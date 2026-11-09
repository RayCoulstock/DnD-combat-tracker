import {useState} from 'react'
import type {FogOfWar} from '../shared/fog'
import type {FogToolSettings,FogPolygonState,FogController} from './fogEditor'
import type {RefObject} from 'react'
import {Button,StatusPill} from './ui'
import './fog-tools.css'
export default function FogOfWarPanel({fog,floorName,settings,active,disabled,busy,failed,message,local,polygon,controller,onSettings,onEnable,onActivate,onOverlay,overlay,onPreview,onReset,onFloor}:{fog?:FogOfWar;floorName:string;settings:FogToolSettings;active:boolean;disabled:boolean;busy:boolean;failed:boolean;message:string;local:boolean;polygon:FogPolygonState;controller:RefObject<FogController|null>;onSettings:(settings:FogToolSettings)=>void;onEnable:(enabled:boolean)=>void;onActivate:()=>void;onOverlay:(show:boolean)=>void;overlay:boolean;onPreview:()=>void;onReset:(all:boolean)=>void;onFloor:(reveal:boolean)=>void}){
 const [radiusText,setRadiusText]=useState(String(settings.radius))
 const [seenRadius,setSeenRadius]=useState(settings.radius)
 if(seenRadius!==settings.radius){setSeenRadius(settings.radius);setRadiusText(String(settings.radius))}
 const editingDisabled=disabled||!fog?.enabled
 return <section className="fog-settings" aria-label="Fog of War settings">
  <p>Active floor: <strong>{floorName}</strong></p>
  <label className="fog-check"><input aria-label="Enable Fog of War" type="checkbox" disabled={disabled} checked={Boolean(fog?.enabled)} onChange={e=>onEnable(e.target.checked)}/>Enable Fog of War</label>
  {!fog?.enabled&&<p>Enable fog to start with every floor concealed. Disabling preserves revealed areas.</p>}
  <fieldset disabled={editingDisabled}><legend>Fog editing</legend>
   <label>Fog operation<select aria-label="Fog operation" value={settings.mode} onChange={e=>onSettings({...settings,mode:e.target.value as FogToolSettings['mode']})}><option value="reveal">Reveal</option><option value="conceal">Conceal</option></select></label>
   <label>Fog shape<select aria-label="Fog shape" value={settings.shape} onChange={e=>onSettings({...settings,shape:e.target.value as FogToolSettings['shape']})}><option value="brush">Brush</option><option value="rectangle">Rectangle</option><option value="polygon">Polygon</option></select></label>
   <label>Brush radius (squares)<input aria-label="Fog brush radius (squares)" type="number" min={.25} max={12} step={.25} disabled={settings.shape!=='brush'} value={radiusText} onBlur={()=>setRadiusText(String(settings.radius))} onChange={e=>{setRadiusText(e.target.value);const n=Number(e.target.value);if(e.target.value&&Number.isFinite(n)&&n>=.25&&n<=12)onSettings({...settings,radius:n})}}/></label>
   <label className="fog-check"><input type="checkbox" checked={settings.snap} onChange={e=>onSettings({...settings,snap:e.target.checked})}/>Snap fog shapes to grid</label>
   <Button aria-pressed={active} onClick={onActivate}>Activate Fog tool</Button>
   {active&&settings.shape==='polygon'&&<div className="fog-polygon-actions"><p role="status">{polygon.count} / 64 vertices · Tap to add; drag to reposition the camera with middle/right mouse or two fingers.</p><div className="fog-actions"><Button disabled={polygon.count<3} onClick={()=>controller.current?.finish()}>Finish polygon</Button><Button disabled={!polygon.count} onClick={()=>controller.current?.back()}>Undo vertex</Button><Button disabled={!polygon.count} onClick={()=>controller.current?.cancel()}>Cancel polygon</Button></div>{polygon.error&&<p role="alert">{polygon.error}</p>}</div>}
   <div className="fog-actions"><Button onClick={()=>onFloor(true)}>Reveal entire floor</Button><Button onClick={()=>onFloor(false)}>Conceal entire floor</Button><Button onClick={()=>onReset(false)}>Reset current floor</Button></div>
  </fieldset>
  <label className="fog-check"><input type="checkbox" checked={overlay} onChange={e=>onOverlay(e.target.checked)}/>Show fog editing overlay</label>
  <figure className="fog-edge-preview"><div aria-hidden="true"/><figcaption>Edge softness preview · Hard boundary</figcaption></figure>
  <div className="fog-actions"><Button onClick={onPreview}>Player Preview</Button><Button disabled={disabled||!fog} onClick={()=>onReset(true)}>Reset Fog</Button></div>
  <p role="status"><StatusPill tone={failed?'danger':busy?'neutral':'success'}>{busy?'Saving map…':failed?'Change not confirmed':local?'Applied to local encounter':'Synced to encounter'}</StatusPill></p>
  {message&&<p role={failed?'alert':'status'}>{message}</p>}
  <p>Left mouse, pen or one finger edits. Middle/right mouse or two fingers controls the camera. Escape cancels. Each completed operation can be undone.</p>
 </section>
}
