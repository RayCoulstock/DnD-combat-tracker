# DigitalOcean production setup — PR 2

**Preparation only. No Droplet, DNS change or production deployment is authorised by this PR.** The following runbook is for a later, explicitly approved installation. Development remains `docker compose up -d postgres` with `compose.yaml`; never combine that file with `compose.production.yaml`.

## Architecture and prerequisites

One Ubuntu **24.04 LTS**, amd64 Droplet: internet → Caddy on TCP 80/443 → one Node 24 app:3001 → PostgreSQL **17**:5432. Only Caddy publishes ports. `proxy` and `database` are separate internal Docker networks; Caddy cannot resolve PostgreSQL, and the app has no internet-facing network. The `edge` network gives Caddy ACME egress. No Redis, Kubernetes, replicas or public GLB bucket is introduced.

Start capacity planning around 2 vCPU / 4 GiB RAM and enough SSD for DB/WAL, GLBs, image retention, Restic cache and temporary plaintext backup artifacts. This is a **starting estimate, not a load benchmark**. Compose caps app at 1536 MiB, PostgreSQL at 768 MiB, Caddy at 256 MiB and DB connections at 30. GLB validation may use two 256 MiB JS worker heaps plus native allocations. Leave host/backup headroom and measure representative models before changing limits. A 25 MiB model limit is not an account storage quota.

Operational scripts target Bash, Python 3.9+ (Ubuntu 24.04 has 3.12), `flock`, Docker Engine/Compose v2 (tested v2.40.3) and Restic (tested 0.18.0). Node 24 + `npm ci` are needed on the **validation workstation/CI** for the local TLS smoke client; production host operations themselves need no host Node installation. Windows users can run these Ubuntu-oriented scripts from WSL2 with Docker Desktop integration; keep private env/password files on the WSL Linux filesystem where mode 0600 and ownership are enforced. Required infra tests fail if prerequisites are missing; normal frontend tests skip Ubuntu-only checks on unsupported hosts.

## 1. Future host preparation

After separate approval, create a Droplet with the operator's SSH **public key**, not a password. Establish an administrator account (`ledgerdeploy` in examples), verify a second SSH session and sudo access, then disable password SSH and direct root login using an sshd drop-in. Validate with `sshd -t` before reloading. Keep an emergency console/recovery path. Do not disable a working login before verifying the replacement.

Apply Ubuntu security updates, use UTC/NTP, enable security-update monitoring and plan reboots outside games. Restrict inbound SSH to administrator IPs in a **DigitalOcean Cloud Firewall**; permit TCP 80 and 443 publicly. Do not open 3001, 5432, Caddy admin 2019 or health 8080. Apply equivalent host firewall policy, but remember Docker's published-port rules can bypass ordinary UFW expectations: the cloud firewall and Compose's lack of app/DB port publications are essential. Outbound DNS, HTTPS, NTP and HTTP ACME/redirect traffic must work. This configuration publishes IPv4 only; do not add an AAAA record until IPv6 binding/firewall/TLS has been explicitly tested.

Install Docker from its official Ubuntu apt repository: create `/etc/apt/keyrings`, download the official Docker signing key over verified HTTPS, verify it against Docker's installation instructions, register the `noble` apt source with `signed-by`, and install `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`. Avoid unaudited `curl | sh` installers. Install Python 3, util-linux (`flock`), CA certificates and a reviewed Restic binary/package. Verify versions and daemon startup. Membership in the `docker` group is **root-equivalent**; grant it only to the trusted operator, never players.

Suggested paths, owned by the operator and private except the checked-out public code:

- `/opt/encounter-ledger/current`: reviewed source/configuration checkout; directory 0755 and Caddy config/snippet files 0644 (no secrets in these files).
- `/etc/encounter-ledger`: 0700; runtime env, backup env and Restic password files 0600, operator-owned.
- `/var/lib/encounter-ledger/operations`: 0700, operator-owned operation locks.
- `/var/backups/encounter-ledger`: 0700, temporary matched artifacts.
- `/var/cache/encounter-ledger`: 0700, Restic cache.

