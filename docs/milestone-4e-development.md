# Milestone 4E: advanced building and tactical tools

## Run

```sh
git fetch origin
git switch feature/advanced-building-tools
npm ci
docker compose up -d postgres
npm run db:migrate
npm run dev:all
```

Use Vite's forwarded port in Codespaces. Existing authentication, storage, PostgreSQL and Socket.IO settings are unchanged. Deploy frontend and backend together.

No new relational migration is required. Shared tactical objects are optional encounter JSONB data, outside the dungeon map document. Existing map versions and procedural generation remain supported. Built-in props can now include an optional bounded uniform scale. Existing missing scale means 1. Old battlefield files default to 5 feet per square; validated custom scale now survives normalization and import/export.

## Stage 1: drawing

Open **Map editor** as DM and create/open a dungeon. Select floor material, wall material and (optionally) the existing uploaded wall visual preset.

- **Wall line:** left-drag snapped grid vertices, then release. The greater horizontal/vertical displacement chooses the axis; ties choose horizontal. Reverse drags work. Each edge remains its existing canonical H/V wall ID.
- **Rectangle room:** drag opposite vertices. Floors fill the rectangle and logical walls form its perimeter. **Walls only** leaves floors unchanged. Existing perimeter walls, their appearances, doors and props are preserved; floor painting uses the chosen material.
- **Corridor:** choose width (1–10 squares) and drag a straight line. Width extends toward +Z for horizontal corridors and +X for vertical ones, independent of drag direction. Existing room floor materials are retained. Connected floor regions omit/remove only their connecting wall segments inside/touching the corridor. A custom GLB wall at an intended opening can be cut, with its visual preserved in undo history. Unrelated walls, scenery and every door remain intact; doors may intentionally keep a connection closed.

Blue previews show added wall geometry; red wireframes identify corridor wall removals. Floor previews show the footprint. Empty/out-of-bounds/oversized gestures do not commit. Escape cancels. One release sends one validated parametric command, persists atomically, increments the map revision once and creates one undo frame. **Undo map edit** restores the entire batch, including any removed wall appearances. Individual wall/door tools still work.

## Stage 2: ruler

In **3D Map**, both players and DM have **Tactical tools** in Map controls. Select **Ruler**, then left-drag on the floor. The line, endpoint markers and distance update locally while dragging. Release retains a local measurement; Escape/Cancel removes it. No network commands are sent for local measurements or pointer movement.

Choose the rule before starting:

- **Straight-line:** Euclidean distance on the ground plane.
- **Diagonals count as 1:** snap endpoints to grid vertices; distance is `max(dx,dz)` squares.
- **Alternating diagonals:** snap endpoints; diagonal costs alternate one/two squares, starting at one. Distance is `max(dx,dz) + floor(min(dx,dz)/2)` squares. At 5 feet per square this is the familiar 5/10 rule; at 10 feet it is 10/20. The alternation resets for each measurement.

The DM can set **Feet per square** (1–100) and Apply scale. All ruler and shape conversions use that shared setting. Measurement does not imply a legal route and ignores obstacles, movement speed and collision. There are no path waypoints or vertical-distance calculations in this milestone.

**Share with encounter** publishes a ruler to authorised participants. Its owner and the DM can move or delete it. Shared rulers expire two minutes after creation; editing does not extend that lifetime. Client rendering hides expiry promptly, and a server cleanup job removes expired current records at most about 15 seconds later when PostgreSQL is available. They never enter exported encounter files, reusable maps or saved checkpoints. Local rulers have no expiry until cancelled.

## Stage 3: tactical areas

Use a preset: 20-foot-radius sphere, 15/30-foot cone, 15-foot cube or 60 × 5-foot line. Move over the battlefield and click to finish local placement. Choose shape dimensions, rotation, colour, opacity and elevation in the properties panel. The draft stays local until **Share with encounter**.

- Sphere: uniformly sized translucent sphere plus a circular ground footprint representing its maximum horizontal radius. The sphere's lowest point is at the selected elevation; the circle is a targeting projection, not a physical sphere/floor intersection.
- Cone: a horizontal circular sector, 90 degrees by default, configurable 15–180 degrees. Length is the sector radius, not the centre-to-base distance of a mathematical solid cone. This is an explicit readable D&D-style convention, not a complete spell-rules engine.
- Cube: uniform side length in feet.
- Line: a thin targeting ribbon with independent length and width. Cone/line face -Z at zero rotation; positive Y rotation uses Three.js conventions.

Opacity is limited to .08–.45 (default .2). Footprints sit slightly above the grid and use depth-write-disabled transparent materials. Elevation is expressed in feet. There is no damage, save, hit detection or affected-creature calculation.

Select a shared overlay in the scene or **Shared overlays** selector. Move, rotate or edit its dimensions locally, then **Apply overlay changes** to publish. If that object changed or disappeared while a draft was being edited, the stale draft is rejected locally; cancel and select current state. Server encounter revisions remain the final authority. **Unshare to local** deletes the shared object and retains a local copy. Delete removes the selected draft/object. The DM can **Clear shared overlays**. Limits are 64 shared objects per encounter and eight owned objects per player.

