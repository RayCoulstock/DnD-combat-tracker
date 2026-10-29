# Matched backups and separate-environment restore verification

These scripts target one app instance. They never delete source databases/volumes or automatically prune backups. A backup is useful only when its decryption key and restoration procedure are available independently of the Droplet.

## Configure encrypted off-server storage (later, after approval)

Provision a **private** DigitalOcean Spaces bucket in a suitable region/account and configure a bucket-scoped read/write credential, not a broad administrator key. Do not enable public access or a CDN. Review whether separate credentials/accounts for recovery/deletion and provider-supported versioning/immutability meet the retention policy. Restic needs to create/remove repository locks; immutable lock objects can prevent operation. Never apply an S3 lifecycle rule that expires individual Restic pack/index/key files: that corrupts the repository.

Copy `.env.backup.example` to `/etc/encounter-ledger/backup.env` with mode 0600 and operator ownership. It uses an HTTPS S3 endpoint such as `s3:https://nyc3.digitaloceanspaces.com/BUCKET/encounter-ledger`. Store a unique high-entropy Restic password in a separate 0600 file, with an independently secured recovery copy/password manager. Losing this password makes encrypted backups irrecoverable. Database/GLB backups do not include the production env file: preserve runtime secrets, including SESSION_SECRET, separately and encrypted. Caddy volumes persist locally; this matched backup intentionally covers DB + GLBs, not live certificate storage. A disaster may require controlled certificate reissuance.

The backup env parser accepts literal `KEY=value` (optional matching quotes), not shell interpolation or commands. Do not put credentials in a repository URL. Only supported Restic/AWS fields are exported to the backup process. Check the provider endpoint/region and scoped credentials with the reviewed Restic version. Create a new repository **explicitly**, after approving its private bucket and policy, with `scripts/ops/init-backup.sh --approve-repository-init` (set LEDGER_ENV_FILE and LEDGER_BACKUP_ENV_FILE first). Restic refuses an already initialised repository; scheduled backups never initialise it. Restrict credentials so they cannot create unrelated buckets. Real Spaces credentials and off-server availability were not exercised by this PR.

## Capture a matched set

```sh
export LEDGER_ENV_FILE=/etc/encounter-ledger/production.env
export LEDGER_BACKUP_ENV_FILE=/etc/encounter-ledger/backup.env
scripts/ops/backup.sh
# For an approved upgrade, instead keep writes stopped until migration/cutover:
# scripts/ops/backup.sh --keep-stopped
```

The script validates configuration/repository access before interruption, locks project maintenance, requires existing app + running DB, stops the app gracefully, runs PostgreSQL 17 `pg_dump -Fc --no-owner`, and streams the private asset volume through a read-only archive helper. App writes cannot occur between DB and GLB capture. This assumes no external/admin writer or manually launched migration bypasses the lock. A manifest records schema format, PostgreSQL major, running app image, UTC time, sizes and SHA-256 hashes. No secret values are put in the manifest.

By default service resumes after local capture, before the encrypted upload, limiting downtime. Restic uploads the immutable set to the configured repository with stable host/project tags and reports a snapshot ID only on success. `--keep-stopped` deliberately leaves the app down, including on failure, to prevent an upgrade from proceeding with an uncertain recovery point. Normal exit/error traps remove only this invocation's private temporary backup artifacts, never source files/volumes. SIGKILL/power loss can leave private staging artifacts; inspect them manually and alert on failed backup jobs.

Temporary plaintext dumps/archives live in an operator-owned 0700 directory (default `/var/backups/encounter-ledger`), with files 0600. Plan free space for DB dump + compressed assets, restored uncompressed assets, Restic cache and database expansion. Archive verification defaults to a 50 GiB uncompressed asset budget; explicitly review/adjust `RESTORE_MAX_ASSET_BYTES` for larger collections. There is no arbitrary upload-to-public-bucket shortcut.

## Scheduling and retention

Review `deploy/systemd/encounter-ledger-backup.service` and `.timer` before installing/enabling them on a future server. They assume `ledgerdeploy`, the paths in the setup guide and a UTC host; the example runs daily at 03:15 plus up to ten minutes jitter and catches missed schedules. Ensure logs/failed units alert a human. Do not silently enable a timer in this PR or before a successful manual backup and restore rehearsal. Docker group access remains root-equivalent despite systemd filesystem hardening.

Initial retention guidance: seven daily, four weekly and twelve monthly snapshots, subject to actual recovery requirements, disk/cost and legal obligations. Random temporary source paths are grouped by **host and tags**, not paths, so they do not accidentally keep every snapshot forever.

```sh
scripts/ops/retention-plan.sh  # Restic forget --dry-run only; no prune/deletion
```

After verifying recovery, an operator may separately approve a reviewed Restic forget/prune policy. No destructive retention command runs automatically here. Check repository metadata routinely and periodically read data (`restic check --read-data` or an approved subset schedule), then restore into a fresh environment. Checksums/encryption alone do not prove a usable encounter. Track backup lag and the UTC time of the latest **successful restore**, not just job exit status.

