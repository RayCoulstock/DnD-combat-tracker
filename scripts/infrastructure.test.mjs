import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath,URL} from 'node:url'
import process from 'node:process'
const root=fileURLToPath(new URL('../',import.meta.url)),config=join(root,'scripts/ops/config.py')
const available=process.platform!=='win32'&&spawnSync('python3',['--version']).status===0&&spawnSync('bash',['--version']).status===0&&spawnSync('docker',['compose','version']).status===0
if(process.env.LEDGER_INFRA_REQUIRED==='1'&&!available)throw Error('Infrastructure validation requires Python 3, Bash and Docker Compose (Ubuntu/WSL).')
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'ledger-infra-')),file=join(dir,'production.env'),password='d'.repeat(40)
 writeFileSync(file,`LEDGER_IMAGE=ghcr.io/example/ledger@sha256:${'a'.repeat(64)}\nLEDGER_DOMAIN=ledger.unit.example.net\nACME_EMAIL=admin@example.net\nAPP_ORIGIN=https://ledger.unit.example.net\nDATABASE_URL=postgresql://ledger:${password}@postgres:5432/ledger\nPOSTGRES_USER=ledger\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=ledger\nSESSION_SECRET=${'s'.repeat(64)}\n`,{mode:0o600})
 const result=spawnSync('docker',['compose','--env-file',file,'-f',join(root,'compose.production.yaml'),'-p','ledger-infra-test','--profile','operations','config','--format','json'],{encoding:'utf8'})
 assert.equal(result.status,0,result.stderr)
 return{dir,file,data:JSON.parse(result.stdout)}
}
function check(data){return spawnSync('python3',[config,'compose','--project','ledger-infra-test'],{input:JSON.stringify(data),encoding:'utf8'})}
test('production config isolates networks/volumes, ports and explicit migration job',{skip:!available},()=>{
 const f=fixture();try{assert.equal(check(f.data).status,0);assert.deepEqual(f.data.services.app.cap_drop,['ALL']);assert.equal(f.data.services['asset-archive'].volumes[0].read_only,true)}finally{rmSync(f.dir,{recursive:true,force:true})}
})
test('unsafe infrastructure settings fail closed without leaking credentials',{skip:!available},()=>{
 const f=fixture();try{
  const changes=[d=>{d.services.caddy.environment.HTTP_PROXY='http://untrusted.example'},d=>{d.services.app.ports=[{target:3001,published:'3001'}]},d=>{d.networks.database.internal=false},d=>{d.services.app.environment.APP_ORIGIN='https://wrong.example.net'},d=>{d.services.app.environment.TRUST_PROXY='true'},d=>{d.services.app.image='ledger:latest'},d=>{d.services.migrate.profiles=[]},d=>{d.services.app.depends_on.migrate={condition:'service_completed_successfully'}},d=>{d.volumes.assets.name='ledger-production_assets'},d=>{d.networks.database.name='ledger-production_database'},d=>{d.services.postgres.image='postgres:18-alpine'},d=>{d.services.caddy.environment.MAX_REQUEST_BODY_BYTES='1024'},d=>{d.services['asset-archive'].volumes[0].read_only=false}]
  for(const change of changes){const d=structuredClone(f.data);change(d);const r=check(d);assert.notEqual(r.status,0);assert(!r.stderr.includes('d'.repeat(40)))}
 }finally{rmSync(f.dir,{recursive:true,force:true})}
})
test('missing production secrets cannot fall back to development defaults',{skip:!available},()=>{
 const dir=mkdtempSync(join(tmpdir(),'ledger-infra-empty-'));try{const file=join(dir,'empty.env');writeFileSync(file,'',{mode:0o600});const env={...process.env};for(const key of['DATABASE_URL','SESSION_SECRET','POSTGRES_PASSWORD','LEDGER_IMAGE'])delete env[key];const r=spawnSync('docker',['compose','--env-file',file,'-f',join(root,'compose.production.yaml'),'config','--quiet'],{env,encoding:'utf8'});assert.notEqual(r.status,0)}finally{rmSync(dir,{recursive:true,force:true})}
})
test('migration approval and production restore guards run before any Docker operation',{skip:!available},()=>{
 const f=fixture();try{
  const init=spawnSync('bash',[join(root,'scripts/ops/init-backup.sh')],{encoding:'utf8'});assert.equal(init.status,2)
  let r=spawnSync('bash',[join(root,'scripts/ops/migrate.sh')],{env:{...process.env,LEDGER_ENV_FILE:f.file},encoding:'utf8'});assert.equal(r.status,2);assert.match(r.stderr,/not approved/)
  r=spawnSync('bash',[join(root,'scripts/ops/restore-verify.sh'),'a'.repeat(64)],{env:{...process.env,LEDGER_PROJECT_NAME:'ledger-production'},encoding:'utf8'});assert.equal(r.status,2);assert.match(r.stderr,/ONLY/)
 }finally{rmSync(f.dir,{recursive:true,force:true})}
})
test('backup integrity rejects corruption and archive traversal/links before extraction',{skip:!available},()=>{
 const r=spawnSync('python3',['-c',String.raw`
import runpy,tempfile,tarfile,io,pathlib
m=runpy.run_path(${JSON.stringify(config)})
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d);(p/'database.dump').write_bytes(b'fixture dump')
 def archive(name,kind):
  with tarfile.open(p/'assets.tar.gz','w:gz') as t:
   i=tarfile.TarInfo(name)
   if kind=='link':i.type=tarfile.SYMTYPE;i.linkname='/etc/passwd';t.addfile(i)
   else:i.size=3;t.addfile(i,io.BytesIO(b'glb'))
  m['manifest'](d,'fixture:image')
 archive('./owner/model.glb','file');m['verify'](d)
 (p/'database.dump').write_bytes(b'corrupt')
 try:m['verify'](d);raise AssertionError('accepted corruption')
 except ValueError:pass
 (p/'database.dump').write_bytes(b'fixture dump')
 for name,kind in [('../outside','file'),('/absolute','file'),('./symlink','link')]:
  archive(name,kind)
  try:m['verify'](d);raise AssertionError('accepted unsafe archive')
  except ValueError:pass
`],{encoding:'utf8'});assert.equal(r.status,0,r.stderr)
})
test('backup configuration is literal data, never evaluated as shell code',{skip:!available},()=>{
 const dir=mkdtempSync(join(tmpdir(),'ledger-backup-env-'));try{
  const password=join(dir,'password'),file=join(dir,'backup.env'),sentinel=join(dir,'executed')
  writeFileSync(password,'p'.repeat(64),{mode:0o600});writeFileSync(file,`RESTIC_REPOSITORY=${dir}/repository\nRESTIC_PASSWORD_FILE=${password}\nAWS_SECRET_ACCESS_KEY=$(touch ${sentinel})\n`,{mode:0o600})
  const r=spawnSync('python3',[config,'backup-env',file],{env:{...process.env,LEDGER_LOCAL_TEST:'1'},encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert(r.stdout.includes('$(touch '));assert.equal(existsSync(sentinel),false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('Caddy production configuration validates without DNS/ACME or exposed ports',{skip:!available},t=>{
 const image=spawnSync('docker',['image','inspect','caddy:2-alpine'],{encoding:'utf8'})
 if(image.status!==0){if(process.env.LEDGER_INFRA_REQUIRED==='1')assert.fail('Ensure Docker daemon and the reviewed Caddy 2 image are available');t.skip('Caddy image/daemon unavailable');return}
 const r=spawnSync('docker',['run','--rm','--network','none','-e','LEDGER_DOMAIN=ledger.example.test','-e','ACME_EMAIL=operator@example.test','-e','MAX_REQUEST_BODY_BYTES=33554432','-v',resolve(root,'deploy/Caddyfile')+':/etc/caddy/Caddyfile:ro','-v',resolve(root,'deploy/caddy')+':/etc/caddy/ledger:ro','caddy:2-alpine','caddy','validate','--config','/etc/caddy/Caddyfile'],{encoding:'utf8',timeout:30000})
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout+r.stderr,/Valid configuration/)
})
test('Ubuntu operations scripts parse and development Compose remains independent',{skip:!available},()=>{
 for(const script of['common','compose','preflight','migrate','backup','restore-verify','retention-plan','init-backup','local-smoke','backup-recovery-smoke'])assert.equal(spawnSync('bash',['-n',join(root,`scripts/ops/${script}.sh`)]).status,0)
 assert(!readFileSync(join(root,'compose.yaml'),'utf8').includes('caddy'))
 const r=spawnSync('docker',['compose','-f',join(root,'compose.yaml'),'config','--format','json'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);const d=JSON.parse(r.stdout);assert.equal(d.services.postgres.ports[0].host_ip,'127.0.0.1')
})
