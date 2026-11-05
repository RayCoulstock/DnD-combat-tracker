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
import {combatantSchema,mergeMapSnapshot,type GameCommand,type Snapshot,type CommandResult,type ClientEvents,type ServerEvents} from '../../shared/domain.ts'
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
import {pointLightSchema,lightingTemplates} from '../../shared/lighting.ts'
test('lighting uses existing authorized map revisions, floor projection and restart persistence',{timeout:90000},async t=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='lighting_'+randomUUID().replaceAll('-',''),directory=await mkdtemp(join(tmpdir(),'ledger-lighting-'));await admin.query(`CREATE SCHEMA ${schema}`)
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`}),storage=new FilesystemAssetStorage(directory),options={pool,assetStorage:storage,origin,secret:'lighting-integration-secret-'.repeat(3)};let app=createApplication(options);const clients:Client[]=[]
 try{
  await migrate(pool);await new Promise<void>(r=>app.http.listen(0,'127.0.0.1',r));const port=(app.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`
  for(let i=0;i<3;i++){const c=new Client(base);await c.api('/session');clients.push(c)}const[dm,player,late]=clients;await dm.api('/auth/register',{email:randomUUID()+'@example.test',password:'Lighting Secure Password 2055!'},201)
  const campaign=await dm.api('/campaigns',{name:'Lighting'},201),path='/campaigns/'+campaign.id,invite=await dm.api(path+'/invitations',{},201);await player.api('/invitations/redeem',{token:invite.url.split('#invite=')[1],displayName:'Light player'},201);await dm.api(path+'/encounters',{name:'Lighting',file:{version:1,round:4,combatants:[]}},201);await dm.api(path+'/session',{active:true});await Promise.all([dm.connect(campaign.id),player.connect(campaign.id)]);await dm.command({type:'map.blank',id:'warehouse',name:'Warehouse',width:30,height:20})
  await t.test('DM environment changes commit once and synchronize; unauthorized players are rejected',async()=>{const revision=dm.snapshot!.revision;await dm.command({type:'map.lighting.environment.set',environment:lightingTemplates.Night});assert.equal(dm.snapshot!.revision,revision+1);await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision);assert.deepEqual(player.snapshot!.state.dungeonMap!.lighting!.environment,lightingTemplates.Night);await player.command({type:'map.lighting.environment.set',environment:lightingTemplates.Daylight},false);assert.equal(dm.snapshot!.state.round,4)})
  await t.test('floor inheritance/overrides remain private when hidden and participate in history',async()=>{await dm.command({type:'map.level.add',id:'office',name:'Secret office',elevationFeet:15,width:12,height:8});await dm.command({type:'map.lighting.override.set',levelId:'office',override:{ambientColor:'#ff00aa',ambientIntensity:1.5}});await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision);assert.equal(JSON.stringify(player.snapshot!.state).includes('#ff00aa'),false);await dm.command({type:'map.lighting.override.set',levelId:'office',override:null});await dm.command({type:'map.undo'});assert.equal(dungeonLevels(dm.snapshot!.state.dungeonMap!)[1].lightingOverride!.ambientIntensity,1.5);await dm.command({type:'map.redo'});assert.equal(dungeonLevels(dm.snapshot!.state.dungeonMap!)[1].lightingOverride,undefined)})
  await t.test('point source commits, privacy, permission and reload use the same revision pipeline',async()=>{const light=pointLightSchema.parse({id:'torch',name:'Private torch name',floorId:'ground',position:{x:5,z:6,heightFeet:5}});await dm.command({type:'map.lighting.source.set',source:light});await dm.command({type:'map.lighting.source.set',source:{...light,id:'secret-light',floorId:'office'}});await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision);assert.equal(player.snapshot!.state.dungeonMap!.lighting!.sources!.length,1);assert.equal(player.snapshot!.state.dungeonMap!.lighting!.sources![0].name,'Light');await player.command({type:'map.lighting.source.remove',id:'torch'},false);await dm.command({type:'map.lighting.source.duplicate',id:'torch',newId:'copy'});await dm.command({type:'map.undo'});assert.equal(dm.snapshot!.state.dungeonMap!.lighting!.sources!.length,2);const file=await dm.api(path+'/export');assert.equal(file.dungeonMap.lighting.sources.length,2)})
  await t.test('moving attached combatants persists fallback positions without discarding map history',async()=>{await dm.command({type:'combatant.add',allowPersistentDuplicate:false,combatants:[combatantSchema.parse({id:'bearer',name:'Light bearer',side:'hero',initiative:12,hp:8,maxHp:12,ac:15,conditions:[],saves:[],actions:[]})]});const source=dm.snapshot!.state.dungeonMap!.lighting!.sources!.find(s=>s.id==='torch')!;await dm.command({type:'map.lighting.source.set',source:{...source,attachment:{kind:'combatant',id:'bearer',offset:{x:0,z:0,heightFeet:5}}}});const depth=dm.snapshot!.state.mapUndoDepth;await dm.command({type:'token.move',combatantId:'bearer',destination:{x:2,z:3}});assert.equal(dm.snapshot!.state.mapUndoDepth,depth);assert.deepEqual(dm.snapshot!.state.dungeonMap!.lighting!.sources!.find(s=>s.id==='torch')!.position,{x:2,z:3,heightFeet:5});await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision);assert.equal(player.snapshot!.state.dungeonMap!.lighting!.sources!.length,1);await dm.command({type:'combatant.remove',combatantId:'bearer'});assert.equal(dm.snapshot!.state.mapUndoDepth,depth);assert.equal(dm.snapshot!.state.dungeonMap!.lighting!.sources!.find(s=>s.id==='torch')!.attachment,undefined)})
  await t.test('private scenes activate atomically with server-stamped transitions and no per-frame writes',async()=>{await dm.command({type:'map.lighting.scene.save',id:'night',name:'Private Night Watch',description:'Secret scene notes',durationMs:2000});await dm.command({type:'map.lighting.environment.set',environment:lightingTemplates.Daylight});await dm.command({type:'map.lighting.scene.save',id:'day',name:'Daylight',description:'',durationMs:2000});const before=Date.now();await dm.command({type:'map.lighting.scene.activate',id:'night',durationMs:2000,transitionId:randomUUID(),startedAt:1});const revision=dm.snapshot!.revision;await waitFor(()=>player.snapshot!.revision===revision);assert.ok(dm.snapshot!.state.dungeonMap!.lighting!.transition!.startedAt>=before);assert.equal(player.snapshot!.state.dungeonMap!.lighting!.environment.ambientIntensity,.3);assert.equal(player.snapshot!.state.dungeonMap!.lighting!.scenes,undefined);assert.equal(player.snapshot!.state.dungeonMap!.lighting!.previous,undefined);assert.equal(JSON.stringify(player.snapshot).includes('Private Night Watch'),false);await player.command({type:'map.lighting.scene.save',id:'hacked',name:'Hacked',description:'',durationMs:0},false);await new Promise(r=>setTimeout(r,100));assert.equal(dm.snapshot!.revision,revision)})
  await t.test('export/templates, late join and backend restart retain lighting',async()=>{const file=await dm.api(path+'/export');assert.deepEqual(file.dungeonMap.lighting.environment,lightingTemplates.Night);const template=await dm.api(path+'/maps',{name:'Night',encounterId:dm.snapshot!.encounterId,encounterRevision:dm.snapshot!.revision},201);await dm.command({type:'map.lighting.environment.set',environment:lightingTemplates.Daylight});await dm.command({type:'map.template.load',templateId:template.id});assert.deepEqual(dm.snapshot!.state.dungeonMap!.lighting!.environment,lightingTemplates.Night);const invite=await dm.api(path+'/invitations',{},201);await late.api('/invitations/redeem',{token:invite.url.split('#invite=')[1],displayName:'Late light player'},201);await late.connect(campaign.id);assert.deepEqual(late.snapshot!.state.dungeonMap!.lighting!.environment,lightingTemplates.Night);for(const c of clients)c.socket?.disconnect();await app.close();await recoverFloorImages(pool,storage);app=createApplication(options);await new Promise<void>(r=>app.http.listen(port,'127.0.0.1',r));await dm.connect(campaign.id);assert.deepEqual(dm.snapshot!.state.dungeonMap!.lighting!.environment,lightingTemplates.Night);assert.equal(dm.snapshot!.state.dungeonMap!.lighting!.scenes!.length,2);assert.equal(dm.snapshot!.state.dungeonMap!.lighting!.sources!.length,2)})
 }finally{for(const c of clients)c.socket?.disconnect();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await rm(directory,{recursive:true,force:true})}
})
