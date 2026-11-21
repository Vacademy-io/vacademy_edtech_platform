-- V41: index for notification_log lookups by correlation_id.
--
-- A campaign (announcement) email is logged twice: the real send, holding the HTML and the SES
-- events, and a tracking row holding only the campaign title, which carries the announcement id
-- in source_id. The real send now also carries the announcement id in correlation_id, and the
-- campaign report (summarizeAnnouncementEmails, findAnnouncementEmailsForUsers) looks emails up
-- by it, counting a tracking row only when no stamped send exists for that address. The
-- engagement ledger already used correlation_id. No index led with that column, so each lookup
-- would seq-scan the table.
--
-- Partial: almost every row has no correlation_id, and an equality lookup implies NOT NULL.
--
-- On a large table, build it by hand first so inserts are never blocked:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nl_correlation_type
--       ON notification_log (correlation_id, notification_type) WHERE correlation_id IS NOT NULL
-- IF NOT EXISTS then makes this migration a no-op there.

CREATE INDEX IF NOT EXISTS idx_nl_correlation_type
    ON notification_log (correlation_id, notification_type)
    WHERE correlation_id IS NOT NULL;
