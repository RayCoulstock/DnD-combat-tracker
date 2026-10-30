import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { libraryDefinition, instantiateLibrary, characterStateSchema, type LibraryEntry } from './combatantLibrary.ts'
import { emptyEncounter, applyCommand, projectEncounter, importEncounter } from './domain.ts'
import { miniatureSchema } from './miniatures.ts'
import { parseStatBlock } from './statBlock.js'
const dm={id:randomUUID(),role:'dm'} as const
const stats={id:'legacy',name:'Hero',side:'hero',initiative:14,hp:4,maxHp:20,ac:15,conditions:['Poisoned'],saves:[],actions:[],spellSlots:{level1:3},privateNotes:'DM only'}
const entry=():LibraryEntry=>({id:randomUUID(),owner_id:dm.id,name:'Hero',kind:'player-character',campaignId:null,notes:'secret',revision:1,archived:false,created_at:'',updated_at:'',definition:libraryDefinition(stats)})
test('existing player and monster text parsing is shared without losing supported/imported fields',()=>{
  for(const [side,kind] of [['hero','player-character'],['enemy','monster-template']] as const){
    const definition=libraryDefinition(parseStatBlock('Aria\nMedium humanoid AC 15 HP 22 Speed 30 ft STR 12 DEX 14 Actions Sword. Hit: 5 damage.','',side))
    assert.equal(definition.side,side);assert.equal(definition.maxHp,22);assert.equal(definition.actions[0].name,'Sword');assert.ok(kind)
  }
  const definition=libraryDefinition(stats);assert.deepEqual(definition.spellSlots,{level1:3});assert.equal(definition.initiative,0);assert.equal(definition.hp,20);assert.deepEqual(definition.conditions,[])
})
test('monster instances and model defaults are independent snapshots',()=>{
  const e={...entry(),kind:'monster-template' as const};e.definition.miniature=miniatureSchema.parse({assetId:randomUUID(),scale:2,rotation:90,verticalOffset:.4})
  const a=instantiateLibrary(e,randomUUID(),emptyEncounter(),undefined),b=instantiateLibrary(e,randomUUID(),emptyEncounter(),undefined)
  let state=applyCommand(emptyEncounter(),dm,{type:'combatant.add',combatants:[a,b],allowPersistentDuplicate:false})
  state=applyCommand(state,dm,{type:'combatant.hp.update',combatantId:a.id,hp:2})
  assert.equal(state.combatants.find(c=>c.id===b.id)!.hp,20);assert.equal(e.definition.hp,20)
  a.miniature!.scale=3;assert.equal(e.definition.miniature!.scale,2);assert.equal(b.miniature!.scale,2)
  e.definition.ac=99;assert.equal(b.ac,15)
})
test('persistent identity can join multiple encounters; duplicate override is explicit',()=>{
  const e=entry(),saved={hp:7,maxHp:23,conditions:['Poisoned']}
  const a=instantiateLibrary(e,randomUUID(),emptyEncounter(),saved),b=instantiateLibrary(e,randomUUID(),emptyEncounter(),saved)
  assert.notEqual(a.id,b.id);assert.equal(a.sourceLibraryId,b.sourceLibraryId);assert.equal(a.hp,7)
  const state=applyCommand(emptyEncounter(),dm,{type:'combatant.add',combatants:[a],allowPersistentDuplicate:false})
  assert.throws(()=>instantiateLibrary(e,randomUUID(),state,saved),/already/)
  assert.ok(instantiateLibrary(e,randomUUID(),state,saved,true));assert.equal(instantiateLibrary(e,randomUUID(),emptyEncounter(),undefined).hp,20)
  applyCommand(state,dm,{type:'combatant.hp.update',combatantId:a.id,hp:1});assert.equal(saved.hp,7)
  assert.throws(()=>characterStateSchema.parse({...saved,floorId:'secret'}))
})
test('legacy encounter records remain readable; source identity and private notes never enter player projection',()=>{
  const old=importEncounter({version:1,round:1,combatants:[stats]});assert.equal(old.combatants.length,1)
  const c=instantiateLibrary(entry(),randomUUID(),emptyEncounter(),undefined)
  const state=applyCommand(emptyEncounter(),dm,{type:'combatant.add',combatants:[c,{...c,id:randomUUID(),visible:false}],allowPersistentDuplicate:true})
  const publicState=projectEncounter(state,{role:'player',id:randomUUID()})
  assert.equal(publicState.combatants.length,1);assert.equal(publicState.combatants[0].sourceLibraryId,undefined);assert.equal(publicState.combatants[0].privateNotes,'')
})
