import { isModalOpen } from './modalState'
import {Html} from '@react-three/drei'
import {editMap,emptyHistory,type DungeonMap} from '../shared/dungeon'
import {useEffect,useRef,useState} from 'react'
import type {ThreeEvent} from '@react-three/fiber'
import {drawingBatch,type Drawing} from '../shared/drawing'
export default function DrawingSurface({width,height,settings,onCommit,document}:{width:number;height:number;settings:Omit<Drawing,'type'|'start'|'end'>;onCommit:(command:Drawing)=>void;document?:DungeonMap}){
 const start=useRef<{x:number;z:number}|null>(null),[draft,setDraft]=useState<Drawing|null>(null)
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(!isModalOpen()&&e.key==='Escape'){start.current=null;setDraft(null)}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[])
 const point=(e:ThreeEvent<PointerEvent>)=>({x:Math.max(0,Math.min(width,Math.round(e.point.x+width/2))),z:Math.max(0,Math.min(height,Math.round(e.point.z+height/2)))})
 const update=(e:ThreeEvent<PointerEvent>)=>{if(start.current){const d={...settings,type:'map.draw' as const,start:start.current,end:point(e)};setDraft(d);return d}}
 let preview:ReturnType<typeof drawingBatch>|undefined
 let invalid=''
 let removed:ReturnType<typeof drawingBatch>['walls']=[]
 try{if(draft){preview=drawingBatch(draft,width,height);if(document){const next=editMap({document,width,height},emptyHistory(),draft).frame.document!,oldWalls=new Set(document.walls.map(w=>w.id));removed=document.walls.filter(w=>!next.walls.some(n=>n.id===w.id));preview.walls=next.walls.filter(w=>!oldWalls.has(w.id))}}}catch(e){invalid=(e as Error).message;preview=undefined}
 const area=preview?.floors,first=area?.[0],last=area?.[area.length-1]
 return <>
  <mesh position={[0,.025,0]} rotation={[-Math.PI/2,0,0]} onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();if(e.pointerType==='touch'&&!e.isPrimary){start.current=null;setDraft(null);return}start.current=point(e);update(e);(e.target as unknown as {setPointerCapture:(id:number)=>void}).setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(start.current){e.stopPropagation();update(e)}}} onPointerUp={e=>{if(e.button!==0)return;e.stopPropagation();const d=update(e);start.current=null;setDraft(null);if(d){try{drawingBatch(d,width,height);if(document)editMap({document,width,height},emptyHistory(),d);onCommit(d)}catch{/* Keep invalid gestures local. */}}}} onPointerCancel={()=>{start.current=null;setDraft(null)}}>
   <planeGeometry args={[width,height]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/>
  </mesh>
  {draft&&invalid&&<Html position={[draft.end.x-width/2,.3,draft.end.z-height/2]} center style={{pointerEvents:'none'}}><span className="token-label" role="status">{invalid}</span></Html>}
  {preview?.walls.map(w=><mesh key={w.id} position={[w.x-width/2+(w.axis==='H'?.5:0),.15,w.z-height/2+(w.axis==='V'?.5:0)]}><boxGeometry args={w.axis==='H'?[1,.28,.12]:[.12,.28,1]}/><meshBasicMaterial color="#70c8ff" transparent opacity={.6} depthWrite={false}/></mesh>)}
  {removed.map(w=><mesh key={`remove:${w.id}`} position={[w.x-width/2+(w.axis==='H'?.5:0),.3,w.z-height/2+(w.axis==='V'?.5:0)]}><boxGeometry args={w.axis==='H'?[1,.6,.18]:[.18,.6,1]}/><meshBasicMaterial color="#ff7b66" wireframe depthTest={false}/></mesh>)}
  {first&&last&&<mesh position={[(first.x+last.x+1)/2-width/2,.03,(first.z+last.z+1)/2-height/2]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[last.x-first.x+1,last.z-first.z+1]}/><meshBasicMaterial color="#70c8ff" transparent opacity={.2} depthWrite={false}/></mesh>}
 </>
}
