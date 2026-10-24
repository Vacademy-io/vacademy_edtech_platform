"""
Private file exports: every file an MCP / Assistant tool hands the admin as a
short-lived link instead of through the AI chat. Logic lives in
``services/file_exports.py``.

Its own table, created by the admin_core Flyway migration
V565__mcp_file_export.sql (keep this model identical to it;
tests/test_file_exports.py checks it). ai_service runs no DDL for it.
"""
from __future__ import annotations

from sqlalchemy import BigInteger, Column, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Session, declarative_base

from .flyway_owned import table_present

Base = declarative_base()

MIGRATION = "V565__mcp_file_export.sql"


class FileExport(Base):
    __tablename__ = "mcp_file_export"

    id = Column(String(36), primary_key=True)
    institute_id = Column(String(255), nullable=False)
    created_by_user_id = Column(String(255), nullable=False)
    #: the tool that built it, e.g. learner_enroll
    source_tool = Column(String(100), nullable=False)
    #: policy key in services.file_exports.EXPORT_KINDS, e.g. ENROLMENT_CREDENTIALS
    kind = Column(String(64), nullable=False)
    file_name = Column(String(255), nullable=False)
    content_type = Column(String(150), nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    #: Fernet token; NULL once consumed / expired / revoked (the row stays as audit).
    ciphertext = Column(Text, nullable=True)
    #: SHA-256 hex of the secret in the link (the secret itself is never stored).
    key_hash = Column(String(64), nullable=False)
    #: ACTIVE | CONSUMED | EXPIRED | REVOKED
    status = Column(String(20), nullable=False, default="ACTIVE")
    download_count = Column(Integer, nullable=False, default=0)
    max_downloads = Column(Integer, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    last_downloaded_at = Column(DateTime(timezone=True), nullable=True)
    #: non-sensitive context only (counts, related ids) — never the file's contents
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("idx_mcp_file_export_status_expires", "status", "expires_at"),
        Index("idx_mcp_file_export_institute", "institute_id", "created_at"),
    )


def check_file_export_schema(db: Session) -> bool:
    """True when mcp_file_export exists. NO DDL: admin_core Flyway V565 creates it.
    Logs an error and returns False when it is missing; never raises."""
    return table_present(db, FileExport.__tablename__, MIGRATION)


__all__ = ["FileExport", "check_file_export_schema", "MIGRATION"]
