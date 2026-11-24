-- Result email of a practice or mock attempt, held until its AI analysis is ready.
-- A practice or mock test is retaken freely, so its result is emailed only when the
-- test has its own result email or WhatsApp template, and only for the first attempt.
-- The submit path sets result_notice_pending = TRUE and this column to the submit time;
-- AutoResultReleaseJob waits until the AI analysis is made (or will not be made, or the
-- wait runs out), then sends the same report email as any other release.
-- NULL on every existing row and on every exam notice: nothing changes for them.
ALTER TABLE student_attempt ADD COLUMN IF NOT EXISTS result_notice_ai_wait_since TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_sa_result_notice_ai_wait
    ON student_attempt (id)
    WHERE result_notice_pending = TRUE AND result_notice_ai_wait_since IS NOT NULL;
