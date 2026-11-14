import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { generateSceneEnvironment } from './sceneGenerationEnvironment.ts'
import { sceneGenerationSpecSchema, type SceneGenerationSpec } from './sceneGeneration.ts'
import { generateDungeon } from './generator.ts'
import { createEffect } from './environmentalEffects.ts'
import { effectVisible } from './effectLighting.ts'
import { fullMask } from './fog.ts'
import { readDungeon, editMap, emptyHistory, dungeonLevels, composeLevels } from './dungeon.ts'
const fixture = () => sceneGenerationSpecSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/scene-generation-v1.json', import.meta.url), 'utf8')))
const setup = () => {
  const spec = fixture()
  const document = generateDungeon(spec.options)
  const context = { manifest: { version: 1 as const, assets: [], effects: ['magical-motes', 'campfire', 'arcane-portal'] as const as ('magical-motes'|'campfire'|'arcane-portal')[] } }
  return { spec, document, context }
}
test('fixture produces deterministic canonical, editable effects without mutating inputs', () => {
  const { spec, document, context } = setup()
  const before = structuredClone({ spec, document, context })
  const a = generateSceneEnvironment(spec, context, document)
  assert.deepEqual(a, generateSceneEnvironment(JSON.parse(JSON.stringify(spec)), structuredClone(context), structuredClone(document)))
  assert.deepEqual({ spec, document, context }, before)
  assert.equal(a.document.environmentalEffects?.effects.length, 1)
  const effect = a.document.environmentalEffects!.effects[0]
  assert.equal(effect.playback, undefined)
  assert.equal(effect.attachment, undefined)
  assert.equal(effectVisible(a.document, effect), false)
  const edited = editMap({ document: a.document, width: a.document.width, height: a.document.height }, emptyHistory(), { type: 'map.effect.remove', id: effect.id })
  assert.equal(edited.frame.document?.environmentalEffects?.effects.length, 0)
  assert.deepEqual(readDungeon(a.document), a.document)
})
test('available presets retain defaults, exclusive linked emitters and no point shadows', () => {
  const { spec, document, context } = setup()
  spec.zones[0].effects = ['campfire', 'arcane-portal']
  const result = generateSceneEnvironment(spec, context, document).document
  assert.equal(result.lighting?.sources?.length, 2)
  for (const e of result.environmentalEffects!.effects) {
    const source = result.lighting!.sources!.find(s => s.id === e.light?.emitterId)!
    assert.deepEqual(source.position, e.position)
    assert.equal(source.castShadow, false)
    assert.equal(effectVisible(result, e), false)
  }
  assert.equal(result.transitions, undefined)
})
test('missing presets, zero budgets and stable earlier placements degrade deterministically', () => {
  const { spec, document, context } = setup()
  spec.zones[0].effects = ['campfire', 'magical-motes', 'arcane-portal']
  spec.budget.effects = 1
  spec.budget.lights = 0
  const result = generateSceneEnvironment(spec, context, document)
  assert.equal(result.document.environmentalEffects?.effects.length, 1)
  assert.equal(result.document.environmentalEffects?.effects[0].light, undefined)
  assert.equal(result.diagnostics.length, 3)
  context.manifest.effects = []
  assert.equal(generateSceneEnvironment(spec, context, document).diagnostics[0].code, 'effect-omitted')
  spec.budget.effects = 0
  assert.equal(generateSceneEnvironment(spec, setup().context, document).document.environmentalEffects, undefined)
})
test('existing over-budget content and lifecycle fields survive unchanged', () => {
  const { spec, document, context } = setup()
  const effect = createEffect('existing', 'magical-motes', 'ground', { x: 2, z: 2, heightFeet: 0 })
  effect.playback = { mode: 'manual', durationMs: 3000, transition: { kind: 'fade', durationMs: 500 }, state: 'paused', revision: 3, elapsedMs: 450 }
  document.environmentalEffects = { version: 1, effects: [effect] }
  spec.budget.effects = 0
  assert.deepEqual(generateSceneEnvironment(spec, context, document).document.environmentalEffects, document.environmentalEffects)
})
test('variant fog preserves source only for identical geometry and rejects unresolved zones', () => {
  const { spec, document, context } = setup()
  spec.source = { kind: 'variant', templateId: '00000000-0000-4000-8000-000000000001', revision: 1 }
  spec.fog = 'preserve'
  spec.zones = []
  document.fogOfWar = { version: 1, enabled: true, appearance: { colour: '#000000', edgeSoftness: 0 }, revision: 7, floors: { ground: fullMask(document.width, document.height) } }
  const variantContext = { ...context, sourceDocument: structuredClone(document) }
  assert.deepEqual(generateSceneEnvironment(spec, variantContext, document).document.fogOfWar, document.fogOfWar)
  assert.throws(() => generateSceneEnvironment(spec, context, document), /authoritative variant source/)
  document.floors.pop()
  assert.throws(() => generateSceneEnvironment(spec, variantContext, document), /changed floor geometry/)
  spec.fog = 'concealed'
  spec.zones = fixture().zones
  assert.throws(() => generateSceneEnvironment(spec, variantContext, document), /room analysis/)
})
test('collisions and mismatched floors fail closed; environment override remains canonical', () => {
  const { spec, document, context } = setup()
  spec.environment = { ambientColor: '#ffffff', ambientIntensity: 1, directionalColor: '#ffffff', directionalIntensity: 1, directionalPosition: [8,14,6], shadows: true, shadowQuality: 'low', exposure: 1 }
  assert.deepEqual(generateSceneEnvironment(spec, context, document).document.lighting?.environment, spec.environment)
  document.environmentalEffects = { version: 1, effects: [createEffect('scene:environment:0:0:0', 'magical-motes', 'ground', { x: 2, z: 2, heightFeet: 0 })] }
  assert.throws(() => generateSceneEnvironment(spec, context, document), /already in use/)
  const invalid: SceneGenerationSpec = { ...spec, floors: [{ id: 'other', elevationFeet: 0 }] }
  invalid.zones = []
  assert.throws(() => generateSceneEnvironment(invalid, context, document), /floors must match/)
})

