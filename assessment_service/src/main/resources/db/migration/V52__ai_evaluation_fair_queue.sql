-- Fair-share AI evaluation queue (AI_EVALUATION_PUBLIC_API.md 11.2, gates G6/G7).
--
-- Until now the queue was one global oldest-first FIFO: one institute's 2,000-copy
-- upload made every other institute wait behind it. Claims are now made per LANE
-- (COPY = handwritten sheets, TYPED = typed long answers) and shared out per
-- INSTITUTE, so a newcomer waits at most for the shortest running job.
--
--   institute_id    the tenant the claim is shared out by (set at enqueue)
--   lane            COPY | TYPED (set at enqueue from TypedAnswerEvaluation.isTypedAttempt)
--   page_count      pages of the uploaded sheet, when known (ETA, per-page billing)
--   quoted_credits  credits quoted at enqueue (billing correctness, G10)
--   rate_snapshot   the rate the quote used (so a price change does not move a queued job)
--   api_key_id      the partner API key that created the job; NULL for dashboard runs
--
-- Every statement is idempotent so a partially applied run can be repeated.
-- ADD COLUMN with a constant default is metadata-only on Postgres 11+.

ALTER TABLE ai_evaluation_process ADD COLUMN IF NOT EXISTS institute_id VARCHAR(36);
ALTER TABLE ai_evaluation_process ADD COLUMN IF NOT EXISTS lane VARCHAR(8) NOT NULL DEFAULT 'COPY';
ALTER TABLE ai_evaluation_process ADD COLUMN IF NOT EXISTS page_count INT;
ALTER TABLE ai_evaluation_process ADD COLUMN IF NOT EXISTS quoted_credits NUMERIC(10, 2);
ALTER TABLE ai_evaluation_process ADD COLUMN IF NOT EXISTS rate_snapshot JSONB;
ALTER TABLE ai_evaluation_process ADD COLUMN IF NOT EXISTS api_key_id VARCHAR(36);

-- Backfill the tenant from the attempt's registration. Rows with no registration
-- keep NULL; the claim treats NULL as one more "institute" so they still drain.
-- (Row count on prod is unverified; ai_evaluation_process holds one row per AI run,
-- so a single UPDATE is expected to be small. Re-running touches nothing.)
UPDATE ai_evaluation_process p
SET institute_id = r.institute_id
FROM student_attempt sa
JOIN assessment_user_registration r ON r.id = sa.registration_id
WHERE sa.id = p.attempt_id
  AND p.institute_id IS NULL
  AND r.institute_id IS NOT NULL;

-- The claim's shapes: waiting rows per lane and institute, oldest first ...
CREATE INDEX IF NOT EXISTS idx_ai_eval_pending_fair
    ON ai_evaluation_process (lane, institute_id, created_at)
    WHERE status = 'PENDING';

-- ... the running count per lane and institute (the lane cap and the fair share) ...
CREATE INDEX IF NOT EXISTS idx_ai_eval_inflight
    ON ai_evaluation_process (lane, institute_id)
    WHERE status IN ('DISPATCHED', 'PROCESSING', 'STARTED', 'EXTRACTING', 'EVALUATING', 'GRADING', 'IN_PROGRESS');

-- ... and recent completions per lane (median duration for queue ETAs, 11.4).
CREATE INDEX IF NOT EXISTS idx_ai_eval_done_lane
    ON ai_evaluation_process (lane, completed_at DESC)
    WHERE status = 'COMPLETED';
