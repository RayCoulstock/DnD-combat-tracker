# Using the hybrid dungeon builder

## Start in Codespaces or locally

Use Node.js 24 or newer. Follow [multiplayer-development.md](multiplayer-development.md) for `.env` configuration and cookie/origin settings. No additional packages or secrets are required for maps.

```bash
npm ci
docker compose up -d --wait
npm run db:migrate
npm run dev:all
```

Open the forwarded Vite port (5173). The existing proxy handles API and Socket.IO traffic; browser code has no fixed backend URL. Local tracker mode works without PostgreSQL or the backend. `npm run build` builds both applications; `npm run db:migrate:production` applies compiled migrations before `npm start`.

Migration `003_dungeon_maps.sql` adds `map_templates` (campaign, owner, schema version, revision, JSON document, timestamps) and `encounter_maps` (encounter, schema version, revision, nullable document, bounded map history, timestamps). It does not modify or delete old encounters. Existing flat battlefields remain flat until explicitly replaced. Back up PostgreSQL before production migrations as usual. Migration execution is transactional and repeatable through the existing migration ledger.

## Build and reuse a map

1. In the local tracker or a DM encounter, choose **Map editor**. Enter a name and dimensions, then **Create blank map** (4–50 cells per side).
2. Choose **Paint floor**, select stone, wood, dirt, grass or lava, then click or drag across the grid. The highlighted cells form one undoable brush stroke.
3. Choose **Draw wall**, select stone or wood, and click near a cell edge. Adjacent cells share the same canonical wall. Click an existing wall to select it.
4. Choose **Place door** and click a wall. Open doors leave a visible passage; locked doors have a gold panel. Use the door-state property and click again, or select the door and apply its state.
5. Choose **Place object**, select one of ten props and a rotation, then click a cell. **Select** an object to rotate/remove it; **Erase** removes the object, door, wall or floor under the pointer. Removing a wall also removes its doorway.
6. Use **Undo map edit** / **Redo map edit**. History contains only map geometry and dimensions, never HP, initiative, ownership or token movements. It retains up to 20 entries per stack within a 2 MB cap.
7. **Save map** creates a reusable template. Select a saved template to open, rename, duplicate, explicitly overwrite or delete it. The map-name input supplies the new name. Overwriting/deleting requires confirmation.

Left mouse edits; middle mouse rotates; right mouse pans; wheel zooms. Encounter mode restores normal token/camera controls. Player cameras are browser-local and never included in commands or saved maps.

Multiplayer encounter edits persist immediately after the server accepts them; **Save map** creates a reusable library copy, rather than acting as a prerequisite for persistence. Local library templates use this browser's localStorage. Local encounter exports include the map, so export before clearing browser storage or moving devices.

Templates are independent documents. Opening one copies it into the current encounter. Opening doors or editing that encounter never changes the template or other encounters; later template overwrites also leave existing encounter copies alone. Template saves check the source encounter revision and overwrites check the template revision. When another DM browser changes state, review the latest state and retry a rejected stale command rather than replaying an old snapshot.

## Generate, preview and edit

Choose **Generate dungeon**. Set Stone Dungeon, Cavern or Mining Outpost, dimensions (6–50), room count, minimum/maximum room sizes and seed. **Preview dungeon** changes only the DM preview; players and saved state remain unchanged. **Regenerate with new seed** produces another preview. **Accept generated map** asks before replacing an existing map, then sends the options to the authoritative server. **Cancel generation** discards the preview.

The same seed and options yield the same map. A partitioned room-and-corridor algorithm guarantees connected floors and separated room bounds; impossible settings produce an error instead of silently dropping rooms. Generated maps use the normal editable schema. Paint, extend corridors, erase walls and place props exactly as on manual maps. Accepted generation can be undone.

Replacing/resizing a map preserves combat statistics and valid token positions. Out-of-bounds tokens move to the first unoccupied cell in roster order, after reserving all still-valid token cells. If the board is full, overlap is permitted (this milestone has no collision enforcement). The same rule applies to undo/redo; map history does not roll token movement back.

## Two-player browser check

Sign in as DM, create a campaign/encounter, start multiplayer, and create two separate invitations. Open each in a separate browser profile or private context and redeem it with a distinct display name. Assign characters as before.

With both players connected, open the DM editor and create/paint a map. Both players should see geometry immediately and have no editing controls. Rotate one player's camera; the other view must stay unchanged. Preview generation and verify players still see the old map; accept and verify both transition. Change a door, undo and redo. Move an assigned token and change HP to confirm combat still works. Disconnect/reconnect a player, refresh the DM, and restart the backend: the latest map, door states and permissions should recover. Save a template and open it in a second encounter; edits to either encounter must leave the other copy unchanged. Revoking a player still removes access.

## Verification and implementation limits

```bash
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

Integration tests require PostgreSQL and the normal development environment variables. Browser tests require the frontend/backend running; set `CHROMIUM_PATH` if using a system Chromium installation. Tests create isolated campaigns/accounts, including a DM with two players, and cover editor interactions, preview/accept, broadcasts, authorisation, stale commands, map-only undo, copy isolation, reconnect and backend restart recovery.

The document is strict schema version 1; legacy encounter version-1 JSON gains an optional `dungeonMap`. Unsupported map versions, unknown props/assets, invalid coordinates, duplicate walls and orphan doors fail before applying an import. No script or external-model URL is accepted. Map templates and history are DM-only; current encounter environments are public to authorised participants. Existing CSRF, cookie, session, invitation and Socket.IO origin protections apply unchanged.

Floors, solid walls and prop parts use instanced meshes. Combat-only broadcasts omit an unchanged map document and retain its object identity on clients; joins/reconnects receive complete snapshots. Map edits currently broadcast the complete changed map through the existing ordered snapshot protocol. This is a deliberate reliability tradeoff for 50×50 maps; incremental patches with snapshot recovery are a future optimisation. Door panels use individual meshes. The production bundler still reports the existing large-chunk advisory; code splitting is a useful follow-up.

There is no fog of war, collision, elevation, pathfinding, uploaded assets or automatic wall transparency. Props are procedural placeholders. Next steps: profile on representative laptops, introduce revisioned map patches if needed, add a trusted GLB adapter behind the prop registry, and design server-side visibility before fog of war. Keep all future visibility filtering on the server.

## Milestone verification (2026-10-22)

- `npm test`: 21 checks passed (7 existing map/application guards and 14 shared domain/generator checks). The existing application handler guard was updated to current handler names and included in the default test command.
- `npm run test:integration`: 22 checks passed against PostgreSQL, including a DM and two simulated players, template/instance isolation, live map updates, denied player/stale/cross-campaign access, reconnect, and backend restart recovery.
- `npm run lint`, `npm run typecheck`, and `npm run build`: passed. Build retains the large JavaScript chunk advisory (about 1.64 MB / 456 KB gzip).
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`: all four browser scenarios passed. Coverage includes existing local/multiplayer combat, waiting-room activation, independent/offline cameras, DM brush strokes, generator preview/cancel/accept, two-player updates, template loading without camera reset, local undo/redo, template recovery and JSON export.
- Source and compiled production migration commands both passed and safely repeated against an already-migrated development database.

Browser camera checks wait for actual rendered-view convergence rather than a fixed delay: multiple software-rendered WebGL canvases can take longer to finish OrbitControls damping. Screenshots were also inspected for dungeon geometry and editor layout. Representative physical-laptop performance has not been benchmarked.
