import { z } from 'zod'
import { assetAppearanceSchema, type Asset3D } from './assets.ts'
export const miniatureSizes = ['Small', 'Medium', 'Large', 'Huge'] as const
export const miniatureSchema = assetAppearanceSchema.extend({
  assetId: z.uuid().nullable().default(null), scale: assetAppearanceSchema.shape.scale.default(1),
  rotation: assetAppearanceSchema.shape.rotation.default(0), verticalOffset: assetAppearanceSchema.shape.verticalOffset.default(0),
  showBase: z.boolean().default(true), baseSize: z.enum(miniatureSizes).default('Medium'),
}).strict()
export type MiniatureAppearance = z.infer<typeof miniatureSchema>
export function inferBaseSize(role = '', size?: unknown): MiniatureAppearance['baseSize'] {
  const value = `${typeof size === 'string' ? size : ''} ${role}`
  return miniatureSizes.find(s => new RegExp(`\\b${s}\\b`, 'i').test(value)) ?? 'Medium'
}
export const baseFootprint = (size: MiniatureAppearance['baseSize']) => size === 'Huge' ? 3 : size === 'Large' ? 2 : 1
export function appearanceFromAsset(asset: Asset3D, baseSize: MiniatureAppearance['baseSize'] = 'Medium'): MiniatureAppearance {
  return miniatureSchema.parse({ assetId: asset.id, scale: asset.presentation.defaultScale, rotation: asset.presentation.defaultRotation, verticalOffset: asset.presentation.verticalOffset, baseSize })
}
