-- V676: when a lead enquired again, kept on the lead itself.
--
-- A repeat enquiry is flagged is_duplicate and points at the lead it repeats. Lists that hide
-- duplicates (Lead Settings "Show duplicates only in Duplicate Leads") show only that lead, at
-- its own submitted_at, so a July lead that enquired again today stayed in July and the repeat
-- was nowhere near today in All Leads. And when a closed lead's repeat takes its place, the
-- repeat is the lead, so Duplicate Leads (is_duplicate rows) never listed it.
--
-- last_enquiry_at  = newest submitted_at of the live duplicates that came AFTER this lead, else NULL.
-- first_enquiry_at = oldest submitted_at of the live duplicates that came BEFORE this lead, else NULL
--                    (set = this lead is itself a repeat of an earlier enquiry).
-- A lead tab whose route opts in (enquiryDates=latest, with that setting on) sorts and
-- date-filters on COALESCE(last_enquiry_at, submitted_at), and its Duplicate Leads also lists
-- leads with first_enquiry_at set. Every other list keeps submitted_at. The app refreshes both
-- whenever a duplicate is flagged, folded, deleted or restored
-- (AudienceResponseRepository.refreshEnquiryDates).
--
-- audience_response is the busiest CRM table. Never queue behind a long report holding it
-- (and block every lead list behind us meanwhile): if the lock is not free in 5 s the migration
-- fails cleanly, the old pods keep serving and the next deploy retries (same pattern as V586).
-- Everything below runs under that one lock, about 3-4 s on prod (463k rows, 2026-11-13).
-- To skip even that, ADD COLUMN + CREATE INDEX CONCURRENTLY can be run by hand first; the
-- IF NOT EXISTS clauses then make them no-ops here.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE audience_response ADD COLUMN IF NOT EXISTS last_enquiry_at TIMESTAMP;
ALTER TABLE audience_response ADD COLUMN IF NOT EXISTS first_enquiry_at TIMESTAMP;

-- Lets the leads page walk the sort order and stop after one page, as the submitted_at
-- index does for the default sort.
CREATE INDEX IF NOT EXISTS idx_audience_response_latest_enquiry
    ON audience_response ((COALESCE(last_enquiry_at, submitted_at)));
-- The date filter's "enquired again inside the window" arm, ORed with the submitted_at range.
-- Only leads with a later duplicate, so it stays tiny. With last_enquiry_at alone the planner
-- re-ran the submitted_at bitmap once per campaign (old windows 2x slower than before).
CREATE INDEX IF NOT EXISTS idx_audience_response_last_enquiry_at
    ON audience_response (audience_id, last_enquiry_at)
    WHERE last_enquiry_at IS NOT NULL;

-- Backfill the leads that already have live duplicates (about 1.1k rows on prod, 2026-11-13).
UPDATE audience_response p
   SET last_enquiry_at = x.latest_after,
       first_enquiry_at = x.earliest_before
  FROM (SELECT d.primary_response_id AS id,
               MAX(d.submitted_at) FILTER (WHERE d.submitted_at > p0.submitted_at) AS latest_after,
               MIN(d.submitted_at) FILTER (WHERE d.submitted_at < p0.submitted_at) AS earliest_before
          FROM audience_response d
          JOIN audience_response p0 ON p0.id = d.primary_response_id
         WHERE d.is_duplicate = TRUE
           AND d.audience_status = 'ACTIVE'
         GROUP BY d.primary_response_id) x
 WHERE p.id = x.id
   AND (x.latest_after IS NOT NULL OR x.earliest_before IS NOT NULL);

-- The planner needs statistics on the new expression to walk its index for a page instead of
-- sorting every lead of the institute. A sampled ANALYZE takes about a second.
ANALYZE audience_response;
