import { z } from 'zod'
import { combatantSchema, DomainError, type Combatant, type EncounterState } from './domain.ts'
export const libraryKinds = ['player-character', 'named-npc', 'monster-template'] as const
export const libraryWriteSchema = z.object({
  name: z.string().trim().min(1).max(200), kind: z.enum(libraryKinds),
  campaignId: z.uuid().nullable(), notes: z.string().max(10000).default(''),
  definition: combatantSchema,
}).strict()
export const characterStateSchema = z.object({hp:z.number().int().min(0).max(100000),maxHp:z.number().int().min(1).max(100000),conditions:z.array(z.string().max(100)).max(50)}).strict().refine(s=>s.hp<=s.maxHp,'HP exceeds maximum')
export type CharacterState = z.infer<typeof characterStateSchema>
export interface LibraryEntry extends z.infer<typeof libraryWriteSchema> {
  id:string; owner_id:string; revision:number; archived:boolean; created_at:string; updated_at:string
}
// Keep the complete supported/imported stat block, but never inherit encounter identity or permissions.
export function libraryDefinition(input: unknown): Combatant {
  const c=combatantSchema.parse(input)
  for(const key of ['sourceLibraryId','persistentIdentity','campaignStateRevision','floorId','unplaced','miniatureStatus','position','ownerId'])delete c[key]
  return combatantSchema.parse({...c,id:'definition',initiative:0,hp:c.maxHp,conditions:[],ownerId:null})
}
export function instantiateLibrary(entry:LibraryEntry,id:string,state:EncounterState,saved:CharacterState|undefined,allowDuplicate=false):Combatant {
  const persistent=entry.kind!=='monster-template'
  if(persistent&&!allowDuplicate&&state.combatants.some(c=>c.sourceLibraryId===entry.id))throw new DomainError('CONFLICT','This character is already in the encounter. Enable the duplicate override to add another.')
  return combatantSchema.parse({...structuredClone(entry.definition),...(persistent&&saved?characterStateSchema.parse(saved):{}),id,name:entry.name,sourceLibraryId:entry.id,persistentIdentity:persistent,ownerId:null,initiative:0})
}
