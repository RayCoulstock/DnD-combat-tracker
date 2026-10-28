import type { Express, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { z } from 'zod'
import { rateLimit } from 'express-rate-limit'
import type { Actor } from '../shared/domain.ts'
import { transaction, type Pool } from './db.ts'
import { AssetError, type AssetStorage, type StagedAsset } from './asset-storage.ts'
import { multipart } from './asset-upload.ts'
import { floorImageLimits } from './floor-image-config.ts'
import { validateFloorImage } from './floor-image-validation.ts'
const publicImage = (row:Record<string,unknown>) => ({id:row.id,width:row.width,height:row.height,fileSize:Number(row.file_size),revision:row.revision})
export async function recoverFloorImages(pool:Pool,storage:AssetStorage) {
  for(const row of (await pool.query("SELECT id,storage_key,upload_status FROM floor_images WHERE upload_status IN ('processing','deleting')")).rows){
    if(row.upload_status==='processing'){
      if(await storage.exists(row.storage_key))await pool.query("UPDATE floor_images SET upload_status='ready' WHERE id=$1",[row.id])
      else await pool.query('DELETE FROM floor_images WHERE id=$1',[row.id])
    } else {await storage.remove(row.storage_key);await pool.query("UPDATE floor_images SET upload_status='deleted' WHERE id=$1",[row.id])}
  }
}
export function registerFloorImageRoutes(app:Express,pool:Pool,storage:AssetStorage,requireDM:(req:Request)=>Actor,requireActor:(req:Request)=>Actor){
  const limits=floorImageLimits(), owners=new Set<string>();let active=0
  const uploadLimit=rateLimit({windowMs:15*60000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{error:{code:'RATE_LIMIT',message:'Too many floor image uploads. Try again later.'}}})
  app.get('/api/floor-images/:imageId/file',async(req,res)=>{
    const actor=requireActor(req),id=z.uuid().parse(req.params.imageId)
    let row
    if(actor.role==='dm')row=(await pool.query("SELECT * FROM floor_images WHERE id=$1 AND owner_id=$2 AND upload_status='ready'",[id,actor.id])).rows[0]
    else {
      const context=z.object({campaignId:z.uuid(),encounterId:z.uuid()}).strict().parse(req.query)
      row=(await pool.query(`SELECT i.* FROM floor_images i
        JOIN encounter_floor_image_references r ON r.image_id=i.id AND r.current
        JOIN encounters e ON e.id=r.encounter_id JOIN campaigns c ON c.id=e.campaign_id AND c.owner_id=i.owner_id
        JOIN memberships m ON m.campaign_id=c.id AND m.id=$2 AND m.revoked_at IS NULL
        WHERE i.id=$1 AND c.id=$3 AND e.id=$4 AND c.active_encounter_id=e.id AND c.session_active AND i.upload_status='ready'`,[id,actor.id,context.campaignId,context.encounterId])).rows[0]
    }
    if(!row)throw new AssetError(404,'Floor image is unavailable or access has ended.')
    let stream
    try{stream=await storage.read(row.storage_key)}catch{throw new AssetError(503,'Floor image storage is unavailable. Restore storage and retry.')}
    res.set({'Content-Type':'image/webp','Content-Length':String(row.file_size),'Content-Disposition':`inline; filename="${row.id}.webp"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"sandbox; default-src 'none'"})
    stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res)
  })
  app.use('/api/floor-images',(req,_res,next)=>{try{requireDM(req);next()}catch(error){next(error)}})
  app.get('/api/floor-images',async(req,res)=>{
    const actor=requireDM(req)
    const rows=(await pool.query("SELECT * FROM floor_images WHERE owner_id=$1 AND upload_status='ready' ORDER BY created_at DESC LIMIT 100",[actor.id])).rows
    res.json({images:rows.map(publicImage),limits})
  })
  app.post('/api/floor-images',uploadLimit,async(req,res)=>{
    const actor=requireDM(req)
    if(active>=2||owners.has(actor.id))throw new AssetError(429,'Another image is processing. Wait for it to finish.')
    active++;owners.add(actor.id)
    let released=false
    const release=()=>{if(!released){released=true;active--;owners.delete(actor.id)}}
    let staged:StagedAsset|undefined,processed:StagedAsset|undefined,published:string|undefined,inserted:string|undefined
    try{
      const upload=await multipart(req,storage,limits.maxBytes,['png','jpg','jpeg','webp'],value=>z.object({}).strict().parse(value));staged=upload.staged
      const chunks:Buffer[]=[];for await(const chunk of await storage.read(staged.key))chunks.push(Buffer.from(chunk))
      const result=await validateFloorImage(new Uint8Array(Buffer.concat(chunks)),limits)
      if(req.aborted||res.destroyed)throw new AssetError(400,'Image upload cancelled.')
      processed=await storage.stage(Readable.from([result.bytes]),limits.maxBytes)
      // Serialize publication for this owner, including a retry after an interrupted
      // acknowledgement. Never overwrite/remove another request's content-addressed file.
      const image=await transaction(pool,async db=>{
        await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[actor.id])
        const existing=(await db.query("SELECT * FROM floor_images WHERE owner_id=$1 AND content_hash=$2 AND upload_status<>'deleted' FOR UPDATE",[actor.id,processed!.hash])).rows[0]
        if(existing){if(existing.upload_status==='ready')return publicImage(existing);throw new AssetError(409,'This image is being recovered. Retry after recovery completes.')}
        const id=randomUUID(),key=`${actor.id}/${processed!.hash}.webp`
        await db.query("INSERT INTO floor_images(id,owner_id,storage_key,content_hash,width,height,file_size,upload_status) VALUES($1,$2,$3,$4,$5,$6,$7,'processing')",[id,actor.id,key,processed!.hash,result.width,result.height,processed!.size]);inserted=id
        published=await storage.publish(processed!,actor.id,'webp')
        const row=(await db.query("UPDATE floor_images SET upload_status='ready' WHERE id=$1 RETURNING *",[id])).rows[0]
        return publicImage(row)
      })
      // Release before acknowledging so the next sequential upload can start.
      published=undefined // Transaction committed: never remove the acknowledged asset.
      release()
      res.status(201).json(image)
    }catch(error){if(inserted&&published)await storage.remove(published).catch(()=>{});throw error}
    finally{
      release()
      if(staged)await storage.remove(staged.key).catch(()=>{})
      if(processed)await storage.remove(processed.key).catch(()=>{})
    }
  })
  app.post('/api/floor-images/:imageId/delete',async(req,res)=>{
    const actor=requireDM(req),id=z.uuid().parse(req.params.imageId),data=z.object({revision:z.number().int().positive()}).strict().parse(req.body)
    const key=await transaction(pool,async db=>{
      const row=(await db.query('SELECT * FROM floor_images WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,actor.id])).rows[0]
      if(!row||row.revision!==data.revision||row.upload_status!=='ready')throw new AssetError(409,'Image changed or is unavailable. Refresh before deleting.')
      if((await db.query('SELECT 1 FROM encounter_floor_image_references WHERE image_id=$1 UNION ALL SELECT 1 FROM template_floor_image_references WHERE image_id=$1 LIMIT 1',[id])).rowCount)throw new AssetError(409,'Image is referenced by a map, template or undo/redo history. Remove those references before deleting.')
      await db.query("UPDATE floor_images SET upload_status='deleting',revision=revision+1 WHERE id=$1",[id]);return row.storage_key
    })
    try{await storage.remove(key)}catch{throw new AssetError(503,'Image deletion is pending. Restore storage and restart the backend to retry.')}
    await pool.query("UPDATE floor_images SET upload_status='deleted' WHERE id=$1",[id]);res.json({ok:true})
  })
  app.use('/api/floor-images',(error:unknown,_req:Request,res:Response,next:(error:unknown)=>void)=>{
    if(error instanceof AssetError)return res.status(error.status).json({error:{code:'IMAGE',message:error.message}})
    if(error instanceof z.ZodError)return res.status(400).json({error:{code:'INVALID',message:'Invalid floor image request.'}})
    next(error)
  })
}
