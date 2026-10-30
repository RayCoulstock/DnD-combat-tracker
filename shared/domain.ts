import {transitionRoute} from './transitions.ts'
import {reuseDungeonGeometry,dungeonLevels,composeLevels,primaryLevelId} from './dungeon.ts'
import { z } from 'zod'
import {tacticalCommands,tacticalRecordSchema,activeTactical,assertTacticalBounds,type TacticalRecord} from './tactical.ts'
import { isScenery } from './scenery.ts'
import { miniatureSchema } from './miniatures.ts'
import { generationOptionsSchema, generateDungeon } from './generator.ts'
import { dungeonSchema, editMap, emptyHistory, mapCommandSchemas, type DungeonMap, type MapCommand, type MapHistory } from './dungeon.ts'
import { createBattleMapState, isGridPosition, normalizeBattleMap, reconcileBattleMap } from '../src/mapState.ts'

export const idSchema = z.union([z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/), z.number().int().safe().nonnegative()]).refine(v => !['__proto__', 'constructor', 'prototype'].includes(String(v)))
const text = z.string().max(10000)
export const combatantSchema = z.object({
  sourceLibraryId:z.uuid().optional(), persistentIdentity:z.boolean().optional(), unplaced:z.boolean().optional(),
  floorId:z.string().min(1).max(100).optional(), miniature: miniatureSchema.optional(), hpShown: z.boolean().optional(),
  id: idSchema, name: z.string().trim().min(1).max(200), short: z.string().max(20).default('?'),
  side: z.enum(['hero', 'enemy']), role: text.default(''), initiative: z.number().finite().min(-1000).max(1000),
  hp: z.number().int().min(0).max(100000), maxHp: z.number().int().min(1).max(100000),
  ac: z.number().int().min(0).max(1000), speed: text.default('30 ft'),
  conditions: z.array(z.string().max(100)).max(50), saves: z.array(z.tuple([z.string().max(30), z.number().finite()])).max(20),
  details: z.array(z.tuple([text, text])).max(50).optional(),
  actions: z.array(z.object({ name: z.string().max(200), text, category: z.string().max(100).optional() })).max(100),
  artwork: z.string().max(4500000).refine(v => /^data:image\/[a-z0-9.+-]{1,80};base64,[A-Za-z0-9+/=]+$/.test(v) || /^\/api\/artwork\/[a-f0-9]{64}$/.test(v)).optional(),
  ownerId: z.uuid().nullable().default(null), visible: z.boolean().default(true), privateNotes: text.default(''),
}).passthrough().refine(c => c.hp <= c.maxHp, 'HP exceeds maximum')
export type Combatant = z.infer<typeof combatantSchema>
export const encounterFileSchema = z.object({
  tactical:z.array(tacticalRecordSchema).max(64).optional(),
  version: z.literal(1), round: z.number().int().min(1).max(1000000),
  activeId: idSchema.nullable().optional(), selectedId: idSchema.nullable().optional(),
  usedAbilities: z.record(z.string().max(400), z.boolean()).default({}),
  dungeonMap: dungeonSchema.optional(),
  combatants: z.array(combatantSchema).max(100), battleMap: z.unknown().optional(),
}).refine(s => new Set(s.combatants.map(c => String(c.id))).size === s.combatants.length, 'Duplicate combatant IDs').refine(s=>!s.tactical||new Set(s.tactical.map(r=>r.id)).size===s.tactical.length,'Duplicate tactical IDs')
export interface EncounterState {
  tactical?:TacticalRecord[]
  levelsHidden?:boolean
  dungeonMap?: DungeonMap; mapRevision?: number; mapUndoDepth?: number; mapRedoDepth?: number
  version: 1; round: number; activeId: string | number | null; selectedId: string | number | null
  usedAbilities: Record<string, boolean>; combatants: Combatant[]; battleMap: ReturnType<typeof createBattleMapState>
}
export interface Actor { role: 'dm' | 'player'; id: string }
export function importEncounter(value: unknown, preservePermissions = false): EncounterState {
  const data = encounterFileSchema.parse(value)
  const combatants = data.combatants.map(c => preservePermissions ? c : { ...c, ownerId: null })
  const ids = new Set(combatants.map(c => c.id))
  return reconcileLevelTokens({ ...(data.tactical?{tactical:data.tactical.filter(r=>r.kind==='template').map(r=>({...r,ownerId:preservePermissions?r.ownerId:'imported'}))}:{}), version: 1, round: data.round, activeId: ids.has(data.activeId!) ? data.activeId! : combatants[0]?.id ?? null,
    selectedId: ids.has(data.selectedId!) ? data.selectedId! : combatants[0]?.id ?? null,
    usedAbilities: data.usedAbilities, combatants, ...(data.dungeonMap ? { dungeonMap: data.dungeonMap } : {}), battleMap: normalizeBattleMap(data.dungeonMap ? { ...(data.battleMap as object ?? {}), width: Math.max(...dungeonLevels(data.dungeonMap).map(l=>l.width)), height: Math.max(...dungeonLevels(data.dungeonMap).map(l=>l.height)) } : data.battleMap, combatants.map(c => c.id)) })
}
export const emptyEncounter = (): EncounterState => importEncounter({ version: 1, round: 1, combatants: [] })
const target = { combatantId: idSchema }
export const commandSchema = z.discriminatedUnion('type', [
  ...mapCommandSchemas, ...tacticalCommands,
  z.object({type:z.literal('library.add'),entryId:z.uuid(),instanceId:z.uuid(),useSavedState:z.boolean().default(true),allowDuplicate:z.boolean().default(false),floorId:z.string().min(1).max(100).optional(),destination:z.object({x:z.number().int(),z:z.number().int()}).strict().optional()}).strict(),
  z.object({type:z.literal('library.state.save'),combatantId:idSchema,expectedRevision:z.number().int().nonnegative(),conditions:z.array(z.string().max(100)).max(50)}).strict(),
  z.object({ type: z.literal('map.generate'), options: generationOptionsSchema }).strict(),
  z.object({type:z.literal('combatant.transition.use'),...target,transitionId:z.string().min(1).max(100),from:z.enum(['source','destination']),allowRemoteSource:z.boolean().default(false),allowOccupied:z.boolean().default(false)}).strict(),
  z.object({type:z.literal('combatant.floor.transfer'),...target,floorId:z.string().min(1).max(100),destination:z.object({x:z.number().int(),z:z.number().int()}).strict()}).strict(),
  z.object({ type: z.literal('token.move'), ...target, destination: z.object({ x: z.number().int(), z: z.number().int() }).strict() }).strict(),
  z.object({ type: z.literal('combatant.miniature.update'), ...target, miniature: miniatureSchema }).strict(),
  z.object({ type: z.literal('token.assign'), ...target, playerId: z.uuid().nullable() }).strict(),
  z.object({ type: z.literal('combatant.hp.update'), ...target, hp: z.number().int().min(0).max(100000) }).strict(),
  z.object({ type: z.literal('combatant.conditions'), ...target, conditions: z.array(z.string().max(100)).max(50) }).strict(),
  z.object({ type: z.literal('combatant.hp.visibility'), ...target, shown: z.boolean() }).strict(),
  z.object({ type: z.literal('combatant.visibility'), ...target, visible: z.boolean() }).strict(),
  z.object({ type: z.literal('combatant.add'), allowPersistentDuplicate:z.boolean().default(false), floorId:z.string().min(1).max(100).optional(), combatants: z.array(combatantSchema).min(1).max(20) }).strict(),
  z.object({ type: z.literal('combatant.edit'), ...target, combatant: combatantSchema }).strict(),
  z.object({ type: z.literal('combatant.remove'), ...target }).strict(),
  z.object({ type: z.literal('ability.toggle'), ...target, key: z.string().max(400) }).strict(),
  z.object({ type: z.literal('initiative.next') }).strict(),
  z.object({ type: z.literal('map.settings'), showGrid: z.boolean(), showLabels: z.boolean(), width: z.number().int().min(1).max(100).optional(), height: z.number().int().min(1).max(100).optional(), gridSizeFeet:z.number().int().min(1).max(100).optional() }).strict(),
  z.object({ type: z.literal('encounter.clear') }).strict(),
  z.object({ type: z.literal('encounter.restore'), file: encounterFileSchema }).strict(),
])
export type GameCommand = z.infer<typeof commandSchema>
export const envelopeSchema = z.object({ commandId: z.uuid(), encounterId: z.uuid(), revision: z.number().int().nonnegative(), command: commandSchema }).strict()
export type CommandEnvelope = z.infer<typeof envelopeSchema>
export class DomainError extends Error {
  constructor(public code: 'FORBIDDEN' | 'INVALID' | 'CONFLICT' | 'NOT_FOUND' | 'UNAUTHENTICATED' | 'SESSION_ENDED', message: string) { super(message) }
}
export function applyCommand(state: EncounterState, actor: Actor, command: GameCommand, now=Date.now()): EncounterState {
  if(command.type==='tactical.create'||command.type==='tactical.update'||command.type==='tactical.remove'||command.type==='tactical.clear'){
    const records=activeTactical(state.tactical,now)
    if(command.type==='tactical.clear'){if(actor.role!=='dm')throw new DomainError('FORBIDDEN','Only the DM may clear shared overlays.');return{...state,tactical:[]}}
    const existing=records.find(r=>r.id===command.id)
    if(command.type!=='tactical.create'&&(!existing||actor.role==='player'&&!levelVisible(state,existing.floorId)||(actor.role!=='dm'&&existing.ownerId!==actor.id)))throw new DomainError('FORBIDDEN','Only the owner or DM may change this overlay.')
    if(command.type==='tactical.remove')return{...state,tactical:records.filter(r=>r.id!==command.id)}
    const floorId=command.floorId??existing?.floorId??primaryLevelId(state.dungeonMap),level=state.dungeonMap&&dungeonLevels(state.dungeonMap).find(l=>l.id===floorId)
    if(state.dungeonMap&&!level||actor.role==='player'&&!levelVisible(state,floorId))throw new DomainError('FORBIDDEN','Level access denied.')
    try{assertTacticalBounds(command.object,level?.width??state.battleMap.width,level?.height??state.battleMap.height)}catch{throw new DomainError('INVALID','Overlay anchor is outside the battlefield.')}
    if(command.type==='tactical.create'){
      if(existing||records.length>=64||(actor.role!=='dm'&&records.filter(r=>r.ownerId===actor.id).length>=8))throw new DomainError('INVALID','Duplicate overlay or shared overlay limit reached.')
      return{...state,tactical:[...records,{...command.object,floorId,id:command.id,ownerId:actor.id,...(command.object.kind==='measurement'?{expiresAt:now+120000}:{})}]}
    }
    if(existing!.floorId&&command.floorId&&command.floorId!==existing!.floorId)throw new DomainError('INVALID','Overlay level cannot change.')
    if(existing!.kind!==command.object.kind)throw new DomainError('INVALID','Overlay kind cannot change.')
    return{...state,tactical:records.map(r=>r.id===command.id?{...command.object,floorId:r.floorId,id:r.id,ownerId:r.ownerId,expiresAt:r.expiresAt}:r)}
  }
  const c = 'combatantId' in command ? state.combatants.find(c => String(c.id) === String(command.combatantId)) : undefined
  if (actor.role !== 'dm' && (command.type !== 'token.move' || !c?.visible || c.ownerId !== actor.id || !combatantLevelVisible(state,c))) throw new DomainError('FORBIDDEN', 'This action is not permitted.')
  if (command.type === 'map.generate') {
    if (actor.role !== 'dm') throw new DomainError('FORBIDDEN', 'Only the DM may generate maps.')
    return applyMapEdit(state, actor, { type: 'map.load', document: generateDungeon(command.options) }, emptyHistory()).state
  }
  if (isMapEdit(command)) return applyMapEdit(state, actor, command, emptyHistory()).state
  if ('combatantId' in command && !c) throw new DomainError('NOT_FOUND', 'Combatant not found.')
  const update = (patch: Partial<Combatant>) => ({ ...state, combatants: state.combatants.map(item => item === c ? { ...item, ...patch } : item) })
  switch (command.type) {
    case 'library.add': case 'library.state.save': throw new DomainError('INVALID','Library commands require server persistence.')
    case 'combatant.transition.use': {
      const transition=state.dungeonMap?.transitions?.find(t=>t.id===command.transitionId)
      if(!transition)throw new DomainError('INVALID','Transition no longer exists.')
      let route
      try{route=transitionRoute(transition,command.from)}catch(error){throw new DomainError('INVALID',(error as Error).message)}
      const {source,destination}=route,position=state.battleMap.tokens[String(c!.id)]
      if(combatantFloorId(state,c!)!==source.floorId)throw new DomainError('INVALID','Combatant is not on the source floor.')
      if((position?.x!==source.x||position?.z!==source.z)&&!command.allowRemoteSource)throw new DomainError('INVALID','Combatant is not on the source square. Confirm the remote transfer override.')
      const level=state.dungeonMap&&dungeonLevels(state.dungeonMap).find(l=>l.id===destination.floorId)
      if(!level||!isGridPosition(destination,level.width,level.height))throw new DomainError('INVALID','Transition destination is unavailable.')
      if(state.combatants.some(other=>other!==c&&combatantFloorId(state,other)===destination.floorId&&state.battleMap.tokens[String(other.id)]?.x===destination.x&&state.battleMap.tokens[String(other.id)]?.z===destination.z)&&!command.allowOccupied)throw new DomainError('INVALID','Destination is occupied. Confirm stacking to continue.')
      return {...update({floorId:destination.floorId,...(c!.unplaced?{unplaced:false}:{})}),battleMap:{...state.battleMap,tokens:{...state.battleMap.tokens,[String(c!.id)]:{x:destination.x,z:destination.z}}}}
    }
    case 'combatant.floor.transfer': {
      const level=state.dungeonMap&&dungeonLevels(state.dungeonMap).find(l=>l.id===command.floorId)
      if(!level||!isGridPosition(command.destination,level.width,level.height))throw new DomainError('INVALID','Choose a destination inside an existing level.')
      return {...update({floorId:level.id,...(c!.unplaced?{unplaced:false}:{})}),battleMap:{...state.battleMap,tokens:{...state.battleMap.tokens,[String(c!.id)]:command.destination}}}
    }
    case 'token.move':
      if (!isGridPosition(command.destination, ...combatantBounds(state,c!))) throw new DomainError('INVALID', 'Destination is outside the battlefield.')
      return { ...update(c!.unplaced?{unplaced:false}:{}), battleMap: {...state.battleMap,tokens:{...state.battleMap.tokens,[String(command.combatantId)]:command.destination}} }
    case 'combatant.miniature.update': return update({ miniature: command.miniature })
    case 'token.assign': return update({ ownerId: command.playerId })
    case 'combatant.hp.update': return update({ hp: Math.min(command.hp, c!.maxHp) })
    case 'combatant.conditions': return update({ conditions: command.conditions })
    case 'combatant.hp.visibility': return update({ hpShown: command.shown })
    case 'combatant.visibility': return update({ visible: command.visible })
    case 'combatant.edit': {
      if (String(command.combatant.id) !== String(c!.id)) throw new DomainError('INVALID', 'Combatant identity cannot change.')
      return { ...update({ ...command.combatant, id: c!.id, ownerId: c!.ownerId, floorId:c!.floorId }), combatants: update({ ...command.combatant, id: c!.id, ownerId: c!.ownerId, floorId:c!.floorId }).combatants.sort((a, b) => b.initiative - a.initiative) }
    }
    case 'combatant.add': {
      if(!command.allowPersistentDuplicate){
        const seen=new Set(state.combatants.filter(c=>c.persistentIdentity).map(c=>c.sourceLibraryId))
        for(const item of command.combatants)if(item.persistentIdentity&&item.sourceLibraryId){if(seen.has(item.sourceLibraryId))throw new DomainError('CONFLICT','This character is already in the encounter. Enable the duplicate override.');seen.add(item.sourceLibraryId)}
      }
      const combatants = [...state.combatants, ...command.combatants.map(c => ({ ...c, floorId:command.floorId??c.floorId??primaryLevelId(state.dungeonMap), ownerId: null }))].sort((a, b) => b.initiative - a.initiative)
      if (combatants.length > 100 || new Set(combatants.map(c => String(c.id))).size !== combatants.length) throw new DomainError('INVALID', 'Too many or duplicate combatants.')
      return reconcileLevelTokens({ ...state, combatants, battleMap:reconcileBattleMap(state.battleMap,combatants.map(c=>c.id)), activeId: state.activeId ?? combatants[0]?.id ?? null })
    }
    case 'combatant.remove': {
      const combatants = state.combatants.filter(item => item !== c)
      return { ...state, combatants, activeId: state.activeId === c!.id ? combatants[0]?.id ?? null : state.activeId,
        selectedId: state.selectedId === c!.id ? null : state.selectedId,
        usedAbilities: Object.fromEntries(Object.entries(state.usedAbilities).filter(([key]) => !key.startsWith(`${c!.id}:`))),
        battleMap: reconcileBattleMap(state.battleMap, combatants.map(c => c.id)) }
    }
    case 'ability.toggle':
      if (!command.key.startsWith(`${c!.id}:`)) throw new DomainError('INVALID', 'Invalid ability key.')
      return { ...state, usedAbilities: { ...state.usedAbilities, [command.key]: !state.usedAbilities[command.key] } }
    case 'initiative.next': {
      if (!state.combatants.length) return state
      const next = (state.combatants.findIndex(c => c.id === state.activeId) + 1) % state.combatants.length
      return { ...state, activeId: state.combatants[next].id, round: state.round + (next === 0 ? 1 : 0) }
    }
    case 'map.settings':
      if (state.dungeonMap && ((command.width && command.width !== state.dungeonMap.width) || (command.height && command.height !== state.dungeonMap.height))) throw new DomainError('INVALID', 'Use the dungeon builder to replace map dimensions.')
      return { ...state, battleMap: reconcileBattleMap({ ...state.battleMap, showGrid: command.showGrid, showLabels: command.showLabels, gridSizeFeet:command.gridSizeFeet??state.battleMap.gridSizeFeet, width: command.width ?? state.battleMap.width, height: command.height ?? state.battleMap.height }, state.combatants.map(c => c.id)) }
    case 'encounter.clear': return emptyEncounter()
    case 'encounter.restore': return importEncounter(command.file)
  }
}
export const isMapEdit = (command: GameCommand): command is MapCommand => mapCommandSchemas.some(s => s.shape.type.value === command.type)
export function applyMapEdit(state: EncounterState, actor: Actor, command: MapCommand, history: MapHistory) {
  if (actor.role !== 'dm') throw new DomainError('FORBIDDEN', 'Only the DM may edit maps.')
  try {
    if (!state.dungeonMap?.level && command.type === 'map.floorImage.set' && Object.values(state.battleMap.tokens).some(p => p.x >= command.width || p.z >= command.height)) throw new Error('Resize would move combatants outside the map. Move them inside the new bounds first.')
    const result = editMap({ document: state.dungeonMap ?? null, width: state.battleMap.width, height: state.battleMap.height }, history, command)
    if (!state.dungeonMap?.level && (command.type === 'map.undo' || command.type === 'map.redo') && (state.dungeonMap?.floorImage || result.frame.document?.floorImage) && Object.values(state.battleMap.tokens).some(p => p.x >= result.frame.width || p.z >= result.frame.height)) throw new Error('Undo/redo would move combatants outside the map. Move them inside the restored bounds first.')
    let next: EncounterState = { ...state, tactical:state.tactical?.map(r=>({...r,floorId:r.floorId??primaryLevelId(state.dungeonMap)})), combatants:state.combatants.map(c=>({...c,floorId:c.floorId??primaryLevelId(state.dungeonMap)})), dungeonMap: result.frame.document ?? undefined,
      battleMap: reconcileBattleMap({ ...state.battleMap, width: result.frame.width, height: result.frame.height }, state.combatants.map(c => c.id)),
      mapUndoDepth: result.history.undo.length, mapRedoDepth: result.history.redo.length }
    const nextLevels=next.dungeonMap?dungeonLevels(next.dungeonMap):[]
    const replacing=command.type==='map.load'||command.type==='map.blank'
    if(replacing)next={...next,combatants:next.combatants.map(c=>nextLevels.some(l=>l.id===(c.floorId??primaryLevelId(state.dungeonMap)))?c:{...c,floorId:primaryLevelId(next.dungeonMap)})}
    if(!replacing&&next.dungeonMap){
      for(const c of next.combatants){
        const id=c.floorId??primaryLevelId(state.dungeonMap),level=nextLevels.find(l=>l.id===id),p=state.battleMap.tokens[String(c.id)]
        if(!level)throw new Error('Move combatants off this level before removing it or undoing its creation.')
        if(p&&!isGridPosition(p,level.width,level.height))throw new Error('Move combatants inside the new level bounds before resizing or undoing.')
      }
    }
    next=reconcileLevelTokens({...next,battleMap:{...next.battleMap,tokens:state.battleMap.tokens}})
    return { state: next, history: result.history }
  } catch (error) { throw new DomainError('INVALID', error instanceof Error ? error.message : 'Invalid map edit.') }
}
// Explicit allowlists: never send opaque stored objects to players.
export function projectEncounter(state: EncounterState, actor: Actor): EncounterState {
  if (actor.role === 'dm') return state
  const combatants = state.combatants.filter(c => c.visible&&combatantLevelVisible(state,c)).map(c => {
    const publicData = { floorId:c.floorId??primaryLevelId(state.dungeonMap), id: c.id, name: c.name, short: c.short, side: c.side, initiative: c.initiative,
      miniature: c.miniature, miniatureStatus: c.miniatureStatus, unplaced:c.unplaced,
      ownerId: c.ownerId, visible: true, hpShown: c.hpShown === true, hp: c.hpShown === true ? c.hp : 0, maxHp: c.hpShown === true ? c.maxHp : 1, ac: 0, role: '', speed: '', conditions: c.conditions,
      saves: [], actions: [], privateNotes: '' }
    if (c.ownerId !== actor.id) return publicData as Combatant
    return { ...publicData, hp: c.hp, maxHp: c.maxHp, ac: c.ac, role: c.role, speed: c.speed,
      saves: c.saves, actions: c.actions, details: c.details, artwork: c.artwork } as Combatant
  })
  const ids = new Set(combatants.map(c => String(c.id)))
  const owned = combatants.filter(c => c.ownerId === actor.id)
  const dungeonMap=playerDungeon(state.dungeonMap)
  const levels=dungeonMap?dungeonLevels(dungeonMap):[]
  return { ...state, levelsHidden:Boolean(state.dungeonMap&&!dungeonMap), tactical:state.tactical?.filter(r=>levelVisible(state,r.floorId)).map(r=>({...r,floorId:r.floorId??primaryLevelId(state.dungeonMap)})), dungeonMap, mapUndoDepth: undefined, mapRedoDepth: undefined, combatants, selectedId: null, activeId: ids.has(String(state.activeId)) ? state.activeId : null,
    usedAbilities: Object.fromEntries(Object.entries(state.usedAbilities).filter(([key]) => owned.some(c => key.startsWith(`${c.id}:`)))),
    battleMap: { ...state.battleMap, ...(state.dungeonMap?{width:Math.max(4,...levels.map(l=>l.width)),height:Math.max(4,...levels.map(l=>l.height))}:{}), tokens: Object.fromEntries(Object.entries(state.battleMap.tokens).filter(([id]) => ids.has(id))) } }
}
export interface Snapshot { mapDocumentOmitted?: boolean; campaignId: string; encounterId: string; name: string; revision: number; sessionActive: boolean; state: EncounterState; actor: Actor }
// Retain the same document reference for combat-only updates. Missing patches require a full join snapshot.
export function mergeMapSnapshot(previous: Snapshot | null, next: Snapshot): Snapshot | null {
  if (!next.mapDocumentOmitted) return next.state.dungeonMap&&previous?.encounterId===next.encounterId?{...next,state:{...next.state,dungeonMap:reuseDungeonGeometry(previous.state.dungeonMap,next.state.dungeonMap)}}:next
  if (!previous || previous.encounterId !== next.encounterId || previous.state.mapRevision !== next.state.mapRevision || !previous.state.dungeonMap) return null
  return { ...next, mapDocumentOmitted: false, state: { ...next.state, dungeonMap: previous.state.dungeonMap } }
}
// Monotonic across encounters and session activation; inactive players receive no state.
export interface SessionState {
  campaignId: string; revision: number; sessionActive: boolean; encounterId: string | null; snapshot: Snapshot | null
}
export function acceptsSessionState(previous: SessionState | null, next: SessionState, campaignId: string): boolean {
  return next.campaignId === campaignId && (!previous || previous.campaignId !== campaignId || next.revision >= previous.revision)
}
export interface Member { id: string; displayName: string; connected: boolean }
export type CommandResult = { ok: true; revision: number; duplicate: boolean } | { ok: false; error: { code: string; message: string } }
export interface ServerEvents {
  'session.state': (state: SessionState) => void
  'encounter.snapshot': (snapshot: Snapshot) => void
  'presence.changed': (members: Member[]) => void
  'session.ended': () => void
  'access.revoked': () => void
}
export interface ClientEvents {
  'campaign.join': (campaignId: string, ack: (result: CommandResult) => void) => void
  'game.command': (data: CommandEnvelope, ack: (result: CommandResult) => void) => void
}

