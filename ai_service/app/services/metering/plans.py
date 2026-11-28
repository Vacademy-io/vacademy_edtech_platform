"""AI subscription plan engine (contract P-ENGINE; d_plans §3, critique C2-C6,
C12, C18, C20). It decides WHO pays for one charge (the institute's wallet,
the plan's monthly allowance, or nobody because the plan includes it); the
price itself (list_credits) is always what today's pricing computed.

Zero disruption
---------------
* `has_live_subscription` is the gate every caller checks first. It costs NO
  database query on the calling thread: an in-process set of institute ids with
  a TRIAL / ACTIVE / GRACE subscription, refreshed by ONE bulk query at most
  every INDEX_TTL seconds on a background thread with its own session (never
  the caller's session, never under the balance row lock); a failed refresh
  keeps the last good set. With `billing.plans.enabled` false (the default) it
  returns False before even looking at the set (the flag is read from the
  in-process settings cache only, no I/O and no thread: the cache is kept
  fresh by the platform's other settings readers, so turning the flag on is
  noticed within one settings TTL on any pod that serves AI traffic).
* `had_subscription` (same index, no I/O) also knows institutes whose
  subscription is no longer live: refunds and idempotent replays of charges a
  plan paid stay plan-aware after a cancel / expiry (never credit the wallet
  for what the allowance paid). An institute that never had a subscription is
  never in it, so its refunds and replays are exactly today's.
* Every public entry point fails SAFE = CHARGED (today's behaviour): any bug,
  DB error, lock timeout or missing V588 table yields billing_mode CHARGED with
  wallet_credits = list_credits, and a rate-limited log line. Nothing here ever
  raises into a caller. A plan failure can therefore never make a use free by
  accident and never fail the charge.
* Every statement runs inside a SAVEPOINT on the caller's session, so a failed
  plan statement cannot abort the caller's (ledger) transaction (critique C20).
* SHADOW subscriptions are evaluated but NOTHING is reserved or consumed: no
  counter upsert, no allowance update, no period row is created. The decision
  is CHARGED with `shadow_mode` = what LIVE would have done. Shadow fair-use and
  allowance usage are read back from earlier ai_usage_event rows with that
  shadow_billing_mode, so shadow OVER_CAP / exhausted allowance are realistic.
* ai_calling and telephony are ALWAYS charged, whatever any row says (also
  hard-coded here, belt and braces with the locked V588 feature rows).

Decision order (d_plans §3.3 with critique C3/C5/C6/C12 overrides)
-------------------------------------------------------------------
  1. billing.plans.enabled false               -> CHARGED (PLANS_OFF)
  2. no live subscription (index, then row)    -> CHARGED (NO_SUBSCRIPTION)
     not started / ended / DRAFT version / GRACE with grace_behaviour CHARGED
     or past grace_days / a period that will not be renewed -> CHARGED
  3. feature eligibility ALWAYS_CHARGED (or unknown / inactive / locked
     voice-bot feature)                        -> CHARGED; beats any item
  4. active ai_subscription_override row (NULL field = inherit) merged over
  5. the plan version's ai_plan_item; no item  -> CHARGED (NOT_IN_PLAN)
  6. INCLUDED on an INCLUDABLE feature: roles_included must match the role
     class, the model must pass the item's model policy, and every fair-use
     scope must accept the use (guarded upsert .. WHERE used + add <= cap ..
     RETURNING, all scopes in ONE savepoint, released together when any one
     refuses) -> INCLUDED; otherwise CHARGED (ROLE_NOT_INCLUDED /
     MODEL_NOT_INCLUDED / OVER_CAP). An INCLUDED item never falls back to the
     allowance.
     ALLOWANCE (or INCLUDED on an ALLOWANCE_ONLY feature): guarded UPDATE of
     ai_subscription_period.allowance_used (row locked FOR UPDATE, partial take
     allowed) -> ALLOWANCE (all of it), SPLIT (part; the wallet pays the rest)
     or CHARGED (ALLOWANCE_EXHAUSTED).

Model policies: DEFAULT_CHAIN = the model that ran is the PRIMARY of
resolve_models()' chain of one of the feature's catalog model use cases (the
platform default when the feature has none); a fallback of that chain counts
only when the caller says the model was not picked
(preferred_model_explicit=False), because no caller reports picks yet and a
fallback model is also what a user could pick (critique C12, fail safe =
charged). ALLOWLIST = in model_allowlist; MAX_PRICE =
ai_models.output_price_per_1m <= the item's max_output_price_per_1m; ANY = any
model. `preferred_model_explicit=True` (the user or tenant picked the model) is
never INCLUDED unless the policy is ANY AND the model is also in the default
chain. No model (tool priced work) passes every policy except an explicit pick.
A LIVE charge on a model outside the chain leaves a per-period strike for
(subscription, feature, actor): later model-less pre-checks of that actor and
feature are not covered (see _record_strike).

Features: catalog.billing_feature_key of the operation's use case, except the
tools in plan_models.TOOL_FEATURE_OVERRIDES (KB ingest / library unlock, tutor
avatar minute), which bill as their own feature.

Fair-use counters live in ai_usage_counter (V587) with period 'PLAN_PERIOD',
window_start = the subscription period start and keys
'PLAN:<sub>|ALL' (plan-level internal_cost_cap_usd, cost of included use),
'PLAN:<sub>|F:<feature>' (institute caps) and 'PLAN:<sub>|F:<feature>|U:<uid>'
(user caps; the actor or the subject per user_cap_basis; no such user = no
user scope, the institute caps still apply). Only scopes with a cap are
written. Lock order everywhere in this module: plan rows (period, counters,
keys sorted) BEFORE institute_credits; callers must keep that order (a refund
that gives allowance back should call refund_allowance before touching the
balance row, or in a transaction of its own).

Paid plans (source = PAYMENT, V590)
-----------------------------------
* Benefits only for a PAID period: a PAYMENT subscription's period gives plan
  benefits only when its payment_status is PAID / WAIVED / COMPLIMENTARY; any
  other status, or no period row, is CHARGED (reason UNPAID), whatever the
  status (GRACE included: grace_behaviour INCLUDED is not honoured for paid
  plans, no unpaid supply). Period rows of PAYMENT subscriptions are created
  only by the billing endpoints when a charge is paid (_may_open is False for
  them), never lazily here and never ahead by the roll job.
* The global switch cannot take benefits from paying customers (payments
  critique #9): with billing.plans.enabled off, an institute whose live
  subscription is source PAYMENT with enforcement LIVE is still decided by its
  plan. The index remembers those institutes (paid_ids); while the switch is
  off it is refreshed in the background only when
  billing.subscriptions.payments.enabled is on or this pod already knows a
  paid institute, so with every flag at its default nothing changes (no I/O,
  no thread, PLANS_OFF for everyone). MANUAL / COMPLIMENTARY subscriptions are
  decided exactly as before.

release(db, token) undoes a decision's reservations while the caller's
transaction is still the one decide() ran in (e.g. the wallet part of a SPLIT
could not be charged, or the charge path failed after decide and falls back
to today's path). After that transaction ended it does nothing: a rollback
already undid the reservation, a commit made it final.
"""
from __future__ import annotations

import calendar
import logging
import threading
import time
import uuid
import weakref
from dataclasses import dataclass, field, fields, replace
from datetime import datetime, timedelta, timezone
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from . import cache as _cache
from .constants import normalize_role_name
from .plan_models import (
    CATALOG_FEATURE_TABLE, ELIGIBILITIES, FEATURE_TABLE, ITEM_MODES, ITEM_TABLE, LIVE_STATUSES,
    LOCKED_ALWAYS_CHARGED, MODEL_POLICIES, OVERRIDE_TABLE, PAID_PERIOD_STATUSES, PERIOD_TABLE, PLAN_COUNTER_PERIOD,
    PLAN_TABLE, SUBSCRIPTION_TABLE, TOOL_FEATURE_OVERRIDES, UNMAPPED_FEATURE, VERSION_TABLE, plan_counter_key,
)

logger = logging.getLogger(__name__)

INDEX_TTL = 30.0
SUB_CACHE_TTL = 30.0
VERSION_CACHE_TTL = 30.0
LOOKUP_TTL = 30.0
PRICE_CACHE_TTL = 60.0
CHAIN_CACHE_TTL = 30.0
ENABLED_SETTING = "billing.plans.enabled"
PAYMENTS_SETTING = "billing.subscriptions.payments.enabled"
INR_PER_USD_SETTING = "billing.inr_per_usd"
DEFAULT_INR_PER_USD = Decimal("86")
#: list credits per US dollar for a cost estimate when the caller passes no cost
DEFAULT_CREDITS_PER_USD = Decimal("150")
SIM_MAX_EVENTS = 200_000
AVG_DAYS_PER_MONTH = Decimal("30.4375")

CHARGED, INCLUDED, ALLOWANCE, SPLIT = "CHARGED", "INCLUDED", "ALLOWANCE", "SPLIT"

_D0 = Decimal("0")
_Q4 = Decimal("0.0001")
_UTC = timezone.utc

# ----------------------------------------------------------------------------
# Stats + rate-limited logging
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


def _fail_safe(where: str, exc: BaseException) -> None:
    _count("fail_safe")
    _count(f"fail_safe:{where}")
    _log_limited(f"fail:{where}", logging.WARNING,
                 "ai plans: %s failed, charging as today (fail safe): %s [fail-safe so far: %d]",
                 where, _first_line(exc), _stats.get("fail_safe", 0))


# ----------------------------------------------------------------------------
# Value helpers
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


def _q4(value: Decimal) -> Decimal:
    return value.quantize(_Q4, rounding=ROUND_HALF_UP)


def _num_out(value: Optional[Decimal]) -> Optional[float]:
    if value is None:
        return None
    q = Decimal(value).quantize(_Q4)
    if q == q.to_integral_value():
        return int(q)
    return float(q)


def _utc(value: Any) -> Optional[datetime]:
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


def _upper(value: Any) -> str:
    return str(value or "").strip().upper()


def _num_lit(value: Decimal):
    """A typed bind (SQLite gets a float, Postgres a numeric): never a raw str."""
    from sqlalchemy import Numeric, literal

    return literal(value, Numeric(20, 8))


# ----------------------------------------------------------------------------
# Session handling
# ----------------------------------------------------------------------------

def _is_pg(db) -> bool:
    try:
        return db.get_bind().dialect.name == "postgresql"
    except Exception:  # noqa: BLE001
        return False


def _savepoint(db, fn: Callable[[Any], Any]) -> Any:
    """Run `fn(db)` inside a SAVEPOINT of the caller's transaction (begun when
    there is none, and then left open for the caller to commit): a failing
    statement rolls back only the savepoint."""
    with db.begin_nested():
        return fn(db)


def _read(db, fn: Callable[[Any], Any]) -> Any:
    """Read-only work that must not leave an idle transaction behind (precheck,
    reports): limits._read semantics."""
    from .limits import _read as limits_read

    return limits_read(db, fn)


def _lock_timeout(s) -> Optional[str]:
    from .limits import _short_lock_timeout

    return _short_lock_timeout(s)


def _restore_timeout(s, prev: Optional[str]) -> None:
    from .limits import _restore_lock_timeout

    _restore_lock_timeout(s, prev)


# ----------------------------------------------------------------------------
# Settings (no I/O on the charge path)
# ----------------------------------------------------------------------------

def plans_enabled() -> bool:
    """The global switch, from the in-process settings cache only (no I/O)."""
    try:
        return _cache.as_bool(_cache.peek_setting(ENABLED_SETTING, False), False)
    except Exception:  # noqa: BLE001
        return False


def payments_enabled() -> bool:
    """billing.subscriptions.payments.enabled, from the in-process settings cache only (no I/O)."""
    try:
        return _cache.as_bool(_cache.peek_setting(PAYMENTS_SETTING, False), False)
    except Exception:  # noqa: BLE001
        return False


def _plans_on_for(institute_id: Any) -> bool:
    """The global switch, or (switch off) this institute pays for a LIVE plan (no I/O)."""
    if plans_enabled():
        return True
    return bool(institute_id) and str(institute_id) in _index.paid_ids


def inr_per_usd() -> Decimal:
    """Reports only (simulate / pnl); may refresh the settings cache."""
    try:
        v = _dec_opt(_cache.setting_value(INR_PER_USD_SETTING, DEFAULT_INR_PER_USD))
        return v if v is not None and v > 0 else DEFAULT_INR_PER_USD
    except Exception:  # noqa: BLE001
        return DEFAULT_INR_PER_USD


# ----------------------------------------------------------------------------
# Lookups: billing features + use_case -> feature (refreshed with the index)
# ----------------------------------------------------------------------------

@dataclass(frozen=True)
class Feature:
    key: str
    label: str
    eligibility: str
    locked: bool = False
    is_active: bool = True
    display_order: int = 100


@dataclass
class Lookups:
    features: Dict[str, Feature] = field(default_factory=dict)
    #: use_case -> feature_key (catalog.billing_feature_key; unmapped rows absent)
    uc_feature: Dict[str, str] = field(default_factory=dict)
    #: feature_key -> [use_case, ...]
    feature_ucs: Dict[str, List[str]] = field(default_factory=dict)


_lk: Dict[str, Any] = {"lookups": None, "at": None, "retry_after": None}
_lk_lock = threading.Lock()


