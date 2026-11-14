-- V39: Meta's per-message WhatsApp pricing, on the outbound row that sent the message.
--
-- Why this exists. The engagement daily report has to say what WhatsApp cost. Meta's status
-- webhook carries a `pricing` object (billable, pricing_model, type, category) on the `sent`
-- status and on one of delivered/read, but no amount, and until now it was thrown away. The
-- webhooks now copy it onto the WHATSAPP_MESSAGE_OUTGOING row by wamid (source_id), and the
-- report multiplies billable messages by its own rate card (country x category).
--
-- All nullable, no backfill: NULL means no pricing was seen (rows sent before this, WATI, or a
-- webhook that carried none), and readers estimate those instead. Adding nullable columns with
-- no default is a catalog-only change in PostgreSQL, so this does not rewrite the table.

-- notification_log is large and written all the time: the ALTER's brief exclusive lock must not
-- queue behind a long transaction (and stall every write behind it). If the lock is not free in
-- 10 s the migration fails cleanly (Flyway runs it in one transaction) and the next deploy retries.
SET LOCAL lock_timeout = '10s';

ALTER TABLE notification_log
    ADD COLUMN IF NOT EXISTS pricing_billable BOOLEAN,
    ADD COLUMN IF NOT EXISTS pricing_type VARCHAR(40),
    ADD COLUMN IF NOT EXISTS pricing_category VARCHAR(40),
    ADD COLUMN IF NOT EXISTS pricing_model VARCHAR(10),
    ADD COLUMN IF NOT EXISTS pricing_updated_at TIMESTAMP;
