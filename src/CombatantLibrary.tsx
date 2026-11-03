import { useEffect, useState } from 'react'
import Modal from './Modal'
import MiniatureSettings from './MiniatureSettings'
import { combatantSchema, type Combatant, type GameCommand, type Snapshot } from '../shared/domain'
import { libraryKinds, type LibraryEntry } from '../shared/combatantLibrary'
import { parseStatBlock } from '../shared/statBlock.js'
import './combatant-library.css'
import {Button,EmptyState,Feedback,InspectorSection,StatusPill,useConfirmation} from './ui'
type API=(path:string,body?:unknown)=>Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
const blank=()=>combatantSchema.parse({id:'definition',name:'New combatant',side:'hero',initiative:0,hp:10,maxHp:10,ac:10,conditions:[],saves:[],actions:[]})
const labels={'player-character':'Player Character','named-npc':'Named NPC','monster-template':'Monster Template'}
export default function CombatantLibrary({api,csrf,snapshot,initial,onClose,onAdd}:{api:API;csrf:string;snapshot?:Snapshot|null;initial?:Combatant;onClose:()=>void;onAdd:(entry:LibraryEntry,saved:boolean,duplicate:boolean,place:boolean)=>Promise<void>;send:(command:GameCommand)=>Promise<void>}) {
  const [entries,setEntries]=useState<LibraryEntry[]>([]),[campaigns,setCampaigns]=useState<{id:string;name:string}[]>([])
  const [search,setSearch]=useState(''),[kind,setKind]=useState(''),[campaign,setCampaign]=useState(''),[archived,setArchived]=useState(false)
  const makeDraft=(definition=blank()):LibraryEntry=>({id:crypto.randomUUID(),name:definition.name,kind:definition.side==='hero'?'player-character':'monster-template',campaignId:snapshot?.campaignId??null,notes:'',definition,revision:0,owner_id:'',archived:false,created_at:'',updated_at:''})
  const [draft,setDraft]=useState<LibraryEntry|null>(()=>initial?makeDraft(initial):null),[json,setJson]=useState(()=>initial?JSON.stringify(initial,null,2):'')
  const [importText,setImportText]=useState(''),[model,setModel]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false)
  const {confirm,confirmation}=useConfirmation()
  const [useSaved,setUseSaved]=useState(true),[duplicates,setDuplicates]=useState(false)
  const refresh=async()=>{const [list,camps]=await Promise.all([api('/combatant-library'),api('/campaigns')]);setEntries(list);setCampaigns(camps)}
  useEffect(()=>{let disposed=false;void Promise.all([api('/combatant-library'),api('/campaigns')]).then(([list,camps])=>{if(!disposed){setEntries(list);setCampaigns(camps);setLoading(false)}}).catch(e=>{if(!disposed){setMessage(e.message);setFailed(true);setLoading(false)}});return()=>{disposed=true}},[api])
  const open=(entry:LibraryEntry)=>{setDraft(structuredClone(entry));setJson(JSON.stringify(entry.definition,null,2));setImportText('');setMessage('');setDuplicates(false)}
  const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setFailed(false);setMessage('');try{await fn()}catch(e){setFailed(true);setMessage((e as Error).message)}finally{setBusy(false)}}
  const save=async(next=draft,preserveModel=true)=>{
    if(!next)return
    const saved=await api(`/combatant-library/${next.id}`,{name:next.name,kind:next.kind,campaignId:next.campaignId,notes:next.notes,definition:combatantSchema.parse(JSON.parse(json)),revision:next.revision,archived:next.archived,preserveModel})
    open(saved);await refresh();setMessage('Library entry saved.')
  }
  const filtered=entries.filter(e=>(archived||!e.archived)&&(!kind||e.kind===kind)&&(!campaign||(campaign==='general'?!e.campaignId:e.campaignId===campaign))&&e.name.toLowerCase().includes(search.toLowerCase()))
  const persisted=entries.find(e=>e.id===draft?.id)
  let dirty=Boolean(draft&&!persisted)
  if(draft&&persisted){try{dirty=draft.name!==persisted.name||draft.kind!==persisted.kind||draft.campaignId!==persisted.campaignId||draft.notes!==persisted.notes||JSON.stringify(combatantSchema.parse(JSON.parse(json)))!==JSON.stringify(combatantSchema.parse(persisted.definition))}catch{dirty=true}}
  const discard=async()=>!dirty||await confirm('Discard library draft','Discard unsaved changes to this library entry? Saved entries and encounter instances remain unchanged.','Discard changes')
  const close=async()=>{if(!busy&&await discard())onClose()}
  const choose=async(entry:LibraryEntry)=>{if(!busy&&await discard())open(entry)}
  return <Modal label="Combatant Library" onClose={()=>void close()}><section className="combatant-library ledger-library" aria-label="Combatant Library workspace" data-ui-zone="C2">
    {confirmation}
    <header className="ledger-library-heading"><div><span className="eyebrow">DM LIBRARY</span><h2>Combatant Library</h2><p>Reusable characters, named NPCs and monster templates.</p></div><div className="ledger-actions"><Button disabled={busy} onClick={()=>void choose(makeDraft())}>Create entry</Button><Button disabled={busy} onClick={()=>void close()}>Close library</Button></div></header>
    {!snapshot&&<p>Open an encounter to add a library entry to the tracker or map.</p>}
    {initial?.sourceLibraryId&&<Button disabled={busy} onClick={()=>{const source=entries.find(e=>e.id===initial.sourceLibraryId);if(source)void choose({...source,name:initial.name,definition:{...initial,miniature:source.definition.miniature}});else{setFailed(true);setMessage('Source entry unavailable. Save a new entry instead.')}}}>Update source entry from selected combatant</Button>}
    <div className="ledger-library-toolbar">
    <label>Search library<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <label>Category<select aria-label="Category" value={kind} onChange={e=>setKind(e.target.value)}><option value="">All categories</option>{libraryKinds.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
    <label>Campaign filter<select aria-label="Campaign filter" value={campaign} onChange={e=>setCampaign(e.target.value)}><option value="">All campaigns</option><option value="general">General library</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Show archived</label></div>
    {message&&<Feedback error={failed}>{message}</Feedback>}
    <div className="combatant-library-columns"><div className="combatant-library-list" aria-busy={loading}>
    <p className="library-result-count">{loading?'Loading library…':`${filtered.length} entries`}</p>
    {loading?<p role="status">Loading combatants…</p>:!filtered.length?<EmptyState title={entries.length?'No matching combatants':'Your library is ready'}>{entries.length?'Change the search or filters to find an entry.':'Create an entry or import a character or monster once, then reuse it.'}</EmptyState>:null}
    <ul aria-label="Library entries">{filtered.map(entry=><li key={entry.id}><Button aria-label={`${entry.name} · ${labels[entry.kind]}${entry.archived?' (archived)':''}`} aria-pressed={draft?.id===entry.id} disabled={busy} onClick={()=>void choose(entry)}><span className="library-avatar" aria-hidden="true">{entry.name.trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('')}</span><span><strong>{entry.name}</strong><small>{labels[entry.kind]} · {entry.campaignId?campaigns.find(c=>c.id===entry.campaignId)?.name??'Campaign':'General library'}</small><small>{entry.definition.maxHp} HP · AC {entry.definition.ac}{entry.definition.miniature?.assetId?' · Model assigned':''}{entry.archived?' · Archived':''}</small></span></Button></li>)}</ul></div>
    {draft?<article className="ledger-card library-entry-detail" aria-label="Library entry details"><div className="library-entry-heading"><h3>{draft.name}</h3><StatusPill tone={dirty?'warning':'success'}>{dirty?'Unsaved library draft':'Saved library entry'}</StatusPill></div><fieldset disabled={busy}><legend>{draft.revision?'Entry details':'New entry'}</legend>
      <label>Entry name<input required maxLength={200} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      <label>Entry type<select aria-label="Entry type" value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as LibraryEntry['kind']})}>{libraryKinds.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
      <label>Entry campaign<select aria-label="Entry campaign" value={draft.campaignId??''} onChange={e=>setDraft({...draft,campaignId:e.target.value||null})}><option value="">General library</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Library notes<textarea value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
      {draft.definition.artwork&&<img width={100} src={draft.definition.artwork} alt="Character portrait"/>}
      <p className="library-stat-summary">{draft.definition.maxHp} default HP · AC {draft.definition.ac} · {draft.definition.speed}</p><p>{draft.definition.role}</p>{draft.definition.actions.map((a,i)=><p key={i}><strong>{a.name}</strong> {a.text}</p>)}
      <p className="library-model-assignment">Current model: {draft.definition.miniature?.assetId??'Placeholder'} · scale {draft.definition.miniature?.scale??1} · rotation {draft.definition.miniature?.rotation??0}°</p>
      <Button onClick={()=>void run(async()=>{const definition=combatantSchema.parse(JSON.parse(json));setDraft({...draft,definition});setModel(true)})}>Assign / change default model</Button>
      <InspectorSection key={`${draft.id}:import`} title="Import stats" defaultOpen={draft.revision===0}><p>Replace supported stats while retaining the current model assignment. Save the entry before adding it to an encounter.</p><label>Import character or monster stat block<textarea value={importText} onChange={e=>setImportText(e.target.value)}/></label>
      <Button disabled={!importText.trim()} onClick={()=>void run(async()=>{const parsed=combatantSchema.parse(parseStatBlock(importText,'',draft.kind==='monster-template'?'enemy':'hero'));const old=combatantSchema.parse(JSON.parse(json));const definition={...parsed,miniature:old.miniature,artwork:old.artwork};setJson(JSON.stringify(definition,null,2));setDraft({...draft,name:parsed.name,definition})})}>Parse import</Button>
      <label>Import Encounter Ledger combatant JSON<input type="file" accept="application/json,.json" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void run(async()=>{const parsed=combatantSchema.parse(JSON.parse(await file.text()));const old=combatantSchema.parse(JSON.parse(json));const definition={...parsed,miniature:old.miniature,artwork:parsed.artwork??old.artwork};setJson(JSON.stringify(definition,null,2));setDraft({...draft,name:parsed.name,definition})})}}/></label>
      </InspectorSection><InspectorSection title="Edit complete stat block / portrait reference (JSON)"><label>Stat block JSON<textarea rows={14} value={json} onChange={e=>setJson(e.target.value)}/></label></InspectorSection>
      <div className="ledger-save-bar"><Button variant="primary" onClick={()=>void run(()=>save(draft,false))}>{busy?'Saving…':'Save library entry'}</Button></div>
      {draft.revision>0&&<><Button onClick={()=>{const copy={...draft,id:crypto.randomUUID(),revision:0,name:`${draft.name} Copy`,archived:false};setDraft(copy)}}>Duplicate entry</Button><Button onClick={()=>void run(async()=>{if(await confirm(draft.archived?'Restore entry':'Archive entry',draft.archived?'Restore this entry to the active library?':'Archive this library entry? Existing encounter combatants remain independent.',draft.archived?'Restore':'Archive'))await save({...draft,archived:!draft.archived})})}>{draft.archived?'Restore entry':'Archive entry'}</Button>
      {!draft.archived&&<><h3>Add to encounter</h3>{dirty&&<p>Save your changes to use this entry. Add actions use the saved definition.</p>}<label><input type="checkbox" checked={useSaved} onChange={e=>setUseSaved(e.target.checked)}/>Use saved campaign state (otherwise full/default)</label>{draft.kind!=='monster-template'&&<label><input type="checkbox" checked={duplicates} onChange={e=>setDuplicates(e.target.checked)}/>Allow duplicate character in this encounter</label>}
      <Button disabled={!snapshot||dirty} onClick={()=>void run(()=>onAdd(draft,useSaved,duplicates,true))}>Add to Encounter — choose square</Button><Button disabled={!snapshot||dirty} onClick={()=>void run(()=>onAdd(draft,useSaved,duplicates,false))}>Add to tracker only</Button></>}
      <p className="library-timestamps">Created {new Date(draft.created_at).toLocaleString()} · Updated {new Date(draft.updated_at).toLocaleString()}</p></>}
    </fieldset></article>:<EmptyState title="Choose a combatant">Select an entry to view its stats, model and encounter actions.</EmptyState>}</div>
    {model&&draft&&<MiniatureSettings combatant={draft.definition} api={api} csrf={csrf} connected={!busy} onClose={()=>setModel(false)} send={async command=>{if(command.type==='combatant.miniature.update'){const definition={...combatantSchema.parse(JSON.parse(json)),miniature:command.miniature};setDraft({...draft,definition});setJson(JSON.stringify(definition,null,2))}}}/>}
  </section></Modal>
}
export function CampaignStateSave({api,snapshot,combatant,send}:{api:API;snapshot:Snapshot;combatant:Combatant;send:(command:GameCommand)=>Promise<void>}){
  const [revision,setRevision]=useState<number|null>(null),[conditions,setConditions]=useState<string[]>([]),[message,setMessage]=useState(''),[failed,setFailed]=useState(false),[loading,setLoading]=useState(true),[saved,setSaved]=useState<{hp:number;maxHp:number;conditions:string[]}|null>(null)
  const path=`/combatant-library/${combatant.sourceLibraryId}/state/${snapshot.campaignId}`
  useEffect(()=>{let disposed=false;void api(path).then(result=>{if(!disposed){setRevision(result.revision);setSaved(result.state);setLoading(false)}}).catch(e=>{if(!disposed){setFailed(true);setMessage(e.message);setLoading(false)}});return()=>{disposed=true}},[api,path])
  const reload=async()=>{setLoading(true);setFailed(false);setMessage('');setRevision(null);try{const result=await api(path);setRevision(result.revision);setSaved(result.state)}catch(e){setFailed(true);setMessage((e as Error).message)}finally{setLoading(false)}}
  const save=async()=>{if(revision===null)return;const expectedRevision=revision;setRevision(null);setFailed(false);setMessage('');try{await send({type:'library.state.save',combatantId:combatant.id,expectedRevision,conditions});const result=await api(path);setRevision(result.revision);setSaved(result.state);setMessage('Campaign state saved.')}catch(e){setFailed(true);setMessage((e as Error).message)}}
  return <section className="ledger-form campaign-state-save"><h3>Save to Campaign — {combatant.name}</h3><p>Save {combatant.hp}/{combatant.maxHp} HP. Select only long-term conditions; other conditions will be cleared from saved campaign state.</p><div className="ledger-card"><h4>Previously saved campaign state</h4>{loading?<p role="status">Loading saved state…</p>:saved?<p>{saved.hp}/{saved.maxHp} HP · {saved.conditions?.join(', ')||'No long-term conditions'}</p>:<p>No saved state yet.</p>}</div>{combatant.conditions.map(c=><label key={c}><input type="checkbox" checked={conditions.includes(c)} onChange={e=>setConditions(e.target.checked?[...conditions,c]:conditions.filter(x=>x!==c))}/>{c}</label>)}<Button variant="primary" disabled={revision===null} onClick={()=>void save()}>Save to Campaign</Button>{failed&&<Button disabled={loading} onClick={()=>void reload()}>Reload saved campaign state</Button>}{message&&<Feedback error={failed}>{message}</Feedback>}</section>
}
