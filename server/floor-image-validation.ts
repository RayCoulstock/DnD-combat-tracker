import { Worker } from 'node:worker_threads'
import { AssetError } from './asset-storage.ts'
import type { FloorImageLimits } from './floor-image-config.ts'
export function validateFloorImage(bytes: Uint8Array, limits: FloorImageLimits): Promise<{bytes:Uint8Array;width:number;height:number}> {
  return new Promise((resolve,reject)=>{
    const worker = new Worker(new URL(import.meta.url.endsWith('.ts') ? './floor-image-worker.ts' : './floor-image-worker.js', import.meta.url), {workerData:{bytes,limits},resourceLimits:{maxOldGenerationSizeMb:128}})
    let settled = false
    const fail = (message:string) => { if (!settled) {settled=true;reject(new AssetError(400,message))} }
    const timer = setTimeout(()=>{fail('Image processing timed out. Try a smaller image.');void worker.terminate()}, limits.timeoutMs)
    worker.once('message',result=>{if(settled)return;settled=true;clearTimeout(timer);if(result.error)reject(new AssetError(400,result.error));else resolve(result);void worker.terminate()})
    worker.once('error',()=>{clearTimeout(timer);fail('Image processing failed safely. Try a smaller image.')})
    worker.once('exit',()=>{clearTimeout(timer);fail('Image processing stopped. Try a smaller image.')})
  })
}
