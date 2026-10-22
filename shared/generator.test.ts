import test from 'node:test'
import assert from 'node:assert/strict'
import { generateDungeon, generateLayout } from './generator.ts'
import { readDungeon, editMap, emptyHistory } from './dungeon.ts'
const options = { width: 30, height: 25, roomCount: 6, minRoomSize: 3, maxRoomSize: 7, theme: 'stone-dungeon', seed: 'reproducible' }
test('generation is deterministic, varied, bounded and non-overlapping for all themes', () => {
  for (const theme of ['stone-dungeon','cavern','mining-outpost']) {
    const o = { ...options, theme }
    assert.deepEqual(generateDungeon(o), generateDungeon(o))
    assert.notDeepEqual(generateDungeon(o).floors, generateDungeon({ ...o, seed: 'different' }).floors)
    const { document, rooms } = generateLayout(o)
    assert.equal(rooms.length, 6); readDungeon(document)
    for (const a of rooms) {
      assert.ok(a.x >= 1 && a.z >= 1 && a.x + a.width < document.width && a.z + a.height < document.height)
      for (const b of rooms) if (a !== b) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.z + a.height <= b.z || b.z + b.height <= a.z)
    }
    const floor = new Set(document.floors.map(f => `${f.x}:${f.z}`)), visited = new Set<string>(), queue = [document.floors[0]]
    while (queue.length) {
      const f = queue.pop()!, key = `${f.x}:${f.z}`
      if (visited.has(key)) continue
      visited.add(key)
      for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) if (floor.has(`${f.x+dx}:${f.z+dz}`) && !visited.has(`${f.x+dx}:${f.z+dz}`)) queue.push({ ...f, x: f.x+dx, z: f.z+dz })
    }
    assert.equal(visited.size, floor.size)
    assert.equal(new Set(document.doors.map(d => d.wallId)).size, document.doors.length)
    const edited = editMap({ document, width: document.width, height: document.height }, emptyHistory(), { type: 'map.floor.paint', cells: [{ x: 0, z: 0 }], material: 'lava' })
    assert.ok(edited.frame.document!.floors.some(f => f.x === 0 && f.z === 0 && f.type === 'lava'))
  }
})
test('impossible options and unsupported settings fail clearly', () => {
  assert.throws(() => generateDungeon({ ...options, width: 6, height: 6, roomCount: 20 }), /cannot fit/)
  assert.throws(() => generateDungeon({ ...options, minRoomSize: 8, maxRoomSize: 3 }))
  assert.throws(() => generateDungeon({ ...options, theme: 'external-url' }))
  assert.throws(() => generateDungeon({ ...options, width: 51 }))
})
