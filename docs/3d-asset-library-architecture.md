# Milestone 4A: unified 3D asset library

## Inspection and implementation plan

The application has an authenticated Express/Passport/PostgreSQL backend, cookie sessions with origin/CSRF checks, DM-only campaign/map routes, typed Socket.IO encounter commands, and a React/Vite/React Three Fiber client. Dungeon props are an enumerated procedural registry in `DungeonScene`, backed by strict shared JSON schemas. Artwork currently uses content-addressed PostgreSQL bytes and JSON import/export; it is not a general upload mechanism. The new library will not modify artwork, dungeon schemas, encounter files, combatants, Socket.IO commands or player cameras. Existing unit, PostgreSQL integration and Playwright browser tests remain required.

Implement A: shared metadata, additive migration and storage; B: bounded upload and GLB validation; C: account-private library UI; D: isolated preview; E: security/persistence/browser regressions and runbook. Work on `feature/3d-asset-library` from the clean hybrid-builder branch, retaining its furniture selection fix.

## Ownership and lifecycle

Assets belong to a DM account, so that DM can reuse the library across their own campaigns. Campaign/player membership grants no library or binary access in 4A. Every list/detail/file/edit/delete request authenticates the server-held DM identity and checks owner_id; UUID possession is never authorisation. Public static hosting is prohibited. Players and unrelated DMs cannot retrieve even a known asset UUID. Future sharing requires an explicit encounter-reference grant, not merely a campaign ID supplied by a caller.

Stable UUID metadata records include name/description/category, tags, source, original filename, GLB format/MIME/size, server-controlled storage key, content hash, presentation defaults, validation metrics/status and audit timestamps. Equal content is deduplicated within an account. No GLB/base64 is stored in PostgreSQL. Original files never change when metadata changes. Metadata updates use expected revisions. Delete is a tombstone transition with retryable binary removal; future references must be checked before tombstoning. Pending file publication and deletion are reconciled on backend startup; stale staging files are cleaned without touching active uploads.

## Storage and upload

A storage interface owns streaming staging writes, atomic publication, authenticated streaming reads, deletion and existence checks. The filesystem adapter uses an explicit ASSET_STORAGE_DIR outside application/public source directories, restricted permissions, server-generated UUID/hash keys and traversal/symlink checks. Docker uses a persistent volume. A later S3 adapter implements the same contract; the UI uses authenticated API URLs only. Back up the binary directory and PostgreSQL together.

Use a two-step upload: create metadata after bounded binary streaming/validation, then publish and mark ready. The client uses Busboy-parsed multipart with exactly one GLB and one bounded metadata JSON field; limits cap fields, files, part headers and total request bytes without buffering the binary body. An exact byte counter enforces the default 25 MiB cap even with no Content-Length; streaming uses backpressure. Upload progress uses XMLHttpRequest. Auth/CSRF/origin checks precede reading. Rate limits and concurrent-upload limits bound server work. Staging is always cleaned after errors/disconnects.

Validate GLB 2 headers, exact declared length, aligned JSON-first/optional BIN chunk structure, and strict self-contained glTF JSON. Use Khronos glTF Validator for semantic checks in a bounded worker with a deadline, plus explicit geometry/node/material/animation/image limits before expensive processing. Reject external/data URI resources, unsupported extensions/compression and non-PNG/JPEG textures. Inspect image dimensions before client decoding. Return bounded safe errors, never internal paths or validator dumps. Configurable limits are documented in the runbook.

## Library and preview

Add a DM-only Asset Library panel to multiplayer navigation, usable before selecting a campaign. Keep the encounter UI mounted while the panel is shown so its camera/selection survives switching. The grid fetches metadata only and uses placeholders, search/category filters, details/edit forms, upload progress/status, and confirmed deletion.

`AssetPreview3D` fetches only the selected authorised GLB, parses with GLTFLoader, cancels stale loads and denies secondary resource requests. It owns its scene (no shared loader cache), disposes geometries/materials/textures on replacement/unmount and releases failed/stale loads. A separate Canvas/OrbitControls keeps its camera independent. Measure transformed bounds, frame automatically, reset to that framing, show loading/error states, neutral light/background and a ground/grid. No animation playback or custom decoder fetching. Presentation uses uniform scale, Y rotation in degrees, and vertical offset in world units; ground the transformed lower bound at y=0, then apply verticalOffset. The original GLB stays unchanged.

## Persistence, compatibility and future contracts

Migration 004 adds asset metadata/indexes without altering existing encounters/maps. Account + content hash deduplication prevents duplicate GLBs. Storage publication uses atomic filesystem operations; startup reconciliation handles process crashes between file and database updates, and failed uploads do not leave usable permanent records. Tombstones make deletion retryable. Library traffic is independent of encounter revisions and does not broadcast private metadata to rooms.

4B may add a validated `MiniatureAppearance {assetId, scale, rotation, verticalOffset}` reference, resolved against ownership/grants by the server, with per-instance defaults copied/overridden. 4C can add a versioned uploaded-prop variant with the same reference contract. Both must introduce reference tracking/deletion guards and authorised player binary retrieval. Neither assignment nor placement is part of 4A; current map prop allowlists and encounter JSON remain unchanged.

## Verification

Unit tests cover storage traversal and bounded writes; valid/malformed/truncated/external/over-budget GLBs and resource counts. PostgreSQL/HTTP tests cover DM/player/anonymous/other-account access, upload cleanup, duplicate content, metadata revisions, tombstones, authenticated reads and restart recovery. Browser tests cover empty state, upload, search/filter, details edits, preview loading/error/framing/reset, deletion and preserved encounter navigation. Run all existing unit/integration/browser tests, lint, both TypeScript checks and production build.

## Implemented modules

`shared/assets.ts` owns metadata/presentation and future appearance contracts. `server/asset-storage.ts` provides private streaming filesystem storage; `asset-config.ts` sets bounds; `asset-glb.ts` performs structural/resource/semantic validation; `asset-validation-worker.ts`/`asset-validation.ts` isolate validation. `server/assets.ts` owns authorised HTTP routes and startup reconciliation, registered by `app.ts` and started by `index.ts`. Migration 004 adds the metadata table. `AssetLibrary.tsx` handles DM browsing/upload/management; `AssetPreview3D.tsx` owns independent model loading/framing/cleanup. Multipart streaming uses Busboy; semantic validation uses the official Khronos gltf-validator package. Generated GLB/PNG fixtures and unit, HTTP and browser tests cover the implementation. See the runbook for completed verification, backup procedure and prototype limits.
