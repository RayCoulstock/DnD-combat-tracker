import { z } from 'zod'
import { assetCategories } from './assets.ts'
// Shared configuration: changing these bounds changes both validation and editor limits.
export const sceneryLimits = { minScale: .01, maxScale: 20, minOffset: -10, maxOffset: 20, maxInstances: 100 } as const
export const sceneryPositionSchema = z.object({ x: z.number().finite().min(0).max(50), z: z.number().finite().min(0).max(50) }).strict()
export const sceneryTransformSchema = z.object({ position: sceneryPositionSchema, rotation: z.number().finite().min(0).max(360), scale: z.number().finite().min(sceneryLimits.minScale).max(sceneryLimits.maxScale), verticalOffset: z.number().finite().min(sceneryLimits.minOffset).max(sceneryLimits.maxOffset), visible: z.boolean() }).strict()
export const scenerySchema = sceneryTransformSchema.extend({ id: z.string().min(1).max(100).regex(/^[A-Za-z0-9_:-]+$/).refine(s => !['__proto__','constructor','prototype'].includes(s)), type: z.literal('asset'), assetId: z.uuid(), label: z.string().trim().min(1).max(150).default('Scenery'), category: z.enum(assetCategories).default('decoration') }).strict()
export type SceneryProp = z.infer<typeof scenerySchema>
export const isScenery = (prop: { type: string }): prop is SceneryProp => prop.type === 'asset'
export function sceneryAtPoint(x: number, z: number, width: number, height: number, snap: boolean) {
  return { x: Math.max(0, Math.min(width-1, snap ? Math.floor(x) : x-.5)), z: Math.max(0, Math.min(height-1, snap ? Math.floor(z) : z-.5)) }
}
