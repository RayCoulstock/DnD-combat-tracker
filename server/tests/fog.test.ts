import {makeTexturedGlb} from '../../test-fixtures/glb.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {AddressInfo} from 'node:net'
import pg from 'pg'
import {io,type Socket} from 'socket.io-client'
import sharp from 'sharp'
import {createApplication} from '../app.ts'
import {migrate} from '../migrate.ts'
import {FilesystemAssetStorage} from '../asset-storage.ts'
import {mergeMapSnapshot,type GameCommand,type Snapshot,type CommandResult,type ClientEvents,type ServerEvents} from '../../shared/domain.ts'
import {fullMask} from '../../shared/fog.ts'
import {floorImageSchema} from '../../shared/floor-image.ts'
const origin='http://localhost:5173'
async function waitFor(predicate:()=>boolean){const until=Date.now()+10000;while(!predicate()){if(Date.now()>until)throw Error('Fog snapshot did not converge');await new Promise(r=>setTimeout(r,20))}}
class Client{
 cookie='';csrf='';snapshot:Snapshot|null=null;socket?:Socket<ServerEvents,ClientEvents>;omitted=0
 constructor(public base:string){}
 async api(path:string,body?:unknown,status=200){const response=await fetch(this.base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:this.cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':this.csrf},body:body===undefined?undefined:JSON.stringify(body)});const cookies=response.headers.getSetCookie();if(cookies.length)this.cookie=cookies.map(c=>c.split(';')[0]).join('; ');const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));if(data.csrf)this.csrf=data.csrf;return data}
 async connect(campaignId:string){this.socket?.disconnect();this.snapshot=null;this.socket=io(this.base,{transports:['websocket'],extraHeaders:{Cookie:this.cookie,Origin:origin},auth:{csrf:this.csrf},reconnection:false});this.socket.on('session.state',s=>{if(s.snapshot){if(s.snapshot.mapDocumentOmitted)this.omitted++;this.snapshot=mergeMapSnapshot(this.snapshot,s.snapshot)}});this.socket.on('connect',()=>this.socket!.emit('campaign.join',campaignId,()=>{}));await waitFor(()=>Boolean(this.snapshot))}
 async command(command:GameCommand,allowed=true){const current=this.snapshot!,result=await new Promise<CommandResult>(resolve=>this.socket!.emit('game.command',{commandId:randomUUID(),encounterId:current.encounterId,revision:current.revision,command},resolve));assert.equal(result.ok,allowed,JSON.stringify(result));if(result.ok)await waitFor(()=>this.snapshot!.revision>=result.revision);return result}
}
test('fog authorization, masked media, ordered snapshots, tracker compatibility, restart and reconnect',{timeout:90000},async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='fog_'+randomUUID().replaceAll('-',''),directory=await mkdtemp(join(tmpdir(),'ledger-fog-'));await admin.query(`CREATE SCHEMA ${schema}`)
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`}),options={pool,assetStorage:new FilesystemAssetStorage(directory),origin,secret:'fog-integration-secret-'.repeat(4)}
 let app=createApplication(options);const clients:Client[]=[]
 try{
  await migrate(pool);await new Promise<void>(r=>app.http.listen(0,'127.0.0.1',r));const port=(app.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`
  for(let i=0;i<3;i++){const c=new Client(base);await c.api('/session');clients.push(c)}const[dm,player,late]=clients
  await dm.api('/auth/register',{email:randomUUID()+'@example.test',password:'Fog Authorization Password 2049!'},201)
  const campaign=await dm.api('/campaigns',{name:'Warehouse fog'},201),path='/campaigns/'+campaign.id
  for(const c of [player,late]){const invite=await dm.api(path+'/invitations',{},201);await c.api('/invitations/redeem',{token:invite.url.split('#invite=')[1],displayName:'Fog player'},201)}
  const encounter=await dm.api(path+'/encounters',{name:'Warehouse',file:{version:1,round:4,combatants:[{id:'hero',name:'Tracker hero',side:'hero',hp:12,maxHp:12,ac:12,initiative:14,conditions:[],actions:[],saves:[]}]}},201)
  await dm.api(path+'/session',{active:true});await Promise.all([dm.connect(campaign.id),player.connect(campaign.id)])
  const png=await sharp({create:{width:64,height:64,channels:4,background:'#dd4400'}}).png().toBuffer(),form=new FormData();form.set('metadata','{}');form.set('file',new Blob([png]),'warehouse.png')
  const uploaded=await fetch(base+'/api/floor-images',{method:'POST',headers:{Cookie:dm.cookie,Origin:origin,'X-CSRF-Token':dm.csrf},body:form});assert.equal(uploaded.status,201);const asset=await uploaded.json()
  await dm.command({type:'map.blank',id:'warehouse',name:'Warehouse',width:8,height:8});await dm.command({type:'map.floorImage.set',width:8,height:8,image:floorImageSchema.parse({imageId:asset.id})})
  const modelForm=new FormData();modelForm.set('metadata',JSON.stringify({name:'Tall concealed model',category:'decoration'}));modelForm.set('file',new Blob([new Uint8Array(await makeTexturedGlb())]),'tall.glb')
  const modelUpload=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:dm.cookie,Origin:origin,'X-CSRF-Token':dm.csrf},body:modelForm});assert.equal(modelUpload.status,201);const model=await modelUpload.json()
  await dm.command({type:'map.scenery.place',prop:{id:'tall-secret',type:'asset',assetId:model.id,label:'Tall concealed model',category:'decoration',position:{x:2,z:2},rotation:0,scale:20,verticalOffset:20,visible:true}})
  const modelFile=`${base}/api/assets/${model.id}/file?campaignId=${campaign.id}&encounterId=${encounter.id}`
  const file=`${base}/api/floor-images/${asset.id}/file?campaignId=${campaign.id}&encounterId=${encounter.id}`
  assert.equal((await fetch(file,{headers:{Cookie:player.cookie}})).status,200)
  const combat=dm.snapshot!.state.combatants,round=dm.snapshot!.state.round
  await dm.command({type:'map.fog.enabled',enabled:true});await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision)
  assert.deepEqual(dm.snapshot!.state.combatants,combat);assert.equal(dm.snapshot!.state.round,round)
  assert.equal(player.snapshot!.state.combatants[0].name,'Tracker hero');assert.deepEqual(player.snapshot!.state.battleMap.tokens,{})
  await player.command({type:'map.fog.enabled',enabled:false},false);await player.command({type:'map.fog.reset',confirmed:true},false);await player.command({type:'map.fog.mask',levelId:'ground',mask:fullMask(8,8)},false)
  assert.equal((await fetch(file,{headers:{Cookie:player.cookie}})).status,404)
  assert.equal((await fetch(modelFile,{headers:{Cookie:player.cookie}})).status,404);assert.equal(JSON.stringify(player.snapshot!.state).includes('Tall concealed model'),false)
  const masked=await fetch(file+'&fogFloor=ground&fogRevision=0',{headers:{Cookie:player.cookie}});assert.equal(masked.status,200);assert.ok((await sharp(Buffer.from(await masked.arrayBuffer())).raw().toBuffer()).every(b=>b===0))
  assert.equal((await fetch(file+'&fogFloor=missing&fogRevision=0',{headers:{Cookie:player.cookie}})).status,404)
  // Deliberately reveal only the west half of each raster row.
  const mask=Array.from({length:32},()=> 'f'.repeat(4)+'0'.repeat(4)).join('')
  await dm.command({type:'map.fog.mask',levelId:'ground',mask,expectedMask:''});await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision)
  const oldMapRevision=dm.snapshot!.state.mapRevision!
  await dm.command({type:'map.floor.paint',cells:[{x:1,z:1}],material:'wood'})
  const stale=await dm.command({type:'map.fog.mask',levelId:'ground',mask:fullMask(8,8),expectedMask:mask,expectedMapRevision:oldMapRevision},false)
  if(!stale.ok)assert.equal(stale.error.code,'CONFLICT')
  const guardedRevision=dm.snapshot!.revision
  await dm.command({type:'map.fog.mask',levelId:'ground',mask:fullMask(8,8),expectedMask:''},false)
  assert.equal(dm.snapshot!.revision,guardedRevision);assert.equal(dm.snapshot!.state.dungeonMap!.fogOfWar!.floors.ground,mask)
  await player.command({type:'map.fog.mask',levelId:'ground',mask:fullMask(8,8),expectedMask:mask},false)
  const partial=await fetch(file+'&fogFloor=ground&fogRevision=1',{headers:{Cookie:player.cookie}}),pixels=await sharp(Buffer.from(await partial.arrayBuffer())).raw().toBuffer()
  assert.equal(pixels[3],255);assert.equal(pixels[(127)*4+3],0)
  const a=dm.snapshot!.revision;await dm.command({type:'map.fog.mask',levelId:'ground',mask:fullMask(8,8)});await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision);assert.equal((await fetch(modelFile,{headers:{Cookie:player.cookie}})).status,200);await dm.command({type:'map.fog.reset',confirmed:true});await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision);assert.ok(dm.snapshot!.revision>a);assert.deepEqual(player.snapshot!.state.battleMap.tokens,{})
  await late.connect(campaign.id);assert.deepEqual(late.snapshot!.state.dungeonMap,player.snapshot!.state.dungeonMap)
  assert.equal(player.omitted,0)
  const saved=dm.snapshot!.state.dungeonMap;for(const c of clients)c.socket?.disconnect();await app.close();app=createApplication(options);await new Promise<void>(r=>app.http.listen(port,'127.0.0.1',r));await Promise.all([dm.connect(campaign.id),player.connect(campaign.id)])
  assert.deepEqual(dm.snapshot!.state.dungeonMap,saved);assert.deepEqual(player.snapshot!.state.battleMap.tokens,{})
  assert.deepEqual((await dm.api(path+'/export')).dungeonMap.fogOfWar,saved!.fogOfWar)
 }finally{for(const c of clients)c.socket?.disconnect();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await rm(directory,{recursive:true,force:true})}
})
