# Playable 3D miniatures (Milestone 4B)

## Upgrade

Use Node 24+, the existing PostgreSQL database and the persistent asset directory from 4A. No new dependency or environment variable is required.

```bash
git fetch origin
git switch feature/playable-3d-miniatures
npm ci
npm run db:migrate
npm run dev:all
```

Stop/restart any existing development processes, then refresh Vite port 5173 (including the usual Codespaces forwarded URL). Production uses `npm run build`, `npm run db:migrate:production`, then `npm start` with the existing secure-cookie/origin and asset-storage configuration.

Migration `005_combatant_miniatures.sql` adds `combatant_asset_references`, keyed by encounter/combatant with cascading combatant foreign keys, an asset foreign key and asset index. It does not drop or rewrite existing encounters, maps, artwork or GLBs. Actual appearance settings remain in the existing `combatants.data` JSON. References are updated in the encounter transaction, under sorted asset-row locks; deletion takes the same asset lock. Concurrent assignment/deletion either publishes a valid reference or rejects the losing operation, never a dangling access grant.

## Assign and adjust

1. Sign in as DM in **Multiplayer**, choose a campaign and open/create an encounter with combatants. The existing Asset Library must contain a ready uploaded GLB owned by your DM account.
2. Select a combatant in the tracker or map roster. Click **Assign 3D Miniature**, beneath the encounter header.
3. Choose **Browse Asset Library**, search/filter the existing cards, select one to preview, then **Use this model**. All categories are available; the same asset can represent multiple combatants. The picker reuses the library and does not duplicate uploads.
4. Set **Miniature scale**, Y rotation in degrees, vertical offset, base size and **Show miniature base**. The preview updates without downloading the GLB again for each transform change. Click **Save miniature** to submit the normal authoritative encounter command.
5. Open **3D Map**. Players already connected receive the appearance without refreshing. Select the model or its base and click a destination square using the usual movement controls. Rotation/scale remain unchanged by movement.
6. Reopen settings to adjust the current model. **Restore placeholder token** removes the assignment; game statistics, IDs, ownership and token position are preserved.

Library defaults are copied when choosing a model. Each combatant then owns explicit overrides; editing one combatant or changing the library defaults does not change another miniature. Selecting a different asset copies its presentation defaults while retaining the chosen base size. Missing/unknown/private assets show an unavailable message; choose an accessible model or restore the placeholder.

Assignment is DM-only and needs an authenticated multiplayer encounter. Local encounter imports retain miniature data; after signing in to the matching DM account, local rendering may resolve owned assets. Offline/unsigned local play remains the original token workflow. Local mode has no library-assignment action.

## Coordinates, normalisation and bases

The original token remains the authoritative entity. Models use its integer X/Z position and existing cell-centre conversion, `x - width/2 + 0.5, z - height/2 + 0.5`; the grid remains five feet per square. There is no new movement command, interpolation, pathfinding, collision or multi-cell occupancy system.

A model is horizontally centred and grounded using its bounds. Its vertical extent is normalised to **one world unit / one square** before the combatant scale multiplier is applied. Proportions and the original GLB are unchanged. Tiny/large/off-centre/multi-mesh models use the same rule. Flat models use their largest extent; empty/non-finite bounds fall back to the token. Y is up; zero Y rotation preserves the authored GLB facing (+Z convention), and positive rotation turns +Z toward +X. Automatic semantic front/up detection is not provided. Re-export models requiring X/Z axis correction; no sculpting/rigging tools are included.

For example, scale 1 means about five feet tall, scale 2 about ten feet. Asset Library preview keeps its existing raw-unit presentation; the miniature picker/settings use normalised framing. A raw-unit default scale previously tuned for library assets may need adjusting here. Rotation is 0–360 degrees; scale is positive up to 10000; vertical offset is −10000–10000 world units. The UI's practical minimum scale is 0.0001. Start near scale 1.

Small/Medium bases span one square, Large two, Huge three. An explicit choice wins; otherwise recognised size text in a stat-block role/size is used when first assigning, with Medium fallback. Bases are centred on the existing token anchor, **not** a new top-left multi-cell position. They may overlap other bases, cross walls or extend beyond the board; only the anchor cell is validated. The model stands on the base top when enabled, then applies verticalOffset. Selection uses a diamond outline and text; the active turn uses a ring and arrow/text, with accessible roster states. HP and public conditions remain in the existing UI; private statistics still follow ownership rules.

## Permissions, saving and deletion

`combatant.miniature.update` uses the existing command envelope, expected encounter revision, duplicate receipts and transaction. Players cannot change appearances. Generic edit/add commands cannot bypass asset checks. Saves/checkpoints, refreshes, reconnects and backend restarts retain appearances and grants. Map undo/redo never rolls appearances or combat state back.

Owner DMs keep their normal Asset Library file access. Player file requests use the existing authenticated endpoint with campaign/encounter context. The server checks live membership, an active session, that encounter being currently open, a visible referenced combatant and a ready asset belonging to the campaign DM. Hidden-only models, ended/inactive/historical encounters, unrelated campaigns and revoked users grant no access. The library metadata remains DM-only. An asset used by both a visible and a hidden combatant is naturally viewable through the visible one; this milestone has no fog of war.