def _load_lookups(s) -> Lookups:
    from sqlalchemy import select

    out = Lookups()
    F = FEATURE_TABLE.c
    for r in s.execute(select(F.feature_key, F.label, F.eligibility, F.locked, F.is_active,
                              F.display_order)).mappings().all():
        key = str(r.get("feature_key") or "").strip()
        if not key:
            continue
        try:
            order = int(r.get("display_order") if r.get("display_order") is not None else 100)
        except (TypeError, ValueError):
            order = 100
        out.features[key] = Feature(key=key, label=str(r.get("label") or key), eligibility=_upper(r.get("eligibility")),
                                    locked=bool(r.get("locked")), is_active=r.get("is_active") is not False
                                    and r.get("is_active") != 0, display_order=order)
    C = CATALOG_FEATURE_TABLE.c
    for r in s.execute(select(C.use_case, C.billing_feature_key)).all():
        uc, fk = str(r[0] or "").strip().lower(), str(r[1] or "").strip()
        if uc and fk:
            out.uc_feature[uc] = fk
            out.feature_ucs.setdefault(fk, []).append(uc)
    for v in out.feature_ucs.values():
        v.sort()
    return out


def _store_lookups(lk: Lookups) -> None:
    _lk["lookups"] = lk
    _lk["at"] = time.monotonic()
    _lk["retry_after"] = None


def lookups(db=None, *, read: Optional[Callable] = None) -> Optional[Lookups]:
    """The cached lookups; reloaded on `db` (in a savepoint, or with `read`)
    when stale or never loaded. Last good copy on failure; None when nothing
    ever loaded."""
    at = _lk.get("at")
    now = time.monotonic()
    if _lk.get("lookups") is not None and at is not None and now - at < LOOKUP_TTL:
        return _lk["lookups"]
    if db is None:
        return _lk.get("lookups")
    ra = _lk.get("retry_after")
    if ra is not None and now < ra:
        return _lk.get("lookups")
    if not _lk_lock.acquire(blocking=False):
        return _lk.get("lookups")
    try:
        try:
            _store_lookups((read or _savepoint)(db, _load_lookups))
        except Exception as exc:  # noqa: BLE001
            _lk["retry_after"] = time.monotonic() + LOOKUP_TTL
            _fail_safe("lookups", exc)
        return _lk.get("lookups")
    finally:
        _lk_lock.release()


def _resolve_use_case(use_case: Any, tool_key: Any, request_type: Any) -> str:
    snap = _cache.peek_snapshot()
    if snap is None:
        return str(use_case or "unknown").strip().lower() or "unknown"
    from .service import EventInput, resolve_use_case

    tk = str(tool_key).strip()[:64] if tool_key else None
    uc, _src, _row = resolve_use_case(snap, EventInput(use_case=use_case, tool_key=tk, request_type=request_type), tk)
    return uc


def tool_feature(tool_key: Any, lk: Optional[Lookups] = None) -> Optional[str]:
    """The tool-level billing feature (TOOL_FEATURE_OVERRIDES) of a tool key,
    when that feature exists in the catalogue; else None. No I/O."""
    if not tool_key:
        return None
    fk = TOOL_FEATURE_OVERRIDES.get(str(tool_key).strip().lower())
    if fk is None:
        return None
    lk = lk if lk is not None else _lk.get("lookups")
    if lk is None or fk not in lk.features:
        return None
    return fk


def feature_for(use_case: Any = None, tool_key: Any = None, request_type: Any = None) -> str:
    """The billing feature of one operation: a tool-level feature
    (TOOL_FEATURE_OVERRIDES: KB ingest / library unlock, tutor avatar minute)
    first, else explicit use case > tool_key > request_type (the metering
    catalog resolution) -> catalog.billing_feature_key; 'unmapped' when nothing
    maps (or the lookups were never loaded). No I/O."""
    try:
        lk = _lk.get("lookups")
        if lk is None:
            return UNMAPPED_FEATURE
        tf = tool_feature(tool_key, lk)
        if tf is not None:
            return tf
        uc = _resolve_use_case(use_case, tool_key, request_type)
        return lk.uc_feature.get(uc) or UNMAPPED_FEATURE
    except Exception as exc:  # noqa: BLE001
        _fail_safe("feature_for", exc)
        return UNMAPPED_FEATURE


# ----------------------------------------------------------------------------
# Live-subscription index (has_live_subscription): in-memory, bulk refresh
# ----------------------------------------------------------------------------

class _Index:
    def __init__(self) -> None:
        self.ids: frozenset = frozenset()
        #: institutes with ANY subscription row (any status, incl. ended ones)
        self.known: frozenset = frozenset()
        #: institutes whose live subscription is source PAYMENT with enforcement LIVE
        #: (decided by their plan even with billing.plans.enabled off)
        self.paid_ids: frozenset = frozenset()
        self.loaded_at: Optional[float] = None
        self.attempted_at: Optional[float] = None
        self.refreshing = False
        self.lock = threading.Lock()
        self.engine: Any = None
        self.sessionmaker: Any = None
        self.ok = False
        self.pending_paid: Optional[frozenset] = None


_index = _Index()


def configure(engine: Any = None, sessionmaker: Any = None) -> None:
    """Which engine / sessionmaker the background index refresh uses (tests,
    scripts). In the app: ai_service's own sessionmaker once the engine exists."""
    _index.engine = engine
    _index.sessionmaker = sessionmaker


def _index_session():
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


def _load_index_ids(s) -> Tuple[frozenset, frozenset]:
    """(institutes with a TRIAL / ACTIVE / GRACE subscription, institutes with
    any subscription row at all) in ONE small grouped query. Also stores the
    institutes whose live subscription is a LIVE PAYMENT one in _index.pending_paid
    (applied with the rest by refresh_index)."""
    from sqlalchemy import and_, case, func, select

    S = SUBSCRIPTION_TABLE.c
    paid_live = and_(S.status.in_(LIVE_STATUSES), S.source == "PAYMENT", S.enforcement == "LIVE")
    rows = s.execute(select(S.institute_id, func.max(case((S.status.in_(LIVE_STATUSES), 1), else_=0)),
                            func.max(case((paid_live, 1), else_=0)))
                     .group_by(S.institute_id)).all()
    known = frozenset(str(r[0]) for r in rows if r[0])
    live = frozenset(str(r[0]) for r in rows if r[0] and int(r[1] or 0) == 1)
    _index.pending_paid = frozenset(str(r[0]) for r in rows if r[0] and int(r[2] or 0) == 1)
    return live, known


