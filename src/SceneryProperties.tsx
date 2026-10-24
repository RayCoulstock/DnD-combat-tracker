import { useState } from 'react'
import { sceneryLimits, type SceneryProp } from '../shared/scenery'
import type { GameCommand } from '../shared/domain'
export default function SceneryProperties({prop,width,height,send,onMove}:{prop:SceneryProp;width:number;height:number;send:(c:GameCommand)=>void;onMove:()=>void}){
  const[draft,setDraft]=useState(prop)
  const transform=(value:SceneryProp)=>({position:value.position,rotation:value.rotation,scale:value.scale,verticalOffset:value.verticalOffset,visible:value.visible})
  return <section className="scenery-properties" aria-label="Selected scenery properties"><h3>Selected scenery: {prop.label}</h3><small>{prop.id} · {prop.category}</small>
    <form onSubmit={e=>{e.preventDefault();send({type:'map.scenery.update',propId:prop.id,transform:transform(draft)})}}>
      {(['x','z']as const).map(axis=><label key={axis}>Scenery {axis.toUpperCase()}<input type="number" min={0} max={(axis==='x'?width:height)-1} step="any" required value={draft.position[axis]} onChange={e=>setDraft({...draft,position:{...draft.position,[axis]:Number(e.target.value)}})}/></label>)}
      <label>Scenery rotation (degrees)<input type="number" min={0} max={360} step="any" required value={draft.rotation} onChange={e=>setDraft({...draft,rotation:Number(e.target.value)})}/></label>
      <input aria-label="Scenery rotation slider" type="range" min={0} max={360} value={draft.rotation} onChange={e=>setDraft({...draft,rotation:Number(e.target.value)})}/>
      <label>Scenery scale<input type="number" min={sceneryLimits.minScale} max={sceneryLimits.maxScale} step="any" required value={draft.scale} onChange={e=>setDraft({...draft,scale:Number(e.target.value)})}/></label>
      <label>Scenery vertical offset<input type="number" min={sceneryLimits.minOffset} max={sceneryLimits.maxOffset} step="any" required value={draft.verticalOffset} onChange={e=>setDraft({...draft,verticalOffset:Number(e.target.value)})}/></label>
      <label><input type="checkbox" checked={draft.visible} onChange={e=>setDraft({...draft,visible:e.target.checked})}/>Visible to players</label><button>Apply scenery transform</button>
    </form>
    <button onClick={onMove}>Move scenery on map</button><button onClick={()=>send({type:'map.scenery.update',propId:prop.id,transform:transform({...prop,rotation:0,scale:1,verticalOffset:0})})}>Reset scenery transform</button>
    <button onClick={()=>send({type:'map.scenery.duplicate',propId:prop.id,newId:crypto.randomUUID(),position:{x:Math.min(width-1,prop.position.x+1),z:Math.min(height-1,prop.position.z+1)}})}>Duplicate scenery</button><button onClick={()=>send({type:'map.scenery.remove',propId:prop.id})}>Delete scenery</button>
  </section>
}
