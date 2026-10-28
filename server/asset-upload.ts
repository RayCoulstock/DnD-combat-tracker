import type { Request } from 'express'
import Busboy from 'busboy'
import { AssetError, type AssetStorage, type StagedAsset } from './asset-storage.ts'
export async function multipart<T>(req: Request, storage: AssetStorage, maxBytes: number, extensions: string[], parseMetadata: (value: unknown) => T) {
  if (Number(req.headers['content-length'] ?? 0) > maxBytes + 32768) throw new AssetError(413, 'File exceeds the upload size limit.')
  let parser: ReturnType<typeof Busboy>
  try { parser = Busboy({ headers: req.headers, defParamCharset: 'utf8', preservePath: true, limits: { files: 1, fields: 1, parts: 3, fieldSize: 16384, fileSize: maxBytes + 1, headerPairs: 30 } }) }
  catch { throw new AssetError(400, 'Upload a file using multipart form data.') }
  let staged: StagedAsset | undefined, fileName = '', metadata: unknown, failure: Error | undefined
  const jobs: Promise<void>[] = []
  const invalid = (message: string) => { failure ??= new AssetError(400, message) }
  parser.on('field', (name, value, info) => { if (name !== 'metadata' || info.valueTruncated) invalid('Invalid or oversized asset metadata.'); else { try { metadata = JSON.parse(value) } catch { invalid('Invalid asset metadata.') } } })
  parser.on('file', (name, stream, info) => {
    fileName = info.filename ?? ''
    if (name !== 'file' || !fileName || fileName.length > 255 || (/[\\/]/.test(fileName) || [...fileName].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) || !extensions.some(extension=>fileName.toLowerCase().endsWith('.'+extension))) { invalid('Choose a supported filename without directory paths.'); stream.resume(); return }
    jobs.push(storage.stage(stream, maxBytes).then(value => { staged = value; if (stream.truncated) failure = new AssetError(413, 'File exceeds the upload size limit.') }).catch(e => { failure = e }))
  })
  for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit'] as const) parser.on(event, () => invalid('Upload exactly one file and one metadata field.'))
  let total = 0
  const budget = (chunk: Buffer) => { total += chunk.length; if (total > maxBytes + 32768) { failure = new AssetError(413, 'Upload exceeds the request size limit.'); req.unpipe(parser); parser.destroy(failure); req.resume() } }
  const aborted = () => parser.destroy(new AssetError(400, 'Upload interrupted.'))
  req.on('data', budget); req.once('aborted', aborted); req.once('error', aborted)
  try {
    await new Promise<void>((resolve, reject) => { parser.once('close', resolve); parser.once('error', e => reject(e instanceof AssetError ? e : new AssetError(400, 'Malformed or interrupted multipart upload.'))); req.pipe(parser) })
    await Promise.all(jobs)
    if (failure) throw failure
    if (!staged || metadata === undefined) throw new AssetError(400, 'A file and metadata are required.')
    return { staged, fileName, metadata: parseMetadata(metadata) }
  } catch (error) { await Promise.all(jobs); if (staged) await storage.remove(staged.key); throw error }
  finally { req.off('data', budget); req.off('aborted', aborted); req.off('error', aborted); req.unpipe(parser); if (!req.destroyed) req.resume() }
}
