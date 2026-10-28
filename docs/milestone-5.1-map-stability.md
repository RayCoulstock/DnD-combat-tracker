# Milestone 5.1: map stability

## Modal layering and interaction

Drei `Html` labels assign depth-dependent z-index values (default range starts at
16,777,271). The old Add Object, architecture and miniature dialogs were ordinary
fixed divs at z-index 100; the combatant dialog used 10. The battlefield had no
isolated stacking context. Labels therefore participated in document stacking and
could cover dialogs. `aria-modal` on a div neither makes background content inert
nor traps focus. Editor capture-phase Escape and other window key handlers also
continued to act on map state while dialogs were active.

All modal surfaces now use `Modal.tsx`, a body portal containing a native dialog
opened with `showModal()`. Application modal UI belongs to the browser top layer;
map labels and floating controls belong to the isolated battlefield stacking
context. Label depth ordering remains unchanged. No larger modal z-index is
needed. Native modal behavior provides background inertness, focus containment
and focus restoration. Dialog gesture handlers stop React propagation. Global
map key handlers explicitly return while any dialog is open, including capture
Escape; the active dialog handles Escape through its cancel event. Inline Asset
Library navigation remains a page, and the picker within miniature settings uses
the enclosing modal rather than creating another dialog.

Future modal surfaces should use this component. Native browser support for
`HTMLDialogElement.showModal()` is required.

## GLB loading mismatch

Preview and map already used the same `loadGlb` parser. Both fetch the same
same-origin asset endpoint with session cookies; map URLs additionally carry
campaign/encounter query parameters for player authorization and an actor fragment
for cache partitioning. Fragments are not sent to the server. The DM endpoint
checks ownership; player requests check current encounter references and session
membership. Neither endpoint nor identifiers changed.

Both paths use Three GLTFLoader, the same permitted embedded resources and
materials, and SkeletonUtils clones. Preview optionally displays raw export units
and fits the camera; map placements normalize/ground the source, or apply edge
calibration for architectural visuals, before applying placement transforms. These
intentional presentation differences are unchanged.

The actual policy mismatch was in `AssetResourceCache`: only map loading passed
through it, rejecting models above 256 MiB of estimated decoded memory or when 16
distinct entries were active. Preview loaded directly without either restriction.
Three 4096-square textures alone estimate to 288 MiB at the loader's six bytes per
pixel, while fitting the server's default 64-megapixel validation limit. Thus a
valid, previewable textured GLB could be downloaded and parsed successfully and
then discarded as "Model unavailable" by the map cache.

The cache now limits idle retention rather than admission of active resources.
It still coalesces loads, allows only two concurrent loads, evicts idle resources,
and disposes oversized resources immediately after their last lease is released.
Active placements retain shared source geometries/textures and independent scene,
skeleton, and transform instances. Ghost materials remain independently owned.
Failed entries are removed for retry; abandoned late results are disposed safely.
Preview now uses the same lease lifecycle, with a mount-specific preview namespace
to prevent account switches reusing a previous preview's resource. Map actor and
encounter cache keys remain unchanged. Preview and map may each download a source
once; multiple map placements share one download and parse.

The loader reports HTTP status with recovery guidance and parse errors with their
cause. It checks cancellation before parsing and disposes completed resources if
cancellation arrives during parsing. Map retry remains available.

## Regression evidence and limitations

`e2e/map-stability.spec.ts` uses real combatant, door and failed-model labels and
checks native top-layer membership, hit testing over every label, background
pointer/focus blocking, Escape, and restored controls without remounting the map.
A second browser regression validates a self-contained three-4K-texture fixture
against server limits, renders it through both preview and map components, checks
two independent transforms and one shared map request, then exercises HTTP 503
recovery and unmount. Cache/loader tests cover authenticated fetch, parse errors,
retry, cancellation, disposal and active resources exceeding retention limits.
Existing scenery and architecture browser/integration suites cover saved maps,
templates, player access, broadcasts and reconnects.

Original Oak Barrel and Medieval Oak Door binaries and production diagnostics were
not supplied. The texture-budget failure is reproduced with a validated synthetic
GLB; the exact failure of each named production asset cannot be independently
confirmed here. Browser/GPU hardware can still impose practical limits on very
large active scenes. Cache limits govern retained idle resources, not a hard cap
on resources required by active placements. Unsupported/compressed/external glTF
resources remain subject to existing server validation and loader restrictions.

No database, API, multiplayer protocol, map schema or asset reference changes.
No additional rendering libraries or multiple-floor functionality.

## Validation results

Validated with Node 24.19, Chromium 154 (software WebGL), and an isolated PostgreSQL
17 database. Test assets and database were disposable; no production services
were used.

- `npm test`: 76 passed; 3 existing environment-dependent infrastructure checks
  skipped (Caddy image/daemon and PowerShell tooling unavailable).
- `node --env-file=<isolated-test-env> --import tsx --test server/tests/*.test.ts`:
  all 51 passed, including storage, templates, persistence, scoped downloads,
  reconnect/restart and multiplayer behavior.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`: final complete run passed 14
  scenarios; the existing furniture-selection test exposed a timing-dependent
  camera projection failure. It now uses the existing `projectBattlefield` helper
  rather than reconstructing the initial camera. Its targeted rerun passed,
  verifying all 15 browser scenarios across the complete run and corrected rerun.
  Both new stability regressions passed in the complete run and separately.
- `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`:
  passed. Build retains the existing large-bundle advisory.
