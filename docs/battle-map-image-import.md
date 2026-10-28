# Milestone 5.2: battle map floor images

The existing dungeon editor renders a private uploaded image beneath its walls,
doors, procedural props, GLB scenery, combatants and tactical grid. The Floor Image
section lives in the existing inspector. There is no new editor, renderer, floor
level, lighting system or binary realtime channel.

## Use and calibration

1. As the DM, select an encounter and open Map editor. Create or load a dungeon map.
2. Expand **Floor Image**, choose or drop one PNG, JPEG or WebP, and wait for upload
   and processing. The sidebar previews the processed image. An upload does not
   change the shared map until **Apply floor image**.
3. Select **Gridded image** to initially hide the application grid, or **Gridless
   image** to show it. The grid checkbox can override that choice.
4. Set map width/height (4–50 squares). These are map dimensions, not image pixels.
   Each square retains its existing world-space size and the usual five-foot
   tactical convention. Existing configured feet-per-square values are preserved.
5. Choose **Fit inside (letterbox)** or **Fill map (crop)**. Both preserve aspect
   ratio. Centre and top-left alignment are available. Positive horizontal offset
   moves east/right; positive vertical offset moves south/down. Offsets and scale
   have 0.01 adjustment steps. Rotation is clockwise in 90-degree increments.
6. **Preview calibration** shows a DM-only local preview. Canvas object editing
   pauses during preview; camera inspection remains available. **Apply floor image**
   commits one revision; **Cancel calibration** restores the saved appearance.
   Edits from another tab/session or switching maps cancel the local preview.
7. Lock image transformations to disable dimension, position, scale, fit, alignment,
   rotation and reset controls. Opacity and grid visibility remain editable.
   Lock changes are saved with Apply. The floor has no canvas drag handles, so wall
   and scenery interactions cannot accidentally drag it even while unlocked.
8. Remove the image to restore the existing procedural floor. This removes the map
   reference, not the stored file. Undo/redo restores replacement, removal,
   calibration, opacity, locking and grid-overlay settings.

Shrinking a map is rejected when it would invalidate wall/prop anchors or relocate
combatants. Undo/redo of image-map resizing also refuses to relocate combatants
that have since moved outside the restored bounds. Coordinates do not rescale to match the image. Painted procedural floor
cells are retained underneath the image and remain visible through transparent
pixels, partial opacity and letterboxing. The image uses an unlit, depth-tested
Three material to preserve its colours; existing object rendering is unchanged.

## Map and multiplayer architecture

`shared/floor-image.ts` defines a strict, bounded metadata schema and a pure UV
mapping function. Map schema 4 adds optional `floorImage` metadata; versions 1–3
remain accepted unchanged. Subsequent wall/scenery operations preserve version 4.
The map contains an opaque image UUID and calibration settings, never image bytes,
file paths, external URLs or base64 data.

`map.floorImage.set` is an ordinary DM-only map edit. It carries dimensions and
optional floor-image metadata through the existing command envelope, optimistic
encounter revision checks, map revision, bounded undo/redo frames, persistence and
snapshot broadcasts. A form submit commits one edit, not each keystroke. The
existing map-template endpoints and encounter JSON export/import need no new
request shape. Imported references that are unavailable to this DM remain safe
placeholders, consistent with existing GLB imports, and confer no download grants.

`FloorImage3D` renders a native Three plane at y=-0.002, above procedural floor tops
at y=-0.005 and beneath the tactical grid at y=0.012. World x/z, token centres and
wall edges remain unchanged. UV clipping gives predictable contain/cover behavior
without stretched edge pixels. The image cannot intercept map raycasts. Correct
bitmap orientation and quarter-turn rotation are tested with asymmetric corner
colours read from the rendered WebGL canvas.

`floorImageResources.ts` reuses the lease-based asset cache, partitioned by actor,
campaign/encounter, image ID and GPU texture limit. Calibrating or editing unrelated
map properties does not download the image again. Downloads use session cookies;
players may fetch only the current image of an active encounter in a campaign they
belong to. Undo-history and template references protect files from deletion but do
not grant player download access. The existing session/revocation rules still apply.
No floor-image editor controls are rendered for players.

