# Multiplayer development and deployment

## Local or Codespaces setup

Use Node.js 24+, npm and Docker Compose. The lockfile pins the tested dependencies.

```bash
npm ci
cp .env.example .env
# Replace SESSION_SECRET in .env with the output of:
openssl rand -hex 32
# Set APP_ORIGIN to the exact browser origin, without a trailing slash.
docker compose up -d --wait
npm run db:migrate
npm run dev:all
```

The frontend normally uses port 5173; the backend uses 3001. Vite proxies `/api` and `/socket.io`, including WebSocket upgrades. Browser code has no hardcoded backend hostname. Keep PostgreSQL bound to the loopback interface. `.env` is ignored; never commit it. If port 5432 is occupied, set POSTGRES_PORT in `.env` and update DATABASE_URL accordingly.

For Codespaces, forward **5173**, set `APP_ORIGIN=https://YOUR-CODESPACE-5173.app.github.dev`, and restart `npm run dev:all`. Keep 3001 and 5432 private. Accessing a private forwarded port requires GitHub authorization independently of this app's invitation. To allow players without Codespaces access, deliberately make only the frontend port public; the application's account/invitation protections then govern access. Use production hosting for ongoing campaigns.

For the original standalone workflow, `npm run dev` alone still works: select **Local tracker**. No database/account is needed for local play. Local state survives switching between the local and multiplayer tabs during the same page visit, but remains browser-memory state; export JSON before closing/reloading.

## DM and players

1. Select **Multiplayer**, create a DM account (12+ character password), and create a campaign.
2. Create an encounter, optionally importing an existing version-1 Encounter Ledger JSON file. Empty encounters can be populated using the existing **Add combatant** stat-block importer.
3. Start the multiplayer session. Generate an invitation for each player. Each link works once and expires in 30 minutes.
4. Open each invitation in a separate browser profile/private context and enter a display name. Use **Token ownership, visibility and combatant settings** to assign characters, hide/reveal enemies, edit initiative/max HP/name/private notes, and resize the map.
5. Players can select visible tokens and move only their assigned, revealed tokens. Their own statistics and actions are available below the map. Other visible combatants show identity/initiative/conditions without private statistics. Only the DM changes HP, conditions, abilities or initiative.
6. Use **Save session** for a checkpoint. Every accepted command is already persisted. Restore a checkpoint through **Invitations and saved sessions**. Export produces compatible JSON including embedded artwork; import strips ownership to avoid reviving another campaign's permissions.
7. Revoke invitations or player access in the room controls. Revoked players are disconnected and their sessions deleted. Ending a session removes player access while retaining state. After the DM restarts it, players can use **Refresh / rejoin**.

A player retains a stable identity in the same browser for up to seven days. After expiry, cookie deletion or revocation, a new invitation creates a new identity; the DM must reassign its tokens. Two players with the same display name still have distinct identities. Invitations use URL fragments to avoid server/referrer logs. Treat the displayed invitation as a temporary credential.

## Database and artwork

`server/migrations/001_initial.sql` creates:

| Records | Purpose |
| --- | --- |
| users | DM email, Argon2id password hash, creation time |
| campaigns | DM owner, active encounter, session status |
| memberships | Stable player identity, campaign, display name, revocation |
| invitations | Hashed token, expiry, redemption and revocation timestamps |
| auth_sessions | Hashed session ID, server-held identity/CSRF, expiry |
| encounters | Name, campaign, revision, version-1 metadata/map settings |
| combatants | Ordered flexible statistics, ownership, visibility, grid position |
| command_receipts | Actor/command identity, payload hash, committed revision |
| checkpoints | Explicit saved encounters with artwork references |
| artwork | Deduplicated content-addressed bytes and MIME type |

Migrations run under a transaction and advisory lock; repeat runs are safe. Development seed is optional: set `SEED_DM_EMAIL` and `SEED_DM_PASSWORD` through environment variables, then run `npm run db:seed`. There is no default DM password. Existing seed accounts are left unchanged.

`server/artwork.ts` defines the storage interface. PostgreSQL stores each image once; snapshots/checkpoints contain references. A later object-store adapter can replace `put/get` without changing encounter files. Image access checks current campaign/ownership/visibility; embedded image MIME types from the existing importer are retained, up to 3 MiB per image. Media responses use a sandbox CSP with no scripts or external resources, including for SVG. Requests and commands are capped at 12 MiB, encounters at 100 combatants, map dimensions at 100 squares per axis. Large legacy JSON files may need artwork reduced before import.

## Validation

