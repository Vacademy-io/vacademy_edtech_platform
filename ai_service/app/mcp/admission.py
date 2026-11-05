"""
How many MCP tool calls run at once on this pod, and the guard in front of the endpoint.

``McpAdmission`` admits a tool call up to a limit per pod and per institute, and
while the main database pool has room. A call over a limit waits a few seconds,
holding no connection and no thread, then either runs or gets a retryable error.
A refused call writes no audit row and never reaches the tool layer, so a
confirm_token it carried is not read or spent.

``McpEdgeGuard`` answers HTTP 429 before the bearer token check when the main pool
is nearly out of connections, because that check itself needs one.

The state is plain ints, a deque and futures. It is touched only on the main event
loop, with no await between a check and the take that follows it.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import logging
import re
import time
from collections import Counter, deque
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Callable, Deque, Dict, List, Optional, Tuple

from mcp.types import CallToolResult, TextContent
from starlette._utils import get_route_path

from ..config import Settings, get_settings
from ..db import get_engine
from .constants import REASON_RATE_LIMITED, REASON_SERVER_BUSY, rate_limited_payload, server_busy_payload

logger = logging.getLogger(__name__)

STATS_INTERVAL_S = 30.0
LAG_TICK_S = 0.25
LAG_WARNING_MS = 1000.0
OLDEST_CALL_ERROR_S = 300.0
REJECT_LOG_EVERY_S = 30.0
_REJECT_LOG_MAX_KEYS = 1024

EDGE_MIN_FREE_CONNECTIONS = 2
EDGE_RETRY_AFTER_S = 10
EDGE_REJECT = "edge_busy"
_EDGE_BODY = json.dumps({
    "jsonrpc": "2.0",
    "id": None,
    "error": {
        "code": -32000,
        "message": f"Vacademy is busy right now. Retry after {EDGE_RETRY_AFTER_S} seconds.",
        "data": {"error": REASON_SERVER_BUSY, "retry_after_s": EDGE_RETRY_AFTER_S},
    },
}).encode()

#: The header is read before the token is checked, so only a date-shaped value is
#: kept and the number of distinct values per interval is bounded.
_PROTOCOL_VERSION_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PROTOCOL_VERSION_MAX_KEYS = 16

#: The running call this context took a slot for. Lets ``leave`` find its start time.
_call_ticket: ContextVar[Optional[int]] = ContextVar("mcp_admission_call_ticket", default=None)


@dataclass(frozen=True)
class Rejection:
    """A call that did not run, and what the client is told about it."""

    code: str
    payload: Dict[str, Any]

    def to_result(self) -> CallToolResult:
        return CallToolResult(content=[TextContent(type="text", text=json.dumps(self.payload))], is_error=True)


@dataclass(eq=False)
class _Waiter:
    institute_id: str
    uses_main_pool: bool
    future: "asyncio.Future[None]"
    ticket: Optional[int] = field(default=None)


def _main_pool() -> Any:
    return get_engine().pool


class McpAdmission:
    def __init__(
        self,
        *,
        pod_cap: int,
        institute_cap: int,
        max_wait_s: float,
        waiters_per_institute: int,
        waiters_per_pod: int,
        pool_reserve: int,
        pool_capacity: int,
        pool_getter: Callable[[], Any] = _main_pool,
    ):
        self.pod_cap = pod_cap
        self.institute_cap = institute_cap
        self.max_wait_s = max_wait_s
        self.waiters_per_institute = waiters_per_institute
        self.waiters_per_pod = waiters_per_pod
        self.pool_reserve = pool_reserve
        self.pool_capacity = pool_capacity
        self._pool_getter = pool_getter

        self.running = 0
        self.running_on_main_pool = 0
        self.running_by_institute: Dict[str, int] = {}
        self._waiters: Deque[_Waiter] = deque()
        self._started: Dict[int, float] = {}
        self._tickets = itertools.count(1)

        self._by_reject: Counter = Counter()
        self._protocol_versions: Counter = Counter()
        self._lag_max_ms = 0.0
        self._reject_logged_at: Dict[Tuple[str, Optional[str]], float] = {}

    @classmethod
    def from_settings(cls, settings: Settings) -> "McpAdmission":
        return cls(
            pod_cap=settings.mcp_max_tool_calls_per_pod,
            institute_cap=settings.mcp_max_tool_calls_per_institute,
            max_wait_s=settings.mcp_gate_max_wait_s,
            waiters_per_institute=settings.mcp_gate_waiters_per_institute,
            waiters_per_pod=settings.mcp_gate_waiters_per_pod,
            pool_reserve=settings.mcp_pool_reserve,
            pool_capacity=settings.db_pool_size + settings.db_max_overflow,
        )

    @property
    def enabled(self) -> bool:
        return self.pod_cap > 0

    # ── the gate ─────────────────────────────────────────────────────────
    async def enter(self, institute_id: str, tool: str, uses_main_pool: bool = True) -> Optional[Rejection]:
        """None when the caller holds a slot and must call ``leave``; otherwise why the call did not run."""
        if not self.enabled:
            return None
        # Earlier waiters that became eligible go first, so a new call never overtakes them.
        self._wake()
        reason = self._blocked(institute_id, uses_main_pool)
        if reason is None:
            _call_ticket.set(self._take(institute_id, uses_main_pool))
            return None
        if self._waiter_allowance_full(institute_id):
            return self._reject(reason, institute_id, tool)

        waiter = _Waiter(institute_id, uses_main_pool, asyncio.get_running_loop().create_future())
        self._waiters.append(waiter)
        try:
            await asyncio.wait({waiter.future}, timeout=self.max_wait_s)
        except asyncio.CancelledError:
            if waiter.ticket is not None:
                self._release(institute_id, uses_main_pool, waiter.ticket)
                self._wake()
            else:
                self._forget(waiter)
            raise

        if waiter.ticket is None:
            self._forget(waiter)
            self._wake()
            reason = self._blocked(institute_id, uses_main_pool)
            if reason is not None:
                return self._reject(reason, institute_id, tool)
            waiter.ticket = self._take(institute_id, uses_main_pool)
        _call_ticket.set(waiter.ticket)
        return None

    def leave(self, institute_id: str, uses_main_pool: bool = True) -> None:
        if not self.enabled:
            return
        self._release(institute_id, uses_main_pool, _call_ticket.get())
        self._wake()

    def _blocked(self, institute_id: str, uses_main_pool: bool) -> Optional[str]:
        if self.running_by_institute.get(institute_id, 0) >= self.institute_cap:
            return REASON_RATE_LIMITED
        if self.running >= self.pod_cap:
            return REASON_SERVER_BUSY
        if uses_main_pool:
            checked_out = self._pool_checked_out()
            if (checked_out is not None
                    and checked_out + self.running_on_main_pool >= self.pool_capacity - self.pool_reserve):
                return REASON_SERVER_BUSY
        return None

    def _waiter_allowance_full(self, institute_id: str) -> bool:
        if len(self._waiters) >= self.waiters_per_pod:
            return True
        return sum(1 for w in self._waiters if w.institute_id == institute_id) >= self.waiters_per_institute

    def _take(self, institute_id: str, uses_main_pool: bool) -> int:
        self.running += 1
        self.running_by_institute[institute_id] = self.running_by_institute.get(institute_id, 0) + 1
        if uses_main_pool:
            self.running_on_main_pool += 1
        ticket = next(self._tickets)
        self._started[ticket] = time.monotonic()
        return ticket

    def _release(self, institute_id: str, uses_main_pool: bool, ticket: Optional[int]) -> None:
        self.running = max(0, self.running - 1)
        remaining = self.running_by_institute.get(institute_id, 0) - 1
        if remaining > 0:
            self.running_by_institute[institute_id] = remaining
        else:
            self.running_by_institute.pop(institute_id, None)
        if uses_main_pool:
            self.running_on_main_pool = max(0, self.running_on_main_pool - 1)
        if self._started.pop(ticket, None) is None and self._started:
            # Released from a context that did not take this slot. Dropping the
            # newest keeps the longest-running call visible in the stats.
            self._started.popitem()

    def _wake(self) -> None:
        """Grant slots first come, first served, skipping any waiter still blocked."""
        for waiter in list(self._waiters):
            if self._blocked(waiter.institute_id, waiter.uses_main_pool) is None:
                self._waiters.remove(waiter)
                waiter.ticket = self._take(waiter.institute_id, waiter.uses_main_pool)
                waiter.future.set_result(None)

    def _forget(self, waiter: _Waiter) -> None:
        try:
            self._waiters.remove(waiter)
        except ValueError:
            pass

    def _reject(self, code: str, institute_id: str, tool: str) -> Rejection:
        self._by_reject[code] += 1
        self._log_reject(code, institute_id, tool)
        if code == REASON_RATE_LIMITED:
            return Rejection(code, rate_limited_payload(self.institute_cap))
        return Rejection(code, server_busy_payload())

    def _log_reject(self, code: str, institute_id: Optional[str], tool: Optional[str]) -> None:
        now = time.monotonic()
        key = (code, institute_id)
        if self._reject_logged_at.get(key, 0.0) > now:
            return
        if len(self._reject_logged_at) >= _REJECT_LOG_MAX_KEYS:
            self._reject_logged_at = {k: v for k, v in self._reject_logged_at.items() if v > now}
            if len(self._reject_logged_at) >= _REJECT_LOG_MAX_KEYS:
                self._reject_logged_at.clear()
        self._reject_logged_at[key] = now + REJECT_LOG_EVERY_S
        logger.warning(
            "mcp_reject code=%s institute=%s tool=%s running=%d waiting=%d institute_running=%d pool_out=%s",
            code, institute_id, tool, self.running, len(self._waiters),
            self.running_by_institute.get(institute_id or "", 0), self._pool_checked_out(),
        )

    def _pool_checked_out(self) -> Optional[int]:
        """Connections out of the main pool, or None when this pool cannot say."""
        try:
            checkedout = getattr(self._pool_getter(), "checkedout", None)
            return checkedout() if checkedout is not None else None
        except Exception as exc:  # noqa: BLE001
            logger.warning("mcp admission could not read the pool: %s", exc)
            return None

    # ── the edge ─────────────────────────────────────────────────────────
    def edge_should_refuse(self) -> bool:
        if not self.enabled:
            return False
        checked_out = self._pool_checked_out()
        if checked_out is None or self.pool_capacity - checked_out >= EDGE_MIN_FREE_CONNECTIONS:
            return False
        self._by_reject[EDGE_REJECT] += 1
        self._log_reject(EDGE_REJECT, None, None)
        return True

    def note_protocol_version(self, raw: Optional[bytes]) -> None:
        if raw is None:
            value = "none"
        else:
            value = raw.decode("latin-1")
            if not _PROTOCOL_VERSION_RE.match(value):
                value = "other"
        if value in self._protocol_versions or len(self._protocol_versions) < _PROTOCOL_VERSION_MAX_KEYS:
            self._protocol_versions[value] += 1
        else:
            self._protocol_versions["other"] += 1

    # ── stats ────────────────────────────────────────────────────────────
    def note_lag(self, lag_ms: float) -> None:
        self._lag_max_ms = max(self._lag_max_ms, lag_ms)

    def snapshot(self) -> Dict[str, Any]:
        now = time.monotonic()
        return {
            "running": self.running,
            "waiting": len(self._waiters),
            "running_on_main_pool": self.running_on_main_pool,
            "running_by_institute": dict(self.running_by_institute),
            "by_reject": dict(self._by_reject),
            "pool_out": self._pool_checked_out(),
            "oldest_call_s": max((now - t for t in self._started.values()), default=0.0),
            "loop_lag_max_ms": self._lag_max_ms,
            "protocol_versions": dict(self._protocol_versions),
        }

    def reset_interval(self) -> None:
        self._by_reject.clear()
        self._protocol_versions.clear()
        self._lag_max_ms = 0.0


_instance: Optional[McpAdmission] = None


def instance() -> McpAdmission:
    global _instance
    if _instance is None:
        _instance = McpAdmission.from_settings(get_settings())
    return _instance


def reset_instance() -> McpAdmission:
    """A fresh gate from the current settings, for the start of the app's lifespan."""
    global _instance
    _instance = McpAdmission.from_settings(get_settings())
    return _instance


