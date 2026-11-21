"""The 30-minute drift sweep (spec §6.1): the safety net under the lesson hooks.

run_once() takes a transaction-scoped advisory lock on a holder session that
stays open (and writes nothing) for the whole sweep, so with several
ai_service replicas only one sweeps at a time (the copy-check billing
reconciliation pattern). The work itself runs in short transactions, one per
institute and one per platform-wide step, each with a statement and lock
timeout: no row lock (queue rows the admin hooks upsert, budget rows the
worker reserves against) is held past its own institute, and a slow plan is
cut off and skipped instead of stalling the sweep. If the holder connection
dies mid-sweep another replica may start sweeping too; every step is safe to
repeat (drift / gone skip queued rows, charges re-check ``charged IS NULL``
under the row lock, run close is guarded by ``status = 'RUNNING'``).
For every institute that turned the feature on and is available on the
platform:
  a) enqueues (reason DRIFT, at most 500 per institute, last 3 days) visible
     lessons that have no source row yet and were created after the
     institute enabled the feature, and lessons published again
     (slide.last_sync_date, set on every publish) after their source was
     written;
  b) enqueues sources whose lesson is no longer visible, so the worker
     tombstones them;
  c) re-drives charges that were delivered but never landed in the ledger,
     with the same idempotency key (a no-op when the charge exists);
  f) re-queues YouTube lessons marked "no captions" while YouTube was blocking
     us (caption_requeue.py; reason YT_CAPTIONS_RETRY, at most
     youtube_captions.requeue_per_sweep per sweep), only when the worker's
     caption canary passed just before the sweep (run_once(captions_ok=True));
     the canary is the sweep's only network call and runs BEFORE the holder
     session is opened.
Then, platform-wide:
  d) closes RUNNING runs with no PENDING / PROCESSING rows left (DONE, or
     PARTIAL when a lesson FAILED or still needs processing), shrinks the run
     budget's cap to what it charged and detaches the finished rows; runs
     that ended otherwise (CANCELLED) get their remaining rows detached too,
     and their budget closed once nothing is in flight;
  e) purges DONE / SKIPPED rows older than 7 days and FAILED older than 30,
     and shadow-mode results older than 30 days (shadow_events.py).

Only DB work happens while the session is open (billing.charge is DB-only:
record_tool_billing plus a ledger read); there is no network call.
CAST(:x AS type), never ``::`` after a bind.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from decimal import Decimal
from typing import Any, Dict, Iterator, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from ... import db as app_db
from ...db import db_session
from . import billing, budget, caption_requeue, flags, shadow_events, store
from .extract.types import PaidDelivered
from .queue import enqueue_slides
from .tree import _VISIBLE_CHAIN

logger = logging.getLogger(__name__)

LOCK_KEY = "course_knowledge_sweep"
DRIFT_REASON = "DRIFT"
MAX_PER_INSTITUTE = 500
LOOKBACK_DAYS = 3
CHARGE_GRACE_MINUTES = 15
MAX_REDRIVES = 100
RUN_CLOSE_GRACE_MINUTES = 2
PURGE_DONE_DAYS = 7
PURGE_FAILED_DAYS = 30
# Per sweep transaction: one statement may run this long, and waits this long
# for a row lock (a worker or an admin save holding the row) before giving up.
STATEMENT_TIMEOUT = "30s"
LOCK_TIMEOUT = "5s"

_TRY_LOCK = text("SELECT pg_try_advisory_xact_lock(hashtext(:key))")

_TIMEOUTS_SQL = (
    text(f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'"),
    text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"),
)

_ENABLED_SQL = text(
    "SELECT institute_id, enabled_at FROM course_knowledge_setting WHERE enabled = TRUE ORDER BY institute_id"
)

# A lesson already waiting (or being indexed), or one that failed since its
# last publish, is left alone: re-queuing it would only bump its generation.
_NOT_QUEUED = """
      AND NOT EXISTS (
          SELECT 1 FROM content_index_queue q
           WHERE q.institute_id = :i AND q.slide_id = {slide}
             AND (q.status IN ('PENDING', 'PROCESSING')
                  OR (q.status = 'FAILED' AND q.updated_at >= {since})))
