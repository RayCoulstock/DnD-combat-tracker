# Phase 4 — Tracker, libraries and polish

Implemented 2–3 November 2026 following the user's Phase 4 request. No deployment is included. This is a presentation refactor: commands, server projections, database schemas, migrations, import parsers, GLB storage and shared loading/resource ownership are unchanged.

## Completed work and control ownership

| Surface | Implementation and retained behaviour |
| --- | --- |
| Tracker C1 | Expanded initiative roster by default; independent remembered collapse preference. Initiative order, active turn, selection, side and permitted HP remain visible. Compact layouts expose an explicit roster toggle. |
| Tracker C2 | Combatant sheet is the primary workspace. Identity/art, HP, AC, speed, initiative, conditions, ability scores/saves, actions, descriptive text and notes retain existing data and callbacks. Action-use state is exposed with `aria-pressed`. No unsupported temp-HP, duration or recharge automation is implied. |
| Sheet header / E1 | Model assignment and Save to Library have named entry points; Combatant actions contains supported edit, duplicate, artwork, remove, model and explicit campaign-save operations. Encounter editing uses a retained E3 drawer and the existing `combatant.edit` command. |
| Combatant Library | A3/B6 still open the existing E4 library. Search, category/campaign/archive filters, identity cards, detail, timestamps, model assignment, duplication, archive/restore and add-to-tracker/map flows use Phase 1 tokens/components. Import and full JSON editing remain available in grouped sections. Unsaved drafts require explicit discard before closing or changing entries; adding uses a saved definition. |
| Persistent state | The existing explicit Save to Campaign form distinguishes saved campaign HP/max HP/conditions from the current encounter. Only selected supported conditions are saved. Conflict feedback offers an explicit reload; no blind retry or automatic campaign update. |
| Asset Library | A3 C2 management and existing E4 pickers retain search/category/paging, names/status/category cards, one selected model preview and calibration. Upload opens a retained E3 drawer; progress/cancel remain available while it is closed. Existing upload limits, validation, metadata, deletion/reference errors and assignment remain. |
| Player Tracker / C3 | Read-only roster and selected sheet use the same hierarchy. Only owned character details and explicitly revealed HP are rendered. Public other-combatant details remain limited; DM notes, library identities and mutation controls are absent. The existing server projection remains authoritative. |
| Shared feedback | Phase 1 Button/Menu/Popover/Drawer/InspectorSection/StatusPill reused; shared Feedback/EmptyState and a native-modal confirmation hook added. Touched destructive tracker, asset and library actions use labelled confirmations with Cancel initially focused. Errors remain visible for inspection. |

## Architecture, data and permissions

- App remains the encounter command owner. Multiplayer remains the sole connection/snapshot owner. Tracker and player selection are presentation state; changing views does not replace the retained map root or create another subscription.
- `PlayerTracker` consumes the already projected snapshot; it does not filter a DM snapshot as an authorization substitute. DM-only library/asset entry points and server authorization remain unchanged.
- `CombatantEditor` exposes the existing supported name/initiative/max-HP/notes fields, not a new character builder. A draft is retained while its drawer is closed; changing selected instance intentionally changes the draft key. Submitting clamps HP to the edited maximum as before.
- Library and encounter identities remain separate. Updating a stat block preserves the existing model assignment unless explicitly changed. Missing models still use the existing fallback and do not block combatant creation. Campaign state continues to use optimistic revisions.
- Dirty comparison normalizes both library definitions through the supported schema so PostgreSQL JSON field order cannot create a false unsaved warning.
- No binary is copied into combatant JSON and no asset URL becomes a persistent ID. The selected preview uses the original shared GLB pipeline; the asset grid creates no per-card WebGL renderers or binary downloads.
- New localStorage keys `ledger.ui.tracker.rosterExpanded` and `ledger.ui.player.tracker.rosterExpanded` contain optional booleans only, through the existing failure-tolerant preference hook. No encounter, template, library or campaign persistence has moved to the browser.
- No migration, data conversion, new dependency or deployment step is required. Normal build still packages existing migrations. Rollback is a UI revert; optional preferences may safely remain.

## Design compliance and deliberate adaptations

The approved tracker reference establishes the light hierarchy, expanded initiative column and large primary sheet. The live UI preserves complete supported stat blocks instead of substituting the reference's abbreviated content. Sheet sections scroll within the workspace; the two permanent A/B rows remain. Library management remains in its existing lifetime/context rather than introducing a new router or backend entity.

The asset API has no thumbnail field or thumbnail-generation service. Consistent category-labelled GLB fallback tiles are used; selecting one opens the actual interactive model preview. This keeps the existing no-grid-binary-download contract and avoids an unrequested thumbnail backend. True rendered thumbnail images remain a separate improvement.

Tracker ability modifiers, section labels and library eyebrows now use the approved muted text token rather than legacy low-contrast grey. Reviewed token pairs are 6.71:1 muted-on-white, 5.90:1 muted-on-page, 16.81:1 ink-on-white and 6.02:1 accent-on-accent-soft. This is a token review, not a claim of an exhaustive accessibility certification.

Native constrained selectors remain native and themed. A primary action is used per action group; side/active/used state is not encoded as another global primary action. Confirmation scope names the affected encounter, asset or library entry. No unsupported Pause/Resume, character builder, fog/LOS, effects or party presets are introduced.

