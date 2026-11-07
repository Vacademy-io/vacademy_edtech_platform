-- Anthropic key pool + registry seeds. Everything here is additive and inert:
--   * llm_provider_keys / llm_key_spend are new tables that nothing reads until a
--     super admin adds a key AND llm.model_routes routes a model to "anthropic".
--     ai_service tolerates them being absent (no keys = every call stays on OpenRouter).
--   * ai_model_defaults rows for the six image use cases hold the exact model each
--     feature hard-codes today, so reading them changes nothing.
--   * ai_models rows for Claude models missing from the registry. No use case points
--     at them (recommended_for is empty), so no traffic moves.
-- Only CREATE ... IF NOT EXISTS, guarded INSERTs and REVOKEs on the two new tables:
-- existing rows and existing tables are never touched.

-- ── Key pool ────────────────────────────────────────────────────────────────
-- key_ciphertext is a Fernet token written by ai_service; no API ever returns it.
-- Anthropic rate limits are per organisation, so org_label groups keys by org.
CREATE TABLE IF NOT EXISTS llm_provider_keys (
    id varchar(64) PRIMARY KEY,
    provider varchar(32) NOT NULL,
    label varchar(120) NOT NULL,
    org_label varchar(120),
    key_ciphertext text NOT NULL,
    key_hint varchar(16) NOT NULL,
    monthly_budget_usd numeric(12,4) NOT NULL DEFAULT 200,
    soft_limit_pct integer NOT NULL DEFAULT 95,
    weight integer NOT NULL DEFAULT 1,
    status varchar(16) NOT NULL DEFAULT 'active',
    cooldown_until timestamptz,
    exhausted_until timestamptz,
    last_error text,
    last_error_at timestamptz,
    last_used_at timestamptz,
    created_by varchar(64),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_provider_keys_provider ON llm_provider_keys(provider, status);

-- Metered spend per key per calendar month (period_month = first day of the month, UTC).
CREATE TABLE IF NOT EXISTS llm_key_spend (
    key_id varchar(64) NOT NULL REFERENCES llm_provider_keys(id) ON DELETE CASCADE,
    period_month date NOT NULL,
    metered_usd numeric(14,6) NOT NULL DEFAULT 0,
    calls bigint NOT NULL DEFAULT 0,
    errors bigint NOT NULL DEFAULT 0,
    input_tokens bigint NOT NULL DEFAULT 0,
    output_tokens bigint NOT NULL DEFAULT 0,
    cache_read_tokens bigint NOT NULL DEFAULT 0,
    cache_write_tokens bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (key_id, period_month)
);

-- The schema default privileges hand every new table to the shared developer and
-- analytics roles (vacademy_readonly = SELECT, vacademy_readwrite = INSERT/UPDATE/DELETE).
-- llm_provider_keys holds the key ciphertext, so those roles get nothing on it, and
-- only read access to the spend counters. The owner (the role Flyway and the
-- services connect as) keeps full access. Guarded so a database without these roles
-- (local, CI) runs the same file.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vacademy_readonly') THEN
        EXECUTE 'REVOKE ALL ON TABLE llm_provider_keys FROM vacademy_readonly';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vacademy_readwrite') THEN
        EXECUTE 'REVOKE ALL ON TABLE llm_provider_keys FROM vacademy_readwrite';
        EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE llm_key_spend FROM vacademy_readwrite';
    END IF;
END $$;

-- ── Image use cases (ai_model_defaults.use_case is UNIQUE) ──────────────────
-- default_model_id = the literal each feature uses today; no fallback.
INSERT INTO ai_model_defaults (use_case, default_model_id, fallback_model_id, description)
VALUES
    ('page_builder_image', 'google/gemini-3.1-flash-image', NULL,
     'Page builder generated images (PAGE_IMAGE_MODEL env still wins)'),
    ('course_assist_image', 'google/gemini-3.1-flash-image', NULL,
     'Course assist generated images (COURSE_ASSIST_IMAGE_MODEL env still wins)'),
    ('quiz_image', 'google/gemini-3.1-flash-image', NULL,
     'Question and quiz figures'),
    ('document_image', 'qwen/qwen-image-3', NULL,
     'HTML document and reading illustrations (DOC_IMAGE_MODEL env still wins)'),
    ('video_image', 'recraft/recraft-v4.1', NULL,
     'AI video scene images and thumbnails'),
    ('video_support_visual', 'bytedance-seed/seedream-4.5', NULL,
     'AI video supporting visuals (image-to-image)')
ON CONFLICT (use_case) DO NOTHING;

-- ── Claude models missing from the registry (ai_models.model_id is UNIQUE) ──
-- model_id = the OpenRouter id (confirmed against openrouter.ai/api/v1/models on
-- 2026-10-15); prices = Anthropic list prices per 1M tokens, which OpenRouter matches.
-- The existing anthropic/claude-haiku-4-5-20251001 row (render-worker) is left alone.
INSERT INTO ai_models (model_id, name, provider, category, tier, max_tokens, context_window,
                       supports_streaming, supports_images, supports_function_calling, supports_json_mode,
                       input_price_per_1m, output_price_per_1m, credit_multiplier,
                       quality_score, speed_score, is_active, display_order, description, recommended_for)
VALUES
    ('anthropic/claude-opus-5.5', 'Claude Opus 5.5', 'Anthropic', 'general', 'ultra', 128000, 1000000,
     true, true, true, true, 4.000000, 20.000000, 4.00,
     5, 3, true, 30, 'Current Claude Opus. Priced for cost reporting and key-pool routing.', '{}'),
    ('anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5', 'Anthropic', 'general', 'premium', 128000, 1000000,
     true, true, true, true, 2.000000, 10.000000, 2.00,
     5, 4, true, 22, 'Current Claude Sonnet. Priced for cost reporting and key-pool routing.', '{}'),
    -- Seeded INACTIVE: Anthropic bills prompts over 100K tokens at $0.50 / $2.50, five times
    -- this flat row, and credit pricing reads only these two columns. Activate it only for
    -- short-prompt use cases (the key pool meters the long-prompt rate on its own).
    ('anthropic/claude-haiku-5.5', 'Claude Haiku 5.5', 'Anthropic', 'general', 'standard', 128000, 1000000,
     true, true, true, true, 0.100000, 0.500000, 1.00,
     4, 5, false, 13, 'Current Claude Haiku. Price is for prompts up to 100K tokens; longer prompts cost 5x (0.50 / 2.50 per 1M). Keep off long-context use cases.', '{}'),
    ('anthropic/claude-haiku-4.5', 'Claude Haiku 4.5', 'Anthropic', 'general', 'standard', 64000, 200000,
     true, true, true, true, 1.000000, 5.000000, 1.00,
     4, 5, true, 14, 'Claude Haiku 4.5 under its OpenRouter id.', '{}')
ON CONFLICT (model_id) DO NOTHING;
