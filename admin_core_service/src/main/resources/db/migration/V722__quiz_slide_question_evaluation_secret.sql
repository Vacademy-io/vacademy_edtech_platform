-- Spreadsheet & Written Response (CBE_RESPONSE) questions inside quiz slides keep their model
-- solution, marking scheme and grading notes here, apart from auto_evaluation_json, which
-- learners receive with the quiz. Same shape as question_slide.evaluation_secret_json (V671):
-- {"parts":[{"id","solution","markingScheme","solutionFileId"}],"gradingNotes"}.
-- Never add this column to the native slide JSON queries; admins read it through
-- GET /admin-core-service/slide/quiz-slide/v1/{slideId}/evaluation-secrets.
ALTER TABLE quiz_slide_question ADD COLUMN IF NOT EXISTS evaluation_secret_json TEXT NULL;
