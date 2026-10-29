# Multi-level battle maps (Milestone 5.3)

## Data and compatibility

Map document version 5 adds `level` metadata to the existing primary geometry
and `levels` for additional level documents. This keeps `floors` meaning painted
cells, preserves all existing geometry and asset IDs, and avoids duplicating the
primary floor's geometry. For example:

```json
{
  "schemaVersion": 5,
  "id": "keep-map",
  "name": "The Keep",
  "level": {
    "id": "ground",
    "name": "Ground Floor",
    "elevationFeet": 0,
    "playerVisible": true
  },
  "width": 20,
  "height": 20,
  "theme": "stone-dungeon",
  "floors": [], "walls": [], "doors": [], "props": [],
  "levels": [{
    "id": "cellar",
    "name": "Cellar",
    "elevationFeet": -10,
    "playerVisible": false,
    "width": 16, "height": 16,
    "theme": "stone-dungeon",
    "floors": [], "walls": [], "doors": [], "props": []
  }]
}
```

Each geometry owner can also have the existing `floorImage` configuration.
Existing v1–v4 documents remain valid, without rewriting stored JSON. The shared
`dungeonLevels` boundary adapter presents them as one `ground` level named Ground
Floor, elevation 0, visible to players. Its views are cached by document identity;
rendering does not run a migration or repeatedly parse the map. Level management
or a scoped edit upgrades the document to v5. Existing image calibration, scenery,
architectural models and combatant X/Z coordinates survive this conversion.

The primary level ID is `level.id`, not the map ID. Removing the primary level
promotes another geometry owner without changing that owner's stable level ID or
the map's identity/name. Array position and elevation sort order are not IDs.

Limits: at most 12 levels, each 4–50 squares per side, elevation -1000 to +1000
feet. The existing per-level geometry/asset limits apply. Level surfaces must be
at least 0.1 feet apart to prevent coincident surfaces. Newly created/duplicated
levels default to hidden from players. Duplicated door and prop IDs are generated
from the new level identity; canonical wall IDs stay level-local edge keys, so a
wall's complete identity is `(levelId, wallId)`. Door wall references remain valid.
Duplication shares uploaded image/GLB references, not the mutable placements.

## Coordinates, editing and rendering

All floors share a north-west grid origin: X increases east and Z increases south.
A square remains one scene unit / five D&D feet. Absolute floor elevation converts
with `elevationFeet / 5`, including negative elevations. A level group translates
its native geometry, image, combatants and tactical overlays together. Different
level dimensions do not shift the common grid origin. Model `verticalOffset`
remains relative to its owning floor; scale/rotation retain their existing meaning.
The existing configurable ruler/grid readout is preserved; it does not rescale
scene geometry or change the elevation conversion.

There is one Canvas, camera and renderer. The active level has the editor surface;
other stacked levels are display only. The canvas event filter discards raycast
intersections belonging to inactive level groups, including meshes that otherwise
stop propagation. Hidden levels are unmounted. Drawing and painting convert world
intersections back into the owning group's coordinates. Depth testing and the
Milestone 5.2 image/procedural/grid vertical separation remain in use.

The Dungeon Levels inspector provides create, rename, elevation, duplicate,
confirmed delete, local visibility and shared player visibility. Single-floor and
stacked controls also appear on the battlefield. Selection, view mode and locally
hidden IDs are browser component state; changing them sends no commands or
multiplayer broadcasts. Players have the same local viewing choices over the
subset revealed to them, without DM editing controls.

Geometry changes are committed using the existing command/revision transaction.
Scoped geometry commands carry `levelId`; omitted IDs target the primary level for
backwards compatibility. Whole-map load/generate/blank operations still replace
the entire map, as their existing confirmation describes. Editing a selected level
does not implicitly replace the map. Image calibration panels retain local drafts
while switching levels; selected scenery/architecture property drafts are retained
for the same map revision. A committed edit or load can invalidate related drafts.
The Generate dungeon control remains a whole-map replacement tool.

## Combatants and history

