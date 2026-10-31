"""Writes ai_usage_event rows (contract K2). Write-only metering: nothing here
may change a charge, a ledger row, a balance or an AI call.

Entry points
------------
record_event(db, ...)          generic: one event on the caller's session, in a
                               SAVEPOINT; returns the event id or None.
record_charged_event_after_commit(...)
                               CreditService.deduct_credits, right after its
                               commit (own short transaction, never under the
                               balance row lock): CHARGED/POSTED, linked both
                               ways (event.ledger_tx_id, credit_transactions.
                               usage_event_id/use_case, ai_token_usage.usage_event_id).
queue_dropped_event(...)       deduct_credits' "DROPPED CHARGE" branch: CHARGED/
                               DROPPED_INSUFFICIENT, written on a background
                               session (that branch never commits the caller's).
queue_free_event(...)          TokenUsageService.record_usage with no deduction:
                               FREE + free_reason, on a background session.
write_free_event(...)          the same, synchronously, for code that already
                               runs on its own session (usage_record_only).
queue_batch_refunds(...)       after a REFUND row with a batch_id (background
                               session): mark_batch_refunds applies the batch's
                               REFUND rows to its CHARGED events (per-shot
                               refunds to that shot's charges).

Safety
------
* Every write is inside `db.begin_nested()`; any exception rolls back that
  savepoint only, is counted, and is logged at most once a minute.
* metering.events.enabled = false, or the V586 tables missing: no query at
  all (the absence is cached for 5 minutes; see cache.py).
* Field resolution follows d_credits §1.4: explicit active use_case > tool_key
  > request_type > 'unknown' (an unknown explicit key is stored as 'unknown'
  and logged); the model goes through ai_model_alias; list_credits is exactly
  what today's code computed; credits_charged = -ledger.amount.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, fields as dc_fields
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from . import cache as _cache
from .constants import (
    ACTOR_KINDS, BILLING_MODES, CHARGE_STATUSES, COST_SOURCES, DEFAULT_SOURCE_SERVICE, FREE_REASONS,
    LEGACY_ROLE_CLASSES, ROLE_CLASSES, ROLE_SOURCES, SURFACES, UNKNOWN_FEATURE_GROUP, UNKNOWN_USE_CASE,
    W_ACTOR_KIND, W_BATCH, W_BILLING_MODE, W_CHARGE_STATUS, W_COST_SOURCE, W_FEATURE_GROUP, W_FREE_REASON,
    W_GATEWAY_KEY, W_IDEM, W_MODEL, W_NAME, W_PROVIDER, W_REQUEST_TYPE, W_ROLE_CLASS, W_ROLE_NAME,
    W_ROLE_SOURCE, W_ROUTER, W_SOURCE_SERVICE, W_SURFACE, W_TOOL_KEY, W_USE_CASE, W_USE_CASE_SOURCE,
    W_USER_ID, normalize_role_name,
)
from .context import resolve_role_class

logger = logging.getLogger(__name__)

_LOG_EVERY_SECONDS = 60.0
_CONTEXT_MAX_BYTES = 4000
_CTX_STR_MAX = 300
MAX_PENDING = 1000

# ----------------------------------------------------------------------------
# Counters + rate-limited logging
# ----------------------------------------------------------------------------

_stats_lock = threading.Lock()
_stats: Dict[str, int] = {
    "written": 0, "linked_existing": 0, "failed": 0, "skipped_disabled": 0, "skipped_absent": 0,
    "queued": 0, "dropped_backlog": 0, "refund_marked": 0, "unknown_use_case": 0, "skipped_busy": 0,
    "limits_applied": 0, "limits_overrun": 0, "limits_failed": 0, "limits_refund_decrements": 0,
}
_last_log: Dict[str, float] = {}


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


def _note_failure(where: str, exc: BaseException) -> None:
    _count("failed")
    text_ = str(exc).splitlines()[0][:300] if str(exc) else type(exc).__name__
    _log_limited(f"fail:{where}", logging.WARNING,
                 "metering: usage event not written (%s; charge unaffected): %s [failures so far: %d]",
                 where, text_, _stats.get("failed", 0))


# ----------------------------------------------------------------------------
# Input
# ----------------------------------------------------------------------------

@dataclass
class EventInput:
    """Everything the writer may use. All optional; resolution fills the rest."""

    institute_id: Optional[str] = None
    request_type: Optional[str] = None
    model: Optional[str] = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    character_count: int = 0
    seconds: Any = 0
    batch_id: Optional[str] = None
    idempotency_key: Optional[str] = None
    description: Optional[str] = None
    # legacy ledger attribution
    user_id: Optional[str] = None
    user_role: Optional[str] = None
    subject_user_id: Optional[str] = None
    # K2 metering fields
    use_case: Optional[str] = None
    actor_kind: Optional[str] = None
    actor_user_id: Optional[str] = None
    actor_role_class: Optional[str] = None
    actor_roles_raw: Optional[List[Any]] = None
    role_source: Optional[str] = None
    actor_display_name: Optional[str] = None
    subject_display_name: Optional[str] = None
    surface: Optional[str] = None
    source_service: Optional[str] = None
    usage_context: Optional[Dict[str, Any]] = None
    router: Optional[str] = None
    provider: Optional[str] = None
    gateway_key_id: Optional[str] = None
    byo_key: Optional[bool] = None
    parent_event_id: Optional[str] = None
    usage_event_id: Optional[str] = None
    tool_key: Optional[str] = None
    real_cost_usd: Any = None
    cost_source: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


_INPUT_FIELDS = frozenset(f.name for f in dc_fields(EventInput))


def input_from(obj: Any = None, **overrides: Any) -> EventInput:
    """EventInput from a CreditDeductRequest-like object (getattr) plus overrides."""
    data: Dict[str, Any] = {}
    if obj is not None:
        for name in _INPUT_FIELDS:
            try:
                value = getattr(obj, name)
            except Exception:  # noqa: BLE001
                continue
            if value is not None:
                data[name] = value
        if "character_count" not in data:
            try:
                cc = getattr(obj, "character_count", None)
                if cc is not None:
                    data["character_count"] = cc
            except Exception:  # noqa: BLE001
                pass
    for k, v in overrides.items():
        if k in _INPUT_FIELDS and v is not None:
            data[k] = v
    return EventInput(**data)


# ----------------------------------------------------------------------------
# Resolution helpers (pure)
# ----------------------------------------------------------------------------

def _s(value: Any, width: int) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    return s[:width]


def _upper_in(value: Any, allowed: frozenset) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip().upper()
    return s if s in allowed else None


def _uuid_or_none(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        return None


def _int(value: Any) -> int:
    try:
        if value is None or isinstance(value, bool):
            return 0
        return max(int(Decimal(str(value))), 0)
    except Exception:  # noqa: BLE001
        return 0


def _num(value: Any) -> Decimal:
    try:
        if value is None or isinstance(value, bool):
            return Decimal("0")
        d = Decimal(str(value))
        return d if d.is_finite() and d > 0 else Decimal("0")
    except Exception:  # noqa: BLE001
        return Decimal("0")


def _opt_num(value: Any) -> Optional[Decimal]:
    try:
        if value is None or isinstance(value, bool):
            return None
        d = Decimal(str(value))
        return d if d.is_finite() and d >= 0 else None
    except Exception:  # noqa: BLE001
        return None


def _clean_context(*parts: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Merge dicts into a small JSON-safe object (strings capped, ~4 KB max)."""
    out: Dict[str, Any] = {}
    for part in parts:
        if not isinstance(part, dict):
            continue
        for k, v in part.items():
            if v is None or v == "":
                continue
            key = str(k)[:64]
            if isinstance(v, bool) or isinstance(v, (int, float)):
                out[key] = v
            elif isinstance(v, Decimal):
                out[key] = float(v)
            elif isinstance(v, (dict, list)):
                try:
                    blob = json.dumps(v, default=str)
                except Exception:  # noqa: BLE001
                    continue
                if len(blob) <= 1000:
                    out[key] = json.loads(blob)
            else:
                out[key] = str(v)[:_CTX_STR_MAX]
    if not out:
        return None
    try:
        blob = json.dumps(out, default=str)
    except Exception:  # noqa: BLE001
        return None
    while len(blob) > _CONTEXT_MAX_BYTES and out:
        out.pop(next(reversed(out)))
        blob = json.dumps(out, default=str)
    return out or None


