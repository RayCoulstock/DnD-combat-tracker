import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyMigrations } from './copy-migrations.mjs'
test('portable build copies SQL exactly, including paths with spaces, and removes stale output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ledger build '))
  try {
    await mkdir(join(root, 'server/migrations'), {recursive:true})
    await mkdir(join(root, 'dist-server/server/migrations'), {recursive:true})
    await writeFile(join(root, 'server/migrations/001_test.sql'), 'SELECT 1;\n')
    await writeFile(join(root, 'server/migrations/README.md'), 'not a migration')
    await writeFile(join(root, 'dist-server/server/migrations/stale.sql'), 'old')
    await copyMigrations(root)
    assert.deepEqual(await readdir(join(root, 'dist-server/server/migrations')), ['001_test.sql'])
    assert.equal(await readFile(join(root, 'dist-server/server/migrations/001_test.sql'), 'utf8'), 'SELECT 1;\n')
    await copyMigrations(root)
  } finally { await rm(root, {recursive:true, force:true}) }
})
