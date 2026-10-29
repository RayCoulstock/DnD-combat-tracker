import {transitionSchema} from './transitions.ts'
import { floorImageSchema } from './floor-image.ts'
import { z } from 'zod'
import {drawingSchema,drawingBatch} from './drawing.ts'
import { architecturalVisualSchema, architectureLimits } from './architecture.ts'
import { scenerySchema, sceneryTransformSchema, sceneryPositionSchema, sceneryLimits, isScenery } from './scenery.ts'
export const floorTypes = ['stone', 'wood', 'dirt', 'grass', 'lava'] as const
export const propTypes = ['crate', 'barrel', 'chest', 'table', 'chair', 'pillar', 'torch', 'rock', 'anvil', 'brazier'] as const
export const themes = ['stone-dungeon', 'cavern', 'mining-outpost'] as const
const objectId = z.string().min(1).max(100).regex(/^[A-Za-z0-9_:-]+$/).refine(s => !['__proto__', 'constructor', 'prototype'].includes(s))
const coordinate = z.number().int().min(0).max(50)
export const cellSchema = z.object({ x: coordinate, z: coordinate }).strict()
const size = z.number().int().min(4).max(50)
export const wallSchema = z.object({ id: objectId, x: coordinate, z: coordinate, axis: z.enum(['H', 'V']), material: z.enum(['stone', 'wood']), visual: architecturalVisualSchema.optional() }).strict()
export const doorSchema = z.object({ id: objectId, wallId: objectId, state: z.enum(['open', 'closed', 'locked']), visual: architecturalVisualSchema.optional() }).strict()
export const proceduralPropSchema = z.object({ id: objectId, type: z.enum(propTypes), scale:z.number().finite().min(.1).max(10).optional(), position: cellSchema, rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]) }).strict()
export type ProceduralProp = z.infer<typeof proceduralPropSchema>
export const propSchema = z.discriminatedUnion('type', [proceduralPropSchema, scenerySchema])
const geometryShape = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), floorImage: floorImageSchema.optional(), id: objectId, name: z.string().trim().min(1).max(150), width: size, height: size,
  theme: z.enum(themes), floors: z.array(cellSchema.extend({ type: z.enum(floorTypes) })).max(2500),
  walls: z.array(wallSchema).max(5100), doors: z.array(doorSchema).max(1000), props: z.array(propSchema).max(200),
}).strict()
export const LEGACY_LEVEL_ID = 'ground'
export const levelMetadataSchema = z.object({id:objectId,name:z.string().trim().min(1).max(150),elevationFeet:z.number().finite().min(-1000).max(1000),playerVisible:z.boolean()}).strict()
const additionalLevelSchema = geometryShape.omit({schemaVersion:true}).extend({elevationFeet:levelMetadataSchema.shape.elevationFeet,playerVisible:z.boolean()})
const documentShape = geometryShape.extend({level:levelMetadataSchema.optional(),levels:z.array(additionalLevelSchema).max(11).optional(),transitions:z.array(transitionSchema).max(200).optional()}).strict()
export type DungeonLevel = z.infer<typeof additionalLevelSchema>
export type LevelMetadata = z.infer<typeof levelMetadataSchema>
export type DungeonMap = z.infer<typeof documentShape>
export type Wall = DungeonMap['walls'][number]
export type Cell = z.infer<typeof cellSchema>
export function wallKey(axis: 'H' | 'V', x: number, z: number) { return `${axis}:${x}:${z}` }
export function canonicalWall(x: number, z: number, edge: 'north' | 'east' | 'south' | 'west', material: Wall['material'] = 'stone'): Wall {
  const axis = edge === 'north' || edge === 'south' ? 'H' : 'V'
  x += edge === 'east' ? 1 : 0; z += edge === 'south' ? 1 : 0
  return { id: wallKey(axis, x, z), axis, x, z, material }
}
const validateGeometry = (map: z.infer<typeof geometryShape>, ctx: z.RefinementCtx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (map.floorImage && map.schemaVersion < 4) invalid('Floor images require map version 4.')
  const seen = new Set<string>()
  for (const f of map.floors) {
    const key = `${f.x}:${f.z}`
    if (f.x >= map.width || f.z >= map.height || seen.has(key)) invalid('Floor cells must be unique and within map bounds.')
    seen.add(key)
  }
  if ([...map.walls,...map.doors].filter(o=>o.visual).length > architectureLimits.maxInstances) invalid('Too many custom architectural visuals (maximum 200).')
  if (map.schemaVersion < 3 && [...map.walls,...map.doors].some(o => o.visual)) invalid('Architectural visuals require map version 3.')
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
  if (map.props.filter(isScenery).length > sceneryLimits.maxInstances) invalid('Too many uploaded scenery instances.')
  for (const p of map.props) {
    if (isScenery(p) && (map.schemaVersion < 2 || p.position.x > map.width-1 || p.position.z > map.height-1)) invalid('Custom scenery requires map version 2 and an anchor within map bounds.')
    if (p.position.x >= map.width || p.position.z >= map.height || ids.has(p.id)) invalid('Invalid prop position or duplicate object ID.')
    ids.add(p.id)
  }
}
export const dungeonSchema = documentShape.superRefine((map,ctx)=>{
  validateGeometry(map,ctx)
  if((map.level||map.levels)&&map.schemaVersion<5)ctx.addIssue({code:'custom',message:'Dungeon levels require map version 5.'})
  if(map.schemaVersion>=5&&!map.level)ctx.addIssue({code:'custom',message:'Version 5 requires primary level metadata.'})
  const ids=new Set([map.level?.id??LEGACY_LEVEL_ID]),elevations=[map.level?.elevationFeet??0]
  for(const level of map.levels??[]){
    if(ids.has(level.id))ctx.addIssue({code:'custom',message:'Level IDs must be unique.'})
    if(elevations.some(e=>Math.abs(e-level.elevationFeet)<.1))ctx.addIssue({code:'custom',message:'Levels must be at least 0.1 feet apart to avoid coincident floor surfaces.'})
    elevations.push(level.elevationFeet);ids.add(level.id);validateGeometry({...level,schemaVersion:5},ctx)
  }
  if(map.transitions&&map.schemaVersion<6)ctx.addIssue({code:'custom',message:'Transitions require map version 6.'})
  const transitionIds=new Set<string>(),levels=[{...map,id:map.level?.id??LEGACY_LEVEL_ID},...(map.levels??[])]
  for(const transition of map.transitions??[]){
    if(transitionIds.has(transition.id))ctx.addIssue({code:'custom',message:'Transition IDs must be unique.'})
    transitionIds.add(transition.id)
    if(transition.source.floorId===transition.destination.floorId)ctx.addIssue({code:'custom',message:'A vertical transition must connect different floors.'})
    for(const point of [transition.source,transition.destination]){
      const level=levels.find(l=>l.id===point.floorId)
      if(!level||point.x>=level.width||point.z>=level.height)ctx.addIssue({code:'custom',message:'Transition endpoints require existing floors and in-bounds squares.'})
    }
  }
})
const legacyMetadata:LevelMetadata={id:LEGACY_LEVEL_ID,name:'Ground Floor',elevationFeet:0,playerVisible:true}
const levelCache=new WeakMap<DungeonMap,DungeonLevel[]>()
// One adapter for legacy documents and version 5; stable views avoid geometry rebuilds on combat updates.
export function dungeonLevels(map:DungeonMap):DungeonLevel[]{
  const cached=levelCache.get(map);if(cached)return cached
  const {level,levels,schemaVersion,transitions,...geometry}=map;void schemaVersion;void transitions
  const result=[{...geometry,...(level??legacyMetadata)},...(levels??[])]
  levelCache.set(map,result);return result
}
export const primaryLevelId=(map?:DungeonMap)=>map?.level?.id??LEGACY_LEVEL_ID
const viewCache=new WeakMap<DungeonLevel,DungeonMap>()
export const levelDocument=(level:DungeonLevel):DungeonMap=>{
 const cached=viewCache.get(level);if(cached)return cached
 const {elevationFeet,playerVisible,...geometry}=level;void elevationFeet;void playerVisible
 const result:DungeonMap={...geometry,schemaVersion:4};viewCache.set(level,result);return result
}
// Reuse unchanged floor geometry across network revisions; equality never crosses level IDs.
export function reuseDungeonGeometry(previous:DungeonMap|undefined,next:DungeonMap):DungeonMap{
 if(!previous)return next
 const prior=new Map(dungeonLevels(previous).map(l=>[l.id,l]))
 const levels=dungeonLevels(next).map(level=>{const old=prior.get(level.id);if(!old)return level
  const same=JSON.stringify(old)===JSON.stringify(level);if(same)return old
  return {...level,...Object.fromEntries((['floors','walls','doors','props','floorImage'] as const).filter(k=>JSON.stringify(old[k])===JSON.stringify(level[k])).map(k=>[k,old[k]]))}
 })
 levelCache.set(next,levels);return next
}
export const elevationToWorld=(feet:number)=>feet/5
export function composeLevels(map:DungeonMap,levels:DungeonLevel[]):DungeonMap{
  if(!levels.length)throw new Error('The last dungeon level cannot be deleted.')
  const [first,...rest]=levels
  const {id,name,elevationFeet,playerVisible,...geometry}=first
  return {...geometry,id:map.id,name:map.name,schemaVersion:map.schemaVersion===6?6:5,...(map.transitions?{transitions:map.transitions}:{}),level:{id,name,elevationFeet,playerVisible},levels:rest}
}
export function blankDungeon(id: string, name: string, width = 20, height = 20): DungeonMap {
  return dungeonSchema.parse({ schemaVersion: 1, id, name, width, height, theme: 'stone-dungeon', floors: [], walls: [], doors: [], props: [] })
}
// Legacy versions remain valid; scenery uses 2, architectural visuals 3, and floor images 4. Never downgrade a document.
export const readDungeon = (value: unknown): DungeonMap => dungeonSchema.parse(value)
export const mapCommandSchemas = [
  z.object({type:z.literal('map.transition.set'),transition:transitionSchema}).strict(),
  z.object({type:z.literal('map.transition.remove'),transitionId:objectId}).strict(),
  z.object({type:z.literal('map.level.add'),id:objectId,name:levelMetadataSchema.shape.name,elevationFeet:levelMetadataSchema.shape.elevationFeet,width:size,height:size}).extend({levelId:objectId.optional()}).strict(),
  z.object({type:z.literal('map.level.update'),id:objectId,name:levelMetadataSchema.shape.name,elevationFeet:levelMetadataSchema.shape.elevationFeet,playerVisible:z.boolean()}).extend({levelId:objectId.optional()}).strict(),
  z.object({type:z.literal('map.level.duplicate'),id:objectId,newId:objectId,name:levelMetadataSchema.shape.name,elevationFeet:levelMetadataSchema.shape.elevationFeet}).extend({levelId:objectId.optional()}).strict(),
  z.object({type:z.literal('map.level.remove'),id:objectId}).extend({levelId:objectId.optional()}).strict(),
  drawingSchema.extend({levelId:objectId.optional()}),
  z.object({type: z.literal('map.floorImage.set'), image: floorImageSchema.nullable(), width: size, height: size}).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.blank'), id: objectId, name: z.string().min(1).max(150), width: size, height: size }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.load'), document: dungeonSchema }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.template.load'), templateId: z.uuid() }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.floor.paint'), cells: z.array(cellSchema).min(1).max(2500), material: z.enum(floorTypes).nullable() }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.wall.place'), wall: wallSchema }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.wall.visual'), wallId: objectId, visual: architecturalVisualSchema.nullable() }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.door.visual'), doorId: objectId, visual: architecturalVisualSchema.nullable() }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.wall.remove'), wallId: objectId }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.door.place'), door: doorSchema }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.door.update'), doorId: objectId, state: z.enum(['open', 'closed', 'locked']) }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.door.remove'), doorId: objectId }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.prop.place'), prop: propSchema }).extend({levelId:objectId.optional()}).strict(),
  z.object({type:z.literal('map.prop.transform'),propId:objectId,position:cellSchema,rotation:proceduralPropSchema.shape.rotation,scale:z.number().finite().min(.1).max(10)}).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.prop.rotate'), propId: objectId, rotation: proceduralPropSchema.shape.rotation }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.prop.remove'), propId: objectId }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.scenery.place'), prop: scenerySchema }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.scenery.update'), propId: objectId, transform: sceneryTransformSchema }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.scenery.duplicate'), propId: objectId, newId: objectId, position: sceneryPositionSchema }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.scenery.remove'), propId: objectId }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.history.clear') }).extend({levelId:objectId.optional()}).strict(),
  z.object({ type: z.literal('map.undo') }).extend({levelId:objectId.optional()}).strict(), z.object({ type: z.literal('map.redo') }).extend({levelId:objectId.optional()}).strict(),
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
function editSingleMap(frame: MapFrame, history: MapHistory, command: MapCommand): { frame: MapFrame; history: MapHistory } {
  if (command.type === 'map.history.clear') return { frame: structuredClone(frame), history: emptyHistory() }
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
      case 'map.floorImage.set':
        map.width = command.width; map.height = command.height
        if (command.image) { map.floorImage = command.image; map.schemaVersion = Math.max(4,map.schemaVersion) as 4 | 5 | 6 } else delete map.floorImage
        break
      case 'map.draw': {
        const {levelId,...drawing}=command;void levelId
        const batch=drawingBatch(drawing,map.width,map.height),existingFloors=new Map(map.floors.map(f=>[`${f.x}:${f.z}`,f])),cells=new Set(batch.area.map(c=>`${c.x}:${c.z}`))
        const occupied=(x:number,z:number)=>existingFloors.has(`${x}:${z}`)||cells.has(`${x}:${z}`)
        const connects=(w:Wall)=>w.axis==='H'?occupied(w.x,w.z-1)&&occupied(w.x,w.z):occupied(w.x-1,w.z)&&occupied(w.x,w.z)
        const protectedWall=(w:Wall)=>map!.doors.some(d=>d.wallId===w.id)
        if(command.kind==='corridor')map.walls=map.walls.filter(w=>{
          const touches=w.axis==='H'?cells.has(`${w.x}:${w.z-1}`)||cells.has(`${w.x}:${w.z}`):cells.has(`${w.x-1}:${w.z}`)||cells.has(`${w.x}:${w.z}`)
          return !touches||!connects(w)||protectedWall(w)
        })
        const walls=new Map(map.walls.map(w=>[w.id,w]))
        for(const w of batch.walls)if(!walls.has(w.id)&&!(command.kind==='corridor'&&connects(w)))walls.set(w.id,w)
        map.walls=[...walls.values()]
        for(const f of batch.floors)if(command.kind==='room'||!existingFloors.has(`${f.x}:${f.z}`))existingFloors.set(`${f.x}:${f.z}`,f)
        map.floors=[...existingFloors.values()];if(command.visual)map.schemaVersion=Math.max(3,map.schemaVersion) as 3 | 4 | 5 | 6
        break
      }
      case 'map.floor.paint': {
        const cells = new Map(map.floors.map(f => [`${f.x}:${f.z}`, f]))
        for (const cell of command.cells) {
          if (cell.x >= map.width || cell.z >= map.height) throw new Error('Floor is outside map bounds.')
          if (command.material) cells.set(`${cell.x}:${cell.z}`, { ...cell, type: command.material })
          else cells.delete(`${cell.x}:${cell.z}`)
        }
        map.floors = [...cells.values()].sort((a, b) => a.z - b.z || a.x - b.x); break
      }
      case 'map.wall.visual':
        requireId(map.walls, command.wallId); map.walls = map.walls.map(w => w.id === command.wallId ? (() => { const next={...w,visual:command.visual ?? undefined}; if(!command.visual)delete next.visual; return next })() : w); if(command.visual) map.schemaVersion=Math.max(3,map.schemaVersion) as 3 | 4 | 5 | 6; break
      case 'map.door.visual':
        requireId(map.doors, command.doorId); map.doors = map.doors.map(d => d.id === command.doorId ? (() => { const next={...d,visual:command.visual ?? undefined}; if(!command.visual)delete next.visual; return next })() : d); if(command.visual) map.schemaVersion=Math.max(3,map.schemaVersion) as 3 | 4 | 5 | 6; break
      case 'map.wall.place': if(command.wall.visual) map.schemaVersion=Math.max(3,map.schemaVersion) as 3 | 4 | 5 | 6; map.walls = [...map.walls.filter(w => w.id !== command.wall.id), command.wall]; break
      case 'map.wall.remove':
        requireId(map.walls, command.wallId); map.walls = map.walls.filter(w => w.id !== command.wallId); map.doors = map.doors.filter(d => d.wallId !== command.wallId); break
      case 'map.door.place': if(command.door.visual) map.schemaVersion=Math.max(3,map.schemaVersion) as 3 | 4 | 5 | 6; map.doors = [...map.doors.filter(d => d.wallId !== command.door.wallId), command.door]; break
      case 'map.door.update': requireId(map.doors, command.doorId); map.doors = map.doors.map(d => d.id === command.doorId ? { ...d, state: command.state } : d); break
      case 'map.door.remove': requireId(map.doors, command.doorId); map.doors = map.doors.filter(d => d.id !== command.doorId); break
      case 'map.scenery.place':
      case 'map.prop.place':
        if (isScenery(command.prop)) map.schemaVersion = Math.max(2,map.schemaVersion) as 2 | 3 | 4 | 5 | 6;
        if (map.props.some(p => p.id === command.prop.id)) throw new Error('Duplicate prop ID.')
        map.props.push(command.prop); break
      case 'map.prop.transform':
        requireId(map.props.filter(p=>!isScenery(p)),command.propId);map.props=map.props.map(p=>p.id===command.propId?{...p,position:command.position,rotation:command.rotation,scale:command.scale}:p);break
      case 'map.prop.rotate': requireId(map.props, command.propId); map.props = map.props.map(p => p.id === command.propId ? { ...p, rotation: command.rotation } : p); break
      case 'map.scenery.update': {
        const prop = map.props.filter(isScenery).find(p => p.id === command.propId)
        if (!prop) throw new Error('Scenery instance no longer exists.')
        map.props = map.props.map(p => p.id === prop.id && isScenery(p) ? { ...p, ...command.transform } : p); break
      }
      case 'map.scenery.duplicate': {
        const prop = map.props.filter(isScenery).find(p => p.id === command.propId)
        if (!prop) throw new Error('Scenery instance no longer exists.')
        if (map.props.some(p => p.id === command.newId)) throw new Error('Duplicate prop ID.')
        map.props.push({ ...prop, id: command.newId, position: command.position }); break
      }
      case 'map.scenery.remove':
        requireId(map.props.filter(isScenery), command.propId); map.props = map.props.filter(p => p.id !== command.propId); break
      case 'map.prop.remove': requireId(map.props, command.propId); map.props = map.props.filter(p => p.id !== command.propId); break
    }
  }
  const document = readDungeon(map)
  return { frame: { document, width: document.width, height: document.height }, history: { undo: bounded([...history.undo, structuredClone(frame)]), redo: [] } }
}

