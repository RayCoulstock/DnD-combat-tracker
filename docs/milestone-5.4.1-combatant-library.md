# Milestone 5.4.1 — Persistent Combatant Library

## Architecture

The existing `campaigns` table is a durable campaign, distinct from its active encounter and `session_active` flag. No new campaign entity is introduced.

- `combatant_library`: DM-owned definitions, optionally scoped to a campaign. Types: player character, named NPC, monster template. Stores a complete supported stat block (including existing importer extension fields), notes, optional portrait, default miniature appearance, timestamps, revision and archival status.
- `campaign_character_state`: explicit HP, maximum HP and DM-selected long-term conditions, keyed by campaign and library identity. No initiative, floor, grid position, model override or used encounter abilities are stored here.
- Encounter combatants remain independent snapshots with their existing instance IDs. Additive optional fields are `sourceLibraryId`, `persistentIdentity` and `unplaced`. Existing records require no rewrite. Library edits and archival never rewrite instances.
- `shared/statBlock.js` contains the existing text parser, extracted unchanged from App. Both existing Add Combatant and library imports use it. Combatant JSON imports use the existing combatant schema. No external API access is added.

Library defaults start at full HP with no conditions and zero initiative. Saving from an encounter copies its supported stats, portrait and miniature settings; current damage/conditions are saved separately with Save to Campaign. Hidden visibility and private combatant notes are preserved in the definition and remain protected by the existing player projection.

A general character can have separate saved states in different owned campaigns. A campaign-scoped character/NPC can only be added to that campaign. Monster templates remain reusable across campaigns regardless of their organizational campaign association.

## API, authorization and consistency

All library HTTP endpoints require authenticated DM access and enforce ownership. Players do not receive library definitions, library notes or source identity IDs; their encounter data continues through `projectEncounter`. Library definitions are never broadcast as a collection.

- `GET /api/combatant-library`: owner's definitions, including archives.
- `POST /api/combatant-library/:id`: create/update/archive/restore. Client supplies stable UUID and revision (`0` for create). Retrying the same create returns the same entry; different content at an existing create ID conflicts. Edits use optimistic revision checks. `preserveModel` defaults to true, allowing stat replacement without changing assigned GLB defaults. The editor submits explicit appearance changes with this flag false.
- `GET /api/combatant-library/:id/state/:campaignId`: owned campaign state and revision.
- Existing WebSocket command envelope adds `library.add` and `library.state.save`. Both use campaign locking, encounter revisions, command receipts and existing broadcasts/late-join snapshots. State saves also check the campaign character-state revision to prevent overwrites from another encounter.

Persistent character duplication is rejected unless the DM explicitly enables the duplicate override. Monsters always receive independent instance IDs. Pending placement has a fixed instance ID and is scoped to the encounter where it began. Tracker-only additions have `unplaced: true`; selecting one and clicking its floor places it through normal movement. The existing database requires a position record even for a tracker-only combatant; that internal anchor is not rendered until placed.

## Assets and portraits

Default models use the existing `miniature` schema: stable asset UUID, scale, rotation, vertical offset, base size and base visibility. Asset selection, previews and binary loading reuse MiniatureSettings, Asset Library and the shared GLB renderer. No model binaries are copied into entries.

New assignments require a ready asset owned by the DM. Missing/deleted models remain identifiable in the definition, but additions use a placeholder and still succeed. Instance appearance changes do not modify the definition. Assets referenced only by a library definition may be deleted through the existing Asset Library; active encounter references retain their existing deletion protection.

Portraits reuse the artwork table and authenticated artwork endpoint. Server references must already belong to an entry or encounter owned by the DM. Existing player portrait permission rules remain in force.

## Migration and deployment

Migration: `server/migrations/011_combatant_library.sql`.

This adds two PostgreSQL tables and an owner/date index. It does not alter existing encounter, combatant, campaign, asset or map rows. Schema migration packaging and pending-migration startup guards are unchanged.

Before deploying this PR, take the normal database and private asset-volume backup, build the release, and run the existing migration command (`npm run db:migrate:production`) in the normal controlled deployment process. Start the new application only after migrations succeed. The two new tables and portrait bytes are included in the normal PostgreSQL dump; GLB files remain in the existing persistent asset volume. Do not replace that volume during release upgrades. No new environment variables or external services are required.

For application rollback, leave the additive tables in place; older application versions ignore them. Old encounter files remain version 1. Older applications may not understand the optional `unplaced` behavior, so avoid rolling back while tracker-only additions need to stay off the map. A destructive schema rollback is not required or supplied.

No deployment was performed as part of this milestone.

## Manual acceptance

