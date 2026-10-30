import { ownedEntry } from './combatant-library.ts'
import { instantiateLibrary, characterStateSchema } from '../shared/combatantLibrary.ts'
import { isGridPosition } from '../src/mapState.ts'
import { syncEncounterImages, imageIds, historyImageIds } from './floor-image-references.ts'
import type { PoolClient } from 'pg'
import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import { applyCommand, applyMapEdit, isMapEdit, DomainError, projectEncounter, type Actor, type CommandEnvelope, type EncounterState, type Snapshot, type SessionState } from '../shared/domain.ts'
import { transaction, type Pool } from './db.ts'
import { generateDungeon } from '../shared/generator.ts'
import { dungeonLevels, primaryLevelId, emptyHistory, readDungeon, type MapHistory } from '../shared/dungeon.ts'
import {activeTactical} from '../shared/tactical.ts'
import { isScenery } from '../shared/scenery.ts'
import { sceneryAssets, historyAssets, syncEncounterScenery } from './scenery.ts'
import { miniatureReferences } from './miniatures.ts'
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
  const references = new Set((await db.query("SELECT combatant_id FROM combatant_asset_references r JOIN assets_3d a ON a.id=r.asset_id WHERE r.encounter_id=$1 AND a.upload_status='ready'", [encounterId])).rows.map(r => r.combatant_id))
  return { ...encounter.state, ...(encounter.state.tactical?{tactical:activeTactical(encounter.state.tactical,Date.now())}:{}), dungeonMap: instance?.document ? readDungeon(instance.document) : undefined, mapRevision: instance?.revision ?? 0, mapUndoDepth: instance?.history.undo.length ?? 0, mapRedoDepth: instance?.history.redo.length ?? 0, combatants: rows.map(r => ({ ...r.data, miniatureStatus: r.data.miniature?.assetId ? (references.has(r.id) ? 'ready' : 'unavailable') : undefined, ownerId: r.owner_id, visible: r.visible })),
    battleMap: { ...encounter.state.battleMap, tokens: Object.fromEntries(rows.map(r => [r.id, r.position])) } }
}
export async function persistState(db: PoolClient, encounterId: string, input: EncounterState, history?: MapHistory, allowUnresolved = false, requiredAssetId?: string, requiredScenery: string[] = [], requiredImage?: string) {
  const saved = (await db.query('SELECT document,history FROM encounter_maps WHERE encounter_id=$1', [encounterId])).rows[0]
  const mapHistory: MapHistory = history ?? saved?.history ?? emptyHistory()
  const priorScenery = new Set([...sceneryAssets(saved?.document ? readDungeon(saved.document) : undefined), ...historyAssets(saved?.history ?? emptyHistory())])
  const sceneryIds = [...sceneryAssets(input.dungeonMap), ...historyAssets(mapHistory)]
  const available = await miniatureReferences(db, encounterId, input, allowUnresolved, requiredAssetId, sceneryIds)
  let state = await storeArtwork(db, input)
  if(state.tactical){
    const owner=(await db.query('SELECT c.owner_id FROM campaigns c JOIN encounters e ON e.campaign_id=c.id WHERE e.id=$1',[encounterId])).rows[0].owner_id
    state={...state,tactical:activeTactical(state.tactical,Date.now()).map(r=>r.ownerId==='imported'?{...r,ownerId:owner}:r)}
  }
  const existing = (await db.query('SELECT document FROM encounter_maps WHERE encounter_id=$1', [encounterId])).rows[0]
  if (history || !isDeepStrictEqual(existing?.document ?? null, state.dungeonMap ?? null)) {
    if (state.dungeonMap) readDungeon(state.dungeonMap)
    await db.query(`INSERT INTO encounter_maps(encounter_id,document,history,schema_version) VALUES($1,$2,$3,$4)
      ON CONFLICT(encounter_id) DO UPDATE SET document=$2,history=$3,schema_version=$4,revision=encounter_maps.revision+1,updated_at=now()`, [encounterId, state.dungeonMap ?? null, history ?? emptyHistory(), state.dungeonMap?.schemaVersion ?? 1])
  }
  await db.query('UPDATE encounters SET state=$2,updated_at=now() WHERE id=$1', [encounterId, { ...state, dungeonMap: undefined, mapRevision: undefined, mapUndoDepth: undefined, mapRedoDepth: undefined, combatants: [], battleMap: { ...state.battleMap, tokens: {} } }])
  await db.query('DELETE FROM combatants WHERE encounter_id=$1', [encounterId])
  for (const [ordinal, c] of state.combatants.entries()) {
    await db.query('INSERT INTO combatants(encounter_id,id,ordinal,data,owner_id,visible,position) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [encounterId, String(c.id), ordinal, { ...c, miniatureStatus: undefined }, c.ownerId, c.visible, state.battleMap.tokens[String(c.id)]])
    if (c.miniature?.assetId && available.has(c.miniature.assetId)) await db.query('INSERT INTO combatant_asset_references(encounter_id,combatant_id,asset_id) VALUES($1,$2,$3)', [encounterId, String(c.id), c.miniature.assetId])
  }
  await syncEncounterScenery(db, encounterId, state.dungeonMap, mapHistory, available, allowUnresolved, priorScenery, requiredScenery)
  await syncEncounterImages(db, encounterId, state.dungeonMap, mapHistory, [...imageIds(saved?.document), ...historyImageIds(saved?.history ?? emptyHistory())], allowUnresolved, requiredImage)
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
    if(command.type==='library.add'){
      const entry=await ownedEntry(db,actor,command.entryId)
      if(entry.kind!=='monster-template'&&entry.campaignId&&entry.campaignId!==campaignId)throw new DomainError('INVALID','This character belongs to another campaign.')
      const saved=(await db.query('SELECT state FROM campaign_character_state WHERE campaign_id=$1 AND library_id=$2',[campaignId,entry.id])).rows[0]
      let instance=instantiateLibrary(entry,command.instanceId,current,command.useSavedState?saved?.state:undefined,command.allowDuplicate)
      const assetId=instance.miniature?.assetId
      if(assetId&&!(await db.query("SELECT 1 FROM assets_3d WHERE id=$1 AND owner_id=$2 AND upload_status='ready' FOR UPDATE",[assetId,actor.id])).rowCount)instance={...instance,miniature:{...instance.miniature!,assetId:null}}
      const floorId=command.floorId??primaryLevelId(current.dungeonMap)
      const level=current.dungeonMap&&dungeonLevels(current.dungeonMap).find(l=>l.id===floorId)
      if(current.dungeonMap&&!level)throw new DomainError('INVALID','Choose an existing floor.')
      if(command.destination&&!isGridPosition(command.destination,level?.width??current.battleMap.width,level?.height??current.battleMap.height))throw new DomainError('INVALID','Choose a square inside the active floor.')
      instance={...instance,floorId,unplaced:!command.destination}
      if(command.destination)current.battleMap={...current.battleMap,tokens:{...current.battleMap.tokens,[String(instance.id)]:command.destination}}
      command={type:'combatant.add',floorId,combatants:[instance],allowPersistentDuplicate:command.allowDuplicate}
    }
    if(command.type==='library.state.save'){
      if(actor.role!=='dm')throw new DomainError('FORBIDDEN','Dungeon Master access required.')
      const c=current.combatants.find(c=>String(c.id)===String(command.combatantId))
      if(!c?.sourceLibraryId)throw new DomainError('INVALID','This combatant has no library identity.')
      const entry=await ownedEntry(db,actor,c.sourceLibraryId)
      if(entry.kind==='monster-template'||entry.campaignId&&entry.campaignId!==campaignId)throw new DomainError('INVALID','This is not a character in this campaign.')
      const prior=(await db.query('SELECT revision FROM campaign_character_state WHERE campaign_id=$1 AND library_id=$2 FOR UPDATE',[campaignId,entry.id])).rows[0]
      if((prior?.revision??0)!==command.expectedRevision)throw new DomainError('CONFLICT','Campaign state changed. Review it before saving again.')
      if(command.conditions.some(condition=>!c.conditions.includes(condition)))throw new DomainError('INVALID','Choose long-term conditions from this combatant.')
      await db.query(`INSERT INTO campaign_character_state(campaign_id,library_id,state) VALUES($1,$2,$3) ON CONFLICT(campaign_id,library_id) DO UPDATE SET state=$3,revision=campaign_character_state.revision+1,updated_at=now()`,[campaignId,entry.id,characterStateSchema.parse({hp:c.hp,maxHp:c.maxHp,conditions:command.conditions})])
    }
    let next: EncounterState, history: MapHistory | undefined
    if(command.type==='library.state.save'){next=current}
    else if (isMapEdit(command)) {
      const saved = (await db.query('SELECT history FROM encounter_maps WHERE encounter_id=$1', [encounter.id])).rows[0]
      const result = applyMapEdit(current, actor, command, saved?.history ?? emptyHistory())
      next = result.state; history = result.history
    } else { next = applyCommand(current, actor, command); if (command.type === 'encounter.restore' || command.type === 'encounter.clear') history = emptyHistory() }
    const incoming = data.command
    const architecture = incoming.type==='map.draw' ? {kind:'wall',visual:incoming.visual} : incoming.type==='map.wall.visual' ? {kind:'wall',visual:incoming.visual} : incoming.type==='map.door.visual' ? {kind:'door',visual:incoming.visual} : incoming.type==='map.wall.place' ? {kind:'wall',visual:incoming.wall.visual} : incoming.type==='map.door.place' ? {kind:'door',visual:incoming.door.visual} : null
    if(architecture?.visual && !(await db.query("SELECT 1 FROM assets_3d WHERE id=$1 AND owner_id=$2 AND upload_status='ready' AND presentation->'architecture'->>'role'=$3",[architecture.visual.assetId,campaign.owner_id,architecture.kind])).rowCount)throw new DomainError('FORBIDDEN',`Choose a ready ${architecture.kind} asset from your own library.`)
    const requiredScenery = incoming.type==='map.transition.set'?(incoming.transition.assetId?[incoming.transition.assetId]:[]):incoming.type==='map.draw' ? (incoming.visual?[incoming.visual.assetId]:[]) : (incoming.type === 'map.wall.visual' || incoming.type === 'map.door.visual') ? (incoming.visual ? [incoming.visual.assetId] : []) : incoming.type === 'map.wall.place' ? (incoming.wall.visual ? [incoming.wall.visual.assetId] : []) : incoming.type === 'map.door.place' ? (incoming.door.visual ? [incoming.door.visual.assetId] : []) : incoming.type === 'map.scenery.place' ? [incoming.prop.assetId] : incoming.type === 'map.prop.place' && isScenery(incoming.prop) ? [incoming.prop.assetId] : incoming.type === 'map.scenery.duplicate' ? (next.dungeonMap?dungeonLevels(next.dungeonMap).filter(l=>l.id===(incoming.levelId??primaryLevelId(next.dungeonMap))).flatMap(l=>l.props.filter(isScenery).filter(p=>p.id===incoming.newId).map(p=>p.assetId)):[]) : []
    await persistState(db, encounter.id, next, history, command.type === 'encounter.restore' || data.command.type === 'map.template.load', data.command.type === 'combatant.miniature.update' ? data.command.miniature.assetId ?? undefined : undefined, requiredScenery, incoming.type === 'map.floorImage.set' ? incoming.image?.imageId : undefined)
    const revision = encounter.revision + 1
    await db.query('UPDATE encounters SET revision=$2 WHERE id=$1', [encounter.id, revision])
    await db.query('UPDATE campaigns SET state_revision=state_revision+1 WHERE id=$1', [campaignId])
    await db.query('INSERT INTO command_receipts(encounter_id,actor_id,command_id,revision,payload_hash) VALUES($1,$2,$3,$4,$5)', [encounter.id, actor.id, data.commandId, revision, hash])
    return { revision, duplicate: false }
  })
}
