import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
import type {AddressInfo} from 'node:net'
import {createApplication} from '../app.ts'
import {migrate} from '../migrate.ts'

test('production HTTPS proxy issues secure authenticated cookies; untrusted forwarding cannot',async()=>{
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='proxy_'+randomUUID().replaceAll('-','')
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`})
  const origin='https://ledger.example.com',secret=randomUUID()+randomUUID()
  const trusted=createApplication({pool,origin,secret,production:true,trustProxy:1}),untrusted=createApplication({pool,origin,secret,production:true,trustProxy:0})
  try{
    await migrate(pool)
    for(const instance of[trusted,untrusted])await new Promise<void>(resolve=>instance.http.listen(0,'127.0.0.1',resolve))
    const base=`http://127.0.0.1:${(trusted.http.address()as AddressInfo).port}`
    const session=await fetch(base+'/api/session',{headers:{'X-Forwarded-Proto':'https'}}),cookies=session.headers.getSetCookie()
    assert.equal(cookies.length,1);assert.match(cookies[0],/; Secure/);assert.match(cookies[0],/; HttpOnly/);assert.match(cookies[0],/; SameSite=Lax/)
    const {csrf}=await session.json(),cookie=cookies[0].split(';')[0]
    const registered=await fetch(base+'/api/auth/register',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-Forwarded-Proto':'https','Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({email:randomUUID()+'@example.test',password:'Production Proxy Password 2049!'})})
    assert.equal(registered.status,201);assert.equal((await registered.json()).actor.role,'dm')
    const forged=await fetch(`http://127.0.0.1:${(untrusted.http.address()as AddressInfo).port}/api/session`,{headers:{'X-Forwarded-Proto':'https'}})
    assert.equal(forged.headers.getSetCookie().length,0)
    const badOrigin=await fetch(base+'/api/auth/register',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.example','X-Forwarded-Proto':'https','Content-Type':'application/json','X-CSRF-Token':csrf},body:'{}'})
    assert.equal(badOrigin.status,403)
  }finally{await trusted.close();await untrusted.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end()}
})
