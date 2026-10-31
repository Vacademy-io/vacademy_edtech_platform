"""Background worker that drains content_index_queue (spec §6.2).

One asyncio task per ai_service replica (started from the app lifespan,
idempotent like start_call_intelligence_poller). Each tick:
  1. with course_knowledge.enabled off: sleep, touching nothing but the
     platform-settings cache (no queue or setting query at all);
  2. every 30 minutes, the drift sweep (advisory-locked, one replica at a time),
     preceded by the YouTube caption canary (a network check made with no DB
     session open; its result decides whether the sweep re-queues caption
     lessons);
  3. claim up to course_knowledge.worker_batch rows (FOR UPDATE SKIP LOCKED, so
     replicas never share a lesson), index them concurrently and finalize each
     with the generation it claimed.
Every error is logged and backed off; the queue is durable, so nothing is lost.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import List, Tuple

from . import caption_requeue, flags, indexer, queue, sweep

logger = logging.getLogger(__name__)

_TASK = None  # global task handle (idempotent start)

DISABLED_SLEEP_S = 60      # feature off: idle, no DB work
IDLE_SLEEP_S = 30          # nothing (or less than a batch) to do
BUSY_SLEEP_S = 2           # drained a full batch: come back promptly
ERROR_SLEEP_S = 30         # back off after an unexpected loop error
SWEEP_EVERY_S = 30 * 60


async def _finalize(row: queue.ClaimedRow, outcome) -> None:
    if isinstance(outcome, BaseException):
        logger.error("course knowledge: index_slide raised for %s/%s: %r",
                     row.institute_id, row.slide_id, outcome)
        outcome = indexer.retry_outcome(row, f"{type(outcome).__name__}: {str(outcome)[:300]}")
    status, not_before, error = outcome
    try:
        stored = await asyncio.to_thread(
            queue.finalize, row.institute_id, row.slide_id, row.generation, status, not_before, error,
        )
    except Exception:  # noqa: BLE001 - a stuck PROCESSING row is re-armed after 30 min
        logger.exception("course knowledge: finalize failed for %s/%s", row.institute_id, row.slide_id)
        return
    if stored is not None and stored != status:
        logger.info("course knowledge: slide %s changed while indexing; queued again", row.slide_id)


async def drain_once() -> Tuple[int, int]:
    """Claim, index and finalize one batch. Returns (claimed, batch size)."""
    batch = flags.worker_batch()
    claimed: List[queue.ClaimedRow] = await asyncio.to_thread(queue.claim, batch)
    if not claimed:
        return 0, batch
    logger.info("course knowledge worker: claimed %d lesson(s)", len(claimed))
    outcomes = await asyncio.gather(*(indexer.index_slide(row) for row in claimed), return_exceptions=True)
    for row, outcome in zip(claimed, outcomes):
        if isinstance(outcome, asyncio.CancelledError):
            raise outcome
        await _finalize(row, outcome)
    return len(claimed), batch


async def _maybe_sweep(last_sweep: float) -> float:
    now = time.monotonic()
    if last_sweep and now - last_sweep < SWEEP_EVERY_S:
        return last_sweep
    captions_ok = False
    try:
        captions_ok = await caption_requeue.captions_ok_for_sweep()
    except Exception:  # noqa: BLE001 - a canary failure only skips the caption requeue
        logger.warning("course knowledge: caption canary failed", exc_info=True)
    try:
        await asyncio.to_thread(sweep.run_once, captions_ok=captions_ok)
    except Exception:  # noqa: BLE001 - the sweep is a safety net; draining goes on
        logger.exception("course knowledge: drift sweep failed")
    return now


async def _loop() -> None:
    logger.info("course knowledge worker started")
    last_sweep = 0.0
    while True:
        try:
            if not flags.platform_enabled():
                await asyncio.sleep(DISABLED_SLEEP_S)
                continue
            last_sweep = await _maybe_sweep(last_sweep)
            n, batch = await drain_once()
            await asyncio.sleep(BUSY_SLEEP_S if n >= batch else IDLE_SLEEP_S)
        except asyncio.CancelledError:
            logger.info("course knowledge worker cancelled")
            raise
        except Exception:  # noqa: BLE001
            logger.exception("course knowledge worker: tick failed")
            await asyncio.sleep(ERROR_SLEEP_S)


def start_course_knowledge_worker() -> None:
    """Start the worker task (idempotent). Call from the app lifespan."""
    global _TASK
    if _TASK is not None and not _TASK.done():
        return
    _TASK = asyncio.create_task(_loop(), name="course-knowledge-worker")


async def stop_course_knowledge_worker() -> None:
    """Cancel the worker task (lifespan shutdown); safe when it never started."""
    global _TASK
    task, _TASK = _TASK, None
    if task is None or task.done():
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


__all__ = ["start_course_knowledge_worker", "stop_course_knowledge_worker", "drain_once"]
