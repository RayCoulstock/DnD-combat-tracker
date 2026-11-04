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
import {makeGlb,triangleDocument} from '../../test-fixtures/glb.ts'
import {combatantSchema,mergeMapSnapshot,projectEncounter,type Snapshot,type GameCommand,type CommandResult,type ClientEvents,type ServerEvents} from '../../shared/domain.ts'
import {groupWriteSchema,type GroupPreset,type GroupAdd} from '../../shared/groupPresets.ts'
const origin='http://localhost:5173'
async function waitFor(fn:()=>boolean){const end=Date.now()+8000;while(!fn()){if(Date.now()>end)throw Error('Snapshot did not converge');await new Promise(r=>setTimeout(r,20))}}
class Client{
 cookie='';csrf='';actor!:{id:string};snapshot:Snapshot|null=null;socket?:Socket<ServerEvents,ClientEvents>;snapshots=0
 constructor(public base:string){}
 async api(path:string,body?:unknown,status=200){const r=await fetch(this.base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:this.cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':this.csrf},body:body===undefined?undefined:JSON.stringify(body)});const cookies=r.headers.getSetCookie();if(cookies.length)this.cookie=cookies.map(c=>c.split(';')[0]).join('; ');const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));if(data.csrf)this.csrf=data.csrf;if(data.actor)this.actor=data.actor;return data}
 async connect(id:string){this.snapshot=null;this.socket=io(this.base,{transports:['websocket'],extraHeaders:{Origin:origin,Cookie:this.cookie},auth:{csrf:this.csrf},reconnection:false});this.socket.on('session.state',s=>{if(s.snapshot){this.snapshot=mergeMapSnapshot(this.snapshot,s.snapshot);this.snapshots++}});this.socket.on('connect',()=>this.socket!.emit('campaign.join',id,()=>{}));await waitFor(()=>Boolean(this.snapshot))}
 async command(command:GameCommand,accepted=true,revision=this.snapshot!.revision,commandId=command.type==='group.add'?command.requestId:randomUUID()){const r=await new Promise<CommandResult>(resolve=>this.socket!.emit('game.command',{commandId,encounterId:this.snapshot!.encounterId,revision,command},resolve));assert.equal(r.ok,accepted,JSON.stringify(r));if(r.ok)await waitFor(()=>this.snapshot!.revision>=r.revision);return r}
 async upload(){const data=new FormData();data.set('metadata',JSON.stringify({name:'Group model',category:'monster'}));data.set('file',new Blob([new Uint8Array(makeGlb({...triangleDocument(),asset:{version:'2.0',generator:randomUUID()}}))]),'model.glb');const r=await fetch(this.base+'/api/assets',{method:'POST',headers:{Cookie:this.cookie,Origin:origin,'X-CSRF-Token':this.csrf},body:data});assert.equal(r.status,201);return r.json()}
}
const body=(p:GroupPreset)=>({name:p.name,description:p.description,campaignId:p.campaignId,members:p.members,revision:p.revision,archived:p.archived})
const member=(entryId:string,quantity=1)=>({id:randomUUID(),entryId,quantity,side:null,displayName:null})
const add=(p:GroupPreset,changes:Partial<GroupAdd>={}):GroupAdd=>({type:'group.add',requestId:randomUUID(),presetId:p.id,presetRevision:p.revision,placement:'roster',floorId:'ground',selections:p.members.map(m=>({memberId:m.id,quantity:m.quantity,useSavedState:true,allowDuplicate:false,instanceIds:Array.from({length:m.quantity},()=>randomUUID())})),...changes})
test('group presets use relational references and one authorized idempotent encounter transaction',{timeout:90000},async t=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='groups_'+randomUUID().replaceAll('-',''),root=await mkdtemp(join(tmpdir(),'ledger-groups-'));await admin.query(`CREATE SCHEMA ${schema}`)
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`}),options={pool,origin,secret:'group-integration-synthetic-secret-'.repeat(3),assetStorage:new FilesystemAssetStorage(root)};let app=createApplication(options);const clients:Client[]=[]
 try{await migrate(pool);await migrate(pool);await new Promise<void>(r=>app.http.listen(0,'127.0.0.1',r));const port=(app.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`
  for(let i=0;i<4;i++){const c=new Client(base);await c.api('/session');clients.push(c)}const[dm,player,other,late]=clients
  for(const c of [dm,other])await c.api('/auth/register',{email:randomUUID()+'@example.test',password:'Synthetic Group Password 2056!'},201)
  const campaign=await dm.api('/campaigns',{name:'Mountain fixture'},201),path='/campaigns/'+campaign.id,otherCampaign=await other.api('/campaigns',{name:'Foreign'},201)
  for(const c of [player,late]){const invitation=await dm.api(path+'/invitations',{},201);await c.api('/invitations/redeem',{token:invitation.url.split('#invite=')[1],displayName:'Group player'},201)}
  const existing=combatantSchema.parse({id:'existing',name:'Existing ally',side:'hero',hp:10,maxHp:12,ac:14,initiative:10,conditions:[],saves:[],actions:[]})
  await dm.api(path+'/encounters',{name:'Original',file:{version:1,round:7,activeId:'existing',combatants:[existing]}},201);await dm.api(path+'/session',{active:true});await Promise.all([dm.connect(campaign.id),player.connect(campaign.id)])
  const asset=await dm.upload(),heroId=randomUUID(),npcId=randomUUID(),guardId=randomUUID()
  const definition=(name:string,side='hero',visible=true)=>({...existing,id:'definition',name,side,hp:20,maxHp:20,visible,miniature:{assetId:asset.id,scale:1.5,rotation:90}})
  const hero=await dm.api('/combatant-library/'+heroId,{name:'Aria',kind:'player-character',campaignId:campaign.id,definition:definition('Aria'),notes:'',revision:0})
  await dm.api('/combatant-library/'+npcId,{name:'Guide',kind:'named-npc',campaignId:null,definition:definition('Guide','neutral'),notes:'',revision:0})
  let guard=await dm.api('/combatant-library/'+guardId,{name:'Warehouse Guard',kind:'monster-template',campaignId:null,definition:definition('Warehouse Guard','enemy',false),notes:'Secret',revision:0})
  const firstHero=randomUUID();await dm.command({type:'library.add',entryId:heroId,instanceId:firstHero,useSavedState:false,allowDuplicate:false});await dm.command({type:'combatant.hp.update',combatantId:firstHero,hp:3});await dm.command({type:'combatant.conditions',combatantId:firstHero,conditions:['Poisoned']});await dm.command({type:'library.state.save',combatantId:firstHero,expectedRevision:0,conditions:['Poisoned']})
  await dm.api(path+'/encounters',{name:'New encounter',file:{version:1,round:7,activeId:'existing',combatants:[existing]}},201);await waitFor(()=>dm.snapshot!.state.combatants.length===1);await dm.command({type:'token.assign',combatantId:'existing',playerId:player.actor.id})
  let preset:GroupPreset=await dm.api('/group-presets/'+randomUUID(),{name:'Warehouse party',description:'Reusable references',campaignId:campaign.id,members:[member(heroId),member(npcId),{...member(guardId,4),side:'neutral',displayName:'Warehouse Guard'}],revision:0,archived:false})
  const generalId=randomUUID();let general:GroupPreset
  await t.test('general/campaign create, retry-safe IDs, edit/reorder/duplicate/archive and scoped references',async()=>{
   general=await dm.api('/group-presets/'+generalId,{...body(preset),campaignId:null,revision:0,members:preset.members.map(m=>({...m,id:randomUUID()}))});const replay=await dm.api('/group-presets/'+generalId,{...body(general),revision:0});assert.equal(replay.revision,1)
   preset=await dm.api('/group-presets/'+preset.id,{...body(preset),name:'Adventuring party and guards',description:'Updated',members:[preset.members[1],preset.members[0],preset.members[2]]});assert.equal(preset.members[0].entryId,npcId)
   const removed=preset.members[0];preset=await dm.api('/group-presets/'+preset.id,{...body(preset),members:preset.members.slice(1)});assert.equal(preset.members.length,2);assert.ok(preset.members.every(m=>m.id!==removed.id));preset=await dm.api('/group-presets/'+preset.id,{...body(preset),members:[removed,...preset.members]});assert.deepEqual(preset.members.map(m=>m.entryId),[npcId,heroId,guardId])
   const duplicate=await dm.api('/group-presets/'+randomUUID(),{...body(preset),revision:0,name:'Copy',members:preset.members.map(m=>({...m,id:randomUUID()}))});assert.notEqual(duplicate.id,preset.id)
   const archived=await dm.api('/group-presets/'+duplicate.id,{...body(duplicate),archived:true});const before=dm.snapshot!.revision;await dm.command(add(archived),false);assert.equal(dm.snapshot!.revision,before)
   await dm.api('/group-presets/'+archived.id,{...body(archived),archived:false})
   await player.api('/group-presets',undefined,403);await player.api('/group-presets/'+randomUUID(),body(preset),403)
   await other.api('/group-presets/'+preset.id,{...body(preset),name:'Stolen'},403)
   await dm.api('/group-presets/'+randomUUID(),{...body(preset),revision:0,campaignId:otherCampaign.id,members:[member(heroId)]},403)
   const foreignEntry=await other.api('/combatant-library/'+randomUUID(),{name:'Private',kind:'monster-template',campaignId:null,definition:{...definition('Private'),miniature:undefined},notes:'',revision:0});await dm.api('/group-presets/'+randomUUID(),{...body(preset),revision:0,members:[member(foreignEntry.id)]},404)
   await dm.api('/group-presets/'+randomUUID(),{...body(preset),revision:0,members:[member(heroId,2)]},409)
  })
  let inserted:GroupAdd,committed:CommandResult
  await t.test('one batch preserves saved state, model transforms, source identity, order/round and permitted broadcast',async()=>{
   await dm.command({type:'initiative.mode',mode:'manual'});const before=dm.snapshot!,count=player.snapshots;inserted=add(preset);const canonicalIds=inserted.selections.flatMap(s=>s.instanceIds);inserted.selections.reverse();committed=await dm.command(inserted);assert.ok(committed.ok);assert.equal(committed.revision,before.revision+1);assert.equal(committed.groupResult!.added.flatMap(a=>a.instanceIds).length,6)
   const state=dm.snapshot!.state;assert.equal(state.activeId,'existing');assert.equal(state.combatants.find(c=>c.id==='existing')!.ownerId,player.actor.id);assert.equal(state.round,7);assert.equal(state.turnOrder!.mode,'manual');assert.deepEqual(state.combatants.slice(1).map(c=>c.id),canonicalIds)
   const pc=state.combatants.find(c=>c.sourceLibraryId===heroId)!;assert.equal(pc.hp,3);assert.deepEqual(pc.conditions,['Poisoned']);assert.equal(pc.persistentIdentity,true)
   const guards=state.combatants.filter(c=>c.sourceLibraryId===guardId);assert.equal(guards.length,4);assert.deepEqual(guards.map(c=>c.name),[1,2,3,4].map(i=>'Warehouse Guard '+i));for(const c of state.combatants.slice(1)){assert.equal(c.miniature!.assetId,asset.id);assert.equal(c.miniature!.scale,1.5);assert.equal(c.miniature!.rotation,90);assert.equal(c.unplaced,true);assert.equal(c.floorId,'ground');assert.equal(c.initiative,0);assert.equal(c.ownerId,null)}assert.ok(guards.every(c=>c.side==='neutral'&&c.hp===20))
   await waitFor(()=>player.snapshot!.revision===dm.snapshot!.revision);assert.equal(player.snapshots,count+1);assert.ok(!JSON.stringify(player.snapshot).includes('Warehouse Guard'));assert.ok(!JSON.stringify(player.snapshot).includes(preset.id));assert.equal(player.snapshot!.state.combatants.length,3)
   await dm.command({type:'combatant.hp.update',combatantId:guards[0].id,hp:2});await dm.command({type:'combatant.conditions',combatantId:guards[0].id,conditions:['Prone']});assert.equal(dm.snapshot!.state.combatants.find(c=>c.id===guards[1].id)!.hp,20);assert.deepEqual(dm.snapshot!.state.combatants.find(c=>c.id===guards[1].id)!.conditions,[])
  })
  await t.test('exact retries return their stored result with no duplicate instances or HP reset; altered payloads reject',async()=>{
   const before=dm.snapshot!;const replay=await dm.command(inserted);assert.ok(replay.ok&&replay.duplicate);assert.ok(committed.ok);assert.deepEqual(replay.groupResult,committed.groupResult);assert.equal(dm.snapshot!.revision,before.revision);assert.deepEqual(dm.snapshot!.state.combatants,before.state.combatants)
   await dm.command({...inserted,floorId:'different'},false);await dm.command({...inserted,requestId:randomUUID()},false,dm.snapshot!.revision,randomUUID())
  })
  await t.test('existing persistent characters skip by default, explicit full duplicates work and initiative mode remains sorted',async()=>{
   const request=add(preset);request.selections=request.selections.filter(s=>preset.members.find(m=>m.id===s.memberId)!.entryId===heroId);const skipped=await dm.command(request);assert.ok(skipped.ok);assert.equal(skipped.groupResult!.added.length,0);assert.equal(skipped.groupResult!.skipped.length,1)
   await dm.command({type:'initiative.mode',mode:'initiative'});const duplicate=add(preset);duplicate.selections=duplicate.selections.filter(s=>preset.members.find(m=>m.id===s.memberId)!.entryId===heroId).map(s=>({...s,useSavedState:false,allowDuplicate:true}));await dm.command(duplicate);const pc=dm.snapshot!.state.combatants.find(c=>c.id===duplicate.selections[0].instanceIds[0])!;assert.equal(pc.hp,20);assert.deepEqual(pc.conditions,[]);assert.equal(dm.snapshot!.state.combatants[0].id,'existing');assert.equal(dm.snapshot!.state.round,7)
   assert.equal((await dm.api(`/combatant-library/${heroId}/state/${campaign.id}`)).state.hp,3)
  })
  await t.test('archived and deleted references are explicit, atomic failures; excluding them remains usable',async()=>{
   guard=await dm.api('/combatant-library/'+guardId,{name:guard.name,kind:guard.kind,campaignId:guard.campaignId,notes:guard.notes,definition:guard.definition,revision:guard.revision,archived:true});const before=dm.snapshot!.revision,beforeCount=dm.snapshot!.state.combatants.length
   const rejected=await dm.command(add(preset),false);assert.ok(!rejected.ok);assert.equal(rejected.groupResult!.added.length,0);assert.ok(rejected.groupResult!.failed.length);assert.equal(dm.snapshot!.revision,before);assert.equal(dm.snapshot!.state.combatants.length,beforeCount)
   const temp=await dm.api('/combatant-library/'+randomUUID(),{name:'Temporary',kind:'monster-template',campaignId:null,definition:definition('Temporary'),revision:0});const missing=await dm.api('/group-presets/'+randomUUID(),{...body(preset),revision:0,members:[member(temp.id),member(npcId)]});await pool.query('DELETE FROM combatant_library WHERE id=$1',[temp.id]);const loaded=(await dm.api('/group-presets')).find((p:GroupPreset)=>p.id===missing.id);assert.equal(loaded.members[0].entryId,null)
   const invalid=await dm.command(add(loaded),false);assert.ok(!invalid.ok&&invalid.groupResult!.failed.length===1);const valid=add(loaded);valid.selections=valid.selections.slice(1);const skipped=await dm.command(valid);assert.ok(skipped.ok&&skipped.groupResult!.skipped.length===1)
  })
  await t.test('future definitions are resolved on insert, missing assets warn without blocking, invalid floor/IDs roll back',async()=>{
   const temporaryAsset=await dm.upload(),tempId=randomUUID();let template=await dm.api('/combatant-library/'+tempId,{name:'Future model',kind:'monster-template',campaignId:null,definition:{...definition('Future model'),miniature:{assetId:temporaryAsset.id,scale:2,rotation:45}},revision:0});const p=await dm.api('/group-presets/'+randomUUID(),{...body(preset),revision:0,members:[member(tempId,2)]});template=await dm.api('/combatant-library/'+tempId,{name:template.name,kind:template.kind,campaignId:null,definition:{...template.definition,hp:30,maxHp:30},revision:template.revision});assert.equal(template.definition.maxHp,30);await pool.query('DELETE FROM assets_3d WHERE id=$1',[temporaryAsset.id]);const command=add(p),result=await dm.command(command);assert.ok(result.ok&&result.groupResult!.warnings.length===1);const instances=dm.snapshot!.state.combatants.filter(c=>c.sourceLibraryId===tempId);assert.ok(instances.every(c=>c.hp===30&&c.miniature!.assetId===null&&c.miniature!.scale===2))
   const collision=add(p);collision.selections[0].instanceIds[0]=command.selections[0].instanceIds[0];const revision=dm.snapshot!.revision;await dm.command(collision,false);assert.equal(dm.snapshot!.revision,revision);await dm.command({...add(p),floorId:'absent'},false);assert.equal(dm.snapshot!.revision,revision)
   const malformed={...add(p),selections:[{...add(p).selections[0],quantity:21}]} as GroupAdd;await dm.command(malformed,false)
  })
  await t.test('roster additions retain an elevated active floor and individual placement uses its grid bounds',async()=>{
   await dm.command({type:'map.blank',id:'group-map',name:'Two floors',width:20,height:20});await dm.command({type:'map.level.add',id:'upper',name:'Upper walk',elevationFeet:15,width:8,height:8})
   const source=await dm.api('/combatant-library/'+randomUUID(),{name:'Upper scout',kind:'monster-template',campaignId:null,definition:definition('Upper scout','enemy'),revision:0}),p=await dm.api('/group-presets/'+randomUUID(),{...body(preset),revision:0,campaignId:null,members:[member(source.id,2)]}),request=add(p,{floorId:'upper'})
   await dm.command(request);const inserted=dm.snapshot!.state.combatants.filter(c=>c.sourceLibraryId===source.id);assert.equal(inserted.length,2);assert.ok(inserted.every(c=>c.floorId==='upper'&&c.unplaced&&c.miniature!.assetId===asset.id));assert.equal(dm.snapshot!.state.dungeonMap!.levels!.find(l=>l.id==='upper')!.elevationFeet,15)
   await dm.command({type:'token.move',combatantId:inserted[0].id,destination:{x:7,z:7}});assert.equal(dm.snapshot!.state.combatants.find(c=>c.id===inserted[0].id)!.unplaced,false);const revision=dm.snapshot!.revision;await dm.command({type:'token.move',combatantId:inserted[0].id,destination:{x:8,z:7}},false);assert.equal(dm.snapshot!.revision,revision);assert.equal(dm.snapshot!.state.round,7)
  })
  await t.test('player insertion is forbidden, late join/reconnect and backend restart retain presets and instances',async()=>{
   const denied=await player.command(add(preset),false);assert.ok(!denied.ok&&denied.error.code==='FORBIDDEN');await late.connect(campaign.id);assert.deepEqual(late.snapshot!.state.combatants,JSON.parse(JSON.stringify(projectEncounter(dm.snapshot!.state,{role:'player',id:late.actor.id}).combatants)));assert.ok(!JSON.stringify(late.snapshot).includes('Warehouse Guard'))
   const exported=await dm.api(path+'/export'),savedPresets=await dm.api('/group-presets');for(const c of clients)c.socket?.disconnect();await app.close();app=createApplication(options);await new Promise<void>(r=>app.http.listen(port,'127.0.0.1',r));assert.deepEqual(await dm.api('/group-presets'),savedPresets);assert.deepEqual((await dm.api(path+'/snapshot')).state.combatants,exported.combatants);await dm.connect(campaign.id);assert.equal(dm.snapshot!.state.round,7)
   assert.equal(groupWriteSchema.safeParse({...body(preset),members:Array.from({length:21},()=>member(guardId))}).success,false)
  })
  // Keep these references live so type checking verifies the public result shapes.
  assert.ok(hero.id&&general!.id)
 }finally{for(const c of clients)c.socket?.disconnect();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await rm(root,{recursive:true,force:true})}
})
