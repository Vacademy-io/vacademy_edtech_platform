-- Index for the Call Log date filter.
--
-- Every Call Log query (CallSearchService: metrics, search, disposition counts,
-- export) filters by
--
--     tcl.institute_id = :instituteId
--     AND COALESCE(tcl.start_time, tcl.created_at) >= :fromUtc
--     AND COALESCE(tcl.start_time, tcl.created_at) <  :toUtc
--
-- and sorts by the same COALESCE. The existing index idx_tcl_institute is on
-- (institute_id, created_at), which Postgres cannot use for a COALESCE expression,
-- so each query read the whole telephony_call_log table. On 7 Nov 2026 about 2,000
-- of these calls in 8 minutes held the admin-core DB pool, and payments, OTP and
-- bulk email waited behind them.
--
-- An index on the exact same expression lets Postgres read only one institute and
-- date range. ANALYZE also gathers statistics for index expressions, which fixes
-- the row estimate (it guessed about 1,161 rows where 66,183 matched).
--
-- Plain CREATE INDEX, not CONCURRENTLY: Flyway runs each migration in a transaction.
-- The table is about 2.5 lakh rows (92 MB), so the build takes a second or two.
-- Reads keep working during the build; call log inserts and updates wait.
--
-- lock_timeout keeps the call flow safe. CREATE INDEX first waits for every open write
-- transaction on this table, and new writes queue behind it while it waits. If some
-- write transaction stays open, calls would queue for as long as it lasts. With a
-- 5 second limit the migration gives up instead, Postgres rolls it back (nothing is
-- recorded), the old pods keep serving, and the next pod start tries again.
-- Deploy outside calling hours (about 21:00 to 09:00 IST) so nothing has to wait.
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_tcl_institute_call_time
    ON telephony_call_log (institute_id, (COALESCE(start_time, created_at)) DESC);

ANALYZE telephony_call_log;
