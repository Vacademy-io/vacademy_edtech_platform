"""
Super Admin — vendor API keys for direct LLM gateways (/super-admin/v1/llm/keys).

Today the only provider is Anthropic: models the route map sends to the
"anthropic" router are served with these keys (services/llm_router.py,
services/llm_providers/key_pool.py), each with a monthly budget and a soft
limit at which the pool stops using it. Platform staff only
(SUPER_ADMIN_USER_IDS), the same gate as routers/super_admin.py — fails closed.

A key is stored Fernet-encrypted and is never returned or logged: responses
carry only its last four characters (`key_hint`). Every write records the
actor (from the auth context) and the reason in ai_model_change_log (or the
log, while that table is missing). The tables come from admin_core Flyway;
before it has run, the list is empty and writes answer 503.
"""
from __future__ import annotations

import logging
import time
import uuid
from decimal import Decimal
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..core.security import get_current_user
from ..db import db_dependency
from ..schemas.auth import CustomUserDetails
from ..services.llm_providers import key_pool
from .super_admin import _require_super_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/super-admin/v1/llm", tags=["Super Admin — LLM keys"])

PROVIDERS = ("anthropic",)
KEYS_TABLE = "llm_provider_keys"
TEST_MODEL = "claude-haiku-5-5"  # cheapest current Claude model
TEST_INTERVAL_SECONDS = 10.0
_last_test: Dict[str, float] = {}

_VIEW_SQL = (
    "SELECT k.id, k.provider, k.label, k.org_label, k.key_hint, k.monthly_budget_usd, k.soft_limit_pct, "
    "k.weight, k.status, k.cooldown_until, k.exhausted_until, k.last_error, k.last_error_at, "
    "k.last_used_at, k.created_at, k.created_by, "
    "COALESCE(s.metered_usd, 0) AS metered_usd, COALESCE(s.calls, 0) AS calls, "
    "COALESCE(s.errors, 0) AS errors, COALESCE(s.input_tokens, 0) AS input_tokens, "
    "COALESCE(s.output_tokens, 0) AS output_tokens, COALESCE(s.cache_read_tokens, 0) AS cache_read_tokens, "
    "COALESCE(s.cache_write_tokens, 0) AS cache_write_tokens "
    "FROM llm_provider_keys k "
    "LEFT JOIN llm_key_spend s ON s.key_id = k.id AND s.period_month = :pm "
)


class KeyCreate(BaseModel):
    provider: str = Field("anthropic", max_length=32)
    label: str = Field(..., min_length=1, max_length=120)
    org_label: Optional[str] = Field(None, max_length=120)
    api_key: str = Field(..., min_length=8, max_length=500)
    monthly_budget_usd: float = Field(200, gt=0, le=1_000_000)
    soft_limit_pct: int = Field(95, ge=1, le=100)
    weight: int = Field(1, ge=0, le=1000)
    reason: str = Field(..., max_length=2000)


class KeyPatch(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=120)
    org_label: Optional[str] = Field(None, max_length=120)
    monthly_budget_usd: Optional[float] = Field(None, gt=0, le=1_000_000)
    soft_limit_pct: Optional[int] = Field(None, ge=1, le=100)
    weight: Optional[int] = Field(None, ge=0, le=1000)
    status: Optional[str] = Field(None, pattern="^(active|disabled)$")
    reason: str = Field(..., max_length=2000)


# ── helpers ─────────────────────────────────────────────────────────────────

def _actor(user: CustomUserDetails) -> Optional[str]:
    return str(getattr(user, "user_id", "") or "") or None


def _reason(reason: Optional[str]) -> str:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="reason is required: say why this key changes")
    return reason


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _num(value: Any) -> float:
    if isinstance(value, Decimal):
        return float(value)
    return float(value or 0)


def _tables_ready(db: Session) -> bool:
    try:
        return bool(db.execute(text("SELECT to_regclass(:t) IS NOT NULL"), {"t": KEYS_TABLE}).scalar())
    except Exception:  # noqa: BLE001
        logger.warning("could not check for %s", KEYS_TABLE, exc_info=True)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return False


def _require_tables(db: Session) -> None:
    if not _tables_ready(db):
        raise HTTPException(status_code=503, detail=(
            f"{KEYS_TABLE} table is missing: deploy admin_core (its Flyway migration creates it) first"))


def _view(row) -> Dict[str, Any]:
    return {
        "id": row.id,
        "provider": row.provider,
        "label": row.label,
        "org_label": row.org_label,
        "key_hint": row.key_hint,
        "monthly_budget_usd": _num(row.monthly_budget_usd),
        "soft_limit_pct": int(row.soft_limit_pct or 0),
        "weight": int(row.weight or 0),
        "status": row.status,
        "cooldown_until": _iso(row.cooldown_until),
        "exhausted_until": _iso(row.exhausted_until),
        "last_error": row.last_error,
        "last_error_at": _iso(row.last_error_at),
        "last_used_at": _iso(row.last_used_at),
        "created_at": _iso(row.created_at),
        "created_by": row.created_by,
        "month": {
            "metered_usd": _num(row.metered_usd),
            "calls": int(row.calls or 0),
            "errors": int(row.errors or 0),
            "input_tokens": int(row.input_tokens or 0),
            "output_tokens": int(row.output_tokens or 0),
            "cache_read_tokens": int(row.cache_read_tokens or 0),
            "cache_write_tokens": int(row.cache_write_tokens or 0),
        },
    }


