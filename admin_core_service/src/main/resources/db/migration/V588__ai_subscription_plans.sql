-- ============================================================================
-- V588: AI subscription plans (catalogue, versions, items, subscriptions)
--
-- Everything here is additive and inert for existing behaviour:
--   * eight NEW tables: ai_billing_feature, ai_plan, ai_plan_version, ai_plan_item,
--     institute_ai_subscription, ai_subscription_period, ai_subscription_override,
--     ai_subscription_event.
--   * ONE nullable column on ai_use_case_catalog (billing_feature_key; small V586
--     table, no default, catalog-only ALTER), filled for every seeded use case.
--   * ONE seeded plan, "AI Pro", version 1 in status DRAFT. A DRAFT version cannot
--     be assigned to an institute, so the seed changes nothing.
--   * No subscription rows. ai_service decides "CHARGED exactly as today" whenever
--     setting billing.plans.enabled is false (the default) or the institute has no
--     TRIAL/ACTIVE/GRACE subscription (in-memory index, one bulk query <= 30 s).
--     ai_service tolerates these tables being absent (plans silently off).
--   * No ledger columns: plan outcomes live on ai_usage_event (billing_mode,
--     shadow_billing_mode, subscription_id, plan_id, plan_item_id; V586).
--     Fair-use counters live in ai_usage_counter (V587) with period 'PLAN_PERIOD',
--     window_start = the subscription period start, counter keys
--       'PLAN:<sub_id>|F:<feature>'           institute x feature
--       'PLAN:<sub_id>|F:<feature>|U:<uid>'   user (actor or subject) x feature
--       'PLAN:<sub_id>|ALL'                   plan-level internal_cost_cap_usd
--   * Like V586/V587, enum-like columns carry NO CHECK constraint (validated in
--     ai_service metering/plan_models.py); a PUBLISHED / RETIRED version and its
--     items are frozen by the triggers at the end of this file.
--
-- Vocabularies (validated in ai_service, documented here):
--   eligibility        INCLUDABLE | ALLOWANCE_ONLY | ALWAYS_CHARGED
--   version status     DRAFT | PUBLISHED | RETIRED
--   grace_behaviour    INCLUDED | CHARGED
--   item mode          INCLUDED | ALLOWANCE | CHARGED
--   model_policy       ANY | DEFAULT_CHAIN | ALLOWLIST | MAX_PRICE
--   on_model_violation CHARGE | BLOCK          over_cap_action  CHARGE | BLOCK
--   user_cap_basis     ACTOR | SUBJECT
--   roles_included     role classes (ADMIN|TEACHER|STAFF|PARENT|LEARNER|SYSTEM|API_KEY|PUBLIC); NULL = all
--   sub status         SCHEDULED | TRIAL | ACTIVE | GRACE | EXPIRED | CANCELLED
--   enforcement        SHADOW | LIVE           source  MANUAL | COMPLIMENTARY | PAYMENT
--   payment_status     DUE | PAID | COMPLIMENTARY | WAIVED
-- Audit: subscription writes -> ai_subscription_event; catalogue / plan writes ->
-- ai_model_change_log (V569).
-- ============================================================================
SET LOCAL lock_timeout = '10s';

-- ── Billing feature vocabulary (groups of ai_use_case_catalog rows) ────────
CREATE TABLE IF NOT EXISTS ai_billing_feature (
    feature_key    VARCHAR(48) PRIMARY KEY,
    label          VARCHAR(128) NOT NULL,
    description    TEXT,
    eligibility    VARCHAR(16) NOT NULL,            -- INCLUDABLE | ALLOWANCE_ONLY | ALWAYS_CHARGED
    locked         BOOLEAN NOT NULL DEFAULT FALSE,  -- eligibility editable only with an unlock reason
    display_order  INT NOT NULL DEFAULT 100,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by     VARCHAR(255),
    updated_at     TIMESTAMPTZ DEFAULT now()
);

