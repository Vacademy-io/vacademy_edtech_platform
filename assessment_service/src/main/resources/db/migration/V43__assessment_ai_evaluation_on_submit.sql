-- Automatic AI evaluation when a learner submits.
--
-- AI evaluation already exists end to end: ai_evaluation_process is the job row,
-- AiEvaluationAsyncService does the work, AiEvaluationStaleJobSweeper rescues jobs that
-- die mid-flight. The only thing missing was a trigger other than a teacher clicking
-- "Evaluate with AI" on the submissions table.
--
-- Two things are added here.
--
-- 1. A per-assessment opt-in. AI evaluation CHARGES INSTITUTE CREDITS per graded
--    question, so this must never be implicit: an assessment evaluates on submit only
--    when someone deliberately turned it on. NULL means off, so every existing
--    assessment is unaffected.
--
-- 2. Claim columns on the job table, so the queue can be drained safely by more than
--    one replica. Dispatch today is an in-JVM @Async call: if that pod dies between the
--    INSERT and the work starting, the job sits PENDING until the 5-minute sweeper
--    notices. With a claim, any replica can pick up unclaimed PENDING work.

ALTER TABLE assessment ADD COLUMN ai_evaluation_enabled BOOLEAN;

-- Which model the institute wants for this assessment (e.g. a cheaper model for a
-- weekly quiz, a stronger one for a board-pattern paper). NULL = whatever the
-- ai_service default resolves to, which is the behaviour of the manual trigger today.
ALTER TABLE assessment ADD COLUMN ai_evaluation_model VARCHAR(100);

-- Who is working on this job, and since when.
--
-- claimed_by is the pod/instance id. claimed_at is what makes a stuck claim
-- recoverable: a claim older than the reclaim window is treated as abandoned, so a pod
-- that died holding a job does not strand it forever.
ALTER TABLE ai_evaluation_process ADD COLUMN claimed_by VARCHAR(120);
ALTER TABLE ai_evaluation_process ADD COLUMN claimed_at TIMESTAMP;

-- The poller's only query shape: unclaimed (or stale-claimed) PENDING rows, oldest
-- first. Partial index because PENDING is a small slice of a table that grows with
-- every evaluated attempt -- indexing terminal rows would be dead weight.
CREATE INDEX IF NOT EXISTS idx_ai_eval_process_claimable
    ON ai_evaluation_process (created_at)
    WHERE status = 'PENDING';

-- Supports the per-attempt idempotency check that runs before every enqueue.
CREATE INDEX IF NOT EXISTS idx_ai_eval_process_attempt_status
    ON ai_evaluation_process (attempt_id, status);
