-- Result email for attempts released automatically on submit
-- (AUTO_AFTER_SUBMISSION, or AUTO_AFTER_ASSESSMENT_END submitted after the end).
-- The submit path sets TRUE after commit; AutoResultReleaseJob claims the row
-- (sets NULL), renders the report PDF and emails it. Every other release path
-- clears it, so one release never sends two emails. NULL on all existing rows:
-- nothing already released is emailed again.
ALTER TABLE student_attempt ADD COLUMN IF NOT EXISTS result_notice_pending BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_sa_result_notice_pending
    ON student_attempt (id)
    WHERE result_notice_pending = TRUE;
