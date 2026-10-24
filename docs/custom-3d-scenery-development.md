# Custom 3D dungeon scenery (Milestone 4C)

## Upgrade and storage

Use the existing Node 24+, PostgreSQL and persistent Asset Library storage configuration. No dependency or environment variable is added.

```bash
git fetch origin
git switch feature/custom-3d-scenery
npm ci
npm run db:migrate
npm run dev:all
```

Restart existing development processes and refresh Vite port 5173 (or its Codespaces forwarded URL). Production uses `npm run build`, `npm run db:migrate:production`, then `npm start`. Continue backing up PostgreSQL and the private GLB directory together as described in the asset-library guide.

Migration `006_custom_scenery.sql` permits map schema versions 1/2 and adds `encounter_scenery_asset_references` and `template_scenery_asset_references`, with asset indexes and cascading encounter/template foreign keys. It does not delete/replace existing map or encounter documents. Version-1 documents and generation output stay unchanged; placing custom scenery upgrades that map to version 2. Version 2 keeps the existing floor/wall/door/procedural prop format and adds a typed asset prop variant in the same `props` array. Unsupported future versions and malformed imports fail before applying changes.

Each asset placement stores an instance ID, reusable asset UUID, label/category, X/Z position, Y rotation in degrees, scale, vertical offset and visibility. These are instance settings, not changes to the reusable GLB. IDs are scoped to map documents/encounter copies; map duplication copies placements/settings while referencing the original assets. No GLB bytes or arbitrary external model URLs enter map JSON or Socket.IO.

## Place Meshy scenery

1. Upload a self-contained Meshy GLB to the existing **Asset Library**, using the supported export format/limits from 4A. Sign in as DM in Multiplayer, open an encounter, then choose **Map editor**.
2. Create/open a dungeon map. Click **3D Scenery**. The existing library picker supports search/category filtering, model preview and **Use this model**. It does not create another upload/management interface.
3. Move over the battlefield to see a translucent model preview (or a placeholder while loading). Click the floor to place. The same chosen asset stays ready for repeated placements. **Choose scenery asset** opens the picker again.
4. **Snap scenery to grid** defaults on. Disable it for fractional placement. Middle-drag rotates the camera, right-drag pans, and wheel zooms. A drag does not commit a placement. **Escape** cancels placement/movement/selection and closes the picker without changing map state.
5. Choose **Select** and click a model, or use **Scenery instances** to select one by label/ID, including hidden or overlapping objects. An outline and the properties heading identify the selected instance. Clicking an occupied grid square also provides the existing sparse-object selection fallback.

Uploaded scenery placement requires a DM campaign encounter. Local import/export retains furnished documents and local tools can edit existing instance transforms; binary resolution still needs a signed-in owner account. The standalone tracker/procedural editor remains usable without a backend.

## Transform and duplicate

The selected scenery properties panel provides X/Z, rotation input/slider, scale, vertical offset and **Visible to players**. Click **Apply scenery transform** to persist the complete validated edit. Typing does not broadcast intermediate values. Apply pending form edits before choosing **Move scenery on map**; that tool uses the current authoritative settings and commits a new anchor with one floor click.

- **Reset scenery transform** restores rotation 0, scale 1 and Y offset 0, retaining the anchor and visibility.
- **Duplicate scenery** copies the instance settings to a fresh ID one square along X/Z, clamped to map bounds. This may overlap another object; there is no collision rule. It never copies the binary asset.
- **Delete scenery** removes the placement, not the GLB. Undo can restore it.
- **Shift+D** duplicates and **Delete** removes the selected scenery when keyboard focus is outside text/number/select inputs. Escape always cancels the tool. Repeated held-key events are ignored.

Built-in props remain under **Place object**, with the original ten procedural models and existing rotate/remove controls. Generated maps still use those procedural models. Both types can coexist and share the same map history and persistence.

## Coordinates, normalisation and limits

Scenery uses the existing cell-centre convention: world X/Z = instance X/Z − half the map dimensions + 0.5. Snapped coordinates are integer cell indices. Free anchors use fractional indices within 0..width−1 / 0..height−1, leaving a half-cell border margin. Numeric properties accept fractional values regardless of the pointer-snap setting. Bounds apply to the anchor, not the full model geometry; large objects may extend off the board or through other objects.

The shared 4B normalisation layer centres X/Z, grounds the lowest Y and normalises model height to one world unit (one grid square) before applying instance scale. Flat/degenerate exports use the existing safe handling/fallback. Rotation is around Y in degrees; zero preserves authored facing. Vertical offset moves the model above/below the logical floor plane; it is not terrain elevation or gravity. Asset defaults are copied when choosing a model, clamped to scenery limits. Instances then have independent settings.

Shared configuration is in `shared/scenery.ts`:

| Limit | Value |
| --- | ---: |
| Custom scenery instances per map | 100 |
| Total props, including procedural | 200 |
| Scale | 0.01–20 |
| Vertical offset | −10–20 world units |
| Y rotation | 0–360 degrees |
| Map size | Existing 4–50 cells per side |

Change the shared configuration and rebuild both client/server if adjusting those scenery bounds. Asset upload complexity limits still apply. The shared miniature/scenery cache allows 16 distinct scoped models and approximately 256 MiB estimated resources, with two concurrent loads. Many instances of one model share a download/parse; different transforms and ghost materials are independent. Unused resources are released after the existing one-second grace period. These are cache budgets, not a hard limit on total browser/GPU memory. Budget/load failures show a selectable placeholder and **Retry model**, with the reason available on the status tooltip. Model loading does not block the rest of the battlefield.

