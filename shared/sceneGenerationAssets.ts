import { z } from 'zod'
import { assetMetadataSchema, type Asset3D } from './assets.ts'
import { dungeonLevels, primaryLevelId, readDungeon, wallKey, type Cell, type DungeonLevel } from './dungeon.ts'
import { generateLayout, type Room } from './generator.ts'
import { normalizeSceneManifest, sceneGenerationSpecSchema, type SceneAssetManifest, type SceneGenerationStage } from './sceneGeneration.ts'

// Authority-owned verification records, NOT asset tags or user-editable presentation.
// Dimensions bound the normalized renderer model at scale 1, centred on its anchor.
const verifiedFootprintSchema = z.object({
  id: z.uuid(), revision: z.number().int().positive(),
  footprint: z.object({ width: z.number().int().min(1).max(50), height: z.number().int().min(1).max(50) }).strict(),
  blocking: z.boolean(),
}).strict()
export type VerifiedSceneFootprint = z.infer<typeof verifiedFootprintSchema>

// Caller must supply an owner-authorized library snapshot. This pure adapter does
// not perform authorization, DB writes, fetches, or accept proposal-supplied assets.
export function sceneManifestFromAssets(assets: readonly Asset3D[], verified: readonly VerifiedSceneFootprint[]): SceneAssetManifest {
  const records = z.array(verifiedFootprintSchema).max(1000).parse(verified)
  if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('Duplicate verified footprint.')
  const entries: SceneAssetManifest['assets'] = []
  for (const asset of assets) {
    const record = records.find(r => r.id === asset.id && r.revision === asset.revision)
    if (!record || asset.uploadStatus !== 'ready' || asset.validationStatus !== 'valid') continue
    const metadata = assetMetadataSchema.parse({ name: asset.name, description: asset.description, category: asset.category, tags: asset.tags, source: asset.source, presentation: asset.presentation })
    entries.push({ ...record, tags: metadata.tags })
  }
  return normalizeSceneManifest({ version: 1, assets: entries, effects: [] })
}

const key = (p: Cell) => `${p.x}:${p.z}`
const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const
const centre = (r: Room): Cell => ({ x: r.x + Math.floor(r.width / 2), z: r.z + Math.floor(r.height / 2) })

// Covers every touched cell, including arbitrary editor rotations/scales. Even
// dimensions at integer anchors deliberately reserve an extra boundary cell.
export function sceneFootprintCells(position: Cell, footprint: { width: number; height: number }, rotation = 0, scale = 1): Cell[] {
  if (![position.x, position.z, footprint.width, footprint.height, rotation, scale].every(Number.isFinite) || footprint.width <= 0 || footprint.height <= 0 || scale <= 0) throw new Error('Invalid footprint transform.')
  const angle = rotation * Math.PI / 180
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle))
  const width = (footprint.width * cos + footprint.height * sin) * scale
  const height = (footprint.width * sin + footprint.height * cos) * scale
  const x0 = Math.floor(position.x + .5 - width / 2 + 1e-9), x1 = Math.ceil(position.x + .5 + width / 2 - 1e-9)
  const z0 = Math.floor(position.z + .5 - height / 2 + 1e-9), z1 = Math.ceil(position.z + .5 + height / 2 - 1e-9)
  if ((x1 - x0) * (z1 - z0) > 10000) throw new Error('Footprint exceeds scene bounds.')
  const cells: Cell[] = []
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) cells.push({ x, z })
  return cells
}