Deleting an asset referenced by any persisted encounter, including hidden/inactive encounters, is rejected. Remove those miniature assignments first. Exported JSON and historical checkpoints do not hold deletion locks: restoring one after its asset was deleted preserves the UUID/settings and shows a placeholder. Importing another account's asset UUID grants no access and uploads no new binary. Existing version-1 encounter JSON remains compatible and contains only references/settings, never GLB bytes or arbitrary external model URLs.

Already-delivered files cannot be erased from a participant's browser/device after revocation. The server rechecks new requests; the client removes mounted models when access/session scope ends. Do not assign private models to visible combatants unless participants may receive them.

## Loading and reliability

Each client coalesces identical scoped model requests/parses. Instances use SkeletonUtils cloning with independent bones/transforms and immutable shared geometry/materials/textures; no animation playback occurs. One instance releasing resources cannot dispose another's model. The cache allows at most 16 distinct models and an estimated 256 MiB of retained model resources, with at most two concurrent loads. Unused entries are disposed after one second, or evicted to make room. These are defensive cache limits, not a guarantee of total browser/GPU memory usage. Repeated skeletons share a download; many distinct large models may show budget fallbacks.

HP, initiative, selection and movement do not reload the GLB. File failures leave a selectable/movable cylinder and an unavailable message; **Retry model** retries explicitly. Loading never suspends the entire battlefield or Socket.IO handling. Cameras are neither included in appearance nor synchronised. The assignment preview has its own camera, and the existing battlefield camera remains mounted during updates.

## Two-player test

Create a campaign/encounter and two invitations. Open them in separate profiles/private contexts, join as two players, and assign a token to each. While both wait on the map, assign the same model to two combatants through the DM dialog. Give them different scales/rotations/bases and confirm both players see the changes without refresh. Move each owner's token; attempts to move the other's still fail. Rotate one player's camera and confirm the other stays put. Disconnect/reconnect a player, save/reload the encounter and restart the backend. Appearance and positions should recover.

Hide a combatant whose model is otherwise unused: a new player request for that GLB should fail. End/switch sessions or revoke access and verify new requests fail. Temporarily make storage unavailable to test fallback and manual retry; then restore it. Import an unknown UUID and confirm the game still works with a placeholder. Try deleting an assigned asset and confirm the library explains why it is blocked.

## Verification and next milestone

```bash
npm test
npm run test:integration
npm run lint
npm run typecheck
npm run build
# Frontend/backend must be running:
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Integration tests use isolated schemas/temp asset directories and a DM/two players. The browser regression covers live assignment, independent overrides, actual model selection, shared download, fallback movement/retry, reconnection, placeholder restoration and camera isolation. Existing tests for the tracker, authentication, builder/generator, templates, asset library and furniture selection remain unchanged.

Known limits: no animation playback, automatic up-axis correction, movement interpolation, collision or multi-cell occupancy. Large/budget-exceeding/unavailable assets use placeholders. Tested GLBs are generated fixtures (including embedded textures and a skinned cloning fixture); private Meshy exports and representative physical-laptop performance should be smoke-tested separately. The production bundle retains the existing chunk-size advisory.

For 4C, add a versioned uploaded dungeon-prop variant using this loader/normalisation/reference pattern. Extend reference/deletion guards and scoped delivery to encounter map instances and reusable templates, retaining the procedural prop allowlist. Keep generated/manual map data unified, and preserve map-only undo history. Profile real assets and consider batching/LOD and code splitting before increasing resource budgets.

## Completed verification (2026-10-24)

- `npm test`: 29 checks passed (7 original map/application guards plus 22 shared/backend checks), covering appearance validation/serialization/projection, normalisation across extreme dimensions and multiple meshes, cache coalescing/budgets/disposal, and independent skinned bones/shared geometry.
- `npm run test:integration`: 39 checks passed. Includes the existing asset/multiplayer suites and a DM/two-player miniature lifecycle: independent shared assignments, movement, forbidden assignment/edit/add bypasses, visibility/session/context/revocation delivery checks, deletion locks, concurrent assignment/deletion, import/export/checkpoints, unresolved imports, reconnect and backend restart.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`: all 7 browser scenarios passed. The new scenario exercises the real picker/preview/settings, live two-player rendering, one network download for shared models, GLB selection, fallback movement and explicit retry, independent cameras, reconnect, placeholder restoration and unknown-model recovery. All previous scenarios remain unchanged.
- Lint, frontend/backend type checks and production build passed. Build retains a large-chunk advisory (about 1.72 MB / 477 KB gzip). Source and compiled migration commands passed, including repeat application.
- Browser screenshots were inspected for loaded textured geometry, bases, status rings and the assignment action. No private Meshy model or physical-laptop benchmark was used.

The integration test also guards a 4A upload timing correction: upload success now releases the processing slot before acknowledgement, so an immediately following sequential upload is not incorrectly rejected as still processing.

## Milestone 4C extension

[Custom scenery](custom-3d-scenery-development.md) now uses the same cached model-instance renderer and normalisation. Miniature base/selection/movement behaviour is preserved. Binary grants and asset deletion guards also account for current visible scenery, map history and reusable map templates; library management remains DM-only.
