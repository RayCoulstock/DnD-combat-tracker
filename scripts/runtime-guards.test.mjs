import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import process from 'node:process'
import {fileURLToPath,URL} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
test('migration CLI refuses a missing connection URL without falling back to another database',()=>{
  const env={...process.env};delete env.DATABASE_URL
  const result=spawnSync(process.execPath,['--import','tsx','server/migrate.ts'],{cwd:root,env,encoding:'utf8',timeout:10000})
  assert.equal(result.status,1);assert.match(result.stderr,/Set DATABASE_URL/)
})
test('development seed refuses production before connecting or exposing credentials',()=>{
  const result=spawnSync(process.execPath,['--import','tsx','server/seed.ts'],{cwd:root,env:{...process.env,NODE_ENV:'production',DATABASE_URL:'postgresql://sensitive-user:sensitive-password@invalid.invalid/test',SEED_DM_EMAIL:'test@example.com',SEED_DM_PASSWORD:'never-print-this-password'},encoding:'utf8',timeout:10000})
  assert.equal(result.status,1);assert.match(result.stderr,/Development seeding is disabled/);assert.doesNotMatch(result.stderr,/sensitive-password|never-print-this-password/)
})
