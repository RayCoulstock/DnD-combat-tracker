import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { generateLayout } from './generator.ts'
import { dungeonLevels, editMap, emptyHistory, readDungeon, canonicalWall } from './dungeon.ts'
import { sceneGenerationSpecSchema, type SceneAssetManifest } from './sceneGeneration.ts'
import { placeSceneAssets, sceneFootprintCells, sceneManifestFromAssets, validateSceneRoutes } from './sceneGenerationAssets.ts'
import { assetMetadataSchema, type Asset3D } from './assets.ts'
const id = '00000000-0000-4000-8000-000000000001'
const spec = () => sceneGenerationSpecSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/scene-generation-v1.json', import.meta.url), 'utf8')))
const manifest = (): SceneAssetManifest => ({ version: 1, effects: [], assets: [{ id, revision: 1, tags: ['storage'], footprint: { width: 1, height: 1 }, blocking: true }] })
const library = (patch: Partial<Asset3D> = {}): Asset3D => ({ ...assetMetadataSchema.parse({ name: 'Crate', category: 'furniture', tags: ['storage'] }), id, revision: 1, fileName: 'crate.glb', fileSize: 1, contentType: 'model/gltf-binary', format: 'glb', uploadStatus: 'ready', validationStatus: 'valid', metrics: { vertices: 0, triangles: 0, nodes: 0, materials: 0, animations: 0, textures: 0 }, createdAt: '', updatedAt: '', ...patch })

