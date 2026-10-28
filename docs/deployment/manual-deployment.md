# One-command manual production deployment

After the reviewed scripts are installed, run this from the Windows repository in PowerShell:

```powershell
.\scripts\ops\deploy.ps1
```

It checks the existing Droplet over SSH, selects the newest successful **main publication workflow** (not a moving Docker tag or a GitHub Release title), verifies its evidence and digest, and shows the current image, proposed image, commit, publication run and whether deployment is required. If a change is needed, type the exact `DEPLOY <run-id>` confirmation shown. Anything else cancels. If already current, nothing is restarted.

```powershell
.\scripts\ops\deploy.ps1 -Plan                       # Read-only deployment plan; no confirmation/apply
.\scripts\ops\deploy.ps1 -Release 123456789          # Explicit successful publication run ID
.\scripts\ops\deploy.ps1 -Release <full-40-char-sha> # Latest successful publication of that main commit
.\scripts\ops\deploy.ps1 -IdentityFile "$env:USERPROFILE\.ssh\ledgerdeploy"
```

Use actual IDs/SHA values, without angle brackets. No digest copying, local Docker, local Node, local GitHub login or deployment service is needed. Windows uses OpenSSH; GitHub/registry verification happens on the existing server. No unattended deployment, GitHub Actions dispatch or infrastructure provisioning is added. The existing GitHub Actions production workflow remains unchanged and disabled until separately approved.

## One-time reviewed installation (not performed by this change)

1. Review/merge the PR, then update the **Windows checkout** to that reviewed main commit. Use Windows PowerShell 5.1 or PowerShell 7 and the Windows OpenSSH client. Confirm `Get-Command ssh`. Unlock the operator key in the SSH agent, or use `-IdentityFile`; batch SSH does not prompt for a key password. This command uses the existing unrestricted operator key, not the GitHub Actions forced-command key.
2. Independently verify the Droplet SSH host-key fingerprint (for example through the DigitalOcean console). Establish the known-host entry using your normal SSH client **only after verifying that fingerprint**. The script enforces `StrictHostKeyChecking=yes`; it does not run ssh-keyscan, accept a new key automatically or forward the agent. Defaults are `ledgerdeploy@ledger.eruditology.com:22`; optional `-SshHost`/`-Port` support an already configured operator SSH alias/port, not another deployment environment.
3. In a separately approved operator session, install the reviewed scripts in the **existing** `/opt/encounter-ledger/current` checkout. Inspect `git status` first and update with a reviewed fast-forward; never reset local changes. Linux Git supplies LF shell scripts and executable modes. This is a code installation only: do not start services or change runtime secrets to install the command. Future invocations do not pull Git, switch branches, replace Compose or rewrite Caddy.
4. As `ledgerdeploy`, confirm existing Docker Engine, Compose (tested 2.40.3; `config --hash` required), Python 3.12, Bash/flock, curl and Restic work. The existing Node 24 **application container** runs the repository's unchanged `scripts/ci/release-gates.mjs` on public release metadata; no host Node installation is needed.
5. Install a reviewed GitHub CLI supporting attestations (tested gh 2.74.2 or newer), using the official verified packages/releases; check `gh --version` and `gh attestation verify --help`. Authenticate **on the Droplet** with read-only Actions/repository/attestation access and read-only GHCR package access as required by repository visibility. For private packages, configure the existing operator's Docker credential helper/login too. Use scoped read-only machine credentials; no package-write or repository-admin scope is needed. Keep gh/Docker credential files private. Do not pass tokens through this PowerShell command, URLs or shell tracing. Publishing continues to use GITHUB_TOKEN in Actions; the host's read credentials are separate.
6. Preserve the existing private, operator-owned files `/etc/encounter-ledger/production.env` and `/etc/encounter-ledger/backup.env`. The backup repository must already be initialised, encrypted and accessible in Spaces. Set `ALLOW_DM_REGISTRATION=false` and retain exactly one **literal** `LEDGER_IMAGE=...@sha256:...` binding. Existing secrets, comments, quotes and line endings are preserved; interpolated/duplicate image bindings are refused. The production origin must be exactly `https://ledger.eruditology.com`; project remains `ledger-production`.
7. During installation, ensure the existing maintenance/staging directories and the new private report directory are available:

```sh
# Installation only, after reviewing ownership and while no maintenance is active.
sudo install -d -o ledgerdeploy -g ledgerdeploy -m 700 \
  /var/lib/encounter-ledger/operations /var/lib/encounter-ledger/deployments \
  /var/backups/encounter-ledger
# Touch an absent lock; NEVER replace an existing lock inode while it may be held.
sudo -u ledgerdeploy sh -c 'umask 077; touch /var/lib/encounter-ledger/operations/ledger-production.lock'
```

The runtime directory must allow its operator to atomically replace production.env, as in the existing runbook; runtime files remain owner-only. Reports are mode 0600 in a mode-0700 directory. No real files or permissions were changed by this PR. The public URL is never contacted by automated repository tests.

## Verification, planning and approval

A plan checks current production preflight and healthy app/PostgreSQL/Caddy containers, current Compose config hashes and image identity, public verified HTTPS readiness, at least 10 GiB free headroom in Docker and backup staging, existing backup credentials/repository access, successful publication metadata and exact registry availability. The floor is not a sizing guarantee: retain enough space for the actual DB dump, GLBs, Restic cache, images and database/WAL growth; review large collections before upgrading.

