import test from 'node:test'
import assert from 'node:assert/strict'
import {dungeonLevels,primaryLevelId,blankDungeon,readDungeon,editMap,emptyHistory,elevationToWorld,levelDocument,reuseDungeonGeometry,type MapCommand} from './dungeon.ts'
import {importEncounter,applyCommand,applyMapEdit,projectEncounter,commandSchema} from './domain.ts'
import {floorImageSchema} from './floor-image.ts'
const dm={id:'dm',role:'dm' as const},player={id:'player',role:'player' as const}
const image=floorImageSchema.parse({imageId:'00000000-0000-4000-8000-000000000001',offsetX:.25,scale:1.3})
function initial(){return importEncounter({version:1,round:2,combatants:[{id:1,name:'Hero',side:'hero',hp:7,maxHp:10,ac:12,initiative:15,conditions:['Poisoned'],saves:[],actions:[],ownerId:'00000000-0000-4000-8000-000000000002'}],dungeonMap:{...blankDungeon('map','Keep',12,10),schemaVersion:4,floorImage:image},battleMap:{width:12,height:10,tokens:{'1':{x:3,z:4}}}},true)}
const add=(id:string,elevationFeet=10):MapCommand=>({type:'map.level.add',id,name:id,elevationFeet,width:12,height:10})
test('legacy normalization preserves all geometry, image metadata, references and token coordinates',()=>{
 const state=initial(),map=state.dungeonMap!,levels=dungeonLevels(map)
 assert.equal(levels.length,1);assert.equal(levels[0].id,'ground');assert.equal(levels[0].name,'Ground Floor');assert.equal(levels[0].elevationFeet,0)
 assert.deepEqual(levels[0].floorImage,image);assert.deepEqual(state.battleMap.tokens['1'],{x:3,z:4});assert.equal(map.schemaVersion,4)
 assert.equal(dungeonLevels(map),levels);assert.equal(levelDocument(levels[0]),levelDocument(levels[0]))
 assert.equal(readDungeon(JSON.parse(JSON.stringify(map))).floorImage?.imageId,image.imageId)
})
test('level add, rename, positive/negative elevations and committed history preserve isolated geometry',()=>{
 let frame={document:initial().dungeonMap!,width:12,height:10},history=emptyHistory()
 for(const command of [add('upper'),add('cellar',-15),{type:'map.level.update',id:'upper',name:'Tower',elevationFeet:25,playerVisible:false},{type:'map.wall.place',levelId:'upper',wall:{id:'H:2:3',axis:'H',x:2,z:3,material:'stone'}}] as MapCommand[]){const result=editMap(frame,history,command);frame=result.frame as typeof frame;history=result.history}
 assert.equal(frame.document.schemaVersion,5);const levels=dungeonLevels(frame.document)
 assert.equal(levels.find(l=>l.id==='upper')?.walls.length,1);assert.equal(levels[0].walls.length,0);assert.equal(levels.find(l=>l.id==='cellar')?.elevationFeet,-15)
 assert.equal(elevationToWorld(25),5);assert.equal(elevationToWorld(-15),-3)
 let result=editMap(frame,history,{type:'map.undo'});assert.equal(dungeonLevels(result.frame.document!).find(l=>l.id==='upper')?.walls.length,0)
 result=editMap(result.frame,result.history,{type:'map.redo'});assert.equal(dungeonLevels(result.frame.document!).find(l=>l.id==='upper')?.walls.length,1)
 assert.throws(()=>editMap(result.frame,result.history,{type:'map.wall.remove',levelId:'ground',wallId:'H:2:3'}),/no longer exists/)
})
test('duplication generates new scoped object identities, retains shared image/GLB transforms and restores deletion',()=>{
 let map=initial().dungeonMap!
 map=editMap({document:map,width:12,height:10},emptyHistory(),{type:'map.prop.place',prop:{id:'crate',type:'crate',position:{x:2,z:2},rotation:90}}).frame.document!
 map=editMap({document:map,width:12,height:10},emptyHistory(),{type:'map.scenery.place',prop:{type:'asset',id:'model',assetId:'00000000-0000-4000-8000-000000000003',label:'Barrel',category:'furniture',position:{x:4,z:4},rotation:45,scale:2,verticalOffset:1.5,visible:true}}).frame.document!
 const frame={document:map,width:12,height:10},copy=editMap(frame,emptyHistory(),{type:'map.level.duplicate',id:'ground',newId:'copy',name:'Copy',elevationFeet:-10})
 const [first,second]=dungeonLevels(copy.frame.document!)
 assert.equal(second.playerVisible,false);assert.deepEqual(second.floorImage,first.floorImage);assert.notEqual(first.props[0].id,second.props[0].id)
 assert.deepEqual({...second.props[1],id:first.props[1].id},first.props[1]);assert.equal(second.elevationFeet,-10)
 const removed=editMap(copy.frame,copy.history,{type:'map.level.remove',id:'copy'}),restored=editMap(removed.frame,removed.history,{type:'map.undo'})
 assert.deepEqual(restored.frame.document,copy.frame.document)
 assert.throws(()=>editMap(frame,emptyHistory(),{type:'map.level.remove',id:'ground'}),/last/)
 assert.throws(()=>editMap(copy.frame,copy.history,add('copy')),/Duplicate/)
})
test('primary level deletion promotes another level without using array order as identity',()=>{
 let state=applyCommand(initial(),dm,add('basement',-10))
 state=applyCommand(state,dm,{type:'combatant.floor.transfer',combatantId:1,floorId:'basement',destination:{x:2,z:3}})
 state=applyCommand(state,dm,{type:'map.level.remove',id:'ground'})
 assert.equal(primaryLevelId(state.dungeonMap),'basement');assert.equal(state.dungeonMap!.name,'Keep');assert.equal(state.combatants[0].floorId,'basement');assert.deepEqual(state.battleMap.tokens['1'],{x:2,z:3})
})
test('combatant transfers preserve combat state, enforce floor bounds, and protect occupied levels/history',()=>{
 let state=applyCommand(initial(),dm,add('upper'))
 const before=state.combatants[0]
 state=applyCommand(state,dm,{type:'combatant.floor.transfer',combatantId:1,floorId:'upper',destination:{x:8,z:6}})
 assert.deepEqual({...state.combatants[0],floorId:before.floorId},before)
 assert.throws(()=>applyCommand(state,dm,{type:'map.level.remove',id:'upper'}),/Move combatants/)
 assert.throws(()=>applyCommand(state,dm,{type:'combatant.floor.transfer',combatantId:1,floorId:'upper',destination:{x:12,z:0}}),/destination/)
 assert.throws(()=>applyCommand(state,player,{type:'combatant.floor.transfer',combatantId:1,floorId:'ground',destination:{x:1,z:1}}),/not permitted/)
 const edited=applyMapEdit(initial(),dm,add('upper'),emptyHistory())
 const moved=applyCommand(edited.state,dm,{type:'combatant.floor.transfer',combatantId:1,floorId:'upper',destination:{x:1,z:1}})
 assert.throws(()=>applyMapEdit(moved,dm,{type:'map.undo'},edited.history),/Move combatants/)
})
test('per-level dimensions preserve tokens on other floors and reject shrinking around combatants',()=>{
 let state=applyCommand(initial(),dm,{...add('large'),width:30,height:25})
 state=applyCommand(state,dm,{type:'combatant.floor.transfer',combatantId:1,floorId:'large',destination:{x:25,z:20}})
 state=applyCommand(state,dm,{type:'map.floorImage.set',levelId:'ground',image,width:10,height:8})
 assert.deepEqual(state.battleMap.tokens['1'],{x:25,z:20});assert.equal(state.battleMap.width,30)
 assert.throws(()=>applyCommand(state,dm,{type:'map.floorImage.set',levelId:'large',image:null,width:20,height:20}),/inside the new level bounds/)
 assert.throws(()=>applyCommand(state,dm,{type:'token.move',combatantId:1,destination:{x:31,z:1}}),/outside/)
})
test('player snapshots omit hidden level geometry, names, images, combatants, overlays and ownership movement',()=>{
 let state=applyCommand(initial(),dm,add('secret'))
 state={...state,combatants:state.combatants.map(c=>({...c,ownerId:player.id}))}
 state=applyCommand(state,dm,{type:'combatant.floor.transfer',combatantId:1,floorId:'secret',destination:{x:2,z:2}})
 let publicState=projectEncounter(state,player)
 assert.equal(publicState.combatants.length,0);assert.equal(dungeonLevels(publicState.dungeonMap!).length,1);assert.equal(JSON.stringify(publicState).includes('secret'),false)
 assert.throws(()=>applyCommand(state,player,{type:'token.move',combatantId:1,destination:{x:3,z:3}}),/not permitted/)
 state=applyCommand(state,dm,{type:'map.level.update',id:'secret',name:'Revealed',elevationFeet:10,playerVisible:true})
 publicState=projectEncounter(state,player);assert.equal(publicState.combatants[0].floorId,'secret');assert.equal(dungeonLevels(publicState.dungeonMap!).length,2)
 state=applyCommand(state,dm,{type:'map.level.update',id:'ground',name:'Hidden Ground',elevationFeet:0,playerVisible:false})
 publicState=projectEncounter(state,player);assert.equal(primaryLevelId(publicState.dungeonMap),'secret');assert.equal(JSON.stringify(publicState).includes('Hidden Ground'),false)
})
test('round trips and scoped image replacement/removal preserve all levels, references, and token ownership',()=>{
 let state=applyCommand(initial(),dm,add('upper'))
 state=applyCommand(state,dm,{type:'map.floorImage.set',levelId:'upper',image:{...image,rotation:270,opacity:.3},width:12,height:10})
 state=applyCommand(state,dm,{type:'map.floorImage.set',levelId:'ground',image:null,width:12,height:10})
 const reloaded=importEncounter(JSON.parse(JSON.stringify(state)),true)
 assert.deepEqual(reloaded.dungeonMap,state.dungeonMap);assert.deepEqual(reloaded.battleMap,state.battleMap)
 assert.equal(dungeonLevels(reloaded.dungeonMap!)[1].floorImage?.rotation,270);assert.equal(dungeonLevels(reloaded.dungeonMap!)[0].floorImage,undefined)
 assert.equal(commandSchema.parse({type:'map.floorImage.set',levelId:'upper',image,width:12,height:10}).type,'map.floorImage.set')
 assert.throws(()=>readDungeon({...state.dungeonMap,levels:[...state.dungeonMap!.levels!,state.dungeonMap!.levels![0]]}),/unique/)
})
test('unchanged level view identity survives unrelated map edits and network snapshots',()=>{
 const state=applyCommand(initial(),dm,add('upper')),map=state.dungeonMap!,upper=dungeonLevels(map)[1]
 const edited=applyCommand(state,dm,{type:'map.floor.paint',levelId:'ground',cells:[{x:1,z:1}],material:'stone'}).dungeonMap!
 assert.equal(dungeonLevels(edited)[1],upper)
 const next=reuseDungeonGeometry(map,readDungeon(JSON.parse(JSON.stringify(map))))
 assert.equal(dungeonLevels(next)[1],upper)
})

