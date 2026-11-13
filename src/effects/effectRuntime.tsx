import {EffectClockContext,type EffectClock} from './effectClock'
import {useEffect,useLayoutEffect,useRef,type ReactNode} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {Frustum,Group,Matrix4,Sphere,Vector3,} from 'three'
import {effectParticles,effectPreset,effectRadius,effectSurface,type EnvironmentalEffect} from '../../shared/environmentalEffects'
import {samplePlayback} from '../../shared/effectPlayback'
import type {LightingQuality} from '../../shared/lighting'
export function EffectRuntime({effect,reduced,quality,children}:{effect:EnvironmentalEffect;reduced:boolean;quality:LightingQuality;children:ReactNode}){
 const group=useRef<Group>(null),runtime=useRef<EffectClock>({time:0,opacity:1,update:true}),timer=useRef<ReturnType<typeof setTimeout>|null>(null),last=useRef(-Infinity),invalidate=useThree(s=>s.invalidate)
 const resources=useRef({frustum:new Frustum(),matrix:new Matrix4(),sphere:new Sphere(),position:new Vector3()})
 useLayoutEffect(()=>{last.current=-Infinity;invalidate();return()=>{if(timer.current!==null)clearTimeout(timer.current);timer.current=null}},[effect,reduced,quality,invalidate])
 useEffect(()=>{const p=effect.playback;if(!p||p.mode!=='once'||p.state!=='active')return;const elapsed=p.elapsedMs+Math.max(0,Date.now()-(p.startedAt??Date.now())),expiry=setTimeout(invalidate,Math.max(0,p.durationMs-elapsed)+1);return()=>clearTimeout(expiry)},[effect.playback,invalidate])
 useFrame(state=>{
  const g=group.current,scratch=resources.current;if(!g)return
  const sample=samplePlayback(effect.playback,Date.now(),reduced),surface=effectPreset(effect.presetId).surface,height=surface?effectSurface(effect).radius*2:effectParticles(effect).height
  g.getWorldPosition(scratch.position);scratch.sphere.center.copy(scratch.position);scratch.sphere.center.y+=height*effect.scale/2;scratch.sphere.radius=effectRadius(effect)+height*effect.scale
  state.camera.updateMatrixWorld();scratch.matrix.multiplyMatrices(state.camera.projectionMatrix,state.camera.matrixWorldInverse);scratch.frustum.setFromProjectionMatrix(scratch.matrix)
  const visible=sample.visible&&scratch.frustum.intersectsSphere(scratch.sphere)
  g.visible=visible;g.scale.setScalar(sample.scale);runtime.current.opacity=sample.opacity;runtime.current.time=sample.time??state.clock.elapsedTime
  const distance=state.camera.position.distanceTo(scratch.position),interval=distance>60?(quality==='low'?66:quality==='medium'?33:16):0,now=state.clock.elapsedTime*1000
  runtime.current.update=visible&&(now-last.current>=interval||!sample.moving||reduced)
  if(runtime.current.update)last.current=now
  if(!visible){if(timer.current!==null)clearTimeout(timer.current);timer.current=null;return}
  if(sample.moving&&(!reduced&&effect.speed>0||sample.opacity<1)){
   if(interval){if(timer.current===null)timer.current=setTimeout(()=>{timer.current=null;invalidate()},interval)}else state.invalidate()
  }
 },-2)
 return <EffectClockContext value={runtime}><group ref={group} name={`effect-runtime:${effect.id}`}>{children}</group></EffectClockContext>
}
