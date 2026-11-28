-- ================================================================================
-- V568: bulk AI check for assignment submissions
-- ================================================================================
--
-- "Check all with AI" queues one assignment_ai_evaluation row per unchecked
-- submission (status QUEUED) under a batch. A scheduled job sends them to the
-- grader a few at a time, and the teacher gets ONE notice when the batch is done
-- (notified_at is claimed once, so two pods never both send it).

ALTER TABLE assignment_ai_evaluation ADD COLUMN IF NOT EXISTS batch_id VARCHAR(36);

CREATE INDEX IF NOT EXISTS idx_assignment_ai_eval_status_created
    ON assignment_ai_evaluation (status, created_at);

CREATE INDEX IF NOT EXISTS idx_assignment_ai_eval_batch
    ON assignment_ai_evaluation (batch_id) WHERE batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS assignment_ai_evaluation_batch (
    id                  VARCHAR(36)  PRIMARY KEY,
    slide_id            VARCHAR(255) NOT NULL,
    package_session_id  VARCHAR(255),                            -- the batch of learners viewed, NULL = all
    institute_id        VARCHAR(255) NOT NULL,
    triggered_by        VARCHAR(255) NOT NULL,                   -- the teacher, who gets the notice
    total_count         INTEGER      NOT NULL,
    notified_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignment_ai_eval_batch_slide
    ON assignment_ai_evaluation_batch (slide_id, institute_id, created_at DESC);
