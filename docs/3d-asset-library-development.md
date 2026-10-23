# 3D Asset Library: development and usage (Milestone 4A)

## Upgrade and run

Use Node 24+, the existing PostgreSQL setup and the same DM account authentication.

```bash
npm ci
docker compose up -d --wait
npm run db:migrate
npm run dev:all
```

Set `ASSET_STORAGE_DIR` in `.env` to a private persistent directory **outside the application checkout**, for example `../.ledger-assets` in Codespaces. It resolves relative to the backend working directory. The development fallback is that same sibling directory. Production requires an explicit value. Create/mount it with read/write access for the backend user; the adapter creates directories with mode 0700 and files with mode 0600, rejects traversal and symlinks, and refuses directories inside the app. Do not expose it with Vite, Express static middleware, a web server alias or a public bucket.

For Codespaces, forward only Vite port 5173 as before; all uploads and model reads use the same-origin proxy. Keep the storage directory on the persistent Codespace volume. This library requires a backend and DM sign-in; the offline local tracker is unchanged.

Migration `004_asset_library.sql` adds `assets_3d` with account ownership, metadata/tags/presentation JSON, original filename, byte count, MIME/format, private storage key, SHA-256 hash, upload/validation status, metrics, revision and timestamps. It adds a partial unique index on owner/content hash and an owner/date listing index. No existing campaign, encounter, map, artwork or imported JSON data is modified. Run `npm run db:migrate:production` after building for production.

## Upload from Meshy

1. Export a **self-contained GLB 2** from Meshy, with embedded buffers and PNG/JPEG textures. Do not export ZIP, separate glTF/textures, Draco/Meshopt-compressed geometry or KTX2 textures for this prototype.
2. Open **Multiplayer**, sign in as a DM, then choose **Asset Library** in the top navigation. No campaign selection is necessary. The library belongs to your account and is reusable across your own campaigns; player campaign membership does not grant library access.
3. Choose the GLB, enter its name/category, optional description and comma-separated tags, and source (defaults to Meshy AI). Click **Upload model**. Progress shows transfer followed by validation. Cancellation/disconnection removes staging data; a successfully acknowledged asset is persisted.
4. Select a card to preview. The grid itself loads metadata/placeholders only. Search name/description/tags, filter by category, and use pagination for more than 50 assets.
5. Edit name, description, category, tags, source and presentation defaults in the details panel. Save uses a revision check; refresh details after a stale edit. Equal GLB content is rejected as already present within your account instead of storing another copy.
6. Delete after confirmation to remove the unused file and tombstone its metadata. If storage is temporarily unavailable, deletion remains pending and can be retried or completed at restart. Refresh details to get the latest revision before retrying.

Only metadata of ready assets can be edited. Pending records represent a validated publication or deletion in progress; startup reconciliation completes/cleans them. A crash before metadata creation may leave a staging file, which is removed once it is older than 24 hours. Normal upload failures clean immediately. Run only one backend instance with this filesystem/recovery implementation.

## Preview controls and transforms

Drag to orbit, right-drag to pan, and scroll to zoom. **Reset preview camera** recomputes framing from the model bounds. Framing includes scale/orientation and works for small miniatures or larger furniture. A neutral background, grid and basic lights are provided; no animations play.

Presentation defaults are metadata: uniform scale (0.0001–10000), rotation about Y in **degrees** (0–360), vertical offset in world units (−10000–10000), and an optional display name. The preview centres the transformed X/Z bounds and grounds its lower Y bound at zero, then applies the vertical offset. The original binary remains byte-for-byte unchanged. Future instances may override these defaults without changing the shared asset.

Preview files are fetched only from authenticated API endpoints. Each preview owns its loaded model, releases geometry/material/texture/skeleton resources when replaced or closed, ignores stale loads, and uses a separate camera/Canvas from the encounter. Library navigation keeps the encounter mounted. Loading, unavailable files, malformed responses and render failures have visible fallbacks. Retry a preview by reopening its details or the library.

## Limits and security

All settings are positive integers, checked at startup; `.env.example` contains defaults. Maximum permitted configuration values bound accidental resource expansion.

| Variable | Default | Upper configuration bound |
| --- | ---: | ---: |
| ASSET_MAX_BYTES | 26214400 (25 MiB) | 104857600 |
| ASSET_MAX_VERTICES | 500000 | 2000000 |
| ASSET_MAX_TRIANGLES | 500000 | 2000000 |
| ASSET_MAX_NODES | 1000 | 5000 |
| ASSET_MAX_MATERIALS | 128 | 512 |
| ASSET_MAX_ANIMATIONS | 16 | 64 |
| ASSET_MAX_TEXTURES | 64 | 256 |
| ASSET_MAX_TEXTURE_DIMENSION | 4096 | 8192 |
| ASSET_MAX_TEXTURE_PIXELS | 67108864 total | 134217728 |
| ASSET_VALIDATION_TIMEOUT_MS | 15000 | 60000 |

Mesh instances count toward geometry budgets; morph targets count toward vertex work. Additional fixed caps are 256 meshes, 1024 total primitives, eight morph targets per primitive and JSON nesting depth 64. Only triangle primitives are accepted. Embedded image dimensions are inspected before browser decoding. PNG/JPEG only; external and data URI resources are rejected. A small allowlist of standard material/texture-transform/quantisation extensions is supported; custom extensions and external decoders are not.

