# Feature-to-zone preservation matrix — Phase 0

**Baseline:** `0a2aedf`, reviewed 31 October 2026. **Status:** proposed destinations, not implemented UI. Each existing control family below must remain discoverable before its old entry point is removed. Repeated rows of characters, floors, assets or invitations are represented by a family; every named field/variant within a family must survive. Read this with the [audit](ui-audit.md) and [migration plan](ui-migration-plan.md).

## Phase 1 adoption

A13–A15 retain their existing E4 entry points and behaviour, now using scoped foundation styles, shared Button and a text assignment pill. X01 gains nested cancel isolation and explicit modal Tab wrapping; X03 retains existing permission/busy gating; X07 gains a text-only model/placeholder cue. Foundation menus/popovers also join the existing keyboard-overlay guard. No other matrix destinations were relocated. See [Phase 1 contracts and tests](phase-1-foundations.md).

## Legend and rules

- **L** = standalone local mode; **D** = authenticated DM in owned context; **P** = permitted player. **P-own** means ownership/visible-floor restrictions still apply. Anonymous entry is **A**. Role availability does not override connection, busy, preview or resource constraints.
- **UI** = local presentation; **Draft** = local until explicit apply/share; **Command** = existing local domain command or online revisioned WebSocket command; **API** = current authenticated HTTP operation. Local template persistence is explicitly marked as data.
- A1 brand, A2 mode, A3 table/libraries, A4 connection/account/help; B1 campaign/encounter, B2 round/session state, B3 view, B4 presence/players, B5 session/data menu, B6 Add/Next turn.
- C1 roster, C2 sheet/3D stage/library workspace, C3 inspector; D1 levels/view, D2 active interaction hint, D3 workspace/fullscreen/history, D4 tool palette, D5 camera/shared display controls, D6 scale.
- E1 entity context, E2 menu/flyout, E3 large form drawer, E4 native dialog/picker/confirmation, E5 transient notification. Destinations such as “B5 → E3” include both trigger and form. Large library management occupies A3 → C2; selection remains B6 → E4. These are presentation addresses, not new URL routes.
- Critical errors retain an inline status/alert at their owning form or A4; E5 is supplementary. E1 may duplicate a contextual entry but must use the same handler/permissions.

## 1. Entry, account, campaign, session and membership

Owners: [Multiplayer](../../src/Multiplayer.tsx), [DMSetupPanel](../../src/DMSetupPanel.tsx); backend [app](../../server/app.ts), [game](../../server/game.ts).

| ID | Existing feature / control family | Who | Proposed zone / entry | Scope and preservation requirement |
| --- | --- | --- | --- | --- |
| S01 | Local tracker / Multiplayer mode buttons; remembered play mode; invite-hash entry | A,L,D,P | A2; invite entry in C2/E4 | UI. Do not force sign-in to use local demo. If A2 is omitted in the player recipe, retain Local tracker and return-to-Multiplayer in A4; this public local workflow is not a DM privilege. |
| S02 | Brand and current encounter title | All | A1, B1 | Display. One brand; do not turn the brand into an encounter reset. |
| S03 | DM email/password sign-in | A | A4 → C2/E4 | API. Preserve autocomplete, validation, CSRF/session bootstrap and error text. |
| S04 | Create DM account; closed-registration message | A | A4 → C2/E4 | API. Only expose registration when server capability allows it. |
| S05 | Invitation redemption: display name, Join campaign, expiry/single-use guidance | A | C2/E4 entry | API. Preserve URL hash and one-use token behaviour; no account requirement for players. |
| S06 | Sign out (DM and player) | D,P | A4 → E2 | API. Clear role/context/access and sensitive resource scope. |
| S07 | Connected/Reconnecting/Disconnected status; player count | D,P | A4 | UI from socket/presence. Keep textual state, not only colour. |
| S08 | Refresh/rejoin; offline/reconnect/acknowledgement errors | D,P | A4 → E2; persistent A4 status | Existing socket callbacks. No buffered writes or false “saved” confirmation. |
| S09 | Waiting for encounter/session start; ended session; access-revoked state | P | B2 + C2 waiting state, A4 recovery | Projected session. Do not show retained hidden map content while inactive. |
| S10 | Campaign select / active campaign | D,P | B1 → E2 | D lists owned campaigns; P sees permitted membership context, no mutation controls. |
| S11 | Campaign create and name field | D | B1 → E3 | API. Retain no-encounter preparation. |
| S12 | Rename campaign; campaign name field | D | B1 → E3 | API. Retain current limits/validation. |
| S13 | Campaign encounter/member/online counts | D | B1/E3 summary, B4 | Display, from existing details/presence. |
| S14 | Encounter select/open | D | B1 → E2 | API. This changes the campaign's shared active encounter, not only the DM's local view. |
| S15 | Blank versus Import JSON encounter source | D | B1 → E3/E4 | API. Both must remain available without a live session. |
| S16 | New encounter name, create/import action, JSON browse/drop/remove file | D | B1 → E3/E4 | API. Preserve file validation and map/combatant import; keep keyboard upload as well as drop. |
| S17 | Start multiplayer session / End session | D | B5 → E2; B2 state | API toggles active/inactive. Do not relabel as a new Pause state. End/restore implications need explicit confirmation policy. |
| S18 | Save session/checkpoint (expanded and summary entry points) | D | B5 → E2 | API. A checkpoint is separate from normal auto-persisted edits and template saves. |
| S19 | Saved sessions list: revision/date, Restore save, empty state | D | B5 → E3 → E4 confirmation | API. Preserve current replacement confirmation and live refresh. |
| S20 | Setup expand/collapse, summary campaign/encounter/round, focus return; auto-collapse on map-open | D | B1/B5 → E3; B1/B2/B4 summary | UI. Existing `ledger.setup.collapsed` preference must not be mistaken for campaign state. |
| S21 | Presence rows/avatars: names, online/offline, assigned token summary | D,P (per existing recipe) | B4 → E2/popover | UI data permitted by session rules. No DM mutations for P. |
| S22 | Invite player/new link, Copy, select-link fallback, copied status | D | B4 → E2/E3 | API + clipboard. Preserve fresh single-use link and expiry; do not add resend semantics. |
| S23 | Pending invitations, expiration display, revoke invitation | D | B4 → E3 | API. Keep pending versus redeemed/revoked/expired distinctions. |
| S24 | Past invitations list/status/time | D | B4 → E3 | Read. Not a public member directory. |
| S25 | Revoke member access with confirmation | D | B4 row menu → E4 | API. Preserve server revocation/disconnect and ownership checks. |
| S26 | Token table All/Party/Enemies filters and counts | D | B4 → E3 ownership panel | UI. Separate from active-floor roster filtering. |
| S27 | Controlled by: unassigned/DM or active campaign membership | D | B4 → E3; C3/E1 contextual link | Command `token.assign`. No automatic assignment from library identity. |
| S28 | Visible to players toggle; exact HP shown/private toggle; pending switches | D | B4 → E3, C3 selected combatant | Commands. These are distinct server policies; owner HP remains permitted. |
| S29 | Token table health/progress and current side/role/AC | D | B4 → E3 | Read. Keep useful management summary when moving setup off the page. |
| S30 | Token edit form: name, initiative, maximum HP, DM notes, Update combatant | D | C2/C3 combatant menu → form; E3 ownership link | Command. Clamp current HP as today; notes stay private. This is the existing edit surface, not a complete character builder. |

