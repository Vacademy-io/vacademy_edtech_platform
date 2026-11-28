"""Cross-pod dedupe and per-pod backpressure for POST /copy-check/grade
(spec 11.2, gates G6 and G11).

  * `claim()` records the run in copy_check_job (admin_core DB) so a second
    /grade for the same process - a Java retry, a sweeper requeue landing on
    the other pod - gets the running job back instead of starting another.
  * `heartbeat_loop()` keeps that claim fresh every 30 s while the job runs; a
    claim silent for 2 minutes is taken over by the next /grade.
  * `slots` caps how many COPY-lane grade jobs one pod runs at once (off by
    default until assessment_service handles 429; `typed_slots` is the TYPED
    lane's own brake). Full = 429, which assessment_service should treat as
    "leave PENDING, retry next tick".

If copy_check_job is unreachable (e.g. ai_service deployed before the admin_core
migration that creates it), claim() returns None and the job runs without
dedupe, exactly as before this module existed. Grading never fails because the
dedupe table is missing.
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
import socket
import time
from typing import Callable, Optional

from ...repositories.copy_check_job_repository import (
    HEARTBEAT_SECONDS,
    STALE_AFTER_SECONDS,
    PURGE_AFTER_DAYS,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_NO_CHARGE,
    ClaimResult,
    CopyCheckJobRepository,
)

logger = logging.getLogger(__name__)


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        logger.warning("%s is not an integer; using %d", name, default)
        return default


# COPY-lane grade jobs one pod runs at once (spec 11, "Caps": the COPY lane is
# ai_service pods x per-pod limit). 0 (or less) = unlimited, the behaviour before
# this gate. The default stays 0 until assessment_service treats 429 as "leave
# PENDING, retry next tick" (T0.28): today its submitGrade retries twice and then
# fails the process, so a dashboard multi-select of more than `limit` copies
# would turn the extras into FAILED evaluations.
MAX_CONCURRENT_JOBS = _int_env("COPY_CHECK_MAX_CONCURRENT_JOBS", 0)
# TYPED-lane jobs per pod. The spec gives TYPED its own lane cap (12, enforced
# by assessment_service), not the per-pod COPY limit, so this is unlimited by
# default and exists only as an emergency brake.
MAX_CONCURRENT_TYPED_JOBS = _int_env("COPY_CHECK_MAX_CONCURRENT_TYPED_JOBS", 0)
# Seconds the 429 tells the caller to wait (the queue poller ticks every 15 s).
RETRY_AFTER_SECONDS = _int_env("COPY_CHECK_RETRY_AFTER_SECONDS", 15)
# A slot reserved by the request handler whose background run never started
# (response send failed, request cancelled) is reclaimed after this long.
RESERVE_TTL_SECONDS = _int_env("COPY_CHECK_SLOT_RESERVE_TTL_SECONDS", 60)
# Share of finish() calls that also purge old finished copy_check_job rows.
PURGE_SAMPLE_RATE = 0.05


class SlotGate:
    """A non-blocking counting semaphore for one pod's event loop, keyed by job.

    Equivalent to an asyncio.Semaphore used only through a non-blocking
    acquire, without binding to an event loop at import time. All methods run
    on the event loop thread with no await between the check and the update,
    so two requests cannot both take the last slot.

    The request handler reserves a slot (try_acquire) and the background run
    confirms it (start) and frees it (release). A reservation that is never
    started - Starlette skipped the background task because the response could
    not be sent, or the request was cancelled in between - expires after
    `reserve_ttl` seconds instead of leaking until the pod restarts.
    """

    def __init__(self, limit: int, reserve_ttl: float = RESERVE_TTL_SECONDS,
                 clock: Callable[[], float] = time.monotonic):
        self.limit = limit
        self.reserve_ttl = reserve_ttl
        self._clock = clock
        self._reserved: dict[str, float] = {}   # job_id -> reserved at, run not started yet
        self._running: set[str] = set()

    def _reclaim(self) -> None:
        cutoff = self._clock() - self.reserve_ttl
        for job_id in [j for j, at in self._reserved.items() if at < cutoff]:
            del self._reserved[job_id]
            logger.warning("copy-check: slot reserved for job %s was never started; reclaimed", job_id)

    @property
    def in_use(self) -> int:
        self._reclaim()
        return len(self._reserved) + len(self._running)

    def try_acquire(self, job_id: str) -> bool:
        if self.limit > 0 and self.in_use >= self.limit:
            return False
        self._reserved[job_id] = self._clock()
        return True

    def start(self, job_id: str) -> None:
        """The run for `job_id` began. Counted even if its reservation already
        expired (a brief over-admission beats a run that holds no slot)."""
        self._reserved.pop(job_id, None)
        self._running.add(job_id)

    def release(self, job_id: str) -> None:
        self._reserved.pop(job_id, None)
        self._running.discard(job_id)


slots = SlotGate(MAX_CONCURRENT_JOBS)
typed_slots = SlotGate(MAX_CONCURRENT_TYPED_JOBS)


def gate_for(answer_mode: Optional[str]) -> SlotGate:
    """The per-pod gate for a grade request's lane: TYPED has its own (by
    default unlimited) gate; everything else is the COPY lane."""
    return typed_slots if (answer_mode or "").upper() == "TYPED" else slots


def pod_name() -> str:
    return os.getenv("HOSTNAME") or socket.gethostname()


def _default_session_factory():
    from ...db import db_session

    return db_session()


SessionFactory = Callable[[], object]


def _claim_sync(process_id: str, job_id: str, session_factory: SessionFactory) -> ClaimResult:
    with session_factory() as db:
        return CopyCheckJobRepository(db).claim(
            process_id, job_id, pod_name(), stale_after_seconds=STALE_AFTER_SECONDS,
        )


async def claim(
    process_id: str,
    job_id: str,
    session_factory: Optional[SessionFactory] = None,
) -> Optional[ClaimResult]:
    """Claim the process for this job. None = dedupe unavailable (logged);
    the caller then runs the job unclaimed."""
    factory = session_factory or _default_session_factory
    try:
        return await asyncio.to_thread(_claim_sync, process_id, job_id, factory)
    except Exception as e:
        logger.warning(
            "copy-check: copy_check_job claim failed for process %s (%s); running without cross-pod dedupe",
            process_id, e,
        )
        return None


def _call_sync(method: str, process_id: str, job_id: str, session_factory: SessionFactory, **kw):
    with session_factory() as db:
        return getattr(CopyCheckJobRepository(db), method)(process_id, job_id, **kw)


async def finish(
    process_id: str,
    job_id: str,
    session_factory: Optional[SessionFactory] = None,
    status: str = STATUS_COMPLETED,
    purge_rate: float = PURGE_SAMPLE_RATE,
) -> None:
    """Mark the run ended; on a sample of calls also delete finished rows
    older than PURGE_AFTER_DAYS so the table does not grow without bound."""
    factory = session_factory or _default_session_factory
    try:
        await asyncio.to_thread(_call_sync, "finish", process_id, job_id, factory, status=status)
    except Exception as e:
        logger.warning("copy-check: could not mark copy_check_job %s/%s %s: %s", process_id, job_id, status, e)
        return
    if purge_rate > 0 and random.random() < purge_rate:
        await purge_finished(factory)


def _purge_sync(session_factory: SessionFactory) -> int:
    with session_factory() as db:
        return CopyCheckJobRepository(db).purge_finished(PURGE_AFTER_DAYS)


async def purge_finished(session_factory: Optional[SessionFactory] = None) -> None:
    factory = session_factory or _default_session_factory
    try:
        deleted = await asyncio.to_thread(_purge_sync, factory)
        if deleted:
            logger.info("copy-check: purged %d finished copy_check_job rows", deleted)
    except Exception as e:  # housekeeping only
        logger.debug("copy-check: copy_check_job purge failed: %s", e)


async def release(
    process_id: str,
    job_id: str,
    session_factory: Optional[SessionFactory] = None,
) -> None:
    factory = session_factory or _default_session_factory
    try:
        await asyncio.to_thread(_call_sync, "release", process_id, job_id, factory)
    except Exception as e:
        logger.warning("copy-check: could not release copy_check_job %s/%s: %s", process_id, job_id, e)


async def heartbeat_loop(
    process_id: str,
    job_id: str,
    session_factory: Optional[SessionFactory] = None,
    interval: float = HEARTBEAT_SECONDS,
) -> None:
    """Refresh the claim every `interval` seconds until cancelled. Stops (with a
    warning) when the row is no longer this job's - another pod took it over
    after this one went quiet for 2 minutes."""
    factory = session_factory or _default_session_factory
    while True:
        await asyncio.sleep(interval)
        try:
            still_ours = await asyncio.to_thread(_call_sync, "heartbeat", process_id, job_id, factory)
        except Exception as e:  # best effort; the next beat tries again
            logger.debug("copy-check: heartbeat for %s/%s failed: %s", process_id, job_id, e)
            continue
        if not still_ours:
            logger.warning(
                "copy-check: job %s lost its copy_check_job claim on process %s (taken over after a stall)",
                job_id, process_id,
            )
            return
