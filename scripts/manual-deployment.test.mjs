import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
import process from 'node:process'
const python=process.platform!=='win32'&&spawnSync('python3',['--version']).status===0
const pwsh=process.env.LEDGER_TEST_PWSH??(process.platform==='win32'?'powershell.exe':'pwsh')
const hasPS=spawnSync(pwsh,['-NoProfile','-Command','$PSVersionTable.PSVersion.ToString()'],{encoding:'utf8'}).status===0
test('manual Ubuntu deployment selection, verification, failures and locks (offline)',{skip:!python},()=>{
 const syntax=spawnSync('bash',['-n','scripts/ops/deploy-release.sh'],{encoding:'utf8'})
 assert.equal(syntax.status,0,syntax.stderr)
 const result=spawnSync('python3',['scripts/ops/deploy_release_tests.py'],{encoding:'utf8',timeout:120000})
 assert.equal(result.status,0,result.stdout+result.stderr)
})
test('PowerShell deployment entry point parses without execution',{skip:!hasPS},()=>{
 const code='$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile($env:LEDGER_PS_SCRIPT,[ref]$tokens,[ref]$errors) > $null; if($errors.Count){$errors;exit 1}'
 const result=spawnSync(pwsh,['-NoProfile','-Command',code],{encoding:'utf8',env:{...process.env,LEDGER_PS_SCRIPT:resolve('scripts/ops/deploy.ps1')}})
 assert.equal(result.status,0,result.stdout+result.stderr)
})
test('PowerShell plan, confirmation, cancellation and invalid release tests use fake SSH only',{skip:!python||!hasPS},()=>{
 const result=spawnSync('python3',['scripts/ops/deploy_powershell_tests.py'],{encoding:'utf8',timeout:120000,env:{...process.env,LEDGER_TEST_PWSH:pwsh}})
 assert.equal(result.status,0,result.stdout+result.stderr)
})
