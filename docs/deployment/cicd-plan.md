# PR 3 implementation plan

Base: merged PR 2 on main. Preserve Dockerfile, standalone production Compose, Caddy and the explicit migration/matched-backup/isolated-restore contracts.

1. Reusable PR validation: Node 24, isolated PostgreSQL 17, full native/test/browser/required-infrastructure checks, then the genuine Buildx image and existing TLS/backup recovery rehearsal. Never accept a diagnostic artifact. Transfer only the tested Docker archive, checksummed evidence and SBOM, not databases, GLBs, session traces or private fixture state.
2. Main-only publication: invoke that same required validation, load its image, verify identity and publish without rebuilding. Bind GHCR digest to commit, workflow run and attested release evidence. Minimal token grants only in the publication job; no fork secrets or pull_request_target.
3. Manual staging/production preparation: fail closed unless owner-configured enable flag, reviewers, restricted main branch, successful trusted publication, exact digest and attestation all verify. Strict SSH to a preconfigured, identity-checked existing target. Matched backup with writes stopped, explicit migration, approved startup and read-only synthetic-account HTTPS/socket check; never automatic database rollback. No initial-install bypass.
4. Validate workflow syntax, shell and release-gate regression tests, all existing tests and actual Docker build/smoke where available. Record unavailable registry/cloud/GitHub capabilities honestly. Document owner settings and future first-deployment approval.
