-- =============================================================================
-- V637: AI copy-check -- what the checked copy was drawn from
-- -----------------------------------------------------------------------------
-- Owned by ai_service (Python), managed here because ai_service has no
-- migration tool (same pattern as V314 copy_check_rubric / V546 copy_check_job).
--
-- When ai_service draws a checked copy it saves the exact inputs of that render:
-- the page layout (after every OCR enrichment), the final per-question verdicts
-- (after enforcement, choice groups, language and deduction marks) and the
-- template options. A teacher who corrects a mark, a remark or a pen note on the
-- review page can then have the copy re-drawn from the same inputs with only
-- the teacher's changes applied (POST /copy-check/re-render), instead of the
-- student keeping a PDF that disagrees with the released marks.
--
-- One row per assessment ai_evaluation_process; a re-check overwrites it.
-- The three *_json columns hold zlib-compressed JSON (base64 text, "z1:" prefix)
-- to keep the per-copy row small.
-- The source PDF URL is not stored: assessment_service sends a fresh one with
-- every re-render request.
-- =============================================================================

CREATE TABLE IF NOT EXISTS copy_check_render_snapshot (
    process_id     VARCHAR(255) PRIMARY KEY,             -- assessment ai_evaluation_process.id
    attempt_id     VARCHAR(255),
    institute_id   VARCHAR(255),
    layout_json    TEXT NOT NULL,                        -- layout map the copy was drawn on
    verdicts_json  TEXT NOT NULL,                        -- final verdicts, annotations included
    options_json   TEXT,                                 -- comment_placement, question_labels, evaluation_table, pen_style
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_copy_check_render_snapshot_attempt
    ON copy_check_render_snapshot (attempt_id);

COMMENT ON TABLE copy_check_render_snapshot IS
    'Inputs of the last checked-copy render per AI evaluation process, so a teacher''s corrections can be re-drawn on the copy.';
