"""Calls from the Site Assistant to admin_core.

Internal routes (SPEC §3.2) carry the HMAC-style clientName/Signature headers
(services/internal_auth.py) and are given the institute explicitly — always
the one from the session, never anything a visitor or the model supplied.
Public routes (the published catalogue by tag, a lead campaign's form
fields) are called without credentials, like the site does.

Small TTL caches (60 s) sit in front of the read-mostly calls; they are read
caches only, so several replicas each holding one is harmless.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from typing import Any, Dict, Optional, Tuple

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

INTERNAL_BASE = "/admin-core-service/internal/site-assistant/v1"
API_KEY_VERIFY = "/admin-core-service/internal/api-keys/v1/verify"
PUBLIC_CATALOGUE = "/admin-core-service/public/course-catalogue/v1/institute/get/by-tag"
LIVE_SESSIONS = INTERNAL_BASE + "/live-sessions"   # internal mirror of the public list (no per-IP limit)
PUBLIC_CAMPAIGN = "/admin-core-service/open/v1/audience/campaign/{iid}/{aid}"
CATALOG_PRODUCT = "catalog"
CATALOG_READ_SCOPE = "catalog:read"
TIMEOUT = 15.0
CACHE_TTL = 60.0


class AdminCoreUnavailable(RuntimeError):
    """admin_core answered 5xx or could not be reached."""


_cache: Dict[Tuple, Tuple[float, Any]] = {}
_cache_lock = threading.Lock()


def _cache_get(key: Tuple) -> Any:
    with _cache_lock:
        hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_TTL:
        return hit[1]
    return None


def _cache_put(key: Tuple, value: Any) -> None:
    with _cache_lock:
        _cache[key] = (time.monotonic(), value)
        if len(_cache) > 2000:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:500]:
                _cache.pop(k, None)


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _base() -> str:
    return get_settings().admin_core_service_base_url.rstrip("/")


async def _request(method: str, path: str, *, params: Optional[Dict[str, Any]] = None,
                   body: Any = None, internal: bool = True, timeout: float = TIMEOUT) -> Tuple[int, Any]:
    headers: Dict[str, str] = {"Accept": "application/json"}
    if internal:
        from ..services.internal_auth import internal_auth_headers
        headers = await internal_auth_headers(headers)
    if body is not None:
        headers["Content-Type"] = "application/json"
    clean = {k: v for k, v in (params or {}).items() if v not in (None, "")}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(method, _base() + path, params=clean, headers=headers,
                                        content=json.dumps(body) if body is not None else None)
    except httpx.HTTPError as exc:
        raise AdminCoreUnavailable(f"{path}: {type(exc).__name__}") from exc
    if resp.status_code >= 500:
        raise AdminCoreUnavailable(f"{path}: HTTP {resp.status_code}")
    try:
        data = resp.json() if resp.content else None
    except ValueError:
        data = None
    return resp.status_code, data


# ── site resolution and embed checks ─────────────────────────────────────

async def resolve_site(host: str, tag: Optional[str] = None) -> Optional[Dict[str, str]]:
    """Domain routing: host → {institute_id, site_tag}. A `tag` wins only if it is
    a real catalogue of the host's institute (admin_core decides)."""
    status, data = await _request("GET", f"{INTERNAL_BASE}/resolve-site", params={"host": host, "tag": tag})
    if status != 200 or not isinstance(data, dict) or not data.get("institute_id") or not data.get("site_tag"):
        return None
    return {"institute_id": str(data["institute_id"]), "site_tag": str(data["site_tag"])}


async def origin_allowed(institute_id: str, host: str) -> bool:
    status, data = await _request("GET", f"{INTERNAL_BASE}/origin-check",
                                  params={"instituteId": institute_id, "host": host})
    return status == 200 and isinstance(data, dict) and data.get("allowed") is True


