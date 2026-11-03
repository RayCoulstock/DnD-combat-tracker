import test from 'node:test'
import assert from 'node:assert/strict'
import {applyCommand,commandSchema,importEncounter,projectEncounter,type EncounterState,type GameCommand} from './domain.ts'
import {miniatureSchema} from './miniatures.ts'
import {instantiateLibrary,libraryDefinition,type LibraryEntry} from './combatantLibrary.ts'
const dm={role:'dm' as const,id:'dm'},player={role:'player' as const,id:'player'}
const fixture=()=>importEncounter({version:1,round:4,activeId:'a',combatants:[['a',20],['b',15],['c',10]].map(([id,initiative])=>({id,name:id,short:id,initiative,side:'enemy',hp:8,maxHp:12,ac:14,conditions:['Prone'],saves:[],actions:[],privateNotes:'secret'}))})
const act=(s:EncounterState,c:GameCommand)=>applyCommand(s,dm,c)
const ids=(s:EncounterState)=>s.combatants.map(c=>c.id)
const next=(s:EncounterState)=>act(s,{type:'initiative.next'})
test('legacy defaults, descending automatic order, zero/negative initiative and stable ties',()=>{
 let s=fixture();assert.equal(s.turnOrder,undefined)
 for(const initiative of [21,0,-8]){s=act(s,{type:'combatant.controls',combatantId:'b',initiative});assert.equal(s.combatants.find(c=>c.id==='b')!.initiative,initiative);assert.equal(s.activeId,'a');assert.equal(s.round,4)}
 s=act(s,{type:'combatant.controls',combatantId:'c',initiative:20});assert.deepEqual(ids(s),['a','c','b'])
 s=act(s,{type:'combatant.hp.update',combatantId:'a',hp:3});s=act(s,{type:'combatant.controls',combatantId:'b',side:'neutral'});assert.deepEqual(ids(s),['a','c','b'])
 assert.equal(importEncounter({...fixture(),combatants:fixture().combatants.map(c=>({...c,initiative:1.5}))}).combatants[0].initiative,1.5)
})
test('committed edits reject empty, noninteger, infinite, oversized and contradictory command input',()=>{
 for(const initiative of ['',null,1.5,NaN,Infinity,1001,-1001])assert.equal(commandSchema.safeParse({type:'combatant.controls',combatantId:'a',initiative}).success,false)
 assert.equal(commandSchema.safeParse({type:'combatant.controls',combatantId:'a'}).success,false)
 assert.throws(()=>act(fixture(),{type:'combatant.edit',combatantId:'a',combatant:{...fixture().combatants[0],initiative:1.5}}))
})
test('manual moves preserve initiative, active ID and round; saved order survives auto mode and JSON roundtrip',()=>{
 let s=act(fixture(),{type:'initiative.mode',mode:'manual'});assert.deepEqual(ids(s),['a','b','c'])
 s=act(s,{type:'initiative.move',combatantId:'c',direction:'up'});s=act(s,{type:'initiative.move',combatantId:'c',direction:'up'});assert.deepEqual(ids(s),['c','a','b']);assert.equal(s.activeId,'a');assert.equal(s.round,4)
 s=act(s,{type:'combatant.controls',combatantId:'b',initiative:99});assert.deepEqual(ids(s),['c','a','b'])
 s=act(s,{type:'initiative.mode',mode:'initiative'});assert.deepEqual(ids(s),['b','a','c']);s=importEncounter(JSON.parse(JSON.stringify(s)),true)
 s=act(s,{type:'initiative.mode',mode:'manual'});assert.deepEqual(ids(s),['c','a','b']);assert.equal(s.combatants.find(c=>c.id==='b')!.initiative,99)
 assert.throws(()=>act(s,{type:'initiative.move',combatantId:'c',direction:'up'}))
 assert.throws(()=>act(fixture(),{type:'initiative.move',combatantId:'b',direction:'up'}))
})
test('normal progression and inferred legacy prefix retain original round wrapping',()=>{
 let s=fixture();s=next(s);assert.equal(s.activeId,'b');s=next(s);assert.equal(s.activeId,'c');s=next(s);assert.equal(s.activeId,'a');assert.equal(s.round,5)
 s={...fixture(),activeId:'c'};s=next(s);assert.equal(s.activeId,'a');assert.equal(s.round,5)
 assert.equal(next(importEncounter({version:1,round:3,combatants:[]})).round,3)
})
test('reorder active and pending entries midround without repeats or skips',()=>{
 let s=next(act(fixture(),{type:'initiative.mode',mode:'manual'}));assert.equal(s.activeId,'b')
 s=act(s,{type:'initiative.move',combatantId:'c',direction:'up'});s=act(s,{type:'initiative.move',combatantId:'c',direction:'up'});assert.equal(s.activeId,'b');assert.deepEqual(ids(s),['c','a','b'])
 s=next(s);assert.equal(s.activeId,'c');assert.equal(s.round,4);s=next(s);assert.equal(s.activeId,'c');assert.equal(s.round,5);assert.deepEqual(s.turnOrder!.completedIds,[])
})
test('automatic initiative change during combat never repeats a completed turn',()=>{
 let s=next(fixture());s=act(s,{type:'combatant.controls',combatantId:'a',initiative:-9});s=act(s,{type:'combatant.controls',combatantId:'c',initiative:99});assert.equal(s.activeId,'b')
 s=next(s);assert.equal(s.activeId,'c');assert.equal(s.round,4);s=next(s);assert.equal(s.round,5);assert.equal(s.activeId,'c')
})
test('new entries before active stay pending and saved manual order appends additions',()=>{
 let s=next(act(fixture(),{type:'initiative.mode',mode:'manual'}));s=act(s,{type:'initiative.mode',mode:'initiative'})
 s=act(s,{type:'combatant.add',combatants:[{...fixture().combatants[0],id:'d',initiative:50}],allowPersistentDuplicate:false});assert.equal(s.activeId,'b')
 s=next(s);assert.equal(s.activeId,'c');s=next(s);assert.equal(s.activeId,'d');assert.equal(s.round,4);s=next(s);assert.equal(s.round,5)
 s=act(s,{type:'initiative.mode',mode:'manual'});assert.deepEqual(ids(s),['a','b','c','d'])
})
test('removal handles current, pending, completed and last combatants deterministically',()=>{
 let s=next(fixture());s=act(s,{type:'combatant.remove',combatantId:'a'});assert.equal(s.activeId,'b');assert.equal(s.round,4)
 s=act(s,{type:'combatant.remove',combatantId:'b'});assert.equal(s.activeId,'c');assert.equal(s.round,4);s=act(s,{type:'combatant.remove',combatantId:'c'});assert.equal(s.activeId,null);assert.equal(s.round,4)
 s=next(next(fixture()));s=act(s,{type:'combatant.remove',combatantId:'c'});assert.equal(s.activeId,'a');assert.equal(s.round,5)
})
test('allegiance cycles never alter other data or the source library definition',()=>{
 const definition=libraryDefinition({...fixture().combatants[0],side:'neutral'}),entry={id:'11111111-1111-4111-8111-111111111111',kind:'monster-template',name:'Friendly monster',definition} as LibraryEntry
 let s=fixture();const original={...instantiateLibrary(entry,'d',s,undefined),miniature:miniatureSchema.parse({assetId:'22222222-2222-4222-8222-222222222222',scale:1.5,rotation:45})};assert.equal(original.side,'neutral');s=act(s,{type:'combatant.add',combatants:[original],allowPersistentDuplicate:false})
 s=act(s,{type:'token.assign',combatantId:'d',playerId:'33333333-3333-4333-8333-333333333333'})
 for(const side of ['hero','enemy','neutral','hero'] as const){s=act(s,{type:'combatant.controls',combatantId:'d',side});const updated=s.combatants.find(c=>c.id==='d')!;assert.deepEqual({...updated,side:original.side}, {...original,ownerId:'33333333-3333-4333-8333-333333333333',floorId:'ground'});assert.equal(entry.definition.side,'neutral')}
})
test('all control commands are DM-only; projected order metadata contains no hidden IDs',()=>{
 let s=act(fixture(),{type:'initiative.mode',mode:'manual'});s=next(s);s.combatants[0].visible=false
 for(const c of [{type:'combatant.controls',combatantId:'b',initiative:25},{type:'combatant.controls',combatantId:'b',side:'neutral'},{type:'initiative.mode',mode:'initiative'},{type:'initiative.move',combatantId:'b',direction:'up'}] as GameCommand[])assert.throws(()=>applyCommand(s,player,c),{code:'FORBIDDEN'})
 const projected=projectEncounter(s,player);assert.deepEqual(projected.combatants.map(c=>c.id),['b','c']);assert.deepEqual(projected.turnOrder!.manualIds,['b','c']);assert.deepEqual(projected.turnOrder!.completedIds,[]);assert.equal(projected.activeId,'b')
})