Do not install/enable the provided systemd timer yet. Review the example account, paths, permissions, memory budget and alert routing first.

## 2. Runtime configuration and images

Copy `.env.production.example` outside Git as `/etc/encounter-ledger/production.env` using `install -m 600`, then edit privately. Generate independent random 32-byte-or-longer database and session secrets (password-manager generation or redirected `openssl rand -hex 32`); do not print/export them into CI logs. Set matching POSTGRES_USER/DB/password and a URL-encoded DATABASE_URL password. Hex generation avoids URL escaping mistakes. Editing PostgreSQL env variables after the volume exists does **not** rotate its password; plan a separate reviewed credential rotation.

Set LEDGER_DOMAIN to the real hostname and APP_ORIGIN to exactly `https://that-host` with no path/trailing slash. Set the ACME contact email. Set LEDGER_IMAGE to the **reviewed application digest**, e.g. `ghcr.io/OWNER/encounter-ledger@sha256:...`; production preflight refuses mutable app tags and placeholders. Review/pin PostgreSQL 17 and Caddy 2 image digests too; PostgreSQL must retain its explicit `:17...` tag before `@sha256:...` so its major version stays reviewable. Dependency/image update policy belongs in PR 3.

The application image is pulled/smoke-tested explicitly before use. App and maintenance services use `pull_policy: never`, so startup cannot fetch a missing/unreviewed application image. Compose has **no build section**. Never substitute a `*-diagnostic` validation-only image for a production build. The image-created asset directory is UID/GID 1000:1000; its named volume is writable by the non-root app. Do not use an arbitrary root-owned bind directory. Assets are private API-delivered files, not a Caddy static root.

Runtime config is never sourced as shell code. Scripts validate file permissions and parse rendered Compose internally without printing secrets. Do not publish raw `docker compose config`/`docker inspect` output: those tools can expose runtime environment values. Docker build context excludes env files, key files and GLBs. Off-server backup credentials are **not** passed to the application or Caddy.

```sh
# Validation only: no services are started.
export LEDGER_ENV_FILE=/etc/encounter-ledger/production.env
scripts/ops/preflight.sh
```

## 3. DNS, TLS and public release — future approval required

Before a future cutover, approve the exact image/digest and validation report, confirm off-host backup credentials/restore rehearsal, then create the hostname's A record pointing to the approved Droplet. Keep SSH private and ports 80/443 reachable. Caddy uses public ACME automatically and persists certificates/state in `caddy-data` and `caddy-config`. HTTP redirects to HTTPS; WebSocket upgrades are handled automatically. No DNS API key or wildcard certificate is required.

Caddy preserves browser Origin, replaces X-Forwarded-For/Proto/Host and removes forged Forwarded/X-Real-IP. Node trusts exactly that one private hop. Secure, HttpOnly, SameSite=Lax cookies and existing CSRF/exact-origin/Socket.IO authorisation remain unchanged. Do not add a CDN or another proxy hop without reviewing this trust model. Global request cap is 32 MiB by default, covering the app's 25 MiB GLB plus multipart overhead; preflight refuses a cap smaller than the configured asset limit. Header/body timeouts are bounded; the 90-second upstream **header** deadline accommodates validation. No WebSocket stream/write deadline is imposed. Caddy shutdown has a bounded ten-second grace period (within Compose’s 35 seconds). Only HTTP/1.1 and HTTP/2 are advertised, so unpublished QUIC/UDP ports are unnecessary.

For an upgrade, take a successful matched encrypted backup with `backup.sh --keep-stopped`; leave app writes stopped through migrations. For the first installation, there is no prior data to back up: inspect the target/project/empty storage and record this exception. Never use that exception on an existing installation. Concurrent backup/migration/restore operations are locked per project.

```sh
# ONLY after a separately approved release window and verified image pull.
# Existing installation: first configure backup and run backup.sh --keep-stopped.
scripts/ops/migrate.sh --approve-migrations
# The migration job does not start/restart app or Caddy.
# Starting production remains a separate approved action:
scripts/ops/compose.sh up -d --wait --wait-timeout 180 app caddy
```

