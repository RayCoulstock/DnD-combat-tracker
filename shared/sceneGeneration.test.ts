import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { sceneGenerationSpecSchema, sceneAssetManifestSchema, normalizeSceneManifest, selectSceneAsset } from './sceneGeneration.ts'
import { generateDungeon } from './generator.ts'
import { editMap, emptyHistory, readDungeon } from './dungeon.ts'
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/scene-generation-v1.json', import.meta.url), 'utf8'))
const asset = (id: string, tags = ['storage']) => ({ id, revision: 1, tags, footprint: { width: 1, height: 1 }, blocking: true })
const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002'
test('shared proposal fixture parses without mutation and remains JSON portable', () => {
  const input = fixture(), before = structuredClone(input)
  assert.deepEqual(sceneGenerationSpecSchema.parse(input), before)
  assert.deepEqual(sceneGenerationSpecSchema.parse(JSON.parse(JSON.stringify(input))), before)
  assert.deepEqual(input, before)
  const manifest = JSON.parse(readFileSync(new URL('./fixtures/scene-manifest-v1.json', import.meta.url), 'utf8'))
  assert.equal(selectSceneAsset(manifest, input.zones[0].dressing[0].tag)?.id, a)
  assert.ok(normalizeSceneManifest(manifest).effects.includes(input.zones[0].effects[0]))
})
test('proposals reject unknown versions, executable fields, URLs, untrusted IDs and nonfinite budgets', () => {
  for (const patch of [{ floors: [] }, { version: 2 }, { mode: 'legacy' }, { code: 'run()' }, { url: 'https://example.test' }, { assetId: a }, { environment: { exposure: 3 } }, { budget: { scenery: Infinity, effects: 1, lights: 0, shadowLights: 0 } }])
    assert.equal(sceneGenerationSpecSchema.safeParse({ ...fixture(), ...patch }).success, false)
  for (const patch of [{ effects: ['untrusted'] }, { material: 'https://example.test' }, { roomIndex: 6 }, { floorId: 'missing' }, { id: '__proto__' }]) {
    const s = fixture(); Object.assign(s.zones[0], patch)
    assert.equal(sceneGenerationSpecSchema.safeParse(s).success, false)
  }
})
test('floor topology validates references, directed routes, dimensions and elevations', () => {
  const s = fixture()
  s.floors.push({ id: 'upper', elevationFeet: 10 })
  assert.equal(sceneGenerationSpecSchema.safeParse(s).success, false)
  s.transitions.push({ id: 'stairs', type: 'stairs', source: { floorId: 'ground', x: 3, z: 3 }, destination: { floorId: 'upper', x: 3, z: 3 }, directionality: 'two-way', movementCost: 'normal' })
  assert.ok(sceneGenerationSpecSchema.safeParse(s).success)
  for (const mutate of [
    (x: typeof s) => { x.transitions[0].destination.floorId = 'absent' },
    (x: typeof s) => { x.transitions[0].source.x = 30 },
    (x: typeof s) => { x.transitions[0].destination.floorId = 'ground' },
    (x: typeof s) => { x.floors[1].elevationFeet = .05 },
    (x: typeof s) => { x.floors[1].id = 'ground' },
    (x: typeof s) => { x.transitions.push(x.transitions[0]) },
    (x: typeof s) => { x.transitions[0].directionality = 'one-way'; [x.transitions[0].source, x.transitions[0].destination] = [x.transitions[0].destination, x.transitions[0].source] },
  ]) { const next = structuredClone(s); mutate(next); assert.equal(sceneGenerationSpecSchema.safeParse(next).success, false) }
})
test('variants require revisioned source and seeded maps cannot preserve fog', () => {
  const s = fixture(); s.fog = 'preserve'
  assert.equal(sceneGenerationSpecSchema.safeParse(s).success, false)
  s.source = { kind: 'variant', templateId: a, revision: 1 }
  assert.ok(sceneGenerationSpecSchema.safeParse(s).success)
  s.source.revision = 0
  assert.equal(sceneGenerationSpecSchema.safeParse(s).success, false)
})
test('duplicate zone IDs/room assignments and excessive budgets fail', () => {
  const s = fixture(); s.zones.push({ ...s.zones[0], id: 'second' })
  assert.equal(sceneGenerationSpecSchema.safeParse(s).success, false)
  s.zones[1].roomIndex = 1; s.zones[1].id = s.zones[0].id
  assert.equal(sceneGenerationSpecSchema.safeParse(s).success, false)
  for (const budget of [{ scenery: 101, effects: 0, lights: 0, shadowLights: 0 }, { scenery: 0, effects: 65, lights: 0, shadowLights: 0 }, { scenery: 0, effects: 0, lights: 33, shadowLights: 0 }, { scenery: 0, effects: 0, lights: 0, shadowLights: 1 }])
    assert.equal(sceneGenerationSpecSchema.safeParse({ ...fixture(), budget }).success, false)
  assert.ok(sceneGenerationSpecSchema.safeParse({ ...fixture(), budget: { scenery: 0, effects: 0, lights: 0, shadowLights: 0 } }).success)
})
test('manifest selection is order-independent, deterministic, immutable and falls back without IDs', () => {
  const input = { version: 1, assets: [asset(b), asset(a, ['storage', 'stone', 'storage'])], effects: ['small-flame', 'magical-motes'] }
  const before = structuredClone(input), normalized = normalizeSceneManifest(input)
  const reordered = { ...input, assets: [...input.assets].reverse().map(a => ({ ...a, tags: [...a.tags].reverse() })), effects: [...input.effects].reverse() }
  assert.deepEqual(normalized, normalizeSceneManifest(reordered))
  assert.deepEqual(normalized, normalizeSceneManifest(JSON.parse(JSON.stringify(input))))
  assert.equal(selectSceneAsset(input, 'storage')?.id, a)
  assert.equal(selectSceneAsset(input, 'unavailable'), undefined)
  assert.equal(selectSceneAsset({ version: 1, assets: [], effects: [] }, 'storage'), undefined)
  assert.deepEqual(input, before)
})
test('manifest rejects duplicate/untrusted assets, presets and unsafe metadata', () => {
  for (const assets of [[asset(a), asset(a)], [asset('https://example.test')], [{ ...asset(a), revision: 0 }], [{ ...asset(a), footprint: { width: 0, height: 1 } }], [{ ...asset(a), url: 'https://example.test' }]])
    assert.equal(sceneAssetManifestSchema.safeParse({ version: 1, assets, effects: [] }).success, false)
  for (const effects of [['missing'], ['magical-motes', 'magical-motes']])
    assert.equal(sceneAssetManifestSchema.safeParse({ version: 1, assets: [], effects }).success, false)
})
test('legacy golden documents remain identical across all themes and editable by canonical tools', () => {
  const hashes = {
    'stone-dungeon': '682ccc84aee3e0a7f4b3d15b89dc8c038f62d98c18a4e171ba935b77f966b861',
    cavern: 'a64a15635c6e541779ef12d847aed6bcb561bd488d01d7b3f8bc1468460e8c6c',
    'mining-outpost': '4526f9e1ce096c0b9a7e4459eed6ecce79b3a886be0b232bc8e68182776f9291',
  }
  for (const [theme, hash] of Object.entries(hashes)) {
    const document = generateDungeon({ ...fixture().options, theme })
    assert.equal(createHash('sha256').update(JSON.stringify(document)).digest('hex'), hash)
    assert.deepEqual(readDungeon(document), document)
    const result = editMap({ document, width: document.width, height: document.height }, emptyHistory(), { type: 'map.prop.remove', propId: document.props[0].id })
    assert.equal(result.frame.document!.props.length, document.props.length - 1)
    assert.equal(result.history.undo.length, 1)
  }
})
