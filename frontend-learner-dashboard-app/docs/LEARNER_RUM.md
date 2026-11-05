# Learner app speed numbers (real users)

`src/lib/perf/learner-rum.ts` measures what learners actually experience and stores it in
the platform's own database. No third party receives the report, and the browser sends Sentry
nothing for it. The backend does sample these requests: see [Sentry cost](#sentry-cost).

## What is collected

20% of tab sessions report (`SAMPLE_RATE`). Each report goes to
`POST /admin-core-service/v1/perf/rum` when the tab is hidden or closed, and becomes rows in
`perf_rum_minute` (admin_core_service), kept for 14 days. **Save a baseline before that window
closes on it.**

| Metric | Meaning | Unit |
| --- | --- | --- |
| `lcp` `fcp` `ttfb` | First load only | ms |
| `settle` | First load: page start until the first screen has no query in flight | ms |
| `inp` | Worst interaction, per screen visit | ms |
| `cls` | Largest layout shift burst, per screen visit | score x 1000 (100 = 0.1) |
| `inp-` `cls-` | Cancels an earlier `inp` or `cls` row: subtract it | same as above |
| `nav` `navs` | Tap to the new screen committed / to it having no query in flight | ms |
| `navq` `navqs` | The same, for a search-param change on one screen, such as next lesson | ms |

`settle` and `navs` see queries that go through the query client, not direct requests, so they
are a lower bound. A browser that lacks an entry type, mainly Safari, does not report that metric.

A visit stays one visit when the tab is hidden and comes back. `inp` and `cls` go out on the first
hide. After a return nothing more is sent unless the value moved to a higher bin, and then the new
row goes with a `-` row for the earlier one, because rows carry no visit id to correct them later.
Leaving a screen and coming back to it is a new visit. A row whose report never arrived can leave
its `-` row unmatched, so the query floors each bin at zero.

## Screens with no LCP

Chrome stops recording LCP at the first scroll, and a smooth programmatic scroll counts. When a
screen scrolls itself on opening, there may be no `lcp` row at all, with nothing to say so. The
query below shows those screens with `samples` far below `first_loads`.

**`/study-library/courses` is one today.** The effect in `CoursesPage.tsx` that scrolls the list
into view on a page change also runs on opening, before the first content paints. The page always
overflows the viewport slightly, so this happens whatever the length of the list. Use `settle` for
this screen.

## Reading a row

`route_key` holds one measurement, split on `|`:

```
lv1 | metric | bin | skin | tier | conn | platform | viewport | cache | build | screen
lv1 | lcp    | 2500 | corporate | mid | 4g | web | phone | cold | abc12345 | /dashboard
```

- `bin`: the value was at most this much.
- `tier`: `low` (up to 4 cores or 2 GB), `mid` (up to 6 cores or 4 GB), `high`, or `na`.
- `cache`: `cold` or `warm`, from whether the entry script was fetched or came from cache.
- `screen`: the route template. `unresolved` means no screen resolved before the tab went away,
  which includes a full-page redirect hop such as `/auth-transfer`. The screen after that hop reads
  `warm` even when the learner's true first load was cold, so check the share of `unresolved` before
  relying on the `cache` cut. `other` means the template check refused it.
- The count is `unannotated_count`, not `sample_count`, and `buckets` stay zero. This keeps these
  rows out of the health portal's server and network charts, which read the histogram.

## p75 LCP by screen and skin

```sql
WITH v AS (
  SELECT split_part(route_key, '|', 2)       AS vital,
         split_part(route_key, '|', 3)::int  AS bin,
         split_part(route_key, '|', 4)       AS skin,
         split_part(route_key, '|', 5)       AS tier,
         split_part(route_key, '|', 7)       AS platform,
         split_part(route_key, '|', 9)       AS cache,
         split_part(route_key, '|', 11)      AS screen,
         institute_id,
         unannotated_count                   AS n
    FROM perf_rum_minute
   WHERE metric = 'server'
     AND route_key ~ '^lv1\|[a-z]+-?\|[0-9]+\|'
     AND bucket_start > now() - interval '14 days'
), net AS (
  SELECT rtrim(vital, '-') AS vital, screen, skin, bin,
         greatest(sum(CASE WHEN vital LIKE '%-' THEN -n ELSE n END), 0) AS n
    FROM v
   GROUP BY 1, 2, 3, 4
), running AS (
  SELECT *, sum(n) OVER (PARTITION BY screen, skin ORDER BY bin) AS below,
            sum(n) OVER (PARTITION BY screen, skin)              AS total
    FROM net
   WHERE vital = 'lcp'
), p75 AS (
  SELECT screen, skin, total::int AS samples,
         min(bin) FILTER (WHERE below >= 0.75 * total) AS at_most
    FROM running
   GROUP BY 1, 2, 3
), loads AS (
  SELECT screen, skin, sum(n)::int AS first_loads
    FROM net
   WHERE vital = 'ttfb'
   GROUP BY 1, 2
)
SELECT screen, skin, coalesce(first_loads, 0) AS first_loads, coalesce(samples, 0) AS samples,
       CASE WHEN samples >= 20 THEN at_most END AS p75_at_most_ms
  FROM loads FULL JOIN p75 USING (screen, skin)
 ORDER BY first_loads DESC;
```

A screen with first loads and few or no `samples` has an LCP gap, not a fast LCP. A low share
across every screen on one platform usually means Safari; a low share on one screen means the
scroll described above.

For another metric, change `'lcp'`; `first_loads` stays the same. For another cut, replace `skin`
with `tier`, `platform`, `cache` or `institute_id` everywhere after the first step. The answer is an
upper bound from the bins, not an interpolated value. `p75_at_most_ms` stays empty below 20 samples,
where a p75 means very little. The `route_key` filter skips any row that is not this format, because
the endpoint accepts any key and one malformed row would otherwise fail the cast.

## Running it

Run the query against the `admin_core_service` database through the read-only analytics proxy,
which hits the standby. Never run it on the primary.

## Sentry cost

Nothing in the browser reaches Sentry for this, but each report is an authenticated request to
admin_core, which has `sentry.traces-sample-rate=0.5` and `sentry.send-default-pii=true`. Expect
about half of these POSTs to become backend transactions, under the same settings as every other API
call. There is no new recipient, and the report body holds no learner details. Leaving the route out
of backend tracing would be a separate admin_core change.
