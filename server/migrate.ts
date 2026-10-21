import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createPool, transaction, type Pool } from './db.ts'
export async function migrate(pool: Pool) {
  await transaction(pool, async db => {
    await db.query("SELECT pg_advisory_xact_lock(73422311)")
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())')
    for (const file of (await readdir(new URL('./migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort()) {
      if ((await db.query('SELECT 1 FROM schema_migrations WHERE name=$1', [file])).rowCount) continue
      await db.query(await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8'))
      await db.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file])
    }
  })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool(process.env.DATABASE_URL!)
  try { await migrate(pool); console.log('Migrations applied') } finally { await pool.end() }
}
