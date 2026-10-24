"""
Super Admin — AI subscription plans (/super-admin/v1/plans/**), contract P-API.

  Feature catalogue (ai_billing_feature)
    GET    /features                          every feature, the use cases mapped to it, unmapped 7-day spend
    PATCH  /features/{key}                    label, description, display_order, eligibility, is_active
                                              (a locked row needs unlock_reason; ai_calling / telephony
                                              can never leave ALWAYS_CHARGED)
  Plans and versions (ai_plan, ai_plan_version, ai_plan_item)
    GET    /plans                             plans, their versions and live subscriber counts
    POST   /plans                             {plan_key, name, description}
    GET    /plans/{id|plan_key}               the plan with every version and its items
    POST   /plans/{id}/versions               a new DRAFT (copy_from_version_id, else the latest version)
    PATCH  /versions/{vid}                    DRAFT only: the commercial terms
    PUT    /versions/{vid}/items              DRAFT only: the full item list, checked against eligibility
    POST   /versions/{vid}/publish            DRAFT -> PUBLISHED (frozen; returns the diff)
    POST   /versions/{vid}/retire             PUBLISHED -> RETIRED (no new subscriptions)
  Subscriptions (institute_ai_subscription, ai_subscription_period/override/event)
    GET    /subscriptions?institute_id=&status=&plan_id=&enforcement=
    POST   /subscriptions                     assign a PUBLISHED version (SHADOW by default)
    GET    /subscriptions/{id}                with periods, active overrides and fair-use counters
    PATCH  /subscriptions/{id}                enforcement, auto_renew, cancel_at_period_end,
                                              pending_plan_version_id, end_at, grace_days, price_override_minor
    POST   /subscriptions/{id}/cancel         {reason, immediate}
    GET    /subscriptions/{id}/overrides      POST same (replaces the feature's active override)
    DELETE /subscriptions/{id}/overrides/{oid}?reason=
    GET    /subscriptions/{id}/events
  Pricing tools (services/metering/plans.py)
    POST   /simulate                          {plan_version_id, institute_id, days}
    GET    /pnl?institute_id=&period=current|previous
  Paid plans + storefront (V590; routers/plans_billing_internal.py holds the money logic)
    POST   /subscriptions  source=PAYMENT     a PENDING subscription + its DUE first charge (needs
                                              billing.subscriptions.payments.enabled); admin_core's
                                              billing job sends the payment link (send_link)
    GET    /subscriptions/{id}/billing        periods, charges, mandates and the billing events
    POST   /subscriptions/{id}/charges/{cid}/send-link   queue a (new) payment link for an unpaid charge
    PATCH  /plans/{id}/listing                listed, tagline, highlights, badge, sort_order, audience_mode
                                              (brand words refused: tenant copy is white-label)
    GET|PUT /plans/{id}/audience              institutes / segments a plan is offered to
    GET|PUT /storefront/audience              institutes / segments the plans page is open to
    PUT    /storefront/segments/{segment}     the institutes in a segment
    GET    /storefront/institutes, PUT /storefront/institutes/{iid}   per-institute switch + brand mode
    GET    /storefront/preview?institute_id=  what the institute would see

Platform staff only (SUPER_ADMIN_USER_IDS, fail closed) as a ROUTER-level
dependency. The actor always comes from the token. EVERY write needs a
non-blank `reason` (422 otherwise; a locked feature's unlock_reason counts).
Subscription writes record an ai_subscription_event row (from/to state, actor,
reason) in the same transaction; catalogue and plan writes record
ai_model_change_log rows (an INFO log while that table is missing). Switching
renewal off (auto_renew false / cancel at period end) first opens the current
period's row of a renewing subscription, so that period is never lost.

Nothing here changes what anybody is charged while billing.plans.enabled is
false, and a SHADOW subscription never changes a charge either: the engine
(services/metering/plans.py) only reads these rows. While V588 is not applied,
reads answer empty and writes 503.

Shared helpers (tables_ready, period arithmetic, sub_event, ...) are reused by
routers/credits_plan.py (tenant view) and routers/plans_internal.py (roll job).
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from ..core.security import get_current_user
from ..db import db_dependency
from ..schemas.auth import CustomUserDetails
from ..services.metering.billing_models import DEFAULT_SUBSCRIPTION_SAC_CODE
from . import credits_limits as cl
from .super_admin import _require_super_admin

logger = logging.getLogger(__name__)

UTC = timezone.utc

PLANS_ENABLED_SETTING = "billing.plans.enabled"
INR_PER_USD_SETTING = "billing.inr_per_usd"

ELIGIBILITIES = ("INCLUDABLE", "ALLOWANCE_ONLY", "ALWAYS_CHARGED")
ITEM_MODES = ("INCLUDED", "ALLOWANCE", "CHARGED")
MODEL_POLICIES = ("ANY", "DEFAULT_CHAIN", "ALLOWLIST", "MAX_PRICE")
# BLOCK is a valid column value but this release never refuses work because of
# a plan: over cap / off-policy model always falls back to today's charge.
VIOLATION_ACTIONS = ("CHARGE",)
CAP_BASES = ("ACTOR", "SUBJECT")
GRACE_BEHAVIOURS = ("INCLUDED", "CHARGED")
ENFORCEMENTS = ("SHADOW", "LIVE")
ASSIGN_SOURCES = ("MANUAL", "COMPLIMENTARY")      # PAYMENT: see create_subscription (paid plans, V590)
LIVE_STATUSES = ("TRIAL", "ACTIVE", "GRACE")
OPEN_STATUSES = ("SCHEDULED",) + LIVE_STATUSES
TERMINAL_STATUSES = ("EXPIRED", "CANCELLED")
#: PENDING (V590): a paid plan waiting for its first payment (never live)
PENDING_STATUS = "PENDING"
#: words tenant-facing plan copy may not contain (white-label: owner decisions D1/D2)
BRAND_WORDS = ("vacademy", "vidyayatan")
SEGMENT_RE = re.compile(r"^[a-z][a-z0-9_-]{0,47}$")
HIGHLIGHTS_MAX = 6
#: Features the plan engine always charges (the voice-bot domain): never anything but ALWAYS_CHARGED.
HARD_LOCKED_FEATURES = ("ai_calling", "telephony")
ROLE_CLASSES = ("ADMIN", "TEACHER", "STAFF", "PARENT", "LEARNER", "SYSTEM", "API_KEY", "PUBLIC")
ROLE_ALIASES = {"STUDENT": "LEARNER"}

PLAN_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,47}$")
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
PERIOD_MONTHS_MAX = 36
GRACE_DAYS_MAX = 90
SIMULATE_DAYS_MAX = 90
ITEMS_MAX = 64
BACKDATE_DAYS_MAX = 366

# NUMERIC(p,s) column limits (a larger value would be a 500 from Postgres).
MAX_14_4 = Decimal("9999999999")         # NUMERIC(14,4)
MAX_14_6 = Decimal("99999999")           # NUMERIC(14,6)
MAX_12_6 = Decimal("999999")             # NUMERIC(12,6)
MAX_BIGINT_MINOR = 10 ** 13               # ₹10 bn in paise: plenty, and far below BIGINT

PLAN_TABLES = ("ai_billing_feature", "ai_plan", "ai_plan_version", "ai_plan_item", "institute_ai_subscription",
               "ai_subscription_period", "ai_subscription_override", "ai_subscription_event")

TERM_FIELDS = ("currency", "price_minor", "is_tax_inclusive", "sac_code", "period_months", "allowance_credits",
               "internal_cost_cap_usd", "grace_days", "grace_behaviour", "supersedes_version_id",
               "migrate_existing_at_renewal")
ITEM_FIELDS = ("feature_key", "mode", "model_policy", "model_allowlist", "max_output_price_per_1m",
               "on_model_violation", "roles_included", "inst_units_cap", "inst_credits_cap", "inst_cost_usd_cap",
               "user_units_cap", "user_credits_cap", "user_cap_basis", "over_cap_action", "display_cap_text")
CAP_FIELDS = ("inst_units_cap", "inst_credits_cap", "inst_cost_usd_cap", "user_units_cap", "user_credits_cap")
SUB_STATE_FIELDS = ("status", "enforcement", "plan_version_id", "pending_plan_version_id", "auto_renew",
                    "cancel_at_period_end", "end_at", "grace_days", "price_override_minor", "period_months",
                    "start_at", "anchor_at", "source")


# ── auth ────────────────────────────────────────────────────────────────────

def _staff_only(current_user: CustomUserDetails = Depends(get_current_user)) -> None:
    _require_super_admin(current_user)


router = APIRouter(
    prefix="/super-admin/v1/plans",
    tags=["Super Admin — AI subscription plans"],
    dependencies=[Depends(_staff_only)],
)


# ── shared helpers (also used by credits_plan and plans_internal) ───────────

_tables_state: Dict[str, Any] = {"ok_until": 0.0}


def tables_ready(db: Session) -> bool:
    """True once every V588 table exists (remembered 60 s once seen)."""
    now = time.monotonic()
    if now < _tables_state["ok_until"]:
        return True
    try:
        sql = "SELECT " + ", ".join(f"to_regclass('{t}') IS NOT NULL" for t in PLAN_TABLES)
        row = db.execute(text(sql)).fetchone()
        ok = bool(row) and all(bool(v) for v in row)
    except Exception:  # noqa: BLE001
        logger.warning("could not check for the AI plan tables", exc_info=True)
        _rollback(db)
        return False
    if ok:
        _tables_state["ok_until"] = now + 60.0
    return ok


def reset_for_tests() -> None:
    _tables_state["ok_until"] = 0.0


def require_tables(db: Session) -> None:
    if not tables_ready(db):
        raise HTTPException(status_code=503, detail=(
            "the AI plan tables are missing: deploy admin_core (its Flyway migration V588 creates them) first"))


def _rollback(db: Session) -> None:
    try:
        db.rollback()
    except Exception:  # noqa: BLE001
        pass


def plans_enabled() -> bool:
    """billing.plans.enabled (default false): the global switch the engine reads."""
    try:
        from ..services.metering.cache import as_bool, setting_value
        return as_bool(setting_value(PLANS_ENABLED_SETTING, False), False)
    except Exception:  # noqa: BLE001
        return False


_engine_state: Dict[str, Any] = {"retry_at": 0.0}


def get_plans_engine():
    """services/metering/plans.py, or None while it cannot be imported
    (re-tried at most once a minute)."""
    now = time.monotonic()
    if now < _engine_state["retry_at"]:
        return None
    try:
        from ..services.metering import plans as engine  # type: ignore
        return engine
    except Exception as exc:  # noqa: BLE001
        _engine_state["retry_at"] = now + 60.0
        logger.warning("AI plans engine unavailable: %s", exc)
        return None


def notify_engine(institute_id: Optional[str] = None, *, live: Optional[bool] = None) -> None:
    """After a committed subscription / plan write: the engine forgets its cached
    copies (one institute, or everything) and, with `live`, updates this
    process's live-subscription index at once (True = the institute now has a
    TRIAL/ACTIVE/GRACE subscription, False = not). Other replicas catch up within
    the engine's <= 30 s index refresh. Never raises: the change is saved either way."""
    engine = get_plans_engine()
    fn = getattr(engine, "invalidate", None) if engine is not None else None
    if not callable(fn):
        return
    try:
        if institute_id is None:
            fn()
        elif live is None:
            fn(institute_id)
        else:
            fn(institute_id, live=live)
    except TypeError:
        try:
            fn(institute_id)
        except Exception:  # noqa: BLE001
            logger.warning("plans engine invalidate(%s) failed", institute_id, exc_info=True)
    except Exception:  # noqa: BLE001
        logger.warning("plans engine invalidate(%s) failed", institute_id, exc_info=True)


def actor_of(user: Any) -> Optional[str]:
    return cl.actor_id(user)


def jsonish(value: Any) -> Any:
    return cl._jsonish(value)  # noqa: SLF001


def iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC).isoformat()
    return str(value)


