
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..schemas.auth import PinnedPrincipal
from ..services.institute_setting_reader import load_institute_setting_data
from .constants import (
    DEFAULT_ALLOWED_ROLES,
    DENY_DISABLED,
    DENY_LEARNER,
    DENY_ROLE,
    LEARNER_ROLES,
    MCP_SERVER_SETTING_KEY,
)

logger = logging.getLogger(__name__)


def normalize_role(role: Any) -> str:
    """Roles are compared case-insensitively with spaces/hyphens unified.

    Institute-defined roles arrive as free text ("Content Creator", "content-creator"),
    and the JWT carries whatever the institute saved. Exact string matching would
    make the allow-list silently miss.
    """
    if not isinstance(role, str):
        return ""
    return role.strip().upper().replace("-", "_").replace(" ", "_")


def _normalize_roles(roles: Optional[List[Any]]) -> set:
    return {r for r in (normalize_role(x) for x in (roles or [])) if r}


def sanitize_allowed_roles(roles: Optional[List[Any]]) -> List[str]:
    """Drop learner roles from an allow-list, whatever the settings blob says."""
    out: List[str] = []
    for raw in roles or []:
        norm = normalize_role(raw)
        if not norm or norm in LEARNER_ROLES:
            continue
        if norm not in out:
            out.append(norm)
    return out


def normalize_setting(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Coerce a stored MCP_SERVER_SETTING blob into the shape the gates expect.

    The result is ALWAYS a truthy dict carrying ``enabled_tools`` and
    ``role_overrides``. That matters: the registry's ``_effective_enabled_tools``
    treats a falsy setting as "not configured" and falls back to the Assistant's
    default-on tools, which must never happen for MCP — an unconfigured MCP
    server grants nothing.
    """
    raw = raw if isinstance(raw, dict) else {}

    overrides_in = raw.get("role_overrides")
    overrides: Dict[str, Dict[str, List[str]]] = {}
    if isinstance(overrides_in, dict):
        for role, node in overrides_in.items():
            norm = normalize_role(role)
            if not norm or norm in LEARNER_ROLES or not isinstance(node, dict):
                continue
            tools = node.get("enabled_tools")
            overrides[norm] = {"enabled_tools": list(tools) if isinstance(tools, list) else []}

    return {
        "enabled": bool(raw.get("enabled", False)),
        "allowed_roles": sanitize_allowed_roles(raw.get("allowed_roles")) or list(DEFAULT_ALLOWED_ROLES),
        "enabled_tools": list(raw.get("enabled_tools") or []),
        "role_overrides": overrides,
    }


def load_mcp_setting(db: Session, institute_id: str) -> Dict[str, Any]:
    """Read and normalize this institute's MCP settings. Fails closed (disabled)."""
    return normalize_setting(load_institute_setting_data(db, institute_id, MCP_SERVER_SETTING_KEY))


def setting_for_tool_gate(setting: Dict[str, Any], principal: PinnedPrincipal) -> Dict[str, Any]:
    """
    Project the MCP setting into the shape the registry tool gate consumes.

    ``_effective_enabled_tools`` looks up ``role_overrides`` by EXACT role string,
    so re-key the overrides under the principal's own spellings of its roles.
    """
    overrides = setting.get("role_overrides") or {}
    projected: Dict[str, Any] = {}
    for role in principal.roles or []:
        node = overrides.get(normalize_role(role))
        if node is not None:
            projected[role] = node

    return {
        "enabled_tools": list(setting.get("enabled_tools") or []),
        "role_overrides": projected,
    }


def check_mcp_access(principal: PinnedPrincipal, setting: Dict[str, Any]) -> Optional[str]:
    """
    Return None when the caller may use the MCP server, else a denial reason.

    Membership is the roles the JWT carries for this institute. is_root_user is
    set for ordinary admins and learners, so it grants nothing here: a principal
    with no role in the institute is refused, root or not.
    """
    if not setting.get("enabled"):
        return DENY_DISABLED

    caller_roles = _normalize_roles(principal.roles)

    # Staff-only surface. A principal holding only learner roles is refused even
    # if that role was somehow allow-listed.
    if caller_roles and caller_roles.issubset(LEARNER_ROLES):
        return DENY_LEARNER

    # No roles for this institute = not a member of it (root users included).
    if not caller_roles:
        return DENY_ROLE

    allowed = {normalize_role(r) for r in setting.get("allowed_roles") or []}
    if not caller_roles.intersection(allowed):
        return DENY_ROLE

    return None


__all__ = [
    "check_mcp_access",
    "normalize_role",
    "load_mcp_setting",
    "normalize_setting",
    "sanitize_allowed_roles",
    "setting_for_tool_gate",
]
