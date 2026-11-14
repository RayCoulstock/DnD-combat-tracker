# 6.4D UX and combined coordinator

Authority: [Issue #58](https://github.com/RayCoulstock/DnD-combat-tracker/issues/58)
and the approved `docs/milestone-6-4-scene-generator.md` ownership matrix.
Branch/worktree: `codex/milestone-6.4d-ux`. Updated from main
`0b8d951` after B #61 and C #60 merged. No shared planning contract, generator
internals or B/C implementation files were changed by D.

## Implemented behavior

- Three editable generation presets retain the entered seed and feed the existing generator.
  Legacy preview/regenerate remain local; acceptance sends the reviewed legacy options for
  server regeneration. Editing options invalidates the old preview; failed generation removes
  it. Acceptance rejects a changed map revision. Cancel leaves the encounter unchanged.
  The new stone preset uses minimum room size 4: size-3 legacy rooms can have an existing
  prop on the essential room centre, which B correctly rejects. Other user-selected options
  can still fail placement/routes; this integration surfaces the error without deleting props.
- The structured proposal editor uses the approved strict schema. Seeded proposals derive
  from current options. Variant proposals read the selected template without writes, pin
  its revision, copy actual floors/transitions, and preserve fog. Zones, budgets, environment
  and all existing spec options are editable as JSON and can be validated offline.
- `coordinateSceneGeneration` now defaults to the **real merged adapters**:
  layout -> `placeSceneAssets` -> `generateSceneEnvironment` -> final spatial validation.
  Final validation reuses B's placement stage with no zones, so it checks existing/generated
  footprints, overlap, geometry and essential routes after C without adding decoration twice.
  It then validates canonical output. All inputs and stage boundaries are cloned, manifests
  normalized, and bounded diagnostics concatenated in order. Explicit dependency injection
  remains for focused failure/cancellation tests.
- The builder uses the real pipeline for local offline scene previews, with no uploaded GLBs
  eligible until the authority supplies verified footprint records. Built-in effects use the
  fixed preset registry, and missing GLBs use B's checked procedural fallback. No client
  library metadata is treated as verified occupancy. The same coordinator accepts an
  authority-owned populated manifest when invoked on the server.
- Scene preview has no persistence callback. Its accept button is disabled, and the workflow
  also rejects programmatic acceptance without an authority adapter. Preview/cancel never
  modifies the encounter. Legacy dungeon acceptance remains available. The workflow ignores
  cancelled/out-of-order previews and prevents duplicate acceptance when a real accept port
  is supplied. Test-only variant mocks demonstrate UI orchestration, not server persistence.

## Remaining review gates and proposed contract changes

**Keep PR #62 in draft: combined seeded realization is integrated, but full scene/variant
acceptance is not ready for final approval.** Both merged adapter handoffs identify the same
missing variant-room seam; their merges did not approve a replacement contract.

1. B rejects variant placement, and C rejects effect-bearing variant zones, because the
   approved context has no resolved room analysis for arbitrary edited geometry. The default
   coordinator rejects variants explicitly and preserves the source. Proposed owner-reviewed
   addition: authority-resolved per-floor room regions/centres tied to a checked source revision,
   with ordering, irregular-room, entry and essential-route rules. Do not infer these from a
   regenerated layout or bypass B's rejection. No shared schema/type was redefined here.
2. The authority preview/accept protocol still needs review: approved spec plus encounter
   revision, manifest snapshot identity, source revision and receipt semantics. Browser preview
   JSON or a browser-supplied manifest must never become trusted persistence input. Agree the
   snapshot protocol before defining new wire fields or registering a scene command.
3. Acceptance must lock/authorize campaign, encounter, source and ready asset revisions,
   reject stale snapshots, deterministically regenerate, synchronize references and apply one
   `map.load` history frame under the existing receipt transaction. Atomic variant acceptance
   additionally duplicates to a new UUID/name, applies to the variant encounter and saves
   with encounter revision in that same transaction. Existing separate duplicate/load/save
   HTTP requests are not a substitute. Destination encounter semantics also need agreement.
4. Additional-floor seed suffixes can exceed the legacy 100-character limit. The documented
   derivation continues to fail explicitly for that case; a bounded versioned derivation
   requires owner review. No truncation or independent seed algorithm was introduced.
5. Physical GPU/tablet measurements and full authoritative acceptance/stale manifest/source/
   atomic-variant tests remain gates before enabling scene persistence. Natural language
   authoring remains deferred; there is no external model/API or network requirement.

These are existing contract/authority gaps, not passing acceptance claims. The new PostgreSQL
check below validates **combined canonical output through existing authorized map commands**;
it does not implement or prove a new scene-spec acceptance protocol or atomic variant save.

## Combined validation

Validated against main `0b8d9516f6c5c2e3f0fe472f58d9ffa0a5783da2`:

- `npm test`: **236 passed**, **3 existing platform-dependent skips**, zero failures
  (36 script/UI + 200 shared/server). Includes both real adapter suites and 4 new combined
  acceptance tests. Final strengthened preset/workflow run: **6 passed**, zero failures/skips.
- `npm run test:integration`: **117 passed**, zero failures/skips, on disposable PostgreSQL
  17 bound to loopback port 55464. The new combined-output check verifies one undo frame,
  duplicate receipts, stale encounter rejection, player edit rejection, fog/glow projection,
  undo/redo, campaign isolation, template save, export/import and backend restart. It also
  verifies conservative concealment of generated linked glow crossing the map edge, even
  under a fully revealed mask. It does not validate an unimplemented scene accept protocol.
- `npm run typecheck`, `npm run lint`, `npm run build`, `git diff --check`: passed.
  Build retains the existing large-bundle advisory.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- e2e/scene-generation.spec.ts
  e2e/scene-generation-combined.spec.ts e2e/scene-generation-assets.spec.ts
  e2e/editor-workspace.spec.ts e2e/environmental-effects.spec.ts`: **7 passed**, zero
  failures/skips. Real full-pipeline browser/Node equivalence includes populated and missing
  manifests, zero budgets, multi-floor scenes and inaccessible transition rejection.
- Re-fetched main before publication; B/C remain merged at the revision above.

The combined checks cover real B/C stages,
client/Node equivalence, immutability, populated/missing/oversized assets, absent effects,
zero/dense budgets, multi-floor walkable transitions and rejected orphan endpoints, canonical
editability, concealed linked glow, history, import/export and explicit variant rejection.
Separate mock-only tests remain for in-flight cancel, out-of-order previews, duplicate accepts,
conflicts and named variant UI orchestration. No mock is imported by the application bundle.

No production database, migration change, merge to main or deployment is authorized or used.
