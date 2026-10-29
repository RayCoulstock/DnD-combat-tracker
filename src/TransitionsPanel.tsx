import {useState} from 'react'
import {dungeonLevels,type DungeonMap} from '../shared/dungeon'
import {transitionTypes,movementCosts,type FloorTransition} from '../shared/transitions'
import type {GameCommand} from '../shared/domain'
export default function TransitionsPanel({map,draft,onDraft,onNew,onPick,onSelect,send,disabled,onChooseAsset}:{map:DungeonMap;draft:FloorTransition|null;onDraft:(draft:FloorTransition)=>void;onNew:()=>void;onPick:(end:'source'|'destination')=>void;onSelect:(transition:FloorTransition)=>void;send:(command:GameCommand)=>Promise<void>;disabled:boolean;onChooseAsset?:()=>void}){
 const levels=dungeonLevels(map)
 const [error,setError]=useState(''),[busy,setBusy]=useState(false)
 const commit=async(command:GameCommand)=>{setError('');setBusy(true);try{await send(command)}catch(error){setError(error instanceof Error?error.message:'Transition edit failed.')}finally{setBusy(false)}}
 const edit=<K extends keyof FloorTransition>(key:K,value:FloorTransition[K])=>{if(draft)onDraft({...draft,[key]:value})}
 return <details open className="transitions-panel"><summary>Transitions <small>{map.transitions?.length??0}</small></summary><section aria-label="Transition editor">
 <p>Pick both squares, then save one map edit. Costs describe movement; they do not consume it.</p>
 <label>Existing transitions<select aria-label="Existing transitions" value={map.transitions?.some(t=>t.id===draft?.id)?draft!.id:''} onChange={e=>{const item=map.transitions?.find(t=>t.id===e.target.value);if(item)onSelect(item)}}><option value="">New transition</option>{map.transitions?.map(t=><option key={t.id} value={t.id}>{t.name||t.type} · {levels.find(l=>l.id===t.source.floorId)?.name} → {levels.find(l=>l.id===t.destination.floorId)?.name}</option>)}</select></label>
 <button type="button" onClick={onNew} disabled={disabled||levels.length<2}>New transition</button>
 {levels.length<2&&<p>Add a second dungeon level to connect floors.</p>}
 {draft&&<form onSubmit={e=>{e.preventDefault();void commit({type:'map.transition.set',transition:draft})}}><fieldset disabled={disabled||busy}>
 <label>Transition type<select aria-label="Transition type" value={draft.type} onChange={e=>edit('type',e.target.value as FloorTransition['type'])}>{transitionTypes.map(type=><option key={type} value={type}>{type}</option>)}</select></label>
 <label>Transition name<input aria-label="Transition name" value={draft.name??''} maxLength={150} onChange={e=>edit('name',e.target.value)}/></label>
 {(['source','destination'] as const).map(end=><fieldset key={end}><legend>{end==='source'?'Source':'Destination'}</legend>
  <label>{end} floor<select aria-label={`${end} floor`} value={draft[end].floorId} onChange={e=>edit(end,{...draft[end],floorId:e.target.value})}>{levels.map(l=><option key={l.id} value={l.id}>{l.name} · {l.elevationFeet} ft</option>)}</select></label>
  {(['x','z'] as const).map(axis=><label key={axis}>{end} {axis.toUpperCase()} square<input aria-label={`${end} ${axis.toUpperCase()}`} type="number" min={0} max={(axis==='x'?levels.find(l=>l.id===draft[end].floorId)?.width:levels.find(l=>l.id===draft[end].floorId)?.height)!-1} value={draft[end][axis]} onChange={e=>edit(end,{...draft[end],[axis]:Number(e.target.value)})} required/></label>)}
  <button type="button" onClick={()=>onPick(end)}>Pick {end} square on map</button>
 </fieldset>)}
 <label>Directionality<select aria-label="Transition directionality" value={draft.directionality} onChange={e=>edit('directionality',e.target.value as FloorTransition['directionality'])}><option value="two-way">Two-way</option><option value="one-way">One-way</option></select></label>
 <label>Movement cost<select aria-label="Transition movement cost" value={draft.movementCost} onChange={e=>edit('movementCost',e.target.value as FloorTransition['movementCost'])}>{movementCosts.map(cost=><option key={cost} value={cost}>{cost==='normal'?'Normal movement':cost==='difficult'?'Difficult terrain / double cost':'DM decides'}</option>)}</select></label>
 <label>DM notes<textarea aria-label="Transition DM notes" value={draft.dmNotes??''} maxLength={10000} onChange={e=>edit('dmNotes',e.target.value)}/></label>
 {onChooseAsset&&<button type="button" onClick={onChooseAsset}>Choose transition model</button>}{draft.assetId&&<><small>Optional model: {draft.assetId}</small><button type="button" onClick={()=>{const next={...draft};delete next.assetId;onDraft(next)}}>Remove transition model</button></>}
 <button>Save transition</button>{map.transitions?.some(t=>t.id===draft.id)&&<button type="button" onClick={()=>{if(confirm('Delete this transition? Undo can restore it.'))void commit({type:'map.transition.remove',transitionId:draft.id})}}>Delete transition</button>}
 </fieldset></form>}
 {error&&<p role="alert">{error}</p>}
 </section></details>
}
