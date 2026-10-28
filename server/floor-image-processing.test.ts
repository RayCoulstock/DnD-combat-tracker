import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { processFloorImage } from './floor-image-processing.ts'
import { validateFloorImage } from './floor-image-validation.ts'
import { floorImageLimits } from './floor-image-config.ts'
import { makeFloorImage } from '../test-fixtures/floor-image.ts'
const limits=floorImageLimits({})
test('PNG, JPEG and WebP are decoded, resized with aspect preserved and re-encoded without metadata',async()=>{
  for(const format of ['png','jpeg','webp'] as const){
    const source=await makeFloorImage(format),result=await processFloorImage(source,{...limits,textureDimension:32})
    assert.equal(result.width,32);assert.equal(result.height,16)
    const meta=await sharp(result.bytes).metadata();assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined)
  }
  const jpeg=await sharp(await makeFloorImage('jpeg')).withMetadata({orientation:6}).jpeg().toBuffer()
  const oriented=await processFloorImage(jpeg,limits);assert.equal(oriented.width,64);assert.equal(oriented.height,128)
  const worker=await validateFloorImage(await makeFloorImage(),limits);assert.equal(worker.width,128)
})
test('image processing rejects fake types, SVG, truncated data and file/dimension/pixel exhaustion',async()=>{
  for(const data of [Buffer.from('<svg width="10" height="10"/>'),Buffer.from('executable'),Buffer.from('GIF89a')])await assert.rejects(processFloorImage(data,limits),/PNG|WebP/)
  const frames=Buffer.alloc(2*4*3,200);frames.fill(20,2*2*3)
  const animated=await sharp(frames,{raw:{width:2,height:4,channels:3,pageHeight:2}}).webp({loop:0,delay:[100,100]}).toBuffer()
  await assert.rejects(processFloorImage(animated,limits),/single-frame/)
  const image=await makeFloorImage()
  await assert.rejects(processFloorImage(image,{...limits,maxBytes:10}),/size limit/)
  await assert.rejects(processFloorImage(image,{...limits,maxDimension:32}),/dimensions/)
  await assert.rejects(processFloorImage(image,{...limits,maxPixels:10}))
  await assert.rejects(processFloorImage(image.subarray(0,40),limits))
  assert.throws(()=>floorImageLimits({FLOOR_IMAGE_TEXTURE_DIMENSION:'8192'}))
  assert.throws(()=>floorImageLimits({FLOOR_IMAGE_MAX_PIXELS:'0'}))
})
