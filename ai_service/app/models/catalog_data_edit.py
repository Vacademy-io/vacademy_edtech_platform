"""
Records ``catalog_data_edit`` keeps of what IT created — today the folder
libraries made by ``create_folder_library``.

The tool may change existing nodes only in a library it created itself, or in
one no live site uses. A library's ``created_by`` is the admin's own user id
(the MCP replays the admin's token), so admin-core cannot tell the two apart:
this table can. One row per created record, filtered by the caller's pinned
institute on every read. Rows are never updated or deleted by the tool.

The admin_core Flyway migration
V562__mcp_catalog_data_record_and_publish_confirm.sql creates the table; keep
this model identical to it (test_mcp_tables_migration_parity). ai_service runs
no DDL for it: it only checks the table exists.
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, Index, String
from sqlalchemy.orm import Session, declarative_base

from .flyway_owned import table_present

Base = declarative_base()


class CatalogDataRecord(Base):
    __tablename__ = "mcp_catalog_data_record"

    id = Column(String(32), primary_key=True)
    institute_id = Column(String(255), nullable=False)
    #: What was created: "folder_library".
    kind = Column(String(40), nullable=False)
    record_id = Column(String(255), nullable=False)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("idx_mcp_catalog_data_record_lookup", "institute_id", "kind", "record_id"),
    )


def check_catalog_data_schema(db: Session) -> bool:
    """True when mcp_catalog_data_record exists. NO DDL: admin_core Flyway V562 creates it.
    Logs an error and returns False when it is missing; never raises."""
    return table_present(db, CatalogDataRecord.__tablename__, "V562__mcp_catalog_data_record_and_publish_confirm.sql")


__all__ = ["CatalogDataRecord", "check_catalog_data_schema"]
