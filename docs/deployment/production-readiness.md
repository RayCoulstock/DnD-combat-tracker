# Production readiness — Phase 1

This PR prepares repository code only. It does not provision or deploy DigitalOcean, create a Caddy site, change DNS, or merge automatically. See [repository audit](repository-audit.md) for findings and unresolved risks.

## Build and runtime contract

Use Node.js 24 and the committed lockfile:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

`build` produces `dist/index.html`, browser bundles and `dist-server/server/index.js`, `migrate.js`, the GLB validation worker, shared domain modules and **all seven SQL files** in `dist-server/server/migrations`. The Node filesystem script replaces shell `cp` and cleans only this generated SQL output. Run commands from the repository/app root. No Windows runner was available here; the portable-copy test covers spaces and repeated runs using Node APIs.

For production, copy `.env.production.example` to a private runtime configuration file **outside the checkout**, fill placeholders and restrict permissions to the operator. Keep the SESSION_SECRET stable across restarts. Runtime preflight rejects incomplete configuration and unsafe origins without logging supplied values. The template is deliberately unusable until secrets are replaced. PostgreSQL credentials must match the PostgreSQL service; URL-encode the URL password separately. Do not set any VITE_-prefixed secrets. The frontend needs no database credentials, session secret or hardcoded host URL.

Apply migrations as an explicit release step, using the same runtime environment as the app:

```sh
# Native: export runtime environment securely before these commands.
npm run db:migrate:production
npm start

# Future production Compose: supply --env-file and the production service configuration.
# docker compose ... run --rm app node dist-server/server/migrate.js
```

Migrations run in one transaction with an advisory lock and a migration ledger; rerunning applies only missing SQL. Startup refuses missing migrations. Neither startup nor migration executes the development seed; `db:seed` now explicitly refuses production. Never run tests/seed against production, reset the database, or delete a production volume to resolve a migration problem. Back up before migrations and plan data-compatible rollback.

## Container and reverse proxy

```sh
docker build -t encounter-ledger:review .
```

The existing multi-stage Node 24 slim image installs build dependencies only in the build stage and uses `npm ci --omit=dev` in runtime. It runs as `node` (UID 1000), serves the built frontend/API/socket together, and declares `/var/lib/encounter-ledger/assets` as a volume. Build-context exclusions cover env files, logs, private keys, GLBs and generated output. The optional `build_ca` secret can supply a trusted public corporate CA for npm installation; do not disable TLS/integrity verification. No database credentials or SESSION_SECRET are build inputs.

The future Compose file must provide DATABASE_URL, SESSION_SECRET, exact HTTPS APP_ORIGIN, NODE_ENV=production, PORT, TRUST_PROXY and persistent ASSET_STORAGE_DIR at **runtime**, not image build time. Only Caddy publishes 80/443. Keep app:3001 and PostgreSQL:5432 on private networks. With TRUST_PROXY=1, exactly one trusted Caddy hop must replace client-supplied forwarding headers. For a host-local proxy, `loopback` is available. `0` ignores forwarding and cannot issue Secure cookies over plain HTTP. Caddy must support WebSocket upgrades and retain the browser Origin; no wildcard CORS is needed. Configure an upload limit allowing the 25 MiB GLB plus multipart overhead, and a suitable request timeout without dropping live WebSockets.

Anonymous `/api/health` is readiness (200 with PostgreSQL available, 503 otherwise); `/api/health/live` is process liveness. The image health check probes readiness every 30 seconds with a 4-second client deadline, a 30-second startup allowance and three failures before unhealthy. Docker's unhealthy status alone does **not** restart a process. Use monitoring; an orchestrator is not introduced here. Shutdown drains HTTP/Socket.IO and PostgreSQL for at most 30 seconds; configure `init: true` and `stop_grace_period: 35s` or longer in future Compose.

## Assets and recovery

Keep GLBs on a named volume or an absolute, private bind mount outside `/app`; the mounted directory must be writable by UID/GID 1000:1000. Files use server-generated owner/hash keys and are delivered through authenticated API routes, never an unrestricted Caddy static directory. All validation limits are documented in the environment template. Increase them only after measuring memory/GPU costs.

Back up PostgreSQL **and** the asset directory as a matched set. A simple consistent procedure is to stop app writes, dump PostgreSQL, archive assets with permissions, then resume. Store encrypted backups off-host and rehearse restoration into a separate environment. Restore both before app startup, retain the session secret if existing sessions should survive, run required forward migrations, then verify readiness, account access, a saved encounter and an authenticated GLB. Startup recovery handles incomplete uploads and pending deletions; it cannot recover missing ready files. Do not delete uploaded models or run volume-pruning commands as troubleshooting shortcuts.

## Local validation record

Validation uses a new loopback-only PostgreSQL 17 test container (`ledger-pr1-postgres`, port 55433) and `/tmp/ledger-pr1-assets`; existing tracker data and uploads are not used. The container uses trust authentication solely on this isolated local test instance, **not as a production setting**. Integration tests create/drop only their own randomly named schemas. Browser tests add fixture accounts and encounters in this separate test DB. Test environment files are mode 0600 in `/tmp`, not tracked or copied into images.

- `npm ci`: passed (including a clean install after dependency classification changes).
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`: see final results below.
- `npm run db:migrate:production`: passed against the separate PostgreSQL instance; compiled migration command also ran twice to verify idempotence.
- API integration includes production HTTPS forwarding/Secure cookie registration, ignored untrusted forwarding, and rejected cross-origin mutations.
- `npm run test:e2e`: all 12 scenarios passed using Chromium `/usr/bin/chromium`, including local mode, two-player multiplayer, sessions/reconnection, independent cameras, map editing/templates, GLB library/scenery/architecture and miniatures.
- Dockerfile parsing and build-stage execution reached npm dependency installation. Full image build is **blocked**: Docker RUN requests to `registry.npmjs.org` repeatedly return `EAI_AGAIN`. Retried default networking, host networking and automatic proxy arguments with the existing BuildKit CA-secret mechanism (also forced registry traffic through the proxy). Local `DOCKER_CONFIG=/tmp/pr1-docker-config` resolved the initial read-only `/home/agent/.docker/buildx` configuration issue. No TLS verification was disabled. Retrying builds were cancelled rather than waiting indefinitely.
- Therefore a full production image and its smoke test are **not claimed as passing**. Run them in GitHub Actions/on the intended VPS builder before deployment. Native compiled-runtime checks are additional evidence, not a replacement for that release gate.

PR creation requires working GitHub CLI/API authentication. Git transport and API authentication are separate; if the CLI cannot authenticate, a pushed branch and prepared PR description do not mean a PR has been opened.

### Final results

53 unit tests, 50 integration tests and all 12 Playwright scenarios pass. Type checking, ESLint, clean installs, the portable production build and `npm run db:migrate:production` pass. A separate offline `npm ci --omit=dev` install contains 200 packages and excludes Vite, its React plugin and TypeScript. Using only that install and copied compiled output, plain Node 24 passed GLB-worker validation, static frontend/readiness, Secure-cookie DM login, authenticated WebSocket connection, SIGTERM with a live socket (zero exit), and restart with the same persisted session and unchanged GLB bytes. A frontend-bundle scan found no configured database URL, session secret or seed password. These are **native runtime** results; Docker image build/smoke remains blocked as described above. No SQL migration or game/UI/protocol change is included.
