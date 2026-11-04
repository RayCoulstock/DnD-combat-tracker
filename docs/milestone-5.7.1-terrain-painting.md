# Milestone 5.7.1 — floor inspector repair and terrain painting

## Inspection and design, before implementation

### A: Root causes and repair

The inherited `.builder-tools fieldset` rule imposes `minmax(0,1fr) 210px` columns on every nested fieldset. Inside the 330px inspector, accordion/body/fieldset padding leaves the first column extremely narrow; labels and action groups become grid items in this inappropriate layout. FloorSurfacePanel does not carry the existing floor-image-panel overrides, and its preview uses a class whose sizing is scoped to that older panel. Number inputs inherit an 85px width; generic library styles need their own form sizing, but the existing Modal is already portalled to document.body and uses the browser top layer. The unbounded inline preview is distinct from that picker; no new anchored popover is needed. These are concrete CSS/layout causes; no production screenshot is attached in this turn.

Use a scoped single-column floor form with shrinkable children, full-width controls, a bounded thumbnail and wrapped action groups. Keep the existing native Modal picker in the top layer and explicitly reset its library form layout. Display saved/draft/saving/error states and the current texture's human name. Preserve retained accordion bodies and per-level drafts. A gets independent browser geometry/focus checks before B.

### B: Smallest compatible painting model

Add optional `terrainPaint` to existing per-level geometry. Store bounded ordered brush strokes rather than image binaries or one mesh per square: UUID, paint/erase, sampled east/south points, brush diameter in squares, opacity, softness, and (paint only) existing repeating texture configuration. Maximum 128 strokes per level, 256 points per stroke, four distinct texture/configuration layers. One gesture is one `map.terrain.stroke` command and one normal history step; clear is `map.terrain.clear`. Existing revision/conflict, projection, snapshot, template and import/export owners remain. No new database tables or storage migration are required.

Evaluate alternatives: full-resolution raster edits complicate persistence/history/network transfer; render targets introduce GPU readback/lifetime complexity; unbounded shader stroke arrays or per-square meshes scale poorly. Instead rasterize the compact stroke log deterministically into bounded CPU masks only after a committed stroke (or for a local draft gesture only as a cursor). Eight mask pixels per square gives at most 400×400 pixels per layer on a 50×50 map. Texture UVs remain independent of mask UVs and use the existing repetition/aspect helpers. Render at most four transparent mesh/material passes per floor, not one per dab/cell. Decoded colour images reuse existing cache/leases and floor-specific texture views; replaced masks/geometry/views are disposed.

Composite strokes in saved order. At each sample, painting alpha a attenuates all prior texture weights by 1-a and adds a to the chosen texture; erasing attenuates all terrain weights by 1-a, revealing the unchanged base (not resurrecting historical paint). Smooth radial falloff is controlled by softness; zero is an explicitly hard circular brush. Interpolate paths continuously in grid space; overlapping samples within one stroke form one coverage union so opacity is not accidentally multiplied by pointer event frequency. Convert final weights to alpha passes in fixed layer order so standard over blending reproduces those weights. Missing texture passes are transparent with a warning, revealing the base.

Mask references participate in the existing image deletion/history/template protections. Only visible current paint assets grant player downloads. New asset references are authorized inside the existing encounter transaction; missing/private imported references fall back safely. Hidden floors remain projected out. No image pixels or partial pointer-move state are broadcast. Mouse left/pen/single touch paint only while the terrain Floor tool is active; middle/right/modifier navigation, a second touch, cancellation or Escape cancels the gesture. Existing orbit/pan bindings and geometry tools remain.

Risks: CSS specificity and modal descendants; mask orientation versus north/south UVs; soft brush determinism; bounded history payload size; stale revisions and interrupted gestures; asset ownership/deletion races; active-floor cancellation; disposal and stacked-floor GPU cost. Tests must check these before rollout. No deployment is authorized.

## Implemented behavior and APIs

A: FloorSurfacePanel now displays a human texture name, bounded thumbnail and selected/draft/saving/saved/error indicators. Its labels, controls and action group explicitly override the legacy horizontal fieldset layout; no fixed inspector width or clipping patch is used. The existing Modal remains in the browser top layer, with Escape handling from search fields and explicit focus return. Image calibration retains its own unchanged controls. Per-level forms remain mounted across collapse and selection changes. TextureLibrary communicates the selected item with text/aria-pressed and outline.

B: Optional `terrainPaint: TerrainStroke[]` is attached to the same geometry shape as floorSurface/floorImage on primary and additional floors. Existing maps without it normalize unchanged. A stroke contains UUID, kind paint/erase, points in logical grid-square x/z coordinates, brush {size,opacity,softness}, and existing RepeatingTexture settings for paint only. No copied image bytes, new database tables or asset store are introduced. `map.terrain.stroke {stroke,levelId?}` and `map.terrain.clear {levelId?}` use existing map commands, revision checks, transactions, bounded history and synchronized snapshots. No custom combat or rendering synchronization protocol is added.

