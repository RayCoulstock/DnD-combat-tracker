import { z } from 'zod'
import { generationOptionsSchema } from './generator.ts'
import { effectIdSchema, effectPresetIds } from './environmentalEffects.ts'
import { floorTypes, propTypes, type DungeonMap } from './dungeon.ts'
import { transitionSchema } from './transitions.ts'
import { environmentSchema } from './lighting.ts'

// Planning contracts only. These are not a second map format or a GameCommand.
const count = (max: number) => z.number().int().min(0).max(max)
export const sceneGenerationBudgetSchema = z.object({
  scenery: count(100), effects: count(64), lights: count(32),
  // Includes linked effect lights; renderer quality may show fewer lights.
  shadowLights: count(2),
}).strict().refine(b => b.shadowLights <= b.lights, 'Shadow lights exceed light budget.')
export const sceneAssetManifestSchema = z.object({
  version: z.literal(1),
  assets: z.array(z.object({
    id: z.uuid(), revision: z.number().int().positive(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    footprint: z.object({ width: z.number().int().min(1).max(50), height: z.number().int().min(1).max(50) }).strict(),
    blocking: z.boolean(),
  }).strict()).max(1000),
  effects: z.array(z.enum(effectPresetIds)).max(effectPresetIds.length),
}).strict().superRefine((m, ctx) => {
  if (new Set(m.assets.map(a => a.id)).size !== m.assets.length || new Set(m.effects).size !== m.effects.length)
    ctx.addIssue({ code: 'custom', message: 'Manifest entries must be unique.' })
})
export type SceneAssetManifest = z.infer<typeof sceneAssetManifestSchema>
const zoneSchema = z.object({
  id: effectIdSchema, floorId: effectIdSchema, roomIndex: count(24),
  purpose: z.enum(['entry', 'passage', 'habitation', 'storage', 'workshop', 'ritual', 'hazard']),
  material: z.enum(floorTypes),
  dressing: z.array(z.object({
    tag: z.string().trim().min(1).max(40), fallback: z.enum(propTypes),
    density: z.enum(['sparse', 'balanced', 'dense']),
  }).strict()).max(8),
  effects: z.array(z.enum(effectPresetIds)).max(8),
}).strict()
export const sceneGenerationSpecSchema = z.object({
  version: z.literal(1), mode: z.literal('scene-v1'),
  options: generationOptionsSchema,
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('seeded') }).strict(),
    z.object({ kind: z.literal('variant'), templateId: z.uuid(), revision: z.number().int().positive() }).strict(),
  ]),
  floors: z.array(z.object({ id: effectIdSchema, elevationFeet: z.number().finite().min(-1000).max(1000) }).strict()).min(1).max(12),
  zones: z.array(zoneSchema).max(300),
  transitions: z.array(transitionSchema.omit({ assetId: true, dmNotes: true })).max(200),
  budget: sceneGenerationBudgetSchema,
  environment: environmentSchema.optional(),
  fog: z.enum(['concealed', 'preserve']),
}).strict().superRefine((s, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message })
  const floors = new Set(s.floors.map(f => f.id))
  if (floors.size !== s.floors.length) invalid('Floor IDs must be unique.')
  if (s.floors.some((f, i) => s.floors.slice(0, i).some(g => Math.abs(f.elevationFeet - g.elevationFeet) < .1))) invalid('Floors must be at least 0.1 feet apart.')
  if (new Set(s.zones.map(zone => zone.id)).size !== s.zones.length) invalid('Zone IDs must be unique.')
  const rooms = new Set<string>()
  for (const zone of s.zones) {
    const key = `${zone.floorId}:${zone.roomIndex}`
    if (!floors.has(zone.floorId) || zone.roomIndex >= s.options.roomCount || rooms.has(key)) invalid('Zones require distinct rooms on existing floors.')
    rooms.add(key)
  }
  if (s.source.kind === 'seeded' && s.fog === 'preserve') invalid('Only variants can preserve fog.')
  if (new Set(s.transitions.map(t => t.id)).size !== s.transitions.length) invalid('Transition IDs must be unique.')
  for (const t of s.transitions) {
    if (t.source.floorId === t.destination.floorId) invalid('Transitions must connect different floors.')
    for (const p of [t.source, t.destination]) if (!floors.has(p.floorId) || p.x >= s.options.width || p.z >= s.options.height) invalid('Transition endpoint is outside its floor.')
  }
  // Every floor must be reachable from the primary floor, respecting directionality.
  const reachable = new Set(s.floors.slice(0, 1).map(f => f.id))
  for (let i = 0; i < s.floors.length; i++) for (const t of s.transitions) {
    if (reachable.has(t.source.floorId)) reachable.add(t.destination.floorId)
    if (t.directionality === 'two-way' && reachable.has(t.destination.floorId)) reachable.add(t.source.floorId)
  }
  if (s.floors.some(f => !reachable.has(f.id))) invalid('Every floor requires a route from the primary floor.')
})
export type SceneGenerationSpec = z.infer<typeof sceneGenerationSpecSchema>
export const sceneGenerationStages = ['layout', 'zones', 'placement', 'validation', 'canonical'] as const

// Server builds this from owner-authorized ready/valid assets, never from a proposal.
// Sort a copy using code-point order; do not depend on locale, DB order, or tag order.
export function normalizeSceneManifest(input: unknown): SceneAssetManifest {
  const manifest = sceneAssetManifestSchema.parse(input)
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
  return { ...manifest, assets: manifest.assets.map(a => ({ ...a, tags: [...new Set(a.tags)].sort(compare) })).sort((a, b) => compare(a.id, b.id)), effects: [...manifest.effects].sort(compare) }
}
export function selectSceneAsset(manifestInput: unknown, tag: string) {
  return normalizeSceneManifest(manifestInput).assets.find(asset => asset.tags.includes(tag))
}
export interface SceneGenerationContext {
  manifest: SceneAssetManifest
  // Variant source is loaded and revision-checked by the authority, never supplied by AI.
  sourceDocument?: DungeonMap
}
export interface SceneGenerationResult {
  document: DungeonMap
  diagnostics: { code: 'asset-fallback' | 'effect-omitted' | 'budget-reduced'; zoneId?: string }[]
}
// B/C implement pure deterministic stages against this seam after contract approval.
// No executor is registered by 6.4A; legacy generateDungeon remains authoritative.
export type SceneGenerationStage = (spec: SceneGenerationSpec, context: SceneGenerationContext, document: DungeonMap) => SceneGenerationResult
