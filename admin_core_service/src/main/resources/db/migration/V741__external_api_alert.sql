-- One row per API and key that has ever needed attention. Written by ai_service's alert sweep
-- (services/external_api_alerts.py), which reads external_api_call_log; read by the health-check
-- portal. The row stays after recovery so that muting one key survives its next failure.
CREATE TABLE IF NOT EXISTS external_api_alert (
    vendor                VARCHAR(255) NOT NULL,
    key_hint              VARCHAR(16) NOT NULL,   -- last four characters, never the key
    kind                  VARCHAR(16) NOT NULL,   -- CREDITS | FAILING
    is_open               BOOLEAN NOT NULL DEFAULT TRUE,
    muted                 BOOLEAN NOT NULL DEFAULT FALSE,
    opened_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at           TIMESTAMPTZ,
    last_failed_at        TIMESTAMPTZ,
    last_notified_at      TIMESTAMPTZ,            -- NULL = nobody has been told about this one yet
    consecutive_failures  INT NOT NULL DEFAULT 0,
    last_http_status      INT,
    last_error            TEXT,
    PRIMARY KEY (vendor, key_hint)
);
