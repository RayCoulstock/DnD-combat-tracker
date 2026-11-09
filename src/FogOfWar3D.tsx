import {useEffect,useMemo} from 'react'
import {DataTexture,NearestFilter,RedFormat} from 'three'
import {fogResolution,type FogOfWar} from '../shared/fog'
export default function FogOfWar3D({fog,floorId,width,height,overlay=false}:{fog:FogOfWar;floorId:string;width:number;height:number;overlay?:boolean}){
 const encoded=fog.floors[floorId]
 const mask=useMemo(()=>{
  const bytes=new Uint8Array(width*height*fogResolution*fogResolution)
  for(let i=0;i<bytes.length;i++)bytes[i]=(parseInt(encoded?.[Math.floor(i/4)]??'0',16)&(1<<(i%4)))?255:0
  const texture=new DataTexture(bytes,width*fogResolution,height*fogResolution,RedFormat)
  texture.minFilter=texture.magFilter=NearestFilter;texture.generateMipmaps=false;texture.needsUpdate=true;return texture
 },[encoded,width,height])
 useEffect(()=>()=>mask.dispose(),[mask])
 const uniforms=useMemo(()=>({mask:{value:mask},opacity:{value:overlay ? .25 : 1}}),[mask,overlay])
 return <mesh name="fog-of-war" position={[0,.026,0]} rotation={[-Math.PI/2,0,0]} renderOrder={10} raycast={()=>null}>
  <planeGeometry args={[width,height]}/><shaderMaterial uniforms={uniforms} transparent={overlay} depthWrite={!overlay} toneMapped={false}
   vertexShader="varying vec2 fogUv; void main(){fogUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}"
   fragmentShader="uniform sampler2D mask; uniform float opacity; varying vec2 fogUv; void main(){if(texture2D(mask,vec2(fogUv.x,1.0-fogUv.y)).r>0.5)discard;gl_FragColor=vec4(0.0,0.0,0.0,opacity);}"/>
 </mesh>
}
