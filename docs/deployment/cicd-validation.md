# PR 3 security and release-gate validation

Local validation: **26 October 2026**. Base: merged PR 1/2, main `a732692`; branch `feature/github-actions-cicd-pr3`. These are workstation results, not GitHub-hosted or DigitalOcean deployment results.

## Results

| Check | Result and limits |
| --- | --- |
| Clean `npm ci` | Pass with an explicit writable temporary npm cache; default cloud HOME cache is read-only. Lockfile unchanged. |
| `npm run typecheck`, `npm run lint`, `npm run build` | Pass; existing Vite large-bundle advisory remains. Native compilation is not Docker release evidence. |
| `npm test` | 70 pass: 28 scripts/map/app tests (including 9 new CI/CD gates) plus 42 shared/server tests. |
| `npm run test:infra` | 8 pass, no skips; actual Docker Compose and Caddy syntax/image checks, not mocked prerequisites. |
| `npm run test:integration` | 50 pass on a new isolated loopback PostgreSQL 17.11 container, not development/staging/production. |
| `npm run test:e2e` | Fresh final run: 12 pass. Initial run had 11 pass and one miniature player-connection failure (`Disconnected` at 15s); full suite rerun with fresh fixtures after concurrent builds stopped passed without changing tests/timeouts or app code. Treat this as a remaining intermittent-browser-test concern, not a guaranteed cause diagnosis. |
| Lockfile Chromium download | Attempted; this environment's CDN access returns HTTP 403 `Domain forbidden`. Local browser regressions used installed Chromium 154.0.8037.57 via existing CHROMIUM_PATH support. CI has no such fallback: its lockfile Chromium installation is required and must fail if unavailable. |
| Workflow YAML and expressions | actionlint 1.7.7 pass for all four workflows; action SHAs resolved from upstream version refs. Compared environment response/policy fields against GitHub's official REST schema. |
| Shell/Python | ShellCheck 0.10.0 pass on new shell tools; Python compilation pass; infrastructure checks also run existing operations shell parsing. Verified pinned tool downloads/checksums and gh attestation flag availability. |
| Release-gate regressions | Pass: trusted main run/digest/evidence only; diagnostic image denial; reviewers/self-review/main-only branches; host environment/target/restore age; occupied-local-port refusal; strict SSH/forced-command injection and cross-environment denial; inherited maintenance-lock identity and concurrent exclusion. |
| Complete actual Dockerfile Buildx build | **Blocked**: default builder repeatedly returned npm registry `EAI_AGAIN`; bounded attempt cancelled. Network-host and explicitly supplied environment-proxy/secret-CA attempts also returned the same error and were cancelled. No TLS/integrity verification disabled; no native/diagnostic image substituted. |
| New genuine-image HTTPS/GLB/encrypted-recovery gate | **Not run to completion**: no newly built genuine image exists because of the build blocker. The workflow requires the existing real PR 2 smoke/recovery procedure and does not count prior diagnostic evidence as a PR 3 release pass. |
| GitHub-hosted workflow execution | Not exercised here; Actions service, installation of pinned Engine/Buildx on hosted Ubuntu, artifact handoff, protected-main context and configured repository policies must be verified by the PR run/owner. |
| GHCR push, digest and attestations | **Not published** by this workstation; no approved image digest reported. Only a successful main workflow may publish after all native and real-image gates. |
| Staging/production SSH and public checks | **Disabled/unexercised**: no infrastructure provisioned, DNS changed, secrets/settings installed or workflow dispatched. No DigitalOcean, public ACME or real Spaces validation claimed. |

Test containers were stopped; only the original development database remains running. Disposable fixture volumes are retained. No existing database reset, real uploaded-asset deletion or volume prune was performed. No app/domain/database schema/game/UI changes were made. The only existing operations behaviour change is support for a validated inherited maintenance lock so an approved release can exclude scheduled backup/migration/restore operations throughout the sequence.

## Permission and release review

- PR jobs use contents-read only, no environment/deployment secrets or registry write, and never `pull_request_target`. No `secrets: inherit` or privileged `workflow_run` handoff.
- Main publication reuses the full required checks, requires GitHub's protected-main signal, pushes the exact loaded/tested image without rebuild, compares published image ID and binds commit/digest to provenance/SBOM. A push followed by failed attestation/upload is not an approved release.
- Promotion is manual/main-only, protected Environment scoped, concurrency-serialised and disabled without DEPLOY_ENABLED. It requires successful original-repository main publication, exact unexpired release artifact/digest and attestations; arbitrary input registry images are not accepted.
- Runtime verifies reviewer/self-review and main-only environment policies. GitHub's REST environment response does **not** expose administrator bypass: disabling it is an explicit owner Settings prerequisite before enablement, not a fabricated API guarantee. Missing API permissions, policies, reports, attestation support or credentials fail closed.
- Strict pinned SSH host keys, per-environment forced commands and target IDs; no insecure SSH, remote code uploads, raw Compose output or production secrets in layers/artifacts. Remote host independently verifies release/attestation and uses only its local Docker daemon.
- The existing healthy installation, machine identity, root-owned reviewed infrastructure, capacity and recent operator-attested real restore are checked before interruption. Matched encrypted backup keeps writes stopped through explicit migrations/start/read-only verification. Failures after backup leave writes stopped; no automatic DB rollback or reset.

## Remaining owner work and risk register

1. **GitHub settings and first hosted execution:** configure protected main/required checks, action policies, GHCR repository/package permissions, attestation support and environments/reviewers/no bypass/main-only restrictions. Do not enable deployment simply to test a missing prerequisite. Test failure paths and artifact/report visibility. Private repository plans may restrict required reviewers/attestations; resolve rather than bypass.
2. **Actual release image:** obtain a successful full Dockerfile build and complete image/TLS/backup-restore run on the GitHub runner. Record the exact published digest and successful publication run, not this native build or prior Windows/diagnostic artifacts. Production AMD64 only; ARM images are not validated.
3. **Browser flakiness/CDN:** investigate a repeated initial connection failure if it recurs under lockfile Chromium in CI. No retries or relaxed assertions were added. Network/tool/CDN failure must block release.
4. **Real infrastructure/recovery:** no staging server, backup bucket/keys, host read-only GHCR/GitHub credentials, strict SSH keys, synthetic verification identities, off-server restore evidence, capacity or monitoring is configured. Restore-age approval is a root-controlled operator assertion; it cannot itself prove Spaces recovery. No initial-install bypass is available.
5. **Operational failures:** SSH/runner cancellation or host power loss can interrupt reporting; inspect current app/SQL/backup state before recovery. Automated SQL rollback is deliberately absent. GitHub/registry/attestation unavailability and expired 30-day release artifacts block promotion; retain approved release records independently and plan reviewed revalidation.
6. **Existing public-launch concerns:** open DM registration, missing per-account storage quotas, runtime/schema ownership, session/receipt retention, disk/WAL/asset growth, backup staging headroom, restore RPO/RTO, mutable production Caddy/PostgreSQL defaults and OOM/capacity remain PR 2 concerns. This CI change does not claim to resolve them. Refresh reviewed action/tool/image pins and vulnerability policy routinely.

## Recommended PR 4

First observe green protected-main CI and genuine-image recovery/publication/attestation on GitHub. Configure manual owner settings, then obtain separate approval to provision **staging only**. Rehearse off-server restore, restricted SSH, approvals, successful deployment, failed-migration/operator recovery, public DM/player WebSockets, capacity and monitoring. Resolve registration/quota policy before public production. First installation, DNS and production cutover need separate explicit approval; no deployment or automatic merge is part of PR 3.
