-- ============================================================================
-- V586: AI usage metering (write-only backbone for per-user / per-role history)
--
-- Everything here is additive and inert for existing behaviour:
--   * four NEW tables: ai_use_case_catalog, ai_role_class_map, ai_usage_event,
--     ai_model_alias. ai_service writes ai_usage_event next to (never instead of)
--     the credit_transactions ledger row; a failed event write never fails a
--     charge (SAVEPOINT in ai_service). ai_service tolerates these tables being
--     absent (metering silently off), so deploy order does not matter.
--   * NULLABLE columns on credit_transactions (usage_event_id, use_case) and
--     ai_token_usage (usage_event_id, router, gateway_key_id, cache/reasoning
--     token counts). No defaults, so the ALTERs are catalog-only (no rewrite);
--     existing readers never select them.
--   * NO CHECK constraints on the new enum-like columns (validated in code), and
--     the existing CHECK constraints on ai_token_usage are NOT touched.
--
-- Vocabularies (validated in ai_service, documented here):
--   billing_mode     CHARGED | INCLUDED | ALLOWANCE | SPLIT | FREE | BYO_KEY
--   charge_status    POSTED | DROPPED_INSUFFICIENT | SKIPPED_NO_INSTITUTE | NOT_APPLICABLE
--                    | REFUNDED | PARTIAL_REFUND
--   free_reason      BUNDLED | POLICY_FREE | UNBILLED_GAP | NO_INSTITUTE | INTERNAL_TEST
--   limit_decision   NONE | OK | WARN | WOULD_BLOCK | OVERRUN | BLOCKED_SKIPPED
--   actor_kind       USER | SYSTEM | API_KEY | PUBLIC | UNKNOWN (catalog hint also ON_BEHALF)
--   role class       ADMIN | TEACHER | STAFF | PARENT | LEARNER | SYSTEM | API_KEY | PUBLIC | UNKNOWN
--                    (ledger user_role STUDENT = LEARNER)
--   role_source      JWT | CALLER | AUTH_LOOKUP | CATALOG_DEFAULT | UNRESOLVED | BACKFILL
--   use_case_source  EXPLICIT | TOOL_KEY | REQUEST_TYPE | BACKFILL | UNKNOWN
--   surface          ADMIN_APP | LEARNER_APP | PUBLIC | PARTNER_API | WHATSAPP | PHONE
--                    | SCHEDULED | INTERNAL | UNKNOWN
--   cost_source      VENDOR_REPORTED | REGISTRY | RATE_CARD | ESTIMATE | UNKNOWN
--
-- credit_transactions and ai_token_usage are busy: never queue behind a long
-- transaction holding them (and block every charge behind us meanwhile). Their
-- ALTERs are the LAST statements, under a 2 s lock_timeout; if a lock is not free
-- in time the migration fails cleanly and the next deploy retries; the old pods
-- keep serving (same pattern as V577). Nothing before them takes a contended lock.
-- ============================================================================
SET LOCAL lock_timeout = '10s';

