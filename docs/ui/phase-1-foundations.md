# Phase 1 — shared UI foundations

**Authorized:** the user's “move on to phase 1” request, 31 October 2026. **Scope:** migration-plan steps 1A and 1B. Phase 2 navigation/shell work is not included. The Phase 0 audit and screenshots remain historical evidence of commit `0a2aedf`.

## Implemented scope

`src/ui/tokens.css` defines namespaced semantic colours, fonts, spacing, radii, focus, target size and overlay layer values. `controls.css` styles only foundation classes and the first adopted surface. The supplied mockup CSS and background are not runtime dependencies. Existing font fallbacks remain usable when external font requests fail.

The existing **Miniature settings** dialog is the first adopted surface (matrix A13–A15, E4). It uses shared buttons, form surfaces and an assignment-status pill. Its stat/model data, asset picker, preview pipeline, draft state, callbacks, permissions and save commands retain their existing owners. An encounter override and a library default still use their respective existing callbacks. No component keys, scene hierarchy, navigation, persistence schemas, migrations, APIs or dependencies were added or replaced.

## Modified-file map

| Files | Purpose |
| --- | --- |
| `src/ui/tokens.css`, `controls.css`, `index.ts` | Scoped design values/styles and public foundation exports. |
| `src/ui/Button.tsx`, `StatusPill.tsx`, `Menu.tsx`, `Popover.tsx`, `FloatingSurface.tsx`, `InspectorSection.tsx`, `Drawer.tsx` | Reusable semantic controls and internal overlay implementation. |
| `src/MiniatureSettings.tsx` | First production adoption, preserving its draft/data callbacks. |
| `src/Modal.tsx`, `modalState.ts` | Retained closed drawer support, nested cancel isolation, focus containment and keyboard-overlay guard. |
| `scripts/ui-tokens.test.mjs`, `e2e/ui-foundations.spec.ts`, `e2e/miniatures.spec.ts`, `e2e/fixtures/ui-foundations.*` | Contrast and behavioural regression coverage without a production fixture route. |
| `docs/ui/` | Phase 0 reference/audit pack, updated adoption/status notes, this report and Phase 1 captures. The Phase 0 capture script also declares its browser-evaluation globals for lint. |

## Component contracts

| Component | Contract |
| --- | --- |
| `Button` | Native button with forwarded native props/ref. Defaults to `type="button"`; form submission must opt into `type="submit"`. Minimum 40×40px, wrapping labels, visible focus, readable disabled styling. Primary, secondary, danger and ghost variants. |
| `SplitButton` | Primary button and separately named menu trigger; opening the menu never invokes the primary action. |
| `StatusPill` | Required visible text, semantic colour variants. `announce` opts into status announcements; decorative repetition does not create multiple live regions. It conveys state and does not grant permission. |
| `Menu` | Action-only menu of named buttons. Arrows/Home/End, typeahead, native Enter/Space activation, disabled skipping, Escape/outside dismissal, trigger focus return and Tab exit. Forms belong in `Popover` or a modal. Group text is presentational. Disabling a trigger closes its menu. |
| `Popover` | Labelled, nonmodal form/information dialog. Initial focus enters content; Tab is not trapped; Escape/outside dismisses. Content unmounts when closed, so callers must own drafts that need retention. |
| `InspectorSection` | Native details/summary, labelled content region, uncontrolled default or caller-controlled expansion. Children remain mounted while collapsed. |
| `Drawer` | Controlled modal wrapper around the existing native `Modal`, with heading, close control, scrolling body and optional footer. Children remain mounted when closed. Keep draft ownership outside the wrapper; wrapper closure performs no domain operation. Nonmodal inspector content uses `InspectorSection`/`Popover`. |

`FloatingSurface` is internal shared positioning/keyboard code. It uses the native Popover API top layer where available, and a scoped fixed-position portal fallback otherwise. Surfaces are clamped to the viewport and repositioned on resize/scroll/content resize; nested forms portal inside their owning native dialog. Escape dismisses only the top transient surface and defers to a newer native dialog. Pointer events do not bubble through to map ancestors. An outside dismissal consumes its pointer-up/click gesture as well, so it cannot paint the scene; activate an outside control with a subsequent gesture. Callers remain responsible for authorization, action errors and destructive confirmation policy.

The existing `Modal` now optionally remains mounted while closed, prevents nested cancel events from cancelling an outer dialog, and explicitly wraps Tab within its own visible controls. Default existing modal callers remain open until unmounted. `modalState.isModalOpen()` also recognises open foundation surfaces so existing capture-phase editor shortcuts do not run behind them. No new global shortcut bindings were introduced.

## Colour and accessibility boundaries

Muted normal text uses `#625b50` rather than the proposal's failing small-text combinations. Token tests calculate WCAG luminance and require 4.5:1 for supported text/surface pairs and 3:1 for control boundaries/focus on supported opaque surfaces. Status always includes text. These checks cover the new foundation tokens; they do not certify all legacy UI or arbitrary translucent scene overlays.

