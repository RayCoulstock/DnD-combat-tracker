# Session activation synchronisation fix

## Root cause

Waiting players did not have a usable subscription to the campaign:

1. The browser only created a socket when its HTTP-loaded details already contained `activeEncounterId`. A player arriving before encounter creation never opened a socket.
2. `campaign.join` called the active-encounter snapshot function before joining the room. It rejected players if the encounter was not active, so an already-authenticated player could not receive the later activation broadcast.
3. Session termination removed players from the room and disconnected their UI. Later restarts again required a manual rejoin.
4. Snapshot ordering compared revisions only within an encounter and accepted every different encounter ID. That cannot order delayed end/start events or an old snapshot arriving after a switch back to another encounter.

Refreshing happened to reload the HTTP metadata after activation, allowing the normal active-room join to succeed.

## Focused changes

- Authenticated members may subscribe to their campaign before an encounter exists or a session starts. Membership, session, CSRF, origin and command permissions are still checked server-side. A waiting subscription grants no encounter access.
- The server subscribes the socket before reading its fresh authoritative state, closing the gap between the initial read and the activation broadcast. A second authorization check accompanies that read.
- A typed `session.state` event carries campaign identity, campaign revision, activation status, encounter identity and an optional recipient-filtered snapshot. Inactive players receive `snapshot: null`. The existing REST snapshot access rules, command permission checks and legacy snapshot events remain intact.
- Migration `002_campaign_state_revision.sql` adds `campaigns.state_revision`. Encounter creation/opening, activation/end, accepted game commands and checkpoint restoration increment it atomically under the existing campaign lock. This orders the entire campaign stream, including switches between encounters whose own revisions differ. Exact duplicate commands do not advance it.
- The browser connects based on authenticated campaign membership, rather than stale HTTP encounter metadata. It applies `session.state` only for the selected campaign and rejects lower campaign revisions. Old socket callbacks are guarded after effect disposal, and delayed HTTP metadata cannot replace newer authoritative activation metadata.
- Ending a session leaves authorized members subscribed in the waiting room. New starts update them automatically. New connections and reconnects always receive a fresh authoritative state after subscribing.
- Lifecycle changes do not tear down the socket or an existing camera. An inactive player's previously authorized scene is hidden and movement disabled, then reused on activation. No camera settings are transmitted; revocation/logout still clears retained state.
- No browser reloads, HTTP polling or timer-driven state broadcasts were added. The old periodic state broadcast was reduced to its existing credential/membership-expiry check. Activation updates are emitted directly after committed lifecycle changes.

## Regression coverage

- Real PostgreSQL/Socket.IO tests cover subscriptions before encounter creation, waiting with an inactive encounter, denial of inactive commands/reads, first activation reaching existing sockets, a concurrent join, joins after activation, reconnecting while waiting, rapid end/start and encounter switching, and durable campaign revisions across server restart.
- Existing role, ownership, cross-campaign, hidden-data, revocation, session-expiry and authentication tests still run.
- A shared ordering test rejects delayed old-encounter and termination updates, accepts an unchanged-version reconnect, and rejects another campaign's update.
- A browser regression joins one player before encounter creation and another before activation, starts through the DM interface, and checks that both battlefields appear within five seconds. It also joins a late player, verifies no player HTTP requests or navigations are used to obtain activation updates, retains the exact canvas element and checks the camera image over end/start within a small rendering tolerance (also verifying that a reset view would fail that comparison), and switches encounters while players remain connected.

## Applying the update

Apply migrations before starting the updated backend:

```bash
npm run db:migrate
npm run dev:all
```

For compiled production deployment use `npm run build`, `npm run db:migrate:production`, then restart the service with `npm start`. Deploy matching frontend/backend versions. No credential or campaign data changes are required.

## Validation result

The complete suite passed: six existing map tests, five shared-domain tests, 20 PostgreSQL integration checks (including the parent lifecycle test), and both Chromium browser scenarios. ESLint, frontend/backend type checks, production build, repeated source/compiled migrations and `git diff --check` also passed. The existing nonfatal Three.js bundle-size warning remains unchanged.
