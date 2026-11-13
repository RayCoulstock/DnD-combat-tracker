import test from 'node:test'
import assert from 'node:assert/strict'
import {createEffect,effectSchema,environmentalEffectsSchema,effectRegistry} from './environmentalEffects.ts'
import {blankDungeon,readDungeon,dungeonLevels,levelDocument,emptyHistory,type MapCommand} from './dungeon.ts'
import {applyMapEdit,importEncounter,projectEncounter} from './domain.ts'
import {initialFog,fullMask} from './fog.ts'
const dm={id:'dm',role:'dm' as const},player={id:'player',role:'player' as const}
const effect=()=>createEffect('motes','magical-motes','ground',{x:5,z:5,heightFeet:5})
function fixture(){return importEncounter({version:1,round:4,combatants:[],dungeonMap:blankDungeon('warehouse','Warehouse')})}
test('legacy absence, empty effects, strict preset/finite parameters and bounded stable IDs',()=>{
 const map=blankDungeon('legacy','Legacy');assert.equal('environmentalEffects' in readDungeon(map),false)
 assert.deepEqual(readDungeon({...map,environmentalEffects:{version:1,effects:[]}}).environmentalEffects,{version:1,effects:[]})
 for(const patch of [{presetId:'shader'},{intensity:Infinity},{speed:NaN},{scale:0},{opacity:2},{color:'red'},{id:'__proto__'},{attachment:{id:'private'}}])assert.equal(effectSchema.safeParse({...effect(),...patch}).success,false)
 assert.equal(environmentalEffectsSchema.safeParse({version:1,effects:[effect(),effect()]}).success,false)
 assert.equal(environmentalEffectsSchema.safeParse({version:2,effects:[]}).success,false)
 assert.equal(environmentalEffectsSchema.safeParse({version:1,effects:Array.from({length:65},(_,i)=>({...effect(),id:'e'+i}))}).success,false)
 assert.ok(effectRegistry['magical-motes'].quality.low<effectRegistry['magical-motes'].quality.high)
 for(const patch of [{floorId:'missing'},{position:{x:20,z:1,heightFeet:0}}])assert.throws(()=>readDungeon({...map,environmentalEffects:{version:1,effects:[{...effect(),...patch}]}}))
})
test('effect CRUD, one history frame, undo/redo, roundtrip and DM-only mutation preserve unrelated state',()=>{
 let state=fixture(),history=emptyHistory();const before=state;const edit=(c:MapCommand)=>{const r=applyMapEdit(state,dm,c,history);state=r.state;history=r.history}
 edit({type:'map.effect.set',effect:effect()});assert.equal(history.undo.length,1);assert.strictEqual(state.combatants,before.combatants);assert.strictEqual(state.battleMap,before.battleMap);assert.equal(state.round,4)
 edit({type:'map.effect.duplicate',id:'motes',newId:'copy'});assert.equal(state.dungeonMap!.environmentalEffects!.effects.length,2)
 assert.throws(()=>edit({type:'map.effect.duplicate',id:'motes',newId:'copy'}))
 edit({type:'map.effect.set',effect:{...effect(),scale:2}});assert.equal(state.dungeonMap!.environmentalEffects!.effects.find(e=>e.id==='copy')!.scale,1)
 edit({type:'map.effect.remove',id:'copy'});edit({type:'map.undo'});assert.equal(state.dungeonMap!.environmentalEffects!.effects.length,2)
 edit({type:'map.redo'});assert.equal(state.dungeonMap!.environmentalEffects!.effects.length,1)
 assert.deepEqual(importEncounter(JSON.parse(JSON.stringify(state))).dungeonMap,state.dungeonMap)
 for(const c of [{type:'map.effect.set',effect:effect()},{type:'map.effect.remove',id:'motes'},{type:'map.effect.duplicate',id:'motes',newId:'hack'}] as MapCommand[])assert.throws(()=>applyMapEdit(state,player,c,history),/Only the DM/)
})
test('floor adapters retain effects only on document; duplication/removal and hidden floors remain safe',()=>{
 let state=fixture();const edit=(c:MapCommand)=>{state=applyMapEdit(state,dm,c,emptyHistory()).state}
 edit({type:'map.effect.set',effect:effect()});edit({type:'map.level.duplicate',id:'ground',newId:'office',name:'Office',elevationFeet:15})
 assert.equal(state.dungeonMap!.environmentalEffects!.effects.length,2)
 assert.equal(levelDocument(dungeonLevels(state.dungeonMap!)[0]).environmentalEffects,undefined)
 assert.equal(projectEncounter(state,player).dungeonMap!.environmentalEffects!.effects.length,1)
 edit({type:'map.level.remove',id:'office'});assert.equal(state.dungeonMap!.environmentalEffects!.effects.length,1)
})
test('fog projection withholds whole animated support including map edges and reveals safely',()=>{
 const state=fixture();state.dungeonMap={...state.dungeonMap!,environmentalEffects:{version:1,effects:[effect()]},fogOfWar:initialFog()}
 assert.equal(projectEncounter(state,player).dungeonMap!.environmentalEffects!.effects.length,0)
 state.dungeonMap={...state.dungeonMap,fogOfWar:{...initialFog(),floors:{ground:fullMask(20,20)}}}
 assert.equal(projectEncounter(state,player).dungeonMap!.environmentalEffects!.effects.length,1)
 state.dungeonMap={...state.dungeonMap,environmentalEffects:{version:1,effects:[{...effect(),scale:5,position:{x:1,z:1,heightFeet:100}}]}}
 assert.equal(projectEncounter(state,player).dungeonMap!.environmentalEffects!.effects.length,0)
 assert.equal(projectEncounter(state,dm).dungeonMap!.environmentalEffects!.effects.length,1)
})
