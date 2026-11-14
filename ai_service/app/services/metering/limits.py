"""AI usage limits engine (contract N2; d_credits §4.2-4.5, critique C5/C18/C20).

Who may use how much AI, per user / role / role class / institute, per day /
week / month, counted in credits (list_credits), requests or real USD.

Zero disruption
---------------
* An institute without a policy row in SHADOW or ENFORCE mode (every institute
  after deploy) costs NO database query on any path here: `has_policy` reads an
  in-process set of institute ids. That set is refreshed by ONE bulk query at
  most every POLICY_INDEX_TTL seconds, on a background thread with its own
  pooled session (never the caller's session, never under the balance row
  lock); a failed refresh keeps the last good set.
* Every public entry point fails OPEN: any bug, DB error or missing V587 table
  yields "allow" (decision NONE) and a rate-limited log line. Nothing here ever
  raises into a caller except `authorize_or_raise`'s LimitExceeded.
* Today's credit check (402) is not touched here; callers keep it as is and
  call `authorize` next to it.

Evaluation (d_credits §4.2), for one operation by actor u (role class r, raw
roles R) on use case uc in feature group g:
  1. scope levels ALL, GROUP:g, USE_CASE:uc are independent and ALL must pass;
     each (scope, period, metric) is its own slot;
  2. per slot, at most ONE individual TENANT row applies, the most specific:
     USER u > ROLE rho in R (most permissive of the matching roles) >
     ROLE_CLASS r (per_member). A USER row with hard NULL therefore exempts u
     from the role cap;
  3. pool rows (INSTITUTE, ROLE / ROLE_CLASS with per_member = false) always
     apply (AND);
  4. PLATFORM rows always apply (AND), whatever the tenant rows say;
  5. SYSTEM actors only meet INSTITUTE pools, ROLE_CLASS SYSTEM rows and
     PLATFORM rows (their user id and raw roles are ignored).
  Per applied row: used + reserved >= hard, or used + reserved + estimate >
  hard -> BLOCK; used + reserved + estimate >= soft -> WARN; else OK. The
  overall decision is the worst one. SHADOW mode, or ENFORCE with the global
  setting metering.limits.enforce = false, turns BLOCK into WOULD_BLOCK.

Counters (ai_usage_counter) are a cache of ai_usage_event: the post-commit
event writer calls `apply_event_to_counters` (one multi-row INSERT .. ON
CONFLICT DO UPDATE .. RETURNING, keys in sorted order); refunds call
`decrement_for_refund`; `rebuild_counters` recomputes them from the events.
Only keys referenced by an active limit row are kept, so after a row is added
or changed call `notify_changed(db, institute_id)` (re-reads the caches and
rebuilds the institute's current windows).

Reservations (reserve_on_authorize use cases, or reserve=True): evaluated and
inserted in one short transaction of their own under transaction-scoped
advisory locks (pg_advisory_xact_lock, sorted key order; safe behind pgbouncer
transaction pooling); expired OPEN rows are ignored, so there is no sweeper.
"""
from __future__ import annotations

import hashlib
import logging
import math
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time as dtime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from . import cache as _cache
from .constants import normalize_role_name
from .limit_models import (
    ACTIVE_PERIODS, COUNTER_TABLE, DEFAULT_TIMEZONE, LIMIT_TABLE, METRICS, ORIGINS, PERIODS, POLICY_MODES,
    POLICY_TABLE, RESERVATION_TABLE, SCOPE_KINDS, SUBJECT_KINDS, W_COUNTER_KEY,
)

logger = logging.getLogger(__name__)

POLICY_INDEX_TTL = 30.0
POLICY_CACHE_TTL = 30.0
CATALOG_FLAGS_TTL = 30.0
ENFORCE_SETTING = "metering.limits.enforce"
RESERVATION_TTL = timedelta(minutes=30)
VIDEO_RESERVATION_TTL = timedelta(hours=2)
VIDEO_USE_CASES = frozenset({"lesson_video", "ai_video_clip", "avatar_video"})
PREVIEW_MAX_EVENTS = 200_000
REBUILD_MAX_EVENTS = 200_000
ACTIVE_MODES = ("SHADOW", "ENFORCE")

_D0 = Decimal("0")
_EPS = Decimal("0.0001")
_UTC = timezone.utc
_RANK = {"NONE": 0, "OK": 1, "WARN": 2, "WOULD_BLOCK": 3, "BLOCK": 4}
_SPECIFICITY = {"USER": 0, "ROLE": 1, "ROLE_CLASS": 2}
_UNIT = {"CREDITS": "credits", "COUNT": "requests", "COST_USD": "usd"}

# ----------------------------------------------------------------------------
# Counters + rate-limited logging
# ----------------------------------------------------------------------------

_stats_lock = threading.Lock()
_stats: Dict[str, int] = {}
_last_log: Dict[str, float] = {}
_LOG_EVERY_SECONDS = 60.0


def _count(key: str, n: int = 1) -> None:
    with _stats_lock:
        _stats[key] = _stats.get(key, 0) + n


def stats() -> Dict[str, int]:
    """Process-local counters (ops / tests)."""
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


def _fail_open(where: str, exc: BaseException) -> None:
    _count("fail_open")
    _count(f"fail_open:{where}")
    _log_limited(f"fail:{where}", logging.WARNING,
                 "usage limits: %s failed, allowing (fail open): %s [fail-open so far: %d]",
                 where, _first_line(exc), _stats.get("fail_open", 0))


# ----------------------------------------------------------------------------
# Small value helpers
# ----------------------------------------------------------------------------

def _dec(value: Any) -> Decimal:
    try:
        if value is None or isinstance(value, bool):
            return _D0
        d = Decimal(str(value))
        return d if d.is_finite() else _D0
    except (InvalidOperation, ValueError, TypeError):
        return _D0


def _dec_opt(value: Any) -> Optional[Decimal]:
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return d if d.is_finite() else None


def _num_out(value: Optional[Decimal]) -> Optional[float]:
    """JSON number for an API body (int when whole)."""
    if value is None:
        return None
    q = value.quantize(Decimal("0.0001"))
    if q == q.to_integral_value():
        return int(q)
    return float(q)


def _utc(value: Any) -> Optional[datetime]:
    """Aware UTC datetime from a datetime (naive = UTC, as SQLite returns it) or ISO string."""
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            value = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=_UTC)
    return value.astimezone(_UTC)


def _now() -> datetime:
    return datetime.now(_UTC)


def _as_list(value: Any) -> List[str]:
    return _cache.as_list(value)


_TZ_CACHE: Dict[str, Any] = {}


def _tz(name: Optional[str]):
    """ZoneInfo for `name`; the default (Asia/Kolkata) for an unknown name; a
    fixed +05:30 offset if the tz database itself is unavailable."""
    key = (name or DEFAULT_TIMEZONE).strip() or DEFAULT_TIMEZONE
    tz = _TZ_CACHE.get(key)
    if tz is not None:
        return tz
    try:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo(key)
    except Exception:  # noqa: BLE001
        try:
            from zoneinfo import ZoneInfo

            tz = ZoneInfo(DEFAULT_TIMEZONE)
        except Exception:  # noqa: BLE001
            tz = timezone(timedelta(hours=5, minutes=30), "IST")
    _TZ_CACHE[key] = tz
    return tz


def _local_midnight(d: date, tz) -> datetime:
    return datetime.combine(d, dtime(0, 0), tzinfo=tz)


def _period_start_date(period: str, d: date) -> date:
    if period == "DAY":
        return d
    if period == "WEEK":
        return d - timedelta(days=d.weekday())  # ISO week: Monday
    if period == "MONTH":
        return d.replace(day=1)
    raise ValueError(f"no calendar window for period {period!r}")


def _next_start_date(period: str, start: date) -> date:
    if period == "DAY":
        return start + timedelta(days=1)
    if period == "WEEK":
        return start + timedelta(days=7)
    if period == "MONTH":
        return date(start.year + (start.month == 12), 1 if start.month == 12 else start.month + 1, 1)
    raise ValueError(f"no calendar window for period {period!r}")


def window_bounds(period: str, at: datetime, tz_name: Optional[str] = None) -> Tuple[datetime, datetime]:
    """(start, end) of the DAY / WEEK (Monday) / MONTH window containing `at`,
    with boundaries at local midnight in the policy timezone, as UTC instants."""
    tz = _tz(tz_name)
    at_utc = _utc(at) or _now()
    local_day = at_utc.astimezone(tz).date()
    start_d = _period_start_date(period, local_day)
    end_d = _next_start_date(period, start_d)
    return _local_midnight(start_d, tz).astimezone(_UTC), _local_midnight(end_d, tz).astimezone(_UTC)


def window_start(period: str, at: datetime, tz_name: Optional[str] = None) -> datetime:
    return window_bounds(period, at, tz_name)[0]


def _local_iso(at_utc: datetime, tz_name: Optional[str]) -> str:
    return at_utc.astimezone(_tz(tz_name)).isoformat()


# ----------------------------------------------------------------------------
# Data
# ----------------------------------------------------------------------------

@dataclass
class LimitRow:
    id: Optional[str]
    institute_id: Optional[str]
    subject_kind: str
    subject_value: Optional[str]
    per_member: bool
    scope_kind: str
    scope_value: Optional[str]
    period: str
    metric: str
    soft: Optional[Decimal]
    hard: Optional[Decimal]
    origin: str = "TENANT"
    locked: bool = False
    is_active: bool = True
    reason: Optional[str] = None
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None
    effective_from: Optional[datetime] = None
    effective_to: Optional[datetime] = None

    @property
    def pooled(self) -> bool:
        return self.subject_kind == "INSTITUTE" or (
            self.subject_kind in ("ROLE", "ROLE_CLASS") and not self.per_member)

    @property
    def slot(self) -> Tuple[str, str, str, str]:
        return (self.scope_kind, self.scope_value or "", self.period, self.metric)

    def to_dict(self) -> Dict[str, Any]:
        def _iso(v):
            v = _utc(v)
            return v.isoformat() if v else None
        return {
            "id": self.id, "institute_id": self.institute_id, "subject_kind": self.subject_kind,
            "subject_value": self.subject_value, "per_member": self.per_member, "scope_kind": self.scope_kind,
            "scope_value": self.scope_value, "period": self.period, "metric": self.metric,
            "soft_limit": _num_out(self.soft), "hard_limit": _num_out(self.hard), "origin": self.origin,
            "locked": self.locked, "is_active": self.is_active, "reason": self.reason,
            "created_by": self.created_by, "created_at": _iso(self.created_at), "updated_by": self.updated_by,
            "updated_at": _iso(self.updated_at), "effective_from": _iso(self.effective_from),
            "effective_to": _iso(self.effective_to),
        }


