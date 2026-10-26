#!/usr/bin/env bash
# Own disposable DB only; never consume a developer/staging/production DATABASE_URL.
set -euo pipefail
umask 077
node scripts/ci/assert-local-ports.mjs
work=$(mktemp -d)
project="ledger-ci-${GITHUB_RUN_ID:-local}-$$"
backend=;frontend=
# shellcheck disable=SC2317 # Invoked indirectly by the EXIT trap.
cleanup(){
  local status=$?
  trap - EXIT
  [[ -z $backend ]] || kill -TERM "$backend" 2>/dev/null || true
  [[ -z $frontend ]] || kill -TERM "$frontend" 2>/dev/null || true
  docker stop "$project" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
password=$(openssl rand -hex 32)
# No DB password on the command line or in the checkout/artifacts.
printf 'POSTGRES_PASSWORD=%s\nPOSTGRES_USER=ledger\nPOSTGRES_DB=ledger\n' "$password" > "$work/postgres.env"
docker run -d --name "$project" --env-file "$work/postgres.env" -p 127.0.0.1::5432 --health-cmd='pg_isready -U ledger -d ledger' --health-interval=2s --health-retries=30 postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 >/dev/null
for _ in {1..60}; do [[ $(docker inspect --format '{{.State.Health.Status}}' "$project") != healthy ]] || break; sleep 1; done
[[ $(docker inspect --format '{{.State.Health.Status}}' "$project") == healthy ]]
port=$(docker port "$project" 5432/tcp);port=${port##*:}
export DATABASE_URL="postgresql://ledger:$password@127.0.0.1:$port/ledger" SESSION_SECRET
SESSION_SECRET=$(openssl rand -hex 32)
export APP_ORIGIN=http://localhost:5173 NODE_ENV=test PORT=3001 ASSET_STORAGE_DIR="$work/assets"
mkdir -p "$ASSET_STORAGE_DIR" ci-results
npm run test:integration
npm run db:migrate:production
node dist-server/server/index.js > "$work/backend.log" 2>&1 & backend=$!
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort > "$work/frontend.log" 2>&1 & frontend=$!
node scripts/ci/wait-ready.mjs
kill -0 "$backend" "$frontend"
# No screenshots, traces or real GLBs are uploaded; JSON reporter is reduced to counts only.
status=0
PLAYWRIGHT_JSON_OUTPUT_FILE="$work/playwright.json" npm run test:e2e -- --reporter=line,json || status=$?
node --input-type=module - "$work/playwright.json" <<'JS'
import {readFileSync,writeFileSync} from 'node:fs'
const report=JSON.parse(readFileSync(process.argv[2],'utf8'))
writeFileSync('ci-results/browser-summary.json',JSON.stringify(report.stats,null,2)+'\n')
JS

exit "$status"
