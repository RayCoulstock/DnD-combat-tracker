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
