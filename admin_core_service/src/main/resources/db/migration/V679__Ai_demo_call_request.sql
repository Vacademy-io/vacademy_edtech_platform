-- Public "Try the AI call" demo (exhibition QR page on telleo.ai).
-- A visitor saves name, organisation, mobile and language on the page, then dials the demo
-- number. An inbound call carries only the caller number, so the voice-bot call-context
-- binds the newest PENDING row for that number and personalises the call from it.
-- The rows double as the exhibition lead list.
CREATE TABLE IF NOT EXISTS ai_demo_call_request (
    id            VARCHAR(36)  PRIMARY KEY,
    institute_id  VARCHAR(255) NOT NULL,
    phone         VARCHAR(10)  NOT NULL,
    phone_raw     VARCHAR(32),
    visitor_name  VARCHAR(120),
    organisation  VARCHAR(160) NOT NULL,
    language      VARCHAR(30)  NOT NULL,
    status        VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    call_log_id   VARCHAR(255),
    source        VARCHAR(160),
    client_ip     VARCHAR(64),
    created_at    TIMESTAMP    NOT NULL DEFAULT now(),
    expires_at    TIMESTAMP    NOT NULL,
    connected_at  TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_demo_call_request_match
    ON ai_demo_call_request (institute_id, phone, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_demo_call_request_call_log
    ON ai_demo_call_request (call_log_id);
