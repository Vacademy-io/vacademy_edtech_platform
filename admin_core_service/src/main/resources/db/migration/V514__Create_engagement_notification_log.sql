-- One row per (slot, run date) that has been pushed.
--
-- The notify tick runs every 15 minutes across 4 admin_core replicas. ShedLock stops
-- the replicas colliding, but it cannot stop a restart or a clock adjustment from
-- replaying a window that already fired — and a duplicate 6 AM push to a whole batch
-- is exactly the kind of thing that gets an app muted. The unique index below is the
-- real guarantee; the lock only reduces wasted work.

CREATE TABLE public.engagement_notification_log (
    id           varchar(255) NOT NULL,
    slot_id      varchar(255) NOT NULL,
    -- The institute-local date the slot ran on, not the server's date.
    run_date     date NOT NULL,
    institute_id varchar(255) NOT NULL,
    recipients   int4 NOT NULL DEFAULT 0,
    sent_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT engagement_notification_log_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX idx_engagement_notification_once
    ON public.engagement_notification_log USING btree (slot_id, run_date);
