import {Button,StatusPill} from './ui'
import type {Campaign} from './DMSetupPanel'
import './my-campaigns.css'
export default function MyCampaigns({campaigns,busy,onJoin,onRefresh,onHost}:{campaigns:Campaign[];busy:boolean;onJoin:(id:string)=>void;onRefresh:()=>void;onHost:(name:string)=>void}){
 return <section className="my-campaigns" aria-label="My Campaigns"><header><div><h1>My Campaigns</h1><p>Membership stays with your account between games.</p></div><Button disabled={busy} onClick={onRefresh}>Refresh campaigns</Button></header>
  <ul className="campaign-cards">{campaigns.map(c=><li key={c.id}><h2>{c.name}</h2><p>Host: {c.hostName??'Campaign host'}</p><p>{c.role==='dm'?'Campaign host':'Active member'} · <StatusPill tone={c.session_active?'success':'neutral'}>{c.session_active?'Live':'Waiting for DM'}</StatusPill></p><Button disabled={busy} aria-label={`${c.role==='dm'?'Open':c.session_active?'Join':'Wait for'} ${c.name}`} onClick={()=>onJoin(c.id)}>{c.role==='dm'?'Open campaign':c.session_active?'Join game':'Wait for DM'}</Button></li>)}</ul>
  {!campaigns.length&&<p role="status">No authorized campaigns. Accept an invitation to join a campaign.</p>}
  <details><summary>Host a campaign</summary><form onSubmit={e=>{e.preventDefault();const name=String(new FormData(e.currentTarget).get('name'));onHost(name)}}><label>New hosted campaign<input name="name" required maxLength={150} autoComplete="off"/></label><Button type="submit" disabled={busy}>Create hosted campaign</Button></form></details>
 </section>
}