test('multi-floor placements follow each floor seed and budgets remain map-wide', () => {
  const { spec, document, context } = setup()
  spec.floors.push({ id: 'upper', elevationFeet: 10 })
  spec.transitions.push({ id: 'stairs', source: { floorId: 'ground', x: 2, z: 2 }, destination: { floorId: 'upper', x: 2, z: 2 }, directionality: 'two-way', movementCost: 'normal', type: 'stairs' })
  spec.zones.push({ ...structuredClone(spec.zones[0]), id: 'upper-zone', floorId: 'upper' })
  const upper = dungeonLevels(generateDungeon({ ...spec.options, seed: `${spec.options.seed}:floor:upper` }))[0]
  const map = composeLevels(document, [...dungeonLevels(document), { ...upper, id: 'upper', elevationFeet: 10 }])
  const result = generateSceneEnvironment(spec, context, map).document
  assert.deepEqual(result.environmentalEffects?.effects.map(e => e.floorId), ['ground', 'upper'])
  for (const effect of result.environmentalEffects!.effects) {
    assert.ok(dungeonLevels(result).find(l => l.id === effect.floorId)!.floors.some(c => c.x === effect.position.x && c.z === effect.position.z))
  }
  spec.budget.effects = 1
  assert.deepEqual(generateSceneEnvironment(spec, context, map).diagnostics, [{ code: 'budget-reduced', zoneId: 'upper-zone' }])
})

test('generated linked glow is excluded by authoritative player projection under concealed fog', async () => {
  const { importEncounter, projectEncounter } = await import('./domain.ts')
  const { spec, document, context } = setup()
  spec.zones[0].effects = ['campfire']
  const map = generateSceneEnvironment(spec, context, document).document
  const state = importEncounter({ version: 1, round: 4, combatants: [], dungeonMap: map })
  const player = projectEncounter(state, { id: 'player', role: 'player' })
  assert.equal(player.dungeonMap!.environmentalEffects!.effects.length, 0)
  assert.equal(player.dungeonMap!.lighting!.sources!.length, 0)
  assert.equal(projectEncounter(state, { id: 'dm', role: 'dm' }).dungeonMap!.environmentalEffects!.effects.length, 1)
  const revealed = structuredClone(map)
  revealed.fogOfWar!.enabled = false
  const publicState = projectEncounter(importEncounter({ version: 1, round: 4, combatants: [], dungeonMap: revealed }), { id: 'player', role: 'player' })
  assert.equal(publicState.dungeonMap!.environmentalEffects!.effects.length, 1)
  assert.equal(publicState.dungeonMap!.lighting!.sources!.length, 1)
})
