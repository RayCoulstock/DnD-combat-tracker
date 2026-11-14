import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import pg from 'pg'
import { io, type Socket } from 'socket.io-client'
import { createApplication } from '../app.ts'
import { migrate } from '../migrate.ts'
import { mergeMapSnapshot, importEncounter, type GameCommand, type Snapshot, type CommandResult, type ClientEvents, type ServerEvents } from '../../shared/domain.ts'
import { coordinateSceneGeneration } from '../../shared/sceneGenerationCoordinator.ts'
import { sceneGenerationSpecSchema } from '../../shared/sceneGeneration.ts'
import { fullMask } from '../../shared/fog.ts'
const origin='http://localhost:5173'
async function waitFor(condition:()=>boolean){const end=Date.now()+8000;while(!condition()){if(Date.now()>end)throw Error('Scene snapshot did not converge');await new Promise(resolve=>setTimeout(resolve,20))}}
class Client{
  cookie='';csrf='';snapshot:Snapshot|null=null;socket?:Socket<ServerEvents,ClientEvents>
  constructor(public base:string){}
  async api(path:string,body?:unknown,status=200){
    const response=await fetch(this.base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:this.cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':this.csrf},body:body===undefined?undefined:JSON.stringify(body)})
    const cookies=response.headers.getSetCookie();if(cookies.length)this.cookie=cookies.map(c=>c.split(';')[0]).join('; ')
    const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));if(data.csrf)this.csrf=data.csrf;return data
  }
  async connect(campaignId:string){
    this.snapshot=null
    this.socket=io(this.base,{transports:['websocket'],extraHeaders:{Cookie:this.cookie,Origin:origin},auth:{csrf:this.csrf},reconnection:false})
    this.socket.on('session.state',state=>{if(state.snapshot)this.snapshot=mergeMapSnapshot(this.snapshot,state.snapshot)})
    this.socket.on('connect',()=>this.socket!.emit('campaign.join',campaignId,()=>{}));await waitFor(()=>Boolean(this.snapshot))
  }
  async command(command:GameCommand,accepted=true){
    const current=this.snapshot!
    const result=await new Promise<CommandResult>(resolve=>this.socket!.emit('game.command',{commandId:randomUUID(),encounterId:current.encounterId,revision:current.revision,command},resolve))
    assert.equal(result.ok,accepted,JSON.stringify(result));if(result.ok)await waitFor(()=>this.snapshot!.revision>=result.revision);return result
  }
}
// Exercises canonical compatibility through existing map commands, not a new scene acceptance protocol.
test('combined B/C canonical output retains multiplayer authority, receipts, history, fog and restart', { timeout: 90000 }, async () => {
  assert.ok(process.env.DATABASE_URL, 'Use a disposable development PostgreSQL database.')
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL }), schema = `scene_${randomUUID().replaceAll('-', '')}`
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` })
  const options = { pool, origin, secret: 'scene-integration-only-secret-'.repeat(3) }
  let app = createApplication(options)
  const clients: Client[] = []
  try {
    await migrate(pool)
    await new Promise<void>(resolve => app.http.listen(0, '127.0.0.1', resolve))
    const port = (app.http.address() as AddressInfo).port, base = `http://127.0.0.1:${port}`
    const dm = new Client(base), player = new Client(base); clients.push(dm, player)
    await dm.api('/session'); await player.api('/session')
    await dm.api('/auth/register', { email: `${randomUUID()}@example.test`, password: 'Scene Integration Password 2056!' }, 201)
    const campaign = await dm.api('/campaigns', { name: 'Combined scene' }, 201), path = `/campaigns/${campaign.id}`
    const invite = await dm.api(`${path}/invitations`, {}, 201)
    await player.api('/invitations/redeem', { token: invite.url.split('#invite=')[1], displayName: 'Scene player' }, 201)
    await dm.api(`${path}/encounters`, { name: 'Scene', file: { version: 1, round: 1, combatants: [] } }, 201)
    await dm.api(`${path}/session`, { active: true })
    await Promise.all([dm.connect(campaign.id), player.connect(campaign.id)])
    await dm.command({ type: 'map.blank', id: 'prior-scene', name: 'Prior scene', width: 30, height: 25 })
    const prior = structuredClone(dm.snapshot!.state.dungeonMap), depth = dm.snapshot!.state.mapUndoDepth!
    const spec = sceneGenerationSpecSchema.parse(JSON.parse(readFileSync(new URL('../../shared/fixtures/scene-generation-v1.json', import.meta.url), 'utf8')))
    spec.zones[0].effects = ['campfire', 'magical-motes']
    const document = coordinateSceneGeneration(spec, { manifest: { version: 1, assets: [], effects: ['campfire', 'magical-motes'] } }).document
    const envelope = { commandId: randomUUID(), encounterId: dm.snapshot!.encounterId, revision: dm.snapshot!.revision, command: { type: 'map.load' as const, document } }
    const emit = () => new Promise<CommandResult>(resolve => dm.socket!.emit('game.command', envelope, resolve))
    const accepted = await emit(); assert.equal(accepted.ok, true)
    await waitFor(() => dm.snapshot!.revision === envelope.revision + 1 && player.snapshot!.revision === dm.snapshot!.revision)
    const duplicate = await emit(); assert.ok(duplicate.ok && duplicate.duplicate)
    assert.equal(dm.snapshot!.state.mapUndoDepth, depth + 1)
    assert.deepEqual(dm.snapshot!.state.dungeonMap, document)
    assert.equal(player.snapshot!.state.dungeonMap!.environmentalEffects!.effects.length, 0)
    assert.equal(player.snapshot!.state.dungeonMap!.lighting!.sources!.length, 0)
    const stale = await new Promise<CommandResult>(resolve => dm.socket!.emit('game.command', { ...envelope, commandId: randomUUID() }, resolve))
    assert.ok(!stale.ok && stale.error.code === 'CONFLICT')
    await player.command({ type: 'map.load', document }, false)
    await dm.command({ type: 'map.undo' }); assert.deepEqual(dm.snapshot!.state.dungeonMap, prior)
    await dm.command({ type: 'map.redo' }); assert.deepEqual(dm.snapshot!.state.dungeonMap, document)
    await dm.command({ type: 'map.fog.mask', levelId: 'ground', mask: fullMask(document.width, document.height) })
    await waitFor(() => player.snapshot!.revision === dm.snapshot!.revision)
    // The generated campfire's linked radius crosses the map edge. Even a full mask
    // must keep that glow concealed; the smaller motes remain visible.
    assert.equal(player.snapshot!.state.dungeonMap!.environmentalEffects!.effects.length, 1)
    assert.equal(player.snapshot!.state.dungeonMap!.environmentalEffects!.effects[0].presetId, 'magical-motes')
    assert.equal(player.snapshot!.state.dungeonMap!.lighting!.sources!.length, 0)
    await dm.command({ type: 'map.fog.enabled', enabled: false })
    await waitFor(() => player.snapshot!.revision === dm.snapshot!.revision)
    assert.equal(player.snapshot!.state.dungeonMap!.environmentalEffects!.effects.length, 2)
    assert.equal(player.snapshot!.state.dungeonMap!.lighting!.sources!.length, 1)
    await dm.command({ type: 'map.fog.enabled', enabled: true })
    await dm.command({ type: 'map.fog.reset', confirmed: true, levelId: 'ground' })
    await waitFor(() => player.snapshot!.revision === dm.snapshot!.revision)
    assert.equal(player.snapshot!.state.dungeonMap!.lighting!.sources!.length, 0)
    const exported = await dm.api(`${path}/export`)
    assert.deepEqual(importEncounter(exported).dungeonMap, dm.snapshot!.state.dungeonMap)
    const saved = await dm.api(`${path}/maps`, { name: 'Combined template', encounterId: dm.snapshot!.encounterId, encounterRevision: dm.snapshot!.revision }, 201)
    const other = await dm.api('/campaigns', { name: 'Isolated campaign' }, 201)
    await dm.api(`/campaigns/${other.id}/maps/${saved.id}`, undefined, 403)
    const persisted = structuredClone(dm.snapshot!.state.dungeonMap), historyDepth = dm.snapshot!.state.mapUndoDepth
    for (const client of clients) client.socket?.disconnect()
    await app.close(); app = createApplication(options)
    await new Promise<void>(resolve => app.http.listen(port, '127.0.0.1', resolve))
    await Promise.all([dm.connect(campaign.id), player.connect(campaign.id)])
    assert.deepEqual(dm.snapshot!.state.dungeonMap, persisted)
    assert.equal(dm.snapshot!.state.mapUndoDepth, historyDepth)
    assert.equal(player.snapshot!.state.dungeonMap!.environmentalEffects!.effects.length, 0)
    assert.deepEqual((await dm.api(`${path}/maps/${saved.id}`)).document, { ...persisted, name: 'Combined template' })
  } finally {
    for (const client of clients) client.socket?.disconnect()
    await app.close(); await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end()
  }
})
