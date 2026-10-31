-- Daily engagement: teacher-authored, time-scheduled tasks for a batch.
-- Design doc: docs/engagement/DAILY_ENGAGEMENT_PLATFORM.md
--
-- Four tables: a PLAN scoped to one batch, SLOTS that carry the schedule window,
-- ITEMS that are the actual cards a learner sees, and one ATTEMPT per learner per
-- item. Points earned flow into points_ledger (V512), never into these tables.

-- ── Plan ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.engagement_plan (
    id                 varchar(255) NOT NULL,
    institute_id       varchar(255) NOT NULL,
    package_session_id varchar(255) NOT NULL,
    title              varchar(500) NOT NULL,
    description        text NULL,
    subject_id         varchar(255) NULL,
    -- DRAFT | PUBLISHED | ARCHIVED | DELETED. Only PUBLISHED reaches learners.
    status             varchar(32) NOT NULL DEFAULT 'DRAFT',
    -- SNAPSHOT of the institute's IANA zone at creation, deliberately not read live:
    -- an institute changing its timezone mid-term must not silently shift windows
    -- under learners who already attempted them.
    timezone           varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
    -- EXPIRES | CATCH_UP_FULL | CATCH_UP_REDUCED (items may override).
    default_miss_policy      varchar(32) NOT NULL DEFAULT 'EXPIRES',
    default_catch_up_days    int4 NULL,
    default_catch_up_percent int4 NULL,
    created_by_user_id varchar(255) NOT NULL,
    created_at         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT engagement_plan_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_engagement_plan_ps ON public.engagement_plan USING btree (package_session_id, status);
CREATE INDEX idx_engagement_plan_institute ON public.engagement_plan USING btree (institute_id, status);

-- ── Slot: the schedule window ────────────────────────────────────────────────
-- Stored as WALL-CLOCK time + the plan's timezone, never as UTC instants: a
-- recurring 6 AM slot stored as an instant drifts by an hour twice a year for any
-- institute in a DST zone. Resolution to instants happens at read time.
CREATE TABLE public.engagement_slot (
    id          varchar(255) NOT NULL,
    plan_id     varchar(255) NOT NULL,
    title       varchar(500) NULL,
    start_date  date NOT NULL,
    -- NULL = single-day slot (end_date = start_date).
    end_date    date NULL,
    start_time  time NOT NULL,
    end_time    time NOT NULL,
    -- Bitmask Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64.
    -- NULL = every day in the date range.
    dow_mask    int4 NULL,
    -- When answers + leaderboard are revealed. NULL = reveal at end_time.
    reveal_time time NULL,
    -- When the push fires. NULL = no push for this slot.
    notify_time time NULL,
    sort_order  int4 NOT NULL DEFAULT 0,
    status      varchar(32) NOT NULL DEFAULT 'ACTIVE',
    created_at  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT engagement_slot_pkey PRIMARY KEY (id),
    CONSTRAINT fk_engagement_slot_plan FOREIGN KEY (plan_id)
        REFERENCES public.engagement_plan(id) ON DELETE CASCADE,
    -- Windows crossing midnight are rejected at authoring time rather than supported;
    -- a 10 PM - 2 AM engagement window is not a use case worth the bug surface.
    CONSTRAINT engagement_slot_time_order CHECK (end_time > start_time)
);

CREATE INDEX idx_engagement_slot_plan_dates ON public.engagement_slot USING btree (plan_id, start_date, end_date);

-- ── Item: one card the learner sees ──────────────────────────────────────────
CREATE TABLE public.engagement_item (
    id            varchar(255) NOT NULL,
    slot_id       varchar(255) NOT NULL,
    -- READING_HTML | VISUAL_NOTE | QUESTION_OF_DAY | QUIZ | GAME | POLL
    item_type     varchar(48) NOT NULL,
    title         varchar(500) NOT NULL,
    -- Bumped when an item is edited after its slot has opened AND attempts exist.
    -- Attempts pin to the version they were made against, so a teacher fixing a
    -- typo at noon cannot silently invalidate the morning's scores.
    version       int4 NOT NULL DEFAULT 1,
    sort_order    int4 NOT NULL DEFAULT 0,
    is_required   boolean NOT NULL DEFAULT false,
    -- Content. Exactly one is populated, depending on item_type.
    content_html  text NULL,          -- READING_HTML, VISUAL_NOTE, GAME
    slide_id      varchar(255) NULL,  -- reuse of an existing slide
    question_id   varchar(255) NULL,  -- QUESTION_OF_DAY
    assessment_id varchar(255) NULL,  -- QUIZ
    payload_json  jsonb NULL,         -- POLL options, game config, per-type extras
    -- Scoring
    completion_points int4 NOT NULL DEFAULT 0,
    correct_points    int4 NOT NULL DEFAULT 0,
    -- Ceiling the server clamps a reported score to (GAME, QUIZ).
    max_score         int4 NULL,
    -- TRUE only when the server holds the answer key and can grade it itself.
    -- Teacher-uploaded games are FALSE: the page reports its own score over
    -- postMessage and anyone with devtools can post any number.
    is_verifiable     boolean NOT NULL DEFAULT false,
    -- NULL = inherit the plan default.
    miss_policy       varchar(32) NULL,
    catch_up_days     int4 NULL,
    catch_up_percent  int4 NULL,
    status        varchar(32) NOT NULL DEFAULT 'ACTIVE',
    created_at    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT engagement_item_pkey PRIMARY KEY (id),
    CONSTRAINT fk_engagement_item_slot FOREIGN KEY (slot_id)
        REFERENCES public.engagement_slot(id) ON DELETE CASCADE
);

CREATE INDEX idx_engagement_item_slot ON public.engagement_item USING btree (slot_id, sort_order);
CREATE INDEX idx_engagement_item_status ON public.engagement_item USING btree (status);

-- ── Attempt: one row per learner per item ────────────────────────────────────
CREATE TABLE public.engagement_attempt (
    id                 varchar(255) NOT NULL,
    item_id            varchar(255) NOT NULL,
    item_version       int4 NOT NULL DEFAULT 1,
    user_id            varchar(255) NOT NULL,
    institute_id       varchar(255) NOT NULL,
    package_session_id varchar(255) NOT NULL,
    -- STARTED | COMPLETED | SKIPPED
    status             varchar(32) NOT NULL,
    -- NULL for item types with no notion of correctness.
    is_correct         boolean NULL,
    score              numeric NULL,
    max_score          numeric NULL,
    -- Chosen option, game payload, scroll depth, ...
    response_json      jsonb NULL,
    time_spent_ms      int8 NULL,
    points_awarded     int4 NOT NULL DEFAULT 0,
    -- Completed under a catch-up policy rather than inside the live window.
    -- Late completions recover points but never repair a broken streak.
    is_late            boolean NOT NULL DEFAULT false,
    -- The server graded this itself (vs. trusting a self-reported score).
    is_verified        boolean NOT NULL DEFAULT false,
    started_at         timestamp NULL,
    completed_at       timestamp NULL,
    created_at         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT engagement_attempt_pkey PRIMARY KEY (id),
    CONSTRAINT fk_engagement_attempt_item FOREIGN KEY (item_id)
        REFERENCES public.engagement_item(id) ON DELETE CASCADE
);

-- One attempt per learner per item. Also the concurrency guard: a double-tapped
-- submit collides here instead of creating two scored rows.
CREATE UNIQUE INDEX idx_engagement_attempt_unique ON public.engagement_attempt USING btree (item_id, user_id);
CREATE INDEX idx_engagement_attempt_user ON public.engagement_attempt USING btree (user_id, completed_at);
-- Backs the "70 people have attempted this" counter.
CREATE INDEX idx_engagement_attempt_item_status ON public.engagement_attempt USING btree (item_id, status);
CREATE INDEX idx_engagement_attempt_ps ON public.engagement_attempt USING btree (package_session_id, completed_at);
