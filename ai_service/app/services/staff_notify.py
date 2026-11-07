"""Tell staff something finished — the dashboard bell (SYSTEM_ALERT) and email.

notification_service's unified send endpoint under `/internal/` takes the same
clientName + Signature headers every Spring service uses, which
`internal_auth_headers()` already resolves for ai_service. The payload mirrors
assessment_service's `NotificationService.sendSystemAlertToUsers` so the alert
looks like every other one in the bell.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, Optional

import httpx

from ..config import get_settings
from .internal_auth import internal_auth_headers

logger = logging.getLogger(__name__)

_UNIFIED_SEND = "/notification-service/internal/v1/send"
_ANNOUNCEMENTS_MULTIPLE = "/notification-service/v1/announcements/admin/multiple"


async def system_alert(
    institute_id: str,
    user_ids: Iterable[str],
    title: str,
    body: str,
    *,
    source: str = "AI_PAPER_DIGITISE",
    source_id: Optional[str] = None,
    data: Optional[Dict[str, str]] = None,
) -> bool:
    """One bell entry per user. Best-effort: False (and a log line) on any failure.

    The dashboard bell reads announcement system alerts, not pushes — the
    unified send's SYSTEM_ALERT channel is FCM only and reached nobody on the
    web (2026-09-20). So the bell entry is an announcement (same shape
    admin_core_service creates; createdByRole ADMIN skips the institute's
    optional approval, as a system notice must), and the push rides alongside
    for anyone on the app.
    """
    ids = [uid for uid in dict.fromkeys(u for u in user_ids if u)]
    if not ids:
        return False
    announcement = {
        "title": title or "Notification",
        "content": {"type": "text", "content": body or "Open to view details."},
        "instituteId": institute_id or "",
        "createdBy": "system",
        "createdByName": source.replace("_", " ").title() if source else "System",
        "createdByRole": "ADMIN",
        "recipients": [{"recipientType": "USER", "recipientId": uid} for uid in ids],
        "modes": [{"modeType": "SYSTEM_ALERT",
                   "settings": {"priority": 2, "isDismissible": True, "showBadge": True, "isActive": True}}],
    }
    ok = await _post(_ANNOUNCEMENTS_MULTIPLE, [announcement], "bell announcement")
    options: Dict[str, Any] = {"pushTitle": title, "pushBody": body, "source": source, "sourceId": source_id}
    if data:
        options["pushData"] = data
    await _send({
        "instituteId": institute_id or "",
        "channel": "SYSTEM_ALERT",
        "recipients": [{"userId": uid} for uid in ids],
        "options": options,
    }, "system_alert push")
    return ok


async def email(
    institute_id: str,
    recipients: Iterable[Dict[str, Optional[str]]],
    subject: str,
    body_html: str,
    *,
    source: str = "AI_PAPER_DIGITISE",
    source_id: Optional[str] = None,
) -> bool:
    """One email per recipient `{"email", "name", "userId"}`; entries without an
    address are skipped. Same UTILITY_EMAIL path assessment_service's staff
    notices use, so the institute's sender / unsubscribe rules apply."""
    to = [
        {"email": r.get("email"), "name": r.get("name") or "", "userId": r.get("userId")}
        for r in recipients if r.get("email")
    ]
    if not to:
        return False
    payload = {
        "instituteId": institute_id or "",
        "channel": "EMAIL",
        "recipients": to,
        "options": {
            "emailSubject": subject,
            "emailBody": body_html,
            "emailType": "UTILITY_EMAIL",
            "source": source,
            "sourceId": source_id,
        },
    }
    return await _send(payload, "email")


async def _send(payload: Dict[str, Any], what: str) -> bool:
    return await _post(_UNIFIED_SEND, payload, what)


async def _post(path: str, payload: Any, what: str) -> bool:
    url = f"{get_settings().notification_service_base_url}{path}"
    try:
        headers = await internal_auth_headers({"Content-Type": "application/json"})
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code >= 300:
            logger.warning("%s -> %s: %s", what, resp.status_code, resp.text[:200])
            return False
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("%s failed: %s", what, exc)
        return False
