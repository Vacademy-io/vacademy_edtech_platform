"""Usage-limit glue between the existing credit gates and the limits engine
(contracts N3 / N4). The engine itself is metering/limits.py; this module is
what every gate, the event writer and the HTTP layer call.

Zero disruption, by construction
--------------------------------
* `policy_active(institute_id)` is the ONLY thing a gate does for an
  institute without a limits policy (every institute after deploy): one
  in-memory set lookup in limits.has_policy. No query, no import retries, no
  allocation beyond that. A gate that sees False does exactly what it did
  before this module existed.
* Every call into the engine is wrapped: an engine bug, a database error or
  the V587 tables missing FAIL OPEN (allowed, logged at most once a minute).
  The one exception that is meant to escape is LimitExceeded, raised here
  only for an ENFORCE block (the engine decides SHADOW / kill switch).
* Nothing here runs on the institute balance-lock path: the post-commit
  counter hook is called by metering/service.py after deduct_credits has
  committed.

Per-request state
-----------------
`LimitHeadersMiddleware` (registered in app_factory) installs one small
mutable `_RequestState` in a ContextVar for each HTTP request. Sync endpoints
run in a thread pool with a COPY of the context, so the state is a mutable
object, not a value: what a gate writes there (warnings, the decision for the
usage event) is visible to the middleware and to the post-commit event hook
of the same request. With no state (no request, a worker thread, a test) the
gate still works; it only cannot add the warning header.
"""
from __future__ import annotations

import logging
import threading
import time
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

WARNING_HEADER = "X-AI-Usage-Warning"
_LOG_EVERY_SECONDS = 60.0
_last_log: Dict[str, float] = {}
_stats_lock = threading.Lock()
_stats: Dict[str, int] = {"authorized": 0, "blocked": 0, "would_block": 0, "warned": 0, "failed_open": 0,
                          "counter_applied": 0, "counter_failed": 0, "overrun": 0, "refund_decrements": 0}

# Ranking of ai_usage_event.limit_decision values written by the post-commit
# hook (the worst one wins). WOULD_BLOCK outranks OVERRUN: in SHADOW an over-limit
# call is recorded as "would have been blocked", which is what the shadow report
# counts; OVERRUN is the event that pushed a counter past its hard limit.
_EVENT_RANK = {"NONE": 0, "OK": 1, "WARN": 2, "OVERRUN": 3, "WOULD_BLOCK": 4, "BLOCKED_SKIPPED": 5}


def _count(key: str, n: int = 1) -> None:
    with _stats_lock:
        _stats[key] = _stats.get(key, 0) + n


def stats() -> Dict[str, int]:
    with _stats_lock:
        return dict(_stats)


def _log_limited(key: str, level: int, msg: str, *args: Any) -> None:
    now = time.monotonic()
    last = _last_log.get(key)
    if last is not None and now - last < _LOG_EVERY_SECONDS:
        return
    _last_log[key] = now
    logger.log(level, msg, *args)


def _first_line(exc: BaseException) -> str:
    s = str(exc)
    return s.splitlines()[0][:300] if s else type(exc).__name__


# ----------------------------------------------------------------------------
# Engine access (never raises)
# ----------------------------------------------------------------------------

_engine_mod: Any = None
_engine_missing_until = 0.0


def _limits() -> Any:
    """metering/limits.py, or None when it cannot be imported (re-tried at most
    once a minute, so a broken module never costs an import per call)."""
    global _engine_mod, _engine_missing_until
    mod = _engine_mod
    if mod is not None:
        return mod
    now = time.monotonic()
    if now < _engine_missing_until:
        return None
    try:
        from . import limits as mod  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        _engine_missing_until = now + _LOG_EVERY_SECONDS
        _log_limited("import", logging.WARNING, "usage limits: engine unavailable, limits off: %s", _first_line(exc))
        return None
    _engine_mod = mod
    return mod


