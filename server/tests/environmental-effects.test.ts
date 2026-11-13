import {lightAppearanceSchema} from '../../shared/lighting.ts'
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
import {mergeMapSnapshot,type GameCommand,type Snapshot,type CommandResult,type ClientEvents,type ServerEvents} from '../../shared/domain.ts'
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
import {createEffect,effectPresetIds} from '../../shared/environmentalEffects.ts'
import {initialFog,fullMask} from '../../shared/fog.ts'
test('effects use authoritative receipts, privacy, reconnect and persisted snapshots',{timeout:90000},async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='effects_'+randomUUID().replaceAll('-',''),directory=await mkdtemp(join(tmpdir(),'ledger-effects-'));await admin.query(`CREATE SCHEMA ${schema}`)
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`}),storage=new FilesystemAssetStorage(directory),options={pool,assetStorage:storage,origin,secret:'effects-integration-secret-'.repeat(3)};let app=createApplication(options);const clients:Client[]=[]
 try{
  await migrate(pool);await new Promise<void>(r=>app.http.listen(0,'127.0.0.1',r));const port=(app.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`
  for(let i=0;i<3;i++){const c=new Client(base);await c.api('/session');clients.push(c)}const[dm,player,late]=clients
  await dm.api('/auth/register',{email:randomUUID()+'@example.test',password:'Effects Secure Password 2055!'},201)
  const campaign=await dm.api('/campaigns',{name:'Effects'},201),path='/campaigns/'+campaign.id,invite=await dm.api(path+'/invitations',{},201)
  await player.api('/invitations/redeem',{token:invite.url.split('#invite=')[1],displayName:'Effects player'},201)
  await dm.api(path+'/encounters',{name:'Effects',file:{version:1,round:4,combatants:[]}},201);await dm.api(path+'/session',{active:true})
  await Promise.all([dm.connect(campaign.id),player.connect(campaign.id)]);await dm.command({type:'map.blank',id:'warehouse',name:'Warehouse',width:20,height:20})
  const effect=createEffect('private-effect','magical-motes','ground',{x:5,z:5,heightFeet:5}),command={type:'map.effect.set' as const,effect},revision=dm.snapshot!.revision
  const envelope={commandId:randomUUID(),encounterId:dm.snapshot!.encounterId,revision,command}
  const emit=()=>new Promise<CommandResult>(resolve=>dm.socket!.emit('game.command',envelope,resolve))
  const first=await emit(),again=await emit();assert.equal(first.ok,true);assert.equal(again.ok,true);if(first.ok&&again.ok){assert.equal(again.revision,first.revision);assert.equal(again.duplicate,true)}
  await waitFor(()=>player.snapshot!.revision===revision+1);assert.equal(player.snapshot!.state.dungeonMap!.environmentalEffects!.effects.length,1)
  const stale=await new Promise<CommandResult>(resolve=>dm.socket!.emit('game.command',{...envelope,commandId:randomUUID(),command:{type:'map.effect.remove',id:effect.id}},resolve));assert.equal(stale.ok,false)
  await player.command(command,false);await player.command({type:'map.effect.remove',id:effect.id},false);await player.command({type:'map.effect.duplicate',id:effect.id,newId:'hack'},false)
  await dm.command({type:'map.effect.duplicate',id:effect.id,newId:'copy'});await dm.command({type:'map.effect.remove',id:'copy'});await dm.command({type:'map.undo'});assert.equal(dm.snapshot!.state.dungeonMap!.environmentalEffects!.effects.length,2);await dm.command({type:'map.redo'})
  await dm.command({type:'map.level.add',id:'office',name:'Office',elevationFeet:15,width:20,height:20});await dm.command({type:'map.effect.set',effect:{...effect,id:'secret-office-effect',floorId:'office'}})
  await dm.command({type:'map.fog.enabled',enabled:true});await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision)
  assert.equal(JSON.stringify(player.snapshot).includes('private-effect'),false);assert.equal(JSON.stringify(player.snapshot).includes('secret-office-effect'),false)
  await dm.command({type:'map.fog.mask',levelId:'ground',mask:fullMask(20,20)});await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision)
  assert.equal(player.snapshot!.state.dungeonMap!.environmentalEffects!.effects.length,1)
  const file=await dm.api(path+'/export');assert.equal(file.dungeonMap.environmentalEffects.effects.length,2);assert.equal(file.round,4)
  const fog=dm.snapshot!.state.dungeonMap!.fogOfWar!;assert.equal(fog.enabled,initialFog().enabled)
  const template=await dm.api(path+'/maps',{name:'Effects',encounterId:dm.snapshot!.encounterId,encounterRevision:dm.snapshot!.revision},201)
  await dm.command({type:'map.effect.remove',id:effect.id});await dm.command({type:'map.template.load',templateId:template.id})
  const lateInvite=await dm.api(path+'/invitations',{},201);await late.api('/invitations/redeem',{token:lateInvite.url.split('#invite=')[1],displayName:'Late effects player'},201);await late.connect(campaign.id)
  assert.equal(late.snapshot!.state.dungeonMap!.environmentalEffects!.effects.length,1)
  const stableRevision=dm.snapshot!.revision;await new Promise(r=>setTimeout(r,150));assert.equal(dm.snapshot!.revision,stableRevision)
  for(const c of clients)c.socket?.disconnect();await app.close();await recoverFloorImages(pool,storage);app=createApplication(options);await new Promise<void>(r=>app.http.listen(port,'127.0.0.1',r))
  await Promise.all([dm.connect(campaign.id),player.connect(campaign.id)])
  assert.equal(dm.snapshot!.state.dungeonMap!.environmentalEffects!.effects.length,2);assert.equal(player.snapshot!.state.dungeonMap!.environmentalEffects!.effects.length,1)
  assert.equal(dungeonLevels(dm.snapshot!.state.dungeonMap!).length,2)
  // B uses the same command protocol for real emitters and every new rendering preset.
  for(const id of effectPresetIds.filter(id=>id!=='magical-motes'))await dm.command({type:'map.effect.set',effect:createEffect('b-'+id,id,'ground',{x:10,z:10,heightFeet:0})})
  await dm.command({type:'map.effect.light.set',id:'b-campfire',appearance:lightAppearanceSchema.parse({intensity:12,radius:4,flicker:{enabled:true}})})
  await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision)
  const emitterId=dm.snapshot!.state.dungeonMap!.environmentalEffects!.effects.find(e=>e.id==='b-campfire')!.light!.emitterId
  assert.equal(player.snapshot!.state.dungeonMap!.lighting!.sources!.find(s=>s.id===emitterId)!.intensity,12)
  await player.command({type:'map.effect.light.set',id:'b-campfire',appearance:null},false)
  await dm.command({type:'map.lighting.source.remove',id:emitterId},false)
  await dm.command({type:'map.effect.duplicate',id:'b-campfire',newId:'b-copy'})
  assert.equal(dm.snapshot!.state.dungeonMap!.lighting!.sources!.length,2)
  await dm.command({type:'map.effect.remove',id:'b-copy'});await dm.command({type:'map.undo'});assert.equal(dm.snapshot!.state.dungeonMap!.lighting!.sources!.length,2);await dm.command({type:'map.redo'})
  await dm.command({type:'map.fog.reset',confirmed:true,levelId:'ground'});await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision)
  assert.equal(player.snapshot!.state.dungeonMap!.environmentalEffects!.effects.length,0);assert.equal(player.snapshot!.state.dungeonMap!.lighting!.sources!.length,0);assert.equal(JSON.stringify(player.snapshot).includes(emitterId),false)
  await dm.command({type:'map.fog.mask',levelId:'ground',mask:fullMask(20,20)})
  const fire=dm.snapshot!.state.dungeonMap!.environmentalEffects!.effects.find(e=>e.id==='b-campfire')!
  await dm.command({type:'map.effect.set',effect:{...fire,enabled:false}});await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision)
  assert.equal(player.snapshot!.state.dungeonMap!.lighting!.sources!.find(s=>s.id===emitterId)!.enabled,false)
  await dm.command({type:'map.effect.set',effect:fire})
  player.socket!.disconnect();await player.connect(campaign.id);assert.equal(player.snapshot!.state.dungeonMap!.lighting!.sources!.find(s=>s.id===emitterId)!.enabled,true)
  const exported=await dm.api(path+'/export');assert.equal(exported.dungeonMap.environmentalEffects.effects.length,18)
  const finalRevision=dm.snapshot!.revision;await new Promise(r=>setTimeout(r,150));assert.equal(dm.snapshot!.revision,finalRevision)
  for(const c of clients)c.socket?.disconnect();await app.close();app=createApplication(options);await new Promise<void>(r=>app.http.listen(port,'127.0.0.1',r));await Promise.all([dm.connect(campaign.id),player.connect(campaign.id)])
  assert.equal(dm.snapshot!.state.dungeonMap!.environmentalEffects!.effects.length,18);assert.equal(player.snapshot!.state.dungeonMap!.lighting!.sources!.length,1)

 }finally{for(const c of clients)c.socket?.disconnect();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await rm(directory,{recursive:true,force:true})}
})
