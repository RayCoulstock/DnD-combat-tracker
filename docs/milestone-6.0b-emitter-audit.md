# 6.0B emitter audit — 5 November 2026

## Finding: merged PRs did not reach main

Verified remote `main` is `80c2e5735f6eb84731368e6953b37fee282de353`, containing 6.0A only. `git show origin/main:src/DungeonBuilder.tsx` has no Lighting tool or LightingSourcesPanel. The B/C functionality exists and is implemented; it is absent from the production source branch.

GitHub confirms:

| PR | Result | Actual base | Merge commit |
| --- | --- | --- | --- |
| #42 — A | Merged 5 Nov 07:49:56 UTC | `main` | `80c2e57` |
| #43 — B | Merged 5 Nov 07:50:14 UTC | `feature/milestone-6-0a-lighting-foundations` | `effef60` |
| #44 — C | Merged 5 Nov 07:30:46 UTC | `feature/milestone-6-0b-point-lights` | `ed2eb52` |

B was merged into A **after** A had already been merged into main. GitHub does not carry subsequent changes to an already-merged feature branch into main. C reached B, then A, but neither reached main. A merged PR badge is insufficient evidence of production inclusion.

`publish.yml` publishes approved main images; `deploy-production.yml` requires a manual dispatch on main and production-environment approval. This audit verifies source ancestry, not the currently running production image/digest. Production was not accessed or deployed. Environmental settings without emitter controls match main's A-only source.

The repair branch integrates the existing complete B/C feature history with current main, preserving scenes rather than reimplementing or cherry-picking fragments. It must be reviewed against **main**. Merging this branch and releasing it remain separate operations; neither is performed by this audit.

## Exact controls on the integrated build

Only the DM has Map editor/D4 editing controls. A loaded map is required.

| Zone/location | Exact label | Function |
| --- | --- | --- |
| B3 view switcher | **Map editor** | Enter the existing editor |
| D4, scrollable left canvas tool palette | **Lighting** (accessible name **Lighting tool**, sun icon) | Select lighting; now reveals C3, clears unrelated object selection and focuses Light preset |
| C3 → Editing → Selection → Point lights | **Light preset** | Torch, Lantern, Candle, Magical crystal, Campfire, Generic coloured light |
| Same | **Add light on map** | Arm placement, then click a square on the active level; D2 shows the placement hint |
| Same | **Add light at level centre** | Keyboard-friendly creation; coordinates can then be edited numerically |
| Same, active-level source list | **Torch · Enabled** (plus **· Attached** when appropriate) | Select an existing light; other names follow the same format |
| Canvas, DM editor only | Small coloured/wireframe sphere | Select an emitter while using Lighting or Select; now reveals C3 and focuses Light name |
| C3 → Selection → Light properties | **Light name**, **Light colour**, **Light intensity**, **Light radius**, **Light X/Z**, **Light height (feet)** | Edit retained draft values; intensity/radius also have sliders |
| Same | **Attach light to** | Select a scenery option `Level name · Object label` or `Combatant · Name`; no attachment is the standalone option |
| Same, attached draft | **Light offset X/Z**, **Light offset height (feet)** | Local position offset, rotated/scaled with the parent |
| Same | **Light enabled**, **Cast point shadows**, **Subtle flicker**, **Flicker strength/speed** | Appearance options; quality/reduced-motion limits still apply |
| Same | **Apply light** | Validate and commit the complete draft |
| Same | **Reload saved light** | Discard the draft in favour of committed values |
| Same | **Move light on map** | Move an independent light by clicking a new square |
| Same | **Detach light** | Detach at the resolved world position |
| Same | **Duplicate light**, **Delete light** | Independent source ID / confirmed removal |
| D3 | **Undo map edit**, **Redo map edit** | Existing map history, one entry per committed light operation |
| D5 | **Rendering quality** | Viewer-local budgets/flicker preference; does not alter map data |

Attachments are configured **on the light**, not in the GLB Asset Library or miniature-assignment dialog. GLB objects/miniatures need not contain embedded lights. The preset configures an emitter; it does not insert a torch GLB.

### Visibility, disabled states and the repaired access gap

The original B Lighting button changed tools but left a collapsed C3 inspector closed. The add buttons then existed only in a hidden inspector. Selecting a gizmo had the same problem. Both entry points now explicitly open C3 and focus their relevant field. The Selection accordion already forces itself open in Lighting mode. No extra toolbar or permanent row is added.

