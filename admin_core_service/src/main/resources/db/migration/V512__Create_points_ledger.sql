-- Per-student points, stored for the first time.
--
-- Before this table the platform had NO per-student points anywhere: the leaderboard
-- ranked raw focused-activity MINUTES recomputed per request (LeaderboardEntryDTO.points),
-- and the learner's XP/level/streak were computed in the browser and cached in
-- localStorage (play-gamification.ts) where the server never saw them. Neither could
-- express "20 points for answering today's question correctly", and badge-holding
-- learners showed as 0 pts on the leaderboard.
--
-- This ledger is APPEND-ONLY. Never UPDATE or DELETE a row: a correction is a
-- compensating row with negative points. Every subsystem that awards points writes
-- here, so totals, weekly windows and the per-source breakdown are all one query.

CREATE TABLE public.points_ledger (
    id                 varchar(255) NOT NULL,
    user_id            varchar(255) NOT NULL,
    institute_id       varchar(255) NOT NULL,
    -- NULL = institute-wide award not attributable to one batch.
    package_session_id varchar(255) NULL,
    -- ENGAGEMENT_ITEM | ENGAGEMENT_STREAK | ASSESSMENT | ACTIVITY | MANUAL
    source_type        varchar(64)  NOT NULL,
    -- Soft pointer into the source system (engagement_item.id, assessment id, ...).
    source_id          varchar(255) NULL,
    -- Signed. A negative row reverses an earlier award and keeps the audit trail.
    points             int4         NOT NULL,
    reason             text         NULL,
    awarded_at         timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- At-most-once guarantee. '{source_type}:{source_id}:{user_id}' for one-shot awards;
    -- repeatables carry the local date, e.g. 'ENGAGEMENT_STREAK:2026-09-13:{user_id}'.
    -- A retried submit collides here instead of double-awarding.
    idempotency_key    varchar(255) NOT NULL,
    created_at         timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT points_ledger_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX idx_points_ledger_idem ON public.points_ledger USING btree (idempotency_key);

-- Learner summary: total + level + breakdown for one learner in one institute.
CREATE INDEX idx_points_ledger_user_inst ON public.points_ledger USING btree (institute_id, user_id);

-- Leaderboard: sum per user over a batch and a time window (weekly / all-time).
CREATE INDEX idx_points_ledger_ps_time ON public.points_ledger USING btree (package_session_id, awarded_at);

-- Institute-wide leaderboard over a time window.
CREATE INDEX idx_points_ledger_inst_time ON public.points_ledger USING btree (institute_id, awarded_at);

-- "Who earned points for this item" + reversal lookups.
CREATE INDEX idx_points_ledger_source ON public.points_ledger USING btree (source_type, source_id);
