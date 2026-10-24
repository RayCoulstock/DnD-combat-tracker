import { z } from 'zod'
export const architectureLimits={maxInstances:200} as const
export const architectureRoles = ['scenery', 'wall', 'door', 'other'] as const
// One edge only. Uniform scaling preserves proportions; no multi-edge stretching.
export const calibrationSchema = z.object({
  gridSpan: z.literal(1).default(1),
  facing: z.enum(['+Z', '-Z', '+X', '-X']).default('+Z'),
  scale: z.number().finite().min(.05).max(10).default(1),
  verticalOffset: z.number().finite().min(-10).max(20).default(0),
  alignment: z.enum(['centre', 'start', 'end']).default('centre'),
  horizontalOffset: z.number().finite().min(-.5).max(.5).default(0),
  rotationCorrection: z.number().finite().min(-180).max(180).default(0),
}).strict()
export const architecturalMetadataSchema = calibrationSchema.extend({role:z.enum(architectureRoles).default('scenery')})
export const architecturalVisualSchema = z.object({assetId:z.uuid(), calibration:calibrationSchema}).strict()
export type Calibration = z.infer<typeof calibrationSchema>
export type ArchitecturalVisual = z.infer<typeof architecturalVisualSchema>
export const facingRotation = (c:Calibration) => ({'+Z':0,'-Z':180,'+X':-90,'-X':90}[c.facing] + c.rotationCorrection) * Math.PI/180
export function edgePose(wall:{axis:'H'|'V';x:number;z:number},width:number,height:number){
  return {x:wall.x-width/2+(wall.axis==='H'?.5:0),z:wall.z-height/2+(wall.axis==='V'?.5:0),rotation:wall.axis==='H'?0:Math.PI/2}
}
