# PR 2 validation and unresolved-risk register

## Scope and release gates

PR 2 is based on latest main (merged PR 1), branch `feature/digitalocean-infrastructure-pr2`. No cloud resources, DNS records, public ACME certificates, off-server backup repository or production deployment were created. Development `compose.yaml`, game/domain schemas, SQL migrations, UI and multiplayer protocols are unchanged.

The owner reports that the full PR 1 production Docker image built and passed a temporary-PostgreSQL smoke test on Windows. That is useful independent evidence; the historical PR 1 DNS failure is **not** claimed to affect all machines. In this cloud execution environment the PR 2 full Dockerfile attempt again returned `EAI_AGAIN` for registry.npmjs.org during npm ci, and was cancelled after a bounded 180-second attempt. No TLS verification was disabled.

To validate infrastructure despite that builder restriction, a **temporary diagnostic image** was assembled locally from fresh native compiled output and locked production-only dependencies (no dev tools). Its Dockerfile is outside the repository, its tag includes `diagnostic`, and its `org.encounter-ledger.validation-only=true` label is rejected by the production migration wrapper. This image is not a production release artifact and cannot satisfy the complete-Dockerfile build gate. Local smoke mode is restricted to `ledger-smoke-*`/`ledger-restore-*` projects and high loopback ports. All test containers/volumes are retained stopped rather than deleted; existing development PostgreSQL and uploaded assets are untouched.

Before deployment, the **exact real application image digest** must pass a successful full Dockerfile build and the local TLS/backup-recovery smoke procedure on a supported builder/workstation. An already verified Windows-built image can be tested/published by digest; no diagnostic fallback is permitted for production. Production migration additionally requires explicit `--approve-migrations`, a stopped app and a locally present non-diagnostic image. No app-start/deployment automation runs on push.

## Automated checks and reproduction

```sh
npm ci
npm run test:infra   # Required Ubuntu/WSL tools; fails rather than silently skipping prerequisites
npm test
npm run typecheck
npm run lint
npm run build
# Existing test environment only, never production:
npm run test:integration
npm run test:e2e
```

Infrastructure tests cover rendered network/port/volume boundaries, required secrets, immutable app images, PostgreSQL major, origin/proxy consistency, inherited HTTP proxy rejection, upload cap consistency, explicit migration profile/approval, production restore refusal, archive traversal/link/corruption rejection, literal backup configuration, Caddy validation with networking disabled, shell syntax and development Compose independence. Default npm test skips Ubuntu-only checks on unsupported hosts; `test:infra` makes the prerequisites mandatory. Caddy validation does not start listeners or contact ACME.

```sh
# First build the actual production image (required release gate):
docker build -t encounter-ledger:review .
# Local validation only, with Node 24 and reviewed Restic installed:
scripts/ops/backup-recovery-smoke.sh encounter-ledger:review
```

This exercise uses a real Caddy container with an internal test CA trusted only via NODE_EXTRA_CA_CERTS, not `--insecure`/disabled TLS. It verifies private container networking and ports, UID 1000, Secure/HttpOnly/SameSite cookies even with forged forwarding headers, exact Origin/CSRF rejection, DM/player authentication, authorised Socket.IO room/command traffic, player permission denial, GLB upload/private retrieval, persisted miniature assignment and token positions, and graceful restart/session recovery. Caddy must not resolve the database; Node and PostgreSQL have no host publications. A matched encrypted Restic backup is checked/read, opened with a wrong password (must fail), restored into a fresh project with different DB/session secrets, and verified through TLS. Reusing that target must be rejected without overwriting it.

Two practical failures caught during local validation were corrected: Docker client HTTP proxy defaults initially routed private Caddy→app traffic through an external proxy (403); all service proxy environment defaults are now explicitly cleared with NO_PROXY='*'. A container liveness probe also disables wget's forward proxy. Proxy logs explicitly filter session/auth/CSRF headers, with a sentinel-header smoke assertion. The test CA is never installed into the host's global trust store.

## Remaining risks / ownership

