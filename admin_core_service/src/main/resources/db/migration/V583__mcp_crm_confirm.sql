-- ================================================================================
-- V583: MCP CRM single-use confirm tokens
-- ================================================================================
--
-- One small table for the opt-in CRM tools over MCP in ai_service. This
-- migration is the ONLY place it is created: ai_service runs no DDL for it and
-- only checks at startup that it exists. The SQLAlchemy model must stay
-- identical to this file (ai_service/tests/test_mcp_crm_confirm_parity.py):
--   mcp_crm_confirm -> ai_service/app/models/crm_confirm.py
--
-- mcp_crm_confirm: single-use confirm tokens for the two-step outbound and bulk
-- CRM actions (calls, AI-call campaigns, WhatsApp sends, bulk lead edits). id is
-- the SHA-256 of the token (the token itself is never stored). A row is bound to
-- the institute, the user, the action (purpose) and the SHA-256 of the exact
-- resolved request. summary_json holds the resolved target ids and counts only.
-- A token is spent once (spent_at) by the first call that uses it; a newer
-- preview of the same request revokes the older one (revoked_at), which does not
-- count towards the hourly caps; outcome records what the apply did.
--
-- Every statement is idempotent. Index and comment DDL sits in a guarded DO block
-- so a table that already exists under another database role (42501) cannot
-- block the deploy (same approach as V562).
-- ================================================================================

CREATE TABLE IF NOT EXISTS mcp_crm_confirm (
    id             VARCHAR(64)  PRIMARY KEY,             -- SHA-256 hex of the token (the token is never stored)
    institute_id   VARCHAR(255) NOT NULL,                -- the caller's pinned institute; every read filters on it
    user_id        VARCHAR(255) NOT NULL,
    purpose        VARCHAR(64)  NOT NULL,                -- crm.<tool>.<action>
    request_sha256 VARCHAR(64)  NOT NULL,                -- SHA-256 of the canonical resolved request
    summary_json   TEXT,                                 -- resolved target ids and counts (no contact data)
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ  NOT NULL,
    spent_at       TIMESTAMPTZ,                          -- spent by the first call that uses it
    revoked_at     TIMESTAMPTZ,                          -- replaced by a newer preview of the same request
    outcome        VARCHAR(16)                           -- what the apply did: done | failed
);

DO $$
BEGIN
    CREATE INDEX IF NOT EXISTS idx_mcp_crm_confirm_caps
        ON mcp_crm_confirm (institute_id, user_id, purpose, spent_at);
    CREATE INDEX IF NOT EXISTS idx_mcp_crm_confirm_expires
        ON mcp_crm_confirm (expires_at);
    COMMENT ON TABLE mcp_crm_confirm IS
        'MCP CRM single-use confirm tokens (SHA-256 of the token only) for outbound and bulk actions';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'skipping mcp_crm_confirm index/comment DDL: %', SQLERRM;
END
$$;
