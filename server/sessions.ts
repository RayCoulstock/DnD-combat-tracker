import session from 'express-session'
import { createHash } from 'node:crypto'
import type { Pool } from './db.ts'
import type { Actor } from '../shared/domain.ts'
export const hashSecret = (value: string) => createHash('sha256').update(value).digest('hex')
declare module 'express-session' {
  interface SessionData { csrf: string; actor: Actor; campaignId?: string }
}
export class PgSessionStore extends session.Store {
  constructor(private pool: Pool) { super() }
  get(sid: string, cb: (err: unknown, data?: session.SessionData | null) => void) {
    this.pool.query('SELECT data FROM auth_sessions WHERE sid_hash=$1 AND expires_at>now()', [hashSecret(sid)])
      .then(r => cb(null, r.rows[0]?.data ?? null)).catch(cb)
  }
  set(sid: string, data: session.SessionData, cb?: (err?: unknown) => void) {
    this.pool.query('INSERT INTO auth_sessions(sid_hash,data,expires_at) VALUES ($1,$2,$3) ON CONFLICT(sid_hash) DO UPDATE SET data=$2,expires_at=$3',
      [hashSecret(sid), data, data.cookie.expires ?? new Date(Date.now() + 86400000)])
      .then(() => cb?.()).catch(e => cb?.(e))
  }
  destroy(sid: string, cb?: (err?: unknown) => void) {
    this.pool.query('DELETE FROM auth_sessions WHERE sid_hash=$1', [hashSecret(sid)]).then(() => cb?.()).catch(e => cb?.(e))
  }
}
