import {z} from 'zod'
const point=z.object({x:z.number().finite().min(0).max(100),z:z.number().finite().min(0).max(100)}).strict()
export const measurementRules=['euclidean','diagonal-one','diagonal-alternating'] as const
export const templateSchema=z.object({kind:z.literal('template'),shape:z.enum(['sphere','cone','cube','line']),position:point,
 radius:z.number().finite().min(1).max(250),length:z.number().finite().min(1).max(500),width:z.number().finite().min(1).max(100),side:z.number().finite().min(1).max(250),angle:z.number().finite().min(15).max(180),
 rotation:z.number().finite().min(0).max(360),elevation:z.number().finite().min(0).max(100),color:z.string().regex(/^#[0-9a-fA-F]{6}$/),opacity:z.number().finite().min(.08).max(.45),
}).strict()
export const measurementSchema=z.object({kind:z.literal('measurement'),start:point,end:point,rule:z.enum(measurementRules)}).strict()
export const tacticalObjectSchema=z.discriminatedUnion('kind',[templateSchema,measurementSchema])
const identity={floorId:z.string().min(1).max(100).optional(),id:z.uuid(),ownerId:z.string().min(1).max(100),expiresAt:z.number().finite().optional()}
export const tacticalRecordSchema=z.discriminatedUnion('kind',[templateSchema.extend(identity),measurementSchema.extend(identity)]).superRefine((r,ctx)=>{if(r.kind==='template'&&r.expiresAt!==undefined||r.kind==='measurement'&&r.expiresAt===undefined)ctx.addIssue({code:'custom',message:'Only shared measurements require an expiry.'})})
export type TacticalObject=z.infer<typeof tacticalObjectSchema>
export type TacticalRecord=z.infer<typeof tacticalRecordSchema>
export type Template=z.infer<typeof templateSchema>
export const tacticalCommands=[
 z.object({type:z.literal('tactical.create'),id:z.uuid(),object:tacticalObjectSchema,floorId:z.string().min(1).max(100).optional()}).strict(),
 z.object({type:z.literal('tactical.update'),id:z.uuid(),object:tacticalObjectSchema,floorId:z.string().min(1).max(100).optional()}).strict(),
 z.object({type:z.literal('tactical.remove'),id:z.uuid()}).strict(),
 z.object({type:z.literal('tactical.clear')}).strict(),
]as const
export function measurementDistance(start:{x:number;z:number},end:{x:number;z:number},feet:number,rule:typeof measurementRules[number]){
 const x=Math.abs(end.x-start.x),z=Math.abs(end.z-start.z)
 if(rule==='euclidean')return Math.hypot(x,z)*feet
 const dx=Math.round(x),dz=Math.round(z)
 return (Math.max(dx,dz)+(rule==='diagonal-alternating'?Math.floor(Math.min(dx,dz)/2):0))*feet
}
export const feetToWorld=(feet:number,feetPerSquare:number)=>feet/feetPerSquare
export function assertTacticalBounds(object:TacticalObject,width:number,height:number){
 const points=object.kind==='measurement'?[object.start,object.end]:[object.position]
 if(points.some(p=>p.x>width||p.z>height))throw new Error('Overlay anchor is outside the battlefield.')
}
export const activeTactical=(records:TacticalRecord[]|undefined,now:number)=>records?.filter(r=>r.expiresAt===undefined||r.expiresAt>now)??[]