export const durableEncounter=(state:EncounterState):EncounterState=>state.tactical?{...state,tactical:state.tactical.filter(r=>r.kind==='template')}:state

export const combatantFloorId=(state:EncounterState,c:Pick<Combatant,'floorId'>)=>c.floorId??primaryLevelId(state.dungeonMap)
export const levelVisible=(state:EncounterState,id?:string)=>!state.dungeonMap||dungeonLevels(state.dungeonMap).some(l=>l.id===(id??primaryLevelId(state.dungeonMap))&&l.playerVisible)
export const combatantLevelVisible=(state:EncounterState,c:Combatant)=>levelVisible(state,c.floorId)
function combatantBounds(state:EncounterState,c:Combatant):[number,number]{
  const level=state.dungeonMap&&dungeonLevels(state.dungeonMap).find(l=>l.id===combatantFloorId(state,c))
  return level?[level.width,level.height]:[state.battleMap.width,state.battleMap.height]
}
export function reconcileLevelTokens(state:EncounterState):EncounterState{
  if(!state.dungeonMap)return state
  const levels=dungeonLevels(state.dungeonMap),tokens:EncounterState['battleMap']['tokens']={}
  for(const level of levels){
    const ids=state.combatants.filter(c=>combatantFloorId(state,c)===level.id).map(c=>c.id)
    Object.assign(tokens,reconcileBattleMap({...state.battleMap,width:level.width,height:level.height},ids).tokens)
  }
  if(state.combatants.some(c=>!levels.some(l=>l.id===combatantFloorId(state,c))))throw new DomainError('INVALID','Combatant references an unknown level.')
  return {...state,battleMap:{...state.battleMap,width:Math.max(...levels.map(l=>l.width)),height:Math.max(...levels.map(l=>l.height)),tokens}}
}
export function playerDungeon(map?:DungeonMap):DungeonMap|undefined{
  if(!map)return undefined
  const levels=dungeonLevels(map).filter(l=>l.playerVisible).map(l=>({...l,props:l.props.filter(p=>!isScenery(p)||p.visible)}))
  if(!levels.length)return undefined
  // Legacy maps retain their public wire format; multi-level maps expose visible levels only.
  if(!map.level)return {...map,props:levels[0].props}
  const visible=new Set(levels.map(l=>l.id))
  const transitions=map.transitions?.filter(t=>visible.has(t.source.floorId)&&visible.has(t.destination.floorId)).map(t=>{const {dmNotes,...publicTransition}=t;void dmNotes;return publicTransition})
  return composeLevels({...map,...(transitions?{transitions}:{})},levels)
}
