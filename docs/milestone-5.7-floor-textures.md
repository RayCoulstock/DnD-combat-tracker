# Milestone 5.7 — repeating floor textures

## Inspection and proposed model (before implementation)

The existing LevelScene renders the base plane, calibrated FloorImage3D, grid, DungeonScene painted tiles/walls/props and interaction surface inside the existing level elevation group. Image UVs already use east/south grid coordinates and are independent of map-camera state. dungeonLevels/levelDocument/composeLevels own legacy and additional-level adapters; editMap owns bounded undo/redo. Server image references cover current documents, history and templates, and authorize live player downloads only through visible referenced floors. GLBs use a separate shared resource cache; no GLB changes are needed.

Add optional `floorSurface` to the existing geometry shape, shared by every level: mode solid/image/texture, optional solidColor, and retained optional texture configuration (assetId, repeatEverySquares, quarter-turn rotation, brightness, tint and square-based UV offsets). Absence infers the existing image when configured, otherwise existing procedural solid/painted floors. Inactive image calibration remains in the existing `floorImage`; inactive texture settings remain in floorSurface.texture. Surface commands never change geometry, dimensions, elevation or grid size. Optional appearance fields extend existing map versions without rewriting legacy documents or changing their geometry-version semantics. Existing strict import normalization validates the new fields.

Use the existing floor_images records, immutable normalized WebP binaries, owner/hash deduplication, validation worker, limits, storage/recovery and reference tables. Migration 013 adds a name and asset-kind flag; texture management is a category within the existing Asset Library, not another binary service. Existing image clients retain their response fields. Texture references, including inactive configurations, participate in deletion/history/template protection. Only active visible references authorize player media access. Built-ins are project-authored local raster illustrations with stable `builtin:stone`, `builtin:wood`, `builtin:grass` identifiers and documented licensing; there is no runtime texture generation or external download.

For an image aspect ratio a=width/height, one tile spans repeatEverySquares east and repeatEverySquares/a south before rotation. Transform grid coordinates by inverse clockwise rotation about the northwest origin, then divide by these spans. This preserves pixel aspect on rectangular maps and after resizing. UV offsets are grid-square offsets. RepeatWrapping handles values beyond [0,1]. Colour textures use sRGB and an unlit material; tint/brightness multiply linear material colour. Cache decoded pixels by authorized URL/GPU limit; floor-owned texture views and UV geometry avoid modifying shared texture state. Dispose each view and geometry on replacement/unmount; release the bounded cache lease after GPU cleanup. No renderer/camera/fullscreen lifecycle change.

Risks: inactive assets must remain deletion-protected without authorizing player downloads; missing/unowned imported references must fall back without disclosing another DM's assets; aspect-aware quarter turns must not swap map dimensions; changing material cannot reset editor/scene state; migration must precede API rollout. No deployment is authorized.

## Implemented model and API

`floorSurface` is optional on primary and additional level geometry. Its mode is solid/image/texture; optional solidColor is a six-digit hex override. Absence preserves legacy painted/procedural terrain. `texture` holds a stable UUID or allowlisted built-in ID, repeatEverySquares (.25–50, default 2), clockwise rotation (0/90/180/270), brightness (.1–2), hex tint, and offsetX/offsetZ (±100 grid squares). A texture-mode surface requires texture settings. Inactive image and texture records are retained; switching materials never resizes floors. Uniform solid colour and textures overlay the same level surface used by calibrated images, without changing logical floor cells.

`map.floorSurface.set {surface, levelId?}` uses the existing authorized map command, revision, transaction, broadcast and bounded undo/redo pipeline. `map.floorImage.set` retains its existing behavior; if an explicit surface is present, applying/removing an image selects image/solid respectively. The explicit Remove image action deletes calibration; mode switching does not. Floor duplication copies surface settings; deleting a floor does not delete shared media.

Migration **013_floor_textures.sql** adds `floor_images.name` and `kind` (`battle-map` by default; `texture` for reusable tiles). No map/database geometry rewrite is necessary. Existing image uploads and responses retain their fields.

- `GET /api/floor-images`: DM-owned ready images with name, kind and distinct encounter/history/template reference count. Texture management filters kind; it never requests GLB binaries.
- `POST /api/floor-images`: existing multipart file + metadata; optional name and kind. Existing size/pixel/dimension/time/concurrency limits apply. PNG/JPEG/WebP signatures are checked, decoded in the existing worker and re-encoded as metadata-free WebP. Supported image MIME types and generic octet-stream fallback are accepted; signature/decode validation remains authoritative. SVG/animation/path names/oversize/invalid images are rejected. Content hashes deduplicate normalized bytes per owner; uploading existing pixels as a texture promotes the metadata without duplicating the file or changing its ID.
- `POST /api/floor-images/:id/metadata {name,revision}`: owner-DM rename with optimistic revision, no reference changes.
- Existing `/:id/file` and `/:id/delete` retain scoped delivery/recovery/deletion semantics. Active visible image/texture references grant players media access; inactive/history/hidden references protect deletion without granting delivery. Players cannot list, rename, upload or delete texture assets. Imported missing/private IDs remain unresolved and cannot authorize a file download.

