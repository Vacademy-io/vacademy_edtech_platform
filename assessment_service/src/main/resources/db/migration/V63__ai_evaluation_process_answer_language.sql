-- The language a teacher confirmed for one copy (Bulk AI check: "Check in Hindi"
-- on a copy written in another language than its question paper). Sent to
-- ai_service as exam_context.answer_language for this run only; NULL = the
-- assessment's own setting, or detection.
ALTER TABLE ai_evaluation_process ADD COLUMN IF NOT EXISTS answer_language VARCHAR(16);
