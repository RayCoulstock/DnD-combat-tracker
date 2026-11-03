# Milestone 5.5 — Combat controls

## Inspection and intended architecture (before implementation)

The shared `combatantSchema` stores numeric initiative (zero is a real value; no unset representation) and `side: hero | enemy`. `combatant.edit` and Add stable-sort descending; ties retain prior array order. Active turn is a stable ID. Next Turn walks the combatant array and increments round on wrap. Removing the active combatant previously selected the first entry. The map roster separately sorts and must instead follow authoritative encounter order. Player projection is an explicit allowlist; encounter metadata must also filter hidden IDs.

`server/game.ts` persists encounter JSON, combatant JSON and ordinal in a revision-checked transaction with command receipts. Existing library definitions already retain `side`, while library instantiation resets initiative to zero. Character state saves only HP/max HP/conditions. No SQL enum governs allegiance. Existing sheet editing, P1 Menu/Popover/Button/Feedback, C1 roster and C3 entity controls can be reused.

### Small compatible schema changes

- Extend existing `side` to `hero | enemy | neutral`, displayed as Ally/Enemy/Neutral. No additional allegiance/type/ownership field.
- Optional encounter `turnOrder: { mode: initiative | manual, manualIds: ID[], completedIds: ID[] }`. Missing metadata means automatic mode; stable ties retain array/SQL ordinal order. `manualIds` is preserved across mode changes and reconciled on additions/removals. No schema version bump or SQL migration: existing JSON columns carry optional fields.
- Add narrow DM-only control-patch, ordering-mode and adjacent-move commands to the existing envelope/revision pipeline. New committed initiative edits require integers within the existing -1000…1000 bound. Legacy finite fractional initiative records remain loadable; no null/unset distinction is invented.
- Keep `combatants` in displayed order, so existing tracker/player consumers and stable-ID selection work. Normalize imports and database loads through shared ordering helpers. Import/export retains optional order metadata. Player snapshots filter both ID lists to permitted combatants; no hidden order IDs are broadcast.

### Deterministic turn policy

Before the first order mutation or advancement of a legacy encounter, infer completed turns from entries preceding the active ID in its existing order. Thereafter record only completed IDs, never an active index.

Initiative edits, manual moves and mode changes preserve active ID and round. Next Turn marks the active ID complete and searches cyclically after it in the current displayed order for the next uncompleted combatant. Moving a completed entry cannot grant another turn. Moving a pending entry before the active ID does not skip it: it remains eligible on the cyclic scan. Newly added entries are pending, including those inserted before the active ID. Once every remaining entry has completed, increment round once, clear completion tracking and activate the first entry. With no reordering this is the existing wrap behaviour.

Removing a non-active entry preserves active ID and round. Removing the active entry selects the next pending entry in the old cyclic order; if all remaining entries have completed, begin the next round once. Removing the last entry leaves no active ID and retains the round. This explicitly replaces the old first-entry removal fallback to avoid duplicate turns. No attempt is made to infer turn history beyond the legacy active prefix.

Manual mode initializes from displayed order only when no saved manual order exists. Existing saved manual order is restored; new entries append to it and removed IDs are pruned. Initiative values never change when moving or switching modes. Returning to automatic mode stable-sorts by initiative. Unrelated HP, conditions, visibility, model and ownership operations never reorder ties.

### UI ownership and risks

C1 expanded rows expose contextual initiative/allegiance editing and keyboard up/down controls; collapsed chips retain labels/side/active indicators without forms. C1 Turn order menu selects mode. C2 sheet and C3 inspector reuse the same committed control form. B6 Next Turn stays in place. No new header row/dock/renderer owner. Players get read-only mode/order/allegiance.

Use explicit Save; Escape resets uncommitted control input. Reject empty, fractional and malformed new initiative edits without sending commands. Single atomic control patch avoids rewriting unrelated stats or intermediate keystrokes. Library defaults use existing definition side; encounter overrides never update a library or campaign state automatically.

Deployment needs the usual coordinated application rollout; older server binaries cannot validate new neutral values or ordering commands. Back up as normal before rollback; preserve the newer JSON if rolling back binaries. No destructive database migration is introduced. Tests must cover round mutations, legacy normalization, permissions/projection, persistence, resource identity and all touched UI paths.

## Implementation and compatibility

Implemented on `feature/milestone-5-5-combat-controls`. `shared/combatOrder.ts` owns reconciliation, mode-independent advancement and active removal; `shared/domain.ts` owns schemas, DM authorization and narrow commands. Existing transaction/receipt code persists the new JSON without a new table. `server/game.ts` normalizes loads so HTTP, WebSocket and late-join views agree. Map and player rosters use the same canonical array; they no longer independently sort it.

`CombatControls.tsx` reuses P1 Popover/Menu/Button/Feedback. It emits one committed patch containing only changed controls. Untouched legacy fractional initiative remains loadable and can retain its value while allegiance changes; new initiative values must be integral. An unchanged Save sends no command. Closing the popover, including Escape, unmounts the native form draft and returns focus through the shared surface. New open/close notification clears stale validation feedback. Async saves, mode changes and manual moves restore keyboard focus; the creation picker exposes and styles all three selected states. Existing name/max-HP/notes editing also exposes allegiance. Neutral uses existing muted tokens, explicit labels/descriptions/tooltips and the existing scene fallback base colour. Active collapsed chips include an arrow as well as the active-turn state.

Creation supports Neutral. Combatant Library adds an explicit Default allegiance selector; importing a replacement preserves an explicitly selected or persisted default. Entry type remains separate library metadata, and encounter patches cannot write it, ownership, GLB settings, HP, conditions or campaign character state. Existing default classifications remain valid without backfilling rows. The original import parser is unchanged.

