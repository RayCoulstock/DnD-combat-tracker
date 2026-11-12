import {RequestLifetime,contextChanged,identityKey} from './requestLifetime'
import MyCampaigns from './MyCampaigns'
import Modal from './Modal'
import AccountEntry,{type Account} from './AccountEntry'
import GroupPresets from './GroupPresets'
import type {GroupAdd,GroupInsertionResult} from '../shared/groupPresets'
import PlayerTracker,{PlayerCombatantDetails} from './PlayerTracker'
import './tracker-workspace.css'
import CombatantLibrary from './CombatantLibrary'
import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import App from './App.jsx'
import AssetLibrary from './AssetLibrary'
import {AppBar,SessionBar,Presence} from './ApplicationShell'
import {Button,Drawer,Menu,type MenuEntry} from './ui'
import DMSetupPanel, {type Campaign,type CampaignDetails as Details} from './DMSetupPanel'
import BattleMap3D from './BattleMap3D'
import { acceptsSessionState, mergeMapSnapshot } from '../shared/domain'
import type { SessionState, Actor, ClientEvents, CommandResult, GameCommand, Member, ServerEvents, Snapshot } from '../shared/domain'
import {createSessionBootstrap,withSessionLock,readSession} from './sessionBootstrap'
import './multiplayer.css'

