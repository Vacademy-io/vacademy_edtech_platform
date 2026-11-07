-- Knowledge Base companions: a student-facing tutor built on ONE knowledge base.
-- Design doc: docs/student-ai/KB_COMPANIONS_DESIGN.md
--
-- Read and written only by ai_service (raw SQL, services/kb_companion/), like the
-- KB tables themselves (V435). Independent of the Student AI chatbot tables
-- (chat_sessions / chat_messages) on purpose — owner decision 2026-09-28.

-- ── Companion ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kb_companion (
    id                 varchar(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    institute_id       varchar(255) NOT NULL,
    knowledge_base_id  varchar(255) NOT NULL REFERENCES public.knowledge_base (id) ON DELETE CASCADE,
    name               varchar(200) NOT NULL,
    description        text NULL,
    avatar_emoji       varchar(16) NULL,
    accent_color       varchar(16) NULL,
    -- Tone and style only. Grounding rules are fixed in code and cannot be
    -- loosened from here.
    persona            text NULL,
    language           varchar(10) NOT NULL DEFAULT 'en',
    -- learn | practice | ask
    modes              text[] NOT NULL DEFAULT ARRAY['learn', 'practice', 'ask']::text[],
    -- Topic / subtopic ids of the KB topic tree; empty = the whole KB.
    scope_node_ids     text[] NOT NULL DEFAULT ARRAY[]::text[],
    voice_enabled      boolean NOT NULL DEFAULT true,
    voice_provider     varchar(30) NULL,
    voice_id           varchar(120) NULL,
    show_on_dashboard  boolean NOT NULL DEFAULT true,
    -- Questions a learner may ask per day on this companion (credit guard).
    daily_question_cap int4 NOT NULL DEFAULT 30,
    status             varchar(20) NOT NULL DEFAULT 'ACTIVE',
    starts_at          timestamp NULL,
    ends_at            timestamp NULL,
    created_by         varchar(255) NULL,
    created_at         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT kb_companion_status_chk CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
    CONSTRAINT kb_companion_language_chk CHECK (language IN ('en', 'hi'))
);

CREATE INDEX IF NOT EXISTS idx_kb_companion_institute ON public.kb_companion (institute_id, status);
CREATE INDEX IF NOT EXISTS idx_kb_companion_kb ON public.kb_companion (knowledge_base_id);

-- ── Who sees it ──────────────────────────────────────────────────────────────
-- INSTITUTE: every learner of the institute (target_id = institute id).
-- BATCH:     learners ACTIVE in that package_session.
-- LEARNER:   one user id.
CREATE TABLE IF NOT EXISTS public.kb_companion_assignment (
    id            varchar(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    companion_id  varchar(255) NOT NULL REFERENCES public.kb_companion (id) ON DELETE CASCADE,
    institute_id  varchar(255) NOT NULL,
    target_type   varchar(20) NOT NULL,
    target_id     varchar(255) NOT NULL,
    created_at    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT kb_companion_assignment_type_chk CHECK (target_type IN ('INSTITUTE', 'BATCH', 'LEARNER')),
    CONSTRAINT kb_companion_assignment_uq UNIQUE (companion_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_companion_assignment_target
    ON public.kb_companion_assignment (institute_id, target_type, target_id);

-- ── Compiled lessons (shared by every learner of the institute) ──────────────
-- One row per (institute, KB, node, language). The unique key is also the
-- cross-pod lock: only the request that inserts the row compiles it.
CREATE TABLE IF NOT EXISTS public.kb_companion_lesson (
    id                 varchar(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    institute_id       varchar(255) NOT NULL,
    knowledge_base_id  varchar(255) NOT NULL REFERENCES public.knowledge_base (id) ON DELETE CASCADE,
    node_id            varchar(255) NOT NULL,
    language           varchar(10) NOT NULL DEFAULT 'en',
    -- GENERATING | READY | FAILED
    status             varchar(20) NOT NULL DEFAULT 'GENERATING',
    title              varchar(500) NULL,
    cards_json         jsonb NOT NULL DEFAULT '[]'::jsonb,
    cards_planned      int4 NOT NULL DEFAULT 0,
    -- Hash of the chunk ids the lesson was written from: a re-ingest changes it
    -- and the lesson is recompiled on next open.
    source_fingerprint varchar(64) NULL,
    model              varchar(100) NULL,
    credits_charged    numeric(12, 2) NOT NULL DEFAULT 0,
    error_message      text NULL,
    created_by         varchar(255) NULL,
    created_at         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT kb_companion_lesson_status_chk CHECK (status IN ('GENERATING', 'READY', 'FAILED')),
    CONSTRAINT kb_companion_lesson_uq UNIQUE (institute_id, knowledge_base_id, node_id, language)
);

-- ── Practice sets (shared, compiled once) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kb_companion_practice (
    id                 varchar(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    institute_id       varchar(255) NOT NULL,
    knowledge_base_id  varchar(255) NOT NULL REFERENCES public.knowledge_base (id) ON DELETE CASCADE,
    node_id            varchar(255) NOT NULL,
    language           varchar(10) NOT NULL DEFAULT 'en',
    status             varchar(20) NOT NULL DEFAULT 'GENERATING',
    questions_json     jsonb NOT NULL DEFAULT '[]'::jsonb,
    model              varchar(100) NULL,
    credits_charged    numeric(12, 2) NOT NULL DEFAULT 0,
    error_message      text NULL,
    created_at         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT kb_companion_practice_status_chk CHECK (status IN ('GENERATING', 'READY', 'FAILED')),
    CONSTRAINT kb_companion_practice_uq UNIQUE (institute_id, knowledge_base_id, node_id, language)
);

-- ── Per-learner progress: what "continue where you left off" reads ──────────
CREATE TABLE IF NOT EXISTS public.kb_companion_progress (
    id                varchar(255) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    companion_id      varchar(255) NOT NULL REFERENCES public.kb_companion (id) ON DELETE CASCADE,
    institute_id      varchar(255) NOT NULL,
    user_id           varchar(255) NOT NULL,
    node_id           varchar(255) NOT NULL,
    -- NOT_STARTED is implied by the absence of a row.
    status            varchar(20) NOT NULL DEFAULT 'IN_PROGRESS',
    card_index        int4 NOT NULL DEFAULT 0,
    cards_total       int4 NOT NULL DEFAULT 0,
    max_card_seen     int4 NOT NULL DEFAULT 0,
    checks_correct    int4 NOT NULL DEFAULT 0,
    checks_total      int4 NOT NULL DEFAULT 0,
    -- Lesson check cards already scored, so answering one again (a revisit)
    -- never counts twice towards mastery.
    answered_card_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    -- Latest practice attempt (replaced, not summed).
    practice_correct  int4 NOT NULL DEFAULT 0,
    practice_total    int4 NOT NULL DEFAULT 0,
    mastery           int4 NOT NULL DEFAULT 0,
    started_at        timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_activity_at  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at      timestamp NULL,
    CONSTRAINT kb_companion_progress_status_chk CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
    CONSTRAINT kb_companion_progress_uq UNIQUE (companion_id, user_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_kb_companion_progress_user
    ON public.kb_companion_progress (companion_id, user_id, last_activity_at DESC);

-- ── Ask thread (persists across visits) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kb_companion_message (
    id            bigserial PRIMARY KEY,
    companion_id  varchar(255) NOT NULL REFERENCES public.kb_companion (id) ON DELETE CASCADE,
    institute_id  varchar(255) NOT NULL,
    user_id       varchar(255) NOT NULL,
    role          varchar(20) NOT NULL,
    content       text NOT NULL,
    meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT kb_companion_message_role_chk CHECK (role IN ('user', 'assistant'))
);

CREATE INDEX IF NOT EXISTS idx_kb_companion_message_thread
    ON public.kb_companion_message (companion_id, user_id, id DESC);

-- ── Pricing ──────────────────────────────────────────────────────────────────
-- Rates ALSO live in ai_service/app/services/tool_cost_estimator.py and
-- computeToolCredits in frontend-admin-dashboard/src/services/ai-credits/get-ai-credits.ts.
-- request_type 'knowledge_base' is already allowed by the ai_token_usage CHECK
-- (V435), so no constraint change is needed here.
INSERT INTO public.ai_tool_pricing (tool_key, request_type, flat_base_credits, per_unit_credits, unit_field, params_json)
VALUES
    -- One compiled visual lesson for one topic, shared by every learner of the
    -- institute. Plan + ~7 card renders on glm-5.3-flash.
    ('kb_companion_lesson',   'knowledge_base', 5, 0, 'flat', '{}'::jsonb),
    -- One 8-question practice set for one topic, shared.
    ('kb_companion_practice', 'knowledge_base', 2, 0, 'flat', '{}'::jsonb),
    -- One grounded answer to a learner's question. Unanswerable ones are free.
    ('kb_companion_ask',      'knowledge_base', 1, 0, 'flat', '{}'::jsonb),
    -- One narration synthesised (cache miss only; audio is shared).
    ('kb_companion_speech',   'knowledge_base', 1, 0, 'flat', '{}'::jsonb)
ON CONFLICT (tool_key) DO NOTHING;
