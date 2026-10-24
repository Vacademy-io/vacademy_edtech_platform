-- Keep every generated class AI report, not just the latest.
--
-- V44 held ONE row per assessment, so a paid Refresh overwrote the report it
-- replaced — an admin who regenerated lost the version they may already have
-- shared with staff, with no way back.
--
-- The tricky part is that the UNIQUE (assessment_id, institute_id) index was
-- also the anti-double-charge gate: it is what makes two simultaneous Generate
-- clicks resolve to one model call. Simply dropping it to allow history would
-- reopen that hole. So it becomes a PARTIAL unique index over live rows only —
-- superseded rows fall out of the constraint and accumulate as history, while
-- at most one live row per assessment still arbitrates the claim exactly as
-- before.
ALTER TABLE assessment_class_ai_analysis
    ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMP;

DROP INDEX IF EXISTS uq_class_ai_analysis_assessment_institute;

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_ai_analysis_live
    ON assessment_class_ai_analysis (assessment_id, institute_id)
    WHERE superseded_at IS NULL;

-- History lookup: newest first, per assessment.
CREATE INDEX IF NOT EXISTS idx_class_ai_analysis_history
    ON assessment_class_ai_analysis (assessment_id, institute_id, generated_at DESC);
