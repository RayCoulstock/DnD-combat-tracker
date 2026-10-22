import 'dotenv/config'
import { FilesystemAssetStorage } from './asset-storage.ts'
import { recoverAssets } from './assets.ts'
import { createApplication } from './app.ts'
import { createPool } from './db.ts'
const pool = createPool(process.env.DATABASE_URL!)
await pool.query('SELECT 1 FROM schema_migrations LIMIT 1')
if (process.env.NODE_ENV === 'production' && !process.env.ASSET_STORAGE_DIR) throw new Error('Set ASSET_STORAGE_DIR to a persistent private directory.')
const assetStorage = new FilesystemAssetStorage(process.env.ASSET_STORAGE_DIR ?? '../.ledger-assets')
await recoverAssets(pool, assetStorage)
const application = createApplication({ assetStorage, pool, secret: process.env.SESSION_SECRET ?? '', origin: process.env.APP_ORIGIN ?? '', production: process.env.NODE_ENV === 'production' })
application.http.listen(Number(process.env.PORT ?? 3001), '0.0.0.0', () => console.log('Encounter Ledger backend listening'))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void application.close().then(() => pool.end()).then(() => process.exit(0)) })
