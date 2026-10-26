// Read-only battlefield verification, using pre-provisioned synthetic identities.
// Config is stdin; never command arguments, container environment or artifact output.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {io} from 'socket.io-client'
const config=JSON.parse(readFileSync(0,'utf8')),origin=new URL(config.origin)
assert.equal(origin.protocol,'https:');assert.equal(origin.origin,config.origin)
const sockets=[]
try {
  const response=await fetch(origin,{signal:AbortSignal.timeout(15000)})
  assert.equal(response.status,200);assert.match(await response.text(),/id="root"/)
  assert.equal((await fetch(new URL('/api/health',origin),{signal:AbortSignal.timeout(15000)})).status,200)
  for(const identity of [{role:'dm',email:config.email,password:config.password},{role:'player',cookie:config.playerCookie}]) {
    let cookie=identity.cookie??'',csrf=''
    async function request(path,body){
      const r=await fetch(new URL('/api'+path,origin),{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:config.origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)})
      assert.equal(r.status,200,'Verification API request failed')
      const cookies=r.headers.getSetCookie()
      if(cookies.length){assert.match(cookies[0],/; Secure/);assert.match(cookies[0],/; HttpOnly/);cookie=cookies.map(c=>c.split(';')[0]).join('; ')}
      const value=await r.json();if(value.csrf)csrf=value.csrf;return value
    }
    await request('/session')
    if(identity.role==='dm')await request('/auth/login',{email:identity.email,password:identity.password})
    assert.equal((await request('/session')).actor?.role,identity.role)
    const socket=io(config.origin,{autoConnect:false,transports:['websocket'],reconnection:false,auth:{csrf},extraHeaders:{Origin:config.origin,Cookie:cookie}})
    sockets.push(socket)
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Verification WebSocket timeout')),15000)
      socket.once('connect',()=>{clearTimeout(timer);resolve()})
      socket.once('connect_error',()=>{clearTimeout(timer);reject(Error('Verification WebSocket authentication failed'))})
      socket.connect()
    })
    assert.equal((await socket.timeout(15000).emitWithAck('campaign.join',config.campaignId)).ok,true)
    const snapshot=await request('/campaigns/'+encodeURIComponent(config.campaignId)+'/snapshot')
    assert(snapshot.encounterId,'Pre-provisioned live verification encounter required')
    socket.disconnect()
    if(identity.role==='dm')await request('/auth/logout',{})
  }
  console.log('PASS public TLS/frontend/health, Secure-cookie DM/player authentication and authorised read-only WebSockets')
} finally {for(const socket of sockets)socket.disconnect()}
