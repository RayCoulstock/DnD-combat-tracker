# Milestone 5.6 — Campaign party and encounter group presets

## Inspection and design (recorded before coding)

Combatant Library entries already have stable IDs, owned/campaign scopes, supported stat blocks and miniature defaults. `instantiateLibrary` supplies saved/full state, persistent identity and source reference; `library.add` resolves permitted ready assets and invokes `combatant.add`. That shared domain command handles the 20-instance batch limit, the 100-combatant encounter limit, initiative/manual ordering and active/round preservation. `server/game.ts` persists one revision transaction and broadcasts only after commit. Command receipts already provide retry protection. Players receive explicit projections, not library objects.

### Smallest compatible model

Migration 012 adds owned `combatant_group_presets` (ID, name, description, optional campaign, archive/revision/creation hash/timestamps) and ordered `combatant_group_members` (stable member ID, preset FK, library FK, ordinal, quantity, optional side/display-name override). No stat block or model binary is copied. The library FK uses SET NULL to preserve a readable missing-member tombstone on hard deletion; archive retains its reference. General and campaign presets are private to the owner DM. Member availability is checked against current library data on insertion.

Presets and insertion batches are limited to 20 instances; non-monster quantities are one. A reviewed selection can exclude unavailable members, choose saved/full campaign state and explicitly allow a persistent duplicate. Otherwise existing or earlier-selected persistent identities are skipped with a reason. Selected invalid references/quantities fail the entire request. No encounter state is published per member.

### Transaction and retry policy

A `group.add` envelope references preset ID/revision and selected stable member IDs, with client-generated instance IDs and one request UUID. Server authorization resolves the current referenced definitions, campaign state and permitted GLB references through the same helper as single-library insertion. It produces one normal `combatant.add` and one committed encounter update. Appearance/name/side overrides are per instance, never library writes. Monsters receive distinct numbered names when quantity exceeds one.

The request UUID must equal the existing envelope command ID. Group receipt hashes cover encounter ID and command payload, excluding the optimistic revision so an uncertain retry can safely use the latest revision. The original selection/instance IDs remain fixed for retry. A nullable receipt `result` JSON column stores the added/skipped/failed/warnings report; exact retries return it without another insertion or revision change. Other commands retain their existing hash/revision behaviour. Unavailable selected references produce an explicit failure report and rollback; asset unavailability instead warns and uses the existing model placeholder.

### Placement, UI and permissions

A3 Libraries owns Group Presets management; B6 Add Combatant owns Add Group Preset review/confirmation. Reuse P1 modal, menu, button, feedback, confirmation and form styles. The underlying App/map/socket remain mounted. No permanent toolbar or row is added. Management is available to an authenticated DM without an encounter; insertion requires an authorized encounter context.

Default and currently supported placement is roster-only using existing `unplaced` semantics and the active floor. The database keeps the existing internal position placeholder required by its non-null column; it is not a chosen/rendered placement. Selecting an unplaced roster combatant and clicking a square invokes existing `token.move`, which clears `unplaced`. Floors, elevations and appearance remain owned by the current map pipeline. Optional staging is deferred: the map has no designated staging region or blocked-cell allocator, and adding those would expand map schemas/editor scope solely for an optional placement mode. No random scatter or tactical positioning is introduced.

Players cannot manage/read presets or submit group commands. Reports are returned only to the requesting DM; broadcasts contain existing permitted encounter snapshots, with hidden combatants/order IDs still filtered. New instances follow existing library ownership defaults (DM/unassigned); existing instances and player assignments are untouched. Presets do not automatically save campaign state.

### Migration and deployment implications

Apply migration 012 through the existing migration runner before starting the new API; normal build packaging includes it. Existing encounters/library definitions require no rewrite. Usual database backups include the new relational tables and receipt JSON. Older binaries do not understand the new command; coordinate rollout. Do not drop new tables/results to roll back application binaries. No deployment is authorized by this milestone.

## Implemented API and schema contract

- `GET /api/group-presets` returns the authenticated DM's presets, including archived entries and ordered member references. Players are rejected. No list is broadcast through encounter snapshots.
- `POST /api/group-presets/:id` creates or updates an owned preset. The body contains name, description, campaignId (nullable), ordered members, revision and archived. A member has a stable UUID, nullable entryId tombstone, quantity, nullable side and nullable displayName. Side reuses `hero`, `enemy`, `neutral`; it is independent of ownership/type. Creates use revision zero; updates require the current revision. Repeating an identical create is safe; stale or conflicting updates fail. Campaign and library ownership are checked inside the transaction.
- `group.add` uses the existing encounter command transport. It contains requestId, presetId, presetRevision, optional floorId, placement `roster`, and selections containing memberId, quantity, useSavedState, allowDuplicate and one unique instanceId per requested instance. Server processing follows saved member order. The requestId must equal envelope commandId. Encounter revision conflicts retain the existing conflict contract.
- Successful acknowledgements contain groupResult with added names/IDs, skipped members, failed members and warnings. A selected unavailable/archived/foreign reference fails atomically; it can be excluded in a new reviewed request. Monster state is independent. Existing persistent identities skip by default, including duplicates within the selection; intentional duplication is explicit. Failed validation does not record a successful receipt or mutate the encounter.
- A successful receipt stores its original result. Exact replay returns that result without re-reading modified presets, resetting instance HP or incrementing revision. A different payload with the same request UUID is rejected. Retry retains the original reviewed selection and IDs; Review again explicitly abandons that pending request.
- The preset maximum and selected insertion maximum are 20 instances; the existing encounter maximum remains 100. Non-monster quantity is one. Current library definitions affect future insertions only. Existing encounters, campaign state and library definitions are never rewritten by insertion.

