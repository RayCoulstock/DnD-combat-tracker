import AtmosphericSurfaceMaterial from './AtmosphericSurfaceMaterial'
import {useEffect,useMemo,useState} from 'react'
import {useThree} from '@react-three/fiber'
import {Html} from '@react-three/drei'
import type {Texture} from 'three'
import {repeatingTextureView,repeatingFloorGeometry,floorTextureColor} from './repeatingTextureResources'
import {type RepeatingTexture} from '../shared/floor-surface'
import {textureUrl,floorTextures} from './floorImageResources'
export default function FloorSurface3D({texture,width,height,scope,context,lit=false}:{lit?:boolean;texture:RepeatingTexture;width:number;height:number;scope?:string;context?:{campaignId:string;encounterId:string}}){
 const limit=useThree(s=>Math.min(4096,s.gl.capabilities.maxTextureSize)),url=textureUrl(texture.assetId,scope,context),key=JSON.stringify([url,limit]),allowed=Boolean(scope)||texture.assetId.startsWith('builtin:')
 const[loaded,setLoaded]=useState<{key:string;value?:Texture;error?:string}|null>(null),[retry,setRetry]=useState(0)
 useEffect(()=>{if(!allowed)return;let stopped=false;const lease=floorTextures.acquire(key);void lease.promise.then(value=>{if(!stopped)setLoaded({key,value})}).catch(error=>{if(!stopped)setLoaded({key,error:error instanceof Error?error.message:'Texture unavailable.'})});return()=>{stopped=true;lease.release()}},[allowed,key,retry])
 const source=loaded?.key===key?loaded.value:undefined,error=!allowed?'Sign in to access this texture.':loaded?.key===key?loaded.error:undefined
 // Each floor owns its GPU view. Cached decoded pixels and their transforms stay untouched.
 const view=useMemo(()=>{if(!source)return null;return repeatingTextureView(source)},[source])
 useEffect(()=>()=>view?.dispose(),[view])
 const geometry=useMemo(()=>source?repeatingFloorGeometry(width,height,source.image as {width:number;height:number},texture):null,[source,width,height,texture])
 useEffect(()=>()=>geometry?.dispose(),[geometry])
 const color=useMemo(()=>floorTextureColor(texture.tint,texture.brightness),[texture.tint,texture.brightness])
 if(!view||!geometry)return <Html center position={[0,.05,0]} style={{pointerEvents:error?'auto':'none'}}><span className="token-label" role={error?'alert':'status'} data-floor-texture-state={error?'error':'loading'}>{error?'Floor texture unavailable — using solid floor':'Loading floor texture…'}{error&&<><span className="model-error-detail">{error}</span><button onClick={e=>{e.stopPropagation();setLoaded(null);setRetry(n=>n+1)}}>Retry floor texture</button></>}</span></Html>
 return <><mesh name="floor-texture" receiveShadow={lit} position={[0,-.002,0]} rotation={[-Math.PI/2,0,0]} renderOrder={-1} raycast={()=>null}><primitive object={geometry} attach="geometry" dispose={null}/><AtmosphericSurfaceMaterial lit={lit} map={view} color={color}/></mesh><Html style={{pointerEvents:'none'}}><span className="visually-hidden" data-floor-texture-state="ready" data-texture-asset={texture.assetId}>Floor texture ready</span></Html></>
}
