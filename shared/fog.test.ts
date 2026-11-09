import test from 'node:test'
import assert from 'node:assert/strict'
import {blankDungeon,readDungeon,editMap,emptyHistory,dungeonLevels,levelDocument,type MapCommand} from './dungeon.ts'
import {importEncounter,applyCommand,projectEncounter,commandSchema,type EncounterState} from './domain.ts'
import {initialFog,fullMask,maskLength,sampleRevealed,regionRevealed} from './fog.ts'
const dm={id:'dm',role:'dm' as const},player={id:'00000000-0000-4000-8000-000000000002',role:'player' as const}
const base=()=>blankDungeon('warehouse','Warehouse',12,8)
function edit(map:ReturnType<typeof base>,command:MapCommand){return editMap({document:map,width:map.width,height:map.height},emptyHistory(),command).frame.document!}
const enabled=()=>edit(base(),{type:'map.fog.enabled',enabled:true})
const state=(map=enabled()):EncounterState=>importEncounter({version:1,round:7,dungeonMap:map,combatants:[{id:1,name:'Known tracker hero',side:'hero',hp:10,maxHp:10,ac:12,initiative:14,conditions:[],saves:[],actions:[],visible:true}],battleMap:{width:12,height:8,tokens:{'1':{x:1,z:1}}}})
test('A1 legacy normalization is unchanged; masks are exact, bounded and independently versioned',()=>{
 const map=base();assert.deepEqual(readDungeon(JSON.parse(JSON.stringify(map))),map);assert.equal(map.fogOfWar,undefined)
 assert.equal(maskLength(50,50),10000)
 for(const fog of [{...initialFog(),version:2},{...initialFog(),floors:{missing:'f'}},{...initialFog(),floors:{ground:'F'.repeat(384)}},{...initialFog(),floors:{ground:'f'}}])assert.throws(()=>readDungeon({...map,fogOfWar:fog}))
 assert.throws(()=>commandSchema.parse({type:'map.fog.reset',confirmed:false}))
 assert.throws(()=>commandSchema.parse({type:'map.fog.mask',levelId:'ground',mask:'f'.repeat(10001)}))
})
test('A2 enable conceals every floor; disable preserves masks; confirmed reset retains enabled flag and is undoable',()=>{
 let map=edit(base(),{type:'map.level.add',id:'office',name:'Office',elevationFeet:15,width:8,height:6})
 map=edit(map,{type:'map.fog.enabled',enabled:true});assert.deepEqual(map.fogOfWar?.floors,{})
 for(const l of dungeonLevels(map))assert.equal(sampleRevealed(map.fogOfWar,l.id,l.width,l.height,1,1),false)
 map=edit(map,{type:'map.fog.mask',levelId:'ground',mask:fullMask(12,8)})
 const off=edit(map,{type:'map.fog.enabled',enabled:false});assert.deepEqual(off.fogOfWar?.floors,map.fogOfWar?.floors)
 assert.equal(sampleRevealed(off.fogOfWar,'office',8,6,1,1),true)
 const on=edit(off,{type:'map.fog.enabled',enabled:true});assert.equal(sampleRevealed(on.fogOfWar,'office',8,6,1,1),false)
 const reset=editMap({document:on,width:12,height:8},emptyHistory(),{type:'map.fog.reset',confirmed:true})
 assert.equal(reset.frame.document?.fogOfWar?.enabled,true);assert.deepEqual(reset.frame.document?.fogOfWar?.floors,{})
 assert.deepEqual(editMap(reset.frame,reset.history,{type:'map.undo'}).frame.document,on)
})
test('A3 rename retains stable mask, duplicate/new floors start concealed, delete cleans up, undo restores exactly',()=>{
 let map=edit(enabled(),{type:'map.fog.mask',levelId:'ground',mask:fullMask(12,8)})
 map=edit(map,{type:'map.level.duplicate',id:'ground',newId:'copy',name:'Copy',elevationFeet:15})
 assert.equal(map.fogOfWar?.floors.copy,undefined);assert.equal(map.fogOfWar?.floors.ground,fullMask(12,8))
 map=edit(map,{type:'map.level.update',id:'ground',name:'Loading bay',elevationFeet:0,playerVisible:true})
 assert.equal(map.fogOfWar?.floors.ground,fullMask(12,8));assert.equal(levelDocument(dungeonLevels(map)[0]).fogOfWar,undefined)
 map=edit(map,{type:'map.level.remove',id:'ground'});assert.deepEqual(map.fogOfWar?.floors,{})
})
test('A7 map save/reload, encounter export/import and snapshots preserve fog without combat or lighting edits',()=>{
 let map=enabled();map=edit(map,{type:'map.fog.mask',levelId:'ground',mask:fullMask(12,8)})
 assert.deepEqual(readDungeon(JSON.parse(JSON.stringify(map))),map)
 const source=state(map),restored=importEncounter(JSON.parse(JSON.stringify(source)))
 assert.deepEqual(restored.dungeonMap?.fogOfWar,map.fogOfWar)
 const before=state(base()),after=applyCommand(before,dm,{type:'map.fog.enabled',enabled:true})
 for(const key of ['round','activeId','combatants','battleMap'] as const)assert.deepEqual(after[key],before[key])
 assert.deepEqual(after.dungeonMap?.lighting,before.dungeonMap?.lighting)
 assert.equal(projectEncounter(after,dm),after)
})
test('A5/A6 hidden objects, GLBs, labels, positions, tactical and hidden-floor masks are excluded; roster remains',()=>{
 const assetId='00000000-0000-4000-8000-000000000001'
 let map=edit(enabled(),{type:'map.scenery.place',prop:{type:'asset',id:'secret-model',assetId,label:'Secret giant model',category:'decoration',position:{x:3,z:3},scale:20,rotation:0,verticalOffset:20,visible:true}})
 map=edit(map,{type:'map.floor.paint',cells:[{x:1,z:1}],material:'wood'})
 map=edit(map,{type:'map.level.add',id:'secret-office',name:'Secret upstairs',elevationFeet:15,width:8,height:6})
 const s=state(map);s.combatants[0].miniature={assetId,scale:20,rotation:0,verticalOffset:20,showBase:true,baseSize:'Huge'}
 const projected=projectEncounter(s,player),wire=JSON.stringify(projected)
 assert.equal(projected.combatants[0].name,'Known tracker hero');assert.deepEqual(projected.battleMap.tokens,{})
 for(const secret of ['Secret giant model','secret-model','Secret upstairs','secret-office',assetId])assert.ok(!wire.includes(secret),secret)
 assert.deepEqual(projected.dungeonMap?.floors,[]);assert.deepEqual(projected.dungeonMap?.props,[])
 const reveal=edit(map,{type:'map.fog.mask',levelId:'ground',mask:fullMask(12,8)})
 const visible=projectEncounter({...s,dungeonMap:reveal},player)
 assert.equal(visible.dungeonMap?.props.length,1);assert.equal(visible.battleMap.tokens['1'].x,1)
 assert.equal(projectEncounter({...s,dungeonMap:reveal},player).dungeonMap?.fogOfWar?.floors['secret-office'],undefined)
})
test('A4 complete footprint policy excludes boundary-crossing objects, not just centres',()=>{
 const fog={...initialFog(),floors:{ground:'0'.repeat(384)}}
 // Reveal first square only (4 samples wide on each of four rows).
 const digits=fog.floors.ground.split('');for(let z=0;z<4;z++)digits[z*12]='f';fog.floors.ground=digits.join('')
 assert.equal(sampleRevealed(fog,'ground',12,8,.5,.5),true)
 assert.equal(regionRevealed(fog,'ground',12,8,0,0,1,1),true)
 assert.equal(regionRevealed(fog,'ground',12,8,0,0,1.1,1),false)
 const map=edit({...base(),fogOfWar:fog},{type:'map.prop.place',prop:{id:'wide',type:'table',scale:2,position:{x:0,z:0},rotation:0}})
 assert.deepEqual(projectEncounter(state(map),player).dungeonMap?.props,[])
})
test('A6/A8 unauthorized fog commands rejected and movement never reveals; late projections match fresh state',()=>{
 const s=state();s.combatants[0].ownerId=player.id
 for(const command of [{type:'map.fog.enabled',enabled:false},{type:'map.fog.reset',confirmed:true},{type:'map.fog.mask',levelId:'ground',mask:fullMask(12,8)}])assert.throws(()=>applyCommand(s,player,commandSchema.parse(command)),/Only the DM|not permitted/)
 const moved=applyCommand(s,player,{type:'token.move',combatantId:1,destination:{x:2,z:2}})
 assert.deepEqual(moved.dungeonMap?.fogOfWar,s.dungeonMap?.fogOfWar)
 assert.deepEqual(projectEncounter(importEncounter(JSON.parse(JSON.stringify(moved)),true),player),projectEncounter(moved,player))
})

