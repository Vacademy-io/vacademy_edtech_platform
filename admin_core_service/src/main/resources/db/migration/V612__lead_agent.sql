-- ================================================================================
-- V612: Lead Agent — tables + pricing seed
--
-- Contract: docs/crm/LEAD_AGENT_BUILD_SPEC.md §2. admin_core only OWNS the schema;
-- ai_service (app/services/lead_agent/) reads and writes these tables with raw SQL.
-- admin_core's only runtime use is the internal bulk-intake / existing-contacts
-- endpoints (features/audience/leadagent/), which touch audience tables, not these.
--
-- PROD SAFETY: only CREATE TABLE / CREATE INDEX on NEW tables and INSERT seed rows.
-- No ALTER of any existing table (prod tables are owned by postgres while Flyway runs
-- as vacademy -> 42501). No foreign key to an existing table (audience_id is a plain
-- column) for the same reason. Idempotent: IF NOT EXISTS + ON CONFLICT DO NOTHING.
--
-- Pricing: request_type 'agent' is already allowed by ai_token_usage_request_type_check
-- (V501 list), so that CHECK is NOT touched. ai_tool_pricing_unit_field_valid only
-- allows questions|audio_minutes|chars|flat|pages|images (V511) and cannot be changed
-- here (ALTER of an existing table), so a delivered lead is priced as 'flat': ONE
-- charge per delivered lead (idempotency key lead_agent:{candidate_id}) of
-- flat_base_credits — same model as site_assistant_answer (1 credit per answer).
-- Provisional: 2 credits (local) / 4 credits (remote). Must agree with
-- DEFAULT_TOOL_PRICING in ai_service/app/services/tool_cost_estimator.py.
-- ================================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- -------------------------------------------------------------------------------
-- 1. lead_agent: one per lead list (audience)
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_agent (
    id                 VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    institute_id       VARCHAR(255)  NOT NULL,
    audience_id        VARCHAR(255)  NOT NULL,
    name               VARCHAR(200)  NOT NULL,
    status             VARCHAR(16)   NOT NULL DEFAULT 'PAUSED',
    brief_json         JSONB         NOT NULL DEFAULT '{}'::jsonb,
    markets_json       JSONB         NOT NULL DEFAULT '[]'::jsonb,
    daily_quota        INT           NOT NULL DEFAULT 10,
    monthly_credit_cap NUMERIC(12,2) NULL,
    mode               VARCHAR(12)   NOT NULL DEFAULT 'AUTO',
    gate_json          JSONB         NOT NULL DEFAULT '{"auto_score":70,"review_score":45,"min_contact":"likely","require_intent":false}'::jsonb,
    window_json        JSONB         NOT NULL DEFAULT '{"tz":"Asia/Kolkata","start":"09:30","end":"19:00","days":[1,2,3,4,5,6]}'::jsonb,
    plan_json          JSONB         NULL,
    plan_built_at      TIMESTAMPTZ   NULL,
    brief_hash         VARCHAR(64)   NULL,
    cursor_json        JSONB         NOT NULL DEFAULT '{}'::jsonb,
    last_tick_at       TIMESTAMPTZ   NULL,
    tick_owner         VARCHAR(64)   NULL,      -- the ai_service worker ticking this agent now
    tick_until         TIMESTAMPTZ   NULL,      -- its lease: no other worker ticks the agent before this
    last_error         TEXT          NULL,
    created_by         VARCHAR(255)  NULL,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT lead_agent_status_valid CHECK (status IN ('ACTIVE','PAUSED','ARCHIVED')),
    CONSTRAINT lead_agent_mode_valid   CHECK (mode IN ('LOCAL','REMOTE','AUTO')),
    CONSTRAINT lead_agent_quota_range  CHECK (daily_quota BETWEEN 1 AND 200),
    CONSTRAINT lead_agent_cap_nonneg   CHECK (monthly_credit_cap IS NULL OR monthly_credit_cap >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_agent_audience_live ON lead_agent (audience_id) WHERE status <> 'ARCHIVED';
CREATE INDEX IF NOT EXISTS idx_lead_agent_institute ON lead_agent (institute_id);
CREATE INDEX IF NOT EXISTS idx_lead_agent_status    ON lead_agent (status);

-- -------------------------------------------------------------------------------
-- 2. lead_org: an organisation on the public web (shared across institutes)
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_org (
    id               VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    domain           VARCHAR(255)  NOT NULL,
    name             VARCHAR(300)  NULL,
    website          VARCHAR(1000) NULL,
    country          VARCHAR(80)   NULL,
    state            VARCHAR(120)  NULL,
    city             VARCHAR(120)  NULL,
    platforms_json   JSONB         NOT NULL DEFAULT '[]'::jsonb,
    size_json        JSONB         NOT NULL DEFAULT '{}'::jsonb,
    social_json      JSONB         NOT NULL DEFAULT '{}'::jsonb,
    robots_json      JSONB         NULL,
    pages_fetched_at TIMESTAMPTZ   NULL,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT uq_lead_org_domain UNIQUE (domain)
);

-- -------------------------------------------------------------------------------
-- 3. lead_org_page: cached page text (evidence), expires after 30 days
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_org_page (
    id                  VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    org_id              VARCHAR(36)   NOT NULL REFERENCES lead_org (id) ON DELETE CASCADE,
    url                 VARCHAR(1000) NOT NULL,
    page_type           VARCHAR(30)   NOT NULL,   -- home | contact | team | careers | admissions | other
    access              VARCHAR(20)   NOT NULL,
    status_code         INT           NULL,
    final_url           VARCHAR(1000) NULL,
    text                TEXT          NULL,
    links_json          JSONB         NOT NULL DEFAULT '[]'::jsonb,
    has_form            BOOLEAN       NOT NULL DEFAULT FALSE,
    platform_hints_json JSONB         NOT NULL DEFAULT '[]'::jsonb,
    fetched_by          VARCHAR(12)   NOT NULL,
    -- '' = read by our server (public, shared by every institute); else the institute whose
    -- Chrome extension read it (its own browser, maybe signed in): visible to that institute only.
    fetched_institute_id VARCHAR(255) NOT NULL DEFAULT '',
    fetched_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ   NOT NULL DEFAULT (now() + interval '30 days'),
    CONSTRAINT uq_lead_org_page_url UNIQUE (org_id, url, fetched_institute_id),
    CONSTRAINT lead_org_page_scope_valid
        CHECK ((fetched_by = 'SERVER' AND fetched_institute_id = '')
            OR (fetched_by = 'EXTENSION' AND fetched_institute_id <> '')),
    CONSTRAINT lead_org_page_access_valid
        CHECK (access IN ('ok','blocked','error','not_html','robots_disallowed','unsafe_url','js_shell')),
    CONSTRAINT lead_org_page_fetched_by_valid CHECK (fetched_by IN ('SERVER','EXTENSION'))
);
CREATE INDEX IF NOT EXISTS idx_lead_org_page_expires ON lead_org_page (expires_at);

-- -------------------------------------------------------------------------------
-- 4. lead_candidate: an organisation for one agent
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_candidate (
    id                    VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    agent_id              VARCHAR(36)   NOT NULL REFERENCES lead_agent (id) ON DELETE CASCADE,
    institute_id          VARCHAR(255)  NOT NULL,
    org_id                VARCHAR(36)   NOT NULL REFERENCES lead_org (id),
    source                VARCHAR(40)   NOT NULL,  -- organisation_search | maps | hiring | keyword | software_request | new_centre
    discovery_json        JSONB         NOT NULL DEFAULT '{}'::jsonb,
    status                VARCHAR(16)   NOT NULL DEFAULT 'DISCOVERED',
    decision              VARCHAR(8)    NULL,
    score                 INT           NULL,
    score_json            JSONB         NULL,
    lead_json             JSONB         NULL,
    stage                 VARCHAR(20)   NULL,
    reject_reason         VARCHAR(300)  NULL,
    reviewed_by           VARCHAR(255)  NULL,
    reviewed_at           TIMESTAMPTZ   NULL,
    delivered_response_id VARCHAR(255)  NULL,
    delivered_at          TIMESTAMPTZ   NULL,
    delivery_note         VARCHAR(300)  NULL,
    credits_charged       NUMERIC(12,2) NOT NULL DEFAULT 0,
    charged_at            TIMESTAMPTZ   NULL,      -- the delivery charge is settled (in the ledger, or free)
    intake_attempted_at   TIMESTAMPTZ   NULL,      -- first bulk-intake call for it (retries skip the dedup check)
    delivery_attempts     INT           NOT NULL DEFAULT 0,
    cost_usd              NUMERIC(12,6) NOT NULL DEFAULT 0,
    attempts              INT           NOT NULL DEFAULT 0,
    last_error            TEXT          NULL,
    fetch_deadline        TIMESTAMPTZ   NULL,
    claimed_at            TIMESTAMPTZ   NULL,
    not_before            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT uq_lead_candidate_agent_org UNIQUE (agent_id, org_id),
    CONSTRAINT lead_candidate_status_valid CHECK (status IN (
        'DISCOVERED','FETCHING','READY','RESEARCHING','REVIEW','APPROVED',
        'DELIVERED','REJECTED','SKIPPED','FAILED')),
    CONSTRAINT lead_candidate_decision_valid CHECK (decision IS NULL OR decision IN ('AUTO','REVIEW','REJECT'))
);
CREATE INDEX IF NOT EXISTS idx_lead_candidate_agent_status     ON lead_candidate (agent_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_candidate_status_nb        ON lead_candidate (status, not_before);
CREATE INDEX IF NOT EXISTS idx_lead_candidate_institute_status ON lead_candidate (institute_id, status);

-- -------------------------------------------------------------------------------
-- 5. lead_fetch_task: page-fetch queue (extension or server)
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_fetch_task (
    id           VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    institute_id VARCHAR(255)  NOT NULL,
    agent_id     VARCHAR(36)   NOT NULL REFERENCES lead_agent (id) ON DELETE CASCADE,
    candidate_id VARCHAR(36)   NOT NULL REFERENCES lead_candidate (id) ON DELETE CASCADE,
    org_id       VARCHAR(36)   NOT NULL,
    url          VARCHAR(1000) NOT NULL,
    page_type    VARCHAR(30)   NOT NULL,
    mode         VARCHAR(12)   NOT NULL,
    status       VARCHAR(12)   NOT NULL DEFAULT 'PENDING',
    lease_owner  VARCHAR(64)   NULL,
    lease_until  TIMESTAMPTZ   NULL,
    attempts     INT           NOT NULL DEFAULT 0,
    last_error   TEXT          NULL,
    not_before   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT lead_fetch_task_mode_valid   CHECK (mode IN ('LOCAL','REMOTE','AUTO')),
    CONSTRAINT lead_fetch_task_status_valid CHECK (status IN ('PENDING','CLAIMED','DONE','FAILED'))
);
CREATE INDEX IF NOT EXISTS idx_lead_fetch_task_claim     ON lead_fetch_task (status, mode, not_before);
CREATE INDEX IF NOT EXISTS idx_lead_fetch_task_candidate ON lead_fetch_task (candidate_id);

-- -------------------------------------------------------------------------------
-- 6. lead_agent_worker: paired Chrome extensions
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_agent_worker (
    id           VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    institute_id VARCHAR(255) NOT NULL,
    user_id      VARCHAR(255) NOT NULL,
    kind         VARCHAR(12)  NOT NULL,
    label        VARCHAR(120) NULL,
    token_hash   VARCHAR(64)  NOT NULL,   -- sha256 hex of the extension token
    version      VARCHAR(30)  NULL,
    last_seen_at TIMESTAMPTZ  NULL,
    revoked_at   TIMESTAMPTZ  NULL,
    pages_today  INT          NOT NULL DEFAULT 0,
    pages_day    DATE         NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_lead_agent_worker_token UNIQUE (token_hash),
    CONSTRAINT lead_agent_worker_kind_valid CHECK (kind IN ('EXTENSION'))
);
CREATE INDEX IF NOT EXISTS idx_lead_agent_worker_institute ON lead_agent_worker (institute_id);

-- -------------------------------------------------------------------------------
-- 7. lead_suppression: never deliver these (per institute)
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_suppression (
    id           VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    institute_id VARCHAR(255) NOT NULL,
    kind         VARCHAR(8)   NOT NULL,
    value        VARCHAR(320) NOT NULL,   -- domain lower-case; phone = last 10 digits; email lower-case
    reason       VARCHAR(40)  NOT NULL,
    note         VARCHAR(300) NULL,
    created_by   VARCHAR(255) NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_lead_suppression UNIQUE (institute_id, kind, value),
    CONSTRAINT lead_suppression_kind_valid   CHECK (kind IN ('DOMAIN','PHONE','EMAIL')),
    CONSTRAINT lead_suppression_reason_valid
        CHECK (reason IN ('CUSTOMER','COMPETITOR','OPTED_OUT','MANUAL','NOT_INTERESTED'))
);

-- -------------------------------------------------------------------------------
-- 8. lead_agent_day: per-agent daily counters (day in the agent's window tz)
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_agent_day (
    agent_id   VARCHAR(36)   NOT NULL REFERENCES lead_agent (id) ON DELETE CASCADE,
    day        DATE          NOT NULL,
    discovered INT           NOT NULL DEFAULT 0,
    researched INT           NOT NULL DEFAULT 0,
    delivered  INT           NOT NULL DEFAULT 0,
    review     INT           NOT NULL DEFAULT 0,
    rejected   INT           NOT NULL DEFAULT 0,
    searches   INT           NOT NULL DEFAULT 0,
    pages      INT           NOT NULL DEFAULT 0,
    cost_usd   NUMERIC(12,6) NOT NULL DEFAULT 0,
    credits    NUMERIC(12,2) NOT NULL DEFAULT 0,
    PRIMARY KEY (agent_id, day)
);

-- -------------------------------------------------------------------------------
-- 9. lead_search_cache: search API results (7-day reuse decided in ai_service)
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_search_cache (
    key          VARCHAR(64) PRIMARY KEY,   -- sha256(provider|kind|query|location|page)
    provider     VARCHAR(12) NOT NULL,
    kind         VARCHAR(12) NOT NULL,
    query        TEXT        NOT NULL,
    results_json JSONB       NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_search_cache_created ON lead_search_cache (created_at);

-- -------------------------------------------------------------------------------
-- 9b. lead_agent_intake: admin_core's own record of each delivered row, written by
--     the internal bulk-intake in the SAME transaction as the lead it created. A repeat
--     call for the same external_id (lead_candidate id) — e.g. after an HTTP timeout —
--     returns this response_id instead of submitting the lead again. Owned and written
--     by admin_core only (ai_service keeps lead_candidate.delivered_response_id).
-- -------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_agent_intake (
    institute_id VARCHAR(255) NOT NULL,
    external_id  VARCHAR(255) NOT NULL,
    audience_id  VARCHAR(255) NOT NULL,
    response_id  VARCHAR(255) NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (institute_id, external_id)
);

-- -------------------------------------------------------------------------------
-- 10. Pricing + metering vocabulary (must equal DEFAULT_TOOL_PRICING in ai_service).
--     DO NOTHING keeps a row a super admin already edited.
--     The catalog row owns only the two tool keys: request_type 'agent' keeps its
--     existing owner row, so each request_type still has exactly one owner.
-- -------------------------------------------------------------------------------
INSERT INTO ai_tool_pricing (tool_key, request_type, flat_base_credits, per_unit_credits, unit_field, params_json)
VALUES ('lead_agent_lead_local',  'agent', 2, 0, 'flat', '{"fixed_price": true}'::jsonb),
       ('lead_agent_lead_remote', 'agent', 4, 0, 'flat', '{"fixed_price": true}'::jsonb)
ON CONFLICT (tool_key) DO NOTHING;

INSERT INTO ai_use_case_catalog
    (use_case, feature_group, label, label_template, count_unit_label, model_use_case,
     legacy_request_types, tool_keys, capability_key, default_surface, actor_kind, unit_kind,
     plan_eligible, limit_eligible, reserve_on_authorize, intentionally_separate, display_order, updated_by)
VALUES ('lead_agent', 'crm', 'Lead Agent (leads delivered)', NULL, 'leads', NULL,
        '{}', '{lead_agent_lead_local,lead_agent_lead_remote}', NULL, 'SCHEDULED', 'SYSTEM', 'REQUESTS',
        FALSE, TRUE, FALSE, FALSE, 84, 'V612')
ON CONFLICT (use_case) DO NOTHING;

-- Billing feature (V588 vocabulary, registered like V599 site_assistant). None of the
-- existing features fits a per-delivered-lead charge, so the Lead Agent gets its own.
-- ALWAYS_CHARGED: a delivered lead is never included free in an AI plan (plan_eligible
-- FALSE above says the same, as V588 aligns those flags); a super admin can change it.
INSERT INTO ai_billing_feature (feature_key, label, description, eligibility, locked, display_order, updated_by)
VALUES ('lead_agent', 'Lead Agent leads',
        'Researched leads the Lead Agent delivers into a lead list (charged per delivered lead).',
        'ALWAYS_CHARGED', FALSE, 76, 'V612')
ON CONFLICT (feature_key) DO NOTHING;

UPDATE ai_use_case_catalog
SET billing_feature_key = 'lead_agent'
WHERE use_case = 'lead_agent'
  AND billing_feature_key IS NULL;
