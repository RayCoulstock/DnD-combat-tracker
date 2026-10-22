import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import pg from 'pg'
import { createApplication } from '../app.ts'
import { migrate } from '../migrate.ts'
import { FilesystemAssetStorage } from '../asset-storage.ts'
import { recoverAssets } from '../assets.ts'
import { assetLimits } from '../asset-config.ts'
import { makeGlb, triangleDocument } from '../../test-fixtures/glb.ts'
const origin = 'http://localhost:5173', secret = 'asset-test-secret-'.repeat(4)
class Client {
  cookie = ''; csrf = ''
  constructor(public base: string) {}
  async request(path: string, body?: unknown, status = 200) {
    const response = await fetch(this.base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, Cookie: this.cookie, 'X-CSRF-Token': this.csrf, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const cookies = response.headers.getSetCookie(); if (cookies.length) this.cookie = cookies.map(c => c.split(';')[0]).join('; ')
    const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); if (data.csrf) this.csrf = data.csrf; return data
  }
  async upload(file = makeGlb(), filename = 'Meshy.glb', metadata: unknown = { name: 'Meshy chair', category: 'furniture', tags: ['wood'], source: 'Meshy AI' }, status = 201) {
    const data = new FormData(); data.set('metadata', JSON.stringify(metadata)); data.set('file', new Blob([new Uint8Array(file)], { type: 'application/octet-stream' }), filename)
    const response = await fetch(this.base + '/api/assets', { method: 'POST', headers: { Origin: origin, Cookie: this.cookie, 'X-CSRF-Token': this.csrf }, body: data })
    const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result
  }
  async file(id: string, status = 200) { const response = await fetch(`${this.base}/api/assets/${id}/file`, { headers: { Cookie: this.cookie } }); assert.equal(response.status, status); return response }
}
test('private GLB library upload, authorisation, persistence and cleanup', { timeout: 60000 }, async t => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL }), schema = `assets_${randomUUID().replaceAll('-', '')}`
  let failPublish = false, failDelete = false
  class FaultStorage extends FilesystemAssetStorage {
    override async publish(...args: Parameters<FilesystemAssetStorage['publish']>) { if (failPublish) throw new Error('Private internal storage failure'); return super.publish(...args) }
    override async remove(key: string) { if (failDelete && !key.startsWith('staging/')) throw new Error('Private delete failure'); return super.remove(key) }
  }
  const root = await mkdtemp(join(tmpdir(), 'ledger-asset-api-')), storage = new FaultStorage(root)
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` })
  const options = { pool, secret, origin, assetStorage: storage, assetValidationLimits: { ...assetLimits({}), maxBytes: 2048 } }
  let application = createApplication(options), asset: { id: string; revision: number }
  try {
    await migrate(pool); await new Promise<void>(r => application.http.listen(0, '127.0.0.1', r))
    const port = (application.http.address() as AddressInfo).port, base = `http://127.0.0.1:${port}`
    const dm = new Client(base), other = new Client(base), player = new Client(base), anonymous = new Client(base)
    for (const client of [dm, other, player, anonymous]) await client.request('/session')
    for (const client of [dm, other]) await client.request('/auth/register', { email: randomUUID()+'@example.test', password: 'Asset Library Password 2049!' }, 201)
    const campaign = await dm.request('/campaigns', { name: 'Asset access campaign' }, 201)
    const invitation = await dm.request(`/campaigns/${campaign.id}/invitations`, {}, 201)
    await player.request('/invitations/redeem', { token: invitation.url.split('#invite=')[1], displayName: 'Asset player' }, 201)
    await t.test('anonymous and player library/upload access denied; CSRF enforced', async () => {
      await anonymous.request('/assets', undefined, 401); await anonymous.upload(undefined, undefined, undefined, 401)
      await player.request('/assets', undefined, 403); await player.upload(undefined, undefined, undefined, 403)
      const data = new FormData(); data.set('file', new Blob([new Uint8Array(makeGlb())]), 'test.glb')
      assert.equal((await fetch(base+'/api/assets', { method: 'POST', headers: { Cookie: dm.cookie, Origin: origin }, body: data })).status, 403)
    })
    await t.test('valid GLB metadata and binary persist, private keys are omitted, equal content deduplicates', async () => {
      asset = await dm.upload(); assert.equal('storageKey' in asset, false)
      assert.equal((await dm.request('/assets')).total, 1)
      const response = await dm.file(asset.id)
      assert.equal(response.headers.get('content-type'), 'model/gltf-binary')
      assert.match(response.headers.get('cache-control')!, /no-store/)
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), makeGlb())
      await dm.upload(undefined, undefined, undefined, 409)
    })
    await t.test('known UUIDs do not grant other DM or campaign players file/management access', async () => {
      await other.request(`/assets/${asset.id}`, undefined, 404); await other.file(asset.id, 404)
      await player.file(asset.id, 403); await anonymous.file(asset.id, 401)
      await other.request(`/assets/${asset.id}/delete`, { revision: 1 }, 404)
      await player.request(`/assets/${asset.id}/update`, { revision: 1, metadata: {} }, 403)
      assert.equal((await other.request('/assets')).total, 0)
    })
    await t.test('metadata, tags, transforms, search and category filtering persist with stale edit protection', async () => {
      const metadata = { name: 'Oak chair', description: 'Handmade chair', category: 'decoration', tags: ['tavern'], source: 'Meshy AI', presentation: { defaultScale: 2, defaultRotation: 90, verticalOffset: .1, displayName: 'Oak' } }
      const updated = await dm.request(`/assets/${asset.id}/update`, { revision: 1, metadata }); asset = updated
      assert.equal(updated.presentation.defaultRotation, 90)
      assert.equal((await dm.request('/assets?q=tavern&category=decoration')).total, 1)
      assert.equal((await dm.request('/assets?category=miniature')).total, 0)
      await dm.request(`/assets/${asset.id}/update`, { revision: 1, metadata }, 409)
      assert.deepEqual(Buffer.from(await (await dm.file(asset.id)).arrayBuffer()), makeGlb(), 'Presentation must not mutate the source file')
    })
    await t.test('malformed, oversized, external and traversal uploads leave no usable rows or staging files', async () => {
      await dm.upload(Buffer.from('invalid'), 'bad.glb', undefined, 400)
      await dm.upload(makeGlb().subarray(0, 40), 'truncated.glb', undefined, 400)
      await dm.upload(Buffer.alloc(3000), 'oversized.glb', undefined, 413)
      await dm.upload(Buffer.alloc(40000), 'too-large-request.glb', undefined, 413)
      await dm.request('/assets', { forged: 'JSON upload' }, 400)
      await dm.upload(makeGlb(), '../escape.glb', undefined, 400)
      await dm.upload(makeGlb(), 'not-glb.zip', undefined, 400)
      await dm.upload(makeGlb('{broken'), 'bad-json.glb', undefined, 400)
      await dm.upload(makeGlb({ ...triangleDocument(), buffers: [{ byteLength: 36, uri: 'https://untrusted.test/texture' }] }), 'external.glb', undefined, 400)
      assert.equal((await dm.request('/assets')).total, 1)
      assert.deepEqual(await readdir(join(root, 'staging')), [])
      const boundary = 'test-size-boundary'
      const payload = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="oversized.glb"\r\n\r\n${'a'.repeat(3000)}\r\n--${boundary}--\r\n`)
      const stream = new ReadableStream({ start(controller) { controller.enqueue(payload); controller.close() } })
      const response = await fetch(base+'/api/assets', { method: 'POST', headers: { Cookie: dm.cookie, Origin: origin, 'X-CSRF-Token': dm.csrf, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: stream, duplex: 'half' } as RequestInit)
      assert.equal(response.status, 413, await response.text())
    })
    await t.test('failed publication and interrupted multipart uploads clean files and pending metadata', async () => {
      const changed = triangleDocument(); changed.asset.generator = 'Different fixture'
      failPublish = true
      try { await dm.upload(makeGlb(changed), 'failed-storage.glb', undefined, 500) } finally { failPublish = false }
      assert.equal((await dm.request('/assets')).total, 1)
      assert.deepEqual(await readdir(join(root, 'staging')), [])
      const boundary = 'interrupt-boundary'
      const request = httpRequest(base+'/api/assets', { method: 'POST', headers: { Cookie: dm.cookie, Origin: origin, 'X-CSRF-Token': dm.csrf, 'Content-Type': `multipart/form-data; boundary=${boundary}` } })
      request.on('error', () => {})
      request.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="interrupted.glb"\r\n\r\n`)
      request.write(makeGlb().subarray(0, 40))
      const deadline = Date.now() + 3000
      while (!(await readdir(join(root, 'staging'))).length && Date.now() < deadline) await new Promise(r => setTimeout(r, 20))
      request.destroy()
      while ((await readdir(join(root, 'staging'))).length && Date.now() < deadline) await new Promise(r => setTimeout(r, 20))
      assert.deepEqual(await readdir(join(root, 'staging')), [])
      assert.equal((await dm.request('/assets')).total, 1)
    })
    await t.test('restart restores metadata/files and pending publication; missing pending files are cleaned', async () => {
      await pool.query("UPDATE assets_3d SET upload_status='processing' WHERE id=$1", [asset.id])
      await application.close(); await recoverAssets(pool, new FilesystemAssetStorage(root)); application = createApplication(options)
      await new Promise<void>(r => application.http.listen(port, '127.0.0.1', r))
      const restored = await dm.request(`/assets/${asset.id}`); assert.equal(restored.name, 'Oak chair'); assert.equal(restored.uploadStatus, 'ready')
      assert.deepEqual(Buffer.from(await (await dm.file(asset.id)).arrayBuffer()), makeGlb())
      const ghost = randomUUID()
      await pool.query(`INSERT INTO assets_3d SELECT $1,owner_id,'Pending missing',description,category,tags,source,presentation,file_name,file_size,content_type,format,$2,$3,'processing',validation_status,metrics,revision,created_at,updated_at FROM assets_3d WHERE id=$4`, [ghost, `${randomUUID()}/${'b'.repeat(64)}.glb`, 'missing-'+ghost, asset.id])
      await recoverAssets(pool, storage); assert.equal((await pool.query('SELECT 1 FROM assets_3d WHERE id=$1', [ghost])).rowCount, 0)
    })
    await t.test('delete tombstones the record and removes the binary, retrieval is denied afterward', async () => {
      failDelete = true
      await dm.request(`/assets/${asset.id}/delete`, { revision: asset.revision }, 503)
      assert.equal((await dm.request(`/assets/${asset.id}`)).uploadStatus, 'deleting')
      failDelete = false
      await recoverAssets(pool, storage)
      await dm.file(asset.id, 404); assert.equal((await dm.request('/assets')).total, 0)
      const row = (await pool.query('SELECT storage_key,upload_status FROM assets_3d WHERE id=$1', [asset.id])).rows[0]
      assert.equal(row.upload_status, 'deleted'); assert.equal(await storage.exists(row.storage_key), false)
      const replacement = await dm.upload() // Deleted content may be uploaded again without duplicate binaries.
      await dm.request(`/assets/${replacement.id}/delete`, { revision: replacement.revision })
    })
    await t.test('upload rate limiting is enforced for authenticated DMs', async () => {
      // The restarted application has accepted one replacement upload so far.
      for (let i = 0; i < 19; i++) await dm.upload(makeGlb(), 'not-a-model.zip', undefined, 400)
      await dm.upload(makeGlb(), 'not-a-model.zip', undefined, 429)
    })
  } finally { await application.close(); await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); await rm(root, { recursive: true, force: true }) }
})
