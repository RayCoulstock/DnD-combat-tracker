# Phase 1 miniature settings captures

These four screenshots show the **existing MiniatureSettings component**, using a synthetic character with no assigned model, inside the dev-only foundation fixture. They demonstrate scoped form styling and font-offline layout, not a completed redesign, online authorization, model-rendering acceptance or the proposed shell.

| Width | Capture |
| --- | --- |
| 1440 | [Miniature settings](1440-miniature-settings.png) |
| 1280 | [Miniature settings](1280-miniature-settings.png) |
| 768 | [Miniature settings](768-miniature-settings.png) |
| 390 | [Miniature settings](390-miniature-settings.png) |

[Metadata](observations.json) records viewport/dialog dimensions and horizontal overflow. External Google font requests were blocked and reduced motion enabled. Screenshots are viewport captures; long modal content scrolls within the existing dialog. They are review artifacts, not pixel comparison assertions.

To reproduce, start Vite (`npm run dev`) and run `node docs/ui/phase-1-baseline/capture.mjs` with Chromium installed. `CHROMIUM_PATH` and `APP_ORIGIN` can override defaults. The capture uses only local synthetic state; no backend/database is needed. Behavioural assertions are in `e2e/ui-foundations.spec.ts`; the real online cancellation workflow extends `e2e/miniatures.spec.ts` without creating another account.
