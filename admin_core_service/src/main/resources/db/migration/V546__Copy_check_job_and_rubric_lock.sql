-- =============================================================================
-- V546: AI copy-check -- cross-pod job dedupe + rubric lock columns
-- -----------------------------------------------------------------------------
-- Owned by ai_service (Python), managed here because ai_service has no
-- migration tool (same pattern as V314 copy_check_rubric).
--
-- copy_check_job (spec 11.2, gate G6): /copy-check/grade inserts one row per
-- assessment_service ai_evaluation_process with ON CONFLICT DO NOTHING. A
-- conflicting row whose heartbeat is younger than 2 minutes means another pod
-- is already grading that process (return the existing job); a stale heartbeat
-- lets the new pod take the row over. The running job refreshes heartbeat_at
-- every 30 s. Today job state lives in a per-pod dict, so a retried POST or a
-- sweeper requeue that lands on the other pod starts a second run.
--
-- copy_check_rubric lock columns (spec 7.4.1): an exam's rubric can be frozen
-- (locked_at / locked_version / locked_by); exam_context carries level,
-- subject, instructions and answer language for criteria generation.
--
-- Idempotent (IF NOT EXISTS everywhere). Columns are nullable with no default,
-- so the ALTER is a catalog-only change on Postgres (no table rewrite).
-- =============================================================================

CREATE TABLE IF NOT EXISTS copy_check_job (
    process_id    VARCHAR(255) PRIMARY KEY,              -- assessment ai_evaluation_process.id
    job_id        VARCHAR(64)  NOT NULL,                 -- ai_service job id returned by /grade
    pod           VARCHAR(255),                          -- hostname of the pod running it
    heartbeat_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status        VARCHAR(16)  NOT NULL DEFAULT 'RUNNING',   -- RUNNING | COMPLETED | FAILED
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Stale-heartbeat scans and housekeeping of finished rows.
CREATE INDEX IF NOT EXISTS idx_copy_check_job_status_heartbeat
    ON copy_check_job (status, heartbeat_at);

COMMENT ON TABLE copy_check_job IS
    'Cross-pod dedupe for /copy-check/grade: one row per evaluation process; heartbeat_at refreshed every 30 s by the running pod.';


ALTER TABLE copy_check_rubric ADD COLUMN IF NOT EXISTS locked_at      TIMESTAMP WITH TIME ZONE;
ALTER TABLE copy_check_rubric ADD COLUMN IF NOT EXISTS locked_version INTEGER;
ALTER TABLE copy_check_rubric ADD COLUMN IF NOT EXISTS locked_by      VARCHAR(255);
ALTER TABLE copy_check_rubric ADD COLUMN IF NOT EXISTS exam_context   JSONB;

COMMENT ON COLUMN copy_check_rubric.locked_at IS
    'Set when the rubric is frozen (rubrics:lock). While set, every rubric write returns 409 rubric_locked.';
COMMENT ON COLUMN copy_check_rubric.exam_context IS
    'JSON {level, subject, instructions, answer_language} used by criteria generation and grading.';
