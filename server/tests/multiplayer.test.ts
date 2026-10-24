import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { io, type Socket } from 'socket.io-client'
import type { AddressInfo } from 'node:net'
import { createApplication } from '../app.ts'
import { migrate } from '../migrate.ts'
import { importEncounter, mergeMapSnapshot } from '../../shared/domain.ts'
import type { ClientEvents, CommandEnvelope, CommandResult, GameCommand, ServerEvents, Snapshot, SessionState } from '../../shared/domain.ts'

const origin = 'http://localhost:5173'
const secret = 'integration-test-secret-is-long-and-random-' + randomUUID()
const fixture = {
  version: 1, round: 3, activeId: 2, usedAbilities: { '2:Action:Secret': true }, combatants: [
    { id: 1, name: 'Ranger', short: 'R', side: 'hero', hp: 10, maxHp: 20, ac: 15, initiative: 18, conditions: [], saves: [], actions: [{ name: 'Bow', text: 'Shoot' }], privateNotes: 'DM secret', artwork: 'data:image/png;base64,aGVsbG8=' },
    { id: 2, name: 'Secret dragon', short: 'D', side: 'enemy', hp: 100, maxHp: 100, ac: 20, initiative: 15, conditions: [], saves: [], actions: [], visible: false },
    { id: 3, name: 'Wizard', short: 'W', side: 'hero', hp: 8, maxHp: 12, ac: 11, initiative: 10, conditions: [], saves: [], actions: [] },
  ],
}
async function waitFor(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 8000
  while (!predicate()) { if (Date.now() > deadline) throw new Error(message); await new Promise(r => setTimeout(r, 20)) }
}
class Browser {
  cookie = ''; csrf = ''; actor: { id: string; role: string } | null = null
  constructor(public base: string) {}
  async request(path: string, body?: unknown, expected = 200, headers: Record<string, string> = {}) {
    const response = await fetch(`${this.base}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: this.cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    const cookies = response.headers.getSetCookie(); if (cookies.length) this.cookie = cookies.map(c => c.split(';')[0]).join('; ')
    const data = await response.json()
    assert.equal(response.status, expected, JSON.stringify(data))
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
test('PostgreSQL multiplayer lifecycle with DM and two players', { timeout: 90000 }, async t => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required; use a development PostgreSQL instance')
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  const schema = `test_${randomUUID().replaceAll('-', '')}`
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 10 })
  let application = createApplication({ pool, secret, origin })
  const sockets: Socket<ServerEvents, ClientEvents>[] = []
  try {
    await migrate(pool)
    await new Promise<void>(resolve => application.http.listen(0, '127.0.0.1', resolve))
    const port = (application.http.address() as AddressInfo).port
    const base = `http://127.0.0.1:${port}`
    const dm = await new Browser(base).init(), p1 = await new Browser(base).init(), p2 = await new Browser(base).init(), stranger = await new Browser(base).init()
    await t.test('authentication, session rotation, CSRF, origin and unauthenticated access', async () => {
      await stranger.request('/campaigns', undefined, 401)
      const initialCookie = dm.cookie
      await dm.request('/auth/register', { email: 'dm@example.test', password: 'Correct Horse Battery 2049!' }, 201)
      assert.notEqual(dm.cookie, initialCookie)
      const user = (await pool.query('SELECT password_hash FROM users')).rows[0]
      assert.ok(user.password_hash.startsWith('$argon2id$'))
      await stranger.request('/auth/login', { email: 'dm@example.test', password: 'wrong-password-123' }, 401)
      await stranger.request('/auth/login', { email: 'dm@example.test', password: 'Correct Horse Battery 2049!' }, 403, { Origin: 'https://evil.test' })
      await stranger.request('/auth/login', { email: 'dm@example.test', password: 'Correct Horse Battery 2049!' }, 403, { 'X-CSRF-Token': '' })
      await stranger.request('/auth/login', { email: 'dm@example.test', password: 'Correct Horse Battery 2049!' })
      await stranger.request('/auth/logout', {})
      await stranger.init()
    })
    const campaign = await dm.request('/campaigns', { name: 'Test campaign' }, 201)
    const path = `/campaigns/${campaign.id}`
    await t.test('one-time, expired and revoked invitations; stable player identities', async () => {
      const invite1 = await dm.request(`${path}/invitations`, {}, 201)
      const token = invite1.url.split('#invite=')[1]
      await p1.request('/invitations/redeem', { token, displayName: 'Ranger player' }, 201)
      await p2.request('/invitations/redeem', { token, displayName: 'Impersonator' }, 403)
      const expired = await dm.request(`${path}/invitations`, {}, 201)
      await pool.query("UPDATE invitations SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.id])
      await p2.request('/invitations/redeem', { token: expired.url.split('#invite=')[1], displayName: 'Expired' }, 403)
      const revoked = await dm.request(`${path}/invitations`, {}, 201)
      await dm.request(`${path}/invitations/${revoked.id}/revoke`, {})
      await p2.request('/invitations/redeem', { token: revoked.url.split('#invite=')[1], displayName: 'Revoked' }, 403)
      const invite2 = await dm.request(`${path}/invitations`, {}, 201)
      await p2.request('/invitations/redeem', { token: invite2.url.split('#invite=')[1], displayName: 'Wizard player' }, 201)
      assert.notEqual(p1.actor!.id, p2.actor!.id)
      const records = (await pool.query('SELECT token_hash FROM invitations')).rows
      assert.ok(records.every(r => /^[a-f0-9]{64}$/.test(r.token_hash)))
      const sessions = (await pool.query('SELECT sid_hash FROM auth_sessions')).rows
      assert.ok(sessions.every(r => /^[a-f0-9]{64}$/.test(r.sid_hash)))
    })
    const dc = await dm.connect(campaign.id, true), c1 = await p1.connect(campaign.id, true), c2 = await p2.connect(campaign.id, true)
    sockets.push(dc.socket, c1.socket, c2.socket)
    await t.test('players subscribe before any encounter exists without receiving game state', async () => {
      for (const client of [c1, c2]) {
        assert.ok(client.socket.connected)
        assert.equal(client.session!.encounterId, null)
        assert.equal(client.session!.sessionActive, false)
        assert.equal(client.session!.snapshot, null)
      }
      await p1.request(`${path}/snapshot`, undefined, 404)
    })
    const encounter = await dm.request(`${path}/encounters`, { name: 'Ambush', file: fixture }, 201)
    await t.test('opening an inactive encounter updates waiting members without exposing it', async () => {
      await waitFor(() => c1.session!.encounterId === encounter.id && c2.session!.encounterId === encounter.id, 'Waiting-room encounter update was missed')
      for (const client of [c1, c2]) {
        assert.equal(client.session!.snapshot, null)
        assert.ok(!JSON.stringify(client.session).includes('Secret dragon'))
      }
      await p1.request(`${path}/snapshot`, undefined, 409)
      const denied = await new Promise<CommandResult>(resolve => c1.socket.emit('game.command', { commandId: randomUUID(), encounterId: encounter.id, revision: 0, command: { type: 'token.move', combatantId: 1, destination: { x: 1, z: 1 } } }, resolve))
      assert.ok(!denied.ok && denied.error.code === 'SESSION_ENDED')
      assert.ok(c1.socket.connected)
    })
    await t.test('first activation reaches waiting players and a simultaneous join without reconnecting', async () => {
      const connectionIds = [c1.socket.id, c2.socket.id]
      const [during] = await Promise.all([p1.connect(campaign.id, true), dm.request(`${path}/session`, { active: true })])
      sockets.push(during.socket)
      await waitFor(() => [dc, c1, c2, during].every(c => c.session?.sessionActive && c.snapshot), 'Session start did not deliver an authorised battlefield')
      assert.deepEqual([c1.socket.id, c2.socket.id], connectionIds)
      assert.equal(during.snapshot!.encounterId, encounter.id)
      during.socket.disconnect(); sockets.splice(sockets.indexOf(during.socket), 1)
    })
    const send = (client: typeof dc, command: GameCommand, override: Partial<CommandEnvelope> = {}) => new Promise<CommandResult>((resolve, reject) => {
      client.socket.timeout(8000).emit('game.command', { commandId: randomUUID(), encounterId: client.snapshot!.encounterId, revision: client.snapshot!.revision, command, ...override }, (error, result) => error ? reject(error) : resolve(result))
    })
    const accepted = async (client: typeof dc, command: GameCommand) => { const r = await send(client, command); assert.ok(r.ok, JSON.stringify(r)); return r }
    await t.test('WebSocket authentication rejects missing sessions, wrong CSRF and hostile origins', async () => {
      for (const [cookie, csrf, socketOrigin] of [['', dm.csrf, origin], [dm.cookie, 'forged', origin], [dm.cookie, dm.csrf, 'https://evil.test']]) {
        const socket = io(base, { transports: ['websocket'], extraHeaders: { Origin: socketOrigin, Cookie: cookie }, auth: { csrf }, reconnection: false })
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Unauthorised handshake did not fail')), 3000)
            socket.once('connect', () => { clearTimeout(timeout); reject(new Error('Unauthorised socket connected')) })
            socket.once('connect_error', () => { clearTimeout(timeout); resolve() })
          })
        } finally { socket.disconnect() }
      }
    })
    await t.test('hidden state and private notes never enter player payloads', async () => {
      for (const client of [c1, c2]) {
        const payload = JSON.stringify(client.snapshot)
        for (const secret of ['Secret dragon', 'DM secret', 'Action:Secret', 'data:image']) assert.ok(!payload.includes(secret))
        assert.equal(client.snapshot!.state.activeId, null)
        assert.equal(client.snapshot!.state.battleMap.tokens['2'], undefined)
      }
      assert.equal(dc.snapshot!.state.combatants.length, 3)
    })
    await accepted(dc, { type: 'token.assign', combatantId: 1, playerId: p1.actor!.id })
    await accepted(dc, { type: 'token.assign', combatantId: 3, playerId: p2.actor!.id })
    await t.test('player cannot use DM controls, move others or join other campaigns', async () => {
      for (const command of [
        { type: 'token.move', combatantId: 3, destination: { x: 7, z: 7 } },
        { type: 'initiative.next' }, { type: 'combatant.hp.update', combatantId: 1, hp: 1 },
        { type: 'combatant.visibility', combatantId: 2, visible: true },
        { type: 'token.assign', combatantId: 1, playerId: p2.actor!.id },
      ] as GameCommand[]) { const result = await send(c1, command); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'FORBIDDEN') }
      await p1.request(`${path}/session`, { active: false }, 403)
      const other = await dm.request('/campaigns', { name: 'Other campaign' }, 201)
      await dm.request(`/campaigns/${other.id}/encounters`, { name: 'Private' }, 201)
      await p1.request(`/campaigns/${other.id}/snapshot`, undefined, 403)
      const join = await new Promise<CommandResult>(resolve => c1.socket.emit('campaign.join', other.id, resolve))
      assert.equal(join.ok, false)
      const wrongEncounter = await send(c1, { type: 'token.move', combatantId: 1, destination: { x: 2, z: 2 } }, { encounterId: randomUUID() })
      assert.equal(wrongEncounter.ok, false)
    })
    await t.test('owner movement, DM movement, HP and initiative synchronise to all clients', async () => {
      await accepted(c1, { type: 'token.move', combatantId: 1, destination: { x: 4, z: 5 } })
      for (const client of [dc, c1, c2]) assert.deepEqual(client.snapshot!.state.battleMap.tokens['1'], { x: 4, z: 5 })
      await accepted(dc, { type: 'token.move', combatantId: 3, destination: { x: 9, z: 9 } })
      await accepted(dc, { type: 'combatant.hp.update', combatantId: 1, hp: 7 })
      assert.equal(c1.snapshot!.state.combatants.find(c => c.id === 1)!.hp, 7)
      assert.equal(c2.snapshot!.state.combatants.find(c => c.id === 1)!.hp, 0)
      await accepted(dc, { type: 'initiative.next' })
      assert.equal(c1.snapshot!.state.activeId, 3)
    })
    await t.test('DM HP-sharing preference persists and broadcasts without exposing other statistics',async()=>{
      await accepted(dc,{type:'combatant.hp.visibility',combatantId:1,shown:true})
      assert.equal(c2.snapshot!.state.combatants.find(c=>c.id===1)!.hp,7)
      assert.equal(c2.snapshot!.state.combatants.find(c=>c.id===1)!.ac,0)
      assert.equal(c2.snapshot!.state.combatants.find(c=>c.id===1)!.privateNotes,'')
      const persisted=await dm.request(path+'/export');assert.equal(persisted.combatants.find((c:{id:number})=>c.id===1).hpShown,true)
      const denied=await send(c1,{type:'combatant.hp.visibility',combatantId:1,shown:false});assert.equal(denied.ok,false)
      await accepted(dc,{type:'combatant.hp.visibility',combatantId:1,shown:false})
      assert.equal(c2.snapshot!.state.combatants.find(c=>c.id===1)!.hp,0)
      assert.equal(c1.snapshot!.state.combatants.find(c=>c.id===1)!.hp,7)
    })
    await t.test('concurrent commands serialize, duplicates are idempotent and stale revisions reject', async () => {
      const revision = dc.snapshot!.revision
      const [a, b] = await Promise.all([
        send(dc, { type: 'token.move', combatantId: 1, destination: { x: 10, z: 10 } }, { revision }),
        send(c1, { type: 'token.move', combatantId: 1, destination: { x: 11, z: 11 } }, { revision }),
      ])
      assert.equal([a, b].filter(r => r.ok).length, 1)
      await waitFor(() => dc.snapshot!.revision === revision + 1, 'Concurrent movement not observed')
      const commandId = randomUUID(), prior = dc.snapshot!.revision
      const command: GameCommand = { type: 'token.move', combatantId: 2, destination: { x: 6, z: 6 } }
      const first = await send(dc, command, { commandId, revision: prior }); assert.ok(first.ok)
      const duplicate = await send(dc, command, { commandId, revision: prior }); assert.ok(duplicate.ok && duplicate.duplicate)
      assert.equal(dc.snapshot!.revision, prior + 1)
      assert.equal((await send(dc, { type: 'initiative.next' }, { revision: prior })).ok, false)
      assert.equal((await send(dc, { ...command, destination: { x: 7, z: 7 } }, { commandId, revision: prior })).ok, false)
    })
    await t.test('artwork deduplicates, export remains compatible and checkpoints restore', async () => {
      const exported = await dm.request(`${path}/export`)
      assert.equal(exported.version, 1); assert.equal(exported.round, 3)
      assert.equal(exported.combatants[0].artwork, fixture.combatants[0].artwork)
      assert.equal(Number((await pool.query('SELECT count(*) FROM artwork')).rows[0].count), 1)
      const stored = JSON.stringify((await pool.query('SELECT state FROM encounters')).rows)
      assert.ok(!stored.includes('data:image'))
      const artPath = dc.snapshot!.state.combatants[0].artwork!
      const forbiddenArt = await fetch(`${base}${artPath}`, { headers: { Cookie: p2.cookie } }); assert.equal(forbiddenArt.status, 403)
      const ownArt = await fetch(`${base}${artPath}`, { headers: { Cookie: p1.cookie } }); assert.equal(ownArt.status, 200)
      assert.ok(ownArt.headers.get('content-security-policy')?.includes("sandbox; default-src 'none'"))
      const save = await dm.request(`${path}/checkpoints`, {}, 201)
      await accepted(dc, { type: 'combatant.hp.update', combatantId: 1, hp: 1 })
      const prior = dc.snapshot!.revision
      await dm.request(`${path}/checkpoints/${save.id}/restore`, {})
      await waitFor(() => dc.snapshot!.revision > prior, 'Restore not broadcast')
      assert.equal(c1.snapshot!.state.combatants[0].hp, 7)
    })
    await t.test('DM dungeon commands broadcast to both players; player edits and stale writes reject', async () => {
      await accepted(dc, { type: 'map.generate', options: { width: 30, height: 24, roomCount: 4, minRoomSize: 3, maxRoomSize: 6, theme: 'mining-outpost', seed: 'multiplayer-map' } })
      for (const client of [dc, c1, c2]) {
        assert.equal(client.snapshot!.state.dungeonMap!.schemaVersion, 1)
        assert.equal(client.snapshot!.state.dungeonMap!.width, 30)
        assert.ok(client.snapshot!.state.dungeonMap!.props.length)
      }
      const revision = dc.snapshot!.revision
      const mapRevision = dc.snapshot!.state.mapRevision!
      const denied = await send(c1, { type: 'map.floor.paint', cells: [{ x: 0, z: 0 }], material: 'lava' })
      assert.ok(!denied.ok && denied.error.code === 'FORBIDDEN')
      const undoDenied = await send(c2, { type: 'map.undo' }); assert.ok(!undoDenied.ok && undoDenied.error.code === 'FORBIDDEN')
      await accepted(dc, { type: 'map.floor.paint', cells: [{ x: 0, z: 0 }], material: 'lava' })
      assert.ok(c1.snapshot!.state.dungeonMap!.floors.some(f => f.x === 0 && f.z === 0 && f.type === 'lava'))
      assert.equal(c2.snapshot!.state.mapRevision, mapRevision + 1)
      const stale = await send(dc, { type: 'map.wall.place', wall: { id: 'H:0:0', axis: 'H', x: 0, z: 0, material: 'stone' } }, { revision })
      assert.ok(!stale.ok && stale.error.code === 'CONFLICT')
      await accepted(dc, { type: 'map.wall.place', wall: { id: 'H:0:0', axis: 'H', x: 0, z: 0, material: 'wood' } })
      await accepted(dc, { type: 'map.door.place', door: { id: 'test-door', wallId: 'H:0:0', state: 'locked' } })
      await accepted(dc, { type: 'map.prop.place', prop: { id: 'test-anvil', type: 'anvil', position: { x: 0, z: 0 }, rotation: 0 } })
      await accepted(dc, { type: 'map.prop.rotate', propId: 'test-anvil', rotation: 90 })
      await accepted(dc, { type: 'combatant.hp.update', combatantId: 1, hp: 6 })
      assert.ok(c1.session!.snapshot!.mapDocumentOmitted, 'Combat-only updates should omit the unchanged map')
      assert.equal(c1.session!.snapshot!.state.dungeonMap, undefined)
      assert.ok(c1.snapshot!.state.dungeonMap, 'Client cache must retain the known document')
      await accepted(dc, { type: 'token.move', combatantId: 1, destination: { x: 11, z: 11 } })
      await accepted(dc, { type: 'map.undo' })
      assert.equal(c1.snapshot!.state.dungeonMap!.props.find(p => p.id === 'test-anvil')!.rotation, 0)
      assert.equal(c1.snapshot!.state.combatants[0].hp, 6)
      assert.deepEqual(c1.snapshot!.state.battleMap.tokens['1'], { x: 11, z: 11 })
      await accepted(dc, { type: 'map.redo' })
      assert.equal(c2.snapshot!.state.dungeonMap!.props.find(p => p.id === 'test-anvil')!.rotation, 90)
      await accepted(dc, { type: 'combatant.hp.update', combatantId: 1, hp: 7 })
      const exported = await dm.request(`${path}/export`)
      assert.deepEqual(importEncounter(exported).dungeonMap, dc.snapshot!.state.dungeonMap)
      const before = dc.snapshot!.revision
      const malformed = await send(dc, { type: 'encounter.restore', file: { ...exported, dungeonMap: { ...exported.dungeonMap, props: [{ id: 'bad', type: 'evil.glb', position: { x: 0, z: 0 }, rotation: 0 }] } } } as unknown as GameCommand)
      assert.equal(malformed.ok, false); assert.equal(dc.snapshot!.revision, before)
    })
    await t.test('campaign templates save, copy, rename, duplicate and delete independently of encounter instances', async () => {
      const saved = await dm.request(`${path}/maps`, { name: 'Reusable mine', encounterId: encounter.id, encounterRevision: dc.snapshot!.revision }, 201)
      const loaded = await dm.request(`${path}/maps/${saved.id}`)
      assert.equal(loaded.document.doors.find((d: { id: string }) => d.id === 'test-door').state, 'locked')
      await p1.request(`${path}/maps`, undefined, 403)
      await p1.request(`${path}/maps`, { name: 'Forbidden', encounterId: encounter.id, encounterRevision: dc.snapshot!.revision }, 403)
      const otherCampaign = await dm.request('/campaigns', { name: 'Private map campaign' }, 201)
      await dm.request(`/campaigns/${otherCampaign.id}/maps/${saved.id}`, undefined, 403)
      await accepted(dc, { type: 'map.door.update', doorId: 'test-door', state: 'open' })
      assert.equal((await dm.request(`${path}/maps/${saved.id}`)).document.doors.find((d: { id: string }) => d.id === 'test-door').state, 'locked')
      await dm.request(`${path}/maps/${saved.id}/rename`, { revision: 1, name: 'Renamed mine' })
      await dm.request(`${path}/maps/${saved.id}/delete`, { revision: 1 }, 409)
      const duplicate = await dm.request(`${path}/maps/${saved.id}/duplicate`, { revision: 2, name: 'Duplicate mine' }, 201)
      const otherEncounter = await dm.request(`${path}/encounters`, { name: 'Map copy encounter' }, 201)
      await accepted(dc, { type: 'map.template.load', templateId: duplicate.id })
      assert.equal(c1.snapshot!.encounterId, otherEncounter.id)
      assert.equal(c1.snapshot!.state.dungeonMap!.name, 'Duplicate mine')
      await accepted(dc, { type: 'map.door.update', doorId: 'test-door', state: 'closed' })
      // Overwriting a template from another encounter must not mutate existing instances.
      await dm.request(`${path}/maps/${saved.id}/save`, { name: 'Renamed mine', revision: 2, encounterId: otherEncounter.id, encounterRevision: dc.snapshot!.revision })
      assert.equal((await dm.request(`${path}/maps/${saved.id}`)).document.doors.find((d: { id: string }) => d.id === 'test-door').state, 'closed')
      const original = (await pool.query('SELECT document FROM encounter_maps WHERE encounter_id=$1', [encounter.id])).rows[0].document
      assert.equal(original.doors.find((d: { id: string }) => d.id === 'test-door').state, 'open')
      await dm.request(`${path}/maps/${duplicate.id}/delete`, { revision: 1 })
      assert.ok((await dm.request(`${path}/snapshot`)).state.dungeonMap)
      await dm.request(`${path}/open`, { encounterId: encounter.id })
      const list = await dm.request(`${path}/maps`)
      assert.equal(list.length, 1); assert.equal(list[0].name, 'Renamed mine')
    })
    await t.test('disconnect/reconnect restores identity and newest state without stale replay', async () => {
      const prior = c1.snapshot!.revision
      const oldMapRevision = c1.snapshot!.state.mapRevision!
      c1.socket.disconnect()
      await accepted(dc, { type: 'map.floor.paint', cells: [{ x: 1, z: 0 }], material: 'grass' })
      await accepted(dc, { type: 'token.move', combatantId: 1, destination: { x: 13, z: 14 } })
      c1.socket.connect()
      await waitFor(() => c1.snapshot!.revision > prior, 'Reconnect did not load new snapshot')
      assert.equal(c1.snapshot!.actor.id, p1.actor!.id)
      assert.ok(c1.snapshot!.state.mapRevision! > oldMapRevision)
      assert.ok(c1.snapshot!.state.dungeonMap!.floors.some(f => f.x === 1 && f.z === 0 && f.type === 'grass'))
      assert.deepEqual(c1.snapshot!.state.battleMap.tokens['1'], { x: 13, z: 14 })
    })
    await t.test('server restart recovers PostgreSQL state and authenticated sessions', async () => {
      const revision = dc.snapshot!.revision
      const campaignRevision = dc.session!.revision
      const savedMap = dc.snapshot!.state.dungeonMap
      const savedMapRevision = dc.snapshot!.state.mapRevision
      for (const s of sockets) s.disconnect()
      await application.close()
      application = createApplication({ pool, secret, origin })
      await new Promise<void>(resolve => application.http.listen(port, '127.0.0.1', resolve))
      const restored = await p1.request(`${path}/snapshot`)
      assert.equal(restored.revision, revision)
      assert.deepEqual(restored.state.dungeonMap, savedMap)
      assert.equal(restored.state.mapRevision, savedMapRevision)
      assert.equal(Number((await pool.query('SELECT state_revision FROM campaigns WHERE id=$1', [campaign.id])).rows[0].state_revision), campaignRevision)
      assert.deepEqual(restored.state.battleMap.tokens['1'], { x: 13, z: 14 })
      dc.snapshot = null; c1.snapshot = null; c2.snapshot = null
      for (const s of sockets) s.connect()
      await waitFor(() => Boolean(dc.snapshot && c1.snapshot && c2.snapshot), 'Could not reconnect after restart')
      assert.ok((dc.snapshot!.state.mapUndoDepth ?? 0) > 0, 'Map history should survive restart')
      await accepted(dc, { type: 'map.undo' })
      assert.ok(c1.snapshot!.state.mapRevision! > savedMapRevision!)
      assert.deepEqual(c1.snapshot!.state.battleMap.tokens['1'], { x: 13, z: 14 })
      await accepted(dc, { type: 'map.redo' })
      assert.deepEqual(c2.snapshot!.state.dungeonMap, savedMap)
    })
    await t.test('revoking a player removes live sockets and HTTP access', async () => {
      await dm.request(`${path}/members/${p2.actor!.id}/revoke`, {})
      await waitFor(() => c2.revoked && !c2.socket.connected, 'Revoked socket remained connected')
      await p2.request(`${path}/snapshot`, undefined, 401)
    })
    await t.test('expired server sessions lose socket and API access', async () => {
      const guest = await new Browser(base).init()
      const invitation = await dm.request(`${path}/invitations`, {}, 201)
      await guest.request('/invitations/redeem', { token: invitation.url.split('#invite=')[1], displayName: 'Temporary' }, 201)
      const client = await guest.connect(campaign.id); sockets.push(client.socket)
      assert.deepEqual(client.snapshot!.state.dungeonMap, dc.snapshot!.state.dungeonMap, 'Late join must receive a complete current map')
      assert.equal(client.snapshot!.state.mapRevision, dc.snapshot!.state.mapRevision)
      await pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE data->'actor'->>'id'=$1", [guest.actor!.id])
      const result = await send(client, { type: 'token.move', combatantId: 1, destination: { x: 1, z: 1 } })
      assert.equal(result.ok, false)
      await waitFor(() => client.revoked, 'Expired socket not revoked')
      await guest.request(`${path}/snapshot`, undefined, 401)
    })
    await t.test('ending a session removes player access, while DM can recover it', async () => {
      await dm.request(`${path}/session`, { active: false })
      await waitFor(() => c1.session?.sessionActive === false, 'Session termination not delivered')
      assert.equal(c1.session!.snapshot, null)
      assert.ok(c1.socket.connected, 'Waiting membership subscription should survive termination')
      await p1.request(`${path}/snapshot`, undefined, 409)
      await dm.request(`${path}/snapshot`)
    })
    await t.test('reconnect while waiting and rapid encounter/session transitions converge on latest state', async () => {
      c1.socket.disconnect(); c1.socket.connect()
      await waitFor(() => c1.socket.connected, 'Waiting player did not reconnect')
      const replacement = await dm.request(`${path}/encounters`, { name: 'Replacement', file: fixture }, 201)
      await Promise.all([
        dm.request(`${path}/session`, { active: true }),
        dm.request(`${path}/session`, { active: false }),
        dm.request(`${path}/open`, { encounterId: encounter.id }),
      ])
      await dm.request(`${path}/open`, { encounterId: replacement.id })
      await dm.request(`${path}/session`, { active: true })
      const authoritative = (await pool.query('SELECT state_revision FROM campaigns WHERE id=$1', [campaign.id])).rows[0].state_revision
      await waitFor(() => c1.session?.revision === authoritative && c1.session.sessionActive, 'Rapid transitions left the player stale')
      assert.equal(c1.session!.snapshot!.encounterId, replacement.id)
      assert.equal(c1.session!.snapshot!.revision, 0)
      assert.equal(c1.session!.snapshot!.state.combatants.length, 2)
    })
    await t.test('production serves assets with secure cookies and no wildcard CORS', async () => {
      const production = createApplication({ pool, secret, origin: 'https://tabletop.example.test', production: true })
      try {
        await new Promise<void>(resolve => production.http.listen(0, '127.0.0.1', resolve))
        const address = `http://127.0.0.1:${(production.http.address() as AddressInfo).port}`
        const bootstrap = await fetch(`${address}/api/session`, { headers: { 'X-Forwarded-Proto': 'https' } })
        const cookie = bootstrap.headers.get('set-cookie') ?? ''
        assert.ok(cookie.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Lax'))
        assert.equal(bootstrap.headers.get('access-control-allow-origin'), null)
        const html = await fetch(address)
        assert.equal(html.status, 200)
        assert.ok((await html.text()).includes('id="root"'))
        assert.ok(html.headers.get('content-security-policy')?.includes("script-src 'self'"))
      } finally { await production.close() }
    })
    await t.test('invitation redemption rate limiting is enforced', async () => {
      let lastStatus = 0
      for (let i = 0; i < 31; i++) {
        const response = await fetch(`${base}/api/invitations/redeem`, { method: 'POST', headers: { Cookie: stranger.cookie, Origin: origin, 'X-CSRF-Token': stranger.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'x'.repeat(43), displayName: 'Rate limited' }) })
        lastStatus = response.status
        if (lastStatus === 429) break
      }
      assert.equal(lastStatus, 429)
    })

  } finally {
    for (const socket of sockets) socket.disconnect()
    await application.close(); await pool.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end()
  }
})
