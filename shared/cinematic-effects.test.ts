import test from 'node:test'
import assert from 'node:assert/strict'
import {configurePlayback,controlPlayback,samplePlayback,defaultPlaybackSettings,effectPlaybackSchema} from './effectPlayback.ts'
import {createEffect,effectSchema} from './environmentalEffects.ts'
import {resolveEffect,permittedEffects} from './effectState.ts'
import {blankDungeon,emptyHistory,readDungeon,type MapCommand} from './dungeon.ts'
import {applyMapEdit,applyCommand,importEncounter,projectEncounter,combatantSchema} from './domain.ts'
import {lightAppearanceSchema} from './lighting.ts'
import {initialFog,fullMask} from './fog.ts'
const dm={id:'dm',role:'dm' as const},player={id:'p',role:'player' as const}
function fixture(){return importEncounter({version:1,round:4,combatants:[combatantSchema.parse({id:'hero',name:'Hero',side:'hero',initiative:12,hp:8,maxHp:12,ac:15,conditions:[],saves:[],actions:[]})],battleMap:{tokens:{hero:{x:4,z:4}}},dungeonMap:{...blankDungeon('warehouse','Warehouse',30,30),props:[{id:'brazier',type:'brazier',position:{x:10,z:10},rotation:90,scale:2}]}})}
test('authoritative playback reconstructs fade, pause/resume, restart, deactivation and one-shot completion',()=>{
 const settings={...defaultPlaybackSettings(),mode:'manual' as const};let p=configurePlayback(undefined,settings,0,1000)
 assert.equal(samplePlayback(p,2000).visible,false)
 p=controlPlayback(p,'activate',1,2000);assert.equal(samplePlayback(p,2000).opacity,0);assert.equal(samplePlayback(p,2250).opacity,.5)
 p=controlPlayback(p,'pause',2,2300);assert.equal(samplePlayback(p,6000).time,.3)
 p=controlPlayback(p,'resume',3,6000);assert.equal(samplePlayback(p,6200).time,.5)
 const active=p;p=controlPlayback(p,'activate',4,6250);assert.deepEqual(p,active)
 p=controlPlayback(p,'restart',4,6300);assert.equal(samplePlayback(p,6300).time,0)
 p=controlPlayback(p,'deactivate',5,6550);assert.equal(samplePlayback(p,6550).opacity,.5);assert.equal(samplePlayback(p,6800).opacity,.25);assert.equal(samplePlayback(p,7050).visible,false)
 assert.equal(samplePlayback(p,6550,true).visible,false)
 assert.throws(()=>controlPlayback(p,'restart',0,7000),/playback changed/)
 p=configurePlayback(p,{...settings,mode:'once',durationMs:1000},6,7000);p=controlPlayback(p,'activate',7,7100)
 assert.equal(samplePlayback(p,8200).finished,true);assert.equal(samplePlayback(p,8200).visible,false)
 const revision=p.revision;assert.equal(samplePlayback(p,9000).visible,false);assert.equal(p.revision,revision)
 assert.equal(effectPlaybackSchema.safeParse({...p,startedAt:NaN}).success,false)
})
test('effect playback commands are DM-only, revision-guarded, undoable and immutable through ordinary edits',()=>{
 let state=fixture(),history=emptyHistory();const edit=(c:MapCommand)=>{const r=applyMapEdit(state,dm,c,history);state=r.state;history=r.history}
 const e=createEffect('portal','fey-portal','ground',{x:10,z:10,heightFeet:0});edit({type:'map.effect.set',effect:e})
 edit({type:'map.effect.playback.configure',id:e.id,settings:{...defaultPlaybackSettings(),mode:'manual'},expectedRevision:0,at:1000});edit({type:'map.effect.playback.control',id:e.id,action:'activate',expectedRevision:1,at:2000})
 const active=state.dungeonMap!.environmentalEffects!.effects[0]
 assert.throws(()=>edit({type:'map.effect.set',effect:{...active,playback:{...active.playback!,revision:99}}}),/playback controls/)
 assert.throws(()=>edit({type:'map.effect.playback.control',id:e.id,action:'deactivate',expectedRevision:1,at:2100}),/playback changed/)
 assert.throws(()=>applyMapEdit(state,player,{type:'map.effect.playback.control',id:e.id,action:'restart',expectedRevision:2},history),/Only the DM/)
 edit({type:'map.undo'});assert.equal(state.dungeonMap!.environmentalEffects!.effects[0].playback!.state,'inactive');edit({type:'map.redo'});assert.equal(state.dungeonMap!.environmentalEffects!.effects[0].playback!.startedAt,2000)
 assert.deepEqual(importEncounter(JSON.parse(JSON.stringify(state))).dungeonMap,state.dungeonMap);assert.equal(state.round,4)
})
test('attachments follow scenery and combatant position/rotation without persisting derived world positions',()=>{
 let state=fixture();const edit=(c:MapCommand)=>{state=applyMapEdit(state,dm,c,emptyHistory()).state}
 const e={...createEffect('fire','campfire','ground',{x:1,z:1,heightFeet:0}),rotation:15,attachment:{kind:'scenery' as const,id:'brazier',floorId:'ground',offset:{x:1,z:0,heightFeet:2}}}
 edit({type:'map.effect.set',effect:e});edit({type:'map.effect.light.set',id:e.id,appearance:lightAppearanceSchema.parse({radius:3})})
 let resolved=resolveEffect(state.dungeonMap!.environmentalEffects!.effects[0],state);assert.equal(resolved.effect.rotation,105);assert.equal(resolved.effect.position.z,8);assert.equal(resolved.effect.position.heightFeet,4)
 edit({type:'map.prop.transform',propId:'brazier',position:{x:12,z:13},rotation:180,scale:2});resolved=resolveEffect(state.dungeonMap!.environmentalEffects!.effects[0],state);assert.equal(resolved.effect.position.x,10);assert.equal(resolved.effect.rotation,195)
 assert.deepEqual(state.dungeonMap!.environmentalEffects!.effects[0].position,e.position)
 const projected=projectEncounter(state,player).dungeonMap!;assert.equal(projected.environmentalEffects!.effects[0].attachment,undefined);assert.deepEqual(projected.environmentalEffects!.effects[0].position,projected.lighting!.sources![0].position);readDungeon(projected)
 edit({type:'map.effect.detach',id:e.id});assert.equal(state.dungeonMap!.environmentalEffects!.effects[0].attachment,undefined);assert.equal(state.dungeonMap!.environmentalEffects!.effects[0].position.x,10)
 const standalone=state.dungeonMap!.environmentalEffects!.effects[0];edit({type:'map.effect.set',effect:{...standalone,attachment:{kind:'combatant',id:'hero',offset:{x:1,z:0,heightFeet:5}}}})
 state=applyCommand(state,dm,{type:'token.move',combatantId:'hero',destination:{x:8,z:9}});assert.equal(resolveEffect(state.dungeonMap!.environmentalEffects!.effects[0],state).effect.position.x,9)
 state=applyCommand(state,dm,{type:'combatant.remove',combatantId:'hero'});assert.equal(resolveEffect(state.dungeonMap!.environmentalEffects!.effects[0],state).available,false);assert.equal(permittedEffects(state).length,0)
})
test('hidden parents/floors/fog never leak effect or attachment identities; floor duplication remaps scenery targets',()=>{
 let state=fixture();const edit=(c:MapCommand)=>{state=applyMapEdit(state,dm,c,emptyHistory()).state}
 edit({type:'map.effect.set',effect:{...createEffect('attached','magical-motes','ground',{x:1,z:1,heightFeet:0}),attachment:{kind:'scenery',id:'brazier',floorId:'ground',offset:{x:0,z:0,heightFeet:1}}}})
 edit({type:'map.level.duplicate',id:'ground',newId:'office',name:'Office',elevationFeet:15})
 const copy=state.dungeonMap!.environmentalEffects!.effects[1];assert.equal(copy.attachment!.kind,'scenery');assert.equal(copy.attachment!.id,'office:prop:0');assert.equal(resolveEffect(copy,state).available,true)
 state={...state,dungeonMap:{...state.dungeonMap!,fogOfWar:initialFog()}};assert.equal(projectEncounter(state,player).dungeonMap!.environmentalEffects!.effects.length,0)
 state={...state,dungeonMap:{...state.dungeonMap!,fogOfWar:{...initialFog(),floors:{ground:fullMask(30,30)}}}};const p=projectEncounter(state,player).dungeonMap!;assert.equal(p.environmentalEffects!.effects.length,1);assert.equal(JSON.stringify(p.environmentalEffects).includes('brazier'),false);assert.equal(JSON.stringify(p).includes('office:prop:0'),false)
 assert.equal(effectSchema.safeParse({...copy,attachment:{kind:'scenery',id:'__proto__',floorId:'ground',offset:{x:0,z:0,heightFeet:0}}}).success,false)
})

