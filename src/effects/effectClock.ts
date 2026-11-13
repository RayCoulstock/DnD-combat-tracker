import {createContext,useContext,type RefObject} from 'react'
import {useFrame} from '@react-three/fiber'
import type {Mesh,Points,ShaderMaterial} from 'three'
import type {EnvironmentalEffect} from '../../shared/environmentalEffects'
export interface EffectClock {time:number;opacity:number;update:boolean}
export const EffectClockContext=createContext<RefObject<EffectClock>|null>(null)
export function useEffectAnimation(getTarget:()=>Mesh|Points|null,effect:EnvironmentalEffect,reduced:boolean,staticTime=0){
 const runtime=useContext(EffectClockContext)
 useFrame(state=>{const material=getTarget()?.material as ShaderMaterial|undefined;if(!material||runtime&&!runtime.current.update)return
  material.uniforms.time.value=reduced||effect.speed===0?staticTime:(runtime?.current.time??state.clock.elapsedTime)*effect.speed
  material.uniforms.alpha.value=effect.opacity*Math.min(1,effect.intensity)*(runtime?.current.opacity??1)
  if(!runtime&&!reduced&&effect.speed>0)state.invalidate()
 })
}
