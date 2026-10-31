"""Shadow-mode results kept across deploys (V602 course_knowledge_shadow_event).

The shadow probe (ai_chat_agent_service._course_shadow_probe) records one row
per learner turn: counts and timings only, never the question or the passages.
summary() gives the go-live numbers for an institute (spec: p95 added latency
under 400 ms, lessons matched often enough, leak_blocked = 0); the drift sweep
calls purge() so the table keeps 30 days.

record() opens its own short session and never raises: a missing table (the
admin_core migration not applied yet) or a failed insert only loses one row.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...db import db_session

logger = logging.getLogger(__name__)

RETENTION_DAYS = 30
GO_LIVE_P95_MS = 400

_INSERT_SQL = text(
    """
    INSERT INTO course_knowledge_shadow_event
        (institute_id, session_id, open_lessons, hits, signposts, kb_refs, top_similarity,
         latency_ms, total_ms, truncated, block_chars, leak_blocked, error)
    VALUES (:i, :s, :open, :hits, :signposts, :refs, :top, :latency, :total, :truncated, :block, :leak, :error)
    """
)

_SUMMARY_SQL = text(
    """
    SELECT count(*),
           count(*) FILTER (WHERE hits > 0),
           count(*) FILTER (WHERE open_lessons = 0),
           count(*) FILTER (WHERE error IS NOT NULL AND error <> 'no_lessons'),
           COALESCE(sum(leak_blocked), 0),
           percentile_cont(0.5)  WITHIN GROUP (ORDER BY total_ms),
           percentile_cont(0.95) WITHIN GROUP (ORDER BY total_ms),
           percentile_cont(0.5)  WITHIN GROUP (ORDER BY top_similarity),
           count(DISTINCT session_id),
           min(created_at), max(created_at)
      FROM course_knowledge_shadow_event
     WHERE institute_id = :i AND created_at >= now() - make_interval(hours => :h)
    """
)

_PURGE_SQL = text(
    "DELETE FROM course_knowledge_shadow_event WHERE created_at < now() - make_interval(days => :d)"
)


def record(
    *,
    institute_id: str,
    session_id: Optional[str],
    open_lessons: int = 0,
    hits: int = 0,
    signposts: int = 0,
    kb_refs: int = 0,
    top_similarity: Optional[float] = None,
    latency_ms: int = 0,
    total_ms: int = 0,
    truncated: bool = False,
    block_chars: int = 0,
    leak_blocked: int = 0,
    error: Optional[str] = None,
) -> bool:
    """One probe result. Blocking: call it via asyncio.to_thread."""
    params = {
        "i": institute_id, "s": (session_id or None) and str(session_id)[:255],
        "open": int(open_lessons), "hits": int(hits), "signposts": int(signposts), "refs": int(kb_refs),
        "top": float(top_similarity) if top_similarity is not None else None,
        "latency": int(latency_ms), "total": int(total_ms), "truncated": bool(truncated),
        "block": int(block_chars), "leak": int(leak_blocked), "error": (error or None) and str(error)[:64],
    }
    try:
        with db_session() as db:
            db.execute(_INSERT_SQL, params)
            db.commit()
        return True
    except Exception as exc:  # noqa: BLE001 - one lost row, never a learner-facing error
        logger.warning("course knowledge: could not record a shadow probe for %s: %s", institute_id, str(exc)[:200])
        return False


def _num(value: Any, digits: int = 0) -> Optional[float]:
    if value is None:
        return None
    return round(float(value), digits) if digits else int(round(float(value)))


def summary(db: Session, institute_id: str, hours: int = 72) -> Dict[str, Any]:
    """The go-live numbers for the last `hours`."""
    row = db.execute(_SUMMARY_SQL, {"i": institute_id, "h": int(hours)}).first()
    turns = int(row[0] or 0) if row else 0
    out: Dict[str, Any] = {
        "institute_id": institute_id, "hours": int(hours), "turns": turns,
        "sessions": int(row[8] or 0) if row else 0,
        "turns_with_hits": int(row[1] or 0) if row else 0,
        "turns_with_no_open_lessons": int(row[2] or 0) if row else 0,
        "errors": int(row[3] or 0) if row else 0,
        "leak_blocked": int(row[4] or 0) if row else 0,
        "total_ms_p50": _num(row[5]) if row else None,
        "total_ms_p95": _num(row[6]) if row else None,
        "top_similarity_p50": _num(row[7], 3) if row else None,
        "first_at": row[9].isoformat() if row and row[9] else None,
        "last_at": row[10].isoformat() if row and row[10] else None,
    }
    out["hit_rate"] = round(out["turns_with_hits"] / turns, 3) if turns else None
    p95 = out["total_ms_p95"]
    out["meets_latency_bar"] = (p95 is not None and p95 < GO_LIVE_P95_MS) if turns else None
    return out


def purge(db: Session, days: int = RETENTION_DAYS) -> int:
    """Delete rows older than `days`. Does not commit."""
    return int(db.execute(_PURGE_SQL, {"d": int(days)}).rowcount or 0)


__all__ = ["record", "summary", "purge", "RETENTION_DAYS", "GO_LIVE_P95_MS"]
