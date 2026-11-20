"""The demo user's sign-in for the framed app.

ai_service signs the read-only demo user in ONCE per process (per demo
institute) with DEMO_GUIDE_APP_USER / DEMO_GUIDE_APP_PASSWORD and hands the
same tokens to every visitor for 6 hours. It never signs in per visitor:
each sign-in revokes that user's earlier refresh tokens, so a second sign-in
would log out everyone already in the demo.

A failed sign-in is not retried for a minute, and the session opens without
the app (``app: null``).
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Dict, Optional, Tuple

import httpx

from ..config import get_settings
from .settings import APP_SIGN_IN_TTL_SECONDS

logger = logging.getLogger(__name__)

LOGIN_PATH = "/auth-service/v1/login-root"
CLIENT_NAME = "ADMIN_PORTAL"
TIMEOUT = 15.0
RETRY_AFTER_FAILURE_SECONDS = 60.0

# institute id -> (signed in at, tokens)
_tokens: Dict[str, Tuple[float, Dict[str, str]]] = {}
_failed_at: Dict[str, float] = {}
_lock = asyncio.Lock()


def reset() -> None:
    _tokens.clear()
    _failed_at.clear()


def credentials() -> Optional[Tuple[str, str]]:
    user = (os.getenv("DEMO_GUIDE_APP_USER") or "").strip()
    password = os.getenv("DEMO_GUIDE_APP_PASSWORD") or ""
    return (user, password) if user and password else None


async def _sign_in(user: str, password: str, institute_id: str) -> Optional[Dict[str, str]]:
    """POST login-root (replaceable in tests). None on any failure; never logs the credentials."""
    url = get_settings().auth_service_base_url.rstrip("/") + LOGIN_PATH
    body = {"user_name": user, "password": password, "client_name": CLIENT_NAME, "institute_id": institute_id}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.post(url, json=body)
    except httpx.HTTPError as exc:
        logger.warning("demo-guide: demo user sign-in failed (%s)", type(exc).__name__)
        return None
    if resp.status_code != 200:
        logger.warning("demo-guide: demo user sign-in answered HTTP %s", resp.status_code)
        return None
    try:
        data: Any = resp.json()
    except ValueError:
        return None
    access, refresh = (data or {}).get("accessToken"), (data or {}).get("refreshToken")
    if not isinstance(access, str) or not isinstance(refresh, str) or not access or not refresh:
        logger.warning("demo-guide: demo user sign-in returned no tokens")
        return None
    return {"accessToken": access, "refreshToken": refresh}


async def app_tokens(institute_id: Optional[str]) -> Optional[Dict[str, str]]:
    """{accessToken, refreshToken, instituteId} for the framed app, or None."""
    creds = credentials()
    if not institute_id or creds is None:
        return None
    now = time.monotonic()
    hit = _tokens.get(institute_id)
    if hit and now - hit[0] < APP_SIGN_IN_TTL_SECONDS:
        return {**hit[1], "instituteId": institute_id}
    async with _lock:
        now = time.monotonic()
        hit = _tokens.get(institute_id)
        if hit and now - hit[0] < APP_SIGN_IN_TTL_SECONDS:
            return {**hit[1], "instituteId": institute_id}
        if now - _failed_at.get(institute_id, -1e9) < RETRY_AFTER_FAILURE_SECONDS:
            return None
        tokens = await _sign_in(creds[0], creds[1], institute_id)
        if tokens is None:
            _failed_at[institute_id] = time.monotonic()
            return None
        _tokens[institute_id] = (time.monotonic(), tokens)
        _failed_at.pop(institute_id, None)
        return {**tokens, "instituteId": institute_id}
