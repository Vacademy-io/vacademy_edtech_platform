-- The institute an event belongs to. A person (auth user) is shared across institutes, so
-- reads keyed by student_user_id showed one institute's notes and journey in another.
-- Nullable: rows written before this column stay visible everywhere until backfilled.
ALTER TABLE timeline_event
    ADD COLUMN IF NOT EXISTS institute_id VARCHAR(255);