async def verify_api_key(key: str, client_ip: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """A usable publishable Catalogue key → {institute_id, key_id}; None otherwise."""
    if not isinstance(key, str) or not key.startswith("vak_pub_") or len(key) > 120:
        return None
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    status, data = await _request("POST", API_KEY_VERIFY, body={"key_hash": key_hash, "client_ip": client_ip})
    if status != 200 or not isinstance(data, dict) or not data.get("institute_id"):
        return None
    products = data.get("products") or []
    scopes = data.get("scopes") or []
    if CATALOG_PRODUCT not in products:
        return None
    if scopes and CATALOG_READ_SCOPE not in scopes:
        return None
    return {"institute_id": str(data["institute_id"]), "key_id": data.get("key_id")}


# ── the published site (catalogue JSON) ──────────────────────────────────

def _parse_catalogue_json(raw: Any) -> Optional[Dict[str, Any]]:
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        val = json.loads(raw)
    except ValueError:
        try:
            from json_repair import repair_json
            val = json.loads(repair_json(raw))
        except Exception:  # noqa: BLE001
            return None
    return val if isinstance(val, dict) else None


async def published_catalogue(institute_id: str, tag: str) -> Optional[Dict[str, Any]]:
    """{catalogue: <parsed json>, raw_sha256} of the PUBLISHED site, or None (no such site)."""
    key = ("catalogue", institute_id, tag)
    hit = _cache_get(key)
    if hit is not None:
        return hit or None
    status, data = await _request("GET", PUBLIC_CATALOGUE, params={"instituteId": institute_id, "tagName": tag},
                                  internal=False)
    if status != 200 or not isinstance(data, dict):
        _cache_put(key, {})
        return None
    if data.get("institute_id") and str(data["institute_id"]) != str(institute_id):
        _cache_put(key, {})
        return None
    raw = data.get("catalogue_json")
    parsed = _parse_catalogue_json(raw)
    if parsed is None:
        _cache_put(key, {})
        return None
    out = {"catalogue": parsed, "tag": data.get("tag_name") or tag}
    _cache_put(key, out)
    return out


# ── Catalogue API views (internal mirror) ────────────────────────────────

async def _catalog(path: str, institute_id: str, params: Optional[Dict[str, Any]] = None,
                   cache: bool = False) -> Optional[Dict[str, Any]]:
    p = {"instituteId": institute_id, **(params or {})}
    key = ("catalog", path, tuple(sorted((k, str(v)) for k, v in p.items())))
    if cache:
        hit = _cache_get(key)
        if hit is not None:
            return hit or None
    status, data = await _request("GET", f"{INTERNAL_BASE}/catalog{path}", params=p)
    result = data if status == 200 and isinstance(data, dict) else None
    if cache:
        _cache_put(key, result or {})
    return result


async def catalog_site(institute_id: str) -> Optional[Dict[str, Any]]:
    return await _catalog("/site", institute_id, cache=True)


async def catalog_courses(institute_id: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return await _catalog("/courses", institute_id, params)


async def catalog_course(institute_id: str, course_id: str, language: Optional[str] = None) -> Optional[Dict[str, Any]]:
    from urllib.parse import quote
    return await _catalog(f"/courses/{quote(course_id, safe='')}", institute_id,
                          {"language": language} if language else None)


async def catalog_outline(institute_id: str, course_id: str) -> Optional[Dict[str, Any]]:
    from urllib.parse import quote
    return await _catalog(f"/courses/{quote(course_id, safe='')}/outline", institute_id)


async def catalog_learning_paths(institute_id: str) -> Optional[Dict[str, Any]]:
    return await _catalog("/learning-paths", institute_id, cache=True)


async def catalog_learning_path(institute_id: str, code: str) -> Optional[Dict[str, Any]]:
    from urllib.parse import quote
    return await _catalog(f"/learning-paths/{quote(code, safe='')}", institute_id)


async def catalog_streams(institute_id: str) -> Optional[Dict[str, Any]]:
    return await _catalog("/streams", institute_id, cache=True)


# ── live classes, campaigns, leads ───────────────────────────────────────

async def live_sessions(institute_id: str, days: int = 30, limit: int = 20) -> Optional[Dict[str, Any]]:
    key = ("live", institute_id, days, limit)
    hit = _cache_get(key)
    if hit is not None:
        return hit or None
    status, data = await _request("GET", LIVE_SESSIONS, params={"instituteId": institute_id, "days": days, "limit": limit})
    result = data if status == 200 and isinstance(data, dict) else None
    _cache_put(key, result or {})
    return result


async def campaign(institute_id: str, audience_id: str) -> Optional[Dict[str, Any]]:
    key = ("campaign", institute_id, audience_id)
    hit = _cache_get(key)
    if hit is not None:
        return hit or None
    from urllib.parse import quote
    status, data = await _request("GET", PUBLIC_CAMPAIGN.format(iid=quote(institute_id, safe=""),
                                                              aid=quote(audience_id, safe="")), internal=False)
    result = data if status == 200 and isinstance(data, dict) else None
    if result and result.get("institute_id") and str(result["institute_id"]) != str(institute_id):
        result = None
    _cache_put(key, result or {})
    return result


async def submit_lead(body: Dict[str, Any]) -> Dict[str, Any]:
    """SPEC §3.2 POST /leads → {status: received|duplicate, lead_ref}. Raises on failure."""
    status, data = await _request("POST", f"{INTERNAL_BASE}/leads", body=body)
    if status not in (200, 201) or not isinstance(data, dict) or data.get("status") not in ("received", "duplicate"):
        raise AdminCoreUnavailable(f"leads: HTTP {status}")
    return {"status": data["status"], "lead_ref": data.get("lead_ref")}