def num(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def rows(db: Session, sql: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    return [dict(r._mapping) for r in db.execute(text(sql), params or {})]


def one(db: Session, sql: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    r = db.execute(text(sql), params or {}).fetchone()
    return dict(r._mapping) if r is not None else None


def sqlstate(exc: BaseException) -> Optional[str]:
    orig = getattr(exc, "orig", None)
    return getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)


def need_reason(reason: Optional[str]) -> str:
    return cl.need_reason(reason)


def valid_uuid(value: Any, what: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(status_code=404, detail=f"{what} not found")


def _upper(value: Any, allowed: Iterable[str], name: str) -> str:
    allowed = tuple(allowed)
    v = str(value or "").strip().upper()
    if v not in allowed:
        raise HTTPException(status_code=422, detail=f"{name} must be one of {', '.join(allowed)}")
    return v


def _decimal(value: Any, name: str, maximum: Decimal) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        d = Decimal(str(value))
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"{name} must be a number")
    if not d.is_finite() or d < 0:
        raise HTTPException(status_code=422, detail=f"{name} must be 0 or more")
    if d > maximum:
        raise HTTPException(status_code=422, detail=f"{name} is too large")
    return d


def _int(value: Any, name: str, lo: int, hi: int) -> int:
    try:
        v = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{name} must be a whole number")
    if isinstance(value, float) and value != v:
        raise HTTPException(status_code=422, detail=f"{name} must be a whole number")
    if v < lo or v > hi:
        raise HTTPException(status_code=422, detail=f"{name} must be between {lo} and {hi}")
    return v


def _aware(value: Optional[datetime], name: str) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    if value.year < 2020 or value.year > 2100:
        raise HTTPException(status_code=422, detail=f"{name} is out of range")
    return value.astimezone(UTC)


def commit(db: Session) -> None:
    try:
        db.commit()
    except Exception as exc:  # noqa: BLE001
        _rollback(db)
        logger.error("AI plans change commit failed: %s", exc)
        raise HTTPException(status_code=503, detail="could not save the change")


def audit(db: Session, table: str, key: str, old: Any, new: Any, reason: str, actor: Optional[str]) -> None:
    """ai_model_change_log row in the caller's transaction (fails the change if it fails)."""
    cl.log_change(db, cl.change_log_ready(db), table, key, old, new, reason, actor)


# period arithmetic ----------------------------------------------------------

def add_months(value: datetime, months: int) -> datetime:
    """Calendar months, clamped to the month's last day (Jan 31 + 1 = Feb 28/29)."""
    month0 = value.month - 1 + months
    year = value.year + month0 // 12
    month = month0 % 12 + 1
    days = [31, 29 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 28,
            31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    return value.replace(year=year, month=month, day=min(value.day, days))


def _own_window(anchor: datetime, period_months: int, at: datetime) -> Tuple[datetime, datetime]:
    pm = max(1, int(period_months or 1))
    anchor = anchor if anchor.tzinfo else anchor.replace(tzinfo=UTC)
    at = at if at.tzinfo else at.replace(tzinfo=UTC)
    if at < anchor:
        return anchor, add_months(anchor, pm)
    months = (at.year - anchor.year) * 12 + (at.month - anchor.month)
    k = max(0, months // pm - 1)
    while add_months(anchor, (k + 1) * pm) <= at:
        k += 1
    while k > 0 and add_months(anchor, k * pm) > at:
        k -= 1
    return add_months(anchor, k * pm), add_months(anchor, (k + 1) * pm)


def period_bounds(anchor: datetime, period_months: int, at: datetime) -> Tuple[datetime, datetime]:
    """[start, end) of the period containing `at`: each boundary is anchor + k *
    period_months calendar months counted from the anchor (a 31st anchor gives the
    28th / 30th in short months and the 31st again after). Before the anchor: the
    first period. The engine's period_window is the authority (period rows must
    start exactly where the engine looks for them); this module's arithmetic, the
    same rule, is used only while the engine cannot be imported."""
    engine = get_plans_engine()
    fn = getattr(engine, "period_window", None) if engine is not None else None
    if callable(fn):
        try:
            start, end = fn(anchor, period_months, at)
            return start, end
        except Exception:  # noqa: BLE001
            logger.warning("plans engine period_window failed; using the router's arithmetic", exc_info=True)
    return _own_window(anchor, period_months, at)


def ensure_period(db: Session, sub: Dict[str, Any], start: datetime, end: datetime,
                  version: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], bool]:
    """The period row (subscription, start), created if missing. psycopg 3 never
    reports a reliable rowcount for ON CONFLICT: RETURNING decides. Returns (row, created)."""
    if version is None:
        version = one(db, "SELECT price_minor, allowance_credits FROM ai_plan_version WHERE id = CAST(:v AS UUID)",
                      {"v": str(sub["plan_version_id"])}) or {}
    price = sub.get("price_override_minor")
    if price is None:
        price = version.get("price_minor") or 0
    status = "COMPLIMENTARY" if str(sub.get("source") or "").upper() == "COMPLIMENTARY" else "DUE"
    row = one(db, (
        "INSERT INTO ai_subscription_period (id, subscription_id, period_start, period_end, plan_version_id, "
        "price_minor_snapshot, allowance_credits, allowance_used, payment_status, created_at) VALUES "
        "(CAST(:id AS UUID), CAST(:s AS UUID), :ps, :pe, CAST(:v AS UUID), :price, :allow, 0, :pay, now()) "
        "ON CONFLICT (subscription_id, period_start) DO NOTHING RETURNING *"), {
        "id": str(uuid.uuid4()), "s": str(sub["id"]), "ps": start, "pe": end, "v": str(sub["plan_version_id"]),
        "price": int(price), "allow": version.get("allowance_credits") or 0, "pay": status})
    if row is not None:
        return row, True
    existing = one(db, "SELECT * FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID) "
                       "AND period_start = :ps", {"s": str(sub["id"]), "ps": start})
    return existing or {}, False


def _tz(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def open_current_period_before_renewal_stops(db: Session, sub: Dict[str, Any],
                                             now: Optional[datetime] = None) -> bool:
    """A renewing live subscription is about to stop renewing (auto_renew off /
    cancel at period end): make sure the period it is in now has its row first.
    The engine never lazily opens a later period of a non-renewing subscription
    (plans._may_open), so without this a change made before the roll job / the
    first charge of a new period would lose that (already renewed) period.
    Same version choice as the engine (the pending version at a renewal).
    Returns True when a row was created. Runs in the caller's transaction."""
    now = now or datetime.now(UTC)
    if str(sub.get("status") or "").upper() not in ("TRIAL", "ACTIVE", "GRACE"):
        return False
    if not sub.get("auto_renew") or sub.get("cancel_at_period_end"):
        return False
    start_at = _tz(sub.get("start_at"))
    end_at = _tz(sub.get("end_at"))
    if start_at is None or now < start_at or (end_at is not None and now >= end_at):
        return False
    anchor = _tz(sub.get("anchor_at")) or start_at
    ps, pe = period_bounds(anchor, int(sub.get("period_months") or 1), now)
    if ps <= start_at < pe:
        return False        # the first period: the engine always opens it
    vid = str(sub.get("pending_plan_version_id") or sub["plan_version_id"])
    version = one(db, "SELECT price_minor, allowance_credits FROM ai_plan_version WHERE id = CAST(:v AS UUID)",
                  {"v": vid}) or {}
    _row, created = ensure_period(db, {**sub, "plan_version_id": vid}, ps, pe, version)
    return created


def sub_state(sub: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not sub:
        return None
    return {k: jsonish(sub.get(k)) for k in SUB_STATE_FIELDS if k in sub}


def sub_event(db: Session, sub_id: Optional[str], institute_id: str, event_type: str,
              from_state: Any, to_state: Any, actor: Optional[str], reason: Optional[str]) -> None:
    db.execute(text(
        "INSERT INTO ai_subscription_event (id, subscription_id, institute_id, event_type, from_state, to_state, "
        "actor, reason, created_at) VALUES (CAST(:id AS UUID), CAST(:s AS UUID), :i, :t, CAST(:f AS JSONB), "
        "CAST(:to AS JSONB), :a, :r, now())"), {
        "id": str(uuid.uuid4()), "s": sub_id, "i": institute_id, "t": event_type[:32],
        "f": json.dumps(jsonish(from_state)) if from_state is not None else None,
        "to": json.dumps(jsonish(to_state)) if to_state is not None else None,
        "a": actor, "r": reason})


def xact_lock(db: Session, key: str) -> None:
    """Transaction-scoped advisory lock (released at COMMIT / ROLLBACK; safe behind pgbouncer)."""
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": key})


# ── output shapes ───────────────────────────────────────────────────────────

def brand_words(*texts: Any) -> List[str]:
    """The platform brand words found in tenant-facing text (case-insensitive)."""
    found = set()
    for t in texts:
        if t is None:
            continue
        values = t if isinstance(t, (list, tuple)) else [t]
        for v in values:
            low = str(v or "").lower()
            found |= {w for w in BRAND_WORDS if w in low}
    return sorted(found)


def feature_out(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "feature_key": r.get("feature_key"), "label": r.get("label"), "tenant_label": r.get("tenant_label"),
        "description": r.get("description"),
        "eligibility": r.get("eligibility"), "locked": bool(r.get("locked")),
        "display_order": r.get("display_order"), "is_active": bool(r.get("is_active", True)),
        "updated_by": r.get("updated_by"), "updated_at": iso(r.get("updated_at")),
    }


def item_out(r: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: r.get(k) for k in ITEM_FIELDS}
    out["id"] = str(r["id"]) if r.get("id") is not None else None
    for k in CAP_FIELDS + ("max_output_price_per_1m",):
        out[k] = num(out.get(k))
    out["model_allowlist"] = list(out.get("model_allowlist") or []) or None
    out["roles_included"] = list(out.get("roles_included") or []) or None
    return out


def version_out(r: Dict[str, Any], items: Optional[List[Dict[str, Any]]] = None,
                subscribers: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    out = {
        "id": str(r["id"]), "plan_id": str(r["plan_id"]), "version_no": r.get("version_no"),
        "status": r.get("status"), "currency": r.get("currency"),
        "price_minor": int(r["price_minor"]) if r.get("price_minor") is not None else None,
        "is_tax_inclusive": bool(r.get("is_tax_inclusive")), "sac_code": r.get("sac_code"),
        "period_months": r.get("period_months"), "allowance_credits": num(r.get("allowance_credits")),
        "internal_cost_cap_usd": num(r.get("internal_cost_cap_usd")), "grace_days": r.get("grace_days"),
        "grace_behaviour": r.get("grace_behaviour"),
        "supersedes_version_id": str(r["supersedes_version_id"]) if r.get("supersedes_version_id") else None,
        "migrate_existing_at_renewal": bool(r.get("migrate_existing_at_renewal")),
        "published_at": iso(r.get("published_at")), "published_by": r.get("published_by"),
        "created_by": r.get("created_by"), "created_at": iso(r.get("created_at")),
        "updated_at": iso(r.get("updated_at")),
    }
    if items is not None:
        out["items"] = [item_out(i) for i in items]
    if subscribers is not None:
        out["subscribers"] = {"live": subscribers.get("LIVE", 0), "shadow": subscribers.get("SHADOW", 0)}
    return out


def plan_out(r: Dict[str, Any]) -> Dict[str, Any]:
    out = {"id": str(r["id"]), "plan_key": r.get("plan_key"), "name": r.get("name"),
           "description": r.get("description"), "is_active": bool(r.get("is_active", True)),
           "created_by": r.get("created_by"), "created_at": iso(r.get("created_at")),
           "updated_at": iso(r.get("updated_at"))}
    if "listed" in r:          # V590 storefront listing (present once the migration ran)
        hl = r.get("highlights")
        if isinstance(hl, str):
            try:
                hl = json.loads(hl)
            except ValueError:
                hl = None
        out["listing"] = {"listed": bool(r.get("listed")), "tagline": r.get("tagline"),
                          "highlights": list(hl) if isinstance(hl, list) else [], "badge": r.get("badge"),
                          "sort_order": r.get("sort_order"), "audience_mode": r.get("audience_mode")}
    return out


def sub_out(r: Dict[str, Any]) -> Dict[str, Any]:
    out = {
        "id": str(r["id"]), "institute_id": r.get("institute_id"), "institute_name": r.get("institute_name"),
        "plan_version_id": str(r["plan_version_id"]), "status": r.get("status"),
        "enforcement": r.get("enforcement"), "source": r.get("source"),
        "anchor_at": iso(r.get("anchor_at")), "start_at": iso(r.get("start_at")), "end_at": iso(r.get("end_at")),
        "period_months": r.get("period_months"), "auto_renew": bool(r.get("auto_renew")),
        "grace_days": r.get("grace_days"), "cancel_at_period_end": bool(r.get("cancel_at_period_end")),
        "pending_plan_version_id": str(r["pending_plan_version_id"]) if r.get("pending_plan_version_id") else None,
        "price_override_minor": int(r["price_override_minor"]) if r.get("price_override_minor") is not None else None,
        "reason": r.get("reason"), "created_by": r.get("created_by"), "created_at": iso(r.get("created_at")),
        "updated_by": r.get("updated_by"), "updated_at": iso(r.get("updated_at")),
    }
    for k in ("plan_id", "plan_key", "plan_name", "version_no", "version_status", "price_minor",
              "allowance_credits"):
        if k in r:
            v = r.get(k)
            out[k] = str(v) if k == "plan_id" and v is not None else (num(v) if k == "allowance_credits" else v)
    if "price_minor" in out and out["price_minor"] is not None:
        out["price_minor"] = int(out["price_minor"])
    return out


def period_out(r: Dict[str, Any]) -> Dict[str, Any]:
    allow, used = num(r.get("allowance_credits")) or 0.0, num(r.get("allowance_used")) or 0.0
    return {"id": str(r["id"]), "period_start": iso(r.get("period_start")), "period_end": iso(r.get("period_end")),
            "plan_version_id": str(r["plan_version_id"]) if r.get("plan_version_id") else None,
            "price_minor_snapshot": int(r.get("price_minor_snapshot") or 0),
            "allowance_credits": allow, "allowance_used": used, "allowance_remaining": max(0.0, allow - used),
            "payment_status": r.get("payment_status"), "created_at": iso(r.get("created_at"))}


def override_out(r: Dict[str, Any]) -> Dict[str, Any]:
    out = {"id": str(r["id"]), "subscription_id": str(r["subscription_id"]), "feature_key": r.get("feature_key"),
           "mode": r.get("mode"), "reason": r.get("reason"), "created_by": r.get("created_by"),
           "created_at": iso(r.get("created_at")), "is_active": bool(r.get("is_active"))}
    for k in CAP_FIELDS:
        out[k] = num(r.get(k))
    return out


def event_out(r: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": str(r["id"]), "subscription_id": str(r["subscription_id"]) if r.get("subscription_id") else None,
            "institute_id": r.get("institute_id"), "event_type": r.get("event_type"),
            "from_state": r.get("from_state"), "to_state": r.get("to_state"), "actor": r.get("actor"),
            "reason": r.get("reason"), "created_at": iso(r.get("created_at"))}


# ── lookups ─────────────────────────────────────────────────────────────────

def features_by_key(db: Session) -> Dict[str, Dict[str, Any]]:
    return {r["feature_key"]: r for r in rows(db, "SELECT * FROM ai_billing_feature")}


def get_version(db: Session, vid: str, *, for_update: bool = False) -> Dict[str, Any]:
    vid = valid_uuid(vid, "plan version")
    r = one(db, "SELECT * FROM ai_plan_version WHERE id = CAST(:v AS UUID)" + (" FOR UPDATE" if for_update else ""),
            {"v": vid})
    if r is None:
        raise HTTPException(status_code=404, detail="plan version not found")
    return r


def version_items(db: Session, vid: str) -> List[Dict[str, Any]]:
    return rows(db, "SELECT i.* FROM ai_plan_item i LEFT JOIN ai_billing_feature f ON f.feature_key = i.feature_key "
                    "WHERE i.plan_version_id = CAST(:v AS UUID) ORDER BY COALESCE(f.display_order, 1000), "
                    "i.feature_key", {"v": str(vid)})


def get_plan(db: Session, plan_ref: str, *, for_update: bool = False) -> Dict[str, Any]:
    ref = str(plan_ref or "").strip()
    lock = " FOR UPDATE" if for_update else ""
    r = None
    try:
        r = one(db, "SELECT * FROM ai_plan WHERE id = CAST(:p AS UUID)" + lock, {"p": str(uuid.UUID(ref))})
    except ValueError:
        if PLAN_KEY_RE.match(ref):
            r = one(db, "SELECT * FROM ai_plan WHERE plan_key = :k" + lock, {"k": ref})
    if r is None:
        raise HTTPException(status_code=404, detail="plan not found")
    return r


def get_sub(db: Session, sid: str, *, for_update: bool = False) -> Dict[str, Any]:
    sid = valid_uuid(sid, "subscription")
    r = one(db, "SELECT * FROM institute_ai_subscription WHERE id = CAST(:s AS UUID)" +
            (" FOR UPDATE" if for_update else ""), {"s": sid})
    if r is None:
        raise HTTPException(status_code=404, detail="subscription not found")
    return r


def subscriber_counts(db: Session) -> Dict[str, Dict[str, int]]:
    out: Dict[str, Dict[str, int]] = {}
    for r in rows(db, "SELECT plan_version_id, enforcement, count(*) AS n FROM institute_ai_subscription "
                      "WHERE status IN ('TRIAL','ACTIVE','GRACE') GROUP BY 1, 2"):
        out.setdefault(str(r["plan_version_id"]), {})[str(r["enforcement"])] = int(r["n"])
    return out


def institute_exists(db: Session, institute_id: str) -> Optional[bool]:
    """True / False when the institutes table is readable; None when it is not."""
    try:
        if not db.execute(text("SELECT to_regclass('institutes') IS NOT NULL")).scalar():
            return None
        return db.execute(text("SELECT 1 FROM institutes WHERE id = :i"), {"i": institute_id}).first() is not None
    except Exception:  # noqa: BLE001
        _rollback(db)
        return None


def institute_names(db: Session, ids: Iterable[str]) -> Dict[str, str]:
    ids = sorted({str(i) for i in ids if i})
    if not ids:
        return {}
    try:
        if not db.execute(text("SELECT to_regclass('institutes') IS NOT NULL")).scalar():
            return {}
        return {str(r[0]): r[1] for r in db.execute(
            text("SELECT id, name FROM institutes WHERE id = ANY(CAST(:ids AS VARCHAR[]))"), {"ids": ids})}
    except Exception:  # noqa: BLE001
        _rollback(db)
        return {}


def _institute(institute_id: Any) -> str:
    iid = str(institute_id or "").strip()
    if not iid or len(iid) > 64:
        raise HTTPException(status_code=422, detail="institute_id must be 1-64 characters")
    return iid


# ── validation of plan items / overrides ───────────────────────────────────

def check_mode_allowed(feature: Dict[str, Any], mode: str) -> None:
    key = feature["feature_key"]
    elig = str(feature.get("eligibility") or "ALWAYS_CHARGED").upper()
    if mode == "CHARGED":
        return
    if key in HARD_LOCKED_FEATURES or bool(feature.get("locked")) or elig == "ALWAYS_CHARGED":
        raise HTTPException(status_code=422, detail=(
            f"{key} is always charged from the wallet: its plan mode can only be CHARGED"))
    if mode == "INCLUDED" and elig == "ALLOWANCE_ONLY":
        raise HTTPException(status_code=422, detail=(
            f"{key} can only be paid from the plan allowance (ALLOWANCE) or charged, never INCLUDED"))


def _roles(values: Optional[List[str]]) -> Optional[List[str]]:
    if not values:
        return None
    out: List[str] = []
    for v in values:
        r = str(v or "").strip().upper()
        r = ROLE_ALIASES.get(r, r)
        if r not in ROLE_CLASSES:
            raise HTTPException(status_code=422, detail=f"roles_included: {v!r} is not a role class "
                                                        f"({', '.join(ROLE_CLASSES)})")
        if r not in out:
            out.append(r)
    return out


def _caps(body: Dict[str, Any]) -> Dict[str, Optional[Decimal]]:
    return {
        "inst_units_cap": _decimal(body.get("inst_units_cap"), "inst_units_cap", MAX_14_4),
        "inst_credits_cap": _decimal(body.get("inst_credits_cap"), "inst_credits_cap", MAX_14_4),
        "inst_cost_usd_cap": _decimal(body.get("inst_cost_usd_cap"), "inst_cost_usd_cap", MAX_14_6),
        "user_units_cap": _decimal(body.get("user_units_cap"), "user_units_cap", MAX_14_4),
        "user_credits_cap": _decimal(body.get("user_credits_cap"), "user_credits_cap", MAX_14_4),
    }


def validate_item(feature: Optional[Dict[str, Any]], body: Dict[str, Any], *, key: str) -> Dict[str, Any]:
    if feature is None:
        raise HTTPException(status_code=422, detail=f"unknown feature_key {key!r}")
    if not bool(feature.get("is_active", True)):
        raise HTTPException(status_code=422, detail=f"feature {key!r} is inactive")
    mode = _upper(body.get("mode"), ITEM_MODES, f"{key}: mode")
    check_mode_allowed(feature, mode)
    policy = _upper(body.get("model_policy") or "DEFAULT_CHAIN", MODEL_POLICIES, f"{key}: model_policy")
    allowlist = [str(m).strip() for m in (body.get("model_allowlist") or []) if str(m or "").strip()]
    if len(allowlist) > 50 or any(len(m) > 255 for m in allowlist):
        raise HTTPException(status_code=422, detail=f"{key}: model_allowlist is too long")
    max_price = _decimal(body.get("max_output_price_per_1m"), f"{key}: max_output_price_per_1m", MAX_12_6)
    if policy == "ALLOWLIST" and not allowlist:
        raise HTTPException(status_code=422, detail=f"{key}: model_policy ALLOWLIST needs model_allowlist")
    if policy == "MAX_PRICE" and max_price is None:
        raise HTTPException(status_code=422, detail=f"{key}: model_policy MAX_PRICE needs max_output_price_per_1m")
    violation = str(body.get("on_model_violation") or "CHARGE").strip().upper()
    if violation not in VIOLATION_ACTIONS:
        raise HTTPException(status_code=422, detail=(
            f"{key}: on_model_violation must be CHARGE (this release never blocks work because of a plan)"))
    over = str(body.get("over_cap_action") or "CHARGE").strip().upper()
    if over not in VIOLATION_ACTIONS:
        raise HTTPException(status_code=422, detail=(
            f"{key}: over_cap_action must be CHARGE (this release never blocks work because of a plan)"))
    basis = _upper(body.get("user_cap_basis") or "ACTOR", CAP_BASES, f"{key}: user_cap_basis")
    text_ = body.get("display_cap_text")
    text_ = str(text_).strip() if text_ is not None else None
    if text_ and len(text_) > 255:
        raise HTTPException(status_code=422, detail=f"{key}: display_cap_text is longer than 255 characters")
    return {"feature_key": key, "mode": mode, "model_policy": policy,
            "model_allowlist": allowlist or None, "max_output_price_per_1m": max_price,
            "on_model_violation": violation, "roles_included": _roles(body.get("roles_included")),
            **_caps(body), "user_cap_basis": basis, "over_cap_action": over, "display_cap_text": text_ or None}


def item_problems(features: Dict[str, Dict[str, Any]], items: List[Dict[str, Any]]) -> List[str]:
    """Re-validation at publish time (eligibility may have changed since the edit)."""
    problems = []
    for it in items:
        key = it.get("feature_key")
        try:
            validate_item(features.get(key), {**it, "model_allowlist": list(it.get("model_allowlist") or []),
                                              "roles_included": list(it.get("roles_included") or [])}, key=key)
        except HTTPException as exc:
            problems.append(str(exc.detail))
    return problems


def _diff(old: Optional[Dict[str, Any]], new: Dict[str, Any], old_items: List[Dict[str, Any]],
          new_items: List[Dict[str, Any]]) -> Dict[str, Any]:
    terms = []
    if old is not None:
        for f in TERM_FIELDS:
            if f == "supersedes_version_id":
                continue
            a, b = jsonish(old.get(f)), jsonish(new.get(f))
            if a != b:
                terms.append({"field": f, "old": a, "new": b})
    o = {i["feature_key"]: item_out(i) for i in old_items}
    n = {i["feature_key"]: item_out(i) for i in new_items}
    items = []
    for k in sorted(set(o) | set(n)):
        if k not in o:
            items.append({"feature_key": k, "change": "ADDED", "new": n[k]})
        elif k not in n:
            items.append({"feature_key": k, "change": "REMOVED", "old": o[k]})
        else:
            fields = [{"field": f, "old": o[k].get(f), "new": n[k].get(f)} for f in ITEM_FIELDS
                      if f != "feature_key" and o[k].get(f) != n[k].get(f)]
            if fields:
                items.append({"feature_key": k, "change": "CHANGED", "fields": fields})
    return {"against_version_id": str(old["id"]) if old else None,
            "against_version_no": old.get("version_no") if old else None, "terms": terms, "items": items}


def _db_error(exc: DBAPIError, what: str) -> HTTPException:
    state = sqlstate(exc)
    msg = str(getattr(exc, "orig", exc)).splitlines()[0][:300]
    if state == "23505":
        return HTTPException(status_code=409, detail=f"{what}: already exists ({msg})")
    if state == "23514" and any(w in msg for w in ("frozen", "cannot move", "cannot be deleted")):
        return HTTPException(status_code=409, detail=f"{what}: {msg}")   # the V588 immutability triggers
    if state in ("23503",):
        return HTTPException(status_code=422, detail=f"{what}: references a row that does not exist")
    if state in ("23514", "22003", "22P02", "23502"):
        return HTTPException(status_code=422, detail=f"{what}: {msg}")
    if state and state.startswith("P0"):   # RAISE from the V588 immutability trigger
        return HTTPException(status_code=409, detail=f"{what}: {msg}")
    logger.error("AI plans write failed (%s): %s", state, msg)
    return HTTPException(status_code=503, detail=f"{what}: could not save the change")


# ── request bodies ──────────────────────────────────────────────────────────

class FeaturePatch(BaseModel):
    label: Optional[str] = Field(None, max_length=128)
    #: V590: what tenants see instead of label (white-label copy, brand words refused)
    tenant_label: Optional[str] = Field(None, max_length=128)
    description: Optional[str] = Field(None, max_length=4000)
    display_order: Optional[int] = Field(None, ge=0, le=100000)
    eligibility: Optional[str] = Field(None, max_length=16)
    is_active: Optional[bool] = None
    unlock_reason: Optional[str] = Field(None, max_length=2000)
    reason: Optional[str] = Field(None, max_length=2000)


class PlanCreate(BaseModel):
    plan_key: str = Field(..., max_length=48)
    name: str = Field(..., max_length=128)
    description: Optional[str] = Field(None, max_length=4000)
    reason: Optional[str] = Field(None, max_length=2000)


class VersionCreate(BaseModel):
    copy_from_version_id: Optional[str] = Field(None, max_length=64)
    copy_latest: bool = True
    reason: Optional[str] = Field(None, max_length=2000)


class VersionPatch(BaseModel):
    currency: Optional[str] = Field(None, max_length=3)
    price_minor: Optional[int] = None
    is_tax_inclusive: Optional[bool] = None
    sac_code: Optional[str] = Field(None, max_length=16)
    period_months: Optional[int] = None
    allowance_credits: Optional[float] = None
    internal_cost_cap_usd: Optional[float] = None
    grace_days: Optional[int] = None
    grace_behaviour: Optional[str] = Field(None, max_length=10)
    supersedes_version_id: Optional[str] = Field(None, max_length=64)
    migrate_existing_at_renewal: Optional[bool] = None
    reason: Optional[str] = Field(None, max_length=2000)


class ItemIn(BaseModel):
    feature_key: str = Field(..., max_length=48)
    mode: str = Field(..., max_length=10)
    model_policy: Optional[str] = Field(None, max_length=14)
    model_allowlist: Optional[List[str]] = None
    max_output_price_per_1m: Optional[float] = None
    on_model_violation: Optional[str] = Field(None, max_length=8)
    roles_included: Optional[List[str]] = None
    inst_units_cap: Optional[float] = None
    inst_credits_cap: Optional[float] = None
    inst_cost_usd_cap: Optional[float] = None
    user_units_cap: Optional[float] = None
    user_credits_cap: Optional[float] = None
    user_cap_basis: Optional[str] = Field(None, max_length=8)
    over_cap_action: Optional[str] = Field(None, max_length=8)
    display_cap_text: Optional[str] = Field(None, max_length=255)


class ItemsPut(BaseModel):
    items: List[ItemIn] = Field(default_factory=list, max_length=ITEMS_MAX)
    reason: Optional[str] = Field(None, max_length=2000)


class ReasonBody(BaseModel):
    reason: Optional[str] = Field(None, max_length=2000)


class SubscriptionCreate(BaseModel):
    institute_id: str = Field(..., max_length=64)
    plan_version_id: str = Field(..., max_length=64)
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    period_count: Optional[int] = None
    period_months: Optional[int] = None
    auto_renew: bool = True
    grace_days: Optional[int] = None
    enforcement: str = Field("SHADOW", max_length=8)
    source: str = Field("MANUAL", max_length=16)
    price_override_minor: Optional[int] = None
    reason: str = Field(..., max_length=2000)
    #: source PAYMENT: have admin_core send the payment link (its billing job picks up the DUE charge)
    send_link: bool = True


class SubscriptionPatch(BaseModel):
    enforcement: Optional[str] = Field(None, max_length=8)
    auto_renew: Optional[bool] = None
    cancel_at_period_end: Optional[bool] = None
    pending_plan_version_id: Optional[str] = Field(None, max_length=64)
    end_at: Optional[datetime] = None
    grace_days: Optional[int] = None
    price_override_minor: Optional[int] = None
    reason: str = Field(..., max_length=2000)


class CancelBody(BaseModel):
    reason: str = Field(..., max_length=2000)
    immediate: bool = False


class OverrideIn(BaseModel):
    feature_key: str = Field(..., max_length=48)
    mode: Optional[str] = Field(None, max_length=10)
    inst_units_cap: Optional[float] = None
    inst_credits_cap: Optional[float] = None
    inst_cost_usd_cap: Optional[float] = None
    user_units_cap: Optional[float] = None
    user_credits_cap: Optional[float] = None
    reason: str = Field(..., max_length=2000)


class SimulateBody(BaseModel):
    plan_version_id: str = Field(..., max_length=64)
    institute_id: str = Field(..., max_length=64)
    days: int = Field(30, ge=1, le=SIMULATE_DAYS_MAX)


# ── feature catalogue ───────────────────────────────────────────────────────

@router.get("/features", summary="The billing feature catalogue, its use-case mapping and unmapped spend")
def list_features(db: Session = Depends(db_dependency)):
    if not tables_ready(db):
        return {"features": [], "unmapped_7d": [], "plans_enabled": plans_enabled()}
    feats = rows(db, "SELECT * FROM ai_billing_feature ORDER BY display_order, feature_key")
    mapped: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows(db, "SELECT use_case, label, feature_group, billing_feature_key FROM ai_use_case_catalog "
                      "ORDER BY display_order, use_case"):
        mapped.setdefault(str(r.get("billing_feature_key") or "unmapped"), []).append(
            {"use_case": r["use_case"], "label": r.get("label"), "feature_group": r.get("feature_group")})
    out = []
    for f in feats:
        item = feature_out(f)
        item["use_cases"] = mapped.get(f["feature_key"], [])
        out.append(item)
    known = {f["feature_key"] for f in feats}
    orphans = [{"billing_feature_key": k, "use_cases": v} for k, v in mapped.items() if k not in known]
    unmapped = []
    try:
        unmapped = [{"use_case": r["use_case"], "events": int(r["n"]), "list_credits": num(r["credits"])}
                    for r in rows(db, (
                        "SELECT e.use_case, count(*) AS n, COALESCE(sum(e.list_credits), 0) AS credits "
                        "FROM ai_usage_event e LEFT JOIN ai_use_case_catalog c ON c.use_case = e.use_case "
                        "WHERE e.occurred_at > now() - interval '7 days' "
                        "AND (c.use_case IS NULL OR c.billing_feature_key IS NULL OR c.billing_feature_key = 'unmapped') "
                        "GROUP BY 1 ORDER BY 3 DESC LIMIT 50"))]
    except Exception:  # noqa: BLE001
        logger.warning("unmapped spend query failed", exc_info=True)
        _rollback(db)
    return {"features": out, "unknown_feature_keys": orphans, "unmapped_7d": unmapped,
            "plans_enabled": plans_enabled()}


@router.patch("/features/{feature_key}", summary="Edit a billing feature (locked rows need unlock_reason)")
def patch_feature(feature_key: str, body: FeaturePatch, db: Session = Depends(db_dependency),
                  current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    actor = actor_of(current_user)
    changes = body.model_dump(exclude_unset=True, exclude={"reason", "unlock_reason"})
    changes = {k: v for k, v in changes.items() if v is not None}
    if not changes:
        raise HTTPException(status_code=422, detail="nothing to change")
    if "label" in changes:
        changes["label"] = str(changes["label"]).strip()
        if not changes["label"]:
            raise HTTPException(status_code=422, detail="label cannot be empty")
    if "eligibility" in changes:
        changes["eligibility"] = _upper(changes["eligibility"], ELIGIBILITIES, "eligibility")
    if "tenant_label" in changes:
        from . import plans_billing_internal as pb
        if not pb.has_column(db, "ai_billing_feature", "tenant_label"):
            raise HTTPException(status_code=503, detail="tenant_label needs admin_core's Flyway V590 first")
        changes["tenant_label"] = str(changes["tenant_label"]).strip() or None
        if brand_words(changes["tenant_label"]):
            raise HTTPException(status_code=422, detail="tenant_label is shown to institutes: no platform brand words")
    row = one(db, "SELECT * FROM ai_billing_feature WHERE feature_key = :k FOR UPDATE", {"k": feature_key})
    if row is None:
        _rollback(db)
        raise HTTPException(status_code=404, detail="feature not found")
    unlock = (body.unlock_reason or "").strip()
    if bool(row.get("locked")) and not unlock:
        _rollback(db)
        raise HTTPException(status_code=409, detail=(
            f"{feature_key} is locked: send unlock_reason to change it (the change is logged)"))
    if feature_key in HARD_LOCKED_FEATURES and changes.get("eligibility", "ALWAYS_CHARGED") != "ALWAYS_CHARGED":
        _rollback(db)
        raise HTTPException(status_code=409, detail=(
            f"{feature_key} is always charged (voice-bot billing is outside AI plans): eligibility stays ALWAYS_CHARGED"))
    if feature_key in HARD_LOCKED_FEATURES and changes.get("is_active") is False:
        _rollback(db)
        raise HTTPException(status_code=409, detail=f"{feature_key} cannot be deactivated")
    reason = (body.reason or "").strip() or unlock
    if not reason:
        _rollback(db)
        need_reason(None)            # 422: every catalogue change says why
    if unlock and unlock not in reason:
        reason = f"{reason} (unlock: {unlock})"
    sets = ", ".join(f"{k} = :{k}" for k in changes)
    try:
        new = one(db, f"UPDATE ai_billing_feature SET {sets}, updated_by = :actor, updated_at = now() "
                      "WHERE feature_key = :key RETURNING *", {**changes, "actor": actor, "key": feature_key})
        audit(db, "ai_billing_feature", feature_key, feature_out(row), feature_out(new or {}), reason, actor)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "feature")
    affected = 0
    if "eligibility" in changes and changes["eligibility"] != row.get("eligibility"):
        bad = ("INCLUDED", "ALLOWANCE") if changes["eligibility"] == "ALWAYS_CHARGED" else (
            ("INCLUDED",) if changes["eligibility"] == "ALLOWANCE_ONLY" else ())
        if bad:
            affected = int(db.execute(text(
                "SELECT count(*) FROM ai_plan_item i JOIN ai_plan_version v ON v.id = i.plan_version_id "
                "WHERE i.feature_key = :k AND v.status = 'PUBLISHED' AND i.mode = ANY(CAST(:m AS VARCHAR[]))"),
                {"k": feature_key, "m": list(bad)}).scalar() or 0)
    commit(db)
    notify_engine()
    if unlock:
        logger.warning("AI billing feature %s (locked) changed by %s: %s", feature_key, actor, unlock)
    out = feature_out(new or {})
    out["published_items_now_charged"] = affected
    return out


# ── plans and versions ──────────────────────────────────────────────────────

@router.get("/plans", summary="Plans, their versions and live / shadow subscriber counts")
def list_plans(include_inactive: bool = Query(True), db: Session = Depends(db_dependency)):
    if not tables_ready(db):
        return {"plans": [], "plans_enabled": plans_enabled()}
    plans = rows(db, "SELECT * FROM ai_plan" + ("" if include_inactive else " WHERE is_active") +
                 " ORDER BY created_at, plan_key")
    versions = rows(db, "SELECT v.*, (SELECT count(*) FROM ai_plan_item i WHERE i.plan_version_id = v.id) AS n_items, "
                        "(SELECT count(*) FROM ai_plan_item i WHERE i.plan_version_id = v.id AND i.mode = 'INCLUDED') "
                        "AS n_included FROM ai_plan_version v ORDER BY v.plan_id, v.version_no")
    subs = subscriber_counts(db)
    by_plan: Dict[str, List[Dict[str, Any]]] = {}
    for v in versions:
        vo = version_out(v, subscribers=subs.get(str(v["id"]), {}))
        vo["item_count"] = int(v.get("n_items") or 0)
        vo["included_count"] = int(v.get("n_included") or 0)
        by_plan.setdefault(str(v["plan_id"]), []).append(vo)
    out = []
    for p in plans:
        po = plan_out(p)
        vs = by_plan.get(str(p["id"]), [])
        po["versions"] = vs
        published = [v for v in vs if v["status"] == "PUBLISHED"]
        po["live_version"] = published[-1] if published else None
        po["subscribers"] = {"live": sum(v["subscribers"]["live"] for v in vs),
                             "shadow": sum(v["subscribers"]["shadow"] for v in vs)}
        out.append(po)
    return {"plans": out, "plans_enabled": plans_enabled()}


@router.post("/plans", summary="Create a plan (add a DRAFT version next)")
def create_plan(body: PlanCreate, db: Session = Depends(db_dependency),
                current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    key = str(body.plan_key or "").strip()
    if not PLAN_KEY_RE.match(key):
        raise HTTPException(status_code=422, detail="plan_key must be 2-48 characters: a-z, 0-9 and _, starting with a letter")
    name = str(body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")
    reason = need_reason(body.reason)
    actor = actor_of(current_user)
    try:
        row = one(db, "INSERT INTO ai_plan (id, plan_key, name, description, is_active, created_by, created_at, "
                      "updated_at) VALUES (CAST(:id AS UUID), :k, :n, :d, true, :a, now(), now()) "
                      "ON CONFLICT (plan_key) DO NOTHING RETURNING *",
                  {"id": str(uuid.uuid4()), "k": key, "n": name, "d": body.description, "a": actor})
        if row is None:
            _rollback(db)
            raise HTTPException(status_code=409, detail=f"a plan with plan_key {key!r} already exists")
        audit(db, "ai_plan", key, None, plan_out(row), reason, actor)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "plan")
    commit(db)
    return {**plan_out(row), "versions": []}


@router.get("/plans/{plan_ref}", summary="A plan (by id or plan_key) with every version and its items")
def get_plan_detail(plan_ref: str, db: Session = Depends(db_dependency)):
    require_tables(db)
    plan = get_plan(db, plan_ref)
    subs = subscriber_counts(db)
    versions = rows(db, "SELECT * FROM ai_plan_version WHERE plan_id = CAST(:p AS UUID) ORDER BY version_no",
                    {"p": str(plan["id"])})
    out = plan_out(plan)
    out["versions"] = [version_out(v, version_items(db, str(v["id"])), subs.get(str(v["id"]), {}))
                       for v in versions]
    out["plans_enabled"] = plans_enabled()
    return out


def _copy_terms(src: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not src:
        return {}
    return {k: src.get(k) for k in TERM_FIELDS if k != "supersedes_version_id"}


@router.post("/plans/{plan_ref}/versions", summary="A new DRAFT version (copied from a version, or blank)")
def create_version(plan_ref: str, body: VersionCreate, db: Session = Depends(db_dependency),
                   current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    reason = need_reason(body.reason)
    actor = actor_of(current_user)
    plan = get_plan(db, plan_ref, for_update=True)     # serialises version_no per plan
    pid = str(plan["id"])
    src = None
    if body.copy_from_version_id:
        src = get_version(db, body.copy_from_version_id)
    elif body.copy_latest:
        src = one(db, "SELECT * FROM ai_plan_version WHERE plan_id = CAST(:p AS UUID) ORDER BY version_no DESC "
                      "LIMIT 1", {"p": pid})
    latest_pub = one(db, "SELECT id FROM ai_plan_version WHERE plan_id = CAST(:p AS UUID) AND status = 'PUBLISHED' "
                         "ORDER BY version_no DESC LIMIT 1", {"p": pid})
    no = int(db.execute(text("SELECT COALESCE(max(version_no), 0) + 1 FROM ai_plan_version "
                             "WHERE plan_id = CAST(:p AS UUID)"), {"p": pid}).scalar() or 1)
    terms = _copy_terms(src)
    # Owner default (2026-10-16): every NEW version carries SAC 998315, also when copied from a
    # version that had another code (V588 seeded 998313); a DRAFT can still be PATCHed to another.
    terms["sac_code"] = DEFAULT_SUBSCRIPTION_SAC_CODE
    vid = str(uuid.uuid4())
    cols = ["id", "plan_id", "version_no", "status", "supersedes_version_id", "created_by", "created_at",
            "updated_at"] + list(terms)
    vals = ["CAST(:id AS UUID)", "CAST(:plan_id AS UUID)", ":version_no", "'DRAFT'", "CAST(:sup AS UUID)", ":actor",
            "now()", "now()"] + [f":{k}" for k in terms]
    try:
        row = one(db, f"INSERT INTO ai_plan_version ({', '.join(cols)}) VALUES ({', '.join(vals)}) RETURNING *",
                  {"id": vid, "plan_id": pid, "version_no": no, "actor": actor,
                   "sup": str(latest_pub["id"]) if latest_pub else None, **terms})
        copied = 0
        if src is not None:
            copied = len(db.execute(text(
                f"INSERT INTO ai_plan_item (id, plan_version_id, {', '.join(ITEM_FIELDS)}) "
                f"SELECT gen_random_uuid(), CAST(:v AS UUID), {', '.join(ITEM_FIELDS)} FROM ai_plan_item "
                "WHERE plan_version_id = CAST(:src AS UUID) RETURNING id"), {"v": vid, "src": str(src["id"])}).fetchall())
        audit(db, "ai_plan_version", f"{plan['plan_key']}@{no}", None,
              {"version_id": vid, "copied_from": str(src["id"]) if src else None, "items": copied},
              reason, actor)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "plan version")
    commit(db)
    return version_out(row, version_items(db, vid))


@router.patch("/versions/{vid}", summary="Edit a DRAFT version's commercial terms (409 once published)")
def patch_version(vid: str, body: VersionPatch, db: Session = Depends(db_dependency),
                  current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    actor = actor_of(current_user)
    given = body.model_fields_set - {"reason"}
    if not given:
        raise HTTPException(status_code=422, detail="nothing to change")
    reason = need_reason(body.reason)
    v = get_version(db, vid, for_update=True)
    if v["status"] != "DRAFT":
        _rollback(db)
        raise HTTPException(status_code=409, detail=f"version {v['version_no']} is {v['status']}: only a DRAFT can be "
                                                    "edited (create a new version)")
    raw = body.model_dump()
    ch: Dict[str, Any] = {}
    nullable = {"internal_cost_cap_usd", "sac_code", "supersedes_version_id"}
    for f in given:
        val = raw.get(f)
        if val is None and f not in nullable:
            raise HTTPException(status_code=422, detail=f"{f} cannot be empty")
        if f == "currency":
            val = str(val).strip().upper()
            if not CURRENCY_RE.match(val):
                raise HTTPException(status_code=422, detail="currency must be a 3-letter code such as INR")
        elif f == "price_minor":
            val = _int(val, "price_minor", 0, MAX_BIGINT_MINOR)
        elif f == "period_months":
            val = _int(val, "period_months", 1, PERIOD_MONTHS_MAX)
        elif f == "grace_days":
            val = _int(val, "grace_days", 0, GRACE_DAYS_MAX)
        elif f == "allowance_credits":
            val = _decimal(val, "allowance_credits", MAX_14_4)
        elif f == "internal_cost_cap_usd":
            val = _decimal(val, "internal_cost_cap_usd", MAX_14_4)
        elif f == "grace_behaviour":
            val = _upper(val, GRACE_BEHAVIOURS, "grace_behaviour")
        elif f == "sac_code":
            val = (str(val).strip() or None) if val is not None else None
        elif f == "supersedes_version_id" and val is not None:
            sup = get_version(db, val)
            if str(sup["id"]) == str(v["id"]):
                raise HTTPException(status_code=422, detail="a version cannot supersede itself")
            val = str(sup["id"])
        ch[f] = val
    sets = ", ".join((f"{k} = CAST(:{k} AS UUID)" if k == "supersedes_version_id" else f"{k} = :{k}") for k in ch)
    try:
        new = one(db, f"UPDATE ai_plan_version SET {sets}, updated_at = now() WHERE id = CAST(:vid AS UUID) "
                      "AND status = 'DRAFT' RETURNING *", {**ch, "vid": str(v["id"])})
        if new is None:
            _rollback(db)
            raise HTTPException(status_code=409, detail="only a DRAFT version can be edited")
        audit(db, "ai_plan_version", str(v["id"]), {k: v.get(k) for k in ch}, ch,
              reason, actor)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "plan version")
    commit(db)
    return version_out(new, version_items(db, str(v["id"])))


@router.put("/versions/{vid}/items", summary="Replace a DRAFT version's items (checked against feature eligibility)")
def put_items(vid: str, body: ItemsPut, db: Session = Depends(db_dependency),
              current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    reason = need_reason(body.reason)
    actor = actor_of(current_user)
    feats = features_by_key(db)
    seen = set()
    clean = []
    for it in body.items:
        key = str(it.feature_key or "").strip()
        if key in seen:
            raise HTTPException(status_code=422, detail=f"feature {key!r} is listed twice")
        seen.add(key)
        clean.append(validate_item(feats.get(key), it.model_dump(), key=key))
    v = get_version(db, vid, for_update=True)
    if v["status"] != "DRAFT":
        _rollback(db)
        raise HTTPException(status_code=409, detail=f"version {v['version_no']} is {v['status']}: its items are frozen")
    old = version_items(db, str(v["id"]))
    try:
        db.execute(text("DELETE FROM ai_plan_item WHERE plan_version_id = CAST(:v AS UUID)"), {"v": str(v["id"])})
        for c in clean:
            db.execute(text(
                f"INSERT INTO ai_plan_item (id, plan_version_id, {', '.join(ITEM_FIELDS)}) VALUES "
                "(CAST(:id AS UUID), CAST(:v AS UUID), :feature_key, :mode, :model_policy, CAST(:model_allowlist AS TEXT[]), "
                ":max_output_price_per_1m, :on_model_violation, CAST(:roles_included AS TEXT[]), :inst_units_cap, "
                ":inst_credits_cap, :inst_cost_usd_cap, :user_units_cap, :user_credits_cap, :user_cap_basis, "
                ":over_cap_action, :display_cap_text)"), {**c, "id": str(uuid.uuid4()), "v": str(v["id"])})
        db.execute(text("UPDATE ai_plan_version SET updated_at = now() WHERE id = CAST(:v AS UUID)"),
                   {"v": str(v["id"])})
        audit(db, "ai_plan_item", str(v["id"]), [item_out(i) for i in old], [jsonish(c) for c in clean],
              reason, actor)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "plan items")
    commit(db)
    return version_out(get_version(db, str(v["id"])), version_items(db, str(v["id"])))


def _schedule_migration(db: Session, version: Dict[str, Any], actor: Optional[str], reason: str) -> int:
    """migrate_existing_at_renewal: every open subscription on the superseded
    version without a pending change gets this version as its
    pending_plan_version_id, so the engine (which opens a renewed period on the
    pending version) and the roll job (which applies it) agree. Returns how many."""
    sup = version.get("supersedes_version_id")
    if not version.get("migrate_existing_at_renewal") or not sup:
        return 0
    moved = rows(db, (
        "UPDATE institute_ai_subscription SET pending_plan_version_id = CAST(:new AS UUID), updated_by = :a, "
        "updated_at = now() WHERE plan_version_id = CAST(:old AS UUID) AND pending_plan_version_id IS NULL "
        "AND status IN ('SCHEDULED','TRIAL','ACTIVE','GRACE') RETURNING id, institute_id"),
        {"new": str(version["id"]), "old": str(sup), "a": actor})
    for r in moved:
        sub_event(db, str(r["id"]), r["institute_id"], "PLAN_CHANGE_SCHEDULED", {"pending_plan_version_id": None},
                  {"pending_plan_version_id": str(version["id"])}, actor,
                  f"{reason} (migrate_existing_at_renewal from version {sup})")
    return len(moved)


@router.post("/versions/{vid}/publish", summary="Publish a DRAFT version (frozen afterwards)")
def publish_version(vid: str, body: ReasonBody, db: Session = Depends(db_dependency),
                    current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    why = need_reason(body.reason)
    actor = actor_of(current_user)
    v = get_version(db, vid, for_update=True)
    if v["status"] != "DRAFT":
        _rollback(db)
        raise HTTPException(status_code=409, detail=f"version {v['version_no']} is already {v['status']}")
    items = version_items(db, str(v["id"]))
    if not items:
        _rollback(db)
        raise HTTPException(status_code=422, detail="a version needs at least one item before it is published")
    problems = item_problems(features_by_key(db), items)
    if problems:
        _rollback(db)
        raise HTTPException(status_code=422, detail={"message": "fix these items before publishing",
                                                     "problems": problems})
    if int(v.get("period_months") or 0) < 1:
        _rollback(db)
        raise HTTPException(status_code=422, detail="period_months must be at least 1")
    against = None
    if v.get("supersedes_version_id"):
        against = one(db, "SELECT * FROM ai_plan_version WHERE id = CAST(:v AS UUID)",
                      {"v": str(v["supersedes_version_id"])})
    if against is None:
        against = one(db, "SELECT * FROM ai_plan_version WHERE plan_id = CAST(:p AS UUID) AND status = 'PUBLISHED' "
                          "AND id <> CAST(:v AS UUID) ORDER BY version_no DESC LIMIT 1",
                      {"p": str(v["plan_id"]), "v": str(v["id"])})
    diff = _diff(against, v, version_items(db, str(against["id"])) if against else [], items)
    warnings = []
    if Decimal(str(v.get("allowance_credits") or 0)) > 0 and not any(i["mode"] == "ALLOWANCE" for i in items):
        warnings.append("the version has allowance credits but no ALLOWANCE item: the allowance is never used")
    if any(i["mode"] == "ALLOWANCE" for i in items) and Decimal(str(v.get("allowance_credits") or 0)) <= 0:
        warnings.append("ALLOWANCE items with 0 allowance credits: those features are always charged")
    leaked = brand_words([i.get("display_cap_text") for i in items])
    if leaked:
        warnings.append("display_cap_text is shown to institutes and contains a platform brand word "
                        f"({', '.join(leaked)}): white-labelled institutes would see it")
    if any(i["mode"] == "INCLUDED" for i in items) and v.get("internal_cost_cap_usd") is None and not any(
            i.get("inst_cost_usd_cap") is not None or i.get("inst_credits_cap") is not None
            or i.get("inst_units_cap") is not None for i in items if i["mode"] == "INCLUDED"):
        warnings.append("INCLUDED items without any institute cap or internal cost cap: included use is unbounded")
    try:
        new = one(db, "UPDATE ai_plan_version SET status = 'PUBLISHED', published_at = now(), published_by = :a, "
                      "updated_at = now() WHERE id = CAST(:v AS UUID) AND status = 'DRAFT' RETURNING *",
                  {"a": actor, "v": str(v["id"])})
        if new is None:
            _rollback(db)
            raise HTTPException(status_code=409, detail="the version is no longer a DRAFT")
        audit(db, "ai_plan_version", str(v["id"]), {"status": "DRAFT"}, {"status": "PUBLISHED", "diff": diff}, why,
              actor)
        moved = _schedule_migration(db, new, actor, why)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "publish")
    commit(db)
    notify_engine()
    return {**version_out(new, items), "diff": diff, "warnings": warnings,
            "subscriptions_scheduled_to_move": moved}


@router.post("/versions/{vid}/retire", summary="Retire a PUBLISHED version (no new subscriptions on it)")
def retire_version(vid: str, body: ReasonBody, db: Session = Depends(db_dependency),
                   current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    why = need_reason(body.reason)
    actor = actor_of(current_user)
    v = get_version(db, vid, for_update=True)
    if v["status"] != "PUBLISHED":
        _rollback(db)
        raise HTTPException(status_code=409, detail=f"only a PUBLISHED version can be retired (this one is {v['status']})")
    live = int(db.execute(text(
        "SELECT count(*) FROM institute_ai_subscription WHERE status IN ('SCHEDULED','TRIAL','ACTIVE','GRACE') "
        "AND (plan_version_id = CAST(:v AS UUID) OR pending_plan_version_id = CAST(:v AS UUID))"),
        {"v": str(v["id"])}).scalar() or 0)
    try:
        # status only: the V588 trigger allows PUBLISHED -> RETIRED and nothing else on a published row
        new = one(db, "UPDATE ai_plan_version SET status = 'RETIRED' "
                      "WHERE id = CAST(:v AS UUID) AND status = 'PUBLISHED' RETURNING *", {"v": str(v["id"])})
        if new is None:
            _rollback(db)
            raise HTTPException(status_code=409, detail="the version is no longer PUBLISHED")
        audit(db, "ai_plan_version", str(v["id"]), {"status": "PUBLISHED"}, {"status": "RETIRED"},
              why, actor)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "retire")
    commit(db)
    notify_engine()
    out = version_out(new, version_items(db, str(v["id"])))
    out["subscriptions_still_on_it"] = live
    if live:
        out["warnings"] = [f"{live} open subscription(s) still use this version; they keep its terms until changed"]
    return out


# ── subscriptions ───────────────────────────────────────────────────────────

_SUB_SELECT = (
    "SELECT s.*, p.id AS plan_id, p.plan_key, p.name AS plan_name, v.version_no, v.status AS version_status, "
    "v.price_minor, v.allowance_credits FROM institute_ai_subscription s "
    "JOIN ai_plan_version v ON v.id = s.plan_version_id JOIN ai_plan p ON p.id = v.plan_id ")


def _with_names(db: Session, subs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    names = institute_names(db, [s.get("institute_id") for s in subs])
    for s in subs:
        s["institute_name"] = names.get(str(s.get("institute_id")))
    return subs


def _current_periods(db: Session, sub_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    if not sub_ids:
        return {}
    out = {}
    for r in rows(db, "SELECT DISTINCT ON (subscription_id) * FROM ai_subscription_period "
                      "WHERE subscription_id = ANY(CAST(:ids AS UUID[])) AND period_start <= now() "
                      "ORDER BY subscription_id, period_start DESC", {"ids": sub_ids}):
        out[str(r["subscription_id"])] = period_out(r)
    return out


@router.get("/subscriptions", summary="Subscriptions, filtered by institute / status / plan / enforcement")
def list_subscriptions(
    institute_id: Optional[str] = Query(None, max_length=64),
    status: Optional[str] = Query(None, max_length=12),
    plan_id: Optional[str] = Query(None, max_length=64),
    enforcement: Optional[str] = Query(None, max_length=8),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(db_dependency),
):
    if not tables_ready(db):
        return {"subscriptions": [], "plans_enabled": plans_enabled()}
    where, params = [], {"lim": limit}
    if institute_id:
        where.append("s.institute_id = :i")
        params["i"] = institute_id.strip()
    if status:
        sts = [x.strip().upper() for x in status.split(",") if x.strip()]
        for x in sts:
            _upper(x, OPEN_STATUSES + (PENDING_STATUS,) + TERMINAL_STATUSES, "status")
        where.append("s.status = ANY(CAST(:st AS VARCHAR[]))")
        params["st"] = sts
    if plan_id:
        where.append("p.id = CAST(:p AS UUID)")
        params["p"] = valid_uuid(plan_id, "plan")
    if enforcement:
        where.append("s.enforcement = :e")
        params["e"] = _upper(enforcement, ENFORCEMENTS, "enforcement")
    sql = _SUB_SELECT + (("WHERE " + " AND ".join(where)) if where else "") + " ORDER BY s.created_at DESC LIMIT :lim"
    subs = _with_names(db, rows(db, sql, params))
    periods = _current_periods(db, [str(s["id"]) for s in subs])
    out = []
    for s in subs:
        so = sub_out(s)
        so["current_period"] = periods.get(str(s["id"]))
        out.append(so)
    return {"subscriptions": out, "plans_enabled": plans_enabled()}


def _counters(db: Session, sub: Dict[str, Any], period_start: Optional[datetime]) -> List[Dict[str, Any]]:
    if period_start is None:
        return []
    try:
        return [{"counter_key": r["counter_key"], "units_used": num(r["count_used"]),
                 "credits_used": num(r["credits_used"]), "cost_usd": num(r["cost_usd"]),
                 "updated_at": iso(r.get("updated_at"))}
                for r in rows(db, "SELECT counter_key, count_used, credits_used, cost_usd, updated_at "
                                  "FROM ai_usage_counter WHERE institute_id = :i AND period = 'PLAN_PERIOD' "
                                  "AND window_start = :w AND counter_key LIKE :k ORDER BY counter_key LIMIT 500",
                              {"i": sub["institute_id"], "w": period_start, "k": f"PLAN:{sub['id']}|%"})]
    except Exception:  # noqa: BLE001
        logger.warning("plan counters read failed", exc_info=True)
        _rollback(db)
        return []


@router.get("/subscriptions/{sid}", summary="A subscription with its periods, overrides and fair-use counters")
def get_subscription(sid: str, db: Session = Depends(db_dependency)):
    require_tables(db)
    sid = valid_uuid(sid, "subscription")
    found = rows(db, _SUB_SELECT + "WHERE s.id = CAST(:s AS UUID)", {"s": sid})
    if not found:
        raise HTTPException(status_code=404, detail="subscription not found")
    s = _with_names(db, found)[0]
    out = sub_out(s)
    periods = [period_out(r) for r in rows(db, "SELECT * FROM ai_subscription_period WHERE subscription_id = "
                                               "CAST(:s AS UUID) ORDER BY period_start DESC LIMIT 60", {"s": sid})]
    out["periods"] = periods
    now = datetime.now(UTC)
    cur = next((p for p in periods if p["period_start"] and datetime.fromisoformat(p["period_start"]) <= now), None)
    out["current_period"] = cur
    out["overrides"] = [override_out(r) for r in rows(
        db, "SELECT * FROM ai_subscription_override WHERE subscription_id = CAST(:s AS UUID) AND is_active "
            "ORDER BY feature_key, created_at", {"s": sid})]
    out["counters"] = _counters(db, s, datetime.fromisoformat(cur["period_start"]) if cur else None)
    out["plans_enabled"] = plans_enabled()
    return out


def _published_version(db: Session, vid: str, what: str) -> Dict[str, Any]:
    v = get_version(db, vid)
    if v["status"] != "PUBLISHED":
        raise HTTPException(status_code=422, detail=f"{what} must be a PUBLISHED version (this one is {v['status']})")
    return v


def _enforcement_note(enforcement: str) -> Optional[str]:
    if enforcement == "LIVE" and not plans_enabled():
        return ("AI plans are switched off platform-wide (billing.plans.enabled = false): this LIVE subscription "
                "charges exactly as today until the setting is turned on")
    if enforcement == "SHADOW":
        return "SHADOW: charges exactly as today; usage events only record what LIVE would have done"
    return None


@router.post("/subscriptions", summary="Assign a PUBLISHED plan version to an institute (SHADOW by default)")
def create_subscription(body: SubscriptionCreate, db: Session = Depends(db_dependency),
                        current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    actor = actor_of(current_user) or "unknown"
    reason = need_reason(body.reason)
    iid = _institute(body.institute_id)
    enforcement = _upper(body.enforcement or "SHADOW", ENFORCEMENTS, "enforcement")
    source = str(body.source or "MANUAL").strip().upper()
    if source == "PAYMENT":
        return _assign_paid(db, body, actor, reason, iid)
    if source not in ASSIGN_SOURCES:
        raise HTTPException(status_code=422, detail="source must be MANUAL, COMPLIMENTARY or PAYMENT")
    v = _published_version(db, body.plan_version_id, "plan_version_id")
    pm = _int(body.period_months if body.period_months is not None else (v.get("period_months") or 1),
              "period_months", 1, PERIOD_MONTHS_MAX)
    grace = _int(body.grace_days if body.grace_days is not None else (v.get("grace_days") or 0),
                 "grace_days", 0, GRACE_DAYS_MAX)
    price_override = (_int(body.price_override_minor, "price_override_minor", 0, MAX_BIGINT_MINOR)
                      if body.price_override_minor is not None else None)
    now = datetime.now(UTC)
    start = _aware(body.start_at, "start_at") or now
    if start < now - timedelta(days=BACKDATE_DAYS_MAX):
        raise HTTPException(status_code=422, detail=f"start_at can be at most {BACKDATE_DAYS_MAX} days in the past")
    end = _aware(body.end_at, "end_at")
    if body.period_count is not None:
        if end is not None:
            raise HTTPException(status_code=422, detail="send end_at or period_count, not both")
        end = add_months(start, _int(body.period_count, "period_count", 1, 120) * pm)
    if end is not None and end <= start:
        raise HTTPException(status_code=422, detail="end_at must be after start_at")
    if end is not None and end <= now:
        raise HTTPException(status_code=422, detail="end_at is in the past")
    known = institute_exists(db, iid)
    if known is False:
        raise HTTPException(status_code=404, detail="institute not found")
    status = "SCHEDULED" if start > now else "ACTIVE"
    sid = str(uuid.uuid4())
    try:
        xact_lock(db, f"ai_subscription:{iid}")
        other = one(db, "SELECT id, status FROM institute_ai_subscription WHERE institute_id = :i "
                        "AND status IN ('SCHEDULED','TRIAL','ACTIVE','GRACE') LIMIT 1", {"i": iid})
        if other is None:       # a paid checkout waiting for its first payment (V590) also blocks
            other = one(db, "SELECT id, status FROM institute_ai_subscription WHERE institute_id = :i "
                            "AND status = 'PENDING' LIMIT 1", {"i": iid})
        if other is not None:
            _rollback(db)
            raise HTTPException(status_code=409, detail={
                "message": "the institute already has an open subscription: change or cancel it first",
                "subscription_id": str(other["id"]), "status": other["status"]})
        sub = one(db, (
            "INSERT INTO institute_ai_subscription (id, institute_id, plan_version_id, status, enforcement, source, "
            "anchor_at, start_at, end_at, period_months, auto_renew, grace_days, cancel_at_period_end, "
            "price_override_minor, reason, created_by, created_at, updated_by, updated_at) VALUES "
            "(CAST(:id AS UUID), :i, CAST(:v AS UUID), :st, :enf, :src, :start, :start, :end, :pm, :ar, :grace, false, "
            ":po, :reason, :actor, now(), :actor, now()) RETURNING *"), {
            "id": sid, "i": iid, "v": str(v["id"]), "st": status, "enf": enforcement, "src": source,
            "start": start, "end": end, "pm": pm, "ar": bool(body.auto_renew), "grace": grace,
            "po": price_override, "reason": reason, "actor": actor})
        period = None
        if status == "ACTIVE":
            ps, pe = period_bounds(start, pm, now)
            period, _ = ensure_period(db, sub, ps, pe, v)
        sub_event(db, sid, iid, "CREATED", None, sub_state(sub), actor, reason)
    except HTTPException:
        raise
    except DBAPIError as exc:
        _rollback(db)
        if sqlstate(exc) == "23505":
            raise HTTPException(status_code=409, detail="the institute already has a live subscription")
        raise _db_error(exc, "subscription")
    commit(db)
    notify_engine(iid, live=(status in LIVE_STATUSES))
    out = sub_out(sub)
    out["current_period"] = period_out(period) if period else None
    out["plans_enabled"] = plans_enabled()
    note = _enforcement_note(enforcement)
    if note:
        out["note"] = note
    if known is None:
        out["warning"] = "could not check that the institute exists"
    return out


@router.patch("/subscriptions/{sid}", summary="Change enforcement, renewal, a pending plan change, end date")
def patch_subscription(sid: str, body: SubscriptionPatch, db: Session = Depends(db_dependency),
                       current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    actor = actor_of(current_user) or "unknown"
    reason = need_reason(body.reason)
    given = body.model_fields_set - {"reason"}
    if not given:
        raise HTTPException(status_code=422, detail="nothing to change")
    raw = body.model_dump()
    ch: Dict[str, Any] = {}
    for f in given:
        val = raw.get(f)
        if val is None and f not in ("pending_plan_version_id", "end_at", "price_override_minor"):
            raise HTTPException(status_code=422, detail=f"{f} cannot be empty")
        if f == "enforcement":
            val = _upper(val, ENFORCEMENTS, "enforcement")
        elif f == "grace_days":
            val = _int(val, "grace_days", 0, GRACE_DAYS_MAX)
        elif f == "price_override_minor" and val is not None:
            val = _int(val, "price_override_minor", 0, MAX_BIGINT_MINOR)
        elif f == "end_at" and val is not None:
            val = _aware(val, "end_at")
        elif f == "pending_plan_version_id" and val is not None:
            val = str(_published_version(db, val, "pending_plan_version_id")["id"])
        ch[f] = val
    paid = _lock_paid(db, sid)
    s = get_sub(db, sid, for_update=True)
    if s["status"] in TERMINAL_STATUSES:
        _rollback(db)
        raise HTTPException(status_code=409, detail=f"the subscription is {s['status']}: assign a new one instead")
    if paid and (
            ch.get("enforcement", "LIVE") != "LIVE" or "price_override_minor" in ch):
        _rollback(db)
        raise HTTPException(status_code=409, detail=(
            "a paid plan is always LIVE and is priced by its charges: cancel it or change its plan instead"))
    if "end_at" in ch and ch["end_at"] is not None and ch["end_at"] <= max(
            s["start_at"] if s["start_at"].tzinfo else s["start_at"].replace(tzinfo=UTC), datetime.now(UTC)):
        _rollback(db)
        raise HTTPException(status_code=422, detail="end_at must be in the future and after start_at")
    if ch.get("pending_plan_version_id") and ch["pending_plan_version_id"] == str(s["plan_version_id"]):
        _rollback(db)
        raise HTTPException(status_code=422, detail="pending_plan_version_id is the current version")
    real = {k: v for k, v in ch.items() if jsonish(v) != jsonish(s.get(k))}
    if not real:
        _rollback(db)
        out = sub_out(s)
        out["changed"] = []
        return out
    uuid_cols = {"pending_plan_version_id"}
    sets = ", ".join((f"{k} = CAST(:{k} AS UUID)" if k in uuid_cols else f"{k} = :{k}") for k in real)
    voided: List[Dict[str, Any]] = []
    try:
        if paid:
            if real.get("auto_renew") is False or real.get("cancel_at_period_end") is True:
                voided = _void_paid_charges(db, s, actor, "NOT_RENEWING", future_only=True)
            elif "pending_plan_version_id" in real:
                voided = _void_paid_charges(db, s, actor, "REPRICED", future_only=True)
        elif real.get("auto_renew") is False or real.get("cancel_at_period_end") is True:
            open_current_period_before_renewal_stops(db, s)
        new = one(db, f"UPDATE institute_ai_subscription SET {sets}, updated_by = :actor, updated_at = now() "
                      "WHERE id = CAST(:sid AS UUID) RETURNING *", {**real, "actor": actor, "sid": str(s["id"])})
        etype = "ENFORCEMENT_CHANGED" if list(real) == ["enforcement"] else (
            "PLAN_CHANGE_SCHEDULED" if list(real) == ["pending_plan_version_id"] else "UPDATED")
        sub_event(db, str(s["id"]), s["institute_id"], etype, {k: s.get(k) for k in real},
                  {k: new.get(k) for k in real}, actor, reason)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "subscription")
    commit(db)
    notify_engine(s["institute_id"])
    out = sub_out(new)
    out["changed"] = sorted(real)
    out["plans_enabled"] = plans_enabled()
    if voided:
        out["voided_charges"] = voided
    note = _enforcement_note(new["enforcement"]) if "enforcement" in real else None
    if note:
        out["note"] = note
    return out


@router.post("/subscriptions/{sid}/cancel", summary="Cancel now (immediate) or at the period end")
def cancel_subscription(sid: str, body: CancelBody, db: Session = Depends(db_dependency),
                        current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    actor = actor_of(current_user) or "unknown"
    reason = need_reason(body.reason)
    paid = _lock_paid(db, sid)
    s = get_sub(db, sid, for_update=True)
    if s["status"] in TERMINAL_STATUSES:
        _rollback(db)
        raise HTTPException(status_code=409, detail=f"the subscription is already {s['status']}")
    immediate = bool(body.immediate) or s["status"] in ("SCHEDULED", PENDING_STATUS)
    voided: List[Dict[str, Any]] = []
    try:
        if paid:
            voided = _void_paid_charges(db, s, actor, "CANCELLED", future_only=not immediate)
        if immediate:
            new = one(db, "UPDATE institute_ai_subscription SET status = 'CANCELLED', end_at = now(), "
                          "auto_renew = false, updated_by = :a, updated_at = now() WHERE id = CAST(:s AS UUID) "
                          "RETURNING *", {"a": actor, "s": str(s["id"])})
            etype = "CANCELLED"
        else:
            if not paid:
                open_current_period_before_renewal_stops(db, s)
            new = one(db, "UPDATE institute_ai_subscription SET cancel_at_period_end = true, updated_by = :a, "
                          "updated_at = now() WHERE id = CAST(:s AS UUID) RETURNING *", {"a": actor, "s": str(s["id"])})
            etype = "CANCEL_SCHEDULED"
        sub_event(db, str(s["id"]), s["institute_id"], etype, sub_state(s), sub_state(new), actor, reason)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "cancel")
    commit(db)
    notify_engine(s["institute_id"], live=False if immediate else None)
    out = sub_out(new)
    out["immediate"] = immediate
    if voided:
        out["voided_charges"] = voided
    return out


# overrides --------------------------------------------------------------------

@router.get("/subscriptions/{sid}/overrides", summary="Per-feature overrides of a subscription")
def list_overrides(sid: str, include_inactive: bool = Query(False), db: Session = Depends(db_dependency)):
    require_tables(db)
    s = get_sub(db, sid)
    sql = "SELECT * FROM ai_subscription_override WHERE subscription_id = CAST(:s AS UUID)"
    if not include_inactive:
        sql += " AND is_active"
    return {"overrides": [override_out(r) for r in rows(db, sql + " ORDER BY feature_key, created_at",
                                                         {"s": str(s["id"])})]}


@router.post("/subscriptions/{sid}/overrides", summary="Add a per-feature override (replaces that feature's active one)")
def add_override(sid: str, body: OverrideIn, db: Session = Depends(db_dependency),
                 current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    actor = actor_of(current_user) or "unknown"
    reason = need_reason(body.reason)
    key = str(body.feature_key or "").strip()
    feature = features_by_key(db).get(key)
    if feature is None:
        raise HTTPException(status_code=422, detail=f"unknown feature_key {key!r}")
    mode = None
    if body.mode is not None:
        mode = _upper(body.mode, ITEM_MODES, "mode")
        check_mode_allowed(feature, mode)
    caps = _caps(body.model_dump())
    if mode is None and all(v is None for v in caps.values()):
        raise HTTPException(status_code=422, detail="an override needs a mode or at least one cap")
    s = get_sub(db, sid, for_update=True)
    if s["status"] in TERMINAL_STATUSES:
        _rollback(db)
        raise HTTPException(status_code=409, detail=f"the subscription is {s['status']}")
    try:
        replaced = [override_out(r) for r in rows(db, (
            "UPDATE ai_subscription_override SET is_active = false WHERE subscription_id = CAST(:s AS UUID) "
            "AND feature_key = :k AND is_active RETURNING *"), {"s": str(s["id"]), "k": key})]
        row = one(db, (
            "INSERT INTO ai_subscription_override (id, subscription_id, feature_key, mode, inst_units_cap, "
            "inst_credits_cap, inst_cost_usd_cap, user_units_cap, user_credits_cap, reason, created_by, created_at, "
            "is_active) VALUES (CAST(:id AS UUID), CAST(:s AS UUID), :k, :mode, :inst_units_cap, :inst_credits_cap, "
            ":inst_cost_usd_cap, :user_units_cap, :user_credits_cap, :reason, :actor, now(), true) RETURNING *"),
            {"id": str(uuid.uuid4()), "s": str(s["id"]), "k": key, "mode": mode, **caps, "reason": reason,
             "actor": actor})
        sub_event(db, str(s["id"]), s["institute_id"], "OVERRIDE_ADDED", replaced[0] if replaced else None,
                  override_out(row), actor, reason)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "override")
    commit(db)
    notify_engine(s["institute_id"])
    out = override_out(row)
    out["replaced"] = replaced
    return out


@router.delete("/subscriptions/{sid}/overrides/{oid}", summary="Remove an override (kept as inactive history)")
def delete_override(sid: str, oid: str, reason: Optional[str] = Query(None, max_length=2000),
                    db: Session = Depends(db_dependency),
                    current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    actor = actor_of(current_user) or "unknown"
    why = need_reason(reason)
    s = get_sub(db, sid, for_update=True)
    oid = valid_uuid(oid, "override")
    try:
        row = one(db, "UPDATE ai_subscription_override SET is_active = false WHERE id = CAST(:o AS UUID) "
                      "AND subscription_id = CAST(:s AS UUID) AND is_active RETURNING *", {"o": oid, "s": str(s["id"])})
        if row is None:
            _rollback(db)
            raise HTTPException(status_code=404, detail="active override not found")
        sub_event(db, str(s["id"]), s["institute_id"], "OVERRIDE_REMOVED", override_out(row), None, actor, why)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "override")
    commit(db)
    notify_engine(s["institute_id"])
    return override_out(row)


@router.get("/subscriptions/{sid}/events", summary="A subscription's change history (newest first)")
def list_events(sid: str, limit: int = Query(200, ge=1, le=1000), db: Session = Depends(db_dependency)):
    require_tables(db)
    s = get_sub(db, sid)
    return {"events": [event_out(r) for r in rows(
        db, "SELECT * FROM ai_subscription_event WHERE subscription_id = CAST(:s AS UUID) "
            "ORDER BY created_at DESC, id DESC LIMIT :lim", {"s": str(s["id"]), "lim": limit})]}


# ── pricing tools (engine) ──────────────────────────────────────────────────

def _engine_or_503():
    engine = get_plans_engine()
    if engine is None:
        raise HTTPException(status_code=503, detail="the AI plans engine is not available on this server")
    return engine


@router.post("/simulate", summary="Replay an institute's recent usage through a plan version (read-only)")
def simulate(body: SimulateBody, db: Session = Depends(db_dependency)):
    require_tables(db)
    engine = _engine_or_503()
    v = get_version(db, body.plan_version_id)
    iid = _institute(body.institute_id)
    fn = getattr(engine, "simulate", None)
    if not callable(fn):
        raise HTTPException(status_code=503, detail="the AI plans engine has no simulate()")
    try:
        result = fn(db, str(v["id"]), iid, days=int(body.days))
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("plan simulate failed")
        _rollback(db)
        raise HTTPException(status_code=500, detail=f"simulate failed: {type(exc).__name__}")
    finally:
        _rollback(db)                        # read-only: nothing it touched is kept
    out = jsonish(result)
    if isinstance(out, dict):
        out.setdefault("plan_version_id", str(v["id"]))
        out.setdefault("institute_id", iid)
        out.setdefault("days", int(body.days))
    return out


@router.get("/pnl", summary="Plan revenue vs real cost per institute and period")
def pnl(institute_id: Optional[str] = Query(None, max_length=64),
        period: str = Query("current", max_length=16), db: Session = Depends(db_dependency)):
    require_tables(db)
    p = str(period or "current").strip().lower()
    if p not in ("current", "previous"):
        raise HTTPException(status_code=422, detail="period must be current or previous")
    engine = _engine_or_503()
    fn = getattr(engine, "pnl", None)
    if not callable(fn):
        raise HTTPException(status_code=503, detail="the AI plans engine has no pnl()")
    try:
        result = fn(db, institute_id=institute_id.strip() if institute_id else None, period=p)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("plan pnl failed")
        _rollback(db)
        raise HTTPException(status_code=500, detail=f"pnl failed: {type(exc).__name__}")
    finally:
        _rollback(db)
    out = jsonish(result)
    if isinstance(out, list):
        out = {"rows": out}
    if isinstance(out, dict):
        out.setdefault("period", p)
        out.setdefault("institute_id", institute_id)
    return out



# ── paid plans + storefront (V590) ──────────────────────────────────────────

def _billing_module(db: Session):
    """routers/plans_billing_internal (imported late: it imports this module),
    503 while the V590 billing tables are missing."""
    from . import plans_billing_internal as pb
    if not pb.billing_ready(db):
        raise HTTPException(status_code=503, detail=(
            "the AI plan billing tables are missing: deploy admin_core (its Flyway migration V590) first"))
    return pb


def _assign_paid(db: Session, body: "SubscriptionCreate", actor: str, reason: str, iid: str) -> Dict[str, Any]:
    """source PAYMENT (sales-led): a PENDING subscription, LIVE, starting when its
    first charge is paid; no scheduled start, no end date, no period count."""
    pb = _billing_module(db)
    if not pb.payments_enabled():
        raise HTTPException(status_code=409, detail=(
            "paid plans are switched off (billing.subscriptions.payments.enabled = false)"))
    if body.start_at is not None or body.end_at is not None or body.period_count is not None:
        raise HTTPException(status_code=422, detail=(
            "a paid plan starts when its first payment is received and renews while it is paid: "
            "no start_at / end_at / period_count"))
    if str(body.enforcement or "LIVE").strip().upper() != "LIVE" and "enforcement" in body.model_fields_set:
        raise HTTPException(status_code=422, detail="a paid plan is always LIVE")
    v = _published_version(db, body.plan_version_id, "plan_version_id")
    if body.period_months is not None and int(body.period_months) != int(v.get("period_months") or 1):
        raise HTTPException(status_code=422, detail="a paid plan bills the version's own period")
    known = institute_exists(db, iid)
    if known is False:
        raise HTTPException(status_code=404, detail="institute not found")
    try:
        out = pb.do_checkout(db, pb.CheckoutBody(
            institute_id=iid, plan_version_id=str(v["id"]), actor=actor, self_serve=False,
            price_override_minor=body.price_override_minor, reason=reason))
        if body.grace_days is not None:
            grace = _int(body.grace_days, "grace_days", 0, GRACE_DAYS_MAX)
            db.execute(text("UPDATE institute_ai_subscription SET grace_days = :g WHERE id = CAST(:s AS UUID)"),
                       {"g": grace, "s": out["subscription_id"]})
        if not body.auto_renew:
            db.execute(text("UPDATE institute_ai_subscription SET auto_renew = false WHERE id = CAST(:s AS UUID)"),
                       {"s": out["subscription_id"]})
        if body.send_link:
            db.execute(text("UPDATE ai_subscription_charge SET next_attempt_at = now(), updated_at = now() "
                            "WHERE id = CAST(:c AS UUID)"), {"c": out["charge_id"]})
    except HTTPException:
        _rollback(db)
        raise
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "subscription")
    commit(db)
    notify_engine(iid)
    sub = get_sub(db, out["subscription_id"])
    res = sub_out(sub)
    fresh = one(db, "SELECT * FROM ai_subscription_charge WHERE id = CAST(:c AS UUID)", {"c": out["charge_id"]})
    res.update(charge=pb.charge_out(fresh) if fresh else out["charge"], superseded=out["superseded"],
               replayed=out["replayed"],
               send_link=bool(body.send_link), plans_enabled=plans_enabled(),
               note=("PENDING until the first payment: admin_core sends the payment link and the plan starts "
                     "when it is paid" if body.send_link else
                     "PENDING until the first payment: use send-link (or mark it paid offline) to collect it"))
    if known is None:
        res["warning"] = "could not check that the institute exists"
    _rollback(db)
    return res


def _lock_paid(db: Session, sid: str) -> bool:
    """For a paid plan (source PAYMENT): take the institute's subscription lock
    BEFORE the row lock (the order /paid and the roll use). True = paid plan.
    MANUAL / COMPLIMENTARY: nothing (exactly as before)."""
    head = one(db, "SELECT institute_id, source FROM institute_ai_subscription WHERE id = CAST(:s AS UUID)",
               {"s": valid_uuid(sid, "subscription")})
    if head is None or str(head.get("source") or "").upper() != "PAYMENT":
        return False
    xact_lock(db, f"ai_subscription:{head['institute_id']}")
    return True


def _void_paid_charges(db: Session, sub: Dict[str, Any], actor: str, reason: str, *,
                       future_only: bool) -> List[Dict[str, Any]]:
    """A staff change of a paid plan: void its unpaid charges (all, or only the
    renewal / upgrade ones when the current paid period runs on). The caller
    holds the institute lock (_lock_paid)."""
    from . import plans_billing_internal as pb
    if not pb.billing_ready(db):
        return []
    charges = pb._open_charges(db, str(sub["id"]))  # noqa: SLF001
    if future_only:
        now = datetime.now(UTC)
        charges = [c for c in charges if c.get("kind") == "PERIOD" and _tz(c["service_start"]) > now
                   or c.get("kind") == "UPGRADE"]
    return pb._void(db, sub, charges, reason, actor)  # noqa: SLF001


@router.get("/subscriptions/{sid}/billing", summary="A paid plan's periods, charges, mandates and billing events")
def subscription_billing(sid: str, db: Session = Depends(db_dependency)):
    require_tables(db)
    pb = _billing_module(db)
    s = get_sub(db, sid)
    sid = str(s["id"])
    out = {"subscription": sub_out(s),
           "periods": [period_out(r) for r in rows(db, "SELECT * FROM ai_subscription_period WHERE subscription_id = "
                                                      "CAST(:s AS UUID) ORDER BY period_start DESC LIMIT 120", {"s": sid})],
           "charges": pb.list_charges(db, subscription_id=sid, limit=500)["charges"],
           "mandates": [pb._mandate_out(m) for m in rows(  # noqa: SLF001
               db, "SELECT * FROM ai_subscription_mandate WHERE subscription_id = CAST(:s AS UUID) OR "
                   "(subscription_id IS NULL AND institute_id = :i) ORDER BY created_at DESC LIMIT 20",
               {"s": sid, "i": s["institute_id"]})],
           "events": [event_out(r) for r in rows(
               db, "SELECT * FROM ai_subscription_event WHERE subscription_id = CAST(:s AS UUID) AND event_type IN "
                   "('CHECKOUT_CREATED','CHECKOUT_SUPERSEDED','CHECKOUT_EXPIRED','CHARGE_CREATED','CHARGE_VOIDED',"
                   "'CHARGE_STATUS','CHARGE_REFUNDED','CHARGE_RESEND','ACTIVATED','RENEWAL_PAID','GRACE_STARTED',"
                   "'GRACE_CLEARED','UPGRADE_QUOTED','UPGRADED','UPGRADE_REVERTED','PAYMENT_DUPLICATE','PAYMENT_LATE',"
                   "'PAYMENT_AMOUNT_MISMATCH','CANCELLED','CANCEL_SCHEDULED','RESUMED','EXPIRED') "
                   "ORDER BY created_at DESC LIMIT 300", {"s": sid})],
           "payments_enabled": pb.payments_enabled(), "autopay_enabled": pb.autopay_enabled()}
    _rollback(db)
    return out


@router.post("/subscriptions/{sid}/charges/{cid}/send-link",
             summary="Queue a payment link for an unpaid charge (admin_core's billing job sends it)")
def send_charge_link(sid: str, cid: str, body: ReasonBody, db: Session = Depends(db_dependency),
                     current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    pb = _billing_module(db)
    why = need_reason(body.reason)
    actor = actor_of(current_user) or "unknown"
    s = get_sub(db, sid)
    xact_lock(db, f"ai_subscription:{s['institute_id']}")
    ch = one(db, "SELECT * FROM ai_subscription_charge WHERE id = CAST(:c AS UUID) AND subscription_id = "
                 "CAST(:s AS UUID) FOR UPDATE", {"c": valid_uuid(cid, "charge"), "s": str(s["id"])})
    if ch is None:
        _rollback(db)
        raise HTTPException(status_code=404, detail="charge not found")
    if ch["status"] not in ("DUE", "LINK_SENT", "FAILED", "DEBIT_SCHEDULED"):
        _rollback(db)
        raise HTTPException(status_code=409, detail=f"the charge is {ch['status']}: nothing to collect")
    try:
        new = one(db, "UPDATE ai_subscription_charge SET status = CASE WHEN status = 'DEBIT_SCHEDULED' THEN status "
                      "ELSE 'DUE' END, next_attempt_at = now(), updated_at = now() WHERE id = CAST(:c AS UUID) "
                      "RETURNING *", {"c": str(ch["id"])})
        sub_event(db, str(s["id"]), s["institute_id"], "CHARGE_RESEND", {"charge_id": str(ch["id"]),
                                                                         "status": ch["status"]},
                  {"charge_id": str(ch["id"]), "status": new["status"]}, actor, why)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "charge")
    commit(db)
    return {"charge": pb.charge_out(new), "queued": True,
            "note": "admin_core's billing job creates a fresh payment link (cancelling the old one) and emails it"}


class ListingPatch(BaseModel):
    listed: Optional[bool] = None
    tagline: Optional[str] = Field(None, max_length=160)
    highlights: Optional[List[str]] = None
    badge: Optional[str] = Field(None, max_length=32)
    sort_order: Optional[int] = Field(None, ge=0, le=100000)
    audience_mode: Optional[str] = Field(None, max_length=10)
    reason: Optional[str] = Field(None, max_length=2000)


class AudiencePut(BaseModel):
    #: INCLUDE rules
    institute_ids: List[str] = Field(default_factory=list, max_length=5000)
    segments: List[str] = Field(default_factory=list, max_length=200)
    #: EXCLUDE rules (always win)
    exclude_institute_ids: List[str] = Field(default_factory=list, max_length=5000)
    exclude_segments: List[str] = Field(default_factory=list, max_length=200)
    reason: Optional[str] = Field(None, max_length=2000)


class SegmentPut(BaseModel):
    institute_ids: List[str] = Field(default_factory=list, max_length=5000)
    reason: Optional[str] = Field(None, max_length=2000)


class StorefrontInstitutePut(BaseModel):
    storefront_enabled: Optional[bool] = None
    brand_mode_override: Optional[str] = Field(None, max_length=10)
    reason: Optional[str] = Field(None, max_length=2000)


@router.patch("/plans/{plan_ref}/listing", summary="Storefront listing of a plan (white-label copy only)")
def patch_listing(plan_ref: str, body: ListingPatch, db: Session = Depends(db_dependency),
                  current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    _billing_module(db)
    reason = need_reason(body.reason)
    actor = actor_of(current_user)
    given = body.model_fields_set - {"reason"}
    if not given:
        raise HTTPException(status_code=422, detail="nothing to change")
    raw = body.model_dump()
    ch: Dict[str, Any] = {}
    for f in given:
        val = raw.get(f)
        if f == "listed":
            if val is None:
                raise HTTPException(status_code=422, detail="listed cannot be empty")
            ch[f] = bool(val)
        elif f in ("tagline", "badge"):
            ch[f] = (str(val).strip() or None) if val is not None else None
        elif f == "highlights":
            hl = [str(x).strip() for x in (val or []) if str(x or "").strip()]
            if len(hl) > HIGHLIGHTS_MAX or any(len(x) > 80 for x in hl):
                raise HTTPException(status_code=422, detail=f"at most {HIGHLIGHTS_MAX} highlights of up to 80 characters")
            ch[f] = json.dumps(hl)
        elif f == "sort_order":
            if val is None:
                raise HTTPException(status_code=422, detail="sort_order cannot be empty")
            ch[f] = int(val)
        elif f == "audience_mode":
            ch[f] = _upper(val, ("ALL", "ALLOWLIST", "SEGMENT"), "audience_mode")
    leaked = brand_words(ch.get("tagline"), ch.get("badge"), json.loads(ch["highlights"]) if "highlights" in ch else None)
    if leaked:
        raise HTTPException(status_code=422, detail=(
            f"listing copy is shown to institutes (white-label): remove {', '.join(leaked)}"))
    plan = get_plan(db, plan_ref, for_update=True)
    warnings = []
    if ch.get("listed") or (plan.get("listed") and "listed" not in ch):
        leaked = brand_words(plan.get("name"), plan.get("description"))
        if leaked:
            _rollback(db)
            raise HTTPException(status_code=422, detail=(
                f"the plan name / description is shown to institutes: remove {', '.join(leaked)} before listing"))
        pub = one(db, "SELECT id, currency, price_minor FROM ai_plan_version WHERE plan_id = CAST(:p AS UUID) "
                      "AND status = 'PUBLISHED' ORDER BY version_no DESC LIMIT 1", {"p": str(plan["id"])})
        if pub is None:
            warnings.append("no PUBLISHED version: the plan is not shown until one is published")
        elif str(pub.get("currency") or "INR") != "INR":
            warnings.append("the published version is not in INR: paid plans are sold in INR only")
        else:
            labels = rows(db, "SELECT i.display_cap_text, f.label" + (
                ", f.tenant_label" if _has_tenant_label(db) else "") + " FROM ai_plan_item i JOIN ai_billing_feature "
                "f ON f.feature_key = i.feature_key WHERE i.plan_version_id = CAST(:v AS UUID)", {"v": str(pub["id"])})
            shown = [r.get("display_cap_text") for r in labels] + [r.get("tenant_label") or r.get("label") for r in labels]
            leaked = brand_words(shown)
            if leaked:
                warnings.append("feature labels / cap texts of the published version contain "
                                f"{', '.join(leaked)}: set the features' tenant_label (and cap texts in a new version)")
    sets = ", ".join((f"{k} = CAST(:{k} AS JSONB)" if k == "highlights" else f"{k} = :{k}") for k in ch)
    try:
        new = one(db, f"UPDATE ai_plan SET {sets}, listing_updated_by = :_a, listing_updated_at = now(), "
                      "updated_at = now() WHERE id = CAST(:p AS UUID) RETURNING *", {**ch, "p": str(plan["id"]), "_a": actor})
        audit(db, "ai_plan", f"{plan['plan_key']}:listing", {k: jsonish(plan.get(k)) for k in ch},
              {k: (json.loads(v) if k == "highlights" else v) for k, v in ch.items()}, reason, actor)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "plan listing")
    commit(db)
    out = plan_out(new)
    out["warnings"] = warnings
    return out


def _has_tenant_label(db: Session) -> bool:
    from . import plans_billing_internal as pb
    return pb.has_column(db, "ai_billing_feature", "tenant_label")


def _clean_ids(values: Iterable[Any], what: str) -> List[str]:
    out: List[str] = []
    for v in values:
        x = str(v or "").strip()
        if not x:
            continue
        if len(x) > 64:
            raise HTTPException(status_code=422, detail=f"{what} must be at most 64 characters")
        if x not in out:
            out.append(x)
    return out


def _clean_segments(values: Iterable[Any]) -> List[str]:
    out: List[str] = []
    for v in values:
        x = str(v or "").strip().lower()
        if not x:
            continue
        if not SEGMENT_RE.match(x):
            raise HTTPException(status_code=422, detail=f"segment {v!r}: a-z, 0-9, _ and -, up to 48 characters")
        if x not in out:
            out.append(x)
    return out


def _audience_rows(db: Session, plan_id: Optional[str]) -> Dict[str, Any]:
    """The active ai_storefront_audience rules of a plan (or of the storefront: None)."""
    plan_sql = "plan_id = CAST(:p AS UUID)" if plan_id else "plan_id IS NULL"
    rs = rows(db, f"SELECT rule, institute_id, segment_key FROM ai_storefront_audience WHERE is_active AND {plan_sql} "
                  "ORDER BY created_at, institute_id, segment_key", {"p": plan_id})
    out: Dict[str, List[str]] = {"institute_ids": [], "segments": [], "exclude_institute_ids": [],
                                 "exclude_segments": []}
    for r in rs:
        excl = str(r.get("rule") or "INCLUDE").upper() == "EXCLUDE"
        if r.get("institute_id"):
            out["exclude_institute_ids" if excl else "institute_ids"].append(r["institute_id"])
        elif r.get("segment_key"):
            out["exclude_segments" if excl else "segments"].append(r["segment_key"])
    return out


def _replace_audience(db: Session, plan_id: Optional[str], body: AudiencePut, actor: Optional[str],
                      reason: str) -> None:
    """Deactivate the current rules (kept as history) and write the new set."""
    plan_sql = "plan_id = CAST(:p AS UUID)" if plan_id else "plan_id IS NULL"
    db.execute(text(f"UPDATE ai_storefront_audience SET is_active = false WHERE is_active AND {plan_sql}"),
               {"p": plan_id})
    wanted = ([("INCLUDE", i, None) for i in _clean_ids(body.institute_ids, "institute_id")]
              + [("INCLUDE", None, g) for g in _clean_segments(body.segments)]
              + [("EXCLUDE", i, None) for i in _clean_ids(body.exclude_institute_ids, "institute_id")]
              + [("EXCLUDE", None, g) for g in _clean_segments(body.exclude_segments)])
    for rule, iid, seg in wanted:
        db.execute(text("INSERT INTO ai_storefront_audience (id, plan_id, rule, institute_id, segment_key, is_active, "
                        "reason, created_by, created_at) VALUES (CAST(:id AS UUID), CAST(:p AS UUID), :r, :i, :g, true, "
                        ":why, :a, now())"),
                   {"id": str(uuid.uuid4()), "p": plan_id, "r": rule, "i": iid, "g": seg, "why": reason,
                    "a": actor or "unknown"})


@router.get("/plans/{plan_ref}/audience", summary="Institutes and segments a plan is offered to")
def get_plan_audience(plan_ref: str, db: Session = Depends(db_dependency)):
    require_tables(db)
    _billing_module(db)
    plan = get_plan(db, plan_ref)
    out = _audience_rows(db, str(plan["id"]))
    out["audience_mode"] = plan.get("audience_mode")
    return out


@router.put("/plans/{plan_ref}/audience", summary="Replace the institutes / segments a plan is offered to")
def put_plan_audience(plan_ref: str, body: AudiencePut, db: Session = Depends(db_dependency),
                      current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    _billing_module(db)
    reason = need_reason(body.reason)
    actor = actor_of(current_user)
    plan = get_plan(db, plan_ref, for_update=True)
    old = _audience_rows(db, str(plan["id"]))
    try:
        _replace_audience(db, str(plan["id"]), body, actor, reason)
        new = _audience_rows(db, str(plan["id"]))
        audit(db, "ai_storefront_audience", f"plan:{plan['plan_key']}", old, new, reason, actor)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "audience")
    commit(db)
    return {**new, "audience_mode": plan.get("audience_mode")}


@router.get("/storefront/audience", summary="Institutes and segments the plans page is open to (ALLOWLIST / SEGMENTS)")
def get_storefront_audience(db: Session = Depends(db_dependency)):
    require_tables(db)
    pb = _billing_module(db)
    out = _audience_rows(db, None)
    segs: Dict[str, List[str]] = {}
    for r in rows(db, "SELECT institute_id, segment_key FROM ai_institute_segment ORDER BY segment_key, institute_id"):
        segs.setdefault(r["segment_key"], []).append(r["institute_id"])
    out["segment_members"] = segs
    out["mode"] = pb.storefront_mode()
    return out


@router.put("/storefront/audience", summary="Replace who the plans page is open to")
def put_storefront_audience(body: AudiencePut, db: Session = Depends(db_dependency),
                            current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    _billing_module(db)
    reason = need_reason(body.reason)
    actor = actor_of(current_user)
    xact_lock(db, "ai_storefront_audience")
    old = _audience_rows(db, None)
    try:
        _replace_audience(db, None, body, actor, reason)
        new = _audience_rows(db, None)
        audit(db, "ai_storefront_audience", "storefront", old, new, reason, actor)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "audience")
    commit(db)
    return new


@router.put("/storefront/segments/{segment}", summary="Replace the institutes in a segment")
def put_segment(segment: str, body: SegmentPut, db: Session = Depends(db_dependency),
                current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    _billing_module(db)
    reason = need_reason(body.reason)
    actor = actor_of(current_user)
    seg = _clean_segments([segment])
    if not seg:
        raise HTTPException(status_code=422, detail="segment is required")
    seg_key = seg[0]
    ids = _clean_ids(body.institute_ids, "institute_id")
    xact_lock(db, f"ai_institute_segment:{seg_key}")
    old = [r["institute_id"] for r in rows(db, "SELECT institute_id FROM ai_institute_segment WHERE segment_key = :g "
                                                "ORDER BY institute_id", {"g": seg_key})]
    try:
        db.execute(text("DELETE FROM ai_institute_segment WHERE segment_key = :g"), {"g": seg_key})
        for i in ids:
            db.execute(text("INSERT INTO ai_institute_segment (institute_id, segment_key, created_by, created_at) "
                            "VALUES (:i, :g, :a, now())"), {"i": i, "g": seg_key, "a": actor or "unknown"})
        audit(db, "ai_storefront_audience", f"segment:{seg_key}", old, sorted(ids), reason, actor)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "segment")
    commit(db)
    return {"segment": seg_key, "institute_ids": sorted(ids)}


@router.get("/storefront/institutes", summary="Per-institute storefront switches and brand-mode overrides")
def list_storefront_institutes(institute_id: Optional[str] = Query(None, max_length=64),
                               db: Session = Depends(db_dependency)):
    require_tables(db)
    _billing_module(db)
    sql = "SELECT * FROM ai_storefront_institute"
    params: Dict[str, Any] = {}
    if institute_id:
        sql += " WHERE institute_id = :i"
        params["i"] = institute_id.strip()
    rs = rows(db, sql + " ORDER BY updated_at DESC LIMIT 1000", params)
    names = institute_names(db, [r["institute_id"] for r in rs])
    return {"institutes": [{"institute_id": r["institute_id"], "institute_name": names.get(r["institute_id"]),
                            "storefront_enabled": r.get("storefront_enabled"),
                            "brand_mode_override": r.get("brand_mode_override"), "reason": r.get("reason"),
                            "updated_by": r.get("updated_by"),
                            "updated_at": iso(r.get("updated_at"))} for r in rs]}


@router.put("/storefront/institutes/{institute_id}", summary="Switch the plans page on/off for one institute; "
                                                             "override its brand mode")
def put_storefront_institute(institute_id: str, body: StorefrontInstitutePut, db: Session = Depends(db_dependency),
                             current_user: CustomUserDetails = Depends(get_current_user)):
    require_tables(db)
    _billing_module(db)
    reason = need_reason(body.reason)
    actor = actor_of(current_user)
    iid = _institute(institute_id)
    brand = body.brand_mode_override
    if brand is not None:
        brand = (str(brand).strip().upper() or None)
        if brand is not None:
            brand = _upper(brand, ("VACADEMY", "NEUTRAL"), "brand_mode_override")
    old = one(db, "SELECT * FROM ai_storefront_institute WHERE institute_id = :i FOR UPDATE", {"i": iid})
    try:
        new = one(db, (
            "INSERT INTO ai_storefront_institute (institute_id, brand_mode_override, storefront_enabled, reason, "
            "updated_by, updated_at) VALUES (:i, :b, :e, :r, :a, now()) ON CONFLICT (institute_id) DO UPDATE SET "
            "brand_mode_override = EXCLUDED.brand_mode_override, storefront_enabled = EXCLUDED.storefront_enabled, "
            "reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING *"),
            {"i": iid, "b": brand, "e": body.storefront_enabled, "r": reason, "a": actor})
        audit(db, "ai_storefront_institute", iid,
              {k: (old or {}).get(k) for k in ("storefront_enabled", "brand_mode_override")},
              {"storefront_enabled": body.storefront_enabled, "brand_mode_override": brand}, reason, actor)
    except DBAPIError as exc:
        _rollback(db)
        raise _db_error(exc, "storefront institute")
    commit(db)
    return {"institute_id": iid, "storefront_enabled": new.get("storefront_enabled"),
            "brand_mode_override": new.get("brand_mode_override"), "updated_at": iso(new.get("updated_at"))}


@router.get("/storefront/preview", summary="What one institute's admins would see on the plans page")
def storefront_preview(institute_id: str = Query(..., min_length=1, max_length=64),
                       db: Session = Depends(db_dependency)):
    require_tables(db)
    pb = _billing_module(db)
    try:
        return pb.catalog(db, institute_id.strip(), preview=True)
    finally:
        _rollback(db)


__all__ = ["router"]