A continuous gesture is sampled to at most 256 points (long gestures are progressively resampled), rounded to .01 squares, and committed only on release. No GPU mask upload or network edit occurs on pointer movement: a projected circular cursor shows the current brush extent. Left mouse, pen and single touch use the same pointer path. Middle/right, modifiers, a second touch, pointer cancellation/lost capture, window blur or Escape cancel a pending gesture. Escape also preserves the existing Select shortcut. A new active floor changes tools/cancels the old interaction rather than moving a pending stroke to another level.

### Compositing and limits

Strokes composite in saved array order. One stroke computes the union of its interpolated swept circular brush; sampling density therefore does not multiply its opacity. Hard brushes use an explicit circular boundary. Soft brushes use a smoothstep radial falloff. Paint applies standard over weights to all existing paint and adds its weight to the selected texture. Erase attenuates every paint weight in its swept region and reveals the unchanged base, including its calibrated image if selected. Earlier historical paint is not resurrected by erasing; Undo restores history explicitly. Clear removes terrainPaint from that floor and is undoable.

Rendering keeps at most four distinct texture/configuration passes per floor. Final texture weights are converted to standard alpha-over passes so the saved ordering is reproduced even when colours overlap. Colour UVs use the existing grid-square/aspect/rotation calculation; independent normalized mask UV1 grows south to match CPU row order. Masks use linear non-colour data, no mipmaps, and clamp wrapping. They do not control texture repetition. Terrain planes sit above the base, below grid/picking, with depth writes disabled and fixed compositing order. Walls, doors, transitions, miniatures and elevations retain their current owners.

Limits: 128 strokes/floor; 256 sampled points/stroke; four distinct texture settings/floor; diameter .5–12 squares; opacity .05–1; softness 0–1. Eight mask pixels/square yields 240×240 on 30×30 and at most 400×400 on 50×50. Each mask is at most 640 KB RGBA; at most four passes/masks per floor. The whole map's serialized terrain budget is 300 KB. Validation rejects an over-budget edit atomically, preserving the last saved map. The existing history remains bounded to 20 frames / 2 MB. Masks are rasterized on committed changes, with incremental append reuse and deterministic replay for undo. Replacement views, masks and geometry are disposed; colour pixels reuse the existing bounded cache.

The four-layer count includes retained stroke configurations even if later erased; clear/rebuild terrain to use a different palette at the limit. Stroke-log download grants apply to references on visible current floors; history/template-only references protect deletion without granting player file access. Missing/unowned imported assets retain transparent terrain passes and visible fallback warnings; private files remain inaccessible. No image pixels are sent with a command. Ordinary encounter edits and player roles cannot mutate terrain.

### Assets and deployment

Mud, Sand and Shallow water join Stone/Wood/Grass as original locally bundled static CC0 illustrations; see public/textures/LICENSE.md. These are starter artwork, not animated water, procedural generation or rules automation. User uploads still use the existing image validation, normalization and owner-specific durable storage. Current terrain, undo/redo and templates participate in the existing reference/deletion protection.

No SQL migration is required beyond deployed Milestone 5.7. No map data is rewritten. Build packaging includes new starter PNGs through the existing Vite public directory. Back up the database and asset volume as usual. Older strict map readers cannot read new terrainPaint fields, so coordinate rollback using a compatible binary or untouched map copies. Nothing is deployed by this change.

## Manual acceptance

Warehouse (test copy): open This level → Floor Surface at desktop and 768px tablet width. Read every label, change repeat scale/rotation/tint, collapse/reopen with a draft, open/search/select/cancel the texture picker, press Escape and check focus return. Apply, save/reload and verify the original image calibration, walls, scenery, miniatures and elevation. Check Saved/Unsaved/Saving/Error feedback and reject an invalid scale without replacing saved values.

Outdoor: create a 30×30 grass base. D4 Floor tools → Paint terrain; This level → Terrain Painting → Mud. Drag a winding path, then change diameter/opacity/softness and add Sand or Stone. Compare soft edges with softness zero. Erase part of the path (base is revealed), undo/redo complete gestures, clear with confirmation and undo the clear. Try middle/right pan, Shift, Escape and two-finger navigation; none should create an unintended stroke. Reactivate Floor after Escape. Repeat on a rectangular map and a second elevated floor.

