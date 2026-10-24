import { memo } from 'react'
import SharedModel3D from './SharedModel3D'
import type { SceneryProp } from '../shared/scenery'
import { canonicalWall } from '../shared/dungeon'
import type { EditorInteraction } from './DungeonScene'
export const Scenery3D=memo(function Scenery3D({prop,width,height,scope,context,editor,preview=false}:{prop:SceneryProp;width:number;height:number;scope?:string;context?:{campaignId:string;encounterId:string};editor?:EditorInteraction;preview?:boolean}){
  const url=`/api/assets/${prop.assetId}/file${context?`?campaignId=${context.campaignId}&encounterId=${context.encounterId}`:''}#${scope??'signed-out'}`
  const placeholder=<mesh position={[0,.4,0]}><boxGeometry args={[.7,.8,.7]}/><meshStandardMaterial color="#986e52" wireframe transparent={preview} opacity={preview?.35:1}/></mesh>
  return <group position={[prop.position.x-width/2+.5,0,prop.position.z-height/2+.5]} onPointerUp={e=>{if(!preview&&editor&&['select','erase'].includes(editor.tool)&&e.button===0&&e.delta<=3){e.stopPropagation();editor.onHit({cell:{x:Math.floor(prop.position.x),z:Math.floor(prop.position.z)},wall:canonicalWall(Math.floor(prop.position.x),Math.floor(prop.position.z),'north'),objectId:prop.id,kind:'prop'})}}}>
    <SharedModel3D url={url} transform={prop} fallback={placeholder} unavailable={!scope} ghost={preview||!prop.visible} selected={editor?.selectedId===prop.id}/>
  </group>
})
