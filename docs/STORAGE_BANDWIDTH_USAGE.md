# Storage & bandwidth usage per institute

Goal: measure what each institute stores and streams. Admins see their own usage.
Platform staff see everyone's, with our approximate cost, for quoting and pricing.

## Where the numbers come from

| What | Source | Switched on |
|---|---|---|
| Storage | Daily **S3 Inventory** of `vacademy-media-storage` and `vacademy-media-storage-public` → `s3://vacademy-usage-reports/inventory/` | 30 Oct 2026; first report within 48 h |
| CDN bandwidth | **CloudFront standard access logs** → `s3://vacademy-cloudfront-logs/<distribution>/` | 30 Oct 2026 |
| Direct S3 bandwidth (presigned and raw S3 URLs) | **S3 server access logs** of both media buckets → `s3://vacademy-usage-reports/s3-access/` | 30 Oct 2026 |

- admin-core reads these with its own **read-only** key: IAM user
  `vacademy-usage-reader`, env `USAGE_S3_ACCESS_KEY` / `USAGE_S3_SECRET_KEY` in the
  `vacademy-secrets` Kubernetes secret. Without the key, metering is skipped.
- Bandwidth history starts on 30 Oct 2026; there is no earlier log data.
- In the S3 access logs, CloudFront's own origin fetches are excluded, so CDN
  traffic is counted once.

## Attributing a file to an institute (`UsageKeyClassifier`)

1. Any of the key's first three path segments is an institute id. This covers
   `<instituteId>/...` and `<SOURCE>/<instituteId>/...`.
2. Class recordings (`BBB_RECORDING/<meetingId>/...`, Zoom, Google Meet, AI call)
   are matched through `session_schedules.provider_meeting_id` or `session_schedules.id`,
   then `live_session.institute_id`.
3. Everything else is recorded as `_UNASSIGNED`.

On the 30 Oct 2026 snapshot these rules attributed **83% of stored bytes**. The rest
is mostly:
- slide videos and audio uploaded under the literal folder `your-institute-id/`, a
  frontend placeholder (fixed in this change for new uploads);
- shared folders without an institute in the key (`VIDEO_DOCUMENTS/STUDENTS/...`,
  `PDF_DOCUMENTS/...`, `SERVICE_UPLOAD/...`);
- older Zoom recordings whose meeting id no longer matches a schedule.

Each file gets a category: `RECORDING`, `VIDEO`, `AUDIO`, `DOCUMENT`, `IMAGE` or
`OTHER`, by prefix or extension.

## Data and job (admin-core, `features/usage_metering`)

**Tables (V633):**
- `institute_storage_usage_daily`: date × institute × bucket × category, holding
  bytes and object count.
- `institute_bandwidth_usage_daily`: date × institute × channel (`CDN` or
  `S3_DIRECT`) × category, holding bytes and request count.

**`UsageMeteringJob`:** runs daily at 22:30 UTC (04:00 IST), under ShedLock.
- Storage comes from the newest inventory report.
- Bandwidth is computed for the previous two UTC days, because CloudFront can
  deliver a log late.
- A day's rows are replaced in one short transaction, so re-runs are safe.
- To switch it off: `USAGE_METERING_ENABLED=false`.

## APIs and screens

- **Institute admins:**
  `GET /admin-core-service/institute/v1/usage/storage-bandwidth?instituteId=`.
  - Requires the ADMIN role in that institute, with no root-user bypass.
  - Screen: **Settings → Storage & Bandwidth** in the admin dashboard. It shows
    sizes only, no prices.
- **Super admins:**
  - `GET /admin-core-service/super-admin/v1/usage/storage-bandwidth?month=YYYY-MM`
  - `POST .../usage/meter?date=` (manual re-run).
  - Screen: **Storage & Bandwidth** in the super-admin portal (vacademy-health-check),
    with every institute, recordings, the month's bandwidth, and our approximate
    cost at the `usage.cost.*` rates.

## Rollout

1. Merge the admin-core and admin-dashboard change. The V633 migration runs on
   deploy. Merge the portal branch afterwards.
2. Once the first inventory report has arrived, trigger a first fill from the
   portal ("Run now"), or wait for the nightly job.
3. Check the numbers against a manual S3 listing for one or two institutes.

## Next

- **Attribution at upload time:** record the institute on every `file_metadata`
  row, then re-attribute the `_UNASSIGNED` share. Existing `your-institute-id/`
  files can be traced through the slide that references them.
- **Pricing:** decide included storage and bandwidth per plan, overage rates, and
  whether recordings get a retention policy.
- **Live-class server hours** (BBB) per institute, if it is to be quoted
  separately.
