import type {TestContext} from 'node:test'
import {randomUUID} from 'node:crypto'
import type {AddressInfo} from 'node:net'
import pg from 'pg'
import argon2 from 'argon2'
import {createApplication} from '../app.ts'
import {migrate} from '../migrate.ts'
import {Browser} from './player-client.ts'
const password='Player Account Fixture Password 2055!',origin='http://localhost:5173'
export async function accountFixture(t:TestContext){
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='account_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`)
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});await migrate(pool)
 const owner=randomUUID(),email=randomUUID()+'@example.test';await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[owner,email,await argon2.hash(password,{type:argon2.argon2id})])
 let app=createApplication({pool,origin,secret:'player-account-isolated-secret-fixture-2055',allowDMRegistration:false});await new Promise<void>(r=>app.http.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(app.http.address() as AddressInfo).port}`
 t.after(async()=>{await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end()})
 const dm=await new Browser(base).init();await dm.request('/auth/login',{email,password});const c=await dm.request('/campaigns',{name:'Account campaign'},201),path='/campaigns/'+c.id
 const invitation=async(membershipId?:string)=>{const i=await dm.request(path+'/invitations',membershipId?{membershipId}:{},201);return{...i,token:new URLSearchParams(new URL(i.url).hash.slice(1)).get('invite')!}}
 const player=async()=>new Browser(base).init()
 const restart=async()=>{await app.close();app=createApplication({pool,origin,secret:'player-account-isolated-secret-fixture-2055',allowDMRegistration:false});await new Promise<void>(r=>app.http.listen(Number(new URL(base).port),'127.0.0.1',r))}
 return{pool,dm,base,path,c,invitation,player,get app(){return app},restart}
}
