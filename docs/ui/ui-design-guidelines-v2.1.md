# Encounter Ledger — UI design guidelines

> **Repository review — Phase 0, 31 October 2026:** This is an external visual proposal, not an instruction to implement Phase 1. The original is preserved at [references/ui-design-guidelines-v2.1.original.md](references/ui-design-guidelines-v2.1.original.md). Read the repository-backed corrections in **section 12** alongside sections 1–11. They identify planning conflicts and proposed resolutions; later-phase implementation still awaits review. The user subsequently approved Phase 1 foundations; see section 13. No application behaviour is changed by this document alone.

**Status:** v2 layout concept. **Audience:** anyone (human or AI agent) adding or changing UI.
Read this before adding any button, panel, toolbar or menu. Every new control must have a **zone address** from this document.

Reference images (archived under `docs/ui/references/v2/`):

| File | Shows |
|---|---|
| [01-blueprint.png](references/v2/01-blueprint.png) | Screen anatomy with zone codes, and the contents of every menu |
| [02-battle-map.png](references/v2/02-battle-map.png) | Battle map (play). Libraries menu open, ruler active, token popover |
| [03-map-editor.png](references/v2/03-map-editor.png) | Map editor. Wall tool with flyout, grouped accordion inspector |
| [04-tracker.png](references/v2/04-tracker.png) | Tracker. Expanded roster, combatant sheet with its own actions |

The sibling `.html` source and [concept.css](references/v2/concept.css) are visual references for colours, sizes and spacing, not production component or behaviour specifications. Their fixed-size body and display-only controls must not be copied into the application unchanged.

---

## 1. Principles

1. **The stage is the hero.** The page has exactly **two rows of chrome**: the App bar (A, 56px) and the Session bar (B, 64px). The workspace (C) fills the rest of the viewport. **Never add a third row** above the stage. In Table views the page never scrolls; panels scroll internally.
2. **Every control has an address.** Each control lives in one named zone (§2). If a feature doesn't fit a zone, update this document first, then build it.
3. **Menus before buttons.** Secondary actions go into the menu that owns their zone (§3). A control earns a visible button only if it's used several times per session. The Session bar has at most **two** visible primary actions. Each view has at most **one** red (accent) button.
4. **Context over chrome.** An action that applies to *one thing* (a combatant, token, wall or level) lives *with that thing*: in the sheet header, the inspector, the context popover or its `⋯` menu. It never goes in a global bar. (For example, "Assign 3D miniature" and "Save to library" are combatant actions, not page actions.)
5. **Six fixed overlay slots.** Canvas controls live in the six docks D1–D6. A new canvas control **joins an existing dock**; nobody adds a new floating bar. Only one hint pill (D2) is visible at a time.
6. **Collapse, don't stack.** The roster, inspector, accordion sections and setup can all fold away. Large setup or configuration UI opens in a **drawer (E3)** over the workspace instead of pushing the stage down. Persist collapse states in `localStorage` under `ledger.ui.*`, wrapped in try/catch.
7. **Same place in every view.** Zones keep their position across Tracker, Battle map and Map editor. Changing view only changes what's inside C and D.
8. **Group with surfaces, not lines.** There are three surface levels: page cream `--bg` → panel well `--well` → white card `--card`. Groups (accordion sections, cards) are always white cards sitting on a darker well, so their edges are obvious.
9. **One component vocabulary.** Use only the components in §5. A browser-default `<button>` or `<select>` showing up anywhere is a bug.
10. **Danger is deliberate.** Destructive actions sit at the bottom of a menu under a *Danger* group, in red text, and always ask for confirmation in a modal (E4).
11. **Players see a subset.** For player roles, A2/B5/B6, DM-only menu items, the Map editor view and the D4 editor tools are hidden. Hide them; don't disable them. Zones don't move.

---

## 2. Named areas

