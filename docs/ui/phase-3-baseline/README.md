# Phase 3 visual review

Reproduce with `node docs/ui/phase-3-baseline/capture.mjs` against the development app. Only built-in synthetic demo combatants and a deterministic locally generated dungeon are used. No credentials, server campaign data, private assets or connection tokens are captured. `observations.json` records viewport/dock bounds. Google fonts are blocked and reduced motion is enabled for reproducibility.

Compare these actual-app captures with [Battle map](../references/v2/02-battle-map.png) and [Map editor](../references/v2/03-map-editor.png). Review the C1/C2/C3 hierarchy, grouped cards on the well, Wall flyout and ownership of D1–D6. Differences in camera, scene topology, imported statistics, fonts and the mockup's decorative background are expected. These images are review artifacts, not a claim of pixel equality with a static mockup.

Automated browser layout regressions in `e2e/battle-workspace.spec.ts` assert six visible dock owners, bounds/non-overlap at five widths and real click actionability with the laptop/tablet inspector open. Domain/browser tests retain grid/floor/model and role assertions. Cross-browser screenshots, physical touch, screen readers and actual browser 200% zoom remain manual acceptance checks in the [implementation report](../phase-3-battle-workspace.md).

| Workspace | Desktop | Laptop / tablet |
| --- | --- | --- |
| Editor | [1600px](editor-1600.png) | [1280px](editor-1280.png), [768px](editor-768.png) |
| Battle map | [1600px](battle-map-1600.png) | [1280px](battle-map-1280.png), [768px](battle-map-768.png), [390px](battle-map-390.png) |
| Context | [Wall flyout](wall-flyout-1600.png) | [Combatant inspector](combatant-inspector-1600.png) |
