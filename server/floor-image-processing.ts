import sharp from 'sharp'
import { AssetError } from './asset-storage.ts'
import type { FloorImageLimits } from './floor-image-config.ts'
export async function processFloorImage(bytes: Uint8Array, limits: FloorImageLimits) {
  if (!bytes.byteLength || bytes.byteLength > limits.maxBytes) throw new AssetError(413, 'Image exceeds the upload size limit or is empty.')
  const signature = Buffer.from(bytes.buffer,bytes.byteOffset,Math.min(bytes.byteLength,12))
  if (!(signature.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || signature.subarray(0,3).equals(Buffer.from([255,216,255])) || (signature.toString('ascii',0,4)==='RIFF' && signature.toString('ascii',8,12)==='WEBP'))) throw new AssetError(400,'Choose a PNG, JPEG or WebP image. SVG is not supported.')
  if(signature.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
    const buffer=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength)
    for(let offset=8;offset+12<=buffer.length;){
      if(buffer.toString('ascii',offset+4,offset+8)==='acTL')throw new AssetError(400,'Animated PNG images are not supported.')
      const length=buffer.readUInt32BE(offset);if(length>buffer.length-offset-12)break;offset+=length+12
    }
  }
  sharp.cache(false); sharp.concurrency(1)
  const image = sharp(bytes, {limitInputPixels: limits.maxPixels, sequentialRead: true, failOn: 'warning'}).timeout({seconds:Math.ceil(limits.timeoutMs/1000)})
  const meta = await image.metadata()
  if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) throw new AssetError(400, 'Choose a single-frame PNG, JPEG or WebP image. SVG and animated images are not supported.')
  if (!meta.width || !meta.height || meta.width > limits.maxDimension || meta.height > limits.maxDimension || meta.width * meta.height > limits.maxPixels) throw new AssetError(400, 'Image dimensions exceed the configured limits.')
  // Decode completely, correct EXIF orientation, strip metadata, and publish only
  // re-encoded pixels. Input filenames and original bytes never become public.
  const result = await image.rotate().resize({width:limits.textureDimension,height:limits.textureDimension,fit:'inside',withoutEnlargement:true}).webp({quality:90,effort:3}).toBuffer({resolveWithObject:true})
  return {bytes: new Uint8Array(result.data), width:result.info.width, height:result.info.height}
}