## Maps, history, visibility and access

Every accepted edit persists immediately. **Save map** creates a reusable campaign template; explicit overwrite changes the template only. Opening it copies the document into the encounter. Rename, duplication, later encounter edits and template changes retain the existing isolation semantics. Browser/DM/player disconnections and backend restarts recover the current map from PostgreSQL. Encounter export includes scenery references/transforms, and legacy JSON remains importable.

Place/move/rotate/scale/visibility/duplicate/delete use normal DM-only validated map commands, command receipts, encounter revisions and map revisions. Undo/redo is server-owned and restores only map frames, never combatant HP, initiative or token movement. Stale commands are rejected and reconciled through the existing snapshot protocol. No client timestamps, reload workaround or polling is introduced. Cameras remain local.

**Invisible scenery is omitted from player snapshots.** The DM sees it translucently and can select it in the instance list. Player binary retrieval checks live membership, active session/current encounter, a visible current scenery or miniature reference, ready status and asset ownership by the campaign DM. Template-only, history-only, unrelated-campaign and hidden-only references do not grant file access. An asset also used by another visible object remains available through that visible reference. Already-delivered files cannot be erased from a player's device; this is not fog of war.

Asset deletion is blocked by current/history encounter map references, reusable templates and miniature assignments. After deleting a placement, its undo frame still needs the asset. **Clear map history** explicitly discards undo/redo after confirmation and releases history-only references. Other encounters/templates may still retain it; remove their references separately before deleting the asset in the library. Exports and historical checkpoints outside bounded map history do not hold deletion locks: restoring a missing/private UUID preserves the document and shows placeholders without granting access.

## Decorative architecture

Wall, door, arch, stair and column GLBs are decorative props in 4C. They do not replace canonical logical walls, create door state, enforce collision, add another level or alter movement. Use the existing wall/door tools for logical entities. Future visual skins should reference those entities and keep a single authoritative door-state model.

## Two-player check

Invite two players in separate browser profiles/private contexts. With both viewing the encounter, place a scenery model from the DM editor. Confirm it appears without refresh and that players have no editing tools. Place several copies and give each different transforms; move/duplicate/delete one and exercise undo/redo. Rotate one player's camera and verify the other view stays unchanged. Hide an otherwise-unused asset instance and verify a new player file request fails; restore visibility and reconnect a player.

Save a furnished map as a template, duplicate it and open copies in different encounters. Editing one copy must not change another or the template. Restart the backend and refresh the DM; scenery/transforms must recover. Temporarily interrupt model storage to test placeholders/retry. Try deleting an asset retained only in undo history, clear that history, and confirm template references still protect it. Original token ownership and miniature movement should remain unchanged.

## Verification and next milestone

```bash
npm test
npm run test:integration
npm run lint
npm run typecheck
npm run build
# With frontend/backend running:
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Tests use generated textured GLBs and isolated database schemas/temp binary directories. The browser scenario exercises real placement preview, snapped/free coordinates, transformations, deletion/duplication/history/templates, reconnect and 25 instances sharing one download per encounter scope. The existing asset, miniature, combat, camera, generator and procedural-editor scenarios remain required. The previous future-map-version rejection assertion advances from 2 to 3 because version 2 is now supported; version-1 compatibility is still explicitly tested.

Known limitations: decorative architecture only; no physics/collision/pathfinding, automatic up-axis correction, animation or elevation editing. Map-changing broadcasts still send full authorised changed documents, while combat-only updates retain the existing omission/cache mechanism. Real Meshy model quality and ordinary-laptop GPU performance need representative manual profiling. The production bundle retains its existing large-chunk advisory.

Recommended next milestone: profile real furnished encounters, add an asset-usage inspector and LOD/code-splitting where justified, then introduce versioned architectural visual skins tied to the existing logical wall/door entities. Design server-side visibility separately before any future fog-of-war work.

## Completed verification (2026-10-24)

- `npm test`: 33 checks passed (7 original map/application guards plus 26 shared/backend checks). New coverage includes mixed v1/v2 documents, strict transforms/limits, atomic failed edits, scenery operations/history and translucent-material independence.
- `npm run test:integration`: 46 checks passed, including every existing asset/miniature/multiplayer check and a DM/two-player scenery lifecycle. It verifies direct/generic/whole-map ownership validation, hidden/history/template delivery boundaries, stale/player commands, independent template copies and overwrites, live updates, reconnect/restart, JSON round trips and reference-safe deletion.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`: all 8 scenarios passed. The new scenery scenario also passed after adding shared miniature/scenery asset use, visibility toggling and missing-model recovery. It covers real library preview, snapped/free placement, transform editing, duplication/deletion/undo/redo, template loading, reconnect and 25 shared instances with one download per encounter scope.
- Lint, frontend/backend type checks and production build passed. Build retains the existing large-chunk advisory (about 1.73 MB / 480 KB gzip). Source/compiled migrations applied successfully, including repeated application.
- Rendered screenshots were inspected with 25 textured fixture placements. Real private Meshy assets, production hosting and physical-laptop benchmarks were not exercised.
