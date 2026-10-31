-- How the AI checks this assessment's copies, chosen when copies are sent for checking:
-- {"subject", "level", "instructions", "language_feedback"} - language_feedback HIGHLIGHT
-- marks spelling and grammar errors with a correction and deducts nothing.
-- NULL = nothing chosen (the institute default applies).
ALTER TABLE assessment ADD COLUMN IF NOT EXISTS copy_check_config JSONB;
