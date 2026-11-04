import {dungeonLevels} from '../../shared/dungeon.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {AddressInfo} from 'node:net'
import pg from 'pg'
import {io,type Socket} from 'socket.io-client'
import {createApplication} from '../app.ts'
import {migrate} from '../migrate.ts'
import {FilesystemAssetStorage} from '../asset-storage.ts'
import {recoverFloorImages} from '../floor-images.ts'
import {floorImageSchema} from '../../shared/floor-image.ts'
import {mergeMapSnapshot,type GameCommand,type Snapshot,type CommandResult,type ClientEvents,type ServerEvents} from '../../shared/domain.ts'
import {makeFloorImage} from '../../test-fixtures/floor-image.ts'
import {repeatingTextureSchema} from '../../shared/floor-surface.ts'
const origin='http://localhost:5173'
async function waitFor(condition:()=>boolean){const end=Date.now()+8000;while(!condition()){if(Date.now()>end)throw Error('Image snapshot did not converge');await new Promise(resolve=>setTimeout(resolve,20))}}
class Client{
  cookie='';csrf='';snapshot:Snapshot|null=null;socket?:Socket<ServerEvents,ClientEvents>
  constructor(public base:string){}
  async api(path:string,body?:unknown,status=200){
    const response=await fetch(this.base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:this.cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':this.csrf},body:body===undefined?undefined:JSON.stringify(body)})
    const cookies=response.headers.getSetCookie();if(cookies.length)this.cookie=cookies.map(c=>c.split(';')[0]).join('; ')
    const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));if(data.csrf)this.csrf=data.csrf;return data
  }
  async upload(bytes:Uint8Array,filename='map.png',status=201,csrf=this.csrf,metadata:unknown={}){
    const data=new FormData();data.set('metadata',JSON.stringify(metadata));data.set('file',new Blob([new Uint8Array(bytes)]),filename)
    const response=await fetch(this.base+'/api/floor-images',{method:'POST',headers:{Cookie:this.cookie,Origin:origin,'X-CSRF-Token':csrf},body:data})
    const image=await response.json();assert.equal(response.status,status,JSON.stringify(image));return image
  }
  async file(imageId:string,campaignId?:string,encounterId?:string,status=200){
    const query=campaignId?`?campaignId=${campaignId}&encounterId=${encounterId}`:''
    const response=await fetch(this.base+`/api/floor-images/${imageId}/file${query}`,{headers:{Cookie:this.cookie}})
    assert.equal(response.status,status);return response
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
import {terrainBrushSchema,type TerrainStroke} from '../../shared/terrain.ts'
test('terrain strokes reuse authoritative map transactions, asset grants and permitted snapshots',{timeout:90000},async t=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='terrain_'+randomUUID().replaceAll('-',''),directory=await mkdtemp(join(tmpdir(),'ledger-terrain-'));await admin.query(`CREATE SCHEMA ${schema}`)
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`}),storage=new FilesystemAssetStorage(directory),options={pool,assetStorage:storage,origin,secret:'terrain-integration-secret-'.repeat(3)};let app=createApplication(options);const clients:Client[]=[]
 try{
  await migrate(pool);await new Promise<void>(r=>app.http.listen(0,'127.0.0.1',r));const port=(app.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`
  for(let i=0;i<4;i++){const client=new Client(base);await client.api('/session');clients.push(client)}const[dm,player,other,late]=clients
  for(const c of [dm,other])await c.api('/auth/register',{email:randomUUID()+'@example.test',password:'Terrain Secure Password 2049!'},201)
  const campaign=await dm.api('/campaigns',{name:'Terrain'},201),path='/campaigns/'+campaign.id,invite=await dm.api(path+'/invitations',{},201);await player.api('/invitations/redeem',{token:invite.url.split('#invite=')[1],displayName:'Terrain player'},201)
  const encounter=await dm.api(path+'/encounters',{name:'Paint',file:{version:1,round:4,combatants:[]}},201);await dm.api(path+'/session',{active:true});await Promise.all([dm.connect(campaign.id),player.connect(campaign.id)])
  const bytes=await makeFloorImage('png',256,128),asset=await dm.upload(bytes,'mud.png',201,dm.csrf,{name:'Mud tile',kind:'texture'}),foreign=await other.upload(bytes,'private.png',201,other.csrf,{kind:'texture'}),image=floorImageSchema.parse({imageId:asset.id,scale:1.5,rotation:90,offsetX:2}),texture=repeatingTextureSchema.parse({assetId:asset.id}),brush=terrainBrushSchema.parse({size:3,opacity:.65,softness:.8})
  const paint=(assetId=asset.id):TerrainStroke=>({id:randomUUID(),kind:'paint',points:[{x:2,z:3},{x:5,z:4},{x:8,z:3}],brush,texture:{...texture,assetId}})
  await dm.command({type:'map.blank',id:'terrain',name:'Terrain',width:30,height:20});await dm.command({type:'map.floorImage.set',image,width:30,height:20});await dm.command({type:'map.floorSurface.set',surface:{mode:'texture',texture:{...texture,assetId:'builtin:grass'}}})
  let original:TerrainStroke
  await t.test('one continuous gesture commits one revision and preserves the base/calibration/round',async()=>{
   original=paint();const before=dm.snapshot!.revision;await dm.command({type:'map.terrain.stroke',stroke:original});assert.equal(dm.snapshot!.revision,before+1);await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision);assert.deepEqual(player.snapshot!.state.dungeonMap!.terrainPaint,[original]);assert.deepEqual(dm.snapshot!.state.dungeonMap!.floorImage,image);assert.equal(dm.snapshot!.state.round,4);assert.equal(dm.snapshot!.state.battleMap.width,30);await player.file(asset.id,campaign.id,encounter.id)
   await player.command({type:'map.terrain.stroke',stroke:paint()},false);await player.command({type:'map.terrain.clear'},false);await dm.command({type:'map.terrain.stroke',stroke:paint(foreign.id)},false);assert.equal(dm.snapshot!.state.dungeonMap!.terrainPaint!.length,1)
  })
  await t.test('opacity, erase, clear and history preserve complete independent strokes',async()=>{
   await dm.command({type:'map.terrain.stroke',stroke:paint('builtin:sand')});const erase:TerrainStroke={id:randomUUID(),kind:'erase',points:[{x:4,z:4}],brush:{...brush,opacity:.5}};await dm.command({type:'map.terrain.stroke',stroke:erase});await dm.command({type:'map.undo'});assert.equal(dm.snapshot!.state.dungeonMap!.terrainPaint!.length,2);await dm.command({type:'map.redo'});assert.deepEqual(dm.snapshot!.state.dungeonMap!.terrainPaint![2],erase)
   await dm.command({type:'map.terrain.clear'});assert.equal(dm.snapshot!.state.dungeonMap!.terrainPaint,undefined);await player.file(asset.id,campaign.id,encounter.id,404);await dm.command({type:'map.undo'});assert.equal(dm.snapshot!.state.dungeonMap!.terrainPaint!.length,3)
  })
  let saved:{id:string;revision:number}
  await t.test('templates, history and floor copies protect assets without exposing hidden terrain',async()=>{
   saved=await dm.api(path+'/maps',{name:'Paint template',encounterId:encounter.id,encounterRevision:dm.snapshot!.revision},201);await dm.api(`/floor-images/${asset.id}/delete`,{revision:asset.revision},409)
   await dm.command({type:'map.level.duplicate',id:'ground',newId:'upper',name:'Secret painted office',elevationFeet:15});const upper=dungeonLevels(dm.snapshot!.state.dungeonMap!)[1];assert.equal(upper.terrainPaint!.length,3);assert.equal(upper.elevationFeet,15)
   await dm.command({type:'map.terrain.clear',levelId:'upper'});assert.equal(dm.snapshot!.state.dungeonMap!.terrainPaint!.length,3);const hiddenAsset=await dm.upload(await makeFloorImage('png',128,256),'hidden.png',201,dm.csrf,{kind:'texture'});await dm.command({type:'map.terrain.stroke',levelId:'upper',stroke:paint(hiddenAsset.id)});await player.file(hiddenAsset.id,campaign.id,encounter.id,404);await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision);assert.equal(JSON.stringify(player.snapshot!.state).includes('Secret painted office'),false)
   await dm.command({type:'map.level.update',id:'upper',name:'Office',elevationFeet:15,playerVisible:true});await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision);assert.equal(dungeonLevels(player.snapshot!.state.dungeonMap!)[1].terrainPaint![0].kind,'paint');await player.file(hiddenAsset.id,campaign.id,encounter.id)
   await dm.command({type:'map.level.remove',id:'upper'});await dm.file(asset.id);await dm.command({type:'map.undo'});assert.equal(dungeonLevels(dm.snapshot!.state.dungeonMap!).length,2)
  })
  await t.test('stale concurrent commands fail atomically while committed changes remain coherent',async()=>{
   const revision=dm.snapshot!.revision;await dm.command({type:'map.terrain.stroke',stroke:paint('builtin:stone')});const before=dm.snapshot!.state.dungeonMap!.terrainPaint!.length,result=await new Promise<CommandResult>(resolve=>dm.socket!.emit('game.command',{commandId:randomUUID(),encounterId:encounter.id,revision,command:{type:'map.terrain.stroke',stroke:paint()}},resolve));assert.equal(result.ok,false);assert.equal(dm.snapshot!.state.dungeonMap!.terrainPaint!.length,before)
  })
  await t.test('save/reload, export/import, late join and restart retain terrain and asset grants',async()=>{
   const file=await dm.api(path+'/export');const next=await dm.api(path+'/encounters',{name:'Reloaded terrain',file},201);for(const c of [dm,player])c.socket?.disconnect();await Promise.all([dm.connect(campaign.id),player.connect(campaign.id)]);assert.equal(dm.snapshot!.encounterId,next.id);assert.deepEqual(dm.snapshot!.state.dungeonMap!.terrainPaint,file.dungeonMap.terrainPaint)
   const invitation=await dm.api(path+'/invitations',{},201);await late.api('/invitations/redeem',{token:invitation.url.split('#invite=')[1],displayName:'Late terrain player'},201);await late.connect(campaign.id);assert.deepEqual(late.snapshot!.state.dungeonMap!.terrainPaint,file.dungeonMap.terrainPaint)
   for(const c of clients)c.socket?.disconnect();await app.close();await recoverFloorImages(pool,storage);app=createApplication(options);await new Promise<void>(r=>app.http.listen(port,'127.0.0.1',r));await Promise.all([dm.connect(campaign.id),player.connect(campaign.id)]);await player.file(asset.id,campaign.id,next.id);assert.deepEqual(dm.snapshot!.state.dungeonMap!.floorImage,image)
  })
  await t.test('missing imported paint falls back without granting private files; direct paint still validates',async()=>{
   const file=await dm.api(path+'/export'),missing=randomUUID();file.dungeonMap.terrainPaint=[paint(missing)];await dm.api(path+'/encounters',{name:'Missing terrain',file},201);dm.socket?.disconnect();await dm.connect(campaign.id);await dm.file(missing,undefined,undefined,404);await dm.command({type:'map.terrain.stroke',stroke:paint(missing)},false)
   await dm.api(path+`/maps/${saved.id}/delete`,{revision:saved.revision})
  })
 }finally{for(const c of clients)c.socket?.disconnect();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await rm(directory,{recursive:true,force:true})}
})
