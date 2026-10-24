# Milestone 4D: use and verification

## Run this version

```sh
git fetch origin
git switch feature/unified-architectural-assets
npm ci
docker compose up -d postgres
npm run db:migrate
npm run dev:all
```

Keep the existing `.env` and private asset storage configuration. Use the forwarded Vite port in Codespaces; HTTP and Socket.IO stay on the same origin. For an already running checkout, apply migrations and restart frontend/backend. No secrets or uploaded binaries are committed.

## Add objects

Sign in as DM, open a campaign encounter and select **Map editor**. Create/load a map if it is still flat. **Add Object** opens one browser with All objects, Built-in objects and Uploaded assets. Search names, filter categories and select a model to preview it. Built-in objects retain their existing geometry and saved format. Choose **Use built-in object** or **Use this model**, adjust placement settings and click the battlefield. Uploaded scenery supports grid snapping or free placement; built-ins use cells and quarter-turn rotations. Escape cancels placement. Select scenery or use Scenery instances to transform, duplicate, hide or delete it as before.

Assets classified as walls or doors in this browser activate the corresponding logical tool instead of placing decorative scenery. Existing decorative wall-shaped scenery stays unchanged; no heuristic conversion moves old objects or changes their assignments. Other architectural assets remain decorative.

## Import and calibrate a Meshy wall or door

1. Export a self-contained GLB from Meshy. Prefer one wall segment or a door leaf, Y-up, with its width along X and forward facing +Z. Avoid a multi-segment building or a frame-and-leaf assembly for a moving door.
2. Open **Asset Library**, upload the GLB, then select its card. Under Asset metadata, set **Architectural role** to `wall` or `door` (category `architecture` is useful but role is what filters the wall/door picker).
3. Adjust Architecture calibration while watching the live preview. Grid span is fixed to one edge. Facing describes the authored forward axis; rotation correction handles additional yaw. The corrected model is centred, grounded and uniformly fitted to one grid unit along X. Scale multiplies that result without distorting proportions. Offset moves it vertically; horizontal alignment anchors centre/start/end, and horizontal offset shifts along the edge. Start/end refer to the model's local X direction, so vertical canonical edges run toward -Z.
4. Save asset metadata. GLB bytes remain unchanged. This updates defaults for future assignments only.
5. In Map editor, use **Choose wall visual** or **Choose door visual**. Only assets with the appropriate role appear. Preview and optionally override calibration before choosing Use this model.
6. For a wall, hover near a cell edge and click. North/south edges canonicalize to H, east/west to V. The GLB sits at the logical edge centre, never the floor-cell centre. For a door, place a wall first, then click that wall/edge using the Door tool. The existing wall becomes its logical opening; no solid wall renders behind the door.
7. Use Select or **Architectural instances** to select an existing wall/door. Choose selected wall/door asset, revert to built-in appearance or edit instance calibration and Apply. Apply wall visual choice to selected wall also applies the current stone/wood preset. IDs and door relationships stay intact. Undo/redo restores these changes.
8. Select a door, choose Door state and Apply selected door state. Open pivots the model at one end of the edge by 90 degrees; Closed/Locked share the closed pose, with an explicit text/lock indicator. Models do not need animation. A missing/failed model retains logical walls/doors and procedural fallback geometry.
9. Save map for a reusable template. Opening a template copies its scenery and architectural assignments into the encounter; later encounter state/calibration edits do not alter that template. Original assets are reused by ID.

A scale of 1 and centred alignment fits one edge. Other scales/offsets can deliberately overhang it; they never change logical span, movement or obstruction semantics. Facing/rotation correct yaw only. Reorient a model exported lying on its side in a modelling tool before importing.

## Data, persistence and permissions

