import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneProposalWorkflow, type SceneProposalAuthority } from '../src/scene-generation/workflow.ts'
import { generationPresets, presetOptions, seededProposal } from '../src/scene-generation/presets.ts'
import { generateDungeon } from './generator.ts'
import type { SceneGenerationResult } from './sceneGeneration.ts'
const spec = () => seededProposal(presetOptions('dungeon', 'test'))
const result = (): SceneGenerationResult => ({ document: generateDungeon(spec().options), diagnostics: [] })
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
test('all editable presets fit, keep the seed and use the unchanged generator', () => {
  for (const p of generationPresets) { const options = presetOptions(p.id, 'repeat'); assert.equal(options.seed, 'repeat'); assert.deepEqual(generateDungeon(options), generateDungeon(options)); assert.equal(seededProposal(options).options.theme, options.theme) }
})
test('cancel and out-of-order previews cannot publish stale results or accept', async () => {
  const first = deferred<SceneGenerationResult>(), second = deferred<SceneGenerationResult>(); let calls = 0, saves = 0
  const workflow = new SceneProposalWorkflow({ preview: () => ++calls === 1 ? first.promise : second.promise, accept: async () => { saves++ } })
  const a = workflow.generate(spec()), b = workflow.generate(spec())
  second.resolve(result()); assert.ok(await b); first.resolve(result()); assert.equal(await a, null)
  workflow.cancel(); await assert.rejects(workflow.accept()); assert.equal(saves, 0)
  const third = deferred<SceneGenerationResult>(), cancelled = new SceneProposalWorkflow({ preview: () => third.promise, accept: async () => {} })
  const pending = cancelled.generate(spec()); cancelled.cancel(); third.resolve(result()); assert.equal(await pending, null)
})
test('accept uses the reviewed snapshot, preserves preview on conflict, and prevents duplicate accepts', async () => {
  const input = spec(), committed = deferred<void>(); let saves = 0
  const authority: SceneProposalAuthority = { preview: async () => result(), accept: async s => { assert.equal(s.options.seed, 'test'); saves++; await committed.promise } }
  const workflow = new SceneProposalWorkflow(authority)
  await workflow.generate(input); input.options.seed = 'edited'; workflow.preview!.spec.options.seed = 'external mutation'
  const accept = workflow.accept(); await assert.rejects(workflow.accept()); await assert.rejects(workflow.generate(spec())); committed.resolve(); await accept
  assert.equal(saves, 1); assert.equal(workflow.preview, null)
  const failing = new SceneProposalWorkflow({ preview: authority.preview, accept: async () => { throw new Error('Stale source/manifest/encounter') } })
  await failing.generate(spec()); await assert.rejects(failing.accept(), /Stale/); assert.ok(failing.preview)
})
test('variant acceptance requires a new name and keeps the revisioned source', async () => {
  const input = spec(); input.source = { kind: 'variant', templateId: '00000000-0000-4000-8000-000000000001', revision: 7 }; input.fog = 'preserve'
  let saved = false
  const workflow = new SceneProposalWorkflow({ preview: async () => result(), accept: async (s, _r, name) => { assert.deepEqual(s.source, input.source); assert.equal(name, 'New variant'); saved = true } })
  await workflow.generate(input); await assert.rejects(workflow.accept(' ')); assert.equal(saved, false)
  await workflow.accept(' New variant '); assert.equal(saved, true)
})
test('invalid proposals fail before authority invocation and discard old preview', async () => {
  let calls = 0
  const workflow = new SceneProposalWorkflow({ preview: async () => { calls++; return result() }, accept: async () => {} })
  await workflow.generate(spec()); await assert.rejects(workflow.generate({ ...spec(), code: 'execute' })); assert.equal(calls, 1); assert.equal(workflow.preview, null)
})
