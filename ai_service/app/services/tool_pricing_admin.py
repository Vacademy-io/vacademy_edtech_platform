"""Super-admin rate card: per-institute price overrides and the pricing audit
trail (docs/AI_EVALUATION_PUBLIC_API.md 10.2, 10.5, 10.7).

Tables (admin_core DB, V545):
  * institute_tool_pricing - append-only; one OPEN row (effective_to IS NULL)
    per (institute, tool_key). An edit closes the open row and inserts a new
    one in the same transaction, so the table is its own history.
  * ai_tool_pricing_history - one row per edit of a GLOBAL ai_tool_pricing row,
    and one per override revert (the revert's reason has no other home;
    new_json.scope = "institute" marks those).

The router (routers/super_admin.py) guards every call with the platform-staff
allowlist; this module only validates and writes.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .tool_cost_estimator import (
    COPY_CHECK_API_TOOL_KEY,
    RATE_SOURCE_GLOBAL,
    ToolCostEstimator,
    apply_override,
    is_fixed_price,
)

logger = logging.getLogger(__name__)

MAX_RATE = 10000
MAX_REASON = 2000

# Example inputs per unit_field for the "what would this cost" preview the PUT
# returns (spec 10.7). (param name, sample sizes)
EXAMPLE_UNITS = {
    "questions": ("num_questions", (10, 40, 64)),
    "pages": ("num_pages", (3, 12, 50)),
    "images": ("num_images", (1, 5, 10)),
    "audio_minutes": ("audio_minutes", (10, 30, 60)),
    "chars": ("transcript_chars", (2000, 10000, 50000)),
}


class PricingAdminError(Exception):
    """A request the endpoint must refuse: carries the HTTP status."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


# ── shapes ────────────────────────────────────────────────────────────────

def _num(value: Any) -> Optional[float]:
    return None if value is None else float(value)


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, (datetime, date)) else value


def _json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return None
    return value


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return _iso(value)


def rate_view(cfg: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "flat": _num(cfg.get("flat_base_credits")),
        "per_unit": _num(cfg.get("per_unit_credits")),
        "unit_field": cfg.get("unit_field"),
        "params": _jsonable(cfg.get("params") or {}),
    }


def override_view(row: Any) -> Dict[str, Any]:
    return {
        "id": str(row.id),
        "institute_id": str(row.institute_id),
        "tool_key": row.tool_key,
        "flat": _num(row.flat_base_credits),
        "per_unit": _num(row.per_unit_credits),
        "params": _json(row.params_json),
        "no_token_overage": bool(row.no_token_overage),
        "effective_from": _iso(row.effective_from),
        "effective_to": _iso(getattr(row, "effective_to", None)),
        "reason": row.reason,
        "created_by": row.created_by,
        "created_at": _iso(row.created_at),
        "ended_by": getattr(row, "ended_by", None),
    }


def _estimator_override(view: Dict[str, Any]) -> Dict[str, Any]:
    """An override_view in the shape ToolCostEstimator.apply_override reads."""
    return {
        "id": view["id"],
        "flat_base_credits": view["flat"],
        "per_unit_credits": view["per_unit"],
        "params": view["params"] if isinstance(view["params"], dict) else None,
        "no_token_overage": view["no_token_overage"],
    }


def effective_view(tool_key: str, cfg: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **rate_view(cfg),
        "no_token_overage": bool(cfg.get("no_token_overage")),
        "fixed_price": is_fixed_price(tool_key, cfg),
        "rate_source": cfg.get("rate_source"),
    }


def _reason(reason: Optional[str]) -> str:
    cleaned = (reason or "").strip()
    if not cleaned:
        raise PricingAdminError(422, "reason is required (e.g. the contract reference)")
    if len(cleaned) > MAX_REASON:
        raise PricingAdminError(422, f"reason must be at most {MAX_REASON} characters")
    return cleaned


