-- ================================================================================
-- V571: who entered a lead by hand
-- ================================================================================
--
-- Check Lead shows "Enquired By" next to "Assigned To". The two differ: a
-- counsellor can add a walk-in that the pool or an admin then gives to someone
-- else. Nothing recorded the person who typed the lead in, so this column does.
--
-- Stamped only by the authenticated admin-panel endpoints (single add and CSV
-- import). Website forms, Meta/Google webhooks and migrated leads have no person
-- behind them and stay NULL; nothing is backfilled.

ALTER TABLE audience_response
    ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(255);