### A · App bar: global, the same on every screen (dark, 56px)
| Code | Name | Contains | Never contains |
|---|---|---|---|
| A1 | Brand | Logo + "Encounter Ledger", links to Table | — |
| A2 | Table mode | `Multiplayer table ▾` ⇄ Local tracker | Campaign or session controls |
| A3 | Primary nav | **Table** · **Libraries ▾** (Combatant Library, 3D Asset Library, Map templates, future libraries) | Encounter actions |
| A4 | Status & account | Connection pill + online count, `?` help, account menu (sign out, preferences) | — |

### B · Session bar: this campaign and encounter (cream, 64px)
| Code | Name | Contains |
|---|---|---|
| B1 | Context switcher | `Campaign ▾` / `Encounter ▾` (both are dropdowns, see §3) |
| B2 | Round & state | Round number, Live/Paused pill |
| B3 | View switcher | Segmented: Tracker · Battle map · Map editor (centred) |
| B4 | Players | Avatar stack + `n/m` online → **Players popover** |
| B5 | Session menu | `Session ▾`, every session/encounter-level secondary action |
| B6 | Primary actions | `Add combatant ▾` split button and **Next turn** (the accent button). Nothing else. |

The old "Session setup" bar and the duplicate brand/encounter header are **merged into B**. Full campaign setup opens as a drawer (E3) from `Campaign ▾ → Campaign setup…`.

### C · Workspace: fills the viewport below B
| Code | Name | Behaviour |
|---|---|---|
| C1 | Roster rail | Initiative order. Collapsed: 56px column of token chips (active turn shows a red tick, selected token a halo). Expanded: 290px list with HP bars. Defaults: expanded in Tracker, collapsed in the map views. |
| C2 | Stage | Tracker → combatant sheet. Battle map / Map editor → 3D canvas. Never pushed down by other UI. |
| C3 | Inspector | 350px, right side, hideable (`]`). Header = the thing being edited + its save state + Save. Body = grouped accordion (§5.4). Hidden by default in Tracker and Battle map; opens when something is selected or the user asks for it. Always present in Map editor. |

### D · Stage overlays: canvas views only, cream "glass" docks
| Code | Slot | Battle map | Map editor |
|---|---|---|---|
| D1 | Top-left | Level ▾, view mode ▾ | same |
| D2 | Top-centre | One hint pill for the active tool | same |
| D3 | Top-right | Player-view preview, `⛶ ▾` (expand map / browser fullscreen), inspector toggle | Undo · Redo · History ▾ · `⛶ ▾` |
| D4 | Left-centre | **Tool palette:** Select (V), Move (M), Ruler (R), Template ▸ (T), Draw (P), Clear | Select (V), Floor (F), Wall ▸ (W: segment/line/room/corridor), Door (D), Object (O), Link/transition (L), Image (I), Erase (E) |
| D5 | Bottom-left | Camera dock: Reset, Top-down, − zoom +, Grid, Labels | same |
| D6 | Bottom-right | Scale chip `1 sq = 5 ft · 30×30 ▾` (expands to the feet-per-square form) | same |

**Rule:** related tools share **one palette slot with a flyout** (a small corner triangle marks it). The flyout opens to the right of the palette. Tool *settings* (template shape, colour, wall material…) go in the inspector's **Active tool** section, never in another floating panel.

### E · Transient UI
| Code | Name | Use |
|---|---|---|
| E1 | Context popover | Anchored to a token or object on the canvas. Name, side, HP/AC, then 3–4 icon actions + `⋯`. Only one at a time; Esc closes it. |
| E2 | Menu / flyout | Every `▾` and `⋯`. Grouped with small uppercase group labels. |
| E3 | Drawer | Right-side sheet over the workspace for large forms: Campaign setup, Token ownership & visibility, Saved sessions. |
| E4 | Modal | Confirmations and pickers (Asset Library picker, Combatant Library picker). |
| E5 | Toast | Bottom-centre of the stage, above D5. Short-lived status and errors. |

---

## 3. Menu contents (source of truth)

