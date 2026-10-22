# Hybrid dungeon builder (Milestone 3)

## Inspection and plan

The repository uses React/Vite, React Three Fiber, pure integer X/Z map helpers, Zod, PostgreSQL/pg, and authenticated Socket.IO commands. Version-1 encounter files store combatants and an optional battleMap. Commands already use UUID receipts, expected encounter revisions, campaign locks and recipient-specific snapshots. The session-start fix is merged into main and must be preserved. No tracked changes were present before creating feature/hybrid-dungeon-builder.

Stages: A defines the domain, compatibility and additive persistence with unit checks; B adds the existing-canvas manual editor; C adds deterministic generation and preview; D integrates authorised commands and the campaign template library; E adds persistent map-only undo/redo, rendering optimisations, multiplayer/browser regressions and the runbook. Run relevant tests at each stage and the complete suite at completion.

## Document and coordinates

`shared/dungeon.ts` defines a strict schemaVersion-1 JSON document (no meshes, URLs or executable fields), dimensions 4–50, floor cells, canonical walls, doors and enumerated props. Cell centres use the existing `x - width/2 + .5, z - height/2 + .5` convention. Walls use grid vertices: horizontal H:x:z from (x,z) to (x+1,z), vertical V:x:z from (x,z) to (x,z+1). North/south and east/west representations canonicalise to the same identifier. A door references exactly one wall and replaces its solid centre; removing that wall cascades the door. Floors and wall IDs are spatially stable; prop/door IDs are stable strings. Unknown schema versions, duplicate coordinates/IDs, orphan doors and unsupported props are rejected atomically.

## Rendering and interaction

Keep BattleMap3D/OrbitControls and the token renderer. A memoised DungeonScene renders floor materials and solid walls using instancing; a procedural prop registry is the extension point for later assets. Doors have oriented posts and a hinged panel (open leaves a passage, locked uses a gold marker). Missing dungeon documents keep the original flat battlefield. No camera data enters domain state or socket commands. Editor left-drag paints with a highlighted cell/edge preview; middle drag rotates, right drag pans, wheel zooms. Editing disables token movement, not camera use. Select/erase interact with raycast object IDs. Geometry is memoised independently from HP/initiative renders.

## Generation

One seeded PRNG drives a room-and-corridor generator. Partition the available interior into room slots with a separating gap; reject options that cannot fit the requested minimum rooms instead of silently dropping rooms. Sample non-overlapping room bounds inside slots, connect their centres with deterministic orthogonal corridors, derive region boundary walls and room-entry doors, and add themed props. Caverns use clipped/irregular room corners and wider passages. Stone Dungeon, Cavern and Mining Outpost vary materials and props, not document format. Preview is local and uses the same renderer; accepting sends validated options and the server deterministically regenerates the document. Cancel never changes state.

## Authority, revisions and undo

Extend the existing typed command union. Every edit is DM-only and validated under the existing campaign/encounter transaction lock, receipt and revision checks. Encounter revision and campaign state_revision order all edits, switches and recoveries. A separate instance revision records map changes. Keep full authorised snapshots for recovery: the existing reliable protocol has no incremental-delta recovery mechanism. Avoid repeatedly sending/rebuilding large map documents on combat-only changes by omitting unchanged documents from session updates and retaining the known revision on the client; fresh joins/reconnects always receive full documents. Players receive only the current public map, never template libraries or history.

Undo/redo stores bounded server-owned map frames (document/dimensions only), not combat state. Twenty entries with a byte cap limit memory/storage. Revisions and permissions apply to undo exactly as other commands. Valid token positions survive map replacement/undo; out-of-bounds positions relocate deterministically to the first free square in roster order, without collision/pathfinding rules. HP, ownership, rounds, abilities and initiative never roll back with map history.

## Persistence and lifecycle

Add migration 003: campaign-scoped `map_templates` with owner, document version/revision and timestamps; `encounter_maps` keyed by encounter with its own document, revision and bounded undo/redo JSON. Existing encounter rows and combatants are not deleted or migrated destructively. Legacy encounters have no instance row and retain flat maps. Loading a template copies its document into the encounter; no live reference is retained. Saving/renaming/duplicating/deleting a template never changes existing encounters. Explicit overwrites and deletion require confirmation and an expected template revision. Import/export extends encounter version 1 with optional dungeonMap; invalid map imports fail before any writes. Template endpoints require the campaign's DM, and template assignment verifies the same campaign under the command transaction.

## Tests

Pure tests cover bounds, canonical edges, door references, strict serialization, all edits, bounded history, generation determinism/connectivity/room separation and malformed imports. PostgreSQL integration tests use a DM and two players for permissions, cross-campaign template isolation, map copies, command broadcasts, revisions, reconnect/restart and undo isolation from combat. Browser tests exercise the real editor, generation preview/cancel/accept, player updates, camera continuity, and existing tracker flows. All existing tests, lint, frontend/backend type checks and production builds must pass.

## Delivered files and verification

The model/history lives in `shared/dungeon.ts`, generation in `shared/generator.ts`, and encounter integration/contracts in `shared/domain.ts`. `server/maps.ts` owns the authorised template library; `server/game.ts` persists instance documents/history under the existing command transaction; `server/app.ts` manages snapshot document omission and full recovery. Migration `003_dungeon_maps.sql` contains the additive tables. `src/DungeonScene.tsx` renders procedural instances and raycast surfaces; `src/DungeonBuilder.tsx` supplies editing/generation/library UI and a tool-properties side panel, reusing `BattleMap3D`. `App.jsx` and `Multiplayer.tsx` connect local and authoritative modes; mapState reconciliation reserves valid token positions before relocation.

Regression coverage extends shared model/generator/domain tests, PostgreSQL multiplayer integration, the existing application guard, and four real-browser flows. See [the development guide](dungeon-builder-development.md) for commands, test results, limitations, template semantics and the two-player walkthrough. No additional dependencies or environment variables were introduced.

One persistence regression found during integration testing is explicitly guarded: PostgreSQL JSONB key ordering must not be compared with `JSON.stringify`. Structural equality now ensures HP/token-only writes do not spuriously increment map revisions or clear map history.
