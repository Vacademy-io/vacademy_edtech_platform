-- Weekly planning email ("What are you teaching next week?").
--
-- One row per (batch, teacher, week). The job writes it when it emails the teacher;
-- the teacher's answer, the AI draft job and the resulting plan are tracked on it.
--   token_hash: sha256 (hex) of the link token in the email. The token itself is
--               never stored. The link can only read this one row's context and
--               submit this week's topic; it never signs anyone in.
--   reminder_token_hash: the reminder carries a fresh token; both links work.
--   status:     SENT | SUBMITTED | DRAFTING | DRAFTED | PUBLISHED | FAILED | EXPIRED
--   week_start: the Monday of the week being planned (institute-local).
--   subjects:   display text, the teacher's subjects in this batch.
CREATE TABLE IF NOT EXISTS public.engagement_planning_request (
    id                 varchar(36)   PRIMARY KEY,
    institute_id       varchar(255)  NOT NULL,
    package_session_id varchar(255)  NOT NULL,
    teacher_user_id    varchar(255)  NOT NULL,
    week_start         date          NOT NULL,
    status             varchar(16)   NOT NULL,
    token_hash         varchar(64)   NOT NULL,
    reminder_token_hash varchar(64)  NULL,
    subjects           text          NULL,
    topic              text          NULL,
    ai_task_id         varchar(64)   NULL,
    plan_id            varchar(255)  NULL,
    error              text          NULL,
    attempts           integer       NOT NULL DEFAULT 0,
    expires_at         timestamp     NOT NULL,
    sent_at            timestamp     NULL,
    reminded_at        timestamp     NULL,
    submitted_at       timestamp     NULL,
    drafted_at         timestamp     NULL,
    created_at         timestamp     NOT NULL DEFAULT now(),
    updated_at         timestamp     NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_engagement_planning_request_week
    ON public.engagement_planning_request (package_session_id, teacher_user_id, week_start);
CREATE UNIQUE INDEX IF NOT EXISTS uq_engagement_planning_request_token
    ON public.engagement_planning_request (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_engagement_planning_request_reminder_token
    ON public.engagement_planning_request (reminder_token_hash) WHERE reminder_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_engagement_planning_request_status
    ON public.engagement_planning_request (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_engagement_planning_request_institute_week
    ON public.engagement_planning_request (institute_id, week_start);