The upload body streams through Busboy into a private staging file with backpressure, a byte counter and bounded multipart fields. Metadata is capped at 16 KiB; total multipart overhead at 32 KiB. File suffix/MIME alone do not authorise acceptance: GLB magic/version/length/chunks, JSON references/bounds/resources and Khronos glTF Validator semantic checks all apply. Validation runs in a worker with a 256 MiB JavaScript heap limit and a configurable deadline. No resource fetching is permitted. Two uploads can process globally, one per account; per-IP limits are 20 uploads and 120 metadata/deletion operations per 15 minutes. Use an upload/request timeout and body limit at the production reverse proxy as well.

All list/detail/file/edit/delete routes check the existing authenticated DM account and owner ID. Players, unauthenticated callers and unrelated DMs cannot access known UUIDs. Existing CSRF/origin, HttpOnly/SameSite/Secure cookie and no-wildcard-CORS policies remain. Binary responses are private/no-store, `nosniff`, same-origin and sandboxed; internal storage paths/keys are never returned. Preview secondary requests are restricted to embedded blob resources. This is format/resource validation, not malware scanning; keep dependencies and browsers updated.

## Filesystem, Docker and recovery

`AssetStorage` abstracts staging, publication, reads, deletion and existence checks. The filesystem adapter generates UUID/hash keys on the server and atomically renames validated staging files into account-owned content-addressed paths. It stores no binary/base64 in PostgreSQL. A future S3 adapter can replace this behind the same API; no library UI change is needed.

The Docker image prepares `/var/lib/encounter-ledger/assets` for the non-root node user and declares it as a persistent volume. Compose's optional `app` profile mounts `ledger-assets` there; its default PostgreSQL-only workflow is unchanged. For the app profile, configure production `APP_ORIGIN` to your exact HTTPS origin, a unique `SESSION_SECRET`, and an HTTPS reverse proxy with WebSocket support. Build and migrate using that profile before starting the app:

```bash
docker compose --profile app build app
docker compose --profile app run --rm app node dist-server/server/migrate.js
docker compose --profile app up -d app
```

PostgreSQL must already be healthy. Keep port 3001 private behind the TLS proxy. Do not use the development database password for production.

Back up **both PostgreSQL and the asset volume/directory** as a matched set. For a simple consistent backup, stop the app, take a PostgreSQL dump and archive the private directory (including permissions), then restart. Restore both before starting the backend. Restoring only the database produces unavailable previews; restoring only files loses library metadata/access policies. Startup reconciles validated pending publications, removes pending rows with missing files, retries tombstoned deletions and removes old staging files. It does not guess ownership from orphaned binaries. Persistent staging cleanup happens at startup, not through polling.

## Tests and limitations

```bash
npm test
npm run test:integration
npm run lint
npm run typecheck
npm run build
# With frontend/backend running:
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Tests use a small valid generated GLB fixture, not commercial assets. Integration tests create isolated database schemas and temporary storage directories; no application data is truncated. Browser tests create isolated accounts in the development database. Use Meshy exports in a manual smoke test as well: upload a miniature and furniture at different scales, orbit/zoom/reset, save defaults, reload and retry after a backend restart. Private Meshy subscription credentials and original commercial files are not needed by the application.

4A deliberately has no model assignment, dungeon placement, player asset grants, animation playback, thumbnail generation, Meshy API integration or public sharing. PNG/JPEG triangle GLB support is narrower than the entire glTF ecosystem. No automatic mesh optimisation or content malware scanner is included. Account storage quotas, multi-instance upload coordination and background orphan reconciliation are recommended before broad hosting. The production bundle retains the existing size advisory; previews are loaded only for selected models, but further code splitting is useful.

For 4B, introduce a versioned miniature appearance reference (`assetId`, scale, Y rotation in degrees, verticalOffset), server-side encounter-reference grants for player retrieval, and transactional reference/deletion guards before rendering on combatants. Copy/override defaults per instance; never embed another copy of the GLB in encounter JSON. Apply the same contract to a later 4C uploaded-prop variant without weakening the existing procedural-prop allowlist.

## Verification results (2026-10-22)

- `npm test`: 25 checks passed (7 original map/application guards, 18 shared/backend domain/storage/GLB checks). Includes a valid embedded PNG GLB, malicious properties, worker timeout, headers/chunks/JSON/semantic rejection, traversal/symlink rejection and filesystem persistence.
- `npm run test:integration`: 32 checks passed, including all existing multiplayer lifecycle checks plus account-private library upload/read/edit/delete, player/anonymous/other-DM denial, CSRF, declared and chunked oversize requests, traversal filenames, failed publication, interrupted upload cleanup, pending-state recovery, retryable deletion, rate limiting and unchanged source bytes after metadata edits.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`: all six scenarios passed. New coverage uses an embedded PNG texture and checks upload/empty state, metadata/search/filtering, loading/error fallbacks, preview orbit/zoom/reset, scale-based framing, lightweight grid requests, encounter Canvas continuity and deletion. Existing combat, activation, camera, generation, template and furniture-selection tests are unchanged and pass.
- Lint, frontend/backend TypeScript checks and production build passed. The build retains a large-chunk advisory (approximately 1.71 MB / 473 KB gzip).
- Source and compiled migration commands passed; a compiled production worker validated a GLB successfully using plain Node. Default and app-profile Compose configuration validated. The Docker image was not rebuilt in this run.
- The library layout and rendered preview were inspected in browser screenshots. No private Meshy export was supplied, so a real Meshy-model smoke test and representative laptop/GPU profiling remain recommended.
