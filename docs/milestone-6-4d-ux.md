# 6.4D UX and coordinator integration

Authority: [Issue #58](https://github.com/RayCoulstock/DnD-combat-tracker/issues/58)
and the approved `docs/milestone-6-4-scene-generator.md` ownership matrix.
Started from main `11765df` (6.4A PR #59 merged), on isolated branch/worktree
`codex/milestone-6.4d-ux`. No open B/C PRs or merged adapters were available at audit.

## Delivered at the typed-mock integration boundary

- Three editable generation presets retain the entered seed and feed the existing generator.
  Preview/regenerate remain local; acceptance sends the reviewed legacy options to server
  regeneration. Editing options invalidates the old preview; failed generation removes it.
  Acceptance rejects a changed map revision. Cancel leaves the encounter unchanged.
- Structured scene proposal editor uses the approved strict schema with no additional fields.
  Seeded proposals derive from current options. Variant proposals load the selected template
  without writes, pin its revision, copy actual floors/transitions, and preserve fog. Users
  can edit zones, budgets, environment and all existing spec options as JSON and validate
  offline. Natural language authoring remains deferred; there is no external model/API.
- The pure coordinator uses the existing layout generator per floor, normalized authority
  manifests, then explicit assets, environment and validation stages. It clones inputs and
  stage boundaries, concatenates bounded diagnostics, validates canonical output and guards
  source geometry/objects/effects/lights and fog. B's room resolver and spatial validator
  are mandatory injected dependencies, with no identity defaults. Mocks exist only in tests.
- The UI workflow snapshots the reviewed spec, ignores cancelled/out-of-order previews,
  prevents duplicate accepts, retains preview after failed acceptance, and requires a new
  variant name. Persistence is an authority dependency; browser mocks verify orchestration,
  not database atomicity. The original template is never overwritten by this implementation.

## Integration gates and proposed shared additions (not registered)

The contract is explicitly a planning contract, not an executable command. Rather than
independently defining a wire protocol, this PR leaves `shared/sceneGeneration.ts`, fixtures,
`shared/domain.ts`, `server/game.ts`, `server/maps.ts`, generator internals and B/C files
unchanged. Scene preview/accept are disabled in the shipped builder until an authority
adapter is supplied. The legacy generator remains enabled. This is the initial D delivery,
not a claim that full scene generation or variant persistence is enabled.

Proposed contract-owner review:

1. Add an explicit scene preview/accept authority protocol carrying the approved spec,
   encounter revision, manifest snapshot identity and command receipt. The browser must
   not submit a trusted manifest or canonical document. Agree how the server pins and
   verifies the preview snapshot before defining field names in a schema.
2. Accept must lock/authorize the campaign, encounter, source template and ready asset
   revisions, reject stale encounter/source/manifest, rerun realization with the same
   snapshot, synchronize references and apply one `map.load` history frame under the
   existing receipt transaction. SceneProposalAuthority is a local UI port, not this protocol.
3. A variant accept must duplicate to a new UUID/name, load the transformed canonical copy
   into the variant encounter, and save the new template with encounter revision in the
   same transaction. Do not compose existing HTTP duplicate/load/save calls: they are
   separate transactions and can leave a partial duplicate. Define whether the destination
   encounter is newly created or explicitly selected; do not silently replace the source.
4. B must supply verified footprint/ownership metadata, deterministic variant room analysis
   and spatial validation in addition to placement; C supplies environment/fog integration.
   The approved single-stage seam does not currently expose B's validation/room analysis.
   The coordinator's local dependency interface requests those capabilities without changing
   the shared contract. Adapt the real exports only after B/C merge and review the seam.
5. Additional floor seeds can exceed the legacy 100-character limit after suffix derivation.
   The coordinator currently fails explicitly; agree a versioned bounded derivation before
   enabling that edge case. No truncation or independent hash algorithm was introduced.

After B/C merge, rebase on main, replace test-only mocks with reviewed real adapters and
implement the approved authority protocol. Require full browser/server equivalence, spatial
failure/fallback, stale snapshots, multiplayer authorization/fog, atomic variants, history,
restart/import/export and quality/budget acceptance before enabling scene acceptance.

## Verification

- `npm test`: 215 passed, 3 existing platform-dependent skips, zero failures
  (36 script/UI + 179 shared/server; includes 9 new coordinator/workflow tests).
- Final focused coordinator/workflow run: 9 passed, zero failures/skips.
- `npm run test:integration`: 116 passed, zero failures/skips, against disposable
  PostgreSQL 17 on loopback port 55464. Container removed after the run. Covers existing
  authoritative generation, DM authority, campaign isolation, receipts, restart and effects.
- `npm run typecheck`, `npm run lint`, `npm run build`, `git diff --check`: passed.
  Build retains the existing large-bundle advisory.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- e2e/scene-generation.spec.ts
  e2e/editor-workspace.spec.ts e2e/environmental-effects.spec.ts`: 5 passed, zero failures/skips.
  Browser tests distinguish production legacy/proposal validation from a test-only injected
  B/C/authority harness; they do not establish atomic server variant persistence.
- Re-fetched main before publication: still `11765df8149caf46e0637b560fdd76726a7ed4ca`.

No test mock is imported by the application bundle. No production database, merge or
deployment was used. Real-adapter and authority acceptance gates above remain outstanding.
