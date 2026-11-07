"""Make course AI-ready runs (table course_knowledge_run, spec §7.5) and the
other admin writes: scan, process, cancel, retry, delete data.

  * SCAN (free): every visible lesson of the course is queued with
    allow_paid=false. One RUNNING scan per course, and at most one new scan
    per course every SCAN_COOLDOWN_SECONDS.
  * PROCESS (paid): the lessons the quote charges for are queued with
    allow_paid=true under a run budget whose cap is the accepted quote, so the
    worker can never spend more than the admin approved. One RUNNING process
    run per course.
  * Runs close in the sweep (DONE / PARTIAL); cancel closes one at once.

Run creation takes a transaction-scoped advisory lock per course
(pg_advisory_xact_lock, safe under pgbouncer transaction pooling), so two
clicks on two replicas cannot both pass the "already running" check. Every
write is decided from RETURNING, never rowcount (psycopg 3 reports -1 for
INSERT .. ON CONFLICT).

Functions that write commit once at the end, unless noted. No network calls.
CAST(:x AS type), never ``::`` after a bind.
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List, Mapping, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from . import budget, settings_store, store
from .coverage import Quote, num
from .queue import enqueue_slides, run_progress

logger = logging.getLogger(__name__)

KIND_SCAN = "SCAN"
KIND_PROCESS = "PROCESS"
RUN_KINDS = (KIND_SCAN, KIND_PROCESS)
RUN_STATUSES = ("RUNNING", "DONE", "PARTIAL", "CANCELLED")

SCAN_REASON = "MAKE_READY_SCAN"
PROCESS_REASON = "MAKE_READY_PROCESS"
CACHED_REASON = "MAKE_READY_CACHED"
RETRY_REASON = "ADMIN_RETRY"

SCAN_COOLDOWN_SECONDS = 300

_DONE_STATES = ("READY", "EMPTY", "UNSUPPORTED")


class RunError(Exception):
    """A refused run operation: the router turns it into HTTPException(status_code, detail)."""

    def __init__(self, status_code: int, detail: Dict[str, Any], headers: Optional[Dict[str, str]] = None):
        super().__init__(detail.get("message") or detail.get("code"))
        self.status_code = status_code
        self.detail = detail
        self.headers = headers


@dataclass(frozen=True)
class Run:
    id: str
    institute_id: str
    package_id: str
    kind: str
    status: str
    requested_by: Optional[str]
    quoted_credits: Decimal
    quote_json: Dict[str, Any]
    slides_total: int
    created_at: Optional[datetime]
    finished_at: Optional[datetime]


_RUN_COLS = (
    "id, institute_id, package_id, kind, status, requested_by, quoted_credits, quote_json, "
    "slides_total, created_at, finished_at"
)


def _json(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except ValueError:
            return {}
    return {}


def _run(r) -> Run:
    return Run(
        id=r[0], institute_id=r[1], package_id=r[2], kind=r[3], status=r[4], requested_by=r[5],
        quoted_credits=Decimal(str(r[6] or 0)), quote_json=_json(r[7]), slides_total=int(r[8] or 0),
        created_at=r[9], finished_at=r[10],
    )


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value is not None else None


def _lock_course(db: Session, institute_id: str, package_id: str) -> None:
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
        {"k": f"course_knowledge_run:{institute_id}:{package_id}"},
    ).fetchone()


# ----------------------------------------------------------------------
# reads
# ----------------------------------------------------------------------
def get_run(db: Session, institute_id: str, run_id: str) -> Optional[Run]:
    """The run, only when it belongs to this institute."""
    if not run_id:
        return None
    row = db.execute(
        text(f"SELECT {_RUN_COLS} FROM course_knowledge_run WHERE id = :r AND institute_id = :i"),
        {"r": run_id, "i": institute_id},
    ).fetchone()
    return _run(row) if row else None


def active_run(db: Session, institute_id: str, package_id: str) -> Optional[Run]:
    """The newest RUNNING run of the course (a PROCESS run first)."""
    row = db.execute(
        text(
            f"""
            SELECT {_RUN_COLS} FROM course_knowledge_run
             WHERE institute_id = :i AND package_id = :p AND status = 'RUNNING'
             ORDER BY CASE WHEN kind = 'PROCESS' THEN 0 ELSE 1 END, created_at DESC
             LIMIT 1
            """
        ),
        {"i": institute_id, "p": package_id},
    ).fetchone()
    return _run(row) if row else None


def _running(db: Session, institute_id: str, package_id: str, kind: str) -> Optional[str]:
    row = db.execute(
        text(
            """
            SELECT id FROM course_knowledge_run
             WHERE institute_id = :i AND package_id = :p AND kind = :k AND status = 'RUNNING'
             ORDER BY created_at DESC LIMIT 1
            """
        ),
        {"i": institute_id, "p": package_id, "k": kind},
    ).fetchone()
    return row[0] if row else None


def _recent_scan(db: Session, institute_id: str, package_id: str) -> Optional[tuple]:
    """(run_id, seconds left) of a scan started within the cooldown."""
    row = db.execute(
        text(
            """
            SELECT id, CAST(:cool AS integer) - EXTRACT(EPOCH FROM (now() - created_at))
              FROM course_knowledge_run
             WHERE institute_id = :i AND package_id = :p AND kind = 'SCAN'
               AND created_at > now() - (CAST(:cool AS integer) * interval '1 second')
             ORDER BY created_at DESC LIMIT 1
            """
        ),
        {"i": institute_id, "p": package_id, "cool": SCAN_COOLDOWN_SECONDS},
    ).fetchone()
    if row is None:
        return None
    return row[0], max(1, int(float(row[1] or 0)))


def progress(db: Session, run: Run) -> Dict[str, int]:
    """{total, pending, processing, done, failed, skipped}. A RUNNING run
    counts its queue rows. A closed run's rows were detached by the sweep (or
    by cancel), so its counts come from the lessons it covered (quote_json
    slide_ids) and their stored index state."""
    total = int(run.slides_total or 0)
    if run.status == "RUNNING":
        counts = run_progress(db, run.id)
        counts["total"] = max(total, counts["total"])
        return counts
    out = {"total": total, "pending": 0, "processing": 0, "done": 0, "failed": 0, "skipped": 0}
    slide_ids = [str(s) for s in (run.quote_json.get("slide_ids") or []) if s]
    if not slide_ids:
        if run.status == "DONE":
            out["done"] = total
        else:
            out["skipped"] = total
        return out
    kb = store.get_course_kb(db, run.institute_id)
    sources = store.coverage_rows(db, kb.id, slide_ids) if kb is not None else {}
    for sid in slide_ids:
        src = sources.get(sid)
        state = (src.index_state or "").upper() if src is not None else ""
        if state in _DONE_STATES or (state == "NEEDS_PROCESSING" and run.kind == KIND_SCAN):
            out["done"] += 1
        elif state == "FAILED":
            out["failed"] += 1
        else:
            out["skipped"] += 1
    out["total"] = max(total, len(slide_ids))
    return out


def _charged(db: Session, run_id: str) -> Decimal:
    row = db.execute(
        text("SELECT charged_credits FROM course_knowledge_budget WHERE id = :id"),
        {"id": budget.run_budget_id(run_id)},
    ).fetchone()
    return Decimal(str(row[0] or 0)) if row else Decimal("0")


def run_dict(db: Session, run: Run) -> Dict[str, Any]:
    """The GET /runs/{id} shape."""
    counts = progress(db, run)
    return {
        "id": run.id, "kind": run.kind, "status": run.status,
        "total": counts["total"], "pending": counts["pending"], "processing": counts["processing"],
        "done": counts["done"], "failed": counts["failed"], "skipped": counts["skipped"],
        "quoted_credits": num(run.quoted_credits),
        "charged_credits": num(_charged(db, run.id)) if run.kind == KIND_PROCESS else 0,
        "created_at": _iso(run.created_at), "finished_at": _iso(run.finished_at),
    }


def active_run_dict(db: Session, institute_id: str, package_id: str) -> Optional[Dict[str, Any]]:
    """The coverage active_run shape, or None."""
    run = active_run(db, institute_id, package_id)
    if run is None:
        return None
    counts = progress(db, run)
    return {
        "id": run.id, "kind": run.kind, "status": run.status, "total": counts["total"],
        "pending": counts["pending"], "processing": counts["processing"],
        "done": counts["done"], "failed": counts["failed"],
    }


# ----------------------------------------------------------------------
# writes
# ----------------------------------------------------------------------
_INSERT_RUN_SQL = text(
    f"""
    INSERT INTO course_knowledge_run
        (id, institute_id, package_id, kind, status, requested_by, quoted_credits, quote_json,
         slides_total, created_at)
    VALUES (:id, :i, :p, :kind, 'RUNNING', :by, CAST(:quoted AS NUMERIC), CAST(:quote AS jsonb), :total, now())
    RETURNING {_RUN_COLS}
    """
)


def _insert_run(db: Session, *, institute_id: str, package_id: str, kind: str, requested_by: Optional[str],
                quoted_credits: Any, quote_json: Mapping[str, Any], slides_total: int) -> Run:
    row = db.execute(_INSERT_RUN_SQL, {
        "id": str(uuid.uuid4()), "i": institute_id, "p": package_id, "kind": kind, "by": requested_by,
        "quoted": str(Decimal(str(quoted_credits or 0))), "quote": json.dumps(dict(quote_json), default=str),
        "total": int(slides_total),
    }).fetchone()
    if row is None:  # pragma: no cover - an INSERT .. RETURNING always returns its row
        raise RuntimeError("course knowledge: run insert returned nothing")
    return _run(row)


def start_scan(
    db: Session, *, institute_id: str, package_id: str, requested_by: Optional[str], slide_ids: Sequence[str],
) -> Dict[str, Any]:
    """Create a SCAN run and queue the lessons (free, now). Raises RunError
    409 scan_running / 429 scan_rate_limited. Commits."""
    ids = list(dict.fromkeys(s for s in slide_ids if s))
    _lock_course(db, institute_id, package_id)
    running = _running(db, institute_id, package_id, KIND_SCAN)
    if running:
        db.rollback()
        raise RunError(409, {"code": "scan_running", "run_id": running,
                             "message": "This course is already being scanned."})
    recent = _recent_scan(db, institute_id, package_id)
    if recent is not None:
        db.rollback()
        raise RunError(
            429,
            {"code": "scan_rate_limited", "run_id": recent[0], "retry_after_seconds": recent[1],
             "message": "This course was scanned a moment ago. Try again in a few minutes."},
            headers={"Retry-After": str(recent[1])},
        )
    if not ids:
        db.rollback()
        return {"run_id": None, "lessons_queued": 0}
    run = _insert_run(db, institute_id=institute_id, package_id=package_id, kind=KIND_SCAN,
                      requested_by=requested_by, quoted_credits=0, quote_json={"slide_ids": ids},
                      slides_total=len(ids))
    queued = enqueue_slides(db, institute_id, ids, reason=SCAN_REASON, run_id=run.id, allow_paid=False)
    db.commit()
    logger.info("course knowledge: scan %s of %s/%s queued %d lesson(s)", run.id, institute_id, package_id, queued)
    return {"run_id": run.id, "lessons_queued": queued}


def start_process(
    db: Session, *, institute_id: str, package_id: str, requested_by: Optional[str], quote: Quote,
) -> Dict[str, Any]:
    """Create the PROCESS run and its budget (cap = the quote) and queue the
    quoted lessons with allow_paid; lessons whose paid text is already cached
    are queued free so they pick it up. The caller has done every check
    (quote, flag, preflight, balance). Raises RunError 409 process_running.
    Commits."""
    _lock_course(db, institute_id, package_id)
    running = _running(db, institute_id, package_id, KIND_PROCESS)
    if running:
        db.rollback()
        raise RunError(409, {"code": "process_running", "run_id": running,
                             "message": "This course is already being processed."})
    slide_ids = quote.slide_ids
    quote_json = {**quote.to_dict(), "slide_ids": slide_ids,
                  "lines": [{"slide_id": l.slide_id, "kind": l.kind, "tool_key": l.tool_key,
                             "units": l.units, "credits": num(l.credits)} for l in quote.lines]}
    run = _insert_run(db, institute_id=institute_id, package_id=package_id, kind=KIND_PROCESS,
                      requested_by=requested_by, quoted_credits=quote.credits, quote_json=quote_json,
                      slides_total=len(slide_ids))
    budget.create_run_budget(db, run.id, institute_id, quote.credits)
    queued = enqueue_slides(db, institute_id, slide_ids, reason=PROCESS_REASON, run_id=run.id, allow_paid=True)
    cached = enqueue_cached(db, institute_id, quote)
    db.commit()
    logger.info("course knowledge: process run %s of %s/%s for %s credits queued %d lesson(s) (+%d cached)",
                run.id, institute_id, package_id, quote.credits, queued, cached)
    return {"run_id": run.id, "quoted_credits": num(quote.credits), "lessons_queued": queued}


def enqueue_cached(db: Session, institute_id: str, quote: Quote) -> int:
    """Queue (free) the lessons whose paid text another course already paid
    for: a free pass reads it from the PAID cache. Does not commit."""
    if not quote.cached_slide_ids:
        return 0
    return enqueue_slides(db, institute_id, quote.cached_slide_ids, reason=CACHED_REASON)


_CANCEL_SQL = text(
    f"""
    UPDATE course_knowledge_run SET status = 'CANCELLED', finished_at = now()
     WHERE id = :r AND institute_id = :i AND status = 'RUNNING'
    RETURNING {_RUN_COLS}
    """
)

_DETACH_PENDING_SQL = text(
    """
    UPDATE content_index_queue SET allow_paid = FALSE, run_id = NULL, updated_at = now()
     WHERE run_id = :r AND status = 'PENDING'
    RETURNING slide_id
    """
)

# In-flight lessons keep their reservations (they settle within the cap);
# nothing new can be reserved. The sweep shrinks the cap to charged once
# nothing of the run is PROCESSING any more.
_FREEZE_BUDGET_SQL = text(
    """
    UPDATE course_knowledge_budget
       SET cap_credits = charged_credits + reserved_credits, updated_at = now()
     WHERE id = :id
    RETURNING id
    """
)


def cancel_run(db: Session, institute_id: str, run_id: str) -> Optional[Run]:
    """Cancel a RUNNING run: status CANCELLED, its PENDING rows lose
    allow_paid and the run, and the budget cap drops to charged + reserved.
    A run that already ended is returned unchanged. None when the run is not
    this institute's. Commits."""
    row = db.execute(_CANCEL_SQL, {"r": run_id, "i": institute_id}).fetchone()
    if row is None:
        db.rollback()
        return get_run(db, institute_id, run_id)
    run = _run(row)
    db.execute(_DETACH_PENDING_SQL, {"r": run_id}).fetchall()
    db.execute(_FREEZE_BUDGET_SQL, {"id": budget.run_budget_id(run_id)}).fetchone()
    db.commit()
    logger.info("course knowledge: run %s of %s cancelled", run_id, institute_id)
    return run


