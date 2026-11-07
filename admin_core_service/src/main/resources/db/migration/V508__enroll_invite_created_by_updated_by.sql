-- =========================================================================
-- V508: record who created and who last edited each enroll invite
--
-- enroll_invite carried created_at / updated_at but no actor, so the course
-- "Invite Links" dialog could not say who made a link, and updated_at was
-- effectively dead: the entity maps it updatable = false and nothing else
-- touches it (130 of ~10k prod rows differ from created_at, all by hand).
-- From this migration on the entity stamps updated_at on every save and both
-- ids come from the JWT of the admin performing the call.
--
-- Backfill: none. There is no honest source for historic creators (the
-- admin_activity_log only starts logging ENROLL_INVITE with this change), and
-- the UI treats NULL as "unknown". Idempotent via IF NOT EXISTS.
-- =========================================================================

ALTER TABLE enroll_invite
    ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(255);

ALTER TABLE enroll_invite
    ADD COLUMN IF NOT EXISTS updated_by_user_id VARCHAR(255);

COMMENT ON COLUMN enroll_invite.created_by_user_id IS
    'auth_service user id of the admin who created the invite. Set once on insert, never updated.';

COMMENT ON COLUMN enroll_invite.updated_by_user_id IS
    'auth_service user id of the admin who last edited the invite (any save: edit, delete, make default).';
