-- The existing idx_audience_response_parent_email_lower indexes lower(parent_email),
-- but every email predicate in the code is lower(trim(parent_email)) -- the lead
-- dedup check on each submission, and now the lead lookup. The trim makes the
-- expression a non-match for that index, so those queries seq-scan the table:
-- measured at 84ms against 135k rows, on a path that runs for every lead that
-- comes in.
--
-- Dropping the trim instead would be wrong: 60 stored emails really do carry
-- surrounding whitespace and would stop matching.
--
-- Partial on NOT NULL, mirroring the existing index -- roughly half the rows have
-- no email at all.
CREATE INDEX IF NOT EXISTS idx_audience_response_parent_email_lower_trim
    ON audience_response (LOWER(TRIM(parent_email)))
    WHERE parent_email IS NOT NULL;
