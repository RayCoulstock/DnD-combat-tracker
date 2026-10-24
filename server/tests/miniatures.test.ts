import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import pg from 'pg'
import { io, type Socket } from 'socket.io-client'
import { createApplication } from '../app.ts'
import { migrate } from '../migrate.ts'
import { FilesystemAssetStorage } from '../asset-storage.ts'
import { makeGlb, triangleDocument } from '../../test-fixtures/glb.ts'
import { miniatureSchema } from '../../shared/miniatures.ts'
import { importEncounter, type GameCommand, type Snapshot, type ClientEvents, type ServerEvents, type CommandResult } from '../../shared/domain.ts'
const origin = 'http://localhost:5173'
async function waitFor(condition: () => boolean) { const end = Date.now()+8000; while (!condition()) { if (Date.now()>end) throw new Error('Snapshot did not converge'); await new Promise(r => setTimeout(r, 20)) } }
class Client {
  cookie = ''; csrf = ''; actor!: { id: string; role: string }; socket?: Socket<ServerEvents, ClientEvents>; snapshot: Snapshot | null = null
  constructor(public base: string) {}
  async api(path: string, body?: unknown, status = 200) {
    const res = await fetch(this.base+'/api'+path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: this.cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }, body: body === undefined ? undefined : JSON.stringify(body) })
    const cookies=res.headers.getSetCookie(); if(cookies.length) this.cookie=cookies.map(c=>c.split(';')[0]).join('; ')
    const data=await res.json(); assert.equal(res.status,status,JSON.stringify(data)); if(data.csrf)this.csrf=data.csrf; if(data.actor)this.actor=data.actor; return data
  }
  async upload(name = 'Skeleton') {
    const document = triangleDocument(); document.asset.generator = name
    const data=new FormData(); data.set('metadata',JSON.stringify({name,category:'monster'})); data.set('file',new Blob([new Uint8Array(makeGlb(document))]),name+'.glb')
    const res=await fetch(this.base+'/api/assets',{method:'POST',headers:{Cookie:this.cookie,Origin:origin,'X-CSRF-Token':this.csrf},body:data}); const asset=await res.json(); assert.equal(res.status,201,JSON.stringify(asset));return asset
  }
  async connect(campaignId: string) {
    this.socket=io(this.base,{transports:['websocket'],extraHeaders:{Origin:origin,Cookie:this.cookie},auth:{csrf:this.csrf},reconnection:false})
    this.socket.on('session.state',s=>{if(s.snapshot)this.snapshot=s.snapshot})
    this.socket.on('connect',()=>this.socket!.emit('campaign.join',campaignId,()=>{})); await waitFor(()=>Boolean(this.snapshot))
  }
  async command(command: GameCommand, accepted=true) {
    const previous=this.snapshot!
    const result=await new Promise<CommandResult>(r=>this.socket!.emit('game.command',{commandId:randomUUID(),encounterId:previous.encounterId,revision:previous.revision,command},r))
    assert.equal(result.ok,accepted,JSON.stringify(result)); if(result.ok) await waitFor(()=>this.snapshot!.revision>=result.revision);return result
  }
  async file(id:string,campaignId:string,encounterId:string,status=200) {const res=await fetch(`${this.base}/api/assets/${id}/file?campaignId=${campaignId}&encounterId=${encounterId}`,{headers:{Cookie:this.cookie}});assert.equal(res.status,status,await(res.status===200?Promise.resolve(''):res.text()));return res}
}
test('miniatures use encounter authority and narrowly scoped binary grants with DM and two players', {timeout:60000}, async t=>{
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='mini_'+randomUUID().replaceAll('-',''),root=await mkdtemp(join(tmpdir(),'miniatures-'))
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`}),storage=new FilesystemAssetStorage(root)
  const options={pool,assetStorage:storage,origin,secret:'miniature-integration-test-secret-'.repeat(3)}
  let app=createApplication(options)
  const clients:Client[]=[]
  try{
    await migrate(pool);await new Promise<void>(r=>app.http.listen(0,'127.0.0.1',r));const port=(app.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`
    for(let i=0;i<5;i++){const c=new Client(base);await c.api('/session');clients.push(c)}
    const[dm,p1,p2,other,outsider]=clients
    for(const c of[dm,other])await c.api('/auth/register',{email:randomUUID()+'@example.test',password:'Miniature Secure Password 2049!'},201)
    const campaign=await dm.api('/campaigns',{name:'Miniatures'},201),path=`/campaigns/${campaign.id}`
    const otherCampaign=await other.api('/campaigns',{name:'Unrelated'},201)
    for(const[c,owner,camp]of[[p1,dm,campaign],[p2,dm,campaign],[outsider,other,otherCampaign]]as const){const invite=await owner.api(`/campaigns/${camp.id}/invitations`,{},201);await c.api('/invitations/redeem',{token:invite.url.split('#invite=')[1],displayName:'Player'},201)}
    const file={version:1,round:1,combatants:[1,2,3].map(id=>({id,name:'Combatant '+id,side:'hero',hp:10,maxHp:10,ac:15,initiative:20-id,conditions:[],saves:[],actions:[],visible:id!==3}))}
    const encounter=await dm.api(path+'/encounters',{name:'Miniatures',file},201);await dm.api(path+'/session',{active:true})
    await Promise.all([dm.connect(campaign.id),p1.connect(campaign.id),p2.connect(campaign.id)])
    const asset=await dm.upload(),hidden=await dm.upload('Hidden model'),foreign=await other.upload('Private model')
    const appearance=miniatureSchema.parse({assetId:asset.id,scale:1.5,rotation:90,verticalOffset:.2,baseSize:'Large'})
    await t.test('DM assigns one shared model to multiple combatants; players receive independent settings',async()=>{
      await dm.command({type:'combatant.miniature.update',combatantId:1,miniature:appearance})
      await dm.command({type:'combatant.miniature.update',combatantId:2,miniature:{...appearance,scale:2,rotation:180}})
      await dm.command({type:'combatant.miniature.update',combatantId:3,miniature:{...appearance,assetId:hidden.id}})
      await waitFor(()=>p1.snapshot!.revision===dm.snapshot!.revision&&p2.snapshot!.revision===dm.snapshot!.revision)
      assert.deepEqual(p1.snapshot!.state.combatants[0].miniature,appearance);assert.equal(p2.snapshot!.state.combatants[1].miniature!.rotation,180)
      assert.equal(p1.snapshot!.state.combatants.length,2)
      await p1.file(asset.id,campaign.id,encounter.id);await p2.file(asset.id,campaign.id,encounter.id)
      await dm.api(`/assets/${asset.id}/delete`,{revision:1},409)
    })
    await t.test('ownership, hidden-only references, campaign context and all assignment entry points are enforced',async()=>{
      await p1.file(hidden.id,campaign.id,encounter.id,404);await outsider.file(asset.id,campaign.id,encounter.id,404)
      await p1.file(asset.id,otherCampaign.id,encounter.id,404);await p1.file(asset.id,campaign.id,randomUUID(),404)
      await other.api(`/assets/${asset.id}`,undefined,404);await p1.api('/assets',undefined,403)
      await p1.command({type:'combatant.miniature.update',combatantId:1,miniature:appearance},false)
      await dm.command({type:'combatant.miniature.update',combatantId:1,miniature:{...appearance,assetId:foreign.id}},false)
      await dm.command({type:'combatant.edit',combatantId:1,combatant:{...dm.snapshot!.state.combatants[0],miniature:{...appearance,assetId:foreign.id}}},false)
      await dm.command({type:'combatant.add',combatants:[{...dm.snapshot!.state.combatants[0],id:'foreign',miniature:{...appearance,assetId:foreign.id}}]},false)
      await dm.command({type:'token.assign',combatantId:1,playerId:p1.actor.id});await dm.command({type:'token.assign',combatantId:2,playerId:p2.actor.id})
      await waitFor(()=>p1.snapshot!.revision===dm.snapshot!.revision)
      await p1.command({type:'token.move',combatantId:2,destination:{x:3,z:3}},false)
      await p1.command({type:'token.move',combatantId:1,destination:{x:5,z:6}})
      await waitFor(()=>dm.snapshot!.state.battleMap.tokens['1'].x===5)
      assert.equal(dm.snapshot!.state.combatants[0].miniature!.rotation,90)
      await dm.command({type:'combatant.hp.update',combatantId:1,hp:7})
      assert.equal((await pool.query('SELECT count(*) FROM combatant_asset_references')).rows[0].count,'3')
    })
    await t.test('visibility, session end, encounter switches and reconnect recheck delivery rights',async()=>{
      await dm.command({type:'combatant.visibility',combatantId:3,visible:true});await p1.file(hidden.id,campaign.id,encounter.id)
      await dm.command({type:'combatant.visibility',combatantId:3,visible:false});await p1.file(hidden.id,campaign.id,encounter.id,404)
      await dm.api(path+'/session',{active:false});await p1.file(asset.id,campaign.id,encounter.id,404)
      await dm.api(path+'/session',{active:true})
      await dm.api(path+'/encounters',{name:'Other encounter'},201);await p1.file(asset.id,campaign.id,encounter.id,404)
      await dm.api(path+'/open',{encounterId:encounter.id});await waitFor(()=>dm.snapshot!.encounterId===encounter.id)
      p1.socket!.disconnect();p1.snapshot=null;await p1.connect(campaign.id);assert.equal(p1.snapshot!.state.combatants[0].miniature!.assetId,asset.id)
    })
    await t.test('checkpoint, export and backend restart retain appearances and grants',async()=>{
      const exported=await dm.api(path+'/export');assert.deepEqual(importEncounter(exported).combatants[0].miniature,appearance)
      const save=await dm.api(path+'/checkpoints',{},201)
      await dm.command({type:'combatant.miniature.update',combatantId:1,miniature:{...appearance,assetId:null}})
      await dm.api(path+`/checkpoints/${save.id}/restore`,{});await waitFor(()=>dm.snapshot!.state.combatants[0].miniature?.assetId===asset.id)
      for(const c of[dm,p1,p2])c.socket!.disconnect();await app.close();app=createApplication(options);await new Promise<void>(r=>app.http.listen(port,'127.0.0.1',r))
      for(const c of[dm,p1,p2]){c.snapshot=null;await c.connect(campaign.id)}
      assert.deepEqual(dm.snapshot!.state.combatants[0].miniature,appearance);await p1.file(asset.id,campaign.id,encounter.id)
      await dm.api(path+`/members/${p2.actor.id}/revoke`,{});await p2.file(asset.id,campaign.id,encounter.id,401)
    })
    await t.test('concurrent deletion and assignment cannot publish a dangling grant',async()=>{
      const racing=await dm.upload('Race model'), prior=dm.snapshot!
      const assignment=new Promise<CommandResult>(r=>dm.socket!.emit('game.command',{commandId:randomUUID(),encounterId:prior.encounterId,revision:prior.revision,command:{type:'combatant.miniature.update',combatantId:2,miniature:{...appearance,assetId:racing.id}}},r))
      const deletion=fetch(base+`/api/assets/${racing.id}/delete`,{method:'POST',headers:{Cookie:dm.cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':dm.csrf},body:JSON.stringify({revision:1})})
      const [assigned,deleted]=await Promise.all([assignment,deletion])
      assert.ok((assigned.ok&&deleted.status===409)||(!assigned.ok&&deleted.status===200))
      if(assigned.ok)await waitFor(()=>dm.snapshot!.revision===assigned.revision)
      const refs=await pool.query('SELECT 1 FROM combatant_asset_references WHERE asset_id=$1',[racing.id])
      assert.equal(Boolean(refs.rowCount),assigned.ok)
    })
    await t.test('unknown/private imported UUIDs render unavailable and never become access grants',async()=>{
      const unknown=randomUUID()
      await dm.command({type:'encounter.restore',file:{...file,combatants:file.combatants.map((c,i)=>({...c,miniature:{...appearance,assetId:i===0?unknown:foreign.id}}))}})
      assert.equal(dm.snapshot!.state.combatants[0].miniature!.assetId,unknown);assert.equal(dm.snapshot!.state.combatants[0].miniatureStatus,'unavailable')
      assert.equal((await pool.query('SELECT count(*) FROM combatant_asset_references')).rows[0].count,'0')
      await p1.file(foreign.id,campaign.id,encounter.id,404);await p1.file(unknown,campaign.id,encounter.id,404)
      await dm.command({type:'combatant.hp.update',combatantId:1,hp:5}) // Unresolved imports survive normal combat saves.
      await dm.api(`/assets/${asset.id}/delete`,{revision:1})
      await dm.command({type:'combatant.miniature.update',combatantId:1,miniature:{...appearance,assetId:unknown}},false)
    })
  }finally{for(const c of clients)c.socket?.disconnect();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await rm(root,{recursive:true,force:true})}
})