Combatants store optional `floorId` in their existing JSON data. Missing IDs default
to the legacy ground/primary level. New combatants use the DM's most recently active
editing level. The DM's map roster offers transfer with a destination level and
zero-based X/Z square. Transfer changes only ownership of space and coordinates;
HP, initiative, conditions, miniature settings and player ownership stay intact.
Players can move their owned visible tokens within a revealed level, never transfer
between floors. Ordinary movement preserves floor ownership.

An occupied floor cannot be deleted. Transfer or remove its combatants first.
Undoing creation of an occupied floor, or shrinking a floor around out-of-bounds
tokens, is also rejected. Transfer is a combat action outside map geometry history;
undoing a map edit never rewinds HP or silently transfers tokens. Importing a file
with an unknown combatant floor ID fails atomically; loading a replacement map
reassigns combatants whose former floor no longer exists to the new primary floor
and uses the existing deterministic in-bounds reconciliation.

The existing bounded history (20 frames / 2 MB) includes the complete map document.
Add/update/duplicate/delete and floor-specific edits each commit one frame. Undo
can restore deleted geometry and references. Images and GLBs referenced by any
current floor, history frame or saved template retain their existing protected
storage references. Deleting a floor never deletes shared uploaded files.

## Multiplayer and security

The server keeps the full map for the DM. Player snapshots, including joins,
reconnects and HTTP snapshots, contain only player-visible levels and their visible
scenery/combatants/overlays. If the primary floor is hidden, a visible level is
promoted in the projected document, preserving its ID. No hidden level names,
geometry, image references or combatant IDs are sent. If all levels are hidden,
the player sees a waiting message with an empty scene.

Current image and scenery download grants are derived from player-visible levels;
history-only and hidden references retain files without granting player access.
Miniature and private artwork downloads additionally check the role-projected
combatants, closing the hidden-floor path through an otherwise visible token.
A shared asset used on a revealed level remains downloadable there. As before,
hiding content cannot erase bytes already delivered to a participant's browser.
Ownership, CSRF, campaign membership, session-active checks and revision conflicts
use the existing infrastructure. No binary data enters Socket.IO payloads.

Tactical records also carry floor IDs. Existing records default to ground; new
rulers/templates bind to the selected level and hidden-floor records are filtered
server-side. Deleting a floor leaves these records undisplayed so undo can restore
their context; the existing clear/expiry behavior remains available.

## Resource handling and performance

The shared GLB and image caches remain unchanged. Multiple floor placements share
fetch/parse resources, with independent model clones and native group transforms.
Unchanged level views and geometry arrays are reused across network map revisions;
combat-only snapshots retain the map reference. The floor renderer memoizes
procedural geometry from its relevant arrays/dimensions. Unmounting hidden/deleted
levels releases leases and per-placement resources through the existing disposal
paths. The caches retain only their existing bounded idle resources. No additional
rendering or storage dependency is introduced.

## Migration and deployment

Apply `server/migrations/009_dungeon_levels.sql` using the normal migration job
before starting the new server. It only broadens `schema_version` checks in
`encounter_maps` and `map_templates` to accept 5. No existing map, combatant, image,
file path or identifier is rewritten. No new configuration or storage volume is
required; use the same persistent database and private asset volume as 5.2.

Back up the database and asset volume together before deployment. Stop/replace the
old backend and update browser assets together: mixed old/new writers are not
supported. Clients reconnect for a full snapshot. Older application versions cannot
read v5 documents. Rollback after creating v5 maps requires restoring the matching
pre-upgrade database backup (and asset backup where necessary); do not downgrade
schema constraints or strip level JSON from live documents. This work does not
deploy production automatically.

## Manual acceptance

1. Load a pre-5.3 encounter with an uploaded floor image, walls/doors, scenery and
   combatants. Check all coordinates and image calibration against its original.
2. In Dungeon Levels create a cellar at -10 feet and tower at +10, with different
   grid dimensions. Verify only ground is initially revealed to players.
3. Place walls, a door, an image and GLB scenery on each floor. Use scale 2,
   rotation 45 degrees and vertical offset 1.25. Verify these stay floor-relative.
4. Start an image calibration draft, switch away and back, then preview and apply.
   Repeat with selected scenery/architecture property values. Check other floors.
5. Enable stacked view and edit the cellar through overlapping display-only
   geometry. Hide/show floors locally and verify selection only targets the active
   visible floor. Check negative elevations, top-down, pan, zoom and reset camera.
