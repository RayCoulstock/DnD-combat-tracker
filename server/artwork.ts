import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { EncounterState } from '../shared/domain.ts'
export interface ArtworkStorage {
  put(db: PoolClient, mime: string, bytes: Buffer): Promise<string>
  get(db: PoolClient, id: string): Promise<{ mime: string; bytes: Buffer } | null>
}
export const artworkStorage: ArtworkStorage = {
  async put(db, mime, bytes) {
    const id = createHash('sha256').update(mime).update(bytes).digest('hex')
    await db.query('INSERT INTO artwork(id,mime,bytes) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, mime, bytes])
    return `/api/artwork/${id}`
  },
  async get(db, id) { return (await db.query('SELECT mime,bytes FROM artwork WHERE id=$1', [id])).rows[0] ?? null },
}
export async function storeArtwork(db: PoolClient, state: EncounterState) {
  const copy = structuredClone(state)
  for (const c of copy.combatants) {
    const match = c.artwork?.match(/^data:(image\/[a-z0-9.+-]{1,80});base64,(.+)$/)
    if (match) {
      const bytes = Buffer.from(match[2], 'base64')
      if (bytes.length > 3 * 1024 * 1024) throw new Error('Artwork exceeds size limit')
      c.artwork = await artworkStorage.put(db, match[1], bytes)
    }
  }
  return copy
}
export async function embedArtwork(db: PoolClient, state: EncounterState) {
  const copy = structuredClone(state)
  for (const c of copy.combatants) {
    const id = c.artwork?.match(/^\/api\/artwork\/([a-f0-9]{64})$/)?.[1]
    if (id) {
      const data = await artworkStorage.get(db, id)
      if (data) c.artwork = `data:${data.mime};base64,${data.bytes.toString('base64')}`
    }
  }
  return copy
}
