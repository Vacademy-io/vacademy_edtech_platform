"""Per-pod capacity, rate limit, single-flight, circuit breakers and counters.

Per event loop (weakref dict, like indexer._gates): the purpose pools and the
single-flight locks. Per process (thread-safe): the token bucket, the
breakers, the counters and the 1 h event window.

Pools: interactive (tutor, kb_ingest, probe) and batch (course_knowledge) are
separate, so a course re-scan never starves the tutor. Limits are read from
platform settings on every acquire, so a portal change applies at once.

Breakers (closed -> open -> half-open admitting one request):
  direct    2 BLOCKED within 10 min            -> open 6 h (consulted only
            when a fallback route is configured)
  proxy     >= 5 of the last 10 calls BLOCKED/TIMEOUT/NETWORK (after retries;
            NETWORK = the proxy refused or dropped us) -> 10 min
            PROXY_AUTH                          -> 30 min
  supadata  401/402/403 or a 404 with no known error code -> 1 h;
            429 -> Retry-After
A call that stopped only because the caller's deadline ran out is not
recorded on any breaker.
Breaker state is per pod on purpose: with 2 replicas the cost is at most one
extra half-open request per cooldown. Spend is the only thing that must hold
across replicas: the Supadata daily cap and the proxy byte budget (cache.py
usage rows) do that in the DB.

The 1 h summary line and the degraded alert are emitted lazily from record()
(at most every 10 min), so no background task is needed.
"""
from __future__ import annotations

import asyncio
import math
import threading
import time
import weakref
from collections import Counter, deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Deque, Dict, List, Optional, Tuple

from .types import BATCH_PURPOSES, Outcome, logger

WINDOW_S = 3600
SUMMARY_EVERY_S = 600
DEGRADED_MIN_CALLS = 20
DEGRADED_BLOCKED_SHARE = 0.10
DEGRADED_YT_CHANGE_SHARE = 0.05
HALF_OPEN_STALE_S = 300      # a half-open probe that never reported frees its slot after this


class Busy(Exception):
    """No slot / token / lock within the wait budget."""


def _now() -> float:
    return time.monotonic()


# ── breakers ─────────────────────────────────────────────────────────────────

class Breaker:
    def __init__(self, name: str, *, open_s: float, fail_count: int = 0, fail_window_s: float = 0.0,
                 ratio_last: int = 0, ratio_fails: int = 0) -> None:
        self.name = name
        self.open_s = open_s
        self.fail_count, self.fail_window_s = fail_count, fail_window_s
        self.ratio_last, self.ratio_fails = ratio_last, ratio_fails
        self._lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        self.state = "closed"
        self.open_until = 0.0
        self.half_open_at: Optional[float] = None
        self.reason: Optional[str] = None
        self._fail_times: Deque[float] = deque()
        self._last: Deque[bool] = deque(maxlen=max(1, self.ratio_last or 1))

    def allow(self) -> Tuple[bool, Optional[int]]:
        """(allowed, seconds left when not)."""
        with self._lock:
            now = _now()
            if self.state == "closed":
                return True, None
            if self.state == "open":
                if now < self.open_until:
                    return False, int(math.ceil(self.open_until - now))
                self.state, self.half_open_at = "half_open", now
                return True, None
            # half-open: one request at a time
            if self.half_open_at is not None and now - self.half_open_at < HALF_OPEN_STALE_S:
                return False, int(HALF_OPEN_STALE_S - (now - self.half_open_at))
            self.half_open_at = now
            return True, None

    def trip(self, seconds: float, reason: str) -> None:
        with self._lock:
            self._trip_locked(seconds, reason)

    def _trip_locked(self, seconds: float, reason: str) -> None:
        was = self.state
        self.state, self.open_until, self.half_open_at, self.reason = "open", _now() + seconds, None, reason
        self._fail_times.clear()
        self._last.clear()
        logger.error("yt_captions breaker opened route=%s for %s (%s; was %s)",
                     self.name, _fmt_secs(seconds), reason, was)

    def record(self, failed: bool, reason: str = "") -> None:
        with self._lock:
            now = _now()
            if self.state == "half_open":
                if failed:
                    self._trip_locked(self.open_s, f"half-open probe failed: {reason}")
                else:
                    self.state, self.half_open_at, self.reason = "closed", None, None
                    self._fail_times.clear()
                    self._last.clear()
                    logger.info("yt_captions breaker closed route=%s", self.name)
                return
            if self.state == "open":
                return
            if self.fail_count:
                while self._fail_times and now - self._fail_times[0] > self.fail_window_s:
                    self._fail_times.popleft()
                if failed:
                    self._fail_times.append(now)
                    if len(self._fail_times) >= self.fail_count:
                        self._trip_locked(self.open_s, f"{len(self._fail_times)} failures in "
                                                       f"{_fmt_secs(self.fail_window_s)}: {reason}")
                        return
            if self.ratio_last:
                self._last.append(bool(failed))
                if sum(self._last) >= self.ratio_fails:
                    self._trip_locked(self.open_s, f"{sum(self._last)} of the last {len(self._last)} "
                                                   f"calls failed: {reason}")

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            left = max(0, int(math.ceil(self.open_until - _now()))) if self.state == "open" else 0
            return {"state": self.state, "seconds_left": left, "reason": self.reason}


