-- ================================================================================
-- V576: priority follow-ups
-- ================================================================================
--
-- When an existing lead enquires again (repeat-lead reattempt, behind the Lead
-- Settings switch repeatLead.reattempt.followUp), the system opens a follow-up
-- for the lead's counsellor and marks it priority. The Follow-ups page lists
-- leads with an open priority follow-up first. Closing the follow-up takes the
-- lead out of the list, so the flag needs no clearing of its own.
--
-- A constant default makes the ADD COLUMN a metadata-only change.

ALTER TABLE lead_followup
    ADD COLUMN IF NOT EXISTS is_priority BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_lead_followup_open_priority
    ON lead_followup (audience_response_id)
    WHERE is_closed = FALSE AND is_priority = TRUE;
