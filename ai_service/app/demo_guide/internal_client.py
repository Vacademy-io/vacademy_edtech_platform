"""The demo guide's one call to admin_core: the lead.

POST /admin-core-service/internal/demo-guide/v1/leads sits beside Site
Assistant's /internal/site-assistant/v1/leads and runs the same pipeline
(SiteAssistantLeadService → AudienceService.submitCatalogueLead), with
``source_type = DEMO_GUIDE`` and ``source_id`` = the session id. The existing
Site Assistant route always writes ``SITE_ASSISTANT``, which is why the guide
has its own. Same HMAC clientName / Signature headers
(services/internal_auth.py); the institute and the lead list come from the
product's settings, never from the visitor or the model.
"""
from __future__ import annotations

from typing import Any, Dict

from ..site_assistant.internal_client import AdminCoreUnavailable, _request  # the shared internal HTTP call

LEADS_PATH = "/admin-core-service/internal/demo-guide/v1/leads"

__all__ = ["AdminCoreUnavailable", "LEADS_PATH", "submit_lead"]


async def submit_lead(body: Dict[str, Any]) -> Dict[str, Any]:
    """→ {status: received|duplicate, lead_ref}. Raises AdminCoreUnavailable on any failure."""
    status, data = await _request("POST", LEADS_PATH, body=body)
    if status not in (200, 201) or not isinstance(data, dict) or data.get("status") not in ("received", "duplicate"):
        raise AdminCoreUnavailable(f"demo-guide leads: HTTP {status}")
    return {"status": data["status"], "lead_ref": data.get("lead_ref")}
