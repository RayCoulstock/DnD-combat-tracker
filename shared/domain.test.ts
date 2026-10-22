import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptsSessionState, type SessionState, applyCommand, commandSchema, importEncounter, projectEncounter } from './domain.ts'
const member = '11111111-1111-4111-8111-111111111111'
export const fixture = () => importEncounter({ version: 1, round: 3, activeId: 2, usedAbilities: { '2:Action:Secret': true }, combatants: [
  { id: 1, name: 'Hero', short: 'H', side: 'hero', hp: 10, maxHp: 20, ac: 15, initiative: 18, conditions: [], saves: [], actions: [], privateNotes: 'DM secret' },
  { id: 2, name: 'Hidden dragon', short: 'D', side: 'enemy', hp: 100, maxHp: 100, ac: 20, initiative: 12, conditions: [], saves: [], actions: [], visible: false },
] })
test('version-1 files without map normalize and embedded art round trips', () => {
  const state = fixture()
  for (const mime of ['image/png', 'image/svg+xml', 'image/avif']) {
    state.combatants[0].artwork = `data:${mime};base64,aGVsbG8=`
    assert.deepEqual(importEncounter(JSON.parse(JSON.stringify(state))), state)
  }
  assert.deepEqual(state.battleMap.tokens['1'], { x: 0, z: 0 })
})
test('player projections remove hidden IDs, notes, statistics and used abilities', () => {
  const state = fixture(); state.combatants[0].ownerId = member
  const player = projectEncounter(state, { role: 'player', id: member })
  assert.equal(player.combatants.length, 1); assert.equal(player.activeId, null)
  const wire = JSON.stringify(player)
  for (const secret of ['DM secret', 'Hidden dragon', 'Secret']) assert.ok(!wire.includes(secret))
  assert.equal(player.combatants[0].hp, 10)
})
test('ownership, DM-only commands and invalid destinations are enforced', () => {
  let state = fixture()
  state = applyCommand(state, { role: 'dm', id: 'dm' }, { type: 'token.assign', combatantId: 1, playerId: member })
  assert.throws(() => applyCommand(state, { role: 'player', id: 'other' }, { type: 'token.move', combatantId: 1, destination: { x: 2, z: 2 } }))
  assert.throws(() => applyCommand(state, { role: 'player', id: member }, { type: 'initiative.next' }))
  assert.throws(() => applyCommand(state, { role: 'dm', id: 'dm' }, { type: 'token.move', combatantId: 1, destination: { x: -1, z: 0 } }))
  assert.equal(applyCommand(state, { role: 'player', id: member }, { type: 'token.move', combatantId: 1, destination: { x: 2, z: 2 } }).battleMap.tokens['1'].x, 2)
})
test('camera/identity claims are not part of any command', () => {
  assert.equal(commandSchema.safeParse({ type: 'camera.move', x: 1 }).success, false)
  assert.equal(commandSchema.safeParse({ type: 'initiative.next', role: 'dm' }).success, false)
})

test('campaign revisions reject delayed activation, termination and old encounter updates', () => {
  const current: SessionState = { campaignId: 'campaign', revision: 8, sessionActive: true, encounterId: 'new', snapshot: null }
  assert.equal(acceptsSessionState(current, { ...current, revision: 7, encounterId: 'old' }, 'campaign'), false)
  assert.equal(acceptsSessionState(current, { ...current, revision: 6, sessionActive: false }, 'campaign'), false)
  assert.equal(acceptsSessionState(current, { ...current, revision: 9, sessionActive: false }, 'campaign'), true)
  assert.equal(acceptsSessionState(current, { ...current, revision: 10, campaignId: 'other' }, 'campaign'), false)
  assert.equal(acceptsSessionState(current, current, 'campaign'), true) // reconnect, unchanged state
  assert.equal(acceptsSessionState(null, current, 'campaign'), true)
})
test('map snapshot omission keeps geometry references and requests recovery on missing versions', async () => {
  const { mergeMapSnapshot } = await import('./domain.ts')
  const { blankDungeon } = await import('./dungeon.ts')
  const state = { ...fixture(), dungeonMap: blankDungeon('cached', 'Cached'), mapRevision: 4 }
  const full = { campaignId: 'campaign', encounterId: 'encounter', name: 'Test', revision: 1, sessionActive: true, actor: { role: 'dm' as const, id: 'dm' }, state }
  const patch = { ...full, revision: 2, mapDocumentOmitted: true, state: { ...state, dungeonMap: undefined } }
  assert.equal(mergeMapSnapshot(full, patch)!.state.dungeonMap, state.dungeonMap)
  assert.equal(mergeMapSnapshot(null, patch), null)
  assert.equal(mergeMapSnapshot(full, { ...patch, state: { ...patch.state, mapRevision: 5 } }), null)
  assert.equal(mergeMapSnapshot(full, { ...patch, encounterId: 'different' }), null)
})