Browser coverage exercises keyboard navigation, default button semantics, focus return/containment, nested Escape, disabled menus, the non-native-popover fallback, retained drawer/inspector drafts, reduced motion and four widths. CSS `zoom: 2` is a reflow check, not a substitute for actual browser zoom or assistive-technology testing. Manual screen-reader, physical touch, Firefox/Safari and native browser 200% zoom review remain acceptance tasks before broad rollout.

## Verification

See [surface captures and reproduction notes](phase-1-baseline/README.md). `e2e/ui-foundations.spec.ts` adds six focused tests through a dev-only fixture at `e2e/fixtures/ui-foundations.html`; the fixture is not a production route or build entry. It also mounts the existing local application for a real canvas identity/camera test. The existing `e2e/miniatures.spec.ts` test reuses its synthetic textured GLB and authenticated DM to check the real miniature/asset-picker cancellation workflow: no encounter mutation, new game command, socket reconnect, canvas replacement or camera reset.

| Check | Result |
| --- | --- |
| `npm test` | 108 passed; 3 existing infrastructure skips (Caddy image/daemon unavailable and two PowerShell checks unavailable). The final run used the local Docker context outside the restricted subprocess sandbox. |
| `npm run test:integration` with disposable PostgreSQL | 71 passed, including private assets, library/campaign persistence, projections, restart and multiplayer permissions. |
| `npm run lint`, `npm run typecheck`, `npm run build` | Passed. Build retains the existing large-chunk advisory; no dependency or build-entry changes. |
| Reference/document integrity | All 12 archived reference hashes and local Markdown file links verified; Diff whitespace checks passed for authored files; byte-preserved reference HTML contains original trailing whitespace and is excluded from that check. |

The initial combined browser run passed 24 of 26 cases. One existing multi-floor case exhausted its 120-second test budget near the final player fullscreen assertion; the new standalone online case hit the existing authentication request limit. Its assertions now extend the existing miniature test instead, retaining coverage without another account or any server-limit change. The current suite contains 25 cases (six new foundation cases). The final isolated command `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- e2e/levels.spec.ts e2e/miniatures.spec.ts --reporter=line` passed **2/2 in 2.1 minutes**, using the unchanged default timeout and a fresh local backend with no competing browser jobs. This verifies the updated online assertions and the previously timed-out case. All **25 current cases** have passed across the full and focused runs; a second complete suite run after restructuring was not performed. No grid assertion, production auth limit or test timeout was relaxed. Existing role/media projection, multiplayer and floor-placement tests remain regression gates; new primitives never read a broader state payload.

## Manual acceptance

1. In an owned online encounter, open Miniature settings from a combatant. Confirm current assignment, model preview and unavailable-asset messages. Browse the Asset Library, cancel, and verify the miniature draft survives. Change scale/rotation/base and save; reopen and verify saved appearance. Restore a placeholder and check that the existing command still applies.
2. Repeat the miniature workflow when editing a Combatant Library default. Confirm saving changes the library draft/default through its existing workflow, without silently rewriting active encounter instances. Verify a player cannot access DM model-management controls.
3. At 1440, 1280, 768 and 390px, then actual browser 200% zoom, Tab through the miniature form and nested picker. Confirm every field/action is reachable, labels wrap, and focus is visible. Escape should close only the top layer. Check font-offline and reduced-motion settings.
4. For future adopters, run the dev fixture: menus support arrows/Home/End/typeahead; split primary/menu actions stay separate; drawer focus stays modal; closed/reopened drawer and inspector keep drafts. With a map tool active, Escape in a surface must not change that tool or paint the map.
5. Repeat representative checks with a screen reader and physical touch device; record browser/device and findings before migrating additional surfaces.

## Rollout and rollback

This is an incremental foundation change with one production form adoption. Other controls retain their existing presentation and workflow. No data migration or deployment action is required. Reverting the foundation imports/adoption and shared modal changes restores the former presentation without touching encounter/library/map records. Phase 2 requires its own scoped work and regression evidence.

## CI follow-up — floor-image scenery placement

The reported CI timeout at the player model-ready check did not reproduce in three unmodified local runs. The test used an unchecked viewport mouse click immediately after choosing a model, without first verifying that scenery placement was active and enabled. The floor-image test now waits for picker dismissal, the selected asset's enabled placement fields and the active object tool. A shared `clickBattlefield` helper retains live-camera projection but uses a canvas-relative locator click with Playwright input/actionability checks. The test then requires exactly one persisted asset at `{x:12,z:5}` before independently requiring the player's ready marker. It never retries a placement click, relaxes coordinates/counts or increases timeouts.

The renderer-readiness regression now includes a blocking overlay and requires exactly one correctly located canvas gesture after dismissal. A negative-control run using the old unchecked mouse dispatch failed because the overlay received that gesture. The updated floor-image and helper cases passed three repeats each (6/6); the strengthened helper regression was also rechecked separately. Lint and type checks passed. This is test synchronization and failure-stage isolation, not proof of a reproduced production GLB-loading defect. Application code, permissions and the shared model pipeline are unchanged; the full 25-case suite was not repeated for this test-only follow-up.
