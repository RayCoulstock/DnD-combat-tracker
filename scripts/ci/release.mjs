// Trusted main workflow only. Transfers the already tested image; never builds one.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,appendFileSync} from 'node:fs'
import process from 'node:process'
import {imageName,validateEvidence} from './release-gates.mjs'
assert.equal(process.env.GITHUB_EVENT_NAME,'push');assert.equal(process.env.GITHUB_REF,'refs/heads/main')
const commit=process.env.GITHUB_SHA,image=imageName(process.env.GITHUB_REPOSITORY),local='encounter-ledger-ci:'+commit
const evidence=JSON.parse(readFileSync('release-artifact/image-validation.json','utf8'))
validateEvidence(evidence,commit)
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','inherit']}).trim()
assert.equal(docker('image','inspect',local,'--format','{{.Id}}'),evidence.imageId)
assert.notEqual(docker('image','inspect',local,'--format','{{ index .Config.Labels "org.encounter-ledger.validation-only" }}'),'true')
assert.equal(docker('image','inspect',local,'--format','{{ index .Config.Labels "org.opencontainers.image.revision" }}'),commit)
if(process.argv[2]==='publish'){
  const tagged=image+':sha-'+commit
  docker('tag',local,tagged);docker('push',tagged)
  const refs=JSON.parse(docker('image','inspect',tagged,'--format','{{json .RepoDigests}}'))
  const reference=refs.find(r=>r.startsWith(image+'@sha256:'));assert(reference,'No immutable registry digest')
  docker('pull',reference)
  assert.equal(docker('image','inspect',reference,'--format','{{.Id}}'),evidence.imageId,'Published image differs from tested image')
  const digest=reference.split('@')[1]
  writeFileSync('release-artifact/release.json',JSON.stringify({...evidence,image,digest,runId:process.env.GITHUB_RUN_ID},null,2)+'\n')
  appendFileSync(process.env.GITHUB_OUTPUT,`image=${image}\ndigest=${digest}\n`)
}else assert.equal(process.argv[2],'verify-local')
