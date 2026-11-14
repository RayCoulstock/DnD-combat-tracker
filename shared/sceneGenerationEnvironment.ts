import { dungeonLevels, readDungeon } from './dungeon.ts'
import { createEffect, effectPreset } from './environmentalEffects.ts'
import { effectEmitterId } from './effectLighting.ts'
import { initialFog } from './fog.ts'
import { generateLayout } from './generator.ts'
import { legacyEnvironment, pointLightSchema } from './lighting.ts'
import { normalizeSceneManifest, sceneGenerationSpecSchema, type SceneGenerationStage, type SceneGenerationResult } from './sceneGeneration.ts'

/** Pure 6.4C stage. Authorization, source revision and manifest freshness belong to the coordinator. */
export const generateSceneEnvironment: SceneGenerationStage = (input, context, document) => {
  const spec = sceneGenerationSpecSchema.parse(input)
  const manifest = normalizeSceneManifest(context.manifest)
  const next = structuredClone(readDungeon(document))
  const levels = dungeonLevels(next)
  if (levels.length !== spec.floors.length || spec.floors.some((floor, i) => {
    const level = levels[i]
    return level.id !== floor.id || level.elevationFeet !== floor.elevationFeet || level.width !== spec.options.width || level.height !== spec.options.height
  })) throw new Error('Scene floors must match the environment stage input.')

  if (spec.fog === 'preserve') {
    if (!context.sourceDocument) throw new Error('Preserving fog requires the authoritative variant source.')
    const sourceLevels = dungeonLevels(readDungeon(context.sourceDocument))
    // Compare canonical geometry, including doors and walls, before carrying source masks.
    const geometry = (list: typeof levels) => list.map(l => ({ id: l.id, width: l.width, height: l.height, elevationFeet: l.elevationFeet, floors: l.floors, walls: l.walls, doors: l.doors }))
    if (JSON.stringify(geometry(sourceLevels)) !== JSON.stringify(geometry(levels))) throw new Error('Cannot preserve fog on changed floor geometry.')
    if (context.sourceDocument.fogOfWar) next.fogOfWar = structuredClone(context.sourceDocument.fogOfWar)
    else delete next.fogOfWar
  } else next.fogOfWar = initialFog()
  if (spec.environment) next.lighting = { ...next.lighting, environment: structuredClone(spec.environment) }

  const diagnostics: SceneGenerationResult['diagnostics'] = []
  const effects = next.environmentalEffects?.effects ?? []
  const sources = next.lighting?.sources ?? []
  const ids = new Set([...effects.map(e => e.id), ...sources.map(s => s.id)])
  const diagnostic = (code: SceneGenerationResult['diagnostics'][number]['code'], zoneId: string) => diagnostics.push({ code, zoneId })
  for (const floor of spec.floors) {
    const zones = spec.zones.filter(z => z.floorId === floor.id)
    if (!zones.some(z => z.effects.length)) continue
    if (spec.source.kind === 'variant') throw new Error('Variant effect zones require a reviewed deterministic room analysis adapter.')
    const options = { ...spec.options, seed: floor.id === spec.floors[0].id ? spec.options.seed : `${spec.options.seed}:floor:${floor.id}` }
    const { rooms } = generateLayout(options)
    const level = levels.find(l => l.id === floor.id)!
    for (const zone of zones) {
      const room = rooms[zone.roomIndex]
      if (!room) throw new Error('Unresolved environment zone room.')
      const candidates = level.floors.filter(c => c.x >= room.x && c.x < room.x + room.width && c.z >= room.z && c.z < room.z + room.height).sort((a, b) => a.z - b.z || a.x - b.x)
      for (const [ordinal, presetId] of zone.effects.entries()) {
        if (!manifest.effects.includes(presetId) || !candidates.length) { diagnostic('effect-omitted', zone.id); continue }
        if (effects.length >= spec.budget.effects) { diagnostic('budget-reduced', zone.id); continue }
        // Spec indices keep IDs bounded even for maximum-length floor and zone IDs.
        const id = `scene:environment:${spec.floors.indexOf(floor)}:${spec.zones.indexOf(zone)}:${ordinal}`
        const emitterId = effectEmitterId(id)
        if (ids.has(id) || ids.has(emitterId)) throw new Error('Generated environment ID is already in use.')
        const cell = candidates[ordinal % candidates.length]
        const effect = createEffect(id, presetId, floor.id, { x: cell.x, z: cell.z, heightFeet: 0 })
        if (effectPreset(presetId).lighting) {
          if (sources.length < spec.budget.lights) {
            sources.push(pointLightSchema.parse({ id: emitterId, name: effectPreset(presetId).name, floorId: floor.id, position: { ...effect.position }, color: effect.color, castShadow: false }))
            effect.light = { emitterId }
            ids.add(emitterId)
          } else diagnostic('budget-reduced', zone.id)
        }
        effects.push(effect)
        ids.add(id)
      }
    }
  }
  if (effects.length) next.environmentalEffects = { version: 1, effects }
  if (sources.length) next.lighting = { ...(next.lighting ?? { environment: structuredClone(legacyEnvironment) }), sources }
  return { document: readDungeon(next), diagnostics }
}
