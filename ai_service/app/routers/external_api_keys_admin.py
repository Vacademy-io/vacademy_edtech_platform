"""
Super Admin — which vendor account each API key belongs to (/super-admin/v1/external-apis).

Platform staff only (SUPER_ADMIN_USER_IDS), the same gate as routers/super_admin.py. Responses
carry a key's last four characters at most, never the key. See services/external_api_keys.py.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Mapping, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..core.security import get_current_user
from ..db import db_dependency
from ..schemas.auth import CustomUserDetails
from ..services import external_api_keys as keys
from ..services import vendor_balances as balances
from ..services.external_api_log import AUTO_CAPTURE_SETTING
from ..services.platform_settings_service import get_platform_setting, set_platform_setting
from .super_admin import _require_super_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/super-admin/v1/external-apis", tags=["Super Admin — external API keys"])

INSTITUTE_ROW_LIMIT = 500

# Each institute's own credentials: the account is that institute's by construction.
_INSTITUTE_KEY_QUERIES = {
    "stored_llm_keys": """
        SELECT 'BYO LLM key' AS vendor, 'ai_api_keys' AS credential, k.institute_id::text AS institute_id,
               i.name AS institute_name, NULL AS account_ref
        FROM ai_api_keys k LEFT JOIN institutes i ON i.id = k.institute_id::text
        WHERE k.institute_id IS NOT NULL AND (k.openai_key IS NOT NULL OR k.gemini_key IS NOT NULL)
        LIMIT :limit
    """,
    "payment_gateways": """
        SELECT m.vendor, 'institute_payment_gateway_mapping' AS credential, m.institute_id,
               i.name AS institute_name, NULL AS account_ref
        FROM institute_payment_gateway_mapping m LEFT JOIN institutes i ON i.id = m.institute_id
        WHERE m.status = 'ACTIVE'
        ORDER BY m.vendor
        LIMIT :limit
    """,
    "telephony": """
        SELECT c.provider_type AS vendor, 'institute_telephony_config' AS credential, c.institute_id,
               i.name AS institute_name, c.api_account_id AS account_ref
        FROM institute_telephony_config c LEFT JOIN institutes i ON i.id = c.institute_id
        ORDER BY c.provider_type
        LIMIT :limit
    """,
}


class OpenRouterCheck(BaseModel):
    key_hint: str = Field(..., min_length=4, max_length=4)


class KeyDetailsUpdate(BaseModel):
    details_key: str = Field(..., max_length=300)
    account: Optional[str] = None
    price: Optional[float] = None
    price_unit: Optional[str] = None
    currency: Optional[str] = None
    notes: Optional[str] = None


def _stored_key_rows(db: Session, details: Mapping[str, Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """Keys in llm_provider_keys, whose org_label records the vendor account."""
    try:
        rows = db.execute(text(
            "SELECT provider, label, org_label, key_hint, status FROM llm_provider_keys ORDER BY provider, created_at"
        )).fetchall()
    except Exception:  # noqa: BLE001
        logger.warning("could not read llm_provider_keys", exc_info=True)
        db.rollback()
        return []
    return [
        keys.key_row(
            vendor=r.provider,
            credential=f"{keys.STORED_KEYS_CREDENTIAL}: {r.label}",
            service="ai",
            configured=r.status == "active",
            hint=r.key_hint,
            entry=keys.resolve_details(details, keys.STORED_KEYS_CREDENTIAL, r.key_hint),
            stored_owner=r.org_label,
            details_credential=keys.STORED_KEYS_CREDENTIAL,
        )
        for r in rows
    ]


def _all_key_rows(db: Session, details: Mapping[str, Mapping[str, Any]]) -> List[Dict[str, Any]]:
    return _stored_key_rows(db, details) + keys.platform_key_rows(os.environ, details)


def _institute_key_rows(db: Session) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for name, sql in _INSTITUTE_KEY_QUERIES.items():
        try:
            rows = db.execute(text(sql), {"limit": INSTITUTE_ROW_LIMIT}).fetchall()
        except Exception:  # noqa: BLE001
            logger.warning("could not read institute keys: %s", name, exc_info=True)
            db.rollback()
            continue
        result.extend(dict(r._mapping) for r in rows)
    return result


@router.get("/key-accounts", summary="Platform and institute API keys with their known owner (never the key)")
def key_accounts(
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    details = keys.parse_details(get_platform_setting(keys.DETAILS_SETTING, default="{}"))
    return {
        "platform_keys": _all_key_rows(db, details),
        "institute_keys": _institute_key_rows(db),
        "price_units": keys.PRICE_UNITS,
        "currencies": keys.CURRENCIES,
    }


@router.get("/vendors", summary="Every vendor that has logged a call, with its usage in this window")
def logged_vendors(
    hours: int = Query(24, ge=1, le=720),
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    """Consolidated view of external_api_vendor: a vendor is here from its first logged call."""
    _require_super_admin(current_user)
    auto_capture = get_platform_setting(AUTO_CAPTURE_SETTING, default=False) is True
    # Created by admin_core's Flyway, which may deploy after this service.
    if not db.execute(text("SELECT to_regclass('external_api_vendor') IS NOT NULL")).scalar():
        return {"vendors": [], "auto_capture": auto_capture, "tables_ready": False}
    rows = db.execute(text("""
        SELECT v.vendor, v.source_service, v.first_seen_at, v.last_seen_at,
               COUNT(l.id) AS calls,
               COUNT(l.id) FILTER (WHERE l.status = 'FAILED') AS failed_calls
        FROM external_api_vendor v
        LEFT JOIN external_api_call_log l
               ON l.vendor = v.vendor AND l.occurred_at > now() - make_interval(hours => CAST(:hours AS int))
        GROUP BY v.vendor, v.source_service, v.first_seen_at, v.last_seen_at
        ORDER BY v.last_seen_at DESC
    """), {"hours": hours}).fetchall()
    return {
        "vendors": [dict(r._mapping) for r in rows],
        "auto_capture": auto_capture,
        "tables_ready": True,
    }


@router.put("/key-accounts/details", summary="Save the account, price and notes staff know for one key")
def save_key_details(
    body: KeyDetailsUpdate,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    # Straight from the table and locked, not the ~30s cache: one key's save must not
    # write back a stale copy and undo another key's save.
    row = db.execute(
        text("SELECT setting_value FROM ai_platform_settings WHERE setting_key = :k FOR UPDATE"),
        {"k": keys.DETAILS_SETTING},
    ).fetchone()
    details = keys.parse_details(row[0]) if row else {}
    if body.details_key not in {r["details_key"] for r in _all_key_rows(db, details)}:
        raise HTTPException(status_code=404, detail="Unknown key")
    try:
        entry = keys.clean_details(
            account=body.account,
            price=body.price,
            price_unit=body.price_unit,
            currency=body.currency,
            notes=body.notes,
            secrets=keys.configured_secrets(os.environ),
        )
        if entry:
            details[body.details_key] = entry
        else:
            details.pop(body.details_key, None)
        set_platform_setting(db, keys.DETAILS_SETTING, json.dumps(details), updated_by=current_user.user_id)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
    logger.info("External API key details for %s saved by %s", body.details_key, current_user.user_id)
    return {"details_key": body.details_key}


@router.get("/balances", summary="Live balances from the vendors that report one")
def vendor_balances(
    refresh: bool = Query(False, description="Ask the vendors again instead of using the cached result"),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    """Each key goes only to its own vendor. Cached per replica; see services/vendor_balances.py."""
    _require_super_admin(current_user)
    return {"balances": balances.balance_cache.get(refresh=refresh)}


@router.post("/key-accounts/openrouter-check", summary="Ask OpenRouter who created one of our keys")
def openrouter_check(
    body: OpenRouterCheck,
    current_user: CustomUserDetails = Depends(get_current_user),
):
    """On demand only. Sends the key to OpenRouter, its issuer, and to nobody else."""
    _require_super_admin(current_user)
    api_key = keys.find_openrouter_key(body.key_hint)
    if api_key is None:
        raise HTTPException(status_code=404, detail="No OpenRouter key with that hint on this service")
    try:
        response = httpx.get(keys.OPENROUTER_KEY_URL, headers={"Authorization": f"Bearer {api_key}"}, timeout=10)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        # The exception text is left out of the response: never risk echoing a request detail.
        logger.warning("OpenRouter key check failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="OpenRouter did not answer the key check")
    logger.info("OpenRouter key check for hint %s by %s", body.key_hint, current_user.user_id)
    return keys.openrouter_identity(payload)
