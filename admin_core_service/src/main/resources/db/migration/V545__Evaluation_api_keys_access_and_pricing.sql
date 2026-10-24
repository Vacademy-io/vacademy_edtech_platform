-- =============================================================================
-- V545: AI Evaluation public API -- keys, product access, per-institute pricing
-- -----------------------------------------------------------------------------
-- Spec: docs/AI_EVALUATION_PUBLIC_API.md sections 6.1 (keys + access), 10.2
-- (per-institute pricing overrides + global pricing history) and 10.1 (seed of
-- the two evaluation tool keys).
--
-- institute_api_key     one issued key. Only the SHA-256 hex of the full key is
--                       stored (key_hash, UNIQUE); verification is by hash only.
--                       The plaintext is shown once at issue and never stored.
-- institute_api_access  per (institute, product) enablement + limits. Written by
--                       platform staff only (super-admin endpoints).
-- institute_tool_pricing append-only per-institute price overrides; one OPEN row
--                       (effective_to IS NULL) per (institute, tool_key). Read and
--                       written by ai_service (ToolCostEstimator, super-admin router).
-- ai_tool_pricing_history audit trail of edits to the GLOBAL ai_tool_pricing rows.
--
-- Idempotent: every statement is IF NOT EXISTS / ON CONFLICT DO NOTHING, so a
-- re-run (or a table created by hand on some env) never fails the boot, and the
-- seed never overwrites a live price edited through the super-admin upsert.
-- =============================================================================

