import test from 'node:test'
import assert from 'node:assert/strict'
import {drawingBatch,drawingSchema} from './drawing.ts'
import {blankDungeon,canonicalWall,editMap,emptyHistory} from './dungeon.ts'
const command=(kind:'room'|'wall-line'|'corridor',start={x:2,z:2},end={x:6,z:5})=>drawingSchema.parse({type:'map.draw',kind,start,end,floor:'stone',material:'wood',width:2})
test('drawing batches use canonical unique edges, dominant-axis lines and bounded rooms',()=>{
 assert.equal(drawingBatch(command('wall-line'),20,20).walls.length,4)
 assert.equal(drawingBatch(command('wall-line',{x:2,z:2},{x:2,z:8}),20,20).walls.length,6)
 const room=drawingBatch(command('room'),20,20);assert.equal(room.floors.length,12);assert.equal(room.walls.length,14);assert.equal(new Set(room.walls.map(w=>w.id)).size,14)
 assert.throws(()=>drawingBatch(command('room'),4,4));assert.equal(drawingBatch({...command('room'),wallsOnly:true},20,20).floors.length,0)
})
test('batch edits preserve doors, props and custom walls, connect corridor floors and undo as one frame',()=>{
 const wall=canonicalWall(2,2,'north'),map={...blankDungeon('map','Room'),walls:[wall],doors:[{id:'door',wallId:wall.id,state:'locked' as const}],props:[{id:'crate',type:'crate' as const,position:{x:3,z:3},rotation:0 as const}]}
 const result=editMap({document:map,width:20,height:20},emptyHistory(),command('room'))
 assert.equal(result.history.undo.length,1);assert.equal(result.frame.document!.doors[0].id,'door');assert.equal(result.frame.document!.props[0].id,'crate');assert.equal(result.frame.document!.walls.filter(w=>w.id===wall.id).length,1)
 const corridor=editMap(result.frame,result.history,command('corridor',{x:4,z:3},{x:10,z:3}))
 assert.equal(corridor.frame.document!.doors.length,1);assert.ok(!corridor.frame.document!.walls.some(w=>w.id==='V:6:3'))
 const undo=editMap(corridor.frame,corridor.history,{type:'map.undo'});assert.deepEqual(undo.frame,result.frame)
})

test('built-in scenery transforms and duplicate placements remain in the same atomic map history',()=>{
 const frame={document:{...blankDungeon('map','Furniture'),props:[{id:'chair',type:'chair' as const,position:{x:2,z:2},rotation:0 as const}]},width:20,height:20}
 const changed=editMap(frame,emptyHistory(),{type:'map.prop.transform',propId:'chair',position:{x:4,z:5},rotation:90,scale:2})
 assert.equal(changed.frame.document!.props[0].scale,2);assert.deepEqual(editMap(changed.frame,changed.history,{type:'map.undo'}).frame,frame)
})

test('corridors cut only their connecting walls and retain unrelated architecture',()=>{
 const room=editMap({document:blankDungeon('map','Room'),width:20,height:20},emptyHistory(),command('room'))
 const visual={assetId:'11111111-1111-4111-8111-111111111111',calibration:{gridSpan:1 as const,facing:'+Z' as const,scale:1,verticalOffset:0,alignment:'centre' as const,horizontalOffset:0,rotationCorrection:0}}
 const document={...room.frame.document!,schemaVersion:3 as const,walls:room.frame.document!.walls.map(w=>w.id==='V:6:3'?{...w,visual}:w).concat({...canonicalWall(15,15,'west'),visual})}
 const result=editMap({...room.frame,document},room.history,command('corridor',{x:4,z:3},{x:10,z:3}))
 assert.equal(result.frame.document!.walls.some(w=>w.id==='V:6:3'),false)
 assert.ok(result.frame.document!.walls.find(w=>w.id==='V:15:15')!.visual)
})