def _rate(name: str, value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise PricingAdminError(422, f"{name} must be a number")
    if not (0 <= number <= MAX_RATE):
        raise PricingAdminError(422, f"{name} must be between 0 and {MAX_RATE} credits")
    return number


def _known_tool(estimator: ToolCostEstimator, tool_key: str) -> Dict[str, Any]:
    cfg = estimator.get_tool_pricing(tool_key).get(tool_key)
    if cfg is None:
        raise PricingAdminError(404, f"Unknown tool {tool_key}")
    return cfg


# ── SQL ───────────────────────────────────────────────────────────────────

_OVERRIDE_COLUMNS = (
    "id, institute_id, tool_key, flat_base_credits, per_unit_credits, params_json, no_token_overage, "
    "effective_from, effective_to, reason, created_by, created_at, ended_by"
)

_OPEN_FOR_INSTITUTE = text(
    f"SELECT {_OVERRIDE_COLUMNS} FROM institute_tool_pricing "
    "WHERE institute_id = :institute_id AND effective_to IS NULL"
)

# clock_timestamp(), not now(): now() is the transaction's start, which can be
# earlier than the effective_from of a row another edit committed meanwhile,
# and the CHECK (effective_to > effective_from) would then fail.
_CLOSE_OPEN = text(
    "UPDATE institute_tool_pricing "
    "SET effective_to = clock_timestamp(), ended_by = :actor "
    "WHERE institute_id = :institute_id AND tool_key = :tool_key AND effective_to IS NULL "
    f"RETURNING {_OVERRIDE_COLUMNS}"
)

_INSERT_OVERRIDE = text(
    "INSERT INTO institute_tool_pricing "
    "(institute_id, tool_key, flat_base_credits, per_unit_credits, params_json, no_token_overage, "
    " effective_from, reason, created_by) "
    "VALUES (:institute_id, :tool_key, :flat, :per_unit, CAST(:params AS JSONB), :no_token_overage, "
    " clock_timestamp(), :reason, :actor) "
    f"RETURNING {_OVERRIDE_COLUMNS}"
)

_INSERT_HISTORY = text(
    "INSERT INTO ai_tool_pricing_history (tool_key, old_json, new_json, changed_by, reason) "
    "VALUES (:tool_key, CAST(:old_json AS JSONB), CAST(:new_json AS JSONB), :actor, :reason)"
)

_OVERRIDE_COUNTS = text(
    "SELECT tool_key, COUNT(*) AS n FROM institute_tool_pricing "
    "WHERE effective_to IS NULL GROUP BY tool_key"
)


# ── reads ─────────────────────────────────────────────────────────────────

def open_overrides(db: Any, institute_id: str) -> Dict[str, Dict[str, Any]]:
    rows = db.execute(_OPEN_FOR_INSTITUTE, {"institute_id": institute_id}).fetchall()
    return {row.tool_key: override_view(row) for row in rows}


def list_institute_pricing(db: Any, institute_id: str, labels: Dict[str, str]) -> List[Dict[str, Any]]:
    """Every tool's global rate, this institute's open override (or null) and
    the rate it actually pays (spec 10.7 GET)."""
    estimator = ToolCostEstimator(db)
    global_rates = estimator.get_tool_pricing()
    overrides = open_overrides(db, institute_id)
    out = []
    for key in sorted(global_rates):
        cfg = global_rates[key]
        override = overrides.get(key)
        effective = apply_override(cfg, _estimator_override(override)) if override else cfg
        out.append({
            "tool_key": key,
            "label": labels.get(key, key.replace("_", " ")),
            "global": rate_view(cfg),
            "override": override,
            "effective": effective_view(key, effective),
            "source": "override" if override else (
                "global" if cfg.get("rate_source") == RATE_SOURCE_GLOBAL else "default"),
        })
    return out


def examples(db: Any, institute_id: str, tool_key: str) -> List[Dict[str, Any]]:
    """What a few typical runs cost at this institute's price and at the
    global price (spec 10.7 PUT response)."""
    estimator = ToolCostEstimator(db)
    cfg = _known_tool(estimator, tool_key)
    param_name, sizes = EXAMPLE_UNITS.get(cfg.get("unit_field"), (None, ()))
    # (label shown in the example, estimator params); every value is a number.
    inputs: List[tuple] = [({param_name: n}, {param_name: n}) for n in sizes] if param_name else [({}, {})]
    if tool_key == COPY_CHECK_API_TOOL_KEY:
        inputs.append(({"typed_answers": 4}, {"answer_mode": "TYPED", "num_answers": 4}))
    out = []
    for label, params in inputs:
        out.append({
            **label,
            "credits": estimator.estimate(tool_key, params, institute_id=institute_id)["estimated_credits"],
            "global_credits": estimator.estimate(tool_key, params)["estimated_credits"],
        })
    return out


def history(
    db: Any,
    tool_key: Optional[str] = None,
    institute_id: Optional[str] = None,
    limit: int = 200,
) -> Dict[str, Any]:
    """{"history": [...]}, newest first, each entry tagged with `scope`:
      * "global"          - an edit of the global rate (ai_tool_pricing_history:
                            old_json / new_json / changed_by / changed_at);
      * "override"        - an institute_tool_pricing row, open or closed
                            (flat / per_unit / params / effective_from / effective_to);
      * "override_revert" - an override ended through DELETE, with its reason.
    With institute_id, global edits stay (they apply to everyone) but other
    institutes' overrides and reverts are left out."""
    limit = max(1, min(int(limit), 1000))
    g_where, g_bind = [], {"limit": limit}
    o_where, o_bind = [], {"limit": limit}
    if tool_key:
        g_where.append("tool_key = :tool_key")
        o_where.append("tool_key = :tool_key")
        g_bind["tool_key"] = o_bind["tool_key"] = tool_key
    if institute_id:
        # Global edits apply to everyone; revert rows of OTHER institutes do not.
        g_where.append("(new_json->>'institute_id' IS NULL OR new_json->>'institute_id' = :institute_id)")
        o_where.append("institute_id = :institute_id")
        g_bind["institute_id"] = o_bind["institute_id"] = institute_id
    g_sql = ("SELECT id, tool_key, old_json, new_json, changed_by, reason, changed_at "
             "FROM ai_tool_pricing_history"
             + (" WHERE " + " AND ".join(g_where) if g_where else "")
             + " ORDER BY changed_at DESC LIMIT :limit")
    o_sql = (f"SELECT {_OVERRIDE_COLUMNS} FROM institute_tool_pricing"
             + (" WHERE " + " AND ".join(o_where) if o_where else "")
             + " ORDER BY created_at DESC LIMIT :limit")
    entries: List[Dict[str, Any]] = []
    for r in db.execute(text(g_sql), g_bind).fetchall():
        new = _json(r.new_json)
        if isinstance(new, dict) and new.get("scope") == "institute":
            entries.append({
                "id": str(r.id),
                "scope": "override_revert",
                "tool_key": r.tool_key,
                "institute_id": new.get("institute_id"),
                "ended": _json(r.old_json),
                "changed_by": r.changed_by,
                "reason": r.reason,
                "changed_at": _iso(r.changed_at),
            })
        else:
            entries.append({
                "id": str(r.id),
                "scope": "global",
                "tool_key": r.tool_key,
                "old_json": _json(r.old_json),
                "new_json": new,
                "changed_by": r.changed_by,
                "reason": r.reason,
                "changed_at": _iso(r.changed_at),
            })
    for r in db.execute(text(o_sql), o_bind).fetchall():
        entries.append({**override_view(r), "scope": "override", "changed_at": _iso(r.created_at)})
    entries.sort(key=lambda e: str(e.get("changed_at") or ""), reverse=True)
    return {"history": entries[:limit]}


def active_overrides(db: Any, tool_key: Optional[str] = None) -> List[Dict[str, Any]]:
    """Institutes with an open override (optionally for one tool)."""
    sql = f"SELECT {_OVERRIDE_COLUMNS} FROM institute_tool_pricing WHERE effective_to IS NULL"
    bind: Dict[str, Any] = {}
    if tool_key:
        sql += " AND tool_key = :tool_key"
        bind["tool_key"] = tool_key
    sql += " ORDER BY created_at DESC LIMIT 1000"
    return [override_view(r) for r in db.execute(text(sql), bind).fetchall()]


def override_counts(db: Any) -> Dict[str, int]:
    """Open overrides per tool, for the global rate card. {} when the table is
    not there yet (read in a SAVEPOINT so the caller's transaction survives)."""
    try:
        with db.begin_nested():
            rows = db.execute(_OVERRIDE_COUNTS).fetchall()
        return {r.tool_key: int(r.n) for r in rows}
    except Exception as exc:  # noqa: BLE001
        logger.warning("institute_tool_pricing count failed: %s", exc)
        return {}


# ── writes ────────────────────────────────────────────────────────────────

def set_override(
    db: Any,
    institute_id: str,
    tool_key: str,
    *,
    flat_base_credits: Any = None,
    per_unit_credits: Any = None,
    params: Optional[dict] = None,
    no_token_overage: bool = False,
    reason: Optional[str],
    actor: str,
) -> Dict[str, Any]:
    """Close the institute's open override for tool_key (if any) and insert the
    new one, in one transaction (spec 10.5). Non-null fields replace the global
    value; null fields inherit it."""
    reason = _reason(reason)
    estimator = ToolCostEstimator(db)
    _known_tool(estimator, tool_key)
    flat = _rate("flat_base_credits", flat_base_credits)
    per_unit = _rate("per_unit_credits", per_unit_credits)
    if params is not None and not isinstance(params, dict):
        raise PricingAdminError(422, "params must be an object")
    if flat is None and per_unit is None and params is None and not no_token_overage:
        raise PricingAdminError(422, "set at least one of flat_base_credits, per_unit_credits, "
                                     "params or no_token_overage (to remove an override, DELETE it)")
    bind = {"institute_id": institute_id, "tool_key": tool_key, "actor": actor}
    try:
        db.execute(_CLOSE_OPEN, bind)
        row = db.execute(_INSERT_OVERRIDE, {
            **bind,
            "flat": flat,
            "per_unit": per_unit,
            "params": None if params is None else json.dumps(params),
            "no_token_overage": bool(no_token_overage),
            "reason": reason,
        }).fetchone()
        db.commit()
    except IntegrityError:
        db.rollback()
        # ux_itp_open: another edit of the same (institute, tool) won the race.
        raise PricingAdminError(409, "this price was changed at the same moment; reload and retry")
    except Exception:
        db.rollback()
        raise
    logger.info("institute %s price for %s set by %s (flat=%s per_unit=%s params=%s no_overage=%s): %s",
                institute_id, tool_key, actor, flat, per_unit, params, no_token_overage, reason)
    effective = ToolCostEstimator(db).get_tool_pricing(tool_key, institute_id=institute_id)[tool_key]
    return {
        "override": override_view(row) if row is not None else None,
        "effective": effective_view(tool_key, effective),
        "examples": examples(db, institute_id, tool_key),
    }


def end_override(db: Any, institute_id: str, tool_key: str, *, reason: Optional[str], actor: str) -> Dict[str, Any]:
    """End the institute's open override: it reverts to the global price. The
    reason is kept in ai_tool_pricing_history (scope "institute")."""
    reason = _reason(reason)
    estimator = ToolCostEstimator(db)
    _known_tool(estimator, tool_key)
    try:
        row = db.execute(_CLOSE_OPEN, {"institute_id": institute_id, "tool_key": tool_key,
                                       "actor": actor}).fetchone()
        if row is None:
            db.rollback()
            raise PricingAdminError(404, f"institute {institute_id} has no price override for {tool_key}")
        ended = override_view(row)
        db.execute(_INSERT_HISTORY, {
            "tool_key": tool_key,
            "old_json": json.dumps(_jsonable(ended)),
            "new_json": json.dumps({"scope": "institute", "institute_id": institute_id,
                                    "action": "revert_to_global"}),
            "actor": actor,
            "reason": reason,
        })
        db.commit()
    except PricingAdminError:
        raise
    except Exception:
        db.rollback()
        raise
    logger.info("institute %s price override for %s ended by %s: %s", institute_id, tool_key, actor, reason)
    effective = ToolCostEstimator(db).get_tool_pricing(tool_key, institute_id=institute_id)[tool_key]
    return {"ended": ended, "effective": effective_view(tool_key, effective)}


def record_global_change(
    db: Any,
    tool_key: str,
    *,
    old: Dict[str, Any],
    new: Dict[str, Any],
    actor: str,
    reason: str,
) -> bool:
    """Write the ai_tool_pricing_history row for a global rate edit, inside a
    SAVEPOINT on the caller's transaction (commit is the caller's). Returns
    False - and logs an error - when it could not be written (e.g. the table is
    not there yet), so the price edit itself still goes through."""
    try:
        with db.begin_nested():
            db.execute(_INSERT_HISTORY, {
                "tool_key": tool_key,
                "old_json": json.dumps(_jsonable(old)),
                "new_json": json.dumps(_jsonable(new)),
                "actor": actor,
                "reason": reason,
            })
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("ai_tool_pricing_history write failed for %s (by %s, reason %r): %s",
                     tool_key, actor, reason, exc)
        return False


__all__ = [
    "PricingAdminError",
    "active_overrides",
    "end_override",
    "examples",
    "history",
    "list_institute_pricing",
    "override_counts",
    "record_global_change",
    "set_override",
]