## 2. Tracker, encounter data and combatant creation

Owner: [App](../../src/App.jsx), plus DM token edit above and [shared domain](../../shared/domain.ts).

| ID | Existing feature / control family | Who | Proposed zone / entry | Scope and preservation requirement |
| --- | --- | --- | --- | --- |
| T01 | Tracker / 3D Map / Map editor view buttons | L,D | B3 | UI. Preserve map/editor parent identity; audit Tracker's current unmount boundary before extending lifetime guarantees. P has no DM editor. |
| T02 | Round and active turn | L,D,P display | B2, C1 | Active is server combat state; selected is local UI. |
| T03 | Next turn and round wrap | L,D | B6 | Command `initiative.next`. Disable when empty/disconnected as appropriate; no automatic Space binding. |
| T04 | Clear encounter | L,D | B5 Danger → E4 | Command. Keep confirmation; clarify that current implementation clears encounter state/environment as well as combatants, despite current wording. |
| T05 | Import encounter JSON into current encounter | L,D | B5 → E4 | Command `encounter.restore`. Separate from creating a new encounter from a file (S16). Preserve compatibility and artwork rules. |
| T06 | Export encounter JSON, filename/round, embedded artwork online | L,D | B5 → E2 | Local export or authenticated export API; preserve complete map, floors, transitions, supported overlays and combatants. |
| T07 | Export/import success/failure messages and dismiss | L,D | Owning surface + E5 | Preserve persistent/recoverable errors, not toast-only failure. |
| T08 | Empty encounter call-to-action; Add combatant dialog | L,D | C2 empty state + B6 → E4 | UI form. Keep empty state discoverability. |
| T09 | Paste plain-text stat block; parser/example | L,D | B6 → E4 | Same parser in `shared/statBlock.js`; no new scraping/API. |
| T10 | Imported initiative override/auto, quantity 1–20, Ally/Enemy side | L,D | B6 → E4 | Command `combatant.add`; preserve independent IDs, naming and current active-floor creation. |
| T11 | Choose from Combatant Library shortcut in Add dialog | D | B6 → E4 library picker | At most two activations to reach selection; keep return context. |
| T12 | Initiative list: scores, names, short/portrait, HP bar, active/down/selected markers | L,D | C1 | Read + UI selection; do not equate selection with advancing turn. |
| T13 | Heroes standing / combatants down summary | L,D | C1 footer | Derived display. Hidden narrow-screen summary needs another accessible location if considered essential. |
| T14 | Selected sheet: name, side, role, AC, speed, portrait | L,D; P permitted subset | C2; C3/E1 subset | Never render player-projected placeholders as real stats. |
| T15 | Artwork upload/change/remove from portrait or action buttons | L,D | C2 combatant menu → E4 | Existing image size/MIME handling, authenticated stored references and export embedding. |
| T16 | Duplicate combatant | L,D | C2/C3/E1 entity menu | Command; persistent identity duplicate prevention still applies. Explicit library override is distinct. |
| T17 | Remove combatant | L,D | C2/C3/E1 Danger | Command; confirm policy decision must not lose or silently change current immediate removal. |
| T18 | HP display/bar; amount ± field; Damage / Heal | L,D | C2; optional E1/C3 adapter | Commands. Add accessible ± names, keep min/max behaviour; no player HP writes. |
| T19 | Conditions: current chips/remove, Add condition, supported list and applied state | L,D | C2; C3 form | Commands; supported picker: Blinded, Charmed, Frightened, Grappled, Poisoned, Prone, Stunned. Imported condition strings remain preserved. No duration automation. |
| T20 | STR/DEX/CON/INT/WIS/CHA values and modifiers | L,D; P-own display | C2 | Preserve existing interpretation of `saves` data; do not introduce rolls/stat changes. |
| T21 | Arbitrary imported details (skills/senses/languages/challenge etc.) | L,D; P-own display | C2 | Full supported data, not just mockup's compact fields. |
| T22 | Traits/actions/reactions: name/category/text, Mark used / Reset | L,D; P-own display only | C2 | Existing `ability.toggle`; used state is encounter-specific and not a new recharge engine. |
| T23 | At-a-glance other-combatant cards and selection | L,D | C2 below sheet | Preserve permitted HP/AC and empty/limited-card behaviour. |
| T24 | Player selected-character details/artwork/actions or limited public description | P | C2 or permitted C3 | Existing direct player recipe; no full DM Tracker implied by B3 mockup. |