def policy_active(institute_id: Optional[str]) -> bool:
    """True when `institute_id` has a limits policy row (in-memory; no I/O on
    the hot path). False on any problem."""
    if not institute_id:
        return False
    mod = _limits()
    if mod is None:
        return False
    try:
        return bool(mod.has_policy(str(institute_id)))
    except Exception as exc:  # noqa: BLE001
        _log_limited("has_policy", logging.WARNING, "usage limits: has_policy failed (allowing): %s",
                     _first_line(exc))
        return False


def any_policy_known() -> bool:
    """Cheap, no-I/O hint for the middleware: False only when the engine is
    positive that no institute has a policy. Unknown -> True (install the
    request state; it costs one ContextVar set)."""
    mod = _limits()
    if mod is None:
        return False
    for name in ("any_policy", "has_any_policy", "peek_any_policy"):
        fn = getattr(mod, name, None)
        if callable(fn):
            try:
                return bool(fn())
            except Exception:  # noqa: BLE001
                return True
    idx = getattr(mod, "_index", None)
    if idx is None:
        return True
    try:
        refresh = getattr(mod, "_maybe_refresh_index", None)
        if callable(refresh):
            refresh()  # at most one background refresh per TTL; never I/O here
        return bool(idx.ids)
    except Exception:  # noqa: BLE001
        return True


# ----------------------------------------------------------------------------
# Per-request state
# ----------------------------------------------------------------------------

class _RequestState:
    __slots__ = ("scope", "warnings", "decisions", "limit_response")

    def __init__(self, scope: Optional[dict] = None) -> None:
        self.scope = scope
        self.warnings: List[Dict[str, Any]] = []
        #: institute_id -> worst event-facing decision noted by a gate in this request
        self.decisions: Dict[str, str] = {}
        self.limit_response = False


_state: ContextVar[Optional[_RequestState]] = ContextVar("ai_usage_limits_request_state", default=None)


def current_state() -> Optional[_RequestState]:
    return _state.get()


def bind_state(scope: Optional[dict] = None):
    """Install a fresh request state; returns the ContextVar token (tests, WS)."""
    return _state.set(_RequestState(scope))


def reset_state(token) -> None:
    try:
        _state.reset(token)
    except Exception:  # noqa: BLE001
        pass


def _note_decision(institute_id: Optional[str], decision: str) -> None:
    st = _state.get()
    if st is None or not institute_id or decision not in _EVENT_RANK:
        return
    key = str(institute_id)
    old = st.decisions.get(key, "NONE")
    if _EVENT_RANK[decision] > _EVENT_RANK.get(old, 0):
        st.decisions[key] = decision


def noted_decision(institute_id: Optional[str]) -> Optional[str]:
    """The decision a gate of this request noted for the institute (for the
    usage event written after the charge), or None."""
    st = _state.get()
    if st is None or not institute_id:
        return None
    return st.decisions.get(str(institute_id))


def _note_warnings(warnings: Any) -> None:
    st = _state.get()
    if st is None or not warnings:
        return
    try:
        for w in warnings:
            if isinstance(w, dict) and w not in st.warnings:
                st.warnings.append(w)
    except Exception:  # noqa: BLE001
        pass


def warning_header_value(warnings: List[Dict[str, Any]]) -> Optional[str]:
    """'<use_case>;pct=<int>' per warning (highest pct per use case), comma-joined.
    A warning the engine marked hide_pct (a shared / platform counter the
    caller may not see the numbers of) gives a bare '<use_case>'."""
    best: Dict[str, Optional[int]] = {}
    for w in warnings or []:
        try:
            uc = str(w.get("use_case") or "all").strip() or "all"
            pct = None if w.get("hide_pct") else int(float(w.get("pct") or 0))
        except Exception:  # noqa: BLE001
            continue
        if uc not in best:
            best[uc] = pct
        elif pct is not None and (best[uc] is None or pct > best[uc]):
            best[uc] = pct
    if not best:
        return None
    return ", ".join(uc if pct is None else f"{uc};pct={pct}" for uc, pct in best.items())


