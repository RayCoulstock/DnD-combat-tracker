import {useState} from 'react'
import {fogCinematicDefaults,type FogOfWar} from '../shared/fog'
import type {FogToolSettings,FogPolygonState,FogController} from './fogEditor'
import type {RefObject} from 'react'
import {Button,StatusPill} from './ui'
import './fog-tools.css'
export default function FogOfWarPanel({fog,floorName,settings,active,disabled,busy,failed,message,local,polygon,controller,onSettings,onEnable,onActivate,onOverlay,overlay,onPreview,onReset,onFloor,onAppearance}:{fog?:FogOfWar;floorName:string;settings:FogToolSettings;active:boolean;disabled:boolean;busy:boolean;failed:boolean;message:string;local:boolean;polygon:FogPolygonState;controller:RefObject<FogController|null>;onSettings:(settings:FogToolSettings)=>void;onEnable:(enabled:boolean)=>void;onActivate:()=>void;onOverlay:(show:boolean)=>void;overlay:boolean;onPreview:()=>void;onReset:(all:boolean)=>void;onFloor:(reveal:boolean)=>void;onAppearance:(edgeSoftness:0|0.5|1,cinematic:{enabled:boolean;durationMs:number})=>void}){
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
  <FogAppearance fog={fog} disabled={disabled||!fog} onApply={onAppearance}/>
  <div className="fog-actions"><Button onClick={onPreview}>Player Preview</Button><Button disabled={disabled||!fog} onClick={()=>onReset(true)}>Reset Fog</Button></div>
  <p role="status"><StatusPill tone={failed?'danger':busy?'neutral':'success'}>{busy?'Saving map…':failed?'Change not confirmed':local?'Applied to local encounter':'Synced to encounter'}</StatusPill></p>
  {message&&<p role={failed?'alert':'status'}>{message}</p>}
  <p>Left mouse, pen or one finger edits. Middle/right mouse or two fingers controls the camera. Escape cancels. Each completed operation can be undone.</p>
 </section>
}

const softnessPreset=(value=0):0|0.5|1=>value<=0?0:value<.75?.5:1
function FogAppearance({fog,disabled,onApply}:{fog?:FogOfWar;disabled:boolean;onApply:(softness:0|0.5|1,cinematic:{enabled:boolean;durationMs:number})=>void}){
 const saved=JSON.stringify([fog?.appearance.edgeSoftness??0,fog?.cinematic??fogCinematicDefaults])
 const [seen,setSeen]=useState(saved),[softness,setSoftness]=useState<0|0.5|1>(softnessPreset(fog?.appearance.edgeSoftness)),[enabled,setEnabled]=useState((fog?.cinematic??fogCinematicDefaults).enabled),[duration,setDuration]=useState(String((fog?.cinematic??fogCinematicDefaults).durationMs/1000))
 if(saved!==seen){setSeen(saved);setSoftness(softnessPreset(fog?.appearance.edgeSoftness));setEnabled((fog?.cinematic??fogCinematicDefaults).enabled);setDuration(String((fog?.cinematic??fogCinematicDefaults).durationMs/1000))}
 const milliseconds=Math.round(Number(duration)*1000),valid=duration!==''&&Number.isFinite(milliseconds)&&milliseconds>=0&&milliseconds<=2000
 return <fieldset disabled={disabled}><legend>Appearance and reveal animation</legend>
  <p>Opaque black fog</p>
  <label>Edge softness<select aria-label="Fog edge softness" value={softness} onChange={e=>setSoftness(Number(e.target.value) as 0|0.5|1)}><option value={0}>Off</option><option value={.5}>Subtle</option><option value={1}>Soft</option></select></label>
  <figure className="fog-edge-preview"><div aria-hidden="true" style={{background:softness?`linear-gradient(90deg,#000 40%,#eee7d7 ${40+softness*35}%)`:undefined}}/><figcaption>Edge softness preview · {softness===0?'Off':softness<1?'Subtle':'Soft'}</figcaption></figure>
  <label className="fog-check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Enable fog animations</label>
  <label>Reveal duration (seconds)<input aria-label="Fog reveal duration (seconds)" type="number" min={0} max={2} step={.05} value={duration} onChange={e=>setDuration(e.target.value)}/></label>
  <Button disabled={!valid} onClick={()=>onApply(softness,{enabled,durationMs:milliseconds})}>Apply fog appearance</Button>
  <p>Zero duration or reduced motion applies immediately. Concealment is immediate to protect hidden content.</p>
 </fieldset>
}
