# Phase 2 shell captures

These are review captures of the real application shell and renderer with synthetic local/DM/player data. They do not import the mockup background. External Google font requests are blocked and reduced motion enabled. [Metadata](observations.json) records viewport width, document width and both visible chrome heights; the capture refuses page overflow.

- Local: [1440 tracker](local-tracker-1440.png), [1280 map](local-map-1280.png), [768 map](local-map-768.png), [390 map](local-map-390.png), [320 map](local-map-320.png).
- DM: [1440 map](dm-map-1440.png), [1280 map](dm-map-1280.png), [768 map](dm-map-768.png), [390 map](dm-map-390.png), [1280 setup drawer](dm-setup-1280.png).
- Player: [1440 map](player-map-1440.png), [390 map](player-map-390.png), [320 map](player-map-320.png).

Reproduce only with a **disposable development database and asset store**, migrated backend, Vite server and registration enabled: `node docs/ui/phase-2-baseline/capture.mjs`. It creates a synthetic DM account, campaign, encounter and one-use player invitation; do not point it at production. `APP_ORIGIN` and `CHROMIUM_PATH` override local defaults. No account credentials, invitation token, cookie or uploaded private data is written to capture metadata.

Screenshots are review artifacts, not pixel comparison tests, screen-reader/cross-browser certification or proof that Phase 3 docks/inspector have been redesigned. Behaviour and domain assertions are in the existing Playwright suite and the new shell tests.
