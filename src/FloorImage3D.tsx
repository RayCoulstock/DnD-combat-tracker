import { useEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { PlaneGeometry, type Texture } from 'three'
import { floorImageUv, type FloorImage } from '../shared/floor-image'
import { floorImageUrl, floorTextures } from './floorImageResources'

export default function FloorImage3D({image,width,height,scope,context}:{image:FloorImage;width:number;height:number;scope?:string;context?:{campaignId:string;encounterId:string}}){
  const limit=useThree(state=>Math.min(4096,state.gl.capabilities.maxTextureSize))
  const key=JSON.stringify([floorImageUrl(image.imageId,scope,context),limit])
  const [loaded,setLoaded]=useState<{key:string;texture?:Texture;error?:string}|null>(null),[retry,setRetry]=useState(0)
  useEffect(()=>{
    if(!scope)return
    let stopped=false
    const lease=floorTextures.acquire(key)
    void lease.promise.then(texture=>{if(!stopped)setLoaded({key,texture})}).catch(error=>{if(!stopped)setLoaded({key,error:error instanceof Error?error.message:'Floor image could not be decoded.'})})
    return()=>{stopped=true;lease.release()}
  },[key,retry,scope])
  const texture=loaded?.key===key?loaded.texture:undefined,error=!scope?'Sign in to the encounter to access this floor image.':loaded?.key===key?loaded.error:undefined
  const geometry=useMemo(()=>{
    if(!texture)return null
    const plane=new PlaneGeometry(width,height),uv=plane.attributes.uv
    const pixels=texture.image as {width:number;height:number}
    for(let i=0;i<uv.count;i++){
      const position=plane.attributes.position
      const [u,v]=floorImageUv(position.getX(i)+width/2,height/2-position.getY(i),width,height,pixels.width,pixels.height,image)
      uv.setXY(i,u,v)
    }
    return plane
  },[texture,width,height,image])
  useEffect(()=>()=>geometry?.dispose(),[geometry])
  if(!texture||!geometry)return <Html center position={[0,.05,0]} style={{pointerEvents:error?'auto':'none'}}><span className="token-label" role={error?'alert':'status'}><span>{error?'Floor image unavailable':'Loading floor image…'}</span>{error&&<><span className="model-error-detail">{error}</span><button onClick={event=>{event.stopPropagation();setLoaded(null);setRetry(value=>value+1)}}>Retry floor image</button></>}</span></Html>
  return <><mesh name="floor-image" renderOrder={-1} position={[0,-.002,0]} rotation={[-Math.PI/2,0,0]} raycast={()=>null}>
    <primitive object={geometry} attach="geometry" dispose={null}/>
    <meshBasicMaterial map={texture} transparent opacity={image.opacity} depthWrite={false} toneMapped={false} onBeforeCompile={shader=>{
      // Clip to the map plane, and leave the procedural floor visible wherever
      // aspect-preserving contain/alignment places UVs outside the image.
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nif (any(lessThan(vMapUv, vec2(0.0))) || any(greaterThan(vMapUv, vec2(1.0)))) discard;')
    }}/>
  </mesh><Html style={{pointerEvents:'none'}}><span className="visually-hidden" data-floor-image-state="ready">Floor image ready</span></Html></>
}
