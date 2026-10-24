import { Html } from '@react-three/drei'
import SharedModel3D from './SharedModel3D'
import { edgePose, type ArchitecturalVisual } from '../shared/architecture'
import type { DungeonMap, Wall } from '../shared/dungeon'
import type { EditorInteraction } from './DungeonScene'
export function BuiltinDoor({state}:{state:'open'|'closed'|'locked'}){
  return <>
    {[-.44,.44].map(x=><mesh key={x} position={[x,.8,0]} castShadow><boxGeometry args={[.12,1.6,.19]}/><meshStandardMaterial color="#646b67"/></mesh>)}
    <group position={[-.38,0,0]} rotation={[0,state==='open'?-Math.PI/2:0,0]}><mesh position={[.38,.65,0]} castShadow><boxGeometry args={[.76,1.3,.09]}/><meshStandardMaterial color={state==='locked'?'#bd913c':'#81522e'}/></mesh><mesh position={[.65,.68,.08]}><sphereGeometry args={[.06,8,8]}/><meshStandardMaterial color="#e9c369"/></mesh></group>
  </>
}
export default function ArchitecturalObject3D({wall,door,map,editor,scope,context,preview=false,visual}:{wall:Wall;door?:DungeonMap['doors'][number];map:Pick<DungeonMap,'width'|'height'>;editor?:EditorInteraction;scope?:string;context?:{campaignId:string;encounterId:string};preview?:boolean;visual?:ArchitecturalVisual}){
  const pose=edgePose(wall,map.width,map.height),assignment=visual ?? (door ? door.visual : wall.visual)
  const fallback=door?<BuiltinDoor state={assignment ? (door.state==='open'?'closed':door.state) : door.state}/>:<mesh position={[0,.8,0]} castShadow receiveShadow><boxGeometry args={[1.04,1.6,.16]}/><meshStandardMaterial color={wall.material==='stone'?'#666c6b':'#775235'} transparent={preview} opacity={preview?.35:1}/></mesh>
  const query=context?`?campaignId=${encodeURIComponent(context.campaignId)}&encounterId=${encodeURIComponent(context.encounterId)}`:''
  const url=assignment?`/api/assets/${encodeURIComponent(assignment.assetId)}/file${query}#${encodeURIComponent(scope??'local')}`:''
  const model=assignment?<SharedModel3D url={url} kind={door?'door':'wall'} architecture={assignment.calibration} transform={{scale:1,rotation:0,verticalOffset:0}} fallback={fallback} ghost={preview} selected={!preview&&editor?.selectedId===(door?.id??wall.id)}/>:fallback
  return <group position={[pose.x,0,pose.z]} rotation={[0,pose.rotation,0]} onPointerUp={e=>{if(!preview&&editor&&['select','erase','wall','door'].includes(editor.tool)&&e.button===0&&e.delta<=3){e.stopPropagation();editor.onHit({cell:{x:Math.min(wall.x,map.width-1),z:Math.min(wall.z,map.height-1)},wall,kind:door?'door':'wall',objectId:door?.id??wall.id})}}}>
    {assignment&&door?<group position={[-.5,0,0]} rotation={[0,door.state==='open'?-Math.PI/2:0,0]}><group position={[.5,0,0]}>{model}</group></group>:model}
    {door&&!preview&&<Html position={[0,1.7,0]} center style={{pointerEvents:'none'}}><span className="token-label" data-door-state={door.state}>{door.state==='locked'?'🔒 Locked':door.state==='open'?'Open':'Closed'}</span></Html>}
  </group>
}
