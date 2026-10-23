import { z } from 'zod'
const integer = (value: string | undefined, fallback: number, max: number) => z.coerce.number().int().positive().max(max).parse(value ?? fallback)
export function assetLimits(env: NodeJS.ProcessEnv = process.env) {
  return {
    maxBytes: integer(env.ASSET_MAX_BYTES, 25 * 1024 * 1024, 100 * 1024 * 1024),
    maxVertices: integer(env.ASSET_MAX_VERTICES, 500000, 2000000), maxTriangles: integer(env.ASSET_MAX_TRIANGLES, 500000, 2000000),
    maxNodes: integer(env.ASSET_MAX_NODES, 1000, 5000), maxMaterials: integer(env.ASSET_MAX_MATERIALS, 128, 512),
    maxAnimations: integer(env.ASSET_MAX_ANIMATIONS, 16, 64), maxTextures: integer(env.ASSET_MAX_TEXTURES, 64, 256),
    maxTextureDimension: integer(env.ASSET_MAX_TEXTURE_DIMENSION, 4096, 8192), maxTexturePixels: integer(env.ASSET_MAX_TEXTURE_PIXELS, 64 * 1024 * 1024, 128 * 1024 * 1024),
    timeoutMs: integer(env.ASSET_VALIDATION_TIMEOUT_MS, 15000, 60000),
  }
}
export type AssetLimits = ReturnType<typeof assetLimits>
