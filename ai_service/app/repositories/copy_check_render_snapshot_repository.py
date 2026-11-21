"""Repository for copy_check_render_snapshot: what each checked copy was drawn from.

Created by admin_core Flyway V637__copy_check_render_snapshot.sql; ai_service
runs no DDL for it. One row per evaluation process, overwritten by a re-check.
Saving is best-effort: a missing table or a database error must never cost a
student the checked copy, it only means that copy cannot be re-drawn later.
"""
from __future__ import annotations

import base64
import json
import logging
import zlib
from dataclasses import dataclass
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Layout maps carry every OCR line of every page, so the JSON is stored
# zlib-compressed (base64 text, "z1:" prefix) - several times smaller - to keep
# one row per checked copy from bloating the shared database. Plain JSON is
# still read, for rows written any other way.
_PACKED = "z1:"


def _pack(value: Any) -> str:
    raw = json.dumps(value, default=str, separators=(",", ":")).encode("utf-8")
    return _PACKED + base64.b64encode(zlib.compress(raw, 6)).decode("ascii")


def _unpack(text: Optional[str]) -> Any:
    if text is None:
        return None
    if text.startswith(_PACKED):
        return json.loads(zlib.decompress(base64.b64decode(text[len(_PACKED):])).decode("utf-8"))
    return json.loads(text)

MIGRATION = "V637__copy_check_render_snapshot.sql"

_UPSERT = text(
    "INSERT INTO copy_check_render_snapshot "
    "  (process_id, attempt_id, institute_id, layout_json, verdicts_json, options_json, created_at, updated_at) "
    "VALUES (:process_id, :attempt_id, :institute_id, :layout_json, :verdicts_json, :options_json, now(), now()) "
    "ON CONFLICT (process_id) DO UPDATE SET "
    "  attempt_id = EXCLUDED.attempt_id, institute_id = EXCLUDED.institute_id, "
    "  layout_json = EXCLUDED.layout_json, verdicts_json = EXCLUDED.verdicts_json, "
    "  options_json = EXCLUDED.options_json, updated_at = now()"
)

_GET = text(
    "SELECT process_id, attempt_id, institute_id, layout_json, verdicts_json, options_json "
    "FROM copy_check_render_snapshot WHERE process_id = :process_id"
)


@dataclass
class RenderSnapshot:
    process_id: str
    attempt_id: Optional[str]
    institute_id: Optional[str]
    layout_map: dict[str, Any]
    verdicts: list[dict[str, Any]]
    options: dict[str, Any]


def save(db: Session, process_id: str, attempt_id: Optional[str], institute_id: Optional[str],
         layout_map: dict[str, Any], verdicts: list[dict[str, Any]], options: dict[str, Any]) -> bool:
    """Store the render inputs. Returns False (and logs) on any failure; never raises."""
    try:
        db.execute(_UPSERT, {
            "process_id": process_id,
            "attempt_id": attempt_id,
            "institute_id": institute_id,
            "layout_json": _pack(layout_map),
            "verdicts_json": _pack(verdicts),
            "options_json": _pack(options or {}),
        })
        db.commit()
        return True
    except Exception as exc:  # noqa: BLE001
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        logger.warning("copy-check %s: render snapshot not saved (admin_core Flyway %s?): %s",
                       process_id, MIGRATION, exc)
        return False


def save_in_own_session(process_id: str, attempt_id: Optional[str], institute_id: Optional[str],
                        layout_map: dict[str, Any], verdicts: list[dict[str, Any]],
                        options: dict[str, Any]) -> bool:
    """`save` on a short session of its own. The grading run closes its session
    before the long OCR/grading work to give the connection back, so the
    snapshot must not reopen that one. Never raises."""
    try:
        from ..db import db_session
        with db_session() as db:
            return save(db, process_id, attempt_id, institute_id, layout_map, verdicts, options)
    except Exception as exc:  # noqa: BLE001
        logger.warning("copy-check %s: render snapshot not saved: %s", process_id, exc)
        return False


def get(db: Session, process_id: str) -> Optional[RenderSnapshot]:
    row = db.execute(_GET, {"process_id": process_id}).mappings().first()
    if row is None:
        return None
    return RenderSnapshot(
        process_id=row["process_id"],
        attempt_id=row["attempt_id"],
        institute_id=row["institute_id"],
        layout_map=_unpack(row["layout_json"]),
        verdicts=_unpack(row["verdicts_json"]),
        options=_unpack(row["options_json"]) or {},
    )
