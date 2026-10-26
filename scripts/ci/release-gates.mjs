import assert from 'node:assert/strict'
export const shaPattern=/^[a-f0-9]{40}$/
export const digestPattern=/^sha256:[a-f0-9]{64}$/
export function imageName(repository){
  assert.match(repository,/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  return 'ghcr.io/'+repository.toLowerCase()
}
export function validateEvidence(e,commit){
  assert.match(commit,shaPattern)
  assert.equal(e.schemaVersion,1);assert.equal(e.commit,commit)
  assert.match(e.imageId,digestPattern)
  assert.equal(e.productionDockerfile,true);assert.equal(e.tlsBackupRestorePassed,true)
}
export function validateRun(run,repository){
  assert.equal(run.repository.full_name,repository)
  assert.equal(run.path,'.github/workflows/publish.yml')
  assert.equal(run.event,'push');assert.equal(run.head_branch,'main')
  assert.equal(run.status,'completed');assert.equal(run.conclusion,'success')
  assert.match(run.head_sha,shaPattern)
}
export function validateRelease(release,run,digest,repository){
  validateRun(run,repository);assert.match(digest,digestPattern)
  validateEvidence(release,run.head_sha)
  assert.equal(String(release.runId),String(run.id))
  assert.equal(release.image,imageName(repository));assert.equal(release.digest,digest)
}
export function validateEnvironment(environment,policies){
  const reviewers=environment.protection_rules.find(r=>r.type==='required_reviewers')
  assert(reviewers?.reviewers?.length>0,'Required environment reviewers are missing')
  assert.equal(reviewers.prevent_self_review,true,'Self-review must be prevented')
  // REST GET environment does not currently expose the administrator-bypass setting.
  // Refuse it if exposed/enabled; owner must disable it in Settings before enablement.
  if(Object.hasOwn(environment,'can_admins_bypass'))assert.equal(environment.can_admins_bypass,false,'Environment administrator bypass must be disabled')
  assert.equal(environment.deployment_branch_policy?.custom_branch_policies,true)
  assert.equal(environment.deployment_branch_policy?.protected_branches,false)
  assert.equal(policies.total_count,1,'Only the main branch may deploy')
  assert.equal(policies.branch_policies[0].name,'main')
  assert.equal(policies.branch_policies[0].type,'branch','Tags must not impersonate main')
}
