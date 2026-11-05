# Milestone 6.0 — atmospheric lighting

## Audit and architecture, before implementation

Main commit 07f055d includes Milestone 5.7.1 (terrain/inspector) and c18dff6 (CI selection/readiness repair). The working tree was clean. Repository merge state is verified; this task does not independently verify or change production deployment.

BattleMap3D owns one R3F Canvas with demand rendering, ACES filmic tone mapping (R3F default), sRGB output and shadows. Its ambient light is white/intensity 1.05; its directional light is at [8,14,6], intensity 2.1, 1024px shadows. GLBs use shared cached/cloned models and lit standard materials. Calibrated images, repeating textures and terrain masks use unlit basic materials to preserve artwork; procedural geometry uses standard materials. Floors share one scene with elevation groups and optional stacked visibility. Map commands, bounded history, server transactions/revisions, player projection and JSON/template persistence already support optional appearance data.

### Three reviewable increments

- **6.0A** adds optional global lighting.environment and per-level lightingOverride, legacy-compatible rendering, environmental controls and local Low/Medium/High quality/flicker preferences. Enabling atmospheric lighting opts floor artwork into a consistent lit material, with a small legibility fill; maps with no lighting fields keep their original materials/lights/exposure. No GLB binary or cached material is changed.
- **6.0B** extends the same map-owned rig with stable point emitters, existing-grid placement, gizmos, explicit local attachments, safe detach/missing-parent behavior, optional bounded shadows and subtle local flicker. Reuse existing object/combatant updates, not animation-frame commands.
- **6.0C** adds map-scoped snapshots of environmental/floor overrides and existing emitter appearance, explicit scene CRUD/activation/previous restoration and authoritative transition metadata. Saved scenes never copy geometry or GLB binaries; normal edits do not autosave them.

Use additive JSON normalization, no separate renderer/service/store and no SQL migration. Existing records are not rewritten. Older strict map readers will not accept new fields, so coordinate binary rollback and keep untouched map copies. Each increment gets its own branch/commit and focused tests/documentation; no automatic deployment or 6.1 work.

### Per-floor policy

Three.js ambient/directional lights affect the entire scene. This milestone deliberately implements **active-floor atmosphere**: the viewer's active floor merges selected override properties with the global environment. All simultaneously visible floors share that environment; inactive floors are not independently illuminated. In B, only active-floor emitters contribute. Overrides/emitter data remain floor-associated for future isolated rendering. UI discloses this policy. Floor switching changes the chosen atmosphere without resetting renderer, camera, objects or floor data. Hidden floors remain filtered, and can never become a light-data side channel.

### Material/quality/resource policy

Absent lighting data reproduces the existing white lights, shadow defaults, unlit artwork and exposure. Configured maps use opt-in standard materials for floor images/textures/terrain, retaining UVs, masks, opacity, clipping and tint. A modest emissive/fill component prevents an artistic dark scene from becoming a rules-based black screen; grid and labels retain their visibility. Artist exposure is bounded. Lighting has no effect on HP, ownership, initiative, movement, visibility permissions or campaign state.

Quality is local viewer preference, never authoritative map data. Low: four point lights, no shadows/flicker; Medium: eight, one selected point shadow; High: sixteen, two selected point shadows. Directional resolutions are capped by profile/GPU limits; point shadows use smaller bounded maps. No automatic FPS claims. Reduced motion disables flicker and transition animation. Shadow targets are disposed on replacement/disable/unmount; demand invalidation runs only while a permitted animation is active. Existing Asset Library previews retain their own lights.

### Attachments, scene privacy and transitions

B attachments reference stable scenery/combatant IDs plus explicit local offsets. Resolve grid anchors, rotation, scale/vertical offset and effective floor from existing state. Detach retains resolved world placement; removed parents safely detach at their last committed location. Hidden/unplaced combatant emitters are not projected to players. Standalone gizmos/names and scene management remain DM-only; players receive only permitted effective light data, not private presets/previous snapshots/hidden floor or hidden parent identities.

C captures environmental/floor overrides and existing emitter appearance, not placement or attachment identities. Activating a scene preserves current geometry, combat state, positions, active floor and camera. Missing/deleted light references are skipped, not resurrected. Explicit Save Changes/Save as New records current settings. Activation/restore stamps one server time and transition ID/duration through existing revisions; targets persist immediately. Existing viewers interpolate locally from current appearance; initially joining viewers render the authoritative target, and elapsed transitions snap to final. No per-frame networking or serialized renderer objects.

Risks to test: legacy material parity; opting lit terrain into the same colour/alpha pipeline; active-floor disclosure; light/parent floor transfer and deletion; hidden source/preset projection; bounded point/shadow budgets; stale revisions; transition/reduced-motion behavior; repeated resource replacement and retained scene identity. Physical-device and assistive-technology checks remain manual.

## 6.0A implementation and acceptance

`lighting.environment` is optional document-level data; `lightingOverride` is optional level geometry data. `map.lighting.environment.set` and `map.lighting.override.set` use the existing DM-only map edit/history/revision pipeline. Global data is explicitly excluded from level geometry and retained through composition/duplication. Partial floor overrides copy with their floor and disappear with it; hidden floor records remain excluded from player projection. There is no SQL migration.

The viewer's local quality/flicker keys contain no campaign or map data. Existing maps use legacy white ambient 1.05, directional 2.1 at [8,14,6], exposure 1 and basic floor materials; configured maps use the opt-in material and a small fill. Shader cache keys distinguish clipped images from repeating/masked artwork. Directional shadow maps are bounded/disposed on quality changes, and renderer exposure/shadow settings are scoped/restored imperatively. Asset previews are unchanged.

Manual A checklist: load an untouched warehouse and compare; apply each template then customize colours/intensities/direction/exposure/shadows; check GLBs, images, repeating textures, painted terrain, grid and labels. Apply a partial office override, switch floors and stacked view, reset it, undo/redo and save/reload. Check camera/scene identity/fullscreen, player read-only synchronization and hidden floors. Change local quality in one browser and confirm authoritative JSON and the other browser's preference are unchanged. Review tablet controls, keyboard focus and actual device performance; do not claim a measured FPS without profiling.

A validation: 140 unit tests passed (3 existing infrastructure guards skipped); the four new database/socket tests passed; the foundation browser case passed; all three existing image/terrain browser cases passed. Lint, type checks and production build passed (existing bundle-size advisory remains). The final partial-schema assertions additionally passed after removing nested defaults, ensuring unchecked properties inherit. A is isolated on feature/milestone-6-0a-lighting-foundations; B and C will stack on its reviewed data/rendering adapters. No deployment occurred.
