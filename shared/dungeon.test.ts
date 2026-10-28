import test from 'node:test'
import assert from 'node:assert/strict'
import { blankDungeon, canonicalWall, readDungeon, editMap, emptyHistory, type MapFrame } from './dungeon.ts'
import { importEncounter, applyMapEdit } from './domain.ts'
const frame = (): MapFrame => ({ document: blankDungeon('test', 'Test'), width: 20, height: 20 })
test('canonical shared walls, strict versions, bounds, duplicate cells and orphan doors', () => {
  assert.deepEqual(canonicalWall(1, 1, 'east'), canonicalWall(2, 1, 'west'))
  assert.deepEqual(canonicalWall(1, 1, 'south'), canonicalWall(1, 2, 'north'))
  const map = blankDungeon('test', 'Test')
  assert.throws(() => readDungeon({ ...map, schemaVersion: 5 }))
  assert.throws(() => readDungeon({ ...map, floors: [{ x: 20, z: 0, type: 'stone' }] }))
  assert.throws(() => readDungeon({ ...map, doors: [{ id: 'door', wallId: 'H:0:0', state: 'open' }] }))
  assert.throws(() => readDungeon({ ...map, props: [{ id: 'bad', type: 'external.glb', position: { x: 0, z: 0 }, rotation: 0 }] }))
  assert.throws(() => readDungeon({ ...map, floors: [{ x: 0, z: 0, type: 'grass' }, { x: 0, z: 0, type: 'stone' }] }))
})
test('floor, wall, door and prop edits undo/redo without orphaning doors', () => {
  let result = { frame: frame(), history: emptyHistory() }
  const edit = (command: Parameters<typeof editMap>[2]) => { result = editMap(result.frame, result.history, command) }
  edit({ type: 'map.floor.paint', cells: [{ x: 1, z: 1 }], material: 'lava' })
  edit({ type: 'map.wall.place', wall: canonicalWall(1, 1, 'north') })
  edit({ type: 'map.door.place', door: { id: 'door', wallId: 'H:1:1', state: 'locked' } })
  edit({ type: 'map.door.update', doorId: 'door', state: 'open' })
  edit({ type: 'map.prop.place', prop: { id: 'crate', type: 'crate', position: { x: 1, z: 1 }, rotation: 0 } })
  edit({ type: 'map.prop.rotate', propId: 'crate', rotation: 90 })
  assert.equal(result.frame.document!.props[0].rotation, 90)
  edit({ type: 'map.undo' }); assert.equal(result.frame.document!.props[0].rotation, 0)
  edit({ type: 'map.redo' }); assert.equal(result.frame.document!.props[0].rotation, 90)
  edit({ type: 'map.wall.remove', wallId: 'H:1:1' }); assert.equal(result.frame.document!.doors.length, 0)
  assert.deepEqual(readDungeon(JSON.parse(JSON.stringify(result.frame.document))), result.frame.document)
  for (let i = 0; i < 30; i++) edit({ type: 'map.floor.paint', cells: [{ x: 0, z: 0 }], material: i % 2 ? 'wood' : 'dirt' })
  assert.equal(result.history.undo.length, 20)
})
test('old encounter files stay flat; malformed dungeon imports are atomic; players cannot edit', () => {
  const old = importEncounter({ version: 1, round: 3, combatants: [] })
  assert.equal(old.dungeonMap, undefined)
  assert.throws(() => importEncounter({ ...old, dungeonMap: { schemaVersion: 999 } }))
  assert.equal(old.round, 3)
  assert.throws(() => applyMapEdit(old, { role: 'player', id: 'player' }, { type: 'map.load', document: frame().document! }, emptyHistory()))
  const edited = applyMapEdit(old, { role: 'dm', id: 'dm' }, { type: 'map.load', document: frame().document! }, emptyHistory())
  assert.deepEqual(importEncounter(edited.state).dungeonMap, edited.state.dungeonMap)
})
test('map undo preserves combat and deterministic relocation', () => {
  const state = importEncounter({ version: 1, round: 9, combatants: [
    { id: 1, name: 'Moved hero', side: 'hero', hp: 7, maxHp: 10, ac: 15, initiative: 20, conditions: ['Poisoned'], saves: [], actions: [] },
    { id: 2, name: 'Reserved square', side: 'hero', hp: 8, maxHp: 10, ac: 15, initiative: 10, conditions: [], saves: [], actions: [] },
  ], battleMap: { width: 20, height: 20, tokens: { '1': { x: 19, z: 19 }, '2': { x: 0, z: 0 } } } })
  const resized = applyMapEdit(state, { role: 'dm', id: 'dm' }, { type: 'map.blank', id: 'small', name: 'Small', width: 4, height: 4 }, emptyHistory())
  assert.deepEqual(resized.state.battleMap.tokens['1'], { x: 1, z: 0 })
  assert.deepEqual(resized.state.battleMap.tokens['2'], { x: 0, z: 0 })
  const changed = { ...resized.state, round: 10, combatants: resized.state.combatants.map(c => ({ ...c, hp: 3 })) }
  const undone = applyMapEdit(changed, { role: 'dm', id: 'dm' }, { type: 'map.undo' }, resized.history)
  assert.equal(undone.state.round, 10); assert.equal(undone.state.combatants[0].hp, 3)
  assert.equal(undone.state.dungeonMap, undefined); assert.equal(undone.state.battleMap.width, 20)
})
test('all procedural props round-trip and unsafe assets or ambiguous object IDs are rejected', () => {
  const map = blankDungeon('large', 'Large', 50, 50)
  const types = ['crate', 'barrel', 'chest', 'table', 'chair', 'pillar', 'torch', 'rock', 'anvil', 'brazier'] as const
  map.floors = Array.from({ length: 2500 }, (_, i) => ({ x: i % 50, z: Math.floor(i / 50), type: 'stone' as const }))
  map.props = types.map((type, i) => ({ id: type, type, position: { x: i, z: 49 }, rotation: 270 }))
  assert.deepEqual(readDungeon(JSON.parse(JSON.stringify(map))), map)
  assert.throws(() => readDungeon({ ...map, props: [{ ...map.props[0], url: 'https://untrusted.test/model.glb' }] }))
  assert.throws(() => readDungeon({ ...map, script: 'alert(1)' }))
  const wall = canonicalWall(0, 0, 'north')
  assert.throws(() => readDungeon({ ...map, walls: [wall], props: [{ ...map.props[0], id: wall.id }] }))
  assert.throws(() => readDungeon({ ...map, walls: [wall, wall] }))
})
test('removal operations and history byte cap preserve valid serialisable maps', () => {
  let result = { frame: frame(), history: emptyHistory() }
  const edit = (command: Parameters<typeof editMap>[2]) => { result = editMap(result.frame, result.history, command) }
  edit({ type: 'map.floor.paint', cells: [{ x: 0, z: 0 }], material: 'stone' })
  edit({ type: 'map.floor.paint', cells: [{ x: 0, z: 0 }], material: null })
  assert.equal(result.frame.document!.floors.length, 0)
  edit({ type: 'map.wall.place', wall: canonicalWall(0, 0, 'north') })
  edit({ type: 'map.door.place', door: { id: 'door', wallId: 'H:0:0', state: 'closed' } })
  edit({ type: 'map.door.remove', doorId: 'door' })
  assert.equal(result.frame.document!.walls.length, 1)
  edit({ type: 'map.prop.place', prop: { id: 'barrel', type: 'barrel', position: { x: 0, z: 0 }, rotation: 0 } })
  edit({ type: 'map.prop.remove', propId: 'barrel' }); assert.equal(result.frame.document!.props.length, 0)
  const large = blankDungeon('large', '大'.repeat(150), 50, 50)
  large.floors = Array.from({ length: 2500 }, (_, i) => ({ x: i % 50, z: Math.floor(i / 50), type: 'stone' as const }))
  large.walls = [...Array.from({ length: 2550 }, (_, i) => canonicalWall(i % 50, Math.floor(i / 50), 'north')), ...Array.from({ length: 2550 }, (_, i) => canonicalWall(Math.floor(i / 50), i % 50, 'west'))]
  for (let i = 0; i < 25; i++) edit({ type: 'map.load', document: large })
  assert.ok(result.history.undo.length < 20)
  assert.ok(new TextEncoder().encode(JSON.stringify(result.history.undo)).byteLength <= 2_000_000)
})
