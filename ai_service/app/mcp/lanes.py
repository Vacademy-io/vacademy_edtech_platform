"""
Worker threads that run MCP work away from the main event loop.

These tools run on worker threads. A worker is one daemon thread running one asyncio
event loop forever, doing one call at a time. Four lanes exist per pod, and each
worker has one connection in the MCP engine's pool:

- tool: the read-only CRM tools. As many workers as the pod's tool call limit, so a
  call the gate admitted always finds one.
- control: tool listings and the guides' authorization.
- verify: the bearer token check.
- oauth: the database work of the OAuth routes, the consent page and the MCP settings routes.

A worker goes back on its lane only when the call has really ended on its thread. A
reply can leave earlier, but the worker stays out until the thread is free.

Lanes are checked out and returned on the main event loop only.
"""
from __future__ import annotations

import asyncio
import contextvars
import logging
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Awaitable, Callable, Deque, List, Optional, Set, Tuple

from ..config import MCP_CONTROL_WORKERS, MCP_OAUTH_WORKERS, MCP_VERIFY_WORKERS, Settings, get_settings

logger = logging.getLogger(__name__)

WORKER_EXECUTOR_THREADS = 4
CONTROL_WAITERS = 16
CONTROL_WAIT_S = 5.0
VERIFY_WAITERS = 32
VERIFY_WAIT_S = 5.0
OAUTH_WAITERS = VERIFY_WAITERS
OAUTH_WAIT_S = 5.0
#: Registrations on the OAuth lane.
OAUTH_REGISTER_LIMIT = 2
#: Limits the OAuth reads. A write is left to answer, so a client never hears "busy" about one that went through.
OAUTH_READ_LIMIT_S = 10.0
STOP_GRACE_S = 2.0


class LaneBusy(Exception):
    """No worker was free in time, or the work outlasted its limit."""


class Worker:
    def __init__(self, name: str):
        self.name = name
        self.loop = asyncio.SelectorEventLoop()
        self.loop.set_default_executor(
            ThreadPoolExecutor(max_workers=WORKER_EXECUTOR_THREADS, thread_name_prefix=f"{name}-pool")
        )
        self.thread = threading.Thread(target=self._run, name=name, daemon=True)
        self.thread.start()

    def _run(self) -> None:
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()
        self.loop.close()

    def is_alive(self) -> bool:
        return self.thread.is_alive()

    def stop(self) -> None:
        """Cancel what is running and end the thread once its call has returned."""
        try:
            self.loop.call_soon_threadsafe(self._shut_down)
        except RuntimeError:
            pass

    def _shut_down(self) -> None:
        tasks = [t for t in asyncio.all_tasks(self.loop) if not t.done()]
        if not tasks:
            self.loop.stop()
            return
        for task in tasks:
            task.cancel()
        asyncio.gather(*tasks, return_exceptions=True).add_done_callback(lambda _: self.loop.stop())

    def warn_on_survivors(self, call: "asyncio.Task[Any]") -> None:
        """Only a warning: a sweep here could kill real work."""
        survivors = [t for t in asyncio.all_tasks(self.loop) if t is not call and not t.done()]
        if survivors:
            logger.warning("mcp worker %s: %d task(s) outlived the call", self.name, len(survivors))


def submit(
    worker: Worker,
    factory: Callable[[], Awaitable[Any]],
    on_finish: Callable[[], None],
) -> Tuple["asyncio.Future[Any]", Callable[[], None]]:
    """
    Start ``factory()`` on the worker, in a copy of the caller's context. Returns a
    future on the caller's loop, and a function that cancels the call on the worker.

    ``on_finish`` runs on the caller's loop and in the caller's context, once, when the
    call has ended on its thread. Cancelling the future does not trigger it, and neither
    does cancelling the call, until the thread gets back to its loop.
    """
    main = asyncio.get_running_loop()
    result = main.create_future()
    box: dict = {}
    finish_context = contextvars.copy_context()

    def deliver(task: "asyncio.Task[Any]") -> None:
        on_finish()
        exc = None if task.cancelled() else task.exception()
        if result.done():
            return
        if task.cancelled():
            result.cancel()
        elif exc is not None:
            result.set_exception(exc)
        else:
            result.set_result(task.result())

    def notify(task: "asyncio.Task[Any]") -> None:
        worker.warn_on_survivors(task)
        try:
            main.call_soon_threadsafe(deliver, task, context=finish_context)
        except RuntimeError:
            pass  # The main loop has closed: the process is exiting.

    def start() -> None:
        task = worker.loop.create_task(factory())
        box["task"] = task
        task.add_done_callback(notify)

    worker.loop.call_soon_threadsafe(start, context=contextvars.copy_context())

    def cancel() -> None:
        try:
            worker.loop.call_soon_threadsafe(lambda: box["task"].cancel())
        except RuntimeError:
            pass

    return result, cancel