Built-ins are `/textures/stone.png`, `/textures/wood.png`, `/textures/grass.png` with stable schema identifiers, available without sign-in. [Licensing](../public/textures/LICENSE.md) records the original CC0 illustrations. Upload a licensed seamless PNG/JPEG/WebP for a more detailed custom style; no arbitrary external art or runtime procedural generation is used.

## Rendering and lifecycle

A 30×30 floor with a square tile and repeatEverySquares=2 has 15 repetitions per axis. A rectangular image preserves its aspect: a 2:1 image repeats every two squares east and one south before rotation. Rectangular floors only change total repetitions. Inverse clockwise rotation is applied to logical east/south coordinates about the northwest origin; the floor's size is never swapped. Grid-size-in-feet changes do not change the physical world square or texture count. Offsets are supported by the schema/UV calculation but are not exposed as additional inspector controls.

The renderer uses the existing decoded-image cache (four idle entries / 96 MiB, GPU-aware downsampling up to 4096 pixels). Texture views share decoded source pixels and retain sRGB; each floor owns its wrap/view state and UV geometry. The existing linear filter without mipmaps avoids cross-tile mip bleeding; source artwork still needs seamless edges. Materials are unlit and persistent across render frames; brightness/tint multiply linear colour. Replaced views/geometry are disposed and cache leases released on unmount; the cache closes idle/evicted ImageBitmaps. Active scenes retain their leased resources. Renderer identity, camera, interaction plane, grid, walls/doors/props and level elevation groups stay owned by the existing map.

The inspector retains per-level surface drafts while switching floors or editing other geometry. If another committed surface arrives, an unchanged form follows it; a differing draft is retained with an explicit reload/apply message. Image calibration forms are keyed to image/dimensions rather than unrelated wall edits. Missing or denied textures display the existing solid/painted floor plus an actionable warning and Retry; failures do not remove geometry or block map/combat interaction.

## Migration and deployment

Run the normal migration runner before starting the new API (`npm run db:migrate`, or the existing production migration command in the release workflow). Normal build packaging includes migration 013 and Vite bundles public starter assets. Back up the database and durable ASSET_STORAGE_DIR with existing procedures; texture binaries share that storage. No files are stored in encounter JSON, no new bucket/volume is required, and no deployment is part of this work. Older application binaries use strict schemas and cannot read new surface fields; coordinate rollback rather than dropping metadata or rewriting maps.

## Manual acceptance — Durran's Warehouse

1. Use a test copy of the warehouse. Confirm the original solid/painted floor or calibrated image, walls, doors, scenery and miniatures look unchanged. Record image calibration.
2. In This level → Floor Surface choose Repeating texture, Stone and repeat every 2 squares; Apply. Count expected tiles on a known rectangular area, with grid visible. Pan/zoom/select/move without drift.
3. Choose the upper office and Wood. Apply 90°/180°/270° rotations, brightness and tint; confirm elevation and GLB grounding remain unchanged. Use stacked view to compare independent floors.
4. Return ground to image mode; Apply and compare original calibration. Return to texture and verify previous scale/rotation/tint are retained. Try solid colour and Reload/reset; explicit Apply should be required.
5. Leave a repeat-scale draft, switch floors and return; retain the draft. Change a wall/HP/selection and verify the draft remains. Exercise Undo/Redo, duplicate/remove/restore a floor, save/load a template and export/import the encounter.
6. Save/reload, expand/native fullscreen and restore; verify camera/floor/editor state, textures, transitions, objects and models. Join and late-join as a player; check permitted materials and hidden floors/media. Players must have no editing or private library operations.
7. In Asset Library → Floor Textures, search/filter starters/uploads; upload a licensed PNG/JPEG/WebP, preview/select it, rename and reuse on another map. Attempt deletion while referenced (including inactive/history/template references); expect a clear refusal. Delete an unreferenced test upload successfully.
8. Simulate missing storage/asset or import a missing UUID; expect solid fallback, warning and recoverable Retry. Restore storage/restart API and confirm persisted references resolve.
9. Test 1280px laptop and 768px tablet, keyboard-only picker/forms, Escape/focus return, text zoom/reduced motion and real touch. Check colour contrast and a screen reader in supported browsers; automated Chromium is not a substitute for physical device/assistive-technology checks.