## 3. Canvas navigation, roster, display and recovery

Owners: [BattleMap3D](../../src/BattleMap3D.tsx), [useMapViewport](../../src/useMapViewport.ts), [FloatingObjectToolbar](../../src/FloatingObjectToolbar.tsx), [ToolbarProjection](../../src/ToolbarProjection.tsx).

| ID | Existing feature / control family | Who | Proposed zone / entry | Scope and preservation requirement |
| --- | --- | --- | --- | --- |
| V01 | Active-floor initiative rail/list, Expand/Collapse roster, names/conditions/initiative/HP | L,D,P permitted | C1; narrow map trigger D1 | UI. Current map roster is floor-scoped; Tracker is not. Provide a Tracker trigger without relying on D1. |
| V02 | Select token from roster or 3D token; active/selected labels | L,D,P | C1/C2/E1 | UI; labels/selection must not leak hidden floors or change turn. |
| V03 | Move selected token by clicking square | L,D,P-own | C2; D4/E1 entry | Existing `token.move`; local/permission/active-floor bounds still enforced. “Move token” is currently selection, not a separate movement mode. |
| V04 | Token context Select / Move token / Appearance, property summary, dismiss | L,D,P subset | E1; C3 optional property adapter | Existing callbacks. Show HP only if owned or explicitly shown; Appearance is not a player control. |
| V05 | Orbit/pan/wheel/pinch/touch camera; Reset camera, Top-down, Zoom −/+ | L,D,P | C2 gestures + D5 | Local camera only; preserve independent participant/preview cameras. No existing 100% zoom value to invent. |
| V06 | Grid toggle; label toggle | L,D; P display only today | D5 | Shared commands, not local camera preferences. Floor image grid uses image-specific state. |
| V07 | Scale readout: feet per square, width × height; feet-per-square form | L,D edit; P read | D6 | Existing `map.settings`. Do not change token coordinates/elevation conversion when changing ruler scale. |
| V08 | Active/visible floor dropdown, name/elevation, single/stacked view | L,D,P permitted | D1 | UI. Only single and stacked exist; inactive stacked floors must not take raycasts. |
| V09 | Hide/show floor locally and expanded Visible floors list | L,D (existing entries) | D1 → E2 | UI visibility, separate from server `playerVisible`. |
| V10 | Expand Map / Restore View | L,D,P | D3 | In-place workspace expansion, scroll/inert restoration; preserve Canvas/drafts. |
| V11 | Browser fullscreen / exit; unavailable/denied/error fallback | L,D,P | D3 → E2 | Native document fullscreen plus independent expanded state. Do not replace with canvas-only fullscreen or F11 emulation. |
| V12 | Expanded map/editor toggle and Show/Hide map inspector | L,D | D3 | UI; same editor and draft owners, contextual access remains reachable when A/B are absent. |
| V13 | Encounter tracker return button | L,D | B3; expanded D3 exit/navigation | Remove duplicate only after B3 or expanded navigation remains reachable. |
| V14 | Active gesture hints / no revealed level / no combatants messages | L,D,P permitted | D2 + C2 empty/permission states | One transient hint, but persistent access/error states must remain separately visible and announced. |
| V15 | Model loading/unavailable, failure detail, Retry model, safe placeholder | L,D,P permitted | Entity inline status near E1/C2; persistent error | Reuse SharedModel3D/cache/binary grant paths; do not replace all model recovery with E5. |
| V16 | Floor texture loading/error and Retry floor image | D,P authorized | C2 inline status; C3 image link | Existing FloorImage3D recovery. Keep ownership/context checks and placeholder floor. |
| V17 | Object toolbar anchoring, viewport clamp, hidden when off-camera, Escape/dismiss/focus return | L,D,P subset | E1 | Existing projection/lifecycle. Keyboard popup semantics must not turn a property form into a menu-only widget. |

## 4. Editor tools, selections, reusable maps and generation

Owners: [DungeonBuilder](../../src/DungeonBuilder.tsx), [DrawingSurface](../../src/DrawingSurface.tsx), [SceneryProperties](../../src/SceneryProperties.tsx), [ArchitectureProperties](../../src/ArchitectureProperties.tsx), [CalibrationFields](../../src/CalibrationFields.tsx).

