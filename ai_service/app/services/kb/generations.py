"""History of what a knowledge base has produced (V444).

One record per artifact — a question paper today, a course or presentation later
— carrying both the REQUEST (so it can be resumed) and the RESULT (so the history
stands on its own).

Kept deliberately artifact-agnostic: nothing here knows what a question paper is.
A new capability supplies its own `artifact_type`, its own `input_json` shape and
its own renderer; this module stores, lists and updates rows.

Every write is best-effort. History is a convenience, and losing a history row
must never fail the generation the user actually asked for.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

ARTIFACT_TYPES = (
    "QUESTION_PAPER", "COURSE", "PRESENTATION", "QUIZ", "ASSESSMENT",
    "NOTES", "SUMMARY", "LESSON_PLAN", "WORKSHEET",
)
STATUSES = ("DRAFT", "GENERATING", "READY", "SAVED", "FAILED")

# Result payloads are large (a 60-question paper is ~130KB). The list endpoint
# never returns them; only the single-record read does.
_LIST_COLUMNS = """
    id, knowledge_base_id, institute_id, artifact_type, title, status, progress,
    external_id, external_type, ai_task_id, items_planned, items_delivered,
    credits_charged, error_message, created_by, created_at, updated_at,
    result_json -> 'published'
"""


def _row(r, *, with_payloads: bool = False) -> Dict[str, Any]:
    out = {
        "id": r[0], "knowledge_base_id": r[1], "institute_id": r[2],
        "artifact_type": r[3], "title": r[4], "status": r[5], "progress": int(r[6] or 0),
        "external_id": r[7], "external_type": r[8], "ai_task_id": r[9],
        "items_planned": int(r[10] or 0), "items_delivered": int(r[11] or 0),
        "credits_charged": float(r[12] or 0), "error_message": r[13],
        "created_by": r[14],
        "created_at": r[15].isoformat() if r[15] else None,
        "updated_at": r[16].isoformat() if r[16] else None,
        # Shareable PDF links, keyed by variant ("question_paper", "with_answer_key").
        # Small enough to ride the list: history shows "Copy link" without a
        # second fetch.
        "published": r[17] or {},
    }
    if with_payloads:
        out["input"] = r[18] or {}
        out["result"] = r[19]
    return out


def create(
    db: Session,
    *,
    kb_id: str,
    institute_id: str,
    artifact_type: str,
    title: str,
    status: str = "GENERATING",
    input_payload: Optional[Dict[str, Any]] = None,
    ai_task_id: Optional[str] = None,
    items_planned: int = 0,
    created_by: Optional[str] = None,
) -> Optional[str]:
    """Record that something is being made. Returns the generation id, or None."""
    if artifact_type not in ARTIFACT_TYPES:
        logger.warning("Unknown artifact_type %r; history row skipped", artifact_type)
        return None
    try:
        row = db.execute(
            text(
                """
                INSERT INTO knowledge_base_generation
                    (knowledge_base_id, institute_id, artifact_type, title, status,
                     input_json, ai_task_id, items_planned, created_by)
                VALUES
                    (:kb_id, :institute_id, :artifact_type, :title, :status,
                     CAST(:input_json AS jsonb), :ai_task_id, :items_planned, :created_by)
                RETURNING id
                """
            ),
            {
                "kb_id": kb_id, "institute_id": institute_id,
                "artifact_type": artifact_type, "title": title[:500], "status": status,
                "input_json": json.dumps(input_payload or {}),
                "ai_task_id": ai_task_id, "items_planned": items_planned,
                "created_by": created_by,
            },
        ).fetchone()
        db.commit()
        return str(row[0])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not record generation history: %s", exc)
        db.rollback()
        return None


def update(
    db: Session,
    generation_id: str,
    *,
    status: Optional[str] = None,
    progress: Optional[int] = None,
    title: Optional[str] = None,
    input_payload: Optional[Dict[str, Any]] = None,
    result_payload: Optional[Dict[str, Any]] = None,
    external_id: Optional[str] = None,
    external_type: Optional[str] = None,
    items_delivered: Optional[int] = None,
    credits_charged: Optional[float] = None,
    error_message: Optional[str] = None,
) -> None:
    """Patch a history row. Silently no-ops on failure — see module docstring."""
    sets: List[str] = []
    params: Dict[str, Any] = {"id": generation_id}
    for col, val in (
        ("status", status), ("progress", progress), ("title", title),
        ("external_id", external_id), ("external_type", external_type),
        ("items_delivered", items_delivered), ("credits_charged", credits_charged),
        ("error_message", error_message),
    ):
        if val is not None:
            sets.append(f"{col} = :{col}")
            params[col] = val
    if input_payload is not None:
        sets.append("input_json = CAST(:input_json AS jsonb)")
        params["input_json"] = json.dumps(input_payload)
    if result_payload is not None:
        sets.append("result_json = CAST(:result_json AS jsonb)")
        params["result_json"] = json.dumps(result_payload)
    if not sets:
        return
    sets.append("updated_at = CURRENT_TIMESTAMP")
    try:
        db.execute(
            text(f"UPDATE knowledge_base_generation SET {', '.join(sets)} WHERE id = :id"),
            params,
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not update generation %s: %s", generation_id, exc)
        db.rollback()


def list_for_kb(
    db: Session,
    kb_id: str,
    institute_id: str,
    *,
    artifact_type: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """History for one knowledge base, newest first. Payloads omitted.

    institute_id is REQUIRED and positional on purpose. A shared PLATFORM
    library is readable by every institute, so scoping only by knowledge_base_id
    would show each tenant what every other tenant has been making from it —
    paper titles alone reveal what a competing institute is teaching and when.
    """
    clause = "AND artifact_type = :artifact_type" if artifact_type else ""
    params: Dict[str, Any] = {
        "kb_id": kb_id, "institute_id": institute_id, "limit": limit,
    }
    if artifact_type:
        params["artifact_type"] = artifact_type
    rows = db.execute(
        text(
            f"""
            SELECT {_LIST_COLUMNS}
            FROM knowledge_base_generation
            WHERE knowledge_base_id = :kb_id
              AND institute_id = :institute_id {clause}
            ORDER BY created_at DESC
            LIMIT :limit
            """
        ),
        params,
    ).fetchall()
    return [_row(r) for r in rows]


def list_for_institute(
    db: Session,
    institute_id: str,
    *,
    artifact_type: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Everything this institute has created, across knowledge bases."""
    clause = "AND artifact_type = :artifact_type" if artifact_type else ""
    params: Dict[str, Any] = {"institute_id": institute_id, "limit": limit}
    if artifact_type:
        params["artifact_type"] = artifact_type
    rows = db.execute(
        text(
            f"""
            SELECT {_LIST_COLUMNS}
            FROM knowledge_base_generation
            WHERE institute_id = :institute_id {clause}
            ORDER BY created_at DESC
            LIMIT :limit
            """
        ),
        params,
    ).fetchall()
    return [_row(r) for r in rows]


