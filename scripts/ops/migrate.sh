#!/usr/bin/env bash
set -euo pipefail
[[ ${1:-} == --approve-migrations && $# == 1 ]] || { echo 'Migrations are not approved. No changes made. Use --approve-migrations only in an approved release window.' >&2; exit 2; }
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
preflight
lock_operations
if [[ ${LEDGER_LOCAL_TEST:-0} != 1 ]]; then
  image=$(dc config --format json | python3 -c 'import json,sys;print(json.load(sys.stdin)["services"]["app"]["image"])')
  diagnostic=$(docker image inspect "$image" --format '{{ index .Config.Labels "org.encounter-ledger.validation-only" }}')
  [[ $diagnostic != true ]] || { echo 'Diagnostic-only images cannot pass the production release gate.' >&2; exit 1; }
fi
[[ -z $(dc ps --status running -q app) ]] || { echo 'Stop app writes and take a matched backup before migrations.' >&2; exit 1; }
# Do not pull/build an unverified image, auto-start the app or invoke the seed.
dc up -d --wait --wait-timeout 120 postgres
dc --profile operations run --rm --no-deps -T migrate
echo 'Migrations complete. App and Caddy have NOT been started; deployment approval is separate.'
