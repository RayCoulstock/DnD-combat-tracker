import {samplePlayback} from './effectPlayback.ts'
import type {DungeonMap} from './dungeon.ts'
import type {PointLightSource} from './lighting.ts'
import {regionRevealed} from './fog.ts'
import {effectRadius,type EnvironmentalEffect} from './environmentalEffects.ts'
export const linkedEffect=(map:DungeonMap|undefined,sourceId:string)=>map?.environmentalEffects?.effects.find(e=>e.light?.emitterId===sourceId)
export function effectVisible(map:DungeonMap,e:EnvironmentalEffect){
 const floor=e.floorId===(map.level?.id??'ground')?{...map,playerVisible:map.level?.playerVisible??true} : map.levels?.find(l=>l.id===e.floorId)
 if(!floor?.playerVisible)return false
 const light=e.light&&map.lighting?.sources?.find(s=>s.id===e.light!.emitterId),r=Math.max(effectRadius(e),light&&light.enabled&&e.enabled&&e.intensity>0?light.radius:0),x=e.position.x+.5,z=e.position.z+.5
 if(map.fogOfWar?.enabled&&(x-r<0||z-r<0||x+r>floor.width||z+r>floor.height))return false
 return regionRevealed(map.fogOfWar,e.floorId,floor.width,floor.height,x-r,z-r,x+r,z+r)
}
export function effectiveEffectLight(map:DungeonMap|undefined,s:PointLightSource):PointLightSource{
 const e=linkedEffect(map,s.id)
 return e&&(!e.enabled||e.intensity===0||!samplePlayback(e.playback).visible)?{...s,enabled:false}:s
}
export function effectEmitterId(id:string){
 let hash=2166136261;for(const c of id)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0
 return `fx:${id.slice(0,60)}:${hash.toString(16)}`
}

// Under fog, a previous interpolated radius must never outlive the authorized target footprint.
export function effectLightTransition(map:DungeonMap,source:PointLightSource){return linkedEffect(map,source.id)&&(!source.enabled||map.fogOfWar?.enabled)?undefined:map.lighting?.transition}
