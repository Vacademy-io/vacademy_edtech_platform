-- ================================================================================
-- V519: MCP server — OAuth store + tool-call audit log
-- ================================================================================
--
-- Background:
-- The Vacademy MCP server (Model Context Protocol) lets an institute's staff
-- connect their own AI apps — Claude, ChatGPT, Cursor — to Vacademy and read
-- their institute's data. It is served by ai_service (app/mcp/), which shares
-- THIS database, so its tables are created here like every other schema change.
--
-- Why these tables exist at all: the MCP server is an OAuth 2.1 authorization
-- server, and an issued access token is deliberately opaque — it is a lookup key,
-- not a credential. Resolving "who is this caller, for which institute" on every
-- request needs server-side state, which is what mcp_oauth_token holds. The other
-- tables are the stages that produce it:
--
--   mcp_oauth_client -> the AI app that registered
--   mcp_oauth_txn    -> an /authorize request parked while the admin signs in
--   mcp_oauth_code   -> a single-use code, created the moment they approve
--   mcp_oauth_token  -> the access + refresh pair the code is exchanged for
--   mcp_tool_call_log-> one row per tool call, for audit
--
-- Two storage rules run through all of it:
--   * tokens WE issue are stored only as SHA-256 hashes — we look them up, we
--     never need to read them back, so a database dump yields nothing usable;
--   * the approving user's PLATFORM tokens must be replayed to admin-core on
--     every tool call, so they are recoverable — and therefore encrypted
--     (Fernet, MCP_TOKEN_ENCRYPTION_KEY). ai_service refuses to start the MCP
--     server without that key rather than storing them in clear.
--
-- Nothing here grants anything. Whether an institute's staff may connect at all
-- is the MCP_SERVER_SETTING institute setting (enabled + role allow-list, and
-- learner roles never), read out of institutes.setting_json at request time.
--
-- ai_service also ensures this schema at startup (app/mcp/schema.py,
-- ensure_mcp_schema) so the service can run standalone in local development.
-- That code and this migration must stay identical; this file is the source of
-- truth. Every statement is idempotent, so the two can safely both run.
-- ================================================================================

