import type {Express,Request} from 'express'
import type {PoolClient} from 'pg'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {transaction,type Pool} from './db.ts'
import {authorize} from './game.ts'
import {ownedEntry} from './combatant-library.ts'
import {DomainError,type Actor} from '../shared/domain.ts'
import {groupWriteSchema,type GroupPreset} from '../shared/groupPresets.ts'
export async function presetRow(db:PoolClient,row:Record<string,unknown>):Promise<GroupPreset>{
 const members=(await db.query('SELECT id,library_id AS "entryId",quantity,side,display_name AS "displayName" FROM combatant_group_members WHERE preset_id=$1 ORDER BY ordinal',[row.id])).rows
 const{campaign_id,...rest}=row;return {...rest,campaignId:campaign_id,members} as unknown as GroupPreset
}
export async function ownedPreset(db:PoolClient,actor:Actor,id:string,archived=false){
 if(actor.role!=='dm')throw new DomainError('FORBIDDEN','Dungeon Master access required.')
 const row=(await db.query('SELECT * FROM combatant_group_presets WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,actor.id])).rows[0]
 if(!row||row.archived&&!archived)throw new DomainError('NOT_FOUND','Group preset unavailable.')
 return presetRow(db,row)
}
export function registerGroupPresetRoutes(app:Express,pool:Pool,requireDM:(req:Request)=>Actor){
 app.get('/api/group-presets',async(req,res)=>{const actor=requireDM(req);res.json(await transaction(pool,async db=>{const rows=(await db.query('SELECT * FROM combatant_group_presets WHERE owner_id=$1 ORDER BY updated_at DESC FOR SHARE',[actor.id])).rows;const presets:GroupPreset[]=[];for(const row of rows)presets.push(await presetRow(db,row));return presets}))})
 app.post('/api/group-presets/:id',async(req,res)=>{
  const actor=requireDM(req),id=z.uuid().parse(req.params.id),data=groupWriteSchema.parse(req.body),hash=createHash('sha256').update(JSON.stringify(data)).digest('hex')
  res.json(await transaction(pool,async db=>{
   if(data.campaignId){await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE',[data.campaignId]);await authorize(db,actor,data.campaignId)}
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id])
   const existing=(await db.query('SELECT * FROM combatant_group_presets WHERE id=$1 FOR UPDATE',[id])).rows[0]
   if(existing&&existing.owner_id!==actor.id)throw new DomainError('NOT_FOUND','Group preset unavailable.')
   if(existing&&data.revision===0){if(existing.creation_hash===hash)return presetRow(db,existing);throw new DomainError('CONFLICT','This ID is already in use.')}
   if(existing?existing.revision!==data.revision:data.revision!==0)throw new DomainError('CONFLICT','Preset changed. Reopen it before saving.')
   for(const entryId of [...new Set(data.members.flatMap(m=>m.entryId?[m.entryId]:[]))].sort()){
    const entry=await ownedEntry(db,actor,entryId,true)
    if(data.campaignId&&entry.kind!=='monster-template'&&entry.campaignId&&entry.campaignId!==data.campaignId)throw new DomainError('INVALID','A character belongs to another campaign.')
    if(entry.kind!=='monster-template'&&data.members.some(m=>m.entryId===entryId&&m.quantity!==1))throw new DomainError('INVALID','Persistent characters have quantity one.')
   }
   // Member UUIDs cannot be taken from another preset.
   if((await db.query('SELECT 1 FROM combatant_group_members WHERE id=ANY($1::uuid[]) AND preset_id<>$2 LIMIT 1',[data.members.map(m=>m.id),id])).rowCount)throw new DomainError('CONFLICT','Member ID is already in use.')
   const values=[id,actor.id,data.campaignId,data.name,data.description,data.archived,hash]
   const row=existing?(await db.query('UPDATE combatant_group_presets SET campaign_id=$3,name=$4,description=$5,archived=$6,revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *',values.slice(0,6))).rows[0]:(await db.query('INSERT INTO combatant_group_presets(id,owner_id,campaign_id,name,description,archived,creation_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',values)).rows[0]
   await db.query('DELETE FROM combatant_group_members WHERE preset_id=$1',[id])
   for(const [ordinal,m]of data.members.entries())await db.query('INSERT INTO combatant_group_members(id,preset_id,library_id,ordinal,quantity,side,display_name) VALUES($1,$2,$3,$4,$5,$6,$7)',[m.id,id,m.entryId,ordinal,m.quantity,m.side,m.displayName])
   return presetRow(db,row)
  }))
 })
}
