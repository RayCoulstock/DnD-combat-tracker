import type { PoolClient } from 'pg'
import { createHash } from 'node:crypto'
import { applyCommand, DomainError, projectEncounter, type Actor, type CommandEnvelope, type EncounterState, type Snapshot } from '../shared/domain.ts'
import { transaction, type Pool } from './db.ts'
import { storeArtwork } from './artwork.ts'

export async function authorize(db: PoolClient, actor: Actor, campaignId: string) {
  const campaign = (await db.query('SELECT * FROM campaigns WHERE id=$1', [campaignId])).rows[0]
  if (!campaign) throw new DomainError('FORBIDDEN', 'Campaign access denied.')
  if (actor.role === 'dm' && campaign.owner_id === actor.id) return campaign
  if (actor.role === 'player' && (await db.query('SELECT 1 FROM memberships WHERE id=$1 AND campaign_id=$2 AND revoked_at IS NULL', [actor.id, campaignId])).rowCount) return campaign
  throw new DomainError('FORBIDDEN', 'Campaign access denied.')
}
export async function loadState(db: PoolClient, encounterId: string): Promise<EncounterState> {
  const encounter = (await db.query('SELECT state FROM encounters WHERE id=$1', [encounterId])).rows[0]
  if (!encounter) throw new DomainError('NOT_FOUND', 'Encounter not found.')
  const rows = (await db.query('SELECT * FROM combatants WHERE encounter_id=$1 ORDER BY ordinal', [encounterId])).rows
  return { ...encounter.state, combatants: rows.map(r => ({ ...r.data, ownerId: r.owner_id, visible: r.visible })),
    battleMap: { ...encounter.state.battleMap, tokens: Object.fromEntries(rows.map(r => [r.id, r.position])) } }
}
export async function persistState(db: PoolClient, encounterId: string, input: EncounterState) {
  const state = await storeArtwork(db, input)
  await db.query('UPDATE encounters SET state=$2,updated_at=now() WHERE id=$1', [encounterId, { ...state, combatants: [], battleMap: { ...state.battleMap, tokens: {} } }])
  await db.query('DELETE FROM combatants WHERE encounter_id=$1', [encounterId])
  for (const [ordinal, c] of state.combatants.entries()) {
    await db.query('INSERT INTO combatants(encounter_id,id,ordinal,data,owner_id,visible,position) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [encounterId, String(c.id), ordinal, c, c.ownerId, c.visible, state.battleMap.tokens[String(c.id)]])
  }
  return state
}
export async function snapshot(db: PoolClient, actor: Actor, campaignId: string): Promise<Snapshot> {
  await db.query('SELECT id FROM campaigns WHERE id=$1 FOR SHARE', [campaignId])
  const campaign = await authorize(db, actor, campaignId)
  if (!campaign.active_encounter_id) throw new DomainError('NOT_FOUND', 'Open an encounter first.')
  if (actor.role === 'player' && !campaign.session_active) throw new DomainError('SESSION_ENDED', 'The session has ended.')
  const encounter = (await db.query('SELECT id,name,revision FROM encounters WHERE id=$1 AND campaign_id=$2', [campaign.active_encounter_id, campaignId])).rows[0]
  return { campaignId, encounterId: encounter.id, name: encounter.name, revision: encounter.revision,
    sessionActive: campaign.session_active, actor, state: projectEncounter(await loadState(db, encounter.id), actor) }
}
export async function execute(pool: Pool, actor: Actor, campaignId: string, data: CommandEnvelope) {
  return transaction(pool, async db => {
    // All room lifecycle writes use this lock order as well.
    await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [campaignId])
    const campaign = await authorize(db, actor, campaignId)
    if (actor.role === 'player' && !campaign.session_active) throw new DomainError('SESSION_ENDED', 'The session has ended.')
    const encounter = (await db.query('SELECT id,revision FROM encounters WHERE id=$1 FOR UPDATE', [campaign.active_encounter_id])).rows[0]
    if (!encounter) throw new DomainError('NOT_FOUND', 'Open an encounter first.')
    if (encounter.id !== data.encounterId) throw new DomainError('CONFLICT', 'A different encounter is now open.')
    const hash = createHash('sha256').update(JSON.stringify(data)).digest('hex')
    const receipt = (await db.query('SELECT revision,payload_hash FROM command_receipts WHERE encounter_id=$1 AND actor_id=$2 AND command_id=$3', [encounter.id, actor.id, data.commandId])).rows[0]
    if (receipt) {
      if (receipt.payload_hash !== hash) throw new DomainError('CONFLICT', 'Command ID has already been used.')
      return { revision: receipt.revision as number, duplicate: true }
    }
    if (encounter.revision !== data.revision) throw new DomainError('CONFLICT', 'The encounter changed. Review the latest state and try again.')
    if (data.command.type === 'token.assign' && data.command.playerId !== null) {
      if (!(await db.query('SELECT 1 FROM memberships WHERE id=$1 AND campaign_id=$2 AND revoked_at IS NULL', [data.command.playerId, campaignId])).rowCount) throw new DomainError('INVALID', 'Choose an active campaign player.')
    }
    const next = applyCommand(await loadState(db, encounter.id), actor, data.command)
    await persistState(db, encounter.id, next)
    const revision = encounter.revision + 1
    await db.query('UPDATE encounters SET revision=$2 WHERE id=$1', [encounter.id, revision])
    await db.query('INSERT INTO command_receipts(encounter_id,actor_id,command_id,revision,payload_hash) VALUES($1,$2,$3,$4,$5)', [encounter.id, actor.id, data.commandId, revision, hash])
    return { revision, duplicate: false }
  })
}