Textures decode asynchronously with `createImageBitmap`, use sRGB colour and a
4096-pixel maximum, and downsample again when the device reports a smaller GPU
limit. Idle textures are retained briefly within the existing cache policy; obsolete
bitmaps, textures, geometry and materials are released. Failed loads retain the
procedural floor and expose an error and retry button. Modern browser support for
WebP, WebGL and `createImageBitmap` is required.

## Storage, validation and lifecycle

Images use the same `ASSET_STORAGE_DIR` and private storage adapter as GLBs, with
server-generated owner/sha256 `.webp` keys. Existing `.glb` keys and IDs are unchanged.
The multipart parser is shared with GLB uploads and enforces byte, field, part,
filename and interruption limits. Client MIME declarations are not trusted.

Sharp is the new server-only image-processing dependency. Signature checks exclude
SVG, GIF and arbitrary payloads before decoding. A separate bounded worker inspects
actual format, dimensions, decoded pixel count and animation, decodes the complete
image, corrects EXIF orientation, resizes without aspect distortion, strips metadata
and re-encodes WebP at quality 90. Animated WebP and APNG are rejected. The native
operation and worker have time limits; concurrency is limited to two processing
jobs and one per DM. Only processed pixels are published. Original files are not
retained. Same-owner duplicate uploads return the existing ready record.

Migration `008_floor_images.sql` adds image records and encounter/template reference
tables, and extends map-version constraints to include 4. Reference publication and
map edits are transactional, lock image records in stable order, and prevent racing
asset deletion. References include current maps and both undo/redo stacks. Template
save, overwrite, duplicate and delete retain/release image references. Startup
recovers processing/deleting records. Stale staging cleanup continues to use the
existing storage recovery mechanism.

The DM's **Uploaded floor images** selector lists the latest 100 ready uploads.
**Delete unreferenced image** deletes storage only when no encounter, history or
template references it. Removal/replacement alone never deletes shared storage.
Unused uploads are intentionally retained for reuse; no automatic garbage collector
or account storage quota is introduced in this milestone.

## Configuration and deployment

Defaults and hard maximums:

| Variable | Default | Hard maximum | Purpose |
| --- | ---: | ---: | --- |
| `FLOOR_IMAGE_MAX_BYTES` | 15 MiB | 25 MiB | Original and processed file byte cap |
| `FLOOR_IMAGE_MAX_DIMENSION` | 8192 | 16384 | Input width or height in pixels |
| `FLOOR_IMAGE_MAX_PIXELS` | 33,554,432 | 67,108,864 | Total decoded input pixels |
| `FLOOR_IMAGE_TEXTURE_DIMENSION` | 4096 | 4096 | Longest output side, never enlarged |
| `FLOOR_IMAGE_TIMEOUT_MS` | 20,000 | 30,000 | Processing worker deadline |

Values must be positive integers within their hard maximums. Raising input limits
increases decode memory/CPU; it does not raise the output GPU dimension limit.
Both Compose configurations and environment examples expose these variables.
The default reverse-proxy 32 MiB request limit accommodates image uploads; retain
multipart overhead when customizing proxy limits.

Deployment is manual. Build/install from the updated lockfile so Sharp and its
platform-specific native dependencies are available in the production image.
Apply the additive migration with the existing migration job before starting the
new backend; startup already refuses pending migrations. Use the existing durable
asset volume at `/var/lib/encounter-ledger/assets`, never an ephemeral app directory.
No new volume, port, external service or CDN is required.

Back up PostgreSQL and the asset volume together using the existing backup process.
The restore audit now checks ready GLBs and floor images for path safety, file size
and sha256. Restoring an older backup requires the normal migration step before
starting this version. Older backends cannot read new version-4 map documents;
rollback after writing image maps requires a compatible backend or restoration of
the pre-upgrade database/storage backup. Do not drop image tables while references
are in use.

## Manual acceptance checklist

1. Run the normal migration/build/start workflow in a test environment. Confirm an
   existing version-1/2/3 map still loads, saves, exports and renders as before.
2. Sign in as DM, create an encounter, start a session and join from a second browser
   as a player. Create a blank map and upload the four-corner fixture or another
   asymmetric PNG. Check progress, preview, corner orientation and aspect ratio.
3. Preview offsets, fit/cover, alignment, rotation, scale, dimensions and opacity.
   Confirm the player remains on the saved version until Apply. Lock transforms;
   verify wall/scenery editing cannot move the image. Cancel another preview.
