"""Background poller that drains the `call_intelligence` work queue.

A single asyncio task (started from the app lifespan) repeatedly:
  1. re-arms rows a crashed worker left mid-flight (and bounded FAILED retries),
  2. atomically CLAIMS a batch of PENDING rows (FOR UPDATE SKIP LOCKED, so
     multiple ai_service replicas never grab the same row),
  3. enriches each with its recording storage key from telephony_call_log,
  4. processes them concurrently via call_intelligence_service.process_one.

Mirrors the existing reels reaper pattern (asyncio loop, idempotent start()).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List

from sqlalchemy import text

from ..db import db_session
from . import call_intelligence_service as svc

logger = logging.getLogger(__name__)

_TASK = None  # global task handle (idempotent start)

BATCH_SIZE = 4              # claimed per tick; transcription concurrency is also capped on the render worker
MAX_ATTEMPTS = 4           # give up after this many claims (transient failures re-armed below)
IDLE_SLEEP_S = 30          # nothing to do
BUSY_SLEEP_S = 2           # drained a full batch — come back promptly
ERROR_SLEEP_S = 30         # back off after an unexpected loop error
STALE_MINUTES = 30         # re-arm rows stuck in a non-terminal state this long (crash recovery)


def _claim_batch() -> List[Dict[str, Any]]:
    """Re-arm stale rows, then atomically claim up to BATCH_SIZE PENDING rows."""
    with db_session() as db:
        # Crash recovery + bounded retry: anything left TRANSCRIBING/ANALYZING by a
        # dead worker, or a transient FAILED, goes back to PENDING once it's stale.
        db.execute(text(f"""
            UPDATE call_intelligence
            SET status = 'PENDING', updated_at = now()
            WHERE status IN ('TRANSCRIBING', 'ANALYZING', 'FAILED')
              AND attempts < :max_attempts
              AND updated_at < now() - (:stale * interval '1 minute')
        """), {"max_attempts": MAX_ATTEMPTS, "stale": STALE_MINUTES})

        rows = db.execute(text("""
            WITH claimed AS (
                SELECT id FROM call_intelligence
                WHERE status = 'PENDING'
                ORDER BY created_at
                LIMIT :batch
                FOR UPDATE SKIP LOCKED
            )
            UPDATE call_intelligence ci
            SET status = 'TRANSCRIBING', attempts = ci.attempts + 1, updated_at = now()
            FROM claimed
            WHERE ci.id = claimed.id
            RETURNING ci.id, ci.call_log_id, ci.institute_id, ci.counsellor_user_id,
                      ci.response_id, ci.user_id, ci.source, ci.direction, ci.duration_seconds
        """), {"batch": BATCH_SIZE}).mappings().all()
        claimed = [dict(r) for r in rows]

        # Enrich with the recording storage key (kept on the call log, not denormalized)
        # AND which bucket it lives in. Recordings are split across the PUBLIC and the
        # PRIVATE media bucket (recording_private), and each has its own resolver route —
        # handing a private file to the public resolver 404s, which fails the whole
        # transcription job ("transcription failed: HTTP Error 404: Not Found").
        if claimed:
            ids = [c["call_log_id"] for c in claimed]
            recs = db.execute(text("""
                SELECT id, recording_storage_key, recording_private, provider_type
                FROM telephony_call_log
                WHERE id = ANY(:ids)
            """), {"ids": ids}).mappings().all()
            keys = {r["id"]: r["recording_storage_key"] for r in recs}
            private = {r["id"]: r["recording_private"] for r in recs}
            # provider_type decides billing: AI-agent calls are analysed free.
            providers = {r["id"]: r["provider_type"] for r in recs}
            for c in claimed:
                c["recording_storage_key"] = keys.get(c["call_log_id"])
                c["recording_private"] = bool(private.get(c["call_log_id"]))
                c["provider_type"] = providers.get(c["call_log_id"])
    return claimed


async def _drain_once() -> int:
    claimed = await asyncio.to_thread(_claim_batch)
    if not claimed:
        return 0
    logger.info("call-intel poller: claimed %d row(s)", len(claimed))
    await asyncio.gather(*(svc.process_one(c) for c in claimed), return_exceptions=True)
    return len(claimed)


async def _loop() -> None:
    logger.info("call-intel poller started")
    while True:
        try:
            n = await _drain_once()
            await asyncio.sleep(BUSY_SLEEP_S if n >= BATCH_SIZE else IDLE_SLEEP_S)
        except asyncio.CancelledError:
            logger.info("call-intel poller cancelled")
            raise
        except Exception:
            logger.exception("call-intel poller: tick failed")
            await asyncio.sleep(ERROR_SLEEP_S)


def start_call_intelligence_poller() -> None:
    """Start the poller task (idempotent). Call from app startup/lifespan."""
    global _TASK
    if _TASK is not None and not _TASK.done():
        return
    _TASK = asyncio.create_task(_loop(), name="call-intelligence-poller")