6. Transfer one combatant to each floor using the map roster. Verify combat stats,
   player ownership and coordinates. Attempt deleting an occupied floor; verify
   the helpful error. Move its combatant away, delete, undo and redo.
7. Reveal the tower to two players; keep cellar hidden. Check token rosters, image
   rendering and each player's local floor choice. Refresh/rejoin a player. Hide
   all floors and check the waiting scene. Inspect player snapshot/download APIs
   for omitted hidden data and denied hidden-only assets.
8. Rename, change elevation, duplicate and delete an unoccupied floor. Verify
   duplicate placement IDs differ, image/GLB IDs are shared and history restores
   the correct floor. Save/reload a template and export/import an encounter.
9. Reload the browser/restart the backend and check all map/placement/token floor
   IDs and image calibration. Repeat a stale edit from another DM tab; verify the
   existing revision conflict handling.
10. On a tablet-sized viewport check inspector, floor selector and transfer controls.
    Exercise a missing GLB/image and its existing retry without losing the map.

## Automated coverage and limitations

`shared/levels.test.ts` covers legacy images/positions, scoped edits, duplication,
elevations, deletion/history, combatants, bounds, projections, round trips and
geometry reuse. `server/tests/floor-images.test.ts` adds real database/Socket.IO
three-level coverage, file authorization, template/reference retention and late
joins. `e2e/levels.spec.ts` drives three populated levels in real WebGL, including
calibration drafts, overlapping edits, transfers, shared visibility, save/export
and reload. Run these alongside the complete existing suites, lint, typecheck and
production build.

Ghosted stacked floors are not implemented. Stacked floors use ordinary depth
occlusion; use single-floor mode or local visibility to inspect covered rooms.
There is no automatic traversal, vertical pathfinding, cutaway, fog or lighting.
The active/local view resets on a fresh workspace mount and is intentionally not
shared or persisted with the map. History remains subject to the existing bounded
retention. Physical tablet/GPU performance needs manual acceptance; automated
WebGL uses Chromium software rendering.

## Changed areas

- `shared/dungeon.ts`: version 5 schema, cached level adapter, scoped map commands,
  duplication, geometry reuse and existing history integration.
- `shared/domain.ts`, `shared/tactical.ts`: combatant/overlay floor associations,
  transfers, bounds, imports and role-specific projections.
- `server/game.ts`, `server/scenery.ts`, `server/floor-image-references.ts`: durable
  per-level references and visible-only current asset grants.
- `server/assets.ts`, `server/app.ts`: hidden miniature/artwork download checks;
  `server/migrations/009_dungeon_levels.sql`: additive version checks.
- `src/DungeonLevelsPanel.tsx`, `src/DungeonBuilder.tsx`, `src/FloorImagePanel.tsx`:
  management, scoped tools, local view state and calibration drafts.
- `src/BattleMap3D.tsx`, `src/DungeonScene.tsx`, `src/DrawingSurface.tsx`,
  `src/TacticalScene.tsx`, `src/SharedModel3D.tsx`: grouped elevation, filtered
  selection, native transforms and diagnostics.
- `src/App.jsx`, `src/Multiplayer.tsx`, property panels, tactical hooks and editor
  CSS: active-level additions, player waiting view and retained property drafts.
- `shared/levels.test.ts`, the floor-image integration tests, and
  `e2e/levels.spec.ts`: focused regression coverage.

## Validation results

Validated on 29 October 2026:

- `npm test`: 94 passed, 3 existing infrastructure skips (Caddy availability and
  PowerShell); no failures.
- Full PostgreSQL/Socket.IO integration suite: 58 passed. The focused seven-test
  image/levels suite was also rerun with a real backend restart after creating
  the multi-level map; all passed.
- Full Playwright suite against the compiled backend: 17 passed (5.3 minutes),
  including positive/negative elevation, independent model transforms, token
  elevation, overlapping floor selection, draft retention, player hiding,
  all-hidden waiting scene, templates, export and reload.
- `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- The existing frontend bundle-size warning remains. Physical tablet/GPU testing
  and optional ghost rendering remain outside this automated validation.

No production deployment was performed.
