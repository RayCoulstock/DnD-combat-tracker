import test from 'node:test'
import assert from 'node:assert/strict'
import {createEffect,magicalEffectPresetIds,effectPresetIds,effectPreset,effectSchema,effectSurface,effectRadius} from './environmentalEffects.ts'
import {blankDungeon,readDungeon,emptyHistory,type MapCommand} from './dungeon.ts'
import {importEncounter,applyMapEdit,projectEncounter,combatantSchema} from './domain.ts'
import {initialFog,fullMask} from './fog.ts'
import {lightAppearanceSchema} from './lighting.ts'
const dm={id:'dm',role:'dm' as const},player={id:'p',role:'player' as const}
const fixture=()=>importEncounter({version:1,round:3,combatants:[combatantSchema.parse({id:'hero',name:'Hero',side:'hero',hp:8,maxHp:12,ac:15,initiative:12,conditions:[],saves:[],actions:[]})],dungeonMap:blankDungeon('cavern','Cavern',30,30)})
test('C registers all 18 presets with strict surface parameters and backward-compatible A/B records',()=>{
 assert.equal(magicalEffectPresetIds.length,18);assert.equal(effectPresetIds.length,35)
 for(const id of magicalEffectPresetIds){const e=createEffect(id,id,'ground',{x:10,z:10,heightFeet:0}),preset=effectPreset(id);assert.equal(e.presetId,id)
  const map=readDungeon({...blankDungeon('m','Map',30,30),environmentalEffects:{version:1,effects:[e]}});assert.deepEqual(readDungeon(JSON.parse(JSON.stringify(map))),map)
  if(preset.surface){
   assert.ok(effectRadius({...e,scale:2})>effectRadius(e));assert.equal(e.parameters,undefined)
   for(const patch of [{radius:0},{radius:Infinity},{pulse:NaN},{pulse:2},{secondaryColor:'red'},{particles:'yes'}])assert.equal(effectSchema.safeParse({...e,surface:{...effectSurface(e),...patch}}).success,false)
   if(!preset.secondary)assert.equal(effectSchema.safeParse({...e,surface:{...effectSurface(e),particles:true}}).success,false)
  }
 }
 for(const id of ['campfire','magical-motes'] as const){const e=createEffect('old',id,'ground',{x:1,z:1,heightFeet:0});assert.equal(e.surface,undefined);assert.equal(effectSchema.safeParse({...e,surface:{radius:1,pulse:0,secondaryColor:'#ffffff',particles:false}}).success,false)}
})
test('C visual edits preserve combat, terrain, fog and transitions, and retain history/export',()=>{
 let state=fixture(),history=emptyHistory();const edit=(c:MapCommand)=>{const r=applyMapEdit(state,dm,c,history);state=r.state;history=r.history}
 edit({type:'map.level.add',id:'court',name:'Court',width:30,height:30,elevationFeet:15})
 edit({type:'map.transition.set',transition:{id:'stairs',name:'Stairs',type:'stairs',source:{floorId:'ground',x:1,z:1},destination:{floorId:'court',x:1,z:1},directionality:'two-way',movementCost:'normal'}})
 const before=state,transition=state.dungeonMap!.transitions
 for(const id of magicalEffectPresetIds)edit({type:'map.effect.set',effect:createEffect(id,id,'ground',{x:10,z:10,heightFeet:0})})
 assert.strictEqual(state.combatants,before.combatants);assert.strictEqual(state.battleMap,before.battleMap);assert.equal(state.round,3);assert.deepEqual(state.dungeonMap!.transitions,transition)
 assert.deepEqual(state.dungeonMap!.floors,before.dungeonMap!.floors);assert.deepEqual(state.dungeonMap!.fogOfWar,before.dungeonMap!.fogOfWar)
 const portal=state.dungeonMap!.environmentalEffects!.effects[0];edit({type:'map.effect.set',effect:{...portal,surface:{...effectSurface(portal),radius:2,pulse:.7},speed:2,color:'#abcdef'}})
 edit({type:'map.effect.remove',id:portal.id});edit({type:'map.undo'});assert.equal(state.dungeonMap!.environmentalEffects!.effects.length,18);edit({type:'map.redo'});assert.equal(state.dungeonMap!.environmentalEffects!.effects.length,17)
 assert.deepEqual(importEncounter(JSON.parse(JSON.stringify(state))).dungeonMap,state.dungeonMap)
 assert.throws(()=>applyMapEdit(state,player,{type:'map.effect.set',effect:portal},history),/Only the DM/)
})
test('magical surfaces, secondary detail and owned lights remain floor- and fog-specific',()=>{
 let state=fixture();const edit=(c:MapCommand)=>{state=applyMapEdit(state,dm,c,emptyHistory()).state}
 for(const id of ['fey-portal','ritual-circle','magical-corruption','lava-pool','electrical-arcs'] as const)edit({type:'map.effect.set',effect:createEffect(id,id,'ground',{x:10,z:10,heightFeet:0})})
 edit({type:'map.effect.light.set',id:'fey-portal',appearance:lightAppearanceSchema.parse({radius:4})})
 edit({type:'map.level.add',id:'secret',name:'Secret',width:30,height:30,elevationFeet:15})
 edit({type:'map.effect.set',effect:createEffect('hidden-portal','dark-portal','secret',{x:10,z:10,heightFeet:0})})
 state={...state,dungeonMap:{...state.dungeonMap!,fogOfWar:initialFog()}}
 let publicMap=projectEncounter(state,player).dungeonMap!;assert.equal(publicMap.environmentalEffects!.effects.length,0);assert.equal(publicMap.lighting!.sources!.length,0)
 state={...state,dungeonMap:{...state.dungeonMap!,fogOfWar:{...initialFog(),floors:{ground:fullMask(30,30)}}}}
 publicMap=projectEncounter(state,player).dungeonMap!;assert.equal(publicMap.environmentalEffects!.effects.length,5);assert.equal(publicMap.lighting!.sources!.length,1);assert.equal(JSON.stringify(publicMap).includes('hidden-portal'),false);readDungeon(publicMap)
 edit({type:'map.effect.duplicate',id:'fey-portal',newId:'copy'});assert.equal(state.dungeonMap!.lighting!.sources!.length,2);edit({type:'map.effect.remove',id:'copy'});assert.equal(state.dungeonMap!.lighting!.sources!.length,1)
 const e=state.dungeonMap!.environmentalEffects!.effects[0];edit({type:'map.effect.set',effect:{...e,position:{x:0,z:0,heightFeet:25},surface:{...effectSurface(e),radius:4},scale:5}})
 assert.equal(projectEncounter(state,player).dungeonMap!.environmentalEffects!.effects.some(e=>e.id==='fey-portal'),false)
})
