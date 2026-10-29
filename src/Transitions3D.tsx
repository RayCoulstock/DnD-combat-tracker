import {Html} from '@react-three/drei'
import {transitionSymbols,type FloorTransition} from '../shared/transitions'
import SharedModel3D from './SharedModel3D'
const colors={stairs:'#d9aa55',ladder:'#b58b67',trapdoor:'#b3a384',pit:'#e47b71',portal:'#b68aff'}
export default function Transitions3D({transitions,floorId,width,height,select,scope,context,floorNames}:{floorNames?:Record<string,string>;transitions:FloorTransition[];floorId:string;width:number;height:number;select?:(id:string)=>void;scope?:string;context?:{campaignId:string;encounterId:string}}){
 return <>{transitions.flatMap(transition=>(['source','destination'] as const).filter(end=>transition[end].floorId===floorId).map(end=>{
  const point=transition[end],other=transition[end==='source'?'destination':'source'],color=colors[transition.type]
  return <group key={`${transition.id}:${end}`} name="floor-transition-marker" userData={{transitionId:transition.id,endpoint:end}} position={[point.x-width/2+.5,0,point.z-height/2+.5]} onPointerUp={event=>{if(select&&event.button===0&&event.delta<=3){event.stopPropagation();select(transition.id)}}}>
   <mesh position={[0,.05,0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[.37,transition.type==='trapdoor'?4:24]}/><meshBasicMaterial color={color} transparent opacity={.75} depthWrite={false}/></mesh>
   {transition.type==='portal'?<mesh position={[0,.48,0]}><torusGeometry args={[.4,.05,8,24]}/><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.4}/></mesh>:<group>{[0,1,2].map(i=><mesh key={i} position={[0,.09+i*(transition.type==='stairs'?.09:0),-.22+i*.2]}><boxGeometry args={[.5,.05,.1]}/><meshStandardMaterial color={color}/></mesh>)}</group>}
   {transition.assetId&&<SharedModel3D url={`/api/assets/${transition.assetId}/file${context?`?campaignId=${context.campaignId}&encounterId=${context.encounterId}`:''}#${scope??'signed-out'}`} transform={{scale:1,rotation:0,verticalOffset:0}} unavailable={!scope} fallback={null}/>}
   <Html center position={[0,.8,0]} style={{pointerEvents:'none'}}><span className="token-label" data-transition-marker={transition.id}>{transitionSymbols[transition.type]} {transition.name||transition.type} {end==='source'?'→':transition.directionality==='two-way'?'↔':'←'} {floorNames?.[other.floorId]??other.floorId} ({other.x}, {other.z})</span></Html>
  </group>
 }))}</>
}
