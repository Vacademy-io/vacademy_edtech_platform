"""Spatius (spatius.ai) teacher avatar — premium layer (owner decision 2026-09-07).

The avatar is rendered on the learner's device by Spatius AvatarKit; their
Motion Server turns the teacher's speech audio into a small motion stream.
This module holds the server side: minting short-lived session tokens for a
lesson, creating an avatar from the institute's teacher photo, and polling
that job. Env: SPATIUS_API_KEY, SPATIUS_APP_ID, optional SPATIUS_CONSOLE_HOST
(default console.us-west.spatius.ai). Nothing here runs when the keys are
absent — the feature stays dark.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

DEFAULT_CONSOLE_HOST = "console.us-west.spatius.ai"
SESSION_TOKEN_TTL_SECONDS = 2 * 60 * 60
# Per-minute vendor cost (overage rate, Starter/Builder plans), for usage rows.
SPATIUS_USD_PER_MINUTE = 0.0072


def _api_key() -> str:
    return (os.environ.get("SPATIUS_API_KEY") or "").strip()


def app_id() -> str:
    return (os.environ.get("SPATIUS_APP_ID") or "").strip()


def base_url() -> str:
    """Session tokens: the regional console host (docs: POST /v1/console/session-tokens)."""
    host = (os.environ.get("SPATIUS_CONSOLE_HOST") or DEFAULT_CONSOLE_HOST).strip().rstrip("/")
    return f"https://{host}/v1/console"


OPEN_API_BASE = "https://console.spatius.ai/v1/open"


def open_base_url() -> str:
    """Avatars and avatar jobs: the open API (docs: https://console.spatius.ai/v1/open/avatars)."""
    return (os.environ.get("SPATIUS_OPEN_API_BASE") or OPEN_API_BASE).strip().rstrip("/")


def available() -> bool:
    return bool(_api_key() and app_id())


def _headers() -> Dict[str, str]:
    return {"X-API-Key": _api_key(), "X-App-ID": app_id(), "Content-Type": "application/json"}


def _payload(r: httpx.Response, what: str) -> Dict[str, Any]:
    """The vendor answers HTTP 200 with an `errors` body for an unknown route
    or a rejected request: treat that as a failure, not a result."""
    try:
        data = r.json()
    except Exception:  # noqa: BLE001
        raise RuntimeError(f"Spatius {what} HTTP {r.status_code}: {r.text[:200]}")
    if r.status_code >= 300 or (isinstance(data, dict) and data.get("errors")):
        errs = (data.get("errors") if isinstance(data, dict) else None) or []
        detail = "; ".join(str(e.get("detail") or e.get("title") or e) for e in errs if isinstance(e, dict)) or r.text[:200]
        raise RuntimeError(f"Spatius {what} failed (HTTP {r.status_code}): {detail}")
    return data if isinstance(data, dict) else {}


# Minting costs 1-9 s at the vendor, and the learner waits for it before the
# teacher's face can even start downloading. The token is not per-lesson —
# it authenticates this app to the Motion Server for two hours — so one is
# shared until it is close to expiry.
_token_cache: Optional[Dict[str, Any]] = None
_token_lock = asyncio.Lock()
# Re-mint this long before expiry, so a lesson never starts on a token that
# dies mid-way (a lesson can run 90 minutes).
TOKEN_REFRESH_MARGIN_SECONDS = 100 * 60


def _cached_token() -> Optional[Dict[str, Any]]:
    c = _token_cache
    if not c or c.get("app_id") != app_id():
        return None
    return c if c["expires_at"] - time.time() > TOKEN_REFRESH_MARGIN_SECONDS else None


def reset_token_cache() -> None:
    """Drop the shared token (tests, key rotation)."""
    global _token_cache
    _token_cache = None


async def _mint(ttl_seconds: int) -> Dict[str, Any]:
    expire_at = int(time.time()) + max(60, min(ttl_seconds, 23 * 3600))
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(f"{base_url()}/session-tokens", headers=_headers(), json={"expireAt": expire_at})
    data = _payload(r, "session token")
    token = data.get("sessionToken") or data.get("session_token")
    if not token:
        raise RuntimeError("Spatius returned no session token")
    return {"session_token": token, "expires_at": expire_at, "app_id": app_id()}


async def mint_session_token(ttl_seconds: int = SESSION_TOKEN_TTL_SECONDS) -> Dict[str, Any]:
    """A session token for the Motion Server (Direct mode: the browser
    connects with it). Shared across lessons while it is comfortably valid;
    expireAt must be within 24 hours."""
    global _token_cache
    if not available():
        raise RuntimeError("Spatius is not configured")
    hit = _cached_token()
    if hit:
        return dict(hit)
    async with _token_lock:
        hit = _cached_token()          # another lesson may have minted while we waited
        if hit:
            return dict(hit)
        fresh = await _mint(ttl_seconds)
        _token_cache = fresh
        return dict(fresh)


async def warm_session_token() -> None:
    """Best-effort: have a token ready before a lesson asks for one."""
    if not available():
        return
    try:
        await mint_session_token()
    except Exception:  # noqa: BLE001
        logger.debug("Spatius token warm-up failed", exc_info=True)


async def create_avatar(image_url: str, name: Optional[str] = None) -> Dict[str, Any]:
    """Queue an avatar from one clear face photo (public https URL, JPEG/PNG
    ≤ 5 MiB, shorter side ≥ 340 px). Returns {job_id, status}."""
    if not available():
        raise RuntimeError("Spatius is not configured")
    body: Dict[str, Any] = {"imageUrl": image_url}
    if name:
        body["name"] = name[:80]
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(f"{open_base_url()}/avatars", headers=_headers(), json=body)
    if r.status_code == 402:
        raise RuntimeError("Spatius avatar creations are used up for this plan")
    data = _payload(r, "avatar creation")
    job_id = data.get("jobId") or data.get("id")
    if not job_id:
        raise RuntimeError(f"Spatius avatar creation returned no job id: {str(data)[:200]}")
    return {"job_id": job_id, "status": data.get("status") or "queued", "raw": data}


async def avatar_job(job_id: str) -> Dict[str, Any]:
    """{status: queued|processing|succeeded|failed, avatar_id, error}."""
    if not available():
        raise RuntimeError("Spatius is not configured")
    async with httpx.AsyncClient(timeout=20.0) as client:
        # The docs list jobs (GET /avatar-jobs) and do not show a single-job
        # route: try it, then fall back to the list and pick ours by id.
        data: Dict[str, Any] = {}
        try:
            data = _payload(await client.get(f"{open_base_url()}/avatar-jobs/{job_id}", headers=_headers()), "avatar job")
        except RuntimeError:
            data = {}
        if not data.get("status"):
            listing = _payload(await client.get(f"{open_base_url()}/avatar-jobs", headers=_headers(),
                                                params={"pagination.pageSize": 100}), "avatar jobs")
            for j in listing.get("jobs") or []:
                if isinstance(j, dict) and (j.get("id") == job_id or j.get("jobId") == job_id):
                    data = j
                    break
    if not data:
        return {"status": "unknown", "avatar_id": None, "error": "job not found", "raw": {}}
    avatar = data.get("avatar") if isinstance(data.get("avatar"), dict) else {}
    return {"status": data.get("status") or "unknown",
            "avatar_id": data.get("avatarId") or data.get("avatar_id") or avatar.get("id") or avatar.get("avatarId"),
            "error": data.get("error") or data.get("failureReason"), "raw": data}