## Modified components and limitations

Shared floor-surface validation/UV helpers extend dungeon geometry and commands. Server image routes/multipart validation/reference sync and migration 013 extend the existing media service. FloorSurface3D/resource helpers add a retained overlay; BattleMap3D selects existing/new appearance modes. FloorSurfacePanel, TextureLibrary, DungeonBuilder and AssetLibrary integrate C3/E4/A3 with existing design components. Shared/resource/database/socket/browser tests and the feature-zone documentation record the new contracts.

Starter illustrations are intentionally simple; no normal maps/PBR/lighting, painted regional textures, terrain penalties or animated/procedural materials are included. Source assets must be tileable for invisible seams. UV offsets are import/API-supported only. Reference counts identify usage volume, not a new map-navigation browser. GPU capacity still bounds very large stacked scenes; active resource leases are not evicted while visible. Production campaign data and physical-device/cross-browser acceptance remain untouched.

## Automated verification — 4 November 2026

| Check | Result |
|---|---|
| `npm test` | 130 passed; 3 existing infrastructure checks skipped by environment guards |
| `npm run test:integration` with disposable PostgreSQL | All 88 passed |
| Focused calibrated-image/texture and stacked-floor browser workflows | Both passed; the D4 Image entry point also passed its focused check |
| Existing multi-level/transition/fullscreen browser regression | Passed with the original timeout and domain assertions |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- --reporter=line` | All **32 passed**, 12.4 minutes, serial Chromium |
| `npm run lint`, `npm run typecheck` | Passed |
| `npm run build` | Passed; existing large-bundle advisory remains |
| Migration/public asset packaging | Built server includes migration 013; built client includes all three PNGs and licensing |
| `git diff --check` | Passed |

The final full browser run completed after reconnecting the execution environment. Earlier interrupted runs are not counted as successes. Inspector test helpers were updated to select the active visible floor's nested image controls, including vertical-navigation acceptance; no production rate limit, timeout or domain assertion was weakened. No authentication fixture was added for the custom-texture workflow; it reuses the existing DM/player floor-image fixture. The additional stacked-floor case uses local mode without authentication.

New shared/resource tests cover square/aspect UV math, quarter turns, offsets, bounded settings, legacy appearance, mode/history preservation, independent level copies/projection, inactive references, sRGB and independent texture views, tint/brightness and repeated lease/disposal behavior. Database/socket tests cover named uploads, validation and permissions, references/deletion, rename, calibration, committed revisions, hidden/elevated levels, reuse across maps, export/import, late join/reconnect/restart and missing media. Browser coverage checks actual material UVs/colour, starter selection, shared fetches, retained canvas/drafts, custom upload/rename/deletion refusal, tablet reload and recoverable HTTP texture failure. The full suite retains existing GLB, image, combat, campaign, group preset, multiplayer, responsive and focus regressions.

### Changed file groups

| Files | Responsibility |
|---|---|
| `shared/floor-surface.ts`, `shared/dungeon.ts` | Strict material model, UV calculation and existing map commands/normalization |
| `server/migrations/013_floor_textures.sql`, `server/floor-images.ts`, `server/asset-upload.ts` | Additive asset metadata, named texture management and MIME/signature-safe upload reuse |
| `server/floor-image-references.ts`, `server/game.ts` | Inactive/history/template protection and authoritative asset validation |
| `src/FloorSurface3D.tsx`, `src/repeatingTextureResources.ts`, `src/floorImageResources.ts`, `src/BattleMap3D.tsx` | Shared image decoding, independent repeated views, resource lifetime and retained scene integration |
| `src/FloorSurfacePanel.tsx`, `src/TextureLibrary.tsx`, `src/floor-surfaces.css`, `src/DungeonBuilder.tsx`, `src/AssetLibrary.tsx` | C3 surface controls, E4 picker, A3 asset category and retained per-level forms |
| `public/textures/*` | Three original static starter tiles and licensing |
| `shared/floor-surface.test.ts`, `server/floor-texture-resources.test.ts`, `server/tests/floor-textures.test.ts` | Model/render-resource/database/socket regression coverage |
| `e2e/floor-textures.ts`, `e2e/floor-texture-levels.spec.ts`, `e2e/floor-images.spec.ts`, `e2e/workspace-helpers.ts`, `e2e/vertical-navigation-acceptance.ts` | Texture, compatibility, tablet, stacked-floor and active-inspector browser coverage |
| `docs/ui/*` updates and this report | Actual feature zones, design decisions, migration and acceptance |

Changes remain suitable for an independent feature PR. Nothing was deployed and no production campaign data was changed.
