-- V677: a duplicate that came BEFORE the lead it points at.
--
-- Usually a duplicate is a later repeat of its lead. But when a closed lead's repeat takes its
-- place (closedRepeatTakesOver), and in imported data where the newest enquiry was kept as the
-- lead, the duplicate row is the person's EARLIER enquiry and the lead itself is the repeat
-- (V676 first_enquiry_at). A Duplicate Leads tab on latest-enquiry dates (route
-- enquiryDates=latest) lists that lead, so it leaves these rows out, or each person would show
-- twice. Kept on the row so the list never looks up the lead of every duplicate.
--
-- precedes_lead = TRUE when this duplicate was submitted before the lead it points at, else
-- NULL. The app refreshes it with the lead dates (AudienceResponseRepository.refreshDuplicateOrder).
--
-- Same lock rules as V676: never queue behind a long report on this table.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE audience_response ADD COLUMN IF NOT EXISTS precedes_lead BOOLEAN;

-- About 21.6k rows on prod (2026-11-13), almost all from imported data.
UPDATE audience_response d
   SET precedes_lead = TRUE
  FROM audience_response p
 WHERE p.id = d.primary_response_id
   AND d.is_duplicate = TRUE
   AND d.submitted_at < p.submitted_at
   AND d.precedes_lead IS DISTINCT FROM TRUE;
