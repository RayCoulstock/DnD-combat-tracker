import test from 'node:test'
import assert from 'node:assert/strict'
import { validateGlb } from './asset-glb.ts'
import { validateAsset } from './asset-validation.ts'
import { assetLimits } from './asset-config.ts'
import { makeGlb, makeTexturedGlb, triangleDocument } from '../test-fixtures/glb.ts'
const limits = assetLimits({})
test('GLB validation accepts valid self-contained triangles and runs in a bounded worker', async () => {
  const expected = { vertices: 3, triangles: 1, nodes: 1, materials: 0, animations: 0, textures: 0 }
  assert.deepEqual(await validateGlb(makeGlb(), limits), expected)
  assert.deepEqual(await validateAsset(makeGlb(), limits), expected)
  assert.equal((await validateGlb(await makeTexturedGlb(), limits)).textures, 1)
  await assert.rejects(validateAsset(makeGlb(), { ...limits, timeoutMs: 1 }), /timed out/)
})
test('GLB headers, lengths, chunk ordering, JSON and semantic errors fail safely', async () => {
  const badMagic = makeGlb(); badMagic.write('nope')
  const version = makeGlb(); version.writeUInt32LE(1,4)
  const chunk = makeGlb(); chunk.writeUInt32LE(3,12)
  const order = makeGlb(); order.writeUInt32LE(0x004e4942,16)
  const semantic = triangleDocument(); semantic.nodes[0].mesh = 99
  for (const value of [badMagic, version, makeGlb().subarray(0, 24), chunk, order, makeGlb('{bad JSON'), makeGlb(semantic)]) await assert.rejects(validateGlb(value, limits))
  await assert.rejects(validateGlb(makeGlb(), { ...limits, maxBytes: 10 }), /size limit/)
})
test('external resources, unsupported extensions and resource budgets reject before rendering', async () => {
  for (const uri of ['https://host.test/a.bin', '../secret.bin', 'data:application/octet-stream;base64,AAAA']) {
    const document = { ...triangleDocument(), buffers: [{ byteLength: 36, uri }] }
    await assert.rejects(validateGlb(makeGlb(document), limits), /self-contained/)
  }
  await assert.rejects(validateGlb(makeGlb({ ...triangleDocument(), extensionsUsed: ['KHR_draco_mesh_compression'] }), limits), /unsupported extensions/)
  await assert.rejects(validateGlb(makeGlb(JSON.stringify(triangleDocument()).replace('"generator":', '"__proto__":{},"generator":')), limits), /Unsupported model property/)
  const huge = triangleDocument(); huge.accessors[0].count = 1000000000
  await assert.rejects(validateGlb(makeGlb(huge), limits), /complexity/)
  await assert.rejects(validateGlb(makeGlb({ ...triangleDocument(), nodes: [{ mesh: 0 }, { mesh: 0 }] }), { ...limits, maxNodes: 1 }), /limits/)
  await assert.rejects(validateGlb(makeGlb({ ...triangleDocument(), materials: [{}, {}] }), { ...limits, maxMaterials: 1 }), /limits/)
  await assert.rejects(validateGlb(makeGlb({ ...triangleDocument(), animations: [{}, {}] }), { ...limits, maxAnimations: 1 }), /limits/)
  const png = Buffer.alloc(36); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(13,8); png.write('IHDR',12); png.writeUInt32BE(5000,16); png.writeUInt32BE(5000,20)
  const texture = { ...triangleDocument(), buffers: [{ byteLength: 72 }], bufferViews: [...triangleDocument().bufferViews, { buffer: 0, byteOffset: 36, byteLength: 36, target: 34962 }], images: [{ bufferView: 1, mimeType: 'image/png' }] }
  await assert.rejects(validateGlb(makeGlb(texture, Buffer.concat([makeGlb().subarray(-36), png])), limits), /texture dimension/)
})
