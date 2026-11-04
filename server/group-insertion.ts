import type {PoolClient} from 'pg'
import {ownedPreset} from './group-presets.ts'
import {ownedEntry} from './combatant-library.ts'
import {instantiateOwnedLibrary,validateEntryCampaign} from './library-instances.ts'
import {emptyGroupResult,groupInstanceName,type GroupAdd} from '../shared/groupPresets.ts'
import {DomainError,type Actor,type EncounterState,type Combatant} from '../shared/domain.ts'
import type {LibraryEntry} from '../shared/combatantLibrary.ts'
import {dungeonLevels,primaryLevelId} from '../shared/dungeon.ts'
export async function prepareGroupInsertion(db:PoolClient,actor:Actor,campaignId:string,state:EncounterState,command:GroupAdd){
 const report=emptyGroupResult(),preset=await ownedPreset(db,actor,command.presetId)
 if(preset.revision!==command.presetRevision)throw new DomainError('CONFLICT','Preset changed. Review it before inserting.')
 if(preset.campaignId&&preset.campaignId!==campaignId)throw new DomainError('INVALID','This preset belongs to another campaign.')
 const floorId=command.floorId??primaryLevelId(state.dungeonMap)
 if(state.dungeonMap?!dungeonLevels(state.dungeonMap).some(l=>l.id===floorId):floorId!==primaryLevelId(state.dungeonMap))throw new DomainError('INVALID','Choose an existing active floor.')
 const selected=new Map(command.selections.map(s=>[s.memberId,s]))
 const members=[...preset.members.filter(m=>selected.has(m.id)).map(member=>({selection:selected.get(member.id)!,member})),...command.selections.filter(s=>!preset.members.some(m=>m.id===s.memberId)).map(selection=>({selection,member:undefined}))],entries=new Map<string,LibraryEntry>()
 for(const id of [...new Set(members.flatMap(r=>r.member?.entryId?[r.member.entryId]:[]))].sort()){
  try{const entry=await ownedEntry(db,actor,id);validateEntryCampaign(entry,campaignId);entries.set(id,entry)}catch(error){for(const row of members.filter(r=>r.member?.entryId===id))report.failed.push({memberId:row.selection.memberId,reason:(error as Error).message})}
 }
 for(const {selection,member}of members){if(!member||!member.entryId)report.failed.push({memberId:selection.memberId,reason:'Library member is missing.'});else if(entries.has(member.entryId)&&entries.get(member.entryId)!.kind!=='monster-template'&&selection.quantity!==1)report.failed.push({memberId:selection.memberId,reason:'Persistent characters have quantity one.'})}
 if(report.failed.length)throw new DomainError('INVALID','Nothing was added. Review unavailable or invalid members.',report)
 const combatants:Combatant[]=[],usedNames=new Set(state.combatants.map(c=>c.name)),totals=new Map<string,number>(),counters=new Map<string,number>()
 for(const {selection,member}of members){const base=member!.displayName??entries.get(member!.entryId!)!.name;totals.set(base,(totals.get(base)??0)+selection.quantity)}
 for(const {selection,member}of members){
  const entry=entries.get(member!.entryId!)!,working={...state,combatants:[...state.combatants,...combatants]}
  if(entry.kind!=='monster-template'&&!selection.allowDuplicate&&working.combatants.some(c=>c.sourceLibraryId===entry.id)){report.skipped.push({memberId:selection.memberId,reason:`${entry.name} is already in this encounter or selection.`});continue}
  const names:string[]=[]
  for(const id of selection.instanceIds){
   const {instance,missingAsset}=await instantiateOwnedLibrary(db,actor,campaignId,working,entry.id,id,selection.useSavedState,selection.allowDuplicate,entry)
   const base=member!.displayName??entry.name;let ordinal=counters.get(base)??0,name=groupInstanceName(base,null)
   if((totals.get(base)??0)>1||usedNames.has(name)){do{name=groupInstanceName(base,++ordinal)}while(usedNames.has(name))}counters.set(base,ordinal);usedNames.add(name)
   combatants.push({...instance,name,...(member!.side?{side:member!.side}:{}),floorId,unplaced:true});names.push(name)
   if(missingAsset&&!report.warnings.includes(`${entry.name}: default model unavailable; using a placeholder.`))report.warnings.push(`${entry.name}: default model unavailable; using a placeholder.`)
  }
  report.added.push({memberId:selection.memberId,entryId:entry.id,instanceIds:selection.instanceIds,names})
 }
 if(state.combatants.length+combatants.length>100||combatants.some(c=>state.combatants.some(existing=>String(existing.id)===String(c.id)))){for(const added of report.added)report.failed.push({memberId:added.memberId,reason:'Encounter limit exceeded or instance ID is already in use.'});report.added=[];throw new DomainError('INVALID','Nothing was added. Encounter capacity or instance IDs changed.',report)}
 return {combatants,floorId,report}
}
