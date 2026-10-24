# Multiplayer DM setup redesign

The setup panel now uses the ledger's cream (`#f4f0e8`) palette, white cards, `#e4ddd0` borders, 14px corners, serif headings and deep-red primary actions (`#9e2b20`). Campaign, Encounter and Players sit in three columns on wide screens, then two/one as space narrows. Tokens & visibility spans the panel below them. On phones the token table scrolls horizontally within its card.

## Use

- Campaign: select the active campaign, see encounter/player/online counts, rename it or create another campaign.
- Encounter: select an encounter, start/end the session or save a checkpoint. Blank creates an empty encounter; Import JSON uses the existing validated import endpoint. Browse or drop a `.json` file into the dashed zone; choosing a file automatically selects Import JSON. Bad files do not replace the current encounter.
- Players: generate a one-time invitation per player and Copy its link. Rows show real presence and assigned combatants. Anonymous unredeemed invitations appear as Pending; registered players who are disconnected appear Offline. Revoke access asks for confirmation. Saved sessions and past invitations are separate collapsibles.
- Tokens: filter All/Party/Enemies; assign control, reveal/hide, share exact HP and inspect HP bars. The ellipsis opens the existing name/initiative/max-HP/DM-notes editor. Flat-map dimensions remain available under Battlefield dimensions; dungeon-map sizing stays in the builder.
- Collapse setup from the header or footer to return to the tracker/battlefield. Expanding restores the same setup. This never unmounts the battlefield or synchronizes cameras.

## HP privacy

`combatant.hp.visibility` is an additive, validated DM-only command. `hpShown` is an optional boolean in existing combatant JSON data, so it survives persistence/import/export/checkpoints without a database migration. Existing combatants default to private HP. Owners always retain their own character statistics; turning HP shown on explicitly shares exact current/max HP with other campaign players. It does not reveal AC, notes, actions or hidden combatants. Turning it off removes exact HP from subsequent player projections. As with all previously delivered information, it cannot erase values someone has already seen.

Ownership and token visibility still use their existing authoritative commands. Switches show pending feedback while a command is in flight, disable additional changes and reconcile to the authoritative result. No new upload endpoint, polling, authentication or room mechanism was introduced.

Presence refreshes now retain the socket's connected state instead of overwriting every member as Offline after a campaign HTTP refresh. Changing campaigns clears the previous membership display. Narrow-screen camera controls are anchored to their own battlefield so they cannot obscure the setup header.

## Verification

Run `npm test`, `npm run test:integration`, `npm run typecheck`, `npm run lint`, `npm run build` and `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e` with the development server and PostgreSQL running. Start browser-test batches with a fresh development backend if earlier runs have exhausted authentication/invitation rate limits; keep those security limits enabled.

New domain/integration coverage checks private defaults, DM-only HP sharing, authoritative persistence and player filtering. The setup browser scenario checks JSON drag-and-drop, clipboard copy, player presence/assignment, token filters, visibility and HP sharing, saved sessions, desktop/390px layout and preserving the same battlefield canvas on collapse. Existing multiplayer and miniature browser selectors now target the replacement ownership table, retaining their prior functional assertions.

Verified: **39 unit checks, 48 integration checks and all 10 browser scenarios passed**. Frontend/backend TypeScript, ESLint and production builds passed. The existing large-bundle advisory remains (approximately 1,774 kB JS / 488 kB gzip). No database migration or new environment settings are needed; deploy updated frontend and backend together for the HP-sharing command.
