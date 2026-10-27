import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import type {AddressInfo} from 'node:net'
import pg from 'pg'
import {io, type Socket} from 'socket.io-client'
import {createApplication} from '../app.ts'
import {migrate} from '../migrate.ts'

test('private beta rejects direct registration while existing DM login, invitations and sockets survive restart',async()=>{
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='registration_'+randomUUID().replaceAll('-','')
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`})
  const origin='https://beta.example.test',secret=randomUUID()+randomUUID(),account={email:'existing@example.test',password:'Existing Beta Account Password 2049!'}
  let app=createApplication({pool,secret,origin})
  let base='',cookie='',csrf=''
  const sockets:Socket[]=[]
  async function start(){await new Promise<void>(resolve=>app.http.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(app.http.address() as AddressInfo).port}`}
  async function request(path:string,body?:unknown,status=200){
    const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'X-Forwarded-Proto':'https','X-CSRF-Token':csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
    const cookies=response.headers.getSetCookie();if(cookies.length)cookie=cookies.map(c=>c.split(';')[0]).join('; ')
    const data=await response.json();assert.equal(response.status,status);if(data.csrf)csrf=data.csrf;return data
  }
  async function socketFor(campaignId:string){
    const socket=io(base,{autoConnect:false,transports:['websocket'],reconnection:false,extraHeaders:{Cookie:cookie,Origin:origin,'X-Forwarded-Proto':'https'},auth:{csrf}})
    sockets.push(socket)
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Authenticated socket timeout')),8000);socket.once('connect',()=>{clearTimeout(timer);resolve()});socket.once('connect_error',()=>{clearTimeout(timer);reject(Error('Authenticated socket rejected'))});socket.connect()})
    assert.equal((await socket.timeout(8000).emitWithAck('campaign.join',campaignId)).ok,true)
  }
  try{
    await migrate(pool);await start()
    assert.equal((await request('/session')).allowDMRegistration,true)
    const existing=await request('/auth/register',account,201)
    const campaign=await request('/campaigns',{name:'Existing beta campaign'},201)
    const invitation=await request(`/campaigns/${campaign.id}/invitations`,{},201)
    const existingCookie=cookie,existingCsrf=csrf
    await app.close()
    // Production defaults closed even without an explicit option or frontend cooperation.
    app=createApplication({pool,secret,origin,production:true});await start()
    const session=await request('/session')
    assert.equal(session.allowDMRegistration,false);assert.equal(session.actor.id,existing.actor.id)
    await socketFor(campaign.id)
    // Valid authenticated session + CSRF, aliases and client-supplied flags cannot override policy.
    for(const path of ['/auth/register','/auth/register?ALLOW_DM_REGISTRATION=true','/AUTH/REGISTER','/auth/register/']){
      const denied=await request(path,{...account,email:randomUUID()+'@example.test',allowDMRegistration:true,role:'dm'},403)
      assert.equal(denied.error.code,'REGISTRATION_DISABLED');assert.match(denied.error.message,/registration is closed/)
    }
    // Closed requests remain 403 and do not exhaust the shared login/invite rate limit.
    for(let i=0;i<32;i++)await request('/auth/register',{email:'valid@example.test',password:'Valid New Password 2049!'},403)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM users')).rows[0].count,1)
    // No session at all and forged CSRF cannot create an account either.
    cookie='';csrf='';await request('/auth/register',account,403)
    await request('/session');await request('/auth/register',account,403)
    await request('/auth/login',account)
    assert.equal((await request('/session')).actor.id,existing.actor.id)
    await socketFor(campaign.id)
    await request('/auth/logout',{})
    await request('/session')
    const player=await request('/invitations/redeem',{token:new URL(invitation.url).hash.slice('#invite='.length),displayName:'Invited beta player'},201)
    assert.equal(player.actor.role,'player');assert.equal(player.campaignId,campaign.id)
    await socketFor(campaign.id)
    await request('/auth/register',{...account,role:'dm'},403)
    assert.equal((await request('/session')).actor.role,'player')
    // A pre-existing, non-logged-out DM session is still valid after closing registration.
    cookie=existingCookie;csrf=existingCsrf
    // Logout above revoked the login session, not this independent original session.
    assert.equal((await request('/session')).actor.id,existing.actor.id)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM users')).rows[0].count,1)
    assert.equal((await pool.query('SELECT name FROM campaigns WHERE id=$1',[campaign.id])).rows[0].name,'Existing beta campaign')
  }finally{for(const socket of sockets)socket.disconnect();await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end()}
})