D4 is scrollable at constrained heights; Lighting may require scrolling down within that dock. Player roles intentionally have neither D4 Lighting nor C3 light editing. Offline/busy clients and generation/floor previews disable editing. Without a selected emitter, Light properties/attachment controls do not appear. Move is disabled for attached lights or unsaved drafts; Apply/Reload before detaching. Disabled/missing emitters, active-floor filtering and local quality budgets can affect illumination without deleting data. Only active-floor emitters render, including stacked view. Invisible/unplaced/missing parents are withheld from players.

## End-to-end trace

1. `src/DungeonBuilder.tsx`: D4 `activateLighting` and canvas `onSelectLight` reveal C3. Placement uses the existing EditorSurface hit coordinates and active floor, creates a stable UUID and sends `map.lighting.source.set`. No renderer/camera remount is introduced.
2. `src/LightingSourcesPanel.tsx`: source list and SourceProperties own the retained draft, validation, attachment selector and Apply. Selecting a parent stores its stable ID, scenery floor ID where relevant and a local offset. Other operations send `.source.duplicate`, `.source.remove` or `.source.detach`.
3. `shared/lighting.ts` and `shared/dungeon.ts`: strict bounded source/attachment schemas, at most 32 sources, map-level `lighting.sources`; normal map history and document normalization. Source edits are existing map commands, not a separate creation/persistence engine.
4. `shared/domain.ts`: `applyMapEdit` requires DM authorization; detach resolves the current world pose. `reconcileLightParents` derives fallbacks from committed parent transforms/movement and safely handles deletion. `projectEncounter`/`permittedLightSources` filter private/hidden data and replace source names with Light for players.
5. `server/game.ts`: the existing campaign authorization, transaction, revision/conflict checks and command receipts persist map JSON in `encounter_maps.document`, preserving history. Existing checkpoint/template/export paths include lighting. There is no SQL migration or binary duplication. Socket snapshots synchronize committed state; unchanged animation frames generate no commands.
6. `src/BattleMap3D.tsx` → `src/PointLights3D.tsx`: reuse the existing R3F scene/Canvas. `resolveLight` in `shared/lightingState.ts` uses parent grid position, rotation, scale, vertical offset and floor elevation. Separate Three.js PointLight objects follow these transforms. DM gizmos are editor-only; player scenes contain illumination without gizmos. Quality budgets, shadow disposal, local flicker and scene transition adapters remain unchanged.

## Documentation/design comparison

`docs/milestone-6.0-lighting.md` accurately described B/C feature-branch code but its delivery section described draft PRs, not eventual production inclusion. This audit records the actual merge ancestry and supplies the missing operational workflow. Canonical `docs/ui/ui-design-guidelines-v2.1.md` requires contextual C3 ownership, D4 tools, six fixed docks, keyboard operation, collapsible panels and hidden DM controls for players. The repair follows those rules and matches existing tactical-tool behaviour, which already opens its inspector. No guideline exception, new dependency, rendering engine, light rules or campaign-state change is needed.

## Acceptance workflow

On the updated build: DM → Map editor → scroll D4 if necessary → Lighting → choose Torch → Add light on map → click a floor square. C3 opens automatically. Select the new source in the Point lights list, or click its gizmo with Lighting/Select. In Light properties choose Attach light to → `Ground Floor · <GLB label>` or `Combatant · <name>`, adjust local offsets and click Apply light. Move/rotate the parent using its existing controls; the emitter follows. Use Save session (multiplayer checkpoint) and/or Save map; server commits already persist source changes. Reload (DMs reselect their campaign using the existing Campaign switcher), join as a player and verify illumination with no editing controls/gizmo. Apply or Reload drafts before using Detach light.

The new browser case creates the Torch through D4/C3, attaches it to a real uploaded GLB, moves and rotates that GLB through its existing inspector, saves a session, reloads both clients and asserts persisted attachment data and actual Three.js light position/colour/radius in the player renderer. It also asserts scenes, miniature assignment, HP and round are unchanged and player snapshots omit private scenes. The local source test covers collapsed-inspector reopening from both D4 and a gizmo, including focus placement.

## Validation on the repair branch

- `npm test`: 148 passed; three existing infrastructure guards skipped.
- PostgreSQL/socket `server/tests/lighting.test.ts`: seven passed (authorization, projection, history, attachment persistence, scenes and restart).
- Final serial browser run: six passed — workspace ownership/collapse/fullscreen, combatant inspector/drafts, real GLB attachment/player save-reload, quality/resource budgets, scenes/tablet form/focus, source/gizmo inspector access. Original 120s test and 15s assertion limits remain unchanged.
- `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`: passed. Existing client bundle-size advisory remains.
- The entire browser suite was not rerun for this small access repair; earlier full-milestone results in the original document are historical. Physical production image identity and device GPU performance were not checked. No runtime deployment, new migration or production data change occurred.
