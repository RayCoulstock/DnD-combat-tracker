import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {validateEvidence,validateRun,validateRelease,validateEnvironment,imageName} from './ci/release-gates.mjs'
const repository='RayCoulstock/DnD-combat-tracker',commit='a'.repeat(40),digest='sha256:'+'b'.repeat(64)
const evidence={schemaVersion:1,commit,imageId:'sha256:'+'c'.repeat(64),productionDockerfile:true,tlsBackupRestorePassed:true}
const run={repository:{full_name:repository},path:'.github/workflows/publish.yml',event:'push',head_branch:'main',head_sha:commit,status:'completed',conclusion:'success',id:123}
const release={...evidence,image:imageName(repository),digest,runId:'123'}
test('release accepts only exact tested production artifact, successful main run and matching digest',()=>{
 validateRelease(release,run,digest,repository)
 for(const edit of[r=>{r.repository.full_name='fork/ledger'},r=>{r.path='.github/workflows/other.yml'},r=>{r.event='pull_request'},r=>{r.head_branch='feature'},r=>{r.conclusion='failure'},r=>{r.status='in_progress'}]){
  const bad=structuredClone(run);edit(bad);assert.throws(()=>validateRun(bad,repository))
 }
 for(const edit of[r=>{r.productionDockerfile=false},r=>{r.tlsBackupRestorePassed=false},r=>{r.commit='d'.repeat(40)},r=>{r.imageId='diagnostic'},r=>{r.digest='sha256:'+'d'.repeat(64)},r=>{r.image='ghcr.io/other/repo'},r=>{r.runId=999}]){
  const bad=structuredClone(release);edit(bad);assert.throws(()=>validateRelease(bad,run,digest,repository))
 }
 assert.throws(()=>validateEvidence({},commit));assert.throws(()=>validateRelease(release,run,'latest',repository))
})
test('deployment requires reviewers, self-review prevention and main-only policy; rejects exposed admin bypass',()=>{
 const environment={can_admins_bypass:false,protection_rules:[{type:'required_reviewers',prevent_self_review:true,reviewers:[{type:'Team',reviewer:{id:1}}]}],deployment_branch_policy:{custom_branch_policies:true,protected_branches:false}}
 const policies={total_count:1,branch_policies:[{name:'main',type:'branch'}]}
 validateEnvironment(environment,policies)
 const restResponse=structuredClone(environment);delete restResponse.can_admins_bypass;validateEnvironment(restResponse,policies)
 for(const edit of[e=>{e.protection_rules=[]},e=>{e.protection_rules[0].reviewers=[]},e=>{e.protection_rules[0].prevent_self_review=false},e=>{e.can_admins_bypass=true},e=>{e.deployment_branch_policy.custom_branch_policies=false}]){
  const bad=structuredClone(environment);edit(bad);assert.throws(()=>validateEnvironment(bad,policies))
 }
 for(const p of[{total_count:2,branch_policies:policies.branch_policies},{total_count:1,branch_policies:[{name:'*',type:'branch'}]},{total_count:1,branch_policies:[{name:'main',type:'tag'}]}])assert.throws(()=>validateEnvironment(environment,p))
})
test('workflow contracts isolate untrusted PRs, require native and genuine image gates, and avoid rebuild on publish',()=>{
 const read=n=>readFileSync('.github/workflows/'+n+'.yml','utf8'),ci=read('ci'),publish=read('publish')
 for(const source of[ci,publish,read('deploy-staging'),read('deploy-production')]){
  assert(!source.includes('pull_request_target'));assert(!source.includes('secrets: inherit'))
  for(const match of source.matchAll(/uses: ([^\s]+)@([^\s]+)/g))assert.match(match[2],/^[a-f0-9]{40}$/)
 }
 assert.match(ci,/pull_request:\s+branches: \[main\]/)
 for(const check of['npm ci','npm run typecheck','npm run lint','npm test','npm run build','npm run test:infra','scripts/ci/native-tests.sh','scripts/ci/verify-image.sh'])assert(ci.includes(check))
 assert.match(ci,/file: Dockerfile/);assert.match(ci,/push: false/);assert(!ci.includes('packages: write'))
 assert.match(publish,/needs: validate/);assert(!publish.includes('build-push-action'));assert.match(publish,/branches: \[main\]/)
 for(const env of['staging','production']){
  const source=read('deploy-'+env)
  assert.match(source,/workflow_dispatch:/);assert(source.includes('environment: '+env));assert.match(source,/cancel-in-progress: false/)
  assert.match(source,/vars.DEPLOY_ENABLED/);assert.match(source,/prepare-deployment.mjs/);assert(!source.includes('packages: write'))
 }
})
test('SSH and host gates reject invalid inputs before contacting a host',()=>{
 if(process.platform==='win32')return
 const r=spawnSync('bash',['scripts/ci/deploy-ssh.sh'],{env:{PATH:process.env.PATH},encoding:'utf8'})
 assert.notEqual(r.status,0)
 const code=readFileSync('scripts/ci/deploy-ssh.sh','utf8')
 assert(code.includes('StrictHostKeyChecking=yes'));assert(!code.includes('StrictHostKeyChecking=no'));assert(!code.includes('ssh-keyscan -'))
})
const python=process.platform!=='win32'&&spawnSync('python3',['--version']).status===0
test('host target, enable flag, restore age and environment identity are enforced',{skip:!python},()=>{
 const r=spawnSync('python3',['-c',String.raw`
import runpy,datetime,copy
m=runpy.run_path('scripts/ci/deploy-host.py');validate=m['validate_target']
now=datetime.datetime(2026,10,26,tzinfo=datetime.timezone.utc)
c=dict(enabled=True,environment='production',target_id='approved-target-123',machine_id='machine',project='ledger-production',image='ghcr.io/raycoulstock/dnd-combat-tracker',infrastructure_commit='a'*40,restore_verified_at='2026-10-25T00:00:00Z',origin='https://ledger.example.test')
validate(c,'production','approved-target-123','machine',now)
for key,value in [('enabled',False),('environment','staging'),('target_id','other'),('machine_id','other'),('project','ledger-staging'),('image','ghcr.io/fork/image'),('infrastructure_commit','main'),('restore_verified_at','2026-01-01T00:00:00Z'),('restore_verified_at','2027-01-01T00:00:00Z')]:
 bad=copy.deepcopy(c);bad[key]=value
 try:validate(bad,'production','approved-target-123','machine',now);raise AssertionError('unsafe host accepted')
 except ValueError:pass
`],{encoding:'utf8'});assert.equal(r.status,0,r.stderr)
})
test('inherited maintenance lock is verified and excludes concurrent operations',{skip:!python},()=>{
 const work=mkdtempSync(join(tmpdir(),'ledger-ci-lock-'))
 try{
  const password='x'.repeat(64),file=join(work,'runtime.env')
  writeFileSync(file,`LEDGER_IMAGE=ghcr.io/example/ledger@sha256:${'a'.repeat(64)}\nLEDGER_DOMAIN=ledger.example.test\nACME_EMAIL=admin@example.test\nAPP_ORIGIN=https://ledger.example.test\nDATABASE_URL=postgresql://ledger:${password}@postgres:5432/ledger\nPOSTGRES_USER=ledger\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=ledger\nSESSION_SECRET=${password}\n`,{mode:0o600})
  const r=spawnSync('python3',['-c',String.raw`
import os,sys,subprocess,fcntl,pathlib
root=pathlib.Path(sys.argv[1]);directory=root/'locks';directory.mkdir(mode=0o700)
lock=open(directory/'ledger-production.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
env=dict(os.environ,LEDGER_ENV_FILE=str(root/'runtime.env'),LEDGER_LOCK_DIR=str(directory),LEDGER_PROJECT_NAME='ledger-production',LEDGER_OPERATION_LOCK_FD=str(lock.fileno()))
command=['bash','-c','source scripts/ops/common.sh; lock_operations']
assert subprocess.run(command,env=env,pass_fds=(lock.fileno(),),capture_output=True).returncode==0
env.pop('LEDGER_OPERATION_LOCK_FD')
assert subprocess.run(command,env=env,capture_output=True).returncode!=0
wrong=open(root/'wrong','w');env['LEDGER_OPERATION_LOCK_FD']=str(wrong.fileno())
assert subprocess.run(command,env=env,pass_fds=(wrong.fileno(),),capture_output=True).returncode!=0
`,work],{encoding:'utf8'});assert.equal(r.status,0,r.stderr)
 }finally{rmSync(work,{recursive:true,force:true})}
})
test('forced SSH command cannot cross environments/targets or evaluate shell input',{skip:!python},()=>{
 const r=spawnSync('python3',['-c',String.raw`
import runpy
parse=runpy.run_path('scripts/ci/ssh-release-command.py')['parse_command']
command='/usr/local/sbin/ledger-release production approved-target-123 sha256:'+'a'*64+' '+'b'*40+' 123'
assert parse(command,'production','approved-target-123')[1]=='production'
for bad,environment,target in [(command+'; id','production','approved-target-123'),(command+'\nwhoami','production','approved-target-123'),(command,'staging','approved-target-123'),(command,'production','other-target-12345'),('bash -c id','production','approved-target-123'),('', 'production','approved-target-123')]:
 try:parse(bad,environment,target);raise AssertionError('unsafe SSH command accepted')
 except ValueError:pass
`],{encoding:'utf8'});assert.equal(r.status,0,r.stderr)
})
test('image validation rejects diagnostic substitutes before any runtime smoke',{skip:process.platform==='win32'},()=>{
 const work=mkdtempSync(join(tmpdir(),'ledger-diagnostic-gate-'))
 try{
  const mock=join(work,'docker')
  writeFileSync(mock,`#!/usr/bin/env bash\ncase "$*" in\n  *Config.User*) echo node ;;\n  *validation-only*) echo true ;;\n  *) echo 'Runtime operation must not run for a diagnostic image.' >&2; exit 97 ;;\nesac\n`,{mode:0o700})
  const result=spawnSync('bash',['scripts/ci/verify-image.sh','encounter-ledger-ci:'+commit],{encoding:'utf8',env:{...process.env,PATH:work+':'+process.env.PATH}})
  assert.equal(result.status,1);assert(!result.stdout.includes('PASS'));assert(!result.stderr.includes('Runtime operation must not run'))
 }finally{rmSync(work,{recursive:true,force:true})}
})
test('native test runner refuses occupied local ports instead of testing an existing application',async()=>{
 const {createServer}=await import('node:net')
 const {assertLocalPorts}=await import('./ci/assert-local-ports.mjs')
 const server=createServer()
 await new Promise(resolve=>server.listen({port:0,host:'::',ipv6Only:false},resolve))
 try{await assert.rejects(assertLocalPorts([server.address().port]),/Refusing tests/)}finally{await new Promise(resolve=>server.close(resolve))}
})