def refresh_index(session=None) -> bool:
    """Reload the set of institutes with a live subscription (one query) and the
    feature lookups (two small queries), now, synchronously; on `session` when
    given (read only; the caller owns it), else on a fresh session. Keeps the last
    good copy on failure. Returns success."""
    own = session is None
    s = session if session is not None else _index_session()
    _index.attempted_at = time.monotonic()
    if s is None:
        _index.attempted_at = time.monotonic() - max(INDEX_TTL - 1.0, 0.0)
        return False
    try:
        ids, known = _load_index_ids(s)
        lk = _load_lookups(s)
        if own:
            s.commit()
        if ids != _index.ids:
            logger.info("ai plans: %d institute(s) with a live AI subscription", len(ids))
        _index.ids = ids
        _index.known = _index.known | known | ids   # monotonic: never forgets an institute
        if _index.pending_paid is not None:
            _index.paid_ids = _index.pending_paid & ids
            _index.pending_paid = None
        _index.loaded_at = time.monotonic()
        _index.ok = True
        _store_lookups(lk)
        return True
    except Exception as exc:  # noqa: BLE001
        _count("index_refresh_failed")
        _log_limited("index", logging.WARNING,
                     "ai plans: subscription index refresh failed (keeping %d known institute(s); plans stay "
                     "off for the others until V588 is applied / the DB answers): %s",
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


def _background(target: Callable[[], None], name: str) -> None:
    try:
        threading.Thread(target=target, name=name, daemon=True).start()
    except Exception as exc:  # noqa: BLE001
        with _index.lock:
            _index.refreshing = False
        _fail_safe("index-thread", exc)


def _refresh_in_background() -> None:
    try:
        refresh_index()
    finally:
        with _index.lock:
            _index.refreshing = False


def _maybe_refresh_index() -> None:
    now = time.monotonic()
    last = _index.attempted_at
    if last is not None and now - last < INDEX_TTL:
        return
    with _index.lock:
        if _index.refreshing:
            return
        if _index.attempted_at is not None and now - _index.attempted_at < INDEX_TTL:
            return
        _index.refreshing = True
        _index.attempted_at = now
    _background(_refresh_in_background, "ai-plans-index")


def has_live_subscription(institute_id: Any) -> bool:
    """True when plans are on and the institute has a TRIAL / ACTIVE / GRACE
    subscription (SHADOW or LIVE). No I/O on the calling thread, ever; with the
    flag off not even a background thread (the flag is only peeked) - except
    that an institute paying for a LIVE plan (source PAYMENT) stays covered with
    the flag off: then the index is refreshed in the background while paid
    plans are switched on or this pod knows a paid institute (critique #9)."""
    try:
        if not institute_id:
            return False
        if not plans_enabled():
            if not _index.paid_ids and not payments_enabled():
                return False
            _maybe_refresh_index()
            return str(institute_id) in _index.paid_ids
        _maybe_refresh_index()
        return str(institute_id) in _index.ids
    except Exception:  # noqa: BLE001
        return False


def had_subscription(institute_id: Any) -> bool:
    """No I/O. True when the institute has or had a subscription (any status)
    as of this pod's last index load, or was written by this pod since; also
    True while plans are on and this pod has not loaded the index yet (unknown:
    the plan-aware refund / replay check then runs and, for an institute with
    no plan-paid events, finds nothing and does exactly today's work). Used to
    keep refunds and idempotent replays of plan-paid charges plan-aware after
    a subscription stopped being live. Never depends on a refresh while the
    flag is off (last good set kept; empty on a pod that never loaded it)."""
    try:
        if not institute_id:
            return False
        inst = str(institute_id)
        if inst in _index.known or inst in _index.ids:
            return True
        return bool(plans_enabled() and not _index.ok)
    except Exception:  # noqa: BLE001
        return False


def set_index_for_tests(ids: Iterable[str], known: Iterable[str] = (), paid: Iterable[str] = ()) -> None:
    _index.ids = frozenset(str(i) for i in ids)
    _index.known = _index.ids | frozenset(str(i) for i in known)
    _index.paid_ids = frozenset(str(i) for i in paid) & _index.ids
    _index.loaded_at = _index.attempted_at = time.monotonic()
    _index.ok = True


# ----------------------------------------------------------------------------
# Subscriptions, versions, periods (cached 30 s; read in a savepoint)
# ----------------------------------------------------------------------------

@dataclass(frozen=True)
class Version:
    id: str
    plan_id: Optional[str]
    plan_key: Optional[str]
    plan_name: Optional[str]
    version_no: int
    status: str
    currency: str
    price_minor: int
    period_months: int
    allowance_credits: Decimal
    internal_cost_cap_usd: Optional[Decimal]
    grace_days: int
    grace_behaviour: str


@dataclass(frozen=True)
class Item:
    feature_key: str
    mode: str
    id: Optional[str] = None
    model_policy: str = "DEFAULT_CHAIN"
    model_allowlist: Tuple[str, ...] = ()
    max_output_price_per_1m: Optional[Decimal] = None
    on_model_violation: str = "CHARGE"
    roles_included: Optional[Tuple[str, ...]] = None
    inst_units_cap: Optional[Decimal] = None
    inst_credits_cap: Optional[Decimal] = None
    inst_cost_usd_cap: Optional[Decimal] = None
    user_units_cap: Optional[Decimal] = None
    user_credits_cap: Optional[Decimal] = None
    user_cap_basis: str = "ACTOR"
    over_cap_action: str = "CHARGE"
    display_cap_text: Optional[str] = None
    override_id: Optional[str] = None


@dataclass(frozen=True)
class Sub:
    id: str
    institute_id: str
    plan_version_id: str
    status: str
    enforcement: str
    source: str
    anchor_at: datetime
    start_at: datetime
    end_at: Optional[datetime]
    period_months: int
    auto_renew: bool
    grace_days: int
    cancel_at_period_end: bool
    pending_plan_version_id: Optional[str]
    price_override_minor: Optional[int]
    updated_at: Optional[datetime]
    #: feature_key -> override row (dict)
    overrides: Dict[str, Dict[str, Any]] = field(default_factory=dict, hash=False, compare=False)


@dataclass(frozen=True)
class Period:
    id: Optional[str]
    subscription_id: str
    period_start: datetime
    period_end: datetime
    plan_version_id: str
    allowance_credits: Decimal
    allowance_used: Decimal = _D0
    price_minor_snapshot: int = 0
    payment_status: str = "DUE"
    virtual: bool = False


_sub_cache: Dict[str, Tuple[float, Optional[Sub]]] = {}
_version_cache: Dict[str, Tuple[float, Optional[Tuple[Version, Dict[str, Item]]]]] = {}
_period_cache: Dict[Tuple[str, str], Tuple[float, Period]] = {}
_cache_lock = threading.Lock()


def _int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _sub_from(r: Dict[str, Any], overrides: Dict[str, Dict[str, Any]]) -> Sub:
    return Sub(
        id=str(r["id"]), institute_id=str(r["institute_id"]), plan_version_id=str(r["plan_version_id"]),
        status=_upper(r.get("status")), enforcement=_upper(r.get("enforcement")) or "SHADOW",
        source=_upper(r.get("source")) or "MANUAL",
        anchor_at=_utc(r.get("anchor_at")) or _utc(r.get("start_at")), start_at=_utc(r.get("start_at")),
        end_at=_utc(r.get("end_at")), period_months=max(_int(r.get("period_months"), 1), 1),
        auto_renew=bool(r.get("auto_renew")), grace_days=max(_int(r.get("grace_days"), 7), 0),
        cancel_at_period_end=bool(r.get("cancel_at_period_end")),
        pending_plan_version_id=str(r["pending_plan_version_id"]) if r.get("pending_plan_version_id") else None,
        price_override_minor=_int(r.get("price_override_minor"), 0) if r.get("price_override_minor") is not None
        else None,
        updated_at=_utc(r.get("updated_at")), overrides=overrides)


def _load_sub(s, institute_id: str) -> Optional[Sub]:
    from sqlalchemy import select

    S = SUBSCRIPTION_TABLE.c
    r = s.execute(select(SUBSCRIPTION_TABLE).where(S.institute_id == institute_id, S.status.in_(LIVE_STATUSES))
                  .order_by(S.created_at.desc()).limit(1)).mappings().first()
    if r is None:
        return None
    O = OVERRIDE_TABLE.c
    overrides: Dict[str, Dict[str, Any]] = {}
    for o in s.execute(select(OVERRIDE_TABLE).where(O.subscription_id == r["id"], O.is_active.is_(True))
                       .order_by(O.created_at)).mappings().all():
        overrides[str(o["feature_key"])] = dict(o)
    return _sub_from(dict(r), overrides)


def live_subscription(db, institute_id: Any, now: Optional[datetime] = None, *, fresh: bool = False,
                      read: Optional[Callable] = None) -> Optional[Sub]:
    """The institute's TRIAL / ACTIVE / GRACE subscription with its active
    overrides, cached SUB_CACHE_TTL seconds (read in a savepoint on `db`). None
    when there is none or it cannot be read (fail safe)."""
    if not institute_id:
        return None
    inst = str(institute_id)
    t = time.monotonic()
    if not fresh:
        hit = _sub_cache.get(inst)
        if hit is not None and t - hit[0] < SUB_CACHE_TTL:
            return hit[1]
    try:
        sub = (read or _savepoint)(db, lambda s: _load_sub(s, inst))
    except Exception as exc:  # noqa: BLE001
        _fail_safe("subscription-read", exc)
        hit = _sub_cache.get(inst)
        return hit[1] if hit is not None else None
    with _cache_lock:
        _sub_cache[inst] = (time.monotonic(), sub)
    return sub


def _item_from(r: Dict[str, Any]) -> Item:
    # NULL = every role; an empty array = no role (never INCLUDED: fail safe)
    roles = _as_list(r.get("roles_included")) if r.get("roles_included") is not None else None
    return Item(
        feature_key=str(r["feature_key"]), mode=_upper(r.get("mode")), id=str(r["id"]) if r.get("id") else None,
        model_policy=_upper(r.get("model_policy")) or "DEFAULT_CHAIN",
        model_allowlist=tuple(_as_list(r.get("model_allowlist"))),
        max_output_price_per_1m=_dec_opt(r.get("max_output_price_per_1m")),
        on_model_violation=_upper(r.get("on_model_violation")) or "CHARGE",
        roles_included=tuple(_role_norm(x) for x in roles) if roles is not None else None,
        inst_units_cap=_dec_opt(r.get("inst_units_cap")), inst_credits_cap=_dec_opt(r.get("inst_credits_cap")),
        inst_cost_usd_cap=_dec_opt(r.get("inst_cost_usd_cap")), user_units_cap=_dec_opt(r.get("user_units_cap")),
        user_credits_cap=_dec_opt(r.get("user_credits_cap")),
        user_cap_basis=_upper(r.get("user_cap_basis")) or "ACTOR",
        over_cap_action=_upper(r.get("over_cap_action")) or "CHARGE",
        display_cap_text=r.get("display_cap_text"))


def _load_version(s, version_id: str) -> Optional[Tuple[Version, Dict[str, Item]]]:
    from sqlalchemy import select

    V, P = VERSION_TABLE.c, PLAN_TABLE.c
    r = s.execute(select(VERSION_TABLE, P.plan_key, P.name.label("plan_name"))
                  .select_from(VERSION_TABLE.outerjoin(PLAN_TABLE, P.id == V.plan_id))
                  .where(V.id == version_id)).mappings().first()
    if r is None:
        return None
    v = Version(
        id=str(r["id"]), plan_id=str(r["plan_id"]) if r.get("plan_id") else None, plan_key=r.get("plan_key"),
        plan_name=r.get("plan_name"), version_no=_int(r.get("version_no"), 0), status=_upper(r.get("status")),
        currency=str(r.get("currency") or "INR"), price_minor=_int(r.get("price_minor"), 0),
        period_months=max(_int(r.get("period_months"), 1), 1), allowance_credits=_dec(r.get("allowance_credits")),
        internal_cost_cap_usd=_dec_opt(r.get("internal_cost_cap_usd")),
        grace_days=max(_int(r.get("grace_days"), 7), 0), grace_behaviour=_upper(r.get("grace_behaviour")) or CHARGED)
    I = ITEM_TABLE.c
    items: Dict[str, Item] = {}
    for ir in s.execute(select(ITEM_TABLE).where(I.plan_version_id == version_id)).mappings().all():
        try:
            it = _item_from(dict(ir))
            items[it.feature_key] = it
        except Exception:  # noqa: BLE001
            continue
    return v, items


def version_terms(db, version_id: Any, *, read: Optional[Callable] = None
                  ) -> Optional[Tuple[Version, Dict[str, Item]]]:
    """(Version, {feature_key: Item}) of one plan version, cached VERSION_CACHE_TTL
    seconds. None when absent or unreadable."""
    if not version_id:
        return None
    vid = str(version_id)
    t = time.monotonic()
    hit = _version_cache.get(vid)
    if hit is not None and t - hit[0] < VERSION_CACHE_TTL:
        return hit[1]
    runner = read or _savepoint
    try:
        out = runner(db, lambda s: _load_version(s, vid))
    except Exception as exc:  # noqa: BLE001
        _fail_safe("version-read", exc)
        return hit[1] if hit is not None else None
    with _cache_lock:
        _version_cache[vid] = (time.monotonic(), out)
    return out


def invalidate(institute_id: Any = None, *, live: Optional[bool] = None, version_id: Any = None,
               paid: Optional[bool] = None) -> None:
    """After a subscription / override / plan write: forget the cached copies (one
    institute or all). `live` updates this process's index at once (True = now
    TRIAL/ACTIVE/GRACE, False = not); `paid` (with live) also says whether that
    live subscription is a LIVE PAYMENT one; other pods catch up within INDEX_TTL."""
    with _cache_lock:
        _period_cache.clear()          # cheap: re-read on the next charge
        if institute_id is None:
            _sub_cache.clear()
        else:
            _sub_cache.pop(str(institute_id), None)
        if version_id is not None:
            _version_cache.pop(str(version_id), None)
        elif institute_id is None:
            _version_cache.clear()
    _lk["at"] = None
    _chain_cache.clear()
    if institute_id is not None:
        _index.known = _index.known | {str(institute_id)}
    if institute_id is not None and live is not None:
        ids = set(_index.ids)
        if live:
            ids.add(str(institute_id))
        else:
            ids.discard(str(institute_id))
        _index.ids = frozenset(ids)
        if paid is not None:
            pids = set(_index.paid_ids)
            if paid and live:
                pids.add(str(institute_id))
            else:
                pids.discard(str(institute_id))
            _index.paid_ids = frozenset(pids)
        elif not live:
            _index.paid_ids = _index.paid_ids - {str(institute_id)}
    else:
        _index.attempted_at = None


def reset_for_tests() -> None:
    with _cache_lock:
        _sub_cache.clear()
        _version_cache.clear()
        _period_cache.clear()
    _price_cache.clear()
    _chain_cache.clear()
    _strikes.clear()
    _index.ids = frozenset()
    _index.known = frozenset()
    _index.paid_ids = frozenset()
    _index.pending_paid = None
    _index.loaded_at = _index.attempted_at = None
    _index.refreshing = False
    _index.ok = False
    _index.engine = None
    _index.sessionmaker = None
    _lk["lookups"] = None
    _lk["at"] = None
    _lk["retry_after"] = None
    _last_log.clear()
    with _stats_lock:
        _stats.clear()


# ── period windows ───────────────────────────────────────────────────────────

def _add_months(dt: datetime, months: int) -> datetime:
    y, m = divmod(dt.month - 1 + months, 12)
    year, month = dt.year + y, m + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def period_window(anchor_at: datetime, period_months: int, at: datetime) -> Tuple[datetime, datetime]:
    """[start, end) of the period containing `at`: anchor + k * period_months
    calendar months (each start computed from the anchor, so no day drift; a
    31st anchor gives the 30th / 28th in short months). Before the anchor: the
    first period."""
    anchor = _utc(anchor_at)
    at = _utc(at)
    pm = max(int(period_months or 1), 1)
    diff = (at.year - anchor.year) * 12 + (at.month - anchor.month)
    k = max(diff // pm, 0)
    start = _add_months(anchor, k * pm)
    while k > 0 and start > at:
        k -= 1
        start = _add_months(anchor, k * pm)
    while True:
        nxt = _add_months(anchor, (k + 1) * pm)
        if nxt > at:
            return start, nxt
        k += 1
        start = nxt


def _period_from(r: Dict[str, Any], virtual: bool = False) -> Period:
    return Period(id=str(r["id"]) if r.get("id") else None, subscription_id=str(r["subscription_id"]),
                  period_start=_utc(r["period_start"]), period_end=_utc(r["period_end"]),
                  plan_version_id=str(r["plan_version_id"]), allowance_credits=_dec(r.get("allowance_credits")),
                  allowance_used=_dec(r.get("allowance_used")),
                  price_minor_snapshot=_int(r.get("price_minor_snapshot"), 0),
                  payment_status=_upper(r.get("payment_status")) or "DUE", virtual=virtual)


def _select_period(s, sub_id: str, start: datetime) -> Optional[Dict[str, Any]]:
    from sqlalchemy import select

    P = PERIOD_TABLE.c
    r = s.execute(select(PERIOD_TABLE).where(P.subscription_id == sub_id, P.period_start == start)).mappings().first()
    return dict(r) if r is not None else None


def _may_open(sub: Sub, start: datetime, end: datetime) -> bool:
    """May a period row be opened lazily (no roll job yet)? The first period
    always; a later one only for a subscription that still renews into it
    (auto_renew on, no cancel at period end). Never for a non-renewing one:
    its last period's end is final, a charge after it is CHARGED and the roll
    job expires / cancels it. (Turning renewal off mid-period opens the
    current period first: plans_admin, so that period is never lost.)
    Never for a source=PAYMENT subscription: its periods are created only when
    their charge is paid (routers/plans_billing_internal.py)."""
    if sub.source == "PAYMENT":
        return False
    if start <= sub.start_at < end:
        return True
    return bool(sub.auto_renew and not sub.cancel_at_period_end)


def _new_period_values(db, sub: Sub, start: datetime, end: datetime,
                       read: Callable) -> Optional[Dict[str, Any]]:
    first = start <= sub.start_at < end
    vid = sub.plan_version_id if first or not sub.pending_plan_version_id else sub.pending_plan_version_id
    terms = version_terms(db, vid, read=read)
    if terms is None:
        return None
    v = terms[0]
    price = sub.price_override_minor if sub.price_override_minor is not None else v.price_minor
    return {"id": str(uuid.uuid4()), "subscription_id": sub.id, "period_start": start, "period_end": end,
            "plan_version_id": v.id, "price_minor_snapshot": int(price), "allowance_credits": v.allowance_credits,
            "allowance_used": _D0, "payment_status": "COMPLIMENTARY" if sub.source == "COMPLIMENTARY" else "DUE",
            "created_at": _now()}


def _insert_period(s, values: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """INSERT .. ON CONFLICT DO NOTHING RETURNING, then SELECT (psycopg 3: never
    the rowcount)."""
    T = PERIOD_TABLE
    if s.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as _ins
    else:
        from sqlalchemy.dialects.sqlite import insert as _ins
    stmt = _ins(T).values(values).on_conflict_do_nothing(
        index_elements=[T.c.subscription_id, T.c.period_start]).returning(*T.c)
    r = s.execute(stmt).mappings().first()
    if r is not None:
        return dict(r)
    return _select_period(s, values["subscription_id"], values["period_start"])


def _separate_insert(db, values: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Open the period on a short transaction of its own (durable even when the
    charge rolls back). Postgres only; None when it cannot."""
    if not _is_pg(db):
        return None
    try:
        from .limits import _own_txn

        return _own_txn(db, lambda s: _insert_period(s, values))
    except Exception as exc:  # noqa: BLE001
        _count("period_separate_failed")
        _log_limited("period-separate", logging.INFO,
                     "ai plans: opening the period on its own transaction failed, using the caller's: %s",
                     _first_line(exc))
        return None


def current_period(db, sub: Sub, now: Optional[datetime] = None, *, create: bool = True,
                   read: Optional[Callable] = None) -> Optional[Period]:
    """The subscription's period containing `now`. Existing rows are cached
    (identity only; allowance is always re-read where it matters). Missing row:
    `create` = open it lazily (its own transaction on Postgres, else a savepoint
    of the caller's) when _may_open allows; otherwise a virtual Period (id None)
    for read-only evaluation. `read`: how reads run (default: a savepoint of the
    caller's transaction; pass _read-like for report endpoints). None when the
    period may not be opened or on error."""
    try:
        now = _utc(now) or _now()
        start, end = period_window(sub.anchor_at, sub.period_months, now)
        ck = (sub.id, start.isoformat())
        t = time.monotonic()
        hit = _period_cache.get(ck)
        if hit is not None and t - hit[0] < SUB_CACHE_TTL:
            return hit[1]
        read = read or _savepoint
        row = read(db, lambda s: _select_period(s, sub.id, start))
        if row is not None:
            p = _period_from(row)
            with _cache_lock:
                _period_cache[ck] = (time.monotonic(), p)
            return p
        if not _may_open(sub, start, end):
            return None
        values = _new_period_values(db, sub, start, end, read)
        if values is None:
            return None
        if not create:
            return _period_from(dict(values, id=None), virtual=True)
        row = _separate_insert(db, values)
        if row is not None:
            p = _period_from(row)
            with _cache_lock:
                _period_cache[ck] = (time.monotonic(), p)
            _count("period_opened")
            return p
        row = _savepoint(db, lambda s: _insert_period(s, values))
        _count("period_opened_in_txn")
        return _period_from(row) if row is not None else None   # not cached: may still roll back
    except Exception as exc:  # noqa: BLE001
        _fail_safe("period", exc)
        return None


# ----------------------------------------------------------------------------
# Decision objects
# ----------------------------------------------------------------------------

@dataclass
class ReleaseToken:
    """What one LIVE decision reserved, for release()."""

    institute_id: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    window_start: Optional[datetime] = None
    #: [(counter_key, credits, count, cost_usd), ...]
    counters: List[Tuple[str, Decimal, Decimal, Decimal]] = field(default_factory=list)
    period_id: Optional[str] = None
    allowance_take: Decimal = _D0
    released: bool = False
    _txn: Any = field(default=None, repr=False, compare=False)

    def as_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "institute_id": self.institute_id, "window_start": self.window_start.isoformat()
                if self.window_start else None, "counters": [[k, str(a), str(b), str(c)] for k, a, b, c in self.counters],
                "period_id": self.period_id, "allowance_take": str(self.allowance_take), "released": self.released}


@dataclass
class PlanDecision:
    """Who pays for one charge. CHARGED = today's path, exactly."""

    billing_mode: str = CHARGED
    list_credits: Decimal = _D0
    wallet_credits: Decimal = _D0
    allowance_credits: Decimal = _D0
    included_credits: Decimal = _D0
    subscription_id: Optional[str] = None
    plan_id: Optional[str] = None
    plan_version_id: Optional[str] = None
    plan_item_id: Optional[str] = None
    override_id: Optional[str] = None
    period_id: Optional[str] = None
    feature_key: Optional[str] = None
    enforcement: Optional[str] = None
    reason: str = "PLANS_OFF"
    #: SHADOW subscriptions: what LIVE would have done (billing_mode stays CHARGED)
    shadow_mode: Optional[str] = None
    #: the item asks the PRE-CHECK to refuse (on_model_violation / over_cap_action BLOCK)
    block: bool = False
    release_token: Optional[ReleaseToken] = None

    @property
    def covered(self) -> bool:
        return self.billing_mode in (INCLUDED, ALLOWANCE, SPLIT)

    def event_fields(self) -> Dict[str, Any]:
        """ai_usage_event columns (billing_mode, shadow_billing_mode, subscription_id, plan_id, plan_item_id)."""
        return {"billing_mode": self.billing_mode, "shadow_billing_mode": self.shadow_mode,
                "subscription_id": self.subscription_id, "plan_id": self.plan_id, "plan_item_id": self.plan_item_id}

    def as_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {}
        for f in fields(self):
            v = getattr(self, f.name)
            if f.name == "release_token":
                v = v.as_dict() if v is not None else None
            elif isinstance(v, Decimal):
                v = _num_out(v)
            d[f.name] = v
        return d


def _charged(lc: Decimal, reason: str, **kw: Any) -> PlanDecision:
    return PlanDecision(billing_mode=CHARGED, list_credits=lc, wallet_credits=lc, reason=reason, **kw)


@dataclass
class _Req:
    institute_id: str
    list_credits: Decimal
    feature: str
    model: Optional[str]
    explicit: Optional[bool]
    role_class: Optional[str]
    actor_user_id: Optional[str]
    subject_user_id: Optional[str]
    units: Decimal
    cost_usd: Decimal


@dataclass
class _Outcome:
    mode: str
    reason: str
    take: Decimal = _D0
    block: bool = False
    item: Optional[Item] = None
    counters: List[Tuple[str, Decimal, Decimal, Decimal]] = field(default_factory=list)


class _OverCap(Exception):
    pass


# ----------------------------------------------------------------------------
# Pure evaluation (shared by decide, precheck and simulate)
# ----------------------------------------------------------------------------

_ROLE_ALIASES = {"STUDENT": "LEARNER"}


def _role_norm(value: Any) -> str:
    r = normalize_role_name(value)
    return _ROLE_ALIASES.get(r, r)


def role_class_of(role_class: Any = None, user_role: Any = None, roles: Any = None) -> Optional[str]:
    """Role class (ADMIN | TEACHER | STAFF | PARENT | LEARNER | SYSTEM | API_KEY |
    PUBLIC) from an explicit class, else the raw roles / the legacy user_role via
    the metering role map (STUDENT -> LEARNER). None when unknown."""
    rc = _role_norm(role_class) if role_class else ""
    if rc and rc != "UNKNOWN":
        return rc
    names = [normalize_role_name(r) for r in (_as_list(roles) if roles is not None else [])]
    if user_role:
        names.append(normalize_role_name(user_role))
    names = [n for n in names if n]
    if not names:
        return None
    from .constants import DEFAULT_ROLE_MAP, LEGACY_ROLE_CLASSES

    snap = _cache.peek_snapshot()
    rmap = getattr(snap, "roles", None) or DEFAULT_ROLE_MAP
    best: Optional[Tuple[int, str]] = None
    for n in names:
        if n in LEGACY_ROLE_CLASSES:
            hit = (0, LEGACY_ROLE_CLASSES[n])
        elif n in rmap:
            cls, prec = rmap[n]
            hit = (int(prec), str(cls))
        else:
            continue
        if best is None or hit[0] < best[0]:
            best = hit
    return best[1] if best else None


def _merge_item(feature: str, item: Optional[Item], override: Optional[Dict[str, Any]]) -> Optional[Item]:
    """Override row (NULL field = inherit) over the plan item. An override with a
    mode and no item stands alone (default policy DEFAULT_CHAIN)."""
    if not override:
        return item
    base = item or Item(feature_key=feature, mode=CHARGED)
    if item is None and not override.get("mode"):
        return None
    changes: Dict[str, Any] = {"override_id": str(override.get("id")) if override.get("id") else None}
    if override.get("mode"):
        changes["mode"] = _upper(override.get("mode"))
    for k in ("inst_units_cap", "inst_credits_cap", "inst_cost_usd_cap", "user_units_cap", "user_credits_cap"):
        v = _dec_opt(override.get(k))
        if v is not None:
            changes[k] = v
    return replace(base, **changes)


@dataclass(frozen=True)
class _Scope:
    key: str
    units_cap: Optional[Decimal]
    credits_cap: Optional[Decimal]
    cost_cap: Optional[Decimal]


def _scopes(sub_id: str, version: Version, item: Item, req: _Req) -> List[_Scope]:
    out: List[_Scope] = []
    if version.internal_cost_cap_usd is not None:
        out.append(_Scope(plan_counter_key(sub_id), None, None, version.internal_cost_cap_usd))
    if any(c is not None for c in (item.inst_units_cap, item.inst_credits_cap, item.inst_cost_usd_cap)):
        out.append(_Scope(plan_counter_key(sub_id, item.feature_key), item.inst_units_cap, item.inst_credits_cap,
                          item.inst_cost_usd_cap))
    if item.user_units_cap is not None or item.user_credits_cap is not None:
        uid = req.subject_user_id if item.user_cap_basis == "SUBJECT" else req.actor_user_id
        if uid:
            out.append(_Scope(plan_counter_key(sub_id, item.feature_key, str(uid)), item.user_units_cap,
                              item.user_credits_cap, None))
    return sorted(out, key=lambda sc: sc.key)


def _fits(sc: _Scope, used: Sequence[Decimal], add: Tuple[Decimal, Decimal, Decimal]) -> bool:
    """used / add = (credits, count, cost)."""
    if sc.credits_cap is not None and used[0] + add[0] > sc.credits_cap:
        return False
    if sc.units_cap is not None and used[1] + add[1] > sc.units_cap:
        return False
    if sc.cost_cap is not None and used[2] + add[2] > sc.cost_cap:
        return False
    return True


def _canon(model: Any) -> Optional[str]:
    if not model:
        return None
    raw = str(model).strip()
    snap = _cache.peek_snapshot()
    aliases = getattr(snap, "aliases", {}) or {}
    return str(aliases.get(raw, raw)).strip().lower() or None


class _Backend:
    """How an evaluation reads / reserves (DB live, DB read-only, shadow, memory)."""

    def chain(self, feature: str) -> Set[str]:
        raise NotImplementedError

    def primaries(self, feature: str) -> Set[str]:
        """The chain's primary model(s) (no fallbacks)."""
        raise NotImplementedError

    def price(self, model: str) -> Optional[Decimal]:
        raise NotImplementedError

    def caps(self, scopes: List[_Scope], add: Tuple[Decimal, Decimal, Decimal]) -> bool:
        raise NotImplementedError

    def take_allowance(self, want: Decimal) -> Decimal:
        raise NotImplementedError


def _model_ok(item: Item, req: _Req, backend: _Backend) -> bool:
    policy = item.model_policy if item.model_policy in MODEL_POLICIES else "DEFAULT_CHAIN"
    m = _canon(req.model)
    if req.explicit is True:
        return policy == "ANY" and m is not None and m in backend.chain(req.feature)
    if policy == "ANY" or m is None:
        return True
    if policy == "DEFAULT_CHAIN":
        if req.explicit is False:
            # the caller says the model came from the default chain (no pick): any chain member
            return m in backend.chain(req.feature)
        # Unknown whether the model was picked (critique C12; no caller reports it yet): only
        # the chain's primary model(s) are included. A fallback model is also what a user could
        # pick explicitly, so it is charged (fail safe) unless the caller says it was not picked.
        return m in backend.primaries(req.feature)
    if policy == "ALLOWLIST":
        return m in {_canon(x) for x in item.model_allowlist}
    if policy == "MAX_PRICE":
        cap = item.max_output_price_per_1m
        price = backend.price(m)
        return cap is not None and price is not None and price <= cap
    return False


def _evaluate(feature_row: Optional[Feature], item: Optional[Item], version: Version, sub_id: str, req: _Req,
              backend: _Backend) -> _Outcome:
    feature = req.feature
    if feature in LOCKED_ALWAYS_CHARGED:
        return _Outcome(CHARGED, "LOCKED_FEATURE")
    if feature_row is None or not feature_row.is_active:
        return _Outcome(CHARGED, "FEATURE_UNKNOWN")
    elig = feature_row.eligibility
    if elig not in ELIGIBILITIES or elig == "ALWAYS_CHARGED":
        return _Outcome(CHARGED, "FEATURE_ALWAYS_CHARGED")
    if item is None:
        return _Outcome(CHARGED, "NOT_IN_PLAN")
    mode = item.mode
    if mode not in ITEM_MODES or mode == CHARGED:
        return _Outcome(CHARGED, "PLAN_CHARGED", item=item)
    lc = req.list_credits
    if mode == INCLUDED and elig == "INCLUDABLE":
        if item.roles_included is not None and (req.role_class or "") not in item.roles_included:
            return _Outcome(CHARGED, "ROLE_NOT_INCLUDED", item=item)
        if not _model_ok(item, req, backend):
            return _Outcome(CHARGED, "MODEL_NOT_INCLUDED", item=item, block=item.on_model_violation == "BLOCK")
        scopes = _scopes(sub_id, version, item, req)
        add = (lc, req.units, req.cost_usd)
        if scopes and not backend.caps(scopes, add):
            return _Outcome(CHARGED, "OVER_CAP", item=item, block=item.over_cap_action == "BLOCK")
        return _Outcome(INCLUDED, "INCLUDED", item=item,
                        counters=[(sc.key, add[0], add[1], add[2]) for sc in scopes])
    # ALLOWANCE item, or INCLUDED on an ALLOWANCE_ONLY feature
    take = backend.take_allowance(lc)
    take = max(min(take, lc), _D0)
    if take <= 0:
        return _Outcome(CHARGED, "ALLOWANCE_EXHAUSTED", item=item)
    if take >= lc:
        return _Outcome(ALLOWANCE, "ALLOWANCE", take=lc, item=item)
    return _Outcome(SPLIT, "ALLOWANCE_PARTIAL", take=take, item=item)


# ── DB backends ──────────────────────────────────────────────────────────────

_chain_cache: Dict[str, Tuple[float, frozenset, frozenset]] = {}
_price_cache: Dict[str, Tuple[float, Optional[Decimal]]] = {}


def _chain_sets(db, feature: str, read: Callable) -> Tuple[frozenset, frozenset]:
    """(every model of the feature's default chains, their primary models)."""
    t = time.monotonic()
    hit = _chain_cache.get(feature)
    if hit is not None and t - hit[0] < CHAIN_CACHE_TTL:
        return hit[1], hit[2]
    from ..model_selection import DEFAULT_HARD_FALLBACK, NON_GLM_FALLBACK, resolve_models

    lk = _lk.get("lookups")
    snap = _cache.peek_snapshot()
    catalog = getattr(snap, "catalog", {}) or {}
    model_ucs = sorted({str(catalog.get(uc, {}).get("model_use_case") or "").strip()
                        for uc in ((lk.feature_ucs.get(feature) if lk else None) or [])} - {""})
    models: Set[str] = set()
    primaries: Set[str] = set()
    for muc in model_ucs:
        primary, fallbacks = read(db, lambda s, u=muc: resolve_models(s, u))
        c = _canon(primary)
        if c:
            primaries.add(c)
        for m in [primary, *fallbacks]:
            c = _canon(m)
            if c:
                models.add(c)
    if not models:
        models = {c for c in (_canon(DEFAULT_HARD_FALLBACK), _canon(NON_GLM_FALLBACK)) if c}
        primaries = {c for c in (_canon(DEFAULT_HARD_FALLBACK),) if c}
    out = (frozenset(models), frozenset(primaries))
    _chain_cache[feature] = (time.monotonic(), out[0], out[1])
    return out


def _default_chain(db, feature: str, read: Callable) -> frozenset:
    return _chain_sets(db, feature, read)[0]


def _default_primaries(db, feature: str, read: Callable) -> frozenset:
    return _chain_sets(db, feature, read)[1]


def default_chain_models(db, feature_key: str) -> List[str]:
    """The model ids a DEFAULT_CHAIN item includes for a feature when nobody
    says whether the model was picked (read-only; the tenant plan view's
    "included models"): the default chains' primary models. [] on failure."""
    try:
        return sorted(_default_primaries(db, str(feature_key), _read))
    except Exception as exc:  # noqa: BLE001
        _fail_safe("default_chain_models", exc)
        return []


def _model_price(db, model: str, read: Callable) -> Optional[Decimal]:
    t = time.monotonic()
    hit = _price_cache.get(model)
    if hit is not None and t - hit[0] < PRICE_CACHE_TTL:
        return hit[1]
    from sqlalchemy import text

    def _q(s):
        r = s.execute(text("SELECT output_price_per_1m FROM ai_models WHERE lower(model_id) = :m LIMIT 1"),
                      {"m": model}).first()
        return _dec_opt(r[0]) if r is not None else None

    price = read(db, _q)
    _price_cache[model] = (time.monotonic(), price)
    return price


def _read_counters(s, inst: str, ws: datetime, keys: Sequence[str]) -> Dict[str, List[Decimal]]:
    from sqlalchemy import select

    from .limit_models import COUNTER_TABLE

    C = COUNTER_TABLE.c
    out: Dict[str, List[Decimal]] = {}
    for r in s.execute(select(C.counter_key, C.window_start, C.credits_used, C.count_used, C.cost_usd).where(
            C.institute_id == inst, C.period == PLAN_COUNTER_PERIOD, C.counter_key.in_(list(keys)))).all():
        if _utc(r[1]) == ws:
            out[r[0]] = [_dec(r[2]), _dec(r[3]), _dec(r[4])]
    return out


def _guarded_upsert(s, inst: str, ws: datetime, sc: _Scope, add: Tuple[Decimal, Decimal, Decimal],
                    now: datetime) -> bool:
    """One scope: INSERT .. ON CONFLICT DO UPDATE .. WHERE used + add <= cap
    RETURNING. True = reserved. (A first use larger than a cap is refused before
    the INSERT by the caller.)"""
    from sqlalchemy import and_

    from .limit_models import COUNTER_TABLE

    T = COUNTER_TABLE
    if s.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as _ins
    else:
        from sqlalchemy.dialects.sqlite import insert as _ins
    stmt = _ins(T).values(institute_id=inst, counter_key=sc.key, period=PLAN_COUNTER_PERIOD, window_start=ws,
                          credits_used=add[0], count_used=add[1], cost_usd=add[2], updated_at=now)
    conds = []
    if sc.credits_cap is not None:
        conds.append(T.c.credits_used + stmt.excluded.credits_used <= _num_lit(sc.credits_cap))
    if sc.units_cap is not None:
        conds.append(T.c.count_used + stmt.excluded.count_used <= _num_lit(sc.units_cap))
    if sc.cost_cap is not None:
        conds.append(T.c.cost_usd + stmt.excluded.cost_usd <= _num_lit(sc.cost_cap))
    stmt = stmt.on_conflict_do_update(
        index_elements=[T.c.institute_id, T.c.counter_key, T.c.period, T.c.window_start],
        set_={"credits_used": T.c.credits_used + stmt.excluded.credits_used,
              "count_used": T.c.count_used + stmt.excluded.count_used,
              "cost_usd": T.c.cost_usd + stmt.excluded.cost_usd,
              "updated_at": stmt.excluded.updated_at},
        where=and_(*conds) if conds else None,
    ).returning(T.c.counter_key)
    return s.execute(stmt).first() is not None


def _subtract_counters(s, inst: str, ws: datetime, counters: Sequence[Tuple[str, Decimal, Decimal, Decimal]],
                       now: datetime) -> None:
    from sqlalchemy import case, update

    from .limit_models import COUNTER_TABLE

    C = COUNTER_TABLE.c

    def floor0(expr):
        return case((expr < 0, 0), else_=expr)

    for key, cr, cn, co in sorted(counters):
        s.execute(update(COUNTER_TABLE).where(
            C.institute_id == inst, C.counter_key == key, C.period == PLAN_COUNTER_PERIOD, C.window_start == ws,
        ).values(credits_used=floor0(C.credits_used - _num_lit(cr)), count_used=floor0(C.count_used - _num_lit(cn)),
                 cost_usd=floor0(C.cost_usd - _num_lit(co)), updated_at=now))


def _take_allowance_db(s, period_id: str, want: Decimal) -> Decimal:
    """Lock the period row (FOR UPDATE), take min(want, remaining), guarded
    UPDATE .. WHERE allowance_used + take <= allowance_credits RETURNING."""
    from sqlalchemy import select, update

    P = PERIOD_TABLE.c
    for _ in range(3):
        row = s.execute(select(P.allowance_credits, P.allowance_used).where(P.id == period_id)
                        .with_for_update()).first()
        if row is None:
            return _D0
        remaining = _dec(row[0]) - _dec(row[1])
        take = min(want, remaining).quantize(_Q4, rounding=ROUND_DOWN)
        if take <= 0:
            return _D0
        done = s.execute(update(PERIOD_TABLE).where(
            P.id == period_id, P.allowance_used + _num_lit(take) <= P.allowance_credits,
        ).values(allowance_used=P.allowance_used + _num_lit(take)).returning(P.id)).first()
        if done is not None:
            return take
    return _D0


class _DbBackend(_Backend):
    """LIVE reserve (write=True: guarded upserts / updates in the caller's
    savepoint) or LIVE read-only (write=False: precheck, decide(reserve=False))."""

    def __init__(self, db, inst: str, period: Period, *, write: bool, read: Callable, now: datetime) -> None:
        self.db, self.inst, self.period, self.write, self.read, self.now = db, inst, period, write, read, now
        #: read-only allowance evaluations: the remaining allowance seen
        self.last_remaining: Optional[Decimal] = None

    def chain(self, feature: str) -> Set[str]:
        return set(_default_chain(self.db, feature, self.read))

    def primaries(self, feature: str) -> Set[str]:
        return set(_default_primaries(self.db, feature, self.read))

    def price(self, model: str) -> Optional[Decimal]:
        return _model_price(self.db, model, self.read)

    def caps(self, scopes: List[_Scope], add: Tuple[Decimal, Decimal, Decimal]) -> bool:
        zero = [_D0, _D0, _D0]
        if any(not _fits(sc, zero, add) for sc in scopes):
            return False   # one use larger than a cap: never inserted
        ws = self.period.period_start
        if not self.write:
            used = self.read(self.db, lambda s: _read_counters(s, self.inst, ws, [sc.key for sc in scopes]))
            return all(_fits(sc, used.get(sc.key, zero), add) for sc in scopes)
        # Reservation happens in decide's savepoint (see _reserve)
        return True

    def take_allowance(self, want: Decimal) -> Decimal:
        p = self.period
        if not self.write or p.id is None:
            if p.id is None:
                remaining = p.allowance_credits - p.allowance_used
            else:
                row = self.read(self.db, lambda s: _select_period(s, p.subscription_id, p.period_start))
                remaining = (_dec(row.get("allowance_credits")) - _dec(row.get("allowance_used"))) if row else _D0
            self.last_remaining = max(remaining, _D0)
            return max(min(want, remaining), _D0).quantize(_Q4, rounding=ROUND_DOWN)
        return want   # the real take happens in decide's savepoint (see _reserve)


class _ShadowBackend(_DbBackend):
    """SHADOW: read-only; usage so far = earlier events' shadow_billing_mode."""

    def __init__(self, db, inst: str, period: Period, feature_ucs: Sequence[str], uid_for: Callable[[_Scope], Any],
                 *, read: Callable, now: datetime) -> None:
        super().__init__(db, inst, period, write=False, read=read, now=now)
        self.feature_ucs = list(feature_ucs)
        self.uid_for = uid_for

    def caps(self, scopes: List[_Scope], add: Tuple[Decimal, Decimal, Decimal]) -> bool:
        zero = [_D0, _D0, _D0]
        if any(not _fits(sc, zero, add) for sc in scopes):
            return False
        used = self.read(self.db, lambda s: _shadow_usage(s, self.inst, self.period.period_start, self.feature_ucs,
                                                          scopes, self.uid_for))
        return all(_fits(sc, used.get(sc.key, zero), add) for sc in scopes)

    def take_allowance(self, want: Decimal) -> Decimal:
        p = self.period
        used = self.read(self.db, lambda s: _shadow_allowance_used(s, self.inst, p.period_start))
        remaining = max(p.allowance_credits - min(used, p.allowance_credits), _D0)
        self.last_remaining = remaining
        return max(min(want, remaining), _D0).quantize(_Q4, rounding=ROUND_DOWN)


def _shadow_usage(s, inst: str, ws: datetime, feature_ucs: Sequence[str], scopes: Sequence[_Scope],
                  uid_for: Callable[[_Scope], Any]) -> Dict[str, List[Decimal]]:
    """(credits, count, cost) per scope from this period's events whose
    shadow_billing_mode is INCLUDED (one query)."""
    from sqlalchemy import and_, case, func, select

    from .models import EVENT_TABLE

    E = EVENT_TABLE.c
    cost = func.coalesce(E.real_cost_usd, E.list_credits / _num_lit(DEFAULT_CREDITS_PER_USD))
    cols = []
    for i, sc in enumerate(scopes):
        if sc.key.endswith("|ALL"):
            cond = E.shadow_billing_mode == INCLUDED
        else:
            cond = and_(E.shadow_billing_mode == INCLUDED, E.use_case.in_(list(feature_ucs) or ["__none__"]))
            uid = uid_for(sc)
            if uid is not None:
                cond = and_(cond, (E.subject_user_id if uid[0] == "SUBJECT" else E.actor_user_id) == uid[1])
        cols += [func.coalesce(func.sum(case((cond, E.list_credits), else_=0)), 0).label(f"c{i}"),
                 func.coalesce(func.sum(case((cond, E.request_count), else_=0)), 0).label(f"n{i}"),
                 func.coalesce(func.sum(case((cond, cost), else_=0)), 0).label(f"u{i}")]
    r = s.execute(select(*cols).where(E.institute_id == inst, E.occurred_at >= ws,
                                      E.parent_event_id.is_(None))).first()
    out: Dict[str, List[Decimal]] = {}
    for i, sc in enumerate(scopes):
        out[sc.key] = [_dec(r[3 * i]), _dec(r[3 * i + 1]), _dec(r[3 * i + 2])] if r is not None else [_D0, _D0, _D0]
    return out


def _shadow_allowance_used(s, inst: str, ws: datetime) -> Decimal:
    """Shadow allowance used this period: sum of list_credits of shadow ALLOWANCE
    and SPLIT events (a SPLIT always takes the rest, so capping the sum at the
    allowance gives the exact shadow balance)."""
    from sqlalchemy import func, select

    from .models import EVENT_TABLE

    E = EVENT_TABLE.c
    r = s.execute(select(func.coalesce(func.sum(E.list_credits), 0)).where(
        E.institute_id == inst, E.occurred_at >= ws, E.shadow_billing_mode.in_([ALLOWANCE, SPLIT]),
        E.parent_event_id.is_(None))).first()
    return _dec(r[0]) if r is not None else _D0


# ----------------------------------------------------------------------------
# decide / precheck / release
# ----------------------------------------------------------------------------

def _make_req(institute_id: str, lc: Decimal, feature: str, model, preferred_model_explicit, role_class, user_role,
              actor_roles, actor_user_id, user_id, subject_user_id, units, cost_usd) -> _Req:
    u = _dec_opt(units)
    cost = _dec_opt(cost_usd)
    if cost is None or cost < 0:
        cost = (lc / DEFAULT_CREDITS_PER_USD).quantize(Decimal("0.00000001"))
    return _Req(institute_id=institute_id, list_credits=lc, feature=feature, model=str(model) if model else None,
                explicit=preferred_model_explicit, role_class=role_class_of(role_class, user_role, actor_roles),
                actor_user_id=str(actor_user_id or user_id) if (actor_user_id or user_id) else None,
                subject_user_id=str(subject_user_id) if subject_user_id else None,
                units=u if u is not None and u >= 0 else Decimal("1"), cost_usd=cost)


@dataclass
class _Ctx:
    sub: Sub
    period: Period
    version: Version
    items: Dict[str, Item]


def _context(db, sub: Sub, now: datetime, *, create: bool, read: Callable) -> Tuple[Optional[_Ctx], str]:
    """The subscription's state at `now`: (ctx, 'OK') or (None, reason)."""
    if sub.start_at is None or now < sub.start_at:
        return None, "NOT_STARTED"
    if sub.end_at is not None and now >= sub.end_at:
        return None, "ENDED"
    if sub.status not in LIVE_STATUSES:
        return None, "NOT_LIVE"
    paid_plan = sub.source == "PAYMENT"
    period = current_period(db, sub, now, create=create and not paid_plan, read=read)
    if paid_plan and (period is None or period.virtual or period.payment_status not in PAID_PERIOD_STATUSES):
        # a paid plan gives benefits only for a PAID period (no row = not paid yet)
        return None, "UNPAID"
    if period is None:
        return None, "NO_PERIOD"
    terms = version_terms(db, period.plan_version_id, read=read)
    if terms is None:
        return None, "VERSION_MISSING"
    version, items = terms
    if version.status not in ("PUBLISHED", "RETIRED"):
        return None, "VERSION_NOT_LIVE"
    if sub.status == "GRACE" and not paid_plan:
        if version.grace_behaviour != INCLUDED:
            return None, "GRACE_CHARGED"
        if now >= period.period_start + timedelta(days=sub.grace_days):
            return None, "GRACE_OVER"
    return _Ctx(sub=sub, period=period, version=version, items=items), "OK"


def _sub_fields(sub: Optional[Sub], ctx: Optional[_Ctx], feature: Optional[str]) -> Dict[str, Any]:
    if sub is None:
        return {"feature_key": feature}
    return {"subscription_id": sub.id, "enforcement": sub.enforcement, "feature_key": feature,
            "plan_id": ctx.version.plan_id if ctx else None,
            "plan_version_id": ctx.version.id if ctx else sub.plan_version_id,
            "period_id": ctx.period.id if ctx else None}


#: Transaction-local list of live release tokens (Postgres): set_config(.., true)
#: is undone by a savepoint rollback and ends with the transaction, so release()
#: knows exactly whether a reservation is still in effect. One GUC name only
#: (no per-token placeholders piling up in a pooled backend); pgbouncer-safe.
TOKEN_GUC = "vacademy_plans.live_tokens"


def _mark_token(s, token_id: str) -> None:
    from sqlalchemy import text

    s.execute(text("SELECT set_config(:g, coalesce(current_setting(:g, true), '') || :t, true)"),
              {"g": TOKEN_GUC, "t": f",{token_id}"})


def _take_token_mark(s, token_id: str) -> bool:
    """True (and the mark removed) when the token's reservation is still part of
    this transaction."""
    from sqlalchemy import text

    cur = s.execute(text("SELECT coalesce(current_setting(:g, true), '')"), {"g": TOKEN_GUC}).scalar() or ""
    mark = f",{token_id}"
    if mark not in cur:
        return False
    s.execute(text("SELECT set_config(:g, :v, true)"), {"g": TOKEN_GUC, "v": cur.replace(mark, "")})
    return True


def _reserve(db, inst: str, ctx: _Ctx, out: _Outcome, req: _Req, now: datetime) -> ReleaseToken:
    """All reservations of one LIVE decision in ONE savepoint of the caller's
    transaction, under a short lock_timeout: the fair-use scopes in sorted key
    order (INCLUDED) or the allowance take (ALLOWANCE). Any refusal or error
    rolls every one of them back and raises (_OverCap for a refusal)."""
    token = ReleaseToken(institute_id=inst, window_start=ctx.period.period_start, period_id=ctx.period.id)

    def _work(s):
        prev = _lock_timeout(s)
        if out.mode == INCLUDED:
            scopes = {sc.key: sc for sc in _scopes(ctx.sub.id, ctx.version, out.item, req)}
            for key, cr, cn, co in sorted(out.counters):
                if not _guarded_upsert(s, inst, ctx.period.period_start, scopes[key], (cr, cn, co), now):
                    raise _OverCap(key)
            token.counters = list(out.counters)
        else:
            if ctx.period.id is None:
                raise _OverCap("no period row")
            took = _take_allowance_db(s, ctx.period.id, out.take)
            if took <= 0:
                raise _OverCap("allowance")
            token.allowance_take = took
        if _is_pg(s):
            _mark_token(s, token.id)
        _restore_timeout(s, prev)

    _savepoint(db, _work)
    try:
        root = db.get_transaction()
        token._txn = weakref.ref(root) if root is not None else None
    except Exception:  # noqa: BLE001
        token._txn = None
    return token


# ── off-chain model strikes (pre-check vs charge consistency) ──────────────
# Most pre-checks do not know the model (preflight, require_credits, admin_core
# planCovers), so an INCLUDED item answers "covered" for them; the charge then
# knows the model that ran. When a LIVE charge finds a model OUTSIDE the
# feature's default chain (an explicit pick of another model, never a
# fallback), it leaves a strike for (subscription, feature, actor) for the rest
# of the period: a strike makes later model-less pre-checks for that actor and
# feature NOT covered (= today's balance check), so a tenant cannot pass the
# prepaid gate again and again with a model the plan never pays for. Written
# on a short transaction of its own (survives a dropped / rolled-back charge);
# also kept in-process.

_strikes: Dict[str, float] = {}
STRIKES_MAX = 20000


def _strike_key(sub_id: str, feature: str, actor_user_id: Any) -> str:
    return plan_counter_key(sub_id, feature, str(actor_user_id) if actor_user_id else "*").replace("|U:", "|X:", 1)


def _strike_mem_key(inst: str, ws: datetime, key: str) -> str:
    return f"{inst}|{ws.isoformat()}|{key}"


def _record_strike(db, inst: str, ctx: _Ctx, feature: str, req: _Req, now: datetime) -> None:
    try:
        key = _strike_key(ctx.sub.id, feature, req.actor_user_id)
        ws = ctx.period.period_start
        if len(_strikes) > STRIKES_MAX:
            _strikes.clear()
        _strikes[_strike_mem_key(inst, ws, key)] = time.monotonic()
        _count("model_strike")
        if not _is_pg(db) or ctx.period.id is None:
            return
        from .limits import _own_txn

        _own_txn(db, lambda s: _guarded_upsert(s, inst, ws, _Scope(key, None, None, None),
                                               (_D0, Decimal("1"), _D0), now))
    except Exception as exc:  # noqa: BLE001
        _count("model_strike_write_failed")
        _log_limited("strike", logging.INFO, "ai plans: model strike not persisted: %s", _first_line(exc))


def _has_strike(db, inst: str, ctx: _Ctx, feature: str, req: _Req) -> bool:
    """Fails CLOSED for the pre-check (True = not covered) only on a positive
    read; a read error means no strike known (the charge path still decides)."""
    key = _strike_key(ctx.sub.id, feature, req.actor_user_id)
    ws = ctx.period.period_start
    if _strike_mem_key(inst, ws, key) in _strikes:
        return True
    try:
        got = _read(db, lambda s: _read_counters(s, inst, ws, [key]))
        row = got.get(key)
        return bool(row and row[1] > 0)
    except Exception as exc:  # noqa: BLE001
        _fail_safe("strike-read", exc)
        return False


def decide(db, *, institute_id: Any, list_credits: Any, use_case: Any = None, tool_key: Any = None,
           request_type: Any = None, model: Any = None, actor_user_id: Any = None, user_id: Any = None,
           role_class: Any = None, user_role: Any = None, actor_roles: Any = None, subject_user_id: Any = None,
           units: Any = 1, cost_usd: Any = None, preferred_model_explicit: Optional[bool] = None,
           reserve: bool = True, now: Optional[datetime] = None, feature_key: Optional[str] = None) -> PlanDecision:
    """Who pays for this charge. Never raises; CHARGED (wallet = list_credits,
    today's path) unless a LIVE subscription covers it. `reserve=True` (the
    charge path): LIVE reservations are made in a savepoint of the caller's open
    transaction (commit them with the ledger, or release()); `reserve=False`:
    the same verdict read-only (nothing reserved, no release token)."""
    lc = _q4(max(_dec(list_credits), _D0))
    try:
        if not _plans_on_for(institute_id):
            _count("decide:off")
            return _charged(lc, "PLANS_OFF")
        if not institute_id or not has_live_subscription(institute_id):
            _count("decide:fast")
            return _charged(lc, "NO_SUBSCRIPTION")
    except Exception as exc:  # noqa: BLE001
        _fail_safe("decide-gate", exc)
        return _charged(lc, "ERROR")
    try:
        return _decide(db, str(institute_id), lc, use_case, tool_key, request_type, model, actor_user_id, user_id,
                       role_class, user_role, actor_roles, subject_user_id, units, cost_usd, preferred_model_explicit,
                       bool(reserve), _utc(now) or _now(), feature_key)
    except Exception as exc:  # noqa: BLE001
        _fail_safe("decide", exc)
        return _charged(lc, "ERROR")


def _decide(db, inst, lc, use_case, tool_key, request_type, model, actor_user_id, user_id, role_class, user_role,
            actor_roles, subject_user_id, units, cost_usd, explicit, reserve, now, feature_key) -> PlanDecision:
    sub = live_subscription(db, inst, now)
    if sub is None:
        return _charged(lc, "NO_SUBSCRIPTION")
    if not plans_enabled() and not (sub.source == "PAYMENT" and sub.enforcement == "LIVE"):
        return _charged(lc, "PLANS_OFF")       # switch off: only paid LIVE plans keep applying
    lk = lookups(db)
    feature = str(feature_key) if feature_key else feature_for(use_case, tool_key, request_type)
    if lc <= 0:
        return _charged(lc, "ZERO_CREDITS", **_sub_fields(sub, None, feature))
    live = sub.enforcement == "LIVE"
    write = live and reserve
    ctx, why = _context(db, sub, now, create=write, read=_savepoint)
    if ctx is None:
        _count(f"decide:{why}")
        return _charged(lc, why, **_sub_fields(sub, None, feature))
    req = _make_req(inst, lc, feature, model, explicit, role_class, user_role, actor_roles, actor_user_id, user_id,
                    subject_user_id, units, cost_usd)
    frow = lk.features.get(feature) if lk else None
    item = _merge_item(feature, ctx.items.get(feature), sub.overrides.get(feature))
    read = _savepoint      # decide never ends the caller's transaction
    if live:
        backend: _Backend = _DbBackend(db, inst, ctx.period, write=write, read=read, now=now)
    else:
        def uid_for(sc: _Scope):
            if "|U:" not in sc.key or item is None:
                return None
            if item.user_cap_basis == "SUBJECT":
                return ("SUBJECT", req.subject_user_id)
            return ("ACTOR", req.actor_user_id)

        backend = _ShadowBackend(db, inst, ctx.period, (lk.feature_ucs.get(feature) if lk else None) or [], uid_for,
                                 read=read, now=now)
    out = _evaluate(frow, item, ctx.version, sub.id, req, backend)
    fields = _sub_fields(sub, ctx, feature)
    fields.update(plan_item_id=out.item.id if out.item else None,
                  override_id=out.item.override_id if out.item else None, block=out.block)

    if not live:
        _count(f"shadow:{out.mode}")
        return _charged(lc, f"SHADOW:{out.reason}", shadow_mode=out.mode, **fields)
    if out.mode == CHARGED:
        _count(f"decide:{out.reason}")
        if write and out.reason == "MODEL_NOT_INCLUDED" and req.model:
            m = _canon(req.model)
            if m is not None and m not in backend.chain(feature):
                _record_strike(db, inst, ctx, feature, req, now)
        return _charged(lc, out.reason, **fields)
    if not write:
        return _decision_for(out, lc, fields, None)

    try:
        token = _reserve(db, inst, ctx, out, req, now)
    except _OverCap:
        _count("decide:OVER_CAP" if out.mode == INCLUDED else "decide:ALLOWANCE_EXHAUSTED")
        reason = "OVER_CAP" if out.mode == INCLUDED else "ALLOWANCE_EXHAUSTED"
        blk = out.item is not None and out.mode == INCLUDED and out.item.over_cap_action == "BLOCK"
        fields["block"] = blk
        return _charged(lc, reason, **fields)
    except Exception as exc:  # noqa: BLE001
        _fail_safe("reserve", exc)
        return _charged(lc, "ERROR", **fields)
    if out.mode in (ALLOWANCE, SPLIT):
        took = token.allowance_take
        out = _Outcome(ALLOWANCE if took >= lc else SPLIT, "ALLOWANCE" if took >= lc else "ALLOWANCE_PARTIAL",
                       take=min(took, lc), item=out.item)
    _count(f"decide:{out.mode}")
    return _decision_for(out, lc, fields, token)


def _decision_for(out: _Outcome, lc: Decimal, fields: Dict[str, Any], token: Optional[ReleaseToken]) -> PlanDecision:
    if out.mode == INCLUDED:
        return PlanDecision(billing_mode=INCLUDED, list_credits=lc, wallet_credits=_D0, included_credits=lc,
                            reason=out.reason, release_token=token, **fields)
    take = _q4(out.take)
    if out.mode == ALLOWANCE or take >= lc:
        return PlanDecision(billing_mode=ALLOWANCE, list_credits=lc, wallet_credits=_D0, allowance_credits=lc,
                            reason="ALLOWANCE", release_token=token, **fields)
    return PlanDecision(billing_mode=SPLIT, list_credits=lc, wallet_credits=_q4(lc - take), allowance_credits=take,
                        reason=out.reason, release_token=token, **fields)


def precheck(db, *, institute_id: Any, use_case: Any = None, tool_key: Any = None, request_type: Any = None,
             model: Any = None, actor_user_id: Any = None, user_id: Any = None, role_class: Any = None,
             user_role: Any = None, actor_roles: Any = None, subject_user_id: Any = None, estimate: Any = None,
             units: Any = 1, cost_usd: Any = None, preferred_model_explicit: Optional[bool] = None,
             now: Optional[datetime] = None, feature_key: Optional[str] = None) -> Dict[str, Any]:
    """Read-only "would the plan pay for this?" for pre-call balance checks
    (critique C18: never creates a wallet, never reserves, never opens a period).
    {'covered': True} only for a LIVE subscription whose verdict is INCLUDED, or
    ALLOWANCE with the remaining allowance >= the estimate. Fails safe to
    covered False (= the caller's balance check, as today)."""
    base = {"covered": False, "mode": CHARGED, "reason": "PLANS_OFF", "feature_key": None, "subscription_id": None,
            "enforcement": None, "block": False, "allowance_remaining": None}
    try:
        if not _plans_on_for(institute_id) or not institute_id or not has_live_subscription(institute_id):
            if plans_enabled():
                base["reason"] = "NO_SUBSCRIPTION"
            return base
        est = _dec_opt(estimate)
        lc = _q4(est if est is not None and est > 0 else Decimal("0.0001"))
        inst = str(institute_id)
        nowv = _utc(now) or _now()
        sub = live_subscription(db, inst, nowv, read=_read)
        feature = str(feature_key) if feature_key else None
        lk = lookups(db, read=_read)
        feature = feature or feature_for(use_case, tool_key, request_type)
        base.update(feature_key=feature, reason="NO_SUBSCRIPTION")
        if sub is None:
            return base
        if not plans_enabled() and not (sub.source == "PAYMENT" and sub.enforcement == "LIVE"):
            base["reason"] = "PLANS_OFF"
            return base
        base.update(subscription_id=sub.id, enforcement=sub.enforcement)
        ctx, why = _context(db, sub, nowv, create=False, read=_read)
        if ctx is None:
            base["reason"] = why
            return base
        req = _make_req(inst, lc, feature, model, preferred_model_explicit, role_class, user_role, actor_roles,
                        actor_user_id, user_id, subject_user_id, units, cost_usd)
        item = _merge_item(feature, ctx.items.get(feature), sub.overrides.get(feature))
        backend = _DbBackend(db, inst, ctx.period, write=False, read=_read, now=nowv)
        out = _evaluate(lk.features.get(feature) if lk else None, item, ctx.version, sub.id, req, backend)
        if (out.mode == INCLUDED and req.model is None and out.item is not None
                and out.item.model_policy != "ANY" and _has_strike(db, inst, ctx, feature, req)):
            # this actor already ran this feature on a model outside the plan's chain this period
            out = _Outcome(CHARGED, "MODEL_STRIKE", item=out.item)
        base.update(mode=out.mode, reason=out.reason, block=out.block,
                    allowance_remaining=_num_out(backend.last_remaining))
        if sub.enforcement != "LIVE":
            base["reason"] = f"SHADOW:{out.reason}"
            return base
        base["covered"] = out.mode in (INCLUDED, ALLOWANCE)
        return base
    except Exception as exc:  # noqa: BLE001
        _fail_safe("precheck", exc)
        return dict(base, reason="ERROR")


def release(db, token: Optional[ReleaseToken], *, force: bool = False) -> bool:
    """Undo one decision's reservations (counters and allowance), in a savepoint
    of the caller's session, only while they are still in effect: on Postgres a
    transaction-local mark set with the reservation says so exactly (gone after
    a rollback of the reservation's savepoint or transaction, and after commit);
    elsewhere the session must still be in the transaction the decision was made
    in. `force`: undo regardless (an explicit correction after commit). True when
    something was undone. Never raises."""
    if token is None or token.released:
        return False
    try:
        if not token.counters and token.allowance_take <= 0:
            token.released = True
            return False
        pg = _is_pg(db)
        if not force and not pg:
            ref = token._txn() if callable(token._txn) else None
            cur = db.get_transaction()
            if ref is None or cur is None or cur is not ref:
                token.released = True
                _count("release_txn_ended")
                return False
        now = _now()

        class _NotLive(Exception):
            pass

        def _undo(s):
            if pg and not force and not _take_token_mark(s, token.id):
                raise _NotLive()
            if token.counters and token.window_start is not None:
                _subtract_counters(s, token.institute_id, token.window_start, token.counters, now)
            if token.period_id and token.allowance_take > 0:
                _give_back_allowance(s, token.period_id, token.allowance_take)

        try:
            _savepoint(db, _undo)
        except _NotLive:
            token.released = True
            _count("release_not_live")
            return False
        token.released = True
        _count("released")
        return True
    except Exception as exc:  # noqa: BLE001
        _fail_safe("release", exc)
        return False


def _give_back_allowance(s, period_id: str, credits: Decimal) -> Decimal:
    from sqlalchemy import case, select, update

    P = PERIOD_TABLE.c
    row = s.execute(select(P.allowance_used).where(P.id == period_id).with_for_update()).first()
    if row is None:
        return _D0
    back = min(_dec(row[0]), credits)
    if back <= 0:
        return _D0
    s.execute(update(PERIOD_TABLE).where(P.id == period_id).values(
        allowance_used=case((P.allowance_used - _num_lit(back) < 0, 0), else_=P.allowance_used - _num_lit(back))))
    return back


def refund_allowance(db, period_id: Any, credits: Any) -> Decimal:
    """Give `credits` of allowance back to a period (refund of an ALLOWANCE /
    SPLIT use), floored so allowance_used never goes below 0. In a savepoint of
    the caller's session (call it BEFORE touching institute_credits: lock order).
    Returns what was given back; 0 on any problem (never raises)."""
    try:
        amt = _q4(_dec(credits))
        if not period_id or amt <= 0:
            return _D0
        back = _savepoint(db, lambda s: _give_back_allowance(s, str(period_id), amt))
        _count("allowance_refunded")
        return back
    except Exception as exc:  # noqa: BLE001
        _fail_safe("refund_allowance", exc)
        return _D0


# ----------------------------------------------------------------------------
# Tenant view helpers
# ----------------------------------------------------------------------------

def usage_snapshot(db, institute_id: Any, now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """Read-only plan state for the tenant / super-admin views: subscription,
    period, version, items (merged with overrides), allowance and the fair-use
    counters of the current period. None when there is no live subscription."""
    try:
        nowv = _utc(now) or _now()
        sub = _read(db, lambda s: _load_sub(s, str(institute_id)))
        if sub is None:
            return None
        start, end = period_window(sub.anchor_at, sub.period_months, nowv)
        row = _read(db, lambda s: _select_period(s, sub.id, start))
        period = _period_from(row) if row else None
        vid = period.plan_version_id if period else sub.plan_version_id
        terms = version_terms(db, vid, read=_read)
        if terms is None:
            return None
        version, items = terms
        merged = {}
        for fk in set(items) | set(sub.overrides):
            it = _merge_item(fk, items.get(fk), sub.overrides.get(fk))
            if it is not None:
                merged[fk] = it
        keys = [plan_counter_key(sub.id)] + [plan_counter_key(sub.id, fk) for fk in merged]
        counters = _read(db, lambda s: _read_counters(s, str(institute_id), start, keys))
        allowance = period.allowance_credits if period else version.allowance_credits
        used = period.allowance_used if period else _D0
        return {"subscription": sub, "version": version, "items": merged, "period_start": start, "period_end": end,
                "period": period, "allowance_credits": allowance, "allowance_used": used, "counters": counters}
    except Exception as exc:  # noqa: BLE001
        _fail_safe("usage_snapshot", exc)
        return None


# ----------------------------------------------------------------------------
# simulate: replay ai_usage_event history through a plan version
# ----------------------------------------------------------------------------

class _MemBackend(_Backend):
    def __init__(self, chains: Dict[str, frozenset], prices: Callable[[str], Optional[Decimal]],
                 primaries: Optional[Dict[str, frozenset]] = None) -> None:
        self.chains = chains
        self.primary_sets = primaries if primaries is not None else chains
        self.prices = prices
        self.counters: Dict[Tuple[int, str], List[Decimal]] = {}
        self.allowance: Dict[int, Decimal] = {}
        self.period_idx = 0
        self.allowance_credits = _D0

    def chain(self, feature: str) -> Set[str]:
        return set(self.chains.get(feature, frozenset()))

    def primaries(self, feature: str) -> Set[str]:
        return set(self.primary_sets.get(feature, frozenset()))

    def price(self, model: str) -> Optional[Decimal]:
        return self.prices(model)

    def caps(self, scopes: List[_Scope], add: Tuple[Decimal, Decimal, Decimal]) -> bool:
        zero = [_D0, _D0, _D0]
        if not all(_fits(sc, self.counters.get((self.period_idx, sc.key), zero), add) for sc in scopes):
            return False
        for sc in scopes:
            acc = self.counters.setdefault((self.period_idx, sc.key), [_D0, _D0, _D0])
            acc[0] += add[0]
            acc[1] += add[1]
            acc[2] += add[2]
        return True

    def take_allowance(self, want: Decimal) -> Decimal:
        used = self.allowance.get(self.period_idx, _D0)
        take = max(min(want, self.allowance_credits - used), _D0)
        self.allowance[self.period_idx] = used + take
        return take


def _feature_entry(fk: str, lk: Optional[Lookups], item: Optional[Item]) -> Dict[str, Any]:
    f = lk.features.get(fk) if lk else None
    return {"feature_key": fk, "label": f.label if f else fk, "eligibility": f.eligibility if f else None,
            "mode": item.mode if item else CHARGED, "events": 0, "list_credits": _D0, "included_credits": _D0,
            "allowance_credits": _D0, "charged_credits": _D0, "charged_today_credits": _D0, "over_cap_events": 0,
            "model_not_included_events": 0, "role_not_included_events": 0, "real_cost_usd": _D0,
            "plan_cost_usd": _D0}


def simulate(db, plan_version_id: Any, institute_id: Any, days: int = 30, *, now: Optional[datetime] = None
             ) -> Dict[str, Any]:
    """Replay the institute's last `days` of ai_usage_event rows (ONE query)
    through a plan version, as if it had been LIVE from the start of the window
    (periods anchored there; no overrides; model policy against today's default
    chains; events are not explicit picks). Per feature: list / included /
    allowance / charged credits, real cost and the plan-borne cost; totals with
    pro-rated revenue and margin in INR. Read-only."""
    from sqlalchemy import select

    from .models import EVENT_TABLE

    nowv = _utc(now) or _now()
    days = max(min(int(days or 30), 366), 1)
    start = nowv - timedelta(days=days)
    terms = version_terms(db, plan_version_id, read=_read)
    if terms is None:
        raise ValueError("plan version not found")
    version, items = terms
    lk = lookups(db, read=_read) or _read(db, _load_lookups)
    E = EVENT_TABLE.c
    rows = _read(db, lambda s: s.execute(
        select(E.occurred_at, E.use_case, E.model_id, E.actor_user_id, E.actor_role_class, E.subject_user_id,
               E.list_credits, E.refunded_credits, E.credits_charged, E.real_cost_usd, E.request_count, E.minutes,
               E.free_reason, E.tool_key)
        .where(E.institute_id == str(institute_id), E.occurred_at >= start, E.occurred_at < nowv,
               E.parent_event_id.is_(None))
        .order_by(E.occurred_at).limit(SIM_MAX_EVENTS)).all())
    def _fk(r) -> str:
        return tool_feature(r[13], lk) or lk.uc_feature.get(str(r[1] or "unknown").lower(), UNMAPPED_FEATURE)

    chains: Dict[str, frozenset] = {}
    prims: Dict[str, frozenset] = {}
    for fk in set(items) | {_fk(r) for r in rows}:
        try:
            chains[fk], prims[fk] = _chain_sets(db, fk, _read)
        except Exception:  # noqa: BLE001
            chains[fk], prims[fk] = frozenset(), frozenset()
    backend = _MemBackend(chains, lambda m: _model_price(db, m, _read), prims)
    backend.allowance_credits = version.allowance_credits
    per: Dict[str, Dict[str, Any]] = {}
    fake_sub = "simulation"
    period_starts: List[datetime] = []
    for r in rows:
        at = _utc(r[0]) or start
        idx, ps = 0, start
        while True:
            nxt = _add_months(start, (idx + 1) * version.period_months)
            if at < nxt:
                break
            idx += 1
            ps = nxt
        backend.period_idx = idx
        if not period_starts or period_starts[-1] != ps:
            period_starts.append(ps)
        fk = _fk(r)
        item = items.get(fk)
        ent = per.setdefault(fk, _feature_entry(fk, lk, item))
        lc = max(_dec(r[6]) - _dec(r[7]), _D0)
        cost = _dec_opt(r[9])
        cost = cost if cost is not None else (lc / DEFAULT_CREDITS_PER_USD)
        bundled = str(r[12] or "").upper() == "BUNDLED"
        ent["events"] += 1
        ent["list_credits"] += lc
        ent["charged_today_credits"] += max(_dec(r[8]) - _dec(r[7]), _D0)
        ent["real_cost_usd"] += cost
        if lc <= 0 or bundled:
            continue
        units = _dec(r[10]) or Decimal("1")
        req = _Req(institute_id=str(institute_id), list_credits=lc, feature=fk, model=r[2], explicit=None,
                   role_class=role_class_of(r[4]), actor_user_id=r[3], subject_user_id=r[5], units=units,
                   cost_usd=cost)
        out = _evaluate(lk.features.get(fk), item, version, fake_sub, req, backend)
        if out.mode == INCLUDED:
            ent["included_credits"] += lc
            ent["plan_cost_usd"] += cost
        elif out.mode in (ALLOWANCE, SPLIT):
            take = min(out.take, lc)
            ent["allowance_credits"] += take
            ent["charged_credits"] += lc - take
            ent["plan_cost_usd"] += cost * take / lc
        else:
            ent["charged_credits"] += lc
            if out.reason == "OVER_CAP":
                ent["over_cap_events"] += 1
            elif out.reason == "MODEL_NOT_INCLUDED":
                ent["model_not_included_events"] += 1
            elif out.reason == "ROLE_NOT_INCLUDED":
                ent["role_not_included_events"] += 1
    rate = inr_per_usd()
    months = Decimal(days) / AVG_DAYS_PER_MONTH
    revenue_minor = (Decimal(version.price_minor) * months / Decimal(version.period_months)).quantize(Decimal("1"))
    tot_keys = ("list_credits", "included_credits", "allowance_credits", "charged_credits", "charged_today_credits",
                "real_cost_usd", "plan_cost_usd")
    totals = {k: sum((e[k] for e in per.values()), _D0) for k in tot_keys}
    totals["events"] = sum(e["events"] for e in per.values())
    totals["over_cap_events"] = sum(e["over_cap_events"] for e in per.values())
    plan_cost_inr = totals["plan_cost_usd"] * rate
    revenue_inr = revenue_minor / 100
    margin_inr = revenue_inr - plan_cost_inr
    features = sorted(per.values(), key=lambda e: (lk.features[e["feature_key"]].display_order
                                                   if e["feature_key"] in lk.features else 999, e["feature_key"]))

    def _out(e: Dict[str, Any]) -> Dict[str, Any]:
        return {k: (_num_out(v) if isinstance(v, Decimal) and "usd" not in k else
                    (float(v.quantize(Decimal("0.000001"))) if isinstance(v, Decimal) else v)) for k, v in e.items()}

    return {
        "plan_version_id": version.id, "plan_key": version.plan_key, "version_no": version.version_no,
        "institute_id": str(institute_id), "days": days, "from": start.isoformat(), "to": nowv.isoformat(),
        "periods": len(period_starts) or 1, "price_minor": version.price_minor,
        "revenue_minor": int(revenue_minor), "inr_per_usd": float(rate),
        "allowance_credits_per_period": _num_out(version.allowance_credits),
        "truncated": len(rows) >= SIM_MAX_EVENTS,
        "features": [_out(e) for e in features],
        "totals": dict(_out(totals), plan_cost_inr=float(plan_cost_inr.quantize(Decimal("0.01"))),
                       revenue_inr=float(revenue_inr), margin_inr=float(margin_inr.quantize(Decimal("0.01"))),
                       margin_pct=(float((margin_inr / revenue_inr * 100).quantize(Decimal("0.1")))
                                   if revenue_inr > 0 else None),
                       wallet_saving_credits=_num_out(totals["charged_today_credits"] - totals["charged_credits"])),
    }


# ----------------------------------------------------------------------------
# pnl: per subscription period, revenue vs real cost (ONE events query)
# ----------------------------------------------------------------------------

def pnl(db, institute_id: Any = None, period: str = "current", *, now: Optional[datetime] = None
        ) -> List[Dict[str, Any]]:
    """One row per subscription period: price, payment status, included list
    credits and their real cost, allowance used, wallet-charged credits, total
    real cost, and margin in INR (billing.inr_per_usd). `period`: 'current' (the
    period containing now), 'previous' (each subscription's latest ended period)
    or 'all'. For SHADOW subscriptions the plan-borne numbers come from
    shadow_billing_mode (what LIVE would have done); `basis` says which.

    Cost: real_cost_usd where the event has one, else the same estimate
    simulate() uses (list_credits net of refunds / DEFAULT_CREDITS_PER_USD); most
    events carry no real cost yet, so `cost_estimated_events` (plan-borne
    events without a real cost) and `cost_basis` (REAL / ESTIMATED / MIXED)
    say how much of the plan cost is an estimate. charged_credits = the wallet
    part only: credits_charged minus the WALLET part of refunds (an INCLUDED /
    ALLOWANCE event's refunded_credits and a SPLIT event's allowance refund
    are plan parts given back, not wallet money)."""
    from sqlalchemy import and_, case, func, select

    from .models import EVENT_TABLE

    nowv = _utc(now) or _now()
    which = str(period or "current").lower()
    P, S, V, PL = PERIOD_TABLE.c, SUBSCRIPTION_TABLE.c, VERSION_TABLE.c, PLAN_TABLE.c

    def _periods(s):
        q = (select(P.id, P.subscription_id, P.period_start, P.period_end, P.plan_version_id,
                    P.price_minor_snapshot, P.allowance_credits, P.allowance_used, P.payment_status,
                    S.institute_id, S.enforcement, S.status, PL.plan_key, PL.name.label("plan_name"), V.version_no)
             .select_from(PERIOD_TABLE.join(SUBSCRIPTION_TABLE, S.id == P.subscription_id)
                          .outerjoin(VERSION_TABLE, V.id == P.plan_version_id)
                          .outerjoin(PLAN_TABLE, PL.id == V.plan_id)))
        if institute_id:
            q = q.where(S.institute_id == str(institute_id))
        if which == "current":
            q = q.where(P.period_start <= nowv, P.period_end > nowv)
        elif which == "previous":
            q = q.where(P.period_end <= nowv)
        return [dict(r) for r in s.execute(q.order_by(P.period_start)).mappings().all()]

    rows = _read(db, _periods)
    if which == "previous":
        latest: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            k = str(r["subscription_id"])
            if k not in latest or _utc(r["period_start"]) > _utc(latest[k]["period_start"]):
                latest[k] = r
        rows = list(latest.values())
    if not rows:
        return []
    E = EVENT_TABLE.c
    ids = [str(r["id"]) for r in rows]
    lc = E.list_credits
    net_lc = case((lc - E.refunded_credits > 0, lc - E.refunded_credits), else_=0)   # as simulate: net of refunds
    cost = func.coalesce(E.real_cost_usd, net_lc / _num_lit(DEFAULT_CREDITS_PER_USD))
    alloc_part = case((lc > 0, (lc - E.credits_charged) / lc), else_=0)
    split_alw_refunded = func.coalesce(E.context["allowance_refunded"].as_float(), 0)
    split_wallet_refunded = E.refunded_credits - split_alw_refunded
    wallet_refunded = case(
        (E.billing_mode.in_([INCLUDED, ALLOWANCE]), 0),
        (E.billing_mode == SPLIT, case((split_wallet_refunded < 0, 0), else_=split_wallet_refunded)),
        else_=E.refunded_credits)
    no_real = E.real_cost_usd.is_(None)

    def _sum(expr):
        return func.coalesce(func.sum(expr), 0)

    def _agg(s):
        q = (select(P.id,
                    func.count(E.id).label("events"),
                    _sum(case((E.billing_mode == INCLUDED, lc), else_=0)).label("included_list_credits"),
                    _sum(case((E.billing_mode == INCLUDED, cost), else_=0)).label("included_cost_usd"),
                    _sum(case((E.billing_mode == ALLOWANCE, cost), (E.billing_mode == SPLIT, cost * alloc_part),
                              else_=0)).label("allowance_cost_usd"),
                    _sum(E.credits_charged - wallet_refunded).label("charged_credits"),
                    _sum(cost).label("real_cost_usd_total"),
                    _sum(case((and_(E.billing_mode.in_([INCLUDED, ALLOWANCE, SPLIT]), no_real), 1), else_=0))
                    .label("est_events"),
                    _sum(case((E.billing_mode.in_([INCLUDED, ALLOWANCE, SPLIT]), 1), else_=0)).label("plan_events"),
                    _sum(case((and_(E.shadow_billing_mode.in_([INCLUDED, ALLOWANCE, SPLIT]), no_real), 1), else_=0))
                    .label("shadow_est_events"),
                    _sum(case((E.shadow_billing_mode.in_([INCLUDED, ALLOWANCE, SPLIT]), 1), else_=0))
                    .label("shadow_plan_events"),
                    _sum(case((E.shadow_billing_mode == INCLUDED, lc), else_=0)).label("shadow_included_list_credits"),
                    _sum(case((E.shadow_billing_mode == INCLUDED, cost), else_=0)).label("shadow_included_cost_usd"),
                    _sum(case((E.shadow_billing_mode.in_([ALLOWANCE, SPLIT]), lc), else_=0))
                    .label("shadow_allowance_credits"),
                    _sum(case((E.shadow_billing_mode.in_([ALLOWANCE, SPLIT]), cost), else_=0))
                    .label("shadow_allowance_cost_usd"))
             .select_from(PERIOD_TABLE.join(SUBSCRIPTION_TABLE, S.id == P.subscription_id)
                          .outerjoin(EVENT_TABLE, and_(E.institute_id == S.institute_id,
                                                       E.occurred_at >= P.period_start, E.occurred_at < P.period_end,
                                                       E.parent_event_id.is_(None))))
             .where(P.id.in_(ids)).group_by(P.id))
        return {str(r["id"]): dict(r) for r in s.execute(q).mappings().all()}

    agg = _read(db, _agg)
    rate = inr_per_usd()
    out = []
    for r in rows:
        a = agg.get(str(r["id"]), {})
        live = _upper(r.get("enforcement")) == "LIVE"
        inc_cost = _dec(a.get("included_cost_usd" if live else "shadow_included_cost_usd"))
        if live:
            alw_cost = _dec(a.get("allowance_cost_usd"))
            allowance_used = _dec(r.get("allowance_used"))
        else:
            allowance_used = min(_dec(a.get("shadow_allowance_credits")), _dec(r.get("allowance_credits")))
            sac = _dec(a.get("shadow_allowance_credits"))
            alw_cost = _dec(a.get("shadow_allowance_cost_usd")) * (allowance_used / sac if sac > 0 else _D0)
        price_inr = Decimal(_int(r.get("price_minor_snapshot"), 0)) / 100
        plan_cost_inr = (inc_cost + alw_cost) * rate
        est_n = int(a.get("est_events" if live else "shadow_est_events") or 0)
        plan_n = int(a.get("plan_events" if live else "shadow_plan_events") or 0)
        cost_basis = "REAL" if est_n == 0 else ("ESTIMATED" if est_n >= plan_n else "MIXED")
        margin = price_inr - plan_cost_inr
        out.append({
            "institute_id": r.get("institute_id"), "subscription_id": str(r["subscription_id"]),
            "period_id": str(r["id"]), "plan_key": r.get("plan_key"), "plan_name": r.get("plan_name"),
            "version_no": r.get("version_no"), "enforcement": _upper(r.get("enforcement")),
            "status": _upper(r.get("status")), "basis": "LIVE" if live else "SHADOW",
            "period_start": _utc(r["period_start"]).isoformat(), "period_end": _utc(r["period_end"]).isoformat(),
            "price_minor": _int(r.get("price_minor_snapshot"), 0), "payment_status": _upper(r.get("payment_status")),
            "events": int(a.get("events") or 0),
            "included_list_credits": _num_out(_dec(a.get("included_list_credits" if live
                                                         else "shadow_included_list_credits"))),
            "included_cost_usd": float(inc_cost.quantize(Decimal("0.000001"))),
            "allowance_credits": _num_out(_dec(r.get("allowance_credits"))),
            "allowance_used": _num_out(allowance_used),
            "allowance_cost_usd": float(alw_cost.quantize(Decimal("0.000001"))),
            "charged_credits": _num_out(_dec(a.get("charged_credits"))),
            "real_cost_usd_total": float(_dec(a.get("real_cost_usd_total")).quantize(Decimal("0.000001"))),
            "plan_borne_events": plan_n,
            "cost_estimated_events": est_n,
            "cost_basis": cost_basis,
            "plan_cost_inr": float(plan_cost_inr.quantize(Decimal("0.01"))),
            "margin_inr": float(margin.quantize(Decimal("0.01"))),
            "margin_pct": float((margin / price_inr * 100).quantize(Decimal("0.1"))) if price_inr > 0 else None,
            "inr_per_usd": float(rate),
        })
    return out


__all__ = [
    "PlanDecision", "ReleaseToken", "Sub", "Period", "Version", "Item", "Feature", "Lookups",
    "plans_enabled", "payments_enabled", "inr_per_usd", "has_live_subscription", "had_subscription", "refresh_index", "configure", "invalidate",
    "set_index_for_tests", "reset_for_tests", "live_subscription", "current_period", "period_window",
    "version_terms", "lookups", "feature_for", "role_class_of", "decide", "precheck", "release",
    "default_chain_models",
    "refund_allowance", "usage_snapshot", "simulate", "pnl", "stats",
    "CHARGED", "INCLUDED", "ALLOWANCE", "SPLIT",
]
