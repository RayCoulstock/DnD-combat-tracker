import {z} from 'zod'
const identifier=z.string().min(1).max(100).regex(/^[A-Za-z0-9_:-]+$/).refine(value=>!['__proto__','constructor','prototype'].includes(value))
export const transitionTypes=['stairs','ladder','trapdoor','pit','portal'] as const
export const movementCosts=['normal','difficult','dm-decides'] as const
export const transitionLocationSchema=z.object({floorId:identifier,x:z.number().int().min(0).max(49),z:z.number().int().min(0).max(49)}).strict()
export const transitionSchema=z.object({
 id:identifier,type:z.enum(transitionTypes),source:transitionLocationSchema,destination:transitionLocationSchema,
 directionality:z.enum(['one-way','two-way']),name:z.string().trim().max(150).optional(),movementCost:z.enum(movementCosts),
 assetId:z.uuid().optional(),dmNotes:z.string().max(10000).optional(),
}).strict()
export type FloorTransition=z.infer<typeof transitionSchema>
export type TransitionLocation=z.infer<typeof transitionLocationSchema>
export function transitionRoute(transition:FloorTransition,from:'source'|'destination'){
 if(from==='destination'&&transition.directionality!=='two-way')throw new Error('This transition is one-way.')
 return from==='source'?{source:transition.source,destination:transition.destination}:{source:transition.destination,destination:transition.source}
}
export const transitionSymbols:Record<FloorTransition['type'],string>={stairs:'▟',ladder:'☷',trapdoor:'▣',pit:'↓',portal:'◎'}
