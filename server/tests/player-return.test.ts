import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import type {Socket} from 'socket.io-client'
import {Browser,waitFor} from './player-client.ts'
import type {AddressInfo} from 'node:net'
import {createApplication} from '../app.ts'
import {migrate} from '../migrate.ts'
import {blankDungeon} from '../../shared/dungeon.ts'
const origin='http://localhost:5173'
test('Phase 0: retained legacy cookie rejoins session two; expired identity needs reinvitation and loses assignment',{timeout:30000},async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='return_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`)
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});const app=createApplication({pool,origin,secret:'return-session-isolated-fixture-secret-2048'});const sockets:Socket[]=[]
 try{
  await migrate(pool);await new Promise<void>(r=>app.http.listen(0,'127.0.0.1',r));const port=(app.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`
  const dm=await new Browser(base).init(),player=await new Browser(base).init()
  await dm.request('/auth/register',{email:randomUUID()+'@example.test',password:'Return Fixture Password 2048!'},201)
  const c=await dm.request('/campaigns',{name:'Two sessions'},201),path='/campaigns/'+c.id
  const fixture={version:1,round:3,combatants:[{id:'hero',name:'Hero',side:'hero',hp:10,maxHp:10,ac:12,initiative:14,conditions:[],saves:[],actions:[]}],dungeonMap:blankDungeon('first-map','First map',8,8)}
  await dm.request(path+'/encounters',{name:'First',file:fixture},201);await dm.request(path+'/session',{active:true})
  const invite=await dm.request(path+'/invitations',{},201),token=new URLSearchParams(new URL(invite.url).hash.slice(1)).get('invite')!
  await player.request('/invitations/redeem',{token,displayName:'Returning player'},201);const memberId=player.actor!.id
  await pool.query('UPDATE combatants SET owner_id=$1 WHERE id=$2',[memberId,'hero'])
  const first=await player.connect(c.id);sockets.push(first.socket);assert.equal(first.snapshot!.state.dungeonMap!.id,'first-map')
  await dm.request(path+'/session',{active:false});await waitFor(()=>first.ended,'No session end');first.socket.disconnect()
  // A new encounter while the player is away must supersede the bookmarked encounter.
  await dm.request(path+'/encounters',{name:'Second',file:{...fixture,dungeonMap:blankDungeon('second-map','Second map',8,8)}},201)
  await dm.request(path+'/session',{active:true});const second=await player.connect(c.id);sockets.push(second.socket);assert.equal(second.snapshot!.state.dungeonMap!.id,'second-map');second.socket.disconnect()
  assert.equal((await pool.query('SELECT revoked_at FROM memberships WHERE id=$1',[memberId])).rows[0].revoked_at,null)
  await pool.query("UPDATE auth_sessions SET expires_at=now()-interval '1 minute' WHERE data->'actor'->>'id'=$1",[memberId])
  assert.equal((await player.request('/session')).actor,null);await player.request(path+'/snapshot',undefined,401)
  await player.request('/invitations/redeem',{token,displayName:'Returning player'},403)
  const replacement=await dm.request(path+'/invitations',{},201),replacementToken=new URLSearchParams(new URL(replacement.url).hash.slice(1)).get('invite')!
  await player.request('/invitations/redeem',{token:replacementToken,displayName:'Returning player'},201)
  assert.notEqual(player.actor!.id,memberId);assert.equal((await pool.query('SELECT owner_id FROM combatants WHERE encounter_id=(SELECT id FROM encounters WHERE name=$1) AND id=$2',['First','hero'])).rows[0].owner_id,memberId)
 }finally{for(const s of sockets)s.disconnect();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end()}
})
