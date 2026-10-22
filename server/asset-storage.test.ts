import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { FilesystemAssetStorage } from './asset-storage.ts'
test('filesystem assets stream, persist, delete and reject oversized/traversal/symlink writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ledger-assets-'))
  try {
    assert.throws(() => new FilesystemAssetStorage(join(process.cwd(), 'public')), /outside the application/)
    const storage = new FilesystemAssetStorage(root)
    await assert.rejects(storage.exists('../secret'))
    await assert.rejects(storage.stage(Readable.from([Buffer.alloc(101)]), 100), /size limit/)
    assert.deepEqual(await readdir(join(root, 'staging')), [])
    const staged = await storage.stage(Readable.from([Buffer.from('test')]), 100)
    const owner = randomUUID(), key = await storage.publish(staged, owner)
    const restarted = new FilesystemAssetStorage(root)
    assert.equal(await restarted.exists(key), true)
    const chunks = []; for await (const c of await restarted.read(key)) chunks.push(c)
    assert.equal(Buffer.concat(chunks).toString(), 'test')
    await restarted.remove(key); assert.equal(await restarted.exists(key), false)
    const other = randomUUID(); await symlink(tmpdir(), join(root, other))
    await assert.rejects(storage.exists(`${other}/${'a'.repeat(64)}.glb`), /unavailable/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
