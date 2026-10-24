import type { ReactNode } from 'react'
import SharedModel3D from './SharedModel3D'
import { baseFootprint, type MiniatureAppearance } from '../shared/miniatures'
export default function CombatantMiniature3D({appearance,url,unavailable,fallback,color}:{appearance:MiniatureAppearance;url:string;unavailable:boolean;fallback:ReactNode;color:string}){
  const footprint=baseFootprint(appearance.baseSize)
  return <>
    {appearance.showBase&&<mesh position={[0,.06,0]} receiveShadow><cylinderGeometry args={[footprint*.47,footprint*.49,.12,32]}/><meshStandardMaterial color={color} roughness={.8}/></mesh>}
    <SharedModel3D url={url} kind="miniature" transform={{...appearance,verticalOffset:appearance.verticalOffset+(appearance.showBase?.12:0)}} unavailable={unavailable} fallback={fallback}/>
  </>
}
