-- next_run_time is now stored in UTC (the scheduler poller compares it against the
-- UTC JVM clock). Previously it held wall-clock time in scheduled_messages.timezone,
-- so non-UTC schedules fired late/early by the zone offset.
-- Convert still-pending rows only. Inactive rows are never polled or returned by the API.
-- Unknown timezone names are skipped instead of failing the migration.
UPDATE scheduled_messages
SET next_run_time = (next_run_time AT TIME ZONE timezone) AT TIME ZONE 'UTC',
    updated_at = now()
WHERE is_active = true
  AND next_run_time IS NOT NULL
  AND timezone IS NOT NULL
  AND timezone NOT IN ('UTC', 'Etc/UTC')
  AND timezone IN (SELECT name FROM pg_timezone_names);