class WorkerLane:
    def __init__(self, name: str, size: int, max_waiters: int = 0, wait_s: float = 0.0):
        self.name = name
        self.max_waiters = max_waiters
        self.wait_s = wait_s
        self._spawned = 0
        self._idle: Deque[Worker] = deque(self._spawn() for _ in range(size))
        self._all: Set[Worker] = set(self._idle)
        self._waiters: Deque["asyncio.Future[Worker]"] = deque()

    def _spawn(self) -> Worker:
        self._spawned += 1
        return Worker(f"{self.name}-{self._spawned}")

    def _usable(self, worker: Worker) -> Worker:
        if worker.is_alive():
            return worker
        logger.error("mcp worker %s has died; starting a replacement", worker.name)
        self._all.discard(worker)
        replacement = self._spawn()
        self._all.add(replacement)
        return replacement

    def try_checkout(self) -> Optional[Worker]:
        return self._usable(self._idle.popleft()) if self._idle else None

    def checkin(self, worker: Worker) -> None:
        while self._waiters:
            waiter = self._waiters.popleft()
            if not waiter.done():
                waiter.set_result(worker)
                return
        self._idle.append(worker)

    async def _checkout(self) -> Worker:
        worker = self.try_checkout()
        if worker is not None:
            return worker
        if len(self._waiters) >= self.max_waiters:
            raise LaneBusy(f"{self.name} queue is full")
        waiter: "asyncio.Future[Worker]" = asyncio.get_running_loop().create_future()
        self._waiters.append(waiter)
        try:
            await asyncio.wait({waiter}, timeout=self.wait_s)
        except asyncio.CancelledError:
            if waiter.done():
                self.checkin(waiter.result())
            else:
                self._forget(waiter)
            raise
        if not waiter.done():
            self._forget(waiter)
            raise LaneBusy(f"{self.name} wait timed out")
        return self._usable(waiter.result())

    def _forget(self, waiter: "asyncio.Future[Worker]") -> None:
        try:
            self._waiters.remove(waiter)
        except ValueError:
            pass
        waiter.cancel()

    async def run(self, factory: Callable[[], Awaitable[Any]], total_s: Optional[float] = None) -> Any:
        """``factory()`` on a worker. ``total_s`` limits the wait for a worker plus the run."""
        loop = asyncio.get_running_loop()
        started = loop.time()
        worker = await self._checkout()
        result, cancel = submit(worker, factory, lambda: self.checkin(worker))
        timeout = None if total_s is None else max(0.0, total_s - (loop.time() - started))
        try:
            await asyncio.wait({result}, timeout=timeout)
        except asyncio.CancelledError:
            result.cancel()
            cancel()
            raise
        if not result.done():
            result.cancel()
            cancel()
            raise LaneBusy(f"{self.name} call passed its limit")
        if result.cancelled():
            raise LaneBusy(f"{self.name} call was cancelled on its worker")
        return result.result()

    def workers(self) -> List[Worker]:
        return list(self._all)


_tool: Optional[WorkerLane] = None
_control: Optional[WorkerLane] = None
_verify: Optional[WorkerLane] = None
_oauth: Optional[WorkerLane] = None


def active() -> bool:
    return _tool is not None


def tool_lane() -> WorkerLane:
    assert _tool is not None
    return _tool


def control_lane() -> WorkerLane:
    assert _control is not None
    return _control


def verify_lane() -> WorkerLane:
    assert _verify is not None
    return _verify


def oauth_lane() -> WorkerLane:
    assert _oauth is not None
    return _oauth


def start(settings: Optional[Settings] = None) -> None:
    """Start the lanes, unless the flag is off or the gate that bounds them is off."""
    global _tool, _control, _verify, _oauth
    settings = settings or get_settings()
    if _tool is not None or not settings.mcp_off_loop_enabled or settings.mcp_max_tool_calls_per_pod <= 0:
        return
    tool = WorkerLane("mcp-tool", settings.mcp_max_tool_calls_per_pod)
    control = WorkerLane("mcp-control", MCP_CONTROL_WORKERS, CONTROL_WAITERS, CONTROL_WAIT_S)
    verify = WorkerLane("mcp-verify", MCP_VERIFY_WORKERS, VERIFY_WAITERS, VERIFY_WAIT_S)
    oauth = WorkerLane("mcp-oauth", MCP_OAUTH_WORKERS, OAUTH_WAITERS, OAUTH_WAIT_S)
    _tool, _control, _verify, _oauth = tool, control, verify, oauth


async def stop(grace_s: float = STOP_GRACE_S) -> None:
    """Stop the lanes, waiting up to the grace for each worker to end."""
    global _tool, _control, _verify, _oauth
    workers = [w for lane in (_tool, _control, _verify, _oauth) if lane is not None for w in lane.workers()]
    _tool = _control = _verify = _oauth = None
    for worker in workers:
        worker.stop()
    loop = asyncio.get_running_loop()
    deadline = loop.time() + grace_s
    while any(w.is_alive() for w in workers) and loop.time() < deadline:
        await asyncio.sleep(0.02)
    busy = sum(1 for w in workers if w.is_alive())
    if busy:
        logger.warning("mcp lanes stopped with %d worker(s) still busy", busy)


__all__ = [
    "LaneBusy",
    "Worker",
    "WorkerLane",
    "active",
    "control_lane",
    "oauth_lane",
    "start",
    "stop",
    "submit",
    "tool_lane",
    "verify_lane",
]
