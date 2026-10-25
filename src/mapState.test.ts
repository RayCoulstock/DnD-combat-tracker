import test from 'node:test'
import assert from 'node:assert/strict'
import { createBattleMapState, isGridPosition, moveToken, normalizeBattleMap, reconcileBattleMap } from './mapState.ts'

test('validates integer coordinates within battlefield bounds', () => {
  assert.equal(isGridPosition({ x: 0, z: 19 }, 20, 20), true)
  assert.equal(isGridPosition({ x: 20, z: 2 }, 20, 20), false)
  assert.equal(isGridPosition({ x: 1.5, z: 2 }, 20, 20), false)
})

test('moves a known token and rejects invalid destinations', () => {
  const map = createBattleMapState([42])
  const moved = moveToken(map, 42, { x: 8, z: 11 })
  assert.deepEqual(moved.tokens['42'], { x: 8, z: 11 })
  assert.equal(moveToken(moved, 42, { x: -1, z: 0 }), moved)
  assert.equal(moveToken(moved, 'missing', { x: 1, z: 1 }), moved)
})

test('reconciles tokens when combatants are added and removed', () => {
  const initial = moveToken(createBattleMapState([1, 2]), 2, { x: 7, z: 7 })
  const changed = reconcileBattleMap(initial, [2, 3])
  assert.deepEqual(changed.tokens['2'], { x: 7, z: 7 })
  assert.ok(changed.tokens['3'])
  assert.equal(changed.tokens['1'], undefined)
})

test('normalizes exported positions without losing valid map state', () => {
  const restored = normalizeBattleMap({ version: 1, width: 20, height: 20, gridSizeFeet: 5, showGrid: false, showLabels: true, tokens: { hero: { x: 4, z: 6 } } }, ['hero'])
  assert.deepEqual(restored.tokens.hero, { x: 4, z: 6 })
  assert.equal(restored.showGrid, false)
})

test('older encounters without map data receive safe positions', () => {
  const restored = normalizeBattleMap(undefined, ['a', 'b'])
  assert.deepEqual(Object.keys(restored.tokens), ['a', 'b'])
  assert.notDeepEqual(restored.tokens.a, restored.tokens.b)
})

test('map reconciliation does not modify existing combat state', () => {
  const combatants = [{ id: 1, hp: 7, conditions: ['Poisoned'] }]
  const snapshot = structuredClone(combatants)
  reconcileBattleMap(createBattleMapState(), combatants.map(({ id }) => id))
  assert.deepEqual(combatants, snapshot)
})

test('configured feet per square survive normalization and token reconciliation',()=>{
 const restored=normalizeBattleMap({gridSizeFeet:10,tokens:{}},['a'])
 assert.equal(restored.gridSizeFeet,10);assert.equal(reconcileBattleMap(restored,['a','b']).gridSizeFeet,10)
 assert.equal(normalizeBattleMap({gridSizeFeet:0},[]).gridSizeFeet,5)
})
