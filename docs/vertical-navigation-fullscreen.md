# Vertical navigation and fullscreen maps — Milestone 5.4

## Architecture and compatibility

The existing map document owns a single optional `transitions` array. Each record
connects two stable level IDs and their zero-based tactical grid squares:

```json
{
  "id": "warehouse-office-stairs",
  "type": "stairs",
  "source": {"floorId": "ground", "x": 3, "z": 4},
  "destination": {"floorId": "office", "x": 8, "z": 9},
  "directionality": "two-way",
  "name": "Office stairs",
  "movementCost": "difficult",
  "assetId": "00000000-0000-4000-8000-000000000001",
  "dmNotes": "Optional private DM notes"
}
```

`assetId` is optional; omit it or replace the illustrative UUID with a library asset you own.
Types are `stairs`, `ladder`, `trapdoor`, `pit`, and `portal`. Movement policies are
`normal`, `difficult` (double cost), and `dm-decides`. They are descriptive metadata:
no movement, actions, climbing rules, fall damage or pathfinding are enforced.
Both endpoints must belong to different existing floors and lie within those
floors' dimensions. There are at most 200 transitions per map. IDs are bounded,
validated strings; notes are limited to 10,000 characters, names to 150.

A map containing transition metadata uses version 6 and the existing version 5
level abstraction. Versions 1–5 continue loading without conversion or new default
connections. A first transition edit upgrades the document. Subsequent geometry,
image and level commands preserve its version and transitions. Transitions live
outside cached per-level geometry views, avoiding duplication of each route in
both floor documents. The existing one-scene renderer and five-foot square remain
unchanged; endpoint markers inherit the floor's native elevation group.

The shared map command/history engine handles `map.transition.set` and
`map.transition.remove`. A transition is saved as one committed edit, not a frame
per field or endpoint click. Undo/redo, templates, encounter export/import and
restarts use the existing persistent map path and revision/conflict mechanism.
A related import correction preserves token coordinates beyond the primary
floor's bounds when their owning secondary floor is larger; normalization first
uses the full map extent, then reconciles each floor independently.

## Editing and travel

The editor's Transitions tool and inspector support:

1. Start a new transition or select a marker/existing record.
2. Choose the source floor and pick a source square on the map.
3. Choose the destination floor and pick its square. Picking switches only the
   DM's local editing floor. Numeric square controls are also available.
4. Set type, optional name, directionality, movement cost, private notes and an
   optional model from the existing Asset Library.
5. Save once, or delete an existing record with confirmation.

Built-in native meshes and labels remain available without any model. Optional
models are decoration with the shared normalized GLB loader's unit transform; use
ordinary scenery alongside the marker for more elaborate placement/calibration.
Both endpoints display the connected floor name and square. Markers respect
inactive-floor raycast filtering and the existing native-modal top layer. Choosing
an endpoint does not accidentally select another transition beneath the pointer.

In the battle map, select a combatant on the active floor and open **Floor
transitions**. Choose **Move through …**. The confirmation dialog shows the target
floor/square, movement policy and whether that floor is hidden. Moving from the
reverse endpoint is available only for two-way routes.

The DM may transfer an off-source token on the source floor, after explicitly
checking the warning override. Occupied destinations require a separate explicit
stacking override. The server enforces both flags independently against current
state, checks the combatant's source floor, validates directionality and rejects
missing/deleted transitions. The existing encounter revision guards races and
stale commands. `combatant.transition.use` atomically changes only the combatant's
floor ID and token coordinates. ID, initiative, HP, conditions, player ownership,
miniature and other combat fields remain intact. Transfers are combat actions
outside geometry history, matching the existing manual floor-transfer command.

**Follow combatant** changes only the DM's local active floor. It never reveals
that floor. The separate **Reveal destination floor** action uses the existing
DM-only level visibility command. Players receive a transferred token only when
authorized to see its destination; a hidden destination stays hidden.

## Floor lifecycle and private assets

Deleting a floor removes all incident transitions in the same history frame.
Undo restores the floor, routes and protected asset references. Shrinking a floor
around a transition endpoint is rejected until its endpoint is moved.

Duplication policy: duplicate floor geometry, images and placements as in 5.3,
but do not copy any transition connections. Existing routes keep their IDs and
endpoints. The duplicate is disconnected until the DM explicitly creates a new
route, which receives a new ID. This avoids silently connecting a copied office
to the original warehouse or creating dangling links.