| Menu | Zone | Items |
|---|---|---|
| Libraries ▾ | A3 | Combatant Library · 3D Asset Library · Map templates · *(future libraries are added here)* |
| Account ▾ | A4 | Signed in as … · Preferences · Keyboard shortcuts · **Sign out** |
| Campaign ▾ | B1 | campaign list · Rename… · New campaign… · Campaign setup… (E3) |
| Encounter ▾ | B1 | encounter list · New encounter… · Import encounter JSON… · Rename… |
| Players popover | B4 | invite link (Copy / New) · player rows (presence, token, Revoke/Resend) · Token ownership & visibility… (E3) |
| Session ▾ | B5 | *Session:* Save checkpoint, Saved sessions…, Pause/Resume · *Encounter data:* Import…, Export…, Save combatants to campaign · *Danger:* Clear encounter…, End session… |
| Add combatant ▾ | B6 | New blank combatant (N) · From Combatant Library… · Paste stat block… · Import combatant JSON… |
| Combatant ⋯ | C2 sheet / C3 / E1 | Assign 3D miniature… · Save to Combatant Library · Edit stat block… · Duplicate · Transfer to level… · *Danger:* Remove |
| Level ▾ | D1 | level list · view: single / stacked / all · Manage levels… (opens C3 section) |
| `⛶ ▾` | D3 | Expand map (hides A+B) · Browser fullscreen · Player-view preview · Show/hide inspector |
| History ▾ | D3 (editor) | Recent edits · *Danger:* Clear map history… |

---

## 4. Where does my new feature go?

Work down this list and stop at the first match:

1. **Does it act on one specific thing?** → That thing's `⋯` menu, plus the inspector section for it. If it's used constantly, also give it an icon button in E1 or the sheet header (max 3 visible).
2. **Is it a canvas interaction mode** (measure, draw, place)? → A tool in D4 (or a flyout inside an existing slot), with its settings in C3 → *Active tool*.
3. **Is it a camera or view setting?** → D5 (camera) or D1 (level/view) or the `⛶` menu in D3.
4. **Is it per-level or per-map data?** → An accordion section in C3, under the *This level* or *Map* group.
5. **Does it apply to the whole encounter or session?** → A `Session ▾` item. Only promote it to B6 if it's used every round.
6. **Does it apply to the campaign or to players?** → `Campaign ▾` / Players popover, with big forms in an E3 drawer.
7. **Is it a reusable collection** (a library)? → A new item in `Libraries ▾` (A3), opening its own full page under Table's sibling route.
8. **Is it app-wide** (account, preferences, help)? → A4.

If you think it needs a new zone, a new toolbar or a third chrome row, **stop**. Propose a change to this document instead.

---

## 5. Components

Sizes are in CSS px. Tokens are in `concept.css`.

### 5.1 Tokens
`--bg #f4f0e8` page · `--surface #fbf9f4` rails/bars · `--well #ece6da` inspector background, segmented tracks · `--card #fff` · `--line #e4ddd0` · `--line-strong #d6ccba` card edges on the well · `--ink #1f1d1a` · `--muted #7a7268` · `--accent #9e2b20` (primary + enemies + danger) · `--ok #2f7d4f` · `--warn #a86b12` · `--party #3c6e91` (allies) · `--dark #23211e` (App bar).
Headings: serif (Georgia/DejaVu Serif). UI: Inter. Eyebrow labels: 10.5px, uppercase, `letter-spacing:.2em`, muted.
Radii: cards 14 · sections/docks/menus 10–12 · buttons 8–9 · pills 999.

### 5.2 Buttons
- **Button** 36px (sm 30px): white, 1px `--line` border, 13px/500. **Primary**: accent fill, only B6 *Next turn* and "Save" in the inspector header. **Danger**: red text, light red border.
- **Split button**: label + `▾` segment (e.g. Add combatant).
- **Dock button** (inside D docks/popovers): 32px, no border, transparent. Active/toggled-on = `--well` fill + semibold. Disabled = `--faint` text.
- **Tool** (D4): 48×48, icon + 9.5px label, shortcut letter top-right, flyout triangle bottom-right; active = accent fill, white.

