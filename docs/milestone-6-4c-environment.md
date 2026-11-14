# 6.4C environment adapter

Implements Issue #58 against main `11765df` (approved contract PR #59 and merged
6.3A–D). `generateSceneEnvironment` implements the existing `SceneGenerationStage`.
Only the C adapter, its tests and this handoff are owned here. Shared contracts,
generator internals, B assets and D orchestration are unchanged. No command is registered.

The coordinator supplies validated canonical floors and an authorized, fresh manifest.
The adapter validates its inputs, clones the document and resolves seeded room indices
with the unchanged generator (including the documented additional-floor seed suffix).
It iterates floors/zones in proposal order and candidate cells by z then x. Effects use
existing preset defaults, stable bounded IDs and legacy looping playback without timestamps.
It creates no attachments, transitions, damage rules or fog reveals.

Existing effects and lights count against map-wide budgets, including disabled sources.
Later effects are omitted at the effect cap; missing presets receive `effect-omitted`.
A lighting-capable effect receives an exclusively owned canonical emitter only while the
source budget permits, otherwise it remains a visual effect with `budget-reduced`.
Generated emitters cast no point shadows, satisfying even a zero shadow budget. Existing
content is preserved even when already over generation budgets. ID collisions fail closed.
The optional environment replaces only the global environment; source overrides, scenes,
playback and geometry remain intact. Absence preserves existing lighting/defaults.

Seeded and explicitly concealed variants use `initialFog`. Preserve mode requires the
authoritative source and identical floor IDs, dimensions, elevations, cells, walls and doors;
source masks are cloned. Existing effect visibility/projection and renderer clipping remain
the fog authority; hidden effects and linked glow are never separately exposed by this stage.
Quality stays a renderer concern: existing 4/8/16 point and 0/1/2 point-shadow limits,
preset particle profiles and reduced-motion behavior remain unchanged. No GPU frame-time
or physical-device performance claim is made by this pure stage.

## Contract integration limits

The approved context has no room analysis for variants. Effect-bearing variant zones fail
with an explicit unresolved-room error, as required by the A specification. Variants without
effect zones can apply environment/fog settings. Proposed follow-up for the contract owner:
provide deterministic, validated room annotations for variants, or approve a common room
analysis algorithm. This PR does not invent either contract independently.

The documented additional-floor seed suffix can exceed the existing generator's 100-character
seed limit. That existing error is surfaced rather than silently truncating or changing the
shared seed derivation. The contract owner should approve a bounded seed derivation before
supporting maximum-length seeds on additional floors.

D must integrate this stage after B and before final canonical/spatial validation, and retain
DM authority, source/manifest revision checks, atomic history and campaign isolation. Full
preview/accept multiplayer and browser/server pipeline tests await that coordinator; this
module is deliberately not enabled in production. Physical GPU/tablet budget measurement
also remains an integration gate before enabling scene generation.