"""

_DRIFT_SQL = text(
    "SELECT DISTINCT sl.id" + _VISIBLE_CHAIN + """
    WHERE cpsm.status = 'ACTIVE'
      AND ps.status <> 'DELETED'
      AND sl.source_type <> 'ASSESSMENT'
      AND EXISTS (SELECT 1 FROM package_institute pi
                  WHERE pi.package_id = ps.package_id AND pi.institute_id = :i)
      AND (
          (NOT EXISTS (SELECT 1 FROM knowledge_base_source s
                        WHERE s.knowledge_base_id = :kb AND s.slide_id = sl.id)
           AND sl.created_at >= CAST(:enabled_at AS timestamptz)
           AND sl.created_at >= now() - (CAST(:days AS integer) * interval '1 day'))
          OR EXISTS (SELECT 1 FROM knowledge_base_source s
                      WHERE s.knowledge_base_id = :kb AND s.slide_id = sl.id
                        AND sl.last_sync_date > s.updated_at
                        AND sl.last_sync_date >= now() - (CAST(:days AS integer) * interval '1 day'))
      )
    """ + _NOT_QUEUED.format(slide="sl.id", since="COALESCE(sl.last_sync_date, sl.created_at)") + """
    LIMIT :lim
    """
)

_GONE_SQL = text(
    """
    SELECT s.slide_id
      FROM knowledge_base_source s
     WHERE s.knowledge_base_id = :kb
       AND s.slide_id IS NOT NULL
       AND NOT EXISTS (SELECT 1""" + _VISIBLE_CHAIN + """
                        WHERE sl.id = s.slide_id
                          AND sl.source_type <> 'ASSESSMENT'
                          AND cpsm.status = 'ACTIVE'
                          AND ps.status <> 'DELETED'
                          AND EXISTS (SELECT 1 FROM package_institute pi
                                      WHERE pi.package_id = ps.package_id AND pi.institute_id = :i))
    """ + _NOT_QUEUED.format(slide="s.slide_id", since="s.updated_at") + """
     LIMIT :lim
    """
)

_UNCHARGED_SQL = text(
    """
    SELECT id, slide_id, meta_json
      FROM knowledge_base_source
     WHERE knowledge_base_id = :kb
       AND meta_json -> 'paid' ->> 'delivered_at' IS NOT NULL
       AND meta_json -> 'paid' ->> 'idempotency_key' IS NOT NULL
       AND COALESCE(jsonb_typeof(meta_json -> 'paid' -> 'charged'), 'null') = 'null'
       AND CAST(meta_json -> 'paid' ->> 'delivered_at' AS timestamptz)
           < now() - (CAST(:grace AS integer) * interval '1 minute')
       AND CAST(meta_json -> 'paid' ->> 'delivered_at' AS timestamptz)
           >= now() - (CAST(:days AS integer) * interval '1 day')
     ORDER BY updated_at
     LIMIT :lim
    """
)

_STORE_CHARGE_SQL = text(
    """
    UPDATE knowledge_base_source
       SET meta_json = jsonb_set(meta_json, '{paid,charged}', to_jsonb(CAST(:c AS NUMERIC)), true),
           credits_charged = CAST(:c AS NUMERIC)
     WHERE id = :id
       AND COALESCE(jsonb_typeof(meta_json -> 'paid' -> 'charged'), 'null') = 'null'
    RETURNING id
    """
)

_FINISHED_RUNS_SQL = text(
    """
    SELECT r.id, r.institute_id
      FROM course_knowledge_run r
     WHERE r.status = 'RUNNING'
       AND r.created_at < now() - (CAST(:grace AS integer) * interval '1 minute')
       AND NOT EXISTS (SELECT 1 FROM content_index_queue q
                        WHERE q.run_id = r.id AND q.status IN ('PENDING', 'PROCESSING'))
     ORDER BY r.created_at
     LIMIT 200
    """
)

_RUN_FAILED_SQL = text(
    "SELECT EXISTS (SELECT 1 FROM content_index_queue WHERE run_id = :r AND status = 'FAILED')"
)

_RUN_NEEDS_SQL = text(
    """
    SELECT EXISTS (
        SELECT 1 FROM content_index_queue q
          JOIN knowledge_base_source s ON s.slide_id = q.slide_id AND s.knowledge_base_id = :kb
         WHERE q.run_id = :r AND s.index_state IN ('NEEDS_PROCESSING', 'FAILED'))
    """
)

_CLOSE_RUN_SQL = text(
    """
    UPDATE course_knowledge_run SET status = :status, finished_at = now()
     WHERE id = :r AND status = 'RUNNING'
    RETURNING id
    """
)

_DETACH_ROWS_SQL = text(
    """
    UPDATE content_index_queue SET run_id = NULL, allow_paid = FALSE, updated_at = now()
     WHERE run_id = :r AND status IN ('DONE', 'FAILED', 'SKIPPED')
    RETURNING slide_id
    """
)

# Runs that ended without the sweep (CANCELLED by the admin) but still hold
# rows: CK-09's cancel detaches only PENDING ones.
_ENDED_RUNS_SQL = text(
    """
    SELECT r.id FROM course_knowledge_run r
     WHERE r.status <> 'RUNNING'
       AND EXISTS (SELECT 1 FROM content_index_queue q
                    WHERE q.run_id = r.id AND q.status <> 'PROCESSING')
     LIMIT 200
    """
)

_DETACH_ENDED_SQL = text(
    """
    UPDATE content_index_queue SET run_id = NULL, allow_paid = FALSE, updated_at = now()
     WHERE run_id = :r AND status <> 'PROCESSING'
    RETURNING slide_id
    """
)

_RUN_IN_FLIGHT_SQL = text(
    "SELECT EXISTS (SELECT 1 FROM content_index_queue WHERE run_id = :r AND status = 'PROCESSING')"
)

_PURGE_SQL = text(
    """
    DELETE FROM content_index_queue
     WHERE run_id IS NULL
       AND ((status IN ('DONE', 'SKIPPED') AND updated_at < now() - (CAST(:done AS integer) * interval '1 day'))
            OR (status = 'FAILED' AND updated_at < now() - (CAST(:failed AS integer) * interval '1 day')))
    RETURNING slide_id
    """
)


# ----------------------------------------------------------------------
# per institute
# ----------------------------------------------------------------------
def _drift(db: Session, institute_id: str, kb_id: Optional[str], enabled_at: Any) -> int:
    if enabled_at is None:
        return 0
    ids = [r[0] for r in db.execute(
        _DRIFT_SQL,
        {"i": institute_id, "kb": kb_id, "enabled_at": enabled_at, "days": LOOKBACK_DAYS,
         "lim": MAX_PER_INSTITUTE},
    ).fetchall()]
    return enqueue_slides(db, institute_id, ids, reason=DRIFT_REASON) if ids else 0


def _gone(db: Session, institute_id: str, kb_id: str) -> int:
    ids = [r[0] for r in db.execute(
        _GONE_SQL, {"i": institute_id, "kb": kb_id, "lim": MAX_PER_INSTITUTE},
    ).fetchall()]
    return enqueue_slides(db, institute_id, ids, reason=DRIFT_REASON) if ids else 0


def _delivered_from(paid: Dict[str, Any]) -> Optional[PaidDelivered]:
    try:
        tool_key = str(paid["tool_key"])
        units = int(paid.get("units") or 0)
        return PaidDelivered(
            tool_key=tool_key, unit_field=("audio_minutes" if "transcribe" in tool_key else "pages"),
            units=units, provider_cost_usd=float(paid.get("provider_cost_usd") or 0.0),
            model=str(paid.get("model") or "unknown"),
            idempotency_key=str(paid["idempotency_key"]),
        )
    except (KeyError, TypeError, ValueError):
        return None


def _redrive_charges(db: Session, institute_id: str, kb_id: str) -> int:
    rows = db.execute(
        _UNCHARGED_SQL,
        {"kb": kb_id, "grace": CHARGE_GRACE_MINUTES, "days": LOOKBACK_DAYS, "lim": MAX_REDRIVES},
    ).fetchall()
    fixed = 0
    for source_id, slide_id, meta in rows:
        paid = (meta or {}).get("paid") if isinstance(meta, dict) else None
        delivered = _delivered_from(paid) if isinstance(paid, dict) else None
        if delivered is None or delivered.units <= 0:
            continue
        run_id = paid.get("run_id")
        charged = billing.charge(
            delivered, institute_id=institute_id, requested_by=paid.get("requested_by"), run_id=run_id,
            slide_id=slide_id, pointer=f"{paid.get('pointer_kind')}:{paid.get('pointer_key')}",
        )
        if charged is None:
            continue
        stored = db.execute(_STORE_CHARGE_SQL, {"id": source_id, "c": str(charged)}).fetchone()
        if stored is None:
            continue
        budget_id = paid.get("budget_id")
        if budget_id:
            # The worker already counted this delivery on the budget at
            # meta.paid.budget_counted (the quote, when the charge was not
            # confirmed); move it to the ledger amount. Older rows have none.
            try:
                counted = Decimal(str(paid.get("budget_counted") or 0))
            except (ArithmeticError, ValueError):
                counted = Decimal("0")
            budget.true_up(db, budget_id, Decimal(str(charged)) - counted)
        fixed += 1
    if fixed:
        logger.info("course knowledge sweep: re-drove %d delivered charge(s) for %s", fixed, institute_id)
    return fixed


def _sweep_institute(db: Session, institute_id: str, enabled_at: Any, captions_limit: int = 0) -> Dict[str, int]:
    kb = store.get_course_kb(db, institute_id)
    kb_id = kb.id if kb is not None else None
    out = {"drift": _drift(db, institute_id, kb_id, enabled_at), "gone": 0, "charges": 0, "captions": 0,
           "captions_selected": 0}
    if kb_id is not None:
        out["gone"] = _gone(db, institute_id, kb_id)
        out["charges"] = _redrive_charges(db, institute_id, kb_id)
        if captions_limit > 0:
            got = caption_requeue.requeue_youtube_caption_lessons(
                db, institute_id=institute_id, limit=captions_limit, kb_id=kb_id)
            out["captions"], out["captions_selected"] = got["queued"], got["selected"]
    return out


# ----------------------------------------------------------------------
# platform-wide
# ----------------------------------------------------------------------
def _close_runs(db: Session) -> int:
    closed = 0
    for run_id, institute_id in db.execute(_FINISHED_RUNS_SQL, {"grace": RUN_CLOSE_GRACE_MINUTES}).fetchall():
        failed = bool(db.execute(_RUN_FAILED_SQL, {"r": run_id}).scalar())
        kb = store.get_course_kb(db, institute_id)
        needs = bool(kb is not None and db.execute(_RUN_NEEDS_SQL, {"r": run_id, "kb": kb.id}).scalar())
        status = "PARTIAL" if (failed or needs) else "DONE"
        if db.execute(_CLOSE_RUN_SQL, {"r": run_id, "status": status}).fetchone() is None:
            continue
        budget.close_run_budget(db, run_id)
        db.execute(_DETACH_ROWS_SQL, {"r": run_id}).fetchall()
        closed += 1
        logger.info("course knowledge sweep: run %s closed as %s", run_id, status)
    for (run_id,) in db.execute(_ENDED_RUNS_SQL).fetchall():
        db.execute(_DETACH_ENDED_SQL, {"r": run_id}).fetchall()
        if not db.execute(_RUN_IN_FLIGHT_SQL, {"r": run_id}).scalar():
            budget.close_run_budget(db, run_id)
    return closed


def _purge(db: Session) -> int:
    rows = db.execute(_PURGE_SQL, {"done": PURGE_DONE_DAYS, "failed": PURGE_FAILED_DAYS}).fetchall()
    return len(rows)


@contextmanager
def _step() -> Iterator[Session]:
    """One short sweep transaction with the statement / lock timeouts set."""
    with db_session() as db:
        for stmt in _TIMEOUTS_SQL:
            db.execute(stmt)
        yield db


@contextmanager
def _sweep_lock() -> Iterator[bool]:
    """Holds the sweep's advisory xact lock on its own session for the whole
    sweep. The session only takes the lock (no writes, no xid), so leaving it
    idle in transaction holds back nothing; releasing it is best effort, since
    the server may have closed an idle connection by then."""
    db: Session = app_db.get_sessionmaker()()
    try:
        yield bool(db.execute(_TRY_LOCK, {"key": LOCK_KEY}).scalar())
    finally:
        try:
            db.rollback()
        except Exception:  # noqa: BLE001 - the lock goes with the connection anyway
            logger.warning("course knowledge sweep: releasing the sweep lock failed", exc_info=True)
        finally:
            db.close()


def run_once(captions_ok: bool = False) -> Dict[str, Any]:
    """One sweep. Returns a summary; {"locked": False} when another replica
    holds the sweep lock. Blocking: call it via asyncio.to_thread.

    captions_ok: the caption canary passed just before this sweep (the worker
    runs it before calling here); without it step f) is skipped."""
    summary: Dict[str, Any] = {"locked": False, "institutes": 0, "drift": 0, "gone": 0, "charges": 0,
                               "captions": 0, "runs_closed": 0, "purged": 0, "shadow_purged": 0, "errors": 0}
    with _sweep_lock() as locked:
        if not locked:
            return summary
        summary["locked"] = True
        captions_left = caption_requeue.sweep_limit(captions_ok)
        with _step() as db:
            institutes: List = db.execute(_ENABLED_SQL).fetchall()
        for institute_id, enabled_at in institutes:
            if not flags.available(institute_id):
                continue
            summary["institutes"] += 1
            try:
                # Its own transaction: committed (and its locks dropped) before
                # the next institute starts; a timeout rolls back only this one.
                with _step() as db:
                    got = _sweep_institute(db, institute_id, enabled_at, captions_left)
                for key in ("drift", "gone", "charges", "captions"):
                    summary[key] += got[key]
                captions_left = max(0, captions_left - got["captions_selected"])
            except Exception:  # noqa: BLE001 - one institute never stops the sweep
                summary["errors"] += 1
                logger.exception("course knowledge sweep: institute %s failed", institute_id)
        for key, step in (("runs_closed", _close_runs), ("purged", _purge),
                          ("shadow_purged", shadow_events.purge)):
            try:
                with _step() as db:
                    summary[key] = step(db)
            except Exception:  # noqa: BLE001
                summary["errors"] += 1
                logger.exception("course knowledge sweep: %s failed", key)
        # Supadata usage rows older than a week (the daily cap reads only today's).
        from ..youtube_captions import cache as caption_cache
        caption_cache.purge_usage()
    if summary["drift"] or summary["gone"] or summary["captions"] or summary["runs_closed"] or summary["errors"]:
        logger.info("course knowledge sweep: %s", summary)
    return summary


__all__ = ["LOCK_KEY", "DRIFT_REASON", "MAX_PER_INSTITUTE", "run_once"]
