import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { floorImageSchema, floorImageUv } from './floor-image.ts'
import { blankDungeon, canonicalWall, editMap, emptyHistory, readDungeon } from './dungeon.ts'
import { applyMapEdit, importEncounter, projectEncounter } from './domain.ts'
const image = floorImageSchema.parse({imageId:randomUUID()})
const close = (actual:number[],expected:number[]) => actual.forEach((value,index)=>assert.ok(Math.abs(value-expected[index])<1e-9,`${actual} != ${expected}`))
test('image UVs preserve north/east orientation, aspect, fit, alignment, offsets and quarter turns',()=>{
  close(floorImageUv(0,0,20,10,200,100,image),[0,1])
  close(floorImageUv(20,10,20,10,200,100,image),[1,0])
  close(floorImageUv(0,0,20,20,200,100,image),[0,1.5]) // letterbox, not stretched
  close(floorImageUv(0,0,20,20,200,100,{...image,fit:'cover'}),[.25,1])
  close(floorImageUv(0,0,20,20,200,100,{...image,alignment:'top-left'}),[0,1])
  close(floorImageUv(3,2,20,10,200,100,{...image,offsetX:3,offsetZ:2}),[0,1])
  close(floorImageUv(5,2.5,20,10,200,100,{...image,scale:.5}),[0,1])
  close(floorImageUv(10,0,10,20,200,100,{...image,rotation:90}),[0,1])
  close(floorImageUv(20,10,20,10,200,100,{...image,rotation:180}),[0,1])
  close(floorImageUv(0,20,10,20,200,100,{...image,rotation:270}),[0,1])
})
test('floor image metadata persists and replacement/removal participate in bounded map history',()=>{
  const legacy=blankDungeon('legacy','Legacy',20,20)
  assert.equal(readDungeon(legacy).floorImage,undefined)
  let result=editMap({document:legacy,width:20,height:20},emptyHistory(),{type:'map.floorImage.set',image,width:20,height:20})
  assert.equal(result.frame.document!.schemaVersion,4)
  const configured={...image,scale:1.5,rotation:90 as const,opacity:.4,offsetX:.25,locked:true,showGrid:false}
  result=editMap(result.frame,result.history,{type:'map.floorImage.set',image:configured,width:20,height:20})
  assert.deepEqual(readDungeon(JSON.parse(JSON.stringify(result.frame.document))).floorImage,configured)
  result=editMap(result.frame,result.history,{type:'map.floorImage.set',image:{...configured,imageId:randomUUID()},width:20,height:20})
  result=editMap(result.frame,result.history,{type:'map.floorImage.set',image:null,width:20,height:20})
  assert.equal(result.frame.document!.floorImage,undefined)
  result=editMap(result.frame,result.history,{type:'map.undo'})
  assert.notEqual(result.frame.document!.floorImage!.imageId,image.imageId)
  result=editMap(result.frame,result.history,{type:'map.undo'})
  assert.deepEqual(result.frame.document!.floorImage,configured)
  result=editMap(result.frame,result.history,{type:'map.redo'})
  assert.notEqual(result.frame.document!.floorImage!.imageId,image.imageId)
  assert.throws(()=>readDungeon({...legacy,floorImage:image}),/version 4/)
  for(const value of [{rotation:45},{scale:0},{offsetX:Infinity},{opacity:1.1},{imageId:'../x'}])assert.equal(floorImageSchema.safeParse({...image,...value}).success,false)
})
test('image resizing preserves valid coordinates and refuses to relocate combatants or objects',()=>{
  const state=importEncounter({version:1,round:1,combatants:[{id:1,name:'Hero',side:'hero',hp:10,maxHp:10,ac:10,initiative:10,conditions:[],saves:[],actions:[]}],dungeonMap:{...blankDungeon('map','Image',20,20),walls:[canonicalWall(8,9,'north')],props:[{id:'crate',type:'crate',position:{x:10,z:10},rotation:0}]}})
  state.battleMap.tokens['1']={x:15,z:15}
  const command={type:'map.floorImage.set' as const,image,width:25,height:25}
  const result=applyMapEdit(state,{id:'dm',role:'dm'},command,emptyHistory())
  assert.deepEqual(result.state.battleMap.tokens,state.battleMap.tokens)
  assert.deepEqual(result.state.dungeonMap!.walls,state.dungeonMap!.walls)
  assert.deepEqual(result.state.dungeonMap!.props,state.dungeonMap!.props)
  assert.equal(result.state.battleMap.gridSizeFeet,5)
  const moved={...result.state,battleMap:{...result.state.battleMap,tokens:{'1':{x:24,z:24}}}}
  assert.throws(()=>applyMapEdit(moved,{id:'dm',role:'dm'},{type:'map.undo'},result.history),/restored bounds/)
  assert.deepEqual(moved.battleMap.tokens['1'],{x:24,z:24})
  const restored=applyMapEdit(result.state,{id:'dm',role:'dm'},{type:'map.undo'},result.history)
  assert.deepEqual(restored.state.battleMap.tokens,state.battleMap.tokens)
  assert.throws(()=>applyMapEdit(state,{id:'dm',role:'dm'},{...command,width:10,height:10},emptyHistory()),/combatants/)
  assert.throws(()=>editMap({document:state.dungeonMap!,width:20,height:20},emptyHistory(),{...command,width:5,height:5}),/wall|prop/i)
  assert.throws(()=>applyMapEdit(state,{id:'player',role:'player'},command,emptyHistory()),/Only the DM/)
  assert.deepEqual(projectEncounter(result.state,{id:'player',role:'player'}).dungeonMap!.floorImage,image)
})
