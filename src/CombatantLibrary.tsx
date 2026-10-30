import { useEffect, useState } from 'react'
import Modal from './Modal'
import MiniatureSettings from './MiniatureSettings'
import { combatantSchema, type Combatant, type GameCommand, type Snapshot } from '../shared/domain'
import { libraryKinds, type LibraryEntry } from '../shared/combatantLibrary'
import { parseStatBlock } from '../shared/statBlock.js'
import './combatant-library.css'
type API=(path:string,body?:unknown)=>Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
const blank=()=>combatantSchema.parse({id:'definition',name:'New combatant',side:'hero',initiative:0,hp:10,maxHp:10,ac:10,conditions:[],saves:[],actions:[]})
const labels={'player-character':'Player Character','named-npc':'Named NPC','monster-template':'Monster Template'}
export default function CombatantLibrary({api,csrf,snapshot,initial,onClose,onAdd}:{api:API;csrf:string;snapshot?:Snapshot|null;initial?:Combatant;onClose:()=>void;onAdd:(entry:LibraryEntry,saved:boolean,duplicate:boolean,place:boolean)=>Promise<void>;send:(command:GameCommand)=>Promise<void>}) {
  const [entries,setEntries]=useState<LibraryEntry[]>([]),[campaigns,setCampaigns]=useState<{id:string;name:string}[]>([])
  const [search,setSearch]=useState(''),[kind,setKind]=useState(''),[campaign,setCampaign]=useState(''),[archived,setArchived]=useState(false)
  const makeDraft=(definition=blank()):LibraryEntry=>({id:crypto.randomUUID(),name:definition.name,kind:definition.side==='hero'?'player-character':'monster-template',campaignId:snapshot?.campaignId??null,notes:'',definition,revision:0,owner_id:'',archived:false,created_at:'',updated_at:''})
  const [draft,setDraft]=useState<LibraryEntry|null>(()=>initial?makeDraft(initial):null),[json,setJson]=useState(()=>initial?JSON.stringify(initial,null,2):'')
  const [importText,setImportText]=useState(''),[model,setModel]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const [useSaved,setUseSaved]=useState(true),[duplicates,setDuplicates]=useState(false)
  const refresh=async()=>{const [list,camps]=await Promise.all([api('/combatant-library'),api('/campaigns')]);setEntries(list);setCampaigns(camps)}
  useEffect(()=>{let disposed=false;void Promise.all([api('/combatant-library'),api('/campaigns')]).then(([list,camps])=>{if(!disposed){setEntries(list);setCampaigns(camps)}}).catch(e=>{if(!disposed)setMessage(e.message)});return()=>{disposed=true}},[api])
  const open=(entry:LibraryEntry)=>{setDraft(structuredClone(entry));setJson(JSON.stringify(entry.definition,null,2));setImportText('');setMessage('');setDuplicates(false)}
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await fn()}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
  const save=async(next=draft,preserveModel=true)=>{
    if(!next)return
    const saved=await api(`/combatant-library/${next.id}`,{name:next.name,kind:next.kind,campaignId:next.campaignId,notes:next.notes,definition:combatantSchema.parse(JSON.parse(json)),revision:next.revision,archived:next.archived,preserveModel})
    open(saved);await refresh();setMessage('Library entry saved.')
  }
  return <Modal label="Combatant Library" onClose={onClose}><section className="combatant-library">
    <h2>Combatant Library</h2>{!snapshot&&<p>Open an encounter to add a library entry to the tracker or map.</p>}{initial?.sourceLibraryId&&<button onClick={()=>{const source=entries.find(e=>e.id===initial.sourceLibraryId);if(source)open({...source,name:initial.name,definition:{...initial,miniature:source.definition.miniature}});else setMessage('Source entry unavailable. Save a new entry instead.')}}>Update source entry from selected combatant</button>}<button onClick={onClose}>Close library</button><button disabled={busy} onClick={()=>open(makeDraft())}>Create entry</button>
    <label>Search library<input value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <label>Category<select aria-label="Category" value={kind} onChange={e=>setKind(e.target.value)}><option value="">All categories</option>{libraryKinds.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
    <label>Campaign filter<select aria-label="Campaign filter" value={campaign} onChange={e=>setCampaign(e.target.value)}><option value="">All campaigns</option><option value="general">General library</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Show archived</label>
    <div className="combatant-library-columns"><ul aria-label="Library entries">{entries.filter(e=>(archived||!e.archived)&&(!kind||e.kind===kind)&&(!campaign||(campaign==='general'?!e.campaignId:e.campaignId===campaign))&&e.name.toLowerCase().includes(search.toLowerCase())).map(entry=><li key={entry.id}><button onClick={()=>open(entry)}>{entry.name} · {labels[entry.kind]}{entry.archived?' (archived)':''}</button></li>)}</ul>
    {draft&&<article><fieldset disabled={busy}><legend>{draft.revision?'Entry details':'New entry'}</legend>
      <label>Entry name<input required maxLength={200} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      <label>Entry type<select aria-label="Entry type" value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as LibraryEntry['kind']})}>{libraryKinds.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
      <label>Entry campaign<select aria-label="Entry campaign" value={draft.campaignId??''} onChange={e=>setDraft({...draft,campaignId:e.target.value||null})}><option value="">General library</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Library notes<textarea value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
      {draft.definition.artwork&&<img width={100} src={draft.definition.artwork} alt="Character portrait"/>}
      <p>{draft.definition.maxHp} default HP · AC {draft.definition.ac} · {draft.definition.speed}</p><p>{draft.definition.role}</p>{draft.definition.actions.map((a,i)=><p key={i}><strong>{a.name}</strong> {a.text}</p>)}
      <p>Current model: {draft.definition.miniature?.assetId??'Placeholder'} · scale {draft.definition.miniature?.scale??1} · rotation {draft.definition.miniature?.rotation??0}°</p>
      <button onClick={()=>void run(async()=>{const definition=combatantSchema.parse(JSON.parse(json));setDraft({...draft,definition});setModel(true)})}>Assign / change default model</button>
      <label>Import character or monster stat block<textarea value={importText} onChange={e=>setImportText(e.target.value)}/></label>
      <button disabled={!importText.trim()} onClick={()=>void run(async()=>{const parsed=combatantSchema.parse(parseStatBlock(importText,'',draft.kind==='monster-template'?'enemy':'hero'));const old=combatantSchema.parse(JSON.parse(json));const definition={...parsed,miniature:old.miniature,artwork:old.artwork};setJson(JSON.stringify(definition,null,2));setDraft({...draft,name:parsed.name,definition})})}>Parse import</button>
      <label>Import Encounter Ledger combatant JSON<input type="file" accept="application/json,.json" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void run(async()=>{const parsed=combatantSchema.parse(JSON.parse(await file.text()));const old=combatantSchema.parse(JSON.parse(json));const definition={...parsed,miniature:old.miniature,artwork:parsed.artwork??old.artwork};setJson(JSON.stringify(definition,null,2));setDraft({...draft,name:parsed.name,definition})})}}/></label>
      <details><summary>Edit complete stat block / portrait reference (JSON)</summary><label>Stat block JSON<textarea rows={14} value={json} onChange={e=>setJson(e.target.value)}/></label></details>
      <button onClick={()=>void run(()=>save(draft,false))}>Save library entry</button>
      {draft.revision>0&&<><button onClick={()=>{const copy={...draft,id:crypto.randomUUID(),revision:0,name:`${draft.name} Copy`,archived:false};setDraft(copy)}}>Duplicate entry</button><button onClick={()=>void run(()=>save({...draft,archived:!draft.archived}))}>{draft.archived?'Restore entry':'Archive entry'}</button>
      {!draft.archived&&<><label><input type="checkbox" checked={useSaved} onChange={e=>setUseSaved(e.target.checked)}/>Use saved campaign state (otherwise full/default)</label>{draft.kind!=='monster-template'&&<label><input type="checkbox" checked={duplicates} onChange={e=>setDuplicates(e.target.checked)}/>Allow duplicate character in this encounter</label>}
      <button disabled={!snapshot} onClick={()=>void run(()=>onAdd(draft,useSaved,duplicates,true))}>Add to Encounter — choose square</button><button disabled={!snapshot} onClick={()=>void run(()=>onAdd(draft,useSaved,duplicates,false))}>Add to tracker only</button></>}
      <p>Created {new Date(draft.created_at).toLocaleString()} · Updated {new Date(draft.updated_at).toLocaleString()}</p></>}
    </fieldset></article>}</div>{message&&<p role="status">{message}</p>}
    {model&&draft&&<MiniatureSettings combatant={draft.definition} api={api} csrf={csrf} connected={!busy} onClose={()=>setModel(false)} send={async command=>{if(command.type==='combatant.miniature.update'){const definition={...combatantSchema.parse(JSON.parse(json)),miniature:command.miniature};setDraft({...draft,definition});setJson(JSON.stringify(definition,null,2))}}}/>}
  </section></Modal>
}
export function CampaignStateSave({api,snapshot,combatant,send}:{api:API;snapshot:Snapshot;combatant:Combatant;send:(command:GameCommand)=>Promise<void>}){
  const [revision,setRevision]=useState<number|null>(null),[conditions,setConditions]=useState<string[]>([]),[message,setMessage]=useState(''),[saved,setSaved]=useState<unknown>(null)
  useEffect(()=>{let disposed=false;void api(`/combatant-library/${combatant.sourceLibraryId}/state/${snapshot.campaignId}`).then(result=>{if(!disposed){setRevision(result.revision);setSaved(result.state)}}).catch(e=>{if(!disposed)setMessage(e.message)});return()=>{disposed=true}},[api,combatant.sourceLibraryId,snapshot.campaignId])
  return <section><h3>Save to Campaign — {combatant.name}</h3><p>Save {combatant.hp}/{combatant.maxHp} HP. Select only long-term conditions; other conditions will be cleared from saved campaign state.</p><pre>{JSON.stringify(saved,null,2)}</pre>{combatant.conditions.map(c=><label key={c}><input type="checkbox" checked={conditions.includes(c)} onChange={e=>setConditions(e.target.checked?[...conditions,c]:conditions.filter(x=>x!==c))}/>{c}</label>)}<button disabled={revision===null} onClick={()=>{setRevision(null);void send({type:'library.state.save',combatantId:combatant.id,expectedRevision:revision!,conditions}).then(()=>{setMessage('Campaign state saved.');return api(`/combatant-library/${combatant.sourceLibraryId}/state/${snapshot.campaignId}`)}).then(result=>{setRevision(result.revision);setSaved(result.state)}).catch(e=>setMessage(e.message))}}>Save to Campaign</button>{message&&<p role="status">{message}</p>}</section>
}
