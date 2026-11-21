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

``load_institute_setting_data`` fails closed-to-None (never raises): a settings read
problem must never silently grant a capability. ``read_institute_setting_data`` grants
nothing either, but raises, for a caller that must tell "could not read" from "not set".
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class SettingReadError(Exception):
    """The settings could not be read, so nothing is known about what they say."""


def _unwrap(node: Any) -> Optional[Dict[str, Any]]:
    """Return the setting's ``data`` payload, tolerating an unwrapped blob."""
    if node is None:
        return None
    if not isinstance(node, dict):
        raise SettingReadError("the saved setting is not a JSON object")
    data = node.get("data")
    if isinstance(data, dict):
        return data
    # Some callers historically stored the payload directly under the key.
    return node


def _select_raw(db: Session, institute_id: str) -> Any:
    """The stored blob, or None when the institute or the column is absent."""
    try:
        row = db.execute(
            text("SELECT setting_json FROM institutes WHERE id = :id"),
            {"id": institute_id},
        ).first()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read institutes.setting_json for %s: %s", institute_id, exc)
        raise SettingReadError("institutes.setting_json could not be read") from exc
    return row[0] if row else None


def _extract(raw: Any, institute_id: str, key: str) -> Optional[Dict[str, Any]]:
    if not raw:
        return None

    try:
        blob = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, TypeError) as exc:
        logger.warning("institutes.setting_json for %s is not valid JSON: %s", institute_id, exc)
        raise SettingReadError("institutes.setting_json is not valid JSON") from exc

    if not isinstance(blob, dict):
        raise SettingReadError("institutes.setting_json is not a JSON object")

    # Canonical location (what admin_core_service writes).
    container = blob.get("setting")
    if isinstance(container, dict) and key in container:
        return _unwrap(container.get(key))

    # Fallback: key stored at the top level.
    if key in blob:
        return _unwrap(blob.get(key))

    return None


def read_institute_setting_data(
    db: Session,
    institute_id: str,
    key: str,
) -> Optional[Dict[str, Any]]:
    """
    Read ``setting_json[setting][key][data]`` for one institute.

    Returns None only when the institute, the column, or the key is absent.
    Raises SettingReadError when the read fails or the stored value cannot be
    understood. A failed statement also rolls the session back, so the caller
    can keep using it.
    """
    if not institute_id or not key:
        return None

    try:
        raw = _select_raw(db, institute_id)
    except SettingReadError:
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            logger.debug("Rollback after a failed settings read also failed.", exc_info=True)
        raise

    return _extract(raw, institute_id, key)


def load_institute_setting_data(
    db: Session,
    institute_id: str,
    key: str,
) -> Optional[Dict[str, Any]]:
    """
    Read ``setting_json[setting][key][data]`` for one institute.

    Returns None when the institute, the column, or the key is absent, or when
    anything about the read/parse fails. Leaves the session's transaction to
    the caller, whose earlier work in it may not be this reader's to discard.
    """
    if not institute_id or not key:
        return None

    try:
        return _extract(_select_raw(db, institute_id), institute_id, key)
    except SettingReadError:
        return None


__all__ = ["SettingReadError", "load_institute_setting_data", "read_institute_setting_data"]