def context_from_current_request(institute_id: Optional[str]) -> Any:
    """MeteringContext for the HTTP request in scope (JWT roles, user id,
    surface), or None. Only called for institutes with a policy."""
    st = _state.get()
    if st is None or st.scope is None:
        return None
    try:
        from starlette.requests import Request

        from .context import MeteringContext

        return MeteringContext.from_request(Request(st.scope), institute_id)
    except Exception:  # noqa: BLE001
        return None


# ----------------------------------------------------------------------------
# Decisions
# ----------------------------------------------------------------------------

def _as_dict(decision: Any) -> Dict[str, Any]:
    if decision is None:
        return {}
    if isinstance(decision, dict):
        return decision
    for attr in ("to_dict", "as_dict", "model_dump", "dict"):
        fn = getattr(decision, attr, None)
        if callable(fn):
            try:
                out = fn()
                if isinstance(out, dict):
                    return out
            except Exception:  # noqa: BLE001
                pass
    try:
        return {k: getattr(decision, k) for k in ("allow", "decision", "warnings", "block", "reservation_id")
                if hasattr(decision, k)}
    except Exception:  # noqa: BLE001
        return {}


def none_decision() -> Dict[str, Any]:
    return {"allow": True, "decision": "NONE", "warnings": [], "block": None, "reservation_id": None}


def normalize(decision: Any) -> Dict[str, Any]:
    """Decision in its JSON shape (N2): allow, decision, warnings, block, reservation_id."""
    d = _as_dict(decision)
    out = none_decision()
    out.update({k: d.get(k) for k in ("allow", "decision", "warnings", "block", "reservation_id") if k in d})
    out["allow"] = bool(out.get("allow", True)) if out.get("allow") is not None else True
    out["decision"] = str(out.get("decision") or "NONE").upper()
    out["warnings"] = list(out.get("warnings") or [])
    for k, v in d.items():
        if k not in out:
            out[k] = v
    return out


def retry_after_seconds(block: Optional[Dict[str, Any]], now: Optional[datetime] = None) -> int:
    """Seconds until block.resets_at (at least 1). 3600 when unknown."""
    try:
        raw = (block or {}).get("resets_at")
        if not raw:
            return 3600
        when = raw if isinstance(raw, datetime) else datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        secs = int((when - (now or datetime.now(timezone.utc))).total_seconds())
        return max(1, secs)
    except Exception:  # noqa: BLE001
        return 3600


def make_exception(block: Dict[str, Any], retry_after: Optional[int] = None) -> Exception:
    """A limits.LimitExceeded carrying the N3 body (falls back to a local class
    with the same attributes if the engine's constructor differs)."""
    try:
        secs = max(1, int(retry_after)) if retry_after is not None else retry_after_seconds(block)
    except Exception:  # noqa: BLE001
        secs = retry_after_seconds(block)
    mod = _limits()
    cls = getattr(mod, "LimitExceeded", None) if mod is not None else None
    exc: Optional[Exception] = None
    if cls is not None:
        for args, kwargs in (((block,), {"retry_after_seconds": secs}), ((block, secs), {}), ((block,), {})):
            try:
                exc = cls(*args, **kwargs)
                break
            except TypeError:
                continue
            except Exception:  # noqa: BLE001
                break
    if exc is None:
        exc = _FallbackLimitExceeded(block)
    try:
        if not isinstance(getattr(exc, "body", None), dict):
            exc.body = block  # type: ignore[attr-defined]
        if not getattr(exc, "retry_after_seconds", None):
            exc.retry_after_seconds = secs  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass
    return exc


class _FallbackLimitExceeded(Exception):
    def __init__(self, body: Dict[str, Any], retry_after_seconds: int = 3600) -> None:
        super().__init__(str((body or {}).get("message") or "AI usage limit reached"))
        self.body = body
        self.retry_after_seconds = retry_after_seconds


def is_limit_exceeded(exc: BaseException) -> bool:
    mod = _limits()
    cls = getattr(mod, "LimitExceeded", None) if mod is not None else None
    return isinstance(exc, _FallbackLimitExceeded) or (cls is not None and isinstance(exc, cls))


