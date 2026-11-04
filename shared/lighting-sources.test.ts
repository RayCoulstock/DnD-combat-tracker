import test from 'node:test'
import assert from 'node:assert/strict'
import {pointLightSchema,legacyEnvironment,flickerFactor,lightingSchema} from './lighting.ts'
import {blankDungeon,emptyHistory,dungeonLevels,type MapCommand} from './dungeon.ts'
import {applyMapEdit,applyCommand,importEncounter,projectEncounter,combatantSchema} from './domain.ts'
import {resolveLight} from './lightingState.ts'
const dm={id:'dm',role:'dm' as const},player={id:'p',role:'player' as const}
function fixture(){const map={...blankDungeon('warehouse','Warehouse',30,20),schemaVersion:5 as const,level:{id:'warehouse',name:'Warehouse',elevationFeet:0,playerVisible:true}};return importEncounter({version:1,round:4,combatants:[combatantSchema.parse({id:'hero',name:'Hero',side:'hero',initiative:12,hp:8,maxHp:12,ac:15,conditions:[],saves:[],actions:[]})],dungeonMap:map,battleMap:{width:30,height:20,tokens:{hero:{x:3,z:4}}}})}
const source=()=>pointLightSchema.parse({id:'torch',name:'Secret flame name',floorId:'warehouse',position:{x:5,z:6,heightFeet:5}})
test('point source edits use one history frame and remain independent of combat and models',()=>{
 let state=fixture(),history=emptyHistory();const edit=(c:MapCommand)=>{const r=applyMapEdit(state,dm,c,history);state=r.state;history=r.history}
 edit({type:'map.lighting.source.set',source:source()});assert.equal(history.undo.length,1);edit({type:'map.lighting.source.duplicate',id:'torch',newId:'copy'});assert.equal(state.dungeonMap!.lighting!.sources!.length,2);edit({type:'map.lighting.source.set',source:{...source(),intensity:12,color:'#abcdef',castShadow:true}});assert.equal(state.dungeonMap!.lighting!.sources!.find(s=>s.id==='copy')!.intensity,8);edit({type:'map.lighting.source.remove',id:'copy'});edit({type:'map.undo'});assert.equal(state.dungeonMap!.lighting!.sources!.length,2);edit({type:'map.redo'});assert.equal(state.dungeonMap!.lighting!.sources!.length,1);assert.equal(state.round,4);assert.equal(state.activeId,'hero');assert.equal(state.combatants[0].hp,8);assert.deepEqual(importEncounter(JSON.parse(JSON.stringify(state))).dungeonMap,state.dungeonMap)
 assert.throws(()=>applyMapEdit(state,player,{type:'map.lighting.source.set',source:source()},history),/Only the DM/)
})
test('combatant attachments follow stable IDs, movement, rotation, transfer and lossless detach',()=>{
 let state=fixture();const edit=(c:MapCommand)=>{state=applyMapEdit(state,dm,c,emptyHistory()).state}
 edit({type:'map.lighting.source.set',source:{...source(),attachment:{kind:'combatant',id:'hero',offset:{x:1,z:0,heightFeet:5}}}})
 assert.equal(resolveLight(state.dungeonMap!.lighting!.sources![0],state).position.x,4)
 state=applyCommand(state,dm,{type:'token.move',combatantId:'hero',destination:{x:8,z:9}});assert.equal(state.dungeonMap!.lighting!.sources![0].position.x,9)
 edit({type:'map.level.add',id:'office',name:'Office',elevationFeet:15,width:30,height:20});state=applyCommand(state,dm,{type:'combatant.floor.transfer',combatantId:'hero',floorId:'office',destination:{x:2,z:3}});assert.equal(state.dungeonMap!.lighting!.sources![0].floorId,'office')
 const before=resolveLight(state.dungeonMap!.lighting!.sources![0],state);edit({type:'map.lighting.source.detach',id:'torch'});assert.deepEqual(state.dungeonMap!.lighting!.sources![0].position,before.position);assert.equal(state.dungeonMap!.lighting!.sources![0].attachment,undefined)
 edit({type:'map.lighting.source.set',source:{...state.dungeonMap!.lighting!.sources![0],attachment:{kind:'combatant',id:'hero',offset:{x:0,z:0,heightFeet:5}}}});state=applyCommand(state,dm,{type:'combatant.remove',combatantId:'hero'});assert.equal(state.dungeonMap!.lighting!.sources![0].attachment,undefined);assert.equal(state.dungeonMap!.lighting!.sources![0].floorId,'office')
})
test('scenery attachment transforms and duplicated floors retain independent sources; players receive only permitted emitters',()=>{
 let state=fixture();const map=state.dungeonMap!;map.props=[{id:'lantern',type:'asset',assetId:'e06248e8-77fa-40a8-bfce-e610e86a0553',label:'Lantern',category:'decoration',position:{x:10,z:8},rotation:90,scale:2,verticalOffset:1,visible:true}];map.lighting={environment:legacyEnvironment,sources:[{...source(),attachment:{kind:'scenery',id:'lantern',floorId:'warehouse',offset:{x:1,z:0,heightFeet:2}}}]}
 state={...state,dungeonMap:{...map}};const resolved=resolveLight(map.lighting.sources![0],state);assert.ok(Math.abs(resolved.position.x-10)<1e-8);assert.equal(resolved.position.z,6);assert.equal(resolved.position.heightFeet,9)
 state=applyMapEdit(state,dm,{type:'map.level.duplicate',id:'warehouse',newId:'copy',name:'Copy',elevationFeet:15},emptyHistory()).state;const sources=state.dungeonMap!.lighting!.sources!;assert.equal(sources.length,2);assert.notEqual(sources[0].id,sources[1].id);assert.equal(sources[1].attachment!.kind,'scenery');assert.equal(sources[1].attachment!.id,dungeonLevels(state.dungeonMap!)[1].props[0].id)
 let projected=projectEncounter(state,player);assert.equal(projected.dungeonMap!.lighting!.sources!.length,1);assert.equal(projected.dungeonMap!.lighting!.sources![0].name,'Light');state.dungeonMap!.props[0]={...state.dungeonMap!.props[0],visible:false} as typeof state.dungeonMap.props[number];state={...state,dungeonMap:{...state.dungeonMap!}};projected=projectEncounter(state,player);assert.equal(projected.dungeonMap!.lighting!.sources!.length,0)
 state.dungeonMap!.lighting!.sources![0].attachment={kind:'combatant',id:'missing',offset:{x:0,z:0,heightFeet:5}};assert.equal(resolveLight(sources[0],state).parentExists,false);assert.equal(projectEncounter(state,player).dungeonMap!.lighting!.sources!.length,0)
})
test('bounded source data and smooth deterministic flicker reject unsafe input',()=>{
 assert.equal(lightingSchema.safeParse({environment:legacyEnvironment,sources:Array.from({length:33},(_,i)=>({...source(),id:'light'+i}))}).success,false);assert.equal(lightingSchema.safeParse({environment:legacyEnvironment,sources:[source(),source()]}).success,false)
 for(const patch of [{radius:0},{intensity:Infinity},{color:'red'},{id:'__proto__'}])assert.equal(pointLightSchema.safeParse({...source(),...patch}).success,false)
 for(let t=0;t<10;t+=.01){const f=flickerFactor('torch',t,.1,.7);assert.ok(f>=.9&&f<=1);assert.equal(f,flickerFactor('torch',t,.1,.7))}
})