Export/import and save/reload a multiplayer encounter/template. Duplicate and remove/undo a floor; verify independent paint. Join and late-join as a player, reconnect and restart the test API; permitted materials persist and hidden-floor paint/media remain unavailable. Players cannot submit paint or clear commands. Test simultaneous DM revisions: a stale update must fail as one edit. Delete a referenced upload and expect refusal; import a missing UUID and expect base fallback/warning.

Test actual pen/touch hardware, supported non-Chromium browsers, screen readers, 200% zoom and reduced motion. Automated Chromium geometry/focus/pixel checks do not certify those devices. No production warehouse data was modified.

## Limitations and review boundaries

The outline previews the brush while dragging; texture changes appear on release. Masks have a fixed eight pixels per square, with linear filtering for smooth appearance; this is not a high-resolution image editor. There is no height sculpting, movement penalty, lighting, animated water, procedural terrain, LOS/fog or pathfinding. Texture repeat/rotation remain independent schema settings; this increment's brush UI exposes coverage/blending controls rather than advanced material editing. Existing large-map history limits still apply. Physical touch/pen and assistive-technology acceptance remains manual.

A can be reviewed through the form/CSS/Modal/TextureLibrary changes and its dedicated layout test. B adds shared terrain/schema commands, reference validation, cached masks and pointer gestures plus the C3 panel/D4 flyout. No changes to the GLB loader or combat creation/order systems are required.

## Validation — 4 November 2026

| Check | Result |
|---|---|
| `npm test` | 137 passed; 3 existing infrastructure checks skipped by their environment guards |
| `npm run test:integration` with disposable PostgreSQL | All 95 passed |
| Focused terrain database/socket suite after adding hidden-only grant assertions | All 7 passed |
| Focused terrain/mask unit suite including aggregate payload budget | All 7 passed |
| Dedicated A inspector test | Passed at 1600/1280/768px; label/control geometry, modal selection, search/Escape, focus, draft retention and 40px Floor flyout target |
| Dedicated B browser cases | Passed; actual Mud-over-Grass and Sand-over-Water pixels, continuous gestures, hard/soft/opacity controls, erase/history, clear/undo, navigation/Escape guards, missing media, import/export, retained canvas and bounded GPU textures |
| Shared modal/stacking/nested Escape focused regression | All 4 selected cases passed |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- --reporter=line` | All **35 passed**, 14.1 minutes, serial Chromium |
| `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check` | Passed; build retains the existing large-bundle advisory |

The final full browser run completed against frozen source and fresh disposable API rate-limit state. Original timeouts, authorization, production limits and domain assertions remain intact. New browser cases use local mode, so they add no authentication attempts to the existing suite. The full regression retains existing campaign/combat/group libraries, calibrated images, multi-floor transitions, fullscreen, GLB scenery/miniatures, permissions, multiplayer and design-system checks.

The new server coverage additionally verifies one committed revision per stroke, explicit asset ownership, hidden-only media denial before reveal, current-grant revocation on clear, history/template deletion protection, independent elevated copies, stale revision rejection, late join, reconnect, backend restart and unresolved imported media. Shared/resource tests verify compositing weights, sampling-density independence, 50×50 masks/replay and balanced mask disposal. Physical touch/pen, assistive technology and non-Chromium acceptance remain manual.

[Visual review captures](ui/milestone-5.7.1-baseline/README.md) document the repaired form and top-layer picker; they were visually inspected. No production campaign data was accessed or modified.

### Review file groups

- A: `src/FloorSurfacePanel.tsx`, `src/floor-surfaces.css`, `src/TextureLibrary.tsx`, `src/Modal.tsx`, `e2e/floor-inspector.spec.ts` and visual captures. These repair inherited layout, readable names, explicit states, selection, touch targets and focus without changing base surface persistence.
- B model/commands: `shared/terrain.ts`, `shared/dungeon.ts`, `server/game.ts`, `server/floor-image-references.ts`. These extend existing JSON/history and asset validation rather than introducing another persistence engine.
- B rendering/input/UI: `src/TerrainLayer3D.tsx`, `src/terrainResources.ts`, `src/TerrainBrushSurface.tsx`, `src/TerrainPaintingPanel.tsx`, plus the adapters in BattleMap3D, DungeonScene and DungeonBuilder. Save feedback appears in Terrain Painting, and new strokes are disabled while an encounter update is pending.
- B assets/tests: new Mud/Sand/Water PNGs and the existing CC0 license; `shared/terrain.test.ts`, `server/terrain-resources.test.ts`, `server/tests/terrain-painting.test.ts`, `e2e/terrain-painting.spec.ts`. UI guidelines, audit, migration plan and feature matrix record actual ownership.

Changes remain uncommitted for review on `feature/milestone-5-7-1-terrain-painting`; no automatic deployment occurred.