- Migration `007_architectural_visuals.sql` broadens existing JSONB map version constraints to 1/2/3. It does not rewrite maps, history, combatants or assets. Calibration is optional existing asset presentation JSON, requiring no binary/table duplication.
- Old maps retain their version and layout. Architectural assignments upgrade a map to version 3; uploaded props remain supported in versions 2/3. Future unsupported versions fail validation atomically.
- Logical walls and doors gain optional `visual: {assetId, calibration}`. Copied calibration is independent per instance. State remains on the original logical door. Procedural generation is unchanged and still produces built-in logical entities.
- Existing transaction/revision checks, recipient broadcasts and bounded server map history are reused. Camera state stays browser-local. Late joins/reconnects receive complete current state; unchanged map documents are still omitted on combat-only broadcasts.
- Existing encounter/template/history asset references now include architecture. Only current rendered architectural references grant active campaign players binary access. History/templates protect deletion without granting player library management. A wall visual suppressed by a door opening does not grant current file access unless referenced elsewhere visibly.
- Explicit wall/door assignments require a ready owned asset with the matching role. Imports may retain unresolved references as fallback placeholders without granting access to another account's assets. Asset deletion remains blocked while referenced, including undo/redo history. Clear map history only when the DM intends to discard those recovery points.
- Backup PostgreSQL and configured private asset storage together, as for 4A–4C. No GLB data is embedded in JSON or Socket.IO.

## Test with two player browsers

1. Start the backend, frontend and PostgreSQL. Sign in as DM and start a campaign encounter.
2. Redeem two separate invitations in independent browser profiles/private sessions. Keep all three battlefields open.
3. Add a built-in chair and an uploaded scenery object through Add Object. Place calibrated walls on north/east/south/west edges and assign a custom door to one wall.
4. Rotate/pan/zoom each player's camera differently. Change wall calibration, switch door Closed/Open/Locked, remove/undo/redo an architectural assignment. Both players should see the update immediately, retaining their own camera views and receiving no editing controls.
5. Disconnect/reconnect one player. Save a template, create another encounter and open it, then change that encounter's door. Reopen the original to verify isolation. Restart the backend and rejoin; architectural assignments, calibration and state should survive.
6. Rejoin as DM after a full page refresh by selecting the campaign (the existing DM campaign chooser does not automatically select it after reload). Unknown imported model IDs show fallback geometry.

## Verification

Commands:

```sh
npm test
npm run test:integration
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
npm run typecheck
npm run lint
npm run build
npm run db:migrate:production
```

Results: **38 unit checks (7 application/map + 31 shared/backend), 47 integration checks, and all 9 browser scenarios passed**. TypeScript frontend/backend checks, ESLint, production frontend/backend build, source migration and compiled production migration all passed. The final complete browser run used `--trace retain-on-failure` and passed in 2.6 minutes. Production JS is approximately 1,751 kB / 484 kB gzip and retains the existing bundle-size advisory.

Repeated browser runs against one long-running development server can exhaust the existing authentication/invitation rate limiter. Restart the development server between batches; do not disable security limits. Earlier exploratory runs included a picker timeout and a player-join failure; the final clean full run passed with tracing enabled. Private Meshy models and ordinary-laptop performance still require manual verification.

Automated coverage includes unified built-in search/category selection; unchanged scenery, procedural generation and miniatures; canonical edges; calibration bounds and normalization of tiny/large/off-centre assets; independent/shared resources; logical wall/door edits and states; undo/redo; DM/two-player broadcasts and permissions; cross-account references; template isolation; import/export; asset grants/deletion; reconnect and backend restart. The browser regression uses small generated GLB fixtures, not private Meshy files.

## Limits and next work

One edge per architectural assignment, uniform scaling, yaw calibration and a simple static hinge are supported. A frame embedded in a door GLB pivots with the whole model; use a leaf-only model or built-in door for the clearest open passage. Logical walls under doors remain persisted but visually suppressed. Geometry cannot define separate wall/door state or collision. There is no fog of war, line of sight or collision in this milestone.

At most 200 assigned architectural visuals per map; existing 100 uploaded-scenery and 200-prop limits remain. The shared GLB cache still permits 16 distinct cached models/~256 MiB estimated resources; repeated instances share downloads and source geometry. Rich Meshy models require practical laptop profiling. The existing production bundle-size advisory remains; no automatic mesh simplification is added.

Recommended next milestone: performance/asset usage inspection and lightweight thumbnails or bundle splitting, followed by visibility/LOS built on canonical logical walls and doors. Never infer obstruction from model triangles.
