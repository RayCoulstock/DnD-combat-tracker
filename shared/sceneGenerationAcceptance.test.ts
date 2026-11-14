import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { coordinateSceneGeneration } from './sceneGenerationCoordinator.ts'
import { sceneGenerationSpecSchema, normalizeSceneManifest, type SceneAssetManifest } from './sceneGeneration.ts'
import { dungeonLevels, editMap, emptyHistory, readDungeon } from './dungeon.ts'
import { generateLayout } from './generator.ts'
import { emptyEncounter, applyMapEdit, projectEncounter, importEncounter } from './domain.ts'
const fixture = () => sceneGenerationSpecSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/scene-generation-v1.json', import.meta.url), 'utf8')))
const manifest = (): SceneAssetManifest => ({ version: 1, assets: [{ id: '00000000-0000-4000-8000-000000000001', revision: 1, tags: ['storage'], footprint: { width: 1, height: 1 }, blocking: true }], effects: ['campfire', 'magical-motes'] })

test('real B/C pipeline is deterministic, immutable, canonical and preserves hidden linked glow', () => {
  const spec = fixture(), context = { manifest: manifest() }; spec.zones[0].effects = ['campfire', 'magical-motes']
  const before = structuredClone({ spec, context })
  const result = coordinateSceneGeneration(spec, context)
  assert.deepEqual({ spec, context }, before)
  assert.deepEqual(result, coordinateSceneGeneration(JSON.parse(JSON.stringify(spec)), { manifest: normalizeSceneManifest(context.manifest) }))
  assert.deepEqual(readDungeon(result.document), result.document)
  assert.ok(result.document.props.some(p => p.type === 'asset'))
  assert.equal(result.document.environmentalEffects?.effects.length, 2)
  assert.equal(result.document.lighting?.sources?.length, 1)
  const state = { ...emptyEncounter(), dungeonMap: result.document }
  const player = projectEncounter(state, { id: 'player', role: 'player' })
  assert.equal(player.dungeonMap?.environmentalEffects?.effects.length, 0)
  assert.equal(player.dungeonMap?.lighting?.sources?.length, 0)
  for (const effect of result.document.environmentalEffects!.effects) assert.equal(JSON.stringify(player).includes(effect.id), false)
})
test('real B/C pipeline handles missing/deleted assets, effects, oversized footprints and zero budgets', () => {
  const spec = fixture()
  for (const available of [{ ...manifest(), assets: [], effects: [] }, { ...manifest(), assets: manifest().assets.map(a => ({ ...a, footprint: { width: 50, height: 50 } })) }]) {
    const result = coordinateSceneGeneration(spec, { manifest: available })
    assert.ok(result.diagnostics.some(d => d.code === 'asset-fallback'))
    assert.equal(result.document.props.some(p => p.type === 'asset'), false)
    if (!available.effects.length) assert.ok(result.diagnostics.some(d => d.code === 'effect-omitted'))
  }
  spec.budget = { scenery: 0, effects: 0, lights: 0, shadowLights: 0 }
  const result = coordinateSceneGeneration(spec, { manifest: manifest() })
  assert.deepEqual(result.document.props, generateLayout(spec.options).document.props)
  assert.equal(result.document.environmentalEffects, undefined)
  assert.equal(result.document.lighting, undefined)
  assert.ok(result.diagnostics.some(d => d.code === 'budget-reduced'))
})
test('real B/C dense budgets, multi-floor transitions and unresolved variants fail safely', () => {
  const spec = fixture(); spec.zones[0].dressing[0].density = 'dense'
  spec.budget.scenery = spec.options.roomCount + 1
  const result = coordinateSceneGeneration(spec, { manifest: manifest() })
  assert.equal(result.document.props.length, spec.budget.scenery)
  assert.ok(result.diagnostics.some(d => d.code === 'budget-reduced'))
  spec.floors.push({ id: 'upper', elevationFeet: 10 })
  const centre = (seed: string, floorId: string) => { const room = generateLayout({ ...spec.options, seed }).rooms[0]; return { floorId, x: room.x + Math.floor(room.width / 2), z: room.z + Math.floor(room.height / 2) } }
  spec.transitions.push({ id: 'stairs', type: 'stairs', directionality: 'two-way', movementCost: 'normal', source: centre(spec.options.seed, 'ground'), destination: centre(`${spec.options.seed}:floor:upper`, 'upper') })
  const multi = coordinateSceneGeneration(spec, { manifest: manifest() })
  assert.equal(dungeonLevels(multi.document).length, 2)
  assert.deepEqual(multi.document.transitions, spec.transitions)
  const invalid = structuredClone(spec); invalid.transitions[0].destination.x = 0; invalid.transitions[0].destination.z = 0
  assert.throws(() => coordinateSceneGeneration(invalid, { manifest: manifest() }), /Inaccessible/)
  const variant = { ...fixture(), source: { kind: 'variant' as const, templateId: '00000000-0000-4000-8000-000000000001', revision: 3 } }
  const sourceDocument = result.document, before = structuredClone(sourceDocument)
  assert.throws(() => coordinateSceneGeneration(variant, { manifest: manifest(), sourceDocument }), /approved room-analysis/)
  assert.deepEqual(sourceDocument, before)
})
test('combined canonical output uses existing editable history and import/export without granting players edits', () => {
  const document = coordinateSceneGeneration(fixture(), { manifest: manifest() }).document
  const dm = { id: 'dm', role: 'dm' as const }, initial = emptyEncounter()
  const loaded = applyMapEdit(initial, dm, { type: 'map.load', document }, emptyHistory())
  assert.equal(loaded.history.undo.length, 1)
  const effect = document.environmentalEffects!.effects[0]
  const edited = editMap({ document, width: document.width, height: document.height }, loaded.history, { type: 'map.effect.remove', id: effect.id })
  assert.equal(edited.frame.document?.environmentalEffects?.effects.length, 0)
  const undone = applyMapEdit(loaded.state, dm, { type: 'map.undo' }, loaded.history)
  assert.equal(undone.state.dungeonMap, undefined)
  const redone = applyMapEdit(undone.state, dm, { type: 'map.redo' }, undone.history)
  assert.deepEqual(redone.state.dungeonMap, document)
  assert.deepEqual(importEncounter(JSON.parse(JSON.stringify(redone.state))).dungeonMap, document)
  assert.throws(() => applyMapEdit(initial, { id: 'player', role: 'player' }, { type: 'map.load', document }, emptyHistory()), /DM|Dungeon|Only/)
})
