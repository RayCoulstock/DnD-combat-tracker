import {expireMeasurements} from './tactical.ts'
import {durableEncounter} from '../shared/domain.ts'
import express, { type Request, type Response, type NextFunction } from 'express'
import { createServer } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import session from 'express-session'
import { Passport } from 'passport'
import { Strategy } from 'passport-local'
import argon2 from 'argon2'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { Server, type Socket } from 'socket.io'
import { z } from 'zod'
import { PgSessionStore, hashSecret } from './sessions.ts'
import { registerAssetRoutes } from './assets.ts'
import { FilesystemAssetStorage, type AssetStorage } from './asset-storage.ts'
import { assetLimits, type AssetLimits } from './asset-config.ts'
import { registerMapRoutes } from './maps.ts'
import { transaction, type Pool } from './db.ts'
import { authorize, execute, loadState, persistState, snapshot, sessionState } from './game.ts'
import { artworkStorage, embedArtwork } from './artwork.ts'
import { DomainError, emptyEncounter, envelopeSchema, importEncounter, type Actor, type ClientEvents, type ServerEvents } from '../shared/domain.ts'

interface Options { pool: Pool; secret: string; origin: string; production?: boolean; assetStorage?: AssetStorage; assetValidationLimits?: AssetLimits }
const uuid = z.uuid()
const nameSchema = z.object({ name: z.string().trim().min(1).max(150) }).strict()
const credentials = z.object({ email: z.email().max(254).transform(s => s.toLowerCase()), password: z.string().min(12).max(128) }).strict()
const freshToken = () => randomBytes(32).toString('base64url')
const saveSession = (req: Request) => new Promise<void>((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()))
const rotateSession = (req: Request) => new Promise<void>((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()))
const equal = (a: unknown, b: string) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
export function createApplication({ pool, secret, origin, production = false, assetStorage = new FilesystemAssetStorage(process.env.ASSET_STORAGE_DIR ?? '../.ledger-assets'), assetValidationLimits = assetLimits() }: Options) {
  if (secret.length < 32 || secret.startsWith('replace-with')) throw new Error('SESSION_SECRET must contain at least 32 characters')
  if (new URL(origin).origin !== origin || (production && !origin.startsWith('https://'))) throw new Error('APP_ORIGIN must be an exact origin (HTTPS in production)')
  const app = express()
  const http = createServer(app)
  const io = new Server<ClientEvents, ServerEvents>(http, { maxHttpBufferSize: 12 * 1024 * 1024, transports: ['websocket'],
    allowRequest: (req, cb) => cb(null, req.headers.origin === origin),
  })
  if (production) app.set('trust proxy', 1)
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'blob:'], 'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], 'font-src': ["'self'", 'https://fonts.gstatic.com'], 'script-src': ["'self'"], 'connect-src': ["'self'", 'blob:', origin.replace(/^http/, 'ws')], 'upgrade-insecure-requests': production ? [] : null } } }))
  const jsonBody = express.json({ limit: '12mb' })
  // Authenticate asset uploads before consuming any body, including a forged JSON MIME.
  app.use((req, res, next) => req.method === 'POST' && req.path.replace(/\/+$/, '').toLowerCase() === '/api/assets' ? next() : jsonBody(req, res, next))
  const sessionMiddleware = session({ name: 'ledger.sid', secret, store: new PgSessionStore(pool), resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 7 * 86400000 } })
  app.use(sessionMiddleware)
  const passport = new Passport()
  passport.use(new Strategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const user = (await pool.query('SELECT id,password_hash FROM users WHERE email=$1', [email.toLowerCase()])).rows[0]
      // Always perform a password hash check, including unknown accounts.
      const valid = await argon2.verify(user?.password_hash ?? dummyHash, password)
      done(null, valid && user ? { id: user.id } : false)
    } catch (e) { done(e) }
  }))
  app.use(passport.initialize())
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!req.session.csrf || req.headers.origin !== origin || !equal(req.headers['x-csrf-token'], req.session.csrf ?? ''))) return res.status(403).json({ error: { code: 'CSRF', message: 'Refresh the page and try again.' } })
    next()
  })
  app.get('/api/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }) })
  app.get('/api/session', async (req, res) => {
    req.session.csrf ??= freshToken()
    await saveSession(req)
    res.json({ csrf: req.session.csrf, actor: req.session.actor ?? null, campaignId: req.session.campaignId ?? null })
  })
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const data = credentials.parse(req.body)
    const id = randomUUID()
    const hash = await argon2.hash(data.password, { type: argon2.argon2id })
    try { await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [id, data.email, hash]) }
    catch (e) { if ((e as { code?: string }).code === '23505') throw new DomainError('INVALID', 'Unable to create this account. Try signing in.'); throw e }
    await rotateSession(req); req.session.actor = { role: 'dm', id }; req.session.csrf = freshToken(); await saveSession(req)
    res.status(201).json({ actor: req.session.actor, csrf: req.session.csrf })
  })
  app.post('/api/auth/login', authLimit, (req, res, next) => {
    const data = credentials.safeParse(req.body)
    if (!data.success) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password.' } })
    req.body = data.data
    passport.authenticate('local', async (error: unknown, user: { id: string } | false) => {
      try {
        if (error) throw error
        if (!user) throw new DomainError('UNAUTHENTICATED', 'Invalid email or password.')
        await rotateSession(req); req.session.actor = { role: 'dm', id: user.id }; req.session.csrf = freshToken(); await saveSession(req)
        res.json({ actor: req.session.actor, csrf: req.session.csrf })
      } catch (e) { next(e) }
    })(req, res, next)
  })
  app.post('/api/auth/logout', async (req, res) => {
    const sid = req.sessionID
    await new Promise<void>((resolve, reject) => req.session.destroy(e => e ? reject(e) : resolve()))
    for (const socket of io.sockets.sockets.values()) if ((socket.request as Request).sessionID === sid) { socket.emit('access.revoked'); socket.disconnect(true) }
    res.clearCookie('ledger.sid', { httpOnly: true, sameSite: 'lax', secure: production }).json({ ok: true })
  })
  app.post('/api/invitations/redeem', authLimit, async (req, res) => {
    const data = z.object({ token: z.string().min(40).max(100), displayName: z.string().trim().min(1).max(80) }).strict().parse(req.body)
    const member = await transaction(pool, async db => {
      const invitation = (await db.query('SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE', [hashSecret(data.token)])).rows[0]
      if (!invitation || invitation.revoked_at || invitation.redeemed_at || new Date(invitation.expires_at).getTime() <= Date.now()) throw new DomainError('FORBIDDEN', 'Invitation is invalid or expired.')
      const id = randomUUID()
      await db.query('INSERT INTO memberships(id,campaign_id,display_name) VALUES($1,$2,$3)', [id, invitation.campaign_id, data.displayName])
      await db.query('UPDATE invitations SET redeemed_at=now() WHERE id=$1', [invitation.id])
      return { id, campaignId: invitation.campaign_id }
    })
    await rotateSession(req); req.session.actor = { role: 'player', id: member.id }; req.session.campaignId = member.campaignId; req.session.csrf = freshToken(); await saveSession(req)
    res.status(201).json({ actor: req.session.actor, csrf: req.session.csrf, campaignId: member.campaignId })
  })
  const requireActor = (req: Request): Actor => {
    if (!req.session.actor) throw new DomainError('UNAUTHENTICATED', 'Sign in or redeem an invitation.')
    return req.session.actor
  }
  const requireDM = (req: Request) => { const actor = requireActor(req); if (actor.role !== 'dm') throw new DomainError('FORBIDDEN', 'Dungeon Master access required.'); return actor }
  registerMapRoutes(app, pool, requireDM)
  registerAssetRoutes(app, pool, assetStorage, requireDM, assetValidationLimits, requireActor)
  app.get('/api/campaigns', async (req, res) => {
    const actor = requireActor(req)
    const query = actor.role === 'dm' ? 'SELECT id,name,session_active FROM campaigns WHERE owner_id=$1 ORDER BY created_at' : 'SELECT c.id,c.name,c.session_active FROM campaigns c JOIN memberships m ON m.campaign_id=c.id WHERE m.id=$1 AND m.revoked_at IS NULL'
    res.json((await pool.query(query, [actor.id])).rows)
  })
  app.post('/api/campaigns', async (req, res) => {
    const actor = requireDM(req); const data = nameSchema.parse(req.body); const id = randomUUID()
    await pool.query('INSERT INTO campaigns(id,owner_id,name) VALUES($1,$2,$3)', [id, actor.id, data.name])
    res.status(201).json({ id, name: data.name })
  })
  app.post('/api/campaigns/:campaignId/settings', async (req, res) => {
    const actor = requireDM(req); const campaignId = uuid.parse(req.params.campaignId); const { name } = nameSchema.parse(req.body)
    await transaction(pool, async db => {
      await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [campaignId]); await authorize(db, actor, campaignId)
      await db.query('UPDATE campaigns SET name=$2,updated_at=now() WHERE id=$1', [campaignId, name])
    }); res.json({ ok: true })
  })
  app.get('/api/campaigns/:campaignId', async (req, res) => {
    const actor = requireActor(req); const campaignId = uuid.parse(req.params.campaignId)
    const result = await transaction(pool, async db => {
      const campaign = await authorize(db, actor, campaignId)
      const encounters = actor.role === 'dm' ? (await db.query('SELECT id,name,revision FROM encounters WHERE campaign_id=$1 ORDER BY created_at', [campaignId])).rows : []
      const members = (await db.query('SELECT id,display_name AS "displayName" FROM memberships WHERE campaign_id=$1 AND revoked_at IS NULL ORDER BY created_at', [campaignId])).rows
      const invitations = actor.role === 'dm' ? (await db.query('SELECT id,expires_at,redeemed_at,revoked_at FROM invitations WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 30', [campaignId])).rows : []
      return { id: campaignId, name: campaign.name, activeEncounterId: campaign.active_encounter_id, sessionActive: campaign.session_active, encounters, members, invitations }
    })
    res.json(result)
  })
  app.get('/api/campaigns/:campaignId/snapshot', async (req, res) => res.json(await transaction(pool, db => snapshot(db, requireActor(req), uuid.parse(req.params.campaignId)))))
  app.post('/api/campaigns/:campaignId/encounters', async (req, res) => {
    const actor = requireDM(req); const campaignId = uuid.parse(req.params.campaignId)
    const data = z.object({ name: nameSchema.shape.name, file: z.unknown().optional() }).strict().parse(req.body)
    const id = randomUUID()
    await transaction(pool, async db => {
      await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [campaignId]); await authorize(db, actor, campaignId)
      const state = data.file ? importEncounter(data.file) : emptyEncounter()
      // Imported files must embed their art; opaque references cannot import another campaign's media.
      if (state.combatants.some(c => c.artwork?.startsWith('/'))) throw new DomainError('INVALID', 'Import embedded artwork, not server references.')
      await db.query('INSERT INTO encounters(id,campaign_id,name,state) VALUES($1,$2,$3,$4)', [id, campaignId, data.name, emptyEncounter()])
      await persistState(db, id, state, undefined, true)
      await db.query('UPDATE campaigns SET active_encounter_id=$2,state_revision=state_revision+1,updated_at=now() WHERE id=$1', [campaignId, id])
    })
    await broadcast(campaignId); res.status(201).json({ id })
  })
  app.post('/api/campaigns/:campaignId/open', async (req, res) => {
    const actor = requireDM(req); const campaignId = uuid.parse(req.params.campaignId)
    const { encounterId } = z.object({ encounterId: uuid }).strict().parse(req.body)
    await transaction(pool, async db => {
      await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [campaignId]); await authorize(db, actor, campaignId)
      if (!(await db.query('SELECT 1 FROM encounters WHERE id=$1 AND campaign_id=$2', [encounterId, campaignId])).rowCount) throw new DomainError('FORBIDDEN', 'Encounter access denied.')
      await db.query('UPDATE campaigns SET active_encounter_id=$2,state_revision=state_revision+1,updated_at=now() WHERE id=$1', [campaignId, encounterId])
    }); await broadcast(campaignId); res.json({ ok: true })
  })
  app.post('/api/campaigns/:campaignId/session', async (req, res) => {
    const actor = requireDM(req); const campaignId = uuid.parse(req.params.campaignId)
    const { active } = z.object({ active: z.boolean() }).strict().parse(req.body)
    await transaction(pool, async db => {
      await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [campaignId]); const campaign = await authorize(db, actor, campaignId)
      if (active && !campaign.active_encounter_id) throw new DomainError('INVALID', 'Open an encounter first.')
      await db.query('UPDATE campaigns SET session_active=$2,state_revision=state_revision+1,updated_at=now() WHERE id=$1', [campaignId, active])
    })
    await broadcast(campaignId); res.json({ ok: true })
  })
  app.post('/api/campaigns/:campaignId/invitations', async (req, res) => {
    const actor = requireDM(req); const campaignId = uuid.parse(req.params.campaignId); const token = freshToken(); const id = randomUUID()
    await transaction(pool, async db => {
      await authorize(db, actor, campaignId)
      await db.query("INSERT INTO invitations(id,campaign_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')", [id, campaignId, hashSecret(token)])
    })
    // Fragment avoids referral/server access logs. Redeem once within 30 minutes.
    res.status(201).json({ id, url: `${origin}/#invite=${token}` })
  })
  app.post('/api/campaigns/:campaignId/invitations/:id/revoke', async (req, res) => {
    await transaction(pool, async db => { await authorize(db, requireDM(req), uuid.parse(req.params.campaignId)); await db.query('UPDATE invitations SET revoked_at=now() WHERE id=$1 AND campaign_id=$2', [uuid.parse(req.params.id), req.params.campaignId]) })
    res.json({ ok: true })
  })
  app.post('/api/campaigns/:campaignId/members/:id/revoke', async (req, res) => {
    const campaignId = uuid.parse(req.params.campaignId); const memberId = uuid.parse(req.params.id)
    await transaction(pool, async db => {
      await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [campaignId]); await authorize(db, requireDM(req), campaignId)
      await db.query('UPDATE memberships SET revoked_at=now() WHERE id=$1 AND campaign_id=$2', [memberId, campaignId])
      await db.query("DELETE FROM auth_sessions WHERE data->'actor'->>'id'=$1", [memberId])
    }); await broadcast(campaignId); res.json({ ok: true })
  })
  app.post('/api/campaigns/:campaignId/checkpoints', async (req, res) => {
    const campaignId = uuid.parse(req.params.campaignId); const id = randomUUID()
    await transaction(pool, async db => {
      await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [campaignId]); const campaign = await authorize(db, requireDM(req), campaignId)
      if (!campaign.active_encounter_id) throw new DomainError('NOT_FOUND', 'Open an encounter first.')
      const encounter = (await db.query('SELECT revision FROM encounters WHERE id=$1', [campaign.active_encounter_id])).rows[0]
      await db.query('INSERT INTO checkpoints(id,encounter_id,state,revision) VALUES($1,$2,$3,$4)', [id, campaign.active_encounter_id, durableEncounter(await loadState(db, campaign.active_encounter_id)), encounter.revision])
    }); res.status(201).json({ id })
  })
  app.get('/api/campaigns/:campaignId/checkpoints', async (req, res) => {
    res.json(await transaction(pool, async db => {
      const c = await authorize(db, requireDM(req), uuid.parse(req.params.campaignId))
      return (await db.query('SELECT id,revision,created_at FROM checkpoints WHERE encounter_id=$1 ORDER BY created_at DESC', [c.active_encounter_id])).rows
    }))
  })
  app.post('/api/campaigns/:campaignId/checkpoints/:id/restore', async (req, res) => {
    const campaignId = uuid.parse(req.params.campaignId)
    await transaction(pool, async db => {
      await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE', [campaignId]); const c = await authorize(db, requireDM(req), campaignId)
      const checkpoint = (await db.query('SELECT state FROM checkpoints WHERE id=$1 AND encounter_id=$2', [uuid.parse(req.params.id), c.active_encounter_id])).rows[0]
      if (!checkpoint) throw new DomainError('NOT_FOUND', 'Save not found.')
      // Clear owners whose access was revoked since saving.
      const state = checkpoint.state
      const members = new Set((await db.query('SELECT id FROM memberships WHERE campaign_id=$1 AND revoked_at IS NULL', [campaignId])).rows.map(r => r.id))
      for (const combatant of state.combatants) if (!members.has(combatant.ownerId)) combatant.ownerId = null
      await persistState(db, c.active_encounter_id, state, { undo: [], redo: [] }, true)
      await db.query('UPDATE encounters SET revision=revision+1 WHERE id=$1', [c.active_encounter_id])
      await db.query('UPDATE campaigns SET state_revision=state_revision+1 WHERE id=$1', [campaignId])
    }); await broadcast(campaignId); res.json({ ok: true })
  })
  app.get('/api/campaigns/:campaignId/export', async (req, res) => {
    const state = await transaction(pool, async db => {
      const c = await authorize(db, requireDM(req), uuid.parse(req.params.campaignId))
      return embedArtwork(db, durableEncounter(await loadState(db, c.active_encounter_id)))
    }); res.json({ ...state, exportedAt: new Date().toISOString() })
  })
  app.get('/api/artwork/:id', async (req, res) => {
    const actor = requireActor(req); const id = z.string().regex(/^[a-f0-9]{64}$/).parse(req.params.id)
    const data = await transaction(pool, async db => {
      const rows = await db.query(`SELECT 1 FROM combatants b JOIN encounters e ON e.id=b.encounter_id JOIN campaigns c ON c.id=e.campaign_id
        WHERE b.data->>'artwork'=$1 AND (($2='dm' AND c.owner_id=$3) OR ($2='player' AND c.session_active AND c.active_encounter_id=e.id AND b.visible AND b.owner_id=$3 AND EXISTS(SELECT 1 FROM memberships m WHERE m.id=$3 AND m.campaign_id=c.id AND m.revoked_at IS NULL))) LIMIT 1`, [`/api/artwork/${id}`, actor.role, actor.id])
      if (!rows.rowCount) throw new DomainError('FORBIDDEN', 'Artwork access denied.')
      return artworkStorage.get(db, id)
    }); if (!data) throw new DomainError('NOT_FOUND', 'Artwork not found.')
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'")
    res.type(data.mime).send(data.bytes)
  })
  // Expose only safe errors; details stay off the wire.
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } }))
  if (production) {
    app.use(express.static(resolve('dist')))
    app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')))
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: { code: 'INVALID', message: 'Invalid request data.' } })
    if (error instanceof DomainError) return res.status(error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : 409).json({ error: { code: error.code, message: error.message } })
    console.error('Request failed', error instanceof Error ? error.name : 'UnknownError')
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Unable to complete the request.' } })
  })
  io.engine.use(sessionMiddleware)
  async function socketActor(socket: Socket<ClientEvents, ServerEvents>): Promise<Actor> {
    const req = socket.request as Request
    await new Promise<void>((resolve, reject) => req.session.reload(e => e ? reject(new DomainError('UNAUTHENTICATED', 'Session expired.')) : resolve()))
    return requireActor(req)
  }
  io.use(async (socket, next) => {
    try { const req = socket.request as Request; await socketActor(socket); if (!req.session.csrf || !equal(socket.handshake.auth.csrf, req.session.csrf ?? '')) throw new Error(); next() }
    catch { next(new Error('Authentication required.')) }
  })
  const rooms = new Map<string, string>()
  const sentMaps = new Map<string, { encounterId: string; revision: number }>()
  async function publishState(socket: Socket<ClientEvents, ServerEvents>, campaignId: string, full = false) {
    const actor = await socketActor(socket)
    const data = await transaction(pool, db => sessionState(db, actor, campaignId))
    if (rooms.get(socket.id) !== campaignId || !socket.connected) return data
    const map = data.snapshot
    if (map) {
      const previous = sentMaps.get(socket.id)
      if (!full && map.state.dungeonMap && previous?.encounterId === map.encounterId && previous.revision === map.state.mapRevision) {
        data.snapshot = { ...map, mapDocumentOmitted: true, state: { ...map.state, dungeonMap: undefined } }
      }
      sentMaps.set(socket.id, { encounterId: map.encounterId, revision: map.state.mapRevision ?? 0 })
    }
    socket.emit('session.state', data)
    // Retain the existing snapshot/termination events for older consumers.
    if (data.snapshot) socket.emit('encounter.snapshot', data.snapshot)
    else if (!data.sessionActive) socket.emit('session.ended')
    return data
  }
  async function broadcast(campaignId: string) {
    for (const socket of io.sockets.sockets.values()) {
      if (rooms.get(socket.id) !== campaignId) continue
      try { await publishState(socket, campaignId) }
      catch { socket.emit('access.revoked'); socket.disconnect(true) }
    }
    await presence(campaignId)
  }
  async function presence(campaignId: string) {
    const members = (await pool.query('SELECT id,display_name AS "displayName" FROM memberships WHERE campaign_id=$1 AND revoked_at IS NULL ORDER BY created_at', [campaignId])).rows
    const connected = new Set([...io.sockets.sockets.values()].filter(s => rooms.get(s.id) === campaignId).map(s => (s.request as Request).session.actor?.id))
    io.to(campaignId).emit('presence.changed', members.map(m => ({ ...m, connected: connected.has(m.id) })))
  }
  io.on('connection', socket => {
    let count = 0; let windowStart = Date.now()
    socket.on('campaign.join', async (input, ack) => {
      if (typeof ack !== 'function') return
      let subscribed = false
      try {
        if (Date.now() - windowStart > 1000) { count = 0; windowStart = Date.now() }
        if (++count > 30) throw new DomainError('INVALID', 'Too many commands.')
        const actor = await socketActor(socket); const campaignId = uuid.parse(input)
        await transaction(pool, db => authorize(db, actor, campaignId))
        const old = rooms.get(socket.id); if (old) await socket.leave(old)
        rooms.set(socket.id, campaignId); await socket.join(campaignId); subscribed = true
        // Subscribe before reading so activation during the join cannot be missed.
        const data = await publishState(socket, campaignId, true)
        ack({ ok: true, revision: data.snapshot?.revision ?? 0, duplicate: false }); if (old) await presence(old); await presence(campaignId)
      } catch (e) { ack(commandError(e)); if (subscribed) { socket.emit('access.revoked'); socket.disconnect(true) } }
    })
    socket.on('game.command', async (input, ack) => {
      if (typeof ack !== 'function') return
      let campaignId: string | undefined
      try {
        if (Date.now() - windowStart > 1000) { count = 0; windowStart = Date.now() }
        if (++count > 30) throw new DomainError('INVALID', 'Too many commands.')
        campaignId = rooms.get(socket.id); const actor = await socketActor(socket)
        if (!campaignId) throw new DomainError('FORBIDDEN', 'Join an authorised campaign first.')
        const data = envelopeSchema.parse(input)
        // References must already belong to this campaign, never another room's artwork.
        const raw = JSON.stringify(data.command)
        for (const reference of raw.match(/\/api\/artwork\/[a-f0-9]{64}/g) ?? []) {
          const exists = await pool.query("SELECT 1 FROM combatants b JOIN encounters e ON e.id=b.encounter_id WHERE e.campaign_id=$1 AND b.data->>'artwork'=$2 LIMIT 1", [campaignId, reference])
          if (!exists.rowCount) throw new DomainError('FORBIDDEN', 'Artwork access denied.')
        }
        const result = await execute(pool, actor, campaignId, data)
        await broadcast(campaignId); ack({ ok: true, ...result })
      } catch (e) {
        ack(commandError(e))
        if (campaignId) { try { await publishState(socket, campaignId) } catch { socket.emit('access.revoked'); socket.disconnect(true) } }
      }
    })
    socket.on('disconnect', () => { sentMaps.delete(socket.id); const c = rooms.get(socket.id); rooms.delete(socket.id); if (c) void presence(c).catch(() => {}) })
  })
  let expiryJob:Promise<void>|undefined
  const timer = setInterval(() => {
    if(!expiryJob)expiryJob=expireMeasurements(pool).then(async campaigns=>{for(const id of campaigns)await broadcast(id)}).catch(()=>{}).finally(()=>{expiryJob=undefined})
    for (const socket of io.sockets.sockets.values()) {
      const campaignId = rooms.get(socket.id)
      if (campaignId) void (async () => {
        try { const actor = await socketActor(socket); await transaction(pool, db => authorize(db, actor, campaignId)) }
        catch { socket.emit('access.revoked'); socket.disconnect(true) }
      })()
    }
  }, 15000)
  timer.unref()
  return { app, http, io, close: async () => { clearInterval(timer); await expiryJob; await new Promise<void>(resolve => io.close(() => resolve())) } }
}
function commandError(error: unknown) {
  return { ok: false as const, error: error instanceof DomainError ? { code: error.code, message: error.message } : { code: 'INVALID', message: 'Unable to apply command.' } }
}
// Precomputed valid Argon2id hash, used only for timing equalisation (not an account credential).
const dummyHash = await argon2.hash(randomBytes(32), { type: argon2.argon2id })