CREATE TABLE IF NOT EXISTS institute_api_key (
    id              VARCHAR(36)  PRIMARY KEY,
    institute_id    VARCHAR(255) NOT NULL,
    name            VARCHAR(120) NOT NULL,
    key_prefix      VARCHAR(24)  NOT NULL,              -- display / logs only
    key_hash        CHAR(64)     NOT NULL,              -- hex SHA-256 of the full key: the lookup
    products        TEXT[]       NOT NULL,              -- {evaluation}
    scopes          TEXT[]       NOT NULL,
    daily_copy_cap  INT,                                -- NULL = institute quota only
    status          VARCHAR(16)  NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | REVOKED
    expires_at      TIMESTAMP,
    created_by      VARCHAR(255) NOT NULL,
    created_via     VARCHAR(16)  NOT NULL,              -- dashboard | super_admin | migration
    created_at      TIMESTAMP    NOT NULL DEFAULT now(),
    last_used_at    TIMESTAMP,
    last_used_ip    VARCHAR(64),
    revoked_at      TIMESTAMP,
    revoked_by      VARCHAR(255),
    legacy_source   VARCHAR(16),                        -- ai_call | video | NULL (Phase 3)
    CONSTRAINT institute_api_key_hash_unique UNIQUE (key_hash),
    CONSTRAINT institute_api_key_status_valid CHECK (status IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT institute_api_key_daily_cap_positive CHECK (daily_copy_cap IS NULL OR daily_copy_cap > 0)
);

CREATE INDEX IF NOT EXISTS idx_iak_institute ON institute_api_key (institute_id, status);

COMMENT ON TABLE institute_api_key IS
    'Partner API keys (AI Evaluation API). Only the SHA-256 hex of the key is stored; verify by key_hash.';
COMMENT ON COLUMN institute_api_key.key_prefix IS
    'First 16 characters of the key, for display and logs only. Never used for lookup.';


CREATE TABLE IF NOT EXISTS institute_api_access (
    institute_id             VARCHAR(255)  NOT NULL,
    product                  VARCHAR(32)   NOT NULL,          -- evaluation
    enabled                  BOOLEAN       NOT NULL DEFAULT FALSE,
    segment                  VARCHAR(16),                     -- school | university | upsc
    rate_tier                VARCHAR(16)   NOT NULL DEFAULT 'standard',
    daily_copy_quota         INT           NOT NULL DEFAULT 2000,
    daily_identify_pages     INT           NOT NULL DEFAULT 5000,
    daily_rubric_generations INT           NOT NULL DEFAULT 200,
    copy_lane_cap            INT,                             -- NULL = platform default
    typed_lane_cap           INT,
    credit_limit             NUMERIC(12,2) NOT NULL DEFAULT 0,  -- allowed overdraft (postpaid)
    fire_workflow_events     BOOLEAN       NOT NULL DEFAULT FALSE,
    notes                    TEXT,
    updated_by               VARCHAR(255)  NOT NULL,
    updated_at               TIMESTAMP     NOT NULL DEFAULT now(),
    PRIMARY KEY (institute_id, product),
    CONSTRAINT institute_api_access_quotas_nonneg CHECK (
        daily_copy_quota >= 0 AND daily_identify_pages >= 0 AND daily_rubric_generations >= 0),
    CONSTRAINT institute_api_access_lane_caps_positive CHECK (
        (copy_lane_cap IS NULL OR copy_lane_cap > 0) AND (typed_lane_cap IS NULL OR typed_lane_cap > 0)),
    CONSTRAINT institute_api_access_credit_limit_nonneg CHECK (credit_limit >= 0)
);

COMMENT ON TABLE institute_api_access IS
    'Per-institute product enablement and limits for partner APIs. Written by platform staff only.';


CREATE TABLE IF NOT EXISTS institute_tool_pricing (
    id                VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
    institute_id      VARCHAR(255)  NOT NULL,
    tool_key          VARCHAR(64)   NOT NULL,
    flat_base_credits DECIMAL(10,4),                          -- NULL = inherit global
    per_unit_credits  DECIMAL(10,4),
    params_json       JSONB,                                  -- NULL = inherit
    no_token_overage  BOOLEAN       NOT NULL DEFAULT FALSE,   -- charge exactly the quote
    effective_from    TIMESTAMP     NOT NULL DEFAULT now(),
    effective_to      TIMESTAMP,                              -- set when replaced or reverted
    reason            TEXT          NOT NULL,                 -- contract reference
    created_by        VARCHAR(255)  NOT NULL,
    created_at        TIMESTAMP     NOT NULL DEFAULT now(),
    ended_by          VARCHAR(255),
    CONSTRAINT institute_tool_pricing_flat_nonneg CHECK (flat_base_credits IS NULL OR flat_base_credits >= 0),
    CONSTRAINT institute_tool_pricing_per_unit_nonneg CHECK (per_unit_credits IS NULL OR per_unit_credits >= 0),
    CONSTRAINT institute_tool_pricing_window_valid CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- One open override per (institute, tool).
CREATE UNIQUE INDEX IF NOT EXISTS ux_itp_open
    ON institute_tool_pricing (institute_id, tool_key)
    WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_itp_inst
    ON institute_tool_pricing (institute_id, tool_key, effective_from DESC);

COMMENT ON TABLE institute_tool_pricing IS
    'Append-only per-institute AI tool price overrides. Edit = close the open row and insert a new one.';


CREATE TABLE IF NOT EXISTS ai_tool_pricing_history (
    id          VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tool_key    VARCHAR(64)  NOT NULL,
    old_json    JSONB,
    new_json    JSONB        NOT NULL,
    changed_by  VARCHAR(255) NOT NULL,
    reason      TEXT         NOT NULL,
    changed_at  TIMESTAMP    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_tool_pricing_history_tool
    ON ai_tool_pricing_history (tool_key, changed_at DESC);


-- Seed both evaluation price rows. DO NOTHING: a live row edited through the
-- super-admin upsert is never overwritten. Must agree with DEFAULT_TOOL_PRICING
-- in ai_service/app/services/tool_cost_estimator.py.
--   copy_check_evaluation      dashboard, per question: 1 + 0.2 x questions (unchanged)
--   copy_check_evaluation_api  API, per page: 0 + 1 x pages; typed: 1 per non-blank
--                              long answer; fixed price (no token overage)
-- 'pages' is allowed by ai_tool_pricing_unit_field_valid since V371 (V511 keeps it).
INSERT INTO ai_tool_pricing (tool_key, request_type, flat_base_credits, per_unit_credits, unit_field, params_json, is_active)
VALUES
    ('copy_check_evaluation',     'evaluation', 1, 0.2, 'questions', '{}'::jsonb, TRUE),
    ('copy_check_evaluation_api', 'evaluation', 0, 1,   'pages',     '{"fixed_price": true, "typed_per_answer": 1}'::jsonb, TRUE)
ON CONFLICT (tool_key) DO NOTHING;
