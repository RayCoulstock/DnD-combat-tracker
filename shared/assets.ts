import { z } from 'zod'
export const assetCategories = ['miniature', 'monster', 'furniture', 'architecture', 'terrain', 'decoration'] as const
export const assetPresentationSchema = z.object({
  defaultScale: z.number().finite().min(.0001).max(10000).default(1),
  defaultRotation: z.number().finite().min(0).max(360).default(0),
  verticalOffset: z.number().finite().min(-10000).max(10000).default(0),
  displayName: z.string().trim().max(150).default(''),
}).strict()
export const assetMetadataSchema = z.object({
  name: z.string().trim().min(1).max(150), description: z.string().trim().max(2000).default(''),
  category: z.enum(assetCategories), tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  source: z.string().trim().max(150).default('Meshy AI'), presentation: assetPresentationSchema.default(() => assetPresentationSchema.parse({})),
}).strict()
export type AssetMetadata = z.infer<typeof assetMetadataSchema>
export interface AssetMetrics { vertices: number; triangles: number; nodes: number; materials: number; animations: number; textures: number }
export interface Asset3D extends AssetMetadata {
  id: string; revision: number; fileName: string; fileSize: number; contentType: 'model/gltf-binary'; format: 'glb'
  uploadStatus: 'processing' | 'ready' | 'deleting' | 'deleted'; validationStatus: 'valid'; metrics: AssetMetrics
  createdAt: string; updatedAt: string
}
// Future instances copy defaults and may override them. No battlefield integration in 4A.
export const assetAppearanceSchema = z.object({ assetId: z.uuid(), scale: z.number().positive().finite().max(10000), rotation: z.number().finite().min(0).max(360), verticalOffset: z.number().finite().min(-10000).max(10000) }).strict()
