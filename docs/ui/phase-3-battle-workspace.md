# Phase 3 — Battle Map workspace

Implemented on `feature/ui-phase-3-workspace`, following the 2 November 2026 request. Scope: map workspace UI only. Phase 4 and deployment are excluded.

## Architecture and control ownership

`BattleMap3D` now composes the C1 roster, existing C2 canvas and C3 inspector for both DungeonBuilder-backed DM/local maps and direct player maps. `DungeonBuilder` still owns all editing tools, selections, per-floor drafts, image/generator previews, map/template APIs and command dispatch. App still owns selected combatants, HP/condition handlers, model/library dialogs and pending library placement. Multiplayer owns the existing session and socket lifecycle. No server, shared schema, dependency, binary loading or deployment configuration changes are required.

| Address | Actual controls |
| --- | --- |
| C1 | Initiative order, selected/active indicators, permitted HP and conditions. Collapsed rail by default; optional remembered preference; D1 button under 1100px. |
| C2 | The same Canvas, scene, OrbitControls, tactical surfaces and existing projected object/token toolbar. |
| C3 Editing | Existing Active tool and Selection forms; retained Floor material entry. |
| C3 This level | Levels, Floor Image, Scenery, Transitions; existing validation, previews, asset pickers, revision and save rules. |
| C3 Map | Map file & templates, dungeon generation and New blank map. Explicit template save status is separate from encounter edits saved through existing commands. |
| C3 combatant | HP/condition controls reuse App callbacks; model/library/campaign-save actions reuse the existing entity menu. Transfer form moves out of the roster. Players receive permitted data and tactical editing only, with no DM mutation controls. |
| D1 | Active level, single/stacked view, optional local floor visibility and existing Floor transitions/travel entry. |
| D2 | One active-tool hint, including endpoint picking and library placement/cancel. |
| D3 | Undo/Redo/History, Map view menu: expanded/native fullscreen and inspector visibility; expanded map/editor switch. Restore View remains reachable without A/B. |
| D4 | Editor palette: Select, Floor, Wall flyout (segment/line/room/corridor), Door, Object, Link, Image, Erase. Existing tactics stay in a D4 flyout. Play: Select, Ruler, Template flyout, Settings. |
| D5 | Reset, Top-down, zoom, permitted shared grid/labels controls. |
| D6 | Active-floor dimensions, tactical feet-per-square and existing scale form. |

Phase 1 Button, Menu, Popover, InspectorSection and StatusPill are reused. `CanvasDock` is a small semantic, pointer-isolated slot wrapper. Menu's optional right-side placement uses the same viewport clamp, native popover/fallback and keyboard/focus lifecycle. InspectorSection adds optional UI-only preference keys; bodies remain mounted while collapsed.

## Preservation and deliberate deviations

- Canvas and OrbitControls stay in their original position and have no UI-dependent key. Roster/inspector toggles change available size; Fiber measures the existing canvas in place. Phase 2's retained workspace through Tracker and libraries remains.
- Editor inspector bodies remain mounted when moving to Battle map, closing the inspector or expanding the map. Existing revision/selection keys still invalidate stale entity drafts intentionally. No extra autosave of campaign character state is introduced.
- Desktop C3 is a column from 1440px. At laptop/tablet widths it overlays nonmodally, so map picking remains possible; collapse it to expose covered squares. Panels scroll internally. D4 stays in the left-centre slot; at short heights it scrolls instead of growing into camera controls. Narrow History retains undo/redo even when their direct buttons are hidden.
- Expanded mode preserves the inspector's current open/closed state. This replaces the old automatic hide-on-expand policy; explicit D3 collapse keeps state reviewable and avoids two inspector visibility owners. Native fullscreen still targets the document so native model/confirmation dialogs remain usable.
- Actual floor names and editor history need more width than the static mockup. D2 sits below the top corner docks; compact D3 moves down when necessary. No seventh floating toolbar is added. E1 object toolbar and transient E2 menus remain separate semantic surfaces.
- D1 retains labelled native level/view selectors. Level management remains in the editor's C3 Levels section. Supplemental Tactical tools and Floor material accordions preserve existing forms that are absent from the static mockup. Their state owners are retained rather than duplicated.
- No player preview, freehand drawing, new Move mode, all-floors enum, numeric zoom percentage, timeline or new backend behaviour is invented. Select-then-click movement, left-drag ruler, undoable drawing and current ownership rules are unchanged.
- Existing editor shortcuts are retained. `[`/`]` toggle roster/inspector and are listed in Help; field, modal, hidden-view, composition and modifier guards apply. Other proposed new shortcut bindings are deferred.
- `ledger.ui.map.rosterExpanded`, `ledger.ui.map.inspectorHidden` and `ledger.ui.inspector.*` store optional booleans only, with storage failures tolerated. Existing encounter records, local map templates, assets and campaign state are unchanged. No database migration is needed. Rollback requires reverting UI files only; the optional preference keys can remain harmlessly stored.

