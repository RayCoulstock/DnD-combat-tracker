import { dungeonLevels, readDungeon, type DungeonMap } from './dungeon.ts'
import { generateLayout } from './generator.ts'
import { initialFog } from './fog.ts'
import { normalizeSceneManifest, sceneGenerationSpecSchema, type SceneGenerationContext, type SceneGenerationResult, type SceneGenerationSpec, type SceneGenerationStage } from './sceneGeneration.ts'

// Required dependencies: there is intentionally no identity-stage production default.
export interface SceneGenerationAdapters {
  assets: SceneGenerationStage
  environment: SceneGenerationStage
  // B owns room analysis and footprint/route validation; authorization is the caller's responsibility.
  validate: SceneGenerationStage
  resolveVariantRooms: (spec: SceneGenerationSpec, source: DungeonMap) => void
}

function layout(spec: SceneGenerationSpec): DungeonMap {
  let mapId = '', mapName = ''
  const levels = spec.floors.map((floor, index) => {
    const options = { ...spec.options, seed: index ? `${spec.options.seed}:floor:${floor.id}` : spec.options.seed }
    // Derivation can exceed the legacy seed limit; reject rather than truncate/collide.
    const { document, rooms } = generateLayout(options)
    if (!index) { mapId = document.id; mapName = document.name }
    if (spec.zones.some(zone => zone.floorId === floor.id && !rooms[zone.roomIndex])) throw new Error('Unresolved room zone.')
    const { schemaVersion, ...geometry } = document
    void schemaVersion
    return { ...geometry, id: floor.id, name: floor.id, elevationFeet: floor.elevationFeet, playerVisible: true }
  })
  const { elevationFeet, playerVisible, ...primary } = levels[0]
  return readDungeon({ ...primary, id: mapId, name: mapName, schemaVersion: 6,
    level: { id: levels[0].id, name: levels[0].name, elevationFeet, playerVisible },
    levels: levels.slice(1), transitions: spec.transitions, fogOfWar: initialFog() })
}

function variant(spec: SceneGenerationSpec, context: SceneGenerationContext, adapters: SceneGenerationAdapters): DungeonMap {
  if (!context.sourceDocument) throw new Error('A revision-checked variant source is required.')
  const source = readDungeon(context.sourceDocument), floors = dungeonLevels(source)
  if (floors.length !== spec.floors.length || floors.some((floor, index) => floor.id !== spec.floors[index].id || floor.elevationFeet !== spec.floors[index].elevationFeet || floor.width !== spec.options.width || floor.height !== spec.options.height)) throw new Error('Variant dimensions and floors must match the source.')
  if (JSON.stringify(source.transitions ?? []) !== JSON.stringify(spec.transitions)) throw new Error('Variant transitions must preserve the source.')
  adapters.resolveVariantRooms(structuredClone(spec), structuredClone(source))
  return readDungeon({ ...source, ...(spec.fog === 'concealed' ? { fogOfWar: initialFog() } : {}) })
}

function preserveVariant(source: DungeonMap, result: DungeonMap) {
  const floors = dungeonLevels(result)
  for (const before of dungeonLevels(source)) {
    const after = floors.find(floor => floor.id === before.id)
    if (!after || before.width !== after.width || before.height !== after.height || before.elevationFeet !== after.elevationFeet) throw new Error('Variant stage changed source geometry.')
    for (const key of ['floors', 'walls', 'doors'] as const) if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error('Variant stage changed source geometry.')
    for (const prop of before.props) if (JSON.stringify(prop) !== JSON.stringify(after.props.find(p => p.id === prop.id))) throw new Error('Variant stage changed a source object.')
  }
  if (floors.length !== dungeonLevels(source).length || JSON.stringify(source.transitions) !== JSON.stringify(result.transitions)) throw new Error('Variant stage changed source floors or transitions.')
  for (const key of ['environmentalEffects', 'lighting'] as const) {
    const before = key === 'lighting' ? source.lighting?.sources : source.environmentalEffects?.effects
    const after = key === 'lighting' ? result.lighting?.sources : result.environmentalEffects?.effects
    for (const item of before ?? []) if (JSON.stringify(item) !== JSON.stringify(after?.find(value => value.id === item.id))) throw new Error('Variant stage changed a source effect or light.')
  }
}

// Pure realization only. Never accepts proposal-supplied manifests or saves client JSON.
export function coordinateSceneGeneration(input: unknown, authorityContext: SceneGenerationContext, adapters: SceneGenerationAdapters): SceneGenerationResult {
  const spec = sceneGenerationSpecSchema.parse(input)
  const context: SceneGenerationContext = { manifest: normalizeSceneManifest(authorityContext.manifest), ...(authorityContext.sourceDocument ? { sourceDocument: readDungeon(authorityContext.sourceDocument) } : {}) }
  let document = spec.source.kind === 'seeded' ? layout(spec) : variant(spec, context, adapters)
  const baseline = structuredClone(document), diagnostics: SceneGenerationResult['diagnostics'] = []
  for (const stage of [adapters.assets, adapters.environment, adapters.validate]) {
    const result = stage(structuredClone(spec), structuredClone(context), structuredClone(document))
    document = readDungeon(result.document)
    if (result.diagnostics.length + diagnostics.length > 1000 || result.diagnostics.some(d => !['asset-fallback', 'effect-omitted', 'budget-reduced'].includes(d.code) || d.zoneId !== undefined && !spec.zones.some(z => z.id === d.zoneId))) throw new Error('Invalid stage diagnostics.')
    diagnostics.push(...result.diagnostics.map(d => ({ code: d.code, ...(d.zoneId ? { zoneId: d.zoneId } : {}) })))
    if (spec.source.kind === 'variant') preserveVariant(baseline, document)
    if (JSON.stringify(document.fogOfWar) !== JSON.stringify(baseline.fogOfWar)) throw new Error('Scene stages must preserve generation fog.')
  }
  return { document, diagnostics }
}
