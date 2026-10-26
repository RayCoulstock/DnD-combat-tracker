#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# == 1 && $1 =~ ^[a-z0-9][a-zA-Z0-9._/:@-]+$ ]] || { echo 'Supply one already-built local test image.' >&2; exit 2; }
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
work=$(mktemp -d)
export LEDGER_ENV_FILE="$work/runtime.env" LEDGER_LOCAL_TEST=1 LEDGER_PROJECT_NAME="ledger-smoke-$(date +%s)-$RANDOM" LEDGER_LOCK_DIR="$work/locks" LEDGER_SMOKE_STATE="$work/fixture.json"
python3 - "$LEDGER_ENV_FILE" "$1" "$root" <<'PY'
import sys,secrets,socket
ports=[]
for _ in range(2):
 s=socket.socket();s.bind(('127.0.0.1',0));ports.append(s.getsockname()[1]);s.close()
pw=secrets.token_hex(32)
open(sys.argv[1],'w').write(f'''LEDGER_IMAGE={sys.argv[2]}
LEDGER_DOMAIN=localhost
ACME_EMAIL=local@example.test
LEDGER_CADDY_FILE={sys.argv[3]}/deploy/Caddyfile.smoke
LEDGER_BIND_IP=127.0.0.1
LEDGER_HTTP_PORT={ports[0]}
LEDGER_HTTPS_PORT={ports[1]}
APP_ORIGIN=https://localhost:{ports[1]}
DATABASE_URL=postgresql://ledger:{pw}@postgres:5432/ledger
POSTGRES_USER=ledger
POSTGRES_PASSWORD={pw}
POSTGRES_DB=ledger
SESSION_SECRET={secrets.token_hex(32)}
''')
PY
source "$root/scripts/ops/common.sh"
cleanup(){ local status=$?; trap - EXIT; dc stop -t 35 >/dev/null || status=1; echo "Local test project retained stopped: $project; private fixture directory: $work"; exit "$status"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
preflight
docker image inspect "$1" >/dev/null
"$root/scripts/ops/migrate.sh" --approve-migrations
dc up -d --wait --wait-timeout 180 app caddy
dc cp caddy:/data/caddy/pki/authorities/local/root.crt "$work/root.crt" >/dev/null
export NODE_EXTRA_CA_CERTS="$work/root.crt"
APP_ORIGIN=$(dc config --format json | python3 -c 'import sys,json;print(json.load(sys.stdin)["services"]["app"]["environment"]["APP_ORIGIN"])')
export APP_ORIGIN
node --dns-result-order=ipv4first "$root/scripts/ops/smoke.mjs" create
# The stack must not expose app/DB ports, and Caddy must not resolve the database.
[[ -z $(docker port "$(dc ps -q app)") && -z $(docker port "$(dc ps -q postgres)") ]]
dc exec -T app node -e 'if(process.getuid()!==1000)process.exit(1)'
dc exec -T caddy sh -c '! nslookup postgres 127.0.0.11 >/dev/null 2>&1'
node --dns-result-order=ipv4first "$root/scripts/ops/smoke.mjs" restart
node --dns-result-order=ipv4first "$root/scripts/ops/smoke.mjs" restart-proxy
dc logs --no-log-prefix caddy | python3 -c 'import sys;assert "ledger-private-log-sentinel" not in sys.stdin.read(),"Private header leaked into proxy logs"'
dc exec -T app node --input-type=module <"$root/scripts/ops/audit-assets.mjs"
# Exit zero is local runtime evidence only, not proof this image was built by Dockerfile.
if [[ -n ${LEDGER_SMOKE_RESULT_FILE:-} ]]; then
  python3 - "$LEDGER_SMOKE_RESULT_FILE" "$project" "$work" "$LEDGER_ENV_FILE" "$LEDGER_SMOKE_STATE" <<'PYRESULT'
import json,sys
with open(sys.argv[1],'w') as f:json.dump(dict(zip(['project','work','env','state'],sys.argv[2:])),f)
PYRESULT
fi
echo "PASS isolated Caddy/app/PostgreSQL stack; project=$project; fixture=$work"
