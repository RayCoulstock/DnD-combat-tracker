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
test('floor textures reuse durable image storage with private references and transactional level appearance',{timeout:90000},async t=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='texture_'+randomUUID().replaceAll('-',''),directory=await mkdtemp(join(tmpdir(),'ledger-texture-'));await admin.query(`CREATE SCHEMA ${schema}`)
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`}),storage=new FilesystemAssetStorage(directory),options={pool,assetStorage:storage,origin,secret:'floor-texture-integration-secret-'.repeat(3)};let app=createApplication(options);const clients:Client[]=[]
 try{
  await migrate(pool);await migrate(pool);await new Promise<void>(r=>app.http.listen(0,'127.0.0.1',r));const port=(app.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`
  for(let i=0;i<5;i++){const client=new Client(base);await client.api('/session');clients.push(client)}const[dm,player,other,late,anon]=clients
  for(const c of [dm,other])await c.api('/auth/register',{email:randomUUID()+'@example.test',password:'Texture Secure Password 2049!'},201)
  const campaign=await dm.api('/campaigns',{name:'Warehouse textures'},201),path='/campaigns/'+campaign.id,invite=await dm.api(path+'/invitations',{},201);await player.api('/invitations/redeem',{token:invite.url.split('#invite=')[1],displayName:'Texture player'},201)
  const encounter=await dm.api(path+'/encounters',{name:'Warehouse',file:{version:1,round:3,combatants:[]}},201);await dm.api(path+'/session',{active:true});await Promise.all([dm.connect(campaign.id),player.connect(campaign.id)])
  const bytes=await makeFloorImage('png',256,128),asset=await dm.upload(bytes,'tile.png',201,dm.csrf,{name:'Warehouse stone',kind:'texture'}),foreign=await other.upload(bytes,'tile.png',201,other.csrf,{name:'Private wood',kind:'texture'}),image=floorImageSchema.parse({imageId:asset.id,offsetX:2,rotation:90,scale:1.5,showGrid:false}),texture=repeatingTextureSchema.parse({assetId:asset.id,repeatEverySquares:2,rotation:270,brightness:.7,tint:'#aaccee',offsetX:.25})
  await t.test('named image assets validate formats, ownership and retry-safe normalized pixels',async()=>{
   assert.equal(asset.kind,'texture');assert.equal(asset.width,256);assert.equal((await dm.upload(bytes,'retry.png',201,dm.csrf,{name:'Warehouse stone',kind:'texture'})).id,asset.id)
   await dm.upload(Buffer.from('not png'),'invalid.png',400,dm.csrf,{kind:'texture'});await player.upload(bytes,'tile.png',403,player.csrf,{kind:'texture'});await anon.upload(bytes,'tile.png',401,anon.csrf,{kind:'texture'})
   await player.api('/floor-images',undefined,403);await other.file(asset.id,undefined,undefined,404)
  })
  await dm.command({type:'map.blank',id:'warehouse',name:'Warehouse',width:30,height:10});await dm.command({type:'map.floorImage.set',image,width:30,height:10})
  await t.test('surface edits retain calibration/geometry and synchronize one permitted map revision',async()=>{
   const revision=dm.snapshot!.revision;await dm.command({type:'map.floorSurface.set',surface:{mode:'texture',texture}});assert.equal(dm.snapshot!.revision,revision+1);await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision)
   assert.deepEqual(player.snapshot!.state.dungeonMap!.floorSurface,{mode:'texture',texture});assert.deepEqual(dm.snapshot!.state.dungeonMap!.floorImage,image);assert.equal(dm.snapshot!.state.battleMap.width,30);assert.equal(dm.snapshot!.state.round,3)
   await player.file(asset.id,campaign.id,encounter.id);await player.command({type:'map.floorSurface.set',surface:{mode:'solid'}},false)
   await dm.command({type:'map.floorSurface.set',surface:{mode:'texture',texture:{...texture,assetId:foreign.id}}},false)
   const renamed=await dm.api(`/floor-images/${asset.id}/metadata`,{name:'Reusable stone',revision:(await dm.api('/floor-images')).images.find((i:{id:string})=>i.id===asset.id).revision});assert.equal(renamed.name,'Reusable stone');assert.equal(dm.snapshot!.state.dungeonMap!.floorSurface!.texture!.assetId,asset.id)
   await other.api(`/floor-images/${asset.id}/metadata`,{name:'Stolen',revision:renamed.revision},409)
  })
  let template:{id:string;revision:number}
  await t.test('inactive settings/history/templates protect assets without granting inactive downloads',async()=>{
   await dm.command({type:'map.floorSurface.set',surface:{mode:'solid',texture,solidColor:'#123456'}});await player.file(asset.id,campaign.id,encounter.id,404)
   await dm.api(`/floor-images/${asset.id}/delete`,{revision:(await dm.api('/floor-images')).images.find((i:{id:string})=>i.id===asset.id).revision},409)
   template=await dm.api(path+'/maps',{name:'Textured warehouse',encounterId:encounter.id,encounterRevision:dm.snapshot!.revision},201);assert.deepEqual((await dm.api(path+`/maps/${template.id}`)).document.floorImage,image)
   await dm.command({type:'map.undo'});assert.equal(dm.snapshot!.state.dungeonMap!.floorSurface!.mode,'texture');await dm.command({type:'map.redo'});assert.equal(dm.snapshot!.state.dungeonMap!.floorSurface!.mode,'solid')
  })
  await t.test('independent elevated/hidden levels and copies retain material references without leaks',async()=>{
   await dm.command({type:'map.level.duplicate',id:'ground',newId:'office',name:'Private office',elevationFeet:15});await dm.command({type:'map.floorSurface.set',levelId:'office',surface:{mode:'texture',texture:{...texture,assetId:'builtin:wood',rotation:90}}});assert.equal(dungeonLevels(dm.snapshot!.state.dungeonMap!)[1].elevationFeet,15)
   await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision);assert.equal(JSON.stringify(player.snapshot!.state).includes('Private office'),false);assert.equal(dungeonLevels(player.snapshot!.state.dungeonMap!).length,1)
   await dm.command({type:'map.level.update',id:'office',name:'Office',elevationFeet:15,playerVisible:true});await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision);assert.equal(dungeonLevels(player.snapshot!.state.dungeonMap!)[1].floorSurface!.texture!.assetId,'builtin:wood')
   await dm.command({type:'map.level.remove',id:'office'});await dm.file(asset.id);await dm.command({type:'map.undo'});assert.equal(dungeonLevels(dm.snapshot!.state.dungeonMap!).length,2)
  })
  await t.test('reuse on another map, import/export, late join, reconnect and backend restart persist',async()=>{
   const exported=await dm.api(path+'/export');assert.deepEqual(exported.dungeonMap.floorSurface.texture,texture)
   const second=await dm.api(path+'/encounters',{name:'Second map',file:exported},201);await dm.connect(campaign.id);assert.equal(dm.snapshot!.encounterId,second.id);assert.equal(dm.snapshot!.state.dungeonMap!.floorSurface!.texture!.assetId,asset.id)
   const invitation=await dm.api(path+'/invitations',{},201);await late.api('/invitations/redeem',{token:invitation.url.split('#invite=')[1],displayName:'Late texture player'},201);await late.connect(campaign.id);assert.deepEqual(late.snapshot!.state.dungeonMap!.floorSurface,dm.snapshot!.state.dungeonMap!.floorSurface)
   for(const c of clients)c.socket?.disconnect();await app.close();await recoverFloorImages(pool,storage);app=createApplication(options);await new Promise<void>(r=>app.http.listen(port,'127.0.0.1',r));await Promise.all([dm.connect(campaign.id),player.connect(campaign.id)]);assert.deepEqual(dm.snapshot!.state.dungeonMap!.floorImage,image);assert.equal((await dm.api('/floor-images')).images.find((i:{id:string})=>i.id===asset.id).name,'Reusable stone')
   await dm.api(path+`/maps/${template.id}/delete`,{revision:template.revision})
  })
  await t.test('unresolved imported textures remain valid but media still requires an owned asset',async()=>{
   const missing=randomUUID(),file=await dm.api(path+'/export');file.dungeonMap.floorSurface={mode:'texture',texture:{...texture,assetId:missing}};await dm.api(path+'/encounters',{name:'Missing texture',file},201);dm.socket?.disconnect();await dm.connect(campaign.id);assert.equal(dm.snapshot!.state.dungeonMap!.floorSurface!.texture!.assetId,missing);await dm.file(missing,undefined,undefined,404)
  })
 }finally{for(const c of clients)c.socket?.disconnect();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await rm(directory,{recursive:true,force:true})}
})
