import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {groupWriteSchema,groupAddSchema,groupInstanceName} from './groupPresets.ts'
import {commandSchema,applyCommand,emptyEncounter} from './domain.ts'
const member=()=>({id:randomUUID(),entryId:randomUUID(),quantity:1,side:null,displayName:null})
const preset=()=>({name:'Party',description:'',campaignId:null,members:[member()],revision:0,archived:false})
const command=()=>({type:'group.add',requestId:randomUUID(),presetId:randomUUID(),presetRevision:1,placement:'roster',selections:[{memberId:randomUUID(),quantity:1,instanceIds:[randomUUID()],useSavedState:true,allowDuplicate:false}]})
test('preset references, nullable missing members and campaign/general scope normalize without copied stats',()=>{
 const data=preset();assert.equal(groupWriteSchema.parse(data).campaignId,null);const campaignId=randomUUID();assert.equal(groupWriteSchema.parse({...data,campaignId}).campaignId,campaignId)
 assert.equal(groupWriteSchema.safeParse({...preset(),members:[{...member(),entryId:null}]}).success,true)
 assert.equal(groupWriteSchema.safeParse({...preset(),members:[{...member(),definition:{hp:99}}]}).success,false)
})
test('preset limits, quantities, allegiance and stable unique member IDs are validated',()=>{
 for(const quantity of [0,-1,1.5,21])assert.equal(groupWriteSchema.safeParse({...preset(),members:[{...member(),quantity}]}).success,false)
 const m=member();assert.equal(groupWriteSchema.safeParse({...preset(),members:[m,m]}).success,false)
 assert.equal(groupWriteSchema.safeParse({...preset(),members:[{...member(),quantity:20},member()]}).success,false)
 for(const side of ['hero','enemy','neutral',null])assert.equal(groupWriteSchema.safeParse({...preset(),members:[{...member(),side}]}).success,true)
})
test('batch schema requires exact distinct IDs, bounded selections and supported placement',()=>{
 const c=command();assert.equal(commandSchema.safeParse(c).success,true)
 for(const change of [{placement:'staging'},{selections:[]},{presetRevision:0}])assert.equal(groupAddSchema.safeParse({...c,...change}).success,false)
 const s=c.selections[0];assert.equal(groupAddSchema.safeParse({...c,selections:[{...s,quantity:2}]}).success,false)
 assert.equal(groupAddSchema.safeParse({...c,selections:[s,{...s,memberId:randomUUID()}]}).success,false)
 assert.equal(groupAddSchema.safeParse({...c,selections:[{...s,quantity:21,instanceIds:Array.from({length:21},()=>randomUUID())}]}).success,false)
})
test('group names remain bounded with distinguishable suffixes and client-only group creation is rejected',()=>{
 assert.equal(groupInstanceName('Warehouse Guard',4),'Warehouse Guard 4');assert.equal(groupInstanceName('x'.repeat(200),20).length,200)
 assert.throws(()=>applyCommand(emptyEncounter(),{role:'player',id:'p'},commandSchema.parse(command())),{code:'FORBIDDEN'})
 assert.throws(()=>applyCommand(emptyEncounter(),{role:'dm',id:'d'},commandSchema.parse(command())),{code:'INVALID'})
})
