#!/usr/bin/env bash
set -euo pipefail
umask 077
LEDGER_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
export LEDGER_ROOT
project=${LEDGER_PROJECT_NAME:-ledger-production}
[[ $project =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Invalid project name.' >&2; exit 2; }
if [[ ${LEDGER_LOCAL_TEST:-0} == 1 && $project != ledger-smoke-* && $project != ledger-restore-* ]]; then
  echo 'Local test mode requires a separate smoke/restore project.' >&2; exit 2
fi
: "${LEDGER_ENV_FILE:?Set LEDGER_ENV_FILE to the absolute private runtime env file}"
python3 "$LEDGER_ROOT/scripts/ops/config.py" private-file "$LEDGER_ENV_FILE"
dc() { docker compose --env-file "$LEDGER_ENV_FILE" -f "$LEDGER_ROOT/compose.production.yaml" -p "$project" "$@"; }
preflight() {
  local flags=()
  [[ ${LEDGER_LOCAL_TEST:-0} == 1 ]] && flags+=(--local-test)
  dc --profile operations config --format json | python3 "$LEDGER_ROOT/scripts/ops/config.py" compose --project "$project" "${flags[@]}"
}
lock_operations() {
  local directory=${LEDGER_LOCK_DIR:-/var/lib/encounter-ledger/operations}
  mkdir -p -m 700 "$directory"
  python3 - "$directory" <<'PY'
import os,stat,sys
p=sys.argv[1];s=os.stat(p)
if os.path.islink(p) or s.st_uid!=os.getuid() or stat.S_IMODE(s.st_mode)&0o077: sys.exit('Operations lock directory must be private and operator-owned.')
PY
  # A release coordinator may retain the same lock across backup/migrate/start.
  # Validate the inherited descriptor AND acquire/confirm its lock; never trust a flag alone.
  if [[ -n ${LEDGER_OPERATION_LOCK_FD:-} ]]; then
    python3 - "$LEDGER_OPERATION_LOCK_FD" "$directory/$project.lock" <<'PYLOCK'
import os,sys
fd=int(sys.argv[1]);assert 3 <= fd <= 1024
held=os.fstat(fd);expected=os.stat(sys.argv[2])
assert (held.st_dev,held.st_ino)==(expected.st_dev,expected.st_ino), 'Incorrect inherited maintenance lock.'
PYLOCK
    flock -n "$LEDGER_OPERATION_LOCK_FD" || { echo 'Maintenance lock unavailable.' >&2; exit 1; }
    return
  fi
  exec 9>"$directory/$project.lock"
  flock -n 9 || { echo 'Another backup/migration/restore operation is running.' >&2; exit 1; }
}
load_backup() {
  : "${LEDGER_BACKUP_ENV_FILE:?Set the absolute private backup config file}"
  command -v restic >/dev/null || { echo 'Install Restic before using backup operations.' >&2; exit 1; }
  local parsed key value
  parsed=$(mktemp)
  if ! python3 "$LEDGER_ROOT/scripts/ops/config.py" backup-env "$LEDGER_BACKUP_ENV_FILE" >"$parsed"; then rm -f "$parsed"; return 1; fi
  unset RESTIC_PASSWORD RESTIC_PASSWORD_COMMAND RESTIC_REPOSITORY_FILE RESTIC_REPOSITORY RESTIC_PASSWORD_FILE RESTIC_CACHE_DIR AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION
  while IFS= read -r -d '' key && IFS= read -r -d '' value; do export "$key=$value"; done <"$parsed"
  rm -f "$parsed"
  # Initialisation is an explicit, separate operator action. No writes here.
  if [[ ${1:-} != --initialising ]]; then restic cat config >/dev/null; fi
}