# Vendor-cost / routing keys never reach the tenant-visible event context (it is
# returned to institute admins and in the CSV export); real cost lives only in
# real_cost_usd, which the read API shows to platform staff alone.
_COST_KEY = re.compile(r"(usd|cost|price|vendor|gateway|router|api_key|secret|token_price)", re.IGNORECASE)


def strip_cost_keys(context: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """`context` without vendor-cost / routing keys (top level). Never raises."""
    if not isinstance(context, dict):
        return context
    try:
        out = {k: v for k, v in context.items() if not _COST_KEY.search(str(k))}
    except Exception:  # noqa: BLE001
        return None
    return out or None


# ai_token_usage metadata is free-form (vendor costs, prompts, previews, tool
# arguments ...). Only identifiers, names and small facts from it reach the
# event context (a WHITELIST); the caller's explicit usage_context is kept, minus
# cost keys. Scalars only.
_META_KEYS = frozenset({
    "feature", "kind", "stage", "event_stage", "purpose", "source", "mode", "leg", "language", "operation",
    "tool", "tool_name", "task", "step", "turn", "quality", "quality_tier", "shot_type", "grounded", "cached",
    "origin", "direction", "outcome", "title", "slide_path", "voice_topic", "seconds", "audio_seconds",
    "video_seconds", "kb_page_start", "kb_page_end", "charged", "billed",
})
_META_KEY_SUFFIX = re.compile(r"^[a-z][a-z0-9_]{0,60}_(id|name|title|count)$")


def _meta_context(meta: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The whitelisted, scalar part of ai_token_usage metadata (never raises)."""
    if not isinstance(meta, dict):
        return None
    out: Dict[str, Any] = {}
    try:
        for k, v in meta.items():
            key = str(k)
            if v is None or isinstance(v, (dict, list, tuple, set)):
                continue
            if key in _META_KEYS or _META_KEY_SUFFIX.match(key):
                out[key] = v
    except Exception:  # noqa: BLE001
        return None
    return out or None


_TOOL_IN_DESC = re.compile(r"\[([A-Za-z0-9_.:-]{1,64}); rate ")


def _tool_key(inp: EventInput) -> Optional[str]:
    ctx = inp.usage_context if isinstance(inp.usage_context, dict) else {}
    for candidate in (inp.tool_key, ctx.get("tool_key")):
        if candidate:
            return str(candidate).strip()[:W_TOOL_KEY]
    # ai_billing._charge_description: "<rt> using <model> [<tool_key>; rate <src>]"
    if inp.description:
        m = _TOOL_IN_DESC.search(str(inp.description))
        if m:
            return m.group(1)
    return None


def resolve_use_case(snap: Any, inp: EventInput, tool_key: Optional[str]):
    """(use_case, use_case_source, catalog_row or None)."""
    catalog = getattr(snap, "catalog", {}) or {}
    explicit = str(inp.use_case).strip().lower() if inp.use_case else ""
    if not explicit and isinstance(inp.metadata, dict) and inp.metadata.get("use_case"):
        meta_uc = str(inp.metadata.get("use_case")).strip().lower()
        if meta_uc in catalog and catalog[meta_uc].get("is_active") is not False:
            return meta_uc, "EXPLICIT", catalog[meta_uc]
    if explicit:
        row = catalog.get(explicit)
        if row is not None and row.get("is_active") is not False:
            return explicit, "EXPLICIT", row
        if row is None:
            _count("unknown_use_case")
            _log_limited(f"uc:{explicit}", logging.INFO,
                         "metering: use_case '%s' is not in ai_use_case_catalog; stored as 'unknown'", explicit)
            return UNKNOWN_USE_CASE, "UNKNOWN", catalog.get(UNKNOWN_USE_CASE)
        # known but inactive: fall through to the defaults
    if tool_key:
        uc = (getattr(snap, "by_tool", {}) or {}).get(tool_key.lower())
        if uc:
            return uc, "TOOL_KEY", catalog.get(uc)
    if inp.request_type:
        uc = (getattr(snap, "by_request_type", {}) or {}).get(str(inp.request_type).strip().lower())
        if uc:
            return uc, "REQUEST_TYPE", catalog.get(uc)
    return UNKNOWN_USE_CASE, "UNKNOWN", catalog.get(UNKNOWN_USE_CASE)


def resolve_model(snap: Any, model: Optional[str]) -> Optional[str]:
    if not model:
        return None
    raw = str(model).strip()
    aliases = getattr(snap, "aliases", {}) or {}
    return aliases.get(raw, raw)


def _roles_list(raw: Any) -> Optional[List[str]]:
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = [p for p in re.split(r"[,\s]+", raw) if p]
    if not isinstance(raw, (list, tuple, set)):
        return None
    out = []
    for r in raw:
        n = normalize_role_name(r)
        if n and n not in out:
            out.append(n[:W_ROLE_NAME])
    return out or None


def resolve_actor(snap: Any, inp: EventInput, catalog_row: Optional[dict]) -> Dict[str, Any]:
    """actor_kind, actor_user_id, actor_role_class, actor_roles_raw, role_source."""
    roles_map = getattr(snap, "roles", None)
    ctx_in = inp.usage_context if isinstance(inp.usage_context, dict) else {}
    # A caller that could not verify who is acting (an unauthenticated route
    # with a body/query user id) passes that id as usage_context.claimed_user_id:
    # it then never becomes the actor (no actor scope, no nightly role lookup),
    # even though the ledger keeps its user_id exactly as today.
    claimed_only = not inp.actor_user_id and bool(ctx_in.get("claimed_user_id"))
    actor_user_id = _s(inp.actor_user_id or (None if claimed_only else inp.user_id), W_USER_ID)
    legacy_role = normalize_role_name(inp.user_role) if inp.user_role else ""
    roles_raw = _roles_list(inp.actor_roles_raw)
    source_service = (inp.source_service or DEFAULT_SOURCE_SERVICE).strip().lower()

    kind = _upper_in(inp.actor_kind, ACTOR_KINDS)
    kind_from_catalog = False
    if kind is None or kind == "UNKNOWN":
        if legacy_role in ("SYSTEM", "PLATFORM_BILLING"):
            kind = "SYSTEM"
        elif legacy_role == "API_KEY" or (actor_user_id or "").startswith("apikey:"):
            kind = "API_KEY"
        elif (actor_user_id or "").startswith("demo-") or legacy_role == "PUBLIC":
            kind = "PUBLIC"
        elif actor_user_id:
            kind = "USER"
        elif catalog_row is not None and str(catalog_row.get("actor_kind") or "").upper() in ("SYSTEM", "ON_BEHALF"):
            # SYSTEM jobs, and ON_BEHALF work done by the platform about a subject learner
            kind, kind_from_catalog = "SYSTEM", True
        else:
            kind = "UNKNOWN"

    explicit_source = _upper_in(inp.role_source, ROLE_SOURCES)
    role_class = _upper_in(inp.actor_role_class, ROLE_CLASSES)
    if role_class == "UNKNOWN":
        role_class = None
    source = None
    if role_class or roles_raw:
        if not role_class:
            role_class = resolve_role_class(roles_raw, roles_map)
        source = explicit_source if explicit_source not in (None, "UNRESOLVED") else (
            "JWT" if roles_raw and source_service == DEFAULT_SOURCE_SERVICE else "CALLER")
    elif kind in ("SYSTEM", "API_KEY", "PUBLIC"):
        role_class = kind
        source = "CATALOG_DEFAULT" if kind_from_catalog else (
            explicit_source if explicit_source not in (None, "UNRESOLVED") else "CALLER")
    elif legacy_role and explicit_source != "UNRESOLVED":
        # The legacy ledger user_role is a billing label, not a looked-up role
        # (e.g. the hard-coded "ADMIN" literals, d_credits G16): only its
        # non-role labels and STUDENT/LEARNER are taken. Anything else stays
        # UNRESOLVED so the nightly AUTH_LOOKUP job fills the real role.
        if legacy_role in LEGACY_ROLE_CLASSES:
            role_class = LEGACY_ROLE_CLASSES[legacy_role]
            source = "CALLER"
        elif legacy_role in ("STUDENT", "LEARNER"):
            role_class = "LEARNER"
            source = "CALLER"
    if not role_class:
        role_class, source = None, "UNRESOLVED"
    return {
        "actor_kind": kind[:W_ACTOR_KIND],
        "actor_user_id": actor_user_id,
        "actor_role_class": (role_class or None) and role_class[:W_ROLE_CLASS],
        "actor_roles_raw": roles_raw,
        "role_source": (source or "UNRESOLVED")[:W_ROLE_SOURCE],
    }


def _surface(inp: EventInput, catalog_row: Optional[dict]) -> str:
    s = _upper_in(inp.surface, SURFACES)
    if s and s != "UNKNOWN":
        return s
    if catalog_row is not None:
        d = _upper_in(catalog_row.get("default_surface"), SURFACES)
        if d:
            return d
    return "UNKNOWN"


def build_row(
    snap: Any,
    inp: EventInput,
    *,
    billing_mode: str,
    charge_status: str,
    list_credits: Any = 0,
    credits_charged: Any = 0,
    free_reason: Optional[str] = None,
    ledger_tx_id: Optional[str] = None,
    occurred_at: Optional[datetime] = None,
    event_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    """The ai_usage_event column values for one event (pure; no I/O)."""
    tool_key = _tool_key(inp)
    use_case, uc_source, row = resolve_use_case(snap, inp, tool_key)
    actor = resolve_actor(snap, inp, row)
    ctx_in = inp.usage_context if isinstance(inp.usage_context, dict) else {}
    meta = inp.metadata if isinstance(inp.metadata, dict) else {}
    subject = _s(inp.subject_user_id or ctx_in.get("subject_user_id"), W_USER_ID)
    context = strip_cost_keys(_clean_context(_meta_context(meta), ctx_in))
    if inp.use_case and use_case == UNKNOWN_USE_CASE and str(inp.use_case).strip().lower() != UNKNOWN_USE_CASE:
        context = dict(context or {})
        context["requested_use_case"] = str(inp.use_case)[:W_USE_CASE]
    if context and "subject_user_id" in context and subject == context.get("subject_user_id"):
        context.pop("subject_user_id", None)
        context = context or None

    model_id = resolve_model(snap, inp.model)
    raw_model = _s(inp.model, W_MODEL)
    wire = ctx_in.get("model_wire_id") or (raw_model if raw_model and raw_model != model_id else None)

    real_cost = _opt_num(inp.real_cost_usd)
    cost_source = _upper_in(inp.cost_source, COST_SOURCES)
    if cost_source is None:
        cost_source = "UNKNOWN" if real_cost is None else (
            "VENDOR_REPORTED" if str(meta.get("price_source") or "") == "usage.cost" else "REGISTRY")

    mode = _upper_in(billing_mode, BILLING_MODES) or "CHARGED"
    status = _upper_in(charge_status, CHARGE_STATUSES) or "NOT_APPLICABLE"
    reason = _upper_in(free_reason, FREE_REASONS)
    occurred = occurred_at or datetime.now(timezone.utc)
    if occurred.tzinfo is None:
        occurred = occurred.replace(tzinfo=timezone.utc)

    return {
        "id": event_id or _uuid_or_none(inp.usage_event_id) or str(uuid.uuid4()),
        "occurred_at": occurred,
        "institute_id": _s(inp.institute_id, 64),
        "actor_kind": actor["actor_kind"],
        "actor_user_id": actor["actor_user_id"],
        "actor_role_class": actor["actor_role_class"],
        "actor_roles_raw": actor["actor_roles_raw"],
        "role_source": actor["role_source"],
        "actor_display_name": _s(inp.actor_display_name, W_NAME),
        "subject_user_id": subject,
        "subject_display_name": _s(inp.subject_display_name, W_NAME),
        "use_case": use_case[:W_USE_CASE],
        "use_case_source": uc_source[:W_USE_CASE_SOURCE],
        "feature_group": (str((row or {}).get("feature_group") or UNKNOWN_FEATURE_GROUP))[:W_FEATURE_GROUP],
        "request_type": _s(inp.request_type, W_REQUEST_TYPE),
        "tool_key": tool_key,
        "surface": _surface(inp, row)[:W_SURFACE],
        "source_service": (_s(inp.source_service, W_SOURCE_SERVICE) or DEFAULT_SOURCE_SERVICE).lower(),
        "context": context,
        "model_id": _s(model_id, W_MODEL),
        "model_wire_id": _s(wire, W_MODEL),
        "provider": _s(inp.provider, W_PROVIDER),
        "router": _s(inp.router, W_ROUTER),
        "gateway_key_id": _s(inp.gateway_key_id, W_GATEWAY_KEY),
        "byo_key": bool(inp.byo_key) if inp.byo_key is not None else False,
        "prompt_tokens": _int(inp.prompt_tokens),
        "cached_read_tokens": _int(ctx_in.get("cached_read_tokens")),
        "cache_write_tokens": _int(ctx_in.get("cache_write_tokens")),
        "completion_tokens": _int(inp.completion_tokens),
        "reasoning_tokens": _int(ctx_in.get("reasoning_tokens")),
        "image_tokens": _int(ctx_in.get("image_tokens")),
        "image_count": _int(ctx_in.get("image_count")),
        "seconds": _num(inp.seconds),
        "minutes": _num(ctx_in.get("minutes")),
        "characters": _int(inp.character_count),
        "request_count": 1,
        "real_cost_usd": real_cost,
        "cost_source": cost_source[:W_COST_SOURCE],
        "list_credits": _num(list_credits),
        "credits_charged": _num(credits_charged),
        "refunded_credits": Decimal("0"),
        "billing_mode": mode[:W_BILLING_MODE],
        "charge_status": status[:W_CHARGE_STATUS],
        "free_reason": reason[:W_FREE_REASON] if reason else None,
        "limit_decision": "NONE",
        "ledger_tx_id": _uuid_or_none(ledger_tx_id),
        "parent_event_id": _uuid_or_none(inp.parent_event_id),
        "batch_id": _s(inp.batch_id, W_BATCH),
        "idempotency_key": _s(idempotency_key, W_IDEM),
        "created_at": datetime.now(timezone.utc),
    }


# ----------------------------------------------------------------------------
# DB writes
# ----------------------------------------------------------------------------

def _insert_ignore(db, row: Dict[str, Any]) -> bool:
    """INSERT ... ON CONFLICT DO NOTHING. True when a row was written.

    Decided by RETURNING, never by rowcount: under psycopg 3 (the prod driver)
    SQLAlchemy reports rowcount -1 for this statement, which read as "not
    written" and silently skipped the ledger and usage back-links."""
    from .models import EVENT_TABLE

    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as _ins
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert as _ins
    else:  # pragma: no cover - only Postgres in prod, SQLite in tests
        from sqlalchemy import insert as _plain

        res = db.execute(_plain(EVENT_TABLE).values(**row).returning(EVENT_TABLE.c.id))
        return res.first() is not None
    res = db.execute(_ins(EVENT_TABLE).values(**row).on_conflict_do_nothing().returning(EVENT_TABLE.c.id))
    return res.first() is not None


# Columns an upgrade (an earlier FREE/record-only event becoming CHARGED) only
# fills when the deduction knows better; the money columns are always taken.
_COALESCE_ON_UPGRADE = (
    "actor_user_id", "actor_display_name", "subject_user_id", "subject_display_name", "context",
    "model_id", "model_wire_id", "provider", "router", "gateway_key_id", "real_cost_usd", "batch_id",
    "parent_event_id", "tool_key", "request_type",
)
_ALWAYS_ON_UPGRADE = (
    "list_credits", "credits_charged", "billing_mode", "charge_status", "free_reason", "ledger_tx_id",
    "occurred_at",
)
# AI-plan columns (V586): only in a row when the charge went through a live
# subscription (record_event's plan_fields); absent from every other row.
PLAN_EVENT_COLUMNS = ("shadow_billing_mode", "subscription_id", "plan_id", "plan_item_id")


def _upgrade(db, where_clause, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Turn an existing not-yet-charged event into the charged one. Returns
    {id, use_case} of the updated row, or None when nothing matched."""
    from sqlalchemy import update

    from .models import EVENT_TABLE as T

    values: Dict[str, Any] = {k: row[k] for k in _ALWAYS_ON_UPGRADE}
    for k in _COALESCE_ON_UPGRADE:
        if row.get(k) is not None:
            values[k] = row[k]
    for k in PLAN_EVENT_COLUMNS:
        if row.get(k) is not None:
            values[k] = row[k]
    if row.get("ledger_tx_id") is None and row.get("idempotency_key") and row.get("billing_mode") in ("INCLUDED",
                                                                                                    "ALLOWANCE"):
        # A plan-covered use has no ledger row: its event key is its idempotency record.
        values["idempotency_key"] = row["idempotency_key"]
    if row.get("use_case") and row["use_case"] != UNKNOWN_USE_CASE:
        values.update(use_case=row["use_case"], use_case_source=row["use_case_source"],
                      feature_group=row["feature_group"])
    if row.get("role_source") != "UNRESOLVED":
        for k in ("actor_kind", "actor_role_class", "actor_roles_raw", "role_source"):
            values[k] = row[k]
    if row.get("surface") and row["surface"] != "UNKNOWN":
        values["surface"] = row["surface"]
    for k in ("prompt_tokens", "completion_tokens", "characters", "seconds"):
        if row.get(k):
            values[k] = row[k]
    stmt = (update(T).where(where_clause).where(T.c.ledger_tx_id.is_(None))
            .values(**values).returning(T.c.id, T.c.use_case))
    got = db.execute(stmt).first()
    if got is None:
        return None
    return {"id": str(got[0]), "use_case": got[1]}


def _link_ledger(db, ledger_tx_id: str, event_id: str, use_case: str) -> None:
    from sqlalchemy import text

    db.execute(text("UPDATE credit_transactions SET usage_event_id = :e, use_case = :u WHERE id = :t"),
               {"e": event_id, "u": use_case, "t": ledger_tx_id})


def _link_usage_row(db, usage_log_id: str, event_id: str, router: Optional[str],
                    gateway_key_id: Optional[str], only_if_unlinked: bool = False) -> int:
    from sqlalchemy import text

    sets = ["usage_event_id = :e"]
    params: Dict[str, Any] = {"e": event_id, "u": usage_log_id}
    if router:
        sets.append("router = :r")
        params["r"] = router
    if gateway_key_id:
        sets.append("gateway_key_id = :g")
        params["g"] = gateway_key_id
    sql = f"UPDATE ai_token_usage SET {', '.join(sets)} WHERE id = :u"
    if only_if_unlinked:
        sql += " AND usage_event_id IS NULL"
    res = db.execute(text(sql), params)
    return res.rowcount or 0


def _ready(db) -> Optional[Any]:
    """The lookup snapshot when metering should run now, else None (counted)."""
    if not _cache.events_enabled():
        _count("skipped_disabled")
        return None
    snap = _cache.get_snapshot(db)
    if snap is None:
        _count("skipped_absent")
        return None
    return snap


def _apply_plan_fields(row: Dict[str, Any], plan_fields: Dict[str, Any]) -> None:
    """Put the AI-plan columns (and plan context keys) on a built event row."""
    mode = _upper_in(plan_fields.get("shadow_billing_mode"), BILLING_MODES)
    if mode:
        row["shadow_billing_mode"] = mode[:W_BILLING_MODE]
    for k in ("subscription_id", "plan_id", "plan_item_id"):
        v = _uuid_or_none(plan_fields.get(k))
        if v:
            row[k] = v
    extra = plan_fields.get("context")
    if isinstance(extra, dict) and extra:
        row["context"] = _clean_context(row.get("context") or {}, extra)


def record_event(
    db,
    inp: Optional[EventInput] = None,
    *,
    billing_mode: str = "FREE",
    charge_status: str = "NOT_APPLICABLE",
    list_credits: Any = 0,
    credits_charged: Any = 0,
    free_reason: Optional[str] = None,
    ledger_tx_id: Optional[str] = None,
    usage_log_id: Optional[str] = None,
    occurred_at: Optional[datetime] = None,
    idempotency_key: Optional[str] = None,
    link_usage_only_if_unlinked: bool = False,
    lookup_existing: bool = True,
    _out: Optional[Dict[str, Any]] = None,
    plan_fields: Optional[Dict[str, Any]] = None,
    upgrade_without_ledger: bool = False,
    **fields: Any,
) -> Optional[str]:
    """Write one usage event on `db` inside a SAVEPOINT. Never raises; returns
    the event id, or None when metering is off/absent or the write failed.

    With `ledger_tx_id`, an earlier event for the same operation (caller-given
    usage_event_id, or the event already linked to `usage_log_id`) is upgraded
    in place instead of inserting a second one, and the ledger row is linked.
    `_out` (internal): receives {"previous": <row before the upgrade>} when the
    institute has a usage-limits policy, so the counter hook can replace the
    earlier event's contribution instead of counting the operation twice.
    `plan_fields` (AI plans, only for an institute with a live subscription):
    shadow_billing_mode / subscription_id / plan_id / plan_item_id, plus a
    "context" dict merged into the event context. `upgrade_without_ledger`:
    look up the earlier event (as above) also when there is no ledger row (an
    INCLUDED / ALLOWANCE use)."""
    try:
        if inp is None:
            inp = input_from(None, **fields)
        elif fields:
            inp = input_from(inp, **fields)
        snap = _ready(db)
        if snap is None:
            return None
        row = build_row(snap, inp, billing_mode=billing_mode, charge_status=charge_status,
                        list_credits=list_credits, credits_charged=credits_charged, free_reason=free_reason,
                        ledger_tx_id=ledger_tx_id, occurred_at=occurred_at, idempotency_key=idempotency_key)
        if plan_fields:
            _apply_plan_fields(row, plan_fields)
    except Exception as exc:  # noqa: BLE001
        _note_failure("resolve", exc)
        return None

    try:
        from sqlalchemy import text

        from .models import EVENT_TABLE as T

        with db.begin_nested():
            event_id: Optional[str] = None
            use_case = row["use_case"]
            if (ledger_tx_id or upgrade_without_ledger) and lookup_existing:
                supplied = _uuid_or_none(inp.usage_event_id)
                found = None
                snap_prev = _out is not None and _limits_on(inp.institute_id)
                if supplied:
                    if snap_prev:
                        _out["previous"] = _event_row(db, supplied)
                    found = _upgrade(db, T.c.id == supplied, row)
                if found is None and usage_log_id:
                    # An event an earlier record_usage wrote for this usage row.
                    existing = db.execute(text("SELECT usage_event_id FROM ai_token_usage WHERE id = :ul"),
                                          {"ul": usage_log_id}).scalar()
                    if existing:
                        if snap_prev:
                            _out["previous"] = _event_row(db, str(existing))
                        found = _upgrade(db, T.c.id == str(existing), row)
                if found is None and _out is not None:
                    _out.pop("previous", None)
                if found is not None:
                    event_id, use_case = found["id"], found["use_case"] or use_case
                    _count("linked_existing")
            if event_id is None:
                if _insert_ignore(db, row):
                    event_id = row["id"]
                    _count("written")
            if event_id is not None:
                if ledger_tx_id:
                    _link_ledger(db, ledger_tx_id, event_id, use_case)
                if usage_log_id:
                    _link_usage_row(db, usage_log_id, event_id, row.get("router"), row.get("gateway_key_id"),
                                    only_if_unlinked=link_usage_only_if_unlinked)
        return event_id
    except Exception as exc:  # noqa: BLE001
        _note_failure("write", exc)
        return None


# ----------------------------------------------------------------------------
# Hooks used by the credit / usage services
# ----------------------------------------------------------------------------

def record_charged_event(db, request: Any, *, transaction_id: Optional[str], credits: Any,
                         now: Optional[datetime] = None, _out: Optional[Dict[str, Any]] = None,
                         billing_mode: str = "CHARGED", charge_status: str = "POSTED",
                         list_credits: Any = None, plan_fields: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """deduct_credits, after the USAGE_DEDUCTION INSERT, before its commit.
    list_credits = the amount today's code computed; credits_charged = -ledger.amount.

    AI plans (live subscription only): `billing_mode` SPLIT / INCLUDED /
    ALLOWANCE with `list_credits` (what CHARGED would have debited) differing
    from `credits` (the wallet part), `plan_fields` for the plan columns, and
    `transaction_id` None when no ledger row was written (INCLUDED /
    ALLOWANCE). The defaults are exactly the CHARGED event."""
    try:
        inp = input_from(request)
        private = getattr(request, "__pydantic_private__", None) or {}
        # Only a well-formed id is used (ai_token_usage.id is a uuid column; a
        # malformed one would just cost the event its savepoint).
        usage_log_id = _uuid_or_none(getattr(request, "usage_log_id", None))
        fresh_usage = bool(private.get("_meter_fresh_usage_row")) if isinstance(private, dict) else False
        if private.get("_meter_real_cost_usd") is not None and inp.real_cost_usd is None:
            inp.real_cost_usd = private.get("_meter_real_cost_usd")
        if private.get("_meter_metadata") and inp.metadata is None:
            inp.metadata = private.get("_meter_metadata")
    except Exception as exc:  # noqa: BLE001
        _note_failure("input", exc)
        return None
    if plan_fields is None and billing_mode == "CHARGED" and list_credits is None:
        return record_event(
            db, inp,
            billing_mode="CHARGED", charge_status="POSTED",
            list_credits=credits, credits_charged=credits,
            ledger_tx_id=transaction_id, usage_log_id=usage_log_id,
            occurred_at=now, idempotency_key=inp.idempotency_key,
            lookup_existing=bool(_uuid_or_none(inp.usage_event_id)) or (bool(usage_log_id) and not fresh_usage),
            _out=_out,
        )
    return record_event(
        db, inp,
        billing_mode=billing_mode, charge_status=charge_status,
        list_credits=credits if list_credits is None else list_credits, credits_charged=credits,
        ledger_tx_id=transaction_id, usage_log_id=usage_log_id,
        occurred_at=now, idempotency_key=inp.idempotency_key,
        lookup_existing=bool(_uuid_or_none(inp.usage_event_id)) or (bool(usage_log_id) and not fresh_usage),
        _out=_out, plan_fields=plan_fields, upgrade_without_ledger=not transaction_id,
    )


def _end_transaction(db, where: str) -> None:
    """Commit whatever metering opened on `db` (only metering work can be in
    it), so the caller's session is never left idle in a transaction."""
    try:
        if db.in_transaction():
            db.commit()
    except Exception as exc:  # noqa: BLE001
        _note_failure(where, exc)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass


def _pool_would_wait(db) -> bool:
    """True when checking out a connection from `db`'s pool would have to wait
    (every connection of a bounded pool is in use). Any doubt -> False."""
    try:
        pool = _engine_of(db).pool
        size = pool.size()
        overflow = getattr(pool, "_max_overflow", 0)
        if not isinstance(size, int) or not isinstance(overflow, int) or overflow < 0:
            return False
        return pool.checkedout() >= size + overflow
    except Exception:  # noqa: BLE001
        return False


def record_charged_event_after_commit(db, request: Any, *, transaction_id: str, credits: Any,
                                      now: Optional[datetime] = None, **plan_kwargs: Any) -> Optional[str]:
    """deduct_credits, right AFTER its commit: the CHARGED event in a short
    transaction of its own on the same session (SAVEPOINT inside), so the
    event write never lengthens the institute balance row lock. That
    transaction is always ended here, whatever happened. Never raises."""
    event_id: Optional[str] = None
    if _pool_would_wait(db):
        # Every pooled connection is in use: writing the event now would make
        # the already-committed charge wait for one. Skip it (parity / backfill
        # report the gap); the charge response is never delayed by metering.
        _count("skipped_busy")
        _log_limited("busy", logging.WARNING,
                     "metering: DB pool exhausted; usage event skipped (charge unaffected)")
        return None
    try:
        out: Dict[str, Any] = {}
        event_id = record_charged_event(db, request, transaction_id=transaction_id, credits=credits, now=now,
                                        _out=out, **plan_kwargs)
        # Usage-limit counters (contract N4), same short post-commit
        # transaction, own SAVEPOINT; an institute without a limits policy
        # costs one in-memory lookup here.
        institute_id = getattr(request, "institute_id", None)
        if event_id and _limits_on(institute_id):
            apply_limits_for_event(db, event_id, institute_id, noted=_noted_decision(institute_id),
                                   previous=out.get("previous"))
    except Exception as exc:  # noqa: BLE001
        _note_failure("charged", exc)
    finally:
        _end_transaction(db, "charged-commit")
    return event_id


# --- usage-limit counters (contract N4) ---------------------------------------
#
# Only for institutes with a limits policy (limit_gate.policy_active: an
# in-memory set lookup, no I/O). Every write runs in its own SAVEPOINT on the
# session that just wrote the event, after the charge committed; a failure
# rolls back that savepoint only (the charge and the event are kept), is
# counted and logged at most once a minute. Counters are a cache of the events
# (the nightly rebuild repairs any drift).

def _limit_gate() -> Any:
    try:
        from . import limit_gate

        return limit_gate
    except Exception:  # noqa: BLE001
        return None


def _limits_on(institute_id: Optional[str]) -> bool:
    if not institute_id:
        return False
    gate = _limit_gate()
    return bool(gate is not None and gate.policy_active(institute_id))


def _noted_decision(institute_id: Optional[str]) -> Optional[str]:
    gate = _limit_gate()
    try:
        return gate.noted_decision(institute_id) if gate is not None else None
    except Exception:  # noqa: BLE001
        return None


def _event_row(db, event_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """The ai_usage_event row as a dict (None when absent)."""
    if not event_id:
        return None
    from sqlalchemy import select

    from .models import EVENT_TABLE as T

    got = db.execute(select(T).where(T.c.id == str(event_id))).mappings().first()
    return dict(got) if got is not None else None


def _counted(row: Optional[Dict[str, Any]]) -> bool:
    """Did the counter hook already count this event? (it stamps a
    limit_decision other than NONE whenever it touched the counters)."""
    return bool(row) and str(row.get("limit_decision") or "NONE").upper() != "NONE"


def apply_limits_for_event(db, event_id: str, institute_id: Optional[str], *, noted: Optional[str] = None,
                           previous: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Add one just-written event to the institute's usage counters and stamp
    its limit_decision (OK / WARN / WOULD_BLOCK / OVERRUN). `previous` is the
    same event before an upgrade: when that version was already counted, its
    credits are taken back first and the request is not counted twice.
    BUNDLED events are part of another charge and are not counted. Never
    raises; returns the stored decision or None."""
    if not event_id or not _limits_on(institute_id):
        return None
    gate = _limit_gate()
    mod = gate._limits() if gate is not None else None  # noqa: SLF001
    if mod is None:
        return None
    try:
        from sqlalchemy import update

        from .models import EVENT_TABLE as T

        with db.begin_nested():
            row = _event_row(db, event_id)
            if row is None or str(row.get("free_reason") or "").upper() == "BUNDLED":
                return None
            if _counted(previous):
                # The same operation was counted before (as a record-only
                # event): take ALL of that contribution back (its credits, its
                # count even when it carried 0 credits, its cost) under its OLD
                # use case / actor; the upgraded event is counted once below.
                mod.remove_event_contribution(db, previous)
            apply_row = dict(row)
            ctx = row.get("context") if isinstance(row.get("context"), dict) else {}
            reservation_id = _uuid_or_none(ctx.get("reservation_id")) if ctx else None
            if reservation_id:
                # A caller that reserved through /internal/metering/v1/authorize
                # passes the id in usage_context; the engine settles it.
                apply_row["reservation_id"] = reservation_id
            result = mod.apply_event_to_counters(db, apply_row)
            final = gate.combine_event_decision(result, noted)
            if final == "NONE" and _counted(previous):
                final = str(previous.get("limit_decision"))
            if final != str(row.get("limit_decision") or "NONE"):
                db.execute(update(T).where(T.c.id == row["id"]).values(limit_decision=final))
        _count("limits_applied")
        if final == "OVERRUN":
            _count("limits_overrun")
        return final
    except Exception as exc:  # noqa: BLE001
        _count("limits_failed")
        _log_limited("limits:apply", logging.WARNING,
                     "metering: usage-limit counters not updated (charge and event kept; nightly rebuild "
                     "repairs): %s", str(exc).splitlines()[0][:300] if str(exc) else type(exc).__name__)
        return None


def _decrement_for_refund(db, event_id: str, refunded: Decimal, already: Any = 0) -> None:
    """Take `refunded` MORE credits back out of the counters of a counted event
    (`already` = what had been refunded before; own SAVEPOINT)."""
    gate = _limit_gate()
    mod = gate._limits() if gate is not None else None  # noqa: SLF001
    if mod is None:
        return
    try:
        with db.begin_nested():
            row = _event_row(db, event_id)
            if not _counted(row):
                return
            mod.decrement_for_refund(db, {**row, "refunded_credits": already or 0}, refunded)
        _count("limits_refund_decrements")
    except Exception as exc:  # noqa: BLE001
        _count("limits_failed")
        _log_limited("limits:refund", logging.WARNING,
                     "metering: usage-limit refund decrement failed (refund kept): %s",
                     str(exc).splitlines()[0][:300] if str(exc) else type(exc).__name__)


# --- background writer --------------------------------------------------------

_executor: Optional[ThreadPoolExecutor] = None
_executor_lock = threading.Lock()
_pending = 0
_pending_lock = threading.Lock()


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="usage-events")
        return _executor


def _engine_of(db) -> Any:
    bind = db.get_bind()
    return getattr(bind, "engine", bind)


def _submit(fn, *args: Any, **kwargs: Any) -> bool:
    global _pending
    with _pending_lock:
        if _pending >= MAX_PENDING:
            _count("dropped_backlog")
            _log_limited("backlog", logging.WARNING, "metering: background backlog full; usage event dropped")
            return False
        _pending += 1

    def _run() -> None:
        global _pending
        try:
            fn(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001
            _note_failure("background", exc)
        finally:
            with _pending_lock:
                _pending -= 1

    try:
        _get_executor().submit(_run)
        _count("queued")
        return True
    except Exception as exc:  # noqa: BLE001
        with _pending_lock:
            _pending -= 1
        _note_failure("queue", exc)
        return False


def wait_for_background(timeout: float = 10.0) -> bool:
    """Tests: block until every queued write has run."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with _pending_lock:
            if _pending == 0:
                return True
        time.sleep(0.01)
    return False


def _with_session(engine: Any, work) -> None:
    from sqlalchemy.orm import Session

    session = Session(bind=engine, future=True)
    try:
        work(session)
        session.commit()
    except Exception:
        try:
            session.rollback()
        except Exception:  # noqa: BLE001
            pass
        raise
    finally:
        session.close()


def queue_dropped_event(db, request: Any, *, credits: Any, now: Optional[datetime] = None) -> bool:
    """deduct_credits' DROPPED CHARGE branch (no ledger row, nothing committed
    there): CHARGED / DROPPED_INSUFFICIENT with list_credits, on its own session.
    The ledger idempotency key is kept as 'dropped:<key>' so a later successful
    retry still gets its own CHARGED event."""
    try:
        if not _cache.events_enabled():
            _count("skipped_disabled")
            return False
        if _cache.peek_snapshot() is None and _cache._state.retry_after is not None \
                and time.monotonic() < _cache._state.retry_after:  # noqa: SLF001
            _count("skipped_absent")
            return False
        inp = input_from(request)
        engine = _engine_of(db)
        idem = f"dropped:{inp.idempotency_key}" if inp.idempotency_key else None
        when = now or datetime.utcnow()
        noted = _noted_decision(inp.institute_id) if _limits_on(inp.institute_id) else None
    except Exception as exc:  # noqa: BLE001
        _note_failure("dropped-input", exc)
        return False

    def _work(session) -> None:
        event_id = record_event(session, inp, billing_mode="CHARGED", charge_status="DROPPED_INSUFFICIENT",
                                list_credits=credits, credits_charged=0, occurred_at=when, idempotency_key=idem,
                                lookup_existing=False)
        if event_id and _limits_on(inp.institute_id):
            apply_limits_for_event(session, event_id, inp.institute_id, noted=noted)

    return _submit(_with_session, engine, _work)


def _free_reason_for(inp: EventInput, explicit: Optional[str], default: str) -> str:
    """NO_INSTITUTE (a fact) > explicit > metadata.free_reason > billed/charged
    false in the metadata (POLICY_FREE) > `default`."""
    if not inp.institute_id:
        return "NO_INSTITUTE"
    reason = _upper_in(explicit, FREE_REASONS)
    if reason:
        return reason
    meta = inp.metadata if isinstance(inp.metadata, dict) else {}
    reason = _upper_in(meta.get("free_reason"), FREE_REASONS)
    if reason:
        return reason
    for k in ("billed", "charged"):
        if k in meta and meta.get(k) in (False, "false", "False", 0):
            return "POLICY_FREE"
    return default


def _list_credits_for(db, inp: EventInput) -> Decimal:
    """What a CHARGED deduction would have debited (CreditService.calculate_credits,
    unchanged), for LLM-ish record-only rows. In its own savepoint; 0 on any problem."""
    if not inp.model or not inp.request_type:
        return Decimal("0")
    if not (_int(inp.prompt_tokens) or _int(inp.completion_tokens) or _int(inp.character_count)
            or _num(inp.seconds)):
        return Decimal("0")
    try:
        from ..credit_service import CreditService

        with db.begin_nested():
            return CreditService(db).calculate_credits(
                request_type=str(inp.request_type), model=inp.model,
                prompt_tokens=_int(inp.prompt_tokens), completion_tokens=_int(inp.completion_tokens),
                character_count=_int(inp.character_count), seconds=int(_num(inp.seconds)),
            )
    except Exception:  # noqa: BLE001
        return Decimal("0")


def write_free_event(db, inp: EventInput, *, usage_log_id: Optional[str] = None,
                     free_reason: Optional[str] = None, default_reason: str = "UNBILLED_GAP",
                     occurred_at: Optional[datetime] = None, limit_noted: Optional[str] = None) -> Optional[str]:
    """A record-only (FREE) event on `db`, synchronously. When `usage_log_id`
    is given the ai_token_usage row is claimed first (usage_event_id IS NULL):
    if a deduction already linked its own event, nothing is written."""
    try:
        if _ready(db) is None:
            return None
        meta = inp.metadata if isinstance(inp.metadata, dict) else {}
        by_caller = bool(meta.get("charged_by_caller"))
        # internal_llm rows: the calling service bills the whole operation itself
        # (its own CHARGED event, e.g. charge-tool), so this vendor call is
        # BUNDLED with list_credits 0 — never counted twice.
        reason = _free_reason_for(inp, free_reason or ("BUNDLED" if by_caller else None), default_reason)
        status = "SKIPPED_NO_INSTITUTE" if reason == "NO_INSTITUTE" else "NOT_APPLICABLE"
        event_id = _uuid_or_none(inp.usage_event_id) or str(uuid.uuid4())
        usage_log_id = _uuid_or_none(usage_log_id)
        if usage_log_id:
            try:
                with db.begin_nested():
                    claimed = _link_usage_row(db, usage_log_id, event_id, _s(inp.router, W_ROUTER),
                                              _s(inp.gateway_key_id, W_GATEWAY_KEY), only_if_unlinked=True)
            except Exception as exc:  # noqa: BLE001
                _note_failure("free-claim", exc)
                return None
            if not claimed:
                return None
        # BUNDLED usage is already paid inside another charge (the tutor minute,
        # the video, the caller's own charge-tool): list_credits 0, never
        # counted twice. Estimates are kept for UNBILLED_GAP / POLICY_FREE only.
        list_credits = Decimal("0") if (by_caller or reason == "BUNDLED") else _list_credits_for(db, inp)
        inp.usage_event_id = event_id
        written = record_event(db, inp, billing_mode="FREE", charge_status=status, list_credits=list_credits,
                               credits_charged=0, free_reason=reason, occurred_at=occurred_at,
                               idempotency_key=None, lookup_existing=False)
        if written and _limits_on(inp.institute_id):
            apply_limits_for_event(db, written, inp.institute_id,
                                   noted=limit_noted if limit_noted is not None else _noted_decision(inp.institute_id))
        return written
    except Exception as exc:  # noqa: BLE001
        _note_failure("free", exc)
        return None


def queue_free_event(db, inp: EventInput, *, usage_log_id: Optional[str] = None,
                     free_reason: Optional[str] = None, default_reason: str = "UNBILLED_GAP") -> bool:
    """write_free_event on a background session (TokenUsageService.record_usage:
    the caller never waits, and its transaction is never touched)."""
    try:
        if not _cache.events_enabled():
            _count("skipped_disabled")
            return False
        if _cache.peek_snapshot() is None and _cache._state.retry_after is not None \
                and time.monotonic() < _cache._state.retry_after:  # noqa: SLF001
            _count("skipped_absent")
            return False
        engine = _engine_of(db)
        when = datetime.now(timezone.utc)
        # The worker thread has no request context: the gate's decision is
        # captured here (None, with no work, without a limits policy).
        noted = (_noted_decision(inp.institute_id) or "NONE") if _limits_on(inp.institute_id) else None
    except Exception as exc:  # noqa: BLE001
        _note_failure("free-input", exc)
        return False

    def _work(session) -> None:
        write_free_event(session, inp, usage_log_id=usage_log_id, free_reason=free_reason,
                         default_reason=default_reason, occurred_at=when, limit_noted=noted)

    return _submit(_with_session, engine, _work)


# AiVideoLedger descriptions (services/ai_video_ledger.py): a charge is
# "AI video shot <n>[/seg<k>] (<d>s, audio)", its per-shot refund
# "AI video shot <n>[/seg<k>] refund: <reason>".
_SHOT_DESC = re.compile(r"^\s*AI video shot (\d+)(?:/seg(\d+))?(\s+refund\b)?")


def _shot_key(description: Any):
    """(shot, seg or None, is_refund) from an AiVideoLedger description, else None."""
    m = _SHOT_DESC.match(str(description or ""))
    if not m:
        return None
    return m.group(1), m.group(2), bool(m.group(3))


def allocate_refunds(refunds: List[Any], events: List[Any]) -> Dict[str, Decimal]:
    """Refunded credits per CHARGED event of one batch (pure).

    refunds: [(amount, description)] of the batch's REFUND rows, oldest first.
    events:  [(event_id, credits_charged, ledger description)] oldest first.

    A per-shot refund ("AI video shot 6[/seg1] refund: ...") goes to the
    charges of that same shot (and segment, when named), oldest first. Every
    other refund (the pipeline's "Full refund for failed video generation ...",
    which is already net of the per-shot ones), and any per-shot remainder no
    matching charge can absorb, is spread over what is left, oldest first."""
    cap: Dict[str, Decimal] = {}
    keys: Dict[str, Any] = {}
    order: List[str] = []
    for ev_id, charged, desc in events:
        k = str(ev_id)
        if k in cap:
            continue
        cap[k] = Decimal(str(charged or 0))
        k_desc = _shot_key(desc)
        keys[k] = k_desc if k_desc is not None and not k_desc[2] else None
        order.append(k)
    share: Dict[str, Decimal] = {k: Decimal("0") for k in order}
    pool = Decimal("0")

    def _take(targets: List[str], amount: Decimal) -> Decimal:
        for k in targets:
            if amount <= 0:
                break
            room = cap[k] - share[k]
            if room <= 0:
                continue
            got = min(room, amount)
            share[k] += got
            amount -= got
        return amount

    for amount, desc in refunds:
        amt = abs(Decimal(str(amount or 0)))
        if amt <= 0:
            continue
        key = _shot_key(desc)
        if key is not None and key[2]:
            shot, seg = key[0], key[1]
            targets = [k for k in order if keys[k] is not None and keys[k][0] == shot
                       and (seg is None or keys[k][1] == seg)]
            pool += _take(targets, amt)
        else:
            pool += amt
    if pool > 0:
        _take(order, pool)
    return share


def _allowance_refunded(ctx: Any) -> Decimal:
    """Plan allowance given back on an event (context.allowance_refunded)."""
    try:
        if isinstance(ctx, str):
            ctx = json.loads(ctx)
        if isinstance(ctx, dict):
            return _num(ctx.get("allowance_refunded"))
    except Exception:  # noqa: BLE001
        pass
    return Decimal("0")


def mark_batch_refunds(db, institute_id: Optional[str], batch_id: Optional[str]) -> int:
    """After a REFUND ledger row for `batch_id`: the batch's REFUND rows are
    applied to its CHARGED events (allocate_refunds: per-shot refunds to that
    shot's charges, the rest oldest first), setting refunded_credits and
    charge_status REFUNDED / PARTIAL_REFUND / POSTED. Recomputed from the ledger
    every time, so idempotent and order-independent. Meant for a session of
    its own (queue_batch_refunds); whatever it opened on `db` is ended before
    it returns. Never raises. Returns the number of events changed."""
    if not institute_id or not batch_id:
        return 0
    changed = 0
    try:
        if _ready(db) is None:
            _end_transaction(db, "refund-commit")
            return 0
        from sqlalchemy import select, text, update

        from .models import EVENT_TABLE as T

        with db.begin_nested():
            ledger = db.execute(text(
                "SELECT id, transaction_type, amount, description FROM credit_transactions "
                "WHERE batch_id = :b AND institute_id = :i "
                "AND transaction_type IN ('REFUND', 'USAGE_DEDUCTION') ORDER BY created_at, id"),
                {"b": batch_id, "i": institute_id}).all()
            refunds = [(r[2], r[3]) for r in ledger if r[1] == "REFUND"]
            desc_by_tx = {str(r[0]).lower(): r[3] for r in ledger if r[1] == "USAGE_DEDUCTION"}
            # SPLIT (AI plans): the wallet part has a ledger row like a CHARGED
            # event; its allowance part refunded (plan_wiring) is kept on top.
            events = db.execute(
                select(T.c.id, T.c.credits_charged, T.c.refunded_credits, T.c.charge_status, T.c.ledger_tx_id,
                       T.c.billing_mode, T.c.list_credits, T.c.context)
                .where(T.c.batch_id == batch_id, T.c.institute_id == str(institute_id),
                       T.c.billing_mode.in_(("CHARGED", "SPLIT")), T.c.ledger_tx_id.isnot(None))
                .order_by(T.c.occurred_at, T.c.id)).all()
            shares = allocate_refunds(
                refunds, [(ev[0], ev[1], desc_by_tx.get(str(ev[4]).lower())) for ev in events])
            for ev_id, charged, already, status, _tx, mode, listed, ctx in events:
                charged_d = Decimal(str(charged or 0))
                share = shares.get(str(ev_id), Decimal("0"))
                if mode == "SPLIT":
                    share = share + _allowance_refunded(ctx)
                    full = Decimal(str(listed or 0))
                    if share <= 0:
                        new_status = "POSTED"
                    elif share >= full:
                        new_status = "REFUNDED"
                    else:
                        new_status = "PARTIAL_REFUND"
                elif share <= 0:
                    new_status = "POSTED"
                elif share >= charged_d:
                    new_status = "REFUNDED"
                else:
                    new_status = "PARTIAL_REFUND"
                if Decimal(str(already or 0)) == share and status == new_status:
                    continue
                db.execute(update(T).where(T.c.id == ev_id).values(refunded_credits=share,
                                                                    charge_status=new_status))
                changed += 1
                newly_refunded = share - Decimal(str(already or 0))
                if newly_refunded > 0 and _limits_on(institute_id):
                    _decrement_for_refund(db, str(ev_id), newly_refunded, already)
    except Exception as exc:  # noqa: BLE001
        _note_failure("refund", exc)
        changed = 0
    _end_transaction(db, "refund-commit")
    if changed:
        _count("refund_marked", changed)
    return changed


def queue_batch_refunds(db, institute_id: Optional[str], batch_id: Optional[str]) -> bool:
    """mark_batch_refunds on a background session (refund_credits, after its
    commit): the refunding session is never touched and never waits."""
    if not institute_id or not batch_id:
        return False
    try:
        if not _cache.events_enabled():
            _count("skipped_disabled")
            return False
        if _cache.peek_snapshot() is None and _cache._state.retry_after is not None \
                and time.monotonic() < _cache._state.retry_after:  # noqa: SLF001
            _count("skipped_absent")
            return False
        engine = _engine_of(db)
    except Exception as exc:  # noqa: BLE001
        _note_failure("refund-input", exc)
        return False
    return _submit(_with_session, engine, lambda session: mark_batch_refunds(session, institute_id, batch_id))


__all__ = [
    "EventInput", "input_from", "build_row", "resolve_use_case", "resolve_actor", "resolve_model",
    "record_event", "record_charged_event", "record_charged_event_after_commit", "queue_dropped_event",
    "queue_free_event", "write_free_event", "mark_batch_refunds", "queue_batch_refunds", "allocate_refunds",
    "strip_cost_keys", "stats", "wait_for_background", "apply_limits_for_event",
]
