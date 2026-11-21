-- Tell the staff when the AI has checked copies.
--
-- The bulk upload already announces itself when its batch settles (email, bell,
-- workflow event). A copy checked on its own — the automatic check when a learner
-- uploads a sheet, or a teacher pressing "Evaluate with AI" on one row — finished
-- in silence: nobody was told the marks were waiting for review and release.
--
-- Two columns on the job row make a reliable, replica-safe notice possible:
--
-- 1. notified_at — set atomically when a notice has been sent for this job. The
--    notifier claims the unnotified settled jobs of an assessment with one UPDATE,
--    so two replicas cannot both announce the same copies.
-- 2. triggered_by — the teacher who pressed "Evaluate with AI", so the notice can go
--    to them as well as to the institute's admins. NULL for automatic and bulk checks.

ALTER TABLE ai_evaluation_process ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP;
ALTER TABLE ai_evaluation_process ADD COLUMN IF NOT EXISTS triggered_by VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_ai_evaluation_process_unnotified
    ON ai_evaluation_process (assessment_id, completed_at)
    WHERE notified_at IS NULL AND status IN ('COMPLETED', 'FAILED');

-- Everything that had already settled before this notice existed counts as announced:
-- the first run after deploy must not email every institute about months-old checks.
UPDATE ai_evaluation_process SET notified_at = CURRENT_TIMESTAMP
 WHERE notified_at IS NULL AND status IN ('COMPLETED', 'FAILED');
