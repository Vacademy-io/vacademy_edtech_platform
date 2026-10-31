"""
Tables ai_service reads and writes but never creates.

ai_service shares admin-core's database, and schema changes for it ship through
admin-core's Flyway migrations only. ai_service runs NO DDL for these tables, at
startup or on first use: it only checks that a table exists and, when it does
not, logs an error naming the migration to apply. The check never raises, so a
missing table (or a database hiccup) cannot crash startup; the tool that needs
the table then reports that its storage is unavailable.
"""
from __future__ import annotations

import logging

from sqlalchemy import inspect
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class TableMissing(RuntimeError):
    """A Flyway-owned table this code needs is not in the database."""


def table_present(db: Session, table: str, migration: str) -> bool:
    """True when ``table`` exists. Logs an error and returns False otherwise; never raises."""
    try:
        present = inspect(db.get_bind()).has_table(table)
    except Exception as exc:  # noqa: BLE001
        logger.error("could not check for table %s (admin_core Flyway %s): %s", table, migration, exc)
        return False
    if not present:
        logger.error(
            "table %s is missing: apply admin_core_service Flyway migration %s. "
            "ai_service does not create it; the tools that use it fail until then.", table, migration)
    return present


__all__ = ["TableMissing", "table_present"]
