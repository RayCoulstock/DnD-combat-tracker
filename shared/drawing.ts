import {z} from 'zod'
import {architecturalVisualSchema} from './architecture.ts'
const vertex=z.object({x:z.number().int().min(0).max(50),z:z.number().int().min(0).max(50)}).strict()
export const drawingSchema=z.object({
  type:z.literal('map.draw'),kind:z.enum(['wall-line','room','corridor']),start:vertex,end:vertex,
  width:z.number().int().min(1).max(10).default(1),wallsOnly:z.boolean().default(false),
  floor:z.enum(['stone','wood','dirt','grass','lava']),material:z.enum(['stone','wood']),visual:architecturalVisualSchema.optional(),
}).strict()
export type Drawing=z.infer<typeof drawingSchema>
export interface DrawWall{x:number;z:number;axis:'H'|'V';id:string;material:'stone'|'wood';visual?:z.infer<typeof architecturalVisualSchema>}
export function snapAxis(a:{x:number;z:number},b:{x:number;z:number}){return Math.abs(b.x-a.x)>=Math.abs(b.z-a.z)?{x:b.x,z:a.z}:{x:a.x,z:b.z}}
export function drawingBatch(input:Drawing,width:number,height:number){
 const d=drawingSchema.parse(input),floors:{x:number;z:number;type:Drawing['floor']}[]=[],walls:DrawWall[]=[]
 const add=(axis:'H'|'V',x:number,z:number)=>walls.push({id:`${axis}:${x}:${z}`,axis,x,z,material:d.material,...(d.visual?{visual:d.visual}:{})})
 const end=d.kind==='room'?d.end:snapAxis(d.start,d.end),x0=Math.min(d.start.x,end.x),x1=Math.max(d.start.x,end.x),z0=Math.min(d.start.z,end.z),z1=Math.max(d.start.z,end.z)
 if(d.start.x>width||end.x>width||d.start.z>height||end.z>height)throw new Error('Drawing is outside map bounds.')
 if(d.kind==='wall-line'){
  if(x0===x1&&z0===z1)throw new Error('Drag at least one grid edge.')
  if(z0===z1)for(let x=x0;x<x1;x++)add('H',x,z0)
  else for(let z=z0;z<z1;z++)add('V',x0,z)
 }else{
  const right=d.kind==='corridor'&&x0===x1?x0+d.width:x1,bottom=d.kind==='corridor'&&z0===z1?z0+d.width:z1
  if(right>width||bottom>height||right===x0||bottom===z0)throw new Error('Choose a non-empty rectangle or an in-bounds corridor.')
  for(let z=z0;z<bottom;z++)for(let x=x0;x<right;x++)floors.push({x,z,type:d.floor})
  for(let x=x0;x<right;x++){add('H',x,z0);add('H',x,bottom)}
  for(let z=z0;z<bottom;z++){add('V',x0,z);add('V',right,z)}
 }
 return{floors:d.kind==='room'&&d.wallsOnly?[]:floors,walls,area:floors}
}
