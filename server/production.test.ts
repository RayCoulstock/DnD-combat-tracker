import test from 'node:test'
import assert from 'node:assert/strict'
import {createApplication} from './app.ts'
import {assertMigrationsCurrent} from './migrate.ts'
import type {Pool} from './db.ts'
import {readdir} from 'node:fs/promises'
import type {AddressInfo} from 'node:net'
test('readiness fails safely on database outage while liveness remains available',async()=>{
  const pool={query:async()=>{throw new Error('postgresql://private-password@private-host')}} as unknown as Pool
  const app=createApplication({pool,secret:'x'.repeat(64),origin:'https://ledger.example.com',production:true})
  try{
    await new Promise<void>(resolve=>app.http.listen(0,'127.0.0.1',resolve))
    const base=`http://127.0.0.1:${(app.http.address()as AddressInfo).port}`
    const ready=await fetch(base+'/api/health');assert.equal(ready.status,503);assert.deepEqual(await ready.json(),{ok:false})
    const live=await fetch(base+'/api/health/live');assert.equal(live.status,200)
  }finally{await app.close()}
})
test('compiled startup requires every shipped migration without applying or deleting data',async()=>{
  const files=(await readdir(new URL('./migrations/',import.meta.url))).filter(f=>f.endsWith('.sql'))
  await assertMigrationsCurrent({query:async()=>({rows:files.map(name=>({name}))})}as unknown as Pool)
  await assert.rejects(()=>assertMigrationsCurrent({query:async()=>({rows:files.slice(0,-1).map(name=>({name}))})}as unknown as Pool),/migrations are pending/)
})