BREAKERS: Dict[str, Breaker] = {
    "direct": Breaker("direct", open_s=6 * 3600, fail_count=2, fail_window_s=600),
    "proxy": Breaker("proxy", open_s=600, ratio_last=10, ratio_fails=5),
    "supadata": Breaker("supadata", open_s=3600),
}
PROXY_AUTH_OPEN_S = 1800


def breaker(name: str) -> Breaker:
    return BREAKERS[name]


# Trust rule: direct NO_CAPTIONS counts only if direct had an OK in the last hour.
_last_direct_ok: Optional[float] = None
DIRECT_TRUST_S = 3600


def note_direct_ok() -> None:
    global _last_direct_ok
    _last_direct_ok = _now()


def direct_trusted() -> bool:
    return _last_direct_ok is not None and _now() - _last_direct_ok < DIRECT_TRUST_S


# ── token bucket (per process) ───────────────────────────────────────────────

class TokenBucket:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.tokens: Optional[float] = None
        self.updated = time.monotonic()

    def _take(self, per_minute: int) -> float:
        """0 when a token was taken, else seconds until one is available."""
        per_minute = max(1, int(per_minute))
        with self._lock:
            now = time.monotonic()      # the same clock as the callers' deadlines
            if self.tokens is None:
                self.tokens = float(per_minute)
            rate = per_minute / 60.0
            self.tokens = min(float(per_minute), self.tokens + max(0.0, now - self.updated) * rate)
            self.updated = now
            if self.tokens >= 1.0:
                self.tokens -= 1.0
                return 0.0
            return (1.0 - self.tokens) / rate

    async def take(self, per_minute: int, deadline: float) -> None:
        while True:
            wait = self._take(per_minute)
            if wait <= 0:
                return
            if time.monotonic() + wait > deadline:
                raise Busy("rate limit")
            await asyncio.sleep(min(wait, 1.0))


BUCKET = TokenBucket()


# ── per-loop pools and single-flight locks ───────────────────────────────────

class _Pool:
    def __init__(self) -> None:
        self.active = 0
        self.peak = 0
        self.cond = asyncio.Condition()

    async def acquire(self, limit_fn: Callable[[], int], timeout: float) -> None:
        async with self.cond:
            try:
                await asyncio.wait_for(self.cond.wait_for(lambda: self.active < max(1, int(limit_fn()))), timeout)
            except asyncio.TimeoutError:
                raise Busy("no free slot") from None
            self.active += 1
            self.peak = max(self.peak, self.active)

    async def release(self) -> None:
        async with self.cond:
            self.active -= 1
            self.cond.notify_all()


@dataclass
class _LoopState:
    pools: Dict[str, _Pool] = field(default_factory=dict)
    locks: Dict[str, List[Any]] = field(default_factory=dict)   # key -> [Lock, refs]


_LOOPS: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, _LoopState]" = weakref.WeakKeyDictionary()


def _state() -> _LoopState:
    loop = asyncio.get_running_loop()
    st = _LOOPS.get(loop)
    if st is None:
        st = _LOOPS[loop] = _LoopState()
    return st


def pool_name(purpose: str) -> str:
    return "batch" if purpose in BATCH_PURPOSES else "interactive"


def pool(purpose: str) -> _Pool:
    st = _state()
    name = pool_name(purpose)
    p = st.pools.get(name)
    if p is None:
        p = st.pools[name] = _Pool()
    return p


@asynccontextmanager
async def slot(purpose: str, limit_fn: Callable[[], int], timeout: float) -> AsyncIterator[None]:
    p = pool(purpose)
    await p.acquire(limit_fn, timeout)
    try:
        yield
    finally:
        await p.release()


@asynccontextmanager
async def key_lock(key: str, timeout: float) -> AsyncIterator[None]:
    """Single-flight per cache key within this pod / loop."""
    st = _state()
    entry = st.locks.get(key)
    if entry is None:
        entry = st.locks[key] = [asyncio.Lock(), 0]
    entry[1] += 1
    try:
        try:
            await asyncio.wait_for(entry[0].acquire(), timeout)
        except asyncio.TimeoutError:
            raise Busy("waiting for the same video") from None
        try:
            yield
        finally:
            entry[0].release()
    finally:
        entry[1] -= 1
        if entry[1] <= 0 and st.locks.get(key) is entry:
            st.locks.pop(key, None)


# ── counters, summary, degraded alert ────────────────────────────────────────

@dataclass
class _Event:
    ts: float
    outcome: str
    route: str
    kind: str
    ms: int
    retries: int
    supadata: bool


_COUNTS: "Counter[Tuple[str, str, str]]" = Counter()
_EVENTS: Deque[_Event] = deque()
_STATS_LOCK = threading.Lock()
_last_summary: Optional[float] = None


