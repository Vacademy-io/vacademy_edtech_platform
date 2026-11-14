-- V24: drop never-used indexes on the two hottest write tables, and index the user search.
--
-- 1. Unused indexes. Every request inserts a user_activity_log row (23 indexes, 15 GB)
--    and touches user_session (18 indexes). These 12 showed zero scans on BOTH the primary
--    and the read replica from the 2026-08-03 stats reset to 2026-10-22, and none backs a
--    constraint. Together they were ~4.4 GB that every write still had to maintain.
--    idx_realtime_session_mgmt also carried last_activity_time, the column rewritten on
--    every session touch. Exact definitions are kept on db-primary in
--    /root/auth_dropped_indexes_2026-10-22.rollback.sql.
--
-- 2. User search. UserRepository.searchUserIdsByQuery matches LIKE '%term%' on
--    full_name, email and mobile_number, which no b-tree can serve, so it seq-scanned
--    users (254k rows): 321 ms average over 72k calls. Trigram GIN indexes on the exact
--    expressions the query uses let it bitmap-OR the three columns: ~25 ms for a name or
--    phone fragment. UserResolutionService forces a per-call plan for this query, since a
--    cached generic plan cannot see the term.
--
-- Prod already has all of this, applied by hand with DROP/CREATE INDEX CONCURRENTLY;
-- IF [NOT] EXISTS makes every statement a no-op there.

DROP INDEX IF EXISTS idx_user_activity_log_performance_analysis;
DROP INDEX IF EXISTS idx_user_activity_log_user_service_date;
DROP INDEX IF EXISTS idx_user_activity_log_service_institute_date;
DROP INDEX IF EXISTS idx_user_activity_log_session_id;
DROP INDEX IF EXISTS idx_user_activity_institute_id;
DROP INDEX IF EXISTS idx_user_activity_log_service_name;
DROP INDEX IF EXISTS idx_user_activity_log_response_status;
DROP INDEX IF EXISTS idx_user_activity_log_response_time;
DROP INDEX IF EXISTS idx_failed_login_tracking;
DROP INDEX IF EXISTS idx_realtime_session_mgmt;
DROP INDEX IF EXISTS idx_user_session_active;
DROP INDEX IF EXISTS idx_user_session_logout_time;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_users_full_name_trgm
    ON users USING gin (LOWER(COALESCE(full_name, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_email_trgm
    ON users USING gin (LOWER(COALESCE(email, '')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_mobile_trgm
    ON users USING gin (COALESCE(mobile_number, '') gin_trgm_ops);
