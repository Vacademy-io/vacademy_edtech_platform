"""
Idempotent DDL for the MCP OAuth + audit tables.

Same contract as the other ``ensure_*_schema`` helpers in this service: safe to
run on every boot, one statement per list entry (psycopg3's extended protocol
rejects multiple commands in a single execute()), and failures are logged rather
than raised so a transient DB hiccup at startup cannot crash the app.

The SOURCE OF TRUTH for this schema is the Flyway migration
``admin_core_service/src/main/resources/db/migration/V519__mcp_server_oauth_and_audit.sql``
— ai_service shares admin-core's database, so schema changes ship through
Flyway like every other table. This function exists so the service can still run
standalone in local development, and because it is idempotent it is a harmless
no-op once Flyway has created the tables. Keep the two in step: if you change a
column here, change it there.
"""
from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


_ENSURE_TABLE_STATEMENTS = [
    # Registered OAuth clients. Created by Dynamic Client Registration (an MCP
    # client registering itself) or by an admin generating a "manual" client id
    # to paste into an LLM app that cannot do DCR. Manual clients carry the
    # institute that owns them; DCR clients do not (any institute may use them).
    """
    CREATE TABLE IF NOT EXISTS mcp_oauth_client (
        client_id          VARCHAR(255) PRIMARY KEY,
        client_secret_hash VARCHAR(255),
        client_name        VARCHAR(255),
        redirect_uris      TEXT NOT NULL,
        grant_types        TEXT,
        scope              TEXT,
        client_metadata    TEXT,
        institute_id       VARCHAR(255),
        created_by         VARCHAR(255),
        source             VARCHAR(32) NOT NULL DEFAULT 'dcr',
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        client_secret_expires_at TIMESTAMPTZ
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_mcp_oauth_client_institute ON mcp_oauth_client(institute_id)",

    # A pending authorization: created when the client hits /authorize, consumed
    # when the admin approves or denies on the dashboard consent page.
    """
    CREATE TABLE IF NOT EXISTS mcp_oauth_txn (
        txn                   VARCHAR(255) PRIMARY KEY,
        client_id             VARCHAR(255) NOT NULL,
        redirect_uri          TEXT NOT NULL,
        redirect_uri_provided BOOLEAN NOT NULL DEFAULT TRUE,
        code_challenge        VARCHAR(255),
        state                 TEXT,
        scopes                TEXT,
        resource              TEXT,
        expires_at            TIMESTAMPTZ NOT NULL,
        consumed_at           TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_mcp_oauth_txn_expires ON mcp_oauth_txn(expires_at)",

    # A single-use authorization code, carrying the approving user's identity and
    # their (encrypted) platform tokens until it is exchanged at /token.
    """
    CREATE TABLE IF NOT EXISTS mcp_oauth_code (
        code                 VARCHAR(255) PRIMARY KEY,
        client_id            VARCHAR(255) NOT NULL,
        user_id              VARCHAR(255) NOT NULL,
        institute_id         VARCHAR(255) NOT NULL,
        username             VARCHAR(255),
        redirect_uri         TEXT NOT NULL,
        code_challenge       VARCHAR(255),
        scopes               TEXT,
        resource             TEXT,
        platform_access_enc  TEXT,
        platform_refresh_enc TEXT,
        expires_at           TIMESTAMPTZ NOT NULL,
        used_at              TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_mcp_oauth_code_expires ON mcp_oauth_code(expires_at)",

    # Issued access + refresh tokens, stored as SHA-256 hashes. ``pair_id`` ties
    # an access token to the refresh token minted with it, so revoking either
    # kills both (RFC 7009 guidance).
    """
    CREATE TABLE IF NOT EXISTS mcp_oauth_token (
        token_hash           VARCHAR(255) PRIMARY KEY,
        kind                 VARCHAR(16) NOT NULL,
        pair_id              VARCHAR(255) NOT NULL,
        client_id            VARCHAR(255) NOT NULL,
        user_id              VARCHAR(255) NOT NULL,
        institute_id         VARCHAR(255) NOT NULL,
        username             VARCHAR(255),
        scopes               TEXT,
        resource             TEXT,
        platform_access_enc  TEXT,
        platform_refresh_enc TEXT,
        expires_at           TIMESTAMPTZ NOT NULL,
        revoked_at           TIMESTAMPTZ,
        last_used_at         TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_mcp_oauth_token_pair      ON mcp_oauth_token(pair_id)",
    "CREATE INDEX IF NOT EXISTS idx_mcp_oauth_token_institute ON mcp_oauth_token(institute_id)",
    "CREATE INDEX IF NOT EXISTS idx_mcp_oauth_token_user      ON mcp_oauth_token(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_mcp_oauth_token_expires   ON mcp_oauth_token(expires_at)",

    # Audit trail: one row per tools/call. Arguments are stored, results are not
    # (they can be large and contain learner PII); tokens never are.
    """
    CREATE TABLE IF NOT EXISTS mcp_tool_call_log (
        id           VARCHAR(255) PRIMARY KEY,
        user_id      VARCHAR(255),
        institute_id VARCHAR(255),
        client_id    VARCHAR(255),
        client_name  VARCHAR(255),
        tool_name    VARCHAR(255),
        args_json    TEXT,
        ok           BOOLEAN,
        error_code   VARCHAR(64),
        duration_ms  INTEGER,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_mcp_tool_call_log_institute ON mcp_tool_call_log(institute_id)",
    "CREATE INDEX IF NOT EXISTS idx_mcp_tool_call_log_created   ON mcp_tool_call_log(created_at)",
]


def ensure_mcp_schema(db: Session) -> None:
    """Create the MCP OAuth + audit tables if missing. Idempotent."""
    try:
        for stmt in _ENSURE_TABLE_STATEMENTS:
            db.execute(text(stmt))
        db.commit()
        logger.info("mcp schema ensured.")
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("ensure_mcp_schema failed (will rely on external migration): %s", exc)


__all__ = ["ensure_mcp_schema"]