### 5.3 Dock (D1–D6, E1)
Background `rgba(251,249,244,.96)` + blur, 12px radius, `0 6px 20px rgba(0,0,0,.35)` shadow, 4px padding, 12px from the stage edges. Separate groups inside a dock with 1×20px vertical rules. Docks never stack on top of each other; on narrow stages D5 collapses its labels to icons first.

### 5.4 Inspector accordion (C3)
- Panel background `--well`; header is white with a strong bottom border.
- Sections are grouped under **group labels**: uppercase 10px text followed by a hairline that runs to the edge. Map editor groups: **Editing** (Active tool, Selection) · **This level** (Levels, Floor image, Scenery, Transitions) · **Map** (File & templates, Generate dungeon).
- Each **section** is a white card: 1px `--line-strong`, radius 10, faint shadow, 7px gap between cards.
- Section header, 44px: 26px icon tile · title (13px/600) · summary on the right (muted text or a count pill) · chevron.
- **Open** section: 3px accent bar on the left edge, header tinted `#fbf6ee` with a divider, icon tile in accent colours.
- Auto-open rules: Active tool opens when the tool changes; Selection opens when something is selected; everything else remembers its last state. `⇈` collapses all.
- Section bodies use labelled fields, segmented controls for 2–4 options, asset cards (thumbnail + name + Change) for model choices, and toggles for booleans.

### 5.5 Menus & popovers
White, 12px radius, large soft shadow, 6px padding. Rows: 26px icon tile + label (+ optional muted description, + optional shortcut on the right). Group labels as above. Danger rows are red and always last.

### 5.6 Pills
Live (green), Unsaved/Warning (amber), Enemy/Danger (red), Count/Neutral (well). Always include a text label; never rely on colour alone.

---

## 6. View recipes

| View | C1 | C2 | C3 | D docks |
|---|---|---|---|---|
| Tracker | expanded list | combatant sheet: header (portrait, name, pills, AC/Speed/Init, `Miniature`, `Save to library`, `⋯`), HP + conditions, abilities, traits, *At a glance* | hidden | none |
| Battle map | rail | 3D canvas | hidden until something is selected → combatant sections (Stats, Appearance, Visibility, Active tool) | D1–D6, play palette |
| Map editor | rail | 3D canvas | always shown, grouped accordion | D1–D6, editor palette |
| Expand map (`⛶`) | rail | canvas | as before | A and B slide away; a tiny "Exit ⛶" dock button stays in D3 |

---

## 7. Migration from the current build

| Today | Goes to |
|---|---|
| Top-bar buttons *Local tracker / Multiplayer* | A2 Table mode dropdown |
| *Asset Library* button, *Combatant Library* button | A3 `Libraries ▾` |
| Session setup bar (campaign / encounter title, Invite, Save, Expand setup) | B1 switchers, B4 Players, B5 Session ▾; full setup → E3 drawer |
| Second "Encounter Ledger" brand + encounter title row | Removed (merged into B) |
| Clear · Import · Export | B5 Session ▾ |
| *Save selected combatant to library* | Combatant sheet header `Save to library` + Combatant ⋯ |
| *Assign 3D Miniature* | Combatant sheet header `Miniature` + Combatant ⋯ + E1 "Look" |
| *Expand Map* / *Browser fullscreen* (classic buttons) | D3 `⛶ ▾` menu |
| Floating level selector panel | D1 dock |
| *Ruler & tactical templates* drawer | D4 tools (Ruler, Template ▸, Draw, Clear); their settings → C3 Active tool |
| *Encounter tracker* button in the camera bar | Removed (B3 does this) |
| Token popover *Select / Move token / Appearance / Properties* | E1: Move · HP · Look · `⋯`; Properties open C3 |
| Editor Line / Room / Corridor as separate tools | Wall ▸ flyout |
| Transitions | D4 *Link* tool + C3 → This level → Transitions |
| Accordion sections on the same background | §5.4 white cards on the well, with group labels |

