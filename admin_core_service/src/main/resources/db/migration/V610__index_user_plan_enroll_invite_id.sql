-- V610: index user_plan.enroll_invite_id.
--
-- user_plan (~300k rows, 570 MB) had no index on enroll_invite_id, so every lookup of the plans
-- of one invite seq-scanned the table: AccessPassRepository's user_plan-by-invite query took
-- 250-360 ms (up to 1.3 s), ~22k blocks read per call (pg_stat_statements, 2026-10-24). With
-- the index: ~20 ms. The billing summary, which also joins user_plan on this column, timed the
-- same before and after (1.1-1.5 s).
--
-- Prod already has it, built by hand with CREATE INDEX CONCURRENTLY; IF NOT EXISTS makes this a
-- no-op there.

CREATE INDEX IF NOT EXISTS idx_user_plan_enroll_invite_id
    ON user_plan (enroll_invite_id);
