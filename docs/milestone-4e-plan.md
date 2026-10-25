# Milestone 4E implementation plan

## Repository inspection
The battlefield uses one React Three Fiber Canvas and browser-local OrbitControls. DungeonScene owns procedural/GLB map rendering; EditorSurface handles floor raycasts. DungeonBuilder owns tool choices and sends typed commands. Canonical H/V walls and linked doors are validated in shared/dungeon.ts. Shared editMap produces one bounded history frame per command. Game execution locks campaign/encounter, checks revisions, persists JSONB and asset references, then broadcasts recipient snapshots. Combatants and map templates remain separate entities. Existing tests exercise two players, GLB grants, restart/reconnect and cameras.

## Stage 1: atomic drawing
Add validated parametric map.draw commands for axis-aligned wall lines, rectangular rooms and straight width-configured corridors. Compute batches on client for preview and independently on server using the same pure function. Vertices are integer map-boundary coordinates. Dominant-axis snapping makes straight drags predictable. Existing walls/doors/props take precedence over generated perimeter walls. Corridor cuts only door-free entry/seam walls along floor connectivity; doors and unrelated architectural objects are preserved; a logical GLB wall on an intended corridor opening may be cut, with its appearance recoverable by undo. One command, revision and undo frame per gesture. Reuse selected floor/wall/GLB presets.

## Stage 2: measurement
Add an explicit battlefield tool controller with local ruler drafts, cancellation and grid-rule math. Euclidean uses map feet-per-square; grid modes snap endpoints to cells and count diagonals as one or alternating one/two squares. Tool pointer surface takes precedence over token/editor gestures, with middle/right camera gestures preserved. Shared measurements use encounter-scoped authoritative records with owner identity and a short server-set lifetime; expired records are excluded, and measurements never enter map templates, exports or checkpoints.

## Stage 3: tactical overlays
Separate versioned tactical records from dungeon props and combatants. Transparent sphere/ground footprint, horizontal sector cone (90-degree default), cube and line use the same grid conversion. Drafts stay local until Share. Shared records have stable UUIDs, server-bound owners, validated dimensions/colour/opacity and owner/DM mutation rules. Keep current records in existing encounter JSONB, outside map undo/template persistence, with snapshot/reconnect recovery. Old encounters default to no overlays; no relational migration is needed.

## Stage 4: contextual controls
A reusable projected floating toolbar follows the selected world anchor each camera frame, clamps to the canvas and visible browser bounds, handles Escape and keyboard focus, and stops its own pointer events only. Map actions invoke existing commands/property panels; token controls retain ownership and DM miniature settings; tactical controls reuse overlay operations. Preserve advanced panels and independent cameras.

## Verification
Pure tests for drawing, preservation, history, dimensions and ruler rules. Integration tests for player batch denial, owner-only overlays, revision conflicts, broadcasts and persistence/reconnect. Browser tests for gestures/previews, local versus shared state, toolbar contexts, Escape and camera isolation. Run all unit/integration/browser suites, frontend/backend TypeScript, lint and production builds after implementation. Report each stage; do not replace working renderers or auth.