def limit_exceeded_types() -> tuple:
    mod = _limits()
    cls = getattr(mod, "LimitExceeded", None) if mod is not None else None
    return (_FallbackLimitExceeded, cls) if isinstance(cls, type) else (_FallbackLimitExceeded,)


def _release(db, mod: Any, reservation_id: Any) -> None:
    try:
        fn = getattr(mod, "release_reservation", None)
        if callable(fn):
            fn(db, reservation_id)
    except Exception as exc:  # noqa: BLE001
        _log_limited("release", logging.WARNING, "usage limits: reservation release failed: %s", _first_line(exc))


def _ctx_arg(ctx: Any, institute_id: Optional[str]) -> Any:
    if ctx is not None:
        return ctx
    return context_from_current_request(institute_id)


def authorize(
    db,
    *,
    institute_id: Optional[str],
    use_case: Optional[str] = None,
    tool_key: Optional[str] = None,
    request_type: Optional[str] = None,
    ctx: Any = None,
    estimate_credits: Any = None,
    reserve: bool = False,
    enforce: bool = True,
) -> Optional[Dict[str, Any]]:
    """The limits decision for one operation, or None when the institute has
    no policy (no I/O at all then).

    `enforce=True` raises LimitExceeded for a BLOCK (the engine only returns
    BLOCK for an ENFORCE policy with the global kill switch on). With
    `enforce=False` a BLOCK is only noted (WOULD_BLOCK on this request's usage
    event) — for paths where refusing would do harm (see internal_llm bridge).
    Any engine failure: logged, None (allowed)."""
    if not policy_active(institute_id):
        return None
    mod = _limits()
    if mod is None:
        return None
    lim_exc = limit_exceeded_types()
    try:
        kwargs = {"catalog_reserve": False} if not reserve else {}
        try:
            raw = mod.authorize(db, institute_id=str(institute_id), use_case=use_case, tool_key=tool_key,
                                request_type=request_type, ctx=_ctx_arg(ctx, institute_id),
                                estimate_credits=estimate_credits, reserve=reserve, **kwargs)
        except TypeError:
            if not kwargs:
                raise
            raw = mod.authorize(db, institute_id=str(institute_id), use_case=use_case, tool_key=tool_key,
                                request_type=request_type, ctx=_ctx_arg(ctx, institute_id),
                                estimate_credits=estimate_credits, reserve=reserve)
        decision = normalize(raw)
        if decision.get("reservation_id") and not reserve:
            # The engine reserves for reserve_on_authorize use cases (video,
            # evaluation batches) on its own. An in-process gate has no way to
            # carry that id into the charges that follow (the video pipeline
            # charges stage by stage), so an unclaimed reservation would count
            # the same work twice for its whole TTL: give it back at once (the
            # check itself has been made under the advisory locks).
            _release(db, mod, decision.get("reservation_id"))
            decision["reservation_id"] = None
    except lim_exc as exc:  # the engine raised the block itself
        body = getattr(exc, "body", None) or {}
        decision = normalize({"allow": False, "decision": "BLOCK", "block": body})
        if enforce:
            _count("blocked")
            st = _state.get()
            if st is not None:
                st.limit_response = True
            raise
    except Exception as exc:  # noqa: BLE001 - limits must never fail a call
        _count("failed_open")
        _log_limited("authorize", logging.WARNING, "usage limits: authorize failed for %s (allowing): %s",
                     institute_id, _first_line(exc))
        return None
    _count("authorized")
    kind = decision["decision"]
    if enforce and not decision["allow"]:
        _count("blocked")
        st = _state.get()
        if st is not None:
            st.limit_response = True
        raise make_exception(decision.get("block") or {}, decision.get("retry_after_seconds"))
    _note_warnings(decision.get("warnings"))
    if decision.get("warnings"):
        _count("warned")
    if not decision["allow"] or kind == "BLOCK":
        _count("would_block")
        _note_decision(institute_id, "WOULD_BLOCK")
        return decision
    if kind == "WOULD_BLOCK":
        _count("would_block")
    if kind in ("OK", "WARN", "WOULD_BLOCK"):
        _note_decision(institute_id, kind)
    return decision