export function editMap(frame:MapFrame,history:MapHistory,command:MapCommand):{frame:MapFrame;history:MapHistory}{
  if(command.type==='map.undo'||command.type==='map.redo'||command.type==='map.history.clear'||command.type==='map.blank'||command.type==='map.load'||command.type==='map.template.load')return editSingleMap(frame,history,command)
  const document=frame.document
  if(!document)throw new Error('Create or load a dungeon map first.')
  if(command.type==='map.transition.set'||command.type==='map.transition.remove'){
    const transitions=document.transitions??[]
    if(command.type==='map.transition.remove'&&!transitions.some(t=>t.id===command.transitionId))throw new Error('Transition no longer exists.')
    const next=readDungeon({...composeLevels(document,dungeonLevels(document)),schemaVersion:6,transitions:command.type==='map.transition.set'?[...transitions.filter(t=>t.id!==command.transition.id),command.transition]:transitions.filter(t=>t.id!==command.transitionId)})
    return {frame:{...frame,document:reuseDungeonGeometry(document,next)},history:{undo:bounded([...history.undo,structuredClone(frame)]),redo:[]}}
  }
  if(!command.type.startsWith('map.level.')&&!document.level&&!command.levelId)return editSingleMap(frame,history,command)
  let levels=dungeonLevels(document)
  if(command.type==='map.level.add'){
    if(levels.some(l=>l.id===command.id))throw new Error('Duplicate level ID.')
    const {schemaVersion,...geometry}=blankDungeon(command.id,command.name,command.width,command.height);void schemaVersion
    levels=[...levels,{...geometry,elevationFeet:command.elevationFeet,playerVisible:false}]
  }else if(command.type==='map.level.update'){
    if(!levels.some(l=>l.id===command.id))throw new Error('Level no longer exists.')
    levels=levels.map(l=>l.id===command.id?{...l,name:command.name,elevationFeet:command.elevationFeet,playerVisible:command.playerVisible}:l)
  }else if(command.type==='map.level.remove'){
    if(!levels.some(l=>l.id===command.id))throw new Error('Level no longer exists.')
    levels=levels.filter(l=>l.id!==command.id)
  }else if(command.type==='map.level.duplicate'){
    const source=levels.find(l=>l.id===command.id)
    if(!source||levels.some(l=>l.id===command.newId))throw new Error('Invalid source or duplicate level ID.')
    const copy=structuredClone(source)
    // Canonical wall edges are level-local keys; (levelId, wallId) is their unique identity.
    copy.doors=copy.doors.map((d,i)=>({...d,id:`${command.newId.slice(0,60)}:door:${i}`}))
    copy.props=copy.props.map((p,i)=>({...p,id:`${command.newId.slice(0,60)}:prop:${i}`}))
    levels=[...levels,{...copy,id:command.newId,name:command.name,elevationFeet:command.elevationFeet,playerVisible:false}]
  }else{
    const id=command.levelId??primaryLevelId(document),index=levels.findIndex(l=>l.id===id)
    if(index<0)throw new Error('Level no longer exists.')
    const source=levels[index]
    const result=editSingleMap({document:levelDocument(source),width:source.width,height:source.height},emptyHistory(),command).frame.document!
    const {schemaVersion,...geometry}=result;void schemaVersion
    levels=levels.map((l,i)=>i===index?{...geometry,id:source.id,name:source.name,elevationFeet:source.elevationFeet,playerVisible:source.playerVisible}:l)
  }
  const composed=composeLevels(document,levels)
  if(command.type==='map.level.remove'&&composed.transitions)composed.transitions=composed.transitions.filter(t=>t.source.floorId!==command.id&&t.destination.floorId!==command.id)
  const next=reuseDungeonGeometry(document,readDungeon(composed))
  return {frame:{document:next,width:next.width,height:next.height},history:{undo:bounded([...history.undo,structuredClone(frame)]),redo:[]}}
}
