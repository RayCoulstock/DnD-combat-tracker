import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { coordinateSceneGeneration, type SceneGenerationAdapters } from './sceneGenerationCoordinator.ts'
import { generateDungeon } from './generator.ts'
import { dungeonLevels, readDungeon } from './dungeon.ts'
import { sceneGenerationSpecSchema, type SceneGenerationContext, type SceneGenerationStage } from './sceneGeneration.ts'
const fixture = () => sceneGenerationSpecSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/scene-generation-v1.json', import.meta.url), 'utf8')))
const identity: SceneGenerationStage = (_spec, _context, document) => ({ document, diagnostics: [] })
const adapters: SceneGenerationAdapters = { assets: identity, environment: identity, validate: identity, resolveVariantRooms: () => {} }
const context: SceneGenerationContext = { manifest: { version: 1, assets: [], effects: [] } }
test('coordinator sequences typed B/C mocks, normalizes manifests and isolates all inputs', () => {
  const spec = fixture(), before = structuredClone(spec), calls: string[] = []
  const stage = (name: string): SceneGenerationStage => (s, c, document) => {
    calls.push(name); assert.equal(c.manifest.assets.length, 0)
    s.options.seed = 'mutated'; c.manifest.effects.push('magical-motes')
    return { document, diagnostics: [{ code: 'asset-fallback', zoneId: 'entry' }] }
  }
  const mocks = { ...adapters, assets: stage('B'), environment: stage('C'), validate: stage('validate') }
  const result = coordinateSceneGeneration(spec, context, mocks)
  assert.deepEqual(calls, ['B', 'C', 'validate']); assert.equal(result.diagnostics.length, 3)
  assert.deepEqual(spec, before); assert.deepEqual(context.manifest.effects, [])
  assert.deepEqual(result.document.floors, generateDungeon(spec.options).floors)
  assert.equal(result.document.fogOfWar?.enabled, true); assert.deepEqual(result.document.fogOfWar?.floors, {})
  assert.deepEqual(coordinateSceneGeneration(spec, context, adapters), coordinateSceneGeneration(JSON.parse(JSON.stringify(spec)), structuredClone(context), adapters))
})
test('multi-floor seeds and canonical transition endpoints are realized deterministically', () => {
  const spec = fixture(); spec.floors.push({ id: 'upper', elevationFeet: 10 })
  const source = generateDungeon(spec.options).floors[0], destination = generateDungeon({ ...spec.options, seed: `${spec.options.seed}:floor:upper` }).floors[0]
  spec.transitions.push({ id: 'stairs', type: 'stairs', directionality: 'two-way', movementCost: 'normal', source: { floorId: 'ground', x: source.x, z: source.z }, destination: { floorId: 'upper', x: destination.x, z: destination.z } })
  const result = coordinateSceneGeneration(spec, context, adapters).document
  assert.equal(result.schemaVersion, 6); assert.equal(dungeonLevels(result).length, 2)
  assert.deepEqual(result.levels![0].floors, generateDungeon({ ...spec.options, seed: `${spec.options.seed}:floor:upper` }).floors)
  assert.deepEqual(readDungeon(result), result)
})
test('variants clone source and reject floor, transition and geometry changes', () => {
  const spec = fixture(), source = coordinateSceneGeneration(spec, context, adapters).document
  spec.source = { kind: 'variant', templateId: '00000000-0000-4000-8000-000000000001', revision: 1 }; spec.fog = 'preserve'
  const before = structuredClone(source), c = { ...context, sourceDocument: source }
  const result = coordinateSceneGeneration(spec, c, adapters)
  result.document.props[0].rotation = 90
  assert.deepEqual(source, before)
  assert.throws(() => coordinateSceneGeneration(spec, context, adapters), /source/)
  assert.throws(() => coordinateSceneGeneration({ ...spec, options: { ...spec.options, width: 31 } }, c, adapters), /dimensions/)
  assert.throws(() => coordinateSceneGeneration(spec, c, { ...adapters, resolveVariantRooms: () => { throw new Error('Unresolved zone') } }), /Unresolved/)
  assert.throws(() => coordinateSceneGeneration(spec, c, { ...adapters, assets: (_s, _c, document) => ({ document: { ...document, floors: [] }, diagnostics: [] }) }), /geometry/)
  assert.deepEqual(source, before)
})
test('failed spatial validation, fog changes, invalid output and diagnostics fail closed', () => {
  const spec = fixture()
  assert.throws(() => coordinateSceneGeneration(spec, context, { ...adapters, validate: () => { throw new Error('Blocked route') } }), /Blocked route/)
  assert.throws(() => coordinateSceneGeneration(spec, context, { ...adapters, environment: (_s, _c, document) => ({ document: { ...document, fogOfWar: undefined }, diagnostics: [] }) }), /fog/)
  assert.throws(() => coordinateSceneGeneration(spec, context, { ...adapters, assets: (_s, _c, document) => ({ document: { ...document, width: -1 }, diagnostics: [] }) }))
  assert.throws(() => coordinateSceneGeneration(spec, context, { ...adapters, assets: (_s, _c, document) => ({ document, diagnostics: [{ code: 'asset-fallback', zoneId: 'absent' }] }) }), /diagnostics/)
})