| ID | Existing feature / control family | Who | Proposed zone / entry | Scope and preservation requirement |
| --- | --- | --- | --- | --- |
| M01 | Select editor tool; per-floor selected object; Escape cancel/clear selection | L,D | D4; E1/C3 | UI. Keep direct geometry, sparse-object and logical-edge hit areas. |
| M02 | Paint floor and erase floor | L,D | D4 Floor/Erase | Command. Stone, wood, dirt, grass, lava; preserve multi-cell paint gestures. |
| M03 | Single wall placement/selection; stone/wood material | L,D | D4 Wall → E2; C3 Active tool | Command. Logical grid edge stays authoritative regardless of chosen visual. |
| M04 | Wall-line drag | L,D | D4 Wall → E2 | One batch command on release; previews/cancel remain local. |
| M05 | Rectangle room drag; Walls only option | L,D | D4 Wall/geometry flyout; C3 Active tool | Includes floor generation unless Walls only; do not reduce to a wall visual feature. |
| M06 | Corridor drag; corridor width, floor/wall material, opening previews | L,D | D4 Wall/geometry flyout; C3 Active tool | Preserve batch/undo semantics and red removed-edge preview. |
| M07 | Door placement on existing edge; open/closed/locked defaults and edits | L,D | D4 Door; C3/E1 | Command; retain error when no wall exists and Open/Close/Unlock/Lock variants. |
| M08 | Built-in object picker, category/search/source filters, preview, initial rotation 0/90/180/270 | L,D | D4 Object → E4; C3 Active tool | Reuse unified Asset Library picker; local mode must retain built-ins without a server asset account. |
| M09 | Uploaded GLB scenery selection/placement ghost; repeated placement | D | D4 Object → E4; C3 Active tool | Stable asset ID/defaults; do not copy binaries. |
| M10 | Snap scenery to grid; placement rotation/scale/vertical offset | L,D as applicable | C3 Active tool | Draft placement settings; fractional positions remain supported where allowed. |
| M11 | Wall/door visual choice, built-in fallback and selected-entity appearance | D GLB; L,D built-in | C3 Active tool/Selection → E4 | Reuse role-filtered picker. Applying visual must not alter logical wall/door topology. |
| M12 | Architectural calibration: grid span, authored facing ±Z/±X, centre/start/end alignment, scale, vertical/horizontal offset, rotation correction, reset, preview/apply | D (asset assignment), existing local visuals | C3 Selection; E4 extended calibration | Draft vs committed calibration; no second fitter/loader. |
| M13 | Selected built-in object Move / Rotate / Scale / Duplicate / Delete / Properties | L,D | E1; C3 Selection | Preserve snapped movement, quarter-turn rotation and explicit scale apply. |
| M14 | Selected scenery X/Z, rotation input/slider, scale, vertical offset, player-visible flag; apply/reset/move/duplicate/delete | L,D where present | E1; C3 Selection | Draft/Command. Keep ownership/revision/floor keys and fractional transforms. |
| M15 | Selected wall apply current material/visual, choose/remove GLB, calibration, remove; selected door state/appearance/remove | L,D as applicable | E1; C3 Selection | Different wall/door commands and logical hit targets stay distinct. |
| M16 | Scenery/props list, count, select by list; selection auto-open/focus properties | L,D | C3 This level → Scenery/Selection | Preserve non-pointer way to choose placed objects. |
| M17 | Inspector map/floor/elevation title, template comparison, map revision, Save map | L,D | C3 header | Explicit reusable-template save, not deferred saving of all already-persisted edits. |
| M18 | Inspector Hide / reopen / Collapse all; Active tool/Selection/Scenery/Floor sections | L,D | C3; D3 reopen | UI. Keep state owners mounted; actual tool/floor/revision invalidation still applies. |
| M19 | Undo map edit / Redo map edit and availability | L,D | D3 | Existing map-history commands; do not apply combat HP history or install shortcut semantics implicitly. |
| M20 | History menu Clear map history with confirmation | L,D | D3 → E2 Danger → E4 | Existing operation; no user-visible recent-edit timeline currently exists. |
| M21 | New blank map: map name, width/height, confirmation/replacement | L,D | C3 Map → File/templates (or E3) | Command. Preserve combatants and deterministic valid placement handling; do not silently resize across invalid tokens. |
| M22 | Template name, saved-map selection/list and revisions; Open saved map | L,D | C3 Map → File/templates; A3 contextual entry | D campaign API; L `ledger.dungeon.templates.v1` **data**. Load is a copy; confirmation preserves independence. |
| M23 | Save new map template; Overwrite selected template with confirmation | L,D | C3 template action; E3 large form | Preserve template revision and encounter revision checks; distinguish new from overwrite. |
| M24 | Rename / Duplicate / Delete saved template | L,D | Template entity menu E2/E3 → E4 for delete | Not encounter rename. Deleting template leaves encounter copies intact. |
| M25 | Generation theme: stone-dungeon/cavern/mining-outpost; width/height, room count/min/max, seed | L,D | C3 Map → Generate dungeon (E3 if needed) | Local configuration. Retain actual schema limits and supported theme identifiers. |
| M26 | Preview dungeon; Regenerate with new seed | L,D | C3 generation | Draft. Preview must not broadcast or create history until accepted. |
| M27 | Accept generated map with replacement confirmation; Cancel generation | L,D | C3/E3 generation + E4 | Command on accept; preserve combat stats/templates and preview error handling. |
| M28 | Invalid drawing feedback, blocked/busy/disconnected/preview errors | L,D | D2 gesture; C3 inline status/alert | Keep errors actionable; no invalid geometry commit or click-through from palette/forms. |
| M29 | Current editor shortcuts V/F/W/D/O/E; Delete and Shift+D for selected GLB scenery | L,D | D4 shortcut hints; A4 help reservation | Existing listeners, not a new application-wide registry. Preserve typing/modal/connection guards. |

