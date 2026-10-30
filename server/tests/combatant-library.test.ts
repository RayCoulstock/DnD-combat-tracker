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
import { execute } from '../game.ts'
import { commandSchema } from '../../shared/domain.ts'
import { migrate } from '../migrate.ts'
import { FilesystemAssetStorage } from '../asset-storage.ts'
import { makeGlb, triangleDocument } from '../../test-fixtures/glb.ts'
import { miniatureSchema } from '../../shared/miniatures.ts'
import { type GameCommand, type Snapshot, type ClientEvents, type ServerEvents, type CommandResult } from '../../shared/domain.ts'
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
test('persistent library uses PostgreSQL, campaign state and permitted multiplayer snapshots',{timeout:90000},async t=>{
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='library_'+randomUUID().replaceAll('-',''),root=await mkdtemp(join(tmpdir(),'combatant-library-'))
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`})
  const options={pool,assetStorage:new FilesystemAssetStorage(root),origin,secret:'library-integration-test-secret-'.repeat(3)}
  let app=createApplication(options)
  const clients:Client[]=[]
  try{
    await migrate(pool);await migrate(pool)
    await new Promise<void>(r=>app.http.listen(0,'127.0.0.1',r))
    const base=`http://127.0.0.1:${(app.http.address() as AddressInfo).port}`
    for(let i=0;i<4;i++){const c=new Client(base);await c.api('/session');clients.push(c)}
    const [dm,player,other,late]=clients
    for(const c of [dm,other])await c.api('/auth/register',{email:randomUUID()+'@example.test',password:'Library Secure Password 2049!'},201)
    const campaign=await dm.api('/campaigns',{name:'Library campaign'},201),path=`/campaigns/${campaign.id}`
    for(const c of [player,late]){const invite=await dm.api(path+'/invitations',{},201);await c.api('/invitations/redeem',{token:invite.url.split('#invite=')[1],displayName:'Library player'},201)}
    const original={id:'old',name:'Aria',side:'hero',hp:8,maxHp:20,ac:15,initiative:18,conditions:['Poisoned'],saves:[['STR',12]],details:[['Class','Ranger']],actions:[{name:'Bow',text:'1d8 damage'}],privateNotes:'Secret history'}
    const encounter=await dm.api(path+'/encounters',{name:'First',file:{version:1,round:1,combatants:[original]}},201)
    await dm.api(path+'/session',{active:true});await Promise.all([dm.connect(campaign.id),player.connect(campaign.id)])
    const asset=await dm.upload('Library default'),foreign=await other.upload('Other DM model')
    const appearance=miniatureSchema.parse({assetId:asset.id,scale:1.5,rotation:90,verticalOffset:.25,baseSize:'Large'})
    const id=randomUUID(),body={name:'Aria',kind:'player-character',campaignId:null,notes:'DM notes',definition:{...original,miniature:appearance},revision:0}
    let hero=await dm.api(`/combatant-library/${id}`,body)
    const add=(entryId:string,extra:Record<string,unknown>={})=>({type:'library.add',entryId,instanceId:randomUUID(),useSavedState:true,allowDuplicate:false,...extra}) as GameCommand
    await t.test('create retries, edits, stale writes and preserved models',async()=>{
      const retry=await dm.api(`/combatant-library/${id}`,body);assert.equal(retry.id,id);assert.equal(retry.revision,1)
      await dm.api(`/combatant-library/${id}`,{...body,name:'Conflicting retry'},409)
      hero=await dm.api(`/combatant-library/${id}`,{...body,revision:hero.revision,definition:{...original,ac:17}})
      assert.deepEqual(hero.definition.miniature,appearance);assert.equal(hero.definition.ac,17)
      await dm.api(`/combatant-library/${id}`,{...body,revision:1},409)
      await dm.api(`/combatant-library/${randomUUID()}`,{...body,definition:{...original,miniature:{...appearance,assetId:foreign.id}}},403)
      assert.equal((await dm.api('/combatant-library')).length,1)
    })
    await t.test('DM authorization and hidden library information',async()=>{
      await player.api('/combatant-library',undefined,403);await player.api(`/combatant-library/${id}`,body,403)
      await other.api(`/combatant-library/${id}`,{...body,revision:2},404)
      await player.api(`/combatant-library/${id}/state/${campaign.id}`,undefined,403)
      assert.deepEqual(await other.api('/combatant-library'),[])
      await player.command(add(id),false)
      await other.api(`/combatant-library/${randomUUID()}`,{...body,campaignId:campaign.id},403)
    })
    await t.test('library-only portraits use existing storage and remain owner-private',async()=>{
      const portraitId=randomUUID(),portrait=await dm.api(`/combatant-library/${portraitId}`,{...body,name:'Portrait character',definition:{...original,artwork:'data:image/png;base64,aGVsbG8='}})
      assert.match(portrait.definition.artwork,/^\/api\/artwork\/[a-f0-9]{64}$/)
      const response=await fetch(base+portrait.definition.artwork,{headers:{Cookie:dm.cookie}});assert.equal(response.status,200)
      await other.api(portrait.definition.artwork.slice(4),undefined,403);await player.api(portrait.definition.artwork.slice(4),undefined,403)
      await other.api(`/combatant-library/${randomUUID()}`,{...body,definition:{...original,artwork:portrait.definition.artwork}},403)
    })
    await t.test('command retries do not duplicate library additions',async()=>{
      const current=dm.snapshot!,command={...add(id),useSavedState:false} as GameCommand
      const envelope={commandId:randomUUID(),encounterId:current.encounterId,revision:current.revision,command}
      const emit=()=>new Promise<CommandResult>(resolve=>dm.socket!.emit('game.command',envelope,resolve))
      const first=await emit();assert.equal(first.ok,true);if(first.ok)await waitFor(()=>dm.snapshot!.revision===first.revision)
      const before=dm.snapshot!.state.combatants.length,retry=await emit();assert.equal(retry.ok,true);if(retry.ok)assert.equal(retry.duplicate,true)
      assert.equal(dm.snapshot!.state.combatants.length,before)
      await dm.command({type:'combatant.remove',combatantId:(command as {instanceId:string}).instanceId})
    })
    let monster:any // eslint-disable-line @typescript-eslint/no-explicit-any
    let firstMonster='',heroInstance=''
    await t.test('convert an existing combatant; monster instances have independent HP and appearance',async()=>{
      monster=await dm.api(`/combatant-library/${randomUUID()}`,{...body,name:'Goblin',kind:'monster-template',campaignId:campaign.id,definition:{...dm.snapshot!.state.combatants[0],side:'enemy',miniature:appearance}})
      for(let i=0;i<2;i++)await dm.command(add(monster.id,{destination:{x:3+i,z:4}}))
      const instances=dm.snapshot!.state.combatants.filter(c=>c.sourceLibraryId===monster.id);assert.equal(instances.length,2);assert.notEqual(instances[0].id,instances[1].id)
      firstMonster=String(instances[0].id)
      await dm.command({type:'combatant.hp.update',combatantId:firstMonster,hp:1})
      assert.equal(dm.snapshot!.state.combatants.find(c=>c.id===instances[1].id)!.hp,20)
      await dm.command({type:'combatant.miniature.update',combatantId:firstMonster,miniature:{...appearance,scale:2}})
      assert.equal((await dm.api('/combatant-library')).find((e:{id:string})=>e.id===monster.id).definition.miniature.scale,1.5)
      await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision)
      assert.equal(player.snapshot!.state.combatants.find(c=>String(c.id)===firstMonster)!.miniature!.scale,2)
      assert.ok(player.snapshot!.state.combatants.every(c=>!c.sourceLibraryId&&!c.privateNotes))
      await dm.command({type:'combatant.visibility',combatantId:firstMonster,visible:false})
      await late.connect(campaign.id);assert.ok(!late.snapshot!.state.combatants.some(c=>String(c.id)===firstMonster))
    })
    await t.test('campaign state is saved only explicitly and duplicate characters require override',async()=>{
      await dm.command(add(id));heroInstance=String(dm.snapshot!.state.combatants.find(c=>c.sourceLibraryId===id)!.id)
      assert.equal(dm.snapshot!.state.combatants.find(c=>String(c.id)===heroInstance)!.unplaced,true)
      await dm.command(add(id),false)
      await dm.command({type:'combatant.hp.update',combatantId:heroInstance,hp:6})
      await dm.command({type:'combatant.conditions',combatantId:heroInstance,conditions:['Poisoned','Prone']})
      const changed=dm.snapshot!.state.combatants.find(c=>String(c.id)===heroInstance)!
      await dm.command({type:'combatant.edit',combatantId:heroInstance,combatant:{...changed,maxHp:23}})
      assert.equal((await dm.api(`/combatant-library/${id}/state/${campaign.id}`)).revision,0)
      await dm.command({type:'library.state.save',combatantId:heroInstance,expectedRevision:0,conditions:['Poisoned']})
      await dm.command({type:'combatant.hp.update',combatantId:heroInstance,hp:2})
      const saved=await dm.api(`/combatant-library/${id}/state/${campaign.id}`)
      assert.deepEqual(saved.state,{hp:6,maxHp:23,conditions:['Poisoned']});assert.equal(saved.revision,1)
      await dm.command({type:'library.state.save',combatantId:heroInstance,expectedRevision:0,conditions:[]},false)
      await player.command({type:'library.state.save',combatantId:heroInstance,expectedRevision:1,conditions:[]},false)
      await dm.command(add(id,{allowDuplicate:true}));assert.equal(dm.snapshot!.state.combatants.filter(c=>c.sourceLibraryId===id).length,2)
    })
    await t.test('campaign states are isolated; scoped NPCs stay in their campaign and templates can cross campaigns',async()=>{
      const second=await dm.api('/campaigns',{name:'Other campaign'},201),secondPath=`/campaigns/${second.id}`
      const secondEncounter=await dm.api(secondPath+'/encounters',{name:'Other encounter'},201)
      const command=async(entryId:string,revision:number)=>execute(pool,{role:'dm',id:dm.actor.id},second.id,{commandId:randomUUID(),encounterId:secondEncounter.id,revision,command:commandSchema.parse(add(entryId))})
      await command(id,0)
      const secondSnapshot=await dm.api(secondPath+'/snapshot');assert.equal(secondSnapshot.state.combatants[0].hp,20)
      assert.equal((await dm.api(`/combatant-library/${id}/state/${second.id}`)).revision,0)
      const npc=await dm.api(`/combatant-library/${randomUUID()}`,{...body,name:'Campaign NPC',kind:'named-npc',campaignId:campaign.id})
      await assert.rejects(command(npc.id,1),/another campaign/)
      await command(monster.id,1)
      assert.equal((await dm.api(secondPath+'/snapshot')).state.combatants.length,2)
    })
    await t.test('template changes and archive leave encounter snapshots intact',async()=>{
      monster=await dm.api(`/combatant-library/${monster.id}`,{...body,name:'Goblin updated',kind:'monster-template',revision:monster.revision,definition:{...original,maxHp:40,ac:30},archived:true})
      assert.equal(dm.snapshot!.state.combatants.find(c=>String(c.id)===firstMonster)!.maxHp,20)
      await dm.command(add(monster.id),false)
      monster=await dm.api(`/combatant-library/${monster.id}`,{...body,name:'Goblin restored',kind:'monster-template',revision:monster.revision,definition:{...original,maxHp:40,ac:30},archived:false})
    })
    await t.test('same character in another encounter uses saved or full state; multi-floor placement stays exact',async()=>{
      const next=await dm.api(path+'/encounters',{name:'Second'},201);await waitFor(()=>dm.snapshot!.encounterId===next.id)
      await dm.command({type:'map.blank',id:'test-map',name:'Tower',width:12,height:10})
      await dm.command({type:'map.level.add',id:'upper',name:'Upper',elevationFeet:25,width:12,height:10})
      await dm.command(add(id,{floorId:'upper',destination:{x:7,z:8}}))
      const c=dm.snapshot!.state.combatants[0];assert.equal(c.hp,6);assert.equal(c.maxHp,23);assert.equal(c.floorId,'upper');assert.equal(c.unplaced,false);assert.deepEqual(dm.snapshot!.state.battleMap.tokens[String(c.id)],{x:7,z:8});assert.deepEqual(c.miniature,appearance)
      await dm.command(add(id,{allowDuplicate:true,useSavedState:false}));assert.equal(dm.snapshot!.state.combatants[1].hp,20)
      await dm.command(add(monster.id,{floorId:'upper',destination:{x:12,z:0}}),false)
      assert.equal((await pool.query('SELECT data FROM combatants WHERE encounter_id=$1 AND id=$2',[encounter.id,heroInstance])).rows[0].data.hp,2)
    })
    await t.test('deleted and missing models allow creation using placeholder',async()=>{
      const disposable=await dm.upload('Disposable'),entryId=randomUUID()
      await dm.api(`/combatant-library/${entryId}`,{...body,name:'Missing model',kind:'monster-template',definition:{...original,miniature:{...appearance,assetId:disposable.id}}})
      await dm.api(`/assets/${disposable.id}/delete`,{revision:1})
      await dm.command(add(entryId));assert.equal(dm.snapshot!.state.combatants.find(c=>c.sourceLibraryId===entryId)!.miniature!.assetId,null)
      await pool.query("UPDATE combatant_library SET definition=jsonb_set(definition,'{miniature,assetId}',to_jsonb($2::text)) WHERE id=$1",[entryId,randomUUID()])
      await dm.command(add(entryId));assert.equal(dm.snapshot!.state.combatants.at(-1)!.miniature!.assetId,null)
    })
    await t.test('application restart, migrations and database reload retain library, states and legacy encounters',async()=>{
      const before=await dm.api('/combatant-library');for(const c of clients)c.socket?.disconnect()
      await app.close();await migrate(pool);app=createApplication(options);await new Promise<void>(r=>app.http.listen(Number(new URL(base).port),'127.0.0.1',r))
      assert.deepEqual(await dm.api('/combatant-library'),before)
      assert.equal((await dm.api(`/combatant-library/${id}/state/${campaign.id}`)).state.hp,6)
      await dm.connect(campaign.id);assert.equal(dm.snapshot!.state.combatants[0].hp,6)
      await dm.api(path+'/open',{encounterId:encounter.id})
      await waitFor(()=>dm.snapshot!.encounterId===encounter.id);assert.equal(dm.snapshot!.state.combatants.find(c=>c.id==='old')!.hp,8)
    })
  }finally{for(const c of clients)c.socket?.disconnect();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await rm(root,{recursive:true,force:true})}
})
