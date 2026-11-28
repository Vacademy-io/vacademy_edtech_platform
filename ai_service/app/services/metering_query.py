"""
Read side of AI usage metering: queries behind /credits/v2/** (tenant History
and Analytics v2) and /super-admin/v1/metering/** (catalog, role map,
coverage, parity).

Everything here only READS ai_usage_event / credit_transactions, except the
two super-admin writes (catalog label fields, role map rows). Rules:

  * parameterised SQL only; the few interpolated fragments (group-by key,
    metric) come from fixed whitelists in this module, never from the request;
  * the institute filter is always in the SQL WHERE, and a non-admin viewer's
    actor filter is too (never filtered after the query);
  * pages are ordered by (occurred_at DESC, id DESC), so they are stable;
  * day buckets are IST calendar days (`AT TIME ZONE 'Asia/Kolkata'`);
  * credit_transactions.created_at is naive UTC, ai_usage_event.occurred_at is
    timestamptz: ledger bounds are passed as naive UTC datetimes.

When the metering tables are not there yet (admin_core Flyway not applied),
every read answers empty and the writes answer 503 from the router.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, time as dtime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

EVENT_TABLE = "ai_usage_event"
CATALOG_TABLE = "ai_use_case_catalog"
ROLE_MAP_TABLE = "ai_role_class_map"

IST = timezone(timedelta(hours=5, minutes=30))
IST_SQL = "Asia/Kolkata"

ROLE_CLASSES = ("ADMIN", "TEACHER", "STAFF", "PARENT", "LEARNER", "SYSTEM", "API_KEY", "PUBLIC", "UNKNOWN")
BILLING_MODES = ("CHARGED", "INCLUDED", "ALLOWANCE", "SPLIT", "FREE", "BYO_KEY")
SURFACES = ("ADMIN_APP", "LEARNER_APP", "PUBLIC", "PARTNER_API", "WHATSAPP", "PHONE", "SCHEDULED",
            "INTERNAL", "UNKNOWN")
SUMMARY_DAYS = (7, 14, 30, 90)
GROUP_BYS = ("use_case", "feature_group", "role_class", "user", "day", "model")
METRICS = ("charged", "list")

EXPORT_CAP = 100_000
EXPORT_BATCH = 2_000
MAX_SUMMARY_ROWS = 1_000

ROLE_CLASS_LABELS = {
    "ADMIN": "Admin", "TEACHER": "Teacher", "STAFF": "Staff", "PARENT": "Parent",
    "LEARNER": "Learner", "SYSTEM": "System", "API_KEY": "API key", "PUBLIC": "Public",
    "UNKNOWN": "Unknown",
}
FEATURE_GROUP_LABELS = {
    "tutor": "AI tutor", "video": "Video", "calling": "Calling", "content": "Content",
    "assessment": "Assessment", "analytics": "Analytics", "kb": "Knowledge base", "crm": "CRM",
    "engagement": "Engagement", "agent": "Agents and assistants", "media": "Media",
    "platform": "Other",
}

# Whitelisted SQL fragments (alias e = ai_usage_event). Never built from input.
_GROUP_KEY_SQL = {
    "use_case": "e.use_case",
    "feature_group": "e.feature_group",
    "role_class": "COALESCE(e.actor_role_class, 'UNKNOWN')",
    "user": "COALESCE(e.actor_user_id, '')",
    "day": f"to_char(e.occurred_at AT TIME ZONE '{IST_SQL}', 'YYYY-MM-DD')",
    "model": "COALESCE(e.model_id, 'unknown')",
}
_METRIC_SQL = {
    # Net of refunds, like the v1 analytics.
    "charged": "COALESCE(e.credits_charged, 0) - COALESCE(e.refunded_credits, 0)",
    "list": "COALESCE(e.list_credits, 0)",
}

_EVENT_COLUMNS = (
    "e.id, e.occurred_at, e.use_case, e.feature_group, e.request_type, e.tool_key, e.actor_kind, "
    "e.actor_user_id, e.actor_display_name, e.actor_role_class, e.subject_user_id, "
    "e.subject_display_name, e.surface, e.model_id, e.prompt_tokens, e.completion_tokens, "
    "e.cached_read_tokens, e.reasoning_tokens, e.image_count, e.seconds, e.minutes, e.characters, "
    "e.list_credits, e.credits_charged, e.refunded_credits, e.billing_mode, e.charge_status, "
    "e.batch_id, e.ledger_tx_id, e.context, e.real_cost_usd, "
    "ct.balance_after AS balance_after, ct.description AS ledger_description"
)
_EVENT_FROM = (
    f"FROM {EVENT_TABLE} e LEFT JOIN credit_transactions ct "
    "ON ct.id = e.ledger_tx_id AND ct.institute_id = e.institute_id "
)

CSV_COLUMNS = (
    "id", "occurred_at_ist", "occurred_at_utc", "label", "use_case", "use_case_label", "feature_group",
    "actor_name", "actor_user_id", "actor_role_class", "subject_name", "subject_user_id", "surface",
    "model_id", "prompt_tokens", "completion_tokens", "cached_read_tokens", "reasoning_tokens",
    "image_count", "seconds", "minutes", "characters", "list_credits", "credits_charged",
    "refunded_credits", "billing_mode", "charge_status", "batch_id", "ledger_tx_id", "context_json",
)


# ── value objects ───────────────────────────────────────────────────────────

@dataclass
class EventFilters:
    from_date: Optional[date] = None
    to_date: Optional[date] = None
    user_id: Optional[str] = None
    role_class: Optional[str] = None
    feature_group: Optional[str] = None
    use_case: Optional[str] = None
    billing_mode: Optional[str] = None
    surface: Optional[str] = None
    min_credits: Optional[float] = None

    def has_event_only_filter(self) -> bool:
        """Filters that only an event has: with any of them set, the
        non-usage ledger rows (grants, purchases...) are left out."""
        return any((self.user_id, self.role_class, self.feature_group, self.use_case,
                    self.billing_mode, self.surface))


@dataclass
class Scope:
    """Which events a viewer may read. actor_user_id None = the whole
    institute (ADMIN / platform staff); otherwise only that actor's events."""
    institute_id: str
    actor_user_id: Optional[str] = None
    include_cost: bool = False


# ── pure helpers (unit-tested) ──────────────────────────────────────────────

def ist_bounds(from_date: Optional[date], to_date: Optional[date]) -> Tuple[Optional[datetime], Optional[datetime]]:
    """[from 00:00 IST, (to + 1 day) 00:00 IST) as aware UTC datetimes."""
    start = datetime.combine(from_date, dtime.min, tzinfo=IST).astimezone(timezone.utc) if from_date else None
    end = (datetime.combine(to_date + timedelta(days=1), dtime.min, tzinfo=IST).astimezone(timezone.utc)
           if to_date else None)
    return start, end


def window_start(days: int, now: Optional[datetime] = None) -> datetime:
    """00:00 IST of the first of the last `days` IST calendar days (today
    included), as an aware UTC datetime."""
    now = now or datetime.now(timezone.utc)
    first = now.astimezone(IST).date() - timedelta(days=max(int(days), 1) - 1)
    return datetime.combine(first, dtime.min, tzinfo=IST).astimezone(timezone.utc)


def naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    """credit_transactions.created_at is `timestamp without time zone` in UTC."""
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def build_event_where(scope: Scope, f: EventFilters, alias: str = "e") -> Tuple[str, Dict[str, Any]]:
    """WHERE clause (without the keyword) + params for ai_usage_event."""
    a = alias
    clauses = [f"{a}.institute_id = :institute_id"]
    params: Dict[str, Any] = {"institute_id": scope.institute_id}
    if scope.actor_user_id is not None:
        clauses.append(f"{a}.actor_user_id = :scope_actor_user_id")
        params["scope_actor_user_id"] = scope.actor_user_id
    start, end = ist_bounds(f.from_date, f.to_date)
    if start is not None:
        clauses.append(f"{a}.occurred_at >= :from_ts")
        params["from_ts"] = start
    if end is not None:
        clauses.append(f"{a}.occurred_at < :to_ts")
        params["to_ts"] = end
    if f.user_id:
        clauses.append(f"{a}.actor_user_id = :f_user_id")
        params["f_user_id"] = f.user_id
    if f.role_class:
        rc = f.role_class.upper()
        if rc == "UNKNOWN":
            clauses.append(f"COALESCE({a}.actor_role_class, 'UNKNOWN') = :f_role_class")
        else:
            clauses.append(f"{a}.actor_role_class = :f_role_class")
        params["f_role_class"] = rc
    if f.feature_group:
        clauses.append(f"{a}.feature_group = :f_feature_group")
        params["f_feature_group"] = f.feature_group
    if f.use_case:
        clauses.append(f"{a}.use_case = :f_use_case")
        params["f_use_case"] = f.use_case
    if f.billing_mode:
        clauses.append(f"{a}.billing_mode = :f_billing_mode")
        params["f_billing_mode"] = f.billing_mode.upper()
    if f.surface:
        clauses.append(f"{a}.surface = :f_surface")
        params["f_surface"] = f.surface.upper()
    if f.min_credits is not None:
        clauses.append(f"{a}.credits_charged >= :f_min_credits")
        params["f_min_credits"] = f.min_credits
    return " AND ".join(clauses), params


def build_ledger_where(scope: Scope, f: EventFilters, alias: str = "ct") -> Optional[Tuple[str, Dict[str, Any]]]:
    """Ledger rows with no usage event, to merge into History: grants,
    purchases, admin adjustments, refunds, AND any charge whose event was never
    written (kill switch off, a failed event write, before the backfill), so
    the History rows still reconcile with balance_after. None when they must
    be left out: a viewer limited to their own events, or any event-only filter."""
    if scope.actor_user_id is not None or f.has_event_only_filter():
        return None
    a = alias
    clauses = [
        f"{a}.institute_id = :institute_id",
        f"{a}.usage_event_id IS NULL",
        f"({a}.transaction_type <> 'USAGE_DEDUCTION' OR NOT EXISTS ("
        f"SELECT 1 FROM {EVENT_TABLE} lx WHERE lx.ledger_tx_id = {a}.id))",
    ]
    params: Dict[str, Any] = {"institute_id": scope.institute_id}
    start, end = ist_bounds(f.from_date, f.to_date)
    if start is not None:
        clauses.append(f"{a}.created_at >= :l_from_ts")
        params["l_from_ts"] = naive_utc(start)
    if end is not None:
        clauses.append(f"{a}.created_at < :l_to_ts")
        params["l_to_ts"] = naive_utc(end)
    if f.min_credits is not None:
        clauses.append(f"ABS({a}.amount) >= :f_min_credits")
        params["f_min_credits"] = f.min_credits
    return " AND ".join(clauses), params


def page_bounds(page: int, page_size: int) -> Tuple[int, int]:
    """(limit, offset) for a 1-based page."""
    page = max(int(page), 1)
    page_size = max(int(page_size), 1)
    return page_size, (page - 1) * page_size


def model_short(model_id: Optional[str]) -> Optional[str]:
    """'vendor/model-name:variant' -> 'model-name'."""
    if not model_id:
        return None
    return str(model_id).split("/")[-1].split(":")[0] or str(model_id)


def _num(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value)


def _as_dict(value: Any) -> Optional[dict]:
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {"value": parsed}
        except ValueError:
            return {"value": value}
    return None


def _row_dict(row: Any) -> Dict[str, Any]:
    if isinstance(row, dict):
        return dict(row)
    mapping = getattr(row, "_mapping", None)
    return dict(mapping) if mapping is not None else dict(row)