test('short one shots cap their fade window and pulse transitions never exceed the authorized scale',()=>{
 let p=configurePlayback(undefined,{mode:'once',durationMs:250,transition:{kind:'pulse',durationMs:5000}},0,1000);p=controlPlayback(p,'activate',1,1100)
 assert.equal(samplePlayback(p,1225).opacity,1)
 for(let at=1100;at<=1350;at+=5){const s=samplePlayback(p,at);assert.ok(s.scale>=.85&&s.scale<=1);assert.ok(s.opacity>=0&&s.opacity<=1)}
})

test('clock skew cannot expand a fade-out beyond the authorized opacity/scale envelope',()=>{
 let p=configurePlayback(undefined,{mode:'manual',durationMs:3000,transition:{kind:'scale',durationMs:500}},0,1000);p=controlPlayback(p,'activate',1,1000);p=controlPlayback(p,'deactivate',2,2000)
 const s=samplePlayback(p,0);assert.ok(s.opacity<=1&&s.opacity>=0);assert.ok(s.scale<=1&&s.scale>=.1)
})

test('long-running persistent loops continue advancing and can pause after more than a week',()=>{
 const settings=defaultPlaybackSettings();let p=configurePlayback(undefined,settings,0,1000)
 assert.ok(samplePlayback(p,1000+8*86400000).time!>7*86400)
 p=controlPlayback(p,'pause',1,1000+8*86400000);assert.equal(p.elapsedMs,8*86400000)
})
