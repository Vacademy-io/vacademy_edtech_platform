-- Telleo API v1.3: Idempotency-Key for creates that have no row of their own to carry it
-- (POST /v1/counsellors creates an auth_service user; POST /v1/agents an ai_agent row).
-- One row per (institute, operation, key); honoured for 24 hours, then the key may be
-- reused. resource_id is NULL while the first request is still working, so a concurrent
-- retry is told to wait instead of creating a second counsellor or agent.
CREATE TABLE IF NOT EXISTS ai_calling_api_idempotency (
    institute_id    VARCHAR(36)  NOT NULL,
    operation       VARCHAR(32)  NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    request_hash    VARCHAR(64)  NOT NULL,
    resource_id     VARCHAR(64),
    api_key_id      VARCHAR(64),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (institute_id, operation, idempotency_key)
);
