import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {floorSurfaceSchema,repeatingTextureSchema,repeatingTextureUv,surfaceMode,starterTextures} from './floor-surface.ts'
import {blankDungeon,canonicalWall,dungeonLevels,editMap,emptyHistory,readDungeon,type MapCommand} from './dungeon.ts'
import {floorImageSchema} from './floor-image.ts'
import {applyMapEdit,importEncounter,projectEncounter} from './domain.ts'
import {imageIds,historyImageIds} from '../server/floor-image-references.ts'
const texture=repeatingTextureSchema.parse({assetId:'builtin:stone'}),close=(v:number[],expected:number[])=>v.forEach((x,i)=>assert.ok(Math.abs(x-expected[i])<1e-8,`${v} != ${expected}`))
test('texture UVs count squares, preserve rectangular pixels and quarter-turn orientation',()=>{
 close(repeatingTextureUv(0,0,128,128,texture),[0,1]);close(repeatingTextureUv(30,30,128,128,texture),[15,-14]);close(repeatingTextureUv(40,10,128,128,texture),[20,-4])
 close(repeatingTextureUv(20,10,200,100,texture),[10,-9]);close(repeatingTextureUv(2,0,128,128,{...texture,rotation:90}),[0,2]);close(repeatingTextureUv(2,0,128,128,{...texture,rotation:180}),[-1,1]);close(repeatingTextureUv(2,0,128,128,{...texture,rotation:270}),[0,0]);close(repeatingTextureUv(3,4,128,128,{...texture,offsetX:3,offsetZ:4}),[0,1])
 for(const id of starterTextures.map(t=>t.id))assert.equal(repeatingTextureSchema.parse({assetId:id}).assetId,id)
})
test('surface settings validate bounded scale/brightness/tint/offsets and stable references',()=>{
 for(const change of [{repeatEverySquares:0},{repeatEverySquares:NaN},{repeatEverySquares:51},{rotation:45},{brightness:0},{brightness:3},{tint:'red'},{offsetX:Infinity},{assetId:'../../file.png'}])assert.equal(repeatingTextureSchema.safeParse({...texture,...change}).success,false)
 assert.equal(floorSurfaceSchema.safeParse({mode:'texture'}).success,false);assert.equal(floorSurfaceSchema.safeParse({mode:'solid',solidColor:'transparent'}).success,false)
})
test('legacy floors/images remain unchanged; switching surfaces retains calibration, geometry, size and history',()=>{
 const legacy=blankDungeon('old','Old',30,10),image=floorImageSchema.parse({imageId:randomUUID(),offsetX:2,rotation:270,scale:1.5,showGrid:false})
 assert.deepEqual(readDungeon(legacy),legacy);assert.equal(surfaceMode(legacy),'solid')
 let result=editMap({document:{...legacy,schemaVersion:4,floorImage:image,walls:[canonicalWall(2,3,'north')]},width:30,height:10},emptyHistory(),{type:'map.floorSurface.set',surface:{mode:'texture',texture}})
 assert.deepEqual(result.frame.document!.floorImage,image);assert.equal(result.frame.document!.width,30);assert.equal(result.frame.document!.height,10);assert.deepEqual(result.frame.document!.walls,[canonicalWall(2,3,'north')])
 result=editMap(result.frame,result.history,{type:'map.floorSurface.set',surface:{...result.frame.document!.floorSurface!,mode:'image'}});assert.deepEqual(result.frame.document!.floorSurface!.texture,texture);assert.deepEqual(result.frame.document!.floorImage,image)
 result=editMap(result.frame,result.history,{type:'map.undo'});assert.equal(surfaceMode(result.frame.document!),'texture');result=editMap(result.frame,result.history,{type:'map.redo'});assert.equal(surfaceMode(result.frame.document!),'image')
 assert.deepEqual(readDungeon(JSON.parse(JSON.stringify(result.frame.document))),result.frame.document)
})
test('different levels retain surfaces through duplication/removal, player projection and import/export',()=>{
 let result=editMap({document:blankDungeon('map','Levels'),width:20,height:20},emptyHistory(),{type:'map.floorSurface.set',surface:{mode:'texture',texture}})
 const apply=(c:MapCommand)=>{result=editMap(result.frame,result.history,c)}
 apply({type:'map.level.duplicate',id:'ground',newId:'upper',name:'Office',elevationFeet:15});assert.deepEqual(dungeonLevels(result.frame.document!)[1].floorSurface!.texture,texture)
 apply({type:'map.floorSurface.set',levelId:'upper',surface:{mode:'texture',texture:{...texture,assetId:'builtin:wood',rotation:90,brightness:.7,tint:'#abcdef'}}})
 const levels=dungeonLevels(result.frame.document!);assert.equal(levels[0].floorSurface!.texture!.assetId,'builtin:stone');assert.equal(levels[1].elevationFeet,15)
 const state=importEncounter({version:1,combatants:[],round:4,dungeonMap:result.frame.document});assert.equal(dungeonLevels(projectEncounter(state,{role:'player',id:'p'}).dungeonMap!).length,1)
 assert.throws(()=>applyMapEdit(state,{role:'player',id:'p'},{type:'map.floorSurface.set',surface:{mode:'solid'}},emptyHistory()),/Only the DM/)
 const exported=JSON.parse(JSON.stringify(state));assert.deepEqual(importEncounter({...exported,version:1}).dungeonMap,state.dungeonMap)
 apply({type:'map.level.remove',id:'upper'});assert.equal(dungeonLevels(result.frame.document!).length,1);apply({type:'map.undo'});assert.equal(dungeonLevels(result.frame.document!).length,2)
})
test('inactive custom textures and images remain deletion-protected in map/history references',()=>{
 const imageId=randomUUID(),assetId=randomUUID(),map={...blankDungeon('a','References'),schemaVersion:4 as const,floorImage:floorImageSchema.parse({imageId}),floorSurface:{mode:'solid' as const,texture:{...texture,assetId}}}
 assert.deepEqual(imageIds(map),[imageId,assetId]);assert.deepEqual(historyImageIds({undo:[{document:map,width:20,height:20}],redo:[]}),[imageId,assetId])
 assert.deepEqual(imageIds({...map,floorSurface:{mode:'texture',texture}}),[imageId])
})
