-- Spreadsheet & Written Response (CBE_RESPONSE) question slides keep their model solution,
-- marking scheme and grading notes here, apart from auto_evaluation_json, which learners
-- receive. Shape: {"parts":[{"id","solution","markingScheme","solutionFileId"}],"gradingNotes"}.
-- Never add this column to the native slide JSON queries; admins read it through
-- GET /admin-core-service/slide/question-slide/v1/{slideId}/evaluation-secret.
ALTER TABLE question_slide ADD COLUMN IF NOT EXISTS evaluation_secret_json TEXT NULL;

-- Instant AI checks of CBE question-slide answers are charged by ai_service under tool key
-- cbe_answer_check (use case 'evaluation'). Register the key on the evaluation catalog row so
-- usage events that name only the tool key still resolve to it. Idempotent.
UPDATE ai_use_case_catalog
   SET tool_keys = array_append(tool_keys, 'cbe_answer_check')
 WHERE use_case = 'evaluation'
   AND NOT ('cbe_answer_check' = ANY (tool_keys));