-- ── Use-case catalog: the single metering / billing vocabulary ─────────────
-- legacy_request_types / tool_keys: how an event that names no use_case is mapped
-- (explicit active use_case > tool_key > request_type > 'unknown'). In this seed each
-- request_type and each tool_key belongs to exactly ONE row, so the mapping never
-- depends on display_order.
-- label_template placeholders: {label} {actor_name} {actor_role_label} {subject_name}
-- {minutes} and any event context key ({video_title} {course_name} {agent_name}
-- {flow_name} {assessment_name}); {a|b} = first non-empty. Missing names are dropped.
CREATE TABLE IF NOT EXISTS ai_use_case_catalog (
    use_case               VARCHAR(64) PRIMARY KEY,
    feature_group          VARCHAR(48) NOT NULL,   -- tutor|video|calling|content|assessment|analytics|kb|crm|engagement|agent|media|platform
    label                  VARCHAR(128) NOT NULL,
    label_template         VARCHAR(255),
    count_unit_label       VARCHAR(32) DEFAULT 'requests',
    model_use_case         VARCHAR(64),            -- ai_model_defaults.use_case this feature selects a model with
    legacy_request_types   TEXT[] NOT NULL DEFAULT '{}',
    tool_keys              TEXT[] NOT NULL DEFAULT '{}',
    capability_key         VARCHAR(64),            -- capabilities/catalog.json key, when one fits
    default_surface        VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
    actor_kind             VARCHAR(16) NOT NULL DEFAULT 'USER',      -- USER | SYSTEM | ON_BEHALF
    unit_kind              VARCHAR(16) NOT NULL DEFAULT 'TOKENS',    -- TOKENS|IMAGES|SECONDS|MINUTES|CHARS|REQUESTS|MIXED
    billing_policy         VARCHAR(16) NOT NULL DEFAULT 'AS_TODAY',  -- AS_TODAY | CHARGE | FREE
    plan_eligible          BOOLEAN NOT NULL DEFAULT TRUE,
    limit_eligible         BOOLEAN NOT NULL DEFAULT TRUE,
    reserve_on_authorize   BOOLEAN NOT NULL DEFAULT FALSE,
    typical_credits        NUMERIC(12,4),
    intentionally_separate BOOLEAN NOT NULL DEFAULT FALSE,
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    display_order          INT NOT NULL DEFAULT 100,
    updated_by             VARCHAR(255),
    created_at             TIMESTAMPTZ DEFAULT now(),
    updated_at             TIMESTAMPTZ DEFAULT now()
);

