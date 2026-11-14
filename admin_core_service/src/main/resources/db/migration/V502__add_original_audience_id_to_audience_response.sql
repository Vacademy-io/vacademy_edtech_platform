-- Lead-list migration: remember where a lead originally came from.
--
-- Moving a lead between lists is an UPDATE of audience_response.audience_id, which silently
-- rewrites history: a campaign that acquired 500 leads reports 400 after some are moved out.
-- The timeline (LEAD_LIST_CHANGED events) records the full ordered chain of moves, but a
-- timeline is not something a report can join against.
--
-- This column is the queryable half: the list the response was FIRST created in. Written once,
-- on the first migration, and never overwritten afterwards — so source-attribution reporting can
-- read COALESCE(original_audience_id, audience_id) and stay correct across any number of later
-- reorganisations.
--
-- NULL means "never migrated", so audience_id is still the original. No backfill is needed or
-- correct: every existing row is by definition still in the list it was created in.

ALTER TABLE audience_response
    ADD COLUMN IF NOT EXISTS original_audience_id TEXT;

-- Partial: only migrated rows carry a value, and they are the minority.
CREATE INDEX IF NOT EXISTS idx_audience_response_original_audience_id
    ON audience_response (original_audience_id)
    WHERE original_audience_id IS NOT NULL;

COMMENT ON COLUMN audience_response.original_audience_id IS
    'The audience (lead list) this response was first created in. Set on the FIRST migration only and never overwritten; NULL means the lead has never been moved and audience_id is still the original. Use COALESCE(original_audience_id, audience_id) for source attribution.';