def record(outcome: Outcome, kind: Optional[str], route: Optional[str], ms: int, retries: int = 0,
           supadata_used: bool = False) -> None:
    global _last_summary
    now = _now()
    with _STATS_LOCK:
        _COUNTS[(outcome.value, kind or "-", route or "-")] += 1
        _EVENTS.append(_Event(now, outcome.value, route or "-", kind or "-", int(ms), int(retries),
                              bool(supadata_used)))
        while _EVENTS and now - _EVENTS[0].ts > WINDOW_S:
            _EVENTS.popleft()
        due = _last_summary is None or now - _last_summary >= SUMMARY_EVERY_S
        if due:
            _last_summary = now
    if due:
        try:
            _emit_summary()
        except Exception:  # noqa: BLE001 - stats never break a call
            logger.debug("yt_captions: summary failed", exc_info=True)


def window_stats() -> Dict[str, Any]:
    now = _now()
    with _STATS_LOCK:
        events = [e for e in _EVENTS if now - e.ts <= WINDOW_S]
    net = [e for e in events if e.route not in ("cache", "legacy_cache")]
    c = Counter(e.outcome for e in events)
    ok_kind = Counter(e.kind for e in events if e.outcome == "OK")
    oks = [e for e in net if e.outcome == "OK"]
    ms = sorted(e.ms for e in net)
    p95 = ms[min(len(ms) - 1, int(math.ceil(0.95 * len(ms))) - 1)] if ms else 0
    return {
        "window": "1h", "total": len(events), "network_calls": len(net),
        "ok_manual": ok_kind.get("manual", 0), "ok_auto": ok_kind.get("auto", 0),
        "ok_translated": ok_kind.get("translated", 0), "ok_unknown": ok_kind.get("unknown", 0),
        "no_captions": c.get("NO_CAPTIONS", 0), "blocked": c.get("BLOCKED", 0), "po_token": c.get("PO_TOKEN", 0),
        "unparsable": c.get("UNPARSABLE", 0), "empty_body": c.get("EMPTY_BODY", 0),
        "age_restricted": c.get("AGE_RESTRICTED", 0), "private": c.get("PRIVATE", 0),
        "unavailable": c.get("UNAVAILABLE", 0), "busy": c.get("BUSY", 0), "timeout": c.get("TIMEOUT", 0),
        "network": c.get("NETWORK", 0), "proxy_auth": c.get("PROXY_AUTH", 0),
        "supadata_used": sum(1 for e in events if e.supadata),
        "retries_per_ok": round(sum(e.retries for e in oks) / len(oks), 2) if oks else 0.0,
        "p95_ms": p95,
    }


def _fmt_secs(seconds: float) -> str:
    s = int(max(0, seconds))
    h, rem = divmod(s, 3600)
    m = rem // 60
    return f"{h}h{m:02d}m" if h else (f"{m}m" if m else f"{s}s")


def breakers_line() -> str:
    parts = []
    for name, b in BREAKERS.items():
        snap = b.snapshot()
        parts.append(f"{name}:{snap['state']}" + (f"({_fmt_secs(snap['seconds_left'])})" if snap["seconds_left"] else ""))
    return ",".join(parts)


def _emit_summary() -> None:
    st = window_stats()
    if not st["total"]:
        return
    logger.info(
        "yt_captions_summary window=1h total=%d ok_manual=%d ok_auto=%d ok_translated=%d no_captions=%d "
        "blocked=%d po_token=%d unparsable=%d empty_body=%d age_restricted=%d private=%d supadata_used=%d "
        "retries_per_ok=%s p95_ms=%d breakers=%s",
        st["total"], st["ok_manual"], st["ok_auto"], st["ok_translated"], st["no_captions"], st["blocked"],
        st["po_token"], st["unparsable"], st["empty_body"], st["age_restricted"], st["private"],
        st["supadata_used"], st["retries_per_ok"], st["p95_ms"], breakers_line(),
    )
    net = st["network_calls"]
    if net >= DEGRADED_MIN_CALLS:
        blocked_share = st["blocked"] / net
        change_share = (st["po_token"] + st["unparsable"]) / net
        if blocked_share > DEGRADED_BLOCKED_SHARE or change_share > DEGRADED_YT_CHANGE_SHARE:
            logger.warning(
                "yt_captions_degraded calls=%d blocked_share=%.2f po_token_unparsable_share=%.2f breakers=%s "
                "(a PO_TOKEN/UNPARSABLE rise usually means YouTube changed something: check the "
                "youtube-transcript-api releases)", net, blocked_share, change_share, breakers_line(),
            )


def reset_for_tests() -> None:
    global _last_direct_ok, _last_summary
    for b in BREAKERS.values():
        b.reset()
    with _STATS_LOCK:
        _COUNTS.clear()
        _EVENTS.clear()
    _last_direct_ok = None
    _last_summary = None
    BUCKET.tokens = None
    BUCKET.updated = time.monotonic()
    _LOOPS.clear()


__all__ = ["Busy", "Breaker", "BREAKERS", "breaker", "BUCKET", "slot", "key_lock", "pool", "pool_name",
           "record", "window_stats", "breakers_line", "note_direct_ok", "direct_trusted", "reset_for_tests",
           "PROXY_AUTH_OPEN_S"]
