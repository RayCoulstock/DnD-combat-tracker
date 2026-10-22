import { z } from 'zod'
import { blankDungeon, canonicalWall, readDungeon, themes, type DungeonMap } from './dungeon.ts'
export const generationOptionsSchema = z.object({
  width: z.number().int().min(6).max(50), height: z.number().int().min(6).max(50),
  roomCount: z.number().int().min(1).max(25), minRoomSize: z.number().int().min(3).max(20), maxRoomSize: z.number().int().min(3).max(30),
  theme: z.enum(themes), seed: z.string().min(1).max(100),
}).strict().refine(o => o.minRoomSize <= o.maxRoomSize, 'Minimum room size cannot exceed maximum.')
export type GenerationOptions = z.infer<typeof generationOptionsSchema>
export interface Room { x: number; z: number; width: number; height: number }
function hash(text: string) { let h = 2166136261; for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
export function generateLayout(input: unknown): { document: DungeonMap; rooms: Room[] } {
  const o = generationOptionsSchema.parse(input)
  let state = hash(JSON.stringify(o)) || 1
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296 }
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
  const partitions: { cols: number; rows: number; sw: number; sh: number; waste: number }[] = []
  for (let cols = 1; cols <= o.roomCount; cols++) {
    const rows = Math.ceil(o.roomCount / cols), sw = Math.floor((o.width - 2) / cols), sh = Math.floor((o.height - 2) / rows)
    if (sw >= o.minRoomSize + 2 && sh >= o.minRoomSize + 2) partitions.push({ cols, rows, sw, sh, waste: cols * rows - o.roomCount + Math.abs(sw - sh) / 100 })
  }
  partitions.sort((a, b) => a.waste - b.waste)
  const layout = partitions[0]
  if (!layout) throw new Error('These rooms cannot fit with separating corridors. Increase dimensions, reduce room count or minimum room size.')
  const map = blankDungeon(`generated-${hash(JSON.stringify(o)).toString(16)}`, `${o.theme}: ${o.seed}`, o.width, o.height)
  map.theme = o.theme
  const cells = new Map<string, DungeonMap['floors'][number]>()
  const material = () => o.theme === 'cavern' ? (random() < .3 ? 'stone' : 'dirt') : o.theme === 'mining-outpost' && random() < .4 ? 'wood' : 'stone'
  const add = (x: number, z: number) => { if (x >= 1 && z >= 1 && x < o.width - 1 && z < o.height - 1 && !cells.has(`${x}:${z}`)) cells.set(`${x}:${z}`, { x, z, type: material() }) }
  const rooms: Room[] = []
  const slots = Array.from({ length: layout.cols * layout.rows }, (_, i) => i)
  for (let i = slots.length - 1; i > 0; i--) { const j = int(0, i); [slots[i], slots[j]] = [slots[j], slots[i]] }
  for (const index of slots.slice(0, o.roomCount)) {
    const width = int(o.minRoomSize, Math.min(o.maxRoomSize, layout.sw - 2)), height = int(o.minRoomSize, Math.min(o.maxRoomSize, layout.sh - 2))
    const x = 1 + (index % layout.cols) * layout.sw + int(1, layout.sw - width - 1), z = 1 + Math.floor(index / layout.cols) * layout.sh + int(1, layout.sh - height - 1)
    const room = { x, z, width, height }; rooms.push(room)
    for (let dz = 0; dz < height; dz++) for (let dx = 0; dx < width; dx++) {
      const corner = (dx === 0 || dx === width - 1) && (dz === 0 || dz === height - 1)
      if (!(o.theme === 'cavern' && corner)) add(x + dx, z + dz)
    }
  }
  const centre = (r: Room) => ({ x: r.x + Math.floor(r.width / 2), z: r.z + Math.floor(r.height / 2) })
  for (let i = 1; i < rooms.length; i++) {
    const a = centre(rooms[i - 1]), b = centre(rooms[i]); let x = a.x, z = a.z
    const carve = () => { add(x, z); if (o.theme === 'cavern') { add(x + 1, z); add(x, z + 1) } }
    carve()
    const horizontalFirst = random() > .5
    const walkX = () => { while (x !== b.x) { x += Math.sign(b.x - x); carve() } }
    const walkZ = () => { while (z !== b.z) { z += Math.sign(b.z - z); carve() } }
    if (horizontalFirst) { walkX(); walkZ() } else { walkZ(); walkX() }
  }
  const walls = new Map<string, DungeonMap['walls'][number]>()
  const has = (x: number, z: number) => cells.has(`${x}:${z}`)
  for (const f of cells.values()) {
    const edges = [[0,-1,'north'], [1,0,'east'], [0,1,'south'], [-1,0,'west']] as const
    for (const [dx, dz, edge] of edges) if (!has(f.x + dx, f.z + dz)) {
      const wall = canonicalWall(f.x, f.z, edge, o.theme === 'mining-outpost' && random() < .4 ? 'wood' : 'stone'); walls.set(wall.id, wall)
    }
  }
  for (const [index, room] of rooms.entries()) {
    const entrances: DungeonMap['walls'] = []
    for (let dx = 0; dx < room.width; dx++) {
      if (has(room.x + dx, room.z) && has(room.x + dx, room.z - 1)) entrances.push(canonicalWall(room.x + dx, room.z, 'north'))
      if (has(room.x + dx, room.z + room.height - 1) && has(room.x + dx, room.z + room.height)) entrances.push(canonicalWall(room.x + dx, room.z + room.height - 1, 'south'))
    }
    for (let dz = 0; dz < room.height; dz++) {
      if (has(room.x, room.z + dz) && has(room.x - 1, room.z + dz)) entrances.push(canonicalWall(room.x, room.z + dz, 'west'))
      if (has(room.x + room.width - 1, room.z + dz) && has(room.x + room.width, room.z + dz)) entrances.push(canonicalWall(room.x + room.width - 1, room.z + dz, 'east'))
    }
    if (o.theme !== 'cavern' && entrances.length) {
      const wall = entrances[int(0, entrances.length - 1)]; walls.set(wall.id, wall)
      map.doors.push({ id: `door-${index}`, wallId: wall.id, state: 'closed' })
    }
    const palette = o.theme === 'cavern' ? ['rock'] as const : o.theme === 'mining-outpost' ? ['crate','barrel','pillar','anvil'] as const : ['pillar','crate'] as const
    map.props.push({ id: `prop-${index}`, type: palette[int(0, palette.length - 1)], position: { x: room.x + 1, z: room.z + 1 }, rotation: (int(0,3) * 90) as 0 | 90 | 180 | 270 })
  }
  map.floors = [...cells.values()].sort((a,b) => a.z - b.z || a.x - b.x)
  map.walls = [...walls.values()].sort((a,b) => a.id.localeCompare(b.id))
  return { document: readDungeon(map), rooms }
}
export const generateDungeon = (options: unknown) => generateLayout(options).document
