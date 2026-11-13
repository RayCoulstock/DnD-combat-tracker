import {useEffect,useMemo,useRef} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {InstancedBufferGeometry,InstancedBufferAttribute,Float32BufferAttribute,ShaderMaterial,Color,Mesh,DoubleSide,Sphere,Vector3} from 'three'
import {effectPreset,effectSurface} from '../../shared/environmentalEffects'
import type {EffectRendererProps} from './ParticleEffect3D'
const vertexShader=`attribute float seed;uniform float time,radius;varying vec2 vUv;varying float vSeed;
 vec3 bolt(float t){float envelope=sin(t*3.14159265);float phase=floor(time*5.)+seed*91.;return vec3((t-.5)*2.,1.+envelope*(sin(t*35.+phase)*.13+sin(t*73.+phase*2.)*.07),(seed-.5)*.6+envelope*sin(t*27.+phase)*.12)*radius;}
 void main(){vUv=uv;vSeed=seed;vec4 v=modelViewMatrix*vec4(bolt(uv.y),1.);vec4 n=modelViewMatrix*vec4(bolt(min(1.,uv.y+.002)),1.);vec2 delta=n.xy-v.xy;vec2 tangent=delta/max(length(delta),.00001);v.xy+=vec2(-tangent.y,tangent.x)*position.x*radius*.07*length(modelViewMatrix[0].xyz);gl_Position=projectionMatrix*v;}`
const fragmentShader=`uniform float time,alpha,pulse,variant;uniform vec3 colour,accent;varying vec2 vUv;varying float vSeed;
 void main(){float core=pow(max(0.,1.-abs(vUv.x-.5)*2.),.5);float visibility=1.-pulse*.3+pulse*.3*sin(time*3.+vSeed*8.);
 if(variant>.5&&variant<1.5)visibility*=step(.6,fract(time*.55+vSeed*.17));
 if(variant>1.5)visibility*=.6+.4*sin(vUv.y*15.-time*2.+vSeed*5.);
 gl_FragColor=vec4(mix(colour,accent,core),alpha*core*visibility);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`
export default function EnergyEffect3D({effect,quality,reduced}:EffectRendererProps){
 const p=effectSurface(effect),preset=effectPreset(effect.presetId),ref=useRef<Mesh>(null),invalidate=useThree(s=>s.invalidate),segments=quality==='low'?16:quality==='medium'?32:48,count=quality==='low'?2:quality==='medium'?4:7
 const geometry=useMemo(()=>{const g=new InstancedBufferGeometry(),position=[],uv=[],indices=[]
 for(let i=0;i<=segments;i++){const t=i/segments;position.push(-.5,t,0,.5,t,0);uv.push(0,t,1,t);if(i<segments){const j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2)}}
 g.setAttribute('position',new Float32BufferAttribute(position,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(indices);g.setAttribute('seed',new InstancedBufferAttribute(Float32Array.from({length:count},(_,i)=>(i+.5)/count),1));g.instanceCount=count;g.boundingSphere=new Sphere(new Vector3(0,p.radius,0),p.radius*1.6);return g},[segments,count,p.radius])
 const material=useMemo(()=>new ShaderMaterial({vertexShader,fragmentShader,side:DoubleSide,transparent:true,depthTest:true,depthWrite:false,uniforms:{time:{value:0},radius:{value:1},alpha:{value:1},pulse:{value:0},variant:{value:0},colour:{value:new Color()},accent:{value:new Color()}}}),[])
 useEffect(()=>()=>geometry.dispose(),[geometry]);useEffect(()=>()=>material.dispose(),[material])
 useEffect(()=>{const m=ref.current?.material as ShaderMaterial|undefined;if(!m)return;m.uniforms.radius.value=p.radius;m.uniforms.alpha.value=effect.opacity*Math.min(1,effect.intensity);m.uniforms.pulse.value=p.pulse;m.uniforms.variant.value=preset.style==='lightning'?1:preset.style==='unstable'?2:0;m.uniforms.colour.value.set(effect.color).multiplyScalar(effect.intensity);m.uniforms.accent.value.set(p.secondaryColor).multiplyScalar(effect.intensity);invalidate()},[effect,p,preset,invalidate])
 useFrame(state=>{if(!ref.current)return;(ref.current.material as ShaderMaterial).uniforms.time.value=reduced||effect.speed===0?1.4:state.clock.elapsedTime*effect.speed;if(!reduced&&effect.speed>0)state.invalidate()})
 return <mesh ref={ref} dispose={null} name={`environmental-effect:${effect.id}`} geometry={geometry} material={material} raycast={()=>null} userData={{renderer:'energy',style:preset.style,effectParticles:0,segments,ribbons:count}}/>
}
