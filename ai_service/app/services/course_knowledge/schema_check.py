"""Startup check that admin_core's V600 course-knowledge migration has run.

ai_service never migrates admin_core tables. When this pod starts against a
database without V600, the course-knowledge code would fail on every call, so
the lifespan logs ONE clear error naming the migration instead. Never raises.
"""
from __future__ import annotations

import logging
from typing import List

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

MIGRATION_NAME = "admin_core V600__Course_knowledge.sql"

REQUIRED_TABLES = (
    "content_index_queue",
    "course_knowledge_setting",
    "course_knowledge_budget",
    "course_knowledge_run",
    "course_extract_cache",
    "course_knowledge_link",
)
REQUIRED_COLUMNS = (
    ("kb_chunk", "embedding_768_scoped"),
    ("knowledge_base_source", "slide_id"),
)

_TABLES_SQL = text(
    """
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = ANY (current_schemas(false)) AND table_name IN :names
    """
).bindparams(bindparam("names", expanding=True))

_COLUMNS_SQL = text(
    """
    SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = ANY (current_schemas(false)) AND table_name IN :tables
    """
).bindparams(bindparam("tables", expanding=True))


def missing_course_knowledge_schema(db: Session) -> List[str]:
    """Names of the V600 tables / columns this database lacks (empty = all there)."""
    found_tables = {r[0] for r in db.execute(_TABLES_SQL, {"names": list(REQUIRED_TABLES)}).fetchall()}
    missing = [t for t in REQUIRED_TABLES if t not in found_tables]
    tables = sorted({t for t, _c in REQUIRED_COLUMNS})
    found_cols = {(r[0], r[1]) for r in db.execute(_COLUMNS_SQL, {"tables": tables}).fetchall()}
    missing += [f"{t}.{c}" for t, c in REQUIRED_COLUMNS if (t, c) not in found_cols]
    return missing


def check_course_knowledge_schema(db: Session) -> bool:
    """True when every V600 table and column exists. Logs one error otherwise
    (or when the check itself fails) and returns False; never raises."""
    try:
        missing = missing_course_knowledge_schema(db)
    except Exception as exc:  # noqa: BLE001 - a startup check must not stop the pod
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        logger.error("course knowledge: schema check failed (%s); is %s applied?", exc, MIGRATION_NAME)
        return False
    if missing:
        logger.error(
            "course knowledge: missing %s from %s; course knowledge stays off until it runs",
            ", ".join(missing), MIGRATION_NAME,
        )
        return False
    return True


__all__ = ["REQUIRED_TABLES", "REQUIRED_COLUMNS", "missing_course_knowledge_schema",
           "check_course_knowledge_schema"]
