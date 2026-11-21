"""Write to the admin activity log (admin_core_service.admin_activity_log).

The activity log is the one place an owner looks to answer "who did what":
course and learner actions from admin_core, assessment edits from
assessment_service. AI tools that spend an institute's credits belong there
too. This posts the same snake_case body assessment_service's
AssessmentAuditClient sends, to the same internal endpoint, with the
service-to-service HMAC headers ai_service already uses for admin_core.

Best effort and off the request path: the business action has already
happened, so a logging failure is a warning, never an error.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

import httpx
from fastapi import Request

from ..config import get_settings
from ..core.security import _extract_bearer, decode_access_token
from .internal_auth import internal_auth_headers

logger = logging.getLogger(__name__)

_ROUTE = "/admin-core-service/internal/audit/v1/record"


def actor_from_request(request: Optional[Request], user: Any = None) -> Dict[str, Optional[str]]:
    """actor_id / actor_name / actor_email from the bearer token (the JWT
    carries `user`, `fullname`, `email`, `sub`), falling back to the resolved
    user object."""
    payload: Dict[str, Any] = {}
    if request is not None:
        token = _extract_bearer(request.headers.get("authorization"))
        if token:
            try:
                payload = decode_access_token(token) or {}
            except Exception:  # noqa: BLE001
                payload = {}
    return {
        "actor_id": str(payload.get("user") or getattr(user, "user_id", None) or "") or None,
        "actor_name": (str(payload.get("fullname") or "") or None),
        "actor_email": (str(payload.get("email") or payload.get("sub") or getattr(user, "username", "") or "") or None),
    }


def _client_ip(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


async def record(
    *,
    institute_id: Optional[str],
    entity_type: str,
    entity_id: Optional[str],
    action: str,
    description: str,
    request: Optional[Request] = None,
    user: Any = None,
    actor: Optional[Dict[str, Optional[str]]] = None,
    payload: Optional[Dict[str, Any]] = None,
    response_status: int = 200,
) -> None:
    """Post one activity-log row. Never raises."""
    if not institute_id:
        return
    who = actor or actor_from_request(request, user)
    body: Dict[str, Any] = {
        "institute_id": institute_id,
        **who,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "action": action,
        "description": description,
        "request_payload": payload,
        "http_method": request.method if request is not None else None,
        "endpoint": str(request.url.path) if request is not None else None,
        "ip_address": _client_ip(request),
        "user_agent": request.headers.get("user-agent") if request is not None else None,
        "response_status": response_status,
    }
    try:
        settings = get_settings()
        url = settings.admin_core_service_base_url.rstrip("/") + _ROUTE
        headers = await internal_auth_headers({"Content-Type": "application/json"})
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=body, headers=headers)
            if resp.status_code >= 400:
                logger.warning("activity log post failed (%s %s): %s %s",
                               entity_type, action, resp.status_code, resp.text[:200])
    except Exception as exc:  # noqa: BLE001
        logger.warning("activity log post failed (%s %s): %s", entity_type, action, exc)


def record_later(**kwargs: Any) -> None:
    """Fire-and-forget from a request handler or a background worker."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(record(**kwargs))


__all__ = ["record", "record_later", "actor_from_request"]
