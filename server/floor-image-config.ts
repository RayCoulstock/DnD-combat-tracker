import { z } from 'zod'
const integer = (value: string | undefined, fallback: number, max: number) => z.coerce.number().int().positive().max(max).parse(value ?? fallback)
export function floorImageLimits(env: NodeJS.ProcessEnv = process.env) {
  return {
    maxBytes: integer(env.FLOOR_IMAGE_MAX_BYTES, 15 * 1024 * 1024, 25 * 1024 * 1024),
    maxDimension: integer(env.FLOOR_IMAGE_MAX_DIMENSION, 8192, 16384),
    maxPixels: integer(env.FLOOR_IMAGE_MAX_PIXELS, 32 * 1024 * 1024, 64 * 1024 * 1024),
    textureDimension: integer(env.FLOOR_IMAGE_TEXTURE_DIMENSION, 4096, 4096),
    timeoutMs: integer(env.FLOOR_IMAGE_TIMEOUT_MS, 20000, 30000),
  }
}
export type FloorImageLimits = ReturnType<typeof floorImageLimits>
