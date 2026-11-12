import test from 'node:test'
import assert from 'node:assert/strict'
import {FogAnimation} from '../src/fogAnimation.ts'
import {initialFog,fullMask,fogSchema,type FogOfWar} from './fog.ts'
import {blankDungeon,emptyHistory,readDungeon,type MapCommand} from './dungeon.ts'
import {applyMapEdit,importEncounter,projectEncounter,commandSchema} from './domain.ts'
import {FogMaskDraft} from './fogEditing.ts'
import {pointLightSchema,legacyEnvironment} from './lighting.ts'
const dm={id:'dm',role:'dm' as const},player={id:'player',role:'player' as const}
const reveal=(mask=fullMask(8,8),revision=1,startedAt=1000):FogOfWar=>({...initialFog(),floors:{ground:mask},revision,transition:{startedAt}})
const update=(a:FogAnimation,f:FogOfWar,now=1000,reduced=false)=>a.update(f,'ground',reduced,false,now)
test('C reveal finishes in 750ms; late mounts and expired transitions snap; one fixed resource',()=>{
 const a=new FogAnimation(8,8),buffer=a.pixels;update(a,initialFog());update(a,reveal());assert.equal(a.progress(1000),0);assert.equal(a.progress(1375),.5);assert.equal(a.progress(1750),1)
 assert.equal(a.pixels[0],0);assert.equal(a.pixels[1],0);assert.equal(a.pixels[2],255)
 for(let i=2;i<100;i++)update(a,reveal(i%2?fullMask(8,8):'',i,1000+i),1000+i)
 assert.equal(a.pixels,buffer);assert.equal(a.pixels.length,8*8*16*4)
 const late=new FogAnimation(8,8);update(late,reveal(),1100);assert.equal(late.progress(1100),1)
 update(a,reveal(fullMask(8,8),101,1000),3000);assert.equal(a.progress(3000),1)
})
test('C conceal and mixed operations clamp hidden samples immediately and retarget unfinished reveals',()=>{
 const a=new FogAnimation(8,8);update(a,initialFog());update(a,reveal());
 const half=new FogMaskDraft(8,8,'');half.rectangle({x:0,z:0},{x:4,z:8},'reveal')
 update(a,reveal(half.serialize(),2,1375),1375)
 assert.equal(a.pixels[2],128);const hidden=(4*4)*4;assert.equal(a.pixels[hidden],255);assert.equal(a.pixels[hidden+1],255);assert.equal(a.pixels[hidden+2],255)
 update(a,reveal('',3,1400),1400);assert.ok(a.pixels.every((v,i)=>i%4===3||v===255))
})
test('C zero/disabled/reduced motion snap; enabling reduced motion interrupts existing animation',()=>{
 for(const settings of [{enabled:true,durationMs:0},{enabled:false,durationMs:2000}]){const a=new FogAnimation(8,8);update(a,initialFog());update(a,{...reveal(),cinematic:settings});assert.equal(a.progress(1000),1)}
 const a=new FogAnimation(8,8);update(a,initialFog());update(a,reveal(),1000,true);assert.equal(a.progress(1000),1)
 update(a,reveal('',2,1200),1200);update(a,reveal(fullMask(8,8),3,1300),1300);assert.equal(a.progress(1300),0);update(a,reveal(fullMask(8,8),3,1300),1350,true);assert.equal(a.progress(1350),1)
})
test('C boundary softness stays on authorized side and does not mutate masks',()=>{
 const draft=new FogMaskDraft(8,8,'');draft.rectangle({x:0,z:0},{x:4,z:8},'reveal');const mask=draft.serialize()
 for(const softness of [0,.5,1]){const a=new FogAnimation(8,8);update(a,{...reveal(mask),appearance:{colour:'#000000',edgeSoftness:softness}})
  for(let i=0;i<a.pixels.length;i+=4){if(a.pixels[i]===255)assert.equal(a.pixels[i+1],255)}
  assert.equal(a.pixels[(8*32+15)*4+1]>0,softness>0);assert.equal(mask,draft.serialize())
 }
})
test('C settings validate, persist/import/export, use DM authorization and preserve combat/lighting',()=>{
 let state=importEncounter({version:1,round:3,combatants:[],dungeonMap:{...blankDungeon('map','Map',8,8),fogOfWar:initialFog(),lighting:{environment:legacyEnvironment}}})
 const original=structuredClone(state),command:MapCommand={type:'map.fog.settings',edgeSoftness:1,cinematic:{enabled:true,durationMs:1250}}
 assert.throws(()=>applyMapEdit(state,player,command,emptyHistory()),/Only the DM/)
 const result=applyMapEdit(state,dm,command,emptyHistory());state=result.state
 assert.deepEqual(state.battleMap,original.battleMap);assert.deepEqual(state.dungeonMap!.lighting,original.dungeonMap!.lighting);assert.equal(state.round,3)
 assert.deepEqual(readDungeon(JSON.parse(JSON.stringify(state.dungeonMap))),state.dungeonMap)
 assert.deepEqual(importEncounter(JSON.parse(JSON.stringify(state))).dungeonMap,state.dungeonMap)
 assert.equal(applyMapEdit(state,dm,{type:'map.undo'},result.history).state.dungeonMap!.fogOfWar!.cinematic,undefined)
 for(const durationMs of [-1,2001,Infinity])assert.equal(commandSchema.safeParse({...command,cinematic:{enabled:true,durationMs}}).success,false)
 assert.equal(fogSchema.safeParse({...initialFog(),transition:{startedAt:-1}}).success,false)
})
test('C revealed offset lights detach from fog-hidden parents; hidden casters, gizmos and attachments stay private',()=>{
 const draft=new FogMaskDraft(8,8,'');draft.rectangle({x:0,z:0},{x:3,z:3},'reveal')
 let state=importEncounter({version:1,round:1,combatants:[],dungeonMap:{...blankDungeon('map','Map',8,8),schemaVersion:2,fogOfWar:reveal(draft.serialize()),props:[{id:'secret-parent',type:'asset',assetId:'e06248e8-77fa-40a8-bfce-e610e86a0553',label:'Hidden monster',category:'decoration',position:{x:5,z:5},rotation:0,scale:3,verticalOffset:0,visible:true}],lighting:{environment:legacyEnvironment,sources:[pointLightSchema.parse({id:'torch',name:'Secret light',floorId:'ground',position:{x:1,z:1,heightFeet:5},attachment:{kind:'scenery',id:'secret-parent',floorId:'ground',offset:{x:-4/3,z:-4/3,heightFeet:2}},castShadow:true})]}}})
 const before=JSON.stringify(state.dungeonMap!.fogOfWar),projected=projectEncounter(state,player)
 assert.equal(projected.dungeonMap!.props.length,0);assert.equal(projected.dungeonMap!.lighting!.sources!.length,1)
 assert.equal(projected.dungeonMap!.lighting!.sources![0].attachment,undefined);assert.equal(JSON.stringify(projected).includes('secret-parent'),false)
 assert.equal(JSON.stringify(state.dungeonMap!.fogOfWar),before)
 state=applyMapEdit(state,dm,{type:'map.fog.mask',levelId:'ground',mask:'0'.repeat(256)},emptyHistory()).state
 assert.equal(projectEncounter(state,player).dungeonMap!.lighting!.sources!.length,0)
 assert.equal(state.dungeonMap!.lighting!.sources![0].attachment!.id,'secret-parent')
})