| Risk | Required next action |
| --- | --- |
| Production Dockerfile build blocked in this execution environment | CI/workstation must build and smoke-test the exact release digest. Windows result is owner-reported; diagnostic image results are not a production build. |
| No real Droplet/firewall/DNS/public ACME validation | Future approved provisioning and external TLS/network checks; A record only until IPv6 is tested. Caddy config syntax/local TLS are not internet-reachability proof. |
| Off-server S3 endpoint/scoped credentials/region not exercised | Approve a private bucket, initialise repository explicitly, test backup/read/restore and alerts using the intended provider. Local encrypted Restic tests do not prove Spaces access. |
| Open DM registration; no per-account asset quota | Decide admission policy and storage quotas before unrestricted public access; backend rate limits alone do not prevent distributed disk abuse. |
| DB/schema owner used by runtime | Consider a separate limited runtime role/migration owner in a reviewed application/DB change; current single-private-DB model is not exposed publicly. |
| Data migration rollback | Back up matched DB/GLBs before upgrade. Only compatible schema permits image rollback; restore and verify in a separate environment otherwise. No automatic down migrations/volume replacement. |
| Restore reverts authorisation to snapshot time | Reconcile membership/invitation revocations before cutover. Retaining session secret preserves sessions, including those in the backup; rotate it if incident containment requires reauthentication. |
| Server capacity and backup window | 4 GiB/2 vCPU is a starting budget, not a benchmark. Measure models, memory/OOM, DB/WAL growth, free bytes/inodes, backup capture time and restore capacity. Account for plaintext staging/cache. |
| Backup retention, keys and alerts | Preserve a separate password/runtime-secret recovery copy. Daily timer is only an example (up to 24h RPO); back up after games/releases or increase frequency as needed. Dry-run retention only; no automatic prune. |
| Expired sessions/command receipts and logs grow | Set explicit retention/maintenance and monitor growth; no live data-deletion job is introduced here. |
| Mutable Caddy/PostgreSQL tags | Pin reviewed digests and establish update scanning/rehearsal; PostgreSQL must remain major 17. Do not silently major-upgrade the DB. |
| Unhealthy != restarted | Monitor public readiness, certificates, backup age and restart/OOM logs. Docker restart policy handles exit, not unhealthy status. |
| Host root-equivalent Docker access | Restrict operator access, use SSH keys, pin SSH host keys for future automation, keep runtime/backup secrets outside Git. |

## PR 3: GitHub Actions CI/CD recommendation

First add unprivileged PR CI: clean install, lint/types/unit/API/browser/infra tests with isolated PostgreSQL, full multi-stage image build, real local-Caddy TLS and encrypted backup/restore exercise. Bind test reports to the image digest and Git commit. Fork PR jobs get no production secrets. Publish immutable images/SBOM/provenance only from protected, reviewed refs with minimal permissions; scan and update Node/Caddy/PostgreSQL deliberately.

Deployment is a **separate approved GitHub Environment job**, initially disabled until the owner approves infrastructure and all gates. Use scoped registry/SSH credentials, pinned SSH host keys (never disable host-key checking), protected runtime secret delivery and one release lock. Pull/verify digest → matched backup with writes stopped → explicit migration → separately approved app/Caddy startup → public readiness/auth/socket check. On failure leave a clear operator-owned recovery decision; do not reset DB, prune volumes or assume image rollback reverses SQL. No CI/CD deployment workflow is added in this PR.

## Final local results (26 October 2026)

- Clean `npm ci`, type checks, ESLint and native production build: **pass** (existing Vite large-bundle advisory only).
- `npm test`: **61 pass** (53 existing readiness/domain tests plus 8 infrastructure scenarios); required `npm run test:infra`: **8 pass, no skips**.
- API integration on a separate loopback PostgreSQL 17 test DB: **50 pass**. Existing Playwright regressions: **12 pass** (local, DM/two players, camera independence, sessions/reconnection, import/export, dungeon generation/templates and custom 3D assets).
- Real Caddy image parsing with network disabled: **pass**. Local Caddy/app/PostgreSQL containers using the explicitly labelled diagnostic artifact: **pass**, including TLS with a private trusted CA, Secure cookies despite forged forwarding scheme, CSRF/Origin denial, DM/player WebSockets/ownership, authenticated GLB upload/private delivery, unexposed Node/DB ports, Caddy→DB DNS isolation and non-root app UID.
- App restart with a live authenticated socket and a separate Caddy restart: **pass**; restored session/encounter/token/model data remains readable. Proxy secret-header sentinel is absent from access logs.
- Real Restic 0.18 local encrypted repository: matched dump/assets backup, full `check --read-data`, wrong-password rejection, retention **dry-run**, fresh-environment restore with new DB/session secrets, rejection of a populated target, and TLS verification of restored encounter/model bytes: **pass**. Read-only audit of every ready restored GLB reports **1/1 valid**.
- Complete production Dockerfile build in this environment: **blocked at npm registry DNS (`EAI_AGAIN`)**, bounded/cancelled after 180 seconds. No successful production-image result is substituted for this. Owner-reported Windows full-image/container smoke remains independent evidence. Off-server Spaces operations, real Ubuntu systemd execution, public DNS/ACME and DigitalOcean host hardening remain **not exercised** by design.

Only temporary fixture artifacts were removed; no application database reset, source upload deletion or existing/named data-volume deletion was performed. New disposable validation containers and their anonymous state are removed normally. Local test containers are stopped and fixture volumes are retained. No CI deployment workflow, cloud resource creation or automatic merge is included.