-- --------------------------------------------------------------------------------
-- Registered OAuth clients: the AI apps allowed to start an authorization.
-- Created either by Dynamic Client Registration (RFC 7591 — the app registers
-- itself, source='dcr') or by an admin generating a client id in the MCP settings
-- page for an app that cannot self-register (source='manual', scoped to the
-- institute that created it). All clients are PUBLIC clients: no secret is
-- issued and PKCE is mandatory, so client_secret_hash stays NULL today and
-- exists only so a confidential client can be supported without a migration.
-- redirect_uris is fixed at registration, which is what stops a client id being
-- re-pointed at somewhere else later.
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_oauth_client (
    client_id                VARCHAR(255) PRIMARY KEY,
    client_secret_hash       VARCHAR(255),                         -- NULL for public (PKCE) clients
    client_name              VARCHAR(255),                         -- shown on the consent screen
    redirect_uris            TEXT         NOT NULL,                -- JSON array; https or loopback only
    grant_types              TEXT,                                 -- JSON array
    scope                    TEXT,
    client_metadata          TEXT,                                 -- full RFC 7591 registration, as sent
    institute_id             VARCHAR(255),                         -- set for 'manual' clients only
    created_by               VARCHAR(255),                         -- admin user id, for 'manual' clients
    source                   VARCHAR(32)  NOT NULL DEFAULT 'dcr',  -- 'dcr' | 'manual'
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    client_secret_expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_client_institute ON mcp_oauth_client(institute_id);

COMMENT ON TABLE mcp_oauth_client IS
    'AI apps registered against the MCP server: self-registered via RFC 7591 (source=dcr) or issued by an institute admin (source=manual)';

-- --------------------------------------------------------------------------------
-- A parked /authorize request. When an AI app starts the flow nobody is signed in
-- yet, so the request is stored here and the browser is sent to the dashboard
-- consent page with an opaque txn handle. It carries the PKCE challenge and the
-- OAuth state so neither can be tampered with while the user logs in.
-- Short-lived, and consumed_at makes it single-use: a consent link cannot be
-- replayed into a second grant.
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_oauth_txn (
    txn                   VARCHAR(255) PRIMARY KEY,               -- opaque handle in the consent URL
    client_id             VARCHAR(255) NOT NULL,
    redirect_uri          TEXT         NOT NULL,
    redirect_uri_provided BOOLEAN      NOT NULL DEFAULT TRUE,
    code_challenge        VARCHAR(255),                           -- PKCE S256
    state                 TEXT,                                   -- echoed back to the client
    scopes                TEXT,                                   -- JSON array
    resource              TEXT,                                   -- RFC 8707 resource indicator
    expires_at            TIMESTAMPTZ  NOT NULL,                  -- ~15 min
    consumed_at           TIMESTAMPTZ,                            -- set on approve/deny; single use
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_txn_expires ON mcp_oauth_txn(expires_at);

COMMENT ON TABLE mcp_oauth_txn IS
    'Pending MCP /authorize requests, parked while the admin signs in and approves on the dashboard consent page';

-- --------------------------------------------------------------------------------
-- The authorization code. This is the ONLY place a Vacademy identity is bound to
-- an MCP authorization: it is written the moment an admin approves, and carries
-- who approved, for which institute, and their platform tokens (encrypted).
-- Short TTL, and used_at is set by an UPDATE guarded on used_at IS NULL, so a
-- replayed code loses the race and nothing is issued twice.
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_oauth_code (
    code                 VARCHAR(255) PRIMARY KEY,                -- SHA-256 of the code, never the code
    client_id            VARCHAR(255) NOT NULL,
    user_id              VARCHAR(255) NOT NULL,                   -- the approving staff member
    institute_id         VARCHAR(255) NOT NULL,                   -- the institute they granted
    username             VARCHAR(255),
    redirect_uri         TEXT         NOT NULL,
    code_challenge       VARCHAR(255),                            -- PKCE, verified at /token
    scopes               TEXT,                                    -- JSON array
    resource             TEXT,                                    -- RFC 8707 resource indicator
    platform_access_enc  TEXT,                                    -- Fernet-encrypted Vacademy JWT
    platform_refresh_enc TEXT,                                    -- Fernet-encrypted Vacademy refresh token
    expires_at           TIMESTAMPTZ  NOT NULL,                   -- ~5 min (OAuth 2.1 guidance)
    used_at              TIMESTAMPTZ,                             -- single use
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_code_expires ON mcp_oauth_code(expires_at);

COMMENT ON TABLE mcp_oauth_code IS
    'Single-use MCP authorization codes; the only place a Vacademy user + institute is bound to an AI client authorization';

-- --------------------------------------------------------------------------------
-- Issued access and refresh tokens — the table every MCP request reads. Two rows
-- per connection (kind='access' and kind='refresh') sharing a pair_id, so
-- revoking either revokes both, as RFC 7009 recommends. Refresh rotates: the
-- presented refresh token is burned and a fresh pair issued.
--
-- The row, not the token string, is what carries authority: user_id and
-- institute_id are read from here on every call and the stored platform JWT is
-- replayed to admin-core, so a connection can never do more than the person who
-- approved it. Roles are deliberately NOT stored — they are re-read from that
-- JWT each request, so losing a role takes effect immediately.
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_oauth_token (
    token_hash           VARCHAR(255) PRIMARY KEY,                -- SHA-256 of the issued token
    kind                 VARCHAR(16)  NOT NULL,                   -- 'access' | 'refresh'
    pair_id              VARCHAR(255) NOT NULL,                   -- ties the access+refresh pair together
    client_id            VARCHAR(255) NOT NULL,
    user_id              VARCHAR(255) NOT NULL,
    institute_id         VARCHAR(255) NOT NULL,
    username             VARCHAR(255),
    scopes               TEXT,                                    -- JSON array
    resource             TEXT,                                    -- RFC 8707; tokens are audience-bound
    platform_access_enc  TEXT,                                    -- Fernet-encrypted Vacademy JWT
    platform_refresh_enc TEXT,                                    -- Fernet-encrypted Vacademy refresh token
    expires_at           TIMESTAMPTZ  NOT NULL,                   -- 1h access / 30d refresh
    revoked_at           TIMESTAMPTZ,                             -- set by rotation, revoke, or an admin
    last_used_at         TIMESTAMPTZ,                             -- powers "last used" in the settings UI
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_token_pair      ON mcp_oauth_token(pair_id);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_token_institute ON mcp_oauth_token(institute_id);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_token_user      ON mcp_oauth_token(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_token_expires   ON mcp_oauth_token(expires_at);

COMMENT ON TABLE mcp_oauth_token IS
    'Live MCP access/refresh tokens; the row carries the user, institute and encrypted platform credentials an opaque token resolves to';

-- --------------------------------------------------------------------------------
-- Audit: one row per tools/call. Arguments are kept because they are what the
-- model asked for and are small; RESULTS are deliberately not, since they can be
-- large and full of learner PII. Tokens are never written here.
-- --------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mcp_tool_call_log (
    id           VARCHAR(255) PRIMARY KEY,
    user_id      VARCHAR(255),
    institute_id VARCHAR(255),
    client_id    VARCHAR(255),
    client_name  VARCHAR(255),                                    -- which AI app made the call
    tool_name    VARCHAR(255),
    args_json    TEXT,
    ok           BOOLEAN,
    error_code   VARCHAR(64),                                     -- e.g. tool_not_permitted, tool_failed
    duration_ms  INTEGER,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_call_log_institute ON mcp_tool_call_log(institute_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_call_log_created   ON mcp_tool_call_log(created_at);

COMMENT ON TABLE mcp_tool_call_log IS
    'Audit trail of MCP tool calls: who, from which AI app, which tool, and whether it succeeded';
