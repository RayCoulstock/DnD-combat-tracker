import 'dotenv/config'
import { FilesystemAssetStorage } from './asset-storage.ts'
import { recoverAssets } from './assets.ts'
import { createApplication } from './app.ts'
import { createPool } from './db.ts'
import { assertMigrationsCurrent } from './migrate.ts'
import { runtimeConfig } from './runtime-config.ts'

// Validate before opening connections. Do not print environment values or raw startup errors.
try {
  const config = runtimeConfig()
  const pool = createPool(config.databaseURL)
  try {
    await assertMigrationsCurrent(pool)
    const assetStorage = new FilesystemAssetStorage(config.assetDirectory)
    await recoverAssets(pool, assetStorage)
    const application = createApplication({ assetStorage, pool, secret: config.secret, origin: config.origin, production: config.production, trustProxy: config.trustProxy })
    application.http.listen(config.port, '0.0.0.0', () => console.log('Encounter Ledger backend listening'))
    let stopping = false
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
      if (stopping) return
      stopping = true
      console.log('Encounter Ledger shutting down')
      const deadline = setTimeout(() => { console.error('Shutdown deadline exceeded'); process.exit(1) }, 30000)
      deadline.unref()
      void application.close().then(() => pool.end()).then(() => { clearTimeout(deadline); process.exit(0) }).catch(() => { console.error('Shutdown failed'); process.exit(1) })
    })
    application.http.on('error', () => { console.error('HTTP listener failed'); process.exit(1) })
  } catch { await pool.end(); throw new Error() }
} catch { console.error('Startup failed. Check runtime configuration, database migrations and private asset storage.'); process.exitCode = 1 }