function topology(level: DungeonLevel) {
  const floor = new Set(level.floors.map(key))
  const walls = new Set(level.walls.map(w => w.id))
  const doors = new Map(level.doors.map(d => [d.wallId, d.state]))
  const edge = (a: Cell, b: Cell) => a.x === b.x ? wallKey('H', a.x, Math.max(a.z, b.z)) : wallKey('V', Math.max(a.x, b.x), a.z)
  const canCross = (a: Cell, b: Cell) => {
    const id = edge(a, b)
    return !walls.has(id) || (doors.has(id) && doors.get(id) !== 'locked')
  }
  const search = (start: Cell, blocked: Set<string>) => {
    const parents = new Map<string, string | null>()
    if (!floor.has(key(start)) || blocked.has(key(start))) return parents
    const queue = [start]; parents.set(key(start), null)
    for (let i = 0; i < queue.length; i++) for (const [dx, dz] of directions) {
      const next = { x: queue[i].x + dx, z: queue[i].z + dz }, id = key(next)
      if (floor.has(id) && !blocked.has(id) && !parents.has(id) && canCross(queue[i], next)) { parents.set(id, key(queue[i])); queue.push(next) }
    }
    return parents
  }
  const fits = (cells: Cell[]) => {
    const covered = new Set(cells.map(key))
    return cells.every(p => p.x >= 0 && p.z >= 0 && p.x < level.width && p.z < level.height && floor.has(key(p)) && directions.every(([dx, dz]) => {
      const next = { x: p.x + dx, z: p.z + dz }
      // Even open door edges cannot be spanned by a physical object.
      return !covered.has(key(next)) || !walls.has(edge(p, next))
    }))
  }
  const approaches: Cell[] = []
  for (const door of level.doors) {
    const wall = level.walls.find(w => w.id === door.wallId)!
    approaches.push({ x: wall.x, z: wall.z }, wall.axis === 'H' ? { x: wall.x, z: wall.z - 1 } : { x: wall.x - 1, z: wall.z })
  }
  return { search, fits, approaches }
}

// Useful to coordinators that validate canonical endpoints before invoking stages.
export function validateSceneRoutes(level: DungeonLevel, essential: readonly Cell[], blocked: Set<string> = new Set()) {
  if (!essential.length) throw new Error('Scene requires an entry cell.')
  const reached = topology(level).search(essential[0], blocked)
  if (essential.some(p => !reached.has(key(p)))) throw new Error(`Inaccessible essential route on floor ${level.id}.`)
}

