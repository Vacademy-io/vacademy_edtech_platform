-- Interest level recorded with each follow-up (how warm the lead sounded on that
-- call), separate from the lead's current tier. VARCHAR, not an enum: the option
-- list is per-institute config (LEAD_SETTING followUpFields.interestLevels), so
-- renaming an option stays a settings change.
ALTER TABLE lead_followup ADD COLUMN IF NOT EXISTS interest_level VARCHAR(255);
