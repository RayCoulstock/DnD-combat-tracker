import { z } from 'zod'
export const floorTypes = ['stone', 'wood', 'dirt', 'grass', 'lava'] as const
export const propTypes = ['crate', 'barrel', 'chest', 'table', 'chair', 'pillar', 'torch', 'rock', 'anvil', 'brazier'] as const
export const themes = ['stone-dungeon', 'cavern', 'mining-outpost'] as const
const objectId = z.string().min(1).max(100).regex(/^[A-Za-z0-9_:-]+$/).refine(s => !['__proto__', 'constructor', 'prototype'].includes(s))
const coordinate = z.number().int().min(0).max(50)
export const cellSchema = z.object({ x: coordinate, z: coordinate }).strict()
const size = z.number().int().min(4).max(50)
export const wallSchema = z.object({ id: objectId, x: coordinate, z: coordinate, axis: z.enum(['H', 'V']), material: z.enum(['stone', 'wood']) }).strict()
export const doorSchema = z.object({ id: objectId, wallId: objectId, state: z.enum(['open', 'closed', 'locked']) }).strict()
export const propSchema = z.object({ id: objectId, type: z.enum(propTypes), position: cellSchema, rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]) }).strict()
const documentShape = z.object({
  schemaVersion: z.literal(1), id: objectId, name: z.string().trim().min(1).max(150), width: size, height: size,
  theme: z.enum(themes), floors: z.array(cellSchema.extend({ type: z.enum(floorTypes) })).max(2500),
  walls: z.array(wallSchema).max(5100), doors: z.array(doorSchema).max(1000), props: z.array(propSchema).max(200),
}).strict()
export type DungeonMap = z.infer<typeof documentShape>
export type Wall = DungeonMap['walls'][number]
export type Cell = z.infer<typeof cellSchema>
export function wallKey(axis: 'H' | 'V', x: number, z: number) { return `${axis}:${x}:${z}` }
export function canonicalWall(x: number, z: number, edge: 'north' | 'east' | 'south' | 'west', material: Wall['material'] = 'stone'): Wall {
  const axis = edge === 'north' || edge === 'south' ? 'H' : 'V'
  x += edge === 'east' ? 1 : 0; z += edge === 'south' ? 1 : 0
  return { id: wallKey(axis, x, z), axis, x, z, material }
}
export const dungeonSchema = documentShape.superRefine((map, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message })
  const seen = new Set<string>()
  for (const f of map.floors) {
    const key = `${f.x}:${f.z}`
    if (f.x >= map.width || f.z >= map.height || seen.has(key)) invalid('Floor cells must be unique and within map bounds.')
    seen.add(key)
  }
  const walls = new Set<string>()
  for (const w of map.walls) {
    if (w.id !== wallKey(w.axis, w.x, w.z) || walls.has(w.id) || w.x > map.width || w.z > map.height || (w.axis === 'H' ? w.x >= map.width : w.z >= map.height)) invalid('Invalid or duplicate canonical wall.')
    walls.add(w.id)
  }
  const ids = new Set<string>(walls), openings = new Set<string>()
  for (const d of map.doors) {
    if (!walls.has(d.wallId) || openings.has(d.wallId) || ids.has(d.id)) invalid('Doors require one unique wall opening and ID.')
    ids.add(d.id); openings.add(d.wallId)
  }
  for (const p of map.props) {
    if (p.position.x >= map.width || p.position.z >= map.height || ids.has(p.id)) invalid('Invalid prop position or duplicate object ID.')
    ids.add(p.id)
  }
})
export function blankDungeon(id: string, name: string, width = 20, height = 20): DungeonMap {
  return dungeonSchema.parse({ schemaVersion: 1, id, name, width, height, theme: 'stone-dungeon', floors: [], walls: [], doors: [], props: [] })
}
// Version 1 is the first map format. Unsupported future versions fail rather than being guessed.
export const readDungeon = (value: unknown): DungeonMap => dungeonSchema.parse(value)
export const mapCommandSchemas = [
  z.object({ type: z.literal('map.blank'), id: objectId, name: z.string().min(1).max(150), width: size, height: size }).strict(),
  z.object({ type: z.literal('map.load'), document: dungeonSchema }).strict(),
  z.object({ type: z.literal('map.template.load'), templateId: z.uuid() }).strict(),
  z.object({ type: z.literal('map.floor.paint'), cells: z.array(cellSchema).min(1).max(2500), material: z.enum(floorTypes).nullable() }).strict(),
  z.object({ type: z.literal('map.wall.place'), wall: wallSchema }).strict(),
  z.object({ type: z.literal('map.wall.remove'), wallId: objectId }).strict(),
  z.object({ type: z.literal('map.door.place'), door: doorSchema }).strict(),
  z.object({ type: z.literal('map.door.update'), doorId: objectId, state: z.enum(['open', 'closed', 'locked']) }).strict(),
  z.object({ type: z.literal('map.door.remove'), doorId: objectId }).strict(),
  z.object({ type: z.literal('map.prop.place'), prop: propSchema }).strict(),
  z.object({ type: z.literal('map.prop.rotate'), propId: objectId, rotation: propSchema.shape.rotation }).strict(),
  z.object({ type: z.literal('map.prop.remove'), propId: objectId }).strict(),
  z.object({ type: z.literal('map.undo') }).strict(), z.object({ type: z.literal('map.redo') }).strict(),
] as const
export const mapCommandSchema = z.discriminatedUnion('type', mapCommandSchemas)
export type MapCommand = z.infer<typeof mapCommandSchema>
export interface MapFrame { document: DungeonMap | null; width: number; height: number }
export interface MapHistory { undo: MapFrame[]; redo: MapFrame[] }
export const emptyHistory = (): MapHistory => ({ undo: [], redo: [] })
const bounded = (frames: MapFrame[]) => {
  const result = frames.slice(-20)
  while (new TextEncoder().encode(JSON.stringify(result)).byteLength > 2_000_000) result.shift()
  return result
}
export function editMap(frame: MapFrame, history: MapHistory, command: MapCommand): { frame: MapFrame; history: MapHistory } {
  if (command.type === 'map.undo' || command.type === 'map.redo') {
    const undo = command.type === 'map.undo', source = undo ? history.undo : history.redo
    if (!source.length) throw new Error(undo ? 'Nothing to undo.' : 'Nothing to redo.')
    return { frame: structuredClone(source[source.length - 1]), history: undo ? { undo: source.slice(0, -1), redo: bounded([...history.redo, frame]) } : { redo: source.slice(0, -1), undo: bounded([...history.undo, frame]) } }
  }
  let map = frame.document ? structuredClone(frame.document) : null
  if (command.type === 'map.template.load') throw new Error('Template must be resolved by the server.')
  if (command.type === 'map.blank') map = blankDungeon(command.id, command.name, command.width, command.height)
  else if (command.type === 'map.load') map = readDungeon(command.document)
  else {
    if (!map) throw new Error('Create or load a dungeon map first.')
    const requireId = (items: { id: string }[], id: string) => { if (!items.some(v => v.id === id)) throw new Error('Map object no longer exists.') }
    switch (command.type) {
      case 'map.floor.paint': {
        const cells = new Map(map.floors.map(f => [`${f.x}:${f.z}`, f]))
        for (const cell of command.cells) {
          if (cell.x >= map.width || cell.z >= map.height) throw new Error('Floor is outside map bounds.')
          if (command.material) cells.set(`${cell.x}:${cell.z}`, { ...cell, type: command.material })
          else cells.delete(`${cell.x}:${cell.z}`)
        }
        map.floors = [...cells.values()].sort((a, b) => a.z - b.z || a.x - b.x); break
      }
      case 'map.wall.place': map.walls = [...map.walls.filter(w => w.id !== command.wall.id), command.wall]; break
      case 'map.wall.remove':
        requireId(map.walls, command.wallId); map.walls = map.walls.filter(w => w.id !== command.wallId); map.doors = map.doors.filter(d => d.wallId !== command.wallId); break
      case 'map.door.place': map.doors = [...map.doors.filter(d => d.wallId !== command.door.wallId), command.door]; break
      case 'map.door.update': requireId(map.doors, command.doorId); map.doors = map.doors.map(d => d.id === command.doorId ? { ...d, state: command.state } : d); break
      case 'map.door.remove': requireId(map.doors, command.doorId); map.doors = map.doors.filter(d => d.id !== command.doorId); break
      case 'map.prop.place':
        if (map.props.some(p => p.id === command.prop.id)) throw new Error('Duplicate prop ID.')
        map.props.push(command.prop); break
      case 'map.prop.rotate': requireId(map.props, command.propId); map.props = map.props.map(p => p.id === command.propId ? { ...p, rotation: command.rotation } : p); break
      case 'map.prop.remove': requireId(map.props, command.propId); map.props = map.props.filter(p => p.id !== command.propId); break
    }
  }
  const document = readDungeon(map)
  return { frame: { document, width: document.width, height: document.height }, history: { undo: bounded([...history.undo, structuredClone(frame)]), redo: [] } }
}
