# Milestone 6.1 — Cinematic Fog of War

## Audit and delivery boundary

6.1A is the first increment. B (gesture tools) and C (animation/polish) follow separate PRs after A is reviewable. No deployment or 6.2 work is included. Fog is DM-authored presentation, independent of movement, light, initiative and character rules.

### Existing architecture (inspected 9 November 2026)

| Concern | Existing owner / integration |
| --- | --- |
| Renderer, scene and floor visibility | `src/BattleMap3D.tsx`: one demand-rendered Fiber Canvas, BattlefieldScene, per-level translated groups, LevelScene. No second renderer. |
| Coordinates | X east, Z south; cell centre `(x-width/2+.5,z-height/2+.5)`; elevation feet / 5. Unequal floors align by northwest corner through group offsets. |
| Floors and terrain | `src/DungeonScene.tsx` instanced procedural cells/walls/props; `FloorImage3D.tsx`, `FloorSurface3D.tsx`, `TerrainLayer3D.tsx`; existing texture leases and bounded terrain CPU raster in `shared/terrain.ts`. These systems stay in place. |
| Walls, doors, scenery and GLBs | `ArchitecturalObject3D.tsx`, `Scenery3D.tsx`, `SharedModel3D.tsx`, `modelResources.ts`. Models normalise by height, so horizontal footprint is not bounded by scale alone. |
| Combatants, labels and selection | BattleMap3D Token groups, Html labels, roster, toolbar, inspector and filtered Fiber raycasts. Tracker visibility is separate from map placement. |
| Lighting | `LightingEnvironment3D.tsx`, `PointLights3D.tsx`, `shared/lightingState.ts`, lighting scene commands in `shared/dungeon.ts`; local low/medium/high quality and reduced motion. |
| Schema and persistence | Strict Zod `shared/dungeon.ts`, `readDungeon`, stable legacy `ground` ID, composeLevels/levelDocument adapters. `server/game.ts` load/persist map JSON in encounter_maps and checkpoint state. Existing templates, App import/export consume the same schema. |
| History | editMap whole-map frames, maximum 20 frames / 2 MB each history direction; map command gestures already use one command per completed operation. |
| Multiplayer | `shared/domain.ts` applyMapEdit DM authorization and projectEncounter/playerDungeon; `server/game.ts` transactional revision/receipt handling; `server/app.ts` per-socket session snapshots and map omission cache. |
| Media authorization | `server/assets.ts` projects state before GLB grants. `server/floor-images.ts` previously granted whole current images from relational references: needs current projected-state checking and masked battle-map responses. |
| Floors | playerVisible server projection independent of local hiddenIds; floor transition travel is explicit. Rename uses stable IDs, duplicate gets new ID, deletion removes transitions. |
| Pointer/touch and controls | EditorInteraction active tool, EditorSurface, DrawingSurface, TerrainBrushSurface; OrbitControls owns middle/right and two-touch gestures during painting. DungeonBuilder owns responsive C3 inspector and D4 palette. D3 history/fullscreen stays intact. |

Canonical UI sources read: `docs/ui/README.md`, `ui-design-guidelines-v2.1.md`, `feature-zone-matrix.md`, `ui-audit.md`, `ui-migration-plan.md`. Follow existing Button/InspectorSection/CanvasDock controls, C3 contextual settings, D4 tool entry; no extra header row.

## Proposed A architecture

Optional map-owned, independently versioned fog record. Four binary samples per grid square in each axis; fixed-size lowercase hexadecimal bitset per stable floor ID. Missing floor entry means fully hidden. At 50×50, each floor needs 10 KB hex; twelve floors need at most 120 KB. Validation rejects malformed lengths, unknown floors, unsupported versions and invalid bounds. No pointer event history or cell meshes. Existing maps retain absent fog fields. Enable starts concealed; disable preserves masks; reset requires explicit confirmation and retains enable state. New/duplicated floors start concealed; rename retains masks; deletion removes masks. Resize resets that floor conservatively. Existing map revision/history/persistence handle fog atomically.

Server projection is authoritative. With fog on, procedural floor cells and ordinary objects are sent only when their complete conservative footprint is revealed. Walls use complete segment footprints, not centre points. GLB horizontal bounds cannot be inferred safely from existing height-normalised scale, so custom scenery/architecture/miniatures are conservatively withheld until their entire floor is revealed. This is a deliberate A limitation; follow-up metadata bounds can narrow it without disclosing binaries or trusting client geometry. Tracker combatant identity/initiative remains as established, but hidden map positions and model references are omitted; hidden map selection/hover/labels/inspector cannot instantiate them. Tactical overlays are withheld on partially hidden floors until authoritative footprint support exists. Hidden emitters are withheld and gizmos stay DM-only.

Uploaded battle-map files require a server-baked, fog-masked map-coordinate image for partial floors. The original file is not granted solely by that placement. Repeating textures are reusable materials; grants require projected references. Terrain strokes whose entire conservative support is not revealed are withheld in A, rather than broadcasting hidden stroke coordinates. Previously received information cannot be revoked from a player's memory/cache after conceal.