Migration 012 adds two tables and one nullable JSONB receipt column; there are no new combatant fields. Member ordinals are unique per preset. Hard-deleted definitions become null references rather than cascading into presets or encounters. A campaign-specific preset requires its own campaign on insertion; a general preset can be used in any owned campaign, subject to each referenced persistent entry's existing campaign restriction. Existing models use stable asset IDs and owned ready-asset checks; unavailable models retain appearance defaults while using the existing placeholder.

## Implementation map

- `shared/groupPresets.ts` owns strict management/command validation, limits, result types and bounded instance naming. `shared/domain.ts` registers the command/result contract without creating a local insertion engine.
- `server/group-presets.ts` owns transactional private CRUD; migration 012 owns persistence. `server/library-instances.ts` extracts the existing single-entry instantiation/asset validation for reuse. `server/group-insertion.ts` validates and plans the batch; `server/game.ts` persists it through existing combatant addition and receipts. `server/app.ts` registers routes and private failure reports.
- `src/GroupPresets.tsx` and scoped CSS provide management/review; ApplicationShell, Multiplayer and App integrate A3/B6 with the retained workspace. Selection is bound to encounter identity, preventing an open review from targeting a different encounter after a switch. No Three.js component or asset loader changes are required.
- Shared tests validate payload boundaries; database/socket tests exercise ownership, atomicity, replay and persistence. The existing Combatant Library browser fixture exercises group management/insertion without adding authentication load to the full suite.

## Manual acceptance — When the Mountain Weeps

Use a test copy of the campaign; this work does not modify production campaign data.

1. In A3 Group Presets, create **Adventuring Party** using the existing player characters and their GLBs. Associate the campaign, reorder members with keyboard controls and save. Save explicit campaign HP/conditions through the existing character action first.
2. Create **Durran's Warehouse Guards** with four Warehouse Guards and one captain; create **Myconid Colony** with the Sovereign and several creatures. Use existing entries where available; do not create duplicate definitions merely for quantities. Verify names, model IDs and optional allegiance defaults.
3. Search/filter, rename, remove/re-add a member, duplicate to a general preset, and archive/restore the copy. Refresh and verify references and order persist.
4. Create an encounter. From B6 Add Combatant → Add Group Preset, review Adventuring Party, choose saved state and roster-only, then confirm. Verify saved HP/conditions, models and source identities. Repeat: existing persistent members warn and skip. Explicitly choose full state/duplicate only when intended. Campaign state must remain unchanged.
5. Add the guards; verify five independent instances with distinguishable names. Damage one and change its conditions/allegiance; others and the library must remain unchanged. Check automatic initiative order, then manual order, active combatant and round while adding Myconids. No automatic initiative roll occurs.
6. Select each unplaced roster member and click a valid square on the desired floor. Verify elevation, model scale/rotation and individual placement. Save/reload and verify models, HP, order and position.
7. Join as a player and late-join from another browser. Verify permitted combatants synchronize and hidden creatures remain absent. Players cannot browse presets/library or issue group commands. Disconnect/reconnect and verify no duplicate insertion.
8. Archive a referenced library entry; review must mark it unavailable and selected insertion must fail without a partial group. Exclude it and retry deliberately. Remove a model asset; insertion must warn and still create a placeholder combatant.
9. At 1280, 768 and 390px, exercise keyboard search, member move buttons, Escape, focus return and error/retry feedback. Also check real tablet touch, screen reader, 200% browser zoom and supported non-Chromium browsers manually.

## Deferred options and limitations

- Staging-area placement is deferred for the reasons above. Roster additions keep an active-floor reference but have no rendered map position until individually placed; placement failure never discards an instance.
- Groups are private to the owner DM; no cross-account sharing, public presets, automatic player ownership assignment, rules automation or tactical positioning is added. New persistent instances retain existing library ownership defaults.
- The current model display uses asset IDs and appearance text; previews/binary management remain in Asset Library.
- Native modal/design-system behavior is reused. Automated Chromium viewport/keyboard checks are not certification for physical touch, screen readers or all browsers; those remain manual acceptance.

## Validation results

Executed in the disposable local PostgreSQL/Chromium environment on 3 November 2026:

| Check | Result |
|---|---|
| `npm test` | 122 passed; 3 existing infrastructure tests skipped by their environment guards |
| `npm run test:integration` | 81 passed; includes the new relational/socket group suite |
| Focused group database/socket suite after removal/re-addition coverage | 9 passed |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- --reporter=line` | All 31 passed, 11.8 minutes, serial Chromium |
| `npm run lint` and `npm run typecheck` | Passed |
| `npm run build` | Passed; existing large-bundle advisory remains |
| Migration packaging and diff whitespace | Migration 012 present in built server migrations; `git diff --check` passed |

The new browser coverage extends the existing authenticated Combatant Library fixture, preserving the suite's authentication rate budget. It covers campaign/general presets, search/filter, keyboard member ordering, duplicate/archive, saved state, four independently named/modelled monsters, repeated-confirmation protection, persistent duplicate skip, individual placement/HP, reload and 1280/768/390px overflow checks. The full suite retains existing imports, save/reload, multi-floor maps, fullscreen, scene identity, multiplayer, permissions and keyboard/focus regressions. No test timeouts or production rate limits were changed.

Database/socket coverage additionally checks edited/removed/re-added members, archive/restore, owner/campaign restrictions, selected missing references with atomic rollback, current definitions, unavailable models, explicit full persistent duplication, manual/automatic order, active turn/round preservation, exact retry reports, altered-request rejection, unauthorized players, hidden-data projection, late join/reconnect, backend restart and elevated-floor placement bounds. Test examples are synthetic; the production When the Mountain Weeps campaign remains a manual acceptance target. No deployment was performed.