## 5. Levels, floor images and transitions

Owners: [DungeonLevelsPanel](../../src/DungeonLevelsPanel.tsx), [FloorImagePanel](../../src/FloorImagePanel.tsx), [TransitionsPanel](../../src/TransitionsPanel.tsx), [TransitionTravel](../../src/TransitionTravel.tsx), [BattleMap3D](../../src/BattleMap3D.tsx).

| ID | Existing feature / control family | Who | Proposed zone / entry | Scope and preservation requirement |
| --- | --- | --- | --- | --- |
| F01 | Select/Edit floor; name/elevation/primary-floor summary; single/stacked view | L,D | D1; C3 This level → Levels | View is local; current edit target must be explicit. |
| F02 | Show floor locally | L,D | D1 → E2; C3 Levels | UI. Not equivalent to revealing the level to players. |
| F03 | Edit level name, elevation, Visible to players; Apply level settings | L,D | C3 Levels | Command. Preserve absolute elevation and server projection. |
| F04 | Add blank level: name/elevation/width/height | L,D | C3 Levels | Command; existing floor count/dimension limits. |
| F05 | Duplicate level | L,D | C3 level menu → E2 | Command; new scoped IDs and default hidden-player behaviour remain. |
| F06 | Delete level and confirmation / transfer-first error | L,D | C3 level Danger → E4 | Preserve occupied-floor, minimum-one-level and history rules. |
| F07 | Transfer combatant: choose combatant/destination floor/X/Z | L,D | C1/E1 combatant menu → E3/E4 | Existing `combatant.floor.transfer`, not a map-template change. Keep direct coordinate alternative and bounds checks. |
| F08 | Floor-image upload/replace via browse/drop; PNG/JPEG/WebP/size rules | D | C3 Floor image → E3/E4 if large | API. Requires map and authenticated upload context; preserve errors and persistent references. |
| F09 | Uploaded image select/reuse, preview thumbnail, Delete unreferenced image | D | C3 Floor image → E3/E4 asset selection | Image records are distinct from GLB assets/templates; deletion restrictions must remain visible. |
| F10 | Upload progress / processing / cancellation / retryable errors | D | Owning upload form; optional E5 success | Keep cancellation and late-response safety on closing/switching. |
| F11 | Image gridded/gridless mode; transform lock | L,D existing image settings | C3 Floor image | Draft. Printed grid mode and tactical grid policy must not be conflated. |
| F12 | Map width/height; image contain/cover, centre/top-left fit/alignment | L,D existing image settings | C3 Floor image or E3 calibration | Preserve shrinking/reconciliation validation and field limits. |
| F13 | Offset X/Z, scale, quarter-turn rotation; Reset calibration | L,D existing image settings | C3 Floor image or E3/E4 | Draft in current level; preserve coordinate conventions and lock semantics. |
| F14 | Image opacity; show tactical grid over image | L,D | C3 Floor image; D5 grid adapter | Apply commits shared state; not a local display preference. |
| F15 | Preview calibration / Cancel calibration / Apply floor image | L,D | C3/E3 image calibration | Preview is local and may temporarily resize scene; cancel restores saved version without broadcasting. |
| F16 | Remove floor image / restore procedural floor | L,D existing image | C3 image entity action | Existing command. Remove assignment differs from deleting shared image bytes. |
| F17 | Existing transition list; New transition / selected transition | L,D | D4 Link entry; C3 This level → Transitions | UI/draft. Requires two floors; keep named transition list and endpoint-pick state. |
| F18 | Transition type/name, source/destination floors and X/Z, Pick endpoint on map | L,D | C3 Transitions + D2 picking hint | Draft across floors; changing floors must not drop the opposite endpoint. |
| F19 | Transition directionality; movement cost; DM notes | L,D | C3 Transitions | Command on save. Costs are descriptive, do not consume movement/actions; notes must not enter player projection. |
| F20 | Choose/remove optional transition GLB model | D choose; L,D existing removal | C3 Transitions → E4 | Stable asset reference with existing access rules; no duplicate model management. |
| F21 | Save transition / Delete transition with confirmation | L,D | C3 Transitions; Danger → E4 | One map edit, existing undo/redo and floor-reference validation. |
| F22 | Transition markers and Floor transitions list; selected combatant / Move through transition | L,D use; P projected display | C2 marker/E1; D1 → E2 list | Retain traversal reachability after collapsing roster/inspector. P does not receive a traversal mutation control. |
| F23 | Travel confirmation: destination/floor/cost, allow remote source, allow occupied destination, follow combatant, confirm/cancel | L,D | E4 | Command with independent explicit overrides. Destination hidden warning is essential. |
| F24 | Reveal destination floor during travel confirmation | L,D | E4 contextual action | Separate shared level-visibility command; travel itself must not reveal the floor. |

Transition types currently include stairs, ladder, trapdoor, pit and portal; preserve the exact existing enum through the UI (see `shared/transitions.ts`). Avoid changing persisted identifiers to match decorative icons.

