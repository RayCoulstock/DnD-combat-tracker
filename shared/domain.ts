import { z } from 'zod'
import { createBattleMapState, isGridPosition, moveToken, normalizeBattleMap, reconcileBattleMap } from '../src/mapState.ts'

export const idSchema = z.union([z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/), z.number().int().safe().nonnegative()]).refine(v => !['__proto__', 'constructor', 'prototype'].includes(String(v)))
const text = z.string().max(10000)
export const combatantSchema = z.object({
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
  version: z.literal(1), round: z.number().int().min(1).max(1000000),
  activeId: idSchema.nullable().optional(), selectedId: idSchema.nullable().optional(),
  usedAbilities: z.record(z.string().max(400), z.boolean()).default({}),
  combatants: z.array(combatantSchema).max(100), battleMap: z.unknown().optional(),
}).refine(s => new Set(s.combatants.map(c => String(c.id))).size === s.combatants.length, 'Duplicate combatant IDs')
export interface EncounterState {
  version: 1; round: number; activeId: string | number | null; selectedId: string | number | null
  usedAbilities: Record<string, boolean>; combatants: Combatant[]; battleMap: ReturnType<typeof createBattleMapState>
}
export interface Actor { role: 'dm' | 'player'; id: string }
export function importEncounter(value: unknown, preservePermissions = false): EncounterState {
  const data = encounterFileSchema.parse(value)
  const combatants = data.combatants.map(c => preservePermissions ? c : { ...c, ownerId: null })
  const ids = new Set(combatants.map(c => c.id))
  return { version: 1, round: data.round, activeId: ids.has(data.activeId!) ? data.activeId! : combatants[0]?.id ?? null,
    selectedId: ids.has(data.selectedId!) ? data.selectedId! : combatants[0]?.id ?? null,
    usedAbilities: data.usedAbilities, combatants, battleMap: normalizeBattleMap(data.battleMap, combatants.map(c => c.id)) }
}
export const emptyEncounter = (): EncounterState => importEncounter({ version: 1, round: 1, combatants: [] })
const target = { combatantId: idSchema }
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token.move'), ...target, destination: z.object({ x: z.number().int(), z: z.number().int() }).strict() }).strict(),
  z.object({ type: z.literal('token.assign'), ...target, playerId: z.uuid().nullable() }).strict(),
  z.object({ type: z.literal('combatant.hp.update'), ...target, hp: z.number().int().min(0).max(100000) }).strict(),
  z.object({ type: z.literal('combatant.conditions'), ...target, conditions: z.array(z.string().max(100)).max(50) }).strict(),
  z.object({ type: z.literal('combatant.visibility'), ...target, visible: z.boolean() }).strict(),
  z.object({ type: z.literal('combatant.add'), combatants: z.array(combatantSchema).min(1).max(20) }).strict(),
  z.object({ type: z.literal('combatant.edit'), ...target, combatant: combatantSchema }).strict(),
  z.object({ type: z.literal('combatant.remove'), ...target }).strict(),
  z.object({ type: z.literal('ability.toggle'), ...target, key: z.string().max(400) }).strict(),
  z.object({ type: z.literal('initiative.next') }).strict(),
  z.object({ type: z.literal('map.settings'), showGrid: z.boolean(), showLabels: z.boolean(), width: z.number().int().min(1).max(100).optional(), height: z.number().int().min(1).max(100).optional() }).strict(),
  z.object({ type: z.literal('encounter.clear') }).strict(),
  z.object({ type: z.literal('encounter.restore'), file: encounterFileSchema }).strict(),
])
export type GameCommand = z.infer<typeof commandSchema>
export const envelopeSchema = z.object({ commandId: z.uuid(), encounterId: z.uuid(), revision: z.number().int().nonnegative(), command: commandSchema }).strict()
export type CommandEnvelope = z.infer<typeof envelopeSchema>
export class DomainError extends Error {
  constructor(public code: 'FORBIDDEN' | 'INVALID' | 'CONFLICT' | 'NOT_FOUND' | 'UNAUTHENTICATED' | 'SESSION_ENDED', message: string) { super(message) }
}
export function applyCommand(state: EncounterState, actor: Actor, command: GameCommand): EncounterState {
  const c = 'combatantId' in command ? state.combatants.find(c => String(c.id) === String(command.combatantId)) : undefined
  if (actor.role !== 'dm' && (command.type !== 'token.move' || !c?.visible || c.ownerId !== actor.id)) throw new DomainError('FORBIDDEN', 'This action is not permitted.')
  if ('combatantId' in command && !c) throw new DomainError('NOT_FOUND', 'Combatant not found.')
  const update = (patch: Partial<Combatant>) => ({ ...state, combatants: state.combatants.map(item => item === c ? { ...item, ...patch } : item) })
  switch (command.type) {
    case 'token.move':
      if (!isGridPosition(command.destination, state.battleMap.width, state.battleMap.height)) throw new DomainError('INVALID', 'Destination is outside the battlefield.')
      return { ...state, battleMap: moveToken(state.battleMap, command.combatantId, command.destination) }
    case 'token.assign': return update({ ownerId: command.playerId })
    case 'combatant.hp.update': return update({ hp: Math.min(command.hp, c!.maxHp) })
    case 'combatant.conditions': return update({ conditions: command.conditions })
    case 'combatant.visibility': return update({ visible: command.visible })
    case 'combatant.edit': {
      if (String(command.combatant.id) !== String(c!.id)) throw new DomainError('INVALID', 'Combatant identity cannot change.')
      return { ...update({ ...command.combatant, id: c!.id, ownerId: c!.ownerId }), combatants: update({ ...command.combatant, id: c!.id, ownerId: c!.ownerId }).combatants.sort((a, b) => b.initiative - a.initiative) }
    }
    case 'combatant.add': {
      const combatants = [...state.combatants, ...command.combatants.map(c => ({ ...c, ownerId: null }))].sort((a, b) => b.initiative - a.initiative)
      if (combatants.length > 100 || new Set(combatants.map(c => String(c.id))).size !== combatants.length) throw new DomainError('INVALID', 'Too many or duplicate combatants.')
      return { ...state, combatants, activeId: state.activeId ?? combatants[0]?.id ?? null, battleMap: reconcileBattleMap(state.battleMap, combatants.map(c => c.id)) }
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
    case 'map.settings': return { ...state, battleMap: reconcileBattleMap({ ...state.battleMap, showGrid: command.showGrid, showLabels: command.showLabels, width: command.width ?? state.battleMap.width, height: command.height ?? state.battleMap.height }, state.combatants.map(c => c.id)) }
    case 'encounter.clear': return emptyEncounter()
    case 'encounter.restore': return importEncounter(command.file)
  }
}
// Explicit allowlists: never send opaque stored objects to players.
export function projectEncounter(state: EncounterState, actor: Actor): EncounterState {
  if (actor.role === 'dm') return state
  const combatants = state.combatants.filter(c => c.visible).map(c => {
    const publicData = { id: c.id, name: c.name, short: c.short, side: c.side, initiative: c.initiative,
      ownerId: c.ownerId, visible: true, hp: 0, maxHp: 1, ac: 0, role: '', speed: '', conditions: c.conditions,
      saves: [], actions: [], privateNotes: '' }
    if (c.ownerId !== actor.id) return publicData as Combatant
    return { ...publicData, hp: c.hp, maxHp: c.maxHp, ac: c.ac, role: c.role, speed: c.speed,
      saves: c.saves, actions: c.actions, details: c.details, artwork: c.artwork } as Combatant
  })
  const ids = new Set(combatants.map(c => String(c.id)))
  const owned = combatants.filter(c => c.ownerId === actor.id)
  return { ...state, combatants, selectedId: null, activeId: ids.has(String(state.activeId)) ? state.activeId : null,
    usedAbilities: Object.fromEntries(Object.entries(state.usedAbilities).filter(([key]) => owned.some(c => key.startsWith(`${c.id}:`)))),
    battleMap: { ...state.battleMap, tokens: Object.fromEntries(Object.entries(state.battleMap.tokens).filter(([id]) => ids.has(id))) } }
}
export interface Snapshot { campaignId: string; encounterId: string; name: string; revision: number; sessionActive: boolean; state: EncounterState; actor: Actor }
export interface Member { id: string; displayName: string; connected: boolean }
export type CommandResult = { ok: true; revision: number; duplicate: boolean } | { ok: false; error: { code: string; message: string } }
export interface ServerEvents {
  'encounter.snapshot': (snapshot: Snapshot) => void
  'presence.changed': (members: Member[]) => void
  'session.ended': () => void
  'access.revoked': () => void
}
export interface ClientEvents {
  'campaign.join': (campaignId: string, ack: (result: CommandResult) => void) => void
  'game.command': (data: CommandEnvelope, ack: (result: CommandResult) => void) => void
}
