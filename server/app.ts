import {credentials,authenticateAccount,accountId,actorForCampaign,sessionView,beginAccountSession,registerAccountRoutes,requestActors} from './accounts.ts'
import {registerGroupPresetRoutes} from './group-presets.ts'
import { registerCombatantLibraryRoutes } from './combatant-library.ts'
import { registerFloorImageRoutes } from './floor-images.ts'
import {expireMeasurements} from './tactical.ts'
import {durableEncounter,projectEncounter} from '../shared/domain.ts'
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

interface Options { pool: Pool; secret: string; origin: string; production?: boolean; allowDMRegistration?: boolean; trustProxy?: 0 | 1 | 'loopback'; assetStorage?: AssetStorage; assetValidationLimits?: AssetLimits }
const uuid = z.uuid()
const nameSchema = z.object({ name: z.string().trim().min(1).max(150) }).strict()
const freshToken = () => randomBytes(32).toString('base64url')
const saveSession = (req: Request) => new Promise<void>((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()))
const rotateSession = (req: Request) => new Promise<void>((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()))
const equal = (a: unknown, b: string) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
export function createApplication({ pool, secret, origin, production = false, allowDMRegistration = !production, trustProxy = production ? 1 : 0, assetStorage = new FilesystemAssetStorage(process.env.ASSET_STORAGE_DIR ?? '../.ledger-assets'), assetValidationLimits = assetLimits() }: Options) {
  if (secret.length < 32 || secret.startsWith('replace-with')) throw new Error('SESSION_SECRET must contain at least 32 characters')
  if (new URL(origin).origin !== origin || (production && !origin.startsWith('https://'))) throw new Error('APP_ORIGIN must be an exact origin (HTTPS in production)')
  const app = express()
  const http = createServer(app)
  const io = new Server<ClientEvents, ServerEvents>(http, { maxHttpBufferSize: 12 * 1024 * 1024, transports: ['websocket'],
    allowRequest: (req, cb) => cb(null, req.headers.origin === origin),
  })
  app.set('trust proxy', trustProxy)
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
      done(null,await authenticateAccount(pool,email,password))
    } catch (e) { done(e) }
  }))
  app.use(passport.initialize())
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, message:{error:{code:'RATE_LIMIT',message:'Too many authentication attempts. Try again in 15 minutes.'}}, standardHeaders: 'draft-8', legacyHeaders: false })
  const invitationLimit=rateLimit({windowMs:15*60*1000,limit:60,standardHeaders:'draft-8',legacyHeaders:false,message:{error:{code:'RATE_LIMIT',message:'Too many invitation requests. Try again in 15 minutes.'}}})
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!req.session.csrf || req.headers.origin !== origin || !equal(req.headers['x-csrf-token'], req.session.csrf ?? ''))) return res.status(403).json({ error: { code: 'CSRF', message: 'Refresh the page and try again.' } })
    next()
  })
  app.get('/api/health/live', (_req, res) => res.json({ ok: true }))
  app.get('/api/health', async (_req, res) => {
    try { const probe={text:'SELECT 1', query_timeout:3000}; await pool.query(probe); res.json({ ok: true }) }
    catch { res.status(503).json({ ok: false }) }
  })
  app.get('/api/session', async (req, res) => {
    req.session.csrf ??= freshToken()
    await saveSession(req)
    res.json({ allowDMRegistration, csrf: req.session.csrf, ...await sessionView(pool,req) })
  })
  app.post('/api/auth/register', (_req, res, next) => {
    if (!allowDMRegistration) return res.status(403).json({ error: { code: 'REGISTRATION_DISABLED', message: 'DM registration is closed for the private beta. Existing DMs can sign in; players can join using an invitation.' } })
    next()
  }, authLimit, async (req, res) => {
    const data = credentials.parse(req.body)
    const id = randomUUID()
    const hash = await argon2.hash(data.password, { type: argon2.argon2id })
    try { await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [id, data.email, hash]) }
    catch (e) { if ((e as { code?: string }).code === '23505') throw new DomainError('INVALID', 'Unable to create this account. Try signing in.'); throw e }
    await rotateSession(req); req.session.actor = { role: 'dm', id }; req.session.csrf = freshToken(); await saveSession(req)
    res.status(201).json({...await sessionView(pool,req),csrf:req.session.csrf})
  })
  app.post('/api/auth/login', authLimit, (req, res, next) => {
    const data = credentials.safeParse(req.body)
    if (!data.success) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password.' } })
    req.body = data.data
    passport.authenticate('local', async (error: unknown, user: { id: string } | false) => {
      try {
        if (error) throw error
        if (!user) throw new DomainError('UNAUTHENTICATED', 'Invalid email or password.')
        res.json(await beginAccountSession(pool,req,user.id))
      } catch (e) { next(e) }
    })(req, res, next)
  })
  app.post('/api/auth/logout', async (req, res) => {
    const sid = req.sessionID
    await new Promise<void>((resolve, reject) => req.session.destroy(e => e ? reject(e) : resolve()))
    for (const socket of io.sockets.sockets.values()) if ((socket.request as Request).sessionID === sid) { socket.emit('access.revoked'); socket.disconnect(true) }
    res.clearCookie('ledger.sid', { httpOnly: true, sameSite: 'lax', secure: production }).json({ ok: true })
  })
  registerAccountRoutes(app,pool,authLimit,invitationLimit)
  app.post('/api/invitations/redeem', authLimit, async (req, res) => {
    if(accountId(req))throw new DomainError('INVALID','Use account invitation acceptance while signed in.')
    const data = z.object({ token: z.string().min(40).max(100), displayName: z.string().trim().min(1).max(80) }).strict().parse(req.body)
    const member = await transaction(pool, async db => {
      const invitation = (await db.query('SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE', [hashSecret(data.token)])).rows[0]
      if (!invitation || invitation.membership_id || invitation.revoked_at || invitation.redeemed_at || new Date(invitation.expires_at).getTime() <= Date.now()) throw new DomainError('FORBIDDEN', 'Invitation is invalid or expired.')
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
    return requestActors.get(req)??req.session.actor
  }
  const requireDM = (req: Request) => { const actor = requireActor(req); if (actor.role !== 'dm') throw new DomainError('FORBIDDEN', 'Dungeon Master access required.'); return actor }
  app.use('/api',async(req,res,next)=>{try{if(req.session.actor||accountId(req)){const match=req.path.match(/^\/campaigns\/([0-9a-f-]{36})(?:\/|$)/i),campaign=match?.[1]??(typeof req.query.campaignId==='string'?req.query.campaignId:undefined);requestActors.set(req,await actorForCampaign(pool,req,campaign))}next()}catch(e){if(e instanceof DomainError&&e.code==='FORBIDDEN'&&/^\/(assets|floor-images)\/[^/]+\/file$/.test(req.path)){res.status(404).json({error:{code:'NOT_FOUND',message:'File unavailable.'}});return}next(e)}})
  app.post('/api/campaigns/:campaignId/enter',async(req,res)=>{const id=uuid.parse(req.params.campaignId),actor=requireActor(req);await transaction(pool,db=>authorize(db,actor,id));req.session.campaignId=id;await saveSession(req);res.json({actor,campaignId:id})})
  registerCombatantLibraryRoutes(app,pool,requireDM)
  registerGroupPresetRoutes(app,pool,requireDM)
  registerMapRoutes(app, pool, requireDM)
  registerFloorImageRoutes(app, pool, assetStorage, requireDM, requireActor)
  registerAssetRoutes(app, pool, assetStorage, requireDM, assetValidationLimits, requireActor)
  app.get('/api/campaigns', async (req, res) => {
    const actor = requireActor(req)
    const user=accountId(req)
    const rows=user?await pool.query(`SELECT c.id,c.name,c.session_active,h.display_name AS "hostName",CASE WHEN c.owner_id=$1 THEN 'dm' ELSE 'player' END AS role,CASE WHEN c.owner_id=$1 THEN 'host' ELSE 'active' END AS "membershipStatus" FROM campaigns c JOIN users h ON h.id=c.owner_id LEFT JOIN memberships m ON m.campaign_id=c.id AND m.account_id=$1 AND m.revoked_at IS NULL WHERE c.owner_id=$1 OR m.id IS NOT NULL ORDER BY c.name`,[user]):await pool.query(`SELECT c.id,c.name,c.session_active,h.display_name AS "hostName",'player' AS role,'active' AS "membershipStatus" FROM campaigns c JOIN users h ON h.id=c.owner_id JOIN memberships m ON m.campaign_id=c.id WHERE m.id=$1 AND m.revoked_at IS NULL ORDER BY c.name`,[actor.id])
    res.json(rows.rows)
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
      const members = (await db.query(actor.role==='dm'?`SELECT id,display_name AS "displayName",(account_id IS NOT NULL) AS "accountLinked",CASE WHEN revoked_at IS NULL THEN 'active' ELSE 'revoked' END AS status FROM memberships WHERE campaign_id=$1 ORDER BY created_at`:'SELECT id,display_name AS "displayName" FROM memberships WHERE campaign_id=$1 AND revoked_at IS NULL ORDER BY created_at', [campaignId])).rows
      const invitations = actor.role === 'dm' ? (await db.query('SELECT id,expires_at,redeemed_at,revoked_at,membership_id AS "membershipId" FROM invitations WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 30', [campaignId])).rows : []
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
  app.post('/api/campaigns/:campaignId/invitations', invitationLimit, async (req, res) => {
    const actor = requireDM(req); const campaignId = uuid.parse(req.params.campaignId); const token = freshToken(); const id = randomUUID()
    const {membershipId}=z.object({membershipId:uuid.optional()}).strict().parse(req.body??{})
    await transaction(pool, async db => {
      await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE',[campaignId]);await authorize(db, actor, campaignId)
      if(membershipId&&!(await db.query('SELECT 1 FROM memberships WHERE id=$1 AND campaign_id=$2 AND account_id IS NULL AND revoked_at IS NULL',[membershipId,campaignId])).rowCount)throw new DomainError('INVALID','Choose an active legacy membership in this campaign.')
      await db.query("INSERT INTO invitations(id,campaign_id,token_hash,expires_at,membership_id) VALUES($1,$2,$3,now()+interval '30 minutes',$4)", [id, campaignId, hashSecret(token),membershipId??null])
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
      if(!(await db.query('UPDATE memberships SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND campaign_id=$2 RETURNING id', [memberId, campaignId])).rowCount)throw new DomainError('NOT_FOUND','Member unavailable.')
      await db.query('UPDATE invitations SET revoked_at=COALESCE(revoked_at,now()) WHERE membership_id=$1 AND campaign_id=$2 AND redeemed_at IS NULL',[memberId,campaignId])
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
      const account=accountId(req)
      const rows = await db.query(`SELECT e.id AS encounter_id,e.campaign_id FROM combatants b JOIN encounters e ON e.id=b.encounter_id JOIN campaigns c ON c.id=e.campaign_id
        WHERE b.data->>'artwork'=$1 AND (($2='dm' AND c.owner_id=$3) OR (c.session_active AND c.active_encounter_id=e.id AND b.visible AND EXISTS(SELECT 1 FROM memberships m WHERE m.id=b.owner_id AND m.campaign_id=c.id AND m.revoked_at IS NULL AND (($2='player' AND m.id=$3) OR m.account_id=$4))))`, [`/api/artwork/${id}`, actor.role, actor.id,account??null])
      let allowed=actor.role==='dm'&&Boolean((await db.query("SELECT 1 FROM combatant_library WHERE owner_id=$1 AND definition->>'artwork'=$2",[actor.id,`/api/artwork/${id}`])).rowCount)
      for(const row of rows.rows){const viewer=account?await actorForCampaign(db,req,row.campaign_id):actor;const state=projectEncounter(await loadState(db,row.encounter_id),viewer);if(state.combatants.some(c=>c.artwork===`/api/artwork/${id}`))allowed=true}
      if(!allowed)throw new DomainError('FORBIDDEN','Artwork access denied.')
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
  async function socketActor(socket: Socket<ClientEvents, ServerEvents>,campaignId=rooms.get(socket.id)): Promise<Actor> {
    const req = socket.request as Request
    await new Promise<void>((resolve, reject) => req.session.reload(e => e ? reject(new DomainError('UNAUTHENTICATED', 'Session expired.')) : resolve()))
    return actorForCampaign(pool,req,campaignId)
  }
  io.use(async (socket, next) => {
    try { const req = socket.request as Request; await socketActor(socket); if (!req.session.csrf || !equal(socket.handshake.auth.csrf, req.session.csrf ?? '')) throw new Error(); next() }
    catch { next(new Error('Authentication required.')) }
  })
  const rooms = new Map<string, string>()
  const sentMaps = new Map<string, { encounterId: string; revision: number }>()
  async function publishState(socket: Socket<ClientEvents, ServerEvents>, campaignId: string, full = false) {
    const actor = await socketActor(socket,campaignId)
    const data = await transaction(pool, db => sessionState(db, actor, campaignId))
    if (rooms.get(socket.id) !== campaignId || !socket.connected) return data
    const map = data.snapshot
    if (map) {
      const previous = sentMaps.get(socket.id)
      if (!full && !(actor.role==='player'&&map.state.dungeonMap?.fogOfWar?.enabled) && map.state.dungeonMap && previous?.encounterId === map.encounterId && previous.revision === map.state.mapRevision) {
        data.snapshot = { ...map, mapDocumentOmitted: true, state: { ...map.state, dungeonMap: undefined } }
      }
      sentMaps.set(socket.id, { encounterId: map.encounterId, revision: map.state.mapRevision ?? 0 })
    }
    socket.data.actor=actor
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
    const connected = new Set([...io.sockets.sockets.values()].filter(s => rooms.get(s.id) === campaignId).map(s => s.data.actor?.id))
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
        const campaignId = uuid.parse(input); const actor = await socketActor(socket,campaignId)
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
  return { ok: false as const,...(error instanceof DomainError&&error.groupResult?{groupResult:error.groupResult}:{}), error: error instanceof DomainError ? { code: error.code, message: error.message } : { code: 'INVALID', message: 'Unable to apply command.' } }
}