-- ── Role name -> role class (fixed at write time) ─────────────────────────
-- role_name is normalised exactly like core/security.py jwt_institute_roles:
-- trim, UPPER, '-' and ' ' -> '_'. Lowest precedence number wins for a user with
-- several roles. A role missing from this table is treated as STAFF / 35.
CREATE TABLE IF NOT EXISTS ai_role_class_map (
    role_name   VARCHAR(64) PRIMARY KEY,
    role_class  VARCHAR(16) NOT NULL,   -- ADMIN|TEACHER|STAFF|PARENT|LEARNER
    precedence  INT NOT NULL,           -- ADMIN 10 > TEACHER 20 > STAFF 30 > PARENT 40 > LEARNER 50
    updated_by  VARCHAR(255),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── One row per billable AI operation ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_usage_event (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- callers MAY supply it
    occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    institute_id         VARCHAR(64),             -- NULL only with free_reason = NO_INSTITUTE
    -- who
    actor_kind           VARCHAR(16) NOT NULL,
    actor_user_id        VARCHAR(255),            -- varchar on purpose (demo-*, apikey:*, scripts)
    actor_role_class     VARCHAR(16),
    actor_roles_raw      TEXT[],
    role_source          VARCHAR(16) NOT NULL DEFAULT 'UNRESOLVED',
    actor_display_name   VARCHAR(255),
    subject_user_id      VARCHAR(255),
    subject_display_name VARCHAR(255),
    -- what
    use_case             VARCHAR(64) NOT NULL,
    use_case_source      VARCHAR(16) NOT NULL,
    feature_group        VARCHAR(48) NOT NULL,
    request_type         VARCHAR(50),
    tool_key             VARCHAR(64),
    surface              VARCHAR(24) NOT NULL,
    source_service       VARCHAR(24) NOT NULL,    -- ai_service|admin_core|assessment|community|notification|voice_bot
    context              JSONB,
    -- how it ran
    model_id             VARCHAR(255),            -- canonical registry id (alias-normalised)
    model_wire_id        VARCHAR(255),
    provider             VARCHAR(32),
    router               VARCHAR(32),
    gateway_key_id       VARCHAR(64),             -- llm_provider_keys.id
    byo_key              BOOLEAN NOT NULL DEFAULT FALSE,
    -- units
    prompt_tokens        BIGINT DEFAULT 0,
    cached_read_tokens   BIGINT DEFAULT 0,
    cache_write_tokens   BIGINT DEFAULT 0,
    completion_tokens    BIGINT DEFAULT 0,
    reasoning_tokens     BIGINT DEFAULT 0,
    image_tokens         BIGINT DEFAULT 0,
    image_count          INT DEFAULT 0,
    seconds              NUMERIC(12,3) DEFAULT 0,
    minutes              NUMERIC(12,3) DEFAULT 0,
    characters           INT DEFAULT 0,
    request_count        INT NOT NULL DEFAULT 1,
    -- money
    real_cost_usd        NUMERIC(14,8),
    cost_source          VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN',
    price_snapshot       JSONB,
    list_credits         NUMERIC(14,4) NOT NULL DEFAULT 0,   -- what CHARGED would debit (today's calculation)
    credits_charged      NUMERIC(14,4) NOT NULL DEFAULT 0,   -- = -credit_transactions.amount
    refunded_credits     NUMERIC(14,4) NOT NULL DEFAULT 0,
    billing_mode         VARCHAR(20) NOT NULL,
    shadow_billing_mode  VARCHAR(20),
    charge_status        VARCHAR(24) NOT NULL,
    free_reason          VARCHAR(24),
    subscription_id      UUID,                    -- NULL until AI plans exist
    plan_id              UUID,
    plan_item_id         UUID,
    limit_decision       VARCHAR(16) NOT NULL DEFAULT 'NONE',
    reservation_id       UUID,
    -- links
    ledger_tx_id         UUID,                    -- credit_transactions.id
    parent_event_id      UUID,
    batch_id             VARCHAR(255),            -- same value as the ledger batch_id
    idempotency_key      VARCHAR(255),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_usage_event_idem ON ai_usage_event (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_aue_inst_time      ON ai_usage_event (institute_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_aue_inst_user_time ON ai_usage_event (institute_id, actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_aue_inst_subj_time ON ai_usage_event (institute_id, subject_user_id, occurred_at DESC) WHERE subject_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_aue_inst_uc_time   ON ai_usage_event (institute_id, use_case, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_aue_inst_role_time ON ai_usage_event (institute_id, actor_role_class, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_aue_ledger         ON ai_usage_event (ledger_tx_id) WHERE ledger_tx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_aue_batch          ON ai_usage_event (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_aue_parent         ON ai_usage_event (parent_event_id) WHERE parent_event_id IS NOT NULL;
-- cross-institute time scans (super-admin coverage / parity) and the nightly role backfill
CREATE INDEX IF NOT EXISTS ix_aue_time           ON ai_usage_event (occurred_at);
CREATE INDEX IF NOT EXISTS ix_aue_unresolved     ON ai_usage_event (occurred_at) WHERE role_source = 'UNRESOLVED' AND actor_user_id IS NOT NULL;

-- ── Model id aliases (bare / legacy model labels -> registry id) ───────────
CREATE TABLE IF NOT EXISTS ai_model_alias (
    alias     VARCHAR(255) PRIMARY KEY,
    model_id  VARCHAR(255) NOT NULL,
    note      TEXT
);

-- ── Seed: use-case catalog ────────────────────────────────────────────────
-- Covers every request_type in the prod ledger (all time, checked 2026-10-15), every
-- RequestType enum value (Python + Java), every ai_tool_pricing.tool_key (prod + code
-- defaults in services/tool_cost_estimator.py) and every billed model use case in
-- ai_service/app/constants/model_use_cases.py (CI: tests/test_metering_catalog_coverage.py).
-- Every row starts billing_policy = AS_TODAY: nothing about pricing changes.
INSERT INTO ai_use_case_catalog
    (use_case, feature_group, label, label_template, count_unit_label, model_use_case,
     legacy_request_types, tool_keys, capability_key, default_surface, actor_kind, unit_kind,
     plan_eligible, limit_eligible, reserve_on_authorize, intentionally_separate, display_order, updated_by)
VALUES
    ('ai_calling', 'calling', 'AI calling minutes', 'AI calling — {minutes} min · {agent_name}', 'minutes', NULL,
     '{ai_call_out,ai_call_in}', '{}', 'crm.ai_calling', 'PHONE', 'SYSTEM', 'MINUTES',
     FALSE, TRUE, FALSE, FALSE, 10, 'V586'),
    ('telephony', 'calling', 'Phone call minutes', 'Phone call — {minutes} min · {agent_name}', 'minutes', NULL,
     '{voice_call_out,voice_call_in}', '{}', 'crm.calling', 'PHONE', 'SYSTEM', 'MINUTES',
     FALSE, TRUE, FALSE, FALSE, 12, 'V586'),
    ('agent_assist', 'calling', 'AI calling-agent prompt assistant', NULL, 'requests', 'agent_assist',
     '{}', '{agent_assist}', 'crm.ai_calling', 'ADMIN_APP', 'USER', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 14, 'V586'),
    ('voice_bot_llm', 'calling', 'Voice-bot LLM (internal)', NULL, 'requests', NULL,
     '{}', '{}', NULL, 'PHONE', 'SYSTEM', 'TOKENS',
     FALSE, FALSE, FALSE, TRUE, 16, 'V586'),
    ('call_intelligence', 'crm', 'Call analysis', NULL, 'minutes', 'call_intelligence',
     '{call_intelligence}', '{}', NULL, 'INTERNAL', 'SYSTEM', 'MINUTES',
     TRUE, TRUE, FALSE, FALSE, 20, 'V586'),
    ('learner_analytics', 'analytics', 'Learner insights', 'Learner insights — {subject_name}', 'requests', 'analytics',
     '{analytics}', '{}', NULL, 'SCHEDULED', 'ON_BEHALF', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 30, 'V586'),
    ('student_report', 'analytics', 'Student report', 'Student report — {subject_name}', 'reports', 'student_report',
     '{}', '{}', NULL, 'ADMIN_APP', 'ON_BEHALF', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 32, 'V586'),
    ('report_narrative', 'analytics', 'Scheduled report AI summary', NULL, 'reports', 'analytics',
     '{report}', '{}', NULL, 'SCHEDULED', 'SYSTEM', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 34, 'V586'),
    ('class_report', 'analytics', 'Class AI report', NULL, 'reports', 'class_report',
     '{}', '{assessment_class_ai_report}', NULL, 'ADMIN_APP', 'USER', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 36, 'V586'),
    ('lesson_video', 'video', 'Lesson video', 'Lesson video — {video_title|course_name}', 'videos', 'video',
     '{video}', '{}', NULL, 'ADMIN_APP', 'USER', 'MIXED',
     TRUE, TRUE, TRUE, FALSE, 40, 'V586'),
    ('ai_video_clip', 'video', 'AI video clips', NULL, 'clips', NULL,
     '{ai_video}', '{}', NULL, 'ADMIN_APP', 'USER', 'SECONDS',
     FALSE, TRUE, TRUE, FALSE, 42, 'V586'),
    ('avatar_video', 'video', 'Avatar / AI teacher video', NULL, 'seconds', NULL,
     '{avatar_video}', '{}', NULL, 'ADMIN_APP', 'USER', 'SECONDS',
     FALSE, TRUE, TRUE, FALSE, 44, 'V586'),
    ('video_regenerate', 'video', 'Video shot regenerate', NULL, 'requests', 'video_regenerate',
     '{}', '{}', NULL, 'ADMIN_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 46, 'V586'),
    ('reels', 'video', 'Reels', NULL, 'reels', 'reels_selection',
     '{reels_preview}', '{}', NULL, 'ADMIN_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 48, 'V586'),
    ('studio_plan', 'video', 'Studio plan', NULL, 'requests', 'studio_plan',
     '{}', '{}', NULL, 'ADMIN_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 50, 'V586'),
    ('web_search', 'video', 'Web search', NULL, 'requests', NULL,
     '{}', '{}', NULL, 'INTERNAL', 'SYSTEM', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 52, 'V586'),
    ('tutor_live', 'tutor', 'AI tutor session (minutes)', '{label} · {minutes} min — {actor_name}', 'minutes', NULL,
     '{}', '{tutor_live_minute,tutor_avatar_minute}', NULL, 'LEARNER_APP', 'USER', 'MINUTES',
     TRUE, TRUE, FALSE, FALSE, 60, 'V586'),
    ('tutor_chat', 'tutor', 'AI tutor chat', '{label} — {actor_role_label} {actor_name}', 'messages', NULL,
     '{conversation}', '{}', NULL, 'LEARNER_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 62, 'V586'),
    ('tutor_setup', 'tutor', 'AI tutor setup (slides, media, voice, avatar)', NULL, 'requests', NULL,
     '{}', '{tutor_compile_slide,tutor_media_image,tutor_voice_prepare,tutor_voice_clone,tutor_avatar_create}', NULL, 'ADMIN_APP', 'USER', 'MIXED',
     TRUE, TRUE, FALSE, FALSE, 64, 'V586'),
    ('chat_with_pdf', 'tutor', 'Chat with PDF', NULL, 'messages', 'chat',
     '{}', '{}', NULL, 'LEARNER_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 66, 'V586'),
    ('kb_companion', 'tutor', 'KB Companions', NULL, 'requests', 'kb_companion',
     '{}', '{kb_companion_lesson,kb_companion_practice,kb_companion_ask,kb_companion_speech}', NULL, 'LEARNER_APP', 'USER', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 68, 'V586'),
    ('learner_assistant', 'agent', 'Learner assistant', NULL, 'messages', NULL,
     '{agent}', '{}', NULL, 'LEARNER_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 70, 'V586'),
    ('vacademy_assistant', 'agent', 'Vacademy Assistant', NULL, 'messages', 'assistant',
     '{}', '{}', NULL, 'ADMIN_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 72, 'V586'),
    ('admin_agent', 'agent', 'Admin AI agent', NULL, 'messages', 'admin_agent',
     '{}', '{}', NULL, 'ADMIN_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 74, 'V586'),
    ('copilot', 'agent', 'Instructor copilot', NULL, 'requests', 'copilot',
     '{copilot}', '{}', 'ai.instructor_copilot', 'ADMIN_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 76, 'V586'),
    ('workflow_draft', 'agent', 'Workflow builder AI draft', NULL, 'requests', 'workflow_draft',
     '{}', '{}', NULL, 'ADMIN_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 78, 'V586'),
    ('parent_assistant', 'agent', 'Parent portal assistant', NULL, 'messages', 'parent_assistant',
     '{}', '{}', NULL, 'LEARNER_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 80, 'V586'),
    ('content', 'content', 'Course content', NULL, 'slides', 'content',
     '{content,course_content}', '{course_slide_document,course_slide_assessment,course_slide_video}', 'ai.course_creator', 'ADMIN_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 100, 'V586'),
    ('course_outline', 'content', 'Course outline', NULL, 'outlines', 'outline',
     '{outline}', '{course_outline}', 'ai.course_creator', 'ADMIN_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 102, 'V586'),
    ('course_assist', 'content', 'Course copy assist', NULL, 'requests', 'course_assist',
     '{}', '{course_assist_text}', 'ai.course_creator', 'ADMIN_APP', 'USER', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 104, 'V586'),
    ('html_document', 'content', 'AI HTML documents', NULL, 'documents', 'html_document',
     '{}', '{html_document,html_document_edit,html_document_pdf}', NULL, 'ADMIN_APP', 'USER', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 106, 'V586'),
    ('page_builder', 'content', 'Website / page builder', NULL, 'requests', 'page_builder',
     '{}', '{page_generate,page_edit,page_intake,page_brand_kit}', NULL, 'ADMIN_APP', 'USER', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 108, 'V586'),
    ('transcript_notes', 'content', 'Lecture notes', NULL, 'notes', 'transcript_notes',
     '{notes}', '{notes}', NULL, 'ADMIN_APP', 'USER', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 110, 'V586'),
    ('lecture', 'content', 'Lecture planner', NULL, 'requests', 'lecture',
     '{lecture}', '{lecture}', NULL, 'ADMIN_APP', 'USER', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 112, 'V586'),
    ('presentation', 'content', 'Presentation', NULL, 'decks', 'presentation',
     '{presentation}', '{}', NULL, 'ADMIN_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 114, 'V586'),
    ('translation', 'content', 'Translation', NULL, 'requests', 'translation',
     '{translation}', '{translate_course,translate_strings,translate_rich_text,translate_question,page_translate,dub_video}', NULL, 'ADMIN_APP', 'USER', 'MIXED',
     TRUE, TRUE, FALSE, FALSE, 116, 'V586'),
    ('live_session_summary', 'content', 'Live class summary', NULL, 'summaries', 'live_session_summary',
     '{}', '{}', NULL, 'INTERNAL', 'SYSTEM', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 118, 'V586'),
    ('incident', 'content', 'Incident reports', NULL, 'reports', 'incident',
     '{incident}', '{}', NULL, 'ADMIN_APP', 'USER', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 120, 'V586'),
    ('content_image', 'content', 'Course illustrations', NULL, 'images', 'image',
     '{image}', '{}', 'ai.course_creator', 'ADMIN_APP', 'USER', 'IMAGES',
     TRUE, TRUE, FALSE, FALSE, 130, 'V586'),
    ('document_image', 'content', 'Document illustrations', NULL, 'images', 'document_image',
     '{}', '{html_document_image}', NULL, 'ADMIN_APP', 'USER', 'IMAGES',
     TRUE, TRUE, FALSE, FALSE, 132, 'V586'),
    ('page_builder_image', 'content', 'Page builder images', NULL, 'images', 'page_builder_image',
     '{}', '{}', NULL, 'ADMIN_APP', 'USER', 'IMAGES',
     TRUE, TRUE, FALSE, FALSE, 134, 'V586'),
    ('course_assist_image', 'content', 'Course image assist', NULL, 'images', 'course_assist_image',
     '{}', '{course_assist_image}', 'ai.course_creator', 'ADMIN_APP', 'USER', 'IMAGES',
     TRUE, TRUE, FALSE, FALSE, 136, 'V586'),
    ('assessment_generation', 'assessment', 'AI assessment generation', NULL, 'questions', 'agent',
     '{assessment}', '{assessment}', NULL, 'ADMIN_APP', 'USER', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 140, 'V586'),
    ('questions', 'assessment', 'Question generation', NULL, 'question sets', 'questions',
     '{pdf_questions,coding_question,question_metadata}', '{extract_questions,extract_questions_ocr,coding_question,paper_digitise}', NULL, 'ADMIN_APP', 'USER', 'MIXED',
     TRUE, TRUE, FALSE, FALSE, 142, 'V586'),
    ('kb_question_paper', 'assessment', 'Question paper from knowledge base', NULL, 'papers', 'knowledge_base_qa',
     '{}', '{kb_paper_blueprint,kb_paper_questions,kb_paper_regenerate}', 'ai.knowledge_base', 'ADMIN_APP', 'USER', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 144, 'V586'),
    ('evaluation', 'assessment', 'AI evaluation / copy check', 'AI evaluation — {assessment_name} · {subject_name}', 'answer sheets', 'evaluation',
     '{evaluation}', '{copy_check_evaluation,copy_check_evaluation_api}', NULL, 'ADMIN_APP', 'USER', 'MIXED',
     TRUE, TRUE, FALSE, FALSE, 146, 'V586'),
    ('quiz_image', 'assessment', 'Assessment question images', NULL, 'images', 'quiz_image',
     '{}', '{}', NULL, 'ADMIN_APP', 'USER', 'IMAGES',
     TRUE, TRUE, FALSE, FALSE, 148, 'V586'),
    ('knowledge_base', 'kb', 'Knowledge base', NULL, 'requests', 'knowledge_base_qa',
     '{knowledge_base}', '{kb_ingest_page,kb_ingest_url,kb_ask,kb_library_unlock}', 'ai.knowledge_base', 'ADMIN_APP', 'USER', 'MIXED',
     TRUE, TRUE, FALSE, FALSE, 160, 'V586'),
    ('embedding', 'kb', 'Embeddings', NULL, 'requests', 'embedding',
     '{embedding}', '{}', NULL, 'INTERNAL', 'SYSTEM', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 162, 'V586'),
    ('chatbot_flow', 'engagement', 'WhatsApp AI reply', 'WhatsApp AI reply — {flow_name}', 'replies', 'chatbot_flow',
     '{chatbot}', '{}', NULL, 'WHATSAPP', 'SYSTEM', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 170, 'V586'),
    ('engagement', 'engagement', 'Engagement brain (reply drafts, advisor)', NULL, 'requests', 'engagement',
     '{}', '{}', NULL, 'INTERNAL', 'SYSTEM', 'TOKENS',
     TRUE, TRUE, FALSE, FALSE, 171, 'V586'),
    ('engagement_message', 'engagement', 'Engagement message', NULL, 'messages', 'engagement',
     '{engagement_message}', '{}', NULL, 'SCHEDULED', 'SYSTEM', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 172, 'V586'),
    ('engagement_plan', 'engagement', 'Engagement plans', NULL, 'plans', 'engagement_plan',
     '{}', '{engagement_plan,engagement_item}', NULL, 'ADMIN_APP', 'USER', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 174, 'V586'),
    ('tts', 'media', 'Text to speech', NULL, 'requests', 'tts',
     '{tts,tts_premium}', '{}', NULL, 'ADMIN_APP', 'USER', 'CHARS',
     TRUE, TRUE, FALSE, FALSE, 180, 'V586'),
    ('stock_media', 'media', 'Stock media', NULL, 'requests', NULL,
     '{stock}', '{}', NULL, 'ADMIN_APP', 'USER', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 182, 'V586'),
    ('transcription', 'media', 'Recording transcription', NULL, 'minutes', NULL,
     '{transcription}', '{transcription}', NULL, 'INTERNAL', 'USER', 'MINUTES',
     FALSE, TRUE, FALSE, FALSE, 184, 'V586'),
    ('unknown', 'platform', 'Other AI usage', NULL, 'requests', NULL,
     '{}', '{}', NULL, 'UNKNOWN', 'USER', 'MIXED',
     FALSE, TRUE, FALSE, FALSE, 999, 'V586')
ON CONFLICT (use_case) DO NOTHING;

-- ── Seed: role classes ───────────────────────────────────────────────────
-- d_credits seed plus every generic role name found on prod auth_service.roles
-- (2026-10-15). Unknown custom roles fall back to STAFF / 35 in code.
INSERT INTO ai_role_class_map (role_name, role_class, precedence, updated_by)
VALUES
    ('ADMIN', 'ADMIN', 10, 'V586'),
    ('OWNER', 'ADMIN', 10, 'V586'),
    ('ROOT_ADMIN', 'ADMIN', 10, 'V586'),
    ('SUPERADMIN', 'ADMIN', 10, 'V586'),
    ('SUPER_ADMIN', 'ADMIN', 10, 'V586'),
    ('CENTRE_ADMIN', 'ADMIN', 12, 'V586'),
    ('LMS_ADMIN', 'ADMIN', 12, 'V586'),
    ('SCHOOL_ADMIN', 'ADMIN', 12, 'V586'),
    ('SCHOOL_PRINCIPAL', 'ADMIN', 12, 'V586'),
    ('AIQUESTIONCREATOR', 'TEACHER', 20, 'V586'),
    ('ASSESSMENT_CREATOR', 'TEACHER', 20, 'V586'),
    ('CONTENT_CREATOR', 'TEACHER', 20, 'V586'),
    ('COURSE_CREATOR', 'TEACHER', 20, 'V586'),
    ('CUSTOM_CREATOR', 'TEACHER', 20, 'V586'),
    ('EVALUATOR', 'TEACHER', 20, 'V586'),
    ('MENTOR', 'TEACHER', 20, 'V586'),
    ('TEACHER', 'TEACHER', 20, 'V586'),
    ('ENGLISH_TEACHER', 'TEACHER', 22, 'V586'),
    ('ENGLISH_TEACHER1', 'TEACHER', 22, 'V586'),
    ('MATHS_TEACHER', 'TEACHER', 22, 'V586'),
    ('PLAYGROUP_TEACHER', 'TEACHER', 22, 'V586'),
    ('SCHOOL_ENGLISH_TEACHER', 'TEACHER', 22, 'V586'),
    ('SCHOOL_MATH', 'TEACHER', 22, 'V586'),
    ('SCIENCE_TEACHER', 'TEACHER', 22, 'V586'),
    ('CONTENT_REVIEWER', 'TEACHER', 24, 'V586'),
    ('AFFILIATE', 'STAFF', 30, 'V586'),
    ('CHANNEL_PARTNER', 'STAFF', 30, 'V586'),
    ('COORDINATOR', 'STAFF', 30, 'V586'),
    ('COUNSELLOR', 'STAFF', 30, 'V586'),
    ('CO_ORDINATOR', 'STAFF', 30, 'V586'),
    ('CRM', 'STAFF', 30, 'V586'),
    ('CRM_ACCESS', 'STAFF', 30, 'V586'),
    ('FRONT_DESK_EMPLOYEE', 'STAFF', 30, 'V586'),
    ('GUJARAT_SALES_TEAM', 'STAFF', 30, 'V586'),
    ('HR_ADMIN', 'STAFF', 30, 'V586'),
    ('HR_MANAGER', 'STAFF', 30, 'V586'),
    ('MANAGE_LEAD', 'STAFF', 30, 'V586'),
    ('MODERATOR', 'STAFF', 30, 'V586'),
    ('OPERATIONS', 'STAFF', 30, 'V586'),
    ('PARTNER_ADMIN', 'STAFF', 30, 'V586'),
    ('SALES_HEAD', 'STAFF', 30, 'V586'),
    ('SCHOOL_MANAGER', 'STAFF', 30, 'V586'),
    ('TEAM_LEAD', 'STAFF', 30, 'V586'),
    ('TEAM_PT', 'STAFF', 30, 'V586'),
    ('TPO_COLLEGE', 'STAFF', 30, 'V586'),
    ('UPSELLING', 'STAFF', 30, 'V586'),
    ('VLE', 'STAFF', 30, 'V586'),
    ('ASSISTANT', 'STAFF', 35, 'V586'),
    ('CUSTOMROLECPO', 'STAFF', 35, 'V586'),
    ('CUSTOM_DEV', 'STAFF', 35, 'V586'),
    ('C_P', 'STAFF', 35, 'V586'),
    ('DEV', 'STAFF', 35, 'V586'),
    ('GUEST', 'STAFF', 35, 'V586'),
    ('TEST_ROLE', 'STAFF', 35, 'V586'),
    ('USER', 'STAFF', 35, 'V586'),
    ('PARENT', 'PARENT', 40, 'V586'),
    ('LEARNER', 'LEARNER', 50, 'V586'),
    ('STUDENT', 'LEARNER', 50, 'V586')
ON CONFLICT (role_name) DO NOTHING;

-- ── Seed: model aliases (non-canonical labels seen on prod with a clear registry id) ──
-- Ambiguous labels ('image', 'system', 'tutor-live', 'smallest', ...) stay unmapped.
INSERT INTO ai_model_alias (alias, model_id, note)
VALUES
    ('glm-5.3-flash', 'z-ai/glm-5.3-flash', 'bare id written by the KB companion before kb_companion/llm.py was fixed'),
    ('gemini-2.5-flash', 'google/gemini-2.5-flash', 'bare Google id'),
    ('gemini-2.5-flash-image', 'google/gemini-2.5-flash-image', 'bare Google id'),
    ('anthropic/claude-opus-4-8', 'anthropic/claude-opus-4.8', 'Anthropic dashed version form')
ON CONFLICT (alias) DO NOTHING;

-- ── Additive, nullable links on the existing tables ───────────────────────
-- (plain ALTERs as in V323; both tables are owned by vacademy on prod)
-- LAST in this migration on purpose: each ALTER takes an ACCESS EXCLUSIVE lock
-- that is held until Flyway commits, and while an ALTER WAITS for it every later
-- read/write of that table (every charge, every usage record) queues behind it.
-- Taking them last keeps the hold to the two small partial-index builds; the 2 s
-- lock_timeout bounds the queue if a long transaction is touching the table (the
-- migration then fails cleanly and the next deploy retries).
SET LOCAL lock_timeout = '2s';
ALTER TABLE credit_transactions
    ADD COLUMN IF NOT EXISTS usage_event_id UUID,
    ADD COLUMN IF NOT EXISTS use_case       VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_usage_event ON credit_transactions (usage_event_id) WHERE usage_event_id IS NOT NULL;

ALTER TABLE ai_token_usage
    ADD COLUMN IF NOT EXISTS usage_event_id     UUID,
    ADD COLUMN IF NOT EXISTS router             VARCHAR(32),
    ADD COLUMN IF NOT EXISTS gateway_key_id     VARCHAR(64),
    ADD COLUMN IF NOT EXISTS cached_read_tokens INT,
    ADD COLUMN IF NOT EXISTS cache_write_tokens INT,
    ADD COLUMN IF NOT EXISTS reasoning_tokens   INT;
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_event ON ai_token_usage (usage_event_id) WHERE usage_event_id IS NOT NULL;