## 6. Tactical tools and overlays

Owners: [useTacticalTools](../../src/useTacticalTools.tsx), [TacticalScene](../../src/TacticalScene.tsx), [shared tactical rules](../../shared/tactical.ts).

| ID | Existing feature / control family | Who | Proposed zone / entry | Scope and preservation requirement |
| --- | --- | --- | --- | --- |
| O01 | Open/close Ruler & tactical templates drawer; Select/navigate; Cancel tool/Escape | L,D,P | D4; C3 Active tool (or E3 narrow) | UI/draft. Player play-tool palette must remain available. |
| O02 | Ruler left-drag and measured distance | L,D,P | D4 Ruler, D2 hint, C2 overlay | Draft first. Mockup two-click interaction is not implemented. |
| O03 | Measurement rules: Euclidean, diagonals=1, alternating diagonals | L,D,P | C3 Active tool | UI/draft. Use configured feet per square, not hard-coded 5ft. |
| O04 | Presets: 20ft sphere, 15/30ft cone, 15ft cube, 60×5ft line | L,D,P | D4 Template → E2; C3 Active tool | Preserve supported shape options and presets. |
| O05 | Shape-specific radius/length/width/side/angle; rotation/elevation; colour/opacity | L,D,P-own | C3 Active tool (E3 if needed) | Validated local draft, explicit apply/share. |
| O06 | Shared overlays selector and owner labels; select on canvas | L,D,P | C3 overlay list; C2/E1 | Visible-floor filtered; existing ownership, counts and expiry rules apply. |
| O07 | Move / Rotate / Resize-properties / Delete local overlay | L,D,P | E1; C3 Active tool | Local draft unless selected shared record; existing pointer cancellation/coordinate bounds. |
| O08 | Share with encounter / Apply overlay changes | L,D,P-own | E1/C3 | Command; connected/permission guards and stale-overlay conflict remain. |
| O09 | Unshare to local / Delete shared overlay | D or P-own | E1/C3 entity menu | Command. Keep difference between deleting shared record and retaining a local preview. |
| O10 | Clear shared overlays | D (L DM actor where supported) | D4 Clear → E2 explicit scope | Command; not erase geometry, history clear or cancellation. Player must not see this global clear action. |
| O11 | Two-minute shared ruler expiry; durable shared templates; local-only preview labels | L,D,P display | C2/E1/C3 status | Persistence/lifetime semantics, not a new timer UI requirement. |
| O12 | Offline preview and blocked share status; invalid dimensions/conflict recovery | L,D,P permitted | C3 inline alert/status, A4 network | Preserve local preview while shared mutation is unavailable; do not silently retry/publish. Standalone Share changes only the local encounter, not network participants. |

## 7. Combatant Library and persistent character state

Owners: [CombatantLibrary/CampaignStateSave](../../src/CombatantLibrary.tsx), [App placement](../../src/App.jsx), [library API](../../server/combatant-library.ts), [server execution](../../server/game.ts).

| ID | Existing feature / control family | Who | Proposed zone / entry | Scope and preservation requirement |
| --- | --- | --- | --- | --- |
| C01 | Account library access before a campaign/encounter; Close library | D | A3 → C2 management / E4 existing wrapper | API. Management must not require starting a live session or opening an encounter. |
| C02 | Search; category filter; campaign/general/all filter; Show archived | D | A3 library workspace controls | UI + API data; retain ownership, type and campaign distinctions. |
| C03 | Entry list/select/details; current/default stats/actions/portrait/model ID, created/updated dates | D | Library C2; optional C3 details | No wholesale library data to players. Stable ID is separate from instance ID. |
| C04 | Create entry; name; Player Character / Named NPC / Monster Template; campaign/general; notes | D | Library C2/E3/E4 | API revisioned write. Keep stable UUID for retries. |
| C05 | Text stat-block import and Parse import | D | Library entry import E3/E4 | Reuse parser; preserve model assignment unless explicitly changed. |
| C06 | Combatant JSON file import; complete stat-block/portrait-reference JSON editor | D | Library C2 details or E3 | Supported format; not a general private D&D Beyond API integration. |
| C07 | Assign/change default model; current model settings; save entry | D | Library entity menu/C3 → E4 | Reuse MiniatureSettings/Asset Library. Draft miniature save and library save remain distinct until intentionally redesigned. |
| C08 | Save library entry / error/revision conflict | D | Library entry action + inline status | API, not live instance rewrite. Never imply unsaved editor draft is what Add will instantiate. |
| C09 | Duplicate entry; Archive/Restore entry; archived state and filter | D | Library entry E2 menu | API. Archive is the existing deletion policy; existing encounters remain valid. |
| C10 | Save selected encounter combatant to new library entry | D | C2/C3/E1 combatant menu → E4 | Copies supported definition/appearance; live damage/conditions use separate explicit campaign-state save. |
| C11 | Update source entry from selected combatant | D | Combatant/library contextual action → E4 | Preserve source GLB default rather than copying an incidental instance override automatically. |
| C12 | Use saved campaign state versus full/default state | D | B6 → E4 add picker | Per persistent character; monster additions are independent snapshots. |
| C13 | Allow duplicate persistent character override | D | B6 → E4 add picker | Explicit opt-in; ordinary additions/duplicate button must not bypass identity check. |
| C14 | Add to Encounter — choose square; pending placement/cancel | D | B6 → E4 → C2 with D2 | Existing library command with stable instance ID, encounter scope, active floor and grid point. Pending hint must remain visible in expanded map. |
| C15 | Add to tracker only; later place selected combatant | D | B6 → E4, C1/C2 | Preserve `unplaced` and instance independence; tracker-only additions must not become visible tokens due to layout changes. |
| C16 | Save to Campaign: saved-state read, current HP/max HP, choose long-term conditions, explicit action/status | D | C2/C3/E1 persistent combatant menu → E4 | Separate `library.state.save`, expected campaign-state revision, no initiative/position/floor saving and no ordinary combat autosave. |
| C17 | Missing/deleted default model placeholder, saved/full modes across encounters/campaigns | D creation; P permitted result | Picker inline status; C2 instance recovery | Preserve server fallback, scoped NPC restrictions, monster reuse and explicit campaign-state boundaries. |

