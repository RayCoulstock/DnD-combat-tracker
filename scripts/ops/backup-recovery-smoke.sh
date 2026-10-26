#!/usr/bin/env bash
# Fresh local fixtures ONLY. This never contacts off-server storage or deletes volumes.
set -euo pipefail
umask 077
[[ $# == 1 ]] || { echo 'Supply an already-built test image.' >&2; exit 2; }
command -v restic >/dev/null || { echo 'Install Restic on the validation workstation.' >&2; exit 1; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
work=$(mktemp -d)
export LEDGER_SMOKE_RESULT_FILE="$work/source.json"
"$root/scripts/ops/local-smoke.sh" "$1"
mapfile -t source_info < <(python3 - "$LEDGER_SMOKE_RESULT_FILE" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]));print(s['project']);print(s['env']);print(s['state'])
PY
)
source_project=${source_info[0]};source_env=${source_info[1]}
export LEDGER_PROJECT_NAME="$source_project" LEDGER_ENV_FILE="$source_env" LEDGER_LOCAL_TEST=1 LEDGER_LOCK_DIR="$work/locks" LEDGER_BACKUP_STAGING_DIR="$work/staging" LEDGER_BACKUP_ENV_FILE="$work/backup.env" LEDGER_SMOKE_STATE="${source_info[2]}"
unset RESTIC_PASSWORD RESTIC_PASSWORD_COMMAND RESTIC_REPOSITORY_FILE
export RESTIC_REPOSITORY="$work/repository" RESTIC_PASSWORD_FILE="$work/restic-password" RESTIC_CACHE_DIR="$work/cache"
python3 - "$work" <<'PY'
import pathlib,sys,secrets
p=pathlib.Path(sys.argv[1]);(p/'restic-password').write_text(secrets.token_hex(32))
(p/'backup.env').write_text(f'RESTIC_REPOSITORY={p}/repository\nRESTIC_PASSWORD_FILE={p}/restic-password\nRESTIC_CACHE_DIR={p}/cache\n')
PY
dc(){ "$root/scripts/ops/compose.sh" "$@"; }
cleanup(){ local status=$?;trap - EXIT;dc stop -t 35 >/dev/null || status=1;LEDGER_ENV_FILE="$source_env" LEDGER_PROJECT_NAME="$source_project" "$root/scripts/ops/compose.sh" stop -t 35 >/dev/null || status=1;echo "Recovery fixtures retained privately: $work";exit "$status"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
restic init
# Source app/Caddy remain stopped after local-smoke; start ONLY its private test DB.
dc up -d --wait --wait-timeout 120 postgres
"$root/scripts/ops/backup.sh"
restic check --read-data
"$root/scripts/ops/retention-plan.sh"
# Encryption proof: a wrong password must not open the repository.
if env -u RESTIC_PASSWORD_FILE RESTIC_PASSWORD=deliberately-wrong restic snapshots >"$work/wrong-password.log" 2>&1; then echo 'Encryption check failed.' >&2;exit 1;fi
grep -qi 'wrong password' "$work/wrong-password.log" || { echo 'Wrong-password test failed for an unexpected reason.' >&2; exit 1; }
snapshot=$(restic snapshots --json | python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d)==1;print(d[0]["id"])')
export LEDGER_RESTORE_SOURCE_PROJECT="$source_project" LEDGER_PROJECT_NAME="ledger-restore-$(date +%s)-$RANDOM" LEDGER_ENV_FILE="$work/restore.env"
python3 - "$source_env" "$LEDGER_ENV_FILE" <<'PY'
import sys,socket,secrets
values=dict(line.split('=',1) for line in open(sys.argv[1]).read().splitlines() if line and not line.startswith('#'))
ports=[]
for _ in range(2):
 s=socket.socket();s.bind(('127.0.0.1',0));ports.append(s.getsockname()[1]);s.close()
pw=secrets.token_hex(32)
values.update(LEDGER_HTTP_PORT=str(ports[0]),LEDGER_HTTPS_PORT=str(ports[1]),APP_ORIGIN=f'https://localhost:{ports[1]}',POSTGRES_PASSWORD=pw,DATABASE_URL=f'postgresql://ledger:{pw}@postgres:5432/ledger',SESSION_SECRET=secrets.token_hex(32))
open(sys.argv[2],'w').write(''.join(k+'='+v+'\n' for k,v in values.items()))
PY
"$root/scripts/ops/restore-verify.sh" "$snapshot"
# A repeated restore must reject the populated target without changing it.
if "$root/scripts/ops/restore-verify.sh" "$snapshot" >"$work/repeated-restore.log" 2>&1; then echo 'Existing-target guard failed.' >&2;exit 1;fi
grep -q 'Restore target must have NO existing' "$work/repeated-restore.log" || { echo 'Existing-target test failed for an unexpected reason.' >&2; exit 1; }
dc up -d --wait --wait-timeout 180 app caddy
dc cp caddy:/data/caddy/pki/authorities/local/root.crt "$work/restore-root.crt" >/dev/null
export NODE_EXTRA_CA_CERTS="$work/restore-root.crt"
APP_ORIGIN=$(dc config --format json | python3 -c 'import json,sys;print(json.load(sys.stdin)["services"]["app"]["environment"]["APP_ORIGIN"])');export APP_ORIGIN
node --dns-result-order=ipv4first "$root/scripts/ops/smoke.mjs" verify
dc exec -T app node --input-type=module <"$root/scripts/ops/audit-assets.mjs"
echo 'PASS encrypted matched backup, repository read/check, wrong-password rejection, fresh-environment restore and existing-target refusal'