## Validation

| Check | Result |
| --- | --- |
| `npm test` | 108 passed; 3 existing infrastructure skips (Caddy validation and unavailable PowerShell checks). |
| `npm run test:integration` | 71 passed against disposable PostgreSQL, including private data, assets, authorization and multiplayer persistence. |
| Lint, type checks and build | Passed; existing large client-chunk advisory retained. |
| Final responsive/retained-view regression | **3 passed (43.1 seconds)** after final styling, including player tablet widths, scene/camera identity, permission guards and remote menu dismissal. |
| Complete browser regression | **29 passed (12.3 minutes)** in one complete run with standard timeouts and authorization limits. |

[Actual-app visual captures](phase-3-baseline/README.md) compare the hierarchy and control ownership against the approved references. No pixel equality with the mockup's decorative background is asserted. Existing browser fixtures retain exact grid/floor/model assertions and authorization limits. Use a fresh disposable development API for separate authenticated browser batches; normal registration limits remain enabled. New workspace tests check six dock bounds and non-overlap at 1600/1280/1024/768/390, canvas/camera identity, local HP/conditions, persistent collapse state and inspector draft retention. The DM/player fixture additionally checks player camera/scene identity and control access at 1280/1024/768, no revision writes on resize, role restrictions and menu dismissal on remote session end. Existing tests are adapted to the new menu addresses, rather than bypassing controls through new APIs. Floor-image tests open remembered sections idempotently; miniature hits project through the live camera and dismiss an adjacent context surface before testing a mesh. Player round assertions use the persistent B2 readout when C1 is collapsed.

## Manual acceptance

1. In local and multiplayer DM modes, open Map editor, create/load a map, draw wall segments/lines/rooms/corridors, paint/erase terrain, place doors and built-in/GLB objects. Inspect and transform them; undo/redo and clear history with confirmation. Confirm one gesture is one history edit.
2. Exercise all three C3 groups. Collapse individual sections and the inspector while a template, calibration, scenery or transition draft is edited; reopen, switch Battle map/Tracker and return. Check values remain unless the existing revision conflict rules invalidate them. Save a template, overwrite/duplicate/rename/load/delete and generate/cancel/accept a dungeon.
3. Upload/calibrate a floor image; preview, cancel, save, remove and retry unavailable media. Check image textures and GLB transforms remain correct while the canvas resizes.
4. Add/duplicate/hide/reveal floors, switch single/stacked/local visibility, transfer combatants and traverse a transition in both directions. Verify active elevation and exact destination. Check hidden floors/NPCs/DM notes in a player and late-joining player browser.
5. Select a token, use C3 HP/conditions and appearance, Save to Library and explicit Save to Campaign where supported. Move the token on the map; confirm it updates other clients while camera and panel preferences stay local. Test offline preview and reconnect/error recovery without queued mutations.
6. Expand/restore, enter/exit browser fullscreen (including denial), change editor/map mode, use nested native asset dialogs and check focus returns to the invoking control. Camera/floor/selection/tool/drafts and connection should survive.
7. Check 1600, 1280, 1024 and tablet widths, portrait and short landscapes, long level/map names and 200% browser zoom. Ensure all six docks remain reachable, D4 scrolls at short heights, panel forms scroll, and selected objects remain inspectable. Verify physical touch/pinch, reduced motion and Safari/Firefox fullscreen behaviour manually.
8. Keyboard through D1–D6, menus/flyouts and accordions. Escape closes only the top transient surface; editing shortcuts do not run in fields, menus/dialogs or hidden views. Inspect accessible names with a screen reader; this work does not claim a completed WCAG certification.

## Review map

- `src/BattleMap3D.tsx`, `src/battle-workspace.css`: shared workspace, docks, role-safe context surfaces.
- `src/DungeonBuilder.tsx`, level/image/transition panels: retained grouped inspector and palette adapters.
- `src/App.jsx`: existing combatant handlers exposed to C3; pending placement moved to D2.
- `src/useMapViewport.ts`: remove competing inspector hide/inert policy while retaining expanded/native lifecycle.
- `src/ToolbarProjection.tsx`: constrain E1 to the visible area between docks and the overlay inspector; context controls share the canvas stacking context below docks.
- `src/useTacticalTools.tsx`: expose existing ruler/preset callbacks to D4; settings remain in C3.
- `src/workspacePreferences.ts`, `src/ui/*`: optional UI preferences and small foundation extensions.
- Browser specs/helpers and `docs/ui/`: migrated entry points, regression coverage and actual-location documentation. No Phase 4 implementation.
