# D&D Combat Tracker

A responsive encounter dashboard for tracking initiative, hit points, conditions,
and creature stat blocks during a Dungeons & Dragons combat.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer
- npm (included with Node.js)

## Run locally

```bash
git clone <repository-url>
cd DnD-combat-tracker
npm install
npm run dev
```

Open the URL printed by Vite (normally <http://localhost:5173>). The development
server reloads the page whenever you save a source file.

## Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Vite development server |
| `npm run build` | Create an optimized production build in `dist/` |
| `npm run lint` | Check the source with ESLint |

## Adding a combatant

Select **Add combatant**, paste a plain-text stat block, choose whether the
combatant is an ally or enemy, and enter its initiative. The importer recognizes
standard lines such as `Armor Class 15`, `Hit Points 27`, `Speed 30 ft.`, and the
six ability scores. The first non-empty line becomes the combatant's name.
