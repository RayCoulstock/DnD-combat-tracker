import type {RefObject} from 'react'
import type {FogMode,FogShape} from '../shared/fogEditing'
export interface FogToolSettings {shape:FogShape;mode:FogMode;radius:number;snap:boolean}
export interface FogPolygonState {count:number;error:string}
export interface FogController {finish:()=>void;back:()=>void;cancel:()=>void}
export interface FogInteraction extends FogToolSettings {
 floorId:string;revision:number;mask:string;disabled:boolean;overlay:boolean;edgeSoftness:number
 controller:RefObject<FogController|null>
 onPolygonState:(state:FogPolygonState)=>void
 onCommit:(mask:string,expectedMask:string,expectedMapRevision:number)=>void
}
