-- V33: the REAL delivery outcome of an outbound WhatsApp message, on the row that sent it.
--
-- Why this exists. A provider 2xx only means the message was ACCEPTED for delivery; the actual
-- outcome (delivered / read / failed) arrives seconds later on the status webhook. Until now the
-- webhook's verdict was written to a SEPARATE notification_log row (WHATSAPP_STATUS_EVENT) and
-- nothing ever joined it back, so the outbound row kept saying "Status: SUCCESS" forever and every
-- read surface (WhatsApp Inbox, communication timeline) reported the send as fine. HCCA
-- (2e401567-…) sent 202 messages between 2026-08-08 and 2026-08-31 that Meta rejected outright with
-- 131042 "Business eligibility payment issue" — every one of them still displays as delivered.
--
-- Deliberately NEW nullable columns rather than rewriting `body`: body carries the send-time
-- record in a format other queries parse ("... | Status: FAILED | ..." drives lastSentAt in
-- NotificationLogRepository), and the two facts — what we sent vs. what the provider did with it —
-- must stay separately readable. NULL keeps the pre-existing display behaviour untouched, so rows
-- no webhook ever reported on look exactly as they do today.

ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20);
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS delivery_error_code VARCHAR(50);
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS delivery_error_message VARCHAR(500);
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS delivery_updated_at TIMESTAMP;

COMMENT ON COLUMN notification_log.delivery_status IS
    'Provider-confirmed outcome of an outbound message (SENT/DELIVERED/READ/FAILED), copied from the '
    'status webhook by matching source_id (wamid). NULL = no webhook seen yet; readers must fall back '
    'to their legacy behaviour rather than treating NULL as a failure.';

-- The webhook reconciliation predicate, exactly. Partial: ~42k outbound rows out of ~863k, so the
-- index stays a couple of MB while every status webhook does an index lookup instead of a seq scan
-- on a 2 GB table.
--
-- DEPLOY NOTE: this build takes a SHARE lock on the service's highest-write table (V31 precedent).
-- Deploy off-peak.
CREATE INDEX IF NOT EXISTS idx_nl_source_id_outgoing
    ON notification_log (source_id)
    WHERE notification_type = 'WHATSAPP_MESSAGE_OUTGOING' AND source_id IS NOT NULL;

-- Backfill FAILURES ONLY. A historical row that Meta explicitly rejected is currently rendered as
-- delivered, which is the bug this migration exists to close; leaving those NULL would keep lying
-- about every message sent before this deploy. Successes are deliberately NOT backfilled — they
-- already display correctly, and inferring them would mean trusting a regex over a webhook.
--
-- DISTINCT ON keeps one status row per wamid (the latest), and `delivery_status IS NULL` makes the
-- statement re-runnable without clobbering anything the live webhook has since written.
UPDATE notification_log o
SET delivery_status       = 'FAILED',
    delivery_error_code   = substring(s.message_payload from '"code":(\d+)'),
    delivery_error_message = left(
        coalesce(substring(s.message_payload from '"title":"([^"]+)"'), 'Delivery failed'), 500),
    delivery_updated_at   = s.notification_date
FROM (
    SELECT DISTINCT ON (source_id) source_id, message_payload, notification_date
    FROM notification_log
    WHERE notification_type = 'WHATSAPP_STATUS_EVENT'
      AND source_id IS NOT NULL
      AND message_payload LIKE '%"status":"failed"%'
    ORDER BY source_id, notification_date DESC
) s
WHERE o.source_id = s.source_id
  AND o.notification_type = 'WHATSAPP_MESSAGE_OUTGOING'
  AND o.delivery_status IS NULL;
