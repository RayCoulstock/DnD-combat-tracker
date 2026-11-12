import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {io} from 'socket.io-client'
import {accountFixture} from './player-fixture.ts'
import {waitFor} from './player-client.ts'
import {blankDungeon} from '../../shared/dungeon.ts'
const password='Player Membership Fixture Password 2056!'
const token=(url:string)=>new URLSearchParams(new URL(url).hash.slice(1)).get('invite')!
test('B My Campaigns lists only owned/active member campaigns with independent roles and no member emails',async t=>{
 const f=await accountFixture(t),p=await f.player(),invite=await f.invitation(),email=randomUUID()+'@example.test'
 const a=await p.request('/auth/player-register',{token:invite.token,email,password,displayName:'Player host'},201)
 const second=await f.dm.request('/campaigns',{name:'Second'},201),bInvite=await f.dm.request('/campaigns/'+second.id+'/invitations',{},201)
 const b=await p.request('/invitations/accept',{token:token(bInvite.url)});assert.equal(b.account.id,a.account.id);assert.notEqual(a.actor.id,b.actor.id)
 const unrelated=await f.dm.request('/campaigns',{name:'Unrelated secret'},201),owned=await p.request('/campaigns',{name:'Hosted by player'},201)
 const list=await p.request('/campaigns');assert.equal(list.length,3);assert.equal(JSON.stringify(list).includes(unrelated.id),false);assert.equal(JSON.stringify(list).includes('@'),false)
 assert.equal(list.find((c:{id:string})=>c.id===owned.id).role,'dm');assert.equal(list.find((c:{id:string})=>c.id===f.c.id).membershipStatus,'active');assert.equal(list.find((c:{id:string})=>c.id===f.c.id).hostName,'Campaign host')
 assert.equal((await p.request(f.path+'/enter',{})).actor.id,a.actor.id);assert.equal((await p.request('/campaigns/'+second.id+'/enter',{})).actor.id,b.actor.id)
 await p.request('/campaigns/'+unrelated.id+'/enter',{},403);await p.request(f.path+'/session',{active:true},403)
 const details=await f.dm.request(f.path);assert.equal(details.members[0].accountLinked,true);assert.equal(details.members[0].status,'active');assert.equal((await p.request(f.path)).members[0].accountLinked,undefined)
})
test('B session end retains membership; revocation removes only that campaign and preserves other tabs/account/owners',async t=>{
 const f=await accountFixture(t),p=await f.player(),invite=await f.invitation();const a=await p.request('/auth/player-register',{token:invite.token,email:randomUUID()+'@example.test',password,displayName:'Member'},201)
 const second=await f.dm.request('/campaigns',{name:'Second'},201),secondPath='/campaigns/'+second.id,bInvite=await f.dm.request(secondPath+'/invitations',{},201),b=await p.request('/invitations/accept',{token:token(bInvite.url)})
 const file=(id:string)=>({version:1,round:3,combatants:[{id:'hero',name:'Hero',side:'hero',hp:10,maxHp:10,ac:12,initiative:14,conditions:[],saves:[],actions:[]}],dungeonMap:blankDungeon(id,id,8,8)})
 const encounter=await f.dm.request(f.path+'/encounters',{name:'A',file:file('map-a')},201);await f.dm.request(secondPath+'/encounters',{name:'B',file:file('map-b')},201)
 await f.pool.query('UPDATE combatants SET owner_id=$1 WHERE encounter_id=$2',[a.actor.id,encounter.id]);await f.dm.request(f.path+'/session',{active:true});await f.dm.request(secondPath+'/session',{active:true})
 const tabA=await p.connect(f.c.id),tabB=await p.connect(second.id);t.after(()=>{tabA.socket.disconnect();tabB.socket.disconnect()})
 await f.dm.request(f.path+'/session',{active:false});await waitFor(()=>tabA.session?.sessionActive===false,'No session end');assert.equal((await f.pool.query('SELECT revoked_at FROM memberships WHERE id=$1',[a.actor.id])).rows[0].revoked_at,null)
 await f.dm.request(f.path+'/session',{active:true});await waitFor(()=>tabA.session?.sessionActive===true,'No second session')
 await f.dm.request(f.path+'/members/'+a.actor.id+'/revoke',{});await waitFor(()=>tabA.revoked,'Affected campaign did not revoke');assert.equal(tabB.socket.connected,true);assert.equal(tabB.snapshot!.state.dungeonMap!.id,'map-b')
 await p.request(f.path+'/snapshot',undefined,403);await p.request(f.path+'/enter',{},403);assert.equal((await p.request('/session')).account.id,a.account.id)
 assert.equal((await p.request('/campaigns')).length,1);assert.equal((await p.request(secondPath+'/enter',{})).actor.id,b.actor.id);assert.equal((await f.pool.query('SELECT owner_id FROM combatants WHERE encounter_id=$1',[encounter.id])).rows[0].owner_id,a.actor.id)
 const fresh=io(f.base,{transports:['websocket'],extraHeaders:{Cookie:p.cookie,Origin:'http://localhost:5173'},auth:{csrf:p.csrf},reconnection:false});try{await new Promise<void>((r,j)=>{fresh.on('connect',r);fresh.on('connect_error',j)});const ack=await new Promise<{ok:boolean}>(r=>fresh.emit('campaign.join',f.c.id,r));assert.equal(ack.ok,false)}finally{fresh.disconnect()}
})
test('B targeted legacy claims are auditable and revoked claims cannot restore a revoked membership',async t=>{
 const f=await accountFixture(t),p=await f.player(),i=await f.invitation();await p.request('/invitations/redeem',{token:i.token,displayName:'Legacy'},201);const id=p.actor!.id
 const claim=await f.invitation(id),before=await f.dm.request(f.path);assert.equal(before.invitations.find((i:{id:string})=>i.id===claim.id).membershipId,id);assert.equal(before.members[0].status,'active')
 await p.request(f.path+'/members/'+id+'/revoke',{},403);await f.dm.request(f.path+'/members/'+randomUUID()+'/revoke',{},404)
 await f.dm.request(f.path+'/members/'+id+'/revoke',{});const saved=(await f.pool.query('SELECT revoked_at FROM memberships WHERE id=$1',[id])).rows[0].revoked_at
 await f.dm.request(f.path+'/members/'+id+'/revoke',{});assert.deepEqual((await f.pool.query('SELECT revoked_at FROM memberships WHERE id=$1',[id])).rows[0].revoked_at,saved)
 assert.equal((await f.dm.request(f.path)).members[0].status,'revoked');assert.ok((await f.pool.query('SELECT revoked_at FROM invitations WHERE id=$1',[claim.id])).rows[0].revoked_at)
 const newPlayer=await f.player();await newPlayer.request('/auth/player-register',{token:claim.token,email:randomUUID()+'@example.test',password,displayName:'Cannot steal'},403)
})
