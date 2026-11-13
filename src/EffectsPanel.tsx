import {useState} from 'react'
import {effectCategories,effectRegistry,effectSchema,type EnvironmentalEffect,type EffectPresetId} from '../shared/environmentalEffects'
import type {GameCommand} from '../shared/domain'
import {Button,Feedback,useConfirmation} from './ui'
function Properties({effect,send,onSelect,disabled}:{effect:EnvironmentalEffect;send:(c:GameCommand)=>Promise<void>;onSelect:(id:string|null)=>void;disabled:boolean}){
 const[draft,setDraft]=useState(effect),[message,setMessage]=useState(''),[error,setError]=useState(false),[busy,setBusy]=useState(false),{confirm,confirmation}=useConfirmation()
 const key=JSON.stringify(effect),[seen,setSeen]=useState(key)
 if(key!==seen){setSeen(key);if(JSON.stringify(draft)===seen||JSON.stringify(draft)===key){setDraft(effect);setMessage('Saved effect updated.')}else setMessage('Effect changed elsewhere. Reload or explicitly apply your draft.')}
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await fn();setError(false);setMessage('Effect saved.')}catch(e){setError(true);setMessage((e as Error).message)}finally{setBusy(false)}}
 return <section aria-label="Effect properties">{confirmation}<h3>{effectRegistry[effect.presetId].name}</h3><fieldset disabled={disabled||busy}><legend>Appearance and position</legend>
 <label className="lighting-checkbox"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/>Effect enabled</label>
 {(['scale','intensity','speed','opacity','rotation'] as const).map(k=><label key={k}>Effect {k}<input aria-label={`Effect ${k}`} type="number" step={k==='rotation'?1:.1} min={k==='scale'?.1:0} max={k==='rotation'?360:k==='scale'?5:k==='intensity'?2:k==='speed'?4:1} value={Number.isFinite(draft[k])?draft[k]:''} onChange={e=>setDraft({...draft,[k]:e.target.value===''?NaN:Number(e.target.value)})}/></label>)}
 <label>Effect colour<input aria-label="Effect colour" type="color" value={draft.color} onChange={e=>setDraft({...draft,color:e.target.value})}/></label>
 {(['x','z','heightFeet'] as const).map(k=><label key={k}>Effect {k==='heightFeet'?'height (feet)':k.toUpperCase()+' (squares)'}<input aria-label={`Effect ${k}`} type="number" step={.25} min={0} max={k==='heightFeet'?500:50} value={Number.isFinite(draft.position[k])?draft.position[k]:''} onChange={e=>setDraft({...draft,position:{...draft.position,[k]:e.target.value===''?NaN:Number(e.target.value)}})}/></label>)}
 <div className="ledger-actions"><Button onClick={()=>{setDraft(effect);setMessage('Saved effect reloaded.')}}>Reload saved effect</Button><Button variant="primary" onClick={()=>void run(()=>send({type:'map.effect.set',effect:effectSchema.parse(draft)}))}>Apply effect</Button><Button onClick={()=>void run(async()=>{const id=crypto.randomUUID();await send({type:'map.effect.duplicate',id:effect.id,newId:id});onSelect(id)})}>Duplicate effect</Button><Button variant="danger" onClick={()=>void run(async()=>{if(await confirm('Delete effect','Delete this visual effect? Undo can restore it.','Delete effect')){await send({type:'map.effect.remove',id:effect.id});onSelect(null)}})}>Delete effect</Button></div>
 </fieldset>{message&&<Feedback error={error}>{message}</Feedback>}</section>
}
export default function EffectsPanel({effects,activeId,selectedId,onSelect,onPlace,send,disabled}:{effects:EnvironmentalEffect[];activeId:string;selectedId:string|null;onSelect:(id:string|null)=>void;onPlace:(preset:EffectPresetId,centre:boolean)=>void;send:(c:GameCommand)=>Promise<void>;disabled:boolean}){
 const[category,setCategory]=useState('All'),selected=effects.find(e=>e.id===selectedId)
 return <section className="lighting-form" aria-label="Effects library"><h3>Effects library</h3><fieldset disabled={disabled}><legend>Built-in visual effects</legend><label>Effect category<select aria-label="Effect category" value={category} onChange={e=>setCategory(e.target.value)}>{['All',...effectCategories].map(c=><option key={c}>{c}</option>)}</select></label>
 {Object.values(effectRegistry).filter(p=>category==='All'||p.category===category).map(p=><article key={p.id}><h4>{p.icon} {p.name}</h4><p>{p.category} · {p.description}</p><div className="ledger-actions effects-placement-actions"><Button onClick={()=>onPlace(p.id,false)}>Place {p.name}</Button><Button onClick={()=>onPlace(p.id,true)}>Add {p.name} at level centre</Button></div></article>)}
 <p>Visual effects only. Choose Place then click or tap a square. Escape cancels. Edit position for precise placement.</p>
 <ul className="lighting-source-list">{effects.filter(e=>e.floorId===activeId).map(e=><li key={e.id}><Button aria-pressed={selectedId===e.id} onClick={()=>onSelect(e.id)}>{effectRegistry[e.presetId].name} · {e.enabled?'Enabled':'Disabled'}</Button></li>)}</ul></fieldset>
 {selected&&<Properties key={selected.id} effect={selected} send={send} onSelect={onSelect} disabled={disabled}/>}</section>
}