test('scoped batch room/corridor edits run through legacy drawing validation without mixing levels',()=>{
 let state=applyCommand(initial(),dm,add('upper'))
 state=applyCommand(state,dm,{type:'map.draw',levelId:'upper',kind:'room',start:{x:2,z:2},end:{x:6,z:5},floor:'stone',material:'stone',wallsOnly:false,width:2})
 assert.equal(dungeonLevels(state.dungeonMap!)[1].floors.length,12)
 assert.equal(dungeonLevels(state.dungeonMap!)[0].floors.length,0)
})
test('all hidden floors yield an empty projected map and cannot leak overlays or combatant references',()=>{
 let state=applyCommand(initial(),dm,add('secret'))
 state=applyCommand(state,dm,{type:'map.level.update',id:'ground',name:'Hidden Ground',elevationFeet:0,playerVisible:false})
 const publicState=projectEncounter(state,player)
 assert.equal(publicState.dungeonMap,undefined);assert.equal(publicState.levelsHidden,true);assert.equal(publicState.combatants.length,0)
 assert.deepEqual(publicState.battleMap.tokens,{})
 assert.equal(JSON.stringify(publicState).includes(image.imageId),false)
 assert.throws(()=>applyCommand(state,dm,{type:'map.level.update',id:'secret',name:'Coincident',elevationFeet:0,playerVisible:false}),/at least 0.1/)
})
