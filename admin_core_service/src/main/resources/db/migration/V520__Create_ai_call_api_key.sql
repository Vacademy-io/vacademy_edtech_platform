-- External AI-calling API keys.
--
-- Keys are scoped to one institute. The prefix is safe display metadata; the
-- complete key is retained so an operator can share it again when necessary.
CREATE TABLE ai_call_api_key (
    id            VARCHAR(50) PRIMARY KEY,
    institute_id  VARCHAR(50) NOT NULL,
    key_name      VARCHAR(100),
    key_prefix    VARCHAR(16) NOT NULL,
    api_key       VARCHAR(255) NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_by    VARCHAR(50),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at  TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX ux_ai_call_api_key_plaintext
    ON ai_call_api_key (api_key);

CREATE INDEX ix_ai_call_api_key_institute
    ON ai_call_api_key (institute_id);

COMMENT ON TABLE ai_call_api_key IS
    'Institute-scoped API keys for /admin-core-service/open/ai-calling/v1';
