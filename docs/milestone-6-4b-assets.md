# Milestone 6.4B asset adapter

Implements the B-owned pure stage from Issue #58 against approved 6.4A on main
`11765df`. `shared/sceneGeneration.ts`, its fixtures, legacy generator, commands,
server reference synchronization, effects and UI are unchanged.

## Integration

`sceneManifestFromAssets(ownerAuthorizedAssets, verifiedFootprints)` builds the
asset portion of a normalized v1 manifest. Verification records must come from the
authority, independently of editable tags/presentation, and pin the asset revision.
Only ready/valid matching library entries enter the manifest. Missing, stale or
unverified footprints exclude the asset. Duplicate records/IDs and malformed trusted
data fail validation. The adapter does not authorize library access or create a
production verification store. Until the authority supplies verified records, pass
an empty list and use built-ins. C's coordinator may compose its authorized effect
availability into the returned manifest; this asset adapter emits no effects.

Verified width/height describe conservative integer grid bounds of the **normalized
renderer model at scale 1**, centred at its anchor. They are not raw GLB dimensions.
Generated scenery uses scale 1, rotation 0, offset 0; user presentation defaults
cannot inflate the verified placement. `sceneFootprintCells` conservatively covers
scaled/rotated existing objects, including fractional anchors and rectangular bounds.
A one-cell built-in footprint matches the existing normalized procedural visuals.
Existing unverified scenery fails closed instead of guessing collision semantics.

`placeSceneAssets` implements `SceneGenerationStage`. The coordinator supplies a
canonical layout with the spec's floor IDs/elevations/transitions already realized.
The stage reconstructs seeded room order with the unchanged `generateLayout` and
rejects differing floor geometry. It changes only zone materials and appends canonical
editable props. Inputs are copied, no network/random/time operations occur, and
selection uses normalized manifest order. The candidate order is z then x; sparse,
balanced and dense request 1, 2 and 4 instances per dressing respectively. IDs encode
stage/floor-index/zone-index/dressing-index/ordinal and collisions fail closed.

Every room centre, door approach and transition endpoint is reserved. Cardinal BFS
reserves deterministic connecting paths. Closed unlocked doors are traversable;
locked doors and solid walls block traversal. Footprints require actual floor cells,
cannot span wall/door edges or overlap existing occupancy, and avoid reserved paths.
Final BFS rechecks all essential targets with transient blocking occupancy. Invalid
source occupancy/routes are errors; source objects/geometry are never removed to
make placement succeed. `validateSceneRoutes` is also exported for coordinator use.

The map-wide scenery budget conservatively counts all existing props and all added
decoration, including built-in fallbacks. Existing over-budget content is retained;
new additions stop with `budget-reduced`. Canonical 200 props/100 scenery per floor
limits also apply. Missing assets, oversized footprints or per-floor scenery limits
try a checked one-cell requested built-in; if that cannot fit, omit it. Both report
`asset-fallback`. Final `readDungeon` validation is mandatory. Transient occupancy
is intentionally not a new saved map format; subsequent editor moves can change routes.

## Existing renderer fallback audit

`src/Scenery3D.tsx` already supplies a procedural box mesh to `SharedModel3D`.
The shared loader shows that mesh during loading, failed authenticated fetch/parse,
missing scope and render-boundary failure, with an unavailable status/retry control.
It uses no generated URL or executable content. Missing GLB downloads cannot change
geometry or route decisions. No renderer change was necessary. The existing
`e2e/scenery.spec.ts` includes a missing-asset import with a live player and checks
that fallback status, canvas and multiplayer connection remain present.

## Proposed shared-contract follow-up (not implemented)

The approved context contains only a manifest and optional source document. It has
no resolved variant room analysis. The audit explicitly says variant room analysis
is not implemented. Arbitrary edited geometry cannot safely reuse seeded room indices.
B therefore rejects variant placement with an explicit room-analysis error, preserving
its source. Proposed owner-reviewed addition: an authority-resolved per-floor array
of room regions/centres, tied to the checked source revision, with explicit rules for
room ordering, irregular rooms, entry and essential routes. A/B/D should review that
seam before variant placement is enabled. No shared type/schema was redefined here.

Command registration, transaction-time authorization/revision rechecks, preview
manifest delivery, fog setup, atomic accept/history and variant duplication remain
D-owned coordinator work. This PR exposes no new production generation command.

## Verification (14 November 2026)

- `npm test`: 214 passed, 3 existing platform skips, no failures (includes 8 B tests
  and unchanged legacy generator goldens).
- `npm run test:integration`: 116 passed, no failures/skips, against a new disposable
  PostgreSQL 17 container on loopback port 55464. No production data used.
- `npm run lint`, `npm run typecheck`, `npm run build`: passed. Build retains the
  existing large-bundle advisory.
- Chromium `e2e/scene-generation-assets.spec.ts`: passed; actual browser/server
  stage equivalence and input immutability with available and missing assets.
- Chromium `e2e/editor-workspace.spec.ts`: passed.
- Existing scenery browser regression initially reached its 120-second total timeout
  during concurrent checks; a standalone run with a 240-second limit is recorded below.

No physical-device performance measurements or enabled full coordinator/variant
workflow are claimed. No shared contract changes, migration, merge or deployment.

Standalone Chromium scenery retry: **passed** with the 240-second limit, including
missing-asset fallback, live players, editing, templates, history and reconnect.
