import test from 'node:test'
import assert from 'node:assert/strict'
import { miniatureSchema, baseFootprint, inferBaseSize } from './miniatures.ts'
import { applyCommand, commandSchema, importEncounter, projectEncounter } from './domain.ts'
const assetId = '11111111-1111-4111-8111-111111111111'
const state = () => importEncounter({ version: 1, round: 1, combatants: [{ id: 1, name: 'Hero', side: 'hero', hp: 10, maxHp: 10, ac: 15, initiative: 10, conditions: [], saves: [], actions: [] }] })
test('miniature defaults, bounded settings, sizes and legacy serialization', () => {
  assert.equal(state().combatants[0].miniature, undefined)
  const appearance = miniatureSchema.parse({ assetId })
  assert.equal(appearance.showBase, true); assert.equal(appearance.baseSize, 'Medium')
  for (const patch of [{ assetId: 'https://evil/model.glb' }, { scale: 0 }, { scale: Infinity }, { rotation: 361 }, { verticalOffset: NaN }, { url: '/external.glb' }]) assert.throws(() => miniatureSchema.parse({ ...appearance, ...patch }))
  assert.equal(inferBaseSize('Large undead'), 'Large'); assert.equal(inferBaseSize('Unknown'), 'Medium')
  assert.deepEqual(['Small', 'Medium', 'Large', 'Huge'].map(s => baseFootprint(s as typeof appearance.baseSize)), [1,1,2,3])
  const assigned = applyCommand(state(), { role: 'dm', id: 'dm' }, commandSchema.parse({ type: 'combatant.miniature.update', combatantId: 1, miniature: appearance }))
  assert.deepEqual(importEncounter(JSON.parse(JSON.stringify(assigned))).combatants[0].miniature, appearance)
  assert.throws(() => applyCommand(state(), { role: 'player', id: 'player' }, { type: 'combatant.miniature.update', combatantId: 1, miniature: appearance }))
  assert.deepEqual(projectEncounter(assigned, { role: 'player', id: 'player' }).combatants[0].miniature, appearance)
  assert.equal(projectEncounter({ ...assigned, combatants: assigned.combatants.map(c => ({ ...c, visible: false })) }, { role: 'player', id: 'player' }).combatants.length, 0)
  const moved = applyCommand(assigned, { role: 'dm', id: 'dm' }, { type: 'token.move', combatantId: 1, destination: { x: 2, z: 3 } })
  assert.deepEqual(moved.combatants[0].miniature, appearance)
})
