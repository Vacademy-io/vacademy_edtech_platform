-- Daily engagement: plans scheduled in days after each learner joins the batch.
--
-- CALENDAR (existing behaviour): a slot runs on real dates (start_date..end_date).
-- RELATIVE: a slot runs on "Day start_day .. Day end_day" counted from each
-- learner's own Day 1 = the later of their batch enrollment date and the date the
-- plan was first published (so learners already in the batch start on publish day).
-- For RELATIVE slots start_date/end_date hold a virtual calendar anchored on
-- 2000-01-01 (Day 1) so existing NOT NULL constraints and ordering still hold.
ALTER TABLE public.engagement_plan
    ADD COLUMN IF NOT EXISTS schedule_mode varchar(16) NOT NULL DEFAULT 'CALENDAR',
    ADD COLUMN IF NOT EXISTS published_at timestamp NULL;

UPDATE public.engagement_plan
   SET published_at = created_at
 WHERE status = 'PUBLISHED' AND published_at IS NULL;

ALTER TABLE public.engagement_slot
    ADD COLUMN IF NOT EXISTS start_day int4 NULL,
    ADD COLUMN IF NOT EXISTS end_day int4 NULL;