Ownership uses stable authenticated user/membership IDs, never a supplied name or socket ID. Labels/selectors show a short owner ID (or You for the current owner). The server binds ownership on creation; only owner/DM can update or remove. All authorised participants receive shared objects, including late joins and reconnects. Shared areas survive backend restart and checkpoints; they are independent of map templates and map undo/redo. JSON imports reassign shared area ownership to the importing DM, not arbitrary imported player IDs. Temporary rulers are discarded on import.

## Stage 4: contextual controls

Select a map object in the editor or a token/overlay in encounter mode. The compact floating controls follow its projected position as the camera moves, clamp to the visible browser/canvas region and remain keyboard/touch operable.

- Uploaded scenery: Move, Rotate, Scale, Duplicate, Delete and Properties.
- Built-in scenery: the same operations, using cell placement, quarter-turn rotation and a bounded uniform scale. Duplication keeps independent instance settings.
- Wall: Change appearance, Remove and Properties.
- Door: Open, Close/Unlock, Lock, Change appearance, Remove and Properties; these invoke the existing logical door commands.
- Combatant: Select, ownership-permitted Move token, relevant information, and Appearance for authorised DMs. Movement still uses select-token/then-click-cell; the token and its existing movement command remain authoritative.
- Tactical overlay: Move, Rotate, Resize/properties, Share/Apply, Unshare and Delete when permitted. Read-only objects omit editing actions.

Advanced property panels remain available. Scale/Properties opens the editor panel rather than duplicating its transform state. Escape or deselection closes controls and returns focus to the battlefield. Floating controls stay below modal dialogs. Switching editor tools or encounters cancels unfinished tactical previews without remounting the camera. Only the active tool consumes placement gestures. Middle-drag rotates and right-drag pans while editing/targeting; normal navigation retains existing controls. Two-finger touch camera gestures cancel an unfinished drawing/placement.

## Persistence and security

`map.draw` and built-in `map.prop.transform` reuse validated DM map commands, transactions, command UUID receipts, expected revisions, map history and recipient broadcasts. Wall visual assets undergo existing owned-ready/matching-role checks and history/template reference protection.

`tactical.create/update/remove/clear` are separate typed commands. Owner metadata and ruler expiry are server-managed. Area dimensions, coordinates, colours, opacity, limits and IDs are bounded. Records are in the current encounter's JSONB, never map templates; map undo contains no tactical/combat state. Expiry takes the same campaign-then-encounter lock order and advances revisions before broadcasts. Temporary ruler history is not stored in checkpoints/exports. Backup requirements remain PostgreSQL plus private asset storage.

## Test with DM and two players

1. Start a campaign encounter, invite two independent browser profiles and assign their characters as before.
2. Draw a wall line, room and corridor. Both players should see one committed update per gesture. Undo/redo a batch; existing doors/props remain.
3. Give each browser a different camera angle. Measure locally: other browsers should see nothing. Share the ruler and confirm both receive it. Try the three rules and a different feet-per-square setting.
4. Share each area shape. Move/resize/rotate then Apply. The owner and DM can edit; the other player must have read-only controls and rejected forged commands.
5. Reconnect a player, open a copied map template and restart the backend. Current encounter areas recover; template edits and map undo remain independent. Shared rulers expire after two minutes and are absent from saved checkpoints/exports.
6. Select props, walls, doors and characters. Check contextual actions, Escape, keyboard buttons, camera following and viewport edges. Verify a player cannot move someone else's token or open DM miniature assignment.

## Verification and limits

Commands: `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run build`, and `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- --trace retain-on-failure`. Run browser batches against a fresh development backend when prior batches have exhausted the unchanged authentication/invitation rate limits.

Tests cover canonical batch geometry, corridor cuts/preservation, undo/redo, built-in transforms, scale normalization, distance rules, shape validation, ownership, expiry/checkpoint filtering, persistent restart recovery, two-player broadcasts and new browser gestures. Existing GLB, dungeon, combat, authentication and independent-camera suites remain required.

Limits: straight orthogonal drawing only; corridors retain doors rather than destroying them; approximate ground targeting conventions; one local draft at a time; no collision, fog, pathfinding, automated combat or complex transform gizmos. Rich GLB scenes still require practical laptop profiling; the existing large-bundle advisory remains. Overlay labels use short stable IDs rather than a richer named-owner legend.

Recommended Milestone 5: logical visibility/line-of-sight foundations, named tactical-object/participant management and performance work (bundle splitting, thumbnails and representative Meshy scene benchmarks). Keep visibility and collision based on canonical logical walls/doors, never GLB triangles.

Verified results: **46 unit checks (8 application/map + 38 shared/backend), 49 integration checks and all 11 browser scenarios passed**. Frontend/backend TypeScript, ESLint and production builds passed. The final complete browser run passed with failure-trace retention enabled in 3.8 minutes. The added floor-drag and keyboard/context checks also pass. Production JavaScript is approximately 1,831 kB / 504 kB gzip, retaining the existing bundle-size advisory. No private Meshy models were modified or used for automated fixtures.
