import test from 'node:test'
import assert from 'node:assert/strict'
import {environmentSchema,legacyEnvironment,effectiveEnvironment,lightingTemplates,qualityProfiles,environmentOverrideSchema} from './lighting.ts'
import {blankDungeon,editMap,emptyHistory,dungeonLevels,readDungeon,type MapCommand} from './dungeon.ts'
import {applyMapEdit,importEncounter,projectEncounter} from './domain.ts'
test('legacy maps and environment defaults retain original light values without opting into lighting',()=>{
 const map=blankDungeon('old','Old');assert.deepEqual(readDungeon(map),map);assert.equal(map.lighting,undefined);assert.deepEqual(effectiveEnvironment(),legacyEnvironment);assert.equal(legacyEnvironment.ambientIntensity,1.05);assert.equal(legacyEnvironment.directionalIntensity,2.1);assert.deepEqual(legacyEnvironment.directionalPosition,[8,14,6]);assert.equal(legacyEnvironment.exposure,1)
 for(const change of [{ambientIntensity:-1},{ambientIntensity:NaN},{directionalIntensity:6},{ambientColor:'red'},{exposure:0},{directionalPosition:[0,0,0]}])assert.equal(environmentSchema.safeParse({...legacyEnvironment,...change}).success,false)
})
test('global and partial per-floor lighting use existing history/copies and do not alter map geometry',()=>{
 const map=blankDungeon('lighting','Lighting',30,10);let result=editMap({document:map,width:30,height:10},emptyHistory(),{type:'map.lighting.environment.set',environment:lightingTemplates.Night});const apply=(command:MapCommand)=>{result=editMap(result.frame,result.history,command)}
 apply({type:'map.level.add',id:'office',name:'Office',elevationFeet:15,width:12,height:8});apply({type:'map.lighting.override.set',levelId:'office',override:{ambientIntensity:1.2,ambientColor:'#ffaa00'}});const doc=result.frame.document!,levels=dungeonLevels(doc)
 assert.equal(effectiveEnvironment(doc.lighting,levels[1].lightingOverride).ambientIntensity,1.2);assert.equal(effectiveEnvironment(doc.lighting,levels[1].lightingOverride).directionalIntensity,lightingTemplates.Night.directionalIntensity);assert.deepEqual(environmentOverrideSchema.parse({ambientIntensity:1.2}),{ambientIntensity:1.2});assert.equal(effectiveEnvironment(doc.lighting,levels[0].lightingOverride).ambientIntensity,lightingTemplates.Night.ambientIntensity);assert.deepEqual(doc.lighting!.environment,lightingTemplates.Night);assert.equal(levels[1].elevationFeet,15)
 apply({type:'map.level.duplicate',id:'office',newId:'copy',name:'Copy',elevationFeet:25});assert.deepEqual(dungeonLevels(result.frame.document!)[2].lightingOverride,levels[1].lightingOverride)
 apply({type:'map.lighting.override.set',levelId:'office',override:null});assert.equal(dungeonLevels(result.frame.document!)[1].lightingOverride,undefined);apply({type:'map.undo'});assert.deepEqual(dungeonLevels(result.frame.document!)[1].lightingOverride,levels[1].lightingOverride);apply({type:'map.redo'});assert.equal(dungeonLevels(result.frame.document!)[1].lightingOverride,undefined)
 assert.equal(result.frame.document!.width,30);assert.equal(result.frame.document!.height,10);assert.deepEqual(result.frame.document!.walls,[])
})
test('lighting survives serialization while player projection removes hidden floor overrides and rejects edits',()=>{
 let result=editMap({document:blankDungeon('a','A'),width:20,height:20},emptyHistory(),{type:'map.lighting.environment.set',environment:lightingTemplates.Daylight});result=editMap(result.frame,result.history,{type:'map.level.add',id:'secret',name:'Secret office',elevationFeet:10,width:20,height:20});result=editMap(result.frame,result.history,{type:'map.lighting.override.set',levelId:'secret',override:{ambientColor:'#ff00aa'}})
 const state=importEncounter({version:1,round:5,combatants:[],dungeonMap:result.frame.document}),copy=importEncounter({...JSON.parse(JSON.stringify(state)),version:1});assert.deepEqual(copy.dungeonMap,state.dungeonMap);assert.equal(JSON.stringify(projectEncounter(state,{id:'p',role:'player'})).includes('#ff00aa'),false);assert.throws(()=>applyMapEdit(state,{id:'p',role:'player'},{type:'map.lighting.environment.set',environment:legacyEnvironment},emptyHistory()),/Only the DM/);assert.equal(state.round,5)
 assert.ok(qualityProfiles.low.points<qualityProfiles.medium.points);assert.ok(qualityProfiles.medium.pointShadows<qualityProfiles.high.pointShadows)
})
