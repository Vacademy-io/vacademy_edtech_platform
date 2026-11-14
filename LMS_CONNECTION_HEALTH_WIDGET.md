# Dashboard widget: LMS connection health

Answers one question on the admin dashboard: **are the institute's external LMS
connections actually reachable right now?** Each row is a live probe of a saved
connection, with the failure reason and a link to fix it.

Gated by the same per-role Display Settings as every other dashboard widget.

---

## Why the check runs server-side

The existing `POST /admin-core-service/lms/v1/test-connection` tests the values *in the
settings form*, before saving — the browser already has those values, so it can send them.

A dashboard widget has neither: it needs to test the **saved** credentials, and it must not
receive them. So this adds a sibling endpoint that reads the stored connections and probes
them from the backend:

```
GET /admin-core-service/lms/v1/connection-health?instituteId=
```

Two reasons it could not have been done from the browser:

1. **Secrets.** The WordPress application password and Moodle web-service token would have
   had to travel to the client and back. The response here carries only each connection's
   **host** (`myvtc.com.au`), never a credential.
2. **CORS.** Customer LMS sites are not CORS-open to the dashboard origin, so a browser
   fetch would fail regardless of the credentials.

## Backend

`LmsSettingService.getConnectionHealth(instituteId)` reuses the existing
`testConnection` — same probes, same admin-readable messages — but feeds it stored values
instead of form values.

**Connection resolution is shared, not copied.** The block inside `getProviders` that works
out an institute's connections (curated list → legacy config → discovered from course
settings) was extracted into `resolveInstituteConnections`. Both the settings page and the
health check now go through it, so the widget can't end up reporting on a different set of
connections than the one the admin sees in Settings. `getProviders`' behaviour is unchanged.

**Concurrency.** Each probe allows up to 10s, so a serial sweep of several connections could
outlast the request. Probes run on a pool capped at `HEALTH_MAX_PARALLEL_CHECKS` (4) so a long
connection list can't open an unbounded number of sockets from one dashboard load, and the
whole sweep is bounded by `HEALTH_SWEEP_TIMEOUT_SECONDS` (25). Anything still running at that
point is reported as a timeout rather than holding the response open.

**Three statuses**, because "not tested" is not a failure:

| status | meaning |
| --- | --- |
| `HEALTHY` | probe succeeded |
| `UNHEALTHY` | probe failed — `message` says why, in admin language |
| `NOT_APPLICABLE` | no automated probe exists (built-in Vacademy, a custom LMS) |

Only LearnDash and Moodle have real probes. Reporting a custom LMS as unhealthy because we
have no endpoint for it would cry wolf on every dashboard load.

**Cached 1 minute, per institute** (`lmsConnectionHealth` Caffeine cache). The widget polls
every 60s, so without this every open dashboard would independently probe the customer's
WordPress/Moodle site every minute — five admins with the tab open means five times the
outbound traffic to a third party we don't own. The TTL matches the poll interval, so the
result is never older than the widget claims.

The obvious objection to caching — an admin fixes a connection and keeps seeing the failure —
is handled by `?force=true`, which the manual refresh button sends. That path
(`refreshConnectionHealth`, `@CachePut`) probes live and replaces the cached entry.

## Frontend

`src/routes/dashboard/-components/LmsConnectionHealthWidget.tsx`.

- Per-connection rows: name, default badge, host, latency, and the backend's message verbatim
  — it is already written for admins and already says what to do.
- Header summarises `N of M not reachable`, plus a manual re-check button.
- When something is down, a link deep-links to **Settings → LMS** (`selectedTab: 'lms'`), not
  the settings root.
- **Polls every 60s** (`refetchInterval`), served by the backend's 1-minute cache, so N open
  dashboards still cost the LMS one probe per minute rather than N. `refetchOnWindowFocus` and
  `refetchIntervalInBackground` are both off — nobody is reading the widget in a background tab.
- The **"checked N ago" label runs off a ticking clock** (15s interval), not off the query. If it
  only re-rendered on refetch, a paused poll (backgrounded tab) or a failing one would go on
  claiming the data was fresh.
- The **manual refresh does not go through `refetch()`**. It fetches with `force=true` and writes
  the result into the query cache with `setQueryData`. Threading a force flag through the queryFn
  would have meant either putting it in the query key — forking the cache entry, so the forced
  result would never replace the stale polled one — or smuggling it via a ref, which is what the
  `@tanstack/query/exhaustive-deps` lint rule exists to catch.

### Two deliberate distinctions

- **A failed health *request* is not an unhealthy LMS.** If our own endpoint errors, the card
  says the check couldn't run and offers a retry — it does not claim the customer's LMS is
  down.
- **The summary counts only probed connections.** Saying "all N reachable" when some of the N
  have no automated test would claim a check that never ran. Untestable ones are reported
  separately as "not checkable".

### Self-hiding

Renders nothing when nothing was actually probed — no connections at all, or only
untestable ones. An institute on the built-in Vacademy LMS has no integration that can be
unhealthy, and a card that can only say "we can't tell" is noise. Same convention the
sub-org widgets use.

This is *in addition to* the settings gate, not instead of it.

## Settings wiring

New widget id `lmsConnectionHealth`, threaded through the four places
`widget-labels.ts` already documents as required:

1. the `DashboardWidgetId` union (`types/display-settings.ts`)
2. `DASHBOARD_WIDGET_LABELS` → "LMS connection health"
3. admin defaults — **first** in the order, **hidden**
4. teacher defaults — same position, **hidden**

### Position and width

Rendered as the **first child of the dashboard's full-width main-content column**, so it spans
the screen instead of sharing a row. First because a broken LMS connection silently breaks
enrolment for every course wired to it — that outranks anything else on the page.

Note the main dashboard layout is fixed JSX order; the `order` field only sorts one analytics
sub-group and drives the Settings list. So "first" had to be a JSX move, not an order change —
the order value is set to match so the two don't disagree.

### Hidden by default, strictly

Ships `visible: false` for **every** role. A connection-health card is only meaningful to an
institute that has actually connected an external LMS, and enabling it starts polling that
customer's site every minute — so it is opt-in.

Gated on `isWidgetExplicitlyVisible`, not the shared `isWidgetVisible`. The shared helper fails
**open** (`vis !== false`), which is right for widgets that have always shipped on — a
settings-load failure shouldn't blank the dashboard. But an opt-in widget must not switch
itself on that way, and this one starts hitting the customer's LMS the moment it renders.

Wrapped in `TrackedWidget` for view telemetry, like the other widgets.

**Existing institutes pick it up automatically.** `mergeDisplayWithDefaults` starts from the
defaults, so a widget missing from a saved blob is auto-added with the default visibility and
an order placed *after* the user's last saved widget — it lands at the bottom of an existing
dashboard rather than colliding with an in-use order slot. No settings migration needed.

## Verification

- `admin_core_service` compiles clean.
- `tsc --noEmit`: no errors in any touched file.
- `eslint` and `scripts/design-lint.mjs`: clean on the new widget; no new findings in the
  shared files touched.

**Not exercised against a live LMS.** The probes themselves are the pre-existing, already-in-use
`testConnection` code paths, but `getConnectionHealth` and the widget have not been run against
a real institute.