def _norm_subject_value(kind: str, value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if kind == "ROLE":
        return normalize_role_name(s)
    if kind == "ROLE_CLASS":
        return s.upper()
    return s


def _norm_scope_value(kind: str, value: Any) -> Optional[str]:
    if kind == "ALL" or value is None:
        return None
    s = str(value).strip().lower()
    return s or None


def row_from_mapping(m: Any) -> LimitRow:
    """LimitRow from a DB mapping or an API dict (soft_limit/hard_limit or soft/hard)."""
    g = m.get if hasattr(m, "get") else (lambda k, d=None: getattr(m, k, d))
    kind = str(g("subject_kind") or "").strip().upper()
    scope_kind = str(g("scope_kind") or "ALL").strip().upper()
    soft = g("soft_limit") if g("soft_limit") is not None else g("soft")
    hard = g("hard_limit") if g("hard_limit") is not None else g("hard")
    per_member = g("per_member")
    rid = g("id")
    return LimitRow(
        id=str(rid) if rid is not None else None,
        institute_id=g("institute_id"),
        subject_kind=kind,
        subject_value=_norm_subject_value(kind, g("subject_value")),
        per_member=True if per_member is None else bool(per_member),
        scope_kind=scope_kind,
        scope_value=_norm_scope_value(scope_kind, g("scope_value")),
        period=str(g("period") or "").strip().upper(),
        metric=str(g("metric") or "CREDITS").strip().upper(),
        soft=_dec_opt(soft),
        hard=_dec_opt(hard),
        origin=str(g("origin") or "TENANT").strip().upper(),
        locked=bool(g("locked") or False),
        is_active=True if g("is_active") is None else bool(g("is_active")),
        reason=g("reason"),
        created_by=g("created_by"),
        created_at=g("created_at"),
        updated_by=g("updated_by"),
        updated_at=g("updated_at"),
        effective_from=g("effective_from"),
        effective_to=g("effective_to"),
    )


def validate_row_input(data: Dict[str, Any], *, use_cases: Optional[Iterable[str]] = None,
                       groups: Optional[Iterable[str]] = None) -> Dict[str, Any]:
    """Normalised ai_usage_limit column values from an API body; ValueError
    (with a user-readable message) when something is wrong. Checks the
    vocabularies, soft <= hard, non-negative limits, subject/scope values, and
    (when `use_cases` / `groups` are given) that a scope names a known one.
    Whether a USER / ROLE subject exists is the caller's check."""
    kind = str(data.get("subject_kind") or "").strip().upper()
    if kind not in SUBJECT_KINDS:
        raise ValueError(f"subject_kind must be one of {', '.join(SUBJECT_KINDS)}")
    value = _norm_subject_value(kind, data.get("subject_value"))
    if kind == "INSTITUTE":
        value = None
    elif not value:
        raise ValueError(f"subject_value is required for subject_kind {kind}")
    scope_kind = str(data.get("scope_kind") or "ALL").strip().upper()
    if scope_kind not in SCOPE_KINDS:
        raise ValueError(f"scope_kind must be one of {', '.join(SCOPE_KINDS)}")
    scope_value = _norm_scope_value(scope_kind, data.get("scope_value"))
    if scope_kind != "ALL" and not scope_value:
        raise ValueError(f"scope_value is required for scope_kind {scope_kind}")
    if scope_kind == "USE_CASE" and use_cases is not None and scope_value not in set(use_cases):
        raise ValueError(f"unknown use case '{scope_value}'")
    if scope_kind == "GROUP" and groups is not None and scope_value not in set(groups):
        raise ValueError(f"unknown feature group '{scope_value}'")
    period = str(data.get("period") or "").strip().upper()
    if period not in PERIODS:
        raise ValueError(f"period must be one of {', '.join(PERIODS)}")
    metric = str(data.get("metric") or "CREDITS").strip().upper()
    if metric not in METRICS:
        raise ValueError(f"metric must be one of {', '.join(METRICS)}")
    raw_soft = data.get("soft_limit", data.get("soft"))
    raw_hard = data.get("hard_limit", data.get("hard"))
    soft = _dec_opt(raw_soft)
    hard = _dec_opt(raw_hard)
    if raw_soft not in (None, "") and soft is None:
        raise ValueError("soft_limit must be a number")
    if raw_hard not in (None, "") and hard is None:
        raise ValueError("hard_limit must be a number")
    if soft is not None and soft < 0:
        raise ValueError("soft_limit must be >= 0")
    if hard is not None and hard < 0:
        raise ValueError("hard_limit must be >= 0")
    if soft is not None and hard is not None and soft > hard:
        raise ValueError("soft_limit must be <= hard_limit")
    origin = str(data.get("origin") or "TENANT").strip().upper()
    if origin not in ORIGINS:
        raise ValueError(f"origin must be one of {', '.join(ORIGINS)}")
    per_member = data.get("per_member")
    return {
        "subject_kind": kind, "subject_value": value,
        "per_member": True if (per_member is None or kind in ("INSTITUTE", "USER")) else bool(per_member),
        "scope_kind": scope_kind, "scope_value": scope_value, "period": period, "metric": metric,
        "soft_limit": soft, "hard_limit": hard, "origin": origin,
        "locked": bool(data.get("locked") or False) if origin == "PLATFORM" else False,
    }


@dataclass
class Policy:
    institute_id: str
    mode: str = "OFF"
    tenant_may_enforce: bool = False
    timezone: str = DEFAULT_TIMEZONE
    notify_admins_on_soft: bool = True
    show_numbers_to_learners: bool = False
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None
    reason: Optional[str] = None
    rows: List[LimitRow] = field(default_factory=list)
    exists: bool = True

    def to_dict(self) -> Dict[str, Any]:
        upd = _utc(self.updated_at)
        return {
            "mode": self.mode, "tenant_may_enforce": self.tenant_may_enforce, "timezone": self.timezone,
            "notify_admins_on_soft": self.notify_admins_on_soft,
            "show_numbers_to_learners": self.show_numbers_to_learners,
            "updated_by": self.updated_by, "updated_at": upd.isoformat() if upd else None, "reason": self.reason,
        }


def default_policy(institute_id: str) -> Policy:
    """What an institute without a policy row has (OFF; for API responses)."""
    return Policy(institute_id=str(institute_id), exists=False)


@dataclass
class Actor:
    kind: str = "UNKNOWN"
    user_id: Optional[str] = None
    role_class: Optional[str] = None
    roles: List[str] = field(default_factory=list)

    @property
    def system(self) -> bool:
        return self.kind == "SYSTEM"


class Applied:
    """One limit row matched to an operation: its counter key, its N3 scope
    (USER | ROLE | ROLE_CLASS | INSTITUTE | PLATFORM), whether it constrains
    (`selected`; an out-ranked individual row does not) and why."""

    __slots__ = ("row", "key", "selected", "why", "subject")

    def __init__(self, row: LimitRow, key: str, selected: bool, why: str, subject: Optional[str] = None):
        self.row, self.key, self.selected, self.why = row, key, selected, why
        self.subject = subject or _subject_label(row)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Applied({self.subject} {self.row.id} key={self.key} selected={self.selected})"


@dataclass
class Decision:
    """authorize() result. Dict-style access (d["allow"]) works too."""

    allow: bool = True
    decision: str = "NONE"
    warnings: List[Dict[str, Any]] = field(default_factory=list)
    block: Optional[Dict[str, Any]] = None
    reservation_id: Optional[str] = None
    use_case: Optional[str] = None
    retry_after_seconds: Optional[int] = None
    #: SHADOW / enforce switched off: the 429 body a BLOCK would have returned
    would_block: Optional[Dict[str, Any]] = None
    #: AI plans (additive): CHARGED | INCLUDED | ALLOWANCE for an institute with
    #: a live subscription (plan_wiring.billing_mode_for); None = not reported
    #: (the key is then left out, so the JSON is exactly the pre-plans one).
    billing_mode: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        out = {
            "allow": self.allow, "decision": self.decision, "warnings": list(self.warnings), "block": self.block,
            "reservation_id": self.reservation_id, "use_case": self.use_case,
            "retry_after_seconds": self.retry_after_seconds, "would_block": self.would_block,
        }
        if self.billing_mode is not None:
            out["billing_mode"] = self.billing_mode
        return out

    def __getitem__(self, key: str) -> Any:
        return self.to_dict()[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.to_dict().get(key, default)

    @property
    def limit_decision(self) -> str:
        """The value for ai_usage_event.limit_decision (BLOCK never reaches an event)."""
        return self.decision if self.decision in ("OK", "WARN", "WOULD_BLOCK") else "NONE"

    def warning_header(self) -> Optional[str]:
        return warning_header(self)

    def raise_if_blocked(self) -> None:
        if not self.allow and self.block:
            raise LimitExceeded(self.block, self.retry_after_seconds)


class LimitExceeded(Exception):
    """A hard limit refused the operation. `.body` is the 429 JSON (N3);
    `.retry_after_seconds` the Retry-After header value."""

    def __init__(self, body: Dict[str, Any], retry_after_seconds: Optional[int] = None):
        super().__init__((body or {}).get("message") or "AI usage limit reached")
        self.body = dict(body or {})
        self.retry_after_seconds = int(retry_after_seconds) if retry_after_seconds is not None else None

    def headers(self) -> Dict[str, str]:
        return {"Retry-After": str(max(int(self.retry_after_seconds or 0), 0))}


def warning_header(decision: Any) -> Optional[str]:
    """X-AI-Usage-Warning value ("<use_case>;pct=<int>") for the highest
    warning of a Decision (or its dict), else None."""
    try:
        warnings = decision.warnings if hasattr(decision, "warnings") else (decision or {}).get("warnings")
        if not warnings:
            return None
        top = max(warnings, key=lambda w: (not w.get("hide_pct"), w.get("pct") or 0))
        if top.get("hide_pct"):
            return f"{top.get('use_case') or 'ai'}"
        return f"{top.get('use_case') or 'ai'};pct={int(top.get('pct') or 0)}"
    except Exception:  # noqa: BLE001
        return None


# ----------------------------------------------------------------------------
# Session handling (never leave the caller's session idle in a transaction)
# ----------------------------------------------------------------------------

def _engine_of(db) -> Any:
    bind = db.get_bind()
    return getattr(bind, "engine", bind)


def _is_pg(db) -> bool:
    try:
        return db.get_bind().dialect.name == "postgresql"
    except Exception:  # noqa: BLE001
        return False


def _dirty(db) -> bool:
    try:
        return bool(db.new or db.dirty or db.deleted)
    except Exception:  # noqa: BLE001
        return False


def _pool_would_wait(db) -> bool:
    try:
        from .service import _pool_would_wait as pww

        return pww(db)
    except Exception:  # noqa: BLE001
        return False


def _separate(db, fn: Callable[[Any], Any]) -> Any:
    from sqlalchemy.orm import Session

    if _pool_would_wait(db):
        raise RuntimeError("DB pool exhausted; limits check skipped")
    s = Session(bind=_engine_of(db), future=True)
    try:
        out = fn(s)
        s.commit()
        return out
    except Exception:
        try:
            s.rollback()
        except Exception:  # noqa: BLE001
            pass
        raise
    finally:
        s.close()


def _read(db, fn: Callable[[Any], Any]) -> Any:
    """Run read work on the caller's session: in a SAVEPOINT when it already
    has a transaction, else in one that is ended right after (so no
    idle-in-transaction connection is left behind a long AI call)."""
    if db.in_transaction():
        with db.begin_nested():
            return fn(db)
    if _dirty(db):
        return _separate(db, fn)
    try:
        return fn(db)
    finally:
        try:
            if db.in_transaction():
                db.commit()
        except Exception:  # noqa: BLE001
            try:
                db.rollback()
            except Exception:  # noqa: BLE001
                pass


def _own_txn(db, fn: Callable[[Any], Any]) -> Any:
    """Run write work in a SHORT transaction of its own that is committed here:
    the caller's session when it has no transaction (and nothing pending), else
    a separate session on the same engine."""
    if not db.in_transaction() and not _dirty(db):
        try:
            out = fn(db)
            db.commit()
            return out
        except Exception:
            try:
                db.rollback()
            except Exception:  # noqa: BLE001
                pass
            raise
    return _separate(db, fn)


# ----------------------------------------------------------------------------
# Policy index (has_policy): in-memory set, bulk refresh, never on the caller
# ----------------------------------------------------------------------------

class _PolicyIndex:
    def __init__(self) -> None:
        self.ids: frozenset = frozenset()
        self.loaded_at: Optional[float] = None
        self.attempted_at: Optional[float] = None
        self.refreshing = False
        self.lock = threading.Lock()
        self.engine: Any = None
        self.sessionmaker: Any = None
        self.ok = False


_index = _PolicyIndex()


def configure(engine: Any = None, sessionmaker: Any = None) -> None:
    """Tell the policy index which engine / sessionmaker to refresh on (tests,
    scripts). In the app it uses ai_service's own sessionmaker once the app
    engine exists."""
    _index.engine = engine
    _index.sessionmaker = sessionmaker


def _load_index_ids(session) -> frozenset:
    from sqlalchemy import select

    P = POLICY_TABLE.c
    rows = session.execute(select(P.institute_id).where(P.mode.in_(ACTIVE_MODES))).all()
    return frozenset(str(r[0]) for r in rows if r[0])


def _index_session():
    """A fresh session for the bulk refresh, or None when there is nothing to
    refresh on yet (no configured engine and the app engine not created)."""
    if _index.sessionmaker is not None:
        return _index.sessionmaker()
    if _index.engine is not None:
        from sqlalchemy.orm import Session

        return Session(bind=_index.engine, future=True)
    try:
        from ... import db as _appdb

        if getattr(_appdb, "_engine", None) is None:
            return None
        return _appdb.get_sessionmaker()()
    except Exception:  # noqa: BLE001
        return None


def refresh_policy_index(session=None) -> bool:
    """Reload the set of institutes with an active policy (ONE query), now,
    synchronously. On `session` when given (caller owns it; read only), else on
    a fresh session. Keeps the last good set on failure. Returns success."""
    own = session is None
    s = session if session is not None else _index_session()
    _index.attempted_at = time.monotonic()
    if s is None:
        # Nothing to refresh on yet (a fresh process whose app engine is not
        # created until the first DB request): try again in ~1 s instead of a
        # full TTL, so a new pod does not ignore every policy for 30 s.
        _index.attempted_at = time.monotonic() - max(POLICY_INDEX_TTL - 1.0, 0.0)
        return False
    try:
        ids = _load_index_ids(s)
        if own:
            s.commit()
        if ids != _index.ids:
            logger.info("usage limits: %d institute(s) with an active limits policy", len(ids))
        _index.ids = ids
        _index.loaded_at = time.monotonic()
        _index.ok = True
        return True
    except Exception as exc:  # noqa: BLE001
        _count("index_refresh_failed")
        _log_limited("index", logging.WARNING,
                     "usage limits: policy index refresh failed (keeping %d known institute(s); "
                     "limits stay off for others until V587 is applied / the DB answers): %s",
                     len(_index.ids), _first_line(exc))
        if own:
            try:
                s.rollback()
            except Exception:  # noqa: BLE001
                pass
        return False
    finally:
        if own:
            try:
                s.close()
            except Exception:  # noqa: BLE001
                pass


def _refresh_in_background() -> None:
    try:
        refresh_policy_index()
    finally:
        with _index.lock:
            _index.refreshing = False


def _maybe_refresh_index() -> None:
    now = time.monotonic()
    last = _index.attempted_at if _index.attempted_at is not None else None
    if last is not None and now - last < POLICY_INDEX_TTL:
        return
    with _index.lock:
        if _index.refreshing:
            return
        if _index.attempted_at is not None and now - _index.attempted_at < POLICY_INDEX_TTL:
            return
        _index.refreshing = True
        _index.attempted_at = now
    try:
        threading.Thread(target=_refresh_in_background, name="ai-limits-index", daemon=True).start()
    except Exception as exc:  # noqa: BLE001
        with _index.lock:
            _index.refreshing = False
        _fail_open("index-thread", exc)


def has_policy(institute_id: Any) -> bool:
    """True when the institute has a limits policy in SHADOW or ENFORCE mode.
    No I/O on the calling thread, ever: an in-process set, refreshed in the
    background at most every POLICY_INDEX_TTL seconds (last good on error)."""
    try:
        if not institute_id:
            return False
        _maybe_refresh_index()
        return str(institute_id) in _index.ids
    except Exception:  # noqa: BLE001
        return False


def set_policy_index_for_tests(ids: Iterable[str]) -> None:
    _index.ids = frozenset(str(i) for i in ids)
    _index.loaded_at = _index.attempted_at = time.monotonic()
    _index.ok = True


# ----------------------------------------------------------------------------
# Policy + rows cache (only ever read for institutes in the index)
# ----------------------------------------------------------------------------

_policy_cache: Dict[str, Tuple[float, Optional[Policy]]] = {}
_policy_lock = threading.Lock()


def _row_active(row: LimitRow, now: datetime) -> bool:
    if not row.is_active:
        return False
    eff_to = _utc(row.effective_to)
    if eff_to is not None and eff_to <= now:
        return False
    eff_from = _utc(row.effective_from)
    return eff_from is None or eff_from <= now


def _load_policy(s, institute_id: str) -> Optional[Policy]:
    from sqlalchemy import or_, select

    P = POLICY_TABLE.c
    prow = s.execute(select(POLICY_TABLE).where(P.institute_id == institute_id)).mappings().first()
    L = LIMIT_TABLE.c
    now = _now()
    rows = s.execute(
        select(LIMIT_TABLE).where(L.institute_id == institute_id, L.is_active.is_(True),
                                  or_(L.effective_to.is_(None), L.effective_to > now))
    ).mappings().all()
    if prow is None:
        if not rows:
            return None
        pol = default_policy(institute_id)
    else:
        mode = str(prow.get("mode") or "OFF").strip().upper()
        pol = Policy(
            institute_id=institute_id,
            mode=mode if mode in POLICY_MODES else "OFF",
            tenant_may_enforce=bool(prow.get("tenant_may_enforce")),
            timezone=str(prow.get("timezone") or DEFAULT_TIMEZONE),
            notify_admins_on_soft=bool(prow.get("notify_admins_on_soft")) if prow.get(
                "notify_admins_on_soft") is not None else True,
            show_numbers_to_learners=bool(prow.get("show_numbers_to_learners")),
            updated_by=prow.get("updated_by"), updated_at=prow.get("updated_at"), reason=prow.get("reason"),
        )
    for r in rows:
        try:
            lr = row_from_mapping(r)
            if lr.subject_kind in SUBJECT_KINDS and lr.scope_kind in SCOPE_KINDS and lr.period in PERIODS \
                    and lr.metric in METRICS and lr.origin in ORIGINS and _row_active(lr, now):
                pol.rows.append(lr)
        except Exception:  # noqa: BLE001
            continue
    return pol


def get_policy(db, institute_id: Any, *, fresh: bool = False) -> Optional[Policy]:
    """The institute's policy and its active limit rows (TENANT + PLATFORM),
    cached POLICY_CACHE_TTL seconds; None when it has neither a policy row nor
    rows. On a read failure: the last good copy, else None (fail open)."""
    if not institute_id:
        return None
    inst = str(institute_id)
    now = time.monotonic()
    if not fresh:
        hit = _policy_cache.get(inst)
        if hit is not None and now - hit[0] < POLICY_CACHE_TTL:
            return hit[1]
    try:
        pol = _read(db, lambda s: _load_policy(s, inst))
    except Exception as exc:  # noqa: BLE001
        _fail_open("policy-read", exc)
        hit = _policy_cache.get(inst)
        return hit[1] if hit is not None else None
    with _policy_lock:
        _policy_cache[inst] = (time.monotonic(), pol)
    return pol


def invalidate(institute_id: Any = None, *, active: Optional[bool] = None) -> None:
    """After a policy / row write: forget the cached policy (one institute or
    all). `active` updates this process's policy index at once (True = now in
    SHADOW/ENFORCE, False = OFF / removed); other processes catch up within
    POLICY_INDEX_TTL seconds."""
    with _policy_lock:
        if institute_id is None:
            _policy_cache.clear()
        else:
            _policy_cache.pop(str(institute_id), None)
    _flags_state["at"] = None
    if institute_id is not None and active is not None:
        ids = set(_index.ids)
        if active:
            ids.add(str(institute_id))
        else:
            ids.discard(str(institute_id))
        _index.ids = frozenset(ids)
    else:
        _index.attempted_at = None


def reset_for_tests() -> None:
    with _policy_lock:
        _policy_cache.clear()
    _index.ids = frozenset()
    _index.loaded_at = None
    _index.attempted_at = None
    _index.refreshing = False
    _index.ok = False
    _index.engine = None
    _index.sessionmaker = None
    _flags_state["at"] = None
    _flags_state["map"] = {}
    _last_log.clear()
    with _stats_lock:
        _stats.clear()
    with _role_lock:
        _role_cache.clear()
    try:
        cancel_delayed_rebuilds()
    except NameError:  # pragma: no cover - defined further down
        pass


# ----------------------------------------------------------------------------
# Catalog flags (limit_eligible, reserve_on_authorize, typical_credits, unit)
# ----------------------------------------------------------------------------

@dataclass
class UseCaseFlags:
    use_case: str
    feature_group: str = "platform"
    label: str = "AI"
    count_unit_label: str = "requests"
    limit_eligible: bool = True
    reserve_on_authorize: bool = False
    typical_credits: Optional[Decimal] = None
    actor_kind: str = "USER"


_flags_state: Dict[str, Any] = {"at": None, "map": {}}


def _load_flags(s) -> Dict[str, UseCaseFlags]:
    from sqlalchemy import select

    from .models import CATALOG_TABLE

    c = CATALOG_TABLE.c
    out: Dict[str, UseCaseFlags] = {}
    for r in s.execute(select(c.use_case, c.feature_group, c.label, c.count_unit_label, c.limit_eligible,
                              c.reserve_on_authorize, c.typical_credits, c.actor_kind)).mappings().all():
        uc = str(r.get("use_case") or "").strip()
        if not uc:
            continue
        out[uc] = UseCaseFlags(
            use_case=uc, feature_group=str(r.get("feature_group") or "platform"),
            label=str(r.get("label") or uc), count_unit_label=str(r.get("count_unit_label") or "requests"),
            limit_eligible=r.get("limit_eligible") is not False and r.get("limit_eligible") != 0,
            reserve_on_authorize=bool(r.get("reserve_on_authorize")),
            typical_credits=_dec_opt(r.get("typical_credits")),
            actor_kind=str(r.get("actor_kind") or "USER").upper(),
        )
    return out


def _catalog_flags(db) -> Dict[str, UseCaseFlags]:
    at = _flags_state.get("at")
    if at is not None and time.monotonic() - at < CATALOG_FLAGS_TTL:
        return _flags_state["map"]
    try:
        m = _read(db, _load_flags)
        _flags_state["map"] = m
    except Exception as exc:  # noqa: BLE001
        _fail_open("catalog-read", exc)
    _flags_state["at"] = time.monotonic()
    return _flags_state["map"]


def _flags_for(flags: Dict[str, UseCaseFlags], use_case: str, group: Optional[str] = None) -> UseCaseFlags:
    f = flags.get(use_case)
    if f is not None:
        return f
    return UseCaseFlags(use_case=use_case, feature_group=group or "platform", label=use_case.replace("_", " ").title())


def _snapshot(db):
    """The metering lookups (catalog / role map). get_snapshot only touches the
    session when its 300 s cache is stale (in its own SAVEPOINT); a transaction
    it had to open on an idle session is ended here."""
    try:
        was_in_txn = db.in_transaction()
        if not was_in_txn and _dirty(db):
            return _cache.peek_snapshot()
        snap = _cache.get_snapshot(db)
        if not was_in_txn and db.in_transaction():
            try:
                db.commit()
            except Exception:  # noqa: BLE001
                db.rollback()
        return snap
    except Exception:  # noqa: BLE001
        return _cache.peek_snapshot()


def _resolve_use_case(snap, flags, use_case, tool_key, request_type) -> Tuple[str, Optional[dict]]:
    from .service import EventInput, resolve_use_case

    if snap is None:
        uc = str(use_case or "unknown").strip().lower() or "unknown"
        return uc, None
    inp = EventInput(use_case=use_case, tool_key=tool_key, request_type=request_type)
    uc, _src, row = resolve_use_case(snap, inp, (str(tool_key).strip()[:64] if tool_key else None))
    return uc, row


# ----------------------------------------------------------------------------
# Actors and counter keys
# ----------------------------------------------------------------------------

_CTX_FIELDS = ("actor_kind", "actor_user_id", "user_id", "user_role", "actor_role_class", "actor_roles_raw",
               "user_roles_raw", "roles", "role_source", "source_service", "usage_context", "subject_user_id")


def _ctx_fields(ctx: Any) -> Dict[str, Any]:
    if ctx is None:
        return {}
    if isinstance(ctx, dict):
        return dict(ctx)
    if hasattr(ctx, "as_fields"):
        try:
            return dict(ctx.as_fields())
        except Exception:  # noqa: BLE001
            pass
    out = {}
    for k in _CTX_FIELDS:
        v = getattr(ctx, k, None)
        if v is not None:
            out[k] = v
    return out


def actor_from_ctx(snap, ctx: Any, catalog_row: Optional[dict] = None) -> Actor:
    """The actor exactly as the event writer will resolve it (service.resolve_actor),
    so authorize and the later counter increment use the same counter keys."""
    from .service import EventInput, resolve_actor

    f = _ctx_fields(ctx)
    roles = f.get("actor_roles_raw") or f.get("user_roles_raw") or f.get("roles")
    inp = EventInput(
        actor_kind=f.get("actor_kind"), actor_user_id=f.get("actor_user_id"), user_id=f.get("user_id"),
        user_role=f.get("user_role"), actor_role_class=f.get("actor_role_class"),
        actor_roles_raw=list(roles) if isinstance(roles, (list, tuple, set)) else roles,
        role_source=f.get("role_source"), source_service=f.get("source_service"),
        usage_context=f.get("usage_context") if isinstance(f.get("usage_context"), dict) else None,
    )
    r = resolve_actor(snap, inp, catalog_row)
    return Actor(kind=r["actor_kind"], user_id=r["actor_user_id"], role_class=r["actor_role_class"],
                 roles=list(r["actor_roles_raw"] or []))


def actor_from_event(ev: Dict[str, Any]) -> Actor:
    roles = [normalize_role_name(r) for r in _as_list(ev.get("actor_roles_raw")) if normalize_role_name(r)]
    rc = ev.get("actor_role_class")
    return Actor(kind=str(ev.get("actor_kind") or "UNKNOWN").upper(),
                 user_id=str(ev["actor_user_id"]) if ev.get("actor_user_id") else None,
                 role_class=str(rc).upper() if rc else None, roles=roles)


# --- Role attribution for actors whose event / request carries no role ------
#
# Many charge paths write events with only a user id (role_source UNRESOLVED;
# the nightly AiUsageRoleBackfillJob fills the role later), and some gates
# (admin_core's agent / workflow drafts) send only a user id. ROLE and
# ROLE_CLASS rows must still find such an actor, at the gate and when the
# event is counted, so its role comes from (1) what a gate of this process
# last saw for the user (JWT roles), else (2) the user's latest event with a
# resolved role (one indexed query, cached; only for institutes with a
# policy). Unknown stays unknown: no ROLE / ROLE_CLASS row then (fail open).

ROLE_CACHE_TTL = 3600.0
ROLE_CACHE_MISS_TTL = 300.0
ROLE_CACHE_MAX = 50_000
ROLE_LOOKUP_DAYS = 35
_role_cache: Dict[Tuple[str, str], Tuple[float, Optional[str], Tuple[str, ...]]] = {}
_role_lock = threading.Lock()


def _needs_roles(actor: Actor) -> bool:
    return (not actor.system) and bool(actor.user_id) and not actor.role_class and not actor.roles


def remember_actor_roles(institute_id: Any, actor: Actor) -> None:
    """Note an actor's role class / roles as a gate saw them (verified JWT or a
    trusted caller), so later events of the same user without a role count
    under it. Bounded; never raises."""
    try:
        if actor.system or not actor.user_id or not (actor.role_class or actor.roles) or not institute_id:
            return
        key = (str(institute_id), str(actor.user_id))
        with _role_lock:
            if len(_role_cache) >= ROLE_CACHE_MAX and key not in _role_cache:
                _role_cache.clear()
            _role_cache[key] = (time.monotonic() + ROLE_CACHE_TTL, actor.role_class, tuple(actor.roles))
    except Exception:  # noqa: BLE001
        pass


def _cached_roles(institute_id: str, user_id: str) -> Optional[Tuple[Optional[str], Tuple[str, ...]]]:
    hit = _role_cache.get((institute_id, user_id))
    if hit is None or hit[0] < time.monotonic():
        return None
    return hit[1], hit[2]


def _latest_resolved_actor(s, institute_id: str, user_id: str) -> Tuple[Optional[str], Tuple[str, ...]]:
    from sqlalchemy import select

    from .models import EVENT_TABLE as E

    since = _now() - timedelta(days=ROLE_LOOKUP_DAYS)
    r = s.execute(select(E.c.actor_role_class, E.c.actor_roles_raw)
                  .where(E.c.institute_id == institute_id, E.c.actor_user_id == user_id,
                         E.c.actor_role_class.isnot(None), E.c.occurred_at >= since)
                  .order_by(E.c.occurred_at.desc()).limit(1)).first()
    if r is None:
        return None, ()
    roles = tuple(normalize_role_name(x) for x in _as_list(r[1]) if normalize_role_name(x))
    rc = str(r[0]).upper() if r[0] else None
    return (rc if rc != "UNKNOWN" else None), roles


def _with_roles(actor: Actor, rc: Optional[str], roles: Sequence[str]) -> Actor:
    if not rc and not roles:
        return actor
    return Actor(kind=actor.kind, user_id=actor.user_id, role_class=rc, roles=list(roles))


def fill_actor_roles(db, institute_id: str, actor: Actor, *, role_map: Optional[Dict[str, Any]] = None,
                     lookup: bool = True) -> Actor:
    """`actor` with a role class / roles when it has a user id but no role:
    from this process's gate cache, else `role_map` (a rebuild / preview's
    preloaded {user_id: (role_class, roles)}), else (lookup=True) the user's
    latest resolved event. Never raises; unchanged when nothing is known."""
    try:
        if not _needs_roles(actor):
            return actor
        inst, uid = str(institute_id), str(actor.user_id)
        hit = _cached_roles(inst, uid)
        if hit is not None:
            return _with_roles(actor, *hit)
        if role_map is not None:
            got = role_map.get(uid)
            return _with_roles(actor, *got) if got else actor
        if not lookup or db is None:
            return actor
        rc, roles = _read(db, lambda s: _latest_resolved_actor(s, inst, uid))
        with _role_lock:
            if len(_role_cache) >= ROLE_CACHE_MAX:
                _role_cache.clear()
            ttl = ROLE_CACHE_TTL if (rc or roles) else ROLE_CACHE_MISS_TTL
            _role_cache[(inst, uid)] = (time.monotonic() + ttl, rc, tuple(roles))
        return _with_roles(actor, rc, roles)
    except Exception as exc:  # noqa: BLE001
        _fail_open("role-lookup", exc)
        return actor


def _load_role_map(s, institute_id: str, since: datetime) -> Dict[str, Tuple[Optional[str], Tuple[str, ...]]]:
    """{user_id: (role_class, roles)} from each user's latest resolved event
    since `since` (rebuild / preview: one query instead of one per user)."""
    from sqlalchemy import select

    from .models import EVENT_TABLE as E

    out: Dict[str, Tuple[Optional[str], Tuple[str, ...]]] = {}
    stmt = (select(E.c.actor_user_id, E.c.actor_role_class, E.c.actor_roles_raw)
            .where(E.c.institute_id == institute_id, E.c.actor_user_id.isnot(None),
                   E.c.actor_role_class.isnot(None), E.c.occurred_at >= since)
            .order_by(E.c.occurred_at))
    for uid, rc, raw in s.execute(stmt).all():
        rc_u = str(rc).upper() if rc else None
        if not uid or not rc_u or rc_u == "UNKNOWN":
            continue
        out[str(uid)] = (rc_u, tuple(normalize_role_name(x) for x in _as_list(raw) if normalize_role_name(x)))
    return out


def scope_key(scope_kind: str, scope_value: Optional[str]) -> str:
    if scope_kind == "GROUP":
        return f"G:{scope_value}"
    if scope_kind == "USE_CASE":
        return f"UC:{scope_value}"
    return "ALL"


def _fit_key(prefix: str, ident: str, scope: str) -> str:
    key = f"{prefix}:{ident}|{scope}"
    if len(key) <= W_COUNTER_KEY:
        return key
    digest = hashlib.sha1(ident.encode("utf-8")).hexdigest()
    return f"{prefix}#{digest}|{scope}"[:W_COUNTER_KEY]


def _scope_matches(row: LimitRow, use_case: Optional[str], group: Optional[str]) -> bool:
    if row.scope_kind == "ALL":
        return True
    if row.scope_kind == "GROUP":
        return group is not None and row.scope_value == str(group).lower()
    if row.scope_kind == "USE_CASE":
        return use_case is not None and row.scope_value == str(use_case).lower()
    return False


def _match(row: LimitRow, actor: Actor, use_case: Optional[str], group: Optional[str],
           any_scope: bool = False) -> Optional[str]:
    """The counter key `row` uses for this actor and operation, or None when it does not apply."""
    if row.period not in PERIODS:
        return None
    if not any_scope and not _scope_matches(row, use_case, group):
        return None
    sk = scope_key(row.scope_kind, row.scope_value)
    kind = row.subject_kind
    uid = None if actor.system else actor.user_id
    if kind == "INSTITUTE":
        return f"I|{sk}"
    if kind == "USER":
        if uid and row.subject_value == uid:
            return _fit_key("U", uid, sk)
        return None
    if kind == "ROLE":
        if actor.system or not row.subject_value or row.subject_value not in actor.roles:
            return None
        if row.per_member and uid:
            return _fit_key("U", uid, sk)
        return _fit_key("R", row.subject_value, sk)
    if kind == "ROLE_CLASS":
        if not row.subject_value or (actor.role_class or "") != row.subject_value:
            return None
        if row.per_member and uid:
            return _fit_key("U", uid, sk)
        return _fit_key("RC", row.subject_value, sk)
    return None


def _permissiveness(row: LimitRow) -> Tuple:
    return (row.hard is None, row.hard if row.hard is not None else _D0,
            row.soft is None, row.soft if row.soft is not None else _D0)


def _subject_label(row: LimitRow) -> str:
    return "PLATFORM" if row.origin == "PLATFORM" else row.subject_kind


def select_rows(rows: Sequence[LimitRow], actor: Actor, use_case: Optional[str], group: Optional[str],
                *, any_scope: bool = False) -> List[Applied]:
    """Every row that matches the actor and operation, each marked selected
    (it constrains) or not (an individual TENANT row out-ranked by a more
    specific one), following d_credits §4.2."""
    matched: List[Tuple[LimitRow, str]] = []
    for row in rows:
        key = _match(row, actor, use_case, group, any_scope)
        if key is not None:
            matched.append((row, key))
    out: List[Applied] = []
    individual: Dict[Tuple, List[Tuple[LimitRow, str]]] = {}
    for row, key in matched:
        if row.origin == "PLATFORM":
            out.append(Applied(row, key, True, "Platform limit (always applies; the institute cannot lift it)",
                               "PLATFORM"))
        elif row.pooled or not key.startswith(("U:", "U#")):
            why = ("Institute pool (shared by everyone)" if row.subject_kind == "INSTITUTE"
                   else f"Pooled across {'role' if row.subject_kind == 'ROLE' else 'role class'} "
                        f"{row.subject_value}")
            out.append(Applied(row, key, True, why, row.subject_kind))
        else:
            individual.setdefault(row.slot, []).append((row, key))
    for slot, cands in individual.items():
        best_rank = min(_SPECIFICITY.get(r.subject_kind, 9) for r, _ in cands)
        top = [(r, k) for r, k in cands if _SPECIFICITY.get(r.subject_kind, 9) == best_rank]
        winner = max(top, key=lambda rk: _permissiveness(rk[0]))[0]
        for r, k in cands:
            if r is winner:
                if r.subject_kind == "USER":
                    why = "Own limit for this user (replaces any role limit)"
                elif r.subject_kind == "ROLE":
                    why = (f"Role {r.subject_value} limit" + (" (the most generous of this user's roles)"
                                                               if len(top) > 1 else ""))
                else:
                    why = f"Role class {r.subject_value} limit (each member)"
                out.append(Applied(r, k, True, why, r.subject_kind))
            else:
                if winner.subject_kind == "USER":
                    why = "Replaced by this user's own limit"
                elif winner.subject_kind == "ROLE" and r.subject_kind == "ROLE":
                    why = f"Replaced by the more generous role {winner.subject_value} limit"
                else:
                    why = f"Replaced by the role {winner.subject_value} limit"
                out.append(Applied(r, k, False, why, r.subject_kind))
    return out


# ----------------------------------------------------------------------------
# Evaluation (pure)
# ----------------------------------------------------------------------------

def _metric_value(vals: Optional[Sequence[Decimal]], metric: str) -> Decimal:
    if not vals:
        return _D0
    idx = {"CREDITS": 0, "COUNT": 1, "COST_USD": 2}.get(metric, 0)
    return vals[idx] if idx < len(vals) else _D0


def evaluate_row(row: LimitRow, used: Decimal, estimate: Decimal) -> Tuple[str, int]:
    """(OK | WARN | BLOCK, pct) for one row given current use (+ reserved) and this operation's estimate."""
    cur = used
    after = used + max(estimate, _D0)
    if row.hard is not None and (cur >= row.hard or after > row.hard):
        pct = 100 if row.hard <= 0 else int(math.floor(after / row.hard * 100))
        return "BLOCK", max(pct, 100)
    if row.soft is not None and after >= row.soft:
        base = row.hard if (row.hard is not None and row.hard > 0) else row.soft
        pct = 100 if base <= 0 else int(math.floor(after / base * 100))
        return "WARN", pct
    return "OK", (int(math.floor(after / row.hard * 100)) if row.hard and row.hard > 0 else 0)


def _estimate_for(metric: str, est_credits: Decimal, est_count: Decimal = Decimal("1")) -> Decimal:
    if metric == "CREDITS":
        return est_credits
    if metric == "COUNT":
        return est_count
    return _D0


_PERIOD_WORD = {"DAY": "today's", "WEEK": "this week's", "MONTH": "this month's", "PLAN_PERIOD": "this plan period's"}
_RESET_WORD = {"DAY": "It resets at midnight.", "WEEK": "It resets on Monday.",
               "MONTH": "It resets on the 1st of next month."}


def block_body(row: LimitRow, subject: str, use_case: str, use_case_label: str, used: Decimal,
               resets_at_utc: datetime, tz_name: Optional[str], *, show_numbers: bool = True) -> Dict[str, Any]:
    """The 429 AI_USAGE_LIMIT body (contract N3). With show_numbers=False (the
    caller may not see the amounts) `limit` and `used` are null; real-USD
    (COST_USD) amounts are never put in it (vendor cost stays platform-side)."""
    show = bool(show_numbers) and row.metric != "COST_USD"
    period_word = _PERIOD_WORD.get(row.period, "the current")
    reset = _RESET_WORD.get(row.period, "")
    if row.hard is not None and row.hard <= 0:
        msg = f"{use_case_label} is not available right now: it has been switched off" + (
            " for this institute." if subject in ("INSTITUTE", "PLATFORM") else " for your account.")
    elif subject == "PLATFORM":
        msg = f"This institute has used {period_word} allowance for {use_case_label}. {reset}"
    elif subject == "INSTITUTE" or row.pooled:
        msg = f"Your institute has reached {period_word} limit for {use_case_label}. {reset}"
    else:
        msg = f"You've reached {period_word} limit for {use_case_label}. {reset}"
    return {
        "error": "AI_USAGE_LIMIT",
        "use_case": use_case,
        "use_case_label": use_case_label,
        "scope": subject,
        "period": row.period,
        "limit": _num_out(row.hard) if show else None,
        "used": _num_out(used) if show else None,
        "unit": _UNIT.get(row.metric, "credits"),
        "resets_at": _local_iso(resets_at_utc, tz_name),
        "set_by": "PLATFORM" if row.origin == "PLATFORM" else "INSTITUTE",
        "message": msg.strip(),
    }


def _enforce_enabled() -> bool:
    try:
        return _cache.as_bool(_cache.setting_value(ENFORCE_SETTING, True), True)
    except Exception:  # noqa: BLE001
        return True


# ----------------------------------------------------------------------------
# Counter / reservation state
# ----------------------------------------------------------------------------

Target = Tuple[str, str, datetime]  # (counter_key, period, window_start UTC)


def _load_state(s, institute_id: str, targets: Sequence[Target], now: datetime
                ) -> Tuple[Dict[Target, List[Decimal]], Dict[Target, List[Decimal]]]:
    """Counters and open, unexpired reservations for `targets` (two queries)."""
    from sqlalchemy import select

    keys = sorted({t[0] for t in targets})
    wanted = {(t[0], t[1], t[2]) for t in targets}
    min_ws = min(t[2] for t in targets)
    C = COUNTER_TABLE.c
    counters: Dict[Target, List[Decimal]] = {}
    for r in s.execute(select(C.counter_key, C.period, C.window_start, C.credits_used, C.count_used, C.cost_usd)
                       .where(C.institute_id == institute_id, C.counter_key.in_(keys),
                              C.window_start >= min_ws)).all():
        t = (r[0], r[1], _utc(r[2]))
        if t in wanted:
            counters[t] = [_dec(r[3]), _dec(r[4]), _dec(r[5])]
    R = RESERVATION_TABLE.c
    reserved: Dict[Target, List[Decimal]] = {}
    for r in s.execute(select(R.period_windows, R.credits, R.count)
                       .where(R.institute_id == institute_id, R.status == "OPEN", R.expires_at > now)).all():
        pws = r[0]
        if isinstance(pws, str):
            try:
                import json

                pws = json.loads(pws)
            except Exception:  # noqa: BLE001
                pws = []
        for pw in pws or []:
            try:
                t = (str(pw.get("key")), str(pw.get("period")), _utc(pw.get("window_start")))
            except Exception:  # noqa: BLE001
                continue
            if t in wanted:
                acc = reserved.setdefault(t, [_D0, _D0, _D0])
                acc[0] += _dec(r[1])
                acc[1] += _dec(r[2])
    return counters, reserved


def _advisory_lock(s, institute_id: str, keys: Iterable[str]) -> None:
    """Transaction-scoped advisory locks, one per counter key, in sorted order
    (no deadlocks; released at commit; safe behind pgbouncer transaction pooling).
    Postgres only (SQLite tests: no-op)."""
    if not _is_pg(s):
        return
    from sqlalchemy import text

    for k in sorted(set(keys)):
        s.execute(text("SELECT pg_advisory_xact_lock(hashtext(:a), hashtext(:b))"), {"a": institute_id, "b": k})


def _insert_reservation(s, institute_id: str, targets: Sequence[Target], credits: Decimal, count: Decimal,
                        use_case: str, actor_user_id: Optional[str], now: datetime) -> str:
    from sqlalchemy import insert

    rid = str(uuid.uuid4())
    ttl = VIDEO_RESERVATION_TTL if use_case in VIDEO_USE_CASES else RESERVATION_TTL
    s.execute(insert(RESERVATION_TABLE).values(
        id=rid, institute_id=institute_id, counter_keys=sorted({t[0] for t in targets}),
        period_windows=[{"key": t[0], "period": t[1], "window_start": t[2].isoformat()} for t in sorted(targets)],
        credits=credits, count=count, use_case=use_case[:64],
        actor_user_id=(actor_user_id or None) and actor_user_id[:255], status="OPEN", created_at=now,
        expires_at=now + ttl))
    return rid


# ----------------------------------------------------------------------------
# authorize
# ----------------------------------------------------------------------------

def authorize(db, *, institute_id: Any, use_case: Optional[str] = None, tool_key: Optional[str] = None,
              request_type: Optional[str] = None, ctx: Any = None, estimate_credits: Any = None,
              reserve: bool = False, catalog_reserve: bool = True) -> Decision:
    """The limits verdict for one operation (d_credits §4.3 steps 5-7). Never
    raises; NONE (allow) when the institute has no active policy (no DB query
    at all), the use case is not limit_eligible, or anything goes wrong.
    `catalog_reserve=False`: do not reserve on the catalog's
    reserve_on_authorize flag alone (only when `reserve` asks) — for callers
    that would give the reservation back at once anyway."""
    try:
        if not institute_id or not has_policy(institute_id):
            _count("authorize_fast")
            return Decision()
        return _authorize(db, str(institute_id), use_case, tool_key, request_type, ctx, estimate_credits,
                          bool(reserve), bool(catalog_reserve))
    except Exception as exc:  # noqa: BLE001
        _fail_open("authorize", exc)
        return Decision()


def authorize_or_raise(db, **kwargs: Any) -> Decision:
    """authorize(), raising LimitExceeded when it refuses (for FastAPI gates)."""
    d = authorize(db, **kwargs)
    d.raise_if_blocked()
    return d


def _numbers_visible(policy: Policy, actor: Actor) -> bool:
    """May this actor see limit amounts (limit / used / pooled pct)? Institute
    admins always; everyone else only when the institute lets learners see them."""
    return bool(policy.show_numbers_to_learners) or (actor.role_class or "") == "ADMIN"


def _authorize(db, inst: str, use_case, tool_key, request_type, ctx, estimate_credits, reserve,
               catalog_reserve: bool = True) -> Decision:
    policy = get_policy(db, inst)
    if policy is None or policy.mode not in ACTIVE_MODES:
        return Decision()
    snap = _snapshot(db)
    flags = _catalog_flags(db)
    uc, catalog_row = _resolve_use_case(snap, flags, use_case, tool_key, request_type)
    f = _flags_for(flags, uc, (catalog_row or {}).get("feature_group"))
    if not f.limit_eligible:
        return Decision(use_case=uc)
    group = (catalog_row or {}).get("feature_group") or f.feature_group
    actor = actor_from_ctx(snap, ctx, catalog_row)
    if _needs_roles(actor):
        if any(r.subject_kind in ("ROLE", "ROLE_CLASS") for r in policy.rows):
            actor = fill_actor_roles(db, inst, actor)
    else:
        remember_actor_roles(inst, actor)
    show_numbers = _numbers_visible(policy, actor)
    applied = [a for a in select_rows(policy.rows, actor, uc, group) if a.row.period in ACTIVE_PERIODS]
    if not applied:
        _count("authorize_no_rows")
        return Decision(decision="OK", use_case=uc)

    now = _now()
    tzn = policy.timezone
    bounds: Dict[Tuple[str, str], Tuple[datetime, datetime]] = {}
    for a in applied:
        bounds.setdefault((a.key, a.row.period), window_bounds(a.row.period, now, tzn))
    targets = sorted({(k, p, b[0]) for (k, p), b in bounds.items()})
    est = _dec_opt(estimate_credits)
    if est is None:
        est = f.typical_credits or _D0
    est = max(est, _D0)
    do_reserve = bool(reserve or (catalog_reserve and f.reserve_on_authorize))
    selected = [a for a in applied if a.selected]

    def _evaluate(state) -> Tuple[str, List[Tuple[Applied, str, int, Decimal]]]:
        counters, reserved = state
        verdicts = []
        worst = "OK"
        for a in selected:
            t = (a.key, a.row.period, bounds[(a.key, a.row.period)][0])
            used = _metric_value(counters.get(t), a.row.metric) + _metric_value(reserved.get(t), a.row.metric)
            raw, pct = evaluate_row(a.row, used, _estimate_for(a.row.metric, est))
            verdicts.append((a, raw, pct, used))
            if _RANK[raw] > _RANK[worst]:
                worst = raw
        return worst, verdicts

    reservation_id: Optional[str] = None
    if do_reserve:
        def _txn(s):
            _advisory_lock(s, inst, [t[0] for t in targets])
            worst_, verdicts_ = _evaluate(_load_state(s, inst, targets, now))
            rid = None
            if worst_ != "BLOCK":
                rid = _insert_reservation(s, inst, targets, est, Decimal("1"), uc, actor.user_id, now)
            return worst_, verdicts_, rid

        try:
            worst, verdicts, reservation_id = _own_txn(db, _txn)
            if reservation_id:
                _count("reserved")
        except Exception as exc:  # noqa: BLE001
            _fail_open("reserve", exc)
            worst, verdicts = _evaluate(_read(db, lambda s: _load_state(s, inst, targets, now)))
    else:
        worst, verdicts = _evaluate(_read(db, lambda s: _load_state(s, inst, targets, now)))

    label = f.label or uc
    warnings = []
    for a, raw, pct, used in verdicts:
        if raw in ("WARN", "BLOCK"):
            w = {"use_case": uc, "scope": a.subject, "period": a.row.period, "pct": pct,
                 "limit_id": a.row.id, "metric": a.row.metric}
            if not show_numbers and (a.row.pooled or a.subject in ("INSTITUTE", "PLATFORM")
                                     or a.row.metric == "COST_USD"):
                # A shared / platform counter's percentage is the institute's
                # usage, not the caller's: kept off the response header.
                w["hide_pct"] = True
            warnings.append(w)
    warnings.sort(key=lambda w: -w["pct"])

    if worst != "BLOCK":
        _count(f"decision:{worst}")
        return Decision(allow=True, decision=worst, warnings=warnings, reservation_id=reservation_id, use_case=uc)

    blocking = [(a, used) for a, raw, _p, used in verdicts if raw == "BLOCK"]
    # Report the block that lasts longest (honest Retry-After); PLATFORM first on a tie.
    a, used = max(blocking, key=lambda au: (bounds[(au[0].key, au[0].row.period)][1], au[0].row.origin == "PLATFORM"))
    resets = bounds[(a.key, a.row.period)][1]
    body = block_body(a.row, a.subject, uc, label, used, resets, tzn, show_numbers=show_numbers)
    retry = max(int(math.ceil((resets - now).total_seconds())), 1)
    if policy.mode == "ENFORCE" and _enforce_enabled():
        _count("decision:BLOCK")
        return Decision(allow=False, decision="BLOCK", warnings=warnings, block=body, use_case=uc,
                        retry_after_seconds=retry)
    _count("decision:WOULD_BLOCK")
    return Decision(allow=True, decision="WOULD_BLOCK", warnings=warnings, would_block=body,
                    reservation_id=reservation_id, use_case=uc, retry_after_seconds=retry)


# ----------------------------------------------------------------------------
# Post-call: counters
# ----------------------------------------------------------------------------

def counts_toward_limits(ev: Dict[str, Any]) -> bool:
    """Events that never count: no institute, BUNDLED vendor calls (paid inside
    another charge), child events, and SYSTEM work skipped because of a limit."""
    if not ev.get("institute_id"):
        return False
    if str(ev.get("free_reason") or "").upper() == "BUNDLED":
        return False
    if ev.get("parent_event_id"):
        return False
    if str(ev.get("limit_decision") or "").upper() == "BLOCKED_SKIPPED":
        return False
    return True


def _unit_count(ev: Dict[str, Any], f: Optional[UseCaseFlags]) -> Decimal:
    unit = (f.count_unit_label if f else "requests") or "requests"
    unit = unit.strip().lower()
    if unit in ("minute", "minutes"):
        m = _dec(ev.get("minutes"))
        if m > 0:
            return m
    elif unit in ("second", "seconds"):
        sec = _dec(ev.get("seconds"))
        if sec > 0:
            return sec
    rc = _dec(ev.get("request_count"))
    return rc if rc > 0 else Decimal("1")


def _contribution(ev: Dict[str, Any], f: Optional[UseCaseFlags]) -> Tuple[Decimal, Decimal, Decimal]:
    """(credits, count, cost_usd) an event adds to its counters, net of refunds
    (rebuild and the live increment + decrement agree on this)."""
    lc = max(_dec(ev.get("list_credits")), _D0)
    refunded = max(_dec(ev.get("refunded_credits")), _D0)
    credits = max(lc - refunded, _D0)
    fully_refunded = lc > 0 and refunded >= lc
    count = _D0 if fully_refunded else _unit_count(ev, f)
    cost = max(_dec(ev.get("real_cost_usd")), _D0)
    return credits, count, cost


def count_keys(rows: Sequence[LimitRow], actor: Actor, use_case: Optional[str], group: Optional[str],
               applied: Sequence[Applied]) -> List[Tuple[str, str]]:
    """(counter_key, period) pairs one event adds to: every matched row's key,
    plus the user's own U:<uid>|<scope> key for EVERY per-member USER / ROLE /
    ROLE_CLASS row of a matching scope, whatever role the event carries. That
    key means "this user's use in this scope", so counting it never depends on
    role attribution (an event whose role is resolved later still counts
    toward the per-member caps). SYSTEM actors have no per-member key."""
    pairs = {(a.key, a.row.period) for a in applied}
    uid = None if actor.system else actor.user_id
    if uid:
        for row in rows:
            if row.period not in ACTIVE_PERIODS or not _scope_matches(row, use_case, group):
                continue
            if row.subject_kind in ("ROLE", "ROLE_CLASS") and row.per_member:
                pairs.add((_fit_key("U", uid, scope_key(row.scope_kind, row.scope_value)), row.period))
    return sorted(pairs)


def _event_targets(policy: Policy, ev: Dict[str, Any], flags: Dict[str, UseCaseFlags], db=None,
                   role_map: Optional[Dict[str, Any]] = None, lookup: bool = True,
                   ) -> Tuple[Optional[UseCaseFlags], List[Applied], List[Target], datetime]:
    uc = str(ev.get("use_case") or "unknown")
    f = flags.get(uc)
    group = ev.get("feature_group") or (f.feature_group if f else None)
    at = _utc(ev.get("occurred_at")) or _now()
    if f is not None and not f.limit_eligible:
        return f, [], [], at
    actor = actor_from_event(ev)
    if _needs_roles(actor) and any(r.subject_kind in ("ROLE", "ROLE_CLASS") for r in policy.rows):
        actor = fill_actor_roles(db, policy.institute_id, actor, role_map=role_map, lookup=lookup)
    applied = [a for a in select_rows(policy.rows, actor, uc, group) if a.row.period in ACTIVE_PERIODS]
    targets = sorted({(k, p, window_start(p, at, policy.timezone))
                      for k, p in count_keys(policy.rows, actor, uc, group, applied)})
    return f, applied, targets, at


def _upsert_counters(s, institute_id: str, targets: Sequence[Target], credits: Decimal, count: Decimal,
                     cost: Decimal, now: datetime) -> Dict[Target, List[Decimal]]:
    """One INSERT .. ON CONFLICT DO UPDATE .. RETURNING for every target (sorted:
    concurrent writers lock rows in the same order). Decided by RETURNING, never
    by rowcount (psycopg 3 reports -1)."""
    T = COUNTER_TABLE
    dialect = s.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as _ins
    else:
        from sqlalchemy.dialects.sqlite import insert as _ins
    values = [{"institute_id": institute_id, "counter_key": k, "period": p, "window_start": ws,
               "credits_used": credits, "count_used": count, "cost_usd": cost, "updated_at": now}
              for k, p, ws in sorted(targets)]
    stmt = _ins(T).values(values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[T.c.institute_id, T.c.counter_key, T.c.period, T.c.window_start],
        set_={"credits_used": T.c.credits_used + stmt.excluded.credits_used,
              "count_used": T.c.count_used + stmt.excluded.count_used,
              "cost_usd": T.c.cost_usd + stmt.excluded.cost_usd,
              "updated_at": stmt.excluded.updated_at},
    ).returning(T.c.counter_key, T.c.period, T.c.window_start, T.c.credits_used, T.c.count_used, T.c.cost_usd)
    out: Dict[Target, List[Decimal]] = {}
    for r in s.execute(stmt).all():
        out[(r[0], r[1], _utc(r[2]))] = [_dec(r[3]), _dec(r[4]), _dec(r[5])]
    return out


COUNTER_LOCK_TIMEOUT = "2s"


def _short_lock_timeout(s) -> Optional[str]:
    """Postgres: cap how long a counter write may wait for a row / advisory
    lock (a long rebuild or a stuck writer must never stall a charge
    response); returns the previous value for _restore_lock_timeout. A lock
    timeout fails the counter SAVEPOINT only (the charge and the event are
    kept; rolling the savepoint back also undoes this setting)."""
    if not _is_pg(s):
        return None
    from sqlalchemy import text

    return s.execute(text("SELECT current_setting('lock_timeout'), set_config('lock_timeout', :v, true)"),
                     {"v": COUNTER_LOCK_TIMEOUT}).first()[0]


def _restore_lock_timeout(s, prev: Optional[str]) -> None:
    if prev is None:
        return
    from sqlalchemy import text

    s.execute(text("SELECT set_config('lock_timeout', :v, true)"), {"v": prev})


def apply_event_to_counters(db, event_row: Dict[str, Any]) -> str:
    """Post-commit, inside the event writer's SAVEPOINT (its own nested one here):
    add the event to every counter an active limit row references, settle its
    reservation, and report OVERRUN when the event pushed a constraining
    counter past its hard limit. 'NONE' (nothing counted: no active policy —
    with ZERO DB queries —, not countable, or a failure), 'OK' or 'OVERRUN'."""
    try:
        inst = event_row.get("institute_id") if event_row else None
        if not inst or not has_policy(inst):
            return "NONE"
        if not counts_toward_limits(event_row):
            return "NONE"
        inst = str(inst)
        policy = get_policy(db, inst)
        if policy is None or policy.mode not in ACTIVE_MODES:
            return "NONE"
        flags = _catalog_flags(db)
        f, applied, targets, _at = _event_targets(policy, event_row, flags, db)
        rid = event_row.get("reservation_id")
        if not targets:
            if rid:
                with db.begin_nested():
                    _settle(db, str(rid), event_row.get("list_credits"))
            return "OK" if (f is None or f.limit_eligible) else "NONE"
        credits, count, cost = _contribution(event_row, f)
        now = _now()
        with db.begin_nested():
            prev_timeout = _short_lock_timeout(db)
            if rid:
                _advisory_lock(db, inst, [t[0] for t in targets])
            values = _upsert_counters(db, inst, targets, credits, count, cost, now)
            if rid:
                _settle(db, str(rid), event_row.get("list_credits"))
            _restore_lock_timeout(db, prev_timeout)
        _count("counted")
        for a in applied:
            if not a.selected or a.row.hard is None:
                continue
            t = (a.key, a.row.period, window_start(a.row.period, _at, policy.timezone))
            if _metric_value(values.get(t), a.row.metric) > a.row.hard:
                _count("overrun")
                return "OVERRUN"
        return "OK"
    except Exception as exc:  # noqa: BLE001
        _fail_open("count", exc)
        return "NONE"


def _settle(s, reservation_id: str, actual_credits: Any) -> int:
    from sqlalchemy import update

    R = RESERVATION_TABLE.c
    values: Dict[str, Any] = {"status": "SETTLED"}
    act = _dec_opt(actual_credits)
    if act is not None and act >= 0:
        values["credits"] = act
    res = s.execute(update(RESERVATION_TABLE).where(R.id == reservation_id, R.status == "OPEN").values(**values)
                    .returning(R.id))
    return len(res.all())


def _valid_uuid(value: Any) -> Optional[str]:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def settle_reservation(db, reservation_id: Any, actual_credits: Any = None) -> bool:
    """Close a reservation (OPEN -> SETTLED) in a short transaction of its own.
    The counters themselves move with the event (apply_event_to_counters, which
    also settles the event's reservation_id). Never raises."""
    rid = _valid_uuid(reservation_id)
    if not rid:
        return False
    try:
        return bool(_own_txn(db, lambda s: _settle(s, rid, actual_credits)))
    except Exception as exc:  # noqa: BLE001
        _fail_open("settle", exc)
        return False


def release_reservation(db, reservation_id: Any) -> bool:
    """Give a reservation back (OPEN -> RELEASED: the call failed or was not
    made), in a short transaction of its own so a caller rollback cannot undo
    it. Never raises."""
    rid = _valid_uuid(reservation_id)
    if not rid:
        return False

    def _work(s):
        from sqlalchemy import update

        R = RESERVATION_TABLE.c
        return len(s.execute(update(RESERVATION_TABLE).where(R.id == rid, R.status == "OPEN")
                             .values(status="RELEASED").returning(R.id)).all())

    try:
        return bool(_own_txn(db, _work))
    except Exception as exc:  # noqa: BLE001
        _fail_open("release", exc)
        return False


def decrement_for_refund(db, event_row: Dict[str, Any], refunded_credits: Any) -> str:
    """A refund of `refunded_credits` MORE credits on this event (the delta;
    event_row['refunded_credits'] = what was refunded before this call): its
    counters go down by that much (floored at 0, never below what the event
    added), and its count comes off once the event is fully refunded. Runs in
    a SAVEPOINT on `db`. 'NONE' (nothing to do / no active policy — no DB query
    — / failure) or 'OK'."""
    try:
        inst = event_row.get("institute_id") if event_row else None
        if not inst or not has_policy(inst):
            return "NONE"
        delta = _dec(refunded_credits)
        if delta <= 0 or not counts_toward_limits(event_row):
            return "NONE"
        inst = str(inst)
        policy = get_policy(db, inst)
        if policy is None or policy.mode not in ACTIVE_MODES:
            return "NONE"
        flags = _catalog_flags(db)
        f, _applied, targets, _at = _event_targets(policy, event_row, flags, db)
        if not targets:
            return "NONE"
        lc = max(_dec(event_row.get("list_credits")), _D0)
        before = max(_dec(event_row.get("refunded_credits")), _D0)
        credit_dec = min(delta, max(lc - before, _D0))
        count_dec = _unit_count(event_row, f) if (lc > 0 and before < lc <= before + delta) else _D0
        if credit_dec <= 0 and count_dec <= 0:
            return "NONE"
        now = _now()
        with db.begin_nested():
            prev_timeout = _short_lock_timeout(db)
            _subtract(db, inst, targets, credit_dec, count_dec, None, now)
            _restore_lock_timeout(db, prev_timeout)
        _count("refund_decrement")
        return "OK"
    except Exception as exc:  # noqa: BLE001
        _fail_open("refund", exc)
        return "NONE"


def _floor0(expr):
    """max(expr, 0) as SQL, with a literal 0 (never a bound parameter, whose
    type a driver adapter could turn into text)."""
    from sqlalchemy import case, literal_column

    zero = literal_column("0")
    return case((expr < zero, zero), else_=expr)


def _subtract(s, inst: str, targets: Sequence[Target], credits: Decimal, count: Decimal,
              cost: Optional[Decimal], now: datetime) -> None:
    """Take amounts off existing counters (floored at 0), in sorted key order."""
    from sqlalchemy import update

    C = COUNTER_TABLE.c
    for k, p, ws in sorted(targets):
        values: Dict[str, Any] = {
            "credits_used": _floor0(C.credits_used - credits),
            "count_used": _floor0(C.count_used - count),
            "updated_at": now,
        }
        if cost is not None:
            values["cost_usd"] = _floor0(C.cost_usd - cost)
        s.execute(update(COUNTER_TABLE).where(
            C.institute_id == inst, C.counter_key == k, C.period == p, C.window_start == ws).values(**values))


def remove_event_contribution(db, event_row: Dict[str, Any]) -> str:
    """Take back EVERYTHING an already-counted event added (its credits net
    of refunds, its count — also when it carried 0 credits — and its cost),
    under its own use case / actor. For an event that is replaced in place by
    a later version (a record-only event upgraded to a charge): the new version
    is then counted once by apply_event_to_counters. SAVEPOINT on `db`; 'NONE'
    (nothing to do / no active policy — no DB query — / failure) or 'OK'."""
    try:
        inst = event_row.get("institute_id") if event_row else None
        if not inst or not has_policy(inst) or not counts_toward_limits(event_row):
            return "NONE"
        inst = str(inst)
        policy = get_policy(db, inst)
        if policy is None or policy.mode not in ACTIVE_MODES:
            return "NONE"
        flags = _catalog_flags(db)
        f, _applied, targets, _at = _event_targets(policy, event_row, flags, db)
        if not targets:
            return "NONE"
        credits, count, cost = _contribution(event_row, f)
        if credits <= 0 and count <= 0 and cost <= 0:
            return "NONE"
        with db.begin_nested():
            prev_timeout = _short_lock_timeout(db)
            _subtract(db, inst, targets, credits, count, cost, _now())
            _restore_lock_timeout(db, prev_timeout)
        _count("contribution_removed")
        return "OK"
    except Exception as exc:  # noqa: BLE001
        _fail_open("remove", exc)
        return "NONE"


# ----------------------------------------------------------------------------
# Event history reads (rebuild, preview)
# ----------------------------------------------------------------------------

_EVENT_COLS = ("id", "occurred_at", "institute_id", "actor_kind", "actor_user_id", "actor_role_class",
               "actor_roles_raw", "actor_display_name", "use_case", "feature_group", "list_credits",
               "refunded_credits", "request_count", "minutes", "seconds", "real_cost_usd", "free_reason",
               "parent_event_id", "limit_decision")


def _iter_events(s, institute_id: str, since: datetime):
    """The institute's events since `since`, oldest first, streamed in
    batches (one query; rows are mappings, never all held at once)."""
    from sqlalchemy import select

    from .models import EVENT_TABLE as E

    cols = [E.c[name] for name in _EVENT_COLS]
    stmt = (select(*cols).where(E.c.institute_id == institute_id, E.c.occurred_at >= since)
            .order_by(E.c.occurred_at, E.c.id).execution_options(yield_per=5000))
    for r in s.execute(stmt).mappings():
        yield r


def _key_kind(key: str) -> str:
    subj = key.rpartition("|")[0]
    if subj == "I":
        return "I"
    if subj.startswith(("RC:", "RC#")):
        return "RC"
    if subj.startswith(("R:", "R#")):
        return "R"
    if subj.startswith(("U:", "U#")):
        return "U"
    return "?"


def _key_referenced(key: str, period: str, rows: Sequence[LimitRow]) -> bool:
    """Whether some active row can produce counter `key` for `period`."""
    sk = key.rpartition("|")[2]
    kind = _key_kind(key)
    for r in rows:
        if r.period != period or scope_key(r.scope_kind, r.scope_value) != sk:
            continue
        if kind == "I" and r.subject_kind == "INSTITUTE":
            return True
        if kind == "U" and (r.subject_kind == "USER" or (r.subject_kind in ("ROLE", "ROLE_CLASS") and r.per_member)):
            return True
        if kind == "R" and r.subject_kind == "ROLE":
            return True
        if kind == "RC" and r.subject_kind == "ROLE_CLASS":
            return True
    return False


# ----------------------------------------------------------------------------
# rebuild_counters
# ----------------------------------------------------------------------------

REBUILD_LOCK_TIMEOUT = "2s"
#: seconds after a limits write before the second rebuild of that institute
#: (other pods' policy caches have expired by then, so events they counted
#: only under the old rows are picked up); None switches it off (tests).
DELAYED_REBUILD_SECONDS: Optional[float] = POLICY_CACHE_TTL + 5.0
_delayed: Dict[str, Any] = {}
_delayed_lock = threading.Lock()


def _rebuild_scan(s, institute_id: str, days: int, now: datetime, report: Dict[str, Any]
                  ) -> List[Tuple[Target, List[Decimal]]]:
    """Phase 1, read only: the corrections (expected - current) for the
    institute's counters, from ONE consistent snapshot (REPEATABLE READ on
    Postgres) of the counters and the events. An event and its counter
    increment commit in the same transaction, so a snapshot sees both or
    neither; no row is locked while the events are scanned."""
    from sqlalchemy import select

    pol = _load_policy(s, institute_id)
    if pol is None or not pol.rows:
        return []
    cutoff = now - timedelta(days=max(int(days), 1))
    C = COUNTER_TABLE.c
    existing = {(r[0], r[1], _utc(r[2])): [_dec(r[3]), _dec(r[4]), _dec(r[5])] for r in s.execute(
        select(C.counter_key, C.period, C.window_start, C.credits_used, C.count_used, C.cost_usd).where(
            C.institute_id == institute_id, C.window_start >= cutoff)).all()}
    flags = _load_flags(s)
    role_map = (_load_role_map(s, institute_id, cutoff - timedelta(days=ROLE_LOOKUP_DAYS))
                if any(r.subject_kind in ("ROLE", "ROLE_CLASS") for r in pol.rows) else None)
    expected: Dict[Target, List[Decimal]] = {}
    scanned = 0
    for ev in _iter_events(s, institute_id, cutoff):
        scanned += 1
        if scanned > REBUILD_MAX_EVENTS:
            report["truncated"].append(institute_id)
            break
        if not counts_toward_limits(ev):
            continue
        f, _applied, targets, _at = _event_targets(pol, ev, flags, s, role_map=role_map, lookup=False)
        if not targets:
            continue
        cr, cn, co = _contribution(ev, f)
        for t in targets:
            if t[2] < cutoff:
                continue  # a window that began before the scan: not fully covered, leave it
            acc = expected.setdefault(t, [_D0, _D0, _D0])
            acc[0] += cr
            acc[1] += cn
            acc[2] += co
    report["events_scanned"] += min(scanned, REBUILD_MAX_EVENTS)
    if institute_id in report["truncated"]:
        return []  # a partial scan must never rewrite counters downwards
    # Counters no active row can produce any more are left alone (they are unused).
    stale = {t for t in existing if t not in expected and not _key_referenced(t[0], t[1], pol.rows)}
    out: List[Tuple[Target, List[Decimal]]] = []
    for t in sorted((set(expected) | set(existing)) - stale):
        want = expected.get(t, [_D0, _D0, _D0])
        have = existing.get(t)
        report["counters_checked"] += 1
        if have is not None and all(abs(want[i] - have[i]) < _EPS for i in range(3)):
            continue
        if have is None and all(v == 0 for v in want):
            continue
        base = have if have is not None else [_D0, _D0, _D0]
        out.append((t, [want[i] - base[i] for i in range(3)]))
        if len(report["fixes"]) < 100:
            report["fixes"].append({
                "institute_id": institute_id, "counter_key": t[0], "period": t[1], "window_start": t[2].isoformat(),
                "old": [float(v) for v in have] if have is not None else None, "new": [float(v) for v in want]})
    return out


def _rebuild_write(s, institute_id: str, corrections: Sequence[Tuple[Target, List[Decimal]]], now: datetime) -> None:
    """Phase 2, a short transaction of its own: add each correction to its
    counter (an INSERT .. ON CONFLICT DO UPDATE adding the positive part, an
    UPDATE .. x = max(x + d, 0) for a negative part), keys in sorted order like
    every writer, lock_timeout capped. Increments that landed after the
    phase-1 snapshot are kept, never overwritten."""
    from sqlalchemy import text, update

    T = COUNTER_TABLE
    dialect = s.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as _ins

        s.execute(text("SELECT set_config('lock_timeout', :v, true)"), {"v": REBUILD_LOCK_TIMEOUT})
    else:
        from sqlalchemy.dialects.sqlite import insert as _ins
    C = T.c
    rows = sorted(corrections, key=lambda c: c[0])
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        # Non-negative part: inserted as is (no row yet = nothing counted since
        # the snapshot, so it is the expected total) or added to the row.
        stmt = _ins(T).values([
            {"institute_id": institute_id, "counter_key": k, "period": p, "window_start": ws,
             "credits_used": max(d[0], _D0), "count_used": max(d[1], _D0), "cost_usd": max(d[2], _D0),
             "updated_at": now} for (k, p, ws), d in chunk])
        stmt = stmt.on_conflict_do_update(
            index_elements=[C.institute_id, C.counter_key, C.period, C.window_start],
            set_={"credits_used": C.credits_used + stmt.excluded.credits_used,
                  "count_used": C.count_used + stmt.excluded.count_used,
                  "cost_usd": C.cost_usd + stmt.excluded.cost_usd,
                  "updated_at": stmt.excluded.updated_at})
        s.execute(stmt)
        # Negative part (the counter read high): taken off, floored at 0.
        for (k, p, ws), d in chunk:
            if d[0] < 0 or d[1] < 0 or d[2] < 0:
                s.execute(update(T).where(
                    C.institute_id == institute_id, C.counter_key == k, C.period == p, C.window_start == ws,
                ).values(credits_used=_floor0(C.credits_used + min(d[0], _D0)),
                         count_used=_floor0(C.count_used + min(d[1], _D0)),
                         cost_usd=_floor0(C.cost_usd + min(d[2], _D0)),
                         updated_at=now))


def _snapshot_txn(db, fn: Callable[[Any], Any]) -> Any:
    """Run read-only work in ONE snapshot: on Postgres a connection of its own
    in REPEATABLE READ (BEGIN ISOLATION LEVEL ..., transaction-scoped, fine
    behind pgbouncer transaction pooling); elsewhere (SQLite tests) _own_txn."""
    if not _is_pg(db):
        return _own_txn(db, fn)
    from sqlalchemy.orm import Session

    if _pool_would_wait(db):
        raise RuntimeError("DB pool exhausted; rebuild skipped")
    with _engine_of(db).connect() as conn:
        conn = conn.execution_options(isolation_level="REPEATABLE READ")
        s = Session(bind=conn, future=True)
        try:
            out = fn(s)
            s.rollback()  # read only: nothing to keep
            return out
        finally:
            s.close()


def _rebuild_one(db, institute_id: str, days: int, now: datetime, report: Dict[str, Any]) -> None:
    corrections = _snapshot_txn(db, lambda s: _rebuild_scan(s, institute_id, days, now, report))
    if not corrections:
        return
    _own_txn(db, lambda s: _rebuild_write(s, institute_id, corrections, now))
    report["counters_fixed"] += len(corrections)
    logger.info("usage limits: rebuild fixed %d counter(s) for institute %s", len(corrections), institute_id)


def rebuild_counters(db, days: int = 35, institute_id: Any = None) -> Dict[str, Any]:
    """Recompute counters of every window that started in the last `days` days
    from ai_usage_event and correct the ones that differ (counters are a cache
    of the events). One institute (any mode) or every institute in SHADOW /
    ENFORCE. Per institute: a read-only snapshot scan, then one short write
    transaction of corrections; never raises."""
    started = time.monotonic()
    now = _now()
    report: Dict[str, Any] = {"days": int(days), "institutes": 0, "events_scanned": 0, "counters_checked": 0,
                              "counters_fixed": 0, "fixes": [], "errors": [], "truncated": []}
    try:
        if institute_id:
            ids = [str(institute_id)]
        else:
            ids = sorted(_read(db, _load_index_ids))
    except Exception as exc:  # noqa: BLE001
        report["errors"].append({"institute_id": None, "error": _first_line(exc)})
        _fail_open("rebuild-list", exc)
        ids = []
    for inst in ids:
        try:
            _rebuild_one(db, inst, days, now, report)
            report["institutes"] += 1
        except Exception as exc:  # noqa: BLE001
            report["errors"].append({"institute_id": inst, "error": _first_line(exc)})
            _fail_open("rebuild", exc)
    report["took_ms"] = int((time.monotonic() - started) * 1000)
    return report


def _schedule_delayed_rebuild(db, institute_id: str) -> None:
    """One more rebuild of the institute once every pod's policy cache has
    expired (DELAYED_REBUILD_SECONDS), on a session of its own; one pending per
    institute (a newer write replaces it). Never raises."""
    delay = DELAYED_REBUILD_SECONDS
    if delay is None:
        return
    try:
        engine = _engine_of(db)
    except Exception:  # noqa: BLE001
        return

    def _run() -> None:
        from sqlalchemy.orm import Session

        with _delayed_lock:
            if _delayed.get(institute_id) is not timer:
                return
            _delayed.pop(institute_id, None)
        s = None
        try:
            s = Session(bind=engine, future=True)
            rebuild_counters(s, days=35, institute_id=institute_id)
        except Exception as exc:  # noqa: BLE001
            _fail_open("rebuild-delayed", exc)
        finally:
            if s is not None:
                try:
                    s.close()
                except Exception:  # noqa: BLE001
                    pass

    try:
        timer = threading.Timer(delay, _run)
        timer.daemon = True
        with _delayed_lock:
            old = _delayed.get(institute_id)
            if old is not None:
                old.cancel()
            _delayed[institute_id] = timer
        timer.start()
    except Exception as exc:  # noqa: BLE001
        _fail_open("rebuild-schedule", exc)


def cancel_delayed_rebuilds() -> None:
    with _delayed_lock:
        for t in _delayed.values():
            try:
                t.cancel()
            except Exception:  # noqa: BLE001
                pass
        _delayed.clear()


def notify_changed(db, institute_id: Any, *, rebuild: bool = True, active: Optional[bool] = None) -> Dict[str, Any]:
    """Call after any policy / limit-row write for `institute_id`: drops the
    cached policy (and updates this process's index when `active` is given) and
    rebuilds the institute's current windows so a new row starts from the real
    usage instead of zero; a second rebuild follows once other pods' caches
    have expired (events they counted under the old rows). Never raises."""
    invalidate(institute_id, active=active)
    if not rebuild:
        return {}
    report = rebuild_counters(db, days=35, institute_id=institute_id)
    if institute_id:
        _schedule_delayed_rebuild(db, str(institute_id))
    return report


# ----------------------------------------------------------------------------
# effective_limits ("why am I blocked")
# ----------------------------------------------------------------------------

def _scope_label(row: LimitRow, flags: Dict[str, UseCaseFlags]) -> str:
    if row.scope_kind == "ALL":
        return "All AI features"
    if row.scope_kind == "USE_CASE":
        f = flags.get(row.scope_value or "")
        return f.label if f else (row.scope_value or "").replace("_", " ").title()
    return f"{(row.scope_value or '').replace('_', ' ').title()} features"


def _latest_actor(s, institute_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    from sqlalchemy import select

    from .models import EVENT_TABLE as E

    r = s.execute(select(E.c.actor_kind, E.c.actor_role_class, E.c.actor_roles_raw)
                  .where(E.c.institute_id == institute_id, E.c.actor_user_id == user_id)
                  .order_by(E.c.occurred_at.desc()).limit(1)).mappings().first()
    return dict(r) if r else None


def effective_limits(db, institute_id: Any, user_id: Optional[str] = None, role_class: Optional[str] = None,
                     raw_roles: Optional[Sequence[str]] = None, *, use_case: Optional[str] = None,
                     only_if_active: bool = False) -> List[Dict[str, Any]]:
    """Every limit row that applies to `user_id` (or, without a user, every
    row of the institute), each with its current use, reset time, verdict and
    the reason it applies or is out-ranked. Without role_class/raw_roles the
    user's roles are taken from their latest usage event. [] when the
    institute has no policy or rows, or on failure. `only_if_active=True`
    (the learner-facing /me/usage) returns [] with NO query unless the
    institute's policy is SHADOW / ENFORCE."""
    try:
        if not institute_id:
            return []
        inst = str(institute_id)
        if only_if_active and not has_policy(inst):
            return []
        policy = get_policy(db, inst)
        if policy is None or not policy.rows:
            return []
        flags = _catalog_flags(db)
        now = _now()
        tzn = policy.timezone
        if user_id:
            roles = [normalize_role_name(r) for r in (raw_roles or []) if normalize_role_name(r)]
            rc = str(role_class).upper() if role_class else None
            kind = "USER"
            if not rc and not roles:
                latest = _read(db, lambda s: _latest_actor(s, inst, str(user_id)))
                if latest:
                    roles = [normalize_role_name(r) for r in _as_list(latest.get("actor_roles_raw"))]
                    rc = (latest.get("actor_role_class") or None)
                    kind = str(latest.get("actor_kind") or "USER").upper()
            if not rc and roles:
                from .context import resolve_role_class

                rc = resolve_role_class(roles)
            actor = Actor(kind=kind if kind != "SYSTEM" else "USER", user_id=str(user_id), role_class=rc,
                          roles=roles)
            uc_group = flags.get(use_case).feature_group if use_case and flags.get(use_case) else None
            applied = select_rows(policy.rows, actor, use_case, uc_group, any_scope=use_case is None)
        else:
            applied = []
            for row in policy.rows:
                sk = scope_key(row.scope_kind, row.scope_value)
                if row.subject_kind == "INSTITUTE":
                    key = f"I|{sk}"
                elif row.pooled:
                    key = _fit_key("R" if row.subject_kind == "ROLE" else "RC", row.subject_value or "", sk)
                else:
                    key = ""  # per member: no single counter
                why = ("Platform limit (always applies)" if row.origin == "PLATFORM" else
                       "Institute pool (shared by everyone)" if row.subject_kind == "INSTITUTE" else
                       "Pooled limit" if row.pooled else "Applies to each member separately")
                applied.append(Applied(row, key, True, why))
        targets = sorted({(a.key, a.row.period, window_start(a.row.period, now, tzn))
                          for a in applied if a.key and a.row.period in ACTIVE_PERIODS})
        counters, reserved = (_read(db, lambda s: _load_state(s, inst, targets, now)) if targets else ({}, {}))
        enforce = policy.mode == "ENFORCE" and _enforce_enabled()
        out = []
        for a in applied:
            row = a.row
            entry = {"row": row.to_dict(), "scope": a.subject, "scope_key": scope_key(row.scope_kind, row.scope_value),
                     "scope_label": _scope_label(row, flags), "period": row.period, "metric": row.metric,
                     "unit": _UNIT.get(row.metric, "credits"), "soft": _num_out(row.soft), "hard": _num_out(row.hard),
                     "used": None, "resets_at": None, "decision": None, "why": a.why, "selected": a.selected}
            if row.period in ACTIVE_PERIODS:
                start, end = window_bounds(row.period, now, tzn)
                entry["resets_at"] = _local_iso(end, tzn)
                if a.key:
                    t = (a.key, row.period, start)
                    used = _metric_value(counters.get(t), row.metric) + _metric_value(reserved.get(t), row.metric)
                    entry["used"] = _num_out(used)
                    raw, pct = evaluate_row(row, used, _D0)
                    entry["pct"] = pct
                    if not a.selected:
                        entry["decision"] = "OVERRIDDEN"
                    elif raw == "BLOCK" and not enforce:
                        entry["decision"] = "WOULD_BLOCK"
                    else:
                        entry["decision"] = raw
                elif not a.selected:
                    entry["decision"] = "OVERRIDDEN"
            else:
                entry["decision"] = "NOT_ACTIVE"
                entry["why"] = f"{a.why} (period {row.period} is not in use yet)"
            out.append(entry)
        order = {"PLATFORM": 0, "INSTITUTE": 1, "ROLE_CLASS": 2, "ROLE": 3, "USER": 4}
        out.sort(key=lambda e: (not e["selected"], e["scope_key"] != "ALL", e["scope_key"],
                                order.get(e["scope"], 9), e["period"]))
        return out
    except Exception as exc:  # noqa: BLE001
        _fail_open("effective", exc)
        return []


def usage_windows(db, institute_id: Any, period: str = "MONTH") -> List[Dict[str, Any]]:
    """The institute's counters for the current `period` window, labelled, with
    the soft / hard of the rows that use each counter (the strictest when
    several do). For the /limits/usage endpoints. [] on failure."""
    try:
        from sqlalchemy import select

        inst = str(institute_id)
        period = str(period or "MONTH").upper()
        if period not in ACTIVE_PERIODS:
            return []
        policy = get_policy(db, inst)
        tzn = policy.timezone if policy else DEFAULT_TIMEZONE
        flags = _catalog_flags(db)
        now = _now()
        start, end = window_bounds(period, now, tzn)
        C = COUNTER_TABLE.c
        rows = _read(db, lambda s: s.execute(
            select(C.counter_key, C.credits_used, C.count_used, C.cost_usd)
            .where(C.institute_id == inst, C.period == period, C.window_start == start)).all())
        out = []
        for key, cr, cn, co in rows:
            soft = hard = None
            metric = None
            for r in (policy.rows if policy else []):
                if r.period != period:
                    continue
                sk = scope_key(r.scope_kind, r.scope_value)
                if not key.endswith("|" + sk):
                    continue
                prefix = key[: -(len(sk) + 1)]
                ok = ((r.subject_kind == "INSTITUTE" and prefix == "I")
                      or (r.subject_kind == "USER" and prefix == f"U:{r.subject_value}")
                      or (r.pooled and r.subject_kind == "ROLE" and prefix == f"R:{r.subject_value}")
                      or (r.pooled and r.subject_kind == "ROLE_CLASS" and prefix == f"RC:{r.subject_value}")
                      or (not r.pooled and r.subject_kind in ("ROLE", "ROLE_CLASS") and prefix.startswith("U")))
                if not ok:
                    continue
                if r.hard is not None and (hard is None or r.hard < hard):
                    hard, metric = r.hard, r.metric
                if r.soft is not None and (soft is None or r.soft < soft):
                    soft = r.soft
                    metric = metric or r.metric
            used = _dec(cr) if (metric or "CREDITS") == "CREDITS" else (_dec(cn) if metric == "COUNT" else _dec(co))
            out.append({"key": key, "label": counter_label(key, flags), "period": period,
                        "window_start": _local_iso(start, tzn), "resets_at": _local_iso(end, tzn),
                        "credits_used": _num_out(_dec(cr)), "count_used": _num_out(_dec(cn)),
                        "cost_usd": float(_dec(co)), "metric": metric or "CREDITS",
                        "soft": _num_out(soft), "hard": _num_out(hard),
                        "pct": int(used / hard * 100) if hard and hard > 0 else None})
        out.sort(key=lambda e: e["key"])
        return out
    except Exception as exc:  # noqa: BLE001
        _fail_open("usage", exc)
        return []


def counter_label(key: str, flags: Optional[Dict[str, UseCaseFlags]] = None) -> str:
    """'U:abc|UC:tutor_chat' -> 'User abc · AI tutor chat'."""
    flags = flags or {}
    subj, _, sk = key.partition("|")
    if sk == "ALL":
        scope = "All AI"
    elif sk.startswith("G:"):
        scope = sk[2:].replace("_", " ").title()
    elif sk.startswith("UC:"):
        f = flags.get(sk[3:])
        scope = f.label if f else sk[3:]
    else:
        scope = sk
    if subj == "I":
        who = "Institute"
    elif subj.startswith("U:") or subj.startswith("U#"):
        who = f"User {subj[2:]}"
    elif subj.startswith("RC:"):
        who = f"Role class {subj[3:]}"
    elif subj.startswith("R:"):
        who = f"Role {subj[2:]}"
    else:
        who = subj
    return f"{who} · {scope}"


# ----------------------------------------------------------------------------
# preview_impact
# ----------------------------------------------------------------------------

def preview_impact(db, institute_id: Any, proposed_rows: Sequence[Dict[str, Any]], days: int = 30
                   ) -> Dict[str, Any]:
    """Replay the last `days` days of ai_usage_event (one query, time order,
    at most PREVIEW_MAX_EVENTS) against the institute's active rows plus
    `proposed_rows` (a proposed row with the id of an existing one replaces
    it; with is_active false it removes it), as if ENFORCE had been on: blocked
    events are not counted, so later events see what enforcement would leave.
    Windows start at the scan start (earlier usage in a window is unknown)."""
    inst = str(institute_id)
    result: Dict[str, Any] = {"days": int(days), "events_considered": 0, "would_block": 0, "would_warn": 0,
                              "affected_users": 0, "truncated": False, "by_use_case": [], "by_user": [],
                              "by_row": []}
    try:
        policy = get_policy(db, inst, fresh=True)
        tzn = policy.timezone if policy else DEFAULT_TIMEZONE
        rows: Dict[str, LimitRow] = {}
        for r in (policy.rows if policy else []):
            rows[r.id or f"existing:{len(rows)}"] = r
        for i, data in enumerate(proposed_rows or []):
            try:
                norm = validate_row_input(dict(data))
            except ValueError as exc:
                raise ValueError(f"proposed row {i + 1}: {exc}") from exc
            rid = str(data.get("id")) if data.get("id") else f"proposed:{i}"
            if data.get("is_active") is False or data.get("delete"):
                rows.pop(rid, None)
                continue
            rows[rid] = row_from_mapping(dict(norm, id=rid, institute_id=inst))
        active_rows = [r for r in rows.values() if r.period in ACTIVE_PERIODS]
        if not active_rows:
            return result
        now = _now()
        since = now - timedelta(days=max(int(days), 1))
        flags = _catalog_flags(db)
        tz = _tz(tzn)
        sim: Dict[Target, List[Decimal]] = {}
        start_cache: Dict[Tuple[str, date], datetime] = {}
        by_uc: Dict[str, Dict[str, Any]] = {}
        by_user: Dict[str, Dict[str, Any]] = {}
        by_row: Dict[str, int] = {}

        needs_roles = any(r.subject_kind in ("ROLE", "ROLE_CLASS") for r in active_rows)
        role_map: Dict[str, Any] = {}

        def _replay(s) -> None:
            if needs_roles:
                role_map.update(_load_role_map(s, inst, since - timedelta(days=ROLE_LOOKUP_DAYS)))
            scanned = 0
            for ev in _iter_events(s, inst, since):
                scanned += 1
                if scanned > PREVIEW_MAX_EVENTS:
                    result["truncated"] = True
                    break
                _one(ev)

        def _one(ev) -> None:
            if not counts_toward_limits(ev):
                return
            uc = str(ev.get("use_case") or "unknown")
            f = flags.get(uc)
            if f is not None and not f.limit_eligible:
                return
            group = ev.get("feature_group") or (f.feature_group if f else None)
            actor = actor_from_event(ev)
            if needs_roles and _needs_roles(actor):
                actor = fill_actor_roles(None, inst, actor, role_map=role_map, lookup=False)
            applied = [a for a in select_rows(active_rows, actor, uc, group)]
            if not applied:
                return
            result["events_considered"] += 1
            at = _utc(ev.get("occurred_at")) or now
            local_d = at.astimezone(tz).date()

            def _ws(period: str) -> datetime:
                k = (period, local_d)
                v = start_cache.get(k)
                if v is None:
                    v = _local_midnight(_period_start_date(period, local_d), tz).astimezone(_UTC)
                    start_cache[k] = v
                return v

            cr, cn, co = _contribution(ev, f)
            # The estimate authorize() would have used: the catalog's typical
            # credits (else this call's own credits, the best a replay knows),
            # 1 request for COUNT rows; same `used >= hard or used + est > hard` rule.
            est_credits = (f.typical_credits if (f is not None and f.typical_credits is not None) else cr)
            worst = "OK"
            blockers: List[str] = []
            for a in applied:
                if not a.selected:
                    continue  # out-ranked by a more specific row: it does not constrain this event
                t = (a.key, a.row.period, _ws(a.row.period))
                raw, _pct = evaluate_row(a.row, _metric_value(sim.get(t), a.row.metric),
                                         _estimate_for(a.row.metric, max(est_credits, _D0)))
                if raw == "BLOCK":
                    blockers.append(a.row.id or "")
                if _RANK[raw] > _RANK[worst]:
                    worst = raw
            uid = ev.get("actor_user_id") or (f"{ev.get('actor_kind') or 'UNKNOWN'}")
            u = by_user.setdefault(str(uid), {"user_id": ev.get("actor_user_id"), "name": ev.get("actor_display_name"),
                                              "role_class": ev.get("actor_role_class"), "events": 0,
                                              "would_block": 0, "would_warn": 0, "credits_blocked": _D0})
            c = by_uc.setdefault(uc, {"use_case": uc, "label": f.label if f else uc, "events": 0, "would_block": 0,
                                      "would_warn": 0, "credits_blocked": _D0})
            u["events"] += 1
            c["events"] += 1
            if not u.get("name") and ev.get("actor_display_name"):
                u["name"] = ev.get("actor_display_name")
            if worst == "BLOCK":
                result["would_block"] += 1
                u["would_block"] += 1
                c["would_block"] += 1
                u["credits_blocked"] += cr
                c["credits_blocked"] += cr
                for rid in blockers:
                    by_row[rid] = by_row.get(rid, 0) + 1
                return  # refused: never counted
            if worst == "WARN":
                result["would_warn"] += 1
                u["would_warn"] += 1
                c["would_warn"] += 1
            # Counted like the live counters (every matched key, plus the
            # user's own per-member keys).
            for k, p in count_keys(active_rows, actor, uc, group, applied):
                t = (k, p, _ws(p))
                acc = sim.setdefault(t, [_D0, _D0, _D0])
                acc[0] += cr
                acc[1] += cn
                acc[2] += co
        _read(db, _replay)
        result["affected_users"] = sum(1 for u in by_user.values() if u["would_block"] > 0)

        def _fmt(d):
            d = dict(d)
            d["credits_blocked"] = float(d["credits_blocked"])
            return d

        result["by_use_case"] = [_fmt(v) for v in sorted(by_uc.values(), key=lambda x: (-x["would_block"],
                                                                                         -x["events"]))]
        result["by_user"] = [_fmt(v) for v in sorted(by_user.values(), key=lambda x: (-x["would_block"],
                                                                                      -x["would_warn"],
                                                                                      -x["events"]))[:50]]
        result["by_row"] = [{"row_id": k, "would_block": v} for k, v in sorted(by_row.items(), key=lambda kv: -kv[1])]
        return result
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001
        _fail_open("preview", exc)
        result["error"] = _first_line(exc)
        return result


__all__ = [
    "Decision", "LimitExceeded", "LimitRow", "Policy", "Actor", "Applied", "UseCaseFlags",
    "has_policy", "get_policy", "default_policy", "authorize", "authorize_or_raise", "apply_event_to_counters",
    "settle_reservation", "release_reservation", "decrement_for_refund", "remove_event_contribution",
    "rebuild_counters", "notify_changed", "fill_actor_roles", "remember_actor_roles", "count_keys",
    "effective_limits", "usage_windows", "preview_impact", "validate_row_input", "row_from_mapping",
    "select_rows", "evaluate_row", "window_bounds", "window_start", "block_body", "warning_header",
    "counter_label", "scope_key", "counts_toward_limits", "refresh_policy_index", "configure", "invalidate",
    "reset_for_tests", "set_policy_index_for_tests", "stats", "ENFORCE_SETTING",
]
