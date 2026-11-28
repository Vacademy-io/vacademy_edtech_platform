-- V38: partial index for the hub's email-event counts and drill-down.
--
-- The overview counts EMAIL_EVENTs in a time window, joined to their parent EMAIL via
-- source = parent.id. Once V37 added idx_nl_source_type the planner merge-joined on
-- source: it walked every EMAIL_EVENT ever recorded (413k rows) in source order, reading
-- the heap for each, so one count took 7-38 s and the overview (five of them) averaged
-- 10 s with a 34 s worst case (2026-10-23).
--
-- This index holds only EMAIL_EVENT rows, ordered by notification_date, with the parent
-- id and the event-name prefix of the body, so the window is a short range scan. The
-- queries read left(body, 30): the longest event name prefix, "Email Event: COMPLAINT",
-- is 22 characters. NotificationLogRepository materializes the two sides so the planner
-- cannot return to the merge join.
--
-- Prod already has it, built by hand with CREATE INDEX CONCURRENTLY; IF NOT EXISTS makes
-- this a no-op there.

CREATE INDEX IF NOT EXISTS idx_nl_email_event_window
    ON notification_log (notification_date, source, (left(body, 30)))
    WHERE notification_type = 'EMAIL_EVENT';
