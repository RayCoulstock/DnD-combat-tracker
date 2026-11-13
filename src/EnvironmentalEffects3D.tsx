import {useEffect,useMemo,useRef} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {BufferGeometry,Float32BufferAttribute,ShaderMaterial,Color,Sphere,Vector3,Points} from 'three'
import {effectRegistry,type EnvironmentalEffect} from '../shared/environmentalEffects'
import type {LightingQuality} from '../shared/lighting'
const vertexShader=`
 uniform float time; uniform float pointScale; attribute float seed;
 void main(){
 vec3 p=position; p.x+=sin(time+seed*24.)*.12; p.z+=cos(time*.7+seed*19.)*.12;
 p.y+=sin(time*.5+seed*12.)*.12;
 vec4 view=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*view;
 gl_PointSize=clamp(pointScale/max(.1,-view.z),1.,32.);
 }`
const fragmentShader=`uniform vec3 colour; uniform float alpha;
 void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;
 gl_FragColor=vec4(colour,alpha*(1.-smoothstep(0.,1.,r)));}`
function Motes({effect,quality,reduced}:{effect:EnvironmentalEffect;quality:LightingQuality;reduced:boolean}){
 const count=effectRegistry[effect.presetId].quality[quality],ref=useRef<Points>(null),invalidate=useThree(s=>s.invalidate),height=useThree(s=>s.size.height)
 const geometry=useMemo(()=>{
  let seed=Array.from(effect.id).reduce((a,c)=>(Math.imul(a,31)+c.charCodeAt(0))>>>0,1)
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  const positions=[],seeds=[]
  for(let i=0;i<count;i++){positions.push((random()-.5)*1.2,(random()-.5)*1.2,(random()-.5)*1.2);seeds.push(random())}
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('seed',new Float32BufferAttribute(seeds,1));g.boundingSphere=new Sphere(new Vector3(),1.5);return g
 },[count,effect.id])
 const material=useMemo(()=>new ShaderMaterial({vertexShader,fragmentShader,transparent:true,depthTest:true,depthWrite:false,uniforms:{time:{value:0},pointScale:{value:1},colour:{value:new Color()},alpha:{value:1}}}),[])
 useEffect(()=>()=>geometry.dispose(),[geometry])
 useEffect(()=>()=>material.dispose(),[material])
 useEffect(()=>{const m=ref.current?.material as ShaderMaterial|undefined;if(!m)return;m.uniforms.colour.value.set(effect.color).multiplyScalar(effect.intensity);m.uniforms.alpha.value=effect.opacity*Math.min(1,effect.intensity);m.uniforms.pointScale.value=height*.08*effect.scale;invalidate()},[effect,material,height,invalidate])
 const animate=!reduced&&effect.speed>0&&effect.intensity>0&&effect.opacity>0
 useEffect(()=>{invalidate()},[animate,invalidate])
 useFrame(state=>{if(!ref.current)return;(ref.current.material as ShaderMaterial).uniforms.time.value=reduced?0:state.clock.elapsedTime*effect.speed;if(animate)state.invalidate()})
 return <points dispose={null} ref={ref} name={`environmental-effect:${effect.id}`} geometry={geometry} material={material} raycast={()=>null}/>
}
const renderers={motes:Motes}
export default function EnvironmentalEffects3D({effects,width,height,quality='medium',reduced=false,select,onSelect}:{effects:EnvironmentalEffect[];width:number;height:number;quality?:LightingQuality;reduced?:boolean;select:boolean;onSelect?:(id:string)=>void}){
 return <>{effects.map(effect=>{const Renderer=renderers[effectRegistry[effect.presetId].renderer];return <group key={effect.id} position={[effect.position.x+.5-width/2,effect.position.heightFeet/5,effect.position.z+.5-height/2]} rotation={[0,effect.rotation*Math.PI/180,0]} scale={effect.scale}>
 {effect.enabled&&<Renderer effect={effect} quality={quality} reduced={reduced}/>}
 {select&&<mesh name={`effect-gizmo:${effect.id}`} onPointerUp={e=>{if(e.button===0&&e.delta<=3){e.stopPropagation();onSelect?.(effect.id)}}}><sphereGeometry args={[.2,8,6]}/><meshBasicMaterial color={effect.color} wireframe depthTest={true}/></mesh>}
 </group>})}</>
}