Player snapshots/API projections include a transition only when both endpoint
floors are player-visible. `dmNotes` is always removed, even if both floors are
revealed. Filtering omits the entire route for a hidden endpoint, including its
name, coordinates, hidden floor ID and optional model reference. Players have no
transition editing or travel controls, and cannot send the DM travel command.
New joins/reconnections use the same authoritative projection.

Optional model IDs join the existing current/history/template scenery reference
sets. Only routes with two visible endpoints grant a player download of their
model. Hidden/history-only routes protect files from deletion without granting
access. A shared model used independently on a visible floor remains available
there. The shared loader/cache serves endpoint instances without repeated parsing
or downloading and releases placement resources through its existing lifecycle.
Hiding previously revealed content cannot erase bytes already delivered to a
participant's browser, as with the rest of the application.

## Expanded viewport and native fullscreen

**Expand Map** fixes the current workspace to the available viewport. The current
Canvas, renderer, camera, floor selection, selected token, inspector and local
form drafts stay mounted. Surrounding sibling navigation/panels become inert and
body scrolling is suspended; restoration restores their prior state and scroll
position. The inspector is collapsed visually while expanded, with a DM control
to show it again. Its DOM/form state is retained. A new application layering token
places the expanded workspace above ordinary app panels; native modal dialogs
remain in the browser top layer and battlefield labels stay isolated.

The floating viewport toolbar provides **Restore View**, camera reset, native
fullscreen, and DM map/editor mode and local floor visibility controls. Existing
active-floor, grid (where authorized), zoom and tactical controls remain available.
Players receive only their permitted floor list and view controls. Mode changes
keep the same map workspace/Canvas. Restore does not change map/editor mode.

**Browser fullscreen** requests the Fullscreen API on the document root, which
also contains body-portaled dialogs. Denials or missing support leave expanded
mode active with an understandable status message. `fullscreenchange` observes
external exits, including Escape. Exiting native fullscreen leaves the expanded
viewport usable; Restore exits expansion and any native fullscreen owned by this
workspace. The viewport adds no Escape-key interception: existing editor
cancellation and native modal Escape behavior remain intact.

Layout/view/native fullscreen state is local React/DOM state, absent from saved
maps and multiplayer commands. React Three Fiber's existing ResizeObserver updates
the canvas dimensions/projection and pointer mapping. No renderer is replaced or
reparented, and no additional rendering dependency is introduced.

## Migration and deployment

Apply `server/migrations/010_floor_transitions.sql` using the normal migration job
before starting the updated backend. It only widens the two map version constraints
to accept 6. Existing map/combatant JSON, identifiers, asset files and references
are not rewritten. No additional configuration or storage service is required.
Continue using the existing persistent PostgreSQL and private asset volume.

Back up the database and assets together. Update server and browser assets as one
release and reconnect clients for a full snapshot. Older servers/clients cannot
read v6 maps; mixed old/new writers are unsupported. After v6 maps have been saved,
rollback requires the matching pre-upgrade backup rather than stripping metadata
or narrowing live constraints. Browser fullscreen depends on browser/platform
support and hosting permissions; viewport expansion remains the fallback. An
embedded deployment may require its host's fullscreen permission policy.

No production deployment is performed by this change.

## Manual acceptance

1. Load the existing Durrans Warehouse encounter in a test/staging environment.
   Verify warehouse/office geometry, images, scenery and token positions first.
2. Create each transition type. Pick endpoints on the warehouse and office,
   configure two-way/one-way and each movement policy, save, edit and delete.
   Test markers without a model, then choose a library model. Confirm the route
   remains functional if the visual cannot load.
3. Select a token on the source floor. Confirm an on-source transfer; check that
   HP, initiative, conditions and player ownership are unchanged. Follow it back
   through a two-way route, then verify a one-way route rejects reverse travel.
4. Try an off-source token and an occupied destination. Verify both warnings,
   unchecked blocking and explicit overrides. Confirm ordinary token stacking
   and manual floor transfers still behave as before.
5. Keep the office hidden from players and transfer into it. Verify players lose
   that token and never receive the hidden route, notes or model grant. Follow as
   DM without revealing it. Use the separate reveal action and verify two player
   browsers converge. Reconnect and join late after a transfer.
