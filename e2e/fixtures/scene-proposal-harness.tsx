import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import SceneProposalPanel from '../../src/scene-generation/SceneProposalPanel'
import { presetOptions } from '../../src/scene-generation/presets'
import { coordinateSceneGeneration, type SceneGenerationAdapters } from '../../shared/sceneGenerationCoordinator'
import type { SceneGenerationStage } from '../../shared/sceneGeneration'
import type { SceneProposalAuthority } from '../../src/scene-generation/workflow'
import { generateDungeon } from '../../shared/generator'
const identity: SceneGenerationStage = (_s, _c, document) => ({ document, diagnostics: [] })
const mocks: SceneGenerationAdapters = { assets: identity, environment: identity, validate: identity, resolveVariantRooms: () => {} }
const options = presetOptions('dungeon', 'browser-typed-mock'), sourceDocument = generateDungeon(options)
function Harness() {
  const [commits, setCommits] = useState(0), [name, setName] = useState(''), [preview, setPreview] = useState(false)
  const authority = useMemo<SceneProposalAuthority>(() => ({
    preview: async spec => coordinateSceneGeneration(spec, { manifest: { version: 1, assets: [], effects: [] }, ...(spec.source.kind === 'variant' ? { sourceDocument } : {}) }, mocks),
    accept: async (_spec, _result, variantName) => { setCommits(n => n + 1); setName(variantName ?? '') },
  }), [])
  return <div><SceneProposalPanel options={options} authority={authority} onPreview={result => setPreview(Boolean(result))} source={{ id: '00000000-0000-4000-8000-000000000001', revision: 4, name: 'Original', load: async () => structuredClone(sourceDocument) }} />
    <output data-testid="workflow-state">{JSON.stringify({ commits, name, preview, original: sourceDocument.name })}</output></div>
}
export function mount() {
  const host = document.createElement('section')
  host.id = 'scene-harness'; host.style.cssText = 'position:fixed;inset:0;overflow:auto;background:white;color:black;z-index:99999;padding:20px'
  document.body.append(host); createRoot(host).render(<Harness />)
}
