import {useEffect,useLayoutEffect,useMemo} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {DataTexture,LinearFilter,RGBAFormat,Vector2} from 'three'
import {fogResolution,type FogOfWar} from '../shared/fog'
import {FogAnimation} from './fogAnimation'
class FogResources {
 readonly animation:FogAnimation
 readonly mask:DataTexture
 readonly uniforms
 constructor(width:number,height:number,readonly floorId:string,readonly context:string,readonly overlay:boolean){
  this.animation=new FogAnimation(width,height);this.mask=new DataTexture(this.animation.pixels,width*fogResolution,height*fogResolution,RGBAFormat)
  this.mask.minFilter=this.mask.magFilter=LinearFilter;this.mask.generateMipmaps=false
  this.uniforms={mask:{value:this.mask},dimensions:{value:new Vector2(width*fogResolution,height*fogResolution)},progress:{value:1},soft:{value:false},opacity:{value:overlay?.25:1}}
 }
 update(fog:FogOfWar,reduced:boolean){this.uniforms.soft.value=fog.appearance.edgeSoftness>0;if(this.animation.update(fog,this.floorId,reduced,this.overlay))this.mask.needsUpdate=true;this.frame()}
 frame(){const t=this.animation.progress(Date.now());this.uniforms.progress.value=t;return t<1}
 dispose(){this.mask.dispose()}
}
export default function FogOfWar3D({fog,floorId,width,height,overlay=false,reduced=false,context=''}:{fog:FogOfWar;floorId:string;width:number;height:number;overlay?:boolean;reduced?:boolean;context?:string}){
 const invalidate=useThree(s=>s.invalidate)
 // Context changes snap to the target; the Canvas and camera remain mounted.
 const resources=useMemo(()=>new FogResources(width,height,floorId,context,overlay),[width,height,floorId,context,overlay])
 useEffect(()=>()=>resources.dispose(),[resources])
 useLayoutEffect(()=>{resources.update(fog,reduced);invalidate()},[resources,fog,reduced,invalidate])
 useFrame(()=>{if(resources.frame())invalidate()})
 return <mesh name="fog-of-war" userData={{fogRevision:fog.revision}} position={[0,.026,0]} rotation={[-Math.PI/2,0,0]} renderOrder={10} raycast={()=>null}>
  <planeGeometry args={[width,height]}/><shaderMaterial uniforms={resources.uniforms} transparent depthWrite={false} toneMapped={false}
   vertexShader="varying vec2 fogUv; void main(){fogUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}"
   fragmentShader={`
    uniform sampler2D mask;
    uniform vec2 dimensions;
    uniform float progress;
    uniform bool soft;
    uniform float opacity;
    varying vec2 fogUv;
    void main(){
     vec2 p=vec2(fogUv.x,1.0-fogUv.y);
     vec2 centre=(floor(p*dimensions)+0.5)/dimensions;
     vec4 exact=texture2D(mask,centre);
     vec4 value=soft?texture2D(mask,p):exact;
     // Filtering and interpolation never grant additional map visibility.
     float alpha=exact.r>0.5?1.0:mix(value.b,value.g,progress);
     if(alpha<0.001)discard;
     gl_FragColor=vec4(0.0,0.0,0.0,alpha*opacity);
    }
   `}/>
 </mesh>
}