---

## 8. Responsive rules
- **≥1440px:** as designed.
- **1100–1439px:** the inspector overlays the stage as a drawer instead of pushing it. B3 shows icons + short labels. The `n/m` text in B4 is hidden.
- **<1100px:** the roster rail becomes a button in D1. B1 shows only the encounter name (the campaign moves into its menu). B6 *Add combatant* shrinks to an icon. Docks show icons only.
- Touch: dock buttons and tools stay ≥40px tall.

## 9. Keyboard shortcuts (single registry, ignored while typing in a field)
V Select · M Move · R Ruler · T Template · P Draw · F Floor · W Wall · D Door · O Object · L Link · I Image · E Erase · N New combatant · Space Next turn (DM, with confirmation in multiplayer) · `]` Toggle inspector · `[` Toggle roster · Esc Cancel/close · Ctrl/⌘ Z / Shift Z Undo/Redo · Ctrl/⌘ S Save · `?` Shortcut sheet.
Add a new shortcut here before using it.

## 10. Pull-request checklist for UI changes
- [ ] Every new control has a zone code, and this document is updated if a menu changed.
- [ ] No new rows above the stage, and no new floating bars on the canvas.
- [ ] Object-specific actions sit with the object, not in a bar.
- [ ] Only components from §5. No unstyled native buttons or selects.
- [ ] Destructive actions are in a Danger group and confirmed.
- [ ] It works when collapsed (rail, inspector, sections) and at 1280px wide.
- [ ] Player role checked: DM-only items are hidden.
- [ ] Shortcut registry updated.

---

## 11. Implementation contract (v2.1 additions)

The mockups are visual references, not evidence of the current application's component architecture. Before implementation, inventory existing routes, components, state owners, permissions, and responsive layouts. Maintain a feature-to-zone migration matrix; preserve functionality and data flows. Prefer incremental PRs over a single rewrite.

### 11.1 Accessibility and interaction
- Every icon-only control has an accessible name and visible keyboard focus.
- Menus, drawers, popovers, and modals support logical focus movement, Escape dismissal where safe, and focus restoration. Modal focus is trapped while open.
- Do not rely on colour alone for side, selection, save status, or warnings.
- Meet WCAG 2.2 AA contrast and target-size requirements where practical; use at least 40px touch controls as a project baseline.
- Respect reduced-motion preferences; do not animate essential state changes unnecessarily.
- Avoid shortcut activation while typing, during modal interactions, or when a browser/system shortcut takes precedence. Make shortcuts discoverable.

### 11.2 Layout and state
- Treat A/B heights as desktop design targets, not immutable constraints on narrow viewports or zoomed text.
- Avoid canvas resize/recreation on inspector, roster, or fullscreen changes; verify pointer hit testing and camera state.
- Distinguish local UI preferences (`ledger.ui.*`) from authoritative encounter state. Never broadcast local collapse/selection/fullscreen state.
- Inspector sections show clear unsaved, saving, saved, and failed states; do not conflate local draft edits with persisted map revisions.
- Large asset pickers, floor calibration, and complex forms may use E3/E4 rather than forcing content into a narrow C3.
- When viewport space is insufficient, docks may adapt within their named zones without obscuring map interactions.

### 11.3 Player and preparation workflows
- Define distinct DM preparation, DM live-session, and player view recipes, retaining the same zone vocabulary.
- Player-facing UI must omit unauthorized controls *and* enforce permissions server-side; hiding is not authorization.
- Combatant Library selection during Add combatant remains reachable in no more than two interactions from the active table.
- Preserve the ability to edit maps and library entries without starting a live encounter.

