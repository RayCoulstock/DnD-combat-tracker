import {regionRevealed} from './fog.ts'
import {dungeonLevels,primaryLevelId} from './dungeon.ts'
import type {EncounterState} from './domain.ts'
import type {PointLightSource,LightPosition} from './lighting.ts'
export function resolveLight(source:PointLightSource,state:{dungeonMap?:EncounterState['dungeonMap'];combatants:{id:string|number;floorId?:string;visible?:boolean;unplaced?:boolean;miniature?:EncounterState['combatants'][number]['miniature']}[];battleMap:Pick<EncounterState['battleMap'],'tokens'>}){
 const attachment=source.attachment
 if(!attachment)return {floorId:source.floorId,position:source.position,parentExists:true,parentVisible:true,placed:true}
 let parent:{x:number;z:number;rotation:number;scale:number;height:number;floorId:string;visible:boolean;placed:boolean}|undefined
 if(attachment.kind==='scenery'){
  const floor=state.dungeonMap&&dungeonLevels(state.dungeonMap).find(l=>l.id===attachment.floorId),prop=floor?.props.find(p=>p.id===attachment.id)
  if(prop)parent={x:prop.position.x,z:prop.position.z,rotation:prop.rotation,scale:prop.scale??1,height:('verticalOffset'in prop?prop.verticalOffset:0)*5,floorId:floor!.id,visible:!('visible'in prop)||prop.visible,placed:true}
 }else{
  const c=state.combatants.find(c=>String(c.id)===attachment.id),p=c&&state.battleMap.tokens[String(c.id)]
  if(c&&p)parent={x:p.x,z:p.z,rotation:c.miniature?.rotation??0,scale:c.miniature?.scale??1,height:((c.miniature?.verticalOffset??0)+(c.miniature?.showBase?.12:0))*5,floorId:c.floorId??primaryLevelId(state.dungeonMap),visible:c.visible!==false,placed:!c.unplaced}
 }
 if(!parent)return{floorId:source.floorId,position:source.position,parentExists:false,parentVisible:false,placed:true}
 const angle=parent.rotation*Math.PI/180,o=attachment.offset
 const position:LightPosition={x:parent.x+parent.scale*(o.x*Math.cos(angle)+o.z*Math.sin(angle)),z:parent.z+parent.scale*(o.z*Math.cos(angle)-o.x*Math.sin(angle)),heightFeet:parent.height+o.heightFeet*parent.scale}
 return{floorId:parent.floorId,position,parentExists:true,parentVisible:parent.visible,placed:parent.placed}
}
export function reconcileLightParents(previous:EncounterState,next:EncounterState,detachMissing=false):EncounterState{
 const rig=next.dungeonMap?.lighting;if(!rig?.sources?.length)return next
 let changed=false
 const sources=rig.sources.map(source=>{
  if(!source.attachment)return source
  const resolved=resolveLight(source,next),prior=previous.dungeonMap?.lighting?.sources?.find(s=>s.id===source.id)
  if(!resolved.parentExists){if(detachMissing&&prior&&resolveLight(prior,previous).parentExists){changed=true;const{attachment,...plain}=source;void attachment;const last=resolveLight(prior,previous);return{...plain,floorId:last.floorId,position:last.position}}return source}
  if(!resolved.placed)return source
  if(resolved.floorId===source.floorId&&(['x','z','heightFeet'] as const).every(k=>Math.abs(resolved.position[k]-source.position[k])<1e-8))return source
  changed=true;return{...source,floorId:resolved.floorId,position:resolved.position}
 })
 return changed?{...next,dungeonMap:{...next.dungeonMap!,lighting:{...rig,sources}}}:next
}
export function permittedLightSources(state:EncounterState,permittedCombatantIds:Set<string>){
 const levels=state.dungeonMap?dungeonLevels(state.dungeonMap):[],fog=state.dungeonMap?.fogOfWar
 return (state.dungeonMap?.lighting?.sources??[]).filter(source=>{
  const resolved=resolveLight(source,state),floor=levels.find(l=>l.id===resolved.floorId&&l.playerVisible)
  if(!floor||!regionRevealed(fog,floor.id,floor.width,floor.height,resolved.position.x,resolved.position.z,resolved.position.x+1,resolved.position.z+1))return false
  if(!source.attachment)return true
  if(!resolved.parentExists||!resolved.parentVisible||!resolved.placed)return false
  // A revealed offset emitter is legitimate even when its parent is fog-hidden.
  // The player receives a detached resolved source, never that hidden parent's ID.
  return fog?.enabled||source.attachment.kind!=='combatant'||permittedCombatantIds.has(source.attachment.id)
 }).map(source=>{
  const resolved=resolveLight(source,state)
  if(fog?.enabled){const{attachment,...plain}=source;void attachment;return{...plain,floorId:resolved.floorId,position:resolved.position,name:'Light'}}
  return{...source,floorId:resolved.floorId,position:resolved.position,name:'Light'}
 })
}
