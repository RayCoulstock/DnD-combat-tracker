import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import argon2 from 'argon2'
import {waitFor} from './player-client.ts'
import {blankDungeon} from '../../shared/dungeon.ts'
import {accountFixture as fixture} from './player-fixture.ts'
const password='Player Account Fixture Password 2055!'
test('A invitation-only account creation validates tokens atomically, hashes passwords and prevents replay/concurrent redemption',async t=>{
 const f=await fixture(t),p=await f.player(),email=randomUUID()+'@example.test',body={email,password,displayName:'Player'}
 await p.request('/auth/register',{email,password},403);await p.request('/auth/player-register',body,403)
 for(const mode of ['expired','revoked']){const i=await f.invitation();await f.pool.query(`UPDATE invitations SET ${mode==='expired'?"expires_at=now()-interval '1 minute'":'revoked_at=now()'} WHERE id=$1`,[i.id]);await p.request('/auth/player-register',{...body,token:i.token},403)}
 const i=await f.invitation();assert.notEqual((await f.pool.query('SELECT token_hash FROM invitations WHERE id=$1',[i.id])).rows[0].token_hash,i.token)
 const beforeCookie=p.cookie;const account=await p.request('/auth/player-register',{...body,email:email.toUpperCase(),token:i.token},201);assert.notEqual(p.cookie,beforeCookie);assert.equal(account.actor.role,'player')
 const user=(await f.pool.query('SELECT * FROM users WHERE id=$1',[account.account.id])).rows[0];assert.equal(user.email,email);assert.ok(user.password_hash.startsWith('$argon2id$'));assert.ok(await argon2.verify(user.password_hash,password))
 const replay=await f.player();await replay.request('/auth/player-register',{...body,email:randomUUID()+'@example.test',token:i.token},403)
 const duplicate=await f.invitation();await replay.request('/auth/player-register',{...body,token:duplicate.token},409);assert.equal((await f.pool.query('SELECT redeemed_at FROM invitations WHERE id=$1',[duplicate.id])).rows[0].redeemed_at,null)
 assert.equal((await f.pool.query('SELECT count(*) FROM memberships')).rows[0].count,'1')
 const race=await f.invitation(),a=await f.player(),b=await f.player()
 const results=await Promise.all([a,b].map(client=>client.request('/auth/player-register',{...body,email:randomUUID()+'@example.test',token:race.token},[201,403])))
 assert.equal(results.filter(r=>r.actor).length,1);assert.equal((await f.pool.query('SELECT count(*) FROM memberships')).rows[0].count,'2');assert.equal((await f.pool.query('SELECT count(*) FROM users')).rows[0].count,'3')
 await f.dm.request(f.path+'/invitations',{},403,{Origin:'https://other.example'})
})
test('A legacy claim preserves identity/ownership; ordinary login, expiry and logout restore campaign-scoped access',async t=>{
 const f=await fixture(t),p=await f.player(),i=await f.invitation();await p.request('/invitations/redeem',{token:i.token,displayName:'Legacy player'},201);const membershipId=p.actor!.id
 const file={version:1,round:3,combatants:[{id:'hero',name:'Hero',side:'hero',hp:8,maxHp:10,ac:12,initiative:14,conditions:[],saves:[],actions:[],artwork:'data:image/png;base64,aGVsbG8='}],dungeonMap:blankDungeon('return-map','Return map',8,8)}
 await f.dm.request(f.path+'/encounters',{name:'Owned hero',file},201);await f.pool.query('UPDATE combatants SET owner_id=$1',[membershipId]);await f.dm.request(f.path+'/session',{active:true})
 const email=randomUUID()+'@example.test',result=await p.request('/auth/player-register',{claimLegacy:true,email,password,displayName:'Account name'},201)
 assert.equal(result.actor.id,membershipId);assert.equal(result.membershipId,membershipId);assert.equal((await f.pool.query('SELECT owner_id FROM combatants')).rows[0].owner_id,membershipId)
 assert.equal((await f.pool.query('SELECT display_name FROM memberships WHERE id=$1',[membershipId])).rows[0].display_name,'Legacy player')
 const socket=await p.connect(f.c.id);assert.equal(socket.snapshot!.actor.id,membershipId);assert.equal(socket.snapshot!.state.combatants[0].ownerId,membershipId)
 await p.request('/auth/logout',{});await waitFor(()=>socket.revoked,'Logout did not invalidate socket');socket.socket.disconnect()
 await p.request('/session');await p.request('/auth/login',{email,password:'Incorrect Password 2055!'},401)
 const login=await p.request('/auth/login',{email,password});assert.equal(login.actor.id,membershipId);assert.equal(login.account.id,result.account.id)
 await p.request(f.path+'/session',{active:false},403)
 await f.pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 minute' WHERE data->>'accountId'=$1",[result.account.id]);assert.equal((await p.request('/session')).actor,null);await p.request(f.path+'/snapshot',undefined,401)
 assert.equal((await f.pool.query('SELECT revoked_at FROM memberships WHERE id=$1',[membershipId])).rows[0].revoked_at,null)
 assert.equal((await p.request('/auth/login',{email,password})).actor.id,membershipId);const restored=await p.request(f.path+'/snapshot');assert.equal(restored.state.dungeonMap.id,'return-map');assert.equal((await fetch(f.base+restored.state.combatants[0].artwork,{headers:{Cookie:p.cookie}})).status,200)
 const second=await f.dm.request('/campaigns',{name:'Second campaign'},201),inv=await f.dm.request('/campaigns/'+second.id+'/invitations',{},201),token=new URLSearchParams(new URL(inv.url).hash.slice(1)).get('invite')!
 const retainedCookie=p.cookie,otherTab=await p.connect(f.c.id)
 const accepted=await p.request('/invitations/accept',{token});assert.equal(p.cookie,retainedCookie);await f.dm.request(f.path+'/session',{active:false});await waitFor(()=>otherTab.session?.sessionActive===false,'Other tab lost its waiting subscription');assert.equal(otherTab.socket.connected,true);otherTab.socket.disconnect();assert.notEqual(accepted.actor.id,membershipId);assert.equal(accepted.account.id,result.account.id);assert.equal((await p.request('/campaigns')).length,2)
 assert.equal((await p.request(f.path+'/enter',{})).actor.id,membershipId)
 const owned=await p.request('/campaigns',{name:'Player can host another campaign'},201);assert.equal((await p.request('/campaigns/'+owned.id+'/enter',{})).actor.role,'dm');await p.request(f.path+'/session',{active:false},403)
})
test('A DM-targeted claims require authorization and never merge existing memberships by display name or email',async t=>{
 const f=await fixture(t),legacy=await f.player(),i=await f.invitation();await legacy.request('/invitations/redeem',{token:i.token,displayName:'Same name'},201);const target=legacy.actor!.id
 const stranger=await f.player();await stranger.request('/auth/player-register',{claimLegacy:true,email:randomUUID()+'@example.test',password,displayName:'Same name'},403)
 const claim=await f.invitation(target),email=randomUUID()+'@example.test';const account=await stranger.request('/auth/player-register',{token:claim.token,email,password,displayName:'Same name'},201);assert.equal(account.actor.id,target)
 const other=await f.player(),j=await f.invitation();await other.request('/invitations/redeem',{token:j.token,displayName:'Same name'},201);const otherId=other.actor!.id
 await other.request('/accounts/claim',{claimLegacy:true,email,password},409);assert.equal((await f.pool.query('SELECT account_id FROM memberships WHERE id=$1',[otherId])).rows[0].account_id,null)
 const foreign=await f.dm.request('/campaigns',{name:'Foreign campaign'},201);await f.dm.request('/campaigns/'+foreign.id+'/invitations',{membershipId:otherId},409)
 await stranger.request(f.path+'/invitations',{membershipId:otherId},403)
 const cookie=stranger.cookie;await stranger.request('/accounts/claim',{claimLegacy:true,email,password,membershipId:otherId},400);assert.equal(stranger.cookie,cookie)
})
test('A shared login and account registration limits reject brute force without disclosing credentials',async t=>{
 const f=await fixture(t),p=await f.player()
 for(let i=0;i<29;i++)await p.request('/auth/login',{email:'unknown@example.test',password},401)
 await p.request('/auth/login',{email:'unknown@example.test',password},429)
})