## 8. 3D Asset Library, model pickers and previews

Owners: [AssetLibrary](../../src/AssetLibrary.tsx), [MiniatureSettings](../../src/MiniatureSettings.tsx), [AssetPreview3D](../../src/AssetPreview3D.tsx), [CalibrationFields](../../src/CalibrationFields.tsx).

| ID | Existing feature / control family | Who | Proposed zone / entry | Scope and preservation requirement |
| --- | --- | --- | --- | --- |
| A01 | Account Asset Library; Return to encounter | D | A3 → C2 management | Preserve hidden table/mounted workspace where currently retained; opening management is not sign-out or encounter switch. |
| A02 | GLB file browse, name, category, description, tags, source, Upload model | D | Library workspace/E3 upload | API, existing validation/limits. Categories: miniature, monster, furniture, architecture, terrain, decoration. |
| A03 | Upload progress, validating status, cancel, errors | D | Upload form + persistent status | Preserve in-flight cancellation and server validation; E5 only supplements success. |
| A04 | Search assets, category filter, Refresh library, Previous/Next page, count/loading/no results | D | Library C2 controls | API. Preserve paging and detail refresh, not a static grid of mock assets. |
| A05 | Asset card select and detail: filename/size/format/status/validation/geometry/upload date | D | Library C2/C3 | Read. Existing placeholders are not automatic generated thumbnails. |
| A06 | Edit name/category/description/tags/source; Save asset metadata | D | Library C3/E3 | API with revision checks. Asset record edits differ from individual placements. |
| A07 | Default scale, rotation, vertical offset, display name | D | Library C3 | Asset presentation defaults; do not rewrite existing instance appearances. |
| A08 | Architectural role scenery/wall/door/other and full calibration/reset | D | Library C3; E4 extended editor | Preserve authored-facing/alignment/edge-fitting semantics and preview. |
| A09 | Delete asset and confirmation/reference-in-use error | D | Asset E2 Danger → E4 | API; do not remove references to make deletion “work.” Library-only missing references must still fall back safely. |
| A10 | Independent 3D preview, orbit/pan/zoom, Reset preview camera, loading/render failure | D | Library C2/C3/E4 | Keep preview-specific bounds/camera/material/texture pipeline and lifetime; do not reuse the battlefield camera. |
| A11 | Picker: Use this model / Cancel selection; optional role filter/calibration | D | E4 from entity/C3 tool | Selection mode intentionally omits full asset upload/management; retain separate return callback. |
| A12 | Unified Add Object: all/built-in/uploaded source, built-in search/category/preview, Use built-in object (crate, barrel, chest, table, chair, pillar, torch, rock, anvil, brazier) | L,D | D4 Object → E4 | Preserve procedural objects and uploaded assets without duplicate asset-management functionality. |
| A13 | Miniature settings: assigned model/name/unavailable status, Browse Asset Library, close | D | C2/C3/E1 entity action → E4 | Same component supports library default versus encounter override through its callback. |
| A14 | Miniature scale/rotation/vertical offset; base Small/Medium/Large/Huge; Show base | D | E4 miniature form; C3 appearance summary | Draft then apply. Base is visual; movement still uses one anchor cell. |
| A15 | Save miniature / Restore placeholder token; model preview | D | E4 | Encounter appearance command or library-draft callback, never update both silently. |

## 9. Cross-cutting controls, recovery and interaction

| ID | Existing feature / control family | Who | Proposed zone / entry | Scope and preservation requirement |
| --- | --- | --- | --- | --- |
| X01 | Native dialog close/Escape/backdrop policy; nested asset/model pickers | All permitted | E4 | Preserve browser top layer, event isolation and focus restoration; inner close must not cancel outer work unexpectedly. |
| X02 | Existing native confirm for encounter/map replacement, checkpoints, template/asset/floor/transition/history deletion and revocation | Authorized actor | Owning action → E4 | Migrate deliberately; per-square erase is an undoable gesture, not an irreversible-file-delete dialog. |
| X03 | Busy/disconnected/unauthorized/unavailable/preview gating | All | Owning controls; A4 + inline status | Hide unauthorized controls, disable explained temporary unavailability. Do not queue offline shared commands. |
| X04 | File validation, malformed import, unavailable media, stale revisions, uncertain acknowledgements | All permitted | Owning inline alert + A4; E5 supplementary | Preserve recovery and confirmation of server state; no automatic campaign overwrite/retry after timeout. |
| X05 | Mouse/touch pointer capture, drag cancel and camera gesture hints | L,D,P permitted | C2/D2/D4 | Keep navigation/edit modes separate and inactive floors noninteractive. |
| X06 | Local collapse preferences versus local templates versus server state | L,D,P context | A4 preferences reservation; owned surface | `ledger.playMode`, `ledger.setup.collapsed`, local map-template data and proposed `ledger.ui.*` are not interchangeable. Do not delete data during a preference migration. |
| X07 | Selected/active/down/side/HP-sharing/status text and ARIA cues | All permitted | C1/C2/C3/E1/B2/A4 | Keep textual/non-colour equivalents and restricted statistics, even when compacting to icons. |