# ----------------------------------------------------------------------------
# HTTP layer: 429 handler + warning header
# ----------------------------------------------------------------------------

async def limit_exceeded_handler(request, exc):  # noqa: ANN001 - FastAPI handler signature
    """LimitExceeded -> HTTP 429 with the N3 body and Retry-After."""
    from fastapi.responses import JSONResponse

    body = getattr(exc, "body", None)
    if not isinstance(body, dict):
        body = {"error": "AI_USAGE_LIMIT", "message": str(exc) or "AI usage limit reached"}
    secs = getattr(exc, "retry_after_seconds", None)
    try:
        secs = max(1, int(secs)) if secs is not None else retry_after_seconds(body)
    except Exception:  # noqa: BLE001
        secs = retry_after_seconds(body)
    st = _state.get()
    if st is not None:
        st.limit_response = True
    return JSONResponse(status_code=429, content=body, headers={"Retry-After": str(secs)})


def _append_expose(headers, names: List[str]) -> None:
    """Let browser JS read our headers on CORS responses (only when the CORS
    middleware already set the expose list, i.e. a cross-origin response)."""
    current = headers.get("access-control-expose-headers")
    if current is None:
        return
    have = {h.strip().lower() for h in current.split(",") if h.strip()}
    extra = [n for n in names if n.lower() not in have]
    if extra:
        headers["access-control-expose-headers"] = ", ".join([current] + extra) if current else ", ".join(extra)


class LimitHeadersMiddleware:
    """Pure ASGI. Installs the per-request state and, ONLY when a gate of this
    request produced a soft warning or a 429, adds X-AI-Usage-Warning /
    exposes Retry-After. Otherwise the response passes through untouched."""

    def __init__(self, app) -> None:  # noqa: ANN001
        self.app = app

    async def __call__(self, scope, receive, send):  # noqa: ANN001
        if scope.get("type") != "http" or not any_policy_known():
            await self.app(scope, receive, send)
            return
        st = _RequestState(scope)
        token = _state.set(st)

        async def _send(message):
            if message.get("type") == "http.response.start" and (st.warnings or st.limit_response):
                try:
                    from starlette.datastructures import MutableHeaders

                    headers = MutableHeaders(scope=message)
                    expose: List[str] = []
                    value = warning_header_value(st.warnings)
                    if value and WARNING_HEADER.lower() not in headers:
                        headers[WARNING_HEADER] = value
                        expose.append(WARNING_HEADER)
                    if st.limit_response and "retry-after" in headers:
                        expose.append("Retry-After")
                    if expose:
                        _append_expose(headers, expose)
                except Exception:  # noqa: BLE001
                    pass
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            reset_state(token)


# ----------------------------------------------------------------------------
# Post-commit counter hook (called by metering/service.py)
# ----------------------------------------------------------------------------

def combine_event_decision(applied: Optional[str], noted: Optional[str]) -> str:
    """The limit_decision stored on the event: NONE when the counters were not
    touched, else the worst of the counter result and the gate's decision."""
    a = str(applied or "NONE").upper()
    if a == "NONE":
        return "NONE"
    n = str(noted or "NONE").upper()
    return n if _EVENT_RANK.get(n, 0) > _EVENT_RANK.get(a, 0) else a


__all__ = [
    "policy_active", "any_policy_known", "authorize", "normalize", "none_decision", "make_exception",
    "retry_after_seconds", "limit_exceeded_handler", "LimitHeadersMiddleware", "noted_decision",
    "combine_event_decision", "warning_header_value", "current_state", "bind_state", "reset_state",
    "context_from_current_request", "is_limit_exceeded", "limit_exceeded_types", "stats", "WARNING_HEADER",
]