```bash
npm test                    # six original map tests + shared domain tests
npm run test:integration     # real PostgreSQL HTTP + Socket.IO lifecycle
npm run typecheck
npm run lint
npm run build
# With npm run dev:all running:
npx playwright install chromium
npm run test:e2e
# Or use an installed Chromium:
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Integration tests create and drop a unique PostgreSQL schema, and never truncate application tables. The database user needs schema-creation permission. Browser tests create isolated accounts/campaigns in the configured development database; do not run them against production. They exercise local HP controls, DM registration/campaign/import, two real player browser contexts, movement, hidden UI, camera screenshot independence and reconnection. Three.js needs WebGL; headless Chromium uses SwiftShader. API integration additionally checks ownership attacks, DM permissions, cross-campaign access, invitation expiry/revocation/reuse, origin/CSRF/authentication, concurrent/stale/duplicate commands, checkpoint/artwork compatibility, session expiry, rate limits and restart recovery.

## Production

Deploy one Node service and managed PostgreSQL in the same region. Affordable options include a small Render service with managed PostgreSQL or a small Fly.io/Railway application with a managed PostgreSQL provider. Browser clients connect over TLS to one origin. No separate frontend origin, Redis, or paid object store is required for this prototype.

Set `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET` (unique random 32+ characters), `APP_ORIGIN` (exact HTTPS origin) and optionally `PORT`. Configure verified database TLS using your provider's CA/connection instructions. The reverse proxy must support WebSocket upgrades and replace trusted forwarded headers. The service trusts exactly one proxy hop; do not expose the Node port publicly behind an untrusted forwarded-header chain.

```bash
npm ci
npm run build
npm run db:migrate:production
npm start
```

Alternatively build the supplied Dockerfile. Run migrations as a release job using `node dist-server/server/migrate.js`, then start the image with the environment variables above. Build tooling is absent in the runtime image; compiled migration SQL is copied into it. The HTTP health endpoint is `/api/health` and checks PostgreSQL. Keep the same SESSION_SECRET across restarts so signed sessions remain valid. Back up PostgreSQL (including artwork) and test restoration. Compose's development volume is not a production backup.

## Security decisions and prototype limits

Passport Local verifies Argon2id hashes. Random signed session cookies are HttpOnly and SameSite=Lax, with Secure required in production; stored session IDs and invitation secrets are SHA-256 hashed. Login/redemption rotate session IDs. Session-bound CSRF headers protect HTTP mutations and socket handshakes. Exact Origin checking applies to HTTP mutations and WebSocket handshakes; there is no wildcard CORS. Auth/redemption are rate limited (30 requests/15 minutes/IP); socket joins/commands share a 30-per-second/socket budget. Unknown-account logins still perform password verification. Request errors return safe messages.

Every command validates identity, membership, role, ownership, destination, encounter identity and expected revision inside a transaction. PostgreSQL campaign/encounter locks order simultaneous writes. Receipts make exact command retries idempotent. A changed payload cannot reuse a command ID. Snapshots are consistent, recipient-specific allowlists rather than shared raw state. Full snapshots reconcile skipped revisions; cameras and selection never appear in commands. Disconnected clients do not queue mutations. An uncertain acknowledgement requires checking the refreshed state rather than blindly repeating an action.

This is a single-process prototype. Horizontal scaling requires a shared Socket.IO adapter and cross-instance presence/broadcast coordination. Sessions and membership are checked on every command/read/handshake/broadcast and periodically every 15 seconds for idle sockets. Offline browsers disable mutations immediately; abrupt network blackholes are detected by Socket.IO heartbeats. There is no password recovery, email verification, MFA, session-management dashboard, account deletion, invitation delivery service, public campaign directory, automated movement rules or object-storage adapter yet. Account signup is open, but new accounts can access only their own campaigns. Restrict signup at the hosting/access layer if hosting privately. Add retention/cleanup policies for expired sessions, receipts, old checkpoints and unreferenced artwork before long-term use. Changing visibility cannot erase information a player previously received while it was authorised.

For builds behind a TLS-inspecting corporate proxy, the Dockerfile accepts an optional BuildKit `build_ca` secret. Pass your trusted public CA certificate using `--secret id=build_ca,src=/path/to/ca.pem` and the Docker automatic proxy build arguments as appropriate. The certificate is mounted only for dependency installation and is not embedded in the image. Do not disable TLS or package-integrity verification.

On this cloud machine, the optional full application image build encountered Docker builder DNS `EAI_AGAIN` during npm dependency installation even with proxy/CA configuration. Native installation/build and the PostgreSQL Compose service were verified. Recheck the image on your hosting builder; native Node deployment does not require that image.
