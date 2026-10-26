import {spawnSync} from 'node:child_process'
import process from 'node:process'
const result=spawnSync(process.execPath,['--test','scripts/infrastructure.test.mjs'],{stdio:'inherit',env:{...process.env,LEDGER_INFRA_REQUIRED:'1'}})
process.exitCode=result.status??1
