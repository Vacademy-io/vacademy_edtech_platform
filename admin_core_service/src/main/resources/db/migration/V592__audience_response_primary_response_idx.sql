-- V592: lead lists count the live duplicates that repeat each lead on the page
-- (audience_response.primary_response_id). Only duplicate rows carry it, so the
-- partial index stays tiny and the count no longer scans the whole table.
CREATE INDEX IF NOT EXISTS idx_audience_response_primary_response_id
    ON audience_response (primary_response_id)
    WHERE primary_response_id IS NOT NULL;
