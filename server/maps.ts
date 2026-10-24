import type { Express, Request } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { transaction, type Pool } from './db.ts'
import { syncTemplateScenery } from './scenery.ts'
import { authorize, loadState } from './game.ts'
import { DomainError, type Actor } from '../shared/domain.ts'
import { readDungeon } from '../shared/dungeon.ts'
const name = z.string().trim().min(1).max(150)
const saveSchema = z.object({ name, encounterId: z.uuid(), encounterRevision: z.number().int().nonnegative(), revision: z.number().int().positive().optional() }).strict()
export function registerMapRoutes(app: Express, pool: Pool, requireDM: (req: Request) => Actor) {
  app.get('/api/campaigns/:campaignId/maps', async (req, res) => {
    const actor = requireDM(req), campaignId = z.uuid().parse(req.params.campaignId)
    res.json(await transaction(pool, async db => {
      await authorize(db, actor, campaignId)
      return (await db.query(`SELECT id,name,revision,schema_version,document->'width' AS width,document->'height' AS height,created_at,updated_at FROM map_templates WHERE campaign_id=$1 ORDER BY updated_at DESC`, [campaignId])).rows
    }))
  })
  app.get('/api/campaigns/:campaignId/maps/:mapId', async (req, res) => {
    const actor = requireDM(req), campaignId = z.uuid().parse(req.params.campaignId), id = z.uuid().parse(req.params.mapId)
    res.json(await transaction(pool, async db => {
      await authorize(db, actor, campaignId)
      const row = (await db.query('SELECT id,name,revision,document FROM map_templates WHERE id=$1 AND campaign_id=$2', [id, campaignId])).rows[0]
      if (!row) throw new DomainError('FORBIDDEN', 'Map access denied.')
      return row
    }))
  })
  for (const overwrite of [false, true]) {
    app.post(overwrite ? '/api/campaigns/:campaignId/maps/:mapId/save' : '/api/campaigns/:campaignId/maps', async (req, res) => {
      const actor = requireDM(req), campaignId = z.uuid().parse(req.params.campaignId), data = saveSchema.parse(req.body)
      const id = overwrite ? z.uuid().parse((req.params as Record<string, string>).mapId) : randomUUID()
      const result = await transaction(pool, async db => {
        await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [campaignId]); await authorize(db, actor, campaignId)
        const encounter = (await db.query('SELECT revision FROM encounters WHERE id=$1 AND campaign_id=$2', [data.encounterId, campaignId])).rows[0]
        if (!encounter) throw new DomainError('FORBIDDEN', 'Encounter access denied.')
        if (encounter.revision !== data.encounterRevision) throw new DomainError('CONFLICT', 'Encounter changed. Review the latest map before saving.')
        const state = await loadState(db, data.encounterId)
        if (!state.dungeonMap) throw new DomainError('INVALID', 'Create or load a dungeon map first.')
        const document = readDungeon({ ...state.dungeonMap, name: data.name })
        if (overwrite) {
          const saved = await db.query('UPDATE map_templates SET name=$3,document=$4,schema_version=$6,revision=revision+1,updated_at=now() WHERE id=$1 AND campaign_id=$2 AND revision=$5 RETURNING id,revision', [id, campaignId, data.name, document, data.revision, document.schemaVersion])
          if (!saved.rowCount) throw new DomainError('CONFLICT', 'Template changed or is unavailable. Refresh the library.')
          await syncTemplateScenery(db, id, actor.id, document)
          return saved.rows[0]
        }
        const saved = (await db.query('INSERT INTO map_templates(id,campaign_id,owner_id,name,document,schema_version) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,revision', [id, campaignId, actor.id, data.name, document, document.schemaVersion])).rows[0]
        await syncTemplateScenery(db, id, actor.id, document)
        return saved
      })
      res.status(overwrite ? 200 : 201).json(result)
    })
  }
  for (const action of ['rename', 'duplicate', 'delete'] as const) {
    app.post(`/api/campaigns/:campaignId/maps/:mapId/${action}`, async (req, res) => {
      const actor = requireDM(req), campaignId = z.uuid().parse(req.params.campaignId), id = z.uuid().parse(req.params.mapId)
      const data = z.object({ revision: z.number().int().positive(), name: name.optional() }).strict().parse(req.body)
      const result = await transaction(pool, async db => {
        await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [campaignId]); await authorize(db, actor, campaignId)
        const map = (await db.query('SELECT * FROM map_templates WHERE id=$1 AND campaign_id=$2 FOR UPDATE', [id, campaignId])).rows[0]
        if (!map) throw new DomainError('FORBIDDEN', 'Map access denied.')
        if (map.revision !== data.revision) throw new DomainError('CONFLICT', 'Template changed. Refresh the library.')
        if (action === 'delete') { await db.query('DELETE FROM map_templates WHERE id=$1', [id]); return { ok: true } }
        const newName = name.parse(data.name)
        if (action === 'rename') {
          await db.query('UPDATE map_templates SET name=$2,document=$3,revision=revision+1,updated_at=now() WHERE id=$1', [id, newName, readDungeon({ ...map.document, name: newName })]); await syncTemplateScenery(db, id, actor.id, map.document); return { id, revision: map.revision + 1 }
        }
        const copyId = randomUUID()
        const document = readDungeon({ ...map.document, id: copyId, name: newName })
        await db.query('INSERT INTO map_templates(id,campaign_id,owner_id,name,document,schema_version) VALUES($1,$2,$3,$4,$5,$6)', [copyId, campaignId, actor.id, newName, document, document.schemaVersion])
        await syncTemplateScenery(db, copyId, actor.id, document)
        return { id: copyId, revision: 1 }
      }); res.status(action === 'duplicate' ? 201 : 200).json(result)
    })
  }
}
