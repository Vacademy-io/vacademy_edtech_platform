-- V673: merge one person's leads into another person in the same institute.
--
-- user_lead_profile: a profile merged into another person keeps its row, marked with the
-- person it was merged into, so reports can leave it out of lead and admission counts and
-- the merge can be undone.
-- audience_response: each enquiry moved by a merge keeps the user id it had before, so an
-- undo can move exactly those enquiries back.
ALTER TABLE user_lead_profile ADD COLUMN IF NOT EXISTS merged_into_user_id TEXT;
ALTER TABLE user_lead_profile ADD COLUMN IF NOT EXISTS merged_at TIMESTAMP;
ALTER TABLE user_lead_profile ADD COLUMN IF NOT EXISTS merged_by_user_id TEXT;

ALTER TABLE audience_response ADD COLUMN IF NOT EXISTS merged_from_user_id TEXT;

-- "Who was merged into this person": almost every row has no value, so the index stays tiny.
CREATE INDEX IF NOT EXISTS idx_user_lead_profile_merged_into
    ON user_lead_profile (merged_into_user_id, institute_id)
    WHERE merged_into_user_id IS NOT NULL;