4. Place a wall and door along printed grid lines, a GLB object at a known square,
   and move a combatant onto another square. Toggle the application grid. Verify
   image, grid, object and token centres line up and depth/occlusion are correct.
5. Save a template, reload it, reload the browser and select the campaign again,
   then restart the test backend. Check calibration, image, objects and tokens.
   Join another player and verify the same configuration without editor controls.
6. Replace via drag-and-drop, adjust opacity, remove, undo and redo. Confirm history
   changes occur only on committed edits and old images remain downloadable to the
   DM but not to players when no longer current. Template/history references must
   prevent deletion until those references are cleared.
7. Try SVG, renamed non-image files, animation, malformed/truncated images and files
   over configured limits. Try uploading as player/anonymous or without CSRF. The
   current encounter must remain intact and errors must be understandable.
8. Block an image download in browser developer tools. The procedural floor, walls,
   objects and token controls must remain usable. Unblock and use Retry floor image.
   Check a tablet or GPU with a smaller max texture size if available.

## Automated coverage and limits

Shared tests cover UV orientation/rotation/aspect/offsets, strict metadata, legacy
maps, committed history, persistence serialization and coordinate-preserving resize.
Server tests cover actual decoding/re-encoding, EXIF, resource limits, bad content,
animation and authenticated texture lifetime/failure paths. Database tests cover
uploads, auth/CSRF/traversal/size, scoped grants, stale revisions, templates,
replacement/removal, undo/redo, late join, restart and protected deletion.
The browser acceptance test uploads, calibrates and previews, samples rendered
corner colours, places a wall and GLB, saves/reloads, verifies combatants and player
views, exercises a dropped replacement, and recovers from an HTTP 503 download.

A single image is supported per map. Calibration is numeric, not a two-point grid
measurement tool. Uploads require an authenticated DM in the persistent encounter
workflow; offline/local JSON maps preserve references but cannot bundle private
image files. Output resizing is intentionally lossy WebP and can soften very dense
printed grids. Originals are not retained. Very old browsers and unlimited GPU
textures are unsupported. No production deployment is performed by this change.

## Modified areas

| Area | Files |
| --- | --- |
| Shared map metadata, commands, UV mapping and history | `shared/floor-image.ts`, `shared/dungeon.ts`, `shared/domain.ts` |
| Persistent assets, processing and permissions | `server/floor-image-*.ts`, `server/floor-images.ts`, `server/asset-upload.ts`, existing asset storage/routes and startup |
| Reference retention and map/template persistence | `server/game.ts`, `server/scenery.ts`, `server/migrations/008_floor_images.sql` |
| Existing renderer and inspector integration | `src/FloorImage3D.tsx`, `src/floorImageResources.ts`, `src/FloorImagePanel.tsx`, `src/BattleMap3D.tsx`, `src/DungeonBuilder.tsx`, editor CSS |
| Deployment and restore verification | Both Compose files, environment examples, `scripts/ops/audit-assets.mjs`, backup/restore guide, package lockfile |
| Regression coverage | Shared calibration/history tests, server processing/resource tests, database image tests, `e2e/floor-images.spec.ts`, corner-image fixture and sidebar helper |

## Validation results

Verified locally with Node 24.19, PostgreSQL 17 and Chromium 154 using software
WebGL. The browser suite used the compiled backend and compiled processing workers.

| Check | Result |
| --- | --- |
| `npm test` | 83 passed; 3 existing infrastructure checks skipped (Caddy image/daemon and PowerShell unavailable) |
| All `server/tests/*.test.ts` against disposable PostgreSQL | 57 passed |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` | 16 passed, including all existing multiplayer/GLB/editor regressions |
| Final floor-image browser acceptance rerun after safeguards | Passed against the rebuilt compiled backend |
| `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check` | Passed; existing large frontend bundle advisory remains |
| `scripts/ops/audit-assets.mjs` against the test database/storage | All 30 ready GLB/WebP files matched size/hash and path checks |

The complete unit and database suites were rerun after the final resize/undo guard.
The floor-image browser scenario includes token moves during an in-flight upload,
locking, player access and download reuse, rendered orientation, preview isolation,
wall/GLB placement, save/reload, drag/drop replacement, HTTP 503 recovery, history
and a 768px tablet viewport. GPU downsampling is unit tested with a simulated
2048px device limit; physical tablet GPU/browser testing remains a manual step.
No production data or services were used, and no deployment was performed.
