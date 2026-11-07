"""
Paid AI plans: subscription and charge state (payments design 2026-10-16,
contract [A]; red-team critique #3-#10 applied). Service-to-service only
(X-Internal-Service-Token, the same guard as /internal/plans/v1/roll).
admin_core is the only caller: it owns Razorpay, GST, invoices and the tenant
facade; ai_service owns plan eligibility, the subscription and every amount
owed (ai_subscription_charge, V590).

  GET   /storefront/catalog?institute_id=[&preview=true]
        listed + audience-eligible plans with a PUBLISHED INR version, their
        items (tenant_label, mode, display_cap_text), price, the action the
        institute can take, the current subscription (PENDING included), the
        latest mandate and whether the storefront is open for the institute.
  POST  /subscriptions/quote      {institute_id, plan_version_id, action NEW|UPGRADE|DOWNGRADE}
  POST  /subscriptions/checkout   {institute_id, plan_version_id, actor, idempotency_key}
        -> a PENDING subscription (source PAYMENT, enforcement LIVE) + its DUE
           PERIOD charge. Same institute + version again = the same rows
           (replayed); another version supersedes the earlier checkout.
  POST  /subscriptions/{sid}/change {action UPGRADE|DOWNGRADE|CANCEL|RESUME, plan_version_id?, actor}
  GET   /charges?status=&needs_collection=&institute_id=&subscription_id=&charge_id=
  PATCH /charges/{cid}            link / mandate / tax snapshot / collection status
  POST  /charges/{cid}/paid       {platform_payment_id, vendor_payment_id, amount_minor, currency?, paid_at?}
  POST  /charges/{cid}/refunded   {vendor_payment_id, amount_minor, total_refunded_minor?, refund_id? | vendor_refund_id?}
  POST  /charges/{cid}/void       {reason, actor?}
  POST  /charges/{cid}/waive      {reason, actor}  (staff: benefits without payment)

Money rules
-----------
* Prepaid: a period of a PAYMENT subscription exists (and gives benefits, see
  services/metering/plans.py) only once its charge is PAID (or staff-WAIVED).
  The roll job never creates periods for paid plans; it creates the renewal
  CHARGE (T-7 days), moves an unpaid renewal to GRACE at the period end and
  to EXPIRED after grace_days, and expires an unpaid checkout.
* /paid locks the institute (pg_advisory_xact_lock 'ai_subscription:<iid>', the
  lock every subscription writer takes, transaction-scoped so it is safe behind
  pgbouncer transaction pooling) and the charge row FOR UPDATE; the paid amount
  must equal the charge's total_minor snapshot (409 AMOUNT_MISMATCH otherwise);
  the same vendor_payment_id again is ALREADY_PROCESSED; a second payment for a
  paid charge is DUPLICATE and a payment for a void / out-of-date charge is
  REFUND_REQUIRED (200 with that action: admin_core records the disposition
  and refunds; never a 500 loop).
* /refunded must name the charge's own vendor_payment_id (409 otherwise).
* Every statement is plain SQL on the admin_core database (Postgres); psycopg 3
  never reports a reliable rowcount, so RETURNING decides everywhere.

Proration (D8): day-based in India time (IST, no DST). remaining = IST days from
today to the period end (today counts), period = IST days of the period;
net = round(new_price*remaining/period) - round(old_price*remaining/period),
floored at 0; the allowance grows by (new - old) * remaining / period. An
upgrade applies when its charge is paid; one below Rs 1 applies at once, free.
Downgrades and cancels take effect at the period end; no self-serve refunds.
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, Iterable, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from ..db import db_dependency
from ..dependencies import require_internal_service_token
from . import plans_admin as pa

logger = logging.getLogger(__name__)

UTC = timezone.utc
#: India Standard Time: a fixed +05:30 offset (no DST), so no tz database is needed
IST = timezone(timedelta(hours=5, minutes=30), "IST")

PAYMENTS_SETTING = "billing.subscriptions.payments.enabled"
AUTOPAY_SETTING = "billing.autopay.enabled"
STOREFRONT_SETTING = "billing.storefront.mode"

ACTOR = "system:plans-billing"
#: the renewal charge is created this long before the period end (the T-7 link)
RENEWAL_LEAD = timedelta(days=7)
#: an unpaid first checkout lapses after this (the 48 h first-purchase link)
CHECKOUT_TTL = timedelta(hours=48)
#: extra time after the link's own expiry before the roll expires a checkout
#: (a payment made at the last minute must still find its charge)
EXPIRY_SLACK = timedelta(hours=1)
#: an upgrade quote / link is meant to be paid within about an hour (the remaining
#: days shrink); an unpaid UPGRADE charge is voided by the roll after a day
UPGRADE_QUOTE_TTL = timedelta(hours=1)
UPGRADE_STALE = timedelta(hours=24)
#: RBI e-mandate AFA-free ceiling per debit (Rs 15,000): above it renewals use links
AFA_CEILING_MINOR = 1_500_000
#: Razorpay's smallest payment is Re 1 (100 paise); smaller upgrades are applied free
MIN_CHARGE_MINOR = 100
#: pre-debit notice for mandate debits (UPI Autopay / card e-mandate rules)
PRE_DEBIT_NOTICE = timedelta(hours=24)
GST_RATE_BPS = 1800

CHARGE_KINDS = ("PERIOD", "UPGRADE")
CHARGE_OPEN = ("DUE", "LINK_SENT", "DEBIT_SCHEDULED", "FAILED")
CHARGE_PAID = ("PAID", "REFUNDED", "PARTIALLY_REFUNDED")
PATCH_STATUSES = ("DUE", "LINK_SENT", "DEBIT_SCHEDULED", "FAILED")
PAID_PERIOD = ("PAID", "WAIVED", "COMPLIMENTARY")
ACTIONS = ("NEW", "UPGRADE", "DOWNGRADE")
CHANGE_ACTIONS = ("UPGRADE", "DOWNGRADE", "CANCEL", "RESUME")
STOREFRONT_MODES = ("OFF", "ALLOWLIST", "SEGMENTS", "ALL")
AUDIENCE_MODES = ("ALL", "ALLOWLIST", "SEGMENT")
BILLING_TABLES = ("ai_subscription_charge", "ai_subscription_mandate", "ai_storefront_audience",
                  "ai_storefront_institute", "ai_institute_segment")
STATE_RE = re.compile(r"^\d{2}$")

router = APIRouter(
    prefix="/internal/plans/v1",
    tags=["Internal AI plans — billing"],
    dependencies=[Depends(require_internal_service_token)],
)


# ── readiness, settings ─────────────────────────────────────────────────────

_ready: Dict[str, Any] = {"ok_until": 0.0}
_cols: Dict[Tuple[str, str], Tuple[float, bool]] = {}


def reset_for_tests() -> None:
    _ready["ok_until"] = 0.0
    _cols.clear()


def billing_ready(db: Session) -> bool:
    """True once the V588 tables and the V590 billing tables exist (remembered 60 s)."""
    now = time.monotonic()
    if now < _ready["ok_until"]:
        return True
    if not pa.tables_ready(db):
        return False
    try:
        sql = "SELECT " + ", ".join(f"to_regclass('{t}') IS NOT NULL" for t in BILLING_TABLES)
        row = db.execute(text(sql)).fetchone()
        ok = bool(row) and all(bool(v) for v in row)
    except Exception:  # noqa: BLE001
        logger.warning("could not check for the AI plan billing tables", exc_info=True)
        pa._rollback(db)  # noqa: SLF001
        return False
    if ok:
        _ready["ok_until"] = now + 60.0
    return ok


def require_billing(db: Session) -> None:
    if not billing_ready(db):
        raise HTTPException(status_code=503, detail={
            "code": "BILLING_TABLES_MISSING",
            "message": "the AI plan billing tables are missing: deploy admin_core (Flyway V590) first"})


def has_column(db: Session, table: str, column: str) -> bool:
    """Whether a column exists (cached 60 s; False on any problem)."""
    key = (table, column)
    hit = _cols.get(key)
    now = time.monotonic()
    if hit is not None and now - hit[0] < 60.0:
        return hit[1]
    try:
        ok = db.execute(text("SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() "
                             "AND table_name = :t AND column_name = :c"), {"t": table, "c": column}).first() is not None
    except Exception:  # noqa: BLE001
        pa._rollback(db)  # noqa: SLF001
        ok = False
    _cols[key] = (now, ok)
    return ok


def _setting(key: str, default: Any) -> Any:
    try:
        from ..services.metering.cache import setting_value
        return setting_value(key, default)
    except Exception:  # noqa: BLE001
        return default


def _flag(key: str) -> bool:
    try:
        from ..services.metering.cache import as_bool
        return as_bool(_setting(key, False), False)
    except Exception:  # noqa: BLE001
        return False


def payments_enabled() -> bool:
    return _flag(PAYMENTS_SETTING)


def autopay_enabled() -> bool:
    return _flag(AUTOPAY_SETTING)


def storefront_mode() -> str:
    v = str(_setting(STOREFRONT_SETTING, "OFF") or "OFF").strip().upper()
    return v if v in STOREFRONT_MODES else "OFF"


def _err(status: int, code: str, message: str, /, **extra: Any) -> HTTPException:
    # positional-only: extra detail keys may themselves be called status / code / message
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def require_payments() -> None:
    if not payments_enabled():
        raise _err(409, "PAYMENTS_OFF", "paid AI plans are switched off (billing.subscriptions.payments.enabled)")


# ── small helpers ───────────────────────────────────────────────────────────

def _aware(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _now() -> datetime:
    return datetime.now(UTC)


def ist_date(value: datetime) -> date:
    return _aware(value).astimezone(IST).date()


def _round(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def base_of(price_minor: int, tax_inclusive: bool) -> int:
    """Taxable value of a price: the price itself, or (tax-inclusive price) the
    price without 18% GST, rounded to the paisa (tax = total - base, never
    recomputed on the base: critique #10)."""
    p = int(price_minor or 0)
    if not tax_inclusive:
        return p
    return _round(Decimal(p) * Decimal(10000) / Decimal(10000 + GST_RATE_BPS))


def _uuid(value: Any, what: str) -> str:
    return pa.valid_uuid(value, what)


def _uid_or_none(value: Any) -> Optional[str]:
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        return None


def _jsonable(value: Any) -> Any:
    return pa.jsonish(value)


def _event(db: Session, sub: Dict[str, Any], kind: str, before: Any, after: Any, actor: Optional[str],
           reason: Optional[str]) -> None:
    pa.sub_event(db, str(sub["id"]), sub["institute_id"], kind, before, after, actor or ACTOR, reason)


def notify(institute_id: str, *, live: Optional[bool] = None, paid: Optional[bool] = None) -> None:
    """After a commit: the plan engine forgets its cached copies of the institute;
    `live` / `paid` update this pod's index at once (other pods within 30 s)."""
    engine = pa.get_plans_engine()
    fn = getattr(engine, "invalidate", None) if engine is not None else None
    if not callable(fn):
        return
    try:
        if live is None:
            fn(institute_id)
        else:
            try:
                fn(institute_id, live=live, paid=paid)
            except TypeError:
                fn(institute_id, live=live)
    except Exception:  # noqa: BLE001
        logger.warning("plans engine invalidate(%s) failed", institute_id, exc_info=True)


# ── rows ────────────────────────────────────────────────────────────────────

def charge_out(r: Dict[str, Any]) -> Dict[str, Any]:
    out = {
        "id": str(r["id"]), "subscription_id": str(r["subscription_id"]), "kind": r.get("kind"),
        "status": r.get("status"), "service_start": pa.iso(r.get("service_start")),
        "service_end": pa.iso(r.get("service_end")),
        "plan_version_id": str(r["plan_version_id"]) if r.get("plan_version_id") else None,
        "base_minor": int(r["base_minor"]) if r.get("base_minor") is not None else None,
        "tax_minor": int(r["tax_minor"]) if r.get("tax_minor") is not None else None,
        "total_minor": int(r["total_minor"]) if r.get("total_minor") is not None else None,
        "place_of_supply": r.get("place_of_supply"), "currency": r.get("currency") or "INR",
        "platform_payment_id": r.get("platform_payment_id"), "vendor_payment_id": r.get("vendor_payment_id"),
        "payment_link_id": r.get("payment_link_id"), "payment_link_url": r.get("payment_link_url"),
        "link_expires_at": pa.iso(r.get("link_expires_at")),
        "mandate_id": str(r["mandate_id"]) if r.get("mandate_id") else None,
        "debit_attempts": int(r.get("debit_attempts") or 0), "next_attempt_at": pa.iso(r.get("next_attempt_at")),
        "pre_debit_notice_sent_at": pa.iso(r.get("pre_debit_notice_sent_at")),
        "period_id": str(r["period_id"]) if r.get("period_id") else None,
        "from_plan_version_id": str(r["from_plan_version_id"]) if r.get("from_plan_version_id") else None,
        "tax_head": r.get("tax_head"), "description": r.get("description"),
        "paid_minor": int(r["paid_minor"]) if r.get("paid_minor") is not None else None,
        "paid_at": pa.iso(r.get("paid_at")), "refunded_minor": int(r.get("refunded_minor") or 0),
        "void_reason": r.get("void_reason"), "institute_id": r.get("institute_id"),
        "created_at": pa.iso(r.get("created_at")), "updated_at": pa.iso(r.get("updated_at")),
    }
    for k in ("subscription_status", "source", "plan_key", "plan_name", "version_no", "sac_code",
              "period_months"):
        if k in r:
            out[k] = r.get(k)
    if "is_tax_inclusive" in r:
        out["is_tax_inclusive"] = bool(r.get("is_tax_inclusive"))
        # a tax-inclusive charge: the price paid is the list price (admin_core derives base / tax from it)
        out["list_price_minor"] = out["total_minor"] if out["is_tax_inclusive"] else None
    return out


def _version(db: Session, vid: Any) -> Optional[Dict[str, Any]]:
    if not _uid_or_none(vid):
        return None
    return pa.one(db, "SELECT v.*, p.plan_key, p.name AS plan_name, p.is_active AS plan_active FROM ai_plan_version v "
                      "JOIN ai_plan p ON p.id = v.plan_id WHERE v.id = CAST(:v AS UUID)", {"v": str(vid)})


def _charge_head(db: Session, cid: str) -> Dict[str, Any]:
    cid = _uuid(cid, "charge")
    head = pa.one(db, "SELECT c.subscription_id::text AS subscription_id, s.institute_id FROM ai_subscription_charge c "
                      "JOIN institute_ai_subscription s ON s.id = c.subscription_id WHERE c.id = CAST(:c AS UUID)",
                  {"c": cid})
    if head is None:
        raise _err(404, "CHARGE_NOT_FOUND", "charge not found")
    return {**head, "charge_id": cid}


def _lock_charge(db: Session, cid: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """(subscription, charge), both locked: the institute's advisory lock first
    (every subscription writer's lock), then the rows FOR UPDATE."""
    head = _charge_head(db, cid)
    pa.xact_lock(db, f"ai_subscription:{head['institute_id']}")
    sub = pa.one(db, "SELECT * FROM institute_ai_subscription WHERE id = CAST(:s AS UUID) FOR UPDATE",
                 {"s": head["subscription_id"]})
    ch = pa.one(db, "SELECT * FROM ai_subscription_charge WHERE id = CAST(:c AS UUID) FOR UPDATE",
                {"c": head["charge_id"]})
    if sub is None or ch is None:
        raise _err(404, "CHARGE_NOT_FOUND", "charge not found")
    return sub, ch


def _lock_sub(db: Session, sid: str) -> Dict[str, Any]:
    sid = _uuid(sid, "subscription")
    head = pa.one(db, "SELECT institute_id FROM institute_ai_subscription WHERE id = CAST(:s AS UUID)", {"s": sid})
    if head is None:
        raise _err(404, "SUBSCRIPTION_NOT_FOUND", "subscription not found")
    pa.xact_lock(db, f"ai_subscription:{head['institute_id']}")
    sub = pa.one(db, "SELECT * FROM institute_ai_subscription WHERE id = CAST(:s AS UUID) FOR UPDATE", {"s": sid})
    if sub is None:
        raise _err(404, "SUBSCRIPTION_NOT_FOUND", "subscription not found")
    return sub


def _set_sub(db: Session, sid: str, fields: Dict[str, Any], actor: Optional[str]) -> Dict[str, Any]:
    uuid_cols = {"plan_version_id", "pending_plan_version_id"}
    sets = ", ".join((f"{k} = CAST(:{k} AS UUID)" if k in uuid_cols else f"{k} = :{k}") for k in fields)
    return pa.one(db, f"UPDATE institute_ai_subscription SET {sets}, updated_by = :_actor, updated_at = now() "
                      "WHERE id = CAST(:_sid AS UUID) RETURNING *", {**fields, "_actor": actor or ACTOR, "_sid": sid})


def _set_charge(db: Session, cid: str, fields: Dict[str, Any]) -> Dict[str, Any]:
    uuid_cols = {"period_id", "plan_version_id"}
    parts = []
    params: Dict[str, Any] = {"_cid": cid}
    for k, v in fields.items():
        if k == "mandate_id":
            # type-agnostic: whatever the mandate id column type is, take the row's own id
            parts.append("mandate_id = (SELECT m.id FROM ai_subscription_mandate m WHERE CAST(m.id AS TEXT) = :mandate_id)")
        elif k in uuid_cols:
            parts.append(f"{k} = CAST(:{k} AS UUID)")
        elif k == "quote_json":
            parts.append("quote_json = CAST(:quote_json AS JSONB)")
            v = json.dumps(_jsonable(v)) if v is not None else None
        else:
            parts.append(f"{k} = :{k}")
        params[k] = v
    return pa.one(db, f"UPDATE ai_subscription_charge SET {', '.join(parts)}, updated_at = now() "
                      "WHERE id = CAST(:_cid AS UUID) RETURNING *", params)


def _paid_periods(db: Session, sid: str) -> List[Dict[str, Any]]:
    return pa.rows(db, "SELECT * FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID) "
                       "AND payment_status = ANY(CAST(:ps AS VARCHAR[])) ORDER BY period_start",
                   {"s": sid, "ps": list(PAID_PERIOD)})


def _period_at(periods: List[Dict[str, Any]], at: datetime) -> Optional[Dict[str, Any]]:
    for p in periods:
        if _aware(p["period_start"]) <= at < _aware(p["period_end"]):
            return p
    return None


def _open_charges(db: Session, sid: str, *, kind: Optional[str] = None,
                  from_start: Optional[datetime] = None) -> List[Dict[str, Any]]:
    sql = ("SELECT * FROM ai_subscription_charge WHERE subscription_id = CAST(:s AS UUID) "
           "AND status = ANY(CAST(:st AS VARCHAR[]))")
    params: Dict[str, Any] = {"s": sid, "st": list(CHARGE_OPEN)}
    if kind:
        sql += " AND kind = :k"
        params["k"] = kind
    if from_start is not None:
        sql += " AND service_start >= :fs"
        params["fs"] = from_start
    return pa.rows(db, sql + " ORDER BY created_at FOR UPDATE", params)


def _void(db: Session, sub: Dict[str, Any], charges: List[Dict[str, Any]], reason: str, actor: Optional[str],
          sink: Optional[List[Dict[str, Any]]] = None, dry_run: bool = False) -> List[Dict[str, Any]]:
    """VOID open charges; returns what admin_core must clean up (links to cancel)."""
    out = []
    for c in charges:
        if c.get("status") not in CHARGE_OPEN:
            continue
        info = {"charge_id": str(c["id"]), "subscription_id": str(sub["id"]), "institute_id": sub["institute_id"],
                "kind": c.get("kind"), "reason": reason, "platform_payment_id": c.get("platform_payment_id"),
                "payment_link_id": c.get("payment_link_id"), "mandate_id": str(c["mandate_id"]) if c.get("mandate_id")
                else None}
        if not dry_run:
            _set_charge(db, str(c["id"]), {"status": "VOID", "void_reason": reason[:64]})
            _event(db, sub, "CHARGE_VOIDED", {"charge_id": str(c["id"]), "status": c.get("status")},
                   {"charge_id": str(c["id"]), "status": "VOID"}, actor, reason)
        out.append(info)
    if sink is not None:
        sink.extend(out)
    return out


def _insert_charge(db: Session, sub: Dict[str, Any], *, kind: str, start: datetime, end: datetime,
                   version: Dict[str, Any], base_minor: int, total_minor: Optional[int] = None,
                   actor: Optional[str] = None, reason: Optional[str] = None,
                   extra_event: Optional[Dict[str, Any]] = None, from_version: Optional[Dict[str, Any]] = None,
                   quote: Optional[Dict[str, Any]] = None, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
    """A DUE charge. Tax-inclusive prices carry their total at once (tax = total - base);
    otherwise tax / total / place of supply arrive from admin_core (PATCH)."""
    tax = (int(total_minor) - int(base_minor)) if total_minor is not None else None
    desc = describe({"kind": kind, "service_start": start, "service_end": end}, version, from_version)
    row = pa.one(db, (
        "INSERT INTO ai_subscription_charge (id, subscription_id, institute_id, kind, status, service_start, "
        "service_end, plan_version_id, from_plan_version_id, currency, is_tax_inclusive, sac_code, description, "
        "base_minor, tax_minor, total_minor, quote_json, idempotency_key, debit_attempts, refunded_minor, created_by, "
        "created_at, updated_at) VALUES (CAST(:id AS UUID), CAST(:s AS UUID), :i, :k, 'DUE', :ss, :se, "
        "CAST(:v AS UUID), CAST(:fv AS UUID), :cur, :incl, :sac, :desc, :b, :t, :tot, CAST(:q AS JSONB), :idem, 0, 0, "
        ":actor, now(), now()) RETURNING *"), {
        "id": str(uuid.uuid4()), "s": str(sub["id"]), "i": sub["institute_id"], "k": kind, "ss": start, "se": end,
        "v": str(version["id"]), "fv": str(from_version["id"]) if from_version else None,
        "cur": str(version.get("currency") or "INR"), "incl": bool(version.get("is_tax_inclusive")),
        "sac": version.get("sac_code"), "desc": desc, "b": int(base_minor), "t": tax, "tot": total_minor,
        "q": json.dumps(_jsonable(quote)) if quote is not None else None, "idem": idempotency_key,
        "actor": actor or ACTOR})
    _event(db, sub, "CHARGE_CREATED", None,
           {"charge_id": str(row["id"]), "kind": kind, "service_start": pa.iso(start), "service_end": pa.iso(end),
            "plan_version_id": str(version["id"]), "base_minor": int(base_minor), **(extra_event or {})},
           actor, reason)
    return row


def _price_terms(sub: Dict[str, Any], version: Dict[str, Any]) -> Tuple[int, Optional[int]]:
    """(base_minor, total_minor or None) of one period of `version` for `sub`."""
    price = sub.get("price_override_minor")
    if price is None:
        price = version.get("price_minor") or 0
    incl = bool(version.get("is_tax_inclusive"))
    return base_of(int(price), incl), (int(price) if incl else None)


def _next_window(sub: Dict[str, Any], start: datetime) -> datetime:
    anchor = _aware(sub["anchor_at"])
    pm = int(sub.get("period_months") or 1)
    _, end = pa.period_bounds(anchor, pm, start)
    if end <= start:
        end = pa.add_months(start, pm)
    return end


def _renewal_version(db: Session, sub: Dict[str, Any]) -> Dict[str, Any]:
    if sub.get("pending_plan_version_id"):
        v = _version(db, sub["pending_plan_version_id"])
        if v is not None and v.get("status") == "PUBLISHED":
            return v
    return _version(db, sub["plan_version_id"]) or {}


def ensure_renewal_charge(db: Session, sub: Dict[str, Any], p_end: datetime, *, actor: Optional[str] = None,
                          dry_run: bool = False) -> Tuple[Optional[Dict[str, Any]], bool]:
    """The PERIOD charge for the period starting at `p_end`, created (DUE) when
    missing. (charge, created). A renewal below Re 1 opens a WAIVED period instead."""
    existing = pa.one(db, "SELECT * FROM ai_subscription_charge WHERE subscription_id = CAST(:s AS UUID) "
                          "AND kind = 'PERIOD' AND service_start = :ss AND status <> 'VOID' LIMIT 1",
                      {"s": str(sub["id"]), "ss": p_end})
    if existing is not None:
        return existing, False
    version = _renewal_version(db, sub)
    if not version:
        return None, False
    if dry_run:
        return None, True
    end = _next_window(sub, p_end)
    base, total = _price_terms(sub, version)
    if (total if total is not None else base) < MIN_CHARGE_MINOR:
        # a free renewal (price 0): no charge, the period is opened WAIVED
        pa.ensure_period(db, {**sub, "plan_version_id": str(version["id"])}, p_end, end, version)
        db.execute(text("UPDATE ai_subscription_period SET payment_status = 'WAIVED' WHERE subscription_id = "
                        "CAST(:s AS UUID) AND period_start = :ps AND payment_status = 'DUE'"),
                   {"s": str(sub["id"]), "ps": p_end})
        _event(db, sub, "RENEWED", None, {"period_start": pa.iso(p_end), "payment_status": "WAIVED"}, actor,
               "renewal priced below Re 1: no charge")
        return None, False
    row = _insert_charge(db, sub, kind="PERIOD", start=p_end, end=end, version=version, base_minor=base,
                         total_minor=total, actor=actor, reason="renewal charge")
    return row, True


def _open_period(db: Session, sub: Dict[str, Any], start: datetime, end: datetime, version: Dict[str, Any],
                 price_snapshot: int, status: str) -> Dict[str, Any]:
    """The period row [start, end) with payment `status`; an existing unpaid row
    for that start is updated (RETURNING decides, never the rowcount)."""
    row = pa.one(db, (
        "INSERT INTO ai_subscription_period (id, subscription_id, period_start, period_end, plan_version_id, "
        "price_minor_snapshot, allowance_credits, allowance_used, payment_status, created_at) VALUES "
        "(CAST(:id AS UUID), CAST(:s AS UUID), :ps, :pe, CAST(:v AS UUID), :price, :allow, 0, :pay, now()) "
        "ON CONFLICT (subscription_id, period_start) DO NOTHING RETURNING *"), {
        "id": str(uuid.uuid4()), "s": str(sub["id"]), "ps": start, "pe": end, "v": str(version["id"]),
        "price": int(price_snapshot), "allow": version.get("allowance_credits") or 0, "pay": status})
    if row is not None:
        return row
    row = pa.one(db, "UPDATE ai_subscription_period SET payment_status = :pay, plan_version_id = CAST(:v AS UUID), "
                     "price_minor_snapshot = :price, period_end = :pe WHERE subscription_id = CAST(:s AS UUID) "
                     "AND period_start = :ps AND payment_status NOT IN ('PAID','WAIVED','COMPLIMENTARY') RETURNING *",
                 {"pay": status, "v": str(version["id"]), "price": int(price_snapshot), "pe": end,
                  "s": str(sub["id"]), "ps": start})
    if row is None:
        raise _err(409, "PERIOD_ALREADY_PAID", "the period is already paid")
    return row


# ── proration ───────────────────────────────────────────────────────────────

def prorate(old_price: int, new_price: int, old_allowance: Any, new_allowance: Any, period_start: datetime,
            period_end: datetime, now: datetime) -> Dict[str, Any]:
    """Day-based (IST) upgrade quote. Pure."""
    ps_d, pe_d, now_d = ist_date(period_start), ist_date(period_end), ist_date(now)
    period_days = max((pe_d - ps_d).days, 1)
    remaining = min(max((pe_d - now_d).days, 0), period_days)
    frac = Decimal(remaining) / Decimal(period_days)
    credit = _round(Decimal(int(old_price)) * frac)
    new = _round(Decimal(int(new_price)) * frac)
    net = max(0, new - credit)
    delta = ((Decimal(str(new_allowance or 0)) - Decimal(str(old_allowance or 0))) * frac).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP)
    return {"period_days": period_days, "remaining_days": remaining, "old_price_minor": int(old_price),
            "new_price_minor": int(new_price), "credit_minor": credit, "new_minor": new, "base_minor": net,
            "allowance_delta": float(delta), "free": net < MIN_CHARGE_MINOR}


def _proration(q: Dict[str, Any]) -> Dict[str, Any]:
    """The proration detail of a quote, nested (admin_core shows it as is)."""
    return {k: q[k] for k in ("remaining_days", "period_days", "credit_minor", "new_minor", "new_price_minor",
                              "old_price_minor", "allowance_delta") if k in q}


def _live_paid_sub(db: Session, iid: str) -> Optional[Dict[str, Any]]:
    return pa.one(db, "SELECT * FROM institute_ai_subscription WHERE institute_id = :i "
                      "AND status IN ('TRIAL','ACTIVE','GRACE') ORDER BY created_at DESC LIMIT 1", {"i": iid})


def _has_active_overrides(db: Session, sid: str) -> bool:
    return pa.one(db, "SELECT 1 AS x FROM ai_subscription_override WHERE subscription_id = CAST(:s AS UUID) "
                      "AND is_active LIMIT 1", {"s": sid}) is not None


def change_check(db: Session, sub: Optional[Dict[str, Any]], target: Dict[str, Any], now: datetime
                 ) -> Dict[str, Any]:
    """What the institute's live subscription can do with `target`: {action,
    code?, current_period?, current_version?}. action UPGRADE / DOWNGRADE /
    CURRENT / CONTACT_SALES / SUBSCRIBE / PAY_RENEWAL_FIRST."""
    if sub is None:
        return {"action": "SUBSCRIBE"}
    if str(sub["plan_version_id"]) == str(target["id"]):
        return {"action": "CURRENT"}
    if str(sub.get("source") or "").upper() != "PAYMENT":
        return {"action": "CONTACT_SALES", "code": "NOT_A_PAID_PLAN"}
    if sub.get("price_override_minor") is not None or _has_active_overrides(db, str(sub["id"])):
        return {"action": "CONTACT_SALES", "code": "CUSTOM_DEAL"}
    periods = _paid_periods(db, str(sub["id"]))
    cur = _period_at(periods, now)
    if sub["status"] == "GRACE" or cur is None:
        return {"action": "PAY_RENEWAL_FIRST", "code": "PAY_RENEWAL_FIRST"}
    cur_v = _version(db, cur["plan_version_id"]) or {}
    if str(cur_v.get("id")) == str(target["id"]):
        return {"action": "CURRENT"}
    if int(cur_v.get("period_months") or 1) != int(target.get("period_months") or 1) or \
            bool(cur_v.get("is_tax_inclusive")) != bool(target.get("is_tax_inclusive")) or \
            str(cur_v.get("currency") or "INR") != str(target.get("currency") or "INR"):
        return {"action": "CONTACT_SALES", "code": "DIFFERENT_BILLING_TERMS"}
    old_price, new_price = int(cur_v.get("price_minor") or 0), int(target.get("price_minor") or 0)
    if new_price > old_price:
        later = [p for p in periods if _aware(p["period_start"]) >= _aware(cur["period_end"])]
        if later:
            return {"action": "CONTACT_SALES", "code": "RENEWAL_ALREADY_PAID"}
        return {"action": "UPGRADE", "current_period": cur, "current_version": cur_v}
    return {"action": "DOWNGRADE", "current_period": cur, "current_version": cur_v}


def quote_for(db: Session, iid: str, target: Dict[str, Any], action: str, now: datetime) -> Dict[str, Any]:
    sub = _live_paid_sub(db, iid)
    out: Dict[str, Any] = {"action": action, "plan_version_id": str(target["id"]), "currency": target.get("currency"),
                           "is_tax_inclusive": bool(target.get("is_tax_inclusive")),
                           "sac_code": target.get("sac_code"), "period_months": int(target.get("period_months") or 1)}
    if action == "NEW":
        if sub is not None:
            raise _err(409, "ALREADY_SUBSCRIBED", "the institute already has a plan: change it instead")
        pm = int(target.get("period_months") or 1)
        price = int(target.get("price_minor") or 0)
        incl = bool(target.get("is_tax_inclusive"))
        out.update(base_minor=base_of(price, incl), total_minor=price if incl else None, price_minor=price,
                   period_start=pa.iso(now), period_end=pa.iso(pa.add_months(now, pm)),
                   note="the period starts when the payment is received")
        return out
    chk = change_check(db, sub, target, now)
    if chk["action"] != action:
        raise _err(409, chk.get("code") or chk["action"], f"{action} is not possible: {chk['action']}",
                   possible=chk["action"])
    cur, cur_v = chk["current_period"], chk["current_version"]
    if action == "UPGRADE":
        q = prorate(int(cur_v.get("price_minor") or 0), int(target.get("price_minor") or 0),
                    cur_v.get("allowance_credits"), target.get("allowance_credits"),
                    _aware(cur["period_start"]), _aware(cur["period_end"]), now)
        incl = bool(target.get("is_tax_inclusive"))
        out.update(q, proration=_proration(q), base_minor=base_of(q["base_minor"], incl) if incl else q["base_minor"],
                   total_minor=q["base_minor"] if incl else None,
                   from_version_id=str(cur_v["id"]), subscription_id=str(sub["id"]), period_id=str(cur["id"]),
                   period_start=pa.iso(cur["period_start"]), period_end=pa.iso(cur["period_end"]),
                   service_start=pa.iso(now), service_end=pa.iso(cur["period_end"]), applies="NOW",
                   quote_expires_at=pa.iso(now + UPGRADE_QUOTE_TTL))
        return out
    out.update(base_minor=0, from_version_id=str(cur_v["id"]), subscription_id=str(sub["id"]),
               effective_at=pa.iso(cur["period_end"]), next_period_price_minor=int(target.get("price_minor") or 0),
               applies="AT_RENEWAL")
    return out


# ── storefront ──────────────────────────────────────────────────────────────

def _is_suborg(db: Session, iid: str) -> bool:
    try:
        if not db.execute(text("SELECT to_regclass('institute_suborg') IS NOT NULL")).scalar():
            return False
        return db.execute(text("SELECT 1 FROM institute_suborg WHERE suborg_id = :i AND suborg_id <> institute_id "
                               "AND COALESCE(upper(status), 'ACTIVE') NOT IN ('DELETED','INACTIVE') LIMIT 1"),
                          {"i": iid}).first() is not None
    except Exception:  # noqa: BLE001
        pa._rollback(db)  # noqa: SLF001
        return False


def institute_segments(db: Session, iid: str) -> List[str]:
    """The institute's segment keys (ai_institute_segment, filled by hand in the portal)."""
    return sorted({str(r["segment_key"]) for r in pa.rows(
        db, "SELECT segment_key FROM ai_institute_segment WHERE institute_id = :i", {"i": iid}) if r.get("segment_key")})


def _audience_hits(db: Session, plan_id: Optional[str], iid: str, segs: List[str]) -> Dict[str, bool]:
    """Active ai_storefront_audience rules matching the institute (by id or by one
    of its segments) for a plan (plan_id) or for the storefront itself (None)."""
    plan_sql = "plan_id = CAST(:p AS UUID)" if plan_id else "plan_id IS NULL"
    out = {"include_institute": False, "include_segment": False, "exclude": False}
    for r in pa.rows(db, f"SELECT rule, institute_id, segment_key FROM ai_storefront_audience WHERE is_active "
                         f"AND {plan_sql} AND (institute_id = :i OR segment_key = ANY(CAST(:g AS VARCHAR[])))",
                     {"p": plan_id, "i": iid, "g": segs or [""]}):
        rule = str(r.get("rule") or "INCLUDE").upper()
        if rule == "EXCLUDE":
            out["exclude"] = True
        elif r.get("institute_id"):
            out["include_institute"] = True
        else:
            out["include_segment"] = True
    return out


def storefront_access(db: Session, iid: str) -> Dict[str, Any]:
    """Whether the institute's admins may see the plans page. Order (first match
    wins): a sub-org child -> no; billing.storefront.mode OFF -> no; paid plans
    switched off -> no; ai_storefront_institute.storefront_enabled FALSE -> no;
    an EXCLUDE rule (institute or one of its segments) -> no; storefront_enabled
    TRUE -> yes; mode ALL -> yes; an INCLUDE rule for the institute -> yes; mode
    SEGMENTS and an INCLUDE rule for one of its segments -> yes; else no."""
    mode = storefront_mode()
    inst = pa.one(db, "SELECT * FROM ai_storefront_institute WHERE institute_id = :i", {"i": iid}) or {}
    out = {"mode": mode, "payments_enabled": payments_enabled(), "autopay_enabled": autopay_enabled(),
           "brand_mode_override": inst.get("brand_mode_override"), "allowed": False, "reason": None,
           "segments": []}
    if _is_suborg(db, iid):
        out["reason"] = "SUBORG"
        return out
    segs = institute_segments(db, iid)
    out["segments"] = segs
    if mode == "OFF":
        out["reason"] = "MODE_OFF"
        return out
    if not out["payments_enabled"]:
        out["reason"] = "PAYMENTS_OFF"
        return out
    enabled = inst.get("storefront_enabled")
    if enabled is False:
        out["reason"] = "INSTITUTE_OFF"
        return out
    hits = _audience_hits(db, None, iid, segs)
    if hits["exclude"]:
        out["reason"] = "EXCLUDED"
        return out
    if enabled is True:
        out.update(allowed=True, reason="INSTITUTE_ON")
    elif mode == "ALL":
        out.update(allowed=True, reason="ALL")
    elif hits["include_institute"]:
        out.update(allowed=True, reason="ALLOWLIST")
    elif mode == "SEGMENTS" and hits["include_segment"]:
        out.update(allowed=True, reason="SEGMENT")
    else:
        out["reason"] = "NOT_IN_ROLLOUT"
    return out


def _audience_ok(db: Session, plan: Dict[str, Any], iid: str, segs: List[str]) -> bool:
    """ai_plan.audience_mode: ALL = everyone with the storefront; ALLOWLIST = an
    INCLUDE rule for the institute; SEGMENT = an INCLUDE rule for one of its
    segments (or the institute itself). An EXCLUDE rule always wins."""
    mode = str(plan.get("audience_mode") or "ALLOWLIST").upper()
    hits = _audience_hits(db, str(plan["id"]), iid, segs)
    if hits["exclude"]:
        return False
    if mode == "ALL":
        return True
    if mode == "ALLOWLIST":
        return hits["include_institute"]
    if mode == "SEGMENT":
        return hits["include_segment"] or hits["include_institute"]
    return False


def _listing_version(db: Session, plan_id: str) -> Optional[Dict[str, Any]]:
    return pa.one(db, "SELECT v.*, p.plan_key, p.name AS plan_name FROM ai_plan_version v JOIN ai_plan p "
                      "ON p.id = v.plan_id WHERE v.plan_id = CAST(:p AS UUID) AND v.status = 'PUBLISHED' "
                      "ORDER BY v.version_no DESC LIMIT 1", {"p": plan_id})


def tenant_features(db: Session, vid: str) -> List[Dict[str, Any]]:
    """The version's items as a tenant sees them: tenant label, effective mode,
    the cap text. Never caps, USD or model policy internals."""
    label = "COALESCE(f.tenant_label, f.label)" if has_column(db, "ai_billing_feature", "tenant_label") else "f.label"
    out = []
    for it in pa.rows(db, f"SELECT i.feature_key, i.mode, i.display_cap_text, {label} AS label, f.eligibility, "
                          "f.display_order FROM ai_plan_item i JOIN ai_billing_feature f ON f.feature_key = i.feature_key "
                          "WHERE i.plan_version_id = CAST(:v AS UUID) AND f.is_active "
                          "ORDER BY f.display_order, i.feature_key", {"v": vid}):
        mode = str(it.get("mode") or "CHARGED").upper()
        elig = str(it.get("eligibility") or "")
        if it["feature_key"] in pa.HARD_LOCKED_FEATURES or elig not in pa.ELIGIBILITIES or elig == "ALWAYS_CHARGED":
            mode = "CHARGED"
        elif mode == "INCLUDED" and elig == "ALLOWANCE_ONLY":
            mode = "ALLOWANCE"
        elif mode not in pa.ITEM_MODES:
            mode = "CHARGED"
        out.append({"feature_key": it["feature_key"], "label": it.get("label") or it["feature_key"], "mode": mode,
                    "display_cap_text": it.get("display_cap_text")})
    return out


def _price_out(v: Dict[str, Any]) -> Dict[str, Any]:
    price = int(v.get("price_minor") or 0)
    incl = bool(v.get("is_tax_inclusive"))
    base = base_of(price, incl)
    return {"price_minor": price, "is_tax_inclusive": incl, "base_minor": base,
            "total_minor": price if incl else None, "gst_rate_bps": GST_RATE_BPS,
            "currency": v.get("currency") or "INR", "period_months": int(v.get("period_months") or 1),
            "sac_code": v.get("sac_code")}


def _mandate_out(m: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not m:
        return None
    return {"id": str(m["id"]), "status": m.get("status"), "method": m.get("method"),
            "max_amount_minor": int(m["max_amount_minor"]) if m.get("max_amount_minor") is not None else None,
            "subscription_id": str(m["subscription_id"]) if m.get("subscription_id") else None,
            "registration_link_url": m.get("registration_link_url") if m.get("status") == "PENDING" else None,
            "created_at": pa.iso(m.get("created_at")), "updated_at": pa.iso(m.get("updated_at"))}


def latest_mandate(db: Session, iid: str, sid: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if sid:
        m = pa.one(db, "SELECT * FROM ai_subscription_mandate WHERE subscription_id = CAST(:s AS UUID) "
                       "ORDER BY (status = 'ACTIVE') DESC, created_at DESC LIMIT 1", {"s": sid})
        if m is not None:
            return m
    return pa.one(db, "SELECT * FROM ai_subscription_mandate WHERE institute_id = :i "
                      "ORDER BY (status = 'ACTIVE') DESC, created_at DESC LIMIT 1", {"i": iid})


def subscription_summary(db: Session, iid: str, now: datetime) -> Optional[Dict[str, Any]]:
    """The institute's current subscription (live, else its open PENDING checkout)
    for the tenant facade: status, period, renewal, pending change, open charge."""
    sub = pa.one(db, "SELECT * FROM institute_ai_subscription WHERE institute_id = :i AND status IN "
                     "('TRIAL','ACTIVE','GRACE','PENDING','SCHEDULED') ORDER BY (status IN ('TRIAL','ACTIVE','GRACE')) "
                     "DESC, created_at DESC LIMIT 1", {"i": iid})
    if sub is None:
        return None
    sid = str(sub["id"])
    v = _version(db, sub["plan_version_id"]) or {}
    out: Dict[str, Any] = {"subscription_id": sid, "status": sub["status"], "source": sub.get("source"),
                           "enforcement": sub.get("enforcement"), "plan_id": str(v["plan_id"]) if v.get("plan_id")
                           else None, "plan_key": v.get("plan_key"), "plan_name": v.get("plan_name"),
                           "plan_version_id": str(sub["plan_version_id"]),
                           "cancel_at_period_end": bool(sub.get("cancel_at_period_end")),
                           "auto_renew": bool(sub.get("auto_renew")), "end_at": pa.iso(sub.get("end_at")),
                           "period_start": None, "period_end": None, "renews_at": None, "grace_until": None,
                           "pending_plan": None, "open_charge": None, "price_override_base_minor": None}
    if sub.get("price_override_minor") is not None and v:
        # The institute's own price (custom deal), pre-tax like the plan card's base_minor.
        out["price_override_base_minor"] = _price_terms(sub, v)[0]
    periods = _paid_periods(db, sid) if str(sub.get("source") or "").upper() == "PAYMENT" else pa.rows(
        db, "SELECT * FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID) ORDER BY period_start",
        {"s": sid})
    cur = _period_at(periods, now)
    if cur is not None:
        out["period_start"], out["period_end"] = pa.iso(cur["period_start"]), pa.iso(cur["period_end"])
        cv = _version(db, cur["plan_version_id"]) or {}
        if cv:
            out.update(plan_version_id=str(cv["id"]), plan_key=cv.get("plan_key"), plan_name=cv.get("plan_name"))
    latest = periods[-1] if periods else None
    if latest is not None and sub["status"] in pa.LIVE_STATUSES:
        p_end = _aware(latest["period_end"])
        end_at = _aware(sub.get("end_at"))
        if sub.get("auto_renew") and not sub.get("cancel_at_period_end") and (end_at is None or end_at > p_end):
            out["renews_at"] = pa.iso(p_end)
        if sub["status"] == "GRACE":
            out["grace_until"] = pa.iso(p_end + timedelta(days=int(sub.get("grace_days") or 0)))
    if sub.get("pending_plan_version_id"):
        pv = _version(db, sub["pending_plan_version_id"]) or {}
        out["pending_plan"] = {"plan_version_id": str(sub["pending_plan_version_id"]), "plan_name": pv.get("plan_name"),
                               "effective_at": pa.iso(latest["period_end"]) if latest is not None else None}
    if billing_ready(db):
        oc = pa.one(db, "SELECT * FROM ai_subscription_charge WHERE subscription_id = CAST(:s AS UUID) "
                        "AND status = ANY(CAST(:st AS VARCHAR[])) ORDER BY service_start, created_at LIMIT 1",
                    {"s": sid, "st": list(CHARGE_OPEN)})
        if oc is not None:
            out["open_charge"] = {k: charge_out(oc)[k] for k in (
                "id", "kind", "status", "service_start", "service_end", "base_minor", "tax_minor", "total_minor",
                "currency", "platform_payment_id", "payment_link_url", "link_expires_at", "next_attempt_at")}
            out["open_charge"]["due_at"] = out["open_charge"]["service_start"] if oc.get("kind") == "PERIOD" and \
                sub["status"] != "PENDING" else pa.iso(oc.get("created_at"))
    return out


def catalog(db: Session, iid: str, *, preview: bool = False, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or _now()
    access = storefront_access(db, iid)
    current = subscription_summary(db, iid, now)
    live = _live_paid_sub(db, iid)
    mandate = latest_mandate(db, iid, current["subscription_id"] if current else None)
    out: Dict[str, Any] = {"institute_id": iid, "storefront": access, "current": current,
                           "mandate": _mandate_out(mandate), "plans": []}
    # admin_core's facade reads the current subscription as `subscription` (id) and the
    # charge to pay as a top-level `open_charge` (the full charge, as GET /charges lists it)
    out["subscription"] = {**current, "id": current["subscription_id"]} if current else None
    out["open_charge"] = None
    if current and current.get("open_charge") and current["open_charge"].get("id"):
        full = list_charges(db, charge_id=current["open_charge"]["id"], limit=1, now=now)["charges"]
        out["open_charge"] = full[0] if full else None
    if not (access["allowed"] or preview):
        return out
    segs = access.get("segments") or []
    listing_cols = has_column(db, "ai_plan", "listed")
    plans = pa.rows(db, "SELECT * FROM ai_plan WHERE is_active" + (" AND listed" if listing_cols else " AND false") +
                    (" ORDER BY sort_order, name" if listing_cols else " ORDER BY name"))
    cur_plan_id = current.get("plan_id") if current else None
    seen = set()
    for p in plans:
        if not _audience_ok(db, p, iid, segs):
            continue
        v = _listing_version(db, str(p["id"]))
        if v is None or str(v.get("currency") or "INR") != "INR" or int(v.get("price_minor") or 0) < MIN_CHARGE_MINOR:
            continue
        out["plans"].append(_plan_card(db, p, v, live, now))
        seen.add(str(p["id"]))
    if cur_plan_id and cur_plan_id not in seen and current.get("status") in pa.LIVE_STATUSES:
        p = pa.one(db, "SELECT * FROM ai_plan WHERE id = CAST(:p AS UUID)", {"p": cur_plan_id})
        v = _version(db, current["plan_version_id"])
        if p and v:
            card = _plan_card(db, p, v, live, now)
            card["listed"] = False
            out["plans"].append(card)
    return out


def _plan_card(db: Session, p: Dict[str, Any], v: Dict[str, Any], live: Optional[Dict[str, Any]],
               now: datetime) -> Dict[str, Any]:
    hl = p.get("highlights")
    if isinstance(hl, str):
        try:
            hl = json.loads(hl)
        except ValueError:
            hl = None
    chk = change_check(db, live, v, now)
    card = {"plan_id": str(p["id"]), "plan_key": p.get("plan_key"), "name": p.get("name"),
            "description": p.get("description"), "tagline": p.get("tagline"),
            "highlights": [str(x) for x in hl] if isinstance(hl, list) else [], "badge": p.get("badge"),
            "sort_order": p.get("sort_order"), "listed": bool(p.get("listed")),
            "version_id": str(v["id"]), "version_no": v.get("version_no"), "price": _price_out(v),
            "allowance_credits": pa.num(v.get("allowance_credits")) or 0.0, "grace_days": v.get("grace_days"),
            "features": tenant_features(db, str(v["id"])), "action": chk["action"],
            "is_current": chk["action"] == "CURRENT"}
    if chk["action"] == "UPGRADE":
        cur, cur_v = chk["current_period"], chk["current_version"]
        q = prorate(int(cur_v.get("price_minor") or 0), int(v.get("price_minor") or 0), cur_v.get("allowance_credits"),
                    v.get("allowance_credits"), _aware(cur["period_start"]), _aware(cur["period_end"]), now)
        card["upgrade_quote"] = {"base_minor": q["base_minor"], "remaining_days": q["remaining_days"],
                                 "period_days": q["period_days"], "until": pa.iso(cur["period_end"]),
                                 "service_start": pa.iso(now), "service_end": pa.iso(cur["period_end"]),
                                 "free": q["free"], "proration": _proration(q)}
    elif chk["action"] == "DOWNGRADE":
        card["effective_at"] = pa.iso(chk["current_period"]["period_end"])
    return card


# ── request bodies ──────────────────────────────────────────────────────────

class QuoteBody(BaseModel):
    institute_id: str = Field(..., max_length=64)
    plan_version_id: str = Field(..., max_length=64)
    action: str = Field("NEW", max_length=12)
    #: false = a staff quote: no listing / audience check for an UPGRADE / DOWNGRADE target
    self_serve: bool = True


class CheckoutBody(BaseModel):
    institute_id: str = Field(..., max_length=64)
    plan_version_id: str = Field(..., max_length=64)
    actor: Optional[str] = Field(None, max_length=255)
    idempotency_key: Optional[str] = Field(None, max_length=64)
    #: false = a staff (sales-led) PAYMENT assignment: no listing / audience check
    self_serve: bool = True
    price_override_minor: Optional[int] = None
    reason: Optional[str] = Field(None, max_length=2000)


class ChangeBody(BaseModel):
    action: str = Field(..., max_length=12)
    plan_version_id: Optional[str] = Field(None, max_length=64)
    actor: Optional[str] = Field(None, max_length=255)
    reason: Optional[str] = Field(None, max_length=2000)
    #: false = a staff (sales-led) change: no listing / audience check, like CheckoutBody
    self_serve: bool = True


class ChargePatch(BaseModel):
    status: Optional[str] = Field(None, max_length=20)
    platform_payment_id: Optional[str] = Field(None, max_length=255)
    payment_link_id: Optional[str] = Field(None, max_length=64)
    payment_link_url: Optional[str] = Field(None, max_length=2000)
    link_expires_at: Optional[datetime] = None
    mandate_id: Optional[str] = Field(None, max_length=64)
    base_minor: Optional[int] = None
    tax_minor: Optional[int] = None
    total_minor: Optional[int] = None
    place_of_supply: Optional[str] = Field(None, max_length=2)
    tax_head: Optional[str] = Field(None, max_length=12)
    last_error: Optional[str] = Field(None, max_length=255)
    debit_attempts: Optional[int] = None
    next_attempt_at: Optional[datetime] = None
    pre_debit_notice_sent_at: Optional[datetime] = None
    actor: Optional[str] = Field(None, max_length=255)
    reason: Optional[str] = Field(None, max_length=2000)
    #: with status WAIVED only (admin_core's staff waiver): why; same as POST /charges/{id}/waive
    void_reason: Optional[str] = Field(None, max_length=2000)


class PaidBody(BaseModel):
    platform_payment_id: Optional[str] = Field(None, max_length=255)
    vendor_payment_id: str = Field(..., min_length=1, max_length=64)
    amount_minor: int
    currency: Optional[str] = Field("INR", max_length=3)
    paid_at: Optional[datetime] = None
    actor: Optional[str] = Field(None, max_length=255)


class RefundedBody(BaseModel):
    vendor_payment_id: str = Field(..., min_length=1, max_length=64)
    #: without total_refunded_minor this is read as the CUMULATIVE amount refunded on the
    #: payment (what admin_core sends, F10), so a replayed webhook is harmless
    amount_minor: int
    #: cumulative refunds on the payment so far (admin_core sums them, F10); default amount_minor
    total_refunded_minor: Optional[int] = None
    refund_id: Optional[str] = Field(None, max_length=64)
    #: admin_core's spelling of refund_id
    vendor_refund_id: Optional[str] = Field(None, max_length=64)
    actor: Optional[str] = Field(None, max_length=255)
    reason: Optional[str] = Field(None, max_length=2000)


class VoidBody(BaseModel):
    reason: str = Field(..., min_length=1, max_length=2000)
    actor: Optional[str] = Field(None, max_length=255)


# ── endpoint bodies (callable from tests and plans_admin) ───────────────────

def _published_inr(db: Session, vid: str) -> Dict[str, Any]:
    v = _version(db, vid)
    if v is None:
        raise _err(404, "VERSION_NOT_FOUND", "plan version not found")
    if v.get("status") != "PUBLISHED" or not v.get("plan_active"):
        raise _err(403, "NOT_OFFERED", "this plan is no longer available")
    if str(v.get("currency") or "INR") != "INR":
        raise _err(422, "CURRENCY_NOT_SUPPORTED", "paid plans are sold in INR only")
    return v


def _offered(db: Session, iid: str, v: Dict[str, Any]) -> None:
    access = storefront_access(db, iid)
    if not access["allowed"]:
        raise _err(404, "STOREFRONT_OFF", "the plans page is not open for this institute", reason=access["reason"])
    plan = pa.one(db, "SELECT * FROM ai_plan WHERE id = CAST(:p AS UUID)", {"p": str(v["plan_id"])}) or {}
    if not plan.get("listed") or not _audience_ok(db, plan, iid, access.get("segments") or []):
        raise _err(403, "NOT_OFFERED", "this plan is not offered to the institute")
    latest = _listing_version(db, str(plan["id"]))
    if latest is None or str(latest["id"]) != str(v["id"]):
        raise _err(403, "NOT_OFFERED", "this plan version is not the one on offer")


def debit_in_flight(ch: Optional[Dict[str, Any]]) -> bool:
    """A recurring debit was raised at Razorpay for this charge and has no outcome
    yet. admin_core records the debit on the charge (platform_payment_id,
    DEBIT_SCHEDULED, debit_attempts + 1) BEFORE it calls Razorpay, so from that
    moment no change may void or re-price the charge: a created recurring payment
    cannot be withdrawn and would be debited (and then refunded) anyway."""
    return bool(ch) and ch.get("status") == "DEBIT_SCHEDULED" and int(ch.get("debit_attempts") or 0) > 0


def _refuse_if_debit_in_flight(charges: Iterable[Optional[Dict[str, Any]]]) -> None:
    for c in charges:
        if debit_in_flight(c):
            raise _err(409, "DEBIT_IN_PROGRESS", "an autopay debit for the renewal is in progress: change the plan "
                                                 "once it has settled", charge_id=str(c["id"]))


def do_checkout(db: Session, body: CheckoutBody, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or _now()
    iid = pa._institute(body.institute_id)  # noqa: SLF001
    actor = (body.actor or "").strip() or ACTOR
    v = _published_inr(db, body.plan_version_id)
    if body.self_serve:
        _offered(db, iid, v)
        if body.price_override_minor is not None:
            raise _err(422, "OVERRIDE_NOT_ALLOWED", "a self-serve checkout cannot override the price")
    price_override = body.price_override_minor
    if price_override is not None:
        price_override = pa._int(price_override, "price_override_minor", 0, pa.MAX_BIGINT_MINOR)  # noqa: SLF001
    pa.xact_lock(db, f"ai_subscription:{iid}")
    idem = (body.idempotency_key or "").strip() or None
    if idem:
        prev = pa.one(db, "SELECT * FROM ai_subscription_charge WHERE institute_id = :i AND idempotency_key = :k",
                      {"i": iid, "k": idem})
        if prev is not None:
            psub = pa.one(db, "SELECT * FROM institute_ai_subscription WHERE id = CAST(:s AS UUID)",
                          {"s": str(prev["subscription_id"])})
            pv = _version(db, prev["plan_version_id"]) or v
            return _checkout_out(psub, prev, pv, [], replayed=True)
    live = pa.one(db, "SELECT id, status, source FROM institute_ai_subscription WHERE institute_id = :i "
                      "AND status IN ('SCHEDULED','TRIAL','ACTIVE','GRACE') LIMIT 1", {"i": iid})
    if live is not None:
        raise _err(409, "ALREADY_SUBSCRIBED", "the institute already has a plan: change it instead",
                   subscription_id=str(live["id"]), status=live["status"])
    superseded: List[Dict[str, Any]] = []
    for p in pa.rows(db, "SELECT * FROM institute_ai_subscription WHERE institute_id = :i AND status = 'PENDING' "
                         "ORDER BY created_at FOR UPDATE", {"i": iid}):
        charges = _open_charges(db, str(p["id"]))
        same = (str(p["plan_version_id"]) == str(v["id"]) and p.get("price_override_minor") == price_override
                and charges)
        if same:
            ch = charges[0]
            return _checkout_out(p, ch, v, superseded, replayed=True)
        _void(db, p, charges, "SUPERSEDED", actor, superseded)
        after = _set_sub(db, str(p["id"]), {"status": "CANCELLED", "end_at": now}, actor)
        _event(db, p, "CHECKOUT_SUPERSEDED", pa.sub_state(p), pa.sub_state(after), actor,
               "a newer checkout replaced this one")
    pm = int(v.get("period_months") or 1)
    sid = str(uuid.uuid4())
    sub = pa.one(db, (
        "INSERT INTO institute_ai_subscription (id, institute_id, plan_version_id, status, enforcement, source, "
        "anchor_at, start_at, end_at, period_months, auto_renew, grace_days, cancel_at_period_end, "
        "price_override_minor, reason, created_by, created_at, updated_by, updated_at) VALUES "
        "(CAST(:id AS UUID), :i, CAST(:v AS UUID), 'PENDING', 'LIVE', 'PAYMENT', :now, :now, NULL, :pm, true, :grace, "
        "false, :po, :reason, :actor, now(), :actor, now()) RETURNING *"), {
        "id": sid, "i": iid, "v": str(v["id"]), "now": now, "pm": pm, "grace": int(v.get("grace_days") or 0),
        "po": price_override, "reason": (body.reason or ("self-serve checkout" if body.self_serve
                                                         else "paid plan assigned by the platform team")),
        "actor": actor})
    base, total = _price_terms(sub, v)
    if (total if total is not None else base) < MIN_CHARGE_MINOR:
        raise _err(422, "PRICE_TOO_LOW", "a paid plan must cost at least Re 1 (use COMPLIMENTARY instead)")
    _event(db, sub, "CHECKOUT_CREATED", None, {**(pa.sub_state(sub) or {}), "idempotency_key": body.idempotency_key,
                                                "self_serve": bool(body.self_serve)}, actor, sub.get("reason"))
    ch = _insert_charge(db, sub, kind="PERIOD", start=now, end=pa.add_months(now, pm), version=v, base_minor=base,
                        total_minor=total, actor=actor, reason="first period", idempotency_key=idem)
    return _checkout_out(sub, ch, v, superseded, replayed=False)


def _checkout_out(sub, ch, v, superseded, replayed) -> Dict[str, Any]:
    charge = {**charge_out(ch), "subscription_status": sub["status"], "grace_days": sub.get("grace_days"),
              "plan_key": v.get("plan_key"), "plan_name": v.get("plan_name")}
    return {"subscription_id": str(sub["id"]), "status": sub["status"], "charge": charge,
            "charge_id": str(ch["id"]), "kind": ch["kind"], "base_minor": int(ch["base_minor"]),
            "total_minor": int(ch["total_minor"]) if ch.get("total_minor") is not None else None,
            "currency": ch.get("currency") or "INR", "is_tax_inclusive": bool(v.get("is_tax_inclusive")),
            "sac_code": v.get("sac_code"), "plan_key": v.get("plan_key"), "plan_name": v.get("plan_name"),
            "description": describe(ch, v), "suggested_expire_by": pa.iso(_aware(ch["created_at"]) + CHECKOUT_TTL),
            "superseded": superseded, "replayed": replayed}


def describe(ch: Dict[str, Any], v: Dict[str, Any], from_v: Optional[Dict[str, Any]] = None) -> str:
    """Invoice line text (design §5.3), IST dates; never a brand word."""
    s = ist_date(_aware(ch["service_start"])).strftime("%d-%m-%Y")
    e = ist_date(_aware(ch["service_end"]) - timedelta(seconds=1)).strftime("%d-%m-%Y")
    name = v.get("plan_name") or v.get("plan_key") or "AI plan"
    if ch.get("kind") == "UPGRADE":
        old = (from_v or {}).get("plan_name") or "current plan"
        return f"Upgrade {old} to {name}, {s} to {e}"[:255]
    return f"{name} subscription, {s} to {e}"[:255]


def do_change(db: Session, sid: str, body: ChangeBody, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or _now()
    action = pa._upper(body.action, CHANGE_ACTIONS, "action")  # noqa: SLF001
    actor = (body.actor or "").strip() or ACTOR
    sub = _lock_sub(db, sid)
    if str(sub.get("source") or "").upper() != "PAYMENT":
        raise _err(409, "NOT_A_PAID_PLAN", "only paid plans change here (the platform team changes the others)")
    sid = str(sub["id"])
    voided: List[Dict[str, Any]] = []
    out: Dict[str, Any] = {"action": action, "subscription_id": sid, "voided_charges": voided, "charge": None,
                           "applied": False}
    if action == "CANCEL":
        if sub["status"] == "PENDING":
            _void(db, sub, _open_charges(db, sid), "CANCELLED", actor, voided)
            after = _set_sub(db, sid, {"status": "CANCELLED", "end_at": now}, actor)
            _event(db, sub, "CANCELLED", pa.sub_state(sub), pa.sub_state(after), actor, body.reason or "checkout cancelled")
            out.update(applied=True, status="CANCELLED")
            return out
        if sub["status"] not in pa.LIVE_STATUSES:
            raise _err(409, "NOT_LIVE", f"the subscription is {sub['status']}")
        periods = _paid_periods(db, sid)
        latest = periods[-1] if periods else None
        p_end = _aware(latest["period_end"]) if latest else now
        open_now = _open_charges(db, sid)
        _refuse_if_debit_in_flight(open_now)
        _void(db, sub, open_now, "CANCELLED", actor, voided)
        if sub["status"] == "GRACE" or p_end <= now:
            after = _set_sub(db, sid, {"status": "CANCELLED", "end_at": min(p_end, now), "auto_renew": False}, actor)
            _event(db, sub, "CANCELLED", pa.sub_state(sub), pa.sub_state(after), actor, body.reason or "cancelled")
            out.update(applied=True, status="CANCELLED", live=False)
            return out
        after = _set_sub(db, sid, {"cancel_at_period_end": True}, actor)
        _event(db, sub, "CANCEL_SCHEDULED", pa.sub_state(sub), pa.sub_state(after), actor,
               body.reason or "cancel at period end")
        out.update(applied=True, status=after["status"], effective_at=pa.iso(p_end))
        return out
    if action == "RESUME":
        if sub["status"] not in ("ACTIVE",) or not sub.get("cancel_at_period_end"):
            raise _err(409, "NOTHING_TO_RESUME", "the subscription is not scheduled to cancel")
        periods = _paid_periods(db, sid)
        latest = periods[-1] if periods else None
        if latest is None or _aware(latest["period_end"]) <= now:
            raise _err(409, "PERIOD_OVER", "the period is over: subscribe again")
        after = _set_sub(db, sid, {"cancel_at_period_end": False}, actor)
        _event(db, sub, "RESUMED", pa.sub_state(sub), pa.sub_state(after), actor, body.reason or "resumed")
        p_end = _aware(latest["period_end"])
        if now >= p_end - RENEWAL_LEAD and after.get("auto_renew"):
            ch, created = ensure_renewal_charge(db, after, p_end, actor=actor)
            if ch is not None and created:
                out["charge"] = charge_out(ch)
        out.update(applied=True, status=after["status"])
        return out
    if not body.plan_version_id:
        raise _err(422, "PLAN_VERSION_REQUIRED", "plan_version_id is required")
    target = _published_inr(db, body.plan_version_id)
    if body.self_serve:
        # the same offer check as a self-serve checkout: listed, audience, the current listing version
        _offered(db, sub["institute_id"], target)
    chk = change_check(db, sub if sub["status"] in pa.LIVE_STATUSES else None, target, now)
    if chk["action"] != action:
        raise _err(409, chk.get("code") or chk["action"], f"{action} is not possible: {chk['action']}",
                   possible=chk["action"])
    cur, cur_v = chk["current_period"], chk["current_version"]
    p_end = _aware(cur["period_end"])
    if action == "DOWNGRADE":
        renewal = pa.one(db, "SELECT * FROM ai_subscription_charge WHERE subscription_id = CAST(:s AS UUID) "
                             "AND kind = 'PERIOD' AND service_start = :ss AND status <> 'VOID' LIMIT 1 FOR UPDATE",
                         {"s": sid, "ss": p_end})
        if renewal is not None and renewal["status"] not in CHARGE_OPEN:
            raise _err(409, "RENEWAL_ALREADY_PAID", "the next period is already paid: change it after it starts")
        _refuse_if_debit_in_flight([renewal])
        _void(db, sub, _open_charges(db, sid, kind="UPGRADE"), "SUPERSEDED", actor, voided)
        if renewal is not None:
            _void(db, sub, [renewal], "REPRICED", actor, voided)
        after = _set_sub(db, sid, {"pending_plan_version_id": str(target["id"])}, actor)
        _event(db, sub, "PLAN_CHANGE_SCHEDULED", {"pending_plan_version_id": sub.get("pending_plan_version_id")},
               {"pending_plan_version_id": str(target["id"])}, actor, body.reason or "downgrade at renewal")
        if renewal is not None or (now >= p_end - RENEWAL_LEAD and after.get("auto_renew")
                                   and not after.get("cancel_at_period_end")):
            ch, created = ensure_renewal_charge(db, after, p_end, actor=actor)
            if ch is not None and created:
                out["charge"] = charge_out(ch)
        out.update(applied=True, effective_at=pa.iso(p_end), pending_plan_version_id=str(target["id"]))
        return out
    # UPGRADE
    if sub.get("cancel_at_period_end"):
        raise _err(409, "CANCEL_SCHEDULED", "resume the plan before upgrading")
    # an upgrade re-prices the unpaid renewal (_apply_upgrade): not while its debit is raised
    _refuse_if_debit_in_flight(_open_charges(db, sid, kind="PERIOD", from_start=p_end))
    q = prorate(int(cur_v.get("price_minor") or 0), int(target.get("price_minor") or 0), cur_v.get("allowance_credits"),
                target.get("allowance_credits"), _aware(cur["period_start"]), p_end, now)
    _void(db, sub, _open_charges(db, sid, kind="UPGRADE"), "SUPERSEDED", actor, voided)
    quote = {"from_version_id": str(cur_v["id"]), "to_version_id": str(target["id"]), "period_id": str(cur["id"]),
             **q}
    if q["free"]:
        repriced = _apply_upgrade(db, sub, cur, target, Decimal(str(q["allowance_delta"])), 0, actor,
                                  "upgrade below Re 1: applied at once, no charge", voided, now)
        out.update(applied=True, free=True, quote=quote, repriced_charges=repriced)
        return out
    incl = bool(target.get("is_tax_inclusive"))
    base = base_of(q["base_minor"], incl) if incl else q["base_minor"]
    total = q["base_minor"] if incl else None
    ch = _insert_charge(db, sub, kind="UPGRADE", start=now, end=p_end, version=target, base_minor=base,
                        total_minor=total, actor=actor, reason=body.reason or "upgrade", from_version=cur_v,
                        quote=quote)
    _event(db, sub, "UPGRADE_QUOTED", None, {"charge_id": str(ch["id"]), **quote}, actor, body.reason or "upgrade")
    out.update(charge=charge_out(ch), quote=quote, description=describe(ch, target, cur_v),
               suggested_expire_by=pa.iso(now + UPGRADE_QUOTE_TTL))
    return out


def _apply_upgrade(db: Session, sub: Dict[str, Any], cur: Dict[str, Any], target: Dict[str, Any], delta: Decimal,
                   net_base: int, actor: str, reason: str, voided: List[Dict[str, Any]],
                   now: datetime) -> List[Dict[str, Any]]:
    """Switch the current period and the subscription to `target` now (same
    subscription row: fair-use counters are keyed by it). Re-prices an unpaid
    renewal charge. Returns the new renewal charges (admin_core re-collects)."""
    sid = str(sub["id"])
    db.execute(text(
        "UPDATE ai_subscription_period SET plan_version_id = CAST(:v AS UUID), "
        "allowance_credits = GREATEST(allowance_used, allowance_credits + :d), "
        "price_minor_snapshot = price_minor_snapshot + :b WHERE id = CAST(:p AS UUID)"),
        {"v": str(target["id"]), "d": delta, "b": int(net_base), "p": str(cur["id"])})
    after = _set_sub(db, sid, {"plan_version_id": str(target["id"]), "pending_plan_version_id": None}, actor)
    _event(db, sub, "UPGRADED", pa.sub_state(sub), {**(pa.sub_state(after) or {}), "allowance_delta": float(delta),
                                                    "period_id": str(cur["id"])}, actor, reason)
    p_end = _aware(cur["period_end"])
    renewal = pa.one(db, "SELECT * FROM ai_subscription_charge WHERE subscription_id = CAST(:s AS UUID) "
                         "AND kind = 'PERIOD' AND service_start = :ss AND status = ANY(CAST(:st AS VARCHAR[])) "
                         "LIMIT 1 FOR UPDATE", {"s": sid, "ss": p_end, "st": list(CHARGE_OPEN)})
    repriced: List[Dict[str, Any]] = []
    if renewal is not None and str(renewal["plan_version_id"]) != str(target["id"]):
        _void(db, sub, [renewal], "REPRICED", actor, voided)
        ch, created = ensure_renewal_charge(db, after, p_end, actor=actor)
        if ch is not None and created:
            repriced.append(charge_out(ch))
    return repriced


def _upgrade_quote(db: Session, sid: str, cid: str) -> Optional[Dict[str, Any]]:
    """The quote frozen on an UPGRADE charge (charge.quote_json, V590)."""
    r = pa.one(db, "SELECT quote_json, CAST(from_plan_version_id AS TEXT) AS fv FROM ai_subscription_charge "
                   "WHERE id = CAST(:c AS UUID) AND subscription_id = CAST(:s AS UUID)", {"s": sid, "c": cid})
    if r is None:
        return None
    st = r.get("quote_json")
    if isinstance(st, str):
        try:
            st = json.loads(st)
        except ValueError:
            return None
    if not isinstance(st, dict):
        return None
    if r.get("fv") and not st.get("from_version_id"):
        st = {**st, "from_version_id": r["fv"]}
    return st


def _result(action: str, sub: Dict[str, Any], ch: Dict[str, Any], v: Optional[Dict[str, Any]], **kw: Any
            ) -> Dict[str, Any]:
    out = {"action": action, "subscription_id": str(sub["id"]), "institute_id": sub["institute_id"],
           "subscription_status": sub.get("status"), "charge": charge_out(ch),
           "period_id": str(ch["period_id"]) if ch.get("period_id") else None, "repriced_charges": [],
           "voided_charges": []}
    if v:
        out["invoice"] = {"kind": ch.get("kind"), "description": describe(ch, v, kw.pop("from_version", None)),
                          "sac_code": v.get("sac_code"), "plan_key": v.get("plan_key"), "plan_name": v.get("plan_name"),
                          "service_start": pa.iso(ch.get("service_start")), "service_end": pa.iso(ch.get("service_end")),
                          "base_minor": int(ch["base_minor"]) if ch.get("base_minor") is not None else None,
                          "tax_minor": int(ch["tax_minor"]) if ch.get("tax_minor") is not None else None,
                          "total_minor": int(ch["total_minor"]) if ch.get("total_minor") is not None else None,
                          "place_of_supply": ch.get("place_of_supply"), "currency": ch.get("currency") or "INR"}
    kw.pop("from_version", None)
    out.update(kw)
    return out


def _paid_at(body_at: Optional[datetime], ch: Dict[str, Any], now: datetime) -> datetime:
    at = _aware(body_at)
    if at is None:
        return now
    lo = _aware(ch.get("created_at")) or now
    if at < lo - timedelta(minutes=5) or at > now + timedelta(minutes=5):
        return now          # an implausible timestamp: the server clock decides
    return min(at, now)


def do_paid(db: Session, cid: str, body: PaidBody, now: Optional[datetime] = None, *,
            waive_reason: Optional[str] = None) -> Tuple[Dict[str, Any], Optional[bool]]:
    """Record a payment (or, with waive_reason, a staff waiver) of one charge.
    Returns (result, live) where live says how the institute's index changed."""
    now = now or _now()
    waive = waive_reason is not None
    sub, ch = _lock_charge(db, cid)
    actor = (body.actor or "").strip() or ACTOR
    vpid = str(body.vendor_payment_id).strip()
    v = _version(db, ch["plan_version_id"]) or {}
    if not waive:
        other = pa.one(db, "SELECT id FROM ai_subscription_charge WHERE vendor_payment_id = :p "
                           "AND id <> CAST(:c AS UUID) LIMIT 1", {"p": vpid, "c": str(ch["id"])})
        if other is not None:
            raise _err(409, "VENDOR_PAYMENT_REUSED", "this payment is already recorded on another charge",
                       other_charge_id=str(other["id"]))
    if ch["status"] in CHARGE_PAID:
        if not waive and str(ch.get("vendor_payment_id") or "") == vpid:
            return _result("ALREADY_PROCESSED", sub, ch, v), None
        if waive:
            raise _err(409, "CHARGE_ALREADY_PAID", "the charge is already paid")
        _event(db, sub, "PAYMENT_DUPLICATE", {"charge_id": str(ch["id"]), "vendor_payment_id": ch.get("vendor_payment_id")},
               {"vendor_payment_id": vpid, "amount_minor": int(body.amount_minor),
                "platform_payment_id": body.platform_payment_id}, actor, "a second payment for a paid charge")
        return _result("DUPLICATE", sub, ch, v, refund_minor=int(body.amount_minor)), None
    if not waive:
        if str(body.currency or "INR").upper() != str(ch.get("currency") or "INR").upper():
            _event(db, sub, "PAYMENT_AMOUNT_MISMATCH", {"charge_id": str(ch["id"])},
                   {"currency": body.currency, "amount_minor": int(body.amount_minor), "vendor_payment_id": vpid},
                   actor, "currency differs from the charge")
            db.commit()
            raise _err(409, "AMOUNT_MISMATCH", "the payment currency differs from the charge")
        if ch.get("total_minor") is None:
            raise _err(409, "TOTAL_NOT_SET", "the charge has no total yet (tax snapshot missing)")
        if int(body.amount_minor) != int(ch["total_minor"]):
            _event(db, sub, "PAYMENT_AMOUNT_MISMATCH", {"charge_id": str(ch["id"]), "total_minor": int(ch["total_minor"])},
                   {"amount_minor": int(body.amount_minor), "vendor_payment_id": vpid}, actor,
                   "paid amount differs from the charge total")
            db.commit()
            raise _err(409, "AMOUNT_MISMATCH", "the paid amount differs from the charge total",
                       expected_minor=int(ch["total_minor"]), paid_minor=int(body.amount_minor))
    paid_at = _paid_at(body.paid_at, ch, now) if not waive else now
    pay_status = "WAIVED" if waive else "PAID"
    late = False
    if ch["status"] == "VOID":
        if waive:
            raise _err(409, "CHARGE_VOID", "the charge is void")
        if not _late_checkout_ok(db, sub, ch):
            _event(db, sub, "PAYMENT_LATE", {"charge_id": str(ch["id"]), "status": "VOID"},
                   {"vendor_payment_id": vpid, "amount_minor": int(body.amount_minor)}, actor,
                   "payment for a void charge")
            return _result("REFUND_REQUIRED", sub, ch, v, code="CHARGE_VOID", refund_minor=int(body.amount_minor)), None
        late = True
        sub = _set_sub(db, str(sub["id"]), {"status": "PENDING", "end_at": None}, actor)
    if ch["kind"] == "PERIOD" and sub["status"] == "PENDING":
        return _activate(db, sub, ch, v, paid_at, body, actor, pay_status, late, waive_reason)
    if ch["kind"] == "PERIOD" and sub["status"] in ("ACTIVE", "GRACE"):
        return _renewal_paid(db, sub, ch, v, paid_at, body, actor, pay_status, waive_reason, now)
    if ch["kind"] == "UPGRADE" and sub["status"] == "ACTIVE":
        return _upgrade_paid(db, sub, ch, v, paid_at, body, actor, pay_status, waive_reason, now)
    if waive:
        raise _err(409, "NOT_APPLICABLE", f"the subscription is {sub['status']}")
    _event(db, sub, "PAYMENT_LATE", {"charge_id": str(ch["id"]), "status": ch["status"]},
           {"vendor_payment_id": vpid, "subscription_status": sub["status"]}, actor, "subscription no longer payable")
    return _result("REFUND_REQUIRED", sub, ch, v, code="SUBSCRIPTION_" + str(sub["status"]),
                   refund_minor=int(body.amount_minor)), None


def _late_checkout_ok(db: Session, sub: Dict[str, Any], ch: Dict[str, Any]) -> bool:
    """A late payment for a checkout that lapsed unpaid (not superseded, not
    cancelled) activates it when nothing else is open for the institute
    (critique B). Everything else is refunded."""
    if ch.get("kind") != "PERIOD" or sub.get("status") != "EXPIRED" or str(sub.get("source")) != "PAYMENT":
        return False
    if pa.one(db, "SELECT 1 AS x FROM ai_subscription_period WHERE subscription_id = CAST(:s AS UUID) LIMIT 1",
              {"s": str(sub["id"])}) is not None:
        return False       # it was live once: this is not a lapsed checkout
    lapsed = pa.one(db, "SELECT 1 AS x FROM ai_subscription_event WHERE subscription_id = CAST(:s AS UUID) "
                        "AND event_type = 'CHECKOUT_EXPIRED' LIMIT 1", {"s": str(sub["id"])})
    if lapsed is None:
        return False
    other = pa.one(db, "SELECT 1 AS x FROM institute_ai_subscription WHERE institute_id = :i AND id <> CAST(:s AS UUID) "
                       "AND status IN ('SCHEDULED','PENDING','TRIAL','ACTIVE','GRACE') LIMIT 1",
                   {"i": sub["institute_id"], "s": str(sub["id"])})
    if other is not None:
        return False
    v = _version(db, ch["plan_version_id"]) or {}
    return v.get("status") in ("PUBLISHED", "RETIRED")


def _charge_paid_fields(ch: Dict[str, Any], body: PaidBody, pay_status: str, period_id: str,
                        start: Optional[datetime] = None, end: Optional[datetime] = None,
                        paid_at: Optional[datetime] = None) -> Dict[str, Any]:
    f: Dict[str, Any] = {"status": "PAID" if pay_status == "PAID" else "VOID", "period_id": period_id}
    if pay_status == "PAID":
        f["vendor_payment_id"] = str(body.vendor_payment_id).strip()
        f["paid_minor"] = int(body.amount_minor)
        f["paid_at"] = paid_at or _now()
        if body.platform_payment_id:
            f["platform_payment_id"] = body.platform_payment_id
    else:
        f["void_reason"] = "WAIVED"
    if start is not None:
        f["service_start"] = start
    if end is not None:
        f["service_end"] = end
    return f


def _activate(db, sub, ch, v, paid_at, body, actor, pay_status, late, waive_reason):
    other = pa.one(db, "SELECT id FROM institute_ai_subscription WHERE institute_id = :i AND id <> CAST(:s AS UUID) "
                       "AND status IN ('TRIAL','ACTIVE','GRACE') LIMIT 1", {"i": sub["institute_id"], "s": str(sub["id"])})
    if other is not None:
        if pay_status != "PAID":
            raise _err(409, "ALREADY_SUBSCRIBED", "the institute already has a live plan")
        _event(db, sub, "PAYMENT_LATE", {"charge_id": str(ch["id"])}, {"blocked_by": str(other["id"])}, actor,
               "another plan is live for the institute")
        return _result("REFUND_REQUIRED", sub, ch, v, code="ALREADY_SUBSCRIBED",
                       refund_minor=int(body.amount_minor)), None
    pm = int(sub.get("period_months") or 1)
    start, end = pa.period_bounds(paid_at, pm, paid_at)
    after = _set_sub(db, str(sub["id"]), {"status": "ACTIVE", "anchor_at": start, "start_at": start, "end_at": None},
                     actor)
    period = _open_period(db, after, start, end, v, int(ch["base_minor"]), pay_status)
    ch2 = _set_charge(db, str(ch["id"]), _charge_paid_fields(ch, body, pay_status, str(period["id"]), start, end,
                                                             paid_at))
    _event(db, sub, "ACTIVATED", pa.sub_state(sub), {**(pa.sub_state(after) or {}), "charge_id": str(ch["id"]),
                                                     "period_id": str(period["id"]), "late": late},
           actor, waive_reason or ("first payment received" + (" (after the checkout lapsed)" if late else "")))
    return _result("ACTIVATED", after, ch2, v, late=late, waived=pay_status == "WAIVED"), True


def _renewal_paid(db, sub, ch, v, paid_at, body, actor, pay_status, waive_reason, now):
    sid = str(sub["id"])
    periods = _paid_periods(db, sid)
    latest = periods[-1] if periods else None
    start, end = _aware(ch["service_start"]), _aware(ch["service_end"])
    p_end = _aware(latest["period_end"]) if latest else None
    end_at = _aware(sub.get("end_at"))
    bad = None
    if p_end is None or start != p_end:
        bad = "PERIOD_MISMATCH"
    elif sub.get("cancel_at_period_end") or (end_at is not None and end_at <= start):
        bad = "NOT_RENEWING"
    if bad:
        if pay_status != "PAID":
            raise _err(409, bad, "this renewal is not payable")
        _event(db, sub, "PAYMENT_LATE", {"charge_id": str(ch["id"])}, {"code": bad}, actor, "renewal not payable")
        return _result("REFUND_REQUIRED", sub, ch, v, code=bad, refund_minor=int(body.amount_minor)), None
    period = _open_period(db, sub, start, end, v, int(ch["base_minor"]), pay_status)
    ch2 = _set_charge(db, str(ch["id"]), _charge_paid_fields(ch, body, pay_status, str(period["id"]),
                                                             paid_at=paid_at))
    fields: Dict[str, Any] = {}
    action = "RENEWAL_PAID"
    if start <= now:
        # the period has started: the subscription follows it now (else the roll does at its start)
        if str(sub["plan_version_id"]) != str(v["id"]):
            fields["plan_version_id"] = str(v["id"])
        if sub.get("pending_plan_version_id") and str(sub["pending_plan_version_id"]) == str(v["id"]):
            fields["pending_plan_version_id"] = None
    if sub["status"] == "GRACE":
        fields["status"] = "ACTIVE"
        action = "GRACE_CLEARED"
    after = _set_sub(db, sid, fields, actor) if fields else sub
    _event(db, sub, action, pa.sub_state(sub), {**(pa.sub_state(after) or {}), "charge_id": str(ch["id"]),
                                                "period_id": str(period["id"])}, actor,
           waive_reason or "renewal paid")
    return _result(action, after, ch2, v, waived=pay_status == "WAIVED"), None


def _upgrade_paid(db, sub, ch, v, paid_at, body, actor, pay_status, waive_reason, now):
    sid = str(sub["id"])
    periods = _paid_periods(db, sid)
    cur = _period_at(periods, paid_at)
    quote = _upgrade_quote(db, sid, str(ch["id"])) or {}
    bad = None
    if cur is None or _aware(cur["period_end"]) != _aware(ch["service_end"]) or paid_at >= _aware(ch["service_end"]):
        bad = "PERIOD_CHANGED"
    elif str(cur["plan_version_id"]) != str(quote.get("from_version_id")):
        bad = "PLAN_CHANGED_SINCE_QUOTE"
    elif any(_aware(p["period_start"]) >= _aware(cur["period_end"]) for p in periods):
        bad = "RENEWAL_ALREADY_PAID"
    elif any(debit_in_flight(c) for c in _open_charges(db, sid, kind="PERIOD", from_start=_aware(cur["period_end"]))):
        # the renewal's debit was raised after the quote: re-pricing it now would debit the old
        # price AND charge the new one; refund the upgrade, the institute upgrades again later
        bad = "DEBIT_IN_PROGRESS"
    from_v = _version(db, quote.get("from_version_id")) if quote.get("from_version_id") else None
    if bad:
        if pay_status != "PAID":
            raise _err(409, bad, "this upgrade can no longer be applied")
        _event(db, sub, "PAYMENT_LATE", {"charge_id": str(ch["id"])}, {"code": bad}, actor, "upgrade not applicable")
        return _result("REFUND_REQUIRED", sub, ch, v, code=bad, refund_minor=int(body.amount_minor),
                       from_version=from_v), None
    voided: List[Dict[str, Any]] = []
    repriced = _apply_upgrade(db, sub, cur, v, Decimal(str(quote.get("allowance_delta") or 0)), int(ch["base_minor"]),
                              actor, waive_reason or "upgrade paid", voided, now)
    # the upgraded plan is supplied from the payment on: the invoice's service period starts there
    start = max(_aware(ch["service_start"]), paid_at) if pay_status == "PAID" else None
    ch2 = _set_charge(db, str(ch["id"]), _charge_paid_fields(ch, body, pay_status, str(cur["id"]), start=start,
                                                             paid_at=paid_at))
    after = pa.one(db, "SELECT * FROM institute_ai_subscription WHERE id = CAST(:s AS UUID)", {"s": sid})
    return _result("UPGRADED", after, ch2, v, repriced_charges=repriced, voided_charges=voided, from_version=from_v,
                   waived=pay_status == "WAIVED"), None


def do_refunded(db: Session, cid: str, body: RefundedBody, now: Optional[datetime] = None
                ) -> Tuple[Dict[str, Any], Optional[bool]]:
    now = now or _now()
    sub, ch = _lock_charge(db, cid)
    actor = (body.actor or "").strip() or ACTOR
    if ch["status"] not in CHARGE_PAID:
        raise _err(409, "CHARGE_NOT_PAID", f"the charge is {ch['status']}: nothing to refund")
    if str(ch.get("vendor_payment_id") or "") != str(body.vendor_payment_id).strip():
        raise _err(409, "VENDOR_PAYMENT_MISMATCH", "the refunded payment is not the payment of this charge")
    amount = int(body.amount_minor)
    cum = int(body.total_refunded_minor) if body.total_refunded_minor is not None else amount
    total = int(ch.get("total_minor") or 0)
    if amount <= 0 or cum <= 0 or cum > total or amount > cum:
        raise _err(422, "BAD_REFUND_AMOUNT", "the refund amount must be positive and at most the charge total")
    v = _version(db, ch["plan_version_id"]) or {}
    if ch["status"] == "REFUNDED":
        return _result("ALREADY_PROCESSED", sub, ch, v), None
    if cum < int(ch.get("refunded_minor") or 0):
        cum = int(ch.get("refunded_minor") or 0)        # an older webhook arriving late: never go backwards
    if cum == int(ch.get("refunded_minor") or 0) and ch["status"] == "PARTIALLY_REFUNDED":
        return _result("ALREADY_PROCESSED", sub, ch, v), None
    full = cum >= total
    ch2 = _set_charge(db, str(ch["id"]), {"status": "REFUNDED" if full else "PARTIALLY_REFUNDED",
                                          "refunded_minor": min(cum, int(ch.get("paid_minor") or total))})
    reason = body.reason or ("refunded in full" if full else "partly refunded")
    ev = {"charge_id": str(ch["id"]), "refund_id": body.refund_id or body.vendor_refund_id, "amount_minor": amount,
          "total_refunded_minor": cum, "full": full}
    _event(db, sub, "CHARGE_REFUNDED", {"charge_id": str(ch["id"]), "status": ch["status"]}, ev, actor, reason)
    if not full:
        return _result("PARTIALLY_REFUNDED", sub, ch2, v), None
    live: Optional[bool] = None
    voided: List[Dict[str, Any]] = []
    sid = str(sub["id"])
    after = sub
    if ch["kind"] == "PERIOD" and ch.get("period_id"):
        period = pa.one(db, "UPDATE ai_subscription_period SET payment_status = 'REFUNDED' WHERE id = CAST(:p AS UUID) "
                            "RETURNING *", {"p": str(ch["period_id"])})
        if period is not None and sub["status"] in pa.LIVE_STATUSES:
            ps, pe = _aware(period["period_start"]), _aware(period["period_end"])
            if ps <= now < pe:
                _void(db, sub, _open_charges(db, sid), "REFUNDED", actor, voided)
                after = _set_sub(db, sid, {"status": "CANCELLED", "end_at": now, "auto_renew": False}, actor)
                _event(db, sub, "CANCELLED", pa.sub_state(sub), pa.sub_state(after), actor,
                       "the current period was refunded in full")
                live = False
            elif ps > now:
                _void(db, sub, _open_charges(db, sid, from_start=pe), "REFUNDED", actor, voided)
                after = _set_sub(db, sid, {"cancel_at_period_end": True}, actor)
                _event(db, sub, "CANCEL_SCHEDULED", pa.sub_state(sub), pa.sub_state(after), actor,
                       "the next period was refunded in full")
    elif ch["kind"] == "UPGRADE" and ch.get("period_id"):
        quote = _upgrade_quote(db, sid, str(ch["id"])) or {}
        period = pa.one(db, "SELECT * FROM ai_subscription_period WHERE id = CAST(:p AS UUID) FOR UPDATE",
                        {"p": str(ch["period_id"])})
        fv = quote.get("from_version_id")
        if period is not None and fv and str(period["plan_version_id"]) == str(ch["plan_version_id"]) \
                and _aware(period["period_end"]) > now:
            db.execute(text(
                "UPDATE ai_subscription_period SET plan_version_id = CAST(:v AS UUID), "
                "allowance_credits = GREATEST(allowance_used, allowance_credits - :d), "
                "price_minor_snapshot = GREATEST(0, price_minor_snapshot - :b) WHERE id = CAST(:p AS UUID)"),
                {"v": fv, "d": Decimal(str(quote.get("allowance_delta") or 0)), "b": int(ch["base_minor"]),
                 "p": str(period["id"])})
            if str(sub["plan_version_id"]) == str(ch["plan_version_id"]):
                after = _set_sub(db, sid, {"plan_version_id": fv}, actor)
            _event(db, sub, "UPGRADE_REVERTED", pa.sub_state(sub), pa.sub_state(after), actor,
                   "the upgrade was refunded in full")
    return _result("REFUNDED", after, ch2, v, voided_charges=voided), live


def do_void(db: Session, cid: str, body: VoidBody) -> Tuple[Dict[str, Any], Optional[bool]]:
    sub, ch = _lock_charge(db, cid)
    actor = (body.actor or "").strip() or ACTOR
    v = _version(db, ch["plan_version_id"]) or {}
    if ch["status"] == "VOID":
        return _result("ALREADY_PROCESSED", sub, ch, v), None
    if ch["status"] not in CHARGE_OPEN:
        raise _err(409, "CHARGE_NOT_OPEN", f"the charge is {ch['status']}")
    voided = _void(db, sub, [ch], body.reason.strip(), actor)
    after = sub
    if ch["kind"] == "PERIOD" and sub["status"] == "PENDING":
        if body.reason.strip().upper() == "CHECKOUT_EXPIRED":
            # admin_core saw the checkout link lapse: the same as the roll's expiry, so a
            # payment captured at the last minute still activates it (_late_checkout_ok)
            after = _set_sub(db, str(sub["id"]), {"status": "EXPIRED", "end_at": _now()}, actor)
            _event(db, sub, "CHECKOUT_EXPIRED", pa.sub_state(sub), pa.sub_state(after), actor,
                   "the checkout link expired unpaid")
        else:
            after = _set_sub(db, str(sub["id"]), {"status": "CANCELLED", "end_at": _now()}, actor)
            _event(db, sub, "CANCELLED", pa.sub_state(sub), pa.sub_state(after), actor, body.reason)
    ch2 = pa.one(db, "SELECT * FROM ai_subscription_charge WHERE id = CAST(:c AS UUID)", {"c": str(ch["id"])})
    return _result("VOIDED", after, ch2, v, voided_charges=voided), None


def patch_charge(db: Session, cid: str, body: ChargePatch, now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or _now()
    sub, ch = _lock_charge(db, cid)
    given = body.model_fields_set - {"actor", "reason"}
    if not given:
        raise _err(422, "NOTHING_TO_CHANGE", "nothing to change")
    if ch["status"] not in CHARGE_OPEN:
        raise _err(409, "CHARGE_CLOSED", f"the charge is {ch['status']}: it cannot change")
    raw = body.model_dump()
    f: Dict[str, Any] = {}
    for k in given:
        f[k] = raw.get(k)
    if "status" in f:
        st = str(f["status"] or "").strip().upper()
        if st not in PATCH_STATUSES:
            raise _err(422, "BAD_STATUS", f"status must be one of {', '.join(PATCH_STATUSES)} (paid / void / refund "
                                          "have their own endpoints)")
        f["status"] = st
    for k in ("link_expires_at", "next_attempt_at", "pre_debit_notice_sent_at"):
        if k in f and f[k] is not None:
            f[k] = _aware(f[k])
    if "tax_head" in f and f["tax_head"] is not None:
        f["tax_head"] = pa._upper(f["tax_head"], ("CGST_SGST", "IGST"), "tax_head")  # noqa: SLF001 - INR only
    if "last_error" in f and f["last_error"] is not None:
        f["last_error"] = str(f["last_error"])[:255]
    if "place_of_supply" in f and f["place_of_supply"] is not None:
        pos = str(f["place_of_supply"]).strip()
        if not STATE_RE.match(pos):
            raise _err(422, "BAD_PLACE_OF_SUPPLY", "place_of_supply must be a 2-digit GST state code")
        f["place_of_supply"] = pos
    for k in ("base_minor", "tax_minor", "total_minor", "debit_attempts"):
        if k in f and f[k] is not None and (int(f[k]) < 0 or int(f[k]) > pa.MAX_BIGINT_MINOR):
            raise _err(422, "BAD_AMOUNT", f"{k} is out of range")
    if "base_minor" in f:
        if ch.get("total_minor") is None or f.get("base_minor") is None:
            raise _err(422, "BASE_FIXED", "base_minor can change only for a tax-inclusive price")
        if "total_minor" in f and f["total_minor"] != ch["total_minor"]:
            raise _err(422, "TOTAL_FIXED", "a tax-inclusive charge keeps its total")
    if any(k in f for k in ("base_minor", "tax_minor", "total_minor")):
        relinked = any(f.get(k) and f.get(k) != ch.get(k) for k in ("payment_link_id", "platform_payment_id"))
        changes_amount = any(k in f and f[k] != ch.get(k) for k in ("base_minor", "tax_minor", "total_minor"))
        if changes_amount and f.get("status", ch["status"]) not in ("DUE", "FAILED") and not relinked:
            raise _err(409, "AMOUNT_LOCKED", "the amount of a charge with a live link / debit changes only with a "
                                             "new link or payment")
        base = int(f.get("base_minor", ch["base_minor"]))
        tax = f.get("tax_minor", ch.get("tax_minor"))
        total = f.get("total_minor", ch.get("total_minor"))
        if ch.get("total_minor") is not None and "base_minor" not in f and total != ch["total_minor"]:
            raise _err(422, "TOTAL_FIXED", "a tax-inclusive charge keeps its total")
        if tax is None or total is None or base + int(tax) != int(total):
            raise _err(422, "TOTAL_MISMATCH", "total_minor must equal base_minor + tax_minor")
    status = f.get("status", ch["status"])
    link_url = f.get("payment_link_url", ch.get("payment_link_url"))
    if status == "LINK_SENT" and not link_url:
        raise _err(422, "LINK_REQUIRED", "LINK_SENT needs payment_link_url")
    if status == "DEBIT_SCHEDULED":
        mid = f.get("mandate_id") or (str(ch["mandate_id"]) if ch.get("mandate_id") else None)
        m = pa.one(db, "SELECT * FROM ai_subscription_mandate WHERE CAST(id AS TEXT) = :m", {"m": str(mid)}) \
            if mid else None
        if m is None or m.get("status") != "ACTIVE":
            raise _err(422, "MANDATE_NOT_ACTIVE", "a debit needs an ACTIVE mandate")
        if str(m.get("institute_id")) != str(sub["institute_id"]):
            raise _err(422, "MANDATE_OTHER_INSTITUTE", "the mandate belongs to another institute")
        total = f.get("total_minor", ch.get("total_minor"))
        cap = min(int(m.get("max_amount_minor") or 0), AFA_CEILING_MINOR)
        if total is None or int(total) > cap:
            raise _err(422, "ABOVE_MANDATE_LIMIT", "the charge is above the mandate / Rs 15,000 autopay limit: "
                                                   "use a payment link")
        notice = _aware(f.get("pre_debit_notice_sent_at", ch.get("pre_debit_notice_sent_at")))
        at = _aware(f.get("next_attempt_at", ch.get("next_attempt_at")))
        # Cards / e-mandate: we raise the debit itself, so it must come >= 24 h after our notice.
        # UPI Autopay: next_attempt_at is when admin_core RAISES the recurring payment; the
        # pre-debit notification is then sent to the customer and the charge is initiated
        # 25 hours after it ("subsequent charges are initiated 25 hours after the Pre Debit
        # notification is sent to the customer",
        # https://razorpay.com/docs/payments/recurring-payments/upi/faqs/), so only our own
        # notice must come first.
        gap = timedelta(0) if str(m.get("method") or "").upper() == "UPI" else PRE_DEBIT_NOTICE
        if notice is None or at is None or at < notice + gap:
            raise _err(422, "PRE_DEBIT_NOTICE", "the debit must be at least 24 hours after the pre-debit notice"
                       if gap else "a UPI Autopay debit is raised only after the pre-debit notice")
    if "mandate_id" in f and f["mandate_id"] is not None:
        if pa.one(db, "SELECT 1 AS x FROM ai_subscription_mandate WHERE CAST(id AS TEXT) = :m AND institute_id = :i",
                  {"m": str(f["mandate_id"]), "i": sub["institute_id"]}) is None:
            raise _err(422, "MANDATE_NOT_FOUND", "mandate not found for this institute")
    new = _set_charge(db, str(ch["id"]), f)
    if "status" in f and f["status"] != ch["status"]:
        _event(db, sub, "CHARGE_STATUS", {"charge_id": str(ch["id"]), "status": ch["status"]},
               {"charge_id": str(ch["id"]), "status": f["status"]}, body.actor, body.reason)
    return charge_out(new)


def list_charges(db: Session, *, status: Optional[str] = None, needs_collection: bool = False,
                 institute_id: Optional[str] = None, subscription_id: Optional[str] = None,
                 charge_id: Optional[str] = None, limit: int = 500,
                 now: Optional[datetime] = None) -> Dict[str, Any]:
    """Charges, newest service start last.

    needs_collection=true is admin_core's work list (critique #6: state, not a roll
    report, drives collection): every OPEN charge (DUE, LINK_SENT, DEBIT_SCHEDULED,
    FAILED) of a PENDING / ACTIVE / GRACE subscription. admin_core decides per
    charge what is due now (T-7 link, reminder, pre-debit notice, debit at
    next_attempt_at, link expiry), so a charge with a live link or a scheduled
    debit stays on the list. In this collection view `status=DUE` (the contract's
    `GET /charges?status=DUE&needs_collection=true`) means "owed", i.e. any open
    status; other status values filter literally."""
    now = now or _now()
    where, params = [], {"lim": limit, "now": now}
    sts = [x.strip().upper() for x in (status or "").split(",") if x.strip()]
    if needs_collection and sts == ["DUE"]:
        sts = []                                    # DUE = owed: the open statuses below
    if sts:
        where.append("c.status = ANY(CAST(:st AS VARCHAR[]))")
        params["st"] = sts
    if needs_collection:
        where.append("s.status IN ('PENDING','ACTIVE','GRACE') AND c.status = ANY(CAST(:open AS VARCHAR[]))")
        params["open"] = list(CHARGE_OPEN)
    if charge_id:
        where.append("c.id = CAST(:cid AS UUID)")
        params["cid"] = _uuid(charge_id, "charge")
    if institute_id:
        where.append("s.institute_id = :i")
        params["i"] = institute_id
    if subscription_id:
        where.append("c.subscription_id = CAST(:sid AS UUID)")
        params["sid"] = _uuid(subscription_id, "subscription")
    sql = ("SELECT c.*, s.institute_id, s.status AS subscription_status, s.source, s.grace_days, "
           "p.plan_key, p.name AS plan_name, v.version_no, v.sac_code, v.is_tax_inclusive, v.period_months "
           "FROM ai_subscription_charge c JOIN institute_ai_subscription s ON s.id = c.subscription_id "
           "JOIN ai_plan_version v ON v.id = c.plan_version_id JOIN ai_plan p ON p.id = v.plan_id " +
           (("WHERE " + " AND ".join(where)) if where else "") + " ORDER BY c.service_start, c.created_at LIMIT :lim")
    autopay = autopay_enabled()
    out = []
    mandates: Dict[str, Optional[Dict[str, Any]]] = {}
    for r in pa.rows(db, sql, params):
        co = charge_out(r)
        co["grace_days"] = r.get("grace_days")
        renewal = r.get("kind") == "PERIOD" and r.get("subscription_status") in ("ACTIVE", "GRACE")
        co["is_renewal"] = renewal
        co["due_at"] = co["service_start"] if renewal else co["created_at"]
        if r.get("kind") == "UPGRADE":
            expire = now + UPGRADE_QUOTE_TTL
        elif renewal:
            expire = _aware(r["service_start"]) + timedelta(days=int(r.get("grace_days") or 0))
        else:
            expire = _aware(r["created_at"]) + CHECKOUT_TTL
        co["suggested_expire_by"] = pa.iso(max(expire, now + timedelta(hours=1)))
        v = {"plan_name": r.get("plan_name"), "plan_key": r.get("plan_key")}
        from_v = None
        if r.get("kind") == "UPGRADE":
            q = _upgrade_quote(db, str(r["subscription_id"]), str(r["id"])) or {}
            from_v = _version(db, q.get("from_version_id")) if q.get("from_version_id") else None
            co["from_version_id"] = q.get("from_version_id")
        co["description"] = describe(r, v, from_v)
        key = str(r["subscription_id"])
        if key not in mandates:
            m = pa.one(db, "SELECT * FROM ai_subscription_mandate WHERE (subscription_id = CAST(:s AS UUID) OR "
                           "(subscription_id IS NULL AND institute_id = :i)) AND status = 'ACTIVE' "
                           "ORDER BY created_at DESC LIMIT 1", {"s": key, "i": r["institute_id"]})
            mandates[key] = m
        m = mandates[key]
        co["mandate"] = _mandate_out(m)
        amount = r.get("total_minor")
        # D5: a renewal up to the mandate / Rs 15,000 AFA-free ceiling is debited; anything else,
        # and a renewal whose debit already failed, is collected with a payment link
        failed = r.get("status") == "FAILED" or int(r.get("debit_attempts") or 0) > 0
        co["collection_mode"] = "MANDATE" if (
            autopay and renewal and not failed and m is not None and amount is not None
            and int(amount) <= min(int(m.get("max_amount_minor") or 0), AFA_CEILING_MINOR)) else "LINK"
        out.append(co)
    return {"charges": out, "now": pa.iso(now), "autopay_enabled": autopay}


# ── roll (called by routers/plans_internal.roll for source=PAYMENT) ─────────

def roll_payment(db: Session, sid: str, iid: str, now: datetime, dry_run: bool,
                 extra: Optional[Dict[str, List[Dict[str, Any]]]] = None) -> List[str]:
    """Bring one paid subscription up to `now` (critique #4: a path of its own;
    never pre-creates periods). Runs in the caller's transaction."""
    if not billing_ready(db):
        return []
    extra = extra if extra is not None else {}
    created_sink = extra.setdefault("charges_created", [])
    voided_sink = extra.setdefault("charges_voided", [])
    pa.xact_lock(db, f"ai_subscription:{iid}")
    sub = pa.one(db, "SELECT * FROM institute_ai_subscription WHERE id = CAST(:s AS UUID) FOR UPDATE", {"s": sid})
    if sub is None or sub["status"] not in ("PENDING", "TRIAL", "ACTIVE", "GRACE"):
        return []
    done: List[str] = []

    def move(kind: str, fields: Dict[str, Any], reason: str) -> None:
        nonlocal sub
        done.append(kind)
        after = {**sub, **fields}
        if not dry_run:
            after = _set_sub(db, sid, fields, ACTOR)
            _event(db, sub, kind, pa.sub_state(sub), pa.sub_state(after), ACTOR, reason)
        sub = after

    def void_open(reason: str, **kw: Any) -> None:
        got = _void(db, sub, _open_charges(db, sid, **kw), reason, ACTOR, voided_sink, dry_run=dry_run)
        if got:
            done.append("CHARGES_VOIDED")

    if sub["status"] == "PENDING":
        charges = _open_charges(db, sid, kind="PERIOD")
        expiry = _aware(sub["created_at"]) + CHECKOUT_TTL
        for c in charges:
            le = _aware(c.get("link_expires_at"))
            if le is not None and le > expiry:
                expiry = le
        if now < expiry + EXPIRY_SLACK:
            return done
        void_open("CHECKOUT_EXPIRED")
        move("CHECKOUT_EXPIRED", {"status": "EXPIRED", "end_at": now}, "the checkout was not paid in time")
        return done

    # stale unpaid upgrades (their quote is long out of date)
    stale = [c for c in _open_charges(db, sid, kind="UPGRADE")
             if _aware(c["created_at"]) <= now - UPGRADE_STALE or _aware(c["service_end"]) <= now]
    if stale:
        _void(db, sub, stale, "QUOTE_EXPIRED", ACTOR, voided_sink, dry_run=dry_run)
        done.append("CHARGES_VOIDED")
    periods = _paid_periods(db, sid)
    if not periods:
        logger.warning("plans roll: paid subscription %s is %s without a paid period", sid, sub["status"])
        return done
    latest = periods[-1]
    p_end = _aware(latest["period_end"])
    end_at = _aware(sub.get("end_at"))
    if end_at is not None and end_at <= now:
        void_open("ENDED")
        move("EXPIRED", {"status": "EXPIRED"}, "end_at reached")
        return done
    # the subscription follows the paid period it is in (a renewal on another version paid ahead)
    cur = _period_at(periods, now)
    if cur is not None and str(cur["plan_version_id"]) != str(sub["plan_version_id"]) \
            and _aware(cur["period_start"]) > _aware(sub["start_at"]):
        fields: Dict[str, Any] = {"plan_version_id": str(cur["plan_version_id"])}
        if str(sub.get("pending_plan_version_id") or "") == str(cur["plan_version_id"]):
            fields["pending_plan_version_id"] = None
        move("PLAN_CHANGED", fields, "applied at renewal (paid period started)")
    renews = bool(sub.get("auto_renew")) and not sub.get("cancel_at_period_end") and (end_at is None or end_at > p_end)
    if now < p_end:
        if renews and now >= p_end - RENEWAL_LEAD:
            ch, created = ensure_renewal_charge(db, sub, p_end, dry_run=dry_run)
            if created:
                done.append("CHARGE_CREATED")
                if ch is not None:
                    created_sink.append({**charge_out(ch), "institute_id": iid})
        if sub["status"] == "GRACE" and cur is not None:
            move("GRACE_CLEARED", {"status": "ACTIVE"}, "period paid")
        return done
    # the latest paid period is over and the next one is not paid
    if sub.get("cancel_at_period_end"):
        void_open("CANCELLED")
        move("CANCELLED", {"status": "CANCELLED", "end_at": p_end, "auto_renew": False}, "cancel_at_period_end")
        return done
    if not renews:
        void_open("NOT_RENEWING")
        move("EXPIRED", {"status": "EXPIRED", "end_at": end_at if end_at is not None and end_at < p_end else p_end},
             "period ended without auto-renew")
        return done
    ch, created = ensure_renewal_charge(db, sub, p_end, dry_run=dry_run)
    if created:
        done.append("CHARGE_CREATED")
        if ch is not None:
            created_sink.append({**charge_out(ch), "institute_id": iid})
    grace_until = p_end + timedelta(days=int(sub.get("grace_days") or 0))
    if now < grace_until:
        if sub["status"] != "GRACE":
            move("GRACE_STARTED", {"status": "GRACE"}, "renewal unpaid at the period end")
        return done
    void_open("UNPAID_EXPIRED")
    move("EXPIRED", {"status": "EXPIRED", "end_at": p_end}, "renewal unpaid after the grace days")
    return done


# ── endpoints ───────────────────────────────────────────────────────────────

def _run(db: Session, fn, *args, **kw):
    """Run a write in one transaction: commit on success, roll back on any error;
    database errors are mapped (a unique-index race is a 409)."""
    try:
        out = fn(db, *args, **kw)
    except HTTPException:
        pa._rollback(db)  # noqa: SLF001
        raise
    except DBAPIError as exc:
        pa._rollback(db)  # noqa: SLF001
        state = pa.sqlstate(exc)
        msg = str(getattr(exc, "orig", exc)).splitlines()[0][:300]
        if state == "23505":
            raise _err(409, "CONFLICT", f"a concurrent change won ({msg})")
        logger.error("AI plan billing write failed (%s): %s", state, msg)
        raise _err(503, "WRITE_FAILED", "could not save the change")
    pa.commit(db)
    return out


@router.get("/storefront/catalog", summary="Plans an institute can buy, its current plan and mandate")
def storefront_catalog(institute_id: str = Query(..., min_length=1, max_length=64), preview: bool = Query(False),
                       db: Session = Depends(db_dependency)):
    require_billing(db)
    try:
        return catalog(db, institute_id.strip(), preview=preview)
    finally:
        pa._rollback(db)  # noqa: SLF001 - read only


@router.post("/subscriptions/quote", summary="Price of a new plan, an upgrade (pro-rata) or a downgrade")
def subscriptions_quote(body: QuoteBody, db: Session = Depends(db_dependency)):
    require_billing(db)
    action = pa._upper(body.action, ACTIONS, "action")  # noqa: SLF001
    try:
        v = _published_inr(db, body.plan_version_id)
        iid = pa._institute(body.institute_id)  # noqa: SLF001
        if body.self_serve and action in ("UPGRADE", "DOWNGRADE"):
            _offered(db, iid, v)
        return quote_for(db, iid, v, action, _now())
    finally:
        pa._rollback(db)  # noqa: SLF001


@router.post("/subscriptions/checkout", summary="Start a paid subscription: PENDING + its first DUE charge")
def subscriptions_checkout(body: CheckoutBody, db: Session = Depends(db_dependency)):
    require_billing(db)
    require_payments()
    out = _run(db, do_checkout, body)
    notify(body.institute_id.strip())
    return out


@router.post("/subscriptions/{sid}/change", summary="Upgrade now, downgrade / cancel at period end, resume")
def subscriptions_change(sid: str, body: ChangeBody, db: Session = Depends(db_dependency)):
    require_billing(db)
    if str(body.action or "").strip().upper() in ("UPGRADE", "DOWNGRADE", "RESUME"):
        require_payments()
    out = _run(db, do_change, sid, body)
    iid = pa.one(db, "SELECT institute_id FROM institute_ai_subscription WHERE id = CAST(:s AS UUID)",
                 {"s": out["subscription_id"]})
    pa._rollback(db)  # noqa: SLF001
    if iid:
        notify(iid["institute_id"], live=False if out.get("live") is False else None)
    return out


@router.get("/charges", summary="Charges, e.g. the ones admin_core must collect (needs_collection=true)")
def charges(status: Optional[str] = Query(None, max_length=200), needs_collection: bool = Query(False),
            institute_id: Optional[str] = Query(None, max_length=64),
            subscription_id: Optional[str] = Query(None, max_length=64),
            charge_id: Optional[str] = Query(None, max_length=64),
            limit: int = Query(500, ge=1, le=2000), db: Session = Depends(db_dependency)):
    require_billing(db)
    try:
        return list_charges(db, status=status, needs_collection=needs_collection,
                            institute_id=institute_id.strip() if institute_id else None,
                            subscription_id=subscription_id, charge_id=charge_id, limit=limit)
    finally:
        pa._rollback(db)  # noqa: SLF001


@router.patch("/charges/{cid}", summary="Link / mandate / tax snapshot and collection status of a charge")
def charges_patch(cid: str, body: ChargePatch, db: Session = Depends(db_dependency)):
    require_billing(db)
    if str(body.status or "").strip().upper() == "WAIVED":
        # admin_core's staff waiver arrives as PATCH {status: WAIVED, void_reason, actor}
        return _waive(db, cid, (body.void_reason or body.reason or "").strip(), body.actor)
    return _run(db, patch_charge, cid, body)


def _after_money(out: Dict[str, Any], live: Optional[bool]) -> Dict[str, Any]:
    if live is not None:
        notify(out["institute_id"], live=live, paid=True if live else None)
    elif out.get("action") not in ("ALREADY_PROCESSED", "DUPLICATE", "REFUND_REQUIRED"):
        notify(out["institute_id"])
    return out


@router.post("/charges/{cid}/paid", summary="A payment of the charge was captured (idempotent)")
def charges_paid(cid: str, body: PaidBody, db: Session = Depends(db_dependency)):
    require_billing(db)
    out, live = _run(db, do_paid, cid, body)
    return _after_money(out, live)


@router.post("/charges/{cid}/refunded", summary="The charge's payment was refunded (cumulative amount)")
def charges_refunded(cid: str, body: RefundedBody, db: Session = Depends(db_dependency)):
    require_billing(db)
    out, live = _run(db, do_refunded, cid, body)
    return _after_money(out, live)


@router.post("/charges/{cid}/void", summary="Void an unpaid charge (admin_core cancels its link)")
def charges_void(cid: str, body: VoidBody, db: Session = Depends(db_dependency)):
    require_billing(db)
    out, live = _run(db, do_void, cid, body)
    return _after_money(out, live)


@router.post("/charges/{cid}/waive", summary="Staff waiver: the period's benefits without payment (no invoice)")
def charges_waive(cid: str, body: VoidBody, db: Session = Depends(db_dependency)):
    require_billing(db)
    return _waive(db, cid, body.reason, body.actor)


def _waive(db: Session, cid: str, reason_text: Optional[str], actor: Optional[str]) -> Dict[str, Any]:
    reason = pa.need_reason(reason_text)
    pbody = PaidBody(vendor_payment_id="WAIVED", amount_minor=0, actor=actor)
    out, live = _run(db, do_paid, cid, pbody, waive_reason=f"waived: {reason}")
    out["action"] = "WAIVED" if out["action"] in ("ACTIVATED", "RENEWAL_PAID", "GRACE_CLEARED", "UPGRADED") \
        else out["action"]
    return _after_money(out, live)


__all__ = ["router", "roll_payment", "catalog", "storefront_access", "prorate", "base_of", "do_checkout",
           "do_change", "do_paid", "do_refunded", "do_void", "patch_charge", "list_charges", "billing_ready",
           "subscription_summary", "ensure_renewal_charge", "CheckoutBody", "ChangeBody", "PaidBody",
           "RefundedBody", "VoidBody", "ChargePatch", "tenant_features", "latest_mandate", "payments_enabled",
           "has_column", "describe", "debit_in_flight"]
