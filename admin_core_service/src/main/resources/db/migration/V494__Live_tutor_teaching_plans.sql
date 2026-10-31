-- ================================================================================
-- V494 — Live AI Tutor: teaching plans, learner state, pricing rows
--
-- The personalized teaching mode (docs/ai-tutor/LIVE_TUTOR_DESIGN.md) compiles
-- every slide of an opted-in course into a TEACHING PLAN — topics (one whiteboard
-- each) made of concepts (one board phase each, with board operations, default
-- narration, teaching notes and a check) — and then teaches a learner from that
-- plan one concept at a time, remembering what they are weak at.
--
-- Seven new tables and two pricing rows. Nothing here changes an existing table,
-- so this is additive and safe to run against live data. ai_service owns the
-- rows (same pattern as the knowledge-base tables in V435); admin_core reads
-- them for the admin preview and the teaching-off view.
--
-- Request types are REUSED ('content' for compile, 'image' for generated media)
-- so the ai_token_usage request_type CHECK does not change here — adding a new
-- request type without rewriting that CHECK silently drops every charge
-- (V325, V365 incidents).
-- ================================================================================

-- ================================================================================
-- 1. The compiled plan for one slide version
--
-- One row per (slide, version). A slide edit marks the READY plan STALE; the
-- recompile writes a new version and keeps the old one until the new one is
-- READY, so a learner mid-session never loses their board.
-- ================================================================================
CREATE TABLE IF NOT EXISTS teaching_plan (
    id                  VARCHAR(255) PRIMARY KEY,
    slide_id            VARCHAR(255) NOT NULL,
    institute_id        VARCHAR(255) NOT NULL,
    version             INTEGER      NOT NULL DEFAULT 1,
    -- sha256 of the published slide body the plan was compiled from; a
    -- mismatch at read time means the slide changed underneath the plan.
    content_hash        VARCHAR(80)  NOT NULL,
    language            VARCHAR(20)  NOT NULL DEFAULT 'en',
    -- NEEDS_DETAILS | COMPILING | READY | FAILED | STALE | DELETED
    status              VARCHAR(20)  NOT NULL,
    -- Admin-written "what this video / PDF teaches" for VIDEO and PDF slides,
    -- the only source the compiler has for slides whose body is not text.
    source_description  TEXT,
    model               VARCHAR(120),
    objectives_json     JSONB,
    key_terms_json      JSONB,
    -- Raw compiler output, kept for repair and debugging only; the normalized
    -- topic/concept rows below are the source of truth.
    raw_plan_json       JSONB,
    error               TEXT,
    created_by_user_id  VARCHAR(255),
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT teaching_plan_slide_version_unique UNIQUE (slide_id, version),
    CONSTRAINT teaching_plan_status_valid CHECK (status IN
        ('NEEDS_DETAILS', 'COMPILING', 'READY', 'FAILED', 'STALE', 'DELETED'))
);
CREATE INDEX IF NOT EXISTS idx_teaching_plan_slide_status
    ON teaching_plan (slide_id, status);
CREATE INDEX IF NOT EXISTS idx_teaching_plan_institute
    ON teaching_plan (institute_id, status);

-- ================================================================================
-- 2. Topics: one whiteboard each. The board is cleared when the topic ends.
-- ================================================================================
CREATE TABLE IF NOT EXISTS teaching_topic (
    id                  VARCHAR(255) PRIMARY KEY,
    plan_id             VARCHAR(255) NOT NULL REFERENCES teaching_plan(id) ON DELETE CASCADE,
    slide_id            VARCHAR(255) NOT NULL,
    topic_order         INTEGER      NOT NULL,
    title               TEXT         NOT NULL,
    estimated_seconds   INTEGER,
    -- Closing summary board for the topic, as ops and as materialized HTML.
    summary_ops_json    JSONB,
    summary_html        TEXT
);
CREATE INDEX IF NOT EXISTS idx_teaching_topic_plan
    ON teaching_topic (plan_id, topic_order);

