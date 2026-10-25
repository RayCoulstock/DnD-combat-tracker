export interface GridPosition {
  x: number
  z: number
}

export interface BattleMapState {
  version: 1
  width: number
  height: number
  gridSizeFeet: number
  showGrid: boolean
  showLabels: boolean
  tokens: Record<string, GridPosition>
}

export const DEFAULT_MAP_SIZE = 20

export function createBattleMapState(ids: Array<string | number> = []): BattleMapState {
  return reconcileBattleMap({
    version: 1,
    width: DEFAULT_MAP_SIZE,
    height: DEFAULT_MAP_SIZE,
    gridSizeFeet: 5,
    showGrid: true,
    showLabels: true,
    tokens: {},
  }, ids)
}

export function isGridPosition(value: unknown, width: number, height: number): value is GridPosition {
  if (!value || typeof value !== 'object') return false
  const position = value as GridPosition
  return Number.isInteger(position.x) && Number.isInteger(position.z) &&
    position.x >= 0 && position.x < width && position.z >= 0 && position.z < height
}

function firstAvailablePosition(used: Set<string>, width: number, height: number): GridPosition {
  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!used.has(`${x}:${z}`)) return { x, z }
    }
  }
  return { x: 0, z: 0 }
}

export function reconcileBattleMap(map: BattleMapState, ids: Array<string | number>): BattleMapState {
  const width = Number.isInteger(map.width) && map.width > 0 ? map.width : DEFAULT_MAP_SIZE
  const height = Number.isInteger(map.height) && map.height > 0 ? map.height : DEFAULT_MAP_SIZE
  const tokens: Record<string, GridPosition> = {}
  const used = new Set(ids.map(id => map.tokens?.[String(id)]).filter(p => isGridPosition(p, width, height)).map(p => `${p.x}:${p.z}`))

  ids.forEach((id) => {
    const key = String(id)
    const existing = map.tokens?.[key]
    const position = isGridPosition(existing, width, height) ? existing : firstAvailablePosition(used, width, height)
    tokens[key] = { ...position }
    used.add(`${position.x}:${position.z}`)
  })

  return { ...map, version: 1, width, height, gridSizeFeet: Number.isInteger(map.gridSizeFeet)&&map.gridSizeFeet>=1&&map.gridSizeFeet<=100?map.gridSizeFeet:5, tokens }
}

export function normalizeBattleMap(value: unknown, ids: Array<string | number>): BattleMapState {
  if (!value || typeof value !== 'object') return createBattleMapState(ids)
  const candidate = value as Partial<BattleMapState>
  const base: BattleMapState = {
    version: 1,
    width: Number.isInteger(candidate.width) && candidate.width! > 0 && candidate.width! <= 100 ? candidate.width! : DEFAULT_MAP_SIZE,
    height: Number.isInteger(candidate.height) && candidate.height! > 0 && candidate.height! <= 100 ? candidate.height! : DEFAULT_MAP_SIZE,
    gridSizeFeet: Number.isInteger(candidate.gridSizeFeet)&&candidate.gridSizeFeet!>=1&&candidate.gridSizeFeet!<=100?candidate.gridSizeFeet!:5,
    showGrid: candidate.showGrid !== false,
    showLabels: candidate.showLabels !== false,
    tokens: candidate.tokens && typeof candidate.tokens === 'object' ? candidate.tokens : {},
  }
  return reconcileBattleMap(base, ids)
}

export function moveToken(map: BattleMapState, combatantId: string | number, destination: GridPosition): BattleMapState {
  const key = String(combatantId)
  if (!(key in map.tokens) || !isGridPosition(destination, map.width, map.height)) return map
  return { ...map, tokens: { ...map.tokens, [key]: { ...destination } } }
}