### 11.4 Future feature reservations
- Campaign party presets: A3 Combatant Library and B6 Add combatant menu; configuration in the relevant library page/picker.
- Fog of war: D4 play palette tool/flyout; settings in C3 Active tool; viewer-specific visibility stays server-authoritative.
- Line of sight: D4 tool or contextual visibility controls, depending on implementation; camera toggles in D5 only if they are view settings.
- Animated effects: D4 template/effects flyout for placement, C3 for settings, E1 for instance actions. Respect reduced motion.
- If a feature does not fit, amend this document and the zone matrix before adding controls.

### 11.5 Migration and acceptance
- Phase 0: repository UI audit, screenshots, feature inventory, zone mapping, test baseline.
- Phase 1: shared design tokens and reusable controls; no behaviour change.
- Phase 2: two-row shell, navigation, and session menus.
- Phase 3: roster/stage/inspector layout and map docks.
- Phase 4: tracker, editor, and library workflows; responsive and role-specific refinement.
- Validate at desktop 1440px+, 1280px, tablet, and mobile, plus 200% zoom. Test DM/player permissions, map interactions, fullscreen, import/export, undo/redo, and persistence after each phase.
- Do not delete existing actions until their replacement is discoverable and verified.
- Update visual regression screenshots and this document in every UI-changing PR.


## 12. Repository-backed Phase 0 corrections (proposed for review)

This addendum resolves concrete mismatches found at code baseline `0a2aedf`. It takes precedence **for migration planning** over conflicting visual shorthand above. Sources and complete control coverage are in [ui-audit.md](ui-audit.md) and [feature-zone-matrix.md](feature-zone-matrix.md). These corrections do not authorize implementation or new features.