-- ── Plans ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_plan (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_key     VARCHAR(48) NOT NULL UNIQUE,
    name         VARCHAR(128) NOT NULL,
    description  TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_by   VARCHAR(255),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Commercial terms. DRAFT is editable; PUBLISHED / RETIRED are frozen (trigger).
CREATE TABLE IF NOT EXISTS ai_plan_version (
    id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id                      UUID NOT NULL REFERENCES ai_plan(id),
    version_no                   INT NOT NULL,
    status                       VARCHAR(12) NOT NULL DEFAULT 'DRAFT',   -- DRAFT | PUBLISHED | RETIRED
    currency                     VARCHAR(3) NOT NULL DEFAULT 'INR',
    price_minor                  BIGINT NOT NULL DEFAULT 0,              -- paise per period, before GST
    is_tax_inclusive             BOOLEAN NOT NULL DEFAULT FALSE,
    sac_code                     VARCHAR(16) DEFAULT '998313',
    period_months                INT NOT NULL DEFAULT 1,
    allowance_credits            NUMERIC(14,4) NOT NULL DEFAULT 0,       -- per period, no rollover
    internal_cost_cap_usd        NUMERIC(14,4),                          -- internal; NULL = none; never shown to tenants
    grace_days                   INT NOT NULL DEFAULT 7,
    grace_behaviour              VARCHAR(10) NOT NULL DEFAULT 'CHARGED', -- INCLUDED | CHARGED
    supersedes_version_id        UUID,
    migrate_existing_at_renewal  BOOLEAN NOT NULL DEFAULT FALSE,
    published_at                 TIMESTAMPTZ,
    published_by                 VARCHAR(255),
    created_by                   VARCHAR(255),
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_id, version_no)
);

-- One row per (version, feature). No row = CHARGED.
CREATE TABLE IF NOT EXISTS ai_plan_item (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_version_id          UUID NOT NULL REFERENCES ai_plan_version(id),
    feature_key              VARCHAR(48) NOT NULL REFERENCES ai_billing_feature(feature_key),
    mode                     VARCHAR(10) NOT NULL,                        -- INCLUDED | ALLOWANCE | CHARGED
    model_policy             VARCHAR(14) NOT NULL DEFAULT 'DEFAULT_CHAIN',-- ANY | DEFAULT_CHAIN | ALLOWLIST | MAX_PRICE
    model_allowlist          TEXT[],
    max_output_price_per_1m  NUMERIC(12,6),
    on_model_violation       VARCHAR(8) NOT NULL DEFAULT 'CHARGE',        -- CHARGE | BLOCK
    roles_included           TEXT[],                                      -- role classes; NULL = all
    inst_units_cap           NUMERIC(14,4),
    inst_credits_cap         NUMERIC(14,4),
    inst_cost_usd_cap        NUMERIC(14,6),
    user_units_cap           NUMERIC(14,4),
    user_credits_cap         NUMERIC(14,4),
    user_cap_basis           VARCHAR(8) NOT NULL DEFAULT 'ACTOR',         -- ACTOR | SUBJECT
    over_cap_action          VARCHAR(8) NOT NULL DEFAULT 'CHARGE',        -- CHARGE | BLOCK
    display_cap_text         VARCHAR(255),
    UNIQUE (plan_version_id, feature_key)
);