def _audit(view: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """What the change log keeps of a key: settings only, never spend or secrets."""
    if view is None:
        return None
    keep = ("provider", "label", "org_label", "key_hint", "monthly_budget_usd", "soft_limit_pct", "weight",
            "status", "cooldown_until", "exhausted_until")
    return {k: view.get(k) for k in keep}


def _load_view(db: Session, key_id: str) -> Optional[Dict[str, Any]]:
    row = db.execute(text(_VIEW_SQL + "WHERE k.id = :id"),
                     {"id": key_id, "pm": key_pool.current_period()}).fetchone()
    return _view(row) if row else None


def _change_log_ready(db: Session) -> bool:
    """Checked BEFORE a write: the check rolls the session back when it fails."""
    from ..services.model_defaults_admin import change_log_available
    return change_log_available(db)


def _log_change(db: Session, log_ready: bool, key_id: str, old, new, reason: str, actor: Optional[str]) -> None:
    from ..services.model_defaults_admin import _log_change as log_row

    if log_ready:
        log_row(db, KEYS_TABLE, key_id, _audit(old), _audit(new), reason, actor)
    else:
        logger.info("LLM key change %s by %s (%s): %s -> %s", key_id, actor, reason, _audit(old), _audit(new))


def _commit(db: Session) -> None:
    try:
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("LLM key change commit failed: %s", exc)
        raise HTTPException(status_code=503, detail="could not save the change")


def _anthropic_routes() -> List[Dict[str, str]]:
    try:
        from ..services.llm_router import ANTHROPIC_ROUTER, anthropic_wire_model, model_routes
        return [{"model_id": m, "wire_model": e.get("model") or anthropic_wire_model(m)}
                for m, e in model_routes().items() if e.get("router") == ANTHROPIC_ROUTER]
    except Exception:  # noqa: BLE001
        logger.warning("could not read llm.model_routes", exc_info=True)
        return []


# ── endpoints ───────────────────────────────────────────────────────────────

@router.get("/keys", summary="Vendor API keys with this month's metered spend (never the key itself)")
def list_keys(
    provider: str = Query("anthropic", max_length=32),
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    period = key_pool.current_period()
    keys: List[Dict[str, Any]] = []
    ready = _tables_ready(db)
    if ready:
        rows = db.execute(text(_VIEW_SQL + "WHERE k.provider = :p ORDER BY k.created_at"),
                          {"p": provider, "pm": period}).fetchall()
        keys = [_view(r) for r in rows]
    return {
        "keys": keys,
        "encryption_ready": key_pool.encryption_ready(),
        "anthropic_routes": _anthropic_routes(),
        "period_month": period.isoformat(),
        "tables_ready": ready,
    }


@router.post("/keys", status_code=201, summary="Add a vendor API key (stored encrypted)")
def create_key(
    body: KeyCreate,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    reason = _reason(body.reason)
    provider = body.provider.strip().lower()
    if provider not in PROVIDERS:
        raise HTTPException(status_code=422, detail=f"provider must be one of {', '.join(PROVIDERS)}")
    api_key = body.api_key.strip()
    if any(c.isspace() for c in api_key):
        raise HTTPException(status_code=422, detail="api_key must not contain spaces or line breaks")
    if not key_pool.encryption_ready():
        raise HTTPException(status_code=503, detail=(
            "no encryption secret on ai-service: set LLM_KEY_ENCRYPTION_KEY (a value only ai-service holds, "
            "not INTERNAL_SERVICE_TOKEN or JWT_SECRET_KEY)"))
    _require_tables(db)
    log_ready = _change_log_ready(db)
    cipher = key_pool.cipher()
    existing = db.execute(text("SELECT key_ciphertext FROM llm_provider_keys WHERE provider = :p"),
                          {"p": provider}).fetchall()
    if any(cipher.decrypt(r[0]) == api_key for r in existing):
        raise HTTPException(status_code=409, detail="this key is already in the pool")

    key_id = str(uuid.uuid4())
    actor = _actor(current_user)
    db.execute(text(
        "INSERT INTO llm_provider_keys (id, provider, label, org_label, key_ciphertext, key_hint, "
        "monthly_budget_usd, soft_limit_pct, weight, status, created_by, created_at, updated_at) "
        "VALUES (:id, :p, :label, :org, :ct, :hint, :budget, :pct, :w, 'active', :by, now(), now())"
    ), {
        "id": key_id, "p": provider, "label": body.label.strip(),
        "org": (body.org_label or "").strip() or None, "ct": cipher.encrypt(api_key),
        "hint": key_pool.key_hint(api_key), "budget": body.monthly_budget_usd,
        "pct": body.soft_limit_pct, "w": body.weight, "by": actor,
    })
    view = _load_view(db, key_id)
    _log_change(db, log_ready, key_id, None, view, reason, actor)
    _commit(db)
    key_pool.invalidate(provider)
    logger.info("LLM key %s %s added by %s", provider, view["key_hint"] if view else "", actor)
    return view


@router.patch("/keys/{key_id}", summary="Change a key's label, budget, weight or status")
def update_key(
    key_id: str,
    body: KeyPatch,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    reason = _reason(body.reason)
    _require_tables(db)
    log_ready = _change_log_ready(db)
    old = _load_view(db, key_id)
    if old is None:
        raise HTTPException(status_code=404, detail="key not found")

    sets: List[str] = []
    params: Dict[str, Any] = {"id": key_id}
    fields = body.model_dump(exclude_unset=True)
    if "label" in fields and body.label is not None:
        sets.append("label = :label")
        params["label"] = body.label.strip()
    if "org_label" in fields:
        sets.append("org_label = :org")
        params["org"] = (body.org_label or "").strip() or None
    for name in ("monthly_budget_usd", "soft_limit_pct", "weight"):
        if name in fields and fields[name] is not None:
            sets.append(f"{name} = :{name}")
            params[name] = fields[name]
    if "status" in fields and body.status is not None:
        sets.append("status = :status")
        params["status"] = body.status
        if body.status == "active":
            # Re-activating clears every automatic block (auth failure, cooldown, exhausted month).
            sets += ["cooldown_until = NULL", "exhausted_until = NULL"]
    if not sets:
        raise HTTPException(status_code=422, detail="nothing to change")
    sets.append("updated_at = now()")
    db.execute(text(f"UPDATE llm_provider_keys SET {', '.join(sets)} WHERE id = :id"), params)
    new = _load_view(db, key_id)
    actor = _actor(current_user)
    _log_change(db, log_ready, key_id, old, new, reason, actor)
    _commit(db)
    if body.status == "active":
        key_pool.clear_local_state(key_id)
    key_pool.invalidate(old["provider"])
    return new


@router.post("/keys/{key_id}/test", summary="One tiny Messages call with this key")
async def test_key(
    key_id: str,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    _require_tables(db)
    now = time.monotonic()
    last = _last_test.get(key_id)
    if last is not None and now - last < TEST_INTERVAL_SECONDS:
        raise HTTPException(status_code=429, detail="wait a few seconds before testing this key again")
    row = db.execute(text("SELECT provider, key_ciphertext, key_hint FROM llm_provider_keys WHERE id = :id"),
                     {"id": key_id}).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="key not found")
    if not key_pool.encryption_ready():
        raise HTTPException(status_code=503, detail="no encryption secret on ai-service")
    api_key = key_pool.cipher().decrypt(row.key_ciphertext)
    if not api_key:
        return {"ok": False, "latency_ms": 0, "model": TEST_MODEL,
                "error": "the stored key could not be decrypted (encryption secret changed?) — add it again"}
    _last_test[key_id] = now

    from ..services.chat_llm_client import openrouter_error_text
    from ..services.llm_providers.anthropic_transport import messages_url, request_headers

    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(messages_url(), headers=request_headers(api_key), json={
                "model": TEST_MODEL, "max_tokens": 8,
                "messages": [{"role": "user", "content": "Reply with the single word: ok"}],
            })
    except httpx.HTTPError as exc:
        return {"ok": False, "latency_ms": int((time.monotonic() - started) * 1000), "model": TEST_MODEL,
                "error": f"could not reach Anthropic: {type(exc).__name__}"}
    latency = int((time.monotonic() - started) * 1000)
    if resp.status_code >= 400:
        logger.info("LLM key test %s: HTTP %s", row.key_hint, resp.status_code)
        return {"ok": False, "latency_ms": latency, "model": TEST_MODEL,
                "error": f"HTTP {resp.status_code}: {openrouter_error_text(resp.text)}"}
    return {"ok": True, "latency_ms": latency, "model": TEST_MODEL}


@router.delete("/keys/{key_id}", summary="Remove a key (and its spend history)")
def delete_key(
    key_id: str,
    reason: str = Query(..., max_length=2000),
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    why = _reason(reason)
    _require_tables(db)
    log_ready = _change_log_ready(db)
    old = _load_view(db, key_id)
    if old is None:
        raise HTTPException(status_code=404, detail="key not found")
    db.execute(text("DELETE FROM llm_provider_keys WHERE id = :id"), {"id": key_id})
    actor = _actor(current_user)
    _log_change(db, log_ready, key_id, old, None, why, actor)
    _commit(db)
    key_pool.clear_local_state(key_id)
    key_pool.invalidate(old["provider"])
    _last_test.pop(key_id, None)
    logger.info("LLM key %s %s deleted by %s", old["provider"], old["key_hint"], actor)
    return {"deleted": True}


__all__ = ["router"]
