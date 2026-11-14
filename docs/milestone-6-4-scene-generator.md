# Milestone 6.4A: scene generation audit and contract

Authority: [Issue #58](https://github.com/RayCoulstock/DnD-combat-tracker/issues/58).
Audit on 14 November 2026 against main `922666b9d992dc40aed6ddb5a8d8242d9e70c642`.
This PR contains planning schemas, pure manifest helpers, fixtures and regression tests only.
No new command is registered, renderer changed, persistence format added, or scene executor implemented.
B–D start only after this contract is approved. No merge or deployment is authorized.

## Actual baseline and pending work

GitHub open-PR inspection found **no pending PRs**. 6.3A #54, B #55, C #56 and D #57
are merged into main. Older 6.3 documentation records API/publication limitations from
those sessions; they are historical, not evidence of pending work today. Remote branches
may remain after merge and must not be treated as unmerged dependencies.

| Interface | Actual behavior and integration risk |
| --- | --- |
| `shared/generator.ts` | Strict `generationOptionsSchema`; 6–50 square dimensions, 1–25 rooms, theme, bounded seed and room sizes. `generateLayout` returns `{document, rooms}`, `generateDungeon` returns `DungeonMap`. PRNG hashes serialized parsed options; partition order, draws, property order and locale sorting are compatibility sensitive. Do not change it. Some schema-valid options cannot fit; realization must surface the existing error. |
| `shared/dungeon.ts` | `readDungeon`, `dungeonLevels`, `primaryLevelId`, `editMap`, `emptyHistory`; canonical walls and door references. Reads map schema versions 1–6. Primary geometry stays top-level; additional `levels` max 11. Version 5 needs primary metadata; transitions need version 6. Props max 200/floor, uploaded scenery max 100/floor. Validation checks bounds/IDs, not blocking footprints or essential route reachability. |
| `shared/domain.ts`, `server/game.ts` | `map.generate` contains only legacy options. Both enforce DM role. Server regenerates then converts to `map.load` inside existing encounter revision/receipt transaction. Campaign authorization, player projection and persisted history remain the authority. A future scene command needs an explicit additive protocol change and server manifest resolution; do not widen the existing command silently. |
| `src/DungeonBuilder.tsx` | Local `generateDungeon` preview; cancel drops preview, accept sends options for server regeneration. Existing tools edit canonical objects. Preview is not permission to persist client-generated documents. |
| `server/maps.ts` | Campaign-scoped, DM-only revision-checked template save/load/duplicate. Duplicate copies document to a new UUID/name, revision 1 and syncs references. Template save takes encounter ID/revision, not arbitrary scene JSON. |
| `shared/assets.ts`, `shared/scenery.ts`, `shared/architecture.ts` | Ready/valid GLB library metadata has tags/category/presentation, UUID references and independent revisions. Scenery has anchor, rotation, scale, offset, visibility; architecture visuals have role constraints. No authoritative collision footprint/tag ontology yet: B must adapt verified metadata to this contract. |
| `shared/floor-surface.ts`, `shared/terrain.ts` | Solid/image/texture surfaces and painted strokes use approved built-ins or owned texture UUIDs. V1 scene proposals select enumerated floor material only; custom texture generation is deferred to a reviewed extension. |
| `shared/transitions.ts` | Floor endpoints, one/two-way direction, movement cost, optional visual asset; a portal effect alone never teleports. Document validation doesn't require an actual floor cell at endpoints. |
| `shared/lighting.ts`, `shared/lightingScenes.ts` | Environment plus per-floor overrides, max 32 sources/12 scenes. Low/medium/high render 4/8/16 points and 0/1/2 point shadows. Linked effect light counts as a source, not a free extra. |
| `shared/environmentalEffects.ts` | Fixed preset registry, strict particle/surface controls, 64 effects/map; visual only. `createEffect`, radius/particle helpers, preset support flags. Never invent a preset or renderer. |
| `shared/effectPlayback.ts`, `shared/effectState.ts`, `shared/effectLighting.ts` | Merged 6.3D: optional lifecycle, server timestamps, effect revisions, parent resolution/reconciliation, fog-aware projection, exclusive linked light ownership. Do not put time, random UUIDs or combatant attachments into deterministic generation. |
| `shared/fog.ts`, `fogVisibility.ts`, `src/DungeonScene.tsx`, `src/BattleMap3D.tsx` | Four fog samples/square; floor-indexed masks, server player projection plus renderer clipping/light filtering. Hidden effects must not leak glow/particles/parent position. Rendering quality never changes saved geometry or fog. |

## Versioned proposal and deterministic pipeline

`shared/sceneGeneration.ts` exports `sceneGenerationSpecSchema`, `SceneGenerationSpec`,
`sceneAssetManifestSchema`, `normalizeSceneManifest`, `selectSceneAsset`, budget schema,
stage order, context/result types and the pure `SceneGenerationStage` seam. The JSON
fixtures `shared/fixtures/scene-generation-v1.json` and
`shared/fixtures/scene-manifest-v1.json` are the common B/C/D inputs. Manifest UUIDs
are synthetic fixture identifiers, not trusted production assets.
Strict objects reject unknown executable/code/URL/asset-ID fields; presets, fallback
props and materials are enumerated. This is a **transient proposal**, never a second
map document. `version:1, mode:scene-v1` deliberately opts into changed output. Legacy
`map.generate` remains byte-equivalent for existing seed/options, guarded by goldens.
Unknown versions fail rather than silently falling back to a different algorithm.

The `options.seed` is the only user seed. No timestamps, network fetches, locale-based
comparison or unseeded randomness during realization. Proposed phases:

1. **Layout**: call existing `generateLayout(options)` once per floor. Primary uses
   unchanged options; additional floors derive seed `${seed}:floor:${floorId}`. V1
   floors share dimensions/options. Map room indices refer to returned room order.
   Variant mode copies canonical geometry instead; room indices must be resolved by a
   deterministic room analysis adapter (not implemented in A). Reject unresolved zones.
2. **Zones**: assign explicit zones to distinct room indices/floor IDs; unspecified rooms
   retain legacy materials/props. Room boundaries and purpose are transient annotations.
3. **Placement**: B applies material and tagged dressing to the canonical clone; C then
   applies effects/environment. Stable object IDs use stage/floor/zone/ordinal and must
   be checked against existing IDs. Stage-local PRNG streams derive from spec seed and
   those keys so optional effects cannot shift asset placement. Iterate floors/zones by
   spec array order and candidates by z then x; no implicit DB iteration order.
4. **Validation**: `readDungeon` plus generation-specific footprint, walkability,
   route, asset authorization, budget and reference checks below. Fail closed with a
   useful error, or deterministic decorative fallback/omission diagnostic. Never save a
   partially validated scene. Parser validation alone does not prove spatial validity.
5. **Canonical**: return `SceneGenerationResult.document: DungeonMap`, diagnostics
   containing safe codes/zone IDs. A future coordinator emits one existing `map.load`
   edit inside the authorized transaction for atomic undo. Do not replay hundreds of
   commands or maintain a separate scene persistence store.

B/C implement pure adapters with signature `SceneGenerationStage(spec, context, document)`.
They return `SceneGenerationResult` with a fresh document and bounded diagnostic codes;
leave input/context unchanged. The coordinator concatenates diagnostics in stage order. The future coordinator
validates inputs, supplies source if variant, sequences stages, validates output and returns
result. The signature is a seam, not an implemented executor. The source/template revision,
manifest snapshot and canonical validation are required coordinator preconditions.

## Availability and security

The authority builds a bounded manifest from the DM owner's **ready and valid** assets,
including pinned revision, verified grid footprint, blocking semantics and tags. Browser
preview receives that authorized snapshot through a future adapter; proposal input cannot
supply a manifest. UUID shape validation is not ownership verification. Reuse server
scenery/architecture/texture reference checks and transactional reference synchronization.

Normalize manifest arrays by code-point ID/preset order; deduplicate/sort tags. Candidate
selection is the first normalized matching tag. No arbitrary URLs, executable text, custom
preset IDs or proposal-selected GLB UUIDs. If no candidate exists, use the requested built-in
prop; if that cannot fit, omit decoration with `asset-fallback`. Missing effects are omitted
with `effect-omitted`. Zero budget disables that category. Fallbacks consume canonical prop
limits too. Geometry/routes never depend on successful GLB download. B must supply a safe
procedural runtime visual if an accepted GLB later disappears; current rendering must be
audited before claiming this behavior. Pinned revision changes between preview and accept
require re-preview, not silent acceptance. Same parsed spec, seed, source revision and
normalized available manifest must produce deeply equivalent canonical documents in browser
and server. Revalidate library state under the accept transaction to avoid availability races.

Optional natural language is proposal authoring only: user reviews the strict structured
spec before preview/accept. Never execute model text or bypass validation/authority. No
external LLM endpoint, key, dependency or network requirement is introduced. Procedural
layout and built-in fallback remain available offline. AI authoring is deferred to D.

## Placement, routes and floors

B must reserve doors (including approach cells), essential room centres, transition endpoints
and connecting paths before dressing. Footprints are integer grid rectangles, conservatively
rounded after scale/rotation; rotated 90/270 swaps width/height. Missing trusted footprint
means do not select the asset. Every covered cell must exist on the floor and be in bounds;
blocking rectangles cannot intersect each other or reserved cells. Check wall intersections
and re-run cardinal flood fill with closed unlocked doors traversable, locked doors blocked.
All essential room centres and transition endpoints must be reachable from entry. Never
repair a failed route by deleting user geometry in a variant. Decorative fallback must also
pass footprint/route checks. Canonical scenery alone has no collision field, so generation
must retain transient occupancy through validation; a later edit can change reachability.

Floors max 12 with unique IDs and elevations at least 0.1 feet apart. V1 proposal validates
endpoint bounds, floor references, uniqueness and directed floor reachability from primary.
Realization additionally requires actual walkable endpoint cells and essential routes;
`readDungeon` alone is insufficient. Transitions use canonical schema version 6, no orphan
references or hidden duplicate transport system. Effects such as portals stay visual only.

## Variant workflow, history and compatibility

Variant source is `{kind:'variant', templateId, revision}`. Resolve it with campaign/owner
authorization and expected revision. Clone before any transformation; preserve source JSON,
all geometry, editable IDs, levels, transitions, fog and existing effects/lights unless a
reviewed option explicitly changes them. Existing objects count against budgets: if already
over a generation budget, add none in that category; never delete source content to fit.
V1 variants must match source dimensions/floor IDs/elevations and use resolvable room zones;
reject conflicts. Create a new template UUID/name via the existing duplicate workflow, apply
to the variant encounter, save with encounter revision, and never call overwrite-save on
the source template. Coordinating this workflow and preventing partial duplicate saves is
future D/server integration work, not an existing atomic variant endpoint.

Accept requires DM role, campaign isolation, stale-source/manifest/encounter rejection,
command receipts and one atomic history frame. Cancel changes neither encounter nor source.
Reconnect/restart uses persisted canonical map, not proposal replay. Undo/redo/import/export
use existing map facilities and asset-reference synchronization. No schema migration in A.
Keep old maps readable and preserve optional 6.3 playback fields; never downcast version 6.

## Environment, fog and performance

C uses existing preset/default helpers, never arbitrary shaders/textures. Optional proposal
`environment` reuses the strict existing `environmentSchema`; absence preserves the source
environment (or legacy defaults on a new layout). New effects start
with legacy looping playback (no optional lifecycle timestamps); scenery attachments only
when parent/floor are validated. Linked light is exclusive, at resolved effect position and
within the common budget; no orphan emitter. No generated combatant attachments or automated
damage/teleport/fog reveal. Reserve effects/light IDs before linking. Honor preset attachment,
particle, surface and light support flags.

Generation caps are 100 scenery, 64 effects and 32 sources **per map**, even where canonical
per-floor limits are higher; point shadow cap 2. Default fixture deliberately uses 20/8/4/0.
Quality low/medium/high retains existing 4/8/16 point and 0/1/2 shadow renderer caps. Effects
retain preset particle profiles and existing reduced-motion/static sampling. At budget limits,
keep stable earlier placements and omit later decoration with `budget-reduced`; don't mutate
saved content on quality changes. Browser GPU timings need physical-device measurement in C;
no performance claim follows from schema caps alone.

New maps use concealed fog with existing `initialFog` (empty masks reveal nothing); variants
may preserve masks only on identical floor geometry/dimensions. Never copy masks to resized
floors or reveal areas to showcase assets. C must use existing fog projection/clipping for
geometry, particle bounds, attachments and emitted light. Quality degradation cannot reveal
concealed content or change authorization.

## Ownership and isolated follow-on work

| Owner | Files / seam | Exclusions / dependencies |
| --- | --- | --- |
| A contract owner | `shared/sceneGeneration.ts`, shared JSON fixture, contract tests, this document | Shared changes need separate reviewed PR; B/C/D must not independently redefine them. |
| B assets | New `shared/sceneGenerationAssets.ts` + tests; asset metadata adapter; focused existing asset/scenery integration | No effects/UX/contract edits. Own footprint, deterministic selection/fallback and route validation. Coordinate any server reference changes explicitly. |
| C environment | New `shared/sceneGenerationEnvironment.ts` + tests; focused lighting/effect/fog adapters | Depend on merged 6.3D and approved A. No asset tags/UX/contract edits; avoid B's files. |
| D UX/coordinator | New scene proposal/preset UI components; `src/DungeonBuilder.tsx`; focused `shared/domain.ts`, `server/game.ts`, `server/maps.ts` coordinator integration | Sole owner of command registration and orchestration. Consume B/C adapters after their merges; initially use typed mocks only. No generator internals or contract edits. |

After A approval/merge, create three worktrees from the same updated `origin/main`, e.g.
`git worktree add ../ledger-64b -b codex/milestone-6.4b-assets origin/main` and analogous
64c/64d branches. Give each Codex task Issue #58, this file, explicit ownership and the A
fixture. Each task opens its own PR targeting main; none merges/deploys. B/C can implement
pure adapters in parallel; D can build UI and coordinator tests with mocks, then integrate
real adapters only after B/C land. Rebase remaining branches after each reviewed merge,
rerun compatibility/integration checks; resolve shared changes through the contract owner.
No stacked dependency on unreviewed changes and no concurrent writes in one checkout.

## Verification and review gates

A tests strict proposal/manifest parsing, invalid references/floor routes/versions, normalized
selection/order, empty-manifest fallback seam, multi-floor/variant fixture parsing, unchanged
legacy golden hashes for all themes and canonical editability. Existing domain tests retain
DM-only commands and player projection; no production behavior is enabled in A.

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
With disposable PostgreSQL, run `npm run test:integration` (includes multiplayer, campaign
isolation, receipts/restart, map history and 6.3 effects). With local API/Vite and Chromium,
run focused existing map/editor/effects Playwright regressions. B/C/D must add full-pipeline
browser/server equivalence, failed reference/overlap/route, missing/deleted asset/effect,
variant original-preservation/stale source, preview-cancel/accept, undo/restart/import/export,
player fog/glow and budget/quality browser coverage before enabling the feature. These
future acceptance tests cannot honestly pass against A's deliberately absent executor.

Validation evidence for this PR is recorded below once checks complete.

### 6.4A validation evidence

- `npm test`: 206 passed (36 script/UI tests + 170 shared/server tests), 3 existing
  platform-dependent skips, no failures. The 8 new contract tests also passed in a focused
  run after final contract refinements.
- `npm run test:integration`: 116 passed, no skips/failures, against a newly created
  disposable PostgreSQL 17 container bound to loopback port 55464. Includes the existing
  authoritative map-generation multiplayer test and 6.3 lifecycle/reference coverage.
- `npm run lint`, `npm run typecheck`, `npm run build`: passed. Build retains the existing
  large-bundle advisory; no production module imports the new planning contract.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- e2e/editor-workspace.spec.ts e2e/environmental-effects.spec.ts`:
  2/2 passed using local API/Vite and disposable database (editor controls/camera plus effect
  placement/appearance/history/reduced motion/resource cleanup).
- Legacy goldens were captured from the unchanged audited generator with the shared fixture
  options and all three themes. `shared/generator.ts` and production files are unchanged.

No external LLM, migration, production database, merge or deployment was used. Full scene
realization, physical GPU/tablet testing and B/C/D end-to-end acceptance remain follow-on
work, not claims of this architecture-only PR.