Rendering combines server-safe scene projection with one black, unlit masked plane per visible floor. All hidden objects are removed before rendering (including tall/large GLBs), rather than relying on that plane to cover their height. Revealed samples are clear; edge softness in C darkens only inside revealed space. DM editing sees the full scene, with optional boundary overlay. DM Player Preview uses the same projection as player snapshots and blocks map edits. Floor elevations/stacking retain independent masks and northwest alignment. Transition records require both endpoints/floors revealed; travel never changes fog.

Player map omission caching must not reuse projected maps based solely on mapRevision: moving an attached emitter can change projected map content during a combat revision. Fog-enabled player snapshots therefore include authoritative projected maps. No camera or combat changes are made by fog operations.

## Review / validation record

Implementation and validation results will be recorded below before A is delivered. Warehouse and cavern artwork are not assumed to exist in test fixtures; synthetic maps cover the same role/floor/tall-model cases. Real tablet GPU, real touch and private-map manual scenarios require manual acceptance. No animation or brush controls are claimed in A.

## 6.1A implementation and compatibility

Implemented optional `fogOfWar` version 1 without changing existing map schemaVersion or adding SQL tables. Commands: `map.fog.enabled`, `map.fog.reset` (literal confirmed flag), `map.fog.mask` (complete bounded floor mask). Foundation mask writes are the atomic adapter for B's completed gestures. Undo restores exact bytes through existing bounded history. Fog commands preserve combat/tactical/lighting objects rather than running geometry reconciliation unnecessarily. Projection strips hidden placement/model data while retaining existing initiative records and permitted tracker information.

`server/fog-image.ts` bakes partial uploaded artwork into map coordinates using the existing floorImageUv calibration. Transparent hidden pixels contain zero RGB as well as zero alpha. It produces at most 800×800 pixels (16 per square); full-floor revelation returns the original calibrated image. Two simultaneous mask jobs per process bound decoding work; extra requests return a retryable 429. Responses are private/no-store and verify live membership, session, current encounter and projected floor access. Player direct original-image grants require an unmasked public placement or public material reference. Reusing battle-map artwork itself as a repeating material intentionally authorizes that shared material's contents; use separate texture assets. Revealed full files already downloaded cannot be recalled on conceal. Retrying a stale fog URL always bakes current authoritative state; browser resource keys use monotonic mapRevision rather than undoable fog revision.

One DataTexture and plane per displayed floor, no cell meshes. Textures are disposed on replacement/unmount. Server projection handles full object support before instantiation, so geometry height does not defeat concealment. The DM's optional overlay is translucent and disabled by default. Player Preview suppresses editing controls/callbacks/keyboard shortcuts and uses the same projected map, placements, lights and overlays as player snapshots. D4 opens C3 settings; reveal/conceal gestures remain B.

### Explicit A limitations and follow-up work

- Custom GLBs (including miniature and architectural models) require full-floor revelation in A because trusted horizontal bounds are absent from asset metrics. A room-only reveal therefore withholds those models. This must be resolved before claiming the supplied Warehouse/Myconid room-reveal scenarios complete. Smallest compatible follow-up: capture trusted geometry bounds during existing server asset validation and apply the same height-normalisation/calibration transforms in shared visibility projection. Existing assets need conservative fallback or revalidation.
- Partial terrain strokes are withheld until their entire brush support is revealed. Shared tactical overlays require a completely revealed floor. Nothing is deleted from authoritative state. B/C should replace these conservative policies with clipped derived masks and bounded footprint-aware overlays.
- Boundaries are binary at quarter-square resolution in A; edge softness is versioned state reserved for C and currently renders hard edges. No animation is implemented. Partial artwork is downsampled to 16 pixels per square. These are reviewable foundations, not a claim of finished cinematic quality.
- Fog-enabled players receive full projected map snapshots, including on combat-only revisions; C can optimise using an equality/hash of the complete projection rather than mapRevision alone. Geometry reuse remains active on receipt.
- The tracker intentionally retains already-public combatant identity/initiative and permitted details. Fog protects map placement and private map content, not established tracker disclosures. Previously authorised data cannot be made unknown by concealing it later.
- No real Warehouse/Myconid private artwork or physical tablet testing has been performed. A synthetic warehouse, actual textured GLB and independent browser contexts exercise the same boundaries.

### Performance evidence

Cloud CPU benchmark (`work/fog-benchmark.ts`, scratch only): twelve 50×50 floors, 30,000 floor cells and 30,600 wall segments; 120,260 bytes fog JSON. Thirty projections: median 44.94 ms, p95 83.88 ms while other checks were running. A 2048×2048 input baked into the partial 800×800 map image in 208.73 ms, producing 12,314 bytes. These are CPU/container measurements, not browser FPS or tablet GPU promises. Work happens on snapshots/edits, not every frame. Per-player worst-case projection and large full snapshots are material costs for C to reduce. Existing history limits can retain fewer than twenty frames on very large maps; fog does not raise those limits.

### Validation and manual review

