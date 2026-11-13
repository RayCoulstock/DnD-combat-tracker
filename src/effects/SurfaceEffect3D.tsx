import {useEffectAnimation} from './effectClock'
import {useEffect,useLayoutEffect,useMemo,useRef} from 'react'
import {useThree} from '@react-three/fiber'
import {CircleGeometry,ShaderMaterial,Color,DoubleSide,Mesh,Sphere,Vector3} from 'three'
import {effectPreset,effectSurface,type EnvironmentalEffect} from '../../shared/environmentalEffects'
import ParticleEffect3D,{type EffectRendererProps} from './ParticleEffect3D'
import {portalFragment,circleFragment,corruptionFragment,liquidFragment} from './surfaceShaders'
const vertexShader=`uniform float radius;uniform float upright;varying vec2 vP;
 void main(){vP=position.xy;vec3 p=upright>.5?vec3(position.x*radius,(position.y+1.04)*radius,0.):vec3(position.x*radius,.035,-position.y*radius);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`
const fragments={portal:portalFragment,circle:circleFragment,corruption:corruptionFragment,liquid:liquidFragment}
const variants:Record<string,number>={fey:0,arcane:1,dark:2,runes:0,ritual:1,summoning:2,corruption:0,'dark-energy':1,cracks:2,poison:0,acid:1,lava:2,liquid:3}
type SurfaceKind=keyof typeof fragments
function SurfaceEffect3D({effect,quality,reduced,kind}:EffectRendererProps&{kind:SurfaceKind}){
 const p=effectSurface(effect),preset=effectPreset(effect.presetId),ref=useRef<Mesh>(null),invalidate=useThree(s=>s.invalidate),segments=quality==='low'?24:quality==='medium'?48:64
 const geometry=useMemo(()=>{const g=new CircleGeometry(1.1,segments);g.boundingSphere=new Sphere(new Vector3(0,kind==='portal'?p.radius:0,0),p.radius*2.3);return g},[segments,kind,p.radius])
 const material=useMemo(()=>new ShaderMaterial({vertexShader,fragmentShader:fragments[kind],side:DoubleSide,transparent:true,depthTest:true,depthWrite:false,uniforms:{time:{value:0},radius:{value:1},upright:{value:kind==='portal'?1:0},variant:{value:0},alpha:{value:1},pulse:{value:0},detail:{value:1},secondary:{value:0},colour:{value:new Color()},accent:{value:new Color()}}}),[kind])
 useEffect(()=>()=>geometry.dispose(),[geometry]);useEffect(()=>()=>material.dispose(),[material])
 useLayoutEffect(()=>{const m=ref.current?.material as ShaderMaterial|undefined;if(!m)return;m.uniforms.radius.value=p.radius;m.uniforms.variant.value=variants[preset.style]??0;m.uniforms.alpha.value=effect.opacity*Math.min(1,effect.intensity);m.uniforms.pulse.value=p.pulse;m.uniforms.detail.value=quality==='low'?0:1;m.uniforms.secondary.value=p.particles?1:0;m.uniforms.colour.value.set(effect.color).multiplyScalar(effect.intensity);m.uniforms.accent.value.set(p.secondaryColor).multiplyScalar(effect.intensity);invalidate()},[effect,p,preset,quality,invalidate])
 useEffectAnimation(()=>ref.current,effect,reduced,0)
 const secondary:EnvironmentalEffect={...effect,parameters:{density:.5,lifetime:5,spread:p.radius*.25,height:kind==='portal'?p.radius*2:p.radius*.5,direction:{x:0,z:0},embers:false}}
 return <><mesh ref={ref} dispose={null} name={`environmental-effect:${effect.id}`} geometry={geometry} material={material} raycast={()=>null} userData={{renderer:kind,style:preset.style,effectParticles:0}}/>{preset.secondary==='motes'&&p.particles&&quality!=='low'&&<ParticleEffect3D effect={secondary} quality={quality} reduced={reduced} secondary/>}</>
}
export const PortalEffect3D=(props:EffectRendererProps)=><SurfaceEffect3D {...props} kind="portal"/>
export const CircleEffect3D=(props:EffectRendererProps)=><SurfaceEffect3D {...props} kind="circle"/>
export const CorruptionEffect3D=(props:EffectRendererProps)=><SurfaceEffect3D {...props} kind="corruption"/>
export const LiquidEffect3D=(props:EffectRendererProps)=><SurfaceEffect3D {...props} kind="liquid"/>
