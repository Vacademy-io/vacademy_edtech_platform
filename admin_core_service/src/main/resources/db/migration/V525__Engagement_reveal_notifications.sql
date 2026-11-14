-- The reveal push: "the answer is out" at a slot's reveal time.
--
-- engagement_notification_log already guarantees at-most-once per (slot, run date)
-- for the morning push. The reveal push is a SECOND send for the same slot and day,
-- so the uniqueness has to include what KIND of send it was, or the reveal could
-- never be recorded (or, worse, would block the morning push from being recorded).

ALTER TABLE public.engagement_notification_log
    ADD COLUMN kind varchar(32) NOT NULL DEFAULT 'NOTIFY';

DROP INDEX IF EXISTS idx_engagement_notification_once;

CREATE UNIQUE INDEX idx_engagement_notification_once
    ON public.engagement_notification_log USING btree (slot_id, run_date, kind);
