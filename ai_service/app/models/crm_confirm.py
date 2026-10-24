"""
Single-use confirm tokens for the CRM tools over MCP: the second step of a
two-step outbound or bulk action (a call, an AI-call campaign, a WhatsApp send,
a bulk lead edit).

The preview call issues a token and returns it once; it is never stored. The
row's id is its SHA-256, so a database read cannot replay it. A row is bound to
the institute, the user, the action (``purpose``, ``crm.<tool>.<action>``) and
the SHA-256 of the exact resolved request; ``summary_json`` holds the resolved
target ids and counts only (never contact data or message text). The first
call that uses it spends it (``spent_at``); a newer preview of the same request
revokes the older one (``revoked_at``), which does not count towards the hourly
caps; ``outcome`` records what the apply did.

Its own table, created by the admin_core Flyway migration
V583__mcp_crm_confirm.sql (keep this model identical to it;
test_mcp_crm_confirm_parity). ai_service runs no DDL for it. Only
``services/crm_data.py`` reads or writes it, always filtered by the caller's
pinned institute and user.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, String, Text
from sqlalchemy.orm import Session, declarative_base

from .flyway_owned import table_present

Base = declarative_base()

MIGRATION = "V583__mcp_crm_confirm.sql"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CrmConfirm(Base):
    __tablename__ = "mcp_crm_confirm"

    #: SHA-256 hex of the token handed to the caller (the token is never stored).
    id = Column(String(64), primary_key=True)
    institute_id = Column(String(255), nullable=False)
    user_id = Column(String(255), nullable=False)
    #: crm.<tool>.<action>
    purpose = Column(String(64), nullable=False)
    #: SHA-256 of the canonical resolved request the preview showed.
    request_sha256 = Column(String(64), nullable=False)
    #: JSON text: the resolved target ids and counts the apply sends (no contact data).
    summary_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    spent_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    #: What the apply did: done | failed.
    outcome = Column(String(16), nullable=True)

    # Indexes (caps lookup, expiry purge) are owned by the Flyway migration.


def check_crm_confirm_schema(db: Session) -> bool:
    """True when mcp_crm_confirm exists. NO DDL: admin_core Flyway V583 owns it.
    Logs an error and returns False when it is missing; never raises."""
    return table_present(db, CrmConfirm.__tablename__, MIGRATION)


__all__ = ["CrmConfirm", "check_crm_confirm_schema"]
