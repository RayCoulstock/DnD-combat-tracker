import test from 'node:test'
import assert from 'node:assert/strict'
import {calibrationSchema,architecturalVisualSchema,edgePose} from './architecture.ts'
import {blankDungeon,canonicalWall,readDungeon,editMap,emptyHistory,type MapFrame} from './dungeon.ts'
const visual=architecturalVisualSchema.parse({assetId:'11111111-1111-4111-8111-111111111111',calibration:{}})
test('architectural calibration is bounded, one-edge only and serializable',()=>{
  for(const patch of[{gridSpan:2},{scale:0},{scale:11},{verticalOffset:Infinity},{facing:'up'},{horizontalOffset:2},{rotationCorrection:181},{url:'https://evil'}])assert.throws(()=>calibrationSchema.parse(patch))
  assert.deepEqual(architecturalVisualSchema.parse(JSON.parse(JSON.stringify(visual))),visual)
  for(const version of[1,2]as const)assert.equal(readDungeon({...blankDungeon('m','Map'),schemaVersion:version}).schemaVersion,version)
})
test('canonical four-edge placement stays aligned with logical grid edges',()=>{
  assert.deepEqual(edgePose(canonicalWall(2,3,'north'),20,20),{x:-7.5,z:-7,rotation:0})
  assert.deepEqual(edgePose(canonicalWall(2,3,'south'),20,20),{x:-7.5,z:-6,rotation:0})
  assert.deepEqual(edgePose(canonicalWall(2,3,'east'),20,20),{x:-7,z:-6.5,rotation:Math.PI/2})
  assert.deepEqual(edgePose(canonicalWall(2,3,'west'),20,20),{x:-8,z:-6.5,rotation:Math.PI/2})
  assert.equal(canonicalWall(2,3,'east').id,canonicalWall(3,3,'west').id)
})
test('wall and door appearance changes preserve identity, states and authoritative undo/redo',()=>{
  let result={frame:{document:blankDungeon('m','Map'),width:20,height:20}as MapFrame,history:emptyHistory()}
  const edit=(command:Parameters<typeof editMap>[2])=>{result=editMap(result.frame,result.history,command)}
  const wall=canonicalWall(2,3,'east');edit({type:'map.wall.place',wall})
  edit({type:'map.wall.visual',wallId:wall.id,visual});assert.equal(result.frame.document!.schemaVersion,3)
  const door={id:'door',wallId:wall.id,state:'open' as const,visual};edit({type:'map.door.place',door})
  edit({type:'map.door.update',doorId:door.id,state:'locked'});assert.deepEqual(result.frame.document!.doors[0].visual,visual)
  edit({type:'map.door.visual',doorId:door.id,visual:null});edit({type:'map.undo'});assert.deepEqual(result.frame.document!.doors[0].visual,visual)
  edit({type:'map.redo'});assert.equal(result.frame.document!.doors[0].visual,undefined)
  edit({type:'map.wall.remove',wallId:wall.id});assert.equal(result.frame.document!.doors.length,0)
  edit({type:'map.undo'});assert.equal(result.frame.document!.walls[0].id,wall.id);assert.equal(result.frame.document!.doors[0].state,'locked')
  const doc=result.frame.document!;assert.throws(()=>readDungeon({...doc,schemaVersion:2}));assert.deepEqual(readDungeon(JSON.parse(JSON.stringify(doc))),doc)
})

test('unified object selection retains every procedural prop with search and categories',async()=>{
  const {builtinObjects,filterBuiltinObjects}=await import('./objectPalette.ts'),{propTypes}=await import('./dungeon.ts')
  assert.deepEqual(builtinObjects.map(o=>o.type),[...propTypes]);assert.equal(filterBuiltinObjects(' CHAIR ','furniture')[0].type,'chair')
  assert.equal(filterBuiltinObjects('chair','terrain').length,0);assert.equal(filterBuiltinObjects('','architecture')[0].type,'pillar')
})
