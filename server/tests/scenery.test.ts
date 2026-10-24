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
import { scenerySchema, isScenery } from '../../shared/scenery.ts'
import {calibrationSchema} from '../../shared/architecture.ts'
import { blankDungeon, canonicalWall } from '../../shared/dungeon.ts'
import { importEncounter, mergeMapSnapshot, type GameCommand, type Snapshot, type ClientEvents, type ServerEvents, type CommandResult } from '../../shared/domain.ts'
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
    this.socket.on('session.state',s=>{if(s.snapshot){const merged=mergeMapSnapshot(this.snapshot,s.snapshot);if(merged)this.snapshot=merged}})
    this.socket.on('connect',()=>this.socket!.emit('campaign.join',campaignId,()=>{})); await waitFor(()=>Boolean(this.snapshot))
  }
  async command(command: GameCommand, accepted=true) {
    const previous=this.snapshot!
    const result=await new Promise<CommandResult>(r=>this.socket!.emit('game.command',{commandId:randomUUID(),encounterId:previous.encounterId,revision:previous.revision,command},r))
    assert.equal(result.ok,accepted,JSON.stringify(result)); if(result.ok) await waitFor(()=>this.snapshot!.revision>=result.revision);return result
  }
  async file(id:string,campaignId:string,encounterId:string,status=200) {const res=await fetch(`${this.base}/api/assets/${id}/file?campaignId=${campaignId}&encounterId=${encounterId}`,{headers:{Cookie:this.cookie}});assert.equal(res.status,status,await(res.status===200?Promise.resolve(''):res.text()));return res}
}
test('custom scenery uses existing map transactions, snapshots, templates and scoped assets', {timeout:90000}, async t=>{
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='scenery_'+randomUUID().replaceAll('-',''),root=await mkdtemp(join(tmpdir(),'scenery-'))
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`}),storage=new FilesystemAssetStorage(root)
  const options={pool,assetStorage:storage,origin,secret:'scenery-integration-secret-'.repeat(3)}
  let app=createApplication(options);const clients:Client[]=[]
  try{
    await migrate(pool);await new Promise<void>(r=>app.http.listen(0,'127.0.0.1',r));const port=(app.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`
    for(let i=0;i<5;i++){const c=new Client(base);await c.api('/session');clients.push(c)}
    const[dm,p1,p2,other,outsider]=clients
    for(const c of[dm,other])await c.api('/auth/register',{email:randomUUID()+'@example.test',password:'Scenery Secure Password 2049!'},201)
    const campaign=await dm.api('/campaigns',{name:'Scenery'},201),path=`/campaigns/${campaign.id}`,otherCampaign=await other.api('/campaigns',{name:'Private'},201)
    for(const[c,owner,camp]of[[p1,dm,campaign],[p2,dm,campaign],[outsider,other,otherCampaign]]as const){const invite=await owner.api(`/campaigns/${camp.id}/invitations`,{},201);await c.api('/invitations/redeem',{token:invite.url.split('#invite=')[1],displayName:'Player'},201)}
    const file={version:1,round:1,combatants:[{id:1,name:'Hero',side:'hero',hp:10,maxHp:10,ac:15,initiative:10,conditions:[],saves:[],actions:[]}]}
    const encounter=await dm.api(path+'/encounters',{name:'Furnished',file},201);await dm.api(path+'/session',{active:true});await Promise.all([dm.connect(campaign.id),p1.connect(campaign.id),p2.connect(campaign.id)])
    const asset=await dm.upload('Barrel'),hidden=await dm.upload('Hidden crate'),foreign=await other.upload('Private scenery')
    const prop=scenerySchema.parse({id:'custom',type:'asset',assetId:asset.id,label:'Barrel',category:'furniture',position:{x:2,z:3},rotation:0,scale:1,verticalOffset:0,visible:true})
    await dm.command({type:'map.blank',id:'map',name:'Furnished',width:20,height:20})
    let template:{id:string;revision:number},duplicate:{id:string;revision:number},second:{id:string}
    await t.test('DM placements broadcast to both players; invalid, unauthorised and stale commands reject',async()=>{
      await dm.command({type:'map.prop.place',prop:{id:'builtin',type:'crate',position:{x:1,z:1},rotation:0}})
      const prior=dm.snapshot!
      await dm.command({type:'map.scenery.place',prop});await waitFor(()=>p1.snapshot!.revision===dm.snapshot!.revision&&p2.snapshot!.revision===dm.snapshot!.revision)
      assert.equal(p1.snapshot!.state.dungeonMap!.schemaVersion,2);assert.equal(p2.snapshot!.state.dungeonMap!.props.length,2)
      const stale=await new Promise<CommandResult>(r=>dm.socket!.emit('game.command',{commandId:randomUUID(),encounterId:encounter.id,revision:prior.revision,command:{type:'map.scenery.remove',propId:prop.id}},r));assert.equal(stale.ok,false)
      await p1.command({type:'map.scenery.place',prop:{...prop,id:'forbidden'}},false)
      await p1.command({type:'map.scenery.remove',propId:prop.id},false)
      await dm.command({type:'map.scenery.place',prop:{...prop,id:'foreign',assetId:foreign.id}},false)
      await dm.command({type:'map.prop.place',prop:{...prop,id:'generic-foreign',assetId:foreign.id}},false)
      await dm.command({type:'map.load',document:{...blankDungeon('foreign-map','Foreign'),schemaVersion:2,props:[{...prop,assetId:foreign.id}]}},false)
      await p1.file(asset.id,campaign.id,encounter.id);await p2.file(asset.id,campaign.id,encounter.id)
      await outsider.file(asset.id,campaign.id,encounter.id,404);await p1.file(asset.id,otherCampaign.id,encounter.id,404)
      await dm.command({type:'map.scenery.place',prop:{...prop,id:'hidden',assetId:hidden.id,visible:false}})
      await waitFor(()=>p1.snapshot!.revision===dm.snapshot!.revision)
      assert.equal(p1.snapshot!.state.dungeonMap!.props.some(p=>p.id==='hidden'),false)
      await p1.file(hidden.id,campaign.id,encounter.id,404)
    })
    await t.test('logical architectural visuals validate roles, broadcast door states and preserve edge identity',async()=>{
      const wallAsset=await dm.upload('Wall edge'),doorAsset=await dm.upload('Door panel')
      for(const[asset,role]of[[wallAsset,'wall'],[doorAsset,'door']]as const)await dm.api(`/assets/${asset.id}/update`,{revision:1,metadata:{name:asset.name,category:'architecture',presentation:{architecture:{role}}}})
      assert.equal((await dm.api('/assets?role=wall')).assets[0].id,wallAsset.id)
      const wall=canonicalWall(5,6,'east'),wallVisual={assetId:wallAsset.id,calibration:calibrationSchema.parse({facing:'+X',scale:1.1})},doorVisual={assetId:doorAsset.id,calibration:calibrationSchema.parse({verticalOffset:.1})}
      await dm.command({type:'map.wall.place',wall:{...wall,visual:wallVisual}})
      await waitFor(()=>p2.snapshot!.revision===dm.snapshot!.revision)
      assert.equal(p2.snapshot!.state.dungeonMap!.schemaVersion,3);assert.deepEqual(p2.snapshot!.state.dungeonMap!.walls[0],{...wall,visual:wallVisual})
      await p1.file(wallAsset.id,campaign.id,encounter.id)
      await p1.command({type:'map.wall.visual',wallId:wall.id,visual:null},false)
      await p1.command({type:'map.door.place',door:{id:'bad-door',wallId:wall.id,state:'closed',visual:doorVisual}},false)
      await dm.command({type:'map.wall.visual',wallId:wall.id,visual:{...wallVisual,assetId:foreign.id}},false)
      await dm.command({type:'map.wall.visual',wallId:wall.id,visual:doorVisual},false)
      await dm.command({type:'map.wall.visual',wallId:wall.id,visual:{...wallVisual,calibration:{...wallVisual.calibration,rotationCorrection:15}}})
      await dm.command({type:'map.undo'});assert.deepEqual(dm.snapshot!.state.dungeonMap!.walls[0].visual,wallVisual)
      await dm.command({type:'map.redo'});assert.equal(dm.snapshot!.state.dungeonMap!.walls[0].id,wall.id)
      await dm.command({type:'map.door.place',door:{id:'custom-door',wallId:wall.id,state:'closed',visual:doorVisual}})
      for(const state of['open','locked','closed']as const){await dm.command({type:'map.door.update',doorId:'custom-door',state});await waitFor(()=>p1.snapshot!.revision===dm.snapshot!.revision);assert.equal(p1.snapshot!.state.dungeonMap!.doors[0].state,state);assert.equal(p1.snapshot!.state.dungeonMap!.doors[0].wallId,wall.id)}
      await p1.file(doorAsset.id,campaign.id,encounter.id);await p1.file(wallAsset.id,campaign.id,encounter.id,404) // opening suppresses wall visual and its current grant
      await outsider.file(doorAsset.id,campaign.id,encounter.id,404)
      await dm.api(`/assets/${doorAsset.id}/delete`,{revision:2},409)
      await dm.command({type:'map.door.visual',doorId:'custom-door',visual:null});await p1.file(doorAsset.id,campaign.id,encounter.id,404)
      await dm.command({type:'map.undo'});await p1.file(doorAsset.id,campaign.id,encounter.id)
      await dm.command({type:'map.wall.remove',wallId:wall.id});assert.equal(dm.snapshot!.state.dungeonMap!.doors.length,0)
      await dm.command({type:'map.undo'});assert.equal(dm.snapshot!.state.dungeonMap!.doors[0].id,'custom-door')
    })
    await t.test('free transforms, visibility, duplicate/delete and undo/redo preserve unrelated combat',async()=>{
      const transform={position:{x:3.25,z:4.5},rotation:123.5,scale:2.4,verticalOffset:.2,visible:true}
      await dm.command({type:'map.scenery.update',propId:prop.id,transform})
      await dm.command({type:'map.scenery.update',propId:prop.id,transform:{...transform,visible:false}})
      await waitFor(()=>p1.snapshot!.revision===dm.snapshot!.revision);await p1.file(asset.id,campaign.id,encounter.id,404)
      await dm.command({type:'map.undo'});await p1.file(asset.id,campaign.id,encounter.id)
      await dm.command({type:'map.redo'});await p1.file(asset.id,campaign.id,encounter.id,404)
      await dm.command({type:'map.undo'});await dm.command({type:'map.scenery.duplicate',propId:prop.id,newId:'copy',position:{x:6,z:6}})
      const original=dm.snapshot!.state.dungeonMap!.props.find(p=>p.id===prop.id)!
      assert.equal(original.position.x,3.25);assert.equal(original.rotation,123.5)
      await dm.command({type:'map.scenery.remove',propId:'copy'})
      await dm.command({type:'combatant.hp.update',combatantId:1,hp:7});await dm.command({type:'token.move',combatantId:1,destination:{x:8,z:8}})
      await dm.command({type:'map.undo'});assert.ok(dm.snapshot!.state.dungeonMap!.props.some(p=>p.id==='copy'));assert.equal(dm.snapshot!.state.combatants[0].hp,7);assert.deepEqual(dm.snapshot!.state.battleMap.tokens['1'],{x:8,z:8})
      await dm.command({type:'map.redo'})
      const exported=await dm.api(path+'/export');assert.deepEqual(importEncounter(exported).dungeonMap,dm.snapshot!.state.dungeonMap)
    })
    await t.test('templates save/duplicate/load/overwrite independently and hold deletion references',async()=>{
      template=await dm.api(path+'/maps',{name:'Reusable scenery',encounterId:encounter.id,encounterRevision:dm.snapshot!.revision},201)
      duplicate=await dm.api(path+`/maps/${template.id}/duplicate`,{revision:1,name:'Duplicate scenery'},201)
      second=await dm.api(path+'/encounters',{name:'Second furnished'},201);await waitFor(()=>dm.snapshot!.encounterId===second.id)
      await dm.command({type:'map.template.load',templateId:duplicate.id});await waitFor(()=>p2.snapshot!.encounterId===second.id)
      assert.ok(p2.snapshot!.state.dungeonMap!.props.some(isScenery));await p1.file(asset.id,campaign.id,second.id)
      await dm.command({type:'map.scenery.update',propId:prop.id,transform:{position:{x:9,z:9},rotation:270,scale:3,verticalOffset:0,visible:true}})
      assert.equal((await dm.api(path+`/maps/${template.id}`)).document.props.find((p:{id:string})=>p.id===prop.id).position.x,3.25)
      const first=(await pool.query('SELECT document FROM encounter_maps WHERE encounter_id=$1',[encounter.id])).rows[0].document
      assert.equal(first.props.find((p:{id:string})=>p.id===prop.id).position.x,3.25)
      await dm.api(path+`/maps/${template.id}/save`,{revision:1,name:'Updated scenery',encounterId:second.id,encounterRevision:dm.snapshot!.revision})
      await dm.api(path+`/maps/${template.id}/rename`,{revision:2,name:'Renamed scenery'});template.revision=3
      await dm.api(`/assets/${asset.id}/delete`,{revision:1},409);await p1.api(path+'/maps',undefined,403)
      assert.equal((await dm.api(path+`/maps/${duplicate.id}`)).document.props.find((p:{id:string})=>p.id===prop.id).position.x,3.25)
    })
    await t.test('late join, reconnect and backend restart recover current scenery and scoped grants',async()=>{
      const late=new Client(base);clients.push(late);await late.api('/session');const invite=await dm.api(path+'/invitations',{},201);await late.api('/invitations/redeem',{token:invite.url.split('#invite=')[1],displayName:'Late'},201);await late.connect(campaign.id)
      assert.ok(late.snapshot!.state.dungeonMap!.props.some(isScenery));await late.file(asset.id,campaign.id,second.id)
      p1.socket!.disconnect();p1.snapshot=null
      await dm.command({type:'map.scenery.update',propId:prop.id,transform:{position:{x:10.2,z:10.5},rotation:45,scale:1.2,verticalOffset:1,visible:true}})
      await p1.connect(campaign.id);assert.equal(p1.snapshot!.state.dungeonMap!.props.find(p=>p.id===prop.id)!.position.x,10.2)
      const saved=dm.snapshot!.state.dungeonMap
      for(const c of clients)c.socket?.disconnect();await app.close();app=createApplication(options);await new Promise<void>(r=>app.http.listen(port,'127.0.0.1',r))
      for(const c of[dm,p1,p2]){c.snapshot=null;await c.connect(campaign.id)}
      assert.deepEqual(dm.snapshot!.state.dungeonMap,saved);await p1.file(asset.id,campaign.id,second.id)
    })
    await t.test('history and template references block deletion without granting historical file access',async()=>{
      await dm.command({type:'map.scenery.remove',propId:prop.id});await p1.file(asset.id,campaign.id,second.id,404)
      const historyRef=(await pool.query('SELECT visible_current FROM encounter_scenery_asset_references WHERE encounter_id=$1 AND asset_id=$2',[second.id,asset.id])).rows[0]
      assert.equal(historyRef.visible_current,false)
      await dm.api(`/assets/${asset.id}/delete`,{revision:1},409)
      await dm.command({type:'map.history.clear'})
      assert.equal((await pool.query('SELECT 1 FROM encounter_scenery_asset_references WHERE encounter_id=$1 AND asset_id=$2',[second.id,asset.id])).rowCount,0)
      for(const id of[encounter.id,second.id]){await dm.api(path+'/open',{encounterId:id});await waitFor(()=>dm.snapshot!.encounterId===id);await dm.command({type:'encounter.restore',file})}
      await dm.api(`/assets/${asset.id}/delete`,{revision:1},409) // Templates alone still hold the GLB.
      await dm.api(path+`/maps/${template.id}/delete`,{revision:template.revision});await dm.api(path+`/maps/${duplicate.id}/delete`,{revision:1})
      await dm.api(`/assets/${asset.id}/delete`,{revision:1})
    })
    await t.test('unknown/private imports remain placeholders and never grant access',async()=>{
      const unknown=randomUUID(),document={...blankDungeon('unknown','Unknown scenery'),schemaVersion:2 as const,props:[{...prop,assetId:unknown},{...prop,id:'foreign',assetId:foreign.id}]}
      await dm.command({type:'encounter.restore',file:{...file,dungeonMap:document}})
      assert.equal(dm.snapshot!.state.dungeonMap!.props.length,2);await p1.file(foreign.id,campaign.id,second.id,404);await p1.file(unknown,campaign.id,second.id,404)
      assert.equal((await pool.query('SELECT 1 FROM encounter_scenery_asset_references WHERE encounter_id=$1',[second.id])).rowCount,0)
      await dm.command({type:'combatant.hp.update',combatantId:1,hp:5})
    })
  }finally{for(const c of clients)c.socket?.disconnect();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await rm(root,{recursive:true,force:true})}
})
