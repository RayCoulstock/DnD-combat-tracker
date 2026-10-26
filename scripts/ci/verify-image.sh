#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 && $1 =~ ^encounter-ledger-ci:[a-f0-9]{40}$ ]] || { echo 'Expected the locally built commit-tagged image.' >&2; exit 2; }
[[ $(docker image inspect "$1" --format '{{.Config.User}}') == node ]]
[[ $(docker image inspect "$1" --format '{{ index .Config.Labels "org.encounter-ledger.validation-only" }}') != true ]]
docker run --rm --network none --entrypoint node "$1" --input-type=module -e '
import {access,readdir} from "node:fs/promises";
if(process.getuid()!==1000)throw Error("Non-root image required");
for(const p of["dist/index.html","dist-server/server/index.js","dist-server/server/migrate.js","dist-server/server/asset-validation-worker.js"])await access(p);
if(!(await readdir("dist-server/server/migrations")).some(p=>p.endsWith(".sql")))throw Error("Missing migrations");
for(const name of["vite","eslint","typescript","tsx"]){try{await access("node_modules/"+name);throw Error("Unexpected development tool")}catch(e){if(e.code!=="ENOENT")throw e}}
'
scripts/ops/backup-recovery-smoke.sh "$1"
mkdir -p ci-results
IMAGE="$1" node --input-type=module <<'JS'
import {execFileSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'
const imageId=execFileSync('docker',['image','inspect',process.env.IMAGE,'--format','{{.Id}}'],{encoding:'utf8'}).trim()
writeFileSync('ci-results/image-validation.json',JSON.stringify({schemaVersion:1,commit:process.env.GITHUB_SHA,imageId,productionDockerfile:true,tlsBackupRestorePassed:true},null,2)+'\n')
JS
