-- Learner reminder emails ("starts in N minutes") and "assessment is live" emails are sent by a
-- scheduled job. These two columns record which start time each email already went out for, so
-- the job sends it once even with several pods running, and sends it again only when the admin
-- moves the start time.
--
-- Stored as the assessment's bound_start_time at the moment of sending (same column type), not
-- as a send time: a NULL or a different value means "not sent for the current start time".

ALTER TABLE assessment_notification_metadata
    ADD COLUMN IF NOT EXISTS participant_reminder_sent_for timestamp NULL,
    ADD COLUMN IF NOT EXISTS participant_live_sent_for timestamp NULL;
