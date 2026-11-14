-- V37: indexes for the notification_log lookups by source and by source_id.
--
-- Both are exact-match lookups that usually find nothing, yet each seq-scanned the
-- whole table (2.26M rows, 4.3 GB) because no index leads with either column
-- (pg_stat_statements, 2026-10-22):
--
--   findBySourceAndNotificationType   -- EmailEventService duplicate-event check,
--       source = original email log id   219k calls, 463 ms average
--   findBySourceIdAndNotificationType -- AnnouncementService / InboundEmailService,
--       source_id = announcement / message id   50k calls, 774 ms average
--
-- idx_nl_source_id_outgoing covers source_id only for WHATSAPP_MESSAGE_OUTGOING, so
-- EMAIL and INBOUND_EMAIL lookups could not use it.
--
-- Prod already has both, built by hand with CREATE INDEX CONCURRENTLY so inserts were
-- never blocked; IF NOT EXISTS makes this a no-op there and brings every other
-- environment into line.

CREATE INDEX IF NOT EXISTS idx_nl_source_type
    ON notification_log (source, notification_type);

CREATE INDEX IF NOT EXISTS idx_nl_source_id_type
    ON notification_log (source_id, notification_type);
