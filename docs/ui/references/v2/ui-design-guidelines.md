# Encounter Ledger — UI design guidelines

**Status:** v2 layout concept. **Audience:** anyone (human or AI agent) adding or changing UI.
Read this before adding any button, panel, toolbar or menu. Every new control must have a **zone address** from this document.

Reference images (place in `docs/ui/`):

| File | Shows |
|---|---|
| `01-blueprint.png` | Screen anatomy with zone codes, and the contents of every menu |
| `02-battle-map.png` | Battle map (play). Libraries menu open, ruler active, token popover |
| `03-map-editor.png` | Map editor. Wall tool with flyout, grouped accordion inspector |
| `04-tracker.png` | Tracker. Expanded roster, combatant sheet with its own actions |

The `.html` source for each image is the exact styling reference (colours, sizes, spacing). `concept.css` holds the tokens.

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
