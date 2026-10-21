import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import App from './App.jsx'
import BattleMap3D from './BattleMap3D'
import type { Actor, ClientEvents, CommandResult, GameCommand, Member, ServerEvents, Snapshot } from '../shared/domain'
import './multiplayer.css'

interface Campaign { id: string; name: string }
interface Details extends Campaign {
  sessionActive: boolean; activeEncounterId: string | null
  encounters: { id: string; name: string }[]
  members: Member[]
  invitations: { id: string; expires_at: string; redeemed_at: string | null; revoked_at: string | null }[]
}
export default function Multiplayer() {
  const [mode, setMode] = useState<'local' | 'online'>(() => location.hash.startsWith('#invite=') || localStorage.getItem('ledger.playMode') === 'online' ? 'online' : 'local')
  useEffect(() => { localStorage.setItem('ledger.playMode', mode) }, [mode])
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get('invite') ?? '')
  const [actor, setActor] = useState<Actor | null>(null)
  const [csrf, setCsrf] = useState('')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignId, setCampaignId] = useState('')
  const [details, setDetails] = useState<Details | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [status, setStatus] = useState<'Connected' | 'Reconnecting' | 'Disconnected'>('Disconnected')
  const [error, setError] = useState('')
  const [inviteURL, setInviteURL] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [selected, setSelected] = useState<string | number | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [checkpoints, setCheckpoints] = useState<{ id: string; revision: number; created_at: string }[]>([])
  const socketRef = useRef<Socket<ServerEvents, ClientEvents> | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null)
  const pending = useRef(false)
  const api = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401 || data.error?.code === 'CSRF') {
        const current = await (await fetch('/api/session')).json()
        setCsrf(current.csrf)
        if (!current.actor) { setActor(null); setSnapshot(null); snapshotRef.current = null; setDetails(null); setCampaignId(''); socketRef.current?.disconnect() }
      }
      throw new Error(data.error?.message ?? 'Request failed.')
    }
    if (data.csrf) setCsrf(data.csrf)
    return data
  }, [csrf])
  useEffect(() => {
    if (mode !== 'online') return
    let cancelled = false
    fetch('/api/session').then(r => { if (!r.ok) throw new Error('Server unavailable.'); return r.json() }).then(data => {
      if (!cancelled) { setCsrf(data.csrf); setActor(data.actor); if (data.campaignId) setCampaignId(data.campaignId) }
    }).catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [mode])
  useEffect(() => {
    if (mode !== 'online' || !actor) return
    let cancelled = false
    const load = async () => {
      const list = await api('/campaigns')
      if (!cancelled) setCampaigns(list)
      if (campaignId) {
        const d = await api(`/campaigns/${campaignId}`)
        if (!cancelled) { setDetails(d); setMembers(d.members.map((m: Member) => ({ ...m, connected: false }))) }
        if (actor.role === 'dm') { const saves = await api(`/campaigns/${campaignId}/checkpoints`); if (!cancelled) setCheckpoints(saves) }
      }
    }
    void load().catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [api, mode, actor, campaignId, reload])
  useEffect(() => {
    if (mode !== 'online' || !actor || !csrf || !campaignId || !details?.activeEncounterId) return
    const socket: Socket<ServerEvents, ClientEvents> = io({ auth: { csrf }, autoConnect: false, transports: ['websocket'],
      reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 10000, randomizationFactor: 0.5, reconnectionAttempts: Infinity,
      // Never buffer commands during outages. send() also checks connected status.
    })
    socketRef.current = socket
    socket.on('connect', () => {
      socket.emit('campaign.join', campaignId, result => {
        if (result.ok) { setStatus('Connected'); setError('') }
        else { setStatus('Disconnected'); setError(result.error.message) }
      })
    })
    socket.on('encounter.snapshot', data => {
      const previous = snapshotRef.current
      if (!previous || previous.encounterId !== data.encounterId || data.revision >= previous.revision) {
        snapshotRef.current = data; setSnapshot(data)
      }
    })
    socket.on('presence.changed', setMembers)
    socket.on('disconnect', reason => setStatus(reason === 'io server disconnect' ? 'Disconnected' : 'Reconnecting'))
    socket.on('connect_error', () => { setStatus('Reconnecting'); setError('Connection unavailable or session expired. Sign in again if reconnection fails.') })
    const clear = (message: string) => { snapshotRef.current = null; setSnapshot(null); setStatus('Disconnected'); setError(message); socket.disconnect() }
    socket.on('session.ended', () => clear('The DM ended this session. Use Rejoin when the DM starts it again.'))
    socket.on('access.revoked', () => {
      clear('Your access ended. Sign in or request a new invitation.')
      setActor(null); setCampaignId(''); setDetails(null)
      void fetch('/api/session').then(r => r.json()).then(data => setCsrf(data.csrf)).catch(() => {})
    })
    const offline = () => { socket.disconnect(); setStatus('Reconnecting') }
    const online = () => socket.connect()
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    if (navigator.onLine) socket.connect()
    return () => {
      window.removeEventListener('offline', offline); window.removeEventListener('online', online)
      socket.disconnect(); socketRef.current = null; setStatus('Disconnected')
    }
  }, [mode, actor, csrf, campaignId, details?.activeEncounterId, details?.sessionActive])
  async function run(fn: () => Promise<unknown>) {
    setError(''); setBusy(true)
    try { await fn(); setReload(value => value + 1) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const send = async (command: GameCommand): Promise<void> => {
    const socket = socketRef.current; const current = snapshotRef.current
    if (!navigator.onLine || !socket?.connected || status !== 'Connected' || !current || pending.current) throw new Error('Wait for the current update or reconnect before changing the encounter.')
    pending.current = true
    try {
      await new Promise<void>((resolve, reject) => {
        socket.timeout(8000).emit('game.command', { commandId: crypto.randomUUID(), encounterId: current.encounterId, revision: current.revision, command }, (timeout: Error | null, result: CommandResult) => {
          if (timeout) return reject(new Error('Acknowledgement unavailable. The change may have saved; wait for the latest snapshot before trying again.'))
          if (!result.ok) return reject(new Error(result.error.message))
          resolve()
        })
      })
    } finally { pending.current = false }
  }
  const chooseCampaign = (id: string) => { setCampaignId(id); setDetails(null); setSnapshot(null); snapshotRef.current = null; setInviteURL(''); setSelected(null) }
  const online = status === 'Connected'
  const selectedCombatant = snapshot?.state.combatants.find(c => c.id === selected) ?? snapshot?.state.combatants[0]
  const player = actor?.role === 'player'
  return <>
    <nav className="multiplayer-nav" aria-label="Play mode"><strong>Encounter Ledger</strong><button onClick={() => setMode('local')} aria-pressed={mode === 'local'}>Local tracker</button><button onClick={() => setMode('online')} aria-pressed={mode === 'online'}>Multiplayer</button>{mode === 'online' && <span role="status" className={`connection ${status.toLowerCase()}`}>{status}</span>}</nav>
    <div hidden={mode !== 'local'}><App /></div>
    {mode === 'online' && <>
      {error && <p className="online-message" role="alert">{error}</p>}
      {!actor ? <section className="online-card"><h1>{inviteToken ? 'Join a campaign' : 'Dungeon Master account'}</h1>
        {inviteToken ? <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { const data = await api('/invitations/redeem', { token: inviteToken, displayName: form.get('displayName') }); setActor(data.actor); chooseCampaign(data.campaignId); setInviteToken(''); history.replaceState(null, '', location.pathname) }) }}>
          <label>Display name<input name="displayName" required maxLength={80} autoComplete="nickname" /></label><button disabled={!csrf || busy}>Join campaign</button><p>Invitation links expire after 30 minutes and work once. This browser keeps your player session for up to seven days.</p>
        </form> : <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ?? 'login'; void run(async () => { const data = await api(`/auth/${action}`, { email: form.get('email'), password: form.get('password') }); setActor(data.actor) }) }}>
          <label>Email<input name="email" type="email" required autoComplete="username" /></label><label>Password (12+ characters)<input name="password" type="password" minLength={12} maxLength={128} required autoComplete="current-password" /></label>
          <button name="action" value="login" disabled={!csrf || busy}>Sign in</button><button name="action" value="register" disabled={!csrf || busy}>Create account</button>
        </form>}
      </section> : <>
        <section className="online-controls"><div className="online-row"><span>{player ? 'Player' : 'Dungeon Master'}</span>
          <label>Campaign<select value={campaignId} onChange={e => chooseCampaign(e.target.value)}><option value="">Select campaign</option>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <button disabled={busy} onClick={() => void run(async () => { socketRef.current?.disconnect().connect() })}>Refresh / rejoin</button>
          <button onClick={() => void run(async () => { await api('/auth/logout', {}); setActor(null); chooseCampaign(''); setCampaigns([]); socketRef.current?.disconnect() })}>Sign out</button>
        </div>
        {!player && <form className="online-row" onSubmit={e => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get('name')); e.currentTarget.reset(); void run(async () => { const c = await api('/campaigns', { name }); chooseCampaign(c.id) }) }}><label>New campaign<input name="name" required maxLength={150} /></label><button disabled={busy}>Create campaign</button></form>}
        {details && !player && <>
          <form className="online-row" key={campaignId} onSubmit={e => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get('name')); void run(() => api(`/campaigns/${campaignId}/settings`, { name })) }}><label>Campaign name<input name="name" defaultValue={details.name} required maxLength={150} /></label><button disabled={busy}>Rename campaign</button></form>
          <div className="online-row"><label>Encounter<select value={details.activeEncounterId ?? ''} onChange={e => void run(() => api(`/campaigns/${campaignId}/open`, { encounterId: e.target.value }))}><option value="" disabled>Select encounter</option>{details.encounters.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <button disabled={busy || !details.activeEncounterId} onClick={() => void run(() => api(`/campaigns/${campaignId}/session`, { active: !details.sessionActive }))}>{details.sessionActive ? 'End session' : 'Start multiplayer session'}</button>
          <button disabled={busy || !details.activeEncounterId} onClick={() => void run(() => api(`/campaigns/${campaignId}/checkpoints`, {}))}>Save session</button>
          <button disabled={busy} onClick={() => void run(async () => { const data = await api(`/campaigns/${campaignId}/invitations`, {}); setInviteURL(data.url) })}>Invite player</button></div>
          <form className="online-row" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); const file = form.get('file') as File; void run(async () => api(`/campaigns/${campaignId}/encounters`, { name: form.get('name'), ...(file?.size ? { file: JSON.parse(await file.text()) } : {}) })) }}><label>New encounter<input name="name" required maxLength={150} /></label><label>Optional encounter JSON<input name="file" type="file" accept="application/json" /></label><button disabled={busy}>Create / import encounter</button></form>
          {inviteURL && <p>Share once (expires in 30 minutes): <input aria-label="Invitation link" readOnly value={inviteURL} onFocus={e => e.target.select()} /></p>}
          <details><summary>Invitations and saved sessions</summary>{details.invitations.map(i => <div className="online-row" key={i.id}><span>Expires {new Date(i.expires_at).toLocaleString()} · {i.revoked_at ? 'Revoked' : i.redeemed_at ? 'Redeemed' : 'Available'}</span><button disabled={Boolean(i.revoked_at || i.redeemed_at)} onClick={() => void run(() => api(`/campaigns/${campaignId}/invitations/${i.id}/revoke`, {}))}>Revoke invitation</button></div>)}
          {checkpoints.map(c => <div className="online-row" key={c.id}><span>Revision {c.revision} · {new Date(c.created_at).toLocaleString()}</span><button disabled={busy} onClick={() => { if (confirm('Restore this saved session? Current state will be replaced.')) void run(() => api(`/campaigns/${campaignId}/checkpoints/${c.id}/restore`, {})) }}>Restore save</button></div>)}</details>
        </>}
        {details && <div className="online-row" aria-label="Campaign players">{members.map(m => <span key={m.id}>{m.displayName} · {m.connected ? 'Connected' : 'Offline'} {!player && <button onClick={() => void run(() => api(`/campaigns/${campaignId}/members/${m.id}/revoke`, {}))}>Revoke access</button>}</span>)}</div>}
        {snapshot && !player && <form className="online-row" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => send({ type: 'map.settings', showGrid: snapshot.state.battleMap.showGrid, showLabels: snapshot.state.battleMap.showLabels, width: Number(f.get('width')), height: Number(f.get('height')) })) }}><label>Map width<input name="width" type="number" min={1} max={100} defaultValue={snapshot.state.battleMap.width} required /></label><label>Map height<input name="height" type="number" min={1} max={100} defaultValue={snapshot.state.battleMap.height} required /></label><button disabled={!online}>Resize map</button></form>}
        {snapshot && !player && <details><summary>Token ownership, visibility and combatant settings</summary>{snapshot.state.combatants.map(c => <div className="online-row" key={c.id}><strong>{c.name}</strong><label>Owner<select disabled={!online} value={c.ownerId ?? ''} onChange={e => void run(() => send({ type: 'token.assign', combatantId: c.id, playerId: e.target.value || null }))}><option value="">DM only</option>{members.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label><button disabled={!online} onClick={() => void run(() => send({ type: 'combatant.visibility', combatantId: c.id, visible: !c.visible }))}>{c.visible ? 'Hide' : 'Reveal'}</button>
          <form className="online-row" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(() => send({ type: 'combatant.edit', combatantId: c.id, combatant: { ...c, name: String(f.get('name')), initiative: Number(f.get('initiative')), maxHp: Number(f.get('maxHp')), hp: Math.min(c.hp, Number(f.get('maxHp'))), privateNotes: String(f.get('privateNotes')) } })) }}><label>Name<input name="name" defaultValue={c.name} required maxLength={200} /></label><label>Initiative<input name="initiative" type="number" defaultValue={c.initiative} min={-1000} max={1000} required /></label><label>Max HP<input name="maxHp" type="number" min={1} max={100000} defaultValue={c.maxHp} required /></label><label>DM notes<input name="privateNotes" defaultValue={c.privateNotes} maxLength={10000} /></label><button disabled={!online}>Update combatant</button></form>
        </div>)}</details>}
        </section>
        {snapshot && !player && <App multiplayer={{ snapshot, connected: online, send, exportFile: () => api(`/campaigns/${campaignId}/export`) }} />}
        {snapshot && player && <><BattleMap3D combatants={snapshot.state.combatants} map={snapshot.state.battleMap} round={snapshot.state.round} selectedId={selectedCombatant?.id ?? null} activeId={snapshot.state.activeId} onSelectToken={setSelected}
          onMoveToken={(combatantId, destination) => { if (online && snapshot.state.combatants.find(c => c.id === combatantId)?.ownerId === actor.id) void send({ type: 'token.move', combatantId, destination }).catch(e => setError(e.message)) }}
          canMove={online && selectedCombatant?.ownerId === actor.id} showSharedControls={false} playerId={actor.id} onToggleGrid={() => {}} onToggleLabels={() => {}} onReturnToTracker={() => {}} />
          {selectedCombatant && <article className="online-card"><h2>{selectedCombatant.name}</h2>{selectedCombatant.ownerId === actor.id ? <><p>{selectedCombatant.hp}/{selectedCombatant.maxHp} HP · AC {selectedCombatant.ac} · {selectedCombatant.speed}</p>{selectedCombatant.artwork && <img className="player-artwork" src={selectedCombatant.artwork} alt={`${selectedCombatant.name} artwork`} />}{selectedCombatant.actions.map(a => <p key={a.name}><strong>{a.name}</strong> {a.text}</p>)}</> : <p>Visible on the battlefield. Statistics are private.</p>}</article>}
        </>}
        {!snapshot && details && <p className="online-card">{player ? 'Waiting for the DM to open and start an encounter.' : 'Create or open an encounter to begin.'}</p>}
      </>}
    </>}
  </>
}
