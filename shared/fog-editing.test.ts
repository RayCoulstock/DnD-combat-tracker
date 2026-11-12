import test from 'node:test'
import assert from 'node:assert/strict'
import {FogMaskDraft,validateFogPolygon,sameFogMask} from './fogEditing.ts'
import {initialFog,sampleRevealed,fullMask} from './fog.ts'
import {blankDungeon,editMap,emptyHistory,type MapCommand} from './dungeon.ts'
import {importEncounter,applyCommand,applyMapEdit,commandSchema} from './domain.ts'
const visible=(mask:string,x:number,z:number)=>sampleRevealed({...initialFog(),floors:{ground:mask}},'ground',8,6,x,z)
test('brush clicks, sparse continuous segments and reversed direction produce deterministic bounded masks',()=>{
 const dot=new FogMaskDraft(8,6);dot.brush({x:2,z:2},{x:2,z:2},.5,'reveal');assert.equal(visible(dot.serialize(),2.125,2.125),true);assert.equal(visible(dot.serialize(),3,3),false)
 const a={x:.25,z:.25},b={x:7.75,z:5.75},forward=new FogMaskDraft(8,6),reverse=new FogMaskDraft(8,6);forward.brush(a,b,.5,'reveal');reverse.brush(b,a,.5,'reveal');assert.equal(forward.serialize(),reverse.serialize())
 for(let i=0;i<31;i++)assert.equal(visible(forward.serialize(),a.x+(b.x-a.x)*i/30,a.z+(b.z-a.z)*i/30),true)
 assert.equal(forward.serialize().length,8*6*4)
})
test('conceal preserves unrelated regions and size changes alter the precise brush support',()=>{
 const small=new FogMaskDraft(8,6),large=new FogMaskDraft(8,6);for(const[d,r]of [[small,.5],[large,2]] as const)d.brush({x:4,z:3},{x:4,z:3},r,'reveal')
 assert.equal(visible(small.serialize(),5.125,3.125),false);assert.equal(visible(large.serialize(),5.125,3.125),true)
 const mask=new FogMaskDraft(8,6,fullMask(8,6));mask.brush({x:2,z:2},{x:4,z:2},.5,'conceal');assert.equal(visible(mask.serialize(),3.125,2.125),false);assert.equal(visible(mask.serialize(),6,4),true)
})
test('rectangles normalise reversed drags, match continuous coordinates and ignore zero-area clicks',()=>{
 const a=new FogMaskDraft(8,6),b=new FogMaskDraft(8,6);a.rectangle({x:1.25,z:1.5},{x:6.75,z:4.25},'reveal');b.rectangle({x:6.75,z:4.25},{x:1.25,z:1.5},'reveal');assert.equal(a.serialize(),b.serialize());assert.equal(visible(a.serialize(),1.125,2),false);assert.equal(visible(a.serialize(),1.375,2),true)
 b.rectangle({x:3,z:2},{x:4,z:3},'conceal');assert.equal(visible(b.serialize(),3.125,2.125),false);assert.equal(visible(b.serialize(),2.125,2.125),true)
 const empty=new FogMaskDraft(8,6);empty.rectangle({x:1,z:1},{x:1,z:4},'reveal');assert.equal(sameFogMask(empty.serialize(),''),true)
})
test('concave cavern polygons reveal/conceal correctly independent of winding order',()=>{
 const points=[{x:1,z:1},{x:6,z:1},{x:6,z:2},{x:2,z:2},{x:2,z:5},{x:1,z:5}],a=new FogMaskDraft(8,6),b=new FogMaskDraft(8,6);a.polygon(points,'reveal');b.polygon([...points].reverse(),'reveal');assert.equal(a.serialize(),b.serialize());assert.equal(visible(a.serialize(),1.5,4),true);assert.equal(visible(a.serialize(),4,4),false)
 const c=new FogMaskDraft(8,6,fullMask(8,6));c.polygon(points,'conceal');assert.equal(visible(c.serialize(),1.5,4),false);assert.equal(visible(c.serialize(),4,4),true)
})
test('invalid, crossing, touching, degenerate and oversized polygons cannot change a draft',()=>{
 const invalid=[[],[{x:1,z:1},{x:5,z:5},{x:1,z:5},{x:5,z:1}],[{x:1,z:1},{x:1,z:1},{x:4,z:2}],[{x:1,z:1},{x:2,z:2},{x:3,z:3}],[{x:NaN,z:1},{x:2,z:3},{x:1,z:3}],Array.from({length:65},(_,i)=>({x:i/10,z:1}))]
 for(const p of invalid){const draft=new FogMaskDraft(8,6,fullMask(8,6));assert.throws(()=>draft.polygon(p,'conceal'));assert.equal(draft.serialize(),fullMask(8,6));assert.throws(()=>validateFogPolygon(p,8,6))}
})
test('large drafts stay fixed-size across long painting and reject invalid masks and radius',()=>{
 const draft=new FogMaskDraft(50,50);for(let i=0;i<200;i++)draft.brush({x:i%50,z:i%50},{x:(i+1)%50,z:(i+1)%50},1,'reveal');assert.equal(draft.serialize().length,10000)
 for(const r of [0,.1,13,Infinity,NaN])assert.throws(()=>draft.brush({x:0,z:0},{x:1,z:1},r,'reveal'))
 assert.throws(()=>new FogMaskDraft(8,6,'f'));assert.throws(()=>new FogMaskDraft(51,6));assert.throws(()=>commandSchema.parse({type:'map.fog.mask',levelId:'ground',mask:fullMask(8,6),expectedMask:'f'.repeat(10001)}))
})
test('a completed multi-sample gesture is one exact undo frame and guarded edits reject intervening masks',()=>{
 const base=blankDungeon('fog','Fog',8,6),start=editMap({document:base,width:8,height:6},emptyHistory(),{type:'map.fog.enabled',enabled:true}),draft=new FogMaskDraft(8,6)
 for(let i=0;i<12;i++)draft.brush({x:1+i/4,z:2},{x:1+(i+1)/4,z:2},.5,'reveal')
 const command:MapCommand={type:'map.fog.mask',levelId:'ground',mask:draft.serialize(),expectedMask:''},changed=editMap(start.frame,start.history,command)
 assert.equal(changed.history.undo.length,start.history.undo.length+1)
 const undo=editMap(changed.frame,changed.history,{type:'map.undo'});assert.deepEqual(undo.frame,start.frame);assert.deepEqual(editMap(undo.frame,undo.history,{type:'map.redo'}).frame,changed.frame)
 assert.throws(()=>editMap(changed.frame,changed.history,{...command,mask:fullMask(8,6)}),/Fog changed/)
 assert.equal(changed.frame.document!.fogOfWar!.floors.ground,draft.serialize())
 const disabled=editMap(changed.frame,changed.history,{type:'map.fog.enabled',enabled:false});assert.throws(()=>editMap(disabled.frame,disabled.history,{...command,expectedMask:draft.serialize()}),/Fog changed/)
 const state=importEncounter({version:1,round:1,combatants:[],dungeonMap:start.frame.document});assert.throws(()=>applyCommand(state,{id:'player',role:'player'},command),/not permitted/)
})
test('full-floor operations and current-floor reset remain independent and undoable',()=>{
 let edit=editMap({document:blankDungeon('fog','Fog',8,6),width:8,height:6},emptyHistory(),{type:'map.fog.enabled',enabled:true})
 for(const command of [{type:'map.level.add',id:'office',name:'Office',width:4,height:4,elevationFeet:15},{type:'map.fog.mask',levelId:'ground',mask:fullMask(8,6),expectedMask:''},{type:'map.fog.mask',levelId:'office',mask:fullMask(4,4),expectedMask:''}] as MapCommand[])edit=editMap(edit.frame,edit.history,command)
 const previous=edit.frame;edit=editMap(edit.frame,edit.history,{type:'map.fog.reset',levelId:'office',confirmed:true});assert.equal(edit.frame.document!.fogOfWar!.floors.office,undefined);assert.equal(edit.frame.document!.fogOfWar!.floors.ground,fullMask(8,6));assert.deepEqual(editMap(edit.frame,edit.history,{type:'map.undo'}).frame,previous)
})


test('captured map revisions reject a stale gesture even when the old mask is identical',()=>{
 const map={...blankDungeon('fog','Fog',8,6),fogOfWar:initialFog()},state={...importEncounter({version:1,round:1,combatants:[],dungeonMap:map}),mapRevision:8}
 const command:MapCommand={type:'map.fog.mask',levelId:'ground',mask:fullMask(8,6),expectedMask:'',expectedMapRevision:7}
 assert.throws(()=>applyMapEdit(state,{id:'dm',role:'dm'},command,emptyHistory()),error=>error instanceof Error&&'code'in error&&error.code==='CONFLICT')
 assert.deepEqual(state.dungeonMap!.fogOfWar!.floors,{})
 const applied=applyMapEdit(state,{id:'dm',role:'dm'},{...command,expectedMapRevision:8},emptyHistory())
 assert.equal(applied.state.dungeonMap!.fogOfWar!.floors.ground,fullMask(8,6));assert.equal(applied.history.undo.length,1)
})
