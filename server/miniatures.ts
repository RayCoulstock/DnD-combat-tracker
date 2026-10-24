import type { PoolClient } from 'pg'
import type { EncounterState } from '../shared/domain.ts'
import { DomainError } from '../shared/domain.ts'
// Lock rows in stable order so deletion cannot race validation/reference publication.
export async function miniatureReferences(db: PoolClient, encounterId: string, state: EncounterState, allowUnresolved: boolean, requiredAssetId?: string) {
  const ids = [...new Set(state.combatants.map(c => c.miniature?.assetId).filter((id): id is string => Boolean(id)))].sort()
  const owner = (await db.query('SELECT c.owner_id FROM campaigns c JOIN encounters e ON e.campaign_id=c.id WHERE e.id=$1', [encounterId])).rows[0].owner_id
  const rows = ids.length ? (await db.query('SELECT id,owner_id,upload_status FROM assets_3d WHERE id=ANY($1::uuid[]) AND owner_id=$2 ORDER BY id FOR UPDATE', [ids, owner])).rows : []
  const available = new Set<string>(rows.filter(r => r.owner_id === owner && r.upload_status === 'ready').map(r => r.id))
  if (requiredAssetId && !available.has(requiredAssetId)) throw new DomainError('FORBIDDEN', 'Choose a ready asset from your own library.')
  const prior = new Map((await db.query("SELECT id,data->'miniature'->>'assetId' AS asset_id FROM combatants WHERE encounter_id=$1", [encounterId])).rows.map(r => [r.id, r.asset_id]))
  for (const c of state.combatants) if (c.miniature?.assetId && !available.has(c.miniature.assetId) && !allowUnresolved && prior.get(String(c.id)) !== c.miniature.assetId) throw new DomainError('FORBIDDEN', 'Choose a ready asset from your own library.')
  return available
}
