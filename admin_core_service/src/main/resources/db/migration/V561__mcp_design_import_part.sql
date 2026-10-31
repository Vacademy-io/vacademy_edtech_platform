-- ================================================================================
-- V561: MCP design_import — upload parts
-- ================================================================================
--
-- Background:
-- design_import is an opt-in MCP tool (ai_service, app/services/
-- assistant_tools_design_import.py). An institute admin's AI app reads a design
-- with ITS OWN Figma connection (get_metadata XML, get_design_context code) and
-- sends those results to Vacademy, which plans a website draft from them. The
-- server never fetches Figma and never holds a Figma token; this table only
-- parks what the AI app uploaded, for 24 hours, so a big design can arrive in
-- several calls and save_draft can re-plan it.
--
-- Why its own table and not ai_task: ai_task rows are served by unauthenticated
-- /task-status/* routes and several by-id pollers, and a client's artwork must
-- never be readable through them. Only assistant_tools_design_import reads or
-- writes this table, always filtered by the caller's pinned institute.
--
-- One row per uploaded PART, not per import: parallel chunk calls each INSERT
-- their own row, so no part is lost to a read-modify-write race. Every part of
-- an import carries the import's expires_at (copied from its first part), so a
-- bulk DELETE ... WHERE expires_at <= now() drops whole imports, never half of
-- one.
--
-- This migration is the ONLY place the table is created: ai_service runs no DDL
-- for it and only checks at startup that it exists (app/models/design_import.py,
-- check_design_import_schema). The SQLAlchemy model there must stay identical
-- to this file (ai_service/tests/test_design_import_migration_parity.py).
--
-- Every statement is idempotent. Should the table already exist under another
-- database role, index or comment DDL from this role would fail with 42501.
-- Those statements are performance and documentation aids only, so an
-- ownership failure is skipped with a NOTICE instead of blocking the deploy
-- (same approach as V524).
-- ================================================================================

CREATE TABLE IF NOT EXISTS mcp_design_import_part (
    id           VARCHAR(32)  PRIMARY KEY,
    import_id    VARCHAR(32)  NOT NULL,                  -- groups the parts of one upload
    institute_id VARCHAR(255) NOT NULL,                  -- the caller's pinned institute; every read filters on it
    created_by   VARCHAR(255),                           -- the approving staff member's user id
    payload      TEXT         NOT NULL,                  -- JSON: {metadata_xml: [], design_code: [], variables: {}, frame_ids: [], design_url?}
    bytes        INTEGER      NOT NULL DEFAULT 0,        -- payload size, for the per-import cap
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ  NOT NULL                   -- the import's expiry (24 h), the same on every part
);

DO $$
BEGIN
    CREATE INDEX IF NOT EXISTS idx_mcp_design_import_part_import
        ON mcp_design_import_part (institute_id, import_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_design_import_part_expires
        ON mcp_design_import_part (expires_at);
    COMMENT ON TABLE mcp_design_import_part IS
        'MCP design_import uploads (Figma results sent by an admin''s AI app), one row per part, kept 24 h; never exposed via ai_task';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'skipping mcp_design_import_part index/comment DDL: %', SQLERRM;
END
$$;
