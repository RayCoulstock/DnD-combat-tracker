# Phase 4 visual review

Actual running application at 1600/1280/768/390 CSS pixels, height 1000, Chromium, reduced motion and external font requests blocked. Tracker uses synthetic local demo data; libraries use a fresh synthetic DM account, campaign, imported character and tiny textured GLB in a disposable database. No production data, sessions or credentials are included. Cards use labelled GLB fallback artwork; selected previews use the real renderer. Compare hierarchy and control ownership against [the tracker reference](../references/v2/04-tracker.png), not decorative pixel equality.

Run with an already migrated disposable development database/API and Vite:

```sh
CHROMIUM_PATH=/usr/bin/chromium node --import tsx docs/ui/phase-4-baseline/capture.mjs
```

This creates synthetic development records; use a fresh test API to respect normal registration quotas. The script blocks remote fonts, waits for actual preview rendering, records document dimensions and resets scroll for consistent captures. Viewport resizing is not browser zoom. These screenshots complement semantic regression tests and do not certify screen readers, physical touch or other browser engines.

- `tracker-*`: expanded desktop/tablet C1, collapsed narrow roster with explicit recovery control.
- `combatant-library-*`: current library navigation/filters/detail at desktop and narrow widths; long detail forms scroll within the modal.
- `asset-library-*`: searchable category-labelled grid and selected model detail/preview; page scrolling is expected for full calibration/metadata forms.
- `observations.json`: dimensions and horizontal-overflow observations without account/asset identifiers.