class McpEdgeGuard:
    """
    Wraps the MCP app. A bearer POST to the MCP endpoint gets HTTP 429 when the main
    pool has fewer than two connections free. The request body is never read.
    Everything else passes through: the OAuth routes, GET, DELETE, and requests
    with no token, which still get the SDK's 401.
    """

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if not self._applies(scope):
            await self.app(scope, receive, send)
            return
        gate = instance()
        gate.note_protocol_version(_header(scope, b"mcp-protocol-version"))
        if gate.edge_should_refuse():
            await _send_busy(send)
            return
        await self.app(scope, receive, send)

    @staticmethod
    def _applies(scope: Any) -> bool:
        if scope.get("type") != "http" or scope.get("method") != "POST":
            return False
        if get_route_path(scope) not in ("", "/"):
            return False
        authorization = _header(scope, b"authorization")
        return authorization is not None and authorization[:7].lower() == b"bearer "


def _header(scope: Any, name: bytes) -> Optional[bytes]:
    for key, value in scope.get("headers") or []:
        if key == name:
            return value
    return None


async def _send_busy(send: Any) -> None:
    await send({
        "type": "http.response.start",
        "status": 429,
        "headers": [
            (b"content-type", b"application/json"),
            (b"retry-after", str(EDGE_RETRY_AFTER_S).encode()),
            (b"content-length", str(len(_EDGE_BODY)).encode()),
        ],
    })
    await send({"type": "http.response.body", "body": _EDGE_BODY})


