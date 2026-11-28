-- V771: a small partial index for extra classes (features/extra_class).
--
-- ExtraClassJob runs hourly and looks up extra-class access rows by source and status;
-- without this it seq-scans the whole student_session_institute_group_mapping table
-- (~340k rows, ~70 ms) every hour. Only rows with source = 'EXTRA_CLASS' are indexed, so
-- the index stays tiny.
--
-- Plain CREATE INDEX rather than CONCURRENTLY, as in V603: Flyway runs each migration
-- inside a transaction. The partial index has almost no rows, so the build is a single
-- scan of the table (a couple of seconds at most); reads are not blocked.

CREATE INDEX IF NOT EXISTS idx_ssigm_extra_class_status
    ON student_session_institute_group_mapping (status)
    WHERE source = 'EXTRA_CLASS';
