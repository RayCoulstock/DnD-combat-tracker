import {z} from 'zod'
export const effectIdSchema=z.string().min(1).max(100).regex(/^[A-Za-z0-9_:-]+$/).refine(s=>!['__proto__','constructor','prototype'].includes(s))
export const effectCategories=['Elemental','Atmospheric','Magical','Environmental','Energy'] as const
export const effectParametersSchema=z.object({
 scale:z.number().finite().min(.1).max(5),intensity:z.number().finite().min(0).max(2),speed:z.number().finite().min(0).max(4),
 color:z.string().regex(/^#[0-9a-fA-F]{6}$/),opacity:z.number().finite().min(0).max(1),
}).strict()
export const effectRegistry={
 'magical-motes':{id:'magical-motes',name:'Magical motes',category:'Magical',icon:'✦',description:'A bounded cloud of softly drifting magical lights.',
  defaults:{scale:1,intensity:1,speed:1,color:'#97e8ce',opacity:.7},parameters:effectParametersSchema,
  renderer:'motes',resources:{geometry:'seeded-points',textures:0},quality:{low:12,medium:32,high:64},radius:1.5,lighting:false,attachments:false},
} as const
export type EffectPresetId=keyof typeof effectRegistry
export const effectSchema=effectParametersSchema.extend({id:effectIdSchema,presetId:z.enum(['magical-motes']),floorId:effectIdSchema,
 position:z.object({x:z.number().finite().min(0).max(50),z:z.number().finite().min(0).max(50),heightFeet:z.number().finite().min(0).max(500)}).strict(),
 rotation:z.number().finite().min(0).max(360),enabled:z.boolean(),
}).strict()
export const environmentalEffectsSchema=z.object({version:z.literal(1),effects:z.array(effectSchema).max(64).refine(a=>new Set(a.map(e=>e.id)).size===a.length,'Effect IDs must be unique.')}).strict()
export type EnvironmentalEffect=z.infer<typeof effectSchema>
export function createEffect(id:string,presetId:EffectPresetId,floorId:string,position:EnvironmentalEffect['position']):EnvironmentalEffect{
 return effectSchema.parse({...effectRegistry[presetId].defaults,id,presetId,floorId,position,rotation:0,enabled:true})
}
