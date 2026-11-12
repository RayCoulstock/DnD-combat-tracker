import {useCallback,useEffect,useImperativeHandle,useRef,useState} from 'react'
import {useThree,type ThreeEvent} from '@react-three/fiber'
import {Line} from '@react-three/drei'
import {Plane,Vector3,type Mesh} from 'three'
import {FogMaskDraft,sameFogMask,type FogPoint} from '../shared/fogEditing'
import {initialFog} from '../shared/fog'
import type {EditorInteraction} from './DungeonScene'
import {isModalOpen} from './modalState'
import FogOfWar3D from './FogOfWar3D'
interface Gesture {pointer:number;from:FogPoint;last:FogPoint;screen:{x:number;y:number};mask:FogMaskDraft;expected:string}
export default function FogEditorSurface({width,height,editor}:{width:number;height:number;editor:EditorInteraction}){
 const settings=editor.fog!,canvas=useThree(s=>s.gl.domElement),surface=useRef<Mesh>(null)
 const gesture=useRef<Gesture|null>(null),pointers=useRef(new Set<number>()),vertices=useRef<FogPoint[]>([]),polygonBase=useRef('')
 const[points,setPoints]=useState<FogPoint[]>([]),[cursor,setCursor]=useState<FogPoint|null>(null),[preview,setPreview]=useState<string|null>(null),[rectangle,setRectangle]=useState<[FogPoint,FogPoint]|null>(null)
 const notify=settings.onPolygonState
 const cancel=useCallback(()=>{gesture.current=null;vertices.current=[];setPoints([]);setPreview(null);setRectangle(null);setCursor(null);notify({count:0,error:''})},[notify])
 const commit=(mask:string,expected:string)=>{cancel();if(!settings.disabled&&sameFogMask(settings.mask,expected)&&!sameFogMask(mask,expected))settings.onCommit(mask,expected,settings.revision)}
 const finish=()=>{
  if(settings.disabled||settings.shape!=='polygon'||isModalOpen())return
  try{const mask=new FogMaskDraft(width,height,polygonBase.current);mask.polygon(vertices.current,settings.mode);commit(mask.serialize(),polygonBase.current)}catch(error){notify({count:vertices.current.length,error:(error as Error).message})}
 }
 const back=()=>{const next=vertices.current.slice(0,-1);vertices.current=next;setPoints(next);setPreview(null);notify({count:next.length,error:''})}
 useImperativeHandle(settings.controller,()=>({finish,cancel,back}))
 useEffect(()=>{
  const active=new Set<number>();pointers.current=active
  const down=(e:PointerEvent)=>{active.add(e.pointerId);if(active.size>1)cancel()}
  const up=(e:PointerEvent)=>active.delete(e.pointerId)
  const lost=(e:PointerEvent)=>{if(gesture.current?.pointer===e.pointerId)cancel()}
  const abort=()=>{active.clear();cancel()}
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!isModalOpen())cancel()}
  canvas.addEventListener('pointerdown',down,true);canvas.addEventListener('lostpointercapture',lost);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',abort);window.addEventListener('blur',abort);window.addEventListener('keydown',key)
  return()=>{gesture.current=null;vertices.current=[];canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('lostpointercapture',lost);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',abort);window.removeEventListener('blur',abort);window.removeEventListener('keydown',key);notify({count:0,error:''})}
 },[canvas,cancel,notify])
 const point=(e:ThreeEvent<PointerEvent>)=>{
  const parent=surface.current?.parent;if(!parent)return null
  // Intersect the active floor with the fresh event ray, including capture outside
  // the mesh. Tall objects and captured stale intersection points cannot shift it.
  const y=parent.getWorldPosition(new Vector3()).y+.002,world=e.ray.intersectPlane(new Plane(new Vector3(0,1,0),-y),new Vector3());if(!world)return null
  const p=parent.worldToLocal(world),snap=settings.snap&&settings.shape!=='brush'?Math.round:(v:number)=>v
  return {x:Math.max(0,Math.min(width,snap(p.x+width/2))),z:Math.max(0,Math.min(height,snap(p.z+height/2)))}
 }
 const allowed=(e:ThreeEvent<PointerEvent>)=>!settings.disabled&&!e.altKey&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!isModalOpen()&&pointers.current.size<=1
 const update=(p:FogPoint)=>{
  const d=gesture.current;if(!d)return
  if(settings.shape==='brush'){d.mask.brush(d.last,p,settings.radius,settings.mode);d.last=p;setPreview(d.mask.serialize())}
  else if(settings.shape==='rectangle'){d.mask=new FogMaskDraft(width,height,d.expected);d.mask.rectangle(d.from,p,settings.mode);setRectangle([d.from,p]);setPreview(d.mask.serialize())}
 }
 const colour=settings.mode==='reveal'?'#70c8ff':'#f19075'
 const outline=(rectangle?[rectangle[0],{x:rectangle[1].x,z:rectangle[0].z},rectangle[1],{x:rectangle[0].x,z:rectangle[1].z},rectangle[0]]:points.length?[...points,...(cursor?[cursor]:[]),...(points.length>2?[points[0]]:[])]:[]).map(p=>[p.x-width/2,.045,p.z-height/2] as [number,number,number])
 return <>
  <mesh ref={surface} name="fog-editor-surface" position={[0,.002,0]} rotation={[-Math.PI/2,0,0]}
   onPointerDown={e=>{
    if(e.button!==0||e.buttons!==1||!allowed(e))return
    const p=point(e);if(!p)return;e.stopPropagation()
    gesture.current={pointer:e.pointerId,from:p,last:p,screen:{x:e.clientX,y:e.clientY},mask:new FogMaskDraft(width,height,settings.mask),expected:settings.mask};setCursor(p)
    if(settings.shape==='brush')update(p)
    ;(e.target as unknown as {setPointerCapture:(id:number)=>void}).setPointerCapture(e.pointerId)
   }}
   onPointerMove={e=>{const p=point(e);if(!p)return;if(!settings.disabled)setCursor(p);const d=gesture.current;if(d){if(!allowed(e)||e.buttons!==1){cancel();return}if(d.pointer===e.pointerId){e.stopPropagation();update(p)}}}}
   onPointerLeave={()=>{if(!gesture.current)setCursor(null)}} onPointerCancel={cancel}
   onPointerUp={e=>{
    const d=gesture.current;if(!d||d.pointer!==e.pointerId)return;e.stopPropagation()
    if(e.button!==0||e.buttons!==0||!allowed(e)||!sameFogMask(d.expected,settings.mask)){cancel();return}
    const p=point(e);if(!p){cancel();return}
    if(settings.shape==='polygon'){
     gesture.current=null
     if(Math.hypot(e.clientX-d.screen.x,e.clientY-d.screen.y)>4)return
     if(vertices.current.length>=64){notify({count:64,error:'Maximum 64 vertices. Finish the polygon or undo a vertex.'});return}
     if(!vertices.current.length)polygonBase.current=settings.mask
     if(vertices.current.length&&Math.hypot(p.x-vertices.current.at(-1)!.x,p.z-vertices.current.at(-1)!.z)<1e-6)return
     const next=[...vertices.current,p];vertices.current=next;setPoints(next);notify({count:next.length,error:''});return
    }
    update(p);commit(d.mask.serialize(),d.expected)
   }}><planeGeometry args={[width,height]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>
  {settings.overlay&&<FogOfWar3D fog={{...initialFog(),floors:{[settings.floorId]:preview??settings.mask}}} floorId={settings.floorId} width={width} height={height} overlay/>}
  {cursor&&!settings.disabled&&settings.shape==='brush'&&<mesh name="fog-brush-cursor" position={[cursor.x-width/2,.045,cursor.z-height/2]} rotation={[-Math.PI/2,0,0]} raycast={()=>null}><ringGeometry args={[Math.max(0,settings.radius-.035),settings.radius,64]}/><meshBasicMaterial color={colour} transparent opacity={.9} depthWrite={false}/></mesh>}
  {outline.length>1&&<Line name="fog-shape-outline" points={outline} color={colour} lineWidth={2} raycast={()=>null}/>}
  {points.map((p,i)=><mesh key={i} position={[p.x-width/2,.047,p.z-height/2]} rotation={[-Math.PI/2,0,0]} raycast={()=>null}><circleGeometry args={[.065,12]}/><meshBasicMaterial color={colour} depthWrite={false}/></mesh>)}
 </>
}