| ID / affected sections | Corrected planning guidance | Repository reason / traceability |
| --- | --- | --- |
| R01 — §§1–3, 6–7 | Keep zone addresses as presentation ownership. A new Libraries entry does not require a new URL router or remounting the table. | `Multiplayer.tsx` uses component state and invitation hashes, not frontend routes; matrix S01–S09, A01, C01. |
| R02 — §§2–3, 5.4 | Separate live encounter sync, unapplied draft, reusable-template changes, checkpoint save and campaign character-state save. Label each Save by target. | `DungeonBuilder` template comparison is not encounter durability; explicit apply/command/API paths differ. Matrix M17–M27, S18–S19, C16. |
| R03 — §§2–3, 6 | Use Live/Inactive and Start/End session until true pause is separately implemented. Do not ship Pause/Resume as an alias: ending hides the player's current encounter. | `sessionActive` plus projected `sessionState`; audit §4. |
| R04 — §§1, 6, 8, 11.2 | The two-row shell is a desktop target. Allow reflow, internally scrolling panels and safe document scroll for Tracker/auth/libraries/preparation when needed. Do not globally freeze the document or force 1600px body dimensions. | Current local Tracker overflows at 1280/768 and becomes a long sheet on phone; capture metadata in audit §6. |
| R05 — §§1, 2, 8 | A narrow Tracker still needs a C1/B3-associated roster trigger; D1 is only available in canvas views. Define overflow for all docks using available stage width/height, zoom, safe areas and virtual keyboard. | Distinct Tracker branch and current mobile inspector coverage; matrix V01, M18. |
| R06 — §11.2 | Allow responsive canvas resize **in place**, preserving its renderer, controls, transforms and resource leases. Avoid recreation; verify projection after size changes. Do not promise existing camera retention across Tracker switches without deliberately redesigning that lifetime. | `App` unmounts builder in Tracker; panel/fullscreen changes preserve it. `useMapViewport`, R3F and `workspace-helpers` implement the current lifecycle contract. |
| R07 — §§1, 2, 11.3 | Add explicit anonymous/invitation, standalone local, DM preparation, DM live, player waiting and player live recipes. Hide DM A3 library management for players as well as unauthorized A2/B5/B6/editor actions; retain player help/sign-out/presence and permitted tactical tools. Local tracker remains an authorized public workflow: if A2 is omitted, keep mode switching in A4. | `Multiplayer` renders players separately; shared tactical commands have owner/DM rules. Matrix S01–S09, O01–O12. |
| R08 — §§2, 6 | Player E1/C3 must not display concealed `ac:0`, HP `0/1`, empty speed or DM notes as genuine stats. Use only permitted projected fields; a player preview cannot be CSS filtering of a DM snapshot. | Explicit server allowlist in `projectEncounter`, scoped media grants. Matrix T14, T24, V04. |
| R09 — §§1.6, 11.2 | Store only presentation preferences under guarded `ledger.ui.*` keys. Existing local map-template records are user data; migrate/read legacy UI keys separately. Grid/labels, feet-per-square, player visibility, token ownership/positions and campaign HP remain command/API state. | `ledger.dungeon.templates.v1`, `ledger.setup.collapsed`, `ledger.playMode`, `map.settings`, image-specific grid command. Matrix X06, V06–V09. |
| R10 — §§1, 5.4, 6 | Keep supported per-floor drafts and keys at their current owner when opening/collapsing C3/E3. Distinguish floor selection, token selection, active turn and editor selection. Do not collapse every role into one unchecked global selection. The editor inspector defaults open but remains hideable/reopenable, as it is today. | `DungeonBuilder` draft maps and `App`/player selection owners differ; map roster is active-floor scoped. Matrix T12, V01, M01. |
| R11 — §§2–3 | D1 supports Single/Stacked plus local visibility; no `all` mode. Levels/Transitions are map-wide structures accessed under the chosen level. Keep separate local visibility and player revelation. | `LevelView` enum, floor projection and transition endpoints; matrix F01–F07, F17–F24. |
| R12 — §§2–3, 7 | Preserve existing ruler drag, measurement rules, local/shared template states, ownership, expiry and clear scopes. No freehand Draw, generic Clear or Shift-straight behaviour is implied by the artwork. Wall grouping must preserve room/corridor floor generation and walls-only options. | `DrawingSurface`, `useTacticalTools`; matrix M02–M06, O01–O12. |
| R13 — §§2–3, 6 | Preserve calibration preview/apply/cancel, transform lock, uploaded image reuse/deletion and full transition/travel forms including independent remote-source/occupied-destination overrides. Large forms may use E3/E4. | Existing `FloorImagePanel`, `TransitionsPanel`, `TransitionTravel`; matrix F08–F24. |
| R14 — §§2–3, 11.3 | Library management must work before an encounter; adding needs an encounter. Preserve definition/instance separation, saved-vs-full state, duplicate opt-in, tracker-only add, model-default retention, archival, source update and explicit per-character Save to Campaign. Bulk campaign-state save is not an existing API. | `CombatantLibrary`, `library.add`, `library.state.save`; matrix C01–C17. |
| R15 — §§2–3, 6 | Preserve in-place expand/restore and separate document-native fullscreen. Keep native dialog top-layer access, inert restoration and denial fallback. C3/expanded controls must stay inside the correct owner subtree; native Escape may exit fullscreen before ordinary dismissal. | `useMapViewport` targets `document.documentElement`; `Modal` portals to body. Matrix V10–V12, X01. |
| R16 — §§1.9, 5, 11.1 | Reuse native semantic controls and `Modal`; style them. Mockup display spans are not menu/button implementations. E3/E1 must define modality, focus return, pointer isolation and overflow. Do not add a second GLB loading/projection pipeline for visual consistency. | `Modal`, `FloatingObjectToolbar`, `ToolbarProjection`, `SharedModel3D`, scoped resource cache/preview. |
| R17 — §§1.10, 3, 10 | Keep destructive/replacement/revocation confirmations. Decide an explicit exception policy for undoable erase/object/overlay edits before migration; do not add a modal to every drawing/delete gesture. Preserve undoability and names of clear operations. The current Clear prompt understates that `encounter.clear` also resets the environment; correct the confirmation scope without silently changing the command. | Current immediate map gestures and existing native confirms have different consequences; matrix X02. |
| R18 — §§1.3, 5.2 | Use one primary action per action group rather than literally one accent-coloured element per whole view. Selection, enemy identity and destructive text are separate semantic uses of colour. | Mockup itself has Next turn, Save map and an active red tool simultaneously; current editor also needs both save and turn entry points. |
| R19 — §§5.1, 11.1 | Adjust muted-text tokens/combinations during Phase 1 before treating palette fidelity as accessibility. On opaque supplied tokens, `#7a7268` on `#ece6da` is about **3.81:1**, and on `#f4f0e8` about **4.17:1**; neither meets 4.5:1 for normal small text. `#b0a89b` on `#fbf9f4` is about **2.24:1** and is not normal readable body text. Disabled controls have different WCAG treatment. | WCAG relative-luminance calculation using supplied CSS values; actual translucent docks still require testing over varied scenes. No global AA conformance claim follows from a token table. |
| R20 — §§5.2, 8, 11.1 | The 40px project touch baseline overrides 30–36px/32px examples for touch interaction; preserve labels, focus and 200% zoom reflow. Scope CSS instead of copying resets/global `header`, `button`, `body` rules. | Existing layered styles and narrow captures; audit §§6–7. |
| R21 — §9 | Treat the advertised shortcut set as proposed. Preserve current V/F/W/D/O/E, scenery Delete/Shift+D and context-safe Escape first. Resolve focused-field, modal, IME, repeat, tool and browser conflicts before a single registry; do not activate global Space/Save/Undo silently. | Distributed listeners in builder, drawing/tactical tools and context toolbar. No current centralized registry or defined contextual Save target. |
| R22 — §§2–3, 11.4 | Encounter rename, resend, blank/direct-JSON encounter-combatant creation, Temp HP, durations, recharge logic, player preview, recent-edit timeline, account preferences/help pages, arbitrary roster order and future fog/LOS/effects/party presets are not required implementations of these visuals. Mark unsupported items absent/reserved pending scoped approval. | Actual components, schemas and API inventory; matrix §10. Model/source badges may be derived later without implying new write semantics. |

