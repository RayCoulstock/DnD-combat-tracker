import { isModalOpen } from './modalState'
import {useEffect,useRef,useState} from 'react'
import {Html,Line} from '@react-three/drei'
import {DoubleSide,Shape} from 'three'
import type {ThreeEvent} from '@react-three/fiber'
import {feetToWorld,measurementDistance,type TacticalObject,type TacticalRecord} from '../shared/tactical'
export interface TacticalInteraction{mode:'navigate'|'measure'|'template'|'move';rule:'euclidean'|'diagonal-one'|'diagonal-alternating';onPoint:(point:{x:number;z:number},finish:boolean)=>void;onMeasure:(start:{x:number;z:number},end:{x:number;z:number},finish:boolean)=>void}
export function TacticalSurface({width,height,interaction}:{width:number;height:number;interaction:TacticalInteraction}){
 const start=useRef<{x:number;z:number}|null>(null)
 useEffect(()=>{const cancel=(e:KeyboardEvent)=>{if(!isModalOpen()&&e.key==='Escape')start.current=null};window.addEventListener('keydown',cancel);return()=>window.removeEventListener('keydown',cancel)},[])
 const point=(e:ThreeEvent<PointerEvent>)=>{const raw={x:Math.max(0,Math.min(width,e.point.x+width/2)),z:Math.max(0,Math.min(height,e.point.z+height/2))};return interaction.mode==='measure'&&interaction.rule!=='euclidean'?{x:Math.round(raw.x),z:Math.round(raw.z)}:raw}
 return <mesh position={[0,.035,0]} rotation={[-Math.PI/2,0,0]} onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();if(e.pointerType==='touch'&&!e.isPrimary){start.current=null;return}start.current=point(e);(e.target as unknown as {setPointerCapture:(id:number)=>void}).setPointerCapture(e.pointerId)}} onPointerMove={e=>{e.stopPropagation();const p=point(e);if(interaction.mode==='measure'){if(start.current)interaction.onMeasure(start.current,p,false)}else interaction.onPoint(p,false)}} onPointerUp={e=>{if(e.button!==0)return;e.stopPropagation();const p=point(e);if(interaction.mode==='measure'){if(start.current)interaction.onMeasure(start.current,p,true)}else if(start.current&&e.delta<=3)interaction.onPoint(p,true);start.current=null}} onPointerCancel={()=>{start.current=null}}><planeGeometry args={[width,height]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
}
export function TacticalObject3D({object,width,height,feet,selected=false,onSelect,owner}:{object:TacticalObject;width:number;height:number;feet:number;selected?:boolean;onSelect?:()=>void;owner?:string}){
 const hit=(e:ThreeEvent<MouseEvent>)=>{if(onSelect&&e.delta<=3){e.stopPropagation();onSelect()}}
 if(object.kind==='measurement'){
  const a=[object.start.x-width/2,.08,object.start.z-height/2]as[number,number,number],b=[object.end.x-width/2,.08,object.end.z-height/2]as[number,number,number]
  return <group onClick={hit}><Line points={[a,b]} color={selected?'#ffe291':'#78d5ea'} lineWidth={3}/>{[a,b].map((p,i)=><mesh key={i} position={p}><sphereGeometry args={[.09,8,8]}/><meshBasicMaterial color="#c0edf3"/></mesh>)}<Html center position={[(a[0]+b[0])/2,.3,(a[2]+b[2])/2]} style={{pointerEvents:'none'}}><span className="token-label" data-measurement="visible">{measurementDistance(object.start,object.end,feet,object.rule).toFixed(1)} ft · {object.rule==='euclidean'?'straight':object.rule==='diagonal-one'?'diagonal = 1':`diagonal ${feet}/${feet*2}`}{owner?` · ${owner}`:''}</span></Html></group>
 }
 const radius=feetToWorld(object.radius,feet),length=feetToWorld(object.length,feet),lineWidth=feetToWorld(object.width,feet),side=feetToWorld(object.side,feet),elevation=feetToWorld(object.elevation,feet)
 const sector=new Shape();sector.moveTo(0,0);for(let i=0;i<=32;i++){const a=(-object.angle/2+object.angle*i/32)*Math.PI/180;sector.lineTo(Math.sin(a)*length,Math.cos(a)*length)}sector.closePath()
 const material=<meshBasicMaterial color={object.color} transparent opacity={object.opacity} depthWrite={false} side={DoubleSide}/>
 return <group position={[object.position.x-width/2,elevation,object.position.z-height/2]} rotation={[0,object.rotation*Math.PI/180,0]} onClick={hit}>
  {object.shape==='sphere'?<><mesh position={[0,radius,0]}>{material}<sphereGeometry args={[radius,24,12]}/></mesh><mesh rotation={[-Math.PI/2,0,0]} position={[0,.055,0]}>{material}<circleGeometry args={[radius,48]}/></mesh></>:object.shape==='cone'?<mesh rotation={[-Math.PI/2,0,0]} position={[0,.06,0]}>{material}<shapeGeometry args={[sector]}/></mesh>:<mesh position={object.shape==='line'?[0,.1,-length/2]:[0,side/2+.055,0]}>{material}<boxGeometry args={object.shape==='line'?[lineWidth,.15,length]:[side,side,side]}/></mesh>}
  {selected&&<mesh rotation={[-Math.PI/2,0,0]} position={[0,.075,0]}><ringGeometry args={[.3,.36,24]}/><meshBasicMaterial color="#ffe291" depthWrite={false}/></mesh>}
  <Html position={[0,.35,0]} center style={{pointerEvents:'none'}}><span className="token-label" data-tactical-shape={object.shape}>{object.shape}{owner?` · ${owner}`:' · local preview'}</span></Html>
 </group>
}
export default function TacticalScene({records,draft,selectedId,width,height,feet,onSelect}:{records:TacticalRecord[];draft:TacticalObject|null;selectedId:string|null;width:number;height:number;feet:number;onSelect:(id:string)=>void}){
 const[now,setNow]=useState(()=>Date.now())
 useEffect(()=>{const next=records.flatMap(r=>r.expiresAt&&r.expiresAt>now?[r.expiresAt]:[]).sort((a,b)=>a-b)[0];if(!next)return;const timer=setTimeout(()=>setNow(Date.now()),Math.max(0,next-Date.now())+5);return()=>clearTimeout(timer)},[records,now])
 return <>{records.filter(r=>(!r.expiresAt||r.expiresAt>now)&&!(draft&&selectedId===r.id)).map(r=><TacticalObject3D key={r.id} object={r} width={width} height={height} feet={feet} selected={r.id===selectedId} onSelect={()=>onSelect(r.id)} owner={`Owner ${r.ownerId.slice(0,6)}`}/>)}{draft&&<TacticalObject3D object={draft} width={width} height={height} feet={feet} selected/>}</>
}
