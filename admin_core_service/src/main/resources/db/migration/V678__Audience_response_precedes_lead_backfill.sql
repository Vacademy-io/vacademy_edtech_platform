-- V678: backfill V677 precedes_lead (a duplicate submitted before the lead it points at).
--
-- Its own migration so it runs without V677's table lock: a plain UPDATE takes row locks only,
-- so lead lists keep reading while it runs. About 21.6k rows on prod (2026-11-13), almost all
-- from imported data. IS DISTINCT FROM makes a re-run touch nothing.
SET LOCAL statement_timeout = '10min';

UPDATE audience_response d
   SET precedes_lead = TRUE
  FROM audience_response p
 WHERE p.id = d.primary_response_id
   AND d.is_duplicate = TRUE
   AND d.submitted_at < p.submitted_at
   AND d.precedes_lead IS DISTINCT FROM TRUE;