Caddy’s admin API is disabled. After a proxy configuration change, validate the config, then separately approve/recreate Caddy with `compose.sh up -d --wait --no-deps --force-recreate caddy`; `caddy reload` is deliberately unavailable. Persistent TLS volumes remain attached.

No seed is run. The app refuses pending migrations. Restarting a container never invokes migrations automatically. Migrations use the same image as the app and run as a profile-gated one-off job. There is no deployment workflow or production-start script running on push in this PR. Operators with Docker access can bypass wrappers, so scripts are safeguards, not a substitute for controlled administrator access.

## 4. Monitoring and routine operation

Monitor the **public HTTPS `/api/health`**, certificate expiry, container health/restarts, CPU/memory/OOMs, available disk bytes/inodes, PostgreSQL/WAL growth, backup age and restore-test age. Caddy's private 8080 endpoint is only Caddy liveness; it does not prove app/DB availability. Docker health marks unhealthy but does not automatically restart an unhealthy process; `unless-stopped` handles process exits/host reboots. Internal network/readiness dependencies are initial startup ordering, not ongoing failover automation.

Alert before disk is exhausted (for example 70% warning/85% urgent, tuned to growth). A successful SELECT 1 health check does not prove free disk or every GLB. Configure logs with finite retention; Compose rotates JSON logs at 10 MiB × 3 per service. Proxy logs remove Cookie/Authorization/CSRF/Set-Cookie fields; never enable `log_credentials` or body/secret tracing. Use `docker compose logs` only in controlled operator sessions. No credentials in `set -x`, build args or command-line URLs.

Node drains Socket.IO/HTTP and DB connections on SIGTERM with a 30-second deadline; Compose allows 35 seconds and uses init. PostgreSQL gets 60 seconds. A normal app restart disconnects and reconnects clients using persisted sessions/state and the same session secret; local cameras stay client-side. Keep the session secret stable across routine releases. Data backups are still required despite persistent volumes and restart policies.

## 5. Recovery and production concerns

Follow [backup and restore procedures](backup-restore.md) and the [risk register/test report](infrastructure-validation.md). Never troubleshoot by deleting volumes, resetting the database, using `pg_restore --clean`, or running development seed against production. Do not change Compose project names on a live installation: that selects different volumes and can look like lost data. An app-image rollback does not undo SQL or restore files. Match an earlier image only with a compatible schema; otherwise restore the matched backup into a fresh environment and verify before a separately approved cutover.

DM registration is closed by default in production (see the private-beta section below); review admission policy before any explicit re-enablement. Missing per-account disk quotas remain an explicit public-launch concern. The runtime DB user currently owns its application schema; role separation is future defence-in-depth work. Expired auth/session/receipt retention, real provider outage tests, model-specific capacity testing and alerts need an operations owner. Do not describe this preparation PR as an already deployed or universally production-approved service.

## Private beta: DM registration

`ALLOW_DM_REGISTRATION=false` is the production default and is explicit in `.env.production.example` and the production Compose application environment. Keep it false for private beta. The server rejects direct `/api/auth/register` requests with HTTP 403 even if a browser shows/forges the create-account action. `/api/session` reports only registration availability alongside the existing session response so the sign-in screen can explain the closure and omit Create account. Existing DMs still sign in normally; player invitation redemption, existing sessions and Socket.IO authorisation are unchanged. No accounts, campaigns or schema are changed.

The setting accepts exactly `true` or `false`; invalid values fail startup without printing their contents. Outside production the default is true for local development. To reproduce closure locally set `ALLOW_DM_REGISTRATION=false` and restart the backend, then reload the browser. Standalone local tracking does not require an account.

For an existing future deployment, change only its private runtime env file and recreate the app during an approved maintenance window; a container restart alone does not reload Compose environment values. This PR does not deploy or recreate anything. Keep the session secret stable. Do not run the development seed or delete accounts to close registration. If an administrator needs to bootstrap a first DM account, use a separately approved, access-restricted provisioning window, temporarily enable registration only there, then close it again before public access. Never leave registration enabled just for a health check. The isolated loopback smoke script explicitly enables it solely to create disposable synthetic test accounts; this does not change the production default.
