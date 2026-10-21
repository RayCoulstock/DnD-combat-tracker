# 3D Tabletop Milestone 1 Plan

## Repository assessment

The application is a single-page React/Vite tracker. `App.jsx` owns the encounter state with React hooks: combatants contain initiative, HP, AC, conditions, saves, actions, and optional embedded artwork; separate state tracks the active/selected combatant, round, and used abilities. The tracker UI, stat-block parser, JSON import/export, and encounter controls currently live in that component. JSON files are versioned and serialize the complete encounter state. There are no automated tests or test framework; ESLint and the Vite production build are the existing checks.

## Architecture overview

- Keep `App` as the single source of truth for combatants, initiative state, and map state.
- Add pure TypeScript map-state helpers for bounds validation, safe import normalization, token placement, reconciliation after roster changes, and immutable movement.
- Add `BattleMap3D` as a presentational/interaction boundary. It receives combatants and map state via props and emits `onSelectToken` and `onMoveToken` commands.
- Split scene concerns into floor/grid/walls, token rendering, camera controls, and surrounding tabletop panels. Camera state stays local to the map because it is presentation state rather than shared encounter state.
- Extend existing versioned JSON files with an optional `battleMap` property. The import path accepts files without it and derives safe token positions.

## State model

`BattleMapState` contains version, grid width/height, feet per square, grid visibility, label visibility, and a token-position record keyed by the existing combatant ID. No combat statistics are copied into map state. `moveToken(combatantId, destination)` is the only movement operation in `App`.

## Coordinate system

Grid positions are integer `{ x, z }` coordinates in the inclusive range `0..width-1` and `0..height-1`. The Three.js world is centred at the origin. Grid `(0, 0)` maps to the north-west square centre at `(-width/2 + 0.5, -height/2 + 0.5)` in world X/Z coordinates. One world unit equals one five-foot square.

## Encounter integration

Adding/importing/removing combatants runs map-state reconciliation: known positions are preserved, invalid or missing positions receive the first available square, and removed IDs are discarded. Selecting a token updates the existing selected combatant ID. Active initiative and selected IDs are passed to token rendering for distinct highlights. Tracker/map view switching only changes presentation and therefore preserves all state.

## Future multiplayer considerations

The scene never mutates encounter state directly. It emits ID-based movement commands with integer destinations, creating a boundary where a later authoritative service can validate and broadcast commands. Combatant data, map state, camera state, and rendering remain separated. Multiplayer, authentication, persistence services, collision/pathfinding, fog of war, and automated movement rules are explicitly out of scope for this milestone.
