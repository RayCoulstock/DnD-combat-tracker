# Manual deployment validation

Validated locally on 27 October 2026. No SSH connection to the Droplet, public application request, real GHCR release selection/pull, Spaces operation or production deployment was performed. The production Actions workflow and GitHub settings are unchanged.

| Check | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm run build` | Pass; existing frontend large-bundle advisory only. |
| `npm test` | 77 pass, no skips with PowerShell available: 34 script/map/app groups and 43 shared/server tests. |
| New Ubuntu controller tests | 15 offline fault tests pass inside the test suite. Docker/GitHub/curl are replaced; canonical release validation runs the **actual existing JS gates** under Node 24. |
| PowerShell | Parser plus 6 actual PowerShell flow tests pass using PowerShell 7.4.13 on Linux and a fake SSH executable. Tests force a reserved `.invalid` SSH target even if the fake executable is unavailable. Covers plan-only, exact confirmation, cancel/no-op, malformed metadata/remote failure, explicit selection/injection and key paths containing spaces. |
| Required `npm run test:infra` | 8 pass, no skips; existing production Compose/preflight remains intact. |
| New shell/Python syntax | ShellCheck/Bash parse and Python compile pass. |
| Real Docker interface checks | Local Compose `config --hash` format and read-only/network-isolated Node 24 execution of the existing JS gates via stdin pass. This is not a production-image/deployment smoke result. |
| Native Windows / real SSH / GitHub / registry / Spaces / rollout | Not exercised; installation and a first operator-approved `-Plan`/deployment still need validation on the intended machines. No production success is claimed. |

Fault coverage includes malformed/cross-workflow/non-main evidence, unavailable/expired/unattested releases without fallback, unavailable pull and unsupported pre-beta image, missing backup credentials, insufficient disk, config drift, stale approval, matched-backup failure without env replacement, preserved CRLF/quotes/comments/secrets, concurrent runtime edits, migration/startup/public-health failure, durable snapshot receipt, interruption after backup, no-op and inherited-lock exclusion with a real child of the existing common.sh. Captured tool errors containing dummy credentials are redacted from errors/reports.

The scripts deliberately retain the existing healthy-installation prerequisite, production preflight and current source/config identity. They provide no initial-install, force, seed, database rollback or failed-health bypass. An abrupt host failure cannot guarantee a final result; inspect reports, locks and migration containers before any recovery. Space checks enforce a 10 GiB floor, not an assertion that any database size fits. Required metadata/attestation APIs and package access must work from the operator account; expired evidence blocks deployment. No images/volumes are pruned.

Application source, database schema, Dockerfile, Compose and game behaviour are unchanged. API integration and browser suites were not rerun for this operations-only change; existing unit/domain checks, infrastructure validation, build and new offline orchestration/PowerShell tests were run. See [manual deployment instructions](manual-deployment.md) for installation, exact confirmation and recovery.