## Verify restoration without touching production

Use an entirely separate workstation/host or a fresh `ledger-restore-*` Compose project, new named volumes, unique private env file, different DB credentials and **loopback-only high ports**. Use `deploy/Caddyfile.smoke` and `LEDGER_DOMAIN=localhost`, APP_ORIGIN=`https://localhost:HIGH_HTTPS_PORT`, LEDGER_BIND_IP=127.0.0.1. No DNS/public ACME is involved. Do not reuse a live project's name or volumes. Set the app image to the **image recorded in the backup manifest**; rehearse forward migrations only after reproducing that known state.

```sh
export LEDGER_PROJECT_NAME=ledger-restore-YYYYMMDD-unique
export LEDGER_ENV_FILE=/ABSOLUTE/private/restore.env
export LEDGER_BACKUP_ENV_FILE=/ABSOLUTE/private/backup.env
export LEDGER_LOCAL_TEST=1
export LEDGER_RESTORE_SOURCE_PROJECT=ledger-production
scripts/ops/restore-verify.sh EXPLICIT_SNAPSHOT_ID
```

The script downloads only the three known backup artifacts using Restic authenticated decryption into current-operator-owned files; it does not restore host parent-directory ownership, so differing host user IDs do not require root or ownership bypasses. The manifest independently verifies their hashes before any DB write. The script refuses `latest`, non-restore project names, non-loopback publication, existing containers/volumes/networks (including unlabelled name collisions), mismatched source project/image, failed hashes and unsafe archives (absolute/parent paths, links, devices or special permission bits). It restores only into a **new** PostgreSQL 17 instance with `pg_restore --single-transaction --no-owner --no-acl --exit-on-error`, without `--clean` or DROP; then extracts GLBs as UID/GID 1000. A partial failure leaves the isolated target for inspection; retry in a fresh project. The script does not start app/Caddy or overwrite existing target data.

Inspect counts and restored files first, then explicitly start **only this local test** app/Caddy and trust its test CA using NODE_EXTRA_CA_CERTS (do not disable TLS validation). Log in with a known test account, load a saved encounter/map/template, verify round/HP/conditions/token positions, retrieve an authorised GLB, check that an unauthorised browser is denied, connect two players, test movement/camera independence, restart and verify recovery again. To audit every ready library GLB without logging private filenames, run the read-only checksum/size audit after starting the isolated app:

```sh
scripts/ops/compose.sh exec -T app node --input-type=module < scripts/ops/audit-assets.mjs
```

Real production backup verification should use designated verification accounts and private access, never reset a DM password or expose real private maps publicly just to test restoration.

For repeatable synthetic end-to-end validation on Ubuntu/WSL with Docker, Node 24, installed npm dependencies and Restic:

```sh
# Already-built image; this script cannot build/pull/deploy a production image.
# Creates local test accounts and only high loopback ports, verifies real TLS with a private CA.
scripts/ops/backup-recovery-smoke.sh encounter-ledger:YOUR_LOCAL_REVIEW_IMAGE
```

It creates source fixtures, proves Secure-cookie DM/player login, WebSocket permissions and GLB delivery, exercises restart, then makes a **local encrypted Restic repository** (not an off-server backup), reads/checks it, rejects a wrong password, restores to a new project and verifies persisted data/GLB bytes. A second restore into that target must fail without overwriting it. Containers are stopped afterward and fixture volumes/config remain for inspection; no volume deletion occurs. This diagnostic is not a substitute for a complete production Dockerfile build or a real provider backup test.

## Disaster recovery and cutover (separate approval)

Recover secrets and the repository password from the independent store, provision a replacement host only after approval, and reproduce the verified image/config. Restore into the isolated environment above and check the full application before requesting public cutover. Keep the old writer stopped to avoid divergent encounters. A reviewed promotion must preserve the verified project's volume identity (changing project names selects different volumes), change origin/domain/Caddy configuration deliberately, arrange DNS/TLS only after approval, and establish the new backup host/project tags. Do not automate in-place database rollback or replace a live asset volume from a partial backup.

Floor-image maps (Milestone 5.2) use the same asset volume as GLBs. Back up the
`floor_images`, image-reference tables and version-4 map documents together with
their `.webp` files. The existing asset audit checks both GLBs and floor images.
See `docs/battle-map-image-import.md` for migration ordering and rollback limits.

Multi-level maps (schema version 5, migration 009) retain their floor image and
GLB references across every level, template and retained history frame. Continue
backing up the database and private asset volume as a matched set. Once v5 maps
have been saved, an older application cannot read them; rollback requires the
matching pre-upgrade database backup. See [multi-level maps](../multi-level-battle-maps.md).

Floor transitions (schema version 6, migration 010) use the same matched database
and private asset backup. Transition-only model references in current maps,
templates and retained history must remain available. Older application versions
cannot read v6 maps; follow the coordinated rollout and rollback guidance in
[vertical navigation and fullscreen maps](../vertical-navigation-fullscreen.md).
