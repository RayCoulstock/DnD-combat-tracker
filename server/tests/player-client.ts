import assert from 'node:assert/strict'
import {io,type Socket} from 'socket.io-client'
import {mergeMapSnapshot,type ClientEvents,type ServerEvents,type Snapshot,type SessionState} from '../../shared/domain.ts'
const origin='http://localhost:5173'
export async function waitFor(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 8000
  while (!predicate()) { if (Date.now() > deadline) throw new Error(message); await new Promise(r => setTimeout(r, 20)) }
}
export class Browser {
  cookie = ''; csrf = ''; actor: { id: string; role: string } | null = null
  constructor(public base: string) {}
  async request(path: string, body?: unknown, expected:number|number[] = 200, headers: Record<string, string> = {}) {
    const response = await fetch(`${this.base}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: this.cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    const cookies = response.headers.getSetCookie(); if (cookies.length) this.cookie = cookies.map(c => c.split(';')[0]).join('; ')
    const data = await response.json()
    assert.ok(Array.isArray(expected)?expected.includes(response.status):response.status===expected,`HTTP ${response.status}: ${data.error?.code??'unexpected response'}`)
    if (data.csrf) this.csrf = data.csrf
    if (data.actor) this.actor = data.actor
    return data
  }
  async init() { await this.request('/session'); return this }
  async connect(campaignId: string, waiting = false) {
    const socket: Socket<ServerEvents, ClientEvents> = io(this.base, { transports: ['websocket'], extraHeaders: { Origin: origin, Cookie: this.cookie }, auth: { csrf: this.csrf }, reconnectionDelay: 100, reconnectionDelayMax: 300, autoConnect: false })
    const client = { socket, session: null as SessionState | null, snapshot: null as Snapshot | null, snapshots: [] as Snapshot[], revoked: false, ended: false }
    socket.on('session.state', s => { client.session = s })
    socket.on('encounter.snapshot', s => { const next = mergeMapSnapshot(client.snapshot, s); if (next) { client.snapshot = next; client.snapshots.push(next) } })
    socket.on('access.revoked', () => { client.revoked = true })
    socket.on('session.ended', () => { client.ended = true })
    socket.on('connect', () => socket.emit('campaign.join', campaignId, () => {}))
    socket.connect()
    await waitFor(() => waiting ? Boolean(client.session) : Boolean(client.snapshot), 'No authorised session state received')
    return client
  }
}

