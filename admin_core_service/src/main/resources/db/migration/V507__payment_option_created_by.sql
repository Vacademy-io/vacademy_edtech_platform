-- =========================================================================
-- V507: record who created each payment option
--
-- payment_option carried created_at but no creator, so the admin "Select a
-- Payment Plan" picker could not say who added a plan and the audit trail
-- for plan creation was empty. Column is stamped from the JWT on insert and
-- never rewritten (the Settings page edits via the same POST, which rebuilds
-- the entity from the DTO, so the entity marks it updatable = false).
--
-- Backfill: CPO mirrors are the only rows whose creator the schema already
-- knows (complex_payment_option.created_by). Everything else stays NULL —
-- there is no honest source for it, and the UI treats NULL as "unknown".
-- Idempotent: guarded by IF NOT EXISTS / IS NULL.
-- =========================================================================

ALTER TABLE payment_option
    ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(255);

COMMENT ON COLUMN payment_option.created_by_user_id IS
    'auth_service user id of the admin who created the option. Set once on insert, never updated.';

UPDATE payment_option po
SET    created_by_user_id = cpo.created_by
FROM   complex_payment_option cpo
WHERE  po.complex_payment_option_id = cpo.id
  AND  po.created_by_user_id IS NULL
  AND  cpo.created_by IS NOT NULL;
