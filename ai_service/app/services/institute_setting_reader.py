"""
Shared reader for ONE key out of an institute's settings blob.

Institute settings live in a single JSON string column, ``institutes.setting_json``
(common_service Institute.java -> @Column(name="setting_json")). The Java generic
settings strategy (admin_core_service GenericSettingStrategy) writes this envelope:

    {"institute_id": "...",
     "setting": {"<KEY>": {"key": "<KEY>", "name": "...", "data": {...}}}}

so a key's payload lives at ``setting_json["setting"][KEY]["data"]``.

An older ai_service reader looked the key up at the TOP level of the blob, which
never matches what Java writes — the institute's saved toggles were silently
ignored and the caller fell back to its hardcoded defaults. This reader checks
the canonical location FIRST and keeps the top-level lookup as a fallback, so
both shapes resolve.

Fails closed-to-None (never raises): a settings read problem must never silently
grant a capability.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def _unwrap(node: Any) -> Optional[Dict[str, Any]]:
    """Return the setting's ``data`` payload, tolerating an unwrapped blob."""
    if not isinstance(node, dict):
        return None
    data = node.get("data")
    if isinstance(data, dict):
        return data
    # Some callers historically stored the payload directly under the key.
    return node


def load_institute_setting_data(
    db: Session,
    institute_id: str,
    key: str,
) -> Optional[Dict[str, Any]]:
    """
    Read ``setting_json[setting][key][data]`` for one institute.

    Returns None when the institute, the column, or the key is absent, or when
    anything about the read/parse fails.
    """
    if not institute_id or not key:
        return None

    try:
        row = db.execute(
            text("SELECT setting_json FROM institutes WHERE id = :id"),
            {"id": institute_id},
        ).first()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read institutes.setting_json for %s: %s", institute_id, exc)
        return None

    if not row or not row[0]:
        return None

    raw = row[0]
    try:
        blob = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, TypeError) as exc:
        logger.warning("institutes.setting_json for %s is not valid JSON: %s", institute_id, exc)
        return None

    if not isinstance(blob, dict):
        return None

    # Canonical location (what admin_core_service writes).
    container = blob.get("setting")
    if isinstance(container, dict) and key in container:
        return _unwrap(container.get(key))

    # Fallback: key stored at the top level.
    if key in blob:
        return _unwrap(blob.get(key))

    return None


__all__ = ["load_institute_setting_data"]
