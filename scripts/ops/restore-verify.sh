#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 && $1 =~ ^[a-f0-9]{8,64}$ ]] || { echo 'Supply one explicit Restic snapshot ID (not latest).' >&2; exit 2; }
[[ ${LEDGER_PROJECT_NAME:-} == ledger-restore-* ]] || { echo 'Restore is allowed ONLY in a separately named ledger-restore-* project.' >&2; exit 2; }
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
[[ ${LEDGER_LOCAL_TEST:-0} == 1 ]] || { echo 'Restore verification requires LEDGER_LOCAL_TEST=1 and loopback-only high ports.' >&2; exit 2; }
preflight
lock_operations
load_backup
[[ -z $(dc ps -aq) && -z $(docker volume ls -q --filter "label=com.docker.compose.project=$project") ]] || { echo 'Restore target must have NO existing containers or volumes. Nothing has been overwritten.' >&2; exit 1; }
# Also reject existing unlabelled volumes/networks with names Compose would reuse.
for kind in volumes networks; do
  while IFS= read -r name; do
    resource=volume; [[ $kind == networks ]] && resource=network
    if docker "$resource" inspect "$name" >/dev/null 2>&1; then echo 'Restore resource already exists. Use a fresh project.' >&2; exit 1; fi
  done < <(dc --profile operations config --format json | python3 -c 'import json,sys;d=json.load(sys.stdin);print("\n".join(v["name"] for v in d[sys.argv[1]].values()))' "$kind")
done
# Never select snapshots from another project implicitly.
source_project=${LEDGER_RESTORE_SOURCE_PROJECT:-ledger-production}
snapshot_path=$(restic snapshots --json "$1" | python3 -c 'import json,sys,pathlib;d=json.load(sys.stdin);assert len(d)==1 and "project:"+sys.argv[1] in d[0].get("tags",[]),"Wrong source project snapshot";p=d[0]["paths"];assert len(p)==1 and pathlib.PurePosixPath(p[0]).is_absolute() and ".." not in pathlib.PurePosixPath(p[0]).parts;print(p[0])' "$source_project")
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
# Restore only the known artifacts as operator-owned files; never restore host
# parent-directory ownership or arbitrary snapshot paths. Restic verifies AEAD;
# the manifest independently checks every restored byte before any DB write.
for artifact in manifest.json database.dump assets.tar.gz; do
  restic dump "$1" "$snapshot_path/$artifact" >"$stage/$artifact"
done
backup=$stage
image=$(dc config --format json | python3 -c 'import json,sys;print(json.load(sys.stdin)["services"]["app"]["image"])')
python3 "$LEDGER_ROOT/scripts/ops/config.py" verify "$backup" --image "$image"
# Fresh verification database only. No --clean, DROP, truncation or volume deletion.
dc up -d --wait --wait-timeout 120 postgres
dc exec -T postgres sh -c 'exec pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --no-owner --no-acl --exit-on-error --single-transaction' <"$backup/database.dump"
dc --profile operations run --rm --no-deps -T asset-restore <"$backup/assets.tar.gz"
echo 'Restore finished in the isolated project. App and Caddy remain stopped. Follow the verification runbook before trusting this backup.'
