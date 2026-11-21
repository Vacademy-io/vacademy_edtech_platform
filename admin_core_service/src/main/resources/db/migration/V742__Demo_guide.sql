-- ================================================================================
-- V742: Demo guide (the AI guide beside the framed product demo, demo.vacademy.io),
-- docs/demo-stage/SPEC.md section 2.4.
--
-- Tables are read and written by ai_service with plain SQL (app/demo_guide/);
-- admin_core only owns the schema. Everything is additive and idempotent:
-- CREATE TABLE / INDEX IF NOT EXISTS and seeds with ON CONFLICT DO NOTHING. No
-- ALTER, UPDATE or DROP of anything that exists, so the migration takes no lock
-- on a busy table and does not depend on which role owns the existing tables.
--
-- Billing: none. The guide is our own sales demo; ai_service writes its usage
-- rows record-only against the product's lead institute (free_reason POLICY_FREE).
-- request_type reuses 'chatbot' (allowed by ai_token_usage_request_type_check
-- since V501), so that CHECK is not touched.
-- ================================================================================

-- -------------------------------------------------------------------------------
-- 1. Sessions: one per visitor who opened the demo page. Raw IPs are never stored
--    (ip_hash is a salted SHA-256).
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo_guide_session (
    id              VARCHAR(36)  PRIMARY KEY,
    product         VARCHAR(64)  NOT NULL,                  -- key in the demo_guide.products setting
    lang            VARCHAR(8)   NOT NULL DEFAULT 'en',     -- en | hi | kn | fr
    visitor_id      VARCHAR(64)  NOT NULL,
    ip_hash         VARCHAR(64),
    origin          VARCHAR(255),
    page_url        TEXT,
    utm             JSONB,                                  -- utm_* tags and the referrer
    qualification   JSONB,                                  -- what the guide noted: audience, learner_count, ...
    tours           JSONB,                                  -- [{id, at, finished}]
    lead_id         VARCHAR(64),                            -- audience_response id once contact was sent
    turns           INT          NOT NULL DEFAULT 0,
    speech_chars    INT          NOT NULL DEFAULT 0,
    listen_seconds  INT          NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dg_session_product_created
    ON demo_guide_session (product, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dg_session_ip_created
    ON demo_guide_session (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_dg_session_ip_last
    ON demo_guide_session (ip_hash, last_at);
CREATE INDEX IF NOT EXISTS idx_dg_session_last
    ON demo_guide_session (last_at);

-- -------------------------------------------------------------------------------
-- 2. Messages of a session. The id is a UUID chosen by ai_service before the reply
--    is written, so speech URLs can be built while the reply is still streaming.
--    actions: for the guide {lang, sentences[], choices[], tour, form}; for the
--    visitor {choice_id, tour_id, finished, spoken}.
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo_guide_message (
    id          VARCHAR(36)  PRIMARY KEY,
    session_id  VARCHAR(36)  NOT NULL REFERENCES demo_guide_session (id) ON DELETE CASCADE,
    role        VARCHAR(16)  NOT NULL,                      -- user | assistant
    kind        VARCHAR(24)  NOT NULL,                      -- start | text | choice | tour_end | contact_saved | reply
    text        TEXT         NOT NULL DEFAULT '',
    actions     JSONB,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dg_message_session
    ON demo_guide_message (session_id, created_at);

-- -------------------------------------------------------------------------------
-- 3. Pricing: a demo-guide turn costs 0 credits. Must agree with DEFAULT_TOOL_PRICING
--    in ai_service/app/services/tool_cost_estimator.py. DO NOTHING keeps a row a
--    super admin already edited. unit_field flat is allowed by ai_tool_pricing_unit_field_valid.
-- -------------------------------------------------------------------------------
INSERT INTO ai_tool_pricing (tool_key, request_type, flat_base_credits, per_unit_credits, unit_field, params_json)
VALUES ('demo_guide_turn', 'chatbot', 0, 0, 'flat', '{"fixed_price": true}'::jsonb)
ON CONFLICT (tool_key) DO NOTHING;

-- -------------------------------------------------------------------------------
-- 4. Metering vocabulary (V586) and model default (V569 pattern).
--    The catalog row owns only the tool key: request_type chatbot stays with
--    chatbot_flow, so each request_type keeps exactly one owner row. Not plan- or
--    limit-eligible: nothing is charged, and a usage limit of the lead institute
--    must never switch the public demo off.
--    Model: the same as site_assistant after V599 (a model whose reasoning can be
--    turned off, GLM as the fallback): the reply is spoken, so the first sentence
--    must arrive fast. A super admin can change it in the portal.
-- -------------------------------------------------------------------------------
INSERT INTO ai_use_case_catalog
    (use_case, feature_group, label, label_template, count_unit_label, model_use_case,
     legacy_request_types, tool_keys, capability_key, default_surface, actor_kind, unit_kind,
     plan_eligible, limit_eligible, reserve_on_authorize, intentionally_separate, display_order, updated_by)
VALUES
    ('demo_guide', 'agent', 'Demo guide (product demo page)', NULL, 'turns', 'demo_guide',
     '{}', '{demo_guide_turn}', NULL, 'PUBLIC', 'SYSTEM', 'REQUESTS',
     FALSE, FALSE, FALSE, FALSE, 83, 'V742')
ON CONFLICT (use_case) DO NOTHING;

INSERT INTO ai_model_defaults (use_case, default_model_id, fallback_model_id, free_tier_model_id, description)
VALUES ('demo_guide', 'google/gemini-2.5-flash', 'z-ai/glm-5.3-flash', NULL,
        'Demo guide: the AI guide on the public product demo page (spoken replies, reasoning off). Not charged.')
ON CONFLICT (use_case) DO NOTHING;