Release selection downloads only the same trusted run's `release-<commit>` artifact and uses the existing JavaScript `validateRun`/`validateRelease` gates unchanged. It requires the original repository's completed successful `push` to `main`, the expected publish workflow, matching commit/run ID, genuine production-image validation flags and immutable digest. It verifies GitHub provenance for that exact repository/workflow/ref/commit and compares the registry manifest configuration digest with the tested image ID. Missing/expired evidence (currently retained 30 days), unavailable registry/authentication, failed attestations or malformed metadata **abort**, rather than silently selecting an older image. Explicit selection does not bypass any gate.

Plan mode does not pull images, stop services, back up, write a deployment report, edit production.env or run SQL. It reads metadata, uses an existing maintenance lock and the app's Node process for validation, and may populate ordinary CLI trust/metadata caches. The existing app remains running. Any running/desired configuration drift is refused: reconcile it deliberately, rather than letting an app-image upgrade apply unrelated settings. Keep the current Compose CLI/configuration consistent; an independently upgraded Compose hash algorithm may also require a reviewed reconciliation.

Confirmation is bound to the selected **run and digest**, current running image ID, private runtime-file fingerprint and reviewed checkout commit. Apply reacquires the maintenance lock and repeats verification. If anything changed while the operator was reading the plan, it refuses and asks for a new plan. The file fingerprint is sent as a hash only; no secrets or raw Compose output are shown.

## Apply sequence and scope

The Ubuntu entry point is `scripts/ops/deploy-release.sh`; its Python controller calls the **existing** Compose, preflight, backup and migration scripts. PowerShell supplies its exact confirmed plan automatically; direct `--apply` without those fields is refused.

1. Hold the same `ledger-production.lock` used by scheduled backups/migrations throughout verification, pull, backup, migration, startup, health and final reporting. Existing child scripts validate and inherit the descriptor; there is no unlock/relock gap.
2. Pull the exact approved image **before stopping writes**. Verify image ID, commit label, platform and absence of the diagnostic-only label. A network-isolated temporary probe verifies that the compiled runtime supports closed DM registration; old pre-beta images are refused before interruption. The probe mounts no existing production volume and contacts no database.
3. Run `backup.sh --keep-stopped`, capturing a matched encrypted PostgreSQL/GLB backup. Require a successful receipt and durably record its full snapshot ID **before** any config/SQL change.
4. Compare production.env with the approved captured bytes, then atomically replace only its image value, retaining other bytes, permissions and group. A concurrent operator edit is refused rather than overwritten.
5. Run `migrate.sh --approve-migrations`. No migrations run at container startup and no seed runs. Start app/Caddy through the production wrapper with `--no-deps --wait`, preserving volumes and avoiding an unrelated PostgreSQL restart.
6. Verify healthy containers, exact new image/configuration, still-disabled registration and public HTTPS `/api/health`. Write the release/run, previous release, snapshot ID, stage and result to a private JSON report. No database dump, session secret, token, password or raw tool output is stored in the report or shown in the terminal.

No `down -v`, volume deletion, image prune, account changes, DNS changes or database restore is performed. Existing network/permissions/cookies remain those enforced by production Compose/preflight. The optional future GitHub Environment deployer is not enabled or bypassed; this is a separately operator-approved route using the same published-image gates and production preflight.

## Failures, disconnection and recovery

Before backup, a failed check/pull leaves the existing application alone. A backup failure does **not** replace the image setting or run migrations. The old app may still be running if the backup failed before stopping it, or remain stopped under the existing `--keep-stopped` contract. It is never automatically restarted. After a migration/startup/health failure, the script stops app writes, retains the new setting and snapshot receipt, and reports the stage/recovery location. It does not assume the old image is SQL-compatible.

Normal interruptions are honoured at stage boundaries. Backup/migration/startup commands are isolated from the SSH process group and retain the inherited lock; an interruption waits for the active critical command to finish before proceeding to controlled failure. No client-side retry is attempted. On SSH loss, SIGKILL, host failure or a missing final response, **do not blindly rerun**: inspect the existing process/lock, one-off migration containers and private report first. Abrupt host failure cannot guarantee a complete report; a report's stage is recovery context, not proof that SQL did not begin. If snapshot persistence fails, no config/migration follows. Reports/snapshot IDs should also be copied into the operator's private change record.

Read the reported `/var/lib/encounter-ledger/deployments/deployment-<id>.json` as ledgerdeploy. Inspect protected service/migration diagnostics without dumping environment/Compose secrets. If a backup failed before config/SQL changes, an operator may choose to resume the old app after resolving the backup fault. If SQL started, decide compatibility explicitly. To deploy a previous **compatible** image from a healthy installation, use its successful run ID/full commit with `-Release`; the same gates, backup and confirmation apply. For uncertain schema compatibility, follow [separate-environment restore verification](backup-restore.md), then separately approve cutover. No automatic database rollback is safe.

## Local validation and limitations

Offline fault tests exercise real shared JS release gates, selection, malformed/expired/unattested metadata, unavailable images, secret-preserving replacement, backup/migration/startup/health failures, stale plans, no-op, interruption receipts and actual inherited lock exclusion. Real PowerShell is exercised with a fake SSH executable for plan, confirmation, cancel/no-op, bad metadata and explicit selections. Repository tests do not connect to the Droplet, GHCR/Spaces or the public application, and do not prove a real deployment. Native Windows OpenSSH/agent behaviour and the first approved production plan/deployment remain operator validation steps.
