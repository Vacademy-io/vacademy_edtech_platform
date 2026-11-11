"""Live balances from the vendors that report one, for the keys this service holds.

Only vendors whose own API returns the balance are here, so every figure is the vendor's,
never an estimate. Each key is sent only to the vendor that issued it. A row carries the
key's last four characters at most, and an error says what went wrong without echoing the
request or the vendor's body.

Results are cached for CACHE_SECONDS so the portal does not call the vendors on every view;
a forced refresh is allowed at most once per MIN_REFRESH_SECONDS.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Mapping, Optional

import httpx

from .external_api_log import key_hint

logger = logging.getLogger(__name__)

OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits"
OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key"
FAL_BILLING_URL = "https://api.fal.ai/v1/account/billing"
RUNPOD_GRAPHQL_URL = "https://api.runpod.io/graphql"

CACHE_SECONDS = 600
MIN_REFRESH_SECONDS = 30
TIMEOUT_SECONDS = 10

# kind: what the figure is. An account balance is money left with the vendor; a key limit is
# what one key may still spend under the cap set on it, which can be less than the account has.
ACCOUNT_BALANCE = "account_balance"
KEY_LIMIT = "key_limit"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(vendor: str, account: Optional[str], **fields: Any) -> Dict[str, Any]:
    row = {
        "vendor": vendor,
        "account": account,
        "institute_id": None,
        "institute_name": None,
        "status": "ok",
        "kind": ACCOUNT_BALANCE,
        "balance": None,
        "currency": None,
        "spend_per_hour": None,
        "message": None,
        "checked_at": _now(),
    }
    row.update(fields)
    return row


def _not_set_up(vendor: str, message: str) -> Dict[str, Any]:
    return _row(vendor, None, status="not_set_up", message=message)


def _error(vendor: str, account: Optional[str], message: str) -> Dict[str, Any]:
    return _row(vendor, account, status="error", message=message)


def _http_error_message(vendor: str, exc: Exception) -> str:
    """What failed, in words. The exception text is left out: it can carry the request URL."""
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403):
            return f"{vendor} refused this key for balance reads (HTTP {code})"
        if code == 429:
            return f"{vendor} rate limited the balance check (HTTP 429)"
        return f"{vendor} answered HTTP {code}"
    if isinstance(exc, httpx.TimeoutException):
        return f"{vendor} did not answer within {TIMEOUT_SECONDS}s"
    if isinstance(exc, httpx.HTTPError):
        return f"Could not reach {vendor}"
    return f"{vendor} sent a response we could not read"


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _split_keys(raw: Optional[str]) -> List[str]:
    return [k.strip() for k in (raw or "").split(",") if k.strip()]


def _masked(key: str) -> str:
    return f"key …{key_hint(key)}"


# --- parsers: vendor response -> row fields. Pure, so they are tested without a network. ---

def parse_openrouter_credits(payload: Mapping[str, Any]) -> Dict[str, Any]:
    data = payload.get("data") or {}
    bought, used = _number(data.get("total_credits")), _number(data.get("total_usage"))
    if bought is None or used is None:
        raise ValueError("credits response without totals")
    return {"balance": round(bought - used, 6), "currency": "USD"}


def parse_openrouter_key(payload: Mapping[str, Any]) -> Dict[str, Any]:
    """A key with a spending cap reports what is left under it. Without a cap it says nothing about money left."""
    data = payload.get("data") or {}
    remaining = _number(data.get("limit_remaining"))
    if data.get("limit") is None or remaining is None:
        return {
            "status": "not_set_up",
            "message": "This key has no spending limit, so OpenRouter does not report what is left on it. "
                       "Add OPENROUTER_MANAGEMENT_KEY to ai-service to show the account balance.",
        }
    return {"balance": remaining, "currency": "USD", "kind": KEY_LIMIT,
            "message": "Left under this key's spending limit. The account itself may hold more."}


def parse_fal_billing(payload: Mapping[str, Any]) -> Dict[str, Any]:
    credits = payload.get("credits") or {}
    balance = _number(credits.get("current_balance"))
    if balance is None:
        raise ValueError("billing response without credits")
    return {"balance": balance, "currency": str(credits.get("currency") or "USD").upper()}


def parse_runpod_myself(payload: Mapping[str, Any]) -> Dict[str, Any]:
    if payload.get("errors"):
        raise ValueError("graphql errors")
    me = (payload.get("data") or {}).get("myself") or {}
    balance = _number(me.get("clientBalance"))
    if balance is None:
        raise ValueError("myself without clientBalance")
    return {"balance": balance, "currency": "USD", "spend_per_hour": _number(me.get("currentSpendPerHr"))}


# --- fetchers ---

def _get_json(client: httpx.Client, method: str, url: str, **kwargs: Any) -> Mapping[str, Any]:
    response = client.request(method, url, timeout=TIMEOUT_SECONDS, **kwargs)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, Mapping):
        raise ValueError("response is not an object")
    return payload


def _check(vendor: str, account: Optional[str], call: Callable[[], Mapping[str, Any]],
           parse: Callable[[Mapping[str, Any]], Dict[str, Any]]) -> Dict[str, Any]:
    try:
        return _row(vendor, account, **parse(call()))
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("%s balance check failed: %s", vendor, type(exc).__name__)
        return _error(vendor, account, _http_error_message(vendor, exc))


def openrouter_rows(client: httpx.Client, env: Mapping[str, str]) -> List[Dict[str, Any]]:
    management = (env.get("OPENROUTER_MANAGEMENT_KEY") or "").strip()
    if management:
        return [_check("OpenRouter", "account", lambda: _get_json(
            client, "GET", OPENROUTER_CREDITS_URL, headers={"Authorization": f"Bearer {management}"}),
            parse_openrouter_credits)]
    keys = _split_keys(env.get("OPENROUTER_API_KEY"))
    if not keys:
        return [_not_set_up("OpenRouter", "OPENROUTER_API_KEY is not set on ai-service.")]
    return [_check("OpenRouter", _masked(k), lambda k=k: _get_json(
        client, "GET", OPENROUTER_KEY_URL, headers={"Authorization": f"Bearer {k}"}),
        parse_openrouter_key) for k in keys]


def fal_rows(client: httpx.Client, env: Mapping[str, str]) -> List[Dict[str, Any]]:
    keys = _split_keys(env.get("FAL_API_KEY"))
    if not keys:
        return [_not_set_up("fal.ai", "FAL_API_KEY is not set on ai-service.")]
    return [_check("fal.ai", _masked(k), lambda k=k: _get_json(
        client, "GET", FAL_BILLING_URL, params={"expand": "credits"}, headers={"Authorization": f"Key {k}"}),
        parse_fal_billing) for k in keys]


RUNPOD_QUERY = "query { myself { clientBalance currentSpendPerHr } }"


def runpod_rows(client: httpx.Client, env: Mapping[str, str]) -> List[Dict[str, Any]]:
    keys = _split_keys(env.get("RUNPOD_API_KEY"))
    if not keys:
        return [_not_set_up("RunPod", "RUNPOD_API_KEY is not set on ai-service.")]
    return [_check("RunPod", _masked(k), lambda k=k: _get_json(
        client, "POST", RUNPOD_GRAPHQL_URL, json={"query": RUNPOD_QUERY}, headers={"Authorization": f"Bearer {k}"}),
        parse_runpod_myself) for k in keys]


FETCHERS = (openrouter_rows, fal_rows, runpod_rows)


def fetch_all(env: Optional[Mapping[str, str]] = None, client: Optional[httpx.Client] = None) -> List[Dict[str, Any]]:
    """Every vendor checked at once, so one slow vendor does not hold up the rest beyond its timeout."""
    source = os.environ if env is None else env
    own_client = client is None
    client = client or httpx.Client()
    try:
        with ThreadPoolExecutor(max_workers=len(FETCHERS)) as pool:
            results = list(pool.map(lambda fetch: fetch(client, source), FETCHERS))
    finally:
        if own_client:
            client.close()
    return [row for rows in results for row in rows]


class BalanceCache:
    """One cached result per replica. A refresh inside MIN_REFRESH_SECONDS returns the cached rows."""

    def __init__(self, fetch: Callable[[], List[Dict[str, Any]]] = fetch_all,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._fetch, self._clock = fetch, clock
        self._lock = threading.Lock()
        self._rows: Optional[List[Dict[str, Any]]] = None
        self._at = 0.0

    def get(self, refresh: bool = False) -> List[Dict[str, Any]]:
        with self._lock:
            age = self._clock() - self._at
            stale = self._rows is None or age >= CACHE_SECONDS or (refresh and age >= MIN_REFRESH_SECONDS)
            if stale:
                self._rows = self._fetch()
                self._at = self._clock()
            return list(self._rows or [])


balance_cache = BalanceCache()

__all__ = [
    "ACCOUNT_BALANCE",
    "KEY_LIMIT",
    "BalanceCache",
    "balance_cache",
    "fetch_all",
    "parse_fal_billing",
    "parse_openrouter_credits",
    "parse_openrouter_key",
    "parse_runpod_myself",
]