def log_stats(gate: McpAdmission) -> None:
    """One line per interval, the alert source for this service, then the interval counters restart."""
    snap = gate.snapshot()
    logger.info(
        "mcp_stats running=%d waiting=%d by_reject=%s pool_out=%s mcp_pool_out=0 oldest_call_s=%.1f "
        "loop_lag_max_ms=%.0f protocol_versions=%s",
        snap["running"], snap["waiting"], _compact(snap["by_reject"]), snap["pool_out"], snap["oldest_call_s"],
        snap["loop_lag_max_ms"], _compact(snap["protocol_versions"]),
    )
    if snap["loop_lag_max_ms"] > LAG_WARNING_MS:
        logger.warning("mcp_stats event loop lag reached %.0f ms", snap["loop_lag_max_ms"])
    if snap["oldest_call_s"] > OLDEST_CALL_ERROR_S:
        logger.error("mcp_stats a tool call has been running for %.0f s", snap["oldest_call_s"])
    gate.reset_interval()


def _compact(counts: Dict[str, int]) -> str:
    return json.dumps(counts, sort_keys=True, separators=(",", ":"))


async def _lag_task() -> None:
    loop = asyncio.get_running_loop()
    while True:
        started = loop.time()
        await asyncio.sleep(LAG_TICK_S)
        instance().note_lag(max(0.0, loop.time() - started - LAG_TICK_S) * 1000.0)


async def mcp_stats_task() -> None:
    while True:
        await asyncio.sleep(STATS_INTERVAL_S)
        try:
            log_stats(instance())
        except Exception as exc:  # noqa: BLE001
            logger.warning("mcp_stats line skipped: %s", exc)


def start_stats_tasks() -> List["asyncio.Task[None]"]:
    return [asyncio.create_task(mcp_stats_task(), name="mcp_stats"),
            asyncio.create_task(_lag_task(), name="mcp_stats_lag")]


async def stop_stats_tasks(tasks: List["asyncio.Task[None]"]) -> None:
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


__all__ = [
    "McpAdmission",
    "McpEdgeGuard",
    "Rejection",
    "instance",
    "log_stats",
    "mcp_stats_task",
    "reset_instance",
    "start_stats_tasks",
    "stop_stats_tasks",
]
