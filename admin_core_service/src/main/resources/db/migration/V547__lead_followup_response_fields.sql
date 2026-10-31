-- Three things a counsellor records when they log a follow-up: what the student
-- said, how the contact happened, and what the next action is. Free text rather
-- than enums -- the option lists are per-institute config in LEAD_SETTING, so one
-- institute renaming or adding an option must not need a migration.
ALTER TABLE lead_followup ADD COLUMN IF NOT EXISTS student_response VARCHAR(255);
ALTER TABLE lead_followup ADD COLUMN IF NOT EXISTS follow_up_mode VARCHAR(255);
ALTER TABLE lead_followup ADD COLUMN IF NOT EXISTS next_action VARCHAR(255);
