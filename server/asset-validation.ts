import { Worker } from 'node:worker_threads'
import type { AssetLimits } from './asset-config.ts'
import type { AssetMetrics } from '../shared/assets.ts'
import { AssetError } from './asset-storage.ts'
export function validateAsset(bytes: Uint8Array, limits: AssetLimits): Promise<AssetMetrics> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url.endsWith('.ts') ? './asset-validation-worker.ts' : './asset-validation-worker.js', import.meta.url), { workerData: { bytes, limits }, resourceLimits: { maxOldGenerationSizeMb: 256 } })
    const timer = setTimeout(() => { void worker.terminate(); reject(new AssetError(400, 'Model validation timed out. Reduce model complexity and try again.')) }, limits.timeoutMs)
    worker.once('message', result => { clearTimeout(timer); void worker.terminate(); if (result.error) reject(new AssetError(400, result.error)); else resolve(result.metrics) })
    worker.once('error', () => { clearTimeout(timer); reject(new AssetError(400, 'Model validation failed safely. Try re-exporting the GLB.')) })
    worker.once('exit', code => { clearTimeout(timer); if (code) reject(new AssetError(400, 'Model validation stopped. Reduce model complexity and try again.')) })
  })
}
