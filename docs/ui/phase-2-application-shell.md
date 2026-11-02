# Phase 2 — application shell

**Date:** 1 November 2026. **Baseline:** `1874215`. **Scope:** migration-plan 2A–2C, authorized by the user's Phase 2 request. The user reports Phases 0/1 deployed; this work does not deploy or independently verify that production release. Phase 3 is not started.

## Architecture and relocated controls

The two-row shell composes existing state owners instead of adding a router, global encounter store, socket or backend command. `ApplicationShell.tsx` defines the shared A/B presentation. `Multiplayer` owns global/account/campaign/session/presence callbacks; the local or DM `App` contributes encounter actions and the existing view state. There is exactly one visible App bar and Session bar in desktop Table recipes. The retained hidden local App has its own inactive Session bar; it is not a duplicate active navigation surface.

| Zone | Actual implementation |
| --- | --- |
| A1 | One Encounter Ledger brand; brand and Table return from asset management without resetting the table/view. |
| A2 | Table mode action menu calls the existing local/multiplayer mode setter and remembered play-mode behaviour. Players retain this public mode switch through Account. |
| A3 | Libraries opens existing Combatant Library or 3D Asset Library. Current-table Map templates opens the existing editor's template section for a local table or active DM encounter, without a new global template service. Unavailable account libraries and future destinations are omitted. Global management does not reuse an abandoned selected-combatant copy draft; entity Save to Library keeps its explicit draft path. |
| A4 | Text connection status, connected player count while the transport is connected, Help/keyboard reference and Account (sign-in, rejoin, sign-out as permitted). The help sheet lists implemented shortcuts and gestures; it does not bind the mockup's proposed shortcut set. |
| B1 | Existing campaign and encounter selectors. Encounter selection still changes the campaign's shared active encounter. Campaign/encounter creation, rename, JSON browse/drop/import and other preparation forms move into the retained Campaign setup drawer. |
| B2 | Round and truthful Local/Live/Inactive state. No new pause semantics. |
| B3 | Tracker / Battle map / Map editor for local and DM. Player Tracker is the existing permitted read-only character sheet; Battle map reuses the retained player canvas. No player editor. |
| B4 | Players popover shows permitted presence. DMs can reach invitations, assignment, visibility, HP sharing, revocation and token edit forms in the setup drawer. |
| B5 | Existing checkpoint save/restore list, Start/End session, campaign setup and player management, encounter import/export and Clear. End session and Clear are deliberate, separately named operations with confirmation. |
| B6 | Add combatant split action: existing stat-block importer and, for DMs with encounter context, library selection. Next turn retains initiative progression and empty/disconnected guards. |
| C2/C1 entity action | Previously loose model/library/campaign-state buttons now use a selected Combatant actions menu on the tracker sheet or map roster. Their existing forms, callbacks and per-character save semantics remain. This small relocation removes chrome; sheet/roster redesign remains Phase 4. |

`DMSetupPanel` retains its validation, upload/drop handling, permission switches, invitation expiry/clipboard fallback, checkpoints and edit forms. Its former summary/header/collapse row is removed. The shared Phase 1 Drawer gains an optional scoped class, allowing a wider setup form without changing other callers. Setup stays mounted when closed, and closes explicitly rather than on ordinary multiplayer snapshots. Campaign switching retains the existing campaign-keyed form reset boundary. The obsolete collapse preference is left untouched in storage; it is not encounter data and does not drive the new overlay.

## Modified-file map

| Files | Purpose |
| --- | --- |
| `src/ApplicationShell.tsx`, `src/application-shell.css` | Shared App/Session bars, role-aware navigation, help, presence and responsive shell styling. |
| `src/Multiplayer.tsx`, `src/App.jsx`, `src/DMSetupPanel.tsx` | Existing authority/state owners supply shell callbacks; setup forms move into the retained drawer and encounter/entity entry points relocate. |
| `src/DungeonBuilder.tsx`, `src/BattleMap3D.tsx`, `src/useMapViewport.ts`, `src/useTacticalTools.tsx` | Retained workspace lifetime, template-section navigation and visibility/fullscreen/keyboard guards. |
| `src/ui/Drawer.tsx`, `src/ui/tokens.css`, `scripts/ui-tokens.test.mjs` | Scoped drawer sizing, dark shell tokens and contrast checks. |
| `e2e/application-shell.spec.ts`, `e2e/shell-helpers.ts`, updated existing specs/helpers | New shell/retention coverage and existing workflows adapted to their relocated entry points, including the library-management draft regression. |
| `docs/ui/` | Actual feature locations, canonical guideline/migration updates, this report and 13 reproducible captures. |

## State and permission contracts

- REST/CSRF, schema versions, database migrations, asset references, backup/deployment configuration and all server-side projections/authorization are unchanged. There are no new dependencies.
- Existing command adapters, acknowledgement/receipt guards and the single socket/session owner remain authoritative. Menu, help, setup and library navigation do not join/restart the session or save campaign state.
- Opening/closing setup, menus and help retains the map renderer and current floor/tool/selection. Asset management hides the existing table instead of replacing it. The map-template navigation adapter opens the current editor section, preserving the existing map/editor component identity and draft owners.
- Phase 2 deliberately extends the old R06 lifetime boundary to meet the requested view-state preservation: each App lazily creates one map workspace and retains it behind Tracker, keeping its last map/editor mode, camera, floor, selection and draft owners. Hidden workspaces pause resize observation and keyboard handling; returning measures the viewport in place. This retains at most one map per table, not a scene per view. Player map/Tracker and ended-session retention also keep the player canvas mounted.
- Player chrome omits DM library, session, add/next, ownership and editor controls. The player sheet uses the existing projected own/public information; placeholder private HP/AC values are not displayed as statistics. Presence uses the same permitted member list as before.
- Clear confirmation now names the actual existing command's full scope: combatants, map, positions and combat state. It does not change that command. Explicit per-character Save to Campaign remains an entity action; there is no bulk save.

