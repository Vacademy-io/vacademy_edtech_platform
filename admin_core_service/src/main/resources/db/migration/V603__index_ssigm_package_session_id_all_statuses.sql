-- V603: a non-partial index on student_session_institute_group_mapping.package_session_id.
--
-- Every existing index that leads with package_session_id is partial on
-- status = 'ACTIVE'. The enrolled-learner count used by the course listing (and eight
-- other native queries) filters status IN ('ACTIVE', 'INACTIVE'), which no partial
-- index can serve, so Postgres seq-scanned the whole table once per package_session:
--
--     (SELECT COUNT(*) FROM student_session_institute_group_mapping ssigm
--      WHERE ssigm.package_session_id = ps.id
--        AND ssigm.status IN ('ACTIVE', 'INACTIVE')) AS enrolledStudentCount
--
-- /packages/v1/search with package_view=true loads every session of the institute
-- before paginating, so Shiksha Nation's 380 sessions x a 306k-row scan took 18.4 s of
-- a 20.9 s request (EXPLAIN ANALYZE on the standby, 2026-10-22).
--
-- Plain CREATE INDEX rather than CONCURRENTLY: Flyway runs each migration inside a
-- transaction. The table is ~300k rows / 83 MB, so the build takes a couple of seconds,
-- during which writes to the table wait; reads are not blocked.

CREATE INDEX IF NOT EXISTS idx_ssigm_package_session_id_status_all
    ON student_session_institute_group_mapping (package_session_id, status);
