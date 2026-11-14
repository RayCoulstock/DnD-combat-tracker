import { coordinateSceneGeneration } from '../../shared/sceneGenerationCoordinator'
import { sceneManifestFromAssets } from '../../shared/sceneGenerationAssets'
import { effectPresetIds } from '../../shared/environmentalEffects'
import type { SceneProposalAuthority } from './workflow'

// No GLB is eligible until the authority supplies verified footprint records.
// Built-in presets are available offline; this adapter has no persistence capability.
export const offlineScenePreview: SceneProposalAuthority = {
  preview: async spec => coordinateSceneGeneration(spec, {
    manifest: { ...sceneManifestFromAssets([], []), effects: [...effectPresetIds] },
  }),
}
