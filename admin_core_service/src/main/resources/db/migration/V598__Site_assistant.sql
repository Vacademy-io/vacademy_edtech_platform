-- ================================================================================
-- V598: Site Assistant (public AI chatbot on institute websites), docs/site-assistant/SPEC.md section 2.
--
-- Tables are read and written by ai_service with plain SQL (app/site_assistant/);
-- admin_core only owns the schema. Everything is additive and idempotent:
-- CREATE TABLE / INDEX IF NOT EXISTS, seeds ON CONFLICT DO NOTHING. No ALTER of an
-- existing table, so no lock on a busy table (ai_token_usage, credit_transactions).
--
-- Billing: 1 credit flat per produced answer, tool_key site_assistant_answer.
-- request_type reuses 'chatbot', already allowed by ai_token_usage_request_type_check
-- since V501, so the CHECK is not touched (the trap of V102/V217/V225/V325/V435/V501).
-- pgvector is enabled since V168; embeddings are 768-d like content_embeddings.
-- ================================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- -------------------------------------------------------------------------------
-- 1. Conversations: one per visitor session (hosted site, embed or admin preview).
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_assistant_conversation (
    id              VARCHAR(36)  PRIMARY KEY,
    institute_id    VARCHAR(255) NOT NULL,
    site_tag        VARCHAR(255) NOT NULL,
    channel         VARCHAR(16)  NOT NULL,                  -- HOSTED | EMBED | PREVIEW
    visitor_id      VARCHAR(64)  NOT NULL,
    user_id         VARCHAR(255),                           -- a logged-in learner, else NULL
    ip_hash         VARCHAR(64),
    origin_host     VARCHAR(253),
    started_page    TEXT,
    utm             JSONB,
    locale          VARCHAR(16),
    status          VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',
    message_count   INT          NOT NULL DEFAULT 0,
    answers_billed  INT          NOT NULL DEFAULT 0,
    lead_status     VARCHAR(16),                            -- SALES | SUPPORT once a contact was sent
    lead_ref        VARCHAR(64),                            -- audience_response id of that lead
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_active_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sa_conversation_site_created
    ON site_assistant_conversation (institute_id, site_tag, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sa_conversation_visitor
    ON site_assistant_conversation (visitor_id);

-- -------------------------------------------------------------------------------
-- 2. Messages of a conversation (visitor, assistant and tool turns).
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_assistant_message (
    id               BIGSERIAL    PRIMARY KEY,
    conversation_id  VARCHAR(36)  NOT NULL REFERENCES site_assistant_conversation (id) ON DELETE CASCADE,
    role             VARCHAR(16)  NOT NULL,                 -- user | assistant | tool
    content          TEXT         NOT NULL,
    cards            JSONB,
    tool_name        VARCHAR(64),
    sources          JSONB,
    answered         BOOLEAN,
    feedback         SMALLINT,                              -- 1 | -1
    page             JSONB,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sa_message_conversation
    ON site_assistant_message (conversation_id, id);

-- -------------------------------------------------------------------------------
-- 3. Admin-written knowledge: FAQs and notices (site_tag NULL = every site of the institute).
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_assistant_knowledge (
    id            VARCHAR(36)  PRIMARY KEY,
    institute_id  VARCHAR(255) NOT NULL,
    site_tag      VARCHAR(255),
    kind          VARCHAR(16)  NOT NULL,                    -- FAQ | NOTICE
    title         TEXT         NOT NULL,                    -- FAQ question or notice title
    body          TEXT         NOT NULL,
    active        BOOLEAN      NOT NULL DEFAULT TRUE,
    starts_at     TIMESTAMPTZ,
    ends_at       TIMESTAMPTZ,
    embedding     vector(768),
    created_by    VARCHAR(255),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sa_knowledge_institute_kind
    ON site_assistant_knowledge (institute_id, kind, active);
CREATE INDEX IF NOT EXISTS idx_sa_knowledge_embedding
    ON site_assistant_knowledge USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- -------------------------------------------------------------------------------
-- 4. Indexed text of the published site pages (rebuilt when the catalogue fingerprint changes).
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_assistant_page_chunk (
    id            BIGSERIAL    PRIMARY KEY,
    institute_id  VARCHAR(255) NOT NULL,
    site_tag      VARCHAR(255) NOT NULL,
    page_route    TEXT         NOT NULL,
    page_title    TEXT,
    section_id    VARCHAR(128),
    heading       TEXT,
    content       TEXT         NOT NULL,
    embedding     vector(768),
    fingerprint   VARCHAR(64)  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sa_page_chunk_site
    ON site_assistant_page_chunk (institute_id, site_tag);
CREATE INDEX IF NOT EXISTS idx_sa_page_chunk_embedding
    ON site_assistant_page_chunk USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- -------------------------------------------------------------------------------
-- 5. Index state per site.
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_assistant_index_state (
    institute_id  VARCHAR(255) NOT NULL,
    site_tag      VARCHAR(255) NOT NULL,
    fingerprint   VARCHAR(64),
    status        VARCHAR(16),                              -- READY | INDEXING | FAILED
    chunks        INT,
    error         TEXT,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (institute_id, site_tag)
);

-- -------------------------------------------------------------------------------
-- 6. Daily answer counters: per site (limits.dailyAnswers) and per visitor or IP hash.
--    key_hash is prefixed v: (visitor) or ip: (IP hash).
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_assistant_usage_daily (
    institute_id  VARCHAR(255) NOT NULL,
    site_tag      VARCHAR(255) NOT NULL,
    day           DATE         NOT NULL,
    answers       INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (institute_id, site_tag, day)
);

CREATE TABLE IF NOT EXISTS site_assistant_visitor_daily (
    key_hash  VARCHAR(64) NOT NULL,
    day       DATE        NOT NULL,
    answers   INT         NOT NULL DEFAULT 0,
    PRIMARY KEY (key_hash, day)
);

-- -------------------------------------------------------------------------------
-- 7. Pricing: 1 credit per produced answer. Must agree with DEFAULT_TOOL_PRICING in
--    ai_service/app/services/tool_cost_estimator.py. DO NOTHING keeps a row a super
--    admin already edited. unit_field flat is allowed by ai_tool_pricing_unit_field_valid.
-- -------------------------------------------------------------------------------
INSERT INTO ai_tool_pricing (tool_key, request_type, flat_base_credits, per_unit_credits, unit_field, params_json)
VALUES ('site_assistant_answer', 'chatbot', 1, 0, 'flat', '{"fixed_price": true}'::jsonb)
ON CONFLICT (tool_key) DO NOTHING;

-- -------------------------------------------------------------------------------
-- 8. Metering vocabulary (V586) and model default (V569 pattern).
--    The catalog row owns only the tool key: request_type chatbot stays with
--    chatbot_flow, so each request_type keeps exactly one owner row.
--    Model: GLM flash with a non-GLM fallback like every other chat feature; the
--    engine disables reasoning for latency. A super admin can change it in the portal.
-- -------------------------------------------------------------------------------
INSERT INTO ai_use_case_catalog
    (use_case, feature_group, label, label_template, count_unit_label, model_use_case,
     legacy_request_types, tool_keys, capability_key, default_surface, actor_kind, unit_kind,
     plan_eligible, limit_eligible, reserve_on_authorize, intentionally_separate, display_order, updated_by)
VALUES
    ('site_assistant', 'agent', 'Site Assistant (website chatbot)', NULL, 'answers', 'site_assistant',
     '{}', '{site_assistant_answer}', NULL, 'PUBLIC', 'SYSTEM', 'REQUESTS',
     TRUE, TRUE, FALSE, FALSE, 82, 'V598')
ON CONFLICT (use_case) DO NOTHING;

INSERT INTO ai_model_defaults (use_case, default_model_id, fallback_model_id, free_tier_model_id, description)
VALUES ('site_assistant', 'z-ai/glm-5.3-flash', 'google/gemini-2.5-flash', NULL,
        'Site Assistant: public website chatbot answers (reasoning off)')
ON CONFLICT (use_case) DO NOTHING;
