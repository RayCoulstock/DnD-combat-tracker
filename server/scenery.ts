import { syncTemplateImages } from './floor-image-references.ts'
import type { PoolClient } from 'pg'
import { DomainError } from '../shared/domain.ts'
import { isScenery } from '../shared/scenery.ts'
import { readDungeon, type DungeonMap, type MapHistory } from '../shared/dungeon.ts'
export const visibleMapAssets = (document?: DungeonMap | null) => [...new Set([
  ...(document?.props.filter(isScenery).filter(p=>p.visible).map(p=>p.assetId) ?? []),
  ...(document?.walls.filter(w=>!document.doors.some(d=>d.wallId===w.id)).flatMap(w=>w.visual?[w.visual.assetId]:[]) ?? []),
  ...(document?.doors.flatMap(d=>d.visual?[d.visual.assetId]:[]) ?? []),
])]
export const sceneryAssets = (document?: DungeonMap | null) => [...new Set([
  ...(document?.props.filter(isScenery).map(p=>p.assetId) ?? []),
  ...([...document?.walls ?? [],...document?.doors ?? []].flatMap(o=>o.visual?[o.visual.assetId]:[])),
])]
export const historyAssets = (history: MapHistory) => [...new Set([...history.undo,...history.redo].flatMap(f=>sceneryAssets(f.document)))]
export async function syncEncounterScenery(db:PoolClient,encounterId:string,document:DungeonMap|undefined,history:MapHistory,available:Set<string>,allowUnresolved:boolean,prior:Set<string>,required:string[]=[]){
  const ids=[...new Set([...sceneryAssets(document),...historyAssets(history)])]
  for(const id of ids)if(!available.has(id)&&(!allowUnresolved&&!prior.has(id)||required.includes(id)))throw new DomainError('FORBIDDEN','Choose ready scenery assets from your own library.')
  const visible=new Set(visibleMapAssets(document))
  await db.query('DELETE FROM encounter_scenery_asset_references WHERE encounter_id=$1',[encounterId])
  for(const id of ids)if(available.has(id))await db.query('INSERT INTO encounter_scenery_asset_references(encounter_id,asset_id,visible_current) VALUES($1,$2,$3)',[encounterId,id,visible.has(id)])
}
export async function syncTemplateScenery(db:PoolClient,templateId:string,owner:string,input:unknown){
  const document=readDungeon(input),ids=sceneryAssets(document).sort()
  await syncTemplateImages(db, templateId, owner, document)
  const rows=ids.length?(await db.query("SELECT id FROM assets_3d WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND upload_status='ready' ORDER BY id FOR UPDATE",[ids,owner])).rows:[]
  await db.query('DELETE FROM template_scenery_asset_references WHERE template_id=$1',[templateId])
  for(const row of rows)await db.query('INSERT INTO template_scenery_asset_references(template_id,asset_id) VALUES($1,$2)',[templateId,row.id])
}
