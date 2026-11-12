import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readdir,readFile} from 'node:fs/promises'
import pg from 'pg'
import {migrate} from '../migrate.ts'
import {blankDungeon} from '../../shared/dungeon.ts'
test('014 upgrades populated pre-account data additively without replacing memberships, credentials, owners or maps',async()=>{
 const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='upgrade_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`)
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`})
 try{
  await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())')
  for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')&&f<'014').sort()){await pool.query(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));await pool.query('INSERT INTO schema_migrations(name) VALUES($1)',[file])}
  const user=randomUUID(),campaign=randomUUID(),member=randomUUID(),encounter=randomUUID(),invitation=randomUUID(),map=blankDungeon('preserve','Preserve',8,8)
  await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[user,'existing@example.test','untouched-credential-hash'])
  await pool.query('INSERT INTO campaigns(id,owner_id,name) VALUES($1,$2,$3)',[campaign,user,'Existing'])
  await pool.query('INSERT INTO memberships(id,campaign_id,display_name) VALUES($1,$2,$3)',[member,campaign,'Existing player'])
  await pool.query("INSERT INTO invitations(id,campaign_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[invitation,campaign,'existing-invitation-hash'])
  await pool.query("INSERT INTO auth_sessions(sid_hash,data,expires_at) VALUES($1,$2,now()+interval '1 day')",['existing-session-hash',{actor:{role:'player',id:member},campaignId:campaign}])
  await pool.query('INSERT INTO encounters(id,campaign_id,name,state) VALUES($1,$2,$3,$4)',[encounter,campaign,'Existing encounter',{version:1,round:4}])
  await pool.query('INSERT INTO combatants(encounter_id,id,ordinal,data,owner_id,position) VALUES($1,$2,0,$3,$4,$5)',[encounter,'hero',{name:'Existing hero'},member,{x:3,z:4}])
  await pool.query('INSERT INTO encounter_maps(encounter_id,document,history,schema_version) VALUES($1,$2,$3,1)',[encounter,map,{undo:[],redo:[]}])
  const before={owner:(await pool.query('SELECT owner_id,position FROM combatants')).rows[0],session:(await pool.query('SELECT data FROM auth_sessions')).rows[0],map:(await pool.query('SELECT document FROM encounter_maps')).rows[0]}
  await migrate(pool);await migrate(pool)
  const account=(await pool.query('SELECT * FROM users WHERE id=$1',[user])).rows[0],membership=(await pool.query('SELECT * FROM memberships WHERE id=$1',[member])).rows[0]
  assert.equal(account.password_hash,'untouched-credential-hash');assert.equal(account.disabled_at,null);assert.equal(membership.account_id,null);assert.equal(membership.display_name,'Existing player')
  assert.deepEqual((await pool.query('SELECT owner_id,position FROM combatants')).rows[0],before.owner);assert.deepEqual((await pool.query('SELECT data FROM auth_sessions')).rows[0],before.session);assert.deepEqual((await pool.query('SELECT document FROM encounter_maps')).rows[0],before.map)
  assert.equal((await pool.query('SELECT token_hash FROM invitations WHERE id=$1',[invitation])).rows[0].token_hash,'existing-invitation-hash')
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end()}
})