### Modified files

- Shared domain/order implementation and focused `combatOrder.test.ts`.
- Server state loading and multiplayer integration coverage, including actual PostgreSQL restart recovery and late socket join.
- App, CombatantEditor, BattleMap3D, Multiplayer and PlayerTracker adapters; shared CombatControls/CSS and optional P1 Popover presentation/lifecycle hooks.
- CombatantLibrary and DMSetupPanel default/filter/label support.
- New local browser regression, expanded existing multiplayer/library fixtures, canonical guidelines, audit, migration plan and feature-zone matrix. Existing authenticated fixtures are reused, preserving the full suite's production authentication quota.

## Validation

| Check | Result |
| --- | --- |
| `npm test` | 118 passed; three existing infrastructure skips (Caddy validation / unavailable PowerShell). Ten new focused domain tests cover the mutation/round/permission matrix. |
| `npm run test:integration` | 72 passed, including committed controls, filtered order metadata, late join and PostgreSQL/API restart. |
| Lint, type checks and build | Passed; existing large-client-chunk advisory remains. |
| Focused browser checks | Initiative/allegiance/manual order/import-export/canvas checks and DM/two-player synchronization passed. |
| Full browser regression | **31 passed (12.1 minutes)** in a clean sequential run with unchanged timeouts and no concurrent build/source activity. |
| Final creation/accessibility check | **1 passed (10.9 seconds)** after the final three-way picker selected-state styling/ARIA update, including Neutral creation on the compact layout. |

Exact initiative, ID, round, order, HP, model and projection assertions are retained. No test timeout, production rate limit or role rule is weakened. The software-rendered multi-level acceptance case approaches its existing overall budget; keep source/build activity separate from browser validation. Its isolated normal run and the final full run passed without increasing any timeout.

Browser coverage includes zero/negative/invalid values, explicit commit, cancelled drafts, C1/C2/C3 entry points, manual mode restoration, neutral library default versus instance override, collapsed controls, narrow widths and retained Canvas identity. Existing map, import, GLB, multi-floor, fullscreen and keyboard suites remain gates.

## Manual acceptance — existing encounter (for example Durrans Warehouse)

Use a copy of the encounter for destructive tests; no production encounter was accessed by automated validation.

1. Load the encounter as DM, before starting the multiplayer session. In expanded C1 or the C2 sheet, open the character's combat controls. Enter 21 instead of 12 and Save. Confirm descending order, unchanged active ID and round. Repeat after starting the session; exercise zero and a negative integer.
2. Enter an empty value, decimal or malformed text, then Save: expect validation and the saved value unchanged. Enter another value and Escape: reopen to the saved value, with focus returned and no command issued. Test Enter/Save and keyboard-only navigation.
3. Change a Warehouse Guard from Enemy to Neutral, then back. Check sheet, roster tooltip/text, map base/outline and Neutral campaign-setup filter. Verify HP, conditions, initiative, owner, visibility and GLB settings remain intact. Repeat for an allied monster and hostile player character.
4. In C1 Turn order choose Manual order. Move an entry with the named up/down buttons. Confirm initiative values, active ID and round stay unchanged. Move an already completed combatant after the active one and a pending combatant before it; Next Turn must serve pending IDs once before incrementing round.
5. Add a combatant before the current entry, remove a pending entry, then remove the active entry. Check the documented cyclic-pending policy and round boundary. Removing the final entry leaves no active combatant.
6. Switch to Initiative order and back to Manual order. Verify saved manual order returns, additions append and removals leave no stale IDs. Export/reimport or save/reload the encounter and verify mode, order, allegiance and turn progress.
7. In the library set a default allegiance, add to the encounter, change only the instance, and add to another encounter. Confirm the library/default and campaign state stay unchanged until their explicit supported save actions. Reimport stats into the definition and verify an explicit default and GLB assignment remain.
8. Join and reconnect from player browsers. Verify committed order and allegiance agree with permitted combatants; hidden NPCs/floors and order IDs remain absent. Players must have no editing controls, and forged controls/mode/move commands must be rejected server-side. Verify own movement permissions remain independent of allegiance.
9. Collapse/expand C1, edit in C3 and switch Tracker/map/editor/fullscreen. Confirm selection, camera, floor and unsaved editor drafts remain. At laptop/tablet widths check internal scrolling, popover bounds, focus return and touch targets.

## Known limitations and deliberate choices

- There is no initiative-unset value in the existing model; zero remains a legitimate entered value. New edits retain the existing -1000…1000 limits. Legacy fractional records remain readable, but new fractional edits are rejected.
- Legacy saves have no completed-turn history. On first ordering operation, the active prefix is the deterministic migration assumption; earlier undisclosed manual play cannot be reconstructed.
- Removal of the active combatant intentionally uses the next pending ID rather than the legacy first-entry fallback. This can advance the round when no pending combatants remain.
- The map roster remains the active-floor subset of the global encounter order; use Tracker to plan the full order across levels. Move controls operate on that global order.
- Manual reordering uses accessible adjacent-move buttons; drag-and-drop and initiative rolling are outside scope. Reordering does not replay or undo game actions already performed.
- Automated browser validation uses Chromium and synthetic encounters. Physical touch, screen readers, other browser engines and true browser zoom remain manual acceptance checks; the actual Durrans Warehouse campaign was not opened.
- No deployment is included. Older binaries do not understand Neutral/new commands; coordinate the normal application rollout and preserve JSON/backups for rollback.
