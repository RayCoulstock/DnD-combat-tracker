import 'dotenv/config'
import { createApplication } from './app.ts'
import { createPool } from './db.ts'
const pool = createPool(process.env.DATABASE_URL!)
await pool.query('SELECT 1 FROM schema_migrations LIMIT 1')
const application = createApplication({ pool, secret: process.env.SESSION_SECRET ?? '', origin: process.env.APP_ORIGIN ?? '', production: process.env.NODE_ENV === 'production' })
application.http.listen(Number(process.env.PORT ?? 3001), '0.0.0.0', () => console.log('Encounter Ledger backend listening'))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void application.close().then(() => pool.end()).then(() => process.exit(0)) })
