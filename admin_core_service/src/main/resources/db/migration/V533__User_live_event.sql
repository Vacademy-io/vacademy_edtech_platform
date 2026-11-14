-- User live events -- the institute-wide live activity feed.
--
-- Distinct from admin_activity_log, which is admin-only by construction: that table is
-- written by AuditableAspect off the request thread's clientId header and is skipped
-- entirely when there is no request context. This one records what EVERY role is doing --
-- prospects filling forms, learners at checkout, counsellors calling, AI agents dialling,
-- webhook threads and scheduled jobs -- none of which the aspect can reach.
--
-- Rows are written by LiveActivityRecorder, which publishes to its own replica's SSE
-- subscribers immediately. Other replicas pick the row up by tailing this table on a short
-- interval, which is why occurred_at carries an index -- see LiveActivityPoller.

CREATE TABLE user_live_event (
    id                 VARCHAR(36)  PRIMARY KEY,
    institute_id       VARCHAR(255) NOT NULL,
    occurred_at        TIMESTAMP    NOT NULL DEFAULT now(),
    -- INVITE_FORM | LEAD_FORM | CALL | PAYMENT | COUNSELLOR
    category           VARCHAR(32)  NOT NULL,
    action             VARCHAR(64)  NOT NULL,
    -- PROSPECT | LEARNER | COUNSELLOR | ADMIN | AI | SYSTEM
    actor_type         VARCHAR(16)  NOT NULL,
    -- Deterministic idempotency key derived from the business fact, never from a
    -- timestamp or UUID. Two attempts to record the same real-world moment must
    -- collide here -- see uq_ule_dedupe below.
    dedupe_key         VARCHAR(255) NOT NULL,
    subject_name       VARCHAR(255),
    subject_email      VARCHAR(255),
    subject_mobile     VARCHAR(64),
    subject_id         VARCHAR(255),
    -- enrollInviteId / audienceResponseId / callLogId / paymentLogId
    entity_id          VARCHAR(255),
    counsellor_user_id VARCHAR(255),
    counsellor_name    VARCHAR(255),
    payload            JSONB
);

-- THE load-bearing constraint. Duplicates arrive from four independent directions:
-- multiple replicas running the same code, provider sibling events (Razorpay sends both
-- payment.captured AND order.paid for one payment), webhook retries and the deliberate
-- /webhook/reprocess replay, and @Scheduled jobs that lack @SchedulerLock (EwayPoolingService
-- and CallBillingReconciliationJob both poll on every replica and feed these producers).
--
-- Rather than harden each hook separately, the recorder does
--   INSERT ... ON CONFLICT (dedupe_key) DO NOTHING
-- and publishes ONLY when a row was actually inserted. The database is the arbiter; the
-- losing replica stays silent and subscribers see the event once.
CREATE UNIQUE INDEX uq_ule_dedupe ON user_live_event (dedupe_key);

-- Read paths:
--   1. "Everything happening in my org"  -> idx_ule_inst_time
--   2. Per-category tab + counter strip + per-category retention -> idx_ule_inst_cat_time
-- BRIN on occurred_at supports the retention sweep cheaply.
--
-- Plain indexes, NOT CONCURRENTLY: this is a brand-new empty table so there is nothing to
-- lock. Do not copy the CONCURRENTLY pattern from V408/V409 -- that was for existing hot
-- tables and is what caused the V25 production incident (statement_timeout mid-build left
-- every index INVALID while Flyway recorded success).
CREATE INDEX idx_ule_inst_time
    ON user_live_event (institute_id, occurred_at DESC);

CREATE INDEX idx_ule_inst_cat_time
    ON user_live_event (institute_id, category, occurred_at DESC);

CREATE INDEX idx_ule_occurred_brin
    ON user_live_event USING BRIN (occurred_at);

-- Per-user "unseen since" marker behind the sidebar badge. One row per user per institute,
-- upserted when the feed is opened. Deliberately not a preference blob -- admin_core has no
-- general user-preference table and this needs exactly one column.
CREATE TABLE live_activity_seen (
    user_id      VARCHAR(255) NOT NULL,
    institute_id VARCHAR(255) NOT NULL,
    last_seen_at TIMESTAMP    NOT NULL,
    PRIMARY KEY (user_id, institute_id)
);