def retry_lesson(db: Session, institute_id: str, slide_id: str) -> int:
    """Queue one lesson again, free. Commits."""
    queued = enqueue_slides(db, institute_id, [slide_id], reason=RETRY_REASON)
    db.commit()
    return queued


_CANCEL_ALL_SQL = text(
    """
    UPDATE course_knowledge_run SET status = 'CANCELLED', finished_at = now()
     WHERE institute_id = :i AND status = 'RUNNING'
    RETURNING id
    """
)


def delete_institute_data(db: Session, institute_id: str, updated_by: Optional[str]) -> Dict[str, Any]:
    """Turn the feature off for the institute, drop its course KB (sources and
    chunks cascade), delete its queue rows and cancel its running runs.
    The setting goes first so no new lesson is queued meanwhile. Commits."""
    settings_store.put_setting(db, institute_id, {"enabled": False}, updated_by)
    deleted = store.delete_course_kb(db, institute_id)
    queue_rows = db.execute(
        text("DELETE FROM content_index_queue WHERE institute_id = :i RETURNING slide_id"),
        {"i": institute_id},
    ).fetchall()
    cancelled: List[str] = [r[0] for r in db.execute(_CANCEL_ALL_SQL, {"i": institute_id}).fetchall()]
    for run_id in cancelled:
        db.execute(_FREEZE_BUDGET_SQL, {"id": budget.run_budget_id(run_id)}).fetchone()
    db.commit()
    logger.warning("course knowledge: data of %s deleted by %s (kb=%s, %d queue rows, %d runs cancelled)",
                   institute_id, updated_by, deleted, len(queue_rows), len(cancelled))
    return {"deleted": bool(deleted), "queue_rows_deleted": len(queue_rows), "runs_cancelled": len(cancelled)}


__all__ = [
    "KIND_SCAN", "KIND_PROCESS", "RUN_KINDS", "RUN_STATUSES", "SCAN_REASON", "PROCESS_REASON",
    "CACHED_REASON", "RETRY_REASON", "SCAN_COOLDOWN_SECONDS", "RunError", "Run",
    "get_run", "active_run", "progress", "run_dict", "active_run_dict",
    "start_scan", "start_process", "enqueue_cached", "cancel_run", "retry_lesson", "delete_institute_data",
]
