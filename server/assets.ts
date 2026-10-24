import type { Express, Request, Response } from 'express'
import Busboy from 'busboy'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { assetMetadataSchema, assetCategories, type Asset3D } from '../shared/assets.ts'
import type { Actor } from '../shared/domain.ts'
import { transaction, type Pool } from './db.ts'
import { assetLimits, type AssetLimits } from './asset-config.ts'
import { AssetError, type AssetStorage, type StagedAsset } from './asset-storage.ts'
import { validateAsset } from './asset-validation.ts'
const uuid = z.uuid()
function publicAsset(row: Record<string, unknown>): Asset3D {
  return { id: row.id, name: row.name, description: row.description, category: row.category, tags: row.tags, source: row.source, presentation: row.presentation,
    fileName: row.file_name, fileSize: row.file_size, contentType: row.content_type, format: row.format, revision: row.revision,
    uploadStatus: row.upload_status, validationStatus: row.validation_status, metrics: row.metrics, createdAt: new Date(row.created_at as string).toISOString(), updatedAt: new Date(row.updated_at as string).toISOString() } as Asset3D
}
async function multipart(req: Request, storage: AssetStorage, limits: AssetLimits) {
  if (Number(req.headers['content-length'] ?? 0) > limits.maxBytes + 32768) throw new AssetError(413, 'GLB exceeds the upload size limit.')
  let parser: ReturnType<typeof Busboy>
  try { parser = Busboy({ headers: req.headers, defParamCharset: 'utf8', preservePath: true, limits: { files: 1, fields: 1, parts: 3, fieldSize: 16384, fileSize: limits.maxBytes + 1, headerPairs: 30 } }) }
  catch { throw new AssetError(400, 'Upload a GLB file using multipart form data.') }
  let staged: StagedAsset | undefined, fileName = '', metadata: unknown, failure: Error | undefined
  const jobs: Promise<void>[] = []
  const invalid = (message: string) => { failure ??= new AssetError(400, message) }
  parser.on('field', (name, value, info) => { if (name !== 'metadata' || info.valueTruncated) invalid('Invalid or oversized asset metadata.'); else { try { metadata = JSON.parse(value) } catch { invalid('Invalid asset metadata.') } } })
  parser.on('file', (name, stream, info) => {
    fileName = info.filename ?? ''
    if (name !== 'file' || !fileName || fileName.length > 255 || (/[\\/]/.test(fileName) || [...fileName].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) || !fileName.toLowerCase().endsWith('.glb')) { invalid('Choose a .glb filename without directory paths.'); stream.resume(); return }
    jobs.push(storage.stage(stream, limits.maxBytes).then(value => { staged = value; if (stream.truncated) failure = new AssetError(413, 'GLB exceeds the upload size limit.') }).catch(e => { failure = e }))
  })
  for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit'] as const) parser.on(event, () => invalid('Upload exactly one file and one metadata field.'))
  let total = 0
  const budget = (chunk: Buffer) => { total += chunk.length; if (total > limits.maxBytes + 32768) { failure = new AssetError(413, 'Upload exceeds the request size limit.'); req.unpipe(parser); parser.destroy(failure); req.resume() } }
  const aborted = () => parser.destroy(new AssetError(400, 'Upload interrupted.'))
  req.on('data', budget); req.once('aborted', aborted); req.once('error', aborted)
  try {
    await new Promise<void>((resolve, reject) => { parser.once('close', resolve); parser.once('error', e => reject(e instanceof AssetError ? e : new AssetError(400, 'Malformed or interrupted multipart upload.'))); req.pipe(parser) })
    await Promise.all(jobs)
    if (failure) throw failure
    if (!staged || metadata === undefined) throw new AssetError(400, 'A GLB file and metadata are required.')
    return { staged, fileName, metadata: assetMetadataSchema.parse(metadata) }
  } catch (error) { await Promise.all(jobs); if (staged) await storage.remove(staged.key); throw error }
  finally { req.off('data', budget); req.off('aborted', aborted); req.off('error', aborted); req.unpipe(parser); if (!req.destroyed) req.resume() }
}
export async function recoverAssets(pool: Pool, storage: AssetStorage) {
  for (const row of (await pool.query("SELECT id,storage_key,upload_status FROM assets_3d WHERE upload_status IN ('processing','deleting')")).rows) {
    if (row.upload_status === 'processing') {
      if (await storage.exists(row.storage_key)) await pool.query("UPDATE assets_3d SET upload_status='ready',updated_at=now() WHERE id=$1", [row.id])
      else await pool.query('DELETE FROM assets_3d WHERE id=$1', [row.id])
    } else {
      await storage.remove(row.storage_key)
      await pool.query("UPDATE assets_3d SET upload_status='deleted',updated_at=now() WHERE id=$1", [row.id])
    }
  }
  await storage.cleanStaging()
}
export function registerAssetRoutes(app: Express, pool: Pool, storage: AssetStorage, requireDM: (req: Request) => Actor, limits = assetLimits(), requireActor: (req: Request) => Actor = requireDM) {
  let active = 0
  const owners = new Set<string>()
  const managementLimit = rateLimit({ windowMs: 15 * 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Too many asset changes. Try again shortly.' } } })
  const uploadLimit = rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Too many uploads. Try again shortly.' } } })
  app.get('/api/assets/:assetId/file', async (req, res) => {
    const actor = requireActor(req), id = uuid.parse(req.params.assetId)
    let row
    if (actor.role === 'dm') row = (await pool.query("SELECT * FROM assets_3d WHERE id=$1 AND owner_id=$2 AND upload_status <> 'deleted'", [id, actor.id])).rows[0]
    else {
      const context = z.object({ campaignId: z.uuid().optional(), encounterId: z.uuid().optional() }).strict().parse(req.query)
      if (!context.campaignId || !context.encounterId) throw new AssetError(403, 'An active encounter is required.')
      row = (await pool.query(`SELECT a.* FROM assets_3d a
        JOIN campaigns c ON c.owner_id=a.owner_id JOIN encounters e ON e.campaign_id=c.id
        JOIN memberships m ON m.campaign_id=c.id AND m.id=$2 AND m.revoked_at IS NULL
        WHERE a.id=$1 AND c.id=$3 AND e.id=$4 AND c.active_encounter_id=e.id AND c.session_active
          AND (EXISTS(SELECT 1 FROM combatant_asset_references r JOIN combatants b ON b.encounter_id=r.encounter_id AND b.id=r.combatant_id WHERE r.asset_id=a.id AND r.encounter_id=e.id AND b.visible)
            OR EXISTS(SELECT 1 FROM encounter_scenery_asset_references s WHERE s.asset_id=a.id AND s.encounter_id=e.id AND s.visible_current)) AND a.owner_id=c.owner_id AND a.upload_status='ready' LIMIT 1`, [id, actor.id, context.campaignId, context.encounterId])).rows[0]
    }
    if (!row) throw new AssetError(404, 'Asset is unavailable.')
    if (row.upload_status !== 'ready') throw new AssetError(409, 'Asset is not ready for preview.')
    let stream
    try { stream = await storage.read(row.storage_key) } catch { throw new AssetError(503, 'Asset file is unavailable. Restore storage and retry.') }
    res.set({ 'Content-Type': 'model/gltf-binary', 'Content-Length': String(row.file_size), 'Content-Disposition': `inline; filename="${row.id}.glb"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cross-Origin-Resource-Policy': 'same-origin' })
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res)
  })
  app.use('/api/assets', (req, _res, next) => { try { requireDM(req); next() } catch (e) { next(e) } })
  const owned = async (req: Request) => {
    const actor = requireDM(req), id = uuid.parse(req.params.assetId)
    const row = (await pool.query("SELECT * FROM assets_3d WHERE id=$1 AND owner_id=$2 AND upload_status <> 'deleted'", [id, actor.id])).rows[0]
    if (!row) throw new AssetError(404, 'Asset is unavailable.')
    return row
  }
  app.get('/api/assets', async (req, res) => {
    const actor = requireDM(req)
    const query = z.object({ q: z.string().max(150).default(''), category: z.enum(assetCategories).optional(), offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict().parse(req.query)
    const params = [actor.id, `%${query.q.replace(/[\\%_]/g, '\\$&')}%`, query.category ?? null]
    const where = "owner_id=$1 AND upload_status <> 'deleted' AND (name ILIKE $2 OR description ILIKE $2 OR tags::text ILIKE $2) AND ($3::text IS NULL OR category=$3)"
    const rows = await pool.query(`SELECT * FROM assets_3d WHERE ${where} ORDER BY created_at DESC,id LIMIT 50 OFFSET $4`, [...params, query.offset])
    res.json({ assets: rows.rows.map(publicAsset), total: Number((await pool.query(`SELECT count(*) FROM assets_3d WHERE ${where}`, params)).rows[0].count), maxBytes: limits.maxBytes })
  })
  app.post('/api/assets', uploadLimit, async (req, res) => {
    const actor = requireDM(req)
    if (active >= 2 || owners.has(actor.id)) throw new AssetError(429, 'Another model is processing. Try again when it finishes.')
    active++; owners.add(actor.id)
    let released = false
    const release = () => { if (!released) { released = true; active--; owners.delete(actor.id) } }
    let staged: StagedAsset | undefined
    try {
      const upload = await multipart(req, storage, limits); staged = upload.staged
      const stream = await storage.read(staged.key), chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk))
      const metrics = await validateAsset(new Uint8Array(Buffer.concat(chunks)), limits)
      if (req.aborted || res.destroyed) throw new AssetError(400, 'Upload cancelled.')
      const id = randomUUID(), key = `${actor.id}/${staged.hash}.glb`, m = upload.metadata
      try {
        await pool.query(`INSERT INTO assets_3d(id,owner_id,name,description,category,tags,source,presentation,file_name,file_size,storage_key,content_hash,upload_status,metrics)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'processing',$13)`, [id, actor.id, m.name, m.description, m.category, JSON.stringify(m.tags), m.source, m.presentation, upload.fileName, staged.size, key, staged.hash, metrics])
      } catch (e) { if ((e as { code?: string }).code === '23505') throw new AssetError(409, 'This model is already in your library.'); throw e }
      try {
        if (res.destroyed) throw new AssetError(400, 'Upload cancelled.')
        await storage.publish(staged, actor.id)
        const row = (await pool.query("UPDATE assets_3d SET upload_status='ready',updated_at=now() WHERE id=$1 RETURNING *", [id])).rows[0]
        await storage.remove(staged.key)
        release() // A successful acknowledgement must permit the next sequential upload.
        res.status(201).json(publicAsset(row))
      } catch (e) {
        await storage.remove(key).catch(() => {})
        await pool.query('DELETE FROM assets_3d WHERE id=$1', [id]).catch(() => {})
        throw e
      }
    } finally { if (staged) await storage.remove(staged.key).catch(() => {}); release() }
  })
  app.get('/api/assets/:assetId', async (req, res) => res.json(publicAsset(await owned(req))))
  app.post('/api/assets/:assetId/update', managementLimit, async (req, res) => {
    const row = await owned(req), data = z.object({ revision: z.number().int().positive(), metadata: assetMetadataSchema }).strict().parse(req.body), m = data.metadata
    const result = await pool.query("UPDATE assets_3d SET name=$3,description=$4,category=$5,tags=$6,source=$7,presentation=$8,revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2 AND revision=$9 AND upload_status='ready' RETURNING *", [row.id, requireDM(req).id, m.name, m.description, m.category, JSON.stringify(m.tags), m.source, m.presentation, data.revision])
    if (!result.rowCount) throw new AssetError(409, 'Asset changed. Refresh its details and try again.')
    res.json(publicAsset(result.rows[0]))
  })
  app.post('/api/assets/:assetId/delete', managementLimit, async (req, res) => {
    const row = await owned(req), data = z.object({ revision: z.number().int().positive() }).strict().parse(req.body)
    await transaction(pool, async db => {
      const locked = (await db.query('SELECT revision,upload_status FROM assets_3d WHERE id=$1 AND owner_id=$2 FOR UPDATE', [row.id, requireDM(req).id])).rows[0]
      if (!locked || locked.revision !== data.revision || !['ready', 'deleting'].includes(locked.upload_status)) throw new AssetError(409, 'Asset changed. Refresh its details and try again.')
      if ((await db.query('SELECT 1 FROM combatant_asset_references WHERE asset_id=$1 UNION ALL SELECT 1 FROM encounter_scenery_asset_references WHERE asset_id=$1 UNION ALL SELECT 1 FROM template_scenery_asset_references WHERE asset_id=$1 LIMIT 1', [row.id])).rowCount) throw new AssetError(409, 'This asset is referenced by an encounter, map history or template. Remove those references before deleting it.')
      await db.query("UPDATE assets_3d SET upload_status='deleting',revision=revision+1,updated_at=now() WHERE id=$1", [row.id])
    })
    try { await storage.remove(row.storage_key) } catch { throw new AssetError(503, 'Deletion is pending. Restore storage and retry deletion or restart the backend.') }
    await pool.query("UPDATE assets_3d SET upload_status='deleted',updated_at=now() WHERE id=$1", [row.id]); res.json({ ok: true })
  })
  // Keep bounded upload/parser errors safe, without exposing paths or implementation details.
  app.use('/api/assets', (error: unknown, _req: Request, res: Response, next: (error: unknown) => void) => {
    if (error instanceof AssetError) return res.status(error.status).json({ error: { code: 'ASSET', message: error.message } })
    if (error instanceof z.ZodError) return res.status(400).json({ error: { code: 'INVALID', message: 'Invalid asset metadata or identifier.' } })
    next(error)
  })
}
