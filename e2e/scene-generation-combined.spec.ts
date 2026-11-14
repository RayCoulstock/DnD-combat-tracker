import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { coordinateSceneGeneration } from '../shared/sceneGenerationCoordinator'
import { sceneGenerationSpecSchema, type SceneAssetManifest } from '../shared/sceneGeneration'
import { generateLayout } from '../shared/generator'

test('real assets, environment and final spatial validation agree in browser and Node', async ({ page }) => {
  const spec = sceneGenerationSpecSchema.parse(JSON.parse(readFileSync(new URL('../shared/fixtures/scene-generation-v1.json', import.meta.url), 'utf8')))
  spec.zones[0].effects = ['campfire', 'magical-motes']
  const manifest: SceneAssetManifest = { version: 1, assets: [{ id: '00000000-0000-4000-8000-000000000001', revision: 1, tags: ['storage'], footprint: { width: 1, height: 1 }, blocking: true }], effects: ['campfire', 'magical-motes'] }
  const multi = structuredClone(spec); multi.floors.push({ id: 'upper', elevationFeet: 10 })
  const centre = (seed: string, floorId: string) => { const room = generateLayout({ ...spec.options, seed }).rooms[0]; return { floorId, x: room.x + Math.floor(room.width / 2), z: room.z + Math.floor(room.height / 2) } }
  multi.transitions.push({ id: 'stairs', type: 'stairs', directionality: 'two-way', movementCost: 'normal', source: centre(spec.options.seed, 'ground'), destination: centre(`${spec.options.seed}:floor:upper`, 'upper') })
  const cases = [
    { spec, context: { manifest } },
    { spec, context: { manifest: { ...manifest, assets: [], effects: [] } } },
    { spec: { ...spec, budget: { scenery: 0, effects: 0, lights: 0, shadowLights: 0 } }, context: { manifest } },
    { spec: multi, context: { manifest } },
  ]
  await page.goto('/')
  for (const input of cases) {
    const expected = coordinateSceneGeneration(input.spec, input.context)
    const actual = await page.evaluate(async input => {
      const path = '/shared/sceneGenerationCoordinator.ts'
      const { coordinateSceneGeneration } = await import(/* @vite-ignore */ path)
      const before = JSON.stringify(input)
      const result = coordinateSceneGeneration(input.spec, input.context)
      return { result, unchanged: before === JSON.stringify(input) }
    }, input)
    expect(actual).toEqual({ result: expected, unchanged: true })
  }
  const invalid = structuredClone(multi); invalid.transitions[0].destination.x = 0; invalid.transitions[0].destination.z = 0
  expect(() => coordinateSceneGeneration(invalid, { manifest })).toThrow(/Inaccessible/)
  const error = await page.evaluate(async ({ spec, manifest }) => {
    const path = '/shared/sceneGenerationCoordinator.ts'
    const { coordinateSceneGeneration } = await import(/* @vite-ignore */ path)
    try { coordinateSceneGeneration(spec, { manifest }); return '' } catch (error) { return (error as Error).message }
  }, { spec: invalid, manifest })
  expect(error).toMatch(/Inaccessible/)
})