1. Sign in as DM in Multiplayer. Open Combatant Library before opening an encounter. Create/import a player character, named NPC and monster template. Save entries in the general library and a campaign; verify search/category/campaign filters.
2. Open an entry, browse the existing Asset Library, choose a GLB, change scale/rotation/offset/base, save miniature, then save the entry. Close/reopen and reload the page; verify the assignment and stats.
3. Replace stats with a text or combatant JSON import. Confirm the GLB remains assigned. Edit name, notes and stat fields; save. Duplicate and archive/restore an entry.
4. Open a multi-floor encounter. Choose a monster, Add to Encounter — choose square, select an active floor and click a square. Check exact coordinates, floor elevation and appearance. Repeat to create two monsters, damage one and override its model scale. Confirm the other monster and library default are unchanged.
5. Add a character to tracker only. Confirm it appears in initiative but has no visible token. Select it, open its floor and click to place it. Attempt a second addition and verify rejection; use the explicit duplicate checkbox and verify success.
6. Damage the character and apply conditions. Confirm library default and saved campaign state remain unchanged. Click Save to Campaign, select only long-term conditions and save. Add the character to another encounter: saved-state mode restores HP/max HP/selected conditions; full/default mode resets HP and conditions. Initiative and positions are not copied. Repeat with a general character in another campaign and verify isolated state.
7. Save an existing combatant to the library. For a linked character, use Update source entry from selected combatant and save to replace supported stats while retaining the source model default.
8. Connect two players, hide an NPC or its floor, add visible/hidden library combatants, change HP and reconnect a player. Verify permitted live updates and late-join state, hidden data omission, and absence of library access controls. A player or another DM must receive no library access.
9. Archive an entry used in an encounter. Confirm the encounter remains intact and new additions are blocked. Delete an asset referenced only by a library entry; its next addition must use a placeholder without failing.
10. Restart the backend using the same database and asset volume. Reopen entries and both encounters; verify identity, GLB defaults, saved character state, HP independence and exact floor positions. Run the existing backup/restore verification process before releasing to production.

## Automated coverage

- `shared/combatantLibrary.test.ts`: text imports, stat extensions, independent instances/default appearance, persistent identity, default/saved state, legacy compatibility and player projection.
- `server/tests/combatant-library.test.ts`: real PostgreSQL migrations, retry-safe create, optimistic edits, model preservation and ownership, converting combatants, independent monster instances, two player clients/late join, explicit state writes, stale saves, duplicate override, template/archive isolation, multi-floor placement, deleted/missing assets and application restart.
- `e2e/combatant-library.spec.ts`: real browser create/import, general library before campaign creation, Add Combatant library shortcut, model picker/settings, tracker-only addition, square placement, reload, duplication and archival.

Use the project's normal `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run build` and `npm run test:e2e` commands. Integration/browser tests need a disposable PostgreSQL database and local app, following the existing CI harness.

## Known limitations

- Persistent library operations require a signed-in DM and the server-backed Multiplayer mode; the standalone local demo retains its existing behavior.
- Complete stat editing uses the supported stat-block JSON editor and existing text/JSON importers; this is not a new character builder or a new D&D Beyond parser.
- Archive/restore is used instead of hard deletion. Active instances are not refreshed automatically; remove/re-add intentionally to use a revised template.
- Model assignments reference stable IDs; deleting model bytes deliberately cannot preserve rendering. Missing assignments fall back safely.
- Campaign state includes currently supported HP/max HP and selected conditions. No levelling, progression, account sync or new resource-tracking system is added.
- Browser automation covers the principal creation and placement workflow; secondary-floor validation, authorization, concurrent state updates and restart are covered by database/WebSocket tests and the manual checks above.

## Modified files

| Area | Files |
| --- | --- |
| Database migration | `server/migrations/011_combatant_library.sql` |
| Library API and ownership checks | `server/combatant-library.ts` |
| Commands, character-state saves, model fallback | `server/game.ts` |
| Route registration and library portrait grants | `server/app.ts` |
| Shared definitions, identity and saved-state rules | `shared/combatantLibrary.ts` |
| Existing importer extraction | `shared/statBlock.js`, `src/App.jsx` |
| Optional source identity, placement and compatibility | `shared/domain.ts` |
| Library/detail/import/model interface and state-save dialog | `src/CombatantLibrary.tsx`, `src/combatant-library.css` |
| Tracker actions, placement setup and account navigation | `src/App.jsx`, `src/Multiplayer.tsx` |
| Grid click placement and tracker-only rendering | `src/BattleMap3D.tsx` |
| New automated coverage | `shared/combatantLibrary.test.ts`, `server/tests/combatant-library.test.ts`, `e2e/combatant-library.spec.ts` |
| Architecture, migrations and acceptance guide | `docs/milestone-5.4.1-combatant-library.md` |

## Validation recorded for this change

- `npm test`: 106 passed, 3 skipped by the existing infrastructure-test prerequisites. The final shared-domain rerun also passed all 55 tests.
- `npm run test:integration`: all 71 tests passed in the final full run. The expanded library PostgreSQL/HTTP/WebSocket suite passed all 12 tests, including portrait privacy, command retries, maximum-HP state changes and cross-campaign isolation.
- `npm run typecheck`, `npm run lint`, `npm run build` and `git diff --check`: passed. Build output includes migration 011. Vite still reports the application's large-bundle advisory.
- Full Chromium regression run: 16 of 18 passed on the reused local test server. The scenery test explicitly encountered its accumulated authentication rate limit; the other failure was a player connection wait. Both scenarios passed when rerun against a fresh local backend (2/2). The new library browser test passed in the full run and again after the final Add Combatant shortcut (1/1).
- No production database, hosting or deployment was changed. PostgreSQL and the local browser-test services were disposable test resources.
