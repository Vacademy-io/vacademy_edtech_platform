"""content_index_queue: the durable, multi-replica work queue of lessons to
(re)index (spec §6.2). Copies the call_intelligence_poller claim shape.

One row per (institute_id, slide_id). Writers (the admin_core marker, the drift
sweep, Make course AI-ready, the PPT-anim backfill) upsert a row and bump its
``generation``; the worker claims rows with FOR UPDATE SKIP LOCKED, so two
ai_service replicas never take the same lesson, and finalizes with the
generation it read: if the lesson changed while it was being indexed, the row
goes back to PENDING instead of DONE.

Rules:
  * Every decision comes from RETURNING, never rowcount (psycopg 3 reports -1
    for INSERT .. ON CONFLICT).
  * CAST(:x AS type), never ``::`` after a bind (SQLAlchemy text() would read
    ``:name::type`` as two parameters).
  * claim / finalize open their own short db_session (run them through
    asyncio.to_thread).
  * claimed_at is the claim's lease: the indexer renews it while a paid step
    waits and runs (indexer._keep_claim) and keys its budget hold on it, so a
    row is re-armed only when its owner stopped renewing for STALE_MINUTES.
  * A budget hold recorded on the row is released exactly once, by whoever
    clears the record under the row lock: the indexer's settle / release,
    rearm_stale, or finalize (a hold the indexer could not give back, or one a
    re-armed replica's late finalize finds on the row). enqueue_* and run_progress use the
    caller's session and never commit.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Dict, Iterable, List, Optional, Union

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...db import db_session

logger = logging.getLogger(__name__)

STALE_MINUTES = 30          # claimed_at not renewed for this long = the worker died; re-arm
MAX_ATTEMPTS = 5            # claims before a lesson is given up as FAILED
REASON_MAX = 48             # content_index_queue.reason is VARCHAR(48)
_IN_BATCH = 1000

QUEUE_STATUSES = ("PENDING", "PROCESSING", "DONE", "FAILED", "SKIPPED")


@dataclass(frozen=True)
class ClaimedRow:
    """A queue row this worker now owns (status PROCESSING)."""
    institute_id: str
    slide_id: str
    generation: int
    allow_paid: bool
    run_id: Optional[str]
    reason: Optional[str]
    attempts: int


def clip_reason(reason: Optional[str]) -> str:
    clean = (reason or "").strip() or "LESSON_CHANGED"
    return clean[:REASON_MAX]


# ----------------------------------------------------------------------
# claim
# ----------------------------------------------------------------------
# The CTE locks the stale rows and remembers their reservation; RETURNING
# hands the OLD budget_id / reserved_credits back so they can be released in
# the same transaction.
_REARM_SQL = text(
    """
    WITH stale AS (
        SELECT institute_id, slide_id, budget_id, reserved_credits
          FROM content_index_queue
         WHERE status = 'PROCESSING'
           AND COALESCE(claimed_at, updated_at) < now() - (CAST(:stale AS integer) * interval '1 minute')
         FOR UPDATE SKIP LOCKED
    )
    UPDATE content_index_queue q
       SET status = CASE WHEN q.attempts >= :max_attempts THEN 'FAILED' ELSE 'PENDING' END,
           last_error = CASE WHEN q.attempts >= :max_attempts
                             THEN 'The worker stopped while indexing this lesson too many times'
                             ELSE q.last_error END,
           not_before = now(),
           budget_id = NULL,
           reserved_credits = 0,
           updated_at = now()
      FROM stale
     WHERE q.institute_id = stale.institute_id AND q.slide_id = stale.slide_id
    RETURNING q.institute_id, q.slide_id, q.status, stale.budget_id, stale.reserved_credits
    """
)

_CLAIM_SQL = text(
    """
    WITH c AS (
        SELECT institute_id, slide_id
          FROM content_index_queue
         WHERE status = 'PENDING' AND not_before <= now()
         ORDER BY (run_id IS NULL), not_before
         LIMIT :n
         FOR UPDATE SKIP LOCKED
    )
    UPDATE content_index_queue q
       SET status = 'PROCESSING', attempts = q.attempts + 1, claimed_at = now(), updated_at = now()
      FROM c
     WHERE q.institute_id = c.institute_id AND q.slide_id = c.slide_id
    RETURNING q.institute_id, q.slide_id, q.generation, q.allow_paid, q.run_id, q.reason, q.attempts
    """
)


def rearm_stale(db: Session) -> List[Dict[str, object]]:
    """Re-arm rows stuck in PROCESSING (PENDING, or FAILED after MAX_ATTEMPTS)
    and release the budget reservations they held. Does not commit."""
    from . import budget

    rows = db.execute(_REARM_SQL, {"stale": STALE_MINUTES, "max_attempts": MAX_ATTEMPTS}).fetchall()
    held: Dict[str, Decimal] = {}
    out: List[Dict[str, object]] = []
    for r in rows:
        out.append({"institute_id": r[0], "slide_id": r[1], "status": r[2]})
        amount = Decimal(str(r[4] or 0))
        if r[3] and amount > 0:
            held[r[3]] = held.get(r[3], Decimal("0")) + amount
    for budget_id, amount in held.items():
        budget.release(db, budget_id, amount)
    if out:
        logger.warning("course knowledge: re-armed %d stale queue row(s), released %d reservation(s)",
                       len(out), len(held))
    return out


def claim(n: int) -> List[ClaimedRow]:
    """Re-arm stale rows, then claim up to n due PENDING rows (explicit runs
    first). One short session; blocking, so call it via asyncio.to_thread."""
    n = max(1, int(n))
    with db_session() as db:
        rearm_stale(db)
        rows = db.execute(_CLAIM_SQL, {"n": n}).fetchall()
        claimed = [
            ClaimedRow(
                institute_id=r[0], slide_id=r[1], generation=int(r[2]), allow_paid=bool(r[3]),
                run_id=r[4], reason=r[5], attempts=int(r[6] or 0),
            )
            for r in rows
        ]
    return claimed


# ----------------------------------------------------------------------
# finalize
# ----------------------------------------------------------------------
# :nb is an absolute time, :delay seconds from now(); both NULL keeps the row's
# not_before. A generation that moved on means the lesson changed mid-run:
# back to PENDING (debounced 30 s) whatever this run concluded. The CTE locks
# the row and hands back any hold still recorded on it, released in the same
# transaction (clearing the record without releasing would leak it forever).
_FINALIZE_SQL = text(
    """
    WITH old AS (
        SELECT institute_id, slide_id, budget_id, reserved_credits
          FROM content_index_queue
         WHERE institute_id = :i AND slide_id = :s AND status = 'PROCESSING'
         FOR UPDATE
    )
    UPDATE content_index_queue q
       SET status = CASE WHEN q.generation = :gen THEN :final ELSE 'PENDING' END,
           not_before = CASE WHEN q.generation = :gen
                             THEN COALESCE(CAST(:nb AS timestamptz),
                                           now() + CAST(:delay AS double precision) * interval '1 second',
                                           q.not_before)
                             ELSE now() + interval '30 seconds' END,
           last_error = :err,
           budget_id = NULL,
           reserved_credits = 0,
           updated_at = now()
      FROM old
     WHERE q.institute_id = old.institute_id AND q.slide_id = old.slide_id
    RETURNING q.status, old.budget_id, old.reserved_credits
    """
)


def finalize(
    institute_id: str,
    slide_id: str,
    generation: int,
    final_status: str,
    not_before: Union[datetime, float, int, None] = None,
    error: Optional[str] = None,
) -> Optional[str]:
    """Close a claimed row: `final_status` when the generation is unchanged,
    else PENDING. `not_before` is a datetime or a delay in seconds (None keeps
    it). A budget hold still recorded on the row is released. Returns the
    stored status, or None when the row was no longer PROCESSING (re-armed by
    another replica). Own short session."""
    from . import budget

    if final_status not in QUEUE_STATUSES or final_status == "PROCESSING":
        raise ValueError(f"cannot finalize a queue row as {final_status!r}")
    nb: Optional[datetime] = not_before if isinstance(not_before, datetime) else None
    delay: Optional[float] = (
        float(not_before) if isinstance(not_before, (int, float)) and not isinstance(not_before, bool) else None
    )
    with db_session() as db:
        row = db.execute(
            _FINALIZE_SQL,
            {
                "i": institute_id, "s": slide_id, "gen": int(generation), "final": final_status,
                "nb": nb, "delay": delay, "err": (error[:2000] if error else None),
            },
        ).fetchone()
        if row is None:
            return None
        held = Decimal(str(row[2] or 0))
        if row[1] and held > 0:
            budget.release(db, row[1], held)
            logger.warning("course knowledge: finalize released a %s hold left on %s/%s (%s)",
                           held, institute_id, slide_id, row[1])
    return row[0]


def give_back_attempt(db: Session, institute_id: str, slide_id: str, generation: int) -> bool:
    """Undo this claim's attempt count (a long transcription job is waiting, not
    failing). Only while this worker still owns the row. Does not commit."""
    row = db.execute(
        text(
            """
            UPDATE content_index_queue
               SET attempts = GREATEST(attempts - 1, 0)
             WHERE institute_id = :i AND slide_id = :s AND status = 'PROCESSING' AND generation = :gen
            RETURNING slide_id
            """
        ),
        {"i": institute_id, "s": slide_id, "gen": int(generation)},
    ).fetchone()
    return row is not None


# ----------------------------------------------------------------------
# enqueue
# ----------------------------------------------------------------------
# allow_paid only ever widens. A paid row keeps its own run_id when a later
# free enqueue (a scan, the sweep) arrives, so the paid authorisation stays
# tied to the run whose budget approved it.
_ENQUEUE_SQL = text(
    """
    INSERT INTO content_index_queue
        (institute_id, slide_id, reason, status, allow_paid, run_id, generation,
         not_before, attempts, created_at, updated_at)
    SELECT :i, s.slide_id, :reason, 'PENDING', :allow_paid, CAST(:run_id AS VARCHAR), 1,
           now(), 0, now(), now()
      FROM unnest(CAST(:ids AS TEXT[])) AS s (slide_id)
    ON CONFLICT (institute_id, slide_id) DO UPDATE SET
        generation = content_index_queue.generation + 1,
        not_before = now(),
        reason = EXCLUDED.reason,
        attempts = 0,
        last_error = NULL,
        status = CASE WHEN content_index_queue.status = 'PROCESSING' THEN 'PROCESSING' ELSE 'PENDING' END,
        allow_paid = (content_index_queue.allow_paid OR EXCLUDED.allow_paid),
        run_id = CASE WHEN content_index_queue.allow_paid AND NOT EXCLUDED.allow_paid
                      THEN content_index_queue.run_id
                      ELSE COALESCE(EXCLUDED.run_id, content_index_queue.run_id) END,
        updated_at = now()
    RETURNING slide_id
    """
)


def enqueue_slides(
    db: Session,
    institute_id: str,
    slide_ids: Iterable[str],
    *,
    reason: str,
    run_id: Optional[str] = None,
    allow_paid: bool = False,
) -> int:
    """Queue lessons of one institute for indexing now (not debounced). Used by
    Make course AI-ready, the drift sweep and the backfill. The caller decides
    the lessons belong to the institute. Returns the number of rows written.
    Does not commit."""
    ids = list(dict.fromkeys(str(s) for s in slide_ids if s))
    if not institute_id or not ids:
        return 0
    written = 0
    for start in range(0, len(ids), _IN_BATCH):
        rows = db.execute(
            _ENQUEUE_SQL,
            {
                "i": institute_id, "ids": ids[start:start + _IN_BATCH], "reason": clip_reason(reason),
                "allow_paid": bool(allow_paid), "run_id": run_id,
            },
        ).fetchall()
        written += len(rows)
    return written


# Statement A of the admin_core marker (ContentIndexQueueWriter), with the
# lesson picked by its document: slide.source_id is the document_slide id.
# Institutes come from the lesson's live mappings joined to an enabled setting;
# the 30 s debounce and the untouched allow_paid / run_id / budget_id match it.
ENQUEUE_BY_DOCUMENT_SQL = text(
    """
    INSERT INTO content_index_queue
        (institute_id, slide_id, reason, status, generation, not_before, attempts, created_at, updated_at)
    SELECT DISTINCT pi.institute_id, cts.slide_id, :reason, 'PENDING', 1,
           now() + interval '30 seconds', 0, now(), now()
      FROM slide s
      JOIN chapter_to_slides cts ON cts.slide_id = s.id AND cts.status <> 'DELETED'
      JOIN chapter_package_session_mapping cpsm
           ON cpsm.chapter_id = cts.chapter_id AND cpsm.status <> 'DELETED'
      JOIN package_session ps ON ps.id = cpsm.package_session_id
      JOIN package_institute pi ON pi.package_id = ps.package_id
      JOIN course_knowledge_setting cks ON cks.institute_id = pi.institute_id AND cks.enabled = TRUE
     WHERE s.source_id = :document_id AND s.source_type = 'DOCUMENT'
    ON CONFLICT (institute_id, slide_id) DO UPDATE SET
        generation = content_index_queue.generation + 1,
        not_before = EXCLUDED.not_before,
        reason = EXCLUDED.reason,
        attempts = 0,
        last_error = NULL,
        status = CASE WHEN content_index_queue.status = 'PROCESSING' THEN 'PROCESSING' ELSE 'PENDING' END,
        updated_at = now()
    RETURNING institute_id, slide_id
    """
)


def enqueue_document_lessons(db: Session, document_slide_id: str, reason: str) -> int:
    """Queue every lesson that shows this document_slide, for every institute
    that enabled course knowledge. Returns the rows written. Does not commit."""
    if not document_slide_id:
        return 0
    rows = db.execute(
        ENQUEUE_BY_DOCUMENT_SQL, {"document_id": document_slide_id, "reason": clip_reason(reason)},
    ).fetchall()
    return len(rows)


# ----------------------------------------------------------------------
# progress
# ----------------------------------------------------------------------
def run_progress(db: Session, run_id: str) -> Dict[str, int]:
    """Queue rows of a run by status: {total, pending, processing, done,
    failed, skipped}. Rows leave the run when it closes (the sweep clears
    run_id), so a closed run reads its totals from course_knowledge_run."""
    out = {"total": 0, "pending": 0, "processing": 0, "done": 0, "failed": 0, "skipped": 0}
    if not run_id:
        return out
    rows = db.execute(
        text(
            "SELECT status, COUNT(*) FROM content_index_queue WHERE run_id = :r GROUP BY status"
        ),
        {"r": run_id},
    ).fetchall()
    for status, count in rows:
        key = str(status or "").lower()
        if key in out:
            out[key] = int(count)
        out["total"] += int(count)
    return out


__all__ = [
    "STALE_MINUTES", "MAX_ATTEMPTS", "REASON_MAX", "ClaimedRow", "clip_reason",
    "rearm_stale", "claim", "finalize", "give_back_attempt",
    "enqueue_slides", "ENQUEUE_BY_DOCUMENT_SQL", "enqueue_document_lessons", "run_progress",
]