6. Save/reload a template, export/import an encounter and restart the backend.
   Verify routes, coordinates and token floor IDs. Undo/redo route changes, then
   delete/undo an unoccupied floor. Duplicate a floor and verify it has no copied
   connections and no dangling endpoints.
7. Start a calibration/transition/scenery draft, move and zoom the camera, choose
   a floor/token, then Expand/Restore repeatedly. Verify the same scene/camera,
   selection and uncommitted values. Toggle map/editor mode while expanded.
8. Enter native fullscreen, exit with browser Escape/controls, and restore normal
   layout. Simulate a denied fullscreen request; expanded mode must remain usable.
   Open Add Object and transfer dialogs while expanded/native-fullscreen. Verify
   layering, focus containment, Escape and blocked background map interactions.
9. Resize to a smaller laptop and tablet viewport; test landscape/portrait, touch
   controls, floor selection, wall/object placement and marker picking. Check that
   toolbars and inspector can be reached without horizontal page overflow.
10. Expand only one viewer's map and verify the other browser's layout/camera and
    the encounter revision do not change. Verify players have no DM editor,
    visibility-reveal or travel controls and no unauthorized grid command.

## Automated coverage and remaining limits

`shared/transitions.test.ts` covers all types, validation, one/two-way travel,
remote/occupied overrides, state preservation, permissions, hiding, history,
floor lifecycle and round trips. The PostgreSQL/Socket.IO floor-image integration
suite adds scoped model grants, transfer/reconnect, private-note filtering,
templates, export and reference retention. `e2e/vertical-navigation-acceptance.ts`
extends the existing authenticated three-floor browser workflow, preserving real
authentication rate limits. It exercises actual native fullscreen/external exit,
denied-request fallback, Escape/modal behavior, camera/scene identity, calibration
drafts, canvas resizing, picked endpoints, warnings, follow, hidden transfer,
player controls and local-only expansion.

Movement rules, automatic traversal, cross-map travel, damage, physics, lighting
and fog remain out of scope. Native fullscreen availability varies by platform;
physical tablet/touch/GPU acceptance remains manual. Optional transition models
use a basic unit presentation; independently placed scenery remains available for
more detailed staircase visuals. Existing map history byte/frame retention limits
and asset loading retry behavior remain unchanged.

## Changed areas

- `shared/transitions.ts`: bounded transition/location schemas and direction
  resolution; `shared/dungeon.ts`: v6 validation and committed transition edits.
- `shared/domain.ts`: atomic DM travel command, public projection and secondary
  floor import-coordinate preservation.
- `server/scenery.ts`, `server/game.ts`: protected optional model references and
  visible-route download grants; migration 010 accepts map version 6.
- `src/TransitionsPanel.tsx`, `src/newTransition.ts`, `src/Transitions3D.tsx`,
  `src/TransitionTravel.tsx`: editing, markers, model adapter and confirmation.
- `src/DungeonBuilder.tsx`, `src/DungeonScene.tsx`, `src/BattleMap3D.tsx`,
  `src/App.jsx`: existing editor/scene integration and mode switching.
- `src/useMapViewport.ts`, `src/map-viewport.css`: local mounted expansion,
  browser fullscreen, inert background, responsive controls and restoration.
- Shared transition tests, the existing floor-image integration suite and the
  existing three-floor browser workflow extended through
  `e2e/vertical-navigation-acceptance.ts` cover the new behavior.

## Validation results

Validated on 29 October 2026:

- `npm test`: 102 passed; 3 existing infrastructure skips (Caddy availability and
  PowerShell). No failures.
- Complete PostgreSQL/Socket.IO suite: 59 passed, including nested transition
  metadata/model authorization, transfer, reconnect and persistence coverage.
- Complete Playwright suite against the compiled backend: 17 passed (5.7 minutes).
  The expanded three-floor workflow verifies real browser fullscreen/external
  exit, denied-request fallback, mounted scene/camera identity, unsaved calibration,
  native modal stacking, actual GLB selection through the resized canvas,
  endpoint picking/cancellation, transfer overrides/follow and hidden-player state.
- `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`: passed.
- Existing frontend bundle-size warning remains. Physical tablet/touch/GPU testing
  remains part of manual acceptance.

The test database, local test servers and generated credentials/assets were
removed after validation. Production and live encounters were not modified.
