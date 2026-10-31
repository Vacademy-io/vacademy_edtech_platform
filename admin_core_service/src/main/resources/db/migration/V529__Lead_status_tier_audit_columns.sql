-- ============================================================
-- V529: Who created / last changed / deleted a lead status or lead tier.
-- The admin_activity_log already records each ACTION; these columns keep the
-- answer on the row itself, so "who owns this status?" survives log retention
-- and is readable without a log query.
--   * deleted_by / deleted_at are set on soft delete (is_active = false) and
--     cleared if the row is ever reactivated.
-- ============================================================
ALTER TABLE lead_status ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE lead_status ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE lead_status ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255);
ALTER TABLE lead_status ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

ALTER TABLE lead_tier ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
ALTER TABLE lead_tier ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
ALTER TABLE lead_tier ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(255);
ALTER TABLE lead_tier ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
