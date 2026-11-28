"""Super-admin control of which model every AI feature uses.

Backs routers/super_admin_models.py (/super-admin/v1/models/*):
  * the use-case catalog (constants/model_use_cases.py) merged with the
    `ai_model_defaults` rows, the model registry and the gateway route map;
  * single and bulk edits of `ai_model_defaults` rows;
  * the video per-stage matrix (`ai_model_stage_assignments`);
  * the audit trail `ai_model_change_log` (admin_core Flyway) — every write
    records old/new values, the reason and the actor. Writes refuse with 503
    while that table is missing (ai_service deployed before admin_core).

Every write busts this pod's resolver cache; the other replica picks the
change up within model_selection.CACHE_TTL_SECONDS (30 s).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..constants.model_defaults import GLM_DEFAULT, NON_GLM_FALLBACK
from ..constants.model_use_cases import (
    DEFAULT_ONLY_IN_BULK,
    USE_CASES,
    USE_CASE_CATALOG,
    get_use_case,
    held_reason,
    is_chat_use_case,
    uncatalogued_entry,
)

logger = logging.getLogger(__name__)

CHANGE_LOG_TABLE = "ai_model_change_log"
DEFAULTS_TABLE = "ai_model_defaults"
STAGES_TABLE = "ai_model_stage_assignments"

# Registry categories that are not chat LLMs (mirrors the portal's isChatModel).
NON_CHAT_CATEGORIES = frozenset({"image", "video", "embedding", "tts"})
TIER_ORDER = ("free", "standard", "premium", "ultra", "super_ultra")
DEFAULT_FIELDS = ("default_model_id", "fallback_model_id", "free_tier_model_id")


class ModelAdminError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


# ── small helpers ───────────────────────────────────────────────────────────

def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _price(value: Any) -> Optional[str]:
    return None if value is None else str(value)


def _json_value(value: Any) -> Any:
    if isinstance(value, (str, bytes)):
        try:
            return json.loads(value)
        except Exception:  # noqa: BLE001
            return value
    return value


def _require_reason(reason: Optional[str]) -> str:
    reason = (reason or "").strip()
    if not reason:
        raise ModelAdminError(422, "reason is required: say why this model changes")
    return reason


def _bust_cache(use_case: Optional[str] = None) -> None:
    try:
        from .model_selection import invalidate_cache
        invalidate_cache(use_case)
    except Exception:  # noqa: BLE001
        logger.warning("could not invalidate the model resolver cache", exc_info=True)


def change_log_available(db: Session) -> bool:
    try:
        return bool(db.execute(text("SELECT to_regclass(:t) IS NOT NULL"), {"t": CHANGE_LOG_TABLE}).scalar())
    except Exception:  # noqa: BLE001
        logger.warning("could not check for %s", CHANGE_LOG_TABLE, exc_info=True)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return False


def _require_change_log(db: Session) -> None:
    if not change_log_available(db):
        raise ModelAdminError(
            503,
            f"{CHANGE_LOG_TABLE} table is missing: deploy admin_core (its Flyway migration creates it) "
            "before changing models from the portal",
        )


def _log_change(db: Session, table_name: str, row_key: str, old: Optional[dict], new: Optional[dict],
                reason: str, actor: Optional[str]) -> None:
    db.execute(text(
        "INSERT INTO ai_model_change_log (table_name, row_key, old_value, new_value, reason, actor) "
        "VALUES (:table_name, :row_key, CAST(:old_value AS JSONB), CAST(:new_value AS JSONB), :reason, :actor)"
    ), {
        "table_name": table_name, "row_key": row_key,
        "old_value": json.dumps(old) if old is not None else None,
        "new_value": json.dumps(new) if new is not None else None,
        "reason": reason, "actor": actor,
    })


def _commit_or_503(db: Session) -> None:
    try:
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("model change commit failed: %s", exc)
        raise ModelAdminError(503, f"could not save the change: {exc}") from exc


# ── reads ───────────────────────────────────────────────────────────────────

def _default_rows(db: Session) -> Dict[str, Dict[str, Any]]:
    rows = db.execute(text(
        "SELECT use_case, default_model_id, fallback_model_id, free_tier_model_id, updated_at "
        "FROM ai_model_defaults"
    )).fetchall()
    return {r.use_case: _row_dict(r) for r in rows}


def _default_row(db: Session, use_case: str) -> Optional[Dict[str, Any]]:
    r = db.execute(text(
        "SELECT use_case, default_model_id, fallback_model_id, free_tier_model_id, updated_at "
        "FROM ai_model_defaults WHERE use_case = :uc"
    ), {"uc": use_case}).fetchone()
    return _row_dict(r) if r else None


def _row_dict(r) -> Dict[str, Any]:
    return {
        "default_model_id": r.default_model_id,
        "fallback_model_id": r.fallback_model_id,
        "free_tier_model_id": r.free_tier_model_id,
        "updated_at": _iso(r.updated_at),
    }


def _model_options(db: Session) -> List[Dict[str, Any]]:
    rows = db.execute(text(
        "SELECT model_id, name, provider, category, input_price_per_1m, output_price_per_1m, is_active "
        "FROM ai_models ORDER BY display_order, name"
    )).fetchall()
    return [{
        "model_id": r.model_id, "name": r.name, "provider": r.provider, "category": r.category,
        "input_price_per_1m": _price(r.input_price_per_1m),
        "output_price_per_1m": _price(r.output_price_per_1m),
        "is_active": bool(r.is_active),
    } for r in rows]


def _entry_from_change_row(r) -> Dict[str, Any]:
    return {
        "id": str(r.id), "table_name": r.table_name, "row_key": r.row_key,
        "old_value": _json_value(r.old_value), "new_value": _json_value(r.new_value),
        "reason": r.reason, "actor": r.actor, "created_at": _iso(r.created_at),
    }


def _last_changes(db: Session, use_case: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
    """Latest ai_model_defaults change per use case; {} while the table is missing."""
    if not change_log_available(db):
        return {}
    where = "WHERE table_name = 'ai_model_defaults'" + (" AND row_key = :uc" if use_case else "")
    try:
        rows = db.execute(text(
            "SELECT DISTINCT ON (row_key) id, table_name, row_key, old_value, new_value, reason, actor, created_at "
            f"FROM ai_model_change_log {where} ORDER BY row_key, created_at DESC"
        ), {"uc": use_case} if use_case else {}).fetchall()
    except Exception:  # noqa: BLE001
        logger.warning("could not read %s", CHANGE_LOG_TABLE, exc_info=True)
        db.rollback()
        return {}
    return {r.row_key: _entry_from_change_row(r) for r in rows}


def _routes() -> Dict[str, str]:
    try:
        from .llm_router import model_routes
        return {model_id: entry["router"] for model_id, entry in model_routes().items()}
    except Exception:  # noqa: BLE001
        logger.warning("could not read llm.model_routes", exc_info=True)
        return {}


def _use_case_entry(use_case: str, row: Optional[Dict[str, Any]], last: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    meta = get_use_case(use_case)
    entry = meta.to_dict() if meta else uncatalogued_entry(use_case)
    entry["row"] = row
    entry["last_change"] = last
    return entry


def catalog(db: Session) -> Dict[str, Any]:
    rows = _default_rows(db)
    last = _last_changes(db)
    keys = [u.use_case for u in USE_CASES] + sorted(k for k in rows if k not in USE_CASE_CATALOG)
    platform_row = rows.get("platform_default")
    return {
        "use_cases": [_use_case_entry(k, rows.get(k), last.get(k)) for k in keys],
        "models": _model_options(db),
        "routes": _routes(),
        "platform_default_model": (platform_row or {}).get("default_model_id") or GLM_DEFAULT,
    }


def use_case_entry(db: Session, use_case: str) -> Dict[str, Any]:
    return _use_case_entry(use_case, _default_row(db, use_case), _last_changes(db, use_case).get(use_case))


# ── validation ──────────────────────────────────────────────────────────────

def _validate_model(db: Session, model_id: Optional[str], *, chat: bool, field: str) -> str:
    model_id = (model_id or "").strip()
    if not model_id:
        raise ModelAdminError(422, f"{field} must be a model id")
    r = db.execute(text(
        "SELECT model_id, is_active, category FROM ai_models WHERE model_id = :m"
    ), {"m": model_id}).fetchone()
    if not r:
        raise ModelAdminError(422, f"{field}: unknown model '{model_id}' (not in ai_models)")
    if not r.is_active:
        raise ModelAdminError(422, f"{field}: model '{model_id}' is not active")
    if chat and (r.category or "").lower() in NON_CHAT_CATEGORIES:
        raise ModelAdminError(422, f"{field}: '{model_id}' is a {r.category} model, not a chat model")
    return model_id


# ── single use case ─────────────────────────────────────────────────────────

def update_use_case(db: Session, use_case: str, changes: Dict[str, Optional[str]], reason: Optional[str],
                    actor: Optional[str]) -> Dict[str, Any]:
    """PATCH semantics: only keys present in `changes` change; an explicit None
    clears fallback/free tier. Creates the row when missing (default required)."""
    reason = _require_reason(reason)
    changes = {k: v for k, v in changes.items() if k in DEFAULT_FIELDS}
    if not changes:
        raise ModelAdminError(422, "nothing to change: send default_model_id, fallback_model_id or free_tier_model_id")
    if "default_model_id" in changes and not changes["default_model_id"]:
        raise ModelAdminError(422, "default_model_id cannot be cleared")

    row = _default_row(db, use_case)
    if row is None:
        if use_case not in USE_CASE_CATALOG:
            raise ModelAdminError(404, f"Unknown use case '{use_case}'")
        if not changes.get("default_model_id"):
            raise ModelAdminError(422, f"'{use_case}' has no row yet: default_model_id is required to create it")

    chat = is_chat_use_case(use_case)
    for field, value in changes.items():
        if value is not None:
            changes[field] = _validate_model(db, value, chat=chat, field=field)

    old = {f: (row or {}).get(f) for f in DEFAULT_FIELDS} if row else None
    new = {f: (changes[f] if f in changes else (row or {}).get(f)) for f in DEFAULT_FIELDS}
    if old == new:
        return use_case_entry(db, use_case)

    _require_change_log(db)
    if row is None:
        meta = get_use_case(use_case)
        db.execute(text(
            "INSERT INTO ai_model_defaults (use_case, default_model_id, fallback_model_id, free_tier_model_id, "
            "description, created_at, updated_at) VALUES (:uc, :d, :f, :ft, :desc, now(), now())"
        ), {"uc": use_case, "d": new["default_model_id"], "f": new["fallback_model_id"],
            "ft": new["free_tier_model_id"], "desc": meta.label if meta else None})
    else:
        sets = ", ".join(f"{f} = :{f}" for f in changes)
        db.execute(text(f"UPDATE ai_model_defaults SET {sets}, updated_at = now() WHERE use_case = :uc"),
                   {**changes, "uc": use_case})
    _log_change(db, DEFAULTS_TABLE, use_case, old, new, reason, actor)
    _commit_or_503(db)
    _bust_cache(use_case)
    logger.info("model default %s changed by %s: %s -> %s (%s)", use_case, actor, old, new, reason)
    return use_case_entry(db, use_case)


# ── bulk ────────────────────────────────────────────────────────────────────

_UNSET = object()


def bulk_set_defaults(db: Session, model_id: str, fallback_model_id: Any = _UNSET,
                      use_cases: Optional[Sequence[str]] = None, dry_run: bool = True,
                      reason: Optional[str] = None, actor: Optional[str] = None) -> Dict[str, Any]:
    """Set `model_id` as the default of many use cases (and the fallback when
    `fallback_model_id` is passed — None clears it). Held and non-chat use
    cases are skipped and reported; `analytics` only gets its default."""
    reason = _require_reason(reason)
    model_id = _validate_model(db, model_id, chat=True, field="model_id")
    touch_fallback = fallback_model_id is not _UNSET
    if touch_fallback and fallback_model_id is not None:
        fallback_model_id = _validate_model(db, fallback_model_id, chat=True, field="fallback_model_id")

    rows = _default_rows(db)
    if use_cases is None:
        candidates = [u.use_case for u in USE_CASES] + sorted(k for k in rows if k not in USE_CASE_CATALOG)
    else:
        candidates = []
        for uc in use_cases:
            if uc not in USE_CASE_CATALOG and uc not in rows:
                raise ModelAdminError(422, f"Unknown use case '{uc}'")
            if uc not in candidates:
                candidates.append(uc)

    held: List[Dict[str, str]] = []
    changes: List[Dict[str, Any]] = []
    plan: List[Tuple[str, Optional[Dict[str, Any]], Dict[str, Any]]] = []
    for uc in candidates:
        why = held_reason(uc)
        if why is None and not is_chat_use_case(uc):
            why = "Not a chat LLM"
        if why:
            held.append({"use_case": uc, "reason": why})
            continue
        row = rows.get(uc)
        old = {f: row.get(f) for f in DEFAULT_FIELDS} if row else None
        new = dict(old) if old else {f: None for f in DEFAULT_FIELDS}
        new["default_model_id"] = model_id
        if uc not in DEFAULT_ONLY_IN_BULK:
            if touch_fallback:
                new["fallback_model_id"] = fallback_model_id
            elif row is None:
                new["fallback_model_id"] = NON_GLM_FALLBACK if model_id != NON_GLM_FALLBACK else None
        if new == old:
            continue
        for f in DEFAULT_FIELDS:
            before = old.get(f) if old else None
            if new[f] != before:
                changes.append({"use_case": uc, "field": f, "old": before, "new": new[f]})
        plan.append((uc, old, new))

    if dry_run or not plan:
        return {"changes": changes, "held": held, "applied": (not dry_run)}

    _require_change_log(db)
    for uc, old, new in plan:
        if old is None:
            meta = get_use_case(uc)
            db.execute(text(
                "INSERT INTO ai_model_defaults (use_case, default_model_id, fallback_model_id, free_tier_model_id, "
                "description, created_at, updated_at) VALUES (:uc, :d, :f, :ft, :desc, now(), now()) "
                "ON CONFLICT (use_case) DO UPDATE SET default_model_id = EXCLUDED.default_model_id, "
                "fallback_model_id = EXCLUDED.fallback_model_id, updated_at = now()"
            ), {"uc": uc, "d": new["default_model_id"], "f": new["fallback_model_id"],
                "ft": new["free_tier_model_id"], "desc": meta.label if meta else None})
        else:
            db.execute(text(
                "UPDATE ai_model_defaults SET default_model_id = :d, fallback_model_id = :f, updated_at = now() "
                "WHERE use_case = :uc"
            ), {"uc": uc, "d": new["default_model_id"], "f": new["fallback_model_id"]})
        _log_change(db, DEFAULTS_TABLE, uc, old, new, reason, actor)
    _commit_or_503(db)
    _bust_cache()
    logger.info("bulk model default %s (fallback %s) set by %s on %d use case(s) (%s)",
                model_id, fallback_model_id if touch_fallback else "unchanged", actor, len(plan), reason)
    return {"changes": changes, "held": held, "applied": True}


# ── video stage matrix ──────────────────────────────────────────────────────

def _stage_label(stage_id: str) -> str:
    return (stage_id or "").replace("_", " ").strip().capitalize()


def _tier_rank(tier: str) -> Tuple[int, str]:
    return (TIER_ORDER.index(tier) if tier in TIER_ORDER else len(TIER_ORDER), tier)


def _stage_rows(db: Session, use_case: str):
    return db.execute(text(
        "SELECT stage_id, quality_tier, model_id, fallback_model_id, user_overridable, is_active, updated_at "
        "FROM ai_model_stage_assignments WHERE use_case = :uc ORDER BY stage_id, quality_tier"
    ), {"uc": use_case}).fetchall()


def list_stages(db: Session, use_case: str = "video") -> Dict[str, Any]:
    rows = _stage_rows(db, use_case)
    stages = [{
        "stage_id": r.stage_id, "label": _stage_label(r.stage_id), "quality_tier": r.quality_tier,
        "model_id": r.model_id, "fallback_model_id": r.fallback_model_id,
        "user_overridable": bool(r.user_overridable), "is_active": bool(r.is_active),
        "updated_at": _iso(r.updated_at),
    } for r in rows]
    tiers = sorted({r.quality_tier for r in rows}, key=_tier_rank)
    return {"stages": stages, "tiers": tiers}


def _stage_key(use_case: str, tier: str, stage_id: str) -> str:
    return f"{use_case}/{tier}/{stage_id}"


def _stage_snapshot(r) -> Dict[str, Any]:
    return {"model_id": r.model_id, "fallback_model_id": r.fallback_model_id}


def _apply_stage_changes(db: Session, use_case: str, targets, model_id: str, reason: str,
                         actor: Optional[str]) -> int:
    _require_change_log(db)
    for r in targets:
        db.execute(text(
            "UPDATE ai_model_stage_assignments SET model_id = :m, updated_at = now() "
            "WHERE use_case = :uc AND quality_tier = :tier AND stage_id = :stage"
        ), {"m": model_id, "uc": use_case, "tier": r.quality_tier, "stage": r.stage_id})
        _log_change(db, STAGES_TABLE, _stage_key(use_case, r.quality_tier, r.stage_id),
                    _stage_snapshot(r), {"model_id": model_id, "fallback_model_id": r.fallback_model_id},
                    reason, actor)
    _commit_or_503(db)
    return len(targets)


def update_stage(db: Session, use_case: str, stage_id: str, quality_tiers: Iterable[str], model_id: str,
                 reason: Optional[str], actor: Optional[str]) -> Dict[str, Any]:
    reason = _require_reason(reason)
    tiers = [t for t in (quality_tiers or []) if t]
    if not tiers:
        raise ModelAdminError(422, "quality_tiers is required ('*' = every tier)")
    model_id = _validate_model(db, model_id, chat=True, field="model_id")
    every = "*" in tiers
    rows = [r for r in _stage_rows(db, use_case)
            if r.stage_id == stage_id and (every or r.quality_tier in tiers)]
    if not rows:
        raise ModelAdminError(404, f"No stage rows for {use_case}/{stage_id} in tiers {', '.join(tiers)}")
    targets = [r for r in rows if r.model_id != model_id]
    if not targets:
        return {"updated": 0}
    updated = _apply_stage_changes(db, use_case, targets, model_id, reason, actor)
    logger.info("video stage %s/%s -> %s on %d tier(s) by %s (%s)", use_case, stage_id, model_id, updated, actor, reason)
    return {"updated": updated}


def bulk_set_stages(db: Session, use_case: str, model_id: str, dry_run: bool = True,
                    reason: Optional[str] = None, actor: Optional[str] = None) -> Dict[str, Any]:
    reason = _require_reason(reason)
    model_id = _validate_model(db, model_id, chat=True, field="model_id")
    targets = [r for r in _stage_rows(db, use_case) if r.model_id != model_id]
    changes = [{"quality_tier": r.quality_tier, "stage_id": r.stage_id, "old": r.model_id, "new": model_id}
               for r in targets]
    if dry_run or not targets:
        return {"changes": changes, "applied": not dry_run}
    _apply_stage_changes(db, use_case, targets, model_id, reason, actor)
    logger.info("bulk video stages %s -> %s on %d row(s) by %s (%s)", use_case, model_id, len(targets), actor, reason)
    return {"changes": changes, "applied": True}


# ── change log + overrides ──────────────────────────────────────────────────

def change_log(db: Session, limit: int = 50, use_case: Optional[str] = None) -> Dict[str, Any]:
    if not change_log_available(db):
        raise ModelAdminError(503, f"{CHANGE_LOG_TABLE} table is missing: deploy admin_core (its Flyway migration creates it)")
    params: Dict[str, Any] = {"limit": int(limit)}
    where = ""
    if use_case:
        where = "WHERE row_key = :uc OR row_key LIKE :uc_prefix"
        params.update(uc=use_case, uc_prefix=use_case.replace("%", r"\%").replace("_", r"\_") + "/%")
    rows = db.execute(text(
        "SELECT id, table_name, row_key, old_value, new_value, reason, actor, created_at "
        f"FROM ai_model_change_log {where} ORDER BY created_at DESC LIMIT :limit"
    ), params).fetchall()
    return {"entries": [_entry_from_change_row(r) for r in rows]}


def overrides(db: Session) -> Dict[str, Any]:
    """Institute/user default models on ai_api_keys. Never reads the key
    columns out: has_own_key is computed in SQL."""
    rows = db.execute(text(
        "SELECT id, institute_id, user_id, default_model, "
        "(COALESCE(openai_key, '') <> '' OR COALESCE(gemini_key, '') <> '') AS has_own_key "
        "FROM ai_api_keys "
        "WHERE is_active = TRUE AND default_model IS NOT NULL AND default_model <> '' "
        "ORDER BY updated_at DESC"
    )).fetchall()
    return {"api_key_defaults": [{
        "id": str(r.id),
        "institute_id": str(r.institute_id) if r.institute_id else None,
        "user_id": str(r.user_id) if r.user_id else None,
        "default_model": r.default_model,
        "has_own_key": bool(r.has_own_key),
    } for r in rows]}


__all__ = [
    "ModelAdminError", "catalog", "use_case_entry", "update_use_case", "bulk_set_defaults",
    "list_stages", "update_stage", "bulk_set_stages", "change_log", "overrides",
    "change_log_available", "NON_CHAT_CATEGORIES",
]
