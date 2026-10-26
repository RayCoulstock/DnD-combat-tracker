import test from 'node:test'
import assert from 'node:assert/strict'
import {runtimeConfig} from './runtime-config.ts'
const valid={NODE_ENV:'production',DATABASE_URL:'postgresql://example:secret@postgres/ledger',SESSION_SECRET:'a'.repeat(64),APP_ORIGIN:'https://ledger.example.com',ASSET_STORAGE_DIR:'/var/lib/encounter-ledger/assets'}
test('production configuration retains secure one-hop defaults and explicit proxy options',()=>{
  assert.equal(runtimeConfig(valid).trustProxy,1)
  assert.equal(runtimeConfig({...valid,TRUST_PROXY:'0'}).trustProxy,0)
  assert.equal(runtimeConfig({...valid,TRUST_PROXY:'loopback'}).trustProxy,'loopback')
  assert.equal(runtimeConfig({...valid,NODE_ENV:'development',ASSET_STORAGE_DIR:undefined}).assetDirectory,'../.ledger-assets')
})
test('invalid production configuration fails without echoing secrets',()=>{
  for(const overrides of [{NODE_ENV:'prod'},{DATABASE_URL:''},{SESSION_SECRET:'replace-with-'+'x'.repeat(40)},{APP_ORIGIN:'http://example.com'},{APP_ORIGIN:'https://example.com/'},{PORT:'NaN'},{PORT:'0'},{TRUST_PROXY:'true'},{ASSET_STORAGE_DIR:'relative'}])assert.throws(()=>runtimeConfig({...valid,...overrides}))
  assert.throws(()=>runtimeConfig({...valid,APP_ORIGIN:'private-sensitive-value'}),e=>e instanceof Error&&!e.message.includes('private-sensitive-value'))
})
