-- ================================================================================
-- V565: MCP private file exports
-- ================================================================================
--
-- One store for EVERY file an MCP / Assistant tool generates that must not be
-- shared through the AI chat (credentials, PII exports, fee statements, …). The
-- tool builds the file and the model only ever sees a short-lived link
-- {ai-service}/ai-service/exports/{id}/{key}; the admin downloads it from there.
-- Served by ai_service (app/services/file_exports.py), which shares this database
-- and runs NO DDL for this table (model: app/models/file_export.py — keep the two
-- identical; ai_service/tests/test_file_exports.py checks it).
--
-- Security model:
--   * ciphertext is encrypted with a key derived from a random secret that exists
--     ONLY in the link, plus a server secret — this table alone cannot be read;
--     only key_hash (SHA-256 of the link secret) is stored;
--   * every kind has a policy in code (EXPORT_KINDS: lifetime, download cap, max
--     size, allowed content types) — a new kind of file is a deliberate addition;
--   * when a file is used up, expires or is revoked its ciphertext is wiped at
--     once; the row stays (metadata only) as an audit trail of who generated what
--     and is deleted after the retention window (90 days).
-- metadata_json holds non-sensitive context only (counts, related ids), never the
-- file's contents.

CREATE TABLE IF NOT EXISTS mcp_file_export (
    id                 VARCHAR(36)  PRIMARY KEY,
    institute_id       VARCHAR(255) NOT NULL,                  -- the caller's pinned institute
    created_by_user_id VARCHAR(255) NOT NULL,                  -- the staff member who asked for it
    source_tool        VARCHAR(100) NOT NULL,                  -- the tool that built it, e.g. learner_enroll
    kind               VARCHAR(64)  NOT NULL,                  -- policy key, e.g. ENROLMENT_CREDENTIALS
    file_name          VARCHAR(255) NOT NULL,
    content_type       VARCHAR(150) NOT NULL,
    size_bytes         BIGINT       NOT NULL,
    ciphertext         TEXT,                                   -- NULL once consumed / expired / revoked
    key_hash           VARCHAR(64)  NOT NULL,                  -- SHA-256 of the link secret (never the secret)
    status             VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | CONSUMED | EXPIRED | REVOKED
    download_count     INTEGER      NOT NULL DEFAULT 0,
    max_downloads      INTEGER      NOT NULL,
    expires_at         TIMESTAMPTZ  NOT NULL,
    last_downloaded_at TIMESTAMPTZ,
    metadata_json      TEXT,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

DO $$
BEGIN
    CREATE INDEX IF NOT EXISTS idx_mcp_file_export_status_expires
        ON mcp_file_export (status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_mcp_file_export_institute
        ON mcp_file_export (institute_id, created_at);
    COMMENT ON TABLE mcp_file_export IS
        'Private files MCP tools hand the admin as a short-lived link instead of through the AI chat (encrypted; link-only key)';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'skipping mcp_file_export index/comment DDL: %', SQLERRM;
END
$$;