test('authority adapter requires pinned verified footprints and ready valid metadata', () => {
  const verified = [{ id, revision: 1, footprint: { width: 1, height: 2 }, blocking: true }]
  assert.equal(sceneManifestFromAssets([library()], verified).assets.length, 1)
  for (const asset of [library({ revision: 2 }), library({ uploadStatus: 'deleted' }), library({ uploadStatus: 'processing' })]) assert.deepEqual(sceneManifestFromAssets([asset], verified).assets, [])
  assert.deepEqual(sceneManifestFromAssets([library()], []).assets, [])
  assert.throws(() => sceneManifestFromAssets([library()], [...verified, ...verified]), /Duplicate/)
  assert.throws(() => sceneManifestFromAssets([library()], [{ ...verified[0], footprint: { width: 0, height: 2 } }]))
})
test('footprints conservatively cover centred rotated and scaled models', () => {
  assert.equal(sceneFootprintCells({ x: 3, z: 3 }, { width: 1, height: 1 }).length, 1)
  assert.deepEqual(sceneFootprintCells({ x: 3, z: 3 }, { width: 1, height: 3 }, 90), [{ x: 2, z: 3 }, { x: 3, z: 3 }, { x: 4, z: 3 }])
  assert.equal(sceneFootprintCells({ x: 3, z: 3 }, { width: 1, height: 1 }, 45).length, 9)
  assert.equal(sceneFootprintCells({ x: 3, z: 3 }, { width: 2, height: 2 }).length, 9)
  assert.throws(() => sceneFootprintCells({ x: 0, z: 0 }, { width: 50, height: 50 }, 0, 20))
})
test('routes honor walls and locked doors, with closed unlocked doors traversable', () => {
  const map = generateLayout(spec().options).document
  map.floors = [{ x: 1, z: 1, type: 'stone' }, { x: 2, z: 1, type: 'stone' }]; map.props = []
  map.walls = [canonicalWall(1, 1, 'east')]; map.doors = [{ id: 'door', wallId: map.walls[0].id, state: 'closed' }]
  const essentials = [{ x: 1, z: 1 }, { x: 2, z: 1 }]
  validateSceneRoutes(dungeonLevels(map)[0], essentials)
  const locked = structuredClone(map); locked.doors[0].state = 'locked'
  assert.throws(() => validateSceneRoutes(dungeonLevels(locked)[0], essentials), /Inaccessible/)
  assert.throws(() => validateSceneRoutes(dungeonLevels(map)[0], essentials, new Set(['2:1'])), /Inaccessible/)
  assert.throws(() => validateSceneRoutes(dungeonLevels(map)[0], [...essentials, { x: 0, z: 0 }]), /Inaccessible/)
})
test('seeded stage is portable, immutable, deterministic and canonically editable', () => {
  const s = spec(), document = generateLayout(s.options).document, context = { manifest: manifest() }
  const before = structuredClone({ s, document, context })
  const result = placeSceneAssets(s, context, document)
  assert.deepEqual(result, placeSceneAssets(JSON.parse(JSON.stringify(s)), JSON.parse(JSON.stringify(context)), JSON.parse(JSON.stringify(document))))
  assert.deepEqual({ s, document, context }, before)
  assert.deepEqual(readDungeon(result.document), result.document)
  const added = result.document.props.find(p => p.id.startsWith('assets:'))!
  assert.ok(added)
  assert.equal(added.type, 'asset')
  const edited = editMap({ document: result.document, width: document.width, height: document.height }, emptyHistory(), { type: 'map.prop.remove', propId: added.id })
  assert.equal(edited.frame.document!.props.length, result.document.props.length - 1)
  assert.equal(edited.history.undo.length, 1)
})
test('empty and oversized manifests use checked built-in fallback; zero budgets add nothing', () => {
  const s = spec(), document = generateLayout(s.options).document
  for (const m of [{ version: 1 as const, effects: [], assets: [] }, { ...manifest(), assets: manifest().assets.map(a => ({ ...a, footprint: { width: 50, height: 50 } })) }]) {
    const result = placeSceneAssets(s, { manifest: m }, document)
    assert.ok(result.diagnostics.some(d => d.code === 'asset-fallback'))
    assert.ok(result.document.props.some(p => p.id.startsWith('assets:') && p.type === 'crate'))
  }
  s.budget.scenery = 0
  const result = placeSceneAssets(s, { manifest: manifest() }, document)
  assert.deepEqual(result.document.props, document.props)
  assert.ok(result.diagnostics.some(d => d.code === 'budget-reduced'))
})
test('invalid geometry, unknown existing asset, ID collision and unresolved variants fail closed', () => {
  const s = spec(), document = generateLayout(s.options).document
  const unknown = structuredClone(document); unknown.schemaVersion = 2
  unknown.props.push({ id: 'unknown', type: 'asset', assetId: id, position: { x: 0, z: 0 }, rotation: 0, scale: 1, verticalOffset: 0, visible: true, label: 'Unknown', category: 'decoration' })
  assert.throws(() => placeSceneAssets(s, { manifest: { version: 1, assets: [], effects: [] } }, unknown), /trusted footprint/)
  const changed = structuredClone(document); changed.floors.pop()
  assert.throws(() => placeSceneAssets(s, { manifest: manifest() }, changed), /Unresolved/)
  const collision = structuredClone(document); collision.props[0].id = 'assets:0:0:0:0'
  assert.throws(() => placeSceneAssets(s, { manifest: manifest() }, collision), /collision/)
  assert.throws(() => placeSceneAssets({ ...s, source: { kind: 'variant', templateId: id, revision: 1 } }, { manifest: manifest(), sourceDocument: document }, document), /room-analysis/)
})
test('dense dressing respects occupancy, essential routes, source content and total budget', () => {
  const s = spec(), layout = generateLayout(s.options), document = layout.document
  s.zones[0].dressing[0].density = 'dense'
  s.budget.scenery = document.props.length + 1
  const result = placeSceneAssets(s, { manifest: manifest() }, document)
  assert.equal(result.document.props.length, document.props.length + 1)
  assert.deepEqual(result.document.props.slice(0, document.props.length), document.props)
  assert.ok(result.diagnostics.some(d => d.code === 'budget-reduced'))
  const occupied = new Set<string>()
  for (const p of result.document.props) {
    const k = `${p.position.x}:${p.position.z}`
    assert.ok(!occupied.has(k)); occupied.add(k)
  }
  validateSceneRoutes(dungeonLevels(result.document)[0], layout.rooms.map(r => ({ x: r.x + Math.floor(r.width / 2), z: r.z + Math.floor(r.height / 2) })), occupied)
  const overlap = structuredClone(document); overlap.props.push({ ...overlap.props[0], id: 'overlap' })
  assert.throws(() => placeSceneAssets(s, { manifest: manifest() }, overlap), /overlapping/)
})
test('multi-floor dressing reserves walkable transition endpoints and preserves canonical metadata', () => {
  const s = spec(), lower = generateLayout(s.options), upper = generateLayout({ ...s.options, seed: `${s.options.seed}:floor:upper` })
  s.floors.push({ id: 'upper', elevationFeet: 10 })
  s.zones.push({ ...structuredClone(s.zones[0]), id: 'upper-zone', floorId: 'upper' })
  const point = (room: typeof lower.rooms[number], floorId: string) => ({ floorId, x: room.x + Math.floor(room.width / 2), z: room.z + Math.floor(room.height / 2) })
  s.transitions.push({ id: 'stairs', type: 'stairs', source: point(lower.rooms[0], 'ground'), destination: point(upper.rooms[0], 'upper'), directionality: 'two-way', movementCost: 'normal' })
  const base = dungeonLevels(upper.document)[0]
  const document = readDungeon({ ...lower.document, schemaVersion: 6, level: { id: 'ground', name: 'Ground', elevationFeet: 0, playerVisible: true }, levels: [{ ...base, id: 'upper', elevationFeet: 10 }], transitions: s.transitions })
  const result = placeSceneAssets(s, { manifest: manifest() }, document)
  assert.deepEqual(result.document.transitions, document.transitions)
  assert.equal(result.document.schemaVersion, 6)
  for (const level of dungeonLevels(result.document)) assert.ok(level.props.some(p => p.id.startsWith('assets:')))
  const orphan = structuredClone(s); orphan.transitions[0].destination.x = 0; orphan.transitions[0].destination.z = 0
  assert.throws(() => placeSceneAssets(orphan, { manifest: manifest() }, { ...document, transitions: orphan.transitions }), /Inaccessible/)
})