test('A4/A8 fog is independent of environment, saved scenes and attached lights',async()=>{
 const{pointLightSchema,lightingTemplates}=await import('./lighting.ts')
 const source=pointLightSchema.parse({id:'lantern',name:'Hidden lantern',floorId:'ground',position:{x:1,z:1,heightFeet:5},color:'#ffffff',intensity:10,radius:30,attachment:{kind:'combatant',id:'1',offset:{x:0,z:0,heightFeet:5}}})
 let s=state(base());s={...s,dungeonMap:{...s.dungeonMap!,lighting:{environment:lightingTemplates.Night,sources:[source]}}}
 const fogged=applyCommand(s,dm,{type:'map.fog.enabled',enabled:true})
 assert.deepEqual(fogged.dungeonMap?.lighting,s.dungeonMap?.lighting)
 assert.deepEqual(projectEncounter(fogged,player).dungeonMap?.lighting?.sources,[])
 const changed=applyCommand(fogged,dm,{type:'map.lighting.environment.set',environment:lightingTemplates.Daylight})
 assert.deepEqual(changed.dungeonMap?.fogOfWar,fogged.dungeonMap?.fogOfWar)
 const moved=applyCommand(changed,dm,{type:'token.move',combatantId:1,destination:{x:2,z:2}})
 assert.deepEqual(moved.dungeonMap?.fogOfWar,changed.dungeonMap?.fogOfWar)
 assert.deepEqual(projectEncounter(moved,player).dungeonMap?.lighting?.sources,[])
})