## Validation

| Check | Result |
| --- | --- |
| `npm test` | 108 passed; 3 existing infrastructure skips (Caddy image validation and unavailable PowerShell checks). |
| `npm run test:integration` | 71 passed against disposable PostgreSQL, including persistence, private-data projection, assets and authorization. |
| `npm run lint`, `npm run typecheck`, `npm run build` | Passed; existing large client-chunk advisory remains. |
| Full browser suite | **30 passed (11.3 minutes)** in one complete run, with final code, standard timeouts and normal authorization limits. |

The persistent-character scenario reuses the existing library test account to keep the full suite inside the unchanged 30-authentication-attempt budget per 15 minutes. No timeout or production rate limit is increased.

Browser coverage uses the existing real application, disposable PostgreSQL and private temporary asset storage, standard timeouts and normal authorization limits. It retains exact coordinates, floor/model transforms, resource budgets and negative permission assertions.

- The new tracker test and expanded existing library scenario cover combatant editing, conditions, action state, round progression, confirmation focus/Escape, remembered roster, responsive overflow, character import, search/category/campaign filters, unsaved discard and explicit campaign state across encounters.
- Existing asset, combatant-library, import, model, multiplayer, save/reload, floor-image, multi-level, editor, fullscreen and overlay suites remain regression gates. Tests navigate relocated controls rather than replacing UI workflows with new APIs.
- Actual-app captures and reproduction notes: [Phase 4 visual review](phase-4-baseline/README.md). These are review references, not a claim of pixel equality with a static mockup or complete assistive-technology certification.

## Manual acceptance

1. In local and multiplayer DM Tracker, expand/collapse roster, select each combatant and advance a complete round. Damage/heal, change conditions, use/restore actions, edit max HP/name/initiative/notes, duplicate, change/remove art and cancel/confirm removal. Verify the command's original scope.
2. Open a combatant model picker; assign/change/remove a shared GLB, alter instance appearance, then switch Tracker/map/editor, resize and expand/fullscreen. Check selection, camera, floor, model and unsaved editor drafts remain.
3. Import a character and monster into the library, inspect supported stats/JSON, assign a model, save/reload, search all filters, duplicate/archive/restore. Try closing/changing entry with an unsaved draft; Cancel must retain it. Add tracker-only and place on the active floor; duplicate monster HP must remain independent.
4. Use saved versus full campaign state. Change encounter HP/conditions and verify saved state does not change. Explicitly Save to Campaign with selected long-term conditions, then add to another encounter. Exercise a stale revision and explicitly reload before retrying.
5. Upload a GLB, close/reopen the upload drawer with its draft/progress, cancel and retry. Inspect preview orbit/zoom/reset, calibration, metadata save, search/paging, deletion and a referenced-asset error. Verify only selected previews download binaries.
6. Join as player and late joiner. Select owned and public combatants in Tracker/map; verify permitted HP and owned ability text, no hidden NPC/floor/private notes, no DM menus or libraries. Movement and read-only statistics retain existing rules.
7. At desktop, 1280, tablet and narrow widths, use keyboard only through menus, condition popover, edit/upload drawers and nested confirmations. Check initial focus, Escape priority, return focus, touch targets, text scaling, long names/errors and internal scrolling. Repeat with reduced motion, 200% browser zoom and a screen reader on supported browsers.

## Remaining UX verification and improvements

- Real rendered asset thumbnails need an explicitly designed generation/storage contract; current cards use labelled fallback artwork and the real selected preview.
- Legacy editor/session confirmations outside the touched tracker/library/asset flows retain their existing native interaction and undo semantics. This phase does not replace gesture-sensitive editor history or fullscreen dialogs wholesale.
- The legacy sign-in flow can show a JSON parsing message when an authentication rate limit returns plain text. This was observed while validating test account budgets; improving that global response parser remains a separate small follow-up. Library/asset form errors retain their structured API feedback.
- Physical tablet/touch, screen-reader announcements, non-Chromium native fullscreen and true browser 200% zoom need manual verification. Automated viewport and focus checks do not certify these environments.
- Artwork references remain the existing supported source/input format; this is not a new portrait upload service. No public sharing, automatic external import synchronization or bulk campaign save is added.

## Modified implementation families

- `App.jsx`, `CombatantEditor.tsx`, `tracker-workspace.css`: tracker recipe, contextual editing/actions and presentation preferences.
- `PlayerTracker.tsx`, `Multiplayer.tsx`: projected read-only sheet/roster and retained view composition.
- `CombatantLibrary.tsx` / CSS: identity cards, filters/detail/import/model/state feedback and draft handling.
- `AssetLibrary.tsx` / CSS, `AssetPreview3D.tsx`, `CalibrationFields.tsx`: themed cards/forms, upload drawer and shared buttons; loader logic unchanged.
- `ui/Feedback.tsx`, `ui/useConfirmation.tsx`, `ui/index.ts`, `library-surfaces.css`: shared semantic feedback, empty states, confirmation and scoped form recipes.
- `e2e/tracker-libraries.spec.ts`, the `persistent-character-library.ts` scenario helper and existing asset/library/multiplayer/shell/workspace specs: focused coverage and relocated-control adapters. Canonical guidelines, audit, matrix, migration plan and this report record current destinations and exceptions.