def get(db: Session, generation_id: str, institute_id: str) -> Optional[Dict[str, Any]]:
    """One record WITH its input and result — this is what Resume reads.

    Tenant scope is in the WHERE clause, so a generation id from another
    institute is a 404 rather than a leak.
    """
    row = db.execute(
        text(
            f"""
            SELECT {_LIST_COLUMNS}, input_json, result_json
            FROM knowledge_base_generation
            WHERE id = :id AND institute_id = :institute_id
            """
        ),
        {"id": generation_id, "institute_id": institute_id},
    ).fetchone()
    return _row(row, with_payloads=True) if row else None


def record_published_link(
    db: Session, generation_id: str, institute_id: str, variant: str, link: Dict[str, Any]
) -> None:
    """Remember where a variant of the paper was published.

    Written into result_json.published.<variant> with jsonb_set so the
    questions already stored there are untouched. Best effort like update():
    the link was handed to the caller either way."""
    try:
        db.execute(
            text(
                """
                UPDATE knowledge_base_generation
                   SET result_json = jsonb_set(
                           jsonb_set(
                               COALESCE(result_json, '{}'::jsonb),
                               '{published}',
                               COALESCE(result_json -> 'published', '{}'::jsonb),
                               true
                           ),
                           ARRAY['published', :variant],
                           CAST(:link AS jsonb),
                           true
                       ),
                       updated_at = CURRENT_TIMESTAMP
                 WHERE id = :id AND institute_id = :institute_id
                """
            ),
            {"id": generation_id, "institute_id": institute_id,
             "variant": variant, "link": json.dumps(link)},
        )
        db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("Could not record published link on generation %s", generation_id)
        db.rollback()


def delete(db: Session, generation_id: str, institute_id: str) -> bool:
    result = db.execute(
        text(
            "DELETE FROM knowledge_base_generation "
            "WHERE id = :id AND institute_id = :institute_id"
        ),
        {"id": generation_id, "institute_id": institute_id},
    )
    db.commit()
    return bool(result.rowcount)


__all__ = [
    "create", "update", "get", "delete", "list_for_kb", "list_for_institute",
    "ARTIFACT_TYPES", "STATUSES",
]
