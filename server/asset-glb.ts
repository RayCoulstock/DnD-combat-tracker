import { z } from 'zod'
import { validateBytes } from 'gltf-validator'
import type { AssetLimits } from './asset-config.ts'
import type { AssetMetrics } from '../shared/assets.ts'
const fail = (message: string): never => { throw new Error(message) }
const integer = z.number().int().nonnegative().safe()
const documentSchema = z.object({
  asset: z.object({ version: z.literal('2.0'), minVersion: z.literal('2.0').optional() }).passthrough(),
  buffers: z.array(z.object({ byteLength: integer, uri: z.never().optional() }).passthrough()).max(1),
  bufferViews: z.array(z.object({ buffer: z.literal(0), byteOffset: integer.default(0), byteLength: integer }).passthrough()).default([]),
  accessors: z.array(z.object({ count: integer }).passthrough()).default([]),
  meshes: z.array(z.object({ primitives: z.array(z.object({ attributes: z.record(z.string(), integer), indices: integer.optional(), mode: integer.optional(), targets: z.array(z.unknown()).max(8).optional() }).passthrough()).max(1024) }).passthrough()).max(256),
  nodes: z.array(z.object({ mesh: integer.optional() }).passthrough()).default([]),
  materials: z.array(z.unknown()).default([]), animations: z.array(z.unknown()).default([]), textures: z.array(z.unknown()).default([]),
  images: z.array(z.object({ bufferView: integer, mimeType: z.enum(['image/png', 'image/jpeg']), uri: z.never().optional() }).passthrough()).default([]),
  extensionsUsed: z.array(z.string()).default([]), extensionsRequired: z.array(z.string()).default([]),
}).passthrough()
const allowedExtensions = new Set(['KHR_materials_unlit', 'KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_sheen', 'KHR_materials_emissive_strength', 'KHR_materials_volume', 'KHR_texture_transform', 'KHR_mesh_quantization'])
function imageSize(data: Buffer, mime: string): [number, number] {
  if (mime === 'image/png') {
    if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || data.toString('ascii', 12, 16) !== 'IHDR' || data.readUInt32BE(8) !== 13) return fail('Invalid PNG texture.')
    return [data.readUInt32BE(16), data.readUInt32BE(20)]
  }
  if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8) return fail('Invalid JPEG texture.')
  let offset = 2
  while (offset + 4 <= data.length) {
    if (data[offset++] !== 0xff) break
    while (data[offset] === 0xff) offset++
    const marker = data[offset++], length = offset + 2 <= data.length ? data.readUInt16BE(offset) : 0
    if (length < 2 || offset + length > data.length) break
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) return [data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3)]
    if (marker === 0xda || marker === 0xd9) break
    offset += length
  }
  return fail('Invalid or unsupported JPEG texture.')
}
export async function validateGlb(bytes: Uint8Array, limits: AssetLimits): Promise<AssetMetrics> {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (data.length > limits.maxBytes) fail('GLB exceeds the upload size limit.')
  if (data.length < 20 || data.toString('ascii', 0, 4) !== 'glTF') fail('Not a GLB file: invalid magic header.')
  if (data.readUInt32LE(4) !== 2) fail('Only GLB version 2 is supported.')
  if (data.readUInt32LE(8) !== data.length) fail('GLB declared length does not match the uploaded file.')
  const chunks: { type: number; bytes: Buffer }[] = []
  for (let offset = 12; offset < data.length;) {
    if (offset + 8 > data.length) fail('Truncated GLB chunk header.')
    const size = data.readUInt32LE(offset), type = data.readUInt32LE(offset + 4); offset += 8
    if (!size || size % 4 || offset + size > data.length) fail('Malformed or truncated GLB chunk.')
    chunks.push({ type, bytes: data.subarray(offset, offset + size) }); offset += size
    if (chunks.length > 2) fail('Unsupported GLB chunk structure.')
  }
  if (chunks[0]?.type !== 0x4e4f534a || (chunks[1] && chunks[1].type !== 0x004e4942)) fail('GLB must contain JSON followed by an optional BIN chunk.')
  let raw: unknown
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(chunks[0].bytes)) } catch { return fail('Malformed glTF JSON.') }
  const inspect = (value: unknown, depth: number) => {
    if (depth > 64) fail('glTF JSON nesting exceeds the limit.')
    if (typeof value === 'number' && !Number.isFinite(value)) fail('Non-finite model data is unsupported.')
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('Unsupported model property.')
      if (key === 'uri') fail('Models must be self-contained; external and data URI resources are unsupported.')
      if (key === 'extensions' && child && typeof child === 'object' && Object.keys(child).some(k => !allowedExtensions.has(k))) fail('Model contains unsupported extensions or compression.')
      inspect(child, depth + 1)
    }
  }
  inspect(raw, 0)
  const parsed = documentSchema.safeParse(raw)
  if (!parsed.success) fail('Invalid glTF document; use a self-contained GLB 2 model with PNG/JPEG textures.')
  const model = parsed.data!, binary = chunks[1]?.bytes ?? Buffer.alloc(0)
  if ([...model.extensionsUsed, ...model.extensionsRequired].some(e => !allowedExtensions.has(e))) fail('Model contains unsupported extensions or compression.')
  if (!model.meshes.length) fail('The model must contain mesh geometry.')
  if (model.nodes.length > limits.maxNodes || model.materials.length > limits.maxMaterials || model.animations.length > limits.maxAnimations || Math.max(model.images.length, model.textures.length) > limits.maxTextures) fail('Model exceeds node, material, animation or texture limits.')
  if (model.buffers.length && (model.buffers[0].byteLength > binary.length || binary.length - model.buffers[0].byteLength > 3)) fail('Invalid embedded GLB buffer length.')
  for (const view of model.bufferViews) if (view.byteOffset + view.byteLength > (model.buffers[0]?.byteLength ?? 0)) fail('Buffer view is outside the embedded binary.')
  let vertices = 0, triangles = 0, primitives = 0
  for (const [index, mesh] of model.meshes.entries()) {
    // Count repeated node instances too, rather than only unique source geometry.
    const instances = Math.max(1, model.nodes.filter(n => n.mesh === index).length)
    for (const p of mesh.primitives) {
      if ((p.mode ?? 4) !== 4) fail('Only triangle mesh primitives are supported.')
      const position = model.accessors[p.attributes.POSITION], indices = p.indices === undefined ? position : model.accessors[p.indices]
      if (!position || !indices) fail('Mesh has invalid position or index accessors.')
      vertices += position.count * instances * (1 + (p.targets?.length ?? 0)); triangles += Math.ceil(indices.count / 3) * instances; primitives++
      if (vertices > limits.maxVertices || triangles > limits.maxTriangles || primitives > 1024) fail('Model exceeds geometry complexity limits.')
    }
  }
  let pixels = 0
  for (const image of model.images) {
    const view = model.bufferViews[image.bufferView]
    if (!view) fail('Texture has an invalid buffer view.')
    const [width, height] = imageSize(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength), image.mimeType)
    pixels += width * height
    if (!width || !height || width > limits.maxTextureDimension || height > limits.maxTextureDimension || pixels > limits.maxTexturePixels) fail('Model exceeds texture dimension or decoded pixel limits.')
  }
  const report = await validateBytes(bytes, { maxIssues: 20, externalResourceFunction: async () => { throw new Error('External resources are disabled.') } })
  if (report.issues.numErrors) fail('GLB failed glTF semantic validation. Re-export a valid self-contained model.')
  return { vertices, triangles, nodes: model.nodes.length, materials: model.materials.length, animations: model.animations.length, textures: model.images.length }
}
