import {dungeonLevels} from './dungeon.ts'
import {attachmentParent,resolveLight,type AttachmentState} from './lightingState.ts'
import {lightAppearanceSchema} from './lighting.ts'
import {effectVisible} from './effectLighting.ts'
import {visibleFogLevel,fogTokenVisible} from './fogVisibility.ts'
import type {EnvironmentalEffect} from './environmentalEffects.ts'
import type {EncounterState} from './domain.ts'
export function resolveEffect(e:EnvironmentalEffect,state:AttachmentState){
 if(!e.attachment)return{effect:e,available:true,parentVisible:true}
 const parent=attachmentParent(e.attachment,state)
 if(!parent||!parent.placed)return{effect:e,available:false,parentVisible:false}
 const resolved=resolveLight({...lightAppearanceSchema.parse({}),id:e.id,name:'Effect',floorId:e.floorId,position:e.position,attachment:e.attachment},state)
 return{effect:{...e,floorId:resolved.floorId,position:resolved.position,rotation:((parent.rotation+e.rotation)%360+360)%360},available:true,parentVisible:parent.visible}
}
export function effectPermitted(state:EncounterState,e:EnvironmentalEffect,ids?:Set<string>){
 const map=state.dungeonMap;if(!map)return false
 const r=resolveEffect(e,state)
 if(!r.available||!r.parentVisible)return false
 if(e.attachment?.kind==='scenery'){const target=e.attachment,floor=dungeonLevels(map).find(l=>l.id===target.floorId);if(!floor||!visibleFogLevel(map,floor).props.some(p=>p.id===target.id))return false}
 if(e.attachment?.kind==='combatant'){
  const c=state.combatants.find(c=>String(c.id)===e.attachment!.id)
  if(!c||!c.visible||ids&&!ids.has(String(c.id))||!fogTokenVisible(map,c,state.battleMap.tokens[String(c.id)]))return false
 }
 const p=r.effect.position,floor=r.effect.floorId===(map.level?.id??'ground')?map:map.levels?.find(l=>l.id===r.effect.floorId)
 if(!floor||p.x<0||p.z<0||p.x>=floor.width||p.z>=floor.height||p.heightFeet<0||p.heightFeet>500)return false
 return effectVisible(map,r.effect)
}
export function permittedEffects(state:EncounterState,ids?:Set<string>){
 return(state.dungeonMap?.environmentalEffects?.effects??[]).filter(e=>effectPermitted(state,e,ids)).map(e=>{const {attachment,...plain}=resolveEffect(e,state).effect;void attachment;return plain})
}
// Reconcile only a committed floor transfer; positions/rotation continue to derive from parent state.
export function reconcileEffectParents(state:EncounterState):EncounterState{
 const map=state.dungeonMap;if(!map?.environmentalEffects)return state
 let changed=false
 const effects=map.environmentalEffects.effects.map(e=>{const r=resolveEffect(e,state);if(e.attachment&&r.available&&r.effect.floorId!==e.floorId){changed=true;return{...e,floorId:r.effect.floorId}}return e})
 if(!changed)return state
 const sources=map.lighting?.sources?.map(s=>{const e=effects.find(e=>e.light?.emitterId===s.id);return e?{...s,floorId:e.floorId}:s})
 return{...state,dungeonMap:{...map,environmentalEffects:{...map.environmentalEffects,effects},...(map.lighting?{lighting:{...map.lighting,sources}}:{})}}
}
