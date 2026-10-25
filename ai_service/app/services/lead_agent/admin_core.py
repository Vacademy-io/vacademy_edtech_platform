"""admin_core internal endpoints the delivery uses (spec §5), HMAC internal auth.

  POST /admin-core-service/internal/audience/v1/lead-agent/existing-contacts
       {institute_id, phones: [last 10 digits], emails} -> {phones: [found], emails: [found]}
  POST /admin-core-service/internal/audience/v1/lead-agent/bulk-intake
       {institute_id, audience_id, rows: [...]} -> {results: [{external_id, status, response_id?, message?}]}

bulk-intake runs AudienceService.submitLead and the list's workflows row by row,
so calls carry at most BULK_ROWS rows with a long timeout.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

import httpx

logger = logging.getLogger(__name__)

BASE_PATH = "/admin-core-service/internal/audience/v1/lead-agent"
BULK_ROWS = 10
BULK_TIMEOUT_S = 180.0
CHECK_TIMEOUT_S = 30.0


class AdminCoreError(Exception):
    pass


def _base() -> str:
    from ...config import get_settings

    return get_settings().admin_core_service_base_url.rstrip("/")


async def _post(path: str, body: Dict[str, Any], timeout: float) -> Dict[str, Any]:
    from ..internal_auth import internal_auth_headers

    headers = await internal_auth_headers({"Content-Type": "application/json", "Accept": "application/json"})
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{_base()}{BASE_PATH}{path}", json=body, headers=headers)
    except httpx.HTTPError as exc:
        raise AdminCoreError(f"{path}: {type(exc).__name__}") from None
    if resp.status_code >= 400:
        raise AdminCoreError(f"{path}: HTTP {resp.status_code} {resp.text[:200]}")
    try:
        return resp.json() or {}
    except ValueError:
        raise AdminCoreError(f"{path}: not JSON") from None


async def existing_contacts(institute_id: str, phones: List[str], emails: List[str]) -> Dict[str, List[str]]:
    if not phones and not emails:
        return {"phones": [], "emails": []}
    data = await _post("/existing-contacts", {"institute_id": institute_id, "phones": phones, "emails": emails},
                       CHECK_TIMEOUT_S)
    return {"phones": list(data.get("phones") or []), "emails": [e.lower() for e in data.get("emails") or []]}


async def bulk_intake(institute_id: str, audience_id: str, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """ONE bulk-intake call for at most BULK_ROWS rows (the caller chunks, so a
    failed call loses nothing an earlier call delivered). admin_core is idempotent
    on external_id: a repeat answers CREATED / ALREADY_CREATED with the existing
    response_id."""
    if len(rows) > BULK_ROWS:
        raise ValueError(f"at most {BULK_ROWS} rows per bulk-intake call")
    data = await _post("/bulk-intake", {"institute_id": institute_id, "audience_id": audience_id, "rows": rows},
                       BULK_TIMEOUT_S)
    return list(data.get("results") or [])


__all__ = ["AdminCoreError", "existing_contacts", "bulk_intake", "BULK_ROWS"]