## Responsive and accessibility choices

A/B stay 56/64px on the tested desktop and narrow layouts. Long campaign/encounter names use constrained native selectors with full accessible values and title text. Below 1100px the campaign selector becomes a menu and view labels compact; below 800px Views becomes a menu and player management remains reachable through Session. At phone widths Add uses a compact menu, Next uses a labelled icon, and campaign/setup access remains in Session. Player campaign/presence and Account remain available without DM menus. Menus clamp within the viewport using Phase 1's shared pipeline.

All new shell targets use the Phase 1 40px control baseline, native button semantics and visible focus. Drawers/dialogs remain native modal top-layer surfaces. Menus use the Phase 1 action-only keyboard behaviour; forms remain in popovers/drawers. Notifications and pending placement are overlays rather than extra permanent rows; pending placement remains above an expanded map. Existing canvas docks, inspector sections, map tools and camera shortcuts are not regrouped in this phase.

## Verification and acceptance

[Role captures](phase-2-baseline/README.md) record 13 real-app views at desktop, tablet and phone widths, using synthetic data and blocked external fonts. Each records visible 56/64px bars and no document-width overflow.

| Check | Result |
| --- | --- |
| `npm test` | 108 passed; 3 existing infrastructure skips (Caddy image/daemon and unavailable PowerShell checks). |
| `npm run test:integration` against disposable PostgreSQL | 71 passed, including authorization, private media, library/campaign persistence, restart and multiplayer lifecycle. |
| `npm run lint`, `npm run typecheck`, `npm run build` | Passed after the final source changes; existing large-client-chunk advisory retained. |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- --reporter=line` | **27 passed (9.6 minutes)** in one complete post-recovery run, with standard timeouts and authentication limits. |
| Reference/document integrity | Original 12 reference hashes unchanged; local UI document links and diff whitespace checks pass. |

The final complete browser run passed after execution-environment recovery. New `e2e/application-shell.spec.ts` covers visible two-row geometry at 1440/1280/1024/768/390/320, menu/Escape/focus, local state across mode switches, initiative round wrap, exact import/export entry paths, and canvas identity across Tracker, help/menus/current-table templates. Existing browser workflows now navigate through semantic shell entry points in `e2e/shell-helpers.ts`; their domain, projection, coordinate and model assertions remain.

The existing DM setup test additionally verifies retained unapplied form input, canvas identity, no revision/socket changes on drawer toggles, player menu restrictions and player map/Tracker retention. Existing library/model tests retain import-once placement, model assignments, asset-management return and actual rendered-model checks. The full suite remains the regression gate for late joins, reconnect, floor transitions, fullscreen and permissions.

Manual review before release:

1. Local: switch views, use Session import/export/Clear confirmation, Add stat block and Next turn through round wrap. Return from Table/brand and from Libraries → current-table templates without a data mutation.
2. DM preparation: sign in with no campaign. Open Campaign setup; create/rename a campaign, create/import an encounter by file and drop, generate/copy/revoke an invitation, assign tokens and toggle HP/visibility. Close/reopen while an unapplied input is present.
3. DM live: invite two players and a late joiner; save a checkpoint, mutate and explicitly restore; end/start and change encounters/campaigns. Verify expected shared activation and waiting state. Open asset/combatant libraries and return to the same table.
4. Player: check own/public details, hidden monster protection, permitted movement and presence; no DM controls. Switch read-only Tracker/map and use Account to return to Local tracker and Multiplayer.
5. At desktop, 1280px, tablet/phone, short landscape and actual 200% browser zoom, operate everything by keyboard and touch. Check focus restoration from menus to nested dialogs, narrow menu bounds, long names and recovery errors. Repeat with a screen reader and supported Firefox/Safari; Chromium automation does not certify those browsers or physical touch.

Rollback is a code revert; no schema rollback, media migration or storage clearing is required. No deployment or Phase 3 work is included.

Responsive shell testing caught and corrected a 320px Help-button cascade conflict. The Help sheet remains reachable through Account when its direct button is hidden. Player chrome explicitly retains narrow-screen campaign and presence access because players do not have the DM Session overflow menu. Existing small-screen canvas dock collisions remain Phase 3 scope; the Phase 2 shell does not regroup those controls.

The retained player map pauses its global Escape handlers while Tracker or the waiting state is active. This prevents a shortcut in another surface from discarding a hidden tactical draft; the DM setup regression verifies a sphere draft survives Tracker → Escape → Battle map. This is a visibility guard for existing handlers, not a new shortcut registry or binding.

The existing handlers additionally check their owning workspace’s live DOM visibility at event time, alongside the active-context flag, rather than relying solely on passive-effect cleanup. The tactical-draft assertion uses the select’s accessible combobox name.

Retained map visibility also releases expanded/native-fullscreen state and background inertness when leaving the map or receiving an ended player session. Regression coverage exercises both navigation and the remote-session path. The existing standalone player viewport now clips off-stage labels and hints and omits its unused DM control track; tools/docks themselves are not regrouped.

The final library regression also opens a selected-combatant copy draft, closes it, and then opens A3 management without a stale draft. No library write is made by that navigation.
