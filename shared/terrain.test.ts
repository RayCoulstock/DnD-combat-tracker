import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {terrainBrushSchema,terrainStrokeSchema,terrainPaintSchema,TerrainRaster,brushCoverage,terrainImageIds,type TerrainStroke} from './terrain.ts'
import {repeatingTextureSchema} from './floor-surface.ts'
import {blankDungeon,readDungeon,editMap,emptyHistory,dungeonLevels,type MapCommand} from './dungeon.ts'
import {applyMapEdit,importEncounter,projectEncounter} from './domain.ts'
import {imageIds,historyImageIds} from '../server/floor-image-references.ts'
const brush=terrainBrushSchema.parse({size:2,softness:0,opacity:.5}),texture=repeatingTextureSchema.parse({assetId:'builtin:mud'}),point={x:1.0625,z:1.0625}
const stroke=(changes:Partial<TerrainStroke>={}):TerrainStroke=>{const input={id:randomUUID(),kind:'paint',texture,points:[point],brush,...changes};if(input.kind==='erase'){const{texture:unused,...rest}=input;void unused;return terrainStrokeSchema.parse(rest)}return terrainStrokeSchema.parse(input)}
test('terrain schema bounds commands, geometry, palettes, IDs and metadata without changing legacy maps',()=>{
 const old=blankDungeon('old','Old');assert.deepEqual(readDungeon(old),old)
 for(const patch of [{brush:{...brush,size:0}},{points:[]},{points:[{x:Infinity,z:1}]},{kind:'erase',texture},{points:Array(257).fill(point)}])assert.equal(terrainStrokeSchema.safeParse({...stroke(),...patch}).success,false)
 const a=stroke();assert.equal(terrainPaintSchema.safeParse([a,a]).success,false);assert.equal(terrainPaintSchema.safeParse(Array.from({length:129},()=>stroke())).success,false)
 assert.equal(terrainPaintSchema.safeParse(['stone','wood','grass','mud','sand'].map(name=>stroke({texture:{...texture,assetId:`builtin:${name}`}}))).success,false)
 assert.throws(()=>readDungeon({...old,terrainPaint:[stroke({points:[{x:21,z:2}]})]}),/bounds/)
 assert.throws(()=>readDungeon({...old,terrainPaint:Array.from({length:128},()=>stroke({points:Array(256).fill({x:1.123456789,z:2.123456789})}))}),/300 KB/)
})
test('hard/soft brushes and stroke union are deterministic regardless of event sampling density',()=>{
 assert.equal(brushCoverage(0,{...brush,softness:1}),1);assert.equal(brushCoverage(2,brush),0);assert.ok(brushCoverage(.5,{...brush,softness:1})<1);assert.equal(brushCoverage(.5,brush),1)
 const first=new TerrainRaster(4,4).update([stroke()]),dense=new TerrainRaster(4,4).update([stroke({points:Array(40).fill(point)})]);assert.deepEqual(first[0].rgba,dense[0].rgba);assert.equal(first[0].weight[8*32+8],.5)
 const line=new TerrainRaster(10,4).update([stroke({points:[{x:1,z:1},{x:9,z:1}]})]);assert.ok(line[0].weight[8*80+40]>0)
})
test('ordered over compositing and erasing reveal the unchanged base, including append/undo/redo replay',()=>{
 const a=stroke(),b=stroke({texture:{...texture,assetId:'builtin:sand'}}),erase=stroke({kind:'erase',texture:undefined}),raster=new TerrainRaster(4,4),index=8*32+8
 let layers=raster.update([a,b]);assert.equal(layers[0].weight[index],.25);assert.equal(layers[1].weight[index],.5);assert.equal(layers[0].rgba[index*4+1],128);assert.equal(layers[1].rgba[index*4+1],128)
 layers=raster.update([a,b,erase]);assert.equal(layers[0].weight[index],.125);assert.equal(layers[1].weight[index],.25)
 assert.deepEqual(raster.update([a])[0].rgba,new TerrainRaster(4,4).update([a])[0].rgba);assert.deepEqual(raster.update([a,b,erase]).map(l=>l.rgba),new TerrainRaster(4,4).update([a,b,erase]).map(l=>l.rgba))
})
test('one stroke/erase/clear integrates with history, copies, import/export and player floor projection',()=>{
 const base={...blankDungeon('paint','Paint',30,10),floorSurface:{mode:'texture' as const,texture:{...texture,assetId:'builtin:grass'}}};let result=editMap({document:base,width:30,height:10},emptyHistory(),{type:'map.terrain.stroke',stroke:stroke()})
 const apply=(command:MapCommand)=>{result=editMap(result.frame,result.history,command)}
 assert.equal(result.history.undo.length,1);assert.deepEqual(result.frame.document!.floorSurface,base.floorSurface)
 apply({type:'map.terrain.stroke',stroke:stroke({kind:'erase',texture:undefined})});assert.equal(result.frame.document!.terrainPaint!.length,2);apply({type:'map.undo'});assert.equal(result.frame.document!.terrainPaint!.length,1);apply({type:'map.redo'});assert.equal(result.frame.document!.terrainPaint!.length,2)
 apply({type:'map.terrain.clear'});assert.equal(result.frame.document!.terrainPaint,undefined);apply({type:'map.undo'});assert.equal(result.frame.document!.terrainPaint!.length,2)
 apply({type:'map.level.duplicate',id:'ground',newId:'upper',name:'Secret upper',elevationFeet:15});apply({type:'map.terrain.clear',levelId:'upper'});assert.equal(dungeonLevels(result.frame.document!)[0].terrainPaint!.length,2);assert.equal(dungeonLevels(result.frame.document!)[1].terrainPaint,undefined)
 const state=importEncounter({version:1,round:3,combatants:[],dungeonMap:result.frame.document});assert.deepEqual(importEncounter({...JSON.parse(JSON.stringify(state)),version:1}).dungeonMap,state.dungeonMap);assert.equal(dungeonLevels(projectEncounter(state,{id:'p',role:'player'}).dungeonMap!).length,1)
 assert.throws(()=>applyMapEdit(state,{id:'p',role:'player'},{type:'map.terrain.clear'},emptyHistory()),/Only the DM/)
})
test('custom paint assets participate in deletion/history references; built-ins do not',()=>{
 const id=randomUUID(),s=stroke({texture:{...texture,assetId:id}}),map={...blankDungeon('a','A'),terrainPaint:[s]};assert.deepEqual(imageIds(map),[id]);assert.deepEqual(terrainImageIds([s]),[id]);assert.deepEqual(historyImageIds({undo:[{document:map,width:20,height:20}],redo:[]}),[id]);assert.deepEqual(terrainImageIds([stroke()]),[])
})
test('50×50 masks and repeated append/undo remain bounded with four or fewer passes',()=>{
 const raster=new TerrainRaster(50,50),strokes=Array.from({length:24},(_,i)=>stroke({points:[{x:2,z:2+i},{x:35,z:2+i}],brush:{...brush,size:3,softness:.75}})),start=performance.now();let layers=raster.update(strokes)
 assert.equal(layers.length,1);assert.equal(layers[0].rgba.byteLength,400*400*4)
 for(let i=0;i<5;i++){raster.update(strokes.slice(0,-1));layers=raster.update(strokes)}assert.equal(layers[0].rgba.byteLength,640000);assert.ok(performance.now()-start<8000,'Bounded raster replay should remain practical in the CPU test environment')
})
