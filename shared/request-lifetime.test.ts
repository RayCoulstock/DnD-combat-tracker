import test from 'node:test'
import assert from 'node:assert/strict'
import {RequestLifetime,identityKey} from '../src/requestLifetime.ts'
test('context change aborts all pending requests and invalidates delayed responses/errors',()=>{
 const lifetime=new RequestLifetime(),old=lifetime.current(),a=lifetime.start(),b=lifetime.start();lifetime.advance()
 assert.equal(a.signal.aborted,true);assert.equal(b.signal.aborted,true);assert.equal(lifetime.valid(old),false);assert.throws(()=>lifetime.start(old),{name:'AbortError'});a.finish();b.finish()
})
test('released requests do not affect a newer identity; external cancellation stays request-scoped',()=>{
 const lifetime=new RequestLifetime(),controller=new AbortController(),a=lifetime.start(undefined,controller.signal),b=lifetime.start()
 controller.abort();assert.equal(a.signal.aborted,true);assert.equal(b.signal.aborted,false);a.finish();b.finish();const current=lifetime.current();assert.equal(lifetime.valid(current),true);lifetime.advance();assert.equal(lifetime.valid(current),false)
 const next=lifetime.start();assert.equal(next.signal.aborted,false);next.finish()
})

test('identity keys distinguish accounts from legacy members even when IDs coincide',()=>{assert.notEqual(identityKey('same','same'),identityKey(null,'same'));assert.equal(identityKey('account','member-a'),identityKey('account','member-b'));assert.equal(identityKey(null,null),null)})
