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
standard `AC`/`Armor Class`, `HP`/`Hit Points`, initiative, speed, ability score,
skill, sense, language, challenge rating, trait, action, and reaction fields.
Imported actions are clickable, making it easy to mark limited or memorable
abilities as used and reset them when they become available again.

Use **How many** to add a numbered group of identical creatures at once. An
existing combatant can also be duplicated or removed from its stat card, while
**Clear** resets the entire encounter after confirmation.
