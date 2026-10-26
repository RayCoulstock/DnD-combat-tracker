// Read-only release/environment checks. No SSH until every gate succeeds.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,readFileSync,appendFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import process from 'node:process'
import {validateEnvironment,validateRun,validateRelease,digestPattern} from './release-gates.mjs'
const repo=process.env.GITHUB_REPOSITORY,environment=process.env.DEPLOY_ENVIRONMENT,runId=process.env.RELEASE_RUN_ID,digest=process.env.RELEASE_DIGEST
assert.equal(process.env.GITHUB_EVENT_NAME,'workflow_dispatch')
assert.equal(process.env.GITHUB_REF,'refs/heads/main')
assert(['staging','production'].includes(environment));assert.equal(process.env.DEPLOY_ENABLED,'true','Deployment is disabled pending owner setup')
assert.match(runId,/^[1-9][0-9]{0,19}$/);assert.match(digest,digestPattern)
const api=async(path)=>{
  const response=await fetch('https://api.github.com/repos/'+repo+path,{headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)})
  assert(response.ok,'GitHub release/environment verification unavailable; refusing deployment')
  return response.json()
}
validateEnvironment(await api('/environments/'+environment),await api('/environments/'+environment+'/deployment-branch-policies'))
const run=await api('/actions/runs/'+runId);validateRun(run,repo)
const work=mkdtempSync(join(tmpdir(),'ledger-release-evidence-'))
execFileSync('gh',['run','download',runId,'--repo',repo,'--name','release-'+run.head_sha,'--dir',work],{stdio:['ignore','ignore','inherit']})
const release=JSON.parse(readFileSync(join(work,'release.json'),'utf8'))
validateRelease(release,run,digest,repo)
execFileSync('gh',['attestation','verify','oci://'+release.image+'@'+digest,'--repo',repo,'--signer-workflow',repo+'/.github/workflows/publish.yml','--source-ref','refs/heads/main','--source-digest',run.head_sha,'--deny-self-hosted-runners'],{stdio:['ignore','ignore','inherit']})
appendFileSync(process.env.GITHUB_OUTPUT,`commit=${run.head_sha}\nimage=${release.image}@${digest}\n`)
console.log('PASS protected environment, trusted successful publication and exact attested digest')
