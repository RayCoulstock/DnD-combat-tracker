import { isAbsolute } from 'node:path'
export function runtimeConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV && !['development','test','production'].includes(env.NODE_ENV)) throw new Error('NODE_ENV must be development, test or production.')
  const production = env.NODE_ENV === 'production'
  if (!env.DATABASE_URL || !/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL)) throw new Error('Set DATABASE_URL to a PostgreSQL connection URL.')
  const secret = env.SESSION_SECRET ?? ''
  if (secret.length < 32 || /^(replace|change|your[-_])/i.test(secret)) throw new Error('Set SESSION_SECRET to a unique random value of at least 32 characters.')
  const origin = env.APP_ORIGIN ?? ''
  try { const url = new URL(origin); if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || production && url.protocol !== 'https:') throw new Error() }
  catch { throw new Error('Set APP_ORIGIN to an exact origin, using HTTPS in production.') }
  const port = Number(env.PORT ?? 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.')
  const trust = env.TRUST_PROXY ?? (production ? '1' : '0')
  if (!['0','1','loopback'].includes(trust)) throw new Error('TRUST_PROXY must be 0, 1 or loopback.')
  const assetDirectory = env.ASSET_STORAGE_DIR ?? '../.ledger-assets'
  if (production && (!env.ASSET_STORAGE_DIR || !isAbsolute(assetDirectory))) throw new Error('Set ASSET_STORAGE_DIR to an absolute persistent private directory.')
  return { production, databaseURL: env.DATABASE_URL, secret, origin, port, assetDirectory, trustProxy: trust === 'loopback' ? 'loopback' as const : trust === '1' ? 1 as const : 0 as const }
}
