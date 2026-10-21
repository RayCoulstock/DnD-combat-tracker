# Milestone 2: multiplayer architecture

## Repository inspection and compatibility

The initial checkout is a Vite React app. App.jsx owns mixed numeric/string IDs, roster order, round, active/selected IDs, used-ability keys (`id:category:name`), and version-1 encounter files with optional `battleMap`. BattleMap3D emits selection/movement callbacks and owns OrbitControls locally. src/mapState.ts is pure and safe to reuse on the server. Its integer X/Z grid is retained. The checkout contains duplicate import/export/artwork handlers that prevent compilation; remove only the obsolete duplicates. No tracked user edits were present; node_modules was the only untracked directory. Work is on feature/multiplayer-tabletop.

## Boundaries

* `shared/domain.ts`: validated version-1 serialization, combatants, typed commands, immutable transitions, permission checks, and explicit player projections. Uses the existing map functions. Local mode uses the same transitions as the server.
* `server/`: TypeScript Express + Socket.IO, Passport Local + Argon2id, express-session with a PostgreSQL store that hashes session IDs, node-postgres parameterized queries, and SQL migrations. No client-provided role/identity is accepted.
* `src/Multiplayer.tsx`: same-origin API and socket client; account/campaign/invitation screens; DM room management and a restricted player map. App remains the DM/local ledger.
* PostgreSQL is durable authority, including sessions, membership, invitation hashes, encounters, normalized combatant/ownership rows, command receipts, checkpoints, and content-addressed artwork. JSONB preserves flexible stat blocks. Artwork bytes are stored once behind an interface; encounter records contain references, exports rehydrate embedded images.

## Commands and ordering

Each command includes a UUID and expected revision. A transaction locks the campaign then encounter, authenticates current membership/session, checks active room and revision, applies the shared reducer, writes state/combatants/receipt, and commits before acknowledging. Duplicate IDs return their recorded revision without reapplying; the current filtered snapshot accompanies the receipt. Stale commands fail with a structured conflict and fresh snapshot. No offline mutation queue. A single Node process broadcasts full authorised projections for movement, initiative, combatant updates and restoration; clients accept newer revisions or explicit encounter switches. Socket rooms are joined only after database authorization and rejoined on each reconnect. Every broadcast rechecks the recipient; revocation and ending immediately remove access. Periodic checks also enforce expiry.

## Identity and information security

DM accounts use unique normalized email and Argon2id hashes with Passport Local authentication. HttpOnly, SameSite=Lax signed cookies reference hashed server-side sessions; Secure cookies and a required public origin apply in production. Login/redemption rotate sessions. CSRF tokens are session-bound and required for mutations and socket handshakes. HTTP mutations and Socket.IO require the configured exact Origin. Authentication and redemption are rate limited. Invitations are random 256-bit, SHA-256 hashed, one-use, expiring and revocable; redemption creates a stable membership UUID and a revocable 7-day player session. Display names never confer ownership. Player sessions cannot become DMs by altering requests. Membership and session status are rechecked for each command, read, handshake and broadcast.

Player snapshots use allowlists: hidden combatants, DM notes, private statistics, artwork and ability state of unowned creatures never enter their payload. Only assigned visible characters receive their complete permitted stat block. Hidden active turns appear as null. Grid token records and selected IDs are filtered too. Artwork reads are authorized against current visible combatants. Cameras, selection, connection status and transient form state are not authoritative or network commands.

## Stages and validation

A: document/extract domain and restore existing compilation; run map/domain tests.
B: schema/migrations, account and player identity; test real PostgreSQL HTTP authentication/redemption.
C: transactional command service and Socket.IO; test DM plus two players, isolation, concurrent/stale/idempotent commands, filtering and revocation.
D: integrate local/DM ledger, player battlefield and room controls; build/typecheck/lint and browser smoke checks.
E: test reconnect and server restart with the same database, checkpoint/artwork compatibility and security failure paths; document Codespaces/production.

## Deployment assumptions

