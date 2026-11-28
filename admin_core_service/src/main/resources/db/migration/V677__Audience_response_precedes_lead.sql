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
-- Only the column here: a nullable column with no default is a catalog change, so the table lock
-- is held for a moment. The backfill is V678, its own transaction, so it never runs under this
-- lock (each Flyway migration commits on its own). Never queue behind a long report on this table.
SET LOCAL lock_timeout = '5s';

ALTER TABLE audience_response ADD COLUMN IF NOT EXISTS precedes_lead BOOLEAN;
