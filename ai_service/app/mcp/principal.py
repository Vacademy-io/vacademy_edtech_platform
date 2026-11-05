"""
Rebuild a PinnedPrincipal from the platform token stored against an MCP grant.

The MCP access token is NOT a platform credential — it is an opaque handle into
``mcp_oauth_token``. Each request resolves that handle to the approving user's
platform JWT and re-derives their identity through the SAME trust boundary the
Assistant uses (``resolve_pinned_principal``), so roles/permissions are read live
from the JWT's per-institute authorities map and the user is re-verified against
auth_service. Nothing about the caller's authority is cached on the grant.

Platform JWTs outlive a 1h MCP access token (30 days), but not a 30-day refresh
token — so ``refresh_platform_token`` exchanges the stored platform refresh token
for a fresh JWT when the old one stops verifying.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from ..config import Settings
from ..core.security import AuthServiceUnavailable, resolve_pinned_principal
from ..schemas.auth import PinnedPrincipal

logger = logging.getLogger(__name__)


async def build_pinned_principal(
    platform_token: Optional[str],
    institute_id: str,
    settings: Settings,
) -> PinnedPrincipal:
    """Verify a stored platform token and pin it to ``institute_id``.

    Raises the same HTTPException (401/403) the HTTP dependency raises; MCP
    handlers translate that into a protocol error. Raises AuthServiceUnavailable
    when auth-service could not answer.
    """
    return await resolve_pinned_principal(
        token=platform_token,
        client_id=institute_id,
        settings=settings,
        raise_on_unavailable=True,
    )


async def refresh_platform_token(
    platform_refresh_token: Optional[str],
    settings: Settings,
) -> Optional[str]:
    """
    Mint a fresh platform access token from a stored refresh token.

    auth_service: POST /auth-service/v1/refresh-token  {"token": "<refresh>"}
                  -> {"accessToken": "...", ...}   (camelCase; no new refresh token)

    Returns None when the token is refused or the answer is unusable — the caller
    then fails the MCP request so the client re-runs the OAuth flow rather than
    retrying forever. Raises AuthServiceUnavailable when auth-service is unreachable
    or answers 5xx, because that says nothing about the token.
    """
    if not platform_refresh_token:
        return None

    url = f"{settings.auth_service_base_url}/auth-service/v1/refresh-token"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json={"token": platform_refresh_token})
    except httpx.RequestError as exc:
        logger.warning("MCP platform-token refresh could not reach auth-service: %s", exc)
        raise AuthServiceUnavailable(type(exc).__name__) from exc

    if response.status_code >= 500:
        logger.warning("MCP platform-token refresh got %s from auth-service", response.status_code)
        raise AuthServiceUnavailable(f"auth-service answered {response.status_code}")

    if response.status_code != 200:
        # Never log the response body — it carries tokens on success.
        logger.info("MCP platform-token refresh rejected with %s", response.status_code)
        return None

    try:
        data = response.json()
    except ValueError:
        logger.warning("MCP platform-token refresh returned a non-JSON body.")
        return None

    if not isinstance(data, dict):
        return None

    token = data.get("accessToken") or data.get("access_token")
    return token if isinstance(token, str) and token else None


__all__ = ["build_pinned_principal", "refresh_platform_token"]
