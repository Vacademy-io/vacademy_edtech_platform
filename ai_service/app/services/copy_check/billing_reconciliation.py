"""Nightly copy-check billing reconciliation (spec 10.5, T1.16).

record_tool_billing swallows every error (a graded copy must never fail on
billing), so a billing-DB blip at the end of a run means a copy was graded for
free and nobody hears about it. This job finds those copies and raises an
alert.

Where the facts live (all in the admin_core DB that ai_service uses):
  * copy_check_job.status = 'COMPLETED' - the grade route records run()'s
    outcome there: COMPLETED only when the copy was graded AND a charge was due
    (failed / cancelled copies are FAILED, graded-with-nothing-to-charge is
    NO_CHARGE). One row per assessment ai_evaluation_process (process_id).
  * credit_transactions.external_reference_id - the idempotency key column
    (CreditService.deduct_credits writes request.idempotency_key there; V243's
    partial UNIQUE index covers it). The copy-check charge uses
    idempotency_key = process_id.

So: a COMPLETED copy_check_job row from the last 48 h (older than a short
grace period, so a charge still being written is not flagged) with no
credit_transactions row whose external_reference_id is its process_id is an
unbilled copy. It is reported, not re-billed: the price inputs (page count,
graded answers, rate snapshot) live in assessment_service, so the alert names
the process for a person (or assessment_service) to re-bill.

Limits: copy_check_job rows exist only once the admin_core migration that
creates the table has run (before that the job finds nothing and says so), and
finished rows are purged after 7 days (well past the 48 h window).
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import text

logger = logging.getLogger(__name__)

# The log tag an alert rule matches on.
ALERT_TAG = "[copy-check billing reconciliation] UNBILLED"


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        logger.warning("%s is not an integer; using %d", name, default)
        return default


WINDOW_HOURS = _int_env("COPY_CHECK_RECON_WINDOW_HOURS", 48)
GRACE_MINUTES = _int_env("COPY_CHECK_RECON_GRACE_MINUTES", 15)
MAX_ROWS = _int_env("COPY_CHECK_RECON_MAX_ROWS", 500)
# When the nightly run starts, in UTC. 21:30 UTC = 03:00 IST, the quiet hours.
RUN_AT_UTC_HOUR = _int_env("COPY_CHECK_RECON_UTC_HOUR", 21)
RUN_AT_UTC_MINUTE = _int_env("COPY_CHECK_RECON_UTC_MINUTE", 30)
# Set to 0 to switch the scheduled run off (the function stays callable).
ENABLED = os.getenv("COPY_CHECK_RECON_ENABLED", "1").strip().lower() not in ("0", "false", "no", "off")

# One replica runs it: a transaction-scoped advisory lock on this key.
_LOCK_KEY = "copy_check_billing_reconciliation"

_TRY_LOCK = text("SELECT pg_try_advisory_xact_lock(hashtext(:key))")

_UNBILLED = text(
    "SELECT j.process_id, j.job_id, j.updated_at "
    "FROM copy_check_job j "
    "WHERE j.status = :completed "
    "  AND j.updated_at >= now() - (CAST(:window_hours AS double precision) * interval '1 hour') "
    "  AND j.updated_at <  now() - (CAST(:grace_minutes AS double precision) * interval '1 minute') "
    "  AND NOT EXISTS (SELECT 1 FROM credit_transactions ct "
    "                  WHERE ct.external_reference_id = j.process_id) "
    "ORDER BY j.updated_at "
    "LIMIT :max_rows"
)


def find_unbilled_completions(
    db: Any,
    *,
    window_hours: int = WINDOW_HOURS,
    grace_minutes: int = GRACE_MINUTES,
    max_rows: int = MAX_ROWS,
) -> List[Dict[str, Any]]:
    """Graded, chargeable copies of the last `window_hours` with no credit
    transaction keyed on their process id. Read-only."""
    from ...repositories.copy_check_job_repository import STATUS_COMPLETED

    rows = db.execute(_UNBILLED, {
        "completed": STATUS_COMPLETED,
        "window_hours": int(window_hours),
        "grace_minutes": int(grace_minutes),
        "max_rows": int(max_rows),
    }).fetchall()
    out = []
    for row in rows:
        updated = row.updated_at
        out.append({
            "process_id": str(row.process_id),
            "job_id": str(row.job_id),
            "completed_at": updated.isoformat() if hasattr(updated, "isoformat") else updated,
        })
    return out


def reconcile(db: Any, **kw: Any) -> Optional[List[Dict[str, Any]]]:
    """One reconciliation pass on `db`: take the cross-replica lock, find the
    unbilled copies and log an alert line per copy plus a summary. Returns the
    unbilled rows, or None when another replica holds the lock."""
    locked = db.execute(_TRY_LOCK, {"key": _LOCK_KEY}).scalar()
    if not locked:
        logger.info("copy-check billing reconciliation: another replica is running it")
        return None
    unbilled = find_unbilled_completions(db, **kw)
    for item in unbilled:
        logger.error(
            "%s process_id=%s job_id=%s completed_at=%s: graded copy has no credit transaction "
            "(idempotency key = process_id); re-bill it",
            ALERT_TAG, item["process_id"], item["job_id"], item["completed_at"],
        )
    if unbilled:
        logger.error("%s %d copy(ies) in the last %d h", ALERT_TAG, len(unbilled),
                     kw.get("window_hours", WINDOW_HOURS))
    else:
        logger.info("copy-check billing reconciliation: every completed copy of the last %d h is billed",
                    kw.get("window_hours", WINDOW_HOURS))
    return unbilled


def run_reconciliation() -> Optional[List[Dict[str, Any]]]:
    """The scheduled entry point: a fresh session, never raises."""
    try:
        from ...db import db_session

        with db_session() as db:
            return reconcile(db)
    except Exception as exc:  # noqa: BLE001 - e.g. copy_check_job not created yet
        logger.warning("copy-check billing reconciliation skipped: %s", exc)
        return None


def seconds_until_next_run(now: Optional[datetime] = None,
                           hour: int = RUN_AT_UTC_HOUR, minute: int = RUN_AT_UTC_MINUTE) -> float:
    """Seconds from `now` (UTC) to the next hour:minute UTC."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    target = now.replace(hour=hour % 24, minute=minute % 60, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def start_billing_reconciliation() -> None:
    """Schedule the nightly pass on the running event loop (the same in-process
    pattern as the ai_video sweeper and the reels reaper). No run at boot: a
    deploy is not a reason to alert."""
    if not ENABLED:
        logger.info("copy-check billing reconciliation disabled (COPY_CHECK_RECON_ENABLED)")
        return

    async def _loop() -> None:
        while True:
            await asyncio.sleep(seconds_until_next_run())
            await asyncio.to_thread(run_reconciliation)

    asyncio.get_event_loop().create_task(_loop())


__all__ = [
    "ALERT_TAG",
    "find_unbilled_completions",
    "reconcile",
    "run_reconciliation",
    "seconds_until_next_run",
    "start_billing_reconciliation",
]
