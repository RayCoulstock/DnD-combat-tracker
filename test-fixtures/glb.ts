export function triangleDocument() {
  return { asset: { version: '2.0', generator: 'Encounter Ledger fixture' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0,0,0], max: [1,1,0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 }
}
export function makeGlb(document: unknown = triangleDocument(), binary = Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer)): Buffer {
  const json = Buffer.from(typeof document === 'string' ? document : JSON.stringify(document))
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)])
  const bin = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)])
  const output = Buffer.alloc(12 + 8 + padded.length + 8 + bin.length)
  output.write('glTF'); output.writeUInt32LE(2,4); output.writeUInt32LE(output.length,8)
  output.writeUInt32LE(padded.length,12); output.writeUInt32LE(0x4e4f534a,16); padded.copy(output,20)
  output.writeUInt32LE(bin.length,20+padded.length); output.writeUInt32LE(0x004e4942,24+padded.length); bin.copy(output,28+padded.length)
  return output
}

// Tiny embedded RGBA PNG, generated with valid checksums rather than an external asset.
export async function makeTexturedGlb(dimension = 1, textureCount = 1): Promise<Buffer> {
  const { crc32, deflateSync } = await import('node:zlib')
  const chunk = (type: string, data: Buffer) => {
    const result = Buffer.alloc(12 + data.length)
    result.writeUInt32BE(data.length, 0); result.write(type, 4); data.copy(result, 8)
    result.writeUInt32BE(crc32(result.subarray(4, 8 + data.length)), 8 + data.length); return result
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(dimension, 0); ihdr.writeUInt32BE(dimension, 4); ihdr[8] = 8; ihdr[9] = 6
  const pixels = Buffer.alloc((dimension * 4 + 1) * dimension, 255)
  for (let row = 0; row < dimension; row++) pixels[row * (dimension * 4 + 1)] = 0
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
  const positions = Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer), uv = Buffer.from(new Float32Array([0,0,1,0,0,1]).buffer)
  const document = triangleDocument()
  const textured = { ...document, buffers: [{ byteLength: 60 + png.length * textureCount }],
    bufferViews: [...document.bufferViews, { buffer: 0, byteOffset: 36, byteLength: 24, target: 34962 }, ...Array.from({length:textureCount},(_,i)=>({buffer:0,byteOffset:60+i*png.length,byteLength:png.length}))],
    accessors: [...document.accessors, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    images: Array.from({length:textureCount},(_,i)=>({bufferView:2+i,mimeType:'image/png'})), textures: Array.from({length:textureCount},(_,i)=>({source:i})), materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, ...(textureCount>1?{metallicRoughnessTexture:{index:1}}:{}), metallicFactor: 0, roughnessFactor: 1 }, ...(textureCount>2?{normalTexture:{index:2}}:{}) }],
  }
  return makeGlb(textured, Buffer.concat([positions, uv, ...Array.from({length:textureCount},()=>png)]))
}
