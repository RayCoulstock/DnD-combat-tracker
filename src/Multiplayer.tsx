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
import {createSessionBootstrap} from './sessionBootstrap'
import './multiplayer.css'

export default function Multiplayer() {
  const[setupOpen,setSetupOpen]=useState(false),[setupSection,setSetupSection]=useState('campaign')
  const [groupsOpen,setGroupsOpen]=useState(false)
  const [combatantLibraryOpen,setCombatantLibraryOpen]=useState(false)
  const[templateRequests,setTemplateRequests]=useState({local:0,online:0})
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [mode, setMode] = useState<'local' | 'online'>(() => location.hash.startsWith('#invite=') || localStorage.getItem('ledger.playMode') === 'online' ? 'online' : 'local')
  useEffect(() => { localStorage.setItem('ledger.playMode', mode) }, [mode])
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get('invite') ?? '')
  const [bootstrapSession] = useState(()=>createSessionBootstrap())
  const[dashboardOpen,setDashboardOpen]=useState(false)
  useEffect(()=>{const changed=()=>{const token=new URLSearchParams(location.hash.slice(1)).get('invite')??'';setInviteToken(token);if(token){setMode('online');setDashboardOpen(false)}};window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed)},[])
  const [account,setAccount]=useState<Account|null>(null),[claimOpen,setClaimOpen]=useState(false)
  const campaignChoice=useRef(0)
  const [actor, setActor] = useState<Actor | null>(null)
  const [csrf, setCsrf] = useState('')
  const [allowDMRegistration, setAllowDMRegistration] = useState<boolean | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignId, setCampaignId] = useState('')
  const [details, setDetails] = useState<Details | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [sessionState, setSessionState] = useState<SessionState | null>(null)
  const [status, setStatus] = useState<'Connected' | 'Reconnecting' | 'Disconnected'>('Disconnected')
  const [error, setError] = useState('')
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
  const pending = useRef(false)
  const authTransition=useRef(false)
  const api = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) })
    const data = await response.json()
    if (!response.ok) {
      if (!authTransition.current&&(response.status === 401 || data.error?.code === 'CSRF')) {
        const current = await (await fetch('/api/session')).json()
        setCsrf(current.csrf); setAllowDMRegistration(current.allowDMRegistration === true)
        if (!current.actor) { setAccount(null);setCampaigns([]);sessionRef.current = null; setSessionState(null); setActor(null); setSnapshot(null); snapshotRef.current = null; setDetails(null); setCampaignId(''); socketRef.current?.disconnect() }
      }
      throw new Error(data.error?.message ?? 'Request failed.')
    }
    if (data.csrf) setCsrf(data.csrf)
    return data
  }, [csrf])
  useEffect(() => {
    if (mode !== 'online') return
    let cancelled = false
    bootstrapSession().then(data => {
      if (!cancelled) { setAllowDMRegistration(data.allowDMRegistration === true); setCsrf(data.csrf); setActor(data.actor);setAccount(data.account??null); if (data.campaignId) setCampaignId(data.campaignId) }
    }).catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [mode, bootstrapSession])
  useEffect(() => {
    if (mode !== 'online' || !actor) return
    let cancelled = false
    const load = async () => {
      const list = await api('/campaigns')
      if (!cancelled) setCampaigns(list)
      if (campaignId) {
        const d = await api(`/campaigns/${campaignId}`)
        if (!cancelled) { const current = sessionRef.current; setDetails(current?.campaignId === campaignId ? { ...d, activeEncounterId: current.encounterId, sessionActive: current.sessionActive } : d); setMembers(currentMembers => d.members.filter((m:{status?:string})=>m.status!=='revoked').map((m: Member) => ({ ...m, connected: currentMembers.find(current => current.id === m.id)?.connected ?? false }))) }
        if (actor.role === 'dm') { const saves = await api(`/campaigns/${campaignId}/checkpoints`); if (!cancelled) setCheckpoints(saves) }
      }
    }
    void load().catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [api, mode, actor, campaignId, reload])
  useEffect(() => {
    if (mode !== 'online' || !actor || !csrf || !campaignId) return
    const socket: Socket<ServerEvents, ClientEvents> = io({ auth: { csrf }, autoConnect: false, transports: ['websocket'],
      reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 10000, randomizationFactor: 0.5, reconnectionAttempts: Infinity,
      // Never buffer commands during outages. send() also checks connected status.
    })
    socketRef.current = socket
    let disposed = false
    socket.on('connect', () => {
      const connectionId = socket.id
      socket.emit('campaign.join', campaignId, result => {
        if (disposed || socket.id !== connectionId || !socket.connected) return
        if (result.ok) { setStatus('Connected'); setError('') }
        else { setStatus('Disconnected'); setError(result.error.message) }
      })
    })
    socket.on('session.state', data => {
      if (disposed || !acceptsSessionState(sessionRef.current, data, campaignId)) return
      if (data.snapshot) {
        const merged = mergeMapSnapshot(snapshotRef.current, data.snapshot)
        if (!merged) { socket.emit('campaign.join', campaignId, () => {}); return }
        data = { ...data, snapshot: merged }
      }
      sessionRef.current = data; setSessionState(data);setCampaigns(list=>list.map(c=>c.id===campaignId?{...c,session_active:data.sessionActive}:c))
      setDetails(current => current?.id === campaignId ? { ...current, activeEncounterId: data.encounterId, sessionActive: data.sessionActive } : current)
      if (data.snapshot) { snapshotRef.current = data.snapshot; setSnapshot(data.snapshot) }
      // Keep an already-mounted camera while waiting, without displaying or enabling the battlefield.
    })
    socket.on('presence.changed', setMembers)
    socket.on('disconnect', reason => setStatus(reason === 'io server disconnect' ? 'Disconnected' : 'Reconnecting'))
    socket.on('connect_error', () => { setStatus('Reconnecting'); setError('Connection unavailable or session expired. Sign in again if reconnection fails.') })
    const clear = (message: string) => { sessionRef.current = null; setSessionState(null); snapshotRef.current = null; setSnapshot(null); setStatus('Disconnected'); setError(message); socket.disconnect() }
    socket.on('access.revoked', () => {
      if(authTransition.current)return
      clear('Your access ended. Sign in again or contact the campaign host.');setAccount(null);setCampaigns([])
      setActor(null); setCampaignId(''); setDetails(null)
      void fetch('/api/session').then(r => r.json()).then(data => { setCsrf(data.csrf); setAllowDMRegistration(data.allowDMRegistration === true);if(data.account){setAccount(data.account);setActor(data.actor);setDashboardOpen(true)} }).catch(() => {})
    })
    const offline = () => { socket.disconnect(); setStatus('Reconnecting') }
    const online = () => socket.connect()
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    if (navigator.onLine) socket.connect()
    return () => {
      disposed = true
      window.removeEventListener('offline', offline); window.removeEventListener('online', online)
      socket.disconnect(); socketRef.current = null; setStatus('Disconnected')
    }
  }, [mode, actor, csrf, campaignId])
  async function run(fn: () => Promise<unknown>) {
    setError(''); setBusy(true)
    try { await fn(); setReload(value => value + 1) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const send = async (command: GameCommand,onResult?:(result:GroupInsertionResult)=>void): Promise<void> => {
    const socket = socketRef.current; const current = snapshotRef.current
    if (!navigator.onLine || !socket?.connected || status !== 'Connected' || !current || (actor?.role === 'player' && !sessionRef.current?.sessionActive) || pending.current) throw new Error('Wait for the current update or reconnect before changing the encounter.')
    pending.current = true
    try {
      await new Promise<void>((resolve, reject) => {
        socket.timeout(8000).emit('game.command', { commandId: command.type==='group.add'?command.requestId:crypto.randomUUID(), encounterId: current.encounterId, revision: current.revision, command }, (timeout: Error | null, result: CommandResult) => {
          if (timeout) return reject(new Error('Acknowledgement unavailable. The change may have saved; wait for the latest snapshot before trying again.'))
          if (!result.ok) return reject(Object.assign(new Error(result.error.message),{groupResult:result.groupResult}))
          if(result.groupResult)onResult?.(result.groupResult)
          resolve()
        })
      })
    } finally { pending.current = false }
  }
  const sendGroup=async(command:GroupAdd,encounterId:string)=>{if(snapshotRef.current?.encounterId!==encounterId)throw new Error('The encounter changed. Reopen group review.');let report:GroupInsertionResult|undefined;await send(command,result=>{report=result});if(!report)throw new Error('Group result unavailable. Retry the original request.');return report}
  const chooseCampaign = (id:string,verifiedActor?:Actor) => {
    const generation=++campaignChoice.current
    if(id)setDashboardOpen(false)
    socketRef.current?.disconnect();sessionRef.current=null;setSessionState(null);setCampaignId('');setDetails(null);setMembers([]);setSnapshot(null);snapshotRef.current=null;setInviteURL('');setSelected(null)
    if(!id)return
    if(verifiedActor){setActor(verifiedActor);setCampaignId(id);return}
    void api(`/campaigns/${id}/enter`,{}).then(data=>{if(campaignChoice.current===generation){setActor(data.actor);setCampaignId(id)}}).catch(e=>{if(campaignChoice.current===generation)setError(e.message)})
  }
  const authenticated=(data:{actor:Actor;account?:Account|null;campaignId?:string})=>{authTransition.current=false;setAccount(data.account??null);setActor(data.actor);const showCampaigns=Boolean(data.account)&&!inviteToken&&!claimOpen;if(!(claimOpen&&actor?.id===data.actor.id&&campaignId===data.campaignId))chooseCampaign(data.campaignId??'',data.actor);setInviteToken('');setClaimOpen(false);setDashboardOpen(showCampaigns);history.replaceState(null,'',location.pathname)}
  const online = status === 'Connected'
  const selectedCombatant = snapshot?.state.combatants.find(c => c.id === selected) ?? snapshot?.state.combatants[0]
  const player = actor?.role === 'player'
  const refresh=()=>void run(async()=>{socketRef.current?.disconnect().connect()})
  const signOut=()=>void run(async()=>{socketRef.current?.disconnect();await api('/auth/logout',{});setAccount(null);setDashboardOpen(false);setClaimOpen(false);setActor(null);setGroupsOpen(false);chooseCampaign('');setCampaigns([]);setLibraryOpen(false);setCombatantLibraryOpen(false);setSetupOpen(false);socketRef.current?.disconnect()})
  const goTable=()=>{setDashboardOpen(false);setGroupsOpen(false);setLibraryOpen(false);setCombatantLibraryOpen(false)}
  const context=<>
    <label className="ledger-campaign-select">Campaign<select aria-label="Campaign" title={details?.name} value={campaignId} disabled={busy||!actor} onChange={e=>chooseCampaign(e.target.value)}><option value="">Select campaign</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <div className="ledger-compact-campaign"><Menu label="Campaigns" triggerContent={<>◈<span className="visually-hidden">Campaigns</span></>} items={[...campaigns.map(c=>({id:c.id,label:c.name,onSelect:()=>chooseCampaign(c.id)})),...(!player?[{id:'setup',label:'Campaign setup',onSelect:()=>openSetup()}]:[])]}/></div>
    {!player?<label>Encounter<select aria-label="Encounter" title={snapshot?.name} value={details?.activeEncounterId??''} disabled={!details||busy} onChange={e=>void run(()=>api(`/campaigns/${campaignId}/open`,{encounterId:e.target.value}))}><option value="" disabled>Select encounter</option>{details?.encounters.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>:<strong className="ledger-context-name">{snapshot?.name??details?.name??'Waiting for DM'}</strong>}
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
    <AppBar accountName={account?.displayName} onCampaigns={actor?()=>{setMode('online');setDashboardOpen(true);setReload(v=>v+1);setSetupOpen(false);setLibraryOpen(false);setCombatantLibraryOpen(false)}:undefined} onAccount={actor?.role==='player'&&!account?()=>{setMode('online');setClaimOpen(true)}:undefined} mode={mode} player={player} signedIn={Boolean(actor)} status={status} count={members.filter(m=>m.connected).length} onMode={setMode} onTable={goTable} onAssets={mode==='online'&&actor?.role==='dm'?()=>{setSetupOpen(false);setLibraryOpen(true)}:undefined} onCombatants={mode==='online'&&actor?.role==='dm'?()=>{setSetupOpen(false);setLibraryOpen(false);setCombatantLibraryOpen(true)}:undefined} onGroups={mode==='online'&&actor?.role==='dm'?()=>{setGroupsOpen(true);setSetupOpen(false)}:undefined} onTemplates={mode==='local'||actor?.role==='dm'&&snapshot?()=>{setLibraryOpen(false);setTemplateRequests(previous=>({...previous,[mode]:previous[mode]+1}))}:undefined} onRejoin={refresh} onSignOut={signOut}/>
    {groupsOpen&&actor?.role==='dm'&&mode==='online'&&<GroupPresets api={api} campaignId={campaignId} onClose={()=>setGroupsOpen(false)}/>}
    <div hidden={mode !== 'local'}><App assetScope={actor?.id} chrome={{visible:mode==='local',templatesRequest:templateRequests.local}} /></div>
    {claimOpen&&actor&&<Modal label="Link player account" onClose={()=>setClaimOpen(false)}><AccountEntry onBeginAuth={()=>{authTransition.current=true;socketRef.current?.disconnect()}} onAuthFailure={()=>{authTransition.current=false;socketRef.current?.connect()}} token="" account={account} legacyClaim allowDMRegistration={allowDMRegistration} csrf={csrf} busy={busy} api={api} onAuthenticated={authenticated} onCancel={()=>setClaimOpen(false)}/></Modal>}
    {mode === 'online' && <>
      {combatantLibraryOpen&&actor?.role==='dm'&&!snapshot&&<CombatantLibrary api={api} csrf={csrf} snapshot={null} onClose={()=>setCombatantLibraryOpen(false)} onAdd={async()=>{throw new Error('Open an encounter first.')}} send={send}/>}
      {libraryOpen && actor?.role === 'dm' && <><SessionBar state={details?.sessionActive?'Live':'Inactive'}><strong className="ledger-context-name">3D Asset Library</strong><Button onClick={goTable}>Return to Table</Button></SessionBar><AssetLibrary key={actor.id} api={api} csrf={csrf} onClose={() => setLibraryOpen(false)} /></>}
      <div hidden={libraryOpen && actor?.role === 'dm'}>
      {error && <p className="online-message ledger-floating-message" role="alert">{error}</p>}
      {!actor&&<SessionBar state="Sign in"><strong className="ledger-context-name">{inviteToken?'Join a campaign':'Multiplayer table'}</strong></SessionBar>}
      {(!actor||inviteToken) ? <AccountEntry onBeginAuth={()=>{authTransition.current=true;socketRef.current?.disconnect()}} onAuthFailure={()=>{authTransition.current=false;socketRef.current?.connect()}} token={inviteToken} account={account} legacyClaim={claimOpen} allowDMRegistration={allowDMRegistration} csrf={csrf} busy={busy} api={api} onAuthenticated={authenticated} onCancel={actor?()=>{setClaimOpen(false);setInviteToken('');history.replaceState(null,'',location.pathname)}:undefined}/> : <>
        {(dashboardOpen||!snapshot||player)&&<SessionBar round={snapshot?.state.round} state={details?.sessionActive?'Live':'Inactive'} players={presence} view={playerView} onView={!dashboardOpen&&player&&snapshot?setPlayerView:undefined} editorAllowed={false} player={player} items={!player?sessionItems:undefined}>{context}{!player&&<Button onClick={()=>openSetup()}>Campaign setup</Button>}</SessionBar>}
        {dashboardOpen&&<MyCampaigns campaigns={campaigns} busy={busy} onRefresh={()=>setReload(v=>v+1)} onJoin={id=>{if(id===campaignId){setDashboardOpen(false)}else chooseCampaign(id)}} onHost={name=>void run(async()=>{const c=await api('/campaigns',{name});chooseCampaign(c.id)})}/>}
        {!player&&<Drawer open={setupOpen} title="Campaign setup" className="ledger-setup-drawer" onClose={()=>setSetupOpen(false)}>
          <DMSetupPanel key={campaignId} campaigns={campaigns} campaignId={campaignId} details={details} members={members} snapshot={snapshot} online={online} busy={busy} inviteURL={inviteURL} checkpoints={checkpoints} chooseCampaign={chooseCampaign} api={api} run={run} send={send} setInviteURL={setInviteURL} section={setupSection} open={setupOpen}/>
        </Drawer>}
        <div hidden={dashboardOpen} inert={dashboardOpen}>
        {snapshot && !player && <App chrome={chrome} multiplayer={{ csrf, snapshot, connected: online, send, sendGroup, library: { api, campaignId, encounterId: snapshot.encounterId, revision: snapshot.revision }, exportFile: () => api(`/campaigns/${campaignId}/export`) }} />}
        {snapshot && player && <div className="ledger-player-workspace" hidden={!sessionState?.sessionActive}><div hidden={playerView!=='map'}><BattleMap3D turnOrder={snapshot.state.turnOrder} combatantDetails={selectedCombatant?<PlayerCombatantDetails combatant={selectedCombatant} playerId={actor.id}/>:undefined} keyboardActive={!dashboardOpen&&playerView==='map'&&Boolean(sessionState?.sessionActive)} levelsHidden={snapshot.state.levelsHidden} tactical={snapshot.state.tactical??[]} actor={actor} onCommand={send} connected={online} assetScope={sessionState?.sessionActive ? actor.id : undefined} assetContext={{ campaignId, encounterId: snapshot.encounterId }} dungeonMap={snapshot.state.dungeonMap} combatants={snapshot.state.combatants} map={snapshot.state.battleMap} round={snapshot.state.round} selectedId={selectedCombatant?.id ?? null} activeId={snapshot.state.activeId} onSelectToken={setSelected}
          onMoveToken={(combatantId, destination) => { if (online && sessionState?.sessionActive && snapshot.state.combatants.find(c => c.id === combatantId)?.ownerId === actor.id) void send({ type: 'token.move', combatantId, destination }).catch(e => setError(e.message)) }}
          canMove={online && Boolean(sessionState?.sessionActive) && selectedCombatant?.ownerId === actor.id} showSharedControls={false} playerId={actor.id} onToggleGrid={() => {}} onToggleLabels={() => {}} onReturnToTracker={() => setPlayerView('tracker')} /></div>
          <div hidden={playerView!=='tracker'}><PlayerTracker turnOrder={snapshot.state.turnOrder} combatants={snapshot.state.combatants} selected={selectedCombatant} activeId={snapshot.state.activeId} playerId={actor.id} onSelect={setSelected}/></div>
        </div>}
        </div>
        {(!snapshot || (player && !sessionState?.sessionActive))&&!dashboardOpen && details && <p className="online-card">{player ? 'Waiting for the DM to open and start an encounter.' : 'Create or open an encounter to begin.'}</p>}
      </>}
      </div>
    </>}
  </>
}
