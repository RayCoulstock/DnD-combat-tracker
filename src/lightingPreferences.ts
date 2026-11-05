import {useEffect,useState} from 'react'
import {useWorkspacePreference} from './workspacePreferences'
import {qualityProfiles,type LightingQuality} from '../shared/lighting'
export function useLightingPreferences(){
 const[quality,setValue]=useState<LightingQuality>(()=>{try{const value=localStorage.getItem('ledger.ui.lighting.quality');return value&&value in qualityProfiles?value as LightingQuality:'medium'}catch{return 'medium'}})
 const setQuality=(value:LightingQuality)=>{setValue(value);try{localStorage.setItem('ledger.ui.lighting.quality',value)}catch{/* Local preferences are optional. */}}
 const[flicker,setFlicker]=useWorkspacePreference('lighting.flicker',true),[reducedMotion,setReducedMotion]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches)
 useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)'),update=()=>setReducedMotion(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[])
 return {quality,setQuality,flicker,setFlicker,reducedMotion}
}
