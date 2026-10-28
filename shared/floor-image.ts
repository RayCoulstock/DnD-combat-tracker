import { z } from 'zod'

export const floorImageSchema = z.object({
  imageId: z.uuid(),
  mode: z.enum(['gridded', 'gridless']).default('gridless'),
  fit: z.enum(['contain', 'cover']).default('contain'),
  alignment: z.enum(['center', 'top-left']).default('center'),
  offsetX: z.number().finite().min(-100).max(100).default(0),
  offsetZ: z.number().finite().min(-100).max(100).default(0),
  scale: z.number().finite().min(.01).max(20).default(1),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  opacity: z.number().finite().min(0).max(1).default(1),
  showGrid: z.boolean().default(true),
  locked: z.boolean().default(true),
}).strict()
export type FloorImage = z.infer<typeof floorImageSchema>
export interface FloorImageAsset { id: string; width: number; height: number; fileSize: number; revision: number }

// Logical map coordinates: x increases east, z increases south. Image top is north.
// Return conventional texture UVs (v=1 is the top). Outside [0,1] is letterbox.
export function floorImageUv(x: number, z: number, mapWidth: number, mapHeight: number, imageWidth: number, imageHeight: number, image: FloorImage): [number, number] {
  const quarter = image.rotation === 90 || image.rotation === 270
  const rotatedWidth = quarter ? imageHeight : imageWidth, rotatedHeight = quarter ? imageWidth : imageHeight
  const factor = (image.fit === 'contain' ? Math.min(mapWidth / rotatedWidth, mapHeight / rotatedHeight) : Math.max(mapWidth / rotatedWidth, mapHeight / rotatedHeight)) * image.scale
  const width = imageWidth * factor, height = imageHeight * factor
  const centreX = (image.alignment === 'center' ? mapWidth / 2 : rotatedWidth * factor / 2) + image.offsetX
  const centreZ = (image.alignment === 'center' ? mapHeight / 2 : rotatedHeight * factor / 2) + image.offsetZ
  const angle = image.rotation * Math.PI / 180, dx = x - centreX, dz = z - centreZ
  return [.5 + (dx * Math.cos(angle) + dz * Math.sin(angle)) / width, .5 - (-dx * Math.sin(angle) + dz * Math.cos(angle)) / height]
}
