import test from 'node:test'
import assert from 'node:assert/strict'
import { blankDungeon, readDungeon, editMap, emptyHistory, type MapFrame } from './dungeon.ts'
import { scenerySchema, sceneryAtPoint } from './scenery.ts'
const assetId='11111111-1111-4111-8111-111111111111'
export const scenery=()=>scenerySchema.parse({id:'scenery',type:'asset',assetId,position:{x:2,z:3},rotation:0,scale:1,verticalOffset:0,visible:true})
test('version 1 stays compatible; version 2 permits strictly validated mixed scenery',()=>{
  const old=blankDungeon('map','Map');assert.equal(readDungeon(old).schemaVersion,1)
  assert.throws(()=>readDungeon({...old,props:[scenery()]}))
  const map=readDungeon({...old,schemaVersion:2,props:[scenery(),{id:'crate',type:'crate',position:{x:1,z:1},rotation:0}]})
  assert.deepEqual(readDungeon(JSON.parse(JSON.stringify(map))),map)
  for(const patch of [{assetId:'https://external/model.glb'},{scale:0},{scale:21},{rotation:361},{verticalOffset:Infinity},{url:'evil'}])assert.throws(()=>scenerySchema.parse({...scenery(),...patch}))
  assert.throws(()=>readDungeon({...map,width:4,props:[{...scenery(),position:{x:3.5,z:1}}]}))
  assert.throws(()=>readDungeon({...map,schemaVersion:5}))
  assert.deepEqual(sceneryAtPoint(2.8,3.7,20,20,true),{x:2,z:3});assert.deepEqual(sceneryAtPoint(2.8,3.7,20,20,false),{x:2.3,z:3.2})
})
test('scenery place/update/duplicate/remove and bounded authoritative undo/redo share map history',()=>{
  let result={frame:{document:blankDungeon('map','Map'),width:20,height:20}as MapFrame,history:emptyHistory()}
  const edit=(command:Parameters<typeof editMap>[2])=>{result=editMap(result.frame,result.history,command)}
  edit({type:'map.scenery.place',prop:scenery()});assert.equal(result.frame.document!.schemaVersion,2)
  edit({type:'map.scenery.update',propId:'scenery',transform:{position:{x:4.25,z:5.5},rotation:45,scale:2,verticalOffset:1,visible:false}})
  edit({type:'map.scenery.duplicate',propId:'scenery',newId:'copy',position:{x:6,z:6}})
  assert.equal(result.frame.document!.props.length,2);assert.equal(result.frame.document!.props[0].position.x,4.25)
  edit({type:'map.scenery.remove',propId:'scenery'});edit({type:'map.undo'});assert.equal(result.frame.document!.props.length,2)
  edit({type:'map.redo'});assert.equal(result.frame.document!.props.length,1)
  edit({type:'map.history.clear'});assert.equal(result.history.undo.length,0);assert.equal(result.history.redo.length,0)
})

test('excessive custom scenery and out-of-bounds transforms fail atomically',()=>{
  const map={...blankDungeon('map','Map'),schemaVersion:2 as const,props:Array.from({length:101},(_,i)=>({...scenery(),id:'prop-'+i}))}
  assert.throws(()=>readDungeon(map),/Too many/)
  const frame={document:readDungeon({...map,props:[scenery()]}),width:20,height:20}
  assert.throws(()=>editMap(frame,emptyHistory(),{type:'map.scenery.update',propId:'scenery',transform:{position:{x:25,z:2},rotation:0,scale:1,verticalOffset:0,visible:true}}))
  assert.equal(frame.document.props[0].position.x,2)
})