def _jsonable(row: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    for k, v in row.items():
        if isinstance(v, Decimal):
            out[k] = float(v)
        elif isinstance(v, (datetime, date)):
            out[k] = _iso(v) if isinstance(v, datetime) else v.isoformat()
        elif isinstance(v, (list, tuple)):
            out[k] = list(v)
        else:
            out[k] = v if v is None or isinstance(v, (str, int, float, bool, dict)) else str(v)
    return out


# ── labels ──────────────────────────────────────────────────────────────────

def _fallback_label(catalog_row: Optional[dict], event_row: dict) -> str:
    if catalog_row and catalog_row.get("use_case") != "unknown" and catalog_row.get("label"):
        return str(catalog_row["label"])
    return (event_row.get("description") or (catalog_row or {}).get("label")
            or event_row.get("use_case") or "AI usage")


_label_warned = {"at": 0.0}


def _core_render() -> Optional[Callable[[Optional[dict], dict], Any]]:
    try:
        from .metering.labels import render_label as core_render  # type: ignore
        return core_render
    except Exception:  # noqa: BLE001 - core not deployed / import problem
        return None


def render_label(catalog_row: Optional[dict], event_row: dict) -> str:
    """The metering core's render_label (services/metering/labels.py), with a
    plain fallback so a template problem can never break History."""
    core_render = _core_render()
    if core_render is not None:
        try:
            out = core_render(catalog_row, event_row)
            if out:
                return str(out)
        except Exception:  # noqa: BLE001
            now = time.monotonic()
            if now - _label_warned["at"] > 60:
                _label_warned["at"] = now
                logger.warning("metering label render failed; using the catalog label", exc_info=True)
    return _fallback_label(catalog_row, event_row)


def group_label(group_by: str, key: Optional[str], raw_label: Optional[str], catalog: Dict[str, dict]) -> str:
    if group_by == "use_case":
        row = catalog.get(key or "")
        return str(row.get("label")) if row and row.get("label") else (key or "unknown")
    if group_by == "feature_group":
        return FEATURE_GROUP_LABELS.get(key or "", (key or "other").replace("_", " ").capitalize())
    if group_by == "role_class":
        return ROLE_CLASS_LABELS.get(key or "UNKNOWN", key or "Unknown")
    if group_by == "user":
        if not key:
            return "System / unattributed"
        return raw_label or key
    if group_by == "model":
        return model_short(key) or "unknown"
    return key or ""


# ── row -> API item ─────────────────────────────────────────────────────────

def _event_label_row(r: Dict[str, Any]) -> Dict[str, Any]:
    """The event as render_label sees it: DB column names plus the names the
    API uses (actor_name / subject_name) and the linked ledger description."""
    row = dict(r)
    row["context"] = _as_dict(r.get("context")) or {}
    row["actor_name"] = r.get("actor_display_name")
    row["subject_name"] = r.get("subject_display_name")
    row["description"] = r.get("ledger_description")
    for k in ("minutes", "seconds", "list_credits", "credits_charged", "refunded_credits"):
        if k in row:
            row[k] = _num(row[k])
    return row


def event_item(r: Dict[str, Any], catalog: Dict[str, dict], include_cost: bool) -> Dict[str, Any]:
    cat = catalog.get(r.get("use_case") or "")
    item = {
        "kind": "usage",
        "id": str(r.get("id")),
        "occurred_at": _iso(r.get("occurred_at")),
        "label": render_label(cat, _event_label_row(r)),
        "use_case": r.get("use_case"),
        "use_case_label": (cat or {}).get("label") or r.get("use_case"),
        "feature_group": r.get("feature_group"),
        "actor_user_id": r.get("actor_user_id"),
        "actor_name": r.get("actor_display_name"),
        "actor_role_class": r.get("actor_role_class"),
        "subject_user_id": r.get("subject_user_id"),
        "subject_name": r.get("subject_display_name"),
        "surface": r.get("surface"),
        "model_id": r.get("model_id"),
        "model_short": model_short(r.get("model_id")),
        "units": {
            "prompt_tokens": _int(r.get("prompt_tokens")),
            "completion_tokens": _int(r.get("completion_tokens")),
            "cached_read_tokens": _int(r.get("cached_read_tokens")),
            "image_count": _int(r.get("image_count")),
            "seconds": _num(r.get("seconds")) or 0.0,
            "minutes": _num(r.get("minutes")) or 0.0,
            "characters": _int(r.get("characters")),
        },
        "list_credits": _num(r.get("list_credits")) or 0.0,
        "credits_charged": _num(r.get("credits_charged")) or 0.0,
        "refunded_credits": _num(r.get("refunded_credits")) or 0.0,
        "billing_mode": r.get("billing_mode"),
        "charge_status": r.get("charge_status"),
        "batch_id": r.get("batch_id"),
        "ledger_tx_id": str(r["ledger_tx_id"]) if r.get("ledger_tx_id") else None,
        "balance_after": _num(r.get("balance_after")),
        # Vendor-cost keys are never shown to a tenant (the writer strips them
        # too; this covers rows written before that).
        "context": _as_dict(r.get("context")) if include_cost else _strip_cost(_as_dict(r.get("context"))),
    }
    if include_cost:
        item["real_cost_usd"] = _num(r.get("real_cost_usd"))
    return item


def ledger_item(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "kind": "ledger",
        "id": str(r.get("id")),
        "occurred_at": _iso(r.get("created_at")),
        "transaction_type": r.get("transaction_type"),
        "amount": _num(r.get("amount")) or 0.0,
        "balance_after": _num(r.get("balance_after")),
        "description": r.get("description"),
    }


def _csv_text(value: Any) -> str:
    """Neutralise spreadsheet formulas in free text (names, labels, context)."""
    s = "" if value is None else str(value)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


def _csv_cell(value: Any) -> Any:
    """Numbers as they are; every other cell (ids, enums, names, JSON: any of
    them may hold caller-supplied text) through _csv_text."""
    if isinstance(value, bool):
        return _csv_text(value)
    if isinstance(value, (int, float, Decimal)):
        return value
    return _csv_text(value)


def _strip_cost(context: Optional[dict]) -> Optional[dict]:
    try:
        from .metering.service import strip_cost_keys

        return strip_cost_keys(context)
    except Exception:  # noqa: BLE001
        return None


def csv_header(include_cost: bool) -> List[str]:
    return list(CSV_COLUMNS) + (["real_cost_usd"] if include_cost else [])


def csv_row(r: Dict[str, Any], catalog: Dict[str, dict], include_cost: bool) -> List[Any]:
    item = event_item(r, catalog, include_cost)
    occurred = r.get("occurred_at")
    if isinstance(occurred, datetime) and occurred.tzinfo is None:
        occurred = occurred.replace(tzinfo=timezone.utc)
    ist = occurred.astimezone(IST).strftime("%Y-%m-%d %H:%M:%S") if isinstance(occurred, datetime) else ""
    utc = occurred.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S") if isinstance(occurred, datetime) else ""
    u = item["units"]
    out = [
        item["id"], ist, utc, _csv_text(item["label"]), item["use_case"] or "", _csv_text(item["use_case_label"]),
        item["feature_group"] or "", _csv_text(item["actor_name"]), item["actor_user_id"] or "",
        item["actor_role_class"] or "", _csv_text(item["subject_name"]), item["subject_user_id"] or "",
        item["surface"] or "", item["model_id"] or "", u["prompt_tokens"], u["completion_tokens"],
        u["cached_read_tokens"], _int(r.get("reasoning_tokens")), u["image_count"], u["seconds"], u["minutes"],
        u["characters"], item["list_credits"], item["credits_charged"], item["refunded_credits"],
        item["billing_mode"] or "", item["charge_status"] or "", _csv_text(item["batch_id"]),
        item["ledger_tx_id"] or "",
        _csv_text(json.dumps(item["context"], ensure_ascii=False, default=str) if item["context"] else ""),
    ]
    if include_cost:
        out.append("" if item.get("real_cost_usd") is None else item["real_cost_usd"])
    return [_csv_cell(v) for v in out]


def _csv_line(values: List[Any]) -> str:
    buf = io.StringIO()
    csv.writer(buf).writerow(values)
    return buf.getvalue()


# ── catalog cache ───────────────────────────────────────────────────────────

_CATALOG_TTL = 60.0
_catalog_cache: Dict[str, Any] = {"at": None, "rows": {}}
_catalog_lock = threading.Lock()


def invalidate_catalog_cache() -> None:
    _catalog_cache["at"] = None


_tables_cache: Dict[str, Any] = {"at": None, "ready": False}
_TABLES_TTL = 60.0
_missing_logged = {"done": False}


# ── the query object ────────────────────────────────────────────────────────

class MeteringQuery:
    """All SQL for the metering read API. One per request (holds the session)."""

    def __init__(self, db: Session):
        self.db = db

    # -- readiness / reference data --

    def tables_ready(self) -> bool:
        now = time.monotonic()
        at = _tables_cache["at"]
        if at is not None and now - at < _TABLES_TTL:
            return bool(_tables_cache["ready"])
        try:
            ready = bool(self.db.execute(
                text("SELECT to_regclass(:t) IS NOT NULL AND to_regclass(:c) IS NOT NULL"),
                {"t": EVENT_TABLE, "c": CATALOG_TABLE},
            ).scalar())
        except Exception:  # noqa: BLE001
            logger.warning("could not check for %s", EVENT_TABLE, exc_info=True)
            try:
                self.db.rollback()
            except Exception:  # noqa: BLE001
                pass
            ready = False
        if not ready and not _missing_logged["done"]:
            _missing_logged["done"] = True
            logger.info("%s is not there yet (admin_core Flyway); metering reads answer empty", EVENT_TABLE)
        _tables_cache.update(at=now, ready=ready)
        return ready

    def catalog(self) -> Dict[str, dict]:
        now = time.monotonic()
        at = _catalog_cache["at"]
        if at is not None and now - at < _CATALOG_TTL:
            return _catalog_cache["rows"]
        with _catalog_lock:
            try:
                rows = self.db.execute(text(
                    f"SELECT use_case, feature_group, label, label_template, count_unit_label, "
                    f"display_order, is_active FROM {CATALOG_TABLE}"
                )).fetchall()
                _catalog_cache["rows"] = {r._mapping["use_case"]: dict(r._mapping) for r in rows}
            except Exception:  # noqa: BLE001 - last good on error
                logger.warning("could not load %s; using the last good copy", CATALOG_TABLE, exc_info=True)
                try:
                    self.db.rollback()
                except Exception:  # noqa: BLE001
                    pass
            _catalog_cache["at"] = now
            return _catalog_cache["rows"]

    # -- tenant reads --

    def count_events(self, scope: Scope, f: EventFilters) -> int:
        where, params = build_event_where(scope, f)
        return int(self.db.execute(text(f"SELECT COUNT(*) FROM {EVENT_TABLE} e WHERE {where}"), params).scalar() or 0)

    def list_events(self, scope: Scope, f: EventFilters, page: int, page_size: int) -> Dict[str, Any]:
        limit, offset = page_bounds(page, page_size)
        ew, params = build_event_where(scope, f)
        ledger = build_ledger_where(scope, f)
        if ledger is not None:
            lw, lparams = ledger
            params = {**params, **lparams}
            total_sql = (f"SELECT (SELECT COUNT(*) FROM {EVENT_TABLE} e WHERE {ew}) "
                         f"+ (SELECT COUNT(*) FROM credit_transactions ct WHERE {lw})")
            page_sql = (
                "SELECT kind, id, occurred_at FROM ("
                f"SELECT 'usage' AS kind, CAST(e.id AS text) AS id, e.occurred_at AS occurred_at "
                f"FROM {EVENT_TABLE} e WHERE {ew} "
                "UNION ALL "
                "SELECT 'ledger' AS kind, CAST(ct.id AS text) AS id, "
                "(ct.created_at AT TIME ZONE 'UTC') AS occurred_at "
                f"FROM credit_transactions ct WHERE {lw}"
                ") u ORDER BY occurred_at DESC, id DESC LIMIT :limit OFFSET :offset"
            )
        else:
            total_sql = f"SELECT COUNT(*) FROM {EVENT_TABLE} e WHERE {ew}"
            page_sql = (f"SELECT 'usage' AS kind, CAST(e.id AS text) AS id, e.occurred_at AS occurred_at "
                        f"FROM {EVENT_TABLE} e WHERE {ew} "
                        "ORDER BY e.occurred_at DESC, e.id DESC LIMIT :limit OFFSET :offset")
        total = int(self.db.execute(text(total_sql), params).scalar() or 0)
        keys = self.db.execute(text(page_sql), {**params, "limit": limit, "offset": offset}).fetchall()
        keys = [_row_dict(k) for k in keys]
        event_ids = [k["id"] for k in keys if k["kind"] == "usage"]
        ledger_ids = [k["id"] for k in keys if k["kind"] == "ledger"]

        events: Dict[str, dict] = {}
        if event_ids:
            # Scope re-applied here: the detail fetch can never widen the page.
            where, dparams = build_event_where(scope, EventFilters())
            rows = self.db.execute(text(
                f"SELECT {_EVENT_COLUMNS} {_EVENT_FROM}WHERE {where} AND e.id = ANY(CAST(:ids AS uuid[]))"
            ), {**dparams, "ids": event_ids}).fetchall()
            events = {str(_row_dict(r)["id"]): _row_dict(r) for r in rows}
        ledgers: Dict[str, dict] = {}
        if ledger_ids:
            rows = self.db.execute(text(
                "SELECT id, created_at, transaction_type, amount, balance_after, description "
                "FROM credit_transactions WHERE institute_id = :institute_id "
                "AND id = ANY(CAST(:ids AS uuid[]))"
            ), {"institute_id": scope.institute_id, "ids": ledger_ids}).fetchall()
            ledgers = {str(_row_dict(r)["id"]): _row_dict(r) for r in rows}

        catalog = self.catalog() if events else {}
        items: List[Dict[str, Any]] = []
        for k in keys:
            if k["kind"] == "usage" and k["id"] in events:
                items.append(event_item(events[k["id"]], catalog, scope.include_cost))
            elif k["kind"] == "ledger" and k["id"] in ledgers:
                items.append(ledger_item(ledgers[k["id"]]))
        return {"items": items, "page": max(int(page), 1), "page_size": limit, "total": total}

    def summary(self, scope: Scope, days: int, group_by: str, metric: str,
                now: Optional[datetime] = None) -> Dict[str, Any]:
        if group_by not in _GROUP_KEY_SQL or metric not in _METRIC_SQL:
            raise ValueError("unsupported group_by / metric")
        key_sql = _GROUP_KEY_SQL[group_by]
        metric_sql = _METRIC_SQL[metric]
        where, params = build_event_where(scope, EventFilters())
        where += " AND e.occurred_at >= :since"
        params["since"] = window_start(days, now)
        label_sql = "MAX(e.actor_display_name)" if group_by == "user" else "NULL"
        order = "key ASC" if group_by == "day" else "credits DESC, key ASC"
        rows = self.db.execute(text(
            f"SELECT {key_sql} AS key, {label_sql} AS label, SUM({metric_sql}) AS credits, COUNT(*) AS events "
            f"FROM {EVENT_TABLE} e WHERE {where} GROUP BY 1 ORDER BY {order}"
        ), params).fetchall()
        rows = [_row_dict(r) for r in rows]
        return summarize(group_by, days, metric, rows, self.catalog() if group_by == "use_case" else {})

    def export_batch(self, scope: Scope, f: EventFilters, after: Optional[Tuple[Any, str]],
                     limit: int) -> List[Dict[str, Any]]:
        where, params = build_event_where(scope, f)
        if after is not None:
            where += " AND (e.occurred_at, e.id) < (:k_at, CAST(:k_id AS uuid))"
            params["k_at"], params["k_id"] = after
        rows = self.db.execute(text(
            f"SELECT {_EVENT_COLUMNS} {_EVENT_FROM}WHERE {where} "
            "ORDER BY e.occurred_at DESC, e.id DESC LIMIT :limit"
        ), {**params, "limit": int(limit)}).fetchall()
        return [_row_dict(r) for r in rows]

    # -- super-admin --

    def catalog_rows(self) -> List[Dict[str, Any]]:
        rows = self.db.execute(text(
            f"SELECT * FROM {CATALOG_TABLE} ORDER BY display_order, use_case"
        )).fetchall()
        return [_jsonable(_row_dict(r)) for r in rows]

    def catalog_row(self, use_case: str) -> Optional[Dict[str, Any]]:
        row = self.db.execute(text(f"SELECT * FROM {CATALOG_TABLE} WHERE use_case = :uc"),
                              {"uc": use_case}).fetchone()
        return _jsonable(_row_dict(row)) if row else None

    def update_catalog(self, use_case: str, fields: Dict[str, Any], actor: Optional[str]) -> None:
        allowed = ("label", "label_template", "feature_group", "display_order", "is_active")
        sets = []
        params: Dict[str, Any] = {"uc": use_case, "actor": actor}
        for name in allowed:
            if name in fields:
                sets.append(f"{name} = :{name}")
                params[name] = fields[name]
        if not sets:
            return
        sets += ["updated_by = :actor", "updated_at = now()"]
        self.db.execute(text(f"UPDATE {CATALOG_TABLE} SET {', '.join(sets)} WHERE use_case = :uc"), params)

    def role_map(self) -> List[Dict[str, Any]]:
        rows = self.db.execute(text(
            f"SELECT role_name, role_class, precedence FROM {ROLE_MAP_TABLE} ORDER BY precedence, role_name"
        )).fetchall()
        return [_jsonable(_row_dict(r)) for r in rows]

    def role_row(self, role_name: str) -> Optional[Dict[str, Any]]:
        row = self.db.execute(text(
            f"SELECT role_name, role_class, precedence FROM {ROLE_MAP_TABLE} WHERE role_name = :r"
        ), {"r": role_name}).fetchone()
        return _jsonable(_row_dict(row)) if row else None

    def unmapped_roles(self, days: int = 30, limit: int = 200) -> List[Dict[str, Any]]:
        """Raw roles seen on events that the role map does not know."""
        rows = self.db.execute(text(
            "SELECT x.role_name, COUNT(*) AS events FROM ("
            "SELECT UPPER(REPLACE(REPLACE(TRIM(r.role), '-', '_'), ' ', '_')) AS role_name "
            f"FROM {EVENT_TABLE} e CROSS JOIN LATERAL unnest(e.actor_roles_raw) AS r(role) "
            "WHERE e.occurred_at >= :since AND e.actor_roles_raw IS NOT NULL"
            ") x "
            f"WHERE x.role_name <> '' AND NOT EXISTS (SELECT 1 FROM {ROLE_MAP_TABLE} m "
            "WHERE m.role_name = x.role_name) "
            "GROUP BY x.role_name ORDER BY events DESC, x.role_name LIMIT :limit"
        ), {"since": datetime.now(timezone.utc) - timedelta(days=days), "limit": limit}).fetchall()
        return [{"role_name": _row_dict(r)["role_name"], "events": int(_row_dict(r)["events"])} for r in rows]

    def upsert_role(self, role_name: str, role_class: str, precedence: int, actor: Optional[str]) -> None:
        self.db.execute(text(
            f"INSERT INTO {ROLE_MAP_TABLE} (role_name, role_class, precedence, updated_by, updated_at) "
            "VALUES (:r, :c, :p, :actor, now()) "
            "ON CONFLICT (role_name) DO UPDATE SET role_class = EXCLUDED.role_class, "
            "precedence = EXCLUDED.precedence, updated_by = EXCLUDED.updated_by, updated_at = now()"
        ), {"r": role_name, "c": role_class, "p": precedence, "actor": actor})

    def coverage(self, days: int) -> Dict[str, Any]:
        since = datetime.now(timezone.utc) - timedelta(days=days)
        p = {"since": since}
        head = _row_dict(self.db.execute(text(
            "SELECT COUNT(*) AS events, "
            "COUNT(*) FILTER (WHERE e.use_case = 'unknown') AS unknown_use_case_events, "
            "COUNT(*) FILTER (WHERE e.actor_user_id IS NULL) AS null_actor_events "
            f"FROM {EVENT_TABLE} e WHERE e.occurred_at >= :since"
        ), p).fetchone())
        uc_src = self.db.execute(text(
            f"SELECT COALESCE(e.use_case_source, 'NULL') AS k, COUNT(*) AS n FROM {EVENT_TABLE} e "
            "WHERE e.occurred_at >= :since GROUP BY 1 ORDER BY 2 DESC"
        ), p).fetchall()
        role_src = self.db.execute(text(
            f"SELECT COALESCE(e.role_source, 'NULL') AS k, COUNT(*) AS n FROM {EVENT_TABLE} e "
            "WHERE e.occurred_at >= :since GROUP BY 1 ORDER BY 2 DESC"
        ), p).fetchall()
        by_uc = self.db.execute(text(
            "SELECT e.use_case AS use_case, COUNT(*) AS events, "
            "COALESCE(SUM(e.credits_charged), 0) AS credits "
            f"FROM {EVENT_TABLE} e WHERE e.occurred_at >= :since GROUP BY 1 ORDER BY 3 DESC, 2 DESC"
        ), p).fetchall()
        ledger = _row_dict(self.db.execute(text(
            "SELECT COUNT(*) AS ledger_rows, COUNT(*) FILTER (WHERE NOT EXISTS ("
            f"SELECT 1 FROM {EVENT_TABLE} e WHERE e.ledger_tx_id = ct.id)) AS ledger_without_event "
            "FROM credit_transactions ct WHERE ct.transaction_type = 'USAGE_DEDUCTION' "
            "AND ct.created_at >= :since_naive"
        ), {"since_naive": naive_utc(since)}).fetchone())
        return {
            "days": days,
            "events": _int(head.get("events")),
            "ledger_rows": _int(ledger.get("ledger_rows")),
            "ledger_without_event": _int(ledger.get("ledger_without_event")),
            "use_case_source": {_row_dict(r)["k"]: _int(_row_dict(r)["n"]) for r in uc_src},
            "role_source": {_row_dict(r)["k"]: _int(_row_dict(r)["n"]) for r in role_src},
            "unknown_use_case_events": _int(head.get("unknown_use_case_events")),
            "null_actor_events": _int(head.get("null_actor_events")),
            "by_use_case": [
                {"use_case": d["use_case"], "events": _int(d["events"]), "credits": round(_num(d["credits"]) or 0.0, 4)}
                for d in (_row_dict(r) for r in by_uc)
            ],
        }

    def parity(self, days: int, now: Optional[datetime] = None) -> Dict[str, Any]:
        since = window_start(days, now)
        ledger = self.db.execute(text(
            f"SELECT to_char((ct.created_at AT TIME ZONE 'UTC') AT TIME ZONE '{IST_SQL}', 'YYYY-MM-DD') AS day, "
            "COUNT(*) AS ledger_rows, COALESCE(SUM(-ct.amount), 0) AS ledger_credits, "
            "COUNT(*) FILTER (WHERE NOT EXISTS ("
            f"SELECT 1 FROM {EVENT_TABLE} e WHERE e.ledger_tx_id = ct.id)) AS missing_events "
            "FROM credit_transactions ct WHERE ct.transaction_type = 'USAGE_DEDUCTION' "
            "AND ct.created_at >= :since_naive GROUP BY 1"
        ), {"since_naive": naive_utc(since)}).fetchall()
        events = self.db.execute(text(
            f"SELECT to_char(e.occurred_at AT TIME ZONE '{IST_SQL}', 'YYYY-MM-DD') AS day, "
            "COUNT(*) AS event_rows, COALESCE(SUM(e.credits_charged), 0) AS event_credits "
            f"FROM {EVENT_TABLE} e WHERE e.billing_mode = 'CHARGED' "
            "AND e.charge_status <> 'DROPPED_INSUFFICIENT' AND e.occurred_at >= :since GROUP BY 1"
        ), {"since": since}).fetchall()
        return {"rows": merge_parity([_row_dict(r) for r in ledger], [_row_dict(r) for r in events])}


def summarize(group_by: str, days: int, metric: str, rows: List[Dict[str, Any]],
              catalog: Dict[str, dict]) -> Dict[str, Any]:
    total_credits = sum((_num(r.get("credits")) or 0.0) for r in rows)
    total_events = sum(_int(r.get("events")) for r in rows)
    out = []
    for r in rows[:MAX_SUMMARY_ROWS]:
        credits = _num(r.get("credits")) or 0.0
        key = r.get("key")
        out.append({
            "key": "" if key is None else str(key),
            "label": group_label(group_by, None if key is None else str(key), r.get("label"), catalog),
            "credits": round(credits, 4),
            "events": _int(r.get("events")),
            "share_pct": round(credits * 100.0 / total_credits, 2) if total_credits else 0.0,
        })
    return {"group_by": group_by, "days": days, "metric": metric, "total_credits": round(total_credits, 4),
            "total_events": total_events, "rows": out}


def merge_parity(ledger: List[Dict[str, Any]], events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_day: Dict[str, Dict[str, Any]] = {}
    for r in ledger:
        d = by_day.setdefault(r["day"], _empty_parity(r["day"]))
        d["ledger_rows"] = _int(r.get("ledger_rows"))
        d["ledger_credits"] = round(_num(r.get("ledger_credits")) or 0.0, 4)
        d["missing_events"] = _int(r.get("missing_events"))
    for r in events:
        d = by_day.setdefault(r["day"], _empty_parity(r["day"]))
        d["event_rows"] = _int(r.get("event_rows"))
        d["event_credits"] = round(_num(r.get("event_credits")) or 0.0, 4)
    return [by_day[k] for k in sorted(by_day, reverse=True)]


def _empty_parity(day: str) -> Dict[str, Any]:
    return {"day": day, "ledger_rows": 0, "ledger_credits": 0.0, "event_rows": 0, "event_credits": 0.0,
            "missing_events": 0}


def empty_summary(group_by: str, days: int, metric: str) -> Dict[str, Any]:
    return summarize(group_by, days, metric, [], {})


# ── CSV export (streamed; one short-lived session per batch) ────────────────

def iter_export_csv(
    scope: Scope,
    filters: EventFilters,
    *,
    cap: int = EXPORT_CAP,
    batch_size: int = EXPORT_BATCH,
    session_factory: Optional[Callable[[], Any]] = None,
    query_factory: Callable[[Any], MeteringQuery] = MeteringQuery,
) -> Iterator[str]:
    """Header + at most `cap` rows, newest first, keyset-paged. A new session
    per batch, so a slow download never pins a pooled connection."""
    if session_factory is None:
        from ..db import db_session as session_factory  # type: ignore
    cap = max(0, min(int(cap), EXPORT_CAP))
    yield _csv_line(csv_header(scope.include_cost))
    sent = 0
    after: Optional[Tuple[Any, str]] = None
    catalog: Optional[Dict[str, dict]] = None
    while sent < cap:
        want = min(batch_size, cap - sent)
        with session_factory() as db:
            q = query_factory(db)
            if catalog is None:
                catalog = q.catalog()
            rows = q.export_batch(scope, filters, after, want)[:want]
        if not rows:
            break
        chunk = io.StringIO()
        writer = csv.writer(chunk)
        for r in rows:
            writer.writerow(csv_row(r, catalog or {}, scope.include_cost))
        yield chunk.getvalue()
        sent += len(rows)
        last = rows[-1]
        after = (last.get("occurred_at"), str(last.get("id")))
        if len(rows) < want:
            break


# ════════════════════════════════════════════════════════════════════════════
# Usage limits (V587: institute_ai_limits_policy, ai_usage_limit,
# ai_usage_counter) — SQL behind /credits/v2/institutes/{id}/limits/** and
# /super-admin/v1/metering/limits/**. Same rules as above: parameterised SQL,
# the institute always in the WHERE, interpolated fragments from fixed
# whitelists only. Evaluation (effective limits, preview, authorize) lives in
# services/metering/limits.py; this is only storage + labels.
# ════════════════════════════════════════════════════════════════════════════

POLICY_TABLE_NAME = "institute_ai_limits_policy"
LIMIT_TABLE_NAME = "ai_usage_limit"
COUNTER_TABLE_NAME = "ai_usage_counter"

LIMIT_MODES = ("OFF", "SHADOW", "ENFORCE")
LIMIT_SUBJECT_KINDS = ("INSTITUTE", "ROLE_CLASS", "ROLE", "USER")
LIMIT_SCOPE_KINDS = ("ALL", "GROUP", "USE_CASE")
LIMIT_PERIODS = ("DAY", "WEEK", "MONTH")          # PLAN_PERIOD is reserved until AI plans ship
LIMIT_METRICS = ("CREDITS", "COUNT", "COST_USD")
LIMIT_ORIGINS = ("TENANT", "PLATFORM")
DEFAULT_LIMITS_TZ = "Asia/Kolkata"
#: NUMERIC(14,4): the largest storable limit.
LIMIT_MAX_VALUE = 9_999_999_999.0
#: Role classes a limit may name besides the ones the role map produces
#: (SYSTEM: scheduled jobs / learner analytics, d_credits §4.2 rule 6).
EXTRA_LIMIT_ROLE_CLASSES = ("SYSTEM",)

_LIMIT_COLUMNS = (
    "id, institute_id, subject_kind, subject_value, per_member, scope_kind, scope_value, period, "
    "metric, soft_limit, hard_limit, origin, locked, effective_from, effective_to, is_active, reason, "
    "created_by, created_at, updated_by, updated_at"
)
_POLICY_COLUMNS = (
    "institute_id, mode, tenant_may_enforce, timezone, notify_admins_on_soft, "
    "show_numbers_to_learners, updated_by, updated_at, reason"
)

_limits_tables_cache: Dict[str, Any] = {"at": None, "ready": False}


def default_policy(institute_id: Optional[str] = None) -> Dict[str, Any]:
    """What an institute without a policy row has: limits OFF (today)."""
    return {"institute_id": institute_id, "mode": "OFF", "tenant_may_enforce": False,
            "timezone": DEFAULT_LIMITS_TZ, "notify_admins_on_soft": True,
            "show_numbers_to_learners": False, "updated_by": None, "updated_at": None,
            "reason": None, "exists": False}


def policy_item(row: Optional[Dict[str, Any]], institute_id: Optional[str] = None) -> Dict[str, Any]:
    if not row:
        return default_policy(institute_id)
    out = _jsonable(dict(row))
    out["mode"] = str(out.get("mode") or "OFF").upper()
    out["timezone"] = out.get("timezone") or DEFAULT_LIMITS_TZ
    for k, d in (("tenant_may_enforce", False), ("notify_admins_on_soft", True),
                 ("show_numbers_to_learners", False)):
        out[k] = bool(out[k]) if out.get(k) is not None else d
    out["exists"] = True
    return out


def role_label(role_name: Optional[str]) -> str:
    """'CONTENT_CREATOR' -> 'Content creator'."""
    s = str(role_name or "").strip().replace("_", " ").strip()
    return s[:1].upper() + s[1:].lower() if s else "Unknown role"


def limit_subject_label(row: Dict[str, Any], names: Optional[Dict[str, str]] = None) -> str:
    kind = str(row.get("subject_kind") or "").upper()
    value = row.get("subject_value")
    pooled = row.get("per_member") is False
    if kind == "INSTITUTE":
        return "Whole institute"
    if kind == "ROLE_CLASS":
        base = ROLE_CLASS_LABELS.get(str(value or "").upper(), role_label(value))
        return f"All {base.lower()}s together" if pooled else f"Each {base.lower()}"
    if kind == "ROLE":
        base = role_label(value)
        return f"{base} role, together" if pooled else f"Each {base.lower()}"
    if kind == "USER":
        return (names or {}).get(str(value)) or str(value or "Unknown user")
    return str(value or kind or "")


def limit_scope_label(row: Dict[str, Any], catalog: Optional[Dict[str, dict]] = None) -> str:
    kind = str(row.get("scope_kind") or "").upper()
    value = row.get("scope_value")
    if kind == "ALL":
        return "All AI features"
    if kind == "GROUP":
        return FEATURE_GROUP_LABELS.get(str(value or ""), role_label(value))
    if kind == "USE_CASE":
        c = (catalog or {}).get(str(value or ""))
        return (c or {}).get("label") or str(value or "")
    return str(value or kind or "")


def limit_row_item(row: Dict[str, Any], catalog: Optional[Dict[str, dict]] = None,
                   names: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """The Row shape of the limits API (contract N5)."""
    r = _jsonable(dict(row))
    return {
        "id": str(r.get("id")) if r.get("id") is not None else None,
        "subject_kind": r.get("subject_kind"),
        "subject_value": r.get("subject_value"),
        "subject_label": limit_subject_label(row, names),
        "per_member": bool(r.get("per_member")) if r.get("per_member") is not None else True,
        "scope_kind": r.get("scope_kind"),
        "scope_value": r.get("scope_value"),
        "scope_label": limit_scope_label(row, catalog),
        "period": r.get("period"),
        "metric": r.get("metric"),
        "soft_limit": r.get("soft_limit"),
        "hard_limit": r.get("hard_limit"),
        "origin": r.get("origin"),
        "locked": bool(r.get("locked")),
        "is_active": bool(r.get("is_active")) and r.get("effective_to") is None,
        "reason": r.get("reason"),
        "created_by": r.get("created_by"),
        "created_at": r.get("created_at"),
        "updated_at": r.get("updated_at"),
    }


def limits_window_bounds(period: str, tz_name: Optional[str],
                         now: Optional[datetime] = None) -> Tuple[datetime, datetime]:
    """(start, end) as UTC instants of the current DAY / WEEK (ISO, Monday) /
    MONTH window, boundaries at local midnight in the policy timezone. The
    limits engine's own window_bounds when it is there, so the read API and
    the counters can never disagree."""
    at = now or datetime.now(timezone.utc)
    try:
        from .metering import limits as engine  # type: ignore
        return engine.window_bounds(period, at, tz_name)
    except Exception:  # noqa: BLE001 - engine missing: same rule computed here
        pass
    from zoneinfo import ZoneInfo
    try:
        tz = ZoneInfo(tz_name or DEFAULT_LIMITS_TZ)
    except Exception:  # noqa: BLE001
        tz = ZoneInfo(DEFAULT_LIMITS_TZ)
    day = at.astimezone(tz).date()
    if period == "WEEK":
        day = day - timedelta(days=day.weekday())
        end = day + timedelta(days=7)
    elif period == "MONTH":
        day = day.replace(day=1)
        end = date(day.year + (day.month == 12), 1 if day.month == 12 else day.month + 1, 1)
    else:
        end = day + timedelta(days=1)
    return (datetime.combine(day, dtime.min, tzinfo=tz).astimezone(timezone.utc),
            datetime.combine(end, dtime.min, tzinfo=tz).astimezone(timezone.utc))


def limits_window_start(period: str, tz_name: Optional[str], now: Optional[datetime] = None) -> datetime:
    return limits_window_bounds(period, tz_name, now)[0]


def local_iso(at_utc: datetime, tz_name: Optional[str]) -> str:
    """ISO with the policy timezone's offset (e.g. +05:30), like the 429 body."""
    from zoneinfo import ZoneInfo
    try:
        tz = ZoneInfo(tz_name or DEFAULT_LIMITS_TZ)
    except Exception:  # noqa: BLE001
        tz = ZoneInfo(DEFAULT_LIMITS_TZ)
    return at_utc.astimezone(tz).isoformat()


def parse_counter_key(key: str) -> Dict[str, Optional[str]]:
    """'U:<uid>|UC:tutor_chat' -> subject / scope parts (the d_credits §4.1
    key format: subject 'I' | 'RC:<class>' | 'R:<role>' | 'U:<uid>', then
    scope 'ALL' | 'G:<group>' | 'UC:<use_case>'). Unknown shapes come back
    with kind None and the raw text as the value."""
    subject, _, scope = str(key or "").partition("|")
    out: Dict[str, Optional[str]] = {"subject_kind": None, "subject_value": subject or None,
                                     "scope_kind": None, "scope_value": scope or None}
    if subject == "I":
        out.update(subject_kind="INSTITUTE", subject_value=None)
    else:
        head, sep, rest = subject.partition(":")
        kind = {"RC": "ROLE_CLASS", "R": "ROLE", "U": "USER"}.get(head) if sep else None
        if kind:
            out.update(subject_kind=kind, subject_value=rest)
    if scope == "ALL":
        out.update(scope_kind="ALL", scope_value=None)
    else:
        head, sep, rest = scope.partition(":")
        kind = {"G": "GROUP", "UC": "USE_CASE"}.get(head) if sep else None
        if kind:
            out.update(scope_kind=kind, scope_value=rest)
    return out


def counter_label(key: str, catalog: Optional[Dict[str, dict]] = None,
                  names: Optional[Dict[str, str]] = None) -> str:
    p = parse_counter_key(key)
    if p["subject_kind"] is None or p["scope_kind"] is None:
        return str(key)
    subj = dict(p, per_member=False)
    who = limit_subject_label(subj, names)
    if p["subject_kind"] == "USER":
        who = (names or {}).get(str(p["subject_value"])) or str(p["subject_value"])
    elif p["subject_kind"] in ("ROLE_CLASS", "ROLE"):
        who = (ROLE_CLASS_LABELS.get(str(p["subject_value"]).upper()) if p["subject_kind"] == "ROLE_CLASS"
               else role_label(p["subject_value"]))
    return f"{who} · {limit_scope_label(p, catalog)}"


class LimitsQuery:
    """Storage for the limits API. One per request (holds the session). The
    caller commits."""

    def __init__(self, db: Session):
        self.db = db

    # -- readiness --

    def tables_ready(self) -> bool:
        now = time.monotonic()
        at = _limits_tables_cache["at"]
        if at is not None and now - at < _TABLES_TTL:
            return bool(_limits_tables_cache["ready"])
        try:
            ready = bool(self.db.execute(text(
                "SELECT to_regclass(:p) IS NOT NULL AND to_regclass(:l) IS NOT NULL "
                "AND to_regclass(:c) IS NOT NULL"
            ), {"p": POLICY_TABLE_NAME, "l": LIMIT_TABLE_NAME, "c": COUNTER_TABLE_NAME}).scalar())
        except Exception:  # noqa: BLE001
            logger.warning("could not check for %s", LIMIT_TABLE_NAME, exc_info=True)
            try:
                self.db.rollback()
            except Exception:  # noqa: BLE001
                pass
            ready = False
        _limits_tables_cache.update(at=now, ready=ready)
        return ready

    # -- policy --

    def policy_row(self, institute_id: str, *, for_update: bool = False) -> Optional[Dict[str, Any]]:
        sql = f"SELECT {_POLICY_COLUMNS} FROM {POLICY_TABLE_NAME} WHERE institute_id = :i"
        if for_update:
            sql += " FOR UPDATE"
        row = self.db.execute(text(sql), {"i": institute_id}).fetchone()
        return _row_dict(row) if row else None

    def save_policy(self, institute_id: str, values: Dict[str, Any], actor: Optional[str],
                    reason: str) -> Dict[str, Any]:
        """Insert or replace the institute's policy row with `values` (every
        column; the caller merged them over the old row / the defaults)."""
        row = self.db.execute(text(
            f"INSERT INTO {POLICY_TABLE_NAME} (institute_id, mode, tenant_may_enforce, timezone, "
            "notify_admins_on_soft, show_numbers_to_learners, updated_by, updated_at, reason) "
            "VALUES (:i, :mode, :tme, :tz, :notify, :show, :actor, now(), :reason) "
            "ON CONFLICT (institute_id) DO UPDATE SET mode = EXCLUDED.mode, "
            "tenant_may_enforce = EXCLUDED.tenant_may_enforce, timezone = EXCLUDED.timezone, "
            "notify_admins_on_soft = EXCLUDED.notify_admins_on_soft, "
            "show_numbers_to_learners = EXCLUDED.show_numbers_to_learners, "
            "updated_by = EXCLUDED.updated_by, updated_at = now(), reason = EXCLUDED.reason "
            f"RETURNING {_POLICY_COLUMNS}"
        ), {"i": institute_id, "mode": values["mode"], "tme": bool(values["tenant_may_enforce"]),
            "tz": values["timezone"], "notify": bool(values["notify_admins_on_soft"]),
            "show": bool(values["show_numbers_to_learners"]), "actor": actor, "reason": reason}).fetchone()
        return _row_dict(row)

    # -- rows --

    def list_rows(self, institute_id: str, *, include_inactive: bool = False) -> List[Dict[str, Any]]:
        where = "institute_id = :i"
        if not include_inactive:
            where += " AND is_active AND effective_to IS NULL"
        rows = self.db.execute(text(
            f"SELECT {_LIMIT_COLUMNS} FROM {LIMIT_TABLE_NAME} WHERE {where} "
            "ORDER BY origin DESC, subject_kind, subject_value NULLS FIRST, scope_kind, "
            "scope_value NULLS FIRST, period, metric, created_at"
        ), {"i": institute_id}).fetchall()
        return [_row_dict(r) for r in rows]

    def get_row(self, institute_id: str, row_id: str, *, for_update: bool = False) -> Optional[Dict[str, Any]]:
        sql = (f"SELECT {_LIMIT_COLUMNS} FROM {LIMIT_TABLE_NAME} "
               "WHERE institute_id = :i AND id = CAST(:id AS uuid)")
        if for_update:
            sql += " FOR UPDATE"
        row = self.db.execute(text(sql), {"i": institute_id, "id": row_id}).fetchone()
        return _row_dict(row) if row else None

    def insert_row(self, institute_id: str, f: Dict[str, Any], actor: str) -> Optional[Dict[str, Any]]:
        """The new row, or None when an open row with the same subject /
        scope / period / metric / origin already exists (unique index)."""
        row = self.db.execute(text(
            f"INSERT INTO {LIMIT_TABLE_NAME} (id, institute_id, subject_kind, subject_value, per_member, "
            "scope_kind, scope_value, period, metric, soft_limit, hard_limit, origin, locked, "
            "effective_from, is_active, reason, created_by, created_at, updated_by, updated_at) "
            "VALUES (gen_random_uuid(), :i, :sk, :sv, :pm, :ck, :cv, :period, :metric, :soft, :hard, "
            ":origin, :locked, now(), TRUE, :reason, :actor, now(), :actor, now()) "
            f"ON CONFLICT DO NOTHING RETURNING {_LIMIT_COLUMNS}"
        ), {"i": institute_id, "sk": f["subject_kind"], "sv": f.get("subject_value"),
            "pm": bool(f.get("per_member", True)), "ck": f["scope_kind"], "cv": f.get("scope_value"),
            "period": f["period"], "metric": f["metric"], "soft": f.get("soft_limit"),
            "hard": f.get("hard_limit"), "origin": f["origin"], "locked": bool(f.get("locked", False)),
            "reason": f.get("reason"), "actor": actor}).fetchone()
        return _row_dict(row) if row else None

    def update_row(self, institute_id: str, row_id: str, fields: Dict[str, Any], actor: Optional[str],
                   reason: str) -> Optional[Dict[str, Any]]:
        allowed = ("soft_limit", "hard_limit", "locked")
        sets = ["reason = :reason", "updated_by = :actor", "updated_at = now()"]
        params: Dict[str, Any] = {"i": institute_id, "id": row_id, "reason": reason, "actor": actor}
        for name in allowed:
            if name in fields:
                sets.append(f"{name} = :{name}")
                params[name] = fields[name]
        row = self.db.execute(text(
            f"UPDATE {LIMIT_TABLE_NAME} SET {', '.join(sets)} "
            "WHERE institute_id = :i AND id = CAST(:id AS uuid) AND is_active AND effective_to IS NULL "
            f"RETURNING {_LIMIT_COLUMNS}"
        ), params).fetchone()
        return _row_dict(row) if row else None

    def deactivate_row(self, institute_id: str, row_id: str, actor: Optional[str],
                       reason: str) -> Optional[Dict[str, Any]]:
        row = self.db.execute(text(
            f"UPDATE {LIMIT_TABLE_NAME} SET is_active = FALSE, effective_to = now(), reason = :reason, "
            "updated_by = :actor, updated_at = now() "
            "WHERE institute_id = :i AND id = CAST(:id AS uuid) AND is_active AND effective_to IS NULL "
            f"RETURNING {_LIMIT_COLUMNS}"
        ), {"i": institute_id, "id": row_id, "reason": reason, "actor": actor}).fetchone()
        return _row_dict(row) if row else None

    # -- reference data for validation and labels --

    def use_case_row(self, use_case: str) -> Optional[Dict[str, Any]]:
        row = self.db.execute(text(
            f"SELECT use_case, feature_group, label, count_unit_label, limit_eligible, is_active "
            f"FROM {CATALOG_TABLE} WHERE use_case = :uc"
        ), {"uc": use_case}).fetchone()
        return _row_dict(row) if row else None

    def feature_groups(self) -> List[str]:
        rows = self.db.execute(text(
            f"SELECT DISTINCT feature_group FROM {CATALOG_TABLE} WHERE is_active"
        )).fetchall()
        return sorted(str(_row_dict(r)["feature_group"]) for r in rows if _row_dict(r).get("feature_group"))

    def role_known(self, institute_id: str, role_name: str, days: int = 30) -> bool:
        """In the role map, or seen on this institute's usage events lately
        (a custom role nobody has mapped yet)."""
        if self.db.execute(text(f"SELECT 1 FROM {ROLE_MAP_TABLE} WHERE role_name = :r"),
                           {"r": role_name}).fetchone():
            return True
        return bool(self.db.execute(text(
            f"SELECT 1 FROM {EVENT_TABLE} e CROSS JOIN LATERAL unnest(e.actor_roles_raw) AS r(role) "
            "WHERE e.institute_id = :i AND e.occurred_at >= :since AND e.actor_roles_raw IS NOT NULL "
            "AND UPPER(REPLACE(REPLACE(TRIM(r.role), '-', '_'), ' ', '_')) = :r LIMIT 1"
        ), {"i": institute_id, "r": role_name,
            "since": datetime.now(timezone.utc) - timedelta(days=days)}).fetchone())

    def user_names(self, institute_id: str, user_ids: List[str]) -> Dict[str, str]:
        """Latest display name per user seen on this institute's events."""
        ids = sorted({str(u) for u in user_ids if u})
        if not ids:
            return {}
        rows = self.db.execute(text(
            f"SELECT DISTINCT ON (actor_user_id) actor_user_id, actor_display_name FROM {EVENT_TABLE} "
            "WHERE institute_id = :i AND actor_user_id = ANY(:ids) AND actor_display_name IS NOT NULL "
            "ORDER BY actor_user_id, occurred_at DESC"
        ), {"i": institute_id, "ids": ids}).fetchall()
        return {str(_row_dict(r)["actor_user_id"]): str(_row_dict(r)["actor_display_name"]) for r in rows}

    def user_roles(self, institute_id: str, user_id: str) -> Tuple[Optional[str], List[str]]:
        """(role class, raw roles) on the user's latest event here."""
        got = self.users_roles(institute_id, [user_id]).get(str(user_id))
        return (got["role_class"], got["raw_roles"]) if got else (None, [])

    def users_roles(self, institute_id: str, user_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """{user id: {role_class, raw_roles}} from each user's latest event here."""
        ids = sorted({str(u) for u in user_ids if u})
        if not ids:
            return {}
        rows = self.db.execute(text(
            f"SELECT DISTINCT ON (actor_user_id) actor_user_id, actor_role_class, actor_roles_raw "
            f"FROM {EVENT_TABLE} WHERE institute_id = :i AND actor_user_id = ANY(:ids) "
            "ORDER BY actor_user_id, occurred_at DESC"
        ), {"i": institute_id, "ids": ids}).fetchall()
        out: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            d = _row_dict(r)
            raw = d.get("actor_roles_raw") or []
            if isinstance(raw, str):
                raw = [x.strip().strip('"') for x in raw.strip("{}").split(",") if x.strip()]
            out[str(d["actor_user_id"])] = {"role_class": d.get("actor_role_class"),
                                            "raw_roles": [str(x) for x in raw if x]}
        return out

    # -- usage --

    def counters(self, institute_id: str, period: str, window_start_utc: datetime) -> List[Dict[str, Any]]:
        rows = self.db.execute(text(
            f"SELECT counter_key, period, window_start, credits_used, count_used, cost_usd, updated_at "
            f"FROM {COUNTER_TABLE_NAME} WHERE institute_id = :i AND period = :p AND window_start = :ws "
            "ORDER BY credits_used DESC, counter_key LIMIT 2000"
        ), {"i": institute_id, "p": period, "ws": window_start_utc}).fetchall()
        return [_row_dict(r) for r in rows]

    # -- super-admin overview --

    def overview(self, since: datetime) -> List[Dict[str, Any]]:
        rows = self.db.execute(text(
            f"SELECT p.institute_id, i.name AS institute_name, p.mode, p.tenant_may_enforce, p.timezone, "
            "p.updated_at, "
            "(SELECT COUNT(*) FROM ai_usage_limit l WHERE l.institute_id = p.institute_id AND l.is_active "
            " AND l.effective_to IS NULL AND l.origin = 'TENANT') AS rows, "
            "(SELECT COUNT(*) FROM ai_usage_limit l WHERE l.institute_id = p.institute_id AND l.is_active "
            " AND l.effective_to IS NULL AND l.origin = 'PLATFORM') AS platform_rows "
            f"FROM {POLICY_TABLE_NAME} p LEFT JOIN institutes i ON i.id = p.institute_id "
            "ORDER BY i.name NULLS LAST, p.institute_id LIMIT 2000"
        )).fetchall()
        out = [_row_dict(r) for r in rows]
        ids = [r["institute_id"] for r in out]
        decisions: Dict[str, Dict[str, int]] = {}
        if ids:
            for r in self.db.execute(text(
                f"SELECT institute_id, limit_decision, COUNT(*) AS n FROM {EVENT_TABLE} "
                "WHERE institute_id = ANY(:ids) AND occurred_at >= :since "
                "AND limit_decision IN ('WOULD_BLOCK', 'BLOCKED_SKIPPED', 'OVERRUN') "
                "GROUP BY institute_id, limit_decision"
            ), {"ids": ids, "since": since}).fetchall():
                d = _row_dict(r)
                decisions.setdefault(str(d["institute_id"]), {})[str(d["limit_decision"])] = _int(d["n"])
        for r in out:
            d = decisions.get(str(r["institute_id"]), {})
            r["would_block_7d"] = d.get("WOULD_BLOCK", 0)
            r["blocked_7d"] = d.get("BLOCKED_SKIPPED", 0)
            r["overrun_7d"] = d.get("OVERRUN", 0)
            r["rows"] = _int(r.get("rows"))
            r["platform_rows"] = _int(r.get("platform_rows"))
        return out
