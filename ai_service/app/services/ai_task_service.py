"""
AiTaskService — lifecycle + background execution for AI async tasks.

Mirrors the media_service flow: a request creates a PROGRESS row and returns a
taskId immediately; an asyncio worker runs the actual work and flips the row to
COMPLETED (with result_json) or FAILED (with status_message). The DB row is the
source of truth, so progress survives restarts; the in-flight coroutine does
not (same reliability bar as the Java `aiTaskExecutor`).

Concurrency is bounded by a module-level semaphore sized to mirror the Java
pool, so a burst can't exhaust the shared pgbouncer pool or OOM the pod.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Awaitable, Callable, Optional, Set
from uuid import uuid4

from ..db import db_session
from ..models.ai_task import AiTask, AiTaskInputType, AiTaskStatus, AiTaskType
from ..repositories.ai_task_repository import AiTaskRepository

logger = logging.getLogger(__name__)

# Mirror of media_service AsyncConfig.aiTaskExecutor (core 10 / max 50). A
# semaphore is the asyncio analogue: at most N coroutines do real work at once;
# the rest await a slot. Keep this <= the SQLAlchemy pool so DB writes from
# concurrent tasks never starve.
MAX_CONCURRENT_TASKS = 16
_semaphore = asyncio.Semaphore(MAX_CONCURRENT_TASKS)

# Hold strong references to in-flight tasks so the event loop doesn't GC them
# mid-run (asyncio.create_task only keeps a weak ref).
_running: Set[asyncio.Task] = set()

# Rows left in PROGRESS longer than this are assumed orphaned by a restart and
# swept to FAILED at boot.
STALE_TASK_MINUTES = 30

# A terminal status write is retried this many times (with linear backoff) on a
# transient DB error before falling back to the startup sweep.
_STATUS_WRITE_ATTEMPTS = 3
_STATUS_WRITE_BACKOFF_SECONDS = 0.5

# A result string this long or longer is logged as suspicious (the LLM usually
# returns < ~50 KB of JSON for a lecture plan).
_LARGE_RESULT_WARN_BYTES = 1_000_000


class AiTaskService:
    """Request-scoped task operations (uses the per-request DB session)."""

    def __init__(self, repo: AiTaskRepository):
        self.repo = repo

    def create(
        self,
        *,
        task_type: AiTaskType,
        input_id: str,
        input_type: AiTaskInputType,
        task_name: str,
        institute_id: str,
        dynamic_values: Optional[dict] = None,
    ) -> AiTask:
        task = AiTask(
            id=str(uuid4()),
            task_type=task_type.value,
            status=AiTaskStatus.PROGRESS.value,
            institute_id=institute_id,
            input_id=input_id,
            input_type=input_type.value,
            task_name=task_name,
            dynamic_values_map=json.dumps(dynamic_values) if dynamic_values else None,
        )
        return self.repo.create(task)


OnDone = Callable[[AiTaskStatus, Optional[str], Optional[str]], Awaitable[None]]


def schedule(
    task_id: str,
    work: Callable[[], Awaitable[str]],
    on_done: Optional[OnDone] = None,
) -> None:
    """Fire-and-forget the background work for a task.

    `work` is a zero-arg coroutine function that performs the actual generation
    and returns the raw result string to persist. It must NOT touch the request
    DB session — the worker opens its own session for the status writes.

    `on_done(status, result_json, status_message)` runs AFTER the final status
    is written, for side effects that must see the finished row (telling the
    teacher the job is ready). Its own failure is logged and cannot change the
    task's outcome.
    """
    bg = asyncio.create_task(_run(task_id, work, on_done))
    _running.add(bg)
    bg.add_done_callback(_running.discard)


async def _run(
    task_id: str,
    work: Callable[[], Awaitable[str]],
    on_done: Optional[OnDone] = None,
) -> None:
    async with _semaphore:
        final_status = AiTaskStatus.FAILED
        result_json: Optional[str] = None
        message: Optional[str] = None
        try:
            result_json = await work()
            if result_json and len(result_json) >= _LARGE_RESULT_WARN_BYTES:
                logger.warning(
                    "Task %s produced an unusually large result (%d bytes)",
                    task_id,
                    len(result_json),
                )
            # Status writes are blocking sync DB I/O — run them off the event
            # loop so they don't stall other concurrent tasks.
            final_status, message = AiTaskStatus.COMPLETED, "Completed"
            await asyncio.to_thread(
                _set_status,
                task_id,
                AiTaskStatus.COMPLETED,
                result_json=result_json,
                status_message=message,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("AI task %s failed", task_id)
            message = str(exc)
            await asyncio.to_thread(
                _set_status, task_id, AiTaskStatus.FAILED, status_message=message
            )
        if on_done is not None:
            try:
                await on_done(final_status, result_json, message)
            except Exception:  # noqa: BLE001
                logger.exception("AI task %s: on_done hook failed", task_id)


def _set_status(
    task_id: str,
    status: AiTaskStatus,
    *,
    result_json: Optional[str] = None,
    status_message: Optional[str] = None,
) -> None:
    """Status write on a fresh session (the worker runs outside any request).

    Retried a few times on transient DB errors so a momentary blip (pool
    contention, brief disconnect) doesn't strand the row in PROGRESS until the
    startup sweep. Still best-effort: after the final attempt the failure is
    logged, not raised (the sweep is the backstop)."""
    for attempt in range(_STATUS_WRITE_ATTEMPTS):
        try:
            with db_session() as db:
                AiTaskRepository(db).update_status(
                    task_id,
                    status,
                    result_json=result_json,
                    status_message=status_message,
                )
            return
        except Exception:  # noqa: BLE001
            if attempt + 1 >= _STATUS_WRITE_ATTEMPTS:
                logger.exception(
                    "Failed to persist status %s for task %s after %d attempts",
                    status, task_id, _STATUS_WRITE_ATTEMPTS,
                )
            else:
                logger.warning(
                    "Status write for task %s failed (attempt %d/%d); retrying",
                    task_id, attempt + 1, _STATUS_WRITE_ATTEMPTS,
                )
                time.sleep(_STATUS_WRITE_BACKOFF_SECONDS * (attempt + 1))


def sweep_stale_tasks() -> int:
    """Boot-time recovery: fail tasks orphaned in PROGRESS by a prior restart."""
    try:
        with db_session() as db:
            swept = AiTaskRepository(db).fail_stale_in_progress(STALE_TASK_MINUTES)
            if swept:
                logger.info("Swept %d stale PROGRESS ai_task row(s) to FAILED.", swept)
            return swept
    except Exception:  # noqa: BLE001
        logger.exception("Stale-task sweep failed")
        return 0