## 10. Mockup-only items, ambiguities and justified guideline corrections

These are **not existing features to implement under the guise of preservation**. Reserve addresses where useful; additions need explicit approval and tests.

| Proposal item | Current reality | Recommended disposition / possible address |
| --- | --- | --- |
| Pause/Resume / Paused pill | Only live/inactive start/end exists; ending withholds player snapshot | Keep truthful B2/B5 Start/End semantics; design true pause separately. |
| Encounter rename | No corresponding endpoint/control | Do not ship a nonfunctional B1 item. Separate scoped feature. |
| Resend invitation | New single-use invite + revoke exist, no resend operation | B4 “Create new invitation” uses existing callback; do not imply token reuse. |
| Bulk Save combatants to campaign | Explicit per-character save with conditions/revision only | Preserve C16; batch selection/partial conflict semantics require separate design before B5. |
| New blank encounter combatant / direct JSON Add | Blank creation is in library; JSON import is in library or encounter import, not an independent encounter Add form | Keep those entry paths honest; a later B6 adapter is feature work. |
| Full stat-block editing of arbitrary encounter character | Current DM edit covers name/initiative/max HP/notes; library has complete JSON editor | Preserve both scopes. Do not claim a new character builder exists. |
| Temp HP / condition duration / recharge engine | No dedicated supported state or automation | Remove as mandatory mockup targets; separately design commands/schema if requested. |
| Manual roster sort/reorder | Initiative sort/turn progression exists, no arbitrary reorder action | Keep C1 order; no decorative clickable sort button. |
| Standalone global Map templates page | Campaign/editor-scoped templates + local storage; images separate | A3 may expose contextual management first. Deep-linkable aggregation needs navigation/context design. |
| Player-view preview | No authorized player-preview mode | Do not implement with CSS filtering of a DM snapshot. Later server projection design; D3 reservation. |
| Recent edit timeline / last-edit timestamp | Undo/redo depths and private persisted history exist, no timeline contract | Keep D3 undo/redo/clear. No invented names/timestamps/history broadcast. |
| All floor mode | Single/stacked plus local visibility exist | D1 only supported modes; do not serialize a new enum value. |
| Separate Move mode | Select-then-click token movement exists | E1/D4 adapter may select a token; a new interaction state needs review. |
| Freehand Draw / unspecified Clear | Only existing geometric editor drawing and tactical templates/ruler | No generic P Draw tool. Name each Clear scope using O10/M20/T04. |
| Two-click ruler / Shift straight | Actual ruler is left-drag; no general Shift-straight modifier contract | Keep current gestures/instructions until intentionally changed/tested. |
| Link and Image tools/shortcuts | Transitions and floor-image forms exist; no L/I keyboard tools | D4 shortcuts may open those existing panels later; do not invent image-drag or path-link gestures. |
| Preferences/help/shortcut sheet | No implemented pages or unified shortcut registry | A4 reserved; implement only specified presentation/settings, never a second authoritative state store. |
| 100% zoom label | Camera zoom buttons exist; no defined percentage origin | Omit numeric percentage until a meaningful camera-specific reference is specified. |
| F11 label for native fullscreen | Browser F11 and document Fullscreen API have different ownership/exit behaviour | D3 uses existing native request; do not advertise interception of F11. |
| Model-assigned/source-linked badges | Data exists, badges are not current UI | Optional permitted derived display in C2; never show library identity metadata to players. |
| Every undoable delete requires modal | Current gestures/history rely on immediate edits | Decide reversible-action policy, retain confirmations for destructive/irreversible cases. |
| Exactly one accent button per view | Mockup shows Next turn + Save map + active tool; component rules disagree | One primary action per action group; distinguish selection, side and danger from primary hierarchy. |
| No canvas resizing | Responsive layout necessarily changes size | Allow in-place resize; prohibit unnecessary root/renderer recreation and verify projection. |
| Roster trigger solely D1 below 1100 | Tracker has no D docks; players use a different view recipe | Provide C1/B3-associated Tracker trigger and role-safe D1 on map. |
| General preparation without an encounter | Libraries work without encounter; persistent map editor currently needs active encounter context | Preserve no-live-session preparation; do not claim unsupported no-encounter map editing. |
| Fog of war/LOS/effects/party presets/public sharing | Reservations only; no corresponding implementation in this audit | Future separate feature requests, not Phase 1 scope. |

## Traceability and review use

Sources above cover all current user-facing component families, including dialogs, library/picker variants, player-only entry/waiting/detail views, editor inspector subcomponents, scene loading/retry controls and transient error states. Schemas/backend APIs are used to verify each capability; backend-only support is not counted as a visible control. During implementation, annotate the rows touched by each PR and record desktop, narrow, expanded and player verification. A row is complete only when the replacement is reachable, correctly scoped, keyboard usable and retains its existing data/permission behaviour.
