-- V41: index for notification_log lookups by correlation_id.
--
-- A campaign (announcement) email used to be logged twice: the real send, holding the HTML and
-- the SES events, and a tracking row holding only the campaign title, which carried the
-- announcement id in source_id. The tracking row is no longer written for a successful send;
-- the real send now carries the announcement id in correlation_id instead. The campaign report
-- (summarizeAnnouncementEmails, findAnnouncementEmailsForUsers) therefore looks emails up by
-- correlation_id, and the engagement ledger already did. No index led with that column, so
-- each lookup would seq-scan the table.
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
