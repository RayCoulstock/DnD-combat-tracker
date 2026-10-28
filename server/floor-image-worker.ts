import { parentPort, workerData } from 'node:worker_threads'
import { processFloorImage } from './floor-image-processing.ts'
void processFloorImage(workerData.bytes, workerData.limits).then(result=>parentPort!.postMessage(result)).catch(()=>parentPort!.postMessage({error:'Image could not be decoded safely. Choose a valid single-frame PNG, JPEG or WebP within the configured size and dimension limits.'}))
