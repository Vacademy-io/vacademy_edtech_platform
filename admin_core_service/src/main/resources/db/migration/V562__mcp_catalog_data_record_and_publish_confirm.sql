-- ================================================================================
-- V562: MCP catalog_data_edit records + website_publish confirm tokens
-- ================================================================================
--
-- Two small tables for opt-in MCP tools in ai_service. This migration is the
-- ONLY place they are created: ai_service runs no DDL for them and only checks
-- at startup that they exist. The SQLAlchemy models must stay identical to this
-- file (ai_service/tests/test_mcp_tables_migration_parity.py):
--   mcp_catalog_data_record -> ai_service/app/models/catalog_data_edit.py
--   mcp_publish_confirm     -> ai_service/app/models/publish_confirm.py
--
-- mcp_catalog_data_record: what catalog_data_edit created itself (today the
-- folder libraries made by create_folder_library). The tool may change existing
-- nodes only in a library it created, or in one no live site uses; a library's
-- created_by is the admin's own user id, so only this table tells the two apart.
-- Rows are never updated or deleted by the tool; every read filters on the
-- caller's pinned institute.
--
-- mcp_publish_confirm: single-use confirm tokens for the two-step publish /
-- rollback over MCP. id is the SHA-256 of the token (the token itself is never
-- stored). A row is bound to the institute, user, site, action and the exact
-- state that was checked; it expires 10 minutes after issue and is spent by the
-- first call that uses it (used_at).
--
-- Every statement is idempotent. Index and comment DDL sits in guarded DO blocks
-- so a table that already exists under another database role (42501) cannot
-- block the deploy (same approach as V524 and V561).
-- ================================================================================

CREATE TABLE IF NOT EXISTS mcp_catalog_data_record (
    id           VARCHAR(32)  PRIMARY KEY,
    institute_id VARCHAR(255) NOT NULL,                  -- the caller's pinned institute; every read filters on it
    kind         VARCHAR(40)  NOT NULL,                  -- what was created: folder_library
    record_id    VARCHAR(255) NOT NULL,                  -- the created record's id in admin-core
    created_by   VARCHAR(255),                           -- the approving staff member's user id
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

DO $$
BEGIN
    CREATE INDEX IF NOT EXISTS idx_mcp_catalog_data_record_lookup
        ON mcp_catalog_data_record (institute_id, kind, record_id);
    COMMENT ON TABLE mcp_catalog_data_record IS
        'Records the MCP catalog_data_edit tool created itself (folder libraries), per institute';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'skipping mcp_catalog_data_record index/comment DDL: %', SQLERRM;
END
$$;

CREATE TABLE IF NOT EXISTS mcp_publish_confirm (
    id                VARCHAR(64)  PRIMARY KEY,          -- SHA-256 hex of the token (the token is never stored)
    institute_id      VARCHAR(255) NOT NULL,
    user_id           VARCHAR(255) NOT NULL,
    action            VARCHAR(16)  NOT NULL,             -- publish | rollback
    catalogue_id      VARCHAR(255) NOT NULL,
    tag_name          VARCHAR(255) NOT NULL,
    draft_revision_id VARCHAR(255),                      -- publish: the draft that was checked
    draft_revision_no INTEGER,
    draft_sha256      VARCHAR(64),
    to_revision_id    VARCHAR(255),                      -- rollback: the published revision to bring back
    to_revision_no    INTEGER,
    to_sha256         VARCHAR(64),
    live_revision_no  INTEGER,                           -- the live site when the token was issued
    live_sha256       VARCHAR(64),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ  NOT NULL,
    used_at           TIMESTAMPTZ                        -- spent by the first call that uses it
);

DO $$
BEGIN
    CREATE INDEX IF NOT EXISTS idx_mcp_publish_confirm_institute
        ON mcp_publish_confirm (institute_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_mcp_publish_confirm_expires
        ON mcp_publish_confirm (expires_at);
    COMMENT ON TABLE mcp_publish_confirm IS
        'MCP website_publish single-use confirm tokens (SHA-256 of the token only), 10 min TTL';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'skipping mcp_publish_confirm index/comment DDL: %', SQLERRM;
END
$$;