-- ================================================================================
-- 3. Concepts: one board phase each.
--
-- board_ops_json is the ordered list of whitelisted board operations with
-- stable element ids (the live tutor highlights and annotates by id);
-- board_html is the cumulative render of the topic's ops up to and including
-- this concept, for the teaching-off view and the admin preview.
-- ================================================================================
CREATE TABLE IF NOT EXISTS teaching_concept (
    id                  VARCHAR(255) PRIMARY KEY,
    topic_id            VARCHAR(255) NOT NULL REFERENCES teaching_topic(id) ON DELETE CASCADE,
    plan_id             VARCHAR(255) NOT NULL,
    concept_order       INTEGER      NOT NULL,
    title               TEXT         NOT NULL,
    -- Mastery is tracked per tag (e.g. 'force.definition'), not per concept
    -- row, so it survives a recompile.
    concept_tags        TEXT[]       NOT NULL DEFAULT '{}',
    prerequisites_json  JSONB,
    board_ops_json      JSONB        NOT NULL,
    board_html          TEXT         NOT NULL,
    -- Default narration in the course language; say_i18n_json holds the same
    -- narration in the other supported languages ({lang: text}) so a learner's
    -- language override needs no live model call and stays cacheable.
    say                 TEXT         NOT NULL,
    say_i18n_json       JSONB,
    teach_notes         TEXT,
    -- {type, prompt, options, expected, rubric, misconceptions[], pass_threshold}
    check_json          JSONB
);
CREATE INDEX IF NOT EXISTS idx_teaching_concept_topic
    ON teaching_concept (topic_id, concept_order);
CREATE INDEX IF NOT EXISTS idx_teaching_concept_plan
    ON teaching_concept (plan_id);

-- ================================================================================
-- 4. Media generated for a plan (SVG diagrams, stock or AI images, clips).
--
-- Every row carries a text description and labelled parts, so the tutor can
-- refer to the picture and highlight a part of it; media without a description
-- is decoration the model cannot teach from.
-- ================================================================================
CREATE TABLE IF NOT EXISTS teaching_media (
    id                  VARCHAR(255) PRIMARY KEY,
    plan_id             VARCHAR(255) NOT NULL REFERENCES teaching_plan(id) ON DELETE CASCADE,
    concept_id          VARCHAR(255),
    kind                VARCHAR(20)  NOT NULL,   -- svg | image | video
    source              VARCHAR(20)  NOT NULL,   -- SVG | STOCK | AI_IMAGE | AI_VIDEO
    file_id             VARCHAR(255),
    url                 TEXT,
    description         TEXT         NOT NULL,
    parts_json          JSONB,
    cost_credits        DECIMAL(10,3) NOT NULL DEFAULT 0,
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT teaching_media_kind_valid   CHECK (kind IN ('svg', 'image', 'video')),
    CONSTRAINT teaching_media_source_valid CHECK (source IN ('SVG', 'STOCK', 'AI_IMAGE', 'AI_VIDEO'))
);
CREATE INDEX IF NOT EXISTS idx_teaching_media_plan
    ON teaching_media (plan_id);

-- ================================================================================
-- 5. Learner state: where each learner is in a batch's course and what they
--    are weak at. One row per (learner, batch). Read at every session start,
--    rewritten after every check.
-- ================================================================================
CREATE TABLE IF NOT EXISTS tutor_learner_state (
    id                   VARCHAR(255) PRIMARY KEY,
    user_id              VARCHAR(255) NOT NULL,
    package_session_id   VARCHAR(255) NOT NULL,
    institute_id         VARCHAR(255) NOT NULL,
    current_slide_id     VARCHAR(255),
    current_topic_id     VARCHAR(255),
    current_concept_id   VARCHAR(255),
    -- {concept_tag: {score, attempts, last_at}}
    mastery_json         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- [{tag, note, seen_at}]
    misconceptions_json  JSONB        NOT NULL DEFAULT '[]'::jsonb,
    -- concept ids flagged WEAK, revisited at topic and chapter summaries
    weak_concepts_json   JSONB        NOT NULL DEFAULT '[]'::jsonb,
    -- 150 to 250 words, rewritten at session end; spoken back briefly on resume
    rolling_summary      TEXT,
    preferred_language   VARCHAR(20),
    pace                 VARCHAR(10),            -- slow | normal | fast
    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tutor_learner_state_unique UNIQUE (user_id, package_session_id)
);
CREATE INDEX IF NOT EXISTS idx_tutor_learner_state_batch
    ON tutor_learner_state (package_session_id, updated_at DESC);

