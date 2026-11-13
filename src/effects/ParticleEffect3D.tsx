import {useEffect,useMemo,useRef} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {InstancedBufferGeometry,InstancedBufferAttribute,Float32BufferAttribute,ShaderMaterial,Color,Mesh,Sphere,Vector3,DoubleSide} from 'three'
import {effectParticles,effectPreset,effectParticleCount,type EnvironmentalEffect} from '../../shared/environmentalEffects'
import type {LightingQuality} from '../../shared/lighting'
export interface EffectRendererProps {effect:EnvironmentalEffect;quality:LightingQuality;reduced:boolean}
const vertexShader=`
 attribute vec4 seed; uniform float time, lifetime, spread, height, style; uniform vec2 drift;
 varying vec2 vUv; varying float vFade;
 void main(){
 float age=fract(time/lifetime+seed.x); if(style==2.)age=fract(time/lifetime);
 float angle=seed.y*6.2831853; float radial=sqrt(seed.z);
 vec3 center=vec3(cos(angle),0.,sin(angle))*spread*radial*(.2+.8*age);
 center.xz+=drift*spread*age;
 center.y=height*age;
 if(style==3.){center.xz=vec2(cos(angle),sin(angle))*spread*radial+drift*spread*age;center.y=.04+height*seed.x;}
 if(style==5.)center.y=height*(1.-age);
 if(style==6.){center=vec3(cos(angle)*spread*age,height*(seed.w-.5)*age,sin(angle)*spread*age);}
 center.xz+=vec2(sin(age*8.+seed.w*24.),cos(age*7.+seed.w*16.))*.08*spread;
 float size=spread*(.25+.5*age);if(style>=4.)size=spread*(.025+.035*seed.w);
 vFade=smoothstep(0.,.12,age)*(1.-smoothstep(.45,1.,age));vUv=uv;
 vec4 view=modelViewMatrix*vec4(center,1.);
 if(style==3.)view=modelViewMatrix*vec4(center+vec3(position.x,0.,position.y)*size*2.,1.);
 else {float scale=length(modelViewMatrix[0].xyz);view.xy+=position.xy*size*2.*scale;}
 gl_Position=projectionMatrix*view;
 }`
const fragmentShader=`
 uniform vec3 colour;uniform float alpha,style,detail;varying vec2 vUv;varying float vFade;
 void main(){
 vec2 p=vUv*2.-1.;float radius=length(p);if(radius>1.)discard;
 float soft=1.-smoothstep(.05,1.,radius);
 if(detail>.5&&style<4.)soft*=.72+.28*sin(p.x*8.+sin(p.y*7.));
 if(style>=4.)soft=pow(soft,1.4);
 gl_FragColor=vec4(colour,alpha*vFade*soft);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`
function particleGeometry(id:string,count:number,spread:number,height:number){
 let seed=2166136261;for(const c of id)seed=Math.imul(seed^c.charCodeAt(0),16777619)>>>0
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
 const geometry=new InstancedBufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0],3));geometry.setAttribute('uv',new Float32BufferAttribute([0,0,1,0,1,1,0,1],2));geometry.setIndex([0,1,2,0,2,3]);geometry.setAttribute('seed',new InstancedBufferAttribute(Float32Array.from({length:count*4},random),4));geometry.instanceCount=count
 geometry.boundingSphere=new Sphere(new Vector3(0,height/2,0),height+spread*4);return geometry
}
const styles:Record<string,number>={smoke:0,steam:1,burst:2,mist:3,embers:4,falling:5,electrical:6,fire:4,motes:4}
export default function ParticleEffect3D({effect,quality,reduced,secondary=false}:{secondary?:boolean}&EffectRendererProps){
 const p=effectParticles(effect),count=secondary?Math.max(4,Math.floor(effectParticleCount(effect,quality)/2)):effectParticleCount(effect,quality),preset=effectPreset(effect.presetId),ref=useRef<Mesh>(null),invalidate=useThree(s=>s.invalidate)
 const geometry=useMemo(()=>particleGeometry(effect.id,count,p.spread,p.height),[effect.id,count,p.spread,p.height])
 const material=useMemo(()=>new ShaderMaterial({vertexShader,fragmentShader,transparent:true,depthTest:true,depthWrite:false,side:DoubleSide,uniforms:{time:{value:0},lifetime:{value:1},spread:{value:1},height:{value:1},style:{value:0},drift:{value:[0,0]},colour:{value:new Color()},alpha:{value:1},detail:{value:1}}}),[])
 useEffect(()=>()=>geometry.dispose(),[geometry]);useEffect(()=>()=>material.dispose(),[material])
 useEffect(()=>{const m=ref.current?.material as ShaderMaterial|undefined;if(!m)return
 m.uniforms.lifetime.value=p.lifetime;m.uniforms.spread.value=p.spread;m.uniforms.height.value=p.height;m.uniforms.drift.value=[p.direction.x,p.direction.z];m.uniforms.style.value=secondary?4:styles[preset.style]??4;m.uniforms.detail.value=quality==='low'?0:1;m.uniforms.colour.value.set(effect.color).multiplyScalar(effect.intensity);m.uniforms.alpha.value=effect.opacity*Math.min(1,effect.intensity);invalidate()
 },[effect,p,preset,quality,secondary,invalidate])
 useFrame(state=>{if(!ref.current)return;(ref.current.material as ShaderMaterial).uniforms.time.value=reduced?p.lifetime*.3:state.clock.elapsedTime*effect.speed;if(!reduced&&effect.speed>0)state.invalidate()})
 return <mesh ref={ref} dispose={null} name={`${secondary?'effect-secondary':'environmental-effect'}:${effect.id}`} geometry={geometry} material={material} raycast={()=>null} userData={{effectParticles:count,renderer:preset.renderer,style:preset.style}}/>
}