-- ── Subscriptions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS institute_ai_subscription (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institute_id             VARCHAR(64) NOT NULL,
    plan_version_id          UUID NOT NULL REFERENCES ai_plan_version(id),
    status                   VARCHAR(12) NOT NULL,                  -- SCHEDULED|TRIAL|ACTIVE|GRACE|EXPIRED|CANCELLED
    enforcement              VARCHAR(8) NOT NULL DEFAULT 'SHADOW',  -- SHADOW | LIVE
    source                   VARCHAR(16) NOT NULL DEFAULT 'MANUAL', -- MANUAL | COMPLIMENTARY | PAYMENT
    anchor_at                TIMESTAMPTZ NOT NULL,
    start_at                 TIMESTAMPTZ NOT NULL,
    end_at                   TIMESTAMPTZ,
    period_months            INT NOT NULL DEFAULT 1,
    auto_renew               BOOLEAN NOT NULL DEFAULT TRUE,
    grace_days               INT NOT NULL DEFAULT 7,
    cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,
    pending_plan_version_id  UUID,
    price_override_minor     BIGINT,
    reason                   TEXT,
    created_by               VARCHAR(255) NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by               VARCHAR(255),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- at most one live subscription per institute
CREATE UNIQUE INDEX IF NOT EXISTS ux_ias_live ON institute_ai_subscription (institute_id)
    WHERE status IN ('TRIAL','ACTIVE','GRACE');
CREATE INDEX IF NOT EXISTS ix_ias_inst ON institute_ai_subscription (institute_id, created_at);

-- Billing / allowance periods (created lazily by ai_service or by the roll job).
CREATE TABLE IF NOT EXISTS ai_subscription_period (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id       UUID NOT NULL REFERENCES institute_ai_subscription(id),
    period_start          TIMESTAMPTZ NOT NULL,
    period_end            TIMESTAMPTZ NOT NULL,
    plan_version_id       UUID NOT NULL,
    price_minor_snapshot  BIGINT NOT NULL,
    allowance_credits     NUMERIC(14,4) NOT NULL DEFAULT 0,
    allowance_used        NUMERIC(14,4) NOT NULL DEFAULT 0,
    payment_status        VARCHAR(14) NOT NULL DEFAULT 'DUE',   -- DUE | PAID | COMPLIMENTARY | WAIVED
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (subscription_id, period_start),
    CONSTRAINT ck_asp_allowance_used_nonneg CHECK (allowance_used >= 0)
);

-- Per-subscription custom deal for one feature (NULL field = inherit the plan item).
CREATE TABLE IF NOT EXISTS ai_subscription_override (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id   UUID NOT NULL REFERENCES institute_ai_subscription(id),
    feature_key       VARCHAR(48) NOT NULL,
    mode              VARCHAR(10),                 -- INCLUDED | ALLOWANCE | CHARGED; NULL = inherit
    inst_units_cap    NUMERIC(14,4),
    inst_credits_cap  NUMERIC(14,4),
    inst_cost_usd_cap NUMERIC(14,6),
    user_units_cap    NUMERIC(14,4),
    user_credits_cap  NUMERIC(14,4),
    reason            TEXT NOT NULL,
    created_by        VARCHAR(255) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE
);
-- at most one active override per (subscription, feature): replacing = deactivate + insert
CREATE UNIQUE INDEX IF NOT EXISTS ux_aso_active ON ai_subscription_override (subscription_id, feature_key)
    WHERE is_active;

-- Audit trail of every subscription change.
CREATE TABLE IF NOT EXISTS ai_subscription_event (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id  UUID,
    institute_id     VARCHAR(64) NOT NULL,
    event_type       VARCHAR(32) NOT NULL,
    from_state       JSONB,
    to_state         JSONB,
    actor            VARCHAR(255),
    reason           TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ase_sub  ON ai_subscription_event (subscription_id, created_at);
CREATE INDEX IF NOT EXISTS ix_ase_inst ON ai_subscription_event (institute_id, created_at);

-- ── Freeze PUBLISHED / RETIRED versions and their items ───────────────────
-- ai_plan_version: a DRAFT row's terms may change freely; its status may only
-- stay DRAFT or move to PUBLISHED (never straight to RETIRED or an unknown value).
-- A PUBLISHED row may only move to RETIRED; a RETIRED row never changes; any
-- other column change (updated_at excepted) on a non-DRAFT row is refused.
-- Non-DRAFT rows cannot be deleted.
CREATE OR REPLACE FUNCTION fn_ai_plan_version_freeze() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'DRAFT' THEN
            RAISE EXCEPTION 'ai_plan_version % is % and cannot be deleted', OLD.id, OLD.status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.status = 'DRAFT' THEN
        IF NEW.status IS NULL OR NEW.status NOT IN ('DRAFT', 'PUBLISHED') THEN
            RAISE EXCEPTION 'ai_plan_version % cannot move from DRAFT to %', OLD.id, NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at') THEN
        RAISE EXCEPTION 'ai_plan_version % is %: its terms are frozen (create a new version)', OLD.id, OLD.status
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'PUBLISHED' AND NEW.status = 'RETIRED') THEN
        RAISE EXCEPTION 'ai_plan_version % cannot move from % to %', OLD.id, OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_plan_version_freeze ON ai_plan_version;
CREATE TRIGGER trg_ai_plan_version_freeze
    BEFORE UPDATE OR DELETE ON ai_plan_version
    FOR EACH ROW EXECUTE FUNCTION fn_ai_plan_version_freeze();

-- ai_plan_item: rows of a non-DRAFT version cannot be inserted, changed or deleted
-- (checked against both the old and the new parent version).
CREATE OR REPLACE FUNCTION fn_ai_plan_item_freeze() RETURNS trigger AS $$
DECLARE
    v_status VARCHAR(12);
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        SELECT status INTO v_status FROM ai_plan_version WHERE id = OLD.plan_version_id;
        IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
            RAISE EXCEPTION 'ai_plan_item %: version % is %, its items are frozen', OLD.id, OLD.plan_version_id, v_status
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT status INTO v_status FROM ai_plan_version WHERE id = NEW.plan_version_id;
        IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
            RAISE EXCEPTION 'ai_plan_item: version % is %, items cannot be added or moved into it', NEW.plan_version_id, v_status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_plan_item_freeze ON ai_plan_item;
CREATE TRIGGER trg_ai_plan_item_freeze
    BEFORE INSERT OR UPDATE OR DELETE ON ai_plan_item
    FOR EACH ROW EXECUTE FUNCTION fn_ai_plan_item_freeze();

-- ── Seed: billing features (d_plans §1.1) ─────────────────────────────────
INSERT INTO ai_billing_feature (feature_key, label, description, eligibility, locked, display_order, updated_by)
VALUES
    ('learner_assistant',    'AI learner assistant chat', 'Learner and parent portal assistant messages.', 'INCLUDABLE', FALSE, 10, 'V588'),
    ('admin_assistant',      'Vacademy Assistant', 'Admin-side assistant, admin agent and workflow drafts.', 'INCLUDABLE', FALSE, 12, 'V588'),
    ('tutor_chat',           'AI tutor (text)', 'AI tutor text turns and chat with PDF.', 'INCLUDABLE', FALSE, 20, 'V588'),
    ('tutor_live_minutes',   'Live AI tutor (voice)', 'Live voice tutor minutes.', 'ALLOWANCE_ONLY', FALSE, 22, 'V588'),
    ('tutor_avatar_minutes', 'Tutor avatar', 'Avatar tutor minutes.', 'ALLOWANCE_ONLY', FALSE, 24, 'V588'),
    ('question_generation',  'AI question / paper generation', 'Question, assessment and paper generation.', 'INCLUDABLE', FALSE, 30, 'V588'),
    ('copy_check',           'AI answer-sheet evaluation', 'AI evaluation of answer sheets (partner API excluded by role).', 'INCLUDABLE', FALSE, 32, 'V588'),
    ('kb_qa',                'Knowledge-base Q&A and companion', 'Knowledge-base questions and KB Companions.', 'INCLUDABLE', FALSE, 40, 'V588'),
    ('kb_ingest',            'Knowledge-base ingest and unlock', 'Knowledge-base ingest and library unlock.', 'ALLOWANCE_ONLY', FALSE, 42, 'V588'),
    ('content_generation',   'Course, slide, document and page generation', 'Course content, outlines, documents, pages, notes, lectures, presentations, translation.', 'INCLUDABLE', FALSE, 50, 'V588'),
    ('learner_analytics',    'Learner insights and reports', 'Learner insights, student, class and scheduled reports.', 'INCLUDABLE', FALSE, 60, 'V588'),
    ('chatbot_reply',        'WhatsApp chatbot AI replies', 'AI replies in WhatsApp chatbot flows.', 'INCLUDABLE', FALSE, 70, 'V588'),
    ('copilot',              'Instructor copilot', 'Instructor copilot requests.', 'INCLUDABLE', FALSE, 72, 'V588'),
    ('agent_assist',         'AI calling prompt assistant', 'Prompt assistant for AI calling agents.', 'INCLUDABLE', FALSE, 74, 'V588'),
    ('image_generation',     'AI images', 'Course, document, page, quiz and assist images.', 'ALLOWANCE_ONLY', FALSE, 80, 'V588'),
    ('premium_tts',          'Premium voices', 'Text to speech.', 'ALWAYS_CHARGED', FALSE, 82, 'V588'),
    ('video_lesson',         'AI video lessons', 'Lesson videos, regenerate, reels, studio plans, avatar video, stock media.', 'ALLOWANCE_ONLY', FALSE, 84, 'V588'),
    ('ai_video_clips',       'Generated video clips', 'Generated video clips.', 'ALLOWANCE_ONLY', FALSE, 86, 'V588'),
    ('ai_calling',           'AI phone calls', 'AI calling minutes and the voice-bot model.', 'ALWAYS_CHARGED', TRUE, 90, 'V588'),
    ('telephony',            'Call minutes', 'Phone call minutes.', 'ALWAYS_CHARGED', TRUE, 92, 'V588'),
    ('call_intelligence',    'Call transcription and analysis', 'Transcription and analysis of human calls.', 'ALLOWANCE_ONLY', FALSE, 94, 'V588'),
    ('engagement_messages',  'Engagement Engine messages', 'Engagement Engine messages and brain.', 'ALWAYS_CHARGED', FALSE, 96, 'V588'),
    ('transcription',        'Recording transcription', 'Recording transcription.', 'ALLOWANCE_ONLY', FALSE, 98, 'V588'),
    ('unmapped',             'Other AI usage', 'Anything not mapped to a billing feature.', 'ALWAYS_CHARGED', FALSE, 999, 'V588')
ON CONFLICT (feature_key) DO NOTHING;

-- ── Seed: AI Pro, version 1, DRAFT (d_plans §4.2 / §4.4). DRAFT = inert. ──
-- ₹5,000 + GST per month; 2,000 allowance credits; internal cost cap ₹1,200 at ₹86/$.
INSERT INTO ai_plan (plan_key, name, description, created_by)
VALUES ('ai_pro', 'AI Pro',
        'Everyday AI features included under fair use, plus a monthly credit allowance. AI calls and telephony are always charged.',
        'V588')
ON CONFLICT (plan_key) DO NOTHING;

INSERT INTO ai_plan_version (plan_id, version_no, status, currency, price_minor, is_tax_inclusive, sac_code,
                             period_months, allowance_credits, internal_cost_cap_usd, grace_days, grace_behaviour,
                             created_by)
SELECT p.id, 1, 'DRAFT', 'INR', 500000, FALSE, '998313', 1, 2000, 13.95, 7, 'CHARGED', 'V588'
FROM ai_plan p
WHERE p.plan_key = 'ai_pro'
ON CONFLICT (plan_id, version_no) DO NOTHING;

-- Items are seeded only into a still-DRAFT version 1 that has no items yet.
INSERT INTO ai_plan_item (plan_version_id, feature_key, mode, model_policy, roles_included,
                          inst_units_cap, inst_credits_cap, user_units_cap, user_credits_cap, user_cap_basis,
                          display_cap_text)
SELECT v.id, s.feature_key, s.mode, s.model_policy, s.roles_included::TEXT[],
       s.inst_units_cap, s.inst_credits_cap, s.user_units_cap, s.user_credits_cap, s.user_cap_basis,
       s.display_cap_text
FROM ai_plan_version v
JOIN ai_plan p ON p.id = v.plan_id AND p.plan_key = 'ai_pro'
CROSS JOIN (VALUES
    -- included under fair use (internal soft caps; over cap = charged from the wallet)
    ('learner_assistant',   'INCLUDED',  'DEFAULT_CHAIN', NULL,                      20000::NUMERIC, NULL::NUMERIC, 300::NUMERIC, NULL::NUMERIC, 'ACTOR',
     'Fair use: 300 messages per user per month'),
    ('admin_assistant',     'INCLUDED',  'DEFAULT_CHAIN', NULL,                      1000, NULL, 200, NULL, 'ACTOR',
     'Fair use: 200 messages per user per month'),
    ('tutor_chat',          'INCLUDED',  'DEFAULT_CHAIN', '{LEARNER}',               NULL, NULL, 300, NULL, 'ACTOR',
     'Learners only. Fair use: 300 turns per learner per month'),
    ('question_generation', 'INCLUDED',  'DEFAULT_CHAIN', NULL,                      300, NULL, 100, NULL, 'ACTOR',
     'Fair use: 300 generations per month, 100 per user'),
    ('copy_check',          'INCLUDED',  'DEFAULT_CHAIN', '{ADMIN,TEACHER,STAFF}',   NULL, 1000, NULL, NULL, 'ACTOR',
     'Default model only. Fair use: about 110 answer sheets per month'),
    ('kb_qa',               'INCLUDED',  'DEFAULT_CHAIN', NULL,                      5000, 1000, NULL, NULL, 'ACTOR',
     'Fair use: 5,000 questions per month'),
    ('content_generation',  'INCLUDED',  'DEFAULT_CHAIN', NULL,                      NULL, 600, NULL, 300, 'ACTOR',
     'Default model only. Fair use: 600 credits of generation per month'),
    ('learner_analytics',   'INCLUDED',  'DEFAULT_CHAIN', NULL,                      NULL, 1500, NULL, 3, 'SUBJECT',
     'Fair use: 3 credits of insights per learner per month'),
    ('chatbot_reply',       'INCLUDED',  'DEFAULT_CHAIN', NULL,                      3000, NULL, NULL, NULL, 'ACTOR',
     'Fair use: 3,000 replies per month'),
    ('copilot',             'INCLUDED',  'DEFAULT_CHAIN', NULL,                      200, NULL, NULL, NULL, 'ACTOR',
     'Fair use: 200 requests per month'),
    ('agent_assist',        'INCLUDED',  'DEFAULT_CHAIN', NULL,                      200, NULL, NULL, NULL, 'ACTOR',
     'Fair use: 200 requests per month'),
    -- paid from the monthly allowance, then the wallet
    ('image_generation',     'ALLOWANCE', 'ANY', NULL, NULL, NULL, NULL, NULL, 'ACTOR', 'Uses the monthly allowance, then credits'),
    ('tutor_live_minutes',   'ALLOWANCE', 'ANY', NULL, NULL, NULL, NULL, NULL, 'ACTOR', 'Uses the monthly allowance, then credits'),
    ('tutor_avatar_minutes', 'ALLOWANCE', 'ANY', NULL, NULL, NULL, NULL, NULL, 'ACTOR', 'Uses the monthly allowance, then credits'),
    ('kb_ingest',            'ALLOWANCE', 'ANY', NULL, NULL, NULL, NULL, NULL, 'ACTOR', 'Uses the monthly allowance, then credits'),
    ('transcription',        'ALLOWANCE', 'ANY', NULL, NULL, NULL, NULL, NULL, 'ACTOR', 'Uses the monthly allowance, then credits'),
    ('call_intelligence',    'ALLOWANCE', 'ANY', NULL, NULL, NULL, NULL, NULL, 'ACTOR', 'Uses the monthly allowance, then credits'),
    ('video_lesson',         'ALLOWANCE', 'ANY', NULL, NULL, NULL, NULL, NULL, 'ACTOR', 'Uses the monthly allowance, then credits'),
    ('ai_video_clips',       'ALLOWANCE', 'ANY', NULL, NULL, NULL, NULL, NULL, 'ACTOR', 'Uses the monthly allowance, then credits'),
    -- always charged from credits
    ('premium_tts',          'CHARGED',   'ANY', NULL, NULL, NULL, NULL, NULL, 'ACTOR', 'Charged from credits'),
    ('ai_calling',           'CHARGED',   'ANY', NULL, NULL, NULL, NULL, NULL, 'ACTOR', 'Charged from credits'),
    ('telephony',            'CHARGED',   'ANY', NULL, NULL, NULL, NULL, NULL, 'ACTOR', 'Charged from credits'),
    ('engagement_messages',  'CHARGED',   'ANY', NULL, NULL, NULL, NULL, NULL, 'ACTOR', 'Charged from credits'),
    ('unmapped',             'CHARGED',   'ANY', NULL, NULL, NULL, NULL, NULL, 'ACTOR', 'Charged from credits')
) AS s (feature_key, mode, model_policy, roles_included, inst_units_cap, inst_credits_cap, user_units_cap,
        user_credits_cap, user_cap_basis, display_cap_text)
WHERE v.version_no = 1
  AND v.status = 'DRAFT'
  AND NOT EXISTS (SELECT 1 FROM ai_plan_item i WHERE i.plan_version_id = v.id)
ON CONFLICT (plan_version_id, feature_key) DO NOTHING;

-- ── Use case -> billing feature (every V586 catalog row) ──────────────────
-- Last: the only ALTER of an existing (small, V586) table. Rows already mapped
-- (non-NULL) are never overwritten.
ALTER TABLE ai_use_case_catalog ADD COLUMN IF NOT EXISTS billing_feature_key VARCHAR(48);

UPDATE ai_use_case_catalog c
SET billing_feature_key = m.feature_key
FROM (VALUES
    ('ai_calling',            'ai_calling'),
    ('telephony',             'telephony'),
    ('agent_assist',          'agent_assist'),
    ('voice_bot_llm',         'ai_calling'),
    ('call_intelligence',     'call_intelligence'),
    ('learner_analytics',     'learner_analytics'),
    ('student_report',        'learner_analytics'),
    ('report_narrative',      'learner_analytics'),
    ('class_report',          'learner_analytics'),
    ('lesson_video',          'video_lesson'),
    ('ai_video_clip',         'ai_video_clips'),
    ('avatar_video',          'video_lesson'),
    ('video_regenerate',      'video_lesson'),
    ('reels',                 'video_lesson'),
    ('studio_plan',           'video_lesson'),
    ('web_search',            'unmapped'),
    ('tutor_live',            'tutor_live_minutes'),
    ('tutor_chat',            'tutor_chat'),
    ('tutor_setup',           'unmapped'),
    ('chat_with_pdf',         'tutor_chat'),
    ('kb_companion',          'kb_qa'),
    ('learner_assistant',     'learner_assistant'),
    ('vacademy_assistant',    'admin_assistant'),
    ('admin_agent',           'admin_assistant'),
    ('copilot',               'copilot'),
    ('workflow_draft',        'admin_assistant'),
    ('parent_assistant',      'learner_assistant'),
    ('content',               'content_generation'),
    ('course_outline',        'content_generation'),
    ('course_assist',         'content_generation'),
    ('html_document',         'content_generation'),
    ('page_builder',          'content_generation'),
    ('transcript_notes',      'content_generation'),
    ('lecture',               'content_generation'),
    ('presentation',          'content_generation'),
    ('translation',           'content_generation'),
    ('live_session_summary',  'content_generation'),
    ('incident',              'content_generation'),
    ('content_image',         'image_generation'),
    ('document_image',        'image_generation'),
    ('page_builder_image',    'image_generation'),
    ('course_assist_image',   'image_generation'),
    ('assessment_generation', 'question_generation'),
    ('questions',             'question_generation'),
    ('kb_question_paper',     'question_generation'),
    ('evaluation',            'copy_check'),
    ('quiz_image',            'image_generation'),
    ('knowledge_base',        'kb_qa'),
    ('embedding',             'unmapped'),
    ('chatbot_flow',          'chatbot_reply'),
    ('engagement',            'engagement_messages'),
    ('engagement_message',    'engagement_messages'),
    ('engagement_plan',       'content_generation'),
    ('tts',                   'premium_tts'),
    ('stock_media',           'video_lesson'),
    ('transcription',         'transcription'),
    ('unknown',               'unmapped')
) AS m (use_case, feature_key)
WHERE c.use_case = m.use_case
  AND c.billing_feature_key IS NULL;

-- V586 seeded these three use cases with plan_eligible = FALSE. No code reads
-- plan_eligible (the metering screens only display it); the plan engine decides
-- from billing_feature_key -> ai_billing_feature.eligibility. d_plans §1.1 makes
-- them ALLOWANCE_ONLY features (paid from the plan allowance at list credits,
-- never included free), so the displayed flag is aligned with that decision.
UPDATE ai_use_case_catalog
SET plan_eligible = TRUE
WHERE use_case IN ('ai_video_clip', 'avatar_video', 'transcription')
  AND plan_eligible = FALSE
  AND billing_feature_key IN ('ai_video_clips', 'video_lesson', 'transcription');