The [migration plan](ui-migration-plan.md) is the proposed Phase 1–4 sequence, with smaller PR boundaries, test dependencies and acceptance criteria. Stop for review after Phase 0. Do not import reference CSS/HTML/images into runtime code or change persistence/permissions to satisfy an illustrative label.

## 13. Phase 1 implementation note

The user authorized Phase 1 on 31 October 2026. [Foundation contracts and evidence](phase-1-foundations.md) document the namespaced token/control implementation and the existing Miniature settings dialog as its first E4 adoption. Normal muted text uses `#625b50`, with tested opaque colour pairs; 40px control targets and native button semantics take precedence over compact mockup examples. Menus contain actions, form popovers are nonmodal, and drawers explicitly use native modal semantics with caller-owned drafts. These implementation choices do not authorize later navigation changes or introduce new domain capabilities. Original supplied references remain unmodified.

## 14. Phase 2 implementation decisions

The user authorized the application shell on 1 November 2026. [Phase 2 implementation](phase-2-application-shell.md) and the [actual-location matrix](feature-zone-matrix.md#phase-2-actual-locations) document A/B adoption. Campaign/encounter switchers remain native constrained selectors at desktop; setup is a retained modal drawer. Current-table templates reuse editor management, not a global library service. Player Tracker is the existing permitted read-only sheet, with its map retained. Start/End and Live/Inactive remain truthful; true Pause/Resume and bulk campaign saves are absent. Selected combatant model/library/campaign actions use the sheet/map roster menu to remove loose chrome. Phase 2 deliberately extends R06 with one lazy retained workspace per table across Tracker/map/editor, visibility-gated resize/keyboard handlers, and scene-identity regression coverage. No Phase 3 dock/inspector regrouping or deployment is authorized by this change.
