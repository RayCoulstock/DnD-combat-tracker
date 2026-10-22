import type { PoolClient } from 'pg'
import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import { applyCommand, applyMapEdit, isMapEdit, DomainError, projectEncounter, type Actor, type CommandEnvelope, type EncounterState, type Snapshot, type SessionState } from '../shared/domain.ts'
import { transaction, type Pool } from './db.ts'
import { generateDungeon } from '../shared/generator.ts'
import { emptyHistory, readDungeon, type MapHistory } from '../shared/dungeon.ts'
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
  const instance = (await db.query('SELECT document,revision,history FROM encounter_maps WHERE encounter_id=$1', [encounterId])).rows[0]
  return { ...encounter.state, dungeonMap: instance?.document ? readDungeon(instance.document) : undefined, mapRevision: instance?.revision ?? 0, mapUndoDepth: instance?.history.undo.length ?? 0, mapRedoDepth: instance?.history.redo.length ?? 0, combatants: rows.map(r => ({ ...r.data, ownerId: r.owner_id, visible: r.visible })),
    battleMap: { ...encounter.state.battleMap, tokens: Object.fromEntries(rows.map(r => [r.id, r.position])) } }
}
export async function persistState(db: PoolClient, encounterId: string, input: EncounterState, history?: MapHistory) {
  const state = await storeArtwork(db, input)
  const existing = (await db.query('SELECT document FROM encounter_maps WHERE encounter_id=$1', [encounterId])).rows[0]
  if (history || !isDeepStrictEqual(existing?.document ?? null, state.dungeonMap ?? null)) {
    if (state.dungeonMap) readDungeon(state.dungeonMap)
    await db.query(`INSERT INTO encounter_maps(encounter_id,document,history) VALUES($1,$2,$3)
      ON CONFLICT(encounter_id) DO UPDATE SET document=$2,history=$3,revision=encounter_maps.revision+1,updated_at=now()`, [encounterId, state.dungeonMap ?? null, history ?? emptyHistory()])
  }
  await db.query('UPDATE encounters SET state=$2,updated_at=now() WHERE id=$1', [encounterId, { ...state, dungeonMap: undefined, mapRevision: undefined, mapUndoDepth: undefined, mapRedoDepth: undefined, combatants: [], battleMap: { ...state.battleMap, tokens: {} } }])
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
// Waiting-room subscription does not grant access to an inactive encounter.
export async function sessionState(db: PoolClient, actor: Actor, campaignId: string): Promise<SessionState> {
  await db.query('SELECT id FROM campaigns WHERE id=$1 FOR SHARE', [campaignId])
  const campaign = await authorize(db, actor, campaignId)
  return { campaignId, revision: campaign.state_revision, sessionActive: campaign.session_active,
    encounterId: campaign.active_encounter_id,
    snapshot: campaign.active_encounter_id && (actor.role === 'dm' || campaign.session_active) ? await snapshot(db, actor, campaignId) : null }
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
    const current = await loadState(db, encounter.id)
    let command = data.command
    if (command.type === 'map.generate') {
      if (actor.role !== 'dm') throw new DomainError('FORBIDDEN', 'Only the DM may generate maps.')
      try { command = { type: 'map.load', document: generateDungeon(command.options) } } catch (e) { throw new DomainError('INVALID', (e as Error).message) }
    }
    if (command.type === 'map.template.load') {
      if (actor.role !== 'dm') throw new DomainError('FORBIDDEN', 'Only the DM may load maps.')
      const template = (await db.query('SELECT document FROM map_templates WHERE id=$1 AND campaign_id=$2', [command.templateId, campaignId])).rows[0]
      if (!template) throw new DomainError('FORBIDDEN', 'Map access denied.')
      command = { type: 'map.load', document: readDungeon(template.document) }
    }
    let next: EncounterState, history: MapHistory | undefined
    if (isMapEdit(command)) {
      const saved = (await db.query('SELECT history FROM encounter_maps WHERE encounter_id=$1', [encounter.id])).rows[0]
      const result = applyMapEdit(current, actor, command, saved?.history ?? emptyHistory())
      next = result.state; history = result.history
    } else { next = applyCommand(current, actor, command); if (command.type === 'encounter.restore' || command.type === 'encounter.clear') history = emptyHistory() }
    await persistState(db, encounter.id, next, history)
    const revision = encounter.revision + 1
    await db.query('UPDATE encounters SET revision=$2 WHERE id=$1', [encounter.id, revision])
    await db.query('UPDATE campaigns SET state_revision=state_revision+1 WHERE id=$1', [campaignId])
    await db.query('INSERT INTO command_receipts(encounter_id,actor_id,command_id,revision,payload_hash) VALUES($1,$2,$3,$4,$5)', [encounter.id, actor.id, data.commandId, revision, hash])
    return { revision, duplicate: false }
  })
}