export const placeSceneAssets: SceneGenerationStage = (input, context, original) => {
  const spec = sceneGenerationSpecSchema.parse(input), manifest = normalizeSceneManifest(context.manifest)
  // The approved context carries no resolved variant room analysis. Never guess
  // room indices from an arbitrary edited source or regenerate its geometry.
  if (spec.source.kind === 'variant') throw new Error('Variant placement requires an approved room-analysis seam; source geometry was not changed.')
  const document = readDungeon(structuredClone(original))
  const levels = dungeonLevels(document)
  if (levels.length !== spec.floors.length || levels.some((l, i) => l.id !== spec.floors[i].id || l.elevationFeet !== spec.floors[i].elevationFeet || l.width !== spec.options.width || l.height !== spec.options.height)) throw new Error('Scene floor layout does not match specification.')
  if (JSON.stringify(document.transitions ?? []) !== JSON.stringify(spec.transitions)) throw new Error('Coordinator must realize the specified transitions before placement.')
  const diagnostics: ReturnType<SceneGenerationStage>['diagnostics'] = []
  const sceneryCount = levels.reduce((n, l) => n + l.props.length, 0)
  // All added decoration (including procedural fallback) consumes the stage cap.
  let additions = 0
  for (const level of levels) {
    const options = level.id === primaryLevelId(document) ? spec.options : { ...spec.options, seed: `${spec.options.seed}:floor:${level.id}` }
    const layout = generateLayout(options)
    // Zones refer to the existing generator's room order, so fail closed if a
    // coordinator hands this stage different geometry.
    if (JSON.stringify(level.floors.map(({ x, z }) => ({ x, z }))) !== JSON.stringify(layout.document.floors.map(({ x, z }) => ({ x, z })))) throw new Error('Unresolved scene rooms: floor geometry differs from seeded layout.')
    const graph = topology(level), blocked = new Set<string>(), occupied = new Set<string>()
    for (const prop of level.props) {
      const asset = prop.type === 'asset' ? manifest.assets.find(a => a.id === prop.assetId) : undefined
      if (prop.type === 'asset' && !asset) throw new Error('Existing scenery has no trusted footprint in the authorized manifest.')
      const cells = sceneFootprintCells(prop.position, asset?.footprint ?? { width: 1, height: 1 }, prop.rotation, prop.scale ?? 1)
      if (!graph.fits(cells) || cells.some(p => occupied.has(key(p)))) throw new Error('Existing scene objects have invalid or overlapping footprints.')
      cells.forEach(p => { occupied.add(key(p)); if (!asset || asset.blocking) blocked.add(key(p)) })
    }
    const essential = layout.rooms.map(centre)
    for (const t of document.transitions ?? []) for (const endpoint of [t.source, t.destination]) if (endpoint.floorId === level.id) essential.push({ x: endpoint.x, z: endpoint.z })
    validateSceneRoutes(level, essential, blocked)
    const reserved = new Set([...essential, ...graph.approaches].map(key))
    const parents = graph.search(essential[0], blocked)
    for (const target of essential) {
      let id: string | null | undefined = key(target)
      while (id != null) { reserved.add(id); id = parents.get(id) }
    }
    const ids = new Set([...level.props, ...level.walls, ...level.doors].map(o => o.id))
    for (const zone of spec.zones.filter(z => z.floorId === level.id)) {
      const room = layout.rooms[zone.roomIndex]
      if (!room) throw new Error('Unresolved scene room.')
      for (const cell of level.floors) if (cell.x >= room.x && cell.x < room.x + room.width && cell.z >= room.z && cell.z < room.z + room.height) cell.type = zone.material
      const candidates: Cell[] = []
      for (let z = room.z; z < room.z + room.height; z++) for (let x = room.x; x < room.x + room.width; x++) candidates.push({ x, z })
      for (const [dressingIndex, dressing] of zone.dressing.entries()) {
        const asset = manifest.assets.find(a => a.tags.includes(dressing.tag))
        const count = { sparse: 1, balanced: 2, dense: 4 }[dressing.density]
        for (let ordinal = 0; ordinal < count; ordinal++) {
          if (sceneryCount + additions >= spec.budget.scenery || level.props.length >= 200) { diagnostics.push({ code: 'budget-reduced', zoneId: zone.id }); break }
          const id = `assets:${spec.floors.findIndex(f => f.id === level.id)}:${spec.zones.indexOf(zone)}:${dressingIndex}:${ordinal}`
          if (ids.has(id)) throw new Error('Generated scene object ID collision.')
          const choose = (footprint: { width: number; height: number }) => candidates.find(p => {
            const cells = sceneFootprintCells(p, footprint)
            return graph.fits(cells) && cells.every(c => !occupied.has(key(c)) && !reserved.has(key(c)))
          })
          let position = asset && level.props.filter(p => p.type === 'asset').length < 100 ? choose(asset.footprint) : undefined
          const useAsset = !!position
          if (!position) { diagnostics.push({ code: 'asset-fallback', zoneId: zone.id }); position = choose({ width: 1, height: 1 }) }
          if (!position) continue
          const cells = sceneFootprintCells(position, useAsset ? asset!.footprint : { width: 1, height: 1 })
          cells.forEach(p => { occupied.add(key(p)); if (!useAsset || asset!.blocking) blocked.add(key(p)) })
          if (useAsset) level.props.push({ id, type: 'asset', assetId: asset!.id, position, rotation: 0, scale: 1, verticalOffset: 0, visible: true, label: dressing.tag, category: 'decoration' })
          else level.props.push({ id, type: dressing.fallback, position, rotation: 0 })
          ids.add(id); additions++
        }
      }
    }
    validateSceneRoutes(level, essential, blocked)
  }
  const [primary, ...rest] = levels
  document.floors = primary.floors; document.props = primary.props
  if (document.levels) document.levels = rest
  if (levels.some(l => l.props.some(p => p.type === 'asset')) && document.schemaVersion < 2) document.schemaVersion = 2
  return { document: readDungeon(document), diagnostics }
}
