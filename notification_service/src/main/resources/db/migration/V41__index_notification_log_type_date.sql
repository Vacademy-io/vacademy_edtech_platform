-- V41: index for the platform portal's messaging summary (External APIs > Messaging).
--
-- The portal counts outbound EMAIL and WHATSAPP_MESSAGE_OUTGOING rows in a time window, grouped
-- by delivery status, institute, error code and WhatsApp pricing category, through the read-only
-- analytics proxy (30 s statement timeout, on the standby). No index starts with notification_date,
-- so without this every count is a sequential scan of the whole table (~2 GB).
--
-- DEPLOY NOTE: build it in prod by hand first, without blocking writes:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nl_type_date
--       ON notification_log (notification_type, notification_date);
-- IF NOT EXISTS then makes this migration a no-op there (V38 precedent). Run on its own it takes a
-- SHARE lock on the service's highest-write table, so deploy off-peak if it was not pre-built.

CREATE INDEX IF NOT EXISTS idx_nl_type_date
    ON notification_log (notification_type, notification_date);
