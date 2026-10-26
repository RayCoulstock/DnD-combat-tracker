import pg from 'pg'
import type { PoolClient } from 'pg'
export const createPool = (connectionString: string) => {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 })
  // pg emits idle-client failures outside individual query promises. Never log connection strings.
  pool.on('error', () => console.error('Database idle connection failed'))
  return pool
}
export type Pool = pg.Pool
export async function transaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result }
  catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
