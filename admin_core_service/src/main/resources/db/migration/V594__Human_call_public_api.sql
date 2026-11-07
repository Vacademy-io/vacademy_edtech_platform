-- Telleo API: human (counsellor) click-to-call through the public API (2026-10-17).
--
-- human_call_api_call: one row per POST /v1/human-calls. The public id (hcall_...) is what
-- the client holds; the call itself is an ordinary counsellor click-to-call row in
-- telephony_call_log (call_log_id), placed through CallOrchestrator exactly like the
-- dashboard's Call button. The counsellor's name/email are copied at create time so reads
-- never call auth_service. response_id is set when the number matched exactly one lead
-- of the institute (the call is then filed on that lead's timeline).
--
-- Outbox: final_* / webhook_* mirror ai_call_api_call for human_call.completed /
-- human_call.not_connected; analysis_* drive the optional human_call.analysis_ready
-- event (analyze: true on the request; column analysis_requested, since ANALYZE is a
-- reserved word), which has its own delivery state because it fires later.
-- New table only: no ALTER on an existing (possibly postgres-owned) table.
CREATE TABLE IF NOT EXISTS human_call_api_call (
    id                            VARCHAR(40)  PRIMARY KEY,
    institute_id                  VARCHAR(255) NOT NULL,
    api_key_id                    VARCHAR(255),
    counsellor_user_id            VARCHAR(255) NOT NULL,
    counsellor_name               VARCHAR(255),
    counsellor_email              VARCHAR(255),
    phone_number                  VARCHAR(32)  NOT NULL,
    contact_name                  VARCHAR(255),
    contact_email                 VARCHAR(255),
    external_id                   VARCHAR(255),
    metadata                      JSONB,
    analysis_requested            BOOLEAN      NOT NULL DEFAULT FALSE,
    response_id                   VARCHAR(255),
    provider_type                 VARCHAR(32),
    idempotency_key               VARCHAR(255),
    call_log_id                   VARCHAR(255),
    final_status                  VARCHAR(32),
    final_event                   VARCHAR(40),
    finalized_at                  TIMESTAMPTZ,
    webhook_status                VARCHAR(16),
    webhook_attempts              INTEGER      NOT NULL DEFAULT 0,
    webhook_next_at               TIMESTAMPTZ,
    webhook_last_code             INTEGER,
    webhook_last_error            VARCHAR(500),
    webhook_delivered_at          TIMESTAMPTZ,
    analysis_triggered_at         TIMESTAMPTZ,
    analysis_finalized_at         TIMESTAMPTZ,
    analysis_webhook_status       VARCHAR(16),
    analysis_webhook_attempts     INTEGER      NOT NULL DEFAULT 0,
    analysis_webhook_next_at      TIMESTAMPTZ,
    analysis_webhook_last_code    INTEGER,
    analysis_webhook_last_error   VARCHAR(500),
    analysis_webhook_delivered_at TIMESTAMPTZ,
    checked_at                    TIMESTAMPTZ,
    terminal_seen_at              TIMESTAMPTZ,
    created_at                    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at                    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_human_call_api_call_institute_created
    ON human_call_api_call (institute_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_human_call_api_call_call_log
    ON human_call_api_call (call_log_id) WHERE call_log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_human_call_api_call_counsellor
    ON human_call_api_call (institute_id, counsellor_user_id, created_at DESC);
-- The finaliser scan (calls or analyses not yet final, least recently checked first).
CREATE INDEX IF NOT EXISTS idx_human_call_api_call_open
    ON human_call_api_call (checked_at NULLS FIRST)
    WHERE finalized_at IS NULL OR (analysis_requested AND analysis_finalized_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_human_call_api_call_webhook_due
    ON human_call_api_call (webhook_next_at) WHERE webhook_status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_human_call_api_call_analysis_webhook_due
    ON human_call_api_call (analysis_webhook_next_at) WHERE analysis_webhook_status = 'PENDING';
-- One call per (institute, Idempotency-Key) while the key is honoured (24 h).
CREATE UNIQUE INDEX IF NOT EXISTS ux_human_call_api_call_idempotency
    ON human_call_api_call (institute_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
