# D&D Combat Tracker

A responsive encounter dashboard for tracking initiative, hit points, conditions,
and creature stat blocks during a Dungeons & Dragons combat.

## Requirements

- [Node.js](https://nodejs.org/) 24 or newer
- npm (included with Node.js)

## Run locally

```bash
npm ci
npm run dev
```

Select **Local tracker** for the original standalone workflow. Multiplayer adds a
TypeScript/Socket.IO server, PostgreSQL, DM accounts, invitations and authorised
player views. Follow [multiplayer setup and Codespaces instructions](docs/multiplayer-development.md)
to start the complete system. See the [architecture](docs/multiplayer-architecture.md)
for command ordering, identity, persistence and privacy boundaries.

## Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite frontend (standalone mode needs no backend) |
| `npm run dev:all` | Frontend and backend together |
| `docker compose up -d --wait` | PostgreSQL development service |
| `npm run db:migrate` | Apply transactional database migrations |
| `npm run db:seed` | Optional seed using supplied DM credentials |
| `npm run build` | Build frontend and TypeScript backend |
| `npm run typecheck` | Check shared, frontend and backend TypeScript |
| `npm run lint` | ESLint for JavaScript and TypeScript |
| `npm test` | Original map tests and shared domain tests |
| `npm run test:integration` | PostgreSQL/Socket.IO multiplayer/security tests |
| `npm run test:e2e` | Real browser multiplayer and camera tests |
| `npm start` | Serve built frontend/API/Socket.IO in production |

## Adding a combatant

Select **Add combatant**, paste a plain-text stat block, choose whether the
combatant is an ally or enemy, and enter its initiative. The importer recognizes
standard `AC`/`Armor Class`, `HP`/`Hit Points`, initiative, speed, ability score,
skill, sense, language, challenge rating, trait, action, and reaction fields.
Imported actions are clickable, making it easy to mark limited or memorable
abilities as used and reset them when they become available again.

Use **How many** to add a numbered group of identical creatures at once. An
existing combatant can also be duplicated or removed from its stat card, while
**Clear** resets the entire encounter after confirmation.

## Saving an encounter

Use **Export** to download the complete encounter as a JSON file, including the
round, active turn, current hit points, conditions, used abilities, and character
art. Use **Import** to restore one of these files later—no account or database is
required.

Select a combatant's portrait or choose **Add art** on its stat card to attach an
image. Artwork up to 3 MB is stored directly in exported encounter files, so it
will still be available when the encounter is imported on another device.

## Using the 3D battle map

Choose **3D Map** in the header to open the local virtual tabletop. Each
combatant is represented by a colour-coded token on a 20 × 20 grid, where every
square represents 5 feet. Allies are green, enemies are red, the selected token
has a blue ring, and the active initiative token has a gold ring.

Select a token (in the scene or initiative panel), then select a destination
square to move it. Positions snap to integer grid coordinates and remain intact
when switching back to the tracker. Drag to rotate the camera, right-drag to pan,
and use the mouse wheel to zoom. The controls panel can reset the camera and
toggle grid lines or token labels.

Map settings and token positions are included in encounter JSON exports. Files
created before the map was added remain importable; missing or invalid positions
are assigned safe starting squares automatically.

## Hybrid dungeon builder

DMs and local users can choose **Map editor** to paint terrain, draw walls, operate doors,
place props, generate seeded dungeons, and save reusable templates. Players receive the
shared encounter environment automatically while keeping independent cameras.
Apply `npm run db:migrate` when upgrading multiplayer installations.
See [the builder guide](docs/dungeon-builder-development.md) for controls, map lifecycle,
generation, two-player checks and limitations, and [the architecture](docs/dungeon-builder-architecture.md)
for the schema, authority and persistence design.

## 3D Asset Library (Milestone 4A)

Authenticated DMs can open **Asset Library** from Multiplayer navigation to upload,
organise and preview private GLB models. Apply migrations and set `ASSET_STORAGE_DIR`
to a persistent directory outside the checkout. Models are not assigned to tokens
or placed in maps in this milestone. See the [asset-library guide](docs/3d-asset-library-development.md)
and [architecture](docs/3d-asset-library-architecture.md) for supported exports,
limits, storage/backup configuration and future integration contracts.

## Playable 3D miniatures (Milestone 4B)

After applying migrations, select a combatant in a DM encounter and choose
**Assign 3D Miniature**. Pick an existing owned GLB, preview it, adjust its
scale/rotation/base, and save. Players receive the model through authorised
encounter-scoped delivery and keep the existing token movement controls.
See [miniature usage and testing](docs/3d-miniatures-development.md) and
[architecture](docs/3d-miniatures-architecture.md) for normalisation, migration,
access rules, fallbacks and the visual-only multi-square base limitation.

## Custom 3D scenery (Milestone 4C)

DMs can choose **3D Scenery** in the dungeon editor to browse existing Asset Library
models, place them with snapped/free anchors, and edit independent instance transforms.
Apply migration 006 before starting the backend. Procedural props and logical walls/doors
remain available. See [the scenery guide](docs/custom-3d-scenery-development.md) and
[architecture](docs/custom-3d-scenery-architecture.md) for version compatibility,
map/template/history persistence, player access and deletion safeguards.

Milestone 4D adds one **Add Object** browser plus calibrated GLB visuals on logical walls and doors. See [architecture](docs/milestone-4d-architecture.md) and the [Meshy calibration and multiplayer guide](docs/milestone-4d-development.md). Apply migration 007 before running this version.

Milestone 4E adds atomic wall/room/corridor drawing, local/shared rulers and transparent tactical areas, plus projected contextual controls. See the [implementation plan](docs/milestone-4e-plan.md) and [tool and multiplayer guide](docs/milestone-4e-development.md). Tactical data uses existing encounter JSONB; no new database migration is required.

The canvas-focused editor layout is described in the [workspace guide](docs/map-editor-workspace.md): floating tools and camera controls, an initiative rail, an accordion inspector, and remembered multiplayer setup collapse.

## Production readiness

Before planning a VPS deployment, read the [repository audit](docs/deployment/repository-audit.md) and [Phase 1 readiness guide](docs/deployment/production-readiness.md). The production environment template is [.env.production.example](.env.production.example). The existing Compose file remains development-only; this phase does not provision or deploy infrastructure.
