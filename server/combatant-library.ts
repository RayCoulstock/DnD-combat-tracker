import type { Express, Request } from 'express'
import type { PoolClient } from 'pg'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { transaction, type Pool } from './db.ts'
import { authorize } from './game.ts'
import { artworkStorage } from './artwork.ts'
import { DomainError, type Actor } from '../shared/domain.ts'
import { libraryWriteSchema, libraryDefinition, type LibraryEntry } from '../shared/combatantLibrary.ts'
export function libraryRow(row:Record<string,unknown>):LibraryEntry {
  const {campaign_id,...rest}=row
  return {...rest,campaignId:campaign_id} as unknown as LibraryEntry
}
export async function ownedEntry(db:PoolClient,actor:Actor,id:string,includeArchived=false) {
  if(actor.role!=='dm')throw new DomainError('FORBIDDEN','Dungeon Master access required.')
  const row=(await db.query('SELECT * FROM combatant_library WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,actor.id])).rows[0]
  if(!row||row.archived&&!includeArchived)throw new DomainError('NOT_FOUND','Library entry unavailable.')
  return libraryRow(row)
}
export function registerCombatantLibraryRoutes(app:Express,pool:Pool,requireDM:(req:Request)=>Actor) {
  app.get('/api/combatant-library',async(req,res)=>{
    const actor=requireDM(req)
    res.json((await pool.query('SELECT * FROM combatant_library WHERE owner_id=$1 ORDER BY updated_at DESC',[actor.id])).rows.map(libraryRow))
  })
  app.get('/api/combatant-library/:id/state/:campaignId',async(req,res)=>{
    const actor=requireDM(req),id=z.uuid().parse(req.params.id),campaignId=z.uuid().parse(req.params.campaignId)
    res.json(await transaction(pool,async db=>{
      await authorize(db,actor,campaignId);await ownedEntry(db,actor,id)
      return (await db.query('SELECT state,revision,updated_at FROM campaign_character_state WHERE campaign_id=$1 AND library_id=$2',[campaignId,id])).rows[0]??{state:null,revision:0}
    }))
  })
  // Client-generated IDs make retries safe; revisions protect concurrent editor tabs.
  app.post('/api/combatant-library/:id',async(req,res)=>{
    const actor=requireDM(req),id=z.uuid().parse(req.params.id)
    const data=libraryWriteSchema.extend({revision:z.number().int().nonnegative(),archived:z.boolean().default(false),preserveModel:z.boolean().default(true)}).parse(req.body)
    const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex')
    const entry=await transaction(pool,async db=>{
      if(data.campaignId){await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE',[data.campaignId]);await authorize(db,actor,data.campaignId)}
      // Serialize same-ID creates, including retries arriving before the first commit.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id])
      const existing=(await db.query('SELECT * FROM combatant_library WHERE id=$1 FOR UPDATE',[id])).rows[0]
      if(existing&&existing.owner_id!==actor.id)throw new DomainError('NOT_FOUND','Library entry unavailable.')
      if(existing&&data.revision===0){if(existing.creation_hash===hash)return libraryRow(existing);throw new DomainError('CONFLICT','This ID is already in use.')}
      if(existing?existing.revision!==data.revision:data.revision!==0)throw new DomainError('CONFLICT','Library entry changed. Reopen it before saving.')
      let definition=libraryDefinition(data.definition)
      if(existing&&data.preserveModel)definition={...definition,miniature:existing.definition.miniature}
      const assetId=definition.miniature?.assetId
      if(assetId&&assetId!==existing?.definition.miniature?.assetId){
        if(!(await db.query("SELECT 1 FROM assets_3d WHERE id=$1 AND owner_id=$2 AND upload_status='ready' FOR UPDATE",[assetId,actor.id])).rowCount)throw new DomainError('FORBIDDEN','Choose a ready asset from your own library.')
      }
      const portrait=definition.artwork
      if(portrait?.startsWith('/')){
        const permitted=await db.query(`SELECT 1 FROM combatant_library WHERE owner_id=$1 AND definition->>'artwork'=$2 UNION ALL SELECT 1 FROM combatants b JOIN encounters e ON e.id=b.encounter_id JOIN campaigns c ON c.id=e.campaign_id WHERE c.owner_id=$1 AND b.data->>'artwork'=$2 LIMIT 1`,[actor.id,portrait])
        if(!permitted.rowCount)throw new DomainError('FORBIDDEN','Portrait access denied.')
      }else if(portrait){
        const match=portrait.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/)!
        const bytes=Buffer.from(match[2],'base64');if(bytes.length>3*1024*1024)throw new DomainError('INVALID','Portrait exceeds 3 MB.')
        definition={...definition,artwork:await artworkStorage.put(db,match[1],bytes)}
      }
      const values=[id,actor.id,data.campaignId,data.name,data.kind,definition,data.notes,data.archived,hash]
      const result=existing?await db.query('UPDATE combatant_library SET campaign_id=$3,name=$4,kind=$5,definition=$6,notes=$7,archived=$8,revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *',values.slice(0,8)):await db.query('INSERT INTO combatant_library(id,owner_id,campaign_id,name,kind,definition,notes,archived,creation_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',values)
      return libraryRow(result.rows[0])
    })
    res.json(entry)
  })
}
