"""Which vendor account each platform API key belongs to, and what it costs us.

Only the masked hint ever leaves this module; a key's value is never returned or logged.
An owner is only ever reported with where it came from, so the portal can say "Unknown"
instead of guessing: `stored` (a column on the key's own row) or `declared` (staff, through
the external_apis.key_details setting). Prices are always staff-entered: the code knows no
vendor's price, and an unpriced key leaves its calls' cost empty.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Mapping, Optional, Tuple

from .external_api_log import key_hint

logger = logging.getLogger(__name__)

DETAILS_SETTING = "external_apis.key_details"
OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key"
STORED_KEYS_CREDENTIAL = "llm_provider_keys"

CURRENCIES = ("USD", "INR", "EUR", "GBP")
# How a price converts to one call. The unit divisor per credit or per request; a unit not
# listed here (a monthly plan, a free-form one) gives no per-call cost.
CREDIT_UNITS = {"credit": 1, "1000_credits": 1000}
REQUEST_UNITS = {"request": 1, "1000_requests": 1000}
PRICE_UNITS = (*CREDIT_UNITS, *REQUEST_UNITS, "month", "other")

MAX_ACCOUNT_LENGTH = 200
MAX_NOTES_LENGTH = 500
MAX_PRICE = 1_000_000

# (vendor, environment variable). These are the ones this service can read.
AI_SERVICE_KEYS: Tuple[Tuple[str, str], ...] = (
    ("OpenRouter", "OPENROUTER_API_KEY"),
    ("Isoquant", "ISOQUANT_API_KEY"),
    ("OpenAI", "OPENAI_API_KEY"),
    ("Gemini", "GEMINI_API_KEY"),
    ("Sarvam", "SARVAM_API_KEY"),
    ("Smallest.ai", "SMALLEST_API_KEY"),
    ("fal.ai", "FAL_API_KEY"),
    ("RunPod", "RUNPOD_API_KEY"),
    ("Spatius", "SPATIUS_API_KEY"),
    ("Mathpix", "MATHPIX_APP_KEY"),
    ("Serper", "SERPER_API_KEYS"),
    ("Pexels", "PEXELS_API_KEYS"),
    ("Pixabay", "PIXABAY_API_KEYS"),
    ("YouTube Data", "YOUTUBE_API_KEY"),
)

# Held by other services, so this one cannot tell whether they are set. Details can still be entered.
OTHER_SERVICE_KEYS: Tuple[Tuple[str, str, str], ...] = (
    ("Cloudflare", "cloudflare.api.token", "admin-core"),
    ("Zoom", "zoom.app.client-id", "admin-core"),
    ("Google OAuth", "google.oauth.client-id", "admin-core"),
    ("Meta Lead Ads", "meta.app.id", "admin-core"),
    ("Aavtaar", "aavtaar.api.token", "admin-core"),
    ("Cashfree Secure ID", "cashfree.secureid.client-id", "admin-core"),
    ("Meta WhatsApp", "whatsapp.access-token", "notification"),
    ("AWS SES", "AWS_MAIL_USERNAME", "notification"),
    ("AWS S3", "S3_AWS_ACCESS_KEY", "media"),
    ("CloudConvert", "CLOUD_CONVERT_KEY", "media"),
)


def parse_details(raw: Any) -> Dict[str, Dict[str, Any]]:
    """The details setting as a dict. Anything unreadable counts as nothing entered."""
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        logger.warning("%s is not valid JSON; treating every key as having no details", DETAILS_SETTING)
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(k): v for k, v in parsed.items() if isinstance(v, dict)}


def details_key(credential: str, hint: Optional[str]) -> str:
    """One key by its hint when we can see one, else the whole variable."""
    return f"{credential}:{hint}" if hint and hint != "****" else credential


def resolve_details(
    details: Mapping[str, Mapping[str, Any]], credential: str, hint: Optional[str]
) -> Mapping[str, Any]:
    """This key's own entry, else its variable's, else nothing."""
    return details.get(details_key(credential, hint)) or details.get(credential) or {}


def per_call_cost(entry: Mapping[str, Any], *, credits: float = 1) -> Optional[Tuple[float, str]]:
    """(amount, currency) for one call, or None when its price says nothing about one call."""
    price, unit, currency = entry.get("price"), entry.get("price_unit"), entry.get("currency")
    if not isinstance(price, (int, float)) or price <= 0 or not currency:
        return None
    if unit in CREDIT_UNITS:
        return price / CREDIT_UNITS[unit] * credits, currency
    if unit in REQUEST_UNITS:
        return price / REQUEST_UNITS[unit], currency
    return None


def clean_details(
    *,
    account: Optional[str],
    price: Optional[float],
    price_unit: Optional[str],
    currency: Optional[str],
    notes: Optional[str],
    secrets: List[str],
) -> Dict[str, Any]:
    """A validated entry, empty when nothing was filled in. Raises ValueError with a message for the form."""
    account = (account or "").strip()
    notes = (notes or "").strip()
    if len(account) > MAX_ACCOUNT_LENGTH:
        raise ValueError(f"Account must be at most {MAX_ACCOUNT_LENGTH} characters")
    if len(notes) > MAX_NOTES_LENGTH:
        raise ValueError(f"Notes must be at most {MAX_NOTES_LENGTH} characters")
    if any(secret and secret in text for secret in secrets for text in (account, notes)):
        raise ValueError("That looks like the API key itself. Enter the account name instead")
    entry: Dict[str, Any] = {}
    if account:
        entry["account"] = account
    if notes:
        entry["notes"] = notes
    if price is not None:
        if not 0 <= price <= MAX_PRICE:
            raise ValueError(f"Price must be between 0 and {MAX_PRICE}")
        if price_unit not in PRICE_UNITS:
            raise ValueError("Choose what the price is per")
        if currency not in CURRENCIES:
            raise ValueError("Choose a currency")
        entry.update(price=price, price_unit=price_unit, currency=currency)
    return entry


def configured_secrets(env: Mapping[str, str]) -> List[str]:
    """Every key value this service holds, so a pasted key can be refused."""
    return [key for _, name in AI_SERVICE_KEYS for key in _split_keys(env.get(name))]


def _split_keys(raw: Optional[str]) -> List[str]:
    return [k.strip() for k in (raw or "").split(",") if k.strip()]


def _detail_fields(entry: Mapping[str, Any]) -> Dict[str, Any]:
    return {
        "price": entry.get("price"),
        "price_unit": entry.get("price_unit"),
        "currency": entry.get("currency"),
        "notes": entry.get("notes"),
    }


def key_row(
    *,
    vendor: str,
    credential: str,
    service: str,
    configured: Optional[bool],
    hint: Optional[str],
    entry: Mapping[str, Any],
    stored_owner: Optional[str] = None,
    details_credential: Optional[str] = None,
) -> Dict[str, Any]:
    """One row for the portal. An owner recorded on the key outranks one entered by staff."""
    owner = stored_owner or entry.get("account")
    source = "stored" if stored_owner else ("declared" if owner else "unknown")
    return {
        "vendor": vendor,
        "credential": credential,
        "service": service,
        "configured": configured,
        "key_hint": hint,
        "details_key": details_key(details_credential or credential, hint),
        "owner": owner,
        "owner_source": source,
        **_detail_fields(entry),
    }


def platform_key_rows(env: Mapping[str, str], details: Mapping[str, Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """One row per key. A variable that lists several keys gets a row for each."""
    rows: List[Dict[str, Any]] = []
    for vendor, name in AI_SERVICE_KEYS:
        keys = _split_keys(env.get(name))
        for key in keys or [None]:
            hint = key_hint(key)
            rows.append(key_row(
                vendor=vendor, credential=name, service="ai", configured=key is not None, hint=hint,
                entry=resolve_details(details, name, hint),
            ))
    for vendor, name, service in OTHER_SERVICE_KEYS:
        rows.append(key_row(
            vendor=vendor, credential=name, service=service, configured=None, hint=None,
            entry=resolve_details(details, name, None),
        ))
    return rows


def find_openrouter_key(hint: str, env: Optional[Mapping[str, str]] = None) -> Optional[str]:
    """The OpenRouter key with this hint. Only for asking OpenRouter about that same key."""
    source = os.environ if env is None else env
    return next((k for k in _split_keys(source.get("OPENROUTER_API_KEY")) if key_hint(k) == hint), None)


def openrouter_identity(payload: Mapping[str, Any]) -> Dict[str, Any]:
    """The fields of OpenRouter's key response worth showing. `label` is left out: it echoes the key."""
    data = payload.get("data") or {}
    return {
        "creator_user_id": data.get("creator_user_id"),
        "limit": data.get("limit"),
        "limit_remaining": data.get("limit_remaining"),
        "usage_monthly": data.get("usage_monthly"),
        "is_free_tier": data.get("is_free_tier"),
    }


__all__ = [
    "CURRENCIES",
    "DETAILS_SETTING",
    "OPENROUTER_KEY_URL",
    "PRICE_UNITS",
    "STORED_KEYS_CREDENTIAL",
    "clean_details",
    "configured_secrets",
    "details_key",
    "find_openrouter_key",
    "key_row",
    "openrouter_identity",
    "parse_details",
    "per_call_cost",
    "platform_key_rows",
    "resolve_details",
]
