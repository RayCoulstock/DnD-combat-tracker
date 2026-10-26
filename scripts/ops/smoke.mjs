// Local TLS validation only. Never creates accounts or restarts an app on a public origin.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {randomUUID,createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {io} from 'socket.io-client'
import {makeGlb} from '../../test-fixtures/glb.ts'
const origin=process.env.APP_ORIGIN,url=new URL(origin),mode=process.argv[2]??'create',file=process.env.LEDGER_SMOKE_STATE
assert(url.protocol==='https:'&&url.hostname==='localhost'&&Number(url.port)>1024,'Smoke writes are allowed only on loopback HTTPS high ports')
assert(/^(ledger-smoke-|ledger-restore-)/.test(process.env.LEDGER_PROJECT_NAME??''),'An isolated test project is required')
assert(file,'Set a private fixture-state file')
const sockets=[]
async function browser(){
 const client={cookie:'',csrf:''}
 client.request=async(path,body,expected=200,extra={})=>{
  const response=await fetch(origin+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:client.cookie,Origin:origin,'X-CSRF-Token':client.csrf,...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)})
  const cookies=response.headers.getSetCookie();if(cookies.length){assert.match(cookies[0],/; Secure/);assert.match(cookies[0],/; HttpOnly/);assert.match(cookies[0],/; SameSite=Lax/);client.cookie=cookies.map(c=>c.split(';')[0]).join('; ')}
  const value=await response.json();assert.equal(response.status,expected,'Unexpected API status');if(value.csrf)client.csrf=value.csrf;return value
 }
 // A forged forwarding scheme must not suppress Secure cookies through Caddy.
 await client.request('/session',undefined,200,{'X-Forwarded-Proto':'http','X-Forwarded-For':'203.0.113.7'})
 return client
}
async function connect(client,campaign){
 const socket=io(origin,{transports:['websocket'],auth:{csrf:client.csrf},extraHeaders:{Origin:origin,Cookie:client.cookie},reconnection:true,reconnectionDelay:200,reconnectionDelayMax:1000})
 sockets.push(socket)
 await new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error('TLS WebSocket handshake timed out')),10000);socket.once('connect',()=>{clearTimeout(t);res()});socket.once('connect_error',()=>{clearTimeout(t);rej(Error('Authenticated WebSocket handshake failed'))})})
 const result=await socket.timeout(10000).emitWithAck('campaign.join',campaign);assert.equal(result.ok,true);return socket
}
async function command(socket,dm,path,value){
 const snap=await dm.request(path+'/snapshot')
 return socket.timeout(10000).emitWithAck('game.command',{commandId:randomUUID(),encounterId:snap.encounterId,revision:snap.revision,command:value})
}
async function assetBytes(client,state){
 const response=await fetch(origin+`/api/assets/${state.asset}/file?campaignId=${state.campaign}&encounterId=${state.encounter}`,{headers:{Cookie:client.cookie},signal:AbortSignal.timeout(15000)})
 assert.equal(response.status,200);return Buffer.from(await response.arrayBuffer())
}
try{
 const health=await fetch(origin+'/api/health');assert.equal(health.status,200)
 assert.match(await(await fetch(origin)).text(),/id="root"/)
 const dm=await browser()
 await dm.request('/session',undefined,200,{'X-CSRF-Token':'ledger-private-log-sentinel'})
 if(mode==='create'){
  const state={email:randomUUID()+'@example.test',password:randomUUID()+randomUUID()}
  await dm.request('/auth/register',{email:state.email,password:state.password},201)
  const campaign=await dm.request('/campaigns',{name:'Isolated TLS smoke'},201);state.campaign=campaign.id
  const path='/campaigns/'+state.campaign
  const encounter=await dm.request(path+'/encounters',{name:'TLS fixture',file:{version:1,round:1,combatants:[{id:1,name:'TLS hero',side:'hero',hp:10,maxHp:10,ac:15,initiative:10,conditions:[],saves:[],actions:[]}]}},201);state.encounter=encounter.id
  await dm.request(path+'/session',{active:true})
  const bytes=makeGlb(),upload=new FormData();upload.set('metadata',JSON.stringify({name:'TLS model',category:'miniature'}));upload.set('file',new Blob([bytes]),'fixture.glb')
  const response=await fetch(origin+'/api/assets',{method:'POST',headers:{Cookie:dm.cookie,Origin:origin,'X-CSRF-Token':dm.csrf},body:upload});assert.equal(response.status,201);state.asset=(await response.json()).id;state.assetHash=createHash('sha256').update(bytes).digest('hex')
  assert.deepEqual(await assetBytes(dm,state),bytes)
  assert([401,403,404].includes((await fetch(origin+`/api/assets/${state.asset}/file`)).status))
  await dm.request(path+'/session',{active:true},403,{Origin:'https://foreign.example'})
  const player=await browser(),invite=await dm.request(path+'/invitations',{},201)
  const joined=await player.request('/invitations/redeem',{token:new URLSearchParams(new URL(invite.url).hash.slice(1)).get('invite'),displayName:'TLS player'},201)
  const ds=await connect(dm,state.campaign),ps=await connect(player,state.campaign)
  assert((await command(ds,dm,path,{type:'combatant.miniature.update',combatantId:'1',miniature:{assetId:state.asset,scale:1,rotation:0,verticalOffset:0,showBase:true,baseSize:'Medium'}})).ok)
  assert((await command(ds,dm,path,{type:'token.assign',combatantId:'1',playerId:joined.actor.id})).ok)
  assert((await command(ps,dm,path,{type:'token.move',combatantId:'1',destination:{x:8,z:8}})).ok)
  assert.equal((await command(ps,dm,path,{type:'initiative.next'})).ok,false)
  assert.deepEqual((await dm.request(path+'/snapshot')).state.battleMap.tokens['1'],{x:8,z:8})
  assert.deepEqual(await assetBytes(player,state),bytes)
  await player.request('/assets',undefined,403)
  await writeFile(file,JSON.stringify(state),{mode:0o600})
  console.log('PASS TLS, Secure-cookie DM/player auth, CSRF/origin, scoped GLB upload/retrieval and live authorised WebSocket commands')
 }else{
  const state=JSON.parse(await readFile(file,'utf8'));await dm.request('/auth/login',{email:state.email,password:state.password})
  const socket=await connect(dm,state.campaign)
  if(mode==='restart'||mode==='restart-proxy'){
   const disconnected=new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error('Socket did not close on shutdown')),60000);socket.once('disconnect',()=>{clearTimeout(timer);res()})})
   const result=spawnSync('bash',['scripts/ops/compose.sh','restart','-t','35',mode==='restart-proxy'?'caddy':'app'],{stdio:'pipe',encoding:'utf8',timeout:60000})
   assert.equal(result.status,0,'Local app restart failed');await disconnected
   for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health',{signal:AbortSignal.timeout(500)})).ok)break}catch{/* Restart may briefly return 502 or refuse a connection. */}await new Promise(r=>setTimeout(r,100))}
  }
  const snapshot=await dm.request('/campaigns/'+state.campaign+'/snapshot');assert.deepEqual(snapshot.state.battleMap.tokens['1'],{x:8,z:8});assert.equal(snapshot.state.combatants[0].miniature.assetId,state.asset)
  assert.equal(createHash('sha256').update(await assetBytes(dm,state)).digest('hex'),state.assetHash)
  assert.equal((await dm.request('/session')).actor.role,'dm')
  console.log('PASS persisted encounter, model assignment, GLB bytes and authenticated session after restart/restore')
 }
}finally{for(const socket of sockets)socket.disconnect()}
