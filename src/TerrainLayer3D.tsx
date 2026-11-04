import {terrainMaskTexture} from './terrainResources'
import {useEffect,useMemo,useState} from 'react'
import {useThree} from '@react-three/fiber'
import {Html} from '@react-three/drei'
import {Float32BufferAttribute,type Texture} from 'three'
import {TerrainRaster,type TerrainStroke} from '../shared/terrain'
import {type RepeatingTexture} from '../shared/floor-surface'
import {floorTextures,textureUrl} from './floorImageResources'
import {repeatingFloorGeometry,repeatingTextureView,floorTextureColor} from './repeatingTextureResources'

function TerrainPass({texture,rgba,width,height,index,scope,context}:{texture:RepeatingTexture;rgba:Uint8Array;width:number;height:number;index:number;scope?:string;context?:{campaignId:string;encounterId:string}}){
 const limit=useThree(s=>Math.min(4096,s.gl.capabilities.maxTextureSize)),key=JSON.stringify([textureUrl(texture.assetId,scope,context),limit]),allowed=Boolean(scope)||texture.assetId.startsWith('builtin:')
 const[loaded,setLoaded]=useState<{key:string;value?:Texture;error?:string}|null>(null),[retry,setRetry]=useState(0)
 useEffect(()=>{if(!allowed)return;let stopped=false;const lease=floorTextures.acquire(key);void lease.promise.then(value=>{if(!stopped)setLoaded({key,value})}).catch(e=>{if(!stopped)setLoaded({key,error:e instanceof Error?e.message:'Texture unavailable'})});return()=>{stopped=true;lease.release()}},[allowed,key,retry])
 const source=loaded?.key===key?loaded.value:undefined,error=!allowed?'Sign in to access this terrain texture.':loaded?.key===key?loaded.error:undefined
 const view=useMemo(()=>source?repeatingTextureView(source):null,[source]);useEffect(()=>()=>view?.dispose(),[view])
 const geometry=useMemo(()=>{if(!source)return null;const plane=repeatingFloorGeometry(width,height,source.image as {width:number;height:number},texture);plane.setAttribute('uv1',new Float32BufferAttribute([0,0,1,0,0,1,1,1],2));return plane},[source,width,height,texture]);useEffect(()=>()=>geometry?.dispose(),[geometry])
 const mask=useMemo(()=>terrainMaskTexture(rgba,width*8,height*8),[rgba,width,height]);useEffect(()=>()=>mask.dispose(),[mask])
 const color=useMemo(()=>floorTextureColor(texture.tint,texture.brightness),[texture.tint,texture.brightness])
 if(error)return <Html center position={[0,.05+index*.08,0]}><span className="token-label" role="alert" data-terrain-state="error">Terrain texture unavailable — base surface retained<span className="model-error-detail">{error}</span><button onClick={e=>{e.stopPropagation();setRetry(n=>n+1)}}>Retry terrain texture</button></span></Html>
 if(!view||!geometry)return <Html center style={{pointerEvents:'none'}}><span className="visually-hidden" role="status" data-terrain-state="loading">Loading terrain texture…</span></Html>
 return <><mesh name="terrain-paint" position={[0,-.001,0]} rotation={[-Math.PI/2,0,0]} renderOrder={-.9+index*.1} raycast={()=>null}><primitive object={geometry} attach="geometry" dispose={null}/><meshBasicMaterial map={view} alphaMap={mask} color={color} transparent depthWrite={false} toneMapped={false}/></mesh><Html style={{pointerEvents:'none'}}><span className="visually-hidden" data-terrain-state="ready" data-terrain-asset={texture.assetId}>Terrain texture ready</span></Html></>
}
export default function TerrainLayer3D({strokes,width,height,scope,context}:{strokes:TerrainStroke[];width:number;height:number;scope?:string;context?:{campaignId:string;encounterId:string}}){
 const raster=useMemo(()=>new TerrainRaster(width,height),[width,height])
 const layers=useMemo(()=>raster.update(strokes),[raster,strokes])
 return <>{layers.map((l,i)=><TerrainPass key={JSON.stringify(l.texture)} {...l} index={i} width={width} height={height} scope={scope} context={context}/>)}</>
}
