# Current local UI baseline

Captured on 31 October 2026 from unchanged application commit `0a2aedf`, using system Chromium and the existing Playwright dependency. These are screenshots of the local sample tracker/map/editor, not the external proposal.

For each of 1440×1000, 1280×900, 768×1024 and 390×844, captures show:

- `*-tracker.png`: initial synthetic encounter with its existing sample statistics.
- `*-battle-map.png`: default flat battlefield with its real Three.js scene.
- `*-map-editor.png`: local blank map created through the existing UI, in temporary in-memory state; inspector scrolled to the New blank map operation after creation.

`observations.json` records viewport, document and canvas dimensions. Captures are viewport screenshots (not full-page exports), returned to the document top to show chrome consumption. Forms/panels may have independent scroll positions. Google font requests were blocked; text uses installed fallback fonts. No backend, authenticated campaign, private model, real character artwork or persistent user data was used.

These screenshots demonstrate local layouts only. They do not verify online DM/player interfaces, GLB textures, browser-native fullscreen, keyboard accessibility, assistive technology, physical touch or 200% browser zoom. Those remain explicit implementation acceptance checks in the migration plan.

To reproduce from the repository root with the installed dependencies and `/usr/bin/chromium`, start the existing Vite server on `http://localhost:5173`, then run:

```sh
node docs/ui/current-baseline/capture.mjs
```

The documentation utility uses temporary browser contexts and existing UI actions, overwrites only this baseline directory's captures/metadata, and does not change application source or server state. It is not part of the production build or a visual-regression assertion suite. Change its recorded source commit only when deliberately capturing a new reviewed code baseline.
