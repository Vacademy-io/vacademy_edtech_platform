-- Telleo AI calling public API v1 (2026-10-13).
--
-- ai_call_api_call: one row per call requested through the public API. The public id
-- (call_...) is what the client sees; the call itself rides the existing ai_call_queue
-- (queue_item_id) and, once dialled, telephony_call_log (call_log_id). Contact details,
-- template variables and the client's metadata live here so the voice bot can read them
-- at call start (VoiceBotInternalController) and the API can echo them back.
-- The final_* / webhook_* columns are the outbox for call.completed / call.not_connected.
CREATE TABLE IF NOT EXISTS ai_call_api_call (
    id                   VARCHAR(40)  PRIMARY KEY,
    institute_id         VARCHAR(255) NOT NULL,
    api_key_id           VARCHAR(255),
    batch_id             VARCHAR(40),
    agent_id             VARCHAR(255) NOT NULL,
    phone_number         VARCHAR(32)  NOT NULL,
    contact_name         VARCHAR(255),
    contact_email        VARCHAR(255),
    external_id          VARCHAR(255),
    variables            JSONB,
    metadata             JSONB,
    test_mode            BOOLEAN      NOT NULL DEFAULT FALSE,
    idempotency_key      VARCHAR(255),
    queue_item_id        VARCHAR(255),
    call_log_id          VARCHAR(255),
    final_status         VARCHAR(32),
    final_event          VARCHAR(32),
    finalized_at         TIMESTAMPTZ,
    webhook_status       VARCHAR(16),
    webhook_attempts     INTEGER      NOT NULL DEFAULT 0,
    webhook_next_at      TIMESTAMPTZ,
    webhook_last_code    INTEGER,
    webhook_last_error   VARCHAR(500),
    webhook_delivered_at TIMESTAMPTZ,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_call_api_call_institute_created
    ON ai_call_api_call (institute_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_api_call_batch
    ON ai_call_api_call (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_call_api_call_queue_item
    ON ai_call_api_call (queue_item_id) WHERE queue_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_call_api_call_call_log
    ON ai_call_api_call (call_log_id) WHERE call_log_id IS NOT NULL;
-- The outbox scan: calls not yet final, and finished calls whose webhook is due.
CREATE INDEX IF NOT EXISTS idx_ai_call_api_call_open
    ON ai_call_api_call (created_at) WHERE finalized_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_call_api_call_webhook_due
    ON ai_call_api_call (webhook_next_at) WHERE webhook_status = 'PENDING';
-- One call per (institute, Idempotency-Key): a retried request returns the first call.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_call_api_call_idempotency
    ON ai_call_api_call (institute_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- One webhook endpoint per institute. The secret signs every delivery (HMAC-SHA256);
-- it is shown once when set or rotated and kept here so we can sign.
CREATE TABLE IF NOT EXISTS ai_call_webhook (
    institute_id VARCHAR(255) PRIMARY KEY,
    url          VARCHAR(2048) NOT NULL,
    secret       VARCHAR(128)  NOT NULL,
    enabled      BOOLEAN       NOT NULL DEFAULT TRUE,
    created_by   VARCHAR(255),
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
