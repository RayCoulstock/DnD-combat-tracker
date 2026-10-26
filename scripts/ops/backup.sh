#!/usr/bin/env bash
set -euo pipefail
keep_stopped=0
if [[ ${1:-} == --keep-stopped && $# == 1 ]]; then keep_stopped=1; elif [[ $# != 0 ]]; then echo 'Usage: backup.sh [--keep-stopped]' >&2; exit 2; fi
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
preflight
lock_operations
load_backup
[[ -n $(dc ps -aq app) && -n $(dc ps --status running -q postgres) ]] || { echo 'Existing app container and running PostgreSQL are required; refusing an accidental empty backup.' >&2; exit 1; }
staging_root=${LEDGER_BACKUP_STAGING_DIR:-/var/backups/encounter-ledger}
mkdir -p -m 700 "$staging_root"
# Verify staging is private before creating plaintext artifacts.
python3 - "$staging_root" <<'PY'
import os,stat,sys
from pathlib import Path
p=Path(sys.argv[1]);assert p.is_absolute() and not p.resolve().is_relative_to(Path(os.environ["LEDGER_ROOT"]).resolve()), "Keep backup staging outside the checkout."
s=os.stat(sys.argv[1]);assert not os.path.islink(sys.argv[1]) and s.st_uid==os.getuid() and not stat.S_IMODE(s.st_mode)&0o077, 'Use a private backup staging directory.'
PY
stage=$(mktemp -d "$staging_root/backup.XXXXXXXX")
was_running=0
[[ -z $(dc ps --status running -q app) ]] || was_running=1
cleanup() {
  local status=$?
  trap - EXIT
  if [[ $was_running == 1 && $keep_stopped == 0 ]]; then dc start app >/dev/null || status=1; fi
  # Only artifacts created by this invocation; never source DB/files/volumes.
  rm -rf -- "$stage"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
[[ $was_running == 0 ]] || dc stop -t 35 app >/dev/null
image=$(docker inspect "$(dc ps -aq app)" --format '{{.Config.Image}}')
dc exec -T postgres sh -c 'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner' >"$stage/database.dump"
dc --profile operations run --rm --no-deps -T asset-archive >"$stage/assets.tar.gz"
python3 "$LEDGER_ROOT/scripts/ops/config.py" manifest "$stage" --image "$image"
python3 "$LEDGER_ROOT/scripts/ops/config.py" verify "$stage"
# Resume service before encrypting/uploading the captured, now immutable matched set.
if [[ $was_running == 1 && $keep_stopped == 0 ]]; then dc start app >/dev/null; was_running=0; fi
restic backup --json --host "$project" --tag encounter-ledger --tag "project:$project" "$stage" | python3 -c '
import json,sys
snapshot=None
for line in sys.stdin:
 d=json.loads(line)
 if d.get("message_type")=="summary": snapshot=d.get("snapshot_id")
if not snapshot: sys.exit("No successful encrypted backup snapshot was acknowledged.")
print("Encrypted backup snapshot: "+snapshot)
'
