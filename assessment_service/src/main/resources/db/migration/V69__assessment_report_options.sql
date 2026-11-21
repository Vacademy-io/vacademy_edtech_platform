-- Per-assessment report options: what a student's report shows about each question.
--
-- Shape: {"show_question_wise":true,"show_your_answer":true,"show_correct_answer":true,
--         "show_explanation":true}; every key optional, missing = shown.
-- NULL means "follow the institute's default report profile" (its config_json
-- report_options), which is what every assessment that predates this column keeps.
-- Nullable, no default: a metadata-only change on PostgreSQL, no table rewrite.
ALTER TABLE assessment ADD COLUMN IF NOT EXISTS report_options JSONB;