Automated evidence is completed below with the final run results. Foundation tests cover strict legacy/schema behaviour, lifecycle independence, reset confirmation/history, save/import round trips, role authorization, full-footprint exclusion, tracker preservation, hidden-floor protection, original/masked media grants, late join, reconnect and server restart. Browser tests check the black raster output, same renderer/camera, read-only preview, reset cancel/undo, actual GLB loading and separate DM/player contexts.

Manual A acceptance:

1. Load an existing map without fog: confirm floors, terrain, lighting and combatants render as before.
2. Open Map editor → D4 Fog → C3 Fog of War. Enable it; confirm the DM view and camera stay unchanged.
3. Enter Player Preview: verify opaque black unexplored floor, no hidden tokens/labels/selection/GLBs, clear read-only label, and functional camera/fullscreen. Exit returns to editing.
4. Toggle the optional editing overlay. Hidden objects remain selectable in DM editing. Disable fog, then re-enable: reveal data survives.
5. Import a synthetic/edited fixture with a partly revealed floor and a second independently revealed floor, save/export/reload; verify stable floor IDs and masks. B provides interactive revealing; no pointer tools are claimed in A.
6. Reset Fog and cancel; verify no change. Confirm reset, then undo/redo. Check tracker initiative/HP, terrain and lighting are unchanged.
7. Join another browser with a player invitation; repeat enable/disable/reveal-mask fixture changes, refresh/reconnect, and verify hidden floors remain absent. Inspect snapshot/media requests to verify original concealed artwork and GLB binaries are denied.
8. Verify the conservative model/terrain/tactical limitations above explicitly. Defer full Warehouse and Myconid cinematic acceptance until those follow-ups and B/C are complete.

Rollback: no migration to reverse. Revert application code only after retaining exports of fog-enabled maps; old strict readers reject unknown fog fields. Do not silently discard fog data or clear existing map templates. No deployment is included.

Final A draft validation (9 November 2026): `npm run lint`, `npm run typecheck`, `npm run build` pass; build retains the existing >500 KB bundle warning. `npm test`: 159 passed, 3 existing platform-dependent infrastructure/PowerShell skips. Disposable PostgreSQL: fog, floor-images and lighting integration suites pass (16 tests); final fog integration rerun also passes after projection refinement. Chromium/SwiftShader: all 7 tests in `fog-foundations.spec.ts`, `levels.spec.ts`, `lighting-foundations.spec.ts`, `terrain-painting.spec.ts` pass (3.8 minutes), including separate role contexts, a real textured GLB, black-pixel assertion, reset/undo, refresh/reconnect, multi-floor transitions and fullscreen. Physical tablet and supplied private-map manual scenarios remain unrun.

Publishing status: the local branch is `codex/milestone-6.1a-fog-foundations`. GitHub GraphQL access returned Forbidden and `gh auth status` reported the configured token invalid. A local draft remains reviewable; a remote PR must not be claimed unless publishing succeeds. The documented limitations prevent claiming the entire milestone complete. B/C remain unstarted and nothing is deployed.

Branch publication succeeded through Git: commit `455b20e` is on `origin/codex/milestone-6.1a-fog-foundations`. GitHub REST repository access also returned Forbidden, so no pull request was created. Review the published branch or open the draft manually at https://github.com/RayCoulstock/DnD-combat-tracker/pull/new/codex/milestone-6.1a-fog-foundations. This is a publication/access blocker, not a test failure. B/C remain gated on the requested independently reviewable PR delivery.

## CI follow-up — door placement in the levels regression

The reported CI failure saved a wall but observed zero doors after the next click (`e2e/levels.spec.ts`). Five isolated setup runs under 6× CPU throttling passed, so the precise failing CI event sequence was not reproduced. Inspection found two unsynchronised assumptions: polling the server's wall state does not establish that Fiber has committed that revision and the newly selected tool, and the test used a raw viewport click near the wall's floor edge.

The active level group now records its committed editor tool and map revision in local Three.js userData. The shared projection/click helper can wait for both, updates world matrices before projecting, and retains canvas actionability checks. The levels test waits for the saved wall revision plus Door in that scene, then clicks the middle of the wall face through the shared helper. The final server door-count assertion and its timeout are unchanged; no retries, sleeps, skipped checks or door-command changes were added.

A deterministic browser fixture holds the old tool, then the old revision, and verifies that no pointer click occurs until both match. The existing delayed-renderer/overlay regression remains intact. This adds renderer-readiness diagnostics without changing UI zones, map state, authorization, fog or production door behaviour. Full repeated test and static-check outcomes are recorded with the follow-up commit.

Follow-up validation: lint, typecheck and build pass (existing bundle-size warning); both shared-helper browser regressions pass. The full levels scenario passed twice consecutively at the unchanged 120-second test budget. In the three-repeat batch, the first run hit that overall budget later at transition source picking while diagnostics/static checks were also running; its door assertion had already passed. Batch result: 2 passed, 1 overall timeout. This later timeout is recorded separately from the reported door-count failure; no timeout or assertion was relaxed. The exact original CI failure was not reproduced locally.
