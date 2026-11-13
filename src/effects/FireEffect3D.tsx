import {useEffectAnimation} from './effectClock'
import {useEffect,useLayoutEffect,useMemo,useRef} from 'react'
import {useThree} from '@react-three/fiber'
import {InstancedBufferGeometry,InstancedBufferAttribute,Float32BufferAttribute,ShaderMaterial,Mesh,Color,DoubleSide,Sphere,Vector3} from 'three'
import {effectParticles} from '../../shared/environmentalEffects'
import ParticleEffect3D,{type EffectRendererProps} from './ParticleEffect3D'
const vertexShader=`attribute float angle;uniform float height,spread,time;varying vec2 vUv;
 void main(){vUv=uv;vec3 p=position;p.x*=spread*2.;p.y=(p.y+.5)*height;
 p.x+=sin(time*3.+uv.y*8.)*.1*spread*uv.y;
 p=vec3(p.x*cos(angle),p.y,p.x*sin(angle));gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`
const fragmentShader=`uniform float time,alpha,detail;uniform vec3 colour;varying vec2 vUv;
 void main(){float y=vUv.y;float wave=sin(y*14.-time*4.)*.09;
 if(detail>.5)wave+=sin(y*29.+time*7.)*.04;
 float edge=(1.-y)*(.75+wave);float x=abs(vUv.x-.5)*2.;
 float flame=(1.-smoothstep(edge*.5,edge,x))*(1.-smoothstep(.65,1.,y));
 if(flame<.01)discard;
 vec3 gradient=mix(vec3(1.,.85,.32),colour,smoothstep(0.,.7,y));
 gl_FragColor=vec4(gradient,alpha*flame);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`
export default function FireEffect3D({effect,quality,reduced}:EffectRendererProps){
 const p=effectParticles(effect),ref=useRef<Mesh>(null),invalidate=useThree(s=>s.invalidate),layers=quality==='low'?2:3
 const geometry=useMemo(()=>{const g=new InstancedBufferGeometry();g.setAttribute('position',new Float32BufferAttribute([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0],3));g.setAttribute('uv',new Float32BufferAttribute([0,0,1,0,1,1,0,1],2));g.setIndex([0,1,2,0,2,3]);g.setAttribute('angle',new InstancedBufferAttribute(Float32Array.from({length:layers},(_,i)=>i*Math.PI/layers),1));g.instanceCount=layers;g.boundingSphere=new Sphere(new Vector3(0,p.height/2,0),p.height+p.spread*2);return g},[layers,p.height,p.spread])
 const material=useMemo(()=>new ShaderMaterial({vertexShader,fragmentShader,side:DoubleSide,transparent:true,depthTest:true,depthWrite:false,uniforms:{time:{value:0},height:{value:1},spread:{value:1},alpha:{value:1},colour:{value:new Color()},detail:{value:1}}}),[])
 useEffect(()=>()=>geometry.dispose(),[geometry]);useEffect(()=>()=>material.dispose(),[material])
 useLayoutEffect(()=>{const m=ref.current?.material as ShaderMaterial|undefined;if(!m)return;m.uniforms.height.value=p.height;m.uniforms.spread.value=p.spread;m.uniforms.alpha.value=effect.opacity*Math.min(1,effect.intensity);m.uniforms.colour.value.set(effect.color).multiplyScalar(effect.intensity);m.uniforms.detail.value=quality==='low'?0:1;invalidate()},[effect,p,quality,invalidate])
 useEffectAnimation(()=>ref.current,effect,reduced,0)
 return <><mesh dispose={null} ref={ref} name={`environmental-effect:${effect.id}`} geometry={geometry} material={material} raycast={()=>null} userData={{effectParticles:0,renderer:'fire',layers}}/>{p.embers&&quality!=='low'&&<ParticleEffect3D effect={effect} quality={quality} reduced={reduced} secondary/>}</>
}
