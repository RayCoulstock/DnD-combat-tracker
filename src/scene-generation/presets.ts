import { sceneGenerationSpecSchema, type SceneGenerationSpec } from '../../shared/sceneGeneration'
import { generationOptionsSchema, type GenerationOptions } from '../../shared/generator'

export const generationPresets = [
  { id: 'dungeon', name: 'Stone dungeon', options: { width: 24, height: 24, roomCount: 6, minRoomSize: 3, maxRoomSize: 7, theme: 'stone-dungeon' } },
  { id: 'cavern', name: 'Cavern expedition', options: { width: 30, height: 26, roomCount: 5, minRoomSize: 4, maxRoomSize: 8, theme: 'cavern' } },
  { id: 'outpost', name: 'Mining outpost', options: { width: 28, height: 24, roomCount: 6, minRoomSize: 3, maxRoomSize: 6, theme: 'mining-outpost' } },
] as const
export function presetOptions(id: string, seed: string): GenerationOptions {
  const preset = generationPresets.find(p => p.id === id)
  if (!preset) throw new Error('Choose a generation preset.')
  return generationOptionsSchema.parse({ ...preset.options, seed })
}
export function seededProposal(options: GenerationOptions): SceneGenerationSpec {
  return sceneGenerationSpecSchema.parse({ version: 1, mode: 'scene-v1', options, source: { kind: 'seeded' }, floors: [{ id: 'ground', elevationFeet: 0 }], zones: [], transitions: [], budget: { scenery: 20, effects: 8, lights: 4, shadowLights: 0 }, fog: 'concealed' })
}
