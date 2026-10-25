# Canvas-focused map editor

The editor uses the DM setup's cream/white theme. No database migration, domain schema, command, authorisation or Socket.IO contract changes are required.

- Opening **3D Map** or **Map editor** collapses multiplayer setup to campaign, encounter, round, presence and session actions. **Expand setup** restores the full cards. The collapsed preference is stored as `ledger.setup.collapsed`; storage failures do not prevent using the interface.
- The workspace fits the remaining browser height. The initiative rail and inspector scroll internally. The DM rail starts collapsed; expand it with **»**. Player rosters retain their full list by default and can also be folded. Hiding/reopening the inspector or expanding the roster preserves the mounted canvas and camera.
- The canvas palette has **Select (V), Floor (F), Wall (W), Door (D), Object (O), Erase (E)**, plus wall-line, room and corridor tools. Shortcuts ignore text-entry fields and open asset pickers. Undo/redo are top-right; **History** contains clear history with its existing confirmation.
- Bottom-left controls reset the camera, toggle shared grid/labels, zoom and switch to top-down. The bottom-right scale readout expands to the existing DM feet-per-square form. Shared toggles retain existing permission enforcement. Rulers and tactical overlays remain available in the **Ruler & tactical templates** drawer.
- **Active tool** opens on tool changes. **Selection** opens when a map object is selected. Click walls, doors or scenery on the map; advanced transform and calibration forms are preserved. Door-state buttons send the existing authoritative door command. The placed scenery list also provides an accessible selection alternative.
- Scenery, floor, templates, generation and blank-map sections start collapsed. Template naming, save/open/overwrite/rename/duplicate/delete, generation preview/accept/cancel, room sizing and seed options remain available. **Unsaved template changes** compares the encounter map against the last successful template save or load; encounter edits still persist automatically as before.
- **Collapse all** folds inspector sections; **Hide panel** frees canvas space. On small screens the inspector overlays the canvas and can be hidden with the same button.

Regression coverage includes the existing domain/server suites, multiplayer browser scenarios and a workspace-specific test for keyboard shortcuts, text-entry isolation, panel toggles, canvas identity, camera controls and narrow-screen layout.

Logical edge hit areas support selecting walls and doors through holes in uploaded geometry. These are editor hit targets only and do not introduce collision, movement or geometry-based game rules.

Verified on 25 October 2026: 46 unit tests, 49 server integration tests and all 12 browser scenarios pass. The furniture selection test also verifies that floating Scale controls focus the inspector input. Frontend/backend type checks, ESLint and the production build pass. Vite retains the existing non-blocking large-bundle advisory.