export default function Multiplayer() {
  const[setupOpen,setSetupOpen]=useState(false),[setupSection,setSetupSection]=useState('campaign')
  const [groupsOpen,setGroupsOpen]=useState(false)
  const [combatantLibraryOpen,setCombatantLibraryOpen]=useState(false)
  const[templateRequests,setTemplateRequests]=useState({local:0,online:0})
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [mode, setMode] = useState<'local' | 'online'>(() => location.hash.startsWith('#invite=') || localStorage.getItem('ledger.playMode') === 'online' ? 'online' : 'local')
  const[sessionChecking,setSessionChecking]=useState(mode==='online')
  useEffect(() => { try{localStorage.setItem('ledger.playMode', mode)}catch{/* Optional viewer preference. */} }, [mode])
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get('invite') ?? '')
  const [bootstrapSession] = useState(()=>createSessionBootstrap())
  const[dashboardOpen,setDashboardOpen]=useState(false)
  const [account,setAccount]=useState<Account|null>(null),[claimOpen,setClaimOpen]=useState(false)
  const[lifetime]=useState(()=>new RequestLifetime())
  const knownIdentity=useRef<string|null>(null)
  const [actor, setActor] = useState<Actor | null>(null)
  const [csrf, setCsrfValue] = useState('')
  const csrfRef=useRef('')
  const setCsrf=useCallback((value:string)=>{csrfRef.current=value;setCsrfValue(value)},[])
  const [allowDMRegistration, setAllowDMRegistration] = useState<boolean | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignId, setCampaignId] = useState('')
  const [details, setDetails] = useState<Details | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [sessionState, setSessionState] = useState<SessionState | null>(null)
  const [status, setStatus] = useState<'Connected' | 'Reconnecting' | 'Disconnected'>('Disconnected')
  const [error, setError] = useState('')
  const[phase,setPhase]=useState('Loading campaigns'),[loadingCampaigns,setLoadingCampaigns]=useState(false),[loadFault,setLoadFault]=useState(false),[connectionAttempt,setConnectionAttempt]=useState(0)
  const [inviteURL, setInviteURL] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const[playerView,setPlayerView]=useState('map')
  const [selected, setSelected] = useState<string | number | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const openSetup=(section='campaign')=>{setSetupSection(section);setSetupOpen(true);setReload(v=>v+1)}
  const [checkpoints, setCheckpoints] = useState<{ id: string; revision: number; created_at: string }[]>([])
  const socketRef = useRef<Socket<ServerEvents, ClientEvents> | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null)
  const sessionRef = useRef<SessionState | null>(null)
  const pending = useRef<{stamp:number}|null>(null)
  const authTransition=useRef(false)
  const clearPrivateView=useCallback((message:string,nextAccount:Account|null=null)=>{
    lifetime.advance();authTransition.current=false;socketRef.current?.disconnect();sessionRef.current=null;snapshotRef.current=null;pending.current=null;knownIdentity.current=identityKey(nextAccount?.id,nextAccount?.id)
    setAccount(nextAccount);setActor(nextAccount?{role:'dm',id:nextAccount.id}:null);setCampaignId('');setCampaigns([]);setDetails(null);setMembers([]);setCheckpoints([]);setSnapshot(null);setSessionState(null);setSelected(null);setClaimOpen(false);setSessionChecking(false);setBusy(false);setLoadFault(false);setLoadingCampaigns(false);setLibraryOpen(false);setCombatantLibraryOpen(false);setGroupsOpen(false);setSetupOpen(false);setDashboardOpen(Boolean(nextAccount));setStatus('Disconnected');setError(message);setPhase(nextAccount?'Membership revoked':'Authentication expired')
  },[lifetime])
  const api = useCallback(async (path:string,body?:unknown,options?:{signal?:AbortSignal;stamp?:number})=>{
    const stamp=options?.stamp??lifetime.current(),request=lifetime.start(stamp,options?.signal)
    try{
      const credentialChange=body!==undefined&&/^\/(auth\/(login|register|player-register|logout)|accounts\/claim|invitations\/(redeem|accept))$/.test(path)
      const perform=async()=>{
        if(credentialChange){const fresh=await readSession(request.signal);if(!lifetime.valid(stamp))throw contextChanged();setCsrf(fresh.csrf)}
        const response=await fetch(`/api${path}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',signal:request.signal,headers:{'Content-Type':'application/json','X-CSRF-Token':csrfRef.current},body:body===undefined?undefined:JSON.stringify(body)})
        const data=await response.json().catch(()=>{throw new Error('Server unavailable. Retry the connection.')});return{response,data}
      }
      const{response,data}=await(credentialChange?withSessionLock(perform,request.signal):perform());if(!lifetime.valid(stamp))throw contextChanged()
      if(!response.ok){
        if(!authTransition.current&&(response.status===401||data.error?.code==='CSRF')){
          const current=await bootstrapSession();if(!lifetime.valid(stamp))throw contextChanged();setCsrf(current.csrf);setAllowDMRegistration(current.allowDMRegistration===true)
          if(!current.actor)clearPrivateView('Authentication expired. Sign in again; your campaign membership remains saved.')
          else if(identityKey(current.account?.id,current.actor?.id)!==knownIdentity.current)clearPrivateView('Account changed. Choose a campaign for the signed-in account.',current.account??null)
        }
        throw Object.assign(new Error(data.error?.message??'Request failed. Please retry.'),{code:data.error?.code,status:response.status})
      }
      if(data.csrf)setCsrf(data.csrf)
      return data
    }catch(e){if((e as Error).name==='AbortError'&&lifetime.valid(stamp)&&!options?.signal?.aborted)throw Object.assign(new Error('Request timed out or the connection was interrupted. Please retry.'),{cause:e});throw e}finally{request.finish()}
  },[lifetime,bootstrapSession,setCsrf,clearPrivateView])
  const changeMode=useCallback((next:'local'|'online')=>{
    if(next===mode)return
    if(next==='online'){clearPrivateView('');setPhase('Loading campaigns')}else{lifetime.advance();socketRef.current?.disconnect();setBusy(false)}
    setSessionChecking(next==='online');setMode(next)
  },[mode,clearPrivateView,lifetime])
  useEffect(()=>{
    const changed=()=>{const token=new URLSearchParams(location.hash.slice(1)).get('invite')??'';setInviteToken(token);if(token){changeMode('online');setDashboardOpen(false)}}
    window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed)
  },[changeMode])
  useEffect(()=>{
    if(mode!=='online')return
    let cancelled=false;const stamp=lifetime.current()
    bootstrapSession().then(data=>{
      if(cancelled||!lifetime.valid(stamp)||authTransition.current)return
      setSessionChecking(false);knownIdentity.current=identityKey(data.account?.id,data.actor?.id);setAccount(data.account??null);setActor(data.actor);setCsrf(data.csrf);setAllowDMRegistration(data.allowDMRegistration===true);setCampaignId(data.campaignId??'');setPhase(data.campaignId?'Joining game':'Loading campaigns')
    }).catch(e=>{if(!cancelled&&lifetime.valid(stamp)){setSessionChecking(false);setError(e.name==='AbortError'?'Unable to contact the server. Retry sign-in.':e.message)}})
    return()=>{cancelled=true}
  },[mode,bootstrapSession,lifetime,setCsrf])
  useEffect(()=>{
    if(mode!=='online'||!actor)return
    const controller=new AbortController(),stamp=lifetime.current();let cancelled=false
    const load=async()=>{
      await Promise.resolve();if(cancelled||!lifetime.valid(stamp))return;setLoadingCampaigns(true)
      try{
        const list=await api('/campaigns',undefined,{signal:controller.signal,stamp});if(cancelled||!lifetime.valid(stamp))return;const latest=sessionRef.current;setCampaigns(list.map((c:Campaign)=>latest?.campaignId===c.id?{...c,session_active:latest.sessionActive}:c))
        if(campaignId){
          const d=await api(`/campaigns/${campaignId}`,undefined,{signal:controller.signal,stamp});if(cancelled||!lifetime.valid(stamp))return
          const current=sessionRef.current;setDetails(current?.campaignId===campaignId?{...d,activeEncounterId:current.encounterId,sessionActive:current.sessionActive}:d)
          setMembers(old=>d.members.filter((m:{status?:string})=>m.status!=='revoked').map((m:Member)=>({...m,connected:old.find(p=>p.id===m.id)?.connected??false})))
          if(actor.role==='dm'){const saves=await api(`/campaigns/${campaignId}/checkpoints`,undefined,{signal:controller.signal,stamp});if(!cancelled&&lifetime.valid(stamp))setCheckpoints(saves)}
        }
      }catch(e){if(!cancelled&&lifetime.valid(stamp)){setError((e as Error).name==='AbortError'?'Unable to load campaigns. Please retry.':(e as Error).message)}}
      finally{if(!cancelled&&lifetime.valid(stamp))setLoadingCampaigns(false)}
    }
    void load();return()=>{cancelled=true;controller.abort()}
  },[api,mode,actor,campaignId,reload,lifetime])
  useEffect(()=>{
    if(mode!=='online'||!actor||!csrf||!campaignId)return
    const stamp=lifetime.current(),expectedIdentity=identityKey(account?.id,actor.id)
    const socket:Socket<ServerEvents,ClientEvents>=io({auth:{csrf},autoConnect:false,transports:['websocket'],reconnection:true,reconnectionDelay:500,reconnectionDelayMax:5000,randomizationFactor:.5,reconnectionAttempts:5})
    socketRef.current=socket;let disposed=false,repairUsed=false,authenticationChecked=false,joinAttempt=0
    const current=()=>!disposed&&lifetime.valid(stamp)&&!authTransition.current
    const failed=(message:string)=>{if(!current())return;setStatus('Disconnected');setPhase('Unable to load map');setLoadFault(true);setError(message)}
    const recoverAuthentication=async(reason?:'UNAUTHENTICATED'|'FORBIDDEN')=>{
      if(!current()||authenticationChecked)return
      authenticationChecked=true;socket.disconnect();setStatus('Disconnected');setPhase('Reconnecting');setLoadFault(true)
      try{
        const fresh=await bootstrapSession();if(!current())return;setCsrf(fresh.csrf);setAllowDMRegistration(fresh.allowDMRegistration===true)
        if(!fresh.actor){clearPrivateView(reason==='FORBIDDEN'?'Membership revoked. Contact the campaign host.':'Authentication expired. Sign in again; your campaign membership remains saved.');return}
        if(identityKey(fresh.account?.id,fresh.actor?.id)!==expectedIdentity){clearPrivateView('Account changed. Choose a campaign for the signed-in account.',fresh.account??null);return}
        if(reason==='FORBIDDEN'){clearPrivateView('Membership revoked. Your account and other campaigns remain available.',fresh.account??null);return}
        const entered=await api(`/campaigns/${campaignId}/enter`,{},{stamp});if(!current())return
        setAccount(old=>old?.id===fresh.account?.id?old:fresh.account??null);setActor(old=>old&&old.id===entered.actor.id&&old.role===entered.actor.role?old:entered.actor)
        socket.auth={csrf:fresh.csrf};socket.connect()
      }catch(e){if(!current())return;if((e as {status?:number}).status===403)clearPrivateView('Membership revoked. Your account and other campaigns remain available.',account??null);else failed('Unable to verify the connection. Retry or sign in again.')}
    }
    const join=()=>{
      if(!current())return
      const connectionId=socket.id,attempt=++joinAttempt;setPhase('Loading battle map')
      socket.timeout(10000).emit('campaign.join',campaignId,(timeout:Error|null,result:CommandResult)=>{
        if(!current()||attempt!==joinAttempt||socket.id!==connectionId||!socket.connected)return
        if(timeout){failed('The encounter did not finish loading. Retry the connection.');return}
        if(result.ok){setStatus('Connected');setError('')}
        else if(result.error.code==='UNAUTHENTICATED'||result.error.code==='FORBIDDEN')void recoverAuthentication(result.error.code)
        else failed(result.error.message)
      })
    }
    socket.on('connect',join)
    socket.on('session.state',data=>{
      if(!current()||!acceptsSessionState(sessionRef.current,data,campaignId))return
      if(data.snapshot){const merged=mergeMapSnapshot(snapshotRef.current,data.snapshot);if(!merged){if(!repairUsed){repairUsed=true;join()}else failed('The battle map baseline is unavailable. Retry to reload it.');return}data={...data,snapshot:merged};repairUsed=false}
      const wasActive=sessionRef.current?.sessionActive
      sessionRef.current=data;setSessionState(data);setStatus('Connected');setLoadFault(false);setError('');setPhase(data.snapshot?'Connected':wasActive&&!data.sessionActive?'Session ended':'Waiting for DM')
      setCampaigns(list=>list.map(c=>c.id===campaignId?{...c,session_active:data.sessionActive}:c))
      setDetails(old=>old?.id===campaignId?{...old,activeEncounterId:data.encounterId,sessionActive:data.sessionActive}:old)
      if(data.snapshot){snapshotRef.current=data.snapshot;setSnapshot(data.snapshot)}
    })
    socket.on('presence.changed',data=>{if(current())setMembers(data)})
    socket.on('disconnect',reason=>{if(current()){setStatus(reason==='io server disconnect'?'Disconnected':'Reconnecting');if(reason!=='io server disconnect')setPhase('Reconnecting')}})
    socket.on('connect_error',error=>{
      if(!current())return
      const code=(error as Error&{data?:{code?:string}}).data?.code
      if(code==='UNAUTHENTICATED'||code==='FORBIDDEN'||error.message==='Authentication required.'){
        if(authenticationChecked){socket.disconnect();failed('Authentication could not be restored. Retry or sign in again.')}else void recoverAuthentication(code==='FORBIDDEN'?'FORBIDDEN':'UNAUTHENTICATED')
      }else{setStatus('Reconnecting');setPhase('Reconnecting');setError('Connection unavailable. Retrying…')}
    })
    const exhausted=()=>failed('Reconnection stopped after five attempts. Retry when the connection returns.')
    socket.io.on('reconnect_failed',exhausted)
    socket.on('access.revoked',reason=>{if(current())void recoverAuthentication(reason?.code)})
    socket.on('session.error',problem=>{if(current()&&problem.campaignId===campaignId)failed(problem.message)})
    const offline=()=>{if(current()){socket.disconnect();setStatus('Reconnecting');setPhase('Reconnecting');setError('Offline. Reconnect to resume the session.')}}
    const online=()=>{if(current()){authenticationChecked=false;socket.connect()}}
    window.addEventListener('offline',offline);window.addEventListener('online',online)
    if(navigator.onLine&&current())socket.connect()
    return()=>{disposed=true;window.removeEventListener('offline',offline);window.removeEventListener('online',online);socket.io.off('reconnect_failed',exhausted);socket.disconnect();if(socketRef.current===socket)socketRef.current=null}
  },[mode,actor,csrf,campaignId,account,api,bootstrapSession,lifetime,setCsrf,clearPrivateView,connectionAttempt])
  async function run(fn:()=>Promise<unknown>){
    const stamp=lifetime.current();setError('');setBusy(true)
    try{await fn();if(lifetime.valid(stamp))setReload(v=>v+1)}catch(e){if(lifetime.valid(stamp))setError((e as Error).message)}finally{if(lifetime.valid(stamp))setBusy(false)}
  }
  const send = async (command: GameCommand,onResult?:(result:GroupInsertionResult)=>void): Promise<void> => {
    const socket = socketRef.current; const current = snapshotRef.current
    if (!navigator.onLine || !socket?.connected || status !== 'Connected' || !current || (actor?.role === 'player' && !sessionRef.current?.sessionActive) || pending.current?.stamp===lifetime.current()) throw new Error('Wait for the current update or reconnect before changing the encounter.')
    const ticket={stamp:lifetime.current()};pending.current=ticket
    try {
      await new Promise<void>((resolve, reject) => {
        socket.timeout(8000).emit('game.command', { commandId: command.type==='group.add'?command.requestId:crypto.randomUUID(), encounterId: current.encounterId, revision: current.revision, command }, (timeout: Error | null, result: CommandResult) => {
          if(!lifetime.valid(ticket.stamp))return reject(contextChanged())
          if (timeout) return reject(new Error('Acknowledgement unavailable. The change may have saved; wait for the latest snapshot before trying again.'))
          if (!result.ok) return reject(Object.assign(new Error(result.error.message),{groupResult:result.groupResult}))
          if(result.groupResult)onResult?.(result.groupResult)
          resolve()
        })
      })
    } finally { if(pending.current===ticket)pending.current=null }
  }
  const sendGroup=async(command:GroupAdd,encounterId:string)=>{if(snapshotRef.current?.encounterId!==encounterId)throw new Error('The encounter changed. Reopen group review.');let report:GroupInsertionResult|undefined;await send(command,result=>{report=result});if(!report)throw new Error('Group result unavailable. Retry the original request.');return report}
  const chooseCampaign = (id:string,verifiedActor?:Actor) => {
    const generation=lifetime.advance();authTransition.current=false;setBusy(false);setLoadFault(false);setPhase(id?'Joining game':'Loading campaigns')
    if(id)setDashboardOpen(false)
    socketRef.current?.disconnect();sessionRef.current=null;setSessionState(null);setCampaignId('');setDetails(null);setMembers([]);setCheckpoints([]);setSnapshot(null);snapshotRef.current=null;setInviteURL('');setSelected(null)
    if(!id)return
    if(verifiedActor){setActor(verifiedActor);setCampaignId(id);return}
    void api(`/campaigns/${id}/enter`,{}).then(data=>{if(lifetime.valid(generation)){setActor(data.actor);setCampaignId(id)}}).catch(async e=>{if(!lifetime.valid(generation))return;if(e.status===403){try{const fresh=await bootstrapSession();if(!lifetime.valid(generation))return;setCsrf(fresh.csrf);clearPrivateView('Campaign membership is unavailable. Choose another campaign or contact its host.',fresh.account??null)}catch{if(lifetime.valid(generation))setError('Unable to verify campaign access. Please retry.')}}else{setError(e.message);setPhase('Unable to load map');setLoadFault(true)}})
  }
  const authenticated=(data:{actor:Actor;account?:Account|null;campaignId?:string},stamp?:number)=>{if(stamp!==undefined&&!lifetime.valid(stamp))return;authTransition.current=false;knownIdentity.current=identityKey(data.account?.id,data.actor?.id);setAccount(data.account??null);setActor(data.actor);const showCampaigns=Boolean(data.account)&&!inviteToken&&!claimOpen;if(!(claimOpen&&actor?.id===data.actor.id&&campaignId===data.campaignId))chooseCampaign(data.campaignId??'',data.actor);setInviteToken('');setClaimOpen(false);setDashboardOpen(showCampaigns);history.replaceState(null,'',location.pathname)}
  const beginAuthentication=async()=>{
    const stamp=lifetime.advance();authTransition.current=true;setBusy(false);setStatus('Reconnecting');socketRef.current?.disconnect()
    try{const session=await bootstrapSession();if(!lifetime.valid(stamp))throw contextChanged();setCsrf(session.csrf);return stamp}
    catch(e){if(lifetime.valid(stamp))authTransition.current=false;throw e}
  }
  const authenticationFailed=(stamp?:number)=>{if(stamp!==undefined&&lifetime.valid(stamp)){authTransition.current=false;setReload(v=>v+1);setConnectionAttempt(v=>v+1)}}
  const online = status === 'Connected'
  const selectedCombatant = snapshot?.state.combatants.find(c => c.id === selected) ?? snapshot?.state.combatants[0]
  const player = actor?.role === 'player'
  const refresh=()=>{lifetime.advance();authTransition.current=false;setLoadFault(Boolean(snapshotRef.current));setError('');setPhase(campaignId?'Joining game':'Loading campaigns');setStatus('Reconnecting');setReload(v=>v+1);setConnectionAttempt(v=>v+1)}
  const signOut=()=>void run(async()=>{
    const stamp=lifetime.advance();authTransition.current=true;socketRef.current?.disconnect()
    try{await api('/auth/logout',{});clearPrivateView('');setClaimOpen(false);setPhase('Sign in')}
    catch(e){if(lifetime.valid(stamp)){authTransition.current=false;setBusy(false);setError('Sign-out could not be confirmed. Retry or refresh the connection.');setConnectionAttempt(v=>v+1);setReload(v=>v+1)}throw e}
  })
  const goTable=()=>{setDashboardOpen(false);setGroupsOpen(false);setLibraryOpen(false);setCombatantLibraryOpen(false)}
  const context=<>
    <label className="ledger-campaign-select">Campaign<select aria-label="Campaign" title={details?.name} value={campaignId} disabled={busy||!actor} onChange={e=>chooseCampaign(e.target.value)}><option value="">Select campaign</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <div className="ledger-compact-campaign"><Menu label="Campaigns" triggerContent={<>◈<span className="visually-hidden">Campaigns</span></>} items={[...campaigns.map(c=>({id:c.id,label:c.name,onSelect:()=>chooseCampaign(c.id)})),...(!player?[{id:'setup',label:'Campaign setup',onSelect:()=>openSetup()}]:[])]}/></div>
    {!player?<label>Encounter<select aria-label="Encounter" title={snapshot?.name} value={details?.activeEncounterId??''} disabled={!details||busy} onChange={e=>void run(()=>api(`/campaigns/${campaignId}/open`,{encounterId:e.target.value}))}><option value="" disabled>Select encounter</option>{details?.encounters.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>:<strong className="ledger-context-name">{(sessionState?.sessionActive?snapshot?.name:undefined)??details?.name??'Waiting for DM'}</strong>}
  </>
  const sessionItems:MenuEntry[]=actor?.role==='dm'?[
    {id:'setup',label:'Campaign and encounter setup',onSelect:()=>openSetup()},
    {id:'players',label:'Invitations & token visibility',onSelect:()=>openSetup('players')},
    {id:'checkpoint',label:'Save session',onSelect:()=>void run(()=>api(`/campaigns/${campaignId}/checkpoints`,{})),disabled:!details?.activeEncounterId||busy,group:'Session'},
    {id:'saves',label:'Saved sessions',onSelect:()=>openSetup('saves')},
    {id:'session',label:details?.sessionActive?'End session':'Start multiplayer session',onSelect:()=>{if(!details?.sessionActive||confirm('End this multiplayer session? Players will wait until you start it again.'))void run(()=>api(`/campaigns/${campaignId}/session`,{active:!details?.sessionActive}))},disabled:!details?.activeEncounterId||busy,danger:Boolean(details?.sessionActive),group:details?.sessionActive?'Danger':'Session'}
  ]:[]
  const presence=<Presence members={members} onManage={!player?()=>openSetup('players'):undefined}/>
  const chrome={visible:mode==='online'&&!libraryOpen&&!dashboardOpen,templatesRequest:templateRequests.online,context,players:presence,sessionItems,sessionState:details?.sessionActive?'Live':'Inactive',libraryOpen:combatantLibraryOpen,closeLibrary:()=>setCombatantLibraryOpen(false)}
  return <>
    <AppBar accountName={account?.displayName} onCampaigns={actor?()=>{changeMode('online');setDashboardOpen(true);setReload(v=>v+1);setSetupOpen(false);setLibraryOpen(false);setCombatantLibraryOpen(false)}:undefined} onAccount={actor?.role==='player'&&!account?()=>{changeMode('online');setClaimOpen(true)}:undefined} mode={mode} player={player} signedIn={Boolean(actor)} status={status} count={members.filter(m=>m.connected).length} onMode={changeMode} onTable={goTable} onAssets={mode==='online'&&actor?.role==='dm'?()=>{setSetupOpen(false);setLibraryOpen(true)}:undefined} onCombatants={mode==='online'&&actor?.role==='dm'?()=>{setSetupOpen(false);setLibraryOpen(false);setCombatantLibraryOpen(true)}:undefined} onGroups={mode==='online'&&actor?.role==='dm'?()=>{setGroupsOpen(true);setSetupOpen(false)}:undefined} onTemplates={mode==='local'||actor?.role==='dm'&&snapshot?()=>{setLibraryOpen(false);setTemplateRequests(previous=>({...previous,[mode]:previous[mode]+1}))}:undefined} onRejoin={refresh} onSignOut={signOut}/>
    {groupsOpen&&actor?.role==='dm'&&mode==='online'&&<GroupPresets api={api} campaignId={campaignId} onClose={()=>setGroupsOpen(false)}/>}
    <div hidden={mode !== 'local'}><App assetScope={actor?.id} chrome={{visible:mode==='local',templatesRequest:templateRequests.local}} /></div>
    {claimOpen&&actor&&<Modal label="Link player account" onClose={()=>{if(!authTransition.current)setClaimOpen(false)}}><AccountEntry onBeginAuth={beginAuthentication} onAuthFailure={authenticationFailed} token="" account={account} legacyClaim allowDMRegistration={allowDMRegistration} csrf={csrf} busy={busy} api={api} onAuthenticated={authenticated} onCancel={()=>setClaimOpen(false)}/></Modal>}
    {mode === 'online' && <>
      {combatantLibraryOpen&&actor?.role==='dm'&&!snapshot&&<CombatantLibrary api={api} csrf={csrf} snapshot={null} onClose={()=>setCombatantLibraryOpen(false)} onAdd={async()=>{throw new Error('Open an encounter first.')}} send={send}/>}
      {libraryOpen && actor?.role === 'dm' && <><SessionBar state={details?.sessionActive?'Live':'Inactive'}><strong className="ledger-context-name">3D Asset Library</strong><Button onClick={goTable}>Return to Table</Button></SessionBar><AssetLibrary key={actor.id} api={api} csrf={csrf} onClose={() => setLibraryOpen(false)} /></>}
      <div hidden={libraryOpen && actor?.role === 'dm'}>
      {error && <p className="online-message ledger-floating-message" role="alert">{error}{actor&&!loadFault&&phase==='Reconnecting'&&<Button onClick={refresh}>Retry connection</Button>}</p>}
      {!actor&&<SessionBar state="Sign in"><strong className="ledger-context-name">{inviteToken?'Join a campaign':'Multiplayer table'}</strong></SessionBar>}
      {sessionChecking?<section className="online-card" role="status">Checking authentication…</section>:(!actor||inviteToken) ? <AccountEntry onBeginAuth={beginAuthentication} onAuthFailure={authenticationFailed} token={inviteToken} account={account} legacyClaim={claimOpen} allowDMRegistration={allowDMRegistration} csrf={csrf} busy={busy} api={api} onAuthenticated={authenticated} onCancel={actor?()=>{setClaimOpen(false);setInviteToken('');history.replaceState(null,'',location.pathname)}:undefined}/> : <>
        {(dashboardOpen||!snapshot||player)&&<SessionBar round={player&&!sessionState?.sessionActive?undefined:snapshot?.state.round} state={details?.sessionActive?'Live':player?'Waiting':'Inactive'} players={presence} view={playerView} onView={!dashboardOpen&&player&&snapshot?setPlayerView:undefined} editorAllowed={false} player={player} items={!player?sessionItems:undefined}>{context}{!player&&<Button onClick={()=>openSetup()}>Campaign setup</Button>}</SessionBar>}
        {dashboardOpen&&<MyCampaigns loading={loadingCampaigns} campaigns={campaigns} busy={busy} onRefresh={()=>setReload(v=>v+1)} onJoin={id=>{if(id===campaignId){setDashboardOpen(false)}else chooseCampaign(id)}} onHost={name=>void run(async()=>{const c=await api('/campaigns',{name});chooseCampaign(c.id)})}/>}
        {!player&&<Drawer open={setupOpen} title="Campaign setup" className="ledger-setup-drawer" onClose={()=>setSetupOpen(false)}>
          <DMSetupPanel key={campaignId} campaigns={campaigns} campaignId={campaignId} details={details} members={members} snapshot={snapshot} online={online} busy={busy} inviteURL={inviteURL} checkpoints={checkpoints} chooseCampaign={chooseCampaign} api={api} run={run} send={send} setInviteURL={setInviteURL} section={setupSection} open={setupOpen}/>
        </Drawer>}
        <div hidden={dashboardOpen||loadFault} inert={dashboardOpen||loadFault}>
        {snapshot && !player && <App chrome={chrome} multiplayer={{ csrf, snapshot, connected: online, send, sendGroup, library: { api, campaignId, encounterId: snapshot.encounterId, revision: snapshot.revision }, exportFile: () => api(`/campaigns/${campaignId}/export`) }} />}
        {snapshot && player && <div className="ledger-player-workspace" hidden={!sessionState?.sessionActive}><div hidden={playerView!=='map'}><BattleMap3D turnOrder={snapshot.state.turnOrder} combatantDetails={selectedCombatant?<PlayerCombatantDetails combatant={selectedCombatant} playerId={actor.id}/>:undefined} keyboardActive={!dashboardOpen&&!loadFault&&playerView==='map'&&Boolean(sessionState?.sessionActive)} levelsHidden={snapshot.state.levelsHidden} tactical={snapshot.state.tactical??[]} actor={actor} onCommand={send} connected={online} assetScope={sessionState?.sessionActive ? actor.id : undefined} assetContext={{ campaignId, encounterId: snapshot.encounterId }} dungeonMap={snapshot.state.dungeonMap} combatants={snapshot.state.combatants} map={snapshot.state.battleMap} round={snapshot.state.round} selectedId={selectedCombatant?.id ?? null} activeId={snapshot.state.activeId} onSelectToken={setSelected}
          onMoveToken={(combatantId, destination) => { if (online && sessionState?.sessionActive && snapshot.state.combatants.find(c => c.id === combatantId)?.ownerId === actor.id) void send({ type: 'token.move', combatantId, destination }).catch(e => setError(e.message)) }}
          canMove={online && Boolean(sessionState?.sessionActive) && selectedCombatant?.ownerId === actor.id} showSharedControls={false} playerId={actor.id} onToggleGrid={() => {}} onToggleLabels={() => {}} onReturnToTracker={() => setPlayerView('tracker')} /></div>
          <div hidden={playerView!=='tracker'}><PlayerTracker turnOrder={snapshot.state.turnOrder} combatants={snapshot.state.combatants} selected={selectedCombatant} activeId={snapshot.state.activeId} playerId={actor.id} onSelect={setSelected}/></div>
        </div>}
        </div>
        {(!snapshot||(player&&!sessionState?.sessionActive)||loadFault)&&!dashboardOpen&&<section className="online-card connection-state" role="status"><h2>{phase}</h2><p>{loadFault?'The authorized encounter could not be loaded.':player?'Waiting for the DM to open and start an encounter.':'Create or open an encounter to begin.'}</p><Button disabled={busy} onClick={refresh}>Retry connection</Button></section>}
        {snapshot&&!loadFault&&!error&&phase==='Reconnecting'&&!dashboardOpen&&<p className="online-message ledger-floating-message" role="status">Reconnecting… <Button onClick={refresh}>Retry connection</Button></p>}
      </>}
      </div>
    </>}
  </>
}
