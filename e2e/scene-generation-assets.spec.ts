import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { generateLayout } from '../shared/generator'
import { sceneGenerationSpecSchema, type SceneAssetManifest } from '../shared/sceneGeneration'
import { placeSceneAssets } from '../shared/sceneGenerationAssets'

test('asset stage agrees between browser and server for authorized and missing manifests', async ({ page }) => {
  const spec = sceneGenerationSpecSchema.parse(JSON.parse(readFileSync(new URL('../shared/fixtures/scene-generation-v1.json', import.meta.url), 'utf8')))
  const document = generateLayout(spec.options).document
  const populated: SceneAssetManifest = { version: 1, effects: [], assets: [{ id: '00000000-0000-4000-8000-000000000001', revision: 1, tags: ['storage'], footprint: { width: 1, height: 1 }, blocking: true }] }
  await page.goto('/')
  for (const manifest of [populated, { ...populated, assets: [] }]) {
    const expected = placeSceneAssets(spec, { manifest }, document)
    const actual = await page.evaluate(async ({ spec, manifest, document }) => {
      const path = '/shared/sceneGenerationAssets.ts'
      const { placeSceneAssets } = await import(/* @vite-ignore */ path)
      const before = JSON.stringify({ spec, manifest, document })
      const result = placeSceneAssets(spec, { manifest }, document)
      return { result, unchanged: before === JSON.stringify({ spec, manifest, document }) }
    }, { spec, manifest, document })
    expect(actual.unchanged).toBe(true)
    expect(actual.result).toEqual(expected)
  }
})
