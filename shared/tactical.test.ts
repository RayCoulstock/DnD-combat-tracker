import test from 'node:test'
import assert from 'node:assert/strict'
import {templateSchema,measurementDistance,feetToWorld,activeTactical} from './tactical.ts'
import {applyCommand,emptyEncounter,commandSchema,projectEncounter,durableEncounter} from './domain.ts'
const id='11111111-1111-4111-8111-111111111111',dm={role:'dm' as const,id:'dm'},player={role:'player' as const,id:'player'}
const template=()=>templateSchema.parse({kind:'template',shape:'sphere',position:{x:2,z:3},radius:20,length:15,width:5,side:15,angle:90,rotation:0,elevation:0,color:'#22aaff',opacity:.2})
test('ruler conversion uses configured scale and explicit grid diagonal rules',()=>{
 assert.equal(measurementDistance({x:0,z:0},{x:3,z:4},5,'euclidean'),25)
 assert.equal(measurementDistance({x:0,z:0},{x:3,z:3},5,'diagonal-one'),15)
 assert.equal(measurementDistance({x:0,z:0},{x:3,z:3},5,'diagonal-alternating'),20)
 assert.equal(measurementDistance({x:0,z:0},{x:2,z:2},10,'diagonal-alternating'),30);assert.equal(feetToWorld(20,10),2)
})
test('tactical records bind ownership, persist templates, expire measurements and stay outside map history',()=>{
 let state=applyCommand(emptyEncounter(),player,{type:'tactical.create',id,object:template()},100)
 assert.equal(state.tactical![0].ownerId,'player');assert.equal(projectEncounter(state,dm).tactical!.length,1)
 assert.throws(()=>applyCommand(state,{role:'player',id:'other'},{type:'tactical.update',id,object:{...template(),radius:30}},100),/owner or DM/)
 state=applyCommand(state,dm,{type:'tactical.update',id,object:{...template(),rotation:90}},100)
 assert.equal(state.tactical![0].ownerId,'player');assert.equal(state.tactical![0].kind,'template')
 assert.equal(state.dungeonMap,undefined)
 state=applyCommand(state,player,{type:'tactical.create',id:'22222222-2222-4222-8222-222222222222',object:{kind:'measurement',start:{x:1,z:1},end:{x:3,z:3},rule:'euclidean'}},100)
 assert.equal(durableEncounter(state).tactical!.length,1);assert.equal(activeTactical(state.tactical,120101).length,1)
 assert.throws(()=>applyCommand(state,player,{type:'tactical.clear'}),/Only the DM/)
 assert.equal(applyCommand(state,dm,{type:'tactical.clear'}).tactical!.length,0)
 assert.equal(commandSchema.safeParse({type:'tactical.create',id,object:{...template(),ownerId:'dm'}}).success,false)
 for(const patch of[{opacity:1},{color:'red'},{radius:-1},{angle:360}])assert.throws(()=>templateSchema.parse({...template(),...patch}))
})
