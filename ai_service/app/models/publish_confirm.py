"""
Confirm tokens for ``website_publish``: the second step of a two-step publish
or rollback over MCP.

``website_edit(action='request_publish')`` (publish) or
``website_publish(action='rollback')`` without a token (rollback) issues one
when the caller holds the "Website: publish" capability. The token itself is
returned once and never stored: the row's id is its SHA-256, so a database
read cannot replay it. A row is bound to the institute, the user, the site
(catalogue id), the action and the exact state that was checked — the draft
revision and a hash of its JSON, or the target revision — plus the live
revision then. It expires 10 minutes after it is issued and is spent by the
first call that uses it (``used_at``), whatever that call's outcome.

Its own table, created by the admin_core Flyway migration
V562__mcp_catalog_data_record_and_publish_confirm.sql (keep this model identical
to it; test_mcp_tables_migration_parity). ai_service runs no DDL for it. Only
``assistant_tools_website_publish`` reads or writes it, always filtered by the
caller's pinned institute.
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, Index, Integer, String
from sqlalchemy.orm import Session, declarative_base

from .flyway_owned import table_present

Base = declarative_base()


class PublishConfirm(Base):
    __tablename__ = "mcp_publish_confirm"

    #: SHA-256 hex of the token handed to the caller (the token is never stored).
    id = Column(String(64), primary_key=True)
    institute_id = Column(String(255), nullable=False)
    user_id = Column(String(255), nullable=False)
    #: publish | rollback
    action = Column(String(16), nullable=False)
    catalogue_id = Column(String(255), nullable=False)
    tag_name = Column(String(255), nullable=False)
    #: publish: the draft that was checked (its id, number and the SHA-256 of its JSON text).
    draft_revision_id = Column(String(255), nullable=True)
    draft_revision_no = Column(Integer, nullable=True)
    draft_sha256 = Column(String(64), nullable=True)
    #: rollback: the PUBLISHED revision to bring back, and the SHA-256 of its JSON text.
    to_revision_id = Column(String(255), nullable=True)
    to_revision_no = Column(Integer, nullable=True)
    to_sha256 = Column(String(64), nullable=True)
    #: The live site when the token was issued (None: never published / not reported).
    live_revision_no = Column(Integer, nullable=True)
    live_sha256 = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_mcp_publish_confirm_institute", "institute_id", "created_at"),
        Index("idx_mcp_publish_confirm_expires", "expires_at"),
    )


def check_publish_confirm_schema(db: Session) -> bool:
    """True when mcp_publish_confirm exists. NO DDL: admin_core Flyway V562 creates it.
    Logs an error and returns False when it is missing; never raises."""
    return table_present(db, PublishConfirm.__tablename__, "V562__mcp_catalog_data_record_and_publish_confirm.sql")


__all__ = ["PublishConfirm", "check_publish_confirm_schema"]
