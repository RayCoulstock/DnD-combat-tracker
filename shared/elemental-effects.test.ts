import test from 'node:test'
import assert from 'node:assert/strict'
import {createEffect,effectPresetIds,effectPreset,effectSchema,effectRadius,effectParticleCount} from './environmentalEffects.ts'
import {effectEmitterId,effectiveEffectLight,effectVisible,effectLightTransition} from './effectLighting.ts'
import {blankDungeon,readDungeon,emptyHistory,dungeonLevels,type MapCommand} from './dungeon.ts'
import {applyMapEdit,importEncounter,projectEncounter} from './domain.ts'
import {initialFog,fullMask} from './fog.ts'
import {lightAppearanceSchema,legacyEnvironment} from './lighting.ts'
const dm={id:'dm',role:'dm' as const},player={id:'p',role:'player' as const}
const fire=()=>createEffect('fire','campfire','ground',{x:10,z:10,heightFeet:0})
const fixture=()=>importEncounter({version:1,round:4,combatants:[],dungeonMap:blankDungeon('warehouse','Warehouse',30,30)})
test('all elemental/atmospheric presets load, preserve validated parameters and scale bounded work',()=>{
 assert.equal(effectPresetIds.length,17)
 for(const presetId of effectPresetIds){
  const e=createEffect(presetId,presetId,'ground',{x:10,z:10,heightFeet:0})
  const map=readDungeon({...blankDungeon('m','M',30,30),environmentalEffects:{version:1,effects:[e]}})
  assert.deepEqual(readDungeon(JSON.parse(JSON.stringify(map))),map)
  assert.ok(effectParticleCount(e,'low')<effectParticleCount(e,'high'))
  if(effectPreset(presetId).particles){
   for(const patch of [{density:NaN},{height:Infinity},{spread:9},{lifetime:0},{direction:{x:2,z:0}}])assert.equal(effectSchema.safeParse({...e,parameters:{...e.parameters,...patch}}).success,false)
   assert.ok(effectRadius({...e,scale:2})>effectRadius(e))
  }
 }
 assert.equal(effectSchema.safeParse({...createEffect('smoke','smoke-column','ground',{x:1,z:1,heightFeet:0}),light:{emitterId:'x'}}).success,false)
 assert.equal(effectSchema.safeParse({...fire(),parameters:{...fire().parameters!,density:1,embers:true}}).success,true)
})
test('effect lights have exclusive ordinary-emitter ownership with atomic duplication, movement, removal and history',()=>{
 let state=fixture(),history=emptyHistory();const edit=(c:MapCommand)=>{const r=applyMapEdit(state,dm,c,history);state=r.state;history=r.history}
 edit({type:'map.effect.set',effect:fire()});const before=state
 edit({type:'map.effect.light.set',id:'fire',appearance:lightAppearanceSchema.parse({intensity:12,radius:4})})
 assert.equal(history.undo.length,2);assert.strictEqual(state.combatants,before.combatants);assert.strictEqual(state.battleMap,before.battleMap)
 const get=()=>state.dungeonMap!.lighting!.sources!,emitterId=effectEmitterId('fire')
 assert.equal(get()[0].id,emitterId);assert.equal(get()[0].attachment,undefined)
 for(const c of [{type:'map.lighting.source.remove',id:emitterId},{type:'map.lighting.source.set',source:get()[0]},{type:'map.lighting.source.duplicate',id:emitterId,newId:'illegal'}] as MapCommand[])assert.throws(()=>edit(c),/effect lighting controls/)
 assert.throws(()=>edit({type:'map.effect.set',effect:{...fire(),light:{emitterId:'other'}}}),/effect lighting controls/)
 edit({type:'map.effect.duplicate',id:'fire',newId:'copy'});assert.equal(get().length,2);assert.notEqual(get()[0].id,get()[1].id)
 const e=state.dungeonMap!.environmentalEffects!.effects.find(e=>e.id==='copy')!;edit({type:'map.effect.set',effect:{...e,position:{x:15,z:15,heightFeet:5}}})
 assert.deepEqual(get().find(s=>s.id===e.light!.emitterId)!.position,{x:15,z:15,heightFeet:5})
 edit({type:'map.effect.remove',id:'copy'});assert.equal(get().length,1);edit({type:'map.undo'});assert.equal(get().length,2);edit({type:'map.redo'});assert.equal(get().length,1)
 edit({type:'map.effect.light.set',id:'fire',appearance:null});assert.equal(get().length,0);assert.equal(state.dungeonMap!.environmentalEffects!.effects[0].light,undefined)
 edit({type:'map.undo'});assert.equal(get().length,1)
 assert.deepEqual(importEncounter(JSON.parse(JSON.stringify(state))).dungeonMap,state.dungeonMap)
 assert.throws(()=>applyMapEdit(state,player,{type:'map.effect.light.set',id:'fire',appearance:null},history),/Only the DM/)
})
test('linked lights follow duplicated/removed floors and preserve saved lighting appearance independently of visual intensity',()=>{
 let state=fixture();const edit=(c:MapCommand)=>{state=applyMapEdit(state,dm,c,emptyHistory()).state}
 edit({type:'map.effect.set',effect:fire()});edit({type:'map.effect.light.set',id:'fire',appearance:lightAppearanceSchema.parse({intensity:11,color:'#abcdef'})})
 edit({type:'map.level.duplicate',id:'ground',newId:'office',name:'Office',elevationFeet:15})
 assert.equal(state.dungeonMap!.environmentalEffects!.effects.length,2);assert.equal(state.dungeonMap!.lighting!.sources!.length,2)
 const office=state.dungeonMap!.environmentalEffects!.effects[1],source=state.dungeonMap!.lighting!.sources!.find(s=>s.id===office.light!.emitterId)!
 assert.equal(source.floorId,'office');assert.equal(dungeonLevels(state.dungeonMap!)[1].playerVisible,false)
 edit({type:'map.level.remove',id:'office'});assert.equal(state.dungeonMap!.lighting!.sources!.length,1)
 edit({type:'map.lighting.scene.save',id:'night',name:'Night',description:'',durationMs:0})
 let e=state.dungeonMap!.environmentalEffects!.effects[0];edit({type:'map.effect.set',effect:{...e,intensity:.2,enabled:false}})
 const light=state.dungeonMap!.lighting!.sources![0];assert.equal(light.intensity,11);assert.equal(effectiveEffectLight(state.dungeonMap,light).enabled,false)
 edit({type:'map.lighting.scene.activate',id:'night',durationMs:0,transitionId:'3d51eaf5-b3e3-4bea-9d61-a4b047fc5bf2'})
 assert.equal(effectiveEffectLight(state.dungeonMap,state.dungeonMap!.lighting!.sources![0]).enabled,false)
 e=state.dungeonMap!.environmentalEffects!.effects[0];edit({type:'map.effect.set',effect:{...e,enabled:true}})
 assert.equal(state.dungeonMap!.lighting!.sources![0].intensity,11);assert.equal(state.round,4)
})
test('fog filters full drift/scale/height-independent horizontal support and linked illumination together',()=>{
 let state=fixture();state=applyMapEdit(state,dm,{type:'map.effect.set',effect:fire()},emptyHistory()).state
 state=applyMapEdit(state,dm,{type:'map.effect.light.set',id:'fire',appearance:lightAppearanceSchema.parse({radius:5})},emptyHistory()).state
 state={...state,dungeonMap:{...state.dungeonMap!,fogOfWar:initialFog()}}
 let projected=projectEncounter(state,player);assert.equal(projected.dungeonMap!.environmentalEffects!.effects.length,0);assert.equal(projected.dungeonMap!.lighting!.sources!.length,0);assert.equal(JSON.stringify(projected).includes(effectEmitterId('fire')),false)
 state={...state,dungeonMap:{...state.dungeonMap!,fogOfWar:{...initialFog(),floors:{ground:fullMask(30,30)}}}}
 projected=projectEncounter(state,player);assert.equal(projected.dungeonMap!.environmentalEffects!.effects.length,1);assert.equal(projected.dungeonMap!.lighting!.sources!.length,1);readDungeon(projected.dungeonMap)
 // Conceal one sample inside the light radius, well outside the flame geometry.
 const mask=state.dungeonMap!.fogOfWar!.floors.ground.split(''),sample=10*4*30*4+14*4,index=Math.floor(sample/4);mask[index]=(parseInt(mask[index],16)&~(1<<(sample%4))).toString(16)
 state={...state,dungeonMap:{...state.dungeonMap!,fogOfWar:{...initialFog(),floors:{ground:mask.join('')}}}}
 assert.equal(effectVisible(state.dungeonMap!,fire()),true) // no linked source on this standalone input
 projected=projectEncounter(state,player);assert.equal(projected.dungeonMap!.environmentalEffects!.effects.length,0);assert.equal(projected.dungeonMap!.lighting!.sources!.length,0)
 const malformed={...state.dungeonMap!,lighting:{environment:legacyEnvironment,sources:[]}}
 assert.throws(()=>readDungeon(malformed),/exclusively owned/)
})
test('small owned lights remain paired with their effect when nearby concealed samples exclude the ordinary source anchor',()=>{
 let state=fixture();const edit=(c:MapCommand)=>{state=applyMapEdit(state,dm,c,emptyHistory()).state}
 const tiny={...fire(),scale:.1,position:{x:5.2,z:5.2,heightFeet:0},parameters:{...fire().parameters!,spread:.1}}
 edit({type:'map.effect.set',effect:tiny});edit({type:'map.effect.light.set',id:'fire',appearance:lightAppearanceSchema.parse({radius:.25})})
 const mask=fullMask(30,30).split(''),sample=20*120+20,index=Math.floor(sample/4);mask[index]=(parseInt(mask[index],16)&~(1<<(sample%4))).toString(16)
 state={...state,dungeonMap:{...state.dungeonMap!,fogOfWar:{...initialFog(),floors:{ground:mask.join('')}}}}
 const projected=projectEncounter(state,player).dungeonMap!
 assert.equal(projected.environmentalEffects!.effects.length,1);assert.equal(projected.lighting!.sources!.length,1);readDungeon(projected)
})

test('fog snaps owned light scene transitions so an old radius cannot cross a newly concealed boundary',()=>{
 let state=fixture();const edit=(c:MapCommand)=>{state=applyMapEdit(state,dm,c,emptyHistory()).state}
 edit({type:'map.effect.set',effect:fire()});edit({type:'map.effect.light.set',id:'fire',appearance:lightAppearanceSchema.parse({radius:4})})
 const map=state.dungeonMap!,source=map.lighting!.sources![0],transition={id:'3d51eaf5-b3e3-4bea-9d61-a4b047fc5bf2',startedAt:Date.now(),durationMs:2000}
 const animated={...map,lighting:{...map.lighting!,transition}}
 assert.deepEqual(effectLightTransition(animated,source),transition)
 assert.equal(effectLightTransition({...animated,fogOfWar:initialFog()},source),undefined)
 assert.equal(effectLightTransition(animated,{...source,enabled:false}),undefined)
 assert.deepEqual(effectLightTransition({...animated,fogOfWar:initialFog()},{...source,id:'unrelated'}),transition)
})
