-- ================================================================================
-- V566: AI evaluation of assignment submissions
-- ================================================================================
--
-- A teacher can ask the AI Evaluator to check a learner's assignment copy, the same
-- grader assessments use (ai_service /copy-check/grade). One row per run. The result
-- is a SUGGESTION: marks, feedback and the annotated copy are stored here and shown
-- pre-filled in the grade form - assignment_slide_tracked is only written when the
-- teacher presses Save Grade, so the learner never sees an unreviewed AI mark.
--
-- tracked_id has no FK: a learner re-submission deletes and re-inserts the tracked
-- rows, and the run history must survive that (a run for a replaced copy is stale,
-- the API answers only for the current tracked id).

CREATE TABLE IF NOT EXISTS assignment_ai_evaluation (
    id                  VARCHAR(36)  PRIMARY KEY,                -- also the copy-check process_id
    tracked_id          VARCHAR(255) NOT NULL,                   -- assignment_slide_tracked.id
    slide_id            VARCHAR(255) NOT NULL,                   -- slide.id
    institute_id        VARCHAR(255) NOT NULL,
    user_id             VARCHAR(255),                            -- the learner
    triggered_by        VARCHAR(255),                            -- the teacher
    status              VARCHAR(20)  NOT NULL,                   -- PROCESSING | COMPLETED | FAILED
    current_step        VARCHAR(64),
    preferred_model     VARCHAR(255),
    ai_job_id           VARCHAR(64),
    source_file_id      VARCHAR(255),                            -- the PDF that was graded
    max_marks           DOUBLE PRECISION,
    marks_awarded       DOUBLE PRECISION,
    feedback            TEXT,
    evaluated_file_id   VARCHAR(255),                            -- annotated copy
    result_json         TEXT,                                    -- last question callback, as sent
    error_message       TEXT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignment_ai_eval_tracked
    ON assignment_ai_evaluation (tracked_id, created_at DESC);
