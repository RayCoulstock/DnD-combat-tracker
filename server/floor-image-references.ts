import type { PoolClient } from 'pg'
import { DomainError } from '../shared/domain.ts'
import type { DungeonMap, MapHistory } from '../shared/dungeon.ts'
export const imageIds = (document?: DungeonMap | null) => document?.floorImage ? [document.floorImage.imageId] : []
export const historyImageIds = (history: MapHistory) => [...new Set([...history.undo,...history.redo].flatMap(frame=>imageIds(frame.document)))]
export async function syncEncounterImages(db: PoolClient, encounterId:string, document:DungeonMap|undefined, history:MapHistory, prior:string[], allowUnresolved:boolean, required?:string) {
  const ids = [...new Set([...imageIds(document),...historyImageIds(history)])].sort()
  const owner = (await db.query('SELECT c.owner_id FROM campaigns c JOIN encounters e ON e.campaign_id=c.id WHERE e.id=$1',[encounterId])).rows[0].owner_id
  const rows = ids.length ? (await db.query("SELECT id FROM floor_images WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND upload_status='ready' ORDER BY id FOR UPDATE",[ids,owner])).rows : []
  const available = new Set(rows.map(row=>row.id))
  for (const id of ids) if (!available.has(id) && (required===id || (!allowUnresolved && !prior.includes(id)))) throw new DomainError('FORBIDDEN','Choose an available floor image uploaded by this DM.')
  await db.query('DELETE FROM encounter_floor_image_references WHERE encounter_id=$1',[encounterId])
  for (const id of available) await db.query('INSERT INTO encounter_floor_image_references(encounter_id,image_id,current) VALUES($1,$2,$3)',[encounterId,id,document?.floorImage?.imageId===id])
}
export async function syncTemplateImages(db:PoolClient, templateId:string, owner:string, document:DungeonMap) {
  const ids=imageIds(document)
  const rows=ids.length?(await db.query("SELECT id FROM floor_images WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND upload_status='ready' ORDER BY id FOR UPDATE",[ids,owner])).rows:[]
  await db.query('DELETE FROM template_floor_image_references WHERE template_id=$1',[templateId])
  for(const row of rows)await db.query('INSERT INTO template_floor_image_references(template_id,image_id) VALUES($1,$2)',[templateId,row.id])
}
