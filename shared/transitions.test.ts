import test from 'node:test'
import assert from 'node:assert/strict'
import {blankDungeon,editMap,emptyHistory,readDungeon,dungeonLevels,type MapCommand} from './dungeon.ts'
import {applyCommand,applyMapEdit,importEncounter,projectEncounter,type EncounterState} from './domain.ts'
import {transitionSchema,transitionTypes,transitionRoute,type FloorTransition} from './transitions.ts'
const dm={id:'dm',role:'dm' as const},player={id:'player',role:'player' as const}
function initial(){let state=importEncounter({version:1,round:3,combatants:[{id:1,name:'Hero',initiative:19,hp:7,maxHp:10,ac:15,side:'hero',conditions:['Poisoned'],saves:[],actions:[]}],dungeonMap:blankDungeon('warehouse','Warehouse',12,10),battleMap:{width:12,height:10,tokens:{'1':{x:2,z:3}}}});state=applyCommand(state,dm,{type:'map.level.add',id:'office',name:'Office',elevationFeet:15,width:20,height:20});return state}
const transition=(type:FloorTransition['type']='stairs'):FloorTransition=>transitionSchema.parse({id:type,type,source:{floorId:'ground',x:2,z:3},destination:{floorId:'office',x:15,z:16},directionality:'two-way',movementCost:'normal',name:'Office access',dmNotes:'A secret door',assetId:'00000000-0000-4000-8000-000000000001'})
const set=(state:EncounterState,t=transition())=>applyCommand(state,dm,{type:'map.transition.set',transition:t})
const use=(overrides:Partial<Extract<import('./domain.ts').GameCommand,{type:'combatant.transition.use'}>>={}):Extract<import('./domain.ts').GameCommand,{type:'combatant.transition.use'}>=>({type:'combatant.transition.use',combatantId:1,transitionId:'stairs',from:'source',allowRemoteSource:false,allowOccupied:false,...overrides})
test('all five transition types persist in version 6; legacy maps remain valid',()=>{
 let state=initial();for(const type of transitionTypes)state=set(state,transition(type))
 assert.equal(state.dungeonMap!.schemaVersion,6);assert.equal(state.dungeonMap!.transitions!.length,5)
 assert.equal(readDungeon(blankDungeon('legacy','Legacy')).schemaVersion,1)
 assert.deepEqual(importEncounter(JSON.parse(JSON.stringify(state))).dungeonMap,state.dungeonMap)
 assert.throws(()=>readDungeon({...state.dungeonMap,schemaVersion:5}),/version 6/)
})
test('floor references, endpoint bounds, duplicate IDs and same-floor routes are validated atomically',()=>{
 const state=initial(),t=transition()
 for(const invalid of [{...t,destination:{...t.destination,floorId:'deleted'}},{...t,destination:{...t.destination,x:20}},{...t,destination:{...t.destination,floorId:'ground'}}])assert.throws(()=>set(state,invalid),/endpoints|different floors/)
 assert.throws(()=>readDungeon({...set(state).dungeonMap,transitions:[t,t]}),/unique/)
 assert.equal(state.dungeonMap!.transitions,undefined)
})
test('create/edit/delete transitions are individual undoable edits and do not rebuild level views',()=>{
 let state=initial(),history=emptyHistory();const prior=dungeonLevels(state.dungeonMap!)[1]
 for(const command of [{type:'map.transition.set',transition:transition()},{type:'map.transition.set',transition:{...transition(),name:'Renamed',movementCost:'difficult'}},{type:'map.transition.remove',transitionId:'stairs'}] as MapCommand[]){const result=applyMapEdit(state,dm,command,history);state=result.state;history=result.history}
 assert.deepEqual(state.dungeonMap!.transitions,[]);assert.equal(dungeonLevels(state.dungeonMap!)[1],prior)
 let result=applyMapEdit(state,dm,{type:'map.undo'},history);assert.equal(result.state.dungeonMap!.transitions![0].name,'Renamed')
 result=applyMapEdit(result.state,dm,{type:'map.undo'},result.history);assert.equal(result.state.dungeonMap!.transitions![0].movementCost,'normal')
 result=applyMapEdit(result.state,dm,{type:'map.redo'},result.history);assert.equal(result.state.dungeonMap!.transitions![0].movementCost,'difficult')
})
test('one-way and two-way transfers atomically preserve all combat data and use absolute floor ownership',()=>{
 let state=set(initial());const before=state.combatants[0]
 state=applyCommand(state,dm,use());assert.deepEqual(state.battleMap.tokens['1'],{x:15,z:16});assert.equal(state.combatants[0].floorId,'office')
 assert.deepEqual({...state.combatants[0],floorId:before.floorId},before)
 state=applyCommand(state,dm,use({from:'destination'}));assert.equal(state.combatants[0].floorId,'ground');assert.deepEqual(state.battleMap.tokens['1'],{x:2,z:3})
 state=set(state,{...transition(),directionality:'one-way'});state=applyCommand(state,dm,use())
 assert.throws(()=>applyCommand(state,dm,use({from:'destination'})),/one-way/)
 assert.throws(()=>transitionRoute({...transition(),directionality:'one-way'},'destination'),/one-way/)
})
test('remote source and occupied destination require independent explicit overrides',()=>{
 let state=set(initial());state=applyCommand(state,dm,{type:'token.move',combatantId:1,destination:{x:1,z:1}})
 assert.throws(()=>applyCommand(state,dm,use()),/source square/)
 state={...state,combatants:[...state.combatants,{...state.combatants[0],id:2,floorId:'office'}],battleMap:{...state.battleMap,tokens:{...state.battleMap.tokens,'2':{x:15,z:16}}}}
 assert.throws(()=>applyCommand(state,dm,use({allowRemoteSource:true})),/occupied/)
 const moved=applyCommand(state,dm,use({allowRemoteSource:true,allowOccupied:true}));assert.deepEqual(moved.battleMap.tokens['1'],moved.battleMap.tokens['2'])
 assert.throws(()=>applyCommand(moved,dm,use({allowRemoteSource:true,allowOccupied:true})),/source floor/)
})
test('players cannot transfer; hidden endpoints and private notes never appear in player projections',()=>{
 let state=set(initial());assert.throws(()=>applyCommand(state,player,use()),/not permitted/)
 assert.deepEqual(projectEncounter(state,player).dungeonMap!.transitions,[])
 state=applyCommand(state,dm,use());assert.equal(projectEncounter(state,player).combatants.length,0)
 assert.equal(dungeonLevels(state.dungeonMap!)[1].playerVisible,false)
 state=applyCommand(state,dm,{type:'map.level.update',id:'office',name:'Office',elevationFeet:15,playerVisible:true})
 const publicState=projectEncounter(state,player);assert.equal(publicState.dungeonMap!.transitions!.length,1);assert.equal(publicState.dungeonMap!.transitions![0].dmNotes,undefined)
 assert.equal(JSON.stringify(publicState).includes('secret door'),false)
})
test('duplication leaves routes unchanged; floor deletion removes incident routes in the same undo frame',()=>{
 let state=set(initial());state=applyCommand(state,dm,{type:'map.level.duplicate',id:'office',newId:'copy',name:'Office copy',elevationFeet:30})
 assert.deepEqual(state.dungeonMap!.transitions,[transition()])
 const removed=applyMapEdit(state,dm,{type:'map.level.remove',id:'office'},emptyHistory())
 assert.deepEqual(removed.state.dungeonMap!.transitions,[])
 const restored=applyMapEdit(removed.state,dm,{type:'map.undo'},removed.history)
 assert.deepEqual(restored.state.dungeonMap!.transitions,[transition()])
 const erased=applyCommand(state,dm,{type:'map.transition.remove',transitionId:'stairs'})
 assert.throws(()=>applyCommand(erased,dm,use()),/no longer exists/)
})
test('save/import round trips preserve secondary-floor positions beyond primary bounds and transition calibration',()=>{
 const state=applyCommand(set(initial()),dm,use()),restored=importEncounter(JSON.parse(JSON.stringify(state)))
 assert.deepEqual(restored.battleMap.tokens['1'],{x:15,z:16});assert.equal(restored.combatants[0].floorId,'office');assert.deepEqual(restored.dungeonMap!.transitions,state.dungeonMap!.transitions)
 assert.throws(()=>editMap({document:state.dungeonMap!,width:20,height:20},emptyHistory(),{type:'map.floorImage.set',levelId:'office',width:10,height:10,image:null}),/endpoints/)
})