One application instance serves the built Vite app and Socket.IO behind TLS, with managed PostgreSQL. Vite proxies /api and /socket.io during development; browser code uses relative paths. Docker Compose supplies local PostgreSQL. A single instance is deliberate for six participants: multi-instance broadcasts would need a Redis adapter and cross-instance notification/ordering. Use migrations before boot, a persistent database volume/backups, a strong SESSION_SECRET and exact APP_ORIGIN. No public registration discovery, object-storage integration, invitation email or automated combat rules are introduced.

## Delivered file inventory

Modified existing files:

- `src/App.jsx`: shared transitions for local and DM play; remove obsolete duplicate handlers; preserve stat-block importer, ledger, JSON and artwork controls.
- `src/BattleMap3D.tsx`: ownership-aware interaction, restricted player controls, local cameras, on-demand rendering.
- `src/mapState.ts`: retain coordinate/movement helpers and accept validated configurable map dimensions.
- `src/main.jsx`: mount the local/multiplayer entry point.
- `package.json`, `tsconfig.json`, `eslint.config.js`, `README.md`: complete development/test/build commands and TypeScript linting.

Created files:

- `shared/domain.ts`, `shared/domain.test.ts`: validated commands, encounter compatibility, shared rules, recipient filtering and typed socket contract.
- `server/app.ts`, `server/index.ts`: HTTP/authentication/room lifecycle, Socket.IO, authorization, security middleware and production serving.
- `server/db.ts`, `server/game.ts`, `server/sessions.ts`: transactions, durable authoritative state and hashed server-side sessions.
- `server/artwork.ts`: deduplicated storage abstraction and compatible embedded export.
- `server/migrations/001_initial.sql`, `server/migrate.ts`, `server/seed.ts`: schema, transactional migrations and optional safe development seeding.
- `server/tsconfig.json`, `server/tests/multiplayer.test.ts`: backend compilation and real PostgreSQL multiplayer/security integration tests.
- `src/Multiplayer.tsx`, `src/multiplayer.css`, `src/vite-env.d.ts`: account/campaign/DM/player UI, connection recovery and styling.
- `vite.config.ts`: same-origin development HTTP/WebSocket proxy.
- `playwright.config.ts`, `e2e/multiplayer.spec.ts`: separate-browser functional and camera tests.
- `compose.yaml`, `Dockerfile`, `.dockerignore`: local PostgreSQL and production application image.
- `.env.example`, `.gitignore`, `package-lock.json`: documented configuration, secret/output exclusions and reproducible dependencies.
- `docs/multiplayer-architecture.md`, `docs/multiplayer-development.md`: architecture, schema, runbook, testing, deployment and security limits.

## Validation evidence

Stages A–E were implemented incrementally on `feature/multiplayer-tabletop`. A clean `npm ci` succeeded. All six existing map tests and four shared-domain tests passed. The PostgreSQL integration lifecycle passed 16 checks (including its parent test), with a DM and two simulated players. The Playwright test passed with a DM and two separate Chromium browser contexts, shared movement, independent camera screenshots, offline camera reset and automatic reconnection. Lint, frontend/backend type checks, production assets/backend compilation, repeat migrations (source and compiled), production HTTP/secure-cookie smoke checks, and repeat-safe development seeding passed. The initial duplicate-handler defect is fixed. The Vite bundle emits a nonfatal size warning (~1.6 MB JavaScript, ~446 KB gzip); no bundle-size threshold was disabled.

The tests establish the local development and single-service architecture; they do not claim a published remote branch, a live cloud deployment, a six-person geographical latency test, or a fresh-task environment restoration. See the runbook for required TLS/proxy/database deployment configuration and prototype limits.

The optional production Docker image build was attempted with the platform proxy and trusted CA, but its dependency installation hit container DNS `EAI_AGAIN` errors for npm registry requests. The Dockerfile is provided but its complete image build is unverified here. PostgreSQL Compose startup, native `npm ci`, native production compilation and the production HTTP smoke test all passed. Recheck `docker build` on the deployment builder before using the image.
