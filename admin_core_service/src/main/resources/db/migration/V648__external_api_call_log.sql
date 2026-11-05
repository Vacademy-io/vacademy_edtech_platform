-- One row per real HTTP request to a third-party API, in one shape whichever vendor it is.
-- Summaries only: callers decide what goes in the two JSONB columns, and they must never
-- contain credentials. key_hint is the last four characters of the key used. `vendor` is a
-- name the caller chose ("serper") or, for automatic capture, the host it called.
-- Written by ai_service (services/external_api_log.py); read by the health-check portal.
CREATE TABLE IF NOT EXISTS external_api_call_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    vendor            VARCHAR(255) NOT NULL,
    source_service    VARCHAR(32) NOT NULL DEFAULT 'ai',
    operation         VARCHAR(64) NOT NULL,
    status            VARCHAR(16) NOT NULL,   -- SUCCESS | FAILED
    http_status       INT,
    duration_ms       INT,
    key_hint          VARCHAR(16),
    institute_id      VARCHAR(64),
    run_id            VARCHAR(255),
    request_summary   JSONB,
    response_summary  JSONB,
    error_message     TEXT,
    cost_amount       NUMERIC(14,8),          -- from the price staff entered; NULL = unpriced or failed
    cost_currency     VARCHAR(3)
);

CREATE INDEX IF NOT EXISTS ix_external_api_call_log_time ON external_api_call_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_external_api_call_log_vendor_time ON external_api_call_log (vendor, occurred_at DESC);

-- Every vendor ever logged. Registered by the first call, so a new API appears on the
-- dashboard with no migration or portal change.
CREATE TABLE IF NOT EXISTS external_api_vendor (
    vendor          VARCHAR(255) PRIMARY KEY,
    source_service  VARCHAR(32) NOT NULL,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
