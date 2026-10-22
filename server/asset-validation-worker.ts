import { parentPort, workerData } from 'node:worker_threads'
import { validateGlb } from './asset-glb.ts'
try { parentPort!.postMessage({ metrics: await validateGlb(workerData.bytes, workerData.limits) }) }
catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : 'GLB validation failed.' }) }
