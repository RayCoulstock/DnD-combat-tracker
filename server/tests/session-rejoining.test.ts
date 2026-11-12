import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {io} from 'socket.io-client'
import {accountFixture} from './player-fixture.ts'
import {waitFor} from './player-client.ts'
import {blankDungeon,editMap,emptyHistory} from '../../shared/dungeon.ts'
import {initialFog,fullMask} from '../../shared/fog.ts'
import {lightingTemplates} from '../../shared/lighting.ts'
import type {CommandResult,GameCommand} from '../../shared/domain.ts'
const password='Returning Session Fixture Password 2057!',origin='http://localhost:5173'
function map(id:string){const base={...blankDungeon(id,id,8,8),fogOfWar:{...initialFog(),floors:{ground:fullMask(8,8)}},lighting:{environment:lightingTemplates.Night}};return editMap({document:base,width:8,height:8},emptyHistory(),{type:'map.level.add',id:'private-office',name:'Secret office',elevationFeet:15,width:6,height:6}).frame.document!}
const file=(id:string)=>({version:1,round:3,combatants:[{id:'hero',name:'Hero',side:'hero',hp:9,maxHp:10,ac:12,initiative:14,conditions:[],saves:[],actions:[]}],dungeonMap:map(id)})
test('C second gaming session, expired login and server restart recover current map/fog/lighting with the original owner',async t=>{
 const f=await accountFixture(t),p=await f.player(),invite=await f.invitation(),email=randomUUID()+'@example.test',identity=await p.request('/auth/player-register',{token:invite.token,email,password,displayName:'Returning player'},201)
 const first=await f.dm.request(f.path+'/encounters',{name:'First',file:file('first-map')},201);await f.pool.query('UPDATE combatants SET owner_id=$1 WHERE encounter_id=$2',[identity.actor.id,first.id]);await f.dm.request(f.path+'/session',{active:true})
 const a=await p.connect(f.c.id);assert.equal(a.snapshot!.state.combatants[0].ownerId,identity.actor.id);assert.equal(JSON.stringify(a.snapshot).includes('Secret office'),false)
 const command:GameCommand={type:'token.move',combatantId:'hero',destination:{x:4,z:3}},result=await new Promise<CommandResult>(r=>a.socket.emit('game.command',{commandId:randomUUID(),encounterId:a.snapshot!.encounterId,revision:a.snapshot!.revision,command},r));assert.equal(result.ok,true)
 await waitFor(()=>a.snapshot!.state.battleMap.tokens.hero.x===4,'Position did not persist')
 await f.dm.request(f.path+'/session',{active:false});await waitFor(()=>a.session?.sessionActive===false,'No waiting state');a.socket.disconnect()
 await f.pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 minute' WHERE data->>'accountId'=$1",[identity.account.id]);assert.equal((await p.request('/session')).actor,null)
 const second=await f.dm.request(f.path+'/encounters',{name:'Second',file:file('second-map')},201);await f.pool.query('UPDATE combatants SET owner_id=$1 WHERE encounter_id=$2',[identity.actor.id,second.id]);await f.dm.request(f.path+'/session',{active:true})
 await f.restart();const restored=await p.request('/auth/login',{email,password});assert.equal(restored.actor.id,identity.actor.id)
 const b=await p.connect(f.c.id);t.after(()=>b.socket.disconnect());assert.equal(b.snapshot!.encounterId,second.id);assert.equal(b.snapshot!.state.dungeonMap!.id,'second-map');assert.equal(b.snapshot!.state.dungeonMap!.fogOfWar!.floors.ground,fullMask(8,8));assert.deepEqual(b.snapshot!.state.dungeonMap!.lighting!.environment,lightingTemplates.Night);assert.equal(b.snapshot!.state.combatants[0].ownerId,identity.actor.id)
 assert.equal((await f.pool.query('SELECT count(*) FROM invitations')).rows[0].count,'1');assert.equal((await f.pool.query('SELECT count(*) FROM memberships WHERE account_id=$1',[identity.account.id])).rows[0].count,'1');assert.deepEqual((await f.pool.query('SELECT position FROM combatants WHERE encounter_id=$1',[first.id])).rows[0].position,{x:4,z:3})
})
test('C missing active encounter is a recoverable load error, not revocation; an authorized reopen repairs the room',async t=>{
 const f=await accountFixture(t),p=await f.player(),i=await f.invitation();await p.request('/auth/player-register',{token:i.token,email:randomUUID()+'@example.test',password,displayName:'Player'},201)
 const encounter=await f.dm.request(f.path+'/encounters',{name:'Recoverable',file:file('valid-map')},201);await f.dm.request(f.path+'/session',{active:true});const c=await p.connect(f.c.id);t.after(()=>c.socket.disconnect())
 const priorRevision=c.session!.revision,problems:{code:string;message:string}[]=[];c.socket.on('session.error',e=>problems.push(e));await f.pool.query('UPDATE campaigns SET active_encounter_id=$1,state_revision=state_revision+1 WHERE id=$2',[randomUUID(),f.c.id])
 const result=await new Promise<CommandResult>(r=>c.socket.emit('campaign.join',f.c.id,r));assert.equal(result.ok,false);if(!result.ok)assert.equal(result.error.code,'NOT_FOUND')
 await waitFor(()=>problems.length>0,'No explicit map error');assert.equal(problems[0].code,'LOAD_FAILED');assert.match(problems[0].message,/unavailable/);assert.equal(c.revoked,false);assert.equal(c.socket.connected,true)
 await p.request(f.path+'/snapshot',undefined,404);await f.dm.request(f.path+'/open',{encounterId:encounter.id});await waitFor(()=>c.session!.revision>priorRevision&&c.snapshot!.encounterId===encounter.id,'Reopen did not repair map')
 assert.equal((await p.request('/session')).account.id,(await f.pool.query('SELECT account_id FROM memberships')).rows[0].account_id)
})
test('C the latest requested campaign wins when an earlier join is blocked on its snapshot',async t=>{
 const f=await accountFixture(t),p=await f.player(),i=await f.invitation();await p.request('/auth/player-register',{token:i.token,email:randomUUID()+'@example.test',password,displayName:'Player'},201)
 const b=await f.dm.request('/campaigns',{name:'Second'},201),bi=await f.dm.request('/campaigns/'+b.id+'/invitations',{},201);await p.request('/invitations/accept',{token:new URLSearchParams(new URL(bi.url).hash.slice(1)).get('invite')!})
 await f.dm.request(f.path+'/encounters',{name:'A',file:file('map-a')},201);await f.dm.request('/campaigns/'+b.id+'/encounters',{name:'B',file:file('map-b')},201);await f.dm.request(f.path+'/session',{active:true});await f.dm.request('/campaigns/'+b.id+'/session',{active:true})
 const lock=await f.pool.connect(),socket=io(f.base,{transports:['websocket'],extraHeaders:{Cookie:p.cookie,Origin:origin},auth:{csrf:p.csrf},reconnection:false}),seen:string[]=[];socket.on('session.state',s=>seen.push(s.campaignId))
 try{
  await new Promise<void>((r,j)=>{socket.on('connect',r);socket.on('connect_error',j)});await lock.query('BEGIN');await lock.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE',[f.c.id])
  const first=new Promise<CommandResult>(r=>socket.emit('campaign.join',f.c.id,r));await waitFor(()=>[...f.app.io.sockets.sockets.values()].some(s=>s.rooms.has(f.c.id)),'First join never subscribed')
  const last=await new Promise<CommandResult>(r=>socket.emit('campaign.join',b.id,r));assert.equal(last.ok,true);await lock.query('COMMIT');const prior=await first;assert.equal(prior.ok,false);assert.deepEqual(seen,[b.id])
  assert.equal([...f.app.io.sockets.sockets.values()][0].rooms.has(f.c.id),false)
 }finally{await lock.query('ROLLBACK');lock.release();socket.disconnect()}
})
