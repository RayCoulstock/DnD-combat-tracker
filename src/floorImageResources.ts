import { Texture, SRGBColorSpace, LinearFilter } from 'three'
import { AssetResourceCache } from './assetResourceCache'
export function floorImageUrl(imageId:string,scope?:string,context?:{campaignId:string;encounterId:string}) {
  const query=context?`?${new URLSearchParams(context)}`:''
  return `/api/floor-images/${encodeURIComponent(imageId)}/file${query}#${encodeURIComponent(scope??'signed-out')}`
}
export async function loadFloorTexture(key:string,signal:AbortSignal) {
  const [url,size]=JSON.parse(key) as [string,number]
  const response=await fetch(url,{credentials:'same-origin',signal})
  if(!response.ok)throw new Error(`Floor image request failed (HTTP ${response.status}). Check session access or storage, then retry.`)
  const blob=await response.blob();signal.throwIfAborted()
  // The server outputs at most 4096px. Downsample once more for smaller GPUs.
  let bitmap=await createImageBitmap(blob,{imageOrientation:'flipY'})
  try {
    signal.throwIfAborted()
    if(Math.max(bitmap.width,bitmap.height)>size){
      const factor=size/Math.max(bitmap.width,bitmap.height)
      const smaller=await createImageBitmap(blob,{imageOrientation:'flipY',resizeWidth:Math.max(1,Math.round(bitmap.width*factor)),resizeHeight:Math.max(1,Math.round(bitmap.height*factor)),resizeQuality:'high'})
      bitmap.close();bitmap=smaller
    }
    signal.throwIfAborted()
    const texture=new Texture(bitmap)
    texture.flipY=false;texture.colorSpace=SRGBColorSpace;texture.minFilter=LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true
    return {value:texture,bytes:bitmap.width*bitmap.height*4,dispose:()=>{texture.dispose();bitmap.close()}}
  }catch(error){bitmap.close();throw error}
}
export const floorTextures=new AssetResourceCache<Texture>(loadFloorTexture,4,96*1024*1024)