-- ================================================================================
-- 6. Sessions: one sitting. The transcript lives in chat_sessions /
--    chat_messages (context_type 'tutor') so the existing chat analysis screens
--    can list tutor conversations; this row holds what those tables cannot.
-- ================================================================================
CREATE TABLE IF NOT EXISTS tutor_session (
    id                   VARCHAR(255) PRIMARY KEY,
    user_id              VARCHAR(255) NOT NULL,
    institute_id         VARCHAR(255) NOT NULL,
    package_session_id   VARCHAR(255) NOT NULL,
    chat_session_id      VARCHAR(255),
    mode                 VARCHAR(10)  NOT NULL,   -- VOICE | TEXT
    tts_provider         VARCHAR(20),
    tts_voice            VARCHAR(80),
    language             VARCHAR(20),
    started_slide_id     VARCHAR(255),
    started_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at             TIMESTAMP,
    status               VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | ENDED | ABANDONED
    minutes_billed       INTEGER      NOT NULL DEFAULT 0,
    -- Cost telemetry (model tokens, TTS chars, STT seconds) and the end-of-
    -- session scorecard, recorded even while live rates are undecided.
    summary_json         JSONB,
    CONSTRAINT tutor_session_mode_valid CHECK (mode IN ('VOICE', 'TEXT'))
);
CREATE INDEX IF NOT EXISTS idx_tutor_session_user
    ON tutor_session (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tutor_session_batch
    ON tutor_session (package_session_id, started_at DESC);

-- ================================================================================
-- 7. Concept attempts: every answer the learner gave, scored. The concept
--    heatmap per batch and the learner's mastery both derive from here.
-- ================================================================================
CREATE TABLE IF NOT EXISTS tutor_concept_attempt (
    id                   VARCHAR(255) PRIMARY KEY,
    tutor_session_id     VARCHAR(255) NOT NULL REFERENCES tutor_session(id) ON DELETE CASCADE,
    user_id              VARCHAR(255) NOT NULL,
    concept_id           VARCHAR(255) NOT NULL,
    attempt_no           INTEGER      NOT NULL,
    student_answer       TEXT,
    score                DECIMAL(4,3),
    misconception        TEXT,
    action_taken         VARCHAR(20),            -- advance | remediate | advance_weak | skipped
    -- Student-specific board ops made during this attempt (a highlight, a note
    -- written for one learner); session-scoped, never written to the plan.
    session_ops_json     JSONB,
    created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tutor_attempt_concept
    ON tutor_concept_attempt (concept_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tutor_attempt_user
    ON tutor_concept_attempt (user_id, created_at DESC);

-- ================================================================================
-- 8. Pricing rows (idempotent). Must match DEFAULT_TOOL_PRICING in
--    ai_service/app/services/tool_cost_estimator.py and ToolKey in
--    frontend-admin-dashboard/src/services/ai-credits/get-ai-credits.ts.
--
--    tutor_compile_slide: one strong-model call per slide, charged as
--      max(flat, actual token cost) — same shape as course_slide_*.
--    tutor_media_image: charged ONCE PER GENERATED IMAGE (one charge_tool call
--      per media row, idempotent on the media id), so it stays 'flat' and the
--      unit_field CHECK does not need a new unit.
-- ================================================================================
INSERT INTO ai_tool_pricing (tool_key, request_type, flat_base_credits, per_unit_credits, unit_field, params_json)
VALUES
    ('tutor_compile_slide', 'content', 2, 0, 'flat', '{}'),
    ('tutor_media_image',   'image',   1, 0, 'flat', '{}')
ON CONFLICT (tool_key) DO NOTHING;
