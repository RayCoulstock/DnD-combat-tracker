import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionBootstrap} from '../src/sessionBootstrap.ts'
const anonymous={csrf:'anonymous-csrf',actor:null,campaignId:null,allowDMRegistration:true}
test('Strict Mode concurrent session consumers share one request and the same CSRF/identity',async()=>{
 let calls=0,finish
 const bootstrap=createSessionBootstrap(()=>{calls++;return new Promise(resolve=>{finish=resolve})})
 const first=bootstrap(),replayed=bootstrap()
 assert.equal(first,replayed)
 await Promise.resolve();assert.equal(calls,1)
 finish(anonymous)
 assert.equal(await first,await replayed)
})
test('completed session bootstraps do not cache old anonymous or authenticated identities',async()=>{
 let calls=0,value=anonymous
 const bootstrap=createSessionBootstrap(async()=>{calls++;return value})
 assert.equal((await bootstrap()).actor,null)
 value={...anonymous,csrf:'authenticated-csrf',actor:{id:'existing-dm',role:'dm'}}
 assert.equal((await bootstrap()).actor.id,'existing-dm')
 value=anonymous
 assert.equal((await bootstrap()).actor,null);assert.equal(calls,3)
})
test('failed bootstraps release the shared request so a later visit can recover',async()=>{
 let calls=0
 const bootstrap=createSessionBootstrap(async()=>{if(++calls===1)throw Error('Unavailable');return anonymous})
 const first=bootstrap(),second=bootstrap()
 await Promise.all([assert.rejects(first,/Unavailable/),assert.rejects(second,/Unavailable/)])
 assert.equal(calls,1)
 assert.equal(await bootstrap(),anonymous);assert.equal(calls,2)
})
