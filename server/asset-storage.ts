import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { PassThrough, Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
export class AssetError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export interface StagedAsset { key: string; size: number; hash: string }
export interface AssetStorage {
  stage(input: Readable, maxBytes: number): Promise<StagedAsset>
  publish(staged: StagedAsset, owner: string): Promise<string>
  read(key: string): Promise<Readable>
  remove(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  cleanStaging(): Promise<void>
}
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const keyPattern = new RegExp(`^(?:staging/${uuid}\\.part|${uuid}/[a-f0-9]{64}\\.glb)$`)
export class FilesystemAssetStorage implements AssetStorage {
  readonly root: string
  constructor(directory: string) {
    this.root = resolve(directory)
    if (this.root === process.cwd() || this.root.startsWith(process.cwd() + sep)) throw new Error('ASSET_STORAGE_DIR must be outside the application directory.')
  }
  private async path(key: string) {
    if (!keyPattern.test(key)) throw new AssetError(400, 'Invalid storage key.')
    const target = resolve(this.root, key)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    // Reject symlinks in the configured root, owner/staging directory, or file.
    if (await realpath(this.root) !== this.root || await realpath(dirname(target)) !== dirname(target)) throw new AssetError(500, 'Asset storage is unavailable.')
    try { if ((await lstat(target)).isSymbolicLink()) throw new AssetError(400, 'Invalid storage entry.') } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    return target
  }
  async stage(input: Readable, maxBytes: number): Promise<StagedAsset> {
    const key = `staging/${randomUUID()}.part`, path = await this.path(key)
    let size = 0; const hash = createHash('sha256')
    const bridge = new PassThrough()
    const abort = () => bridge.destroy(new AssetError(400, 'Upload interrupted.'))
    input.once('error', abort); input.once('aborted', abort)
    input.pipe(bridge)
    try {
      await pipeline(bridge, new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        if (size > maxBytes) return callback(new AssetError(413, 'GLB exceeds the upload size limit.'))
        hash.update(chunk); callback(null, chunk)
      } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }))
      if (!size) throw new AssetError(400, 'The GLB file is empty.')
      return { key, size, hash: hash.digest('hex') }
    } catch (e) { await unlink(path).catch(() => {}); throw e }
    finally { input.unpipe(bridge); input.off('error', abort); input.off('aborted', abort); if (!input.destroyed) input.resume() }
  }
  async publish(staged: StagedAsset, owner: string) {
    const key = `${owner}/${staged.hash}.glb`
    await rename(await this.path(staged.key), await this.path(key)); return key
  }
  async read(key: string) { const path = await this.path(key); await stat(path); return createReadStream(path) }
  async remove(key: string) { try { await unlink(await this.path(key)) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e } }
  async exists(key: string) { try { await stat(await this.path(key)); return true } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e } }
  async cleanStaging() {
    const placeholder = await this.path(`staging/${randomUUID()}.part`), directory = dirname(placeholder)
    for (const entry of await readdir(directory)) {
      const key = `staging/${entry}`
      if (keyPattern.test(key) && (await stat(await this.path(key))).mtimeMs < Date.now() - 86400000) await this.remove(key)
    }
  }
}
