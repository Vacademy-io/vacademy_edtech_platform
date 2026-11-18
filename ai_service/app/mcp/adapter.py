"""
Bridge between the Vacademy Assistant tool registry and MCP.

The registry is the single source of truth for what a tool is and does — schema,
executor, settings group. This module only:

  * narrows the registry to ``MCP_EXPOSED_TOOLS`` (Phase 1: one tool), so a tool
    becoming available to the Assistant does not silently appear over MCP;
  * translates an OpenAI function-calling schema into an MCP ``Tool``;
  * runs calls through the registry's own ``execute_tool``, which re-checks the
    per-tool gate and overwrites identity arguments with the pinned principal;
  * audits every call.

Per-tool enablement is evaluated against the institute's MCP settings — NOT the
Assistant's — so an institute can expose a tool to its AI clients without
enabling it in the in-product Assistant, and vice versa.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from mcp.types import CallToolResult, ImageContent, TextContent, Tool, ToolAnnotations
from sqlalchemy.orm import Session

from ..schemas.auth import PinnedPrincipal
from ..services.assistant_tool_registry import (
    ASSISTANT_TOOLS,
    GROUP_LABELS,
    ToolContext,
    ToolSpec,
    execute_tool,
    is_tool_allowed,
    load_entitlements,
    missing_module_feature,
)
from .access import setting_for_tool_gate
from .constants import (
    ASSISTANT_GROUP_PLACEMENT,
    MCP_EXPOSED_TOOLS,
    MCP_OPT_IN_GROUPS,
    MCP_ALWAYS_ON_TOOLS,
    MCP_TOOL_AREAS,
    MCP_TOOL_GROUP_LABELS,
    MCP_TOOL_GROUP_SUMMARIES,
    MCP_TOOL_PLACEMENT,
)
from .repository import McpOAuthRepository

logger = logging.getLogger(__name__)


def exposed_specs() -> List[ToolSpec]:
    """The registry specs this server is willing to surface, in a stable order."""
    specs = []
    for name in MCP_EXPOSED_TOOLS:
        spec = ASSISTANT_TOOLS.get(name)
        if spec is None:
            # A rename in the registry must be loud, not silently narrowing.
            logger.error("MCP_EXPOSED_TOOLS names '%s', which is not in ASSISTANT_TOOLS.", name)
            continue
        specs.append(spec)
    return specs


def _placement(key: str) -> Dict[str, Any]:
    """Where a group sits on the settings page: its area (row), level and risk."""
    place = MCP_TOOL_PLACEMENT.get(key) or {"area": key, "level": "view"}
    area = MCP_TOOL_AREAS.get(place["area"]) or {"label": MCP_TOOL_GROUP_LABELS.get(key, key), "summary": ""}
    return {"area": place["area"], "area_label": area["label"], "area_summary": area["summary"],
            "area_order": list(MCP_TOOL_AREAS).index(place["area"]) if place["area"] in MCP_TOOL_AREAS else 99,
            "level": place["level"], "risk": place.get("risk"), "sub_label": place.get("sub_label"),
            # Turned on one by one: never by the area's Edit level or a preset.
            "opt_in": key in MCP_OPT_IN_GROUPS}


def tool_catalog(include_opt_in: bool = True, entitlements: Optional[Any] = None) -> List[Dict[str, Any]]:
    """
    The catalogue the settings UI renders toggles from.

    Served from the backend so the dashboard never carries a second copy of the
    tool list that can drift from the registry.

    ``include_opt_in=False`` leaves out the opt-in groups (MCP_OPT_IN_GROUPS). The
    settings page asks for them explicitly (``?opt_in=1``) because it never turns
    them on with a preset; an older dashboard bundle does not know the flag, so it
    never sees them and its "everything" / Edit-level presets cannot switch on
    live publishing or live data edits.

    Each entry names the plan feature its tool needs (``module_feature``, None
    when it needs none). With ``entitlements`` (the institute's, from
    app/services/entitlements.py) it also says whether the plan includes it
    (``entitled``), so the page can grey out tools the institute cannot use.
    """
    catalog: List[Dict[str, Any]] = []
    for spec in exposed_specs():
        fn = spec.schema_for(via_mcp=True).get("function", {})
        key = spec.key(via_mcp=True)
        if not include_opt_in and key in MCP_OPT_IN_GROUPS:
            continue
        description = fn.get("description", "")
        # Action-style tools carry their verbs in an `action` enum; surface them
        # so an admin can see what a toggle actually allows.
        action_prop = ((fn.get("parameters") or {}).get("properties") or {}).get("action") or {}
        actions = [a for a in action_prop.get("enum") or [] if isinstance(a, str)]
        catalog.append(
            {
                "name": spec.name,
                "key": key,
                "label": MCP_TOOL_GROUP_LABELS.get(key, key.replace("_", " ").title()),
                "description": description,
                "summary": MCP_TOOL_GROUP_SUMMARIES.get(key, description),
                "actions": actions,
                "mode": spec.mode,
                # Not a toggle: on for everyone who may connect (identity, product how-tos).
                "always_on": bool(spec.always_allowed) or spec.name in MCP_ALWAYS_ON_TOOLS,
                "module_feature": spec.module_feature or (spec.module_features_any or (None,))[0],
                **_placement(key),
            }
        )
        if entitlements is not None:
            catalog[-1]["entitled"] = missing_module_feature(spec, entitlements) is None
    return catalog


def access_areas() -> List[Dict[str, Any]]:
    """The settings page's rows, in display order: one per capability area."""
    return [{"key": key, "label": area["label"], "summary": area["summary"], "order": index}
            for index, (key, area) in enumerate(MCP_TOOL_AREAS.items())]


def _in_product_groups() -> Dict[str, List[ToolSpec]]:
    """In-product assistant settings group → its specs (MCP-only tools are never offered in-product)."""
    groups: Dict[str, List[ToolSpec]] = {}
    for spec in ASSISTANT_TOOLS.values():
        if not spec.mcp_only:
            groups.setdefault(spec.key(), []).append(spec)
    return groups


def _ordered_roles(specs: List[ToolSpec]) -> List[str]:
    roles: List[str] = []
    for spec in specs:
        for role in spec.default_roles or []:
            if role not in roles:
                roles.append(role)
    return roles


def assistant_group_opt_in(key: str, specs: List[ToolSpec]) -> bool:
    """
    True when the assistant's group is turned on one by one, never by an area's
    Edit level or a preset: the group is an MCP opt-in group itself, or one of
    its changes is one over MCP (e.g. ``learner_edits`` changes enrolments,
    which MCP keeps as ``learner_enrolment_changes``).
    """
    if key in MCP_OPT_IN_GROUPS:
        return True
    return any(s.mode == "WRITE" and s.key(via_mcp=True) in MCP_OPT_IN_GROUPS for s in specs)


def assistant_catalog(entitlements: Optional[Any] = None) -> List[Dict[str, Any]]:
    """
    The in-product assistant's settings groups, each placed in an area of the
    settings page (ASSISTANT_GROUP_PLACEMENT) next to the MCP tools of that area.

    Served from the backend for the same reason as ``tool_catalog``: the
    dashboard renders it and keeps no list of its own. Each entry carries the
    group's out-of-the-box defaults (``default_enabled``, ``default_roles``),
    the plan feature its tools need and ``opt_in`` (see
    ``assistant_group_opt_in``); with ``entitlements`` also ``entitled``.
    """
    groups = _in_product_groups()
    catalog: List[Dict[str, Any]] = []
    for key, place in ASSISTANT_GROUP_PLACEMENT.items():
        specs = groups.get(key)
        if not specs:
            # A group renamed in the registry must be loud, not a silently missing switch.
            logger.error("ASSISTANT_GROUP_PLACEMENT names '%s', which no in-product tool uses.", key)
            continue
        features = [f for s in specs for f in ([s.module_feature] if s.module_feature else
                                               list(s.module_features_any or ()))]
        area = MCP_TOOL_AREAS.get(place["area"]) or {"label": place["area"], "summary": ""}
        entry: Dict[str, Any] = {
            "key": key,
            "label": GROUP_LABELS.get(key, key.replace("_", " ").capitalize()),
            "tools": [s.name for s in specs],
            "mode": "WRITE" if any(s.mode == "WRITE" for s in specs) else "READ",
            "always_on": any(s.always_allowed for s in specs),
            "default_enabled": any(s.default_enabled for s in specs),
            "default_roles": _ordered_roles(specs),
            "module_feature": features[0] if features else None,
            "area": place["area"],
            "area_label": area["label"],
            "area_order": list(MCP_TOOL_AREAS).index(place["area"]) if place["area"] in MCP_TOOL_AREAS else 99,
            "level": place["level"],
            "opt_in": assistant_group_opt_in(key, specs),
        }
        if entitlements is not None:
            # On when the plan includes at least one of the group's tools.
            entry["entitled"] = any(missing_module_feature(s, entitlements) is None for s in specs)
        catalog.append(entry)
    return catalog


def assistant_default_setting() -> Dict[str, Any]:
    """
    What the assistant allows while an institute has never saved its setting
    (``_effective_enabled_tools`` with no setting), written out as a setting:
    groups on for everyone in ``enabled_tools``, role defaults in
    ``role_overrides``. The settings page starts from this until the setting
    is first saved. Saved role lists are matched to a person's roles the same
    way as these defaults: ignoring case, spaces and underscores.
    """
    enabled: List[str] = []
    overrides: Dict[str, Dict[str, List[str]]] = {}
    for key, specs in _in_product_groups().items():
        if any(s.always_allowed for s in specs):
            continue
        if any(s.default_enabled for s in specs):
            enabled.append(key)
        for role in _ordered_roles(specs):
            node = overrides.setdefault(role, {"enabled_tools": []})
            if key not in node["enabled_tools"]:
                node["enabled_tools"].append(key)
    return {"enabled_tools": enabled, "role_overrides": overrides}


def _to_mcp_tool(spec: ToolSpec) -> Tool:
    fn = spec.schema_for(via_mcp=True).get("function", {})
    parameters = fn.get("parameters") or {"type": "object", "properties": {}}
    read_only = spec.mode == "READ"
    return Tool(
        name=spec.name,
        description=fn.get("description", ""),
        input_schema=parameters,
        annotations=ToolAnnotations(
            read_only_hint=read_only,
            destructive_hint=not read_only,
            idempotent_hint=read_only,
            # Institute data changes outside this server's control.
            open_world_hint=True,
        ),
    )


def list_tools_for(principal: PinnedPrincipal, mcp_setting: Dict[str, Any],
                   db: Optional[Session] = None) -> List[Tool]:
    """Exposed tools this caller is entitled to, per the institute's MCP settings.

    With ``db``, a tool tied to a plan feature (``module_feature``) is listed only
    when the institute's plan includes it — the same check execute_tool repeats
    on every call. Without it (tests, DB-less callers) that check is skipped.
    """
    gate_setting = setting_for_tool_gate(mcp_setting, principal)
    specs = [spec for spec in exposed_specs() if is_tool_allowed(spec.name, principal, gate_setting, via_mcp=True)]
    if db is not None and any(s.module_feature or s.module_features_any for s in specs):
        try:
            ent = load_entitlements(db, principal.institute_id)
            specs = [s for s in specs if missing_module_feature(s, ent) is None]
        except Exception:  # noqa: BLE001 — never list a module tool the check could not clear
            logger.exception("MCP tools/list module check failed for institute=%s", principal.institute_id)
            specs = [s for s in specs if not (s.module_feature or s.module_features_any)]
    return [_to_mcp_tool(spec) for spec in specs]


def _summarize(payload: Any) -> Tuple[bool, Optional[str]]:
    """(ok, error_code) for the audit row, from a tool's JSON result."""
    if isinstance(payload, dict) and payload.get("error"):
        return False, str(payload["error"])[:64]
    return True, None


async def call_tool(
    *,
    name: str,
    arguments: Optional[Dict[str, Any]],
    principal: PinnedPrincipal,
    platform_token: Optional[str],
    db: Session,
    mcp_setting: Dict[str, Any],
    repo: Optional[McpOAuthRepository] = None,
    client_id: Optional[str] = None,
    client_name: Optional[str] = None,
    before_audit: Optional[Callable[[], None]] = None,
) -> CallToolResult:
    """
    Execute one exposed tool and shape the result for MCP.

    Tool failures are returned as ``is_error`` results rather than raised: the
    model can read the message and recover (or tell the user what to enable),
    which a protocol-level error would not allow.

    ``before_audit`` runs once the tool has returned, before its audit row. A lane
    call uses it to end as cancelled if it was stopped in the meantime.
    """
    if name not in MCP_EXPOSED_TOOLS:
        return CallToolResult(
            content=[
                TextContent(
                    type="text",
                    text=json.dumps(
                        {
                            "error": "tool_not_available",
                            "tool": name,
                            "message": "This tool is not available over the Vacademy MCP server.",
                        }
                    ),
                )
            ],
            is_error=True,
        )

    gate_setting = setting_for_tool_gate(mcp_setting, principal)
    ctx = ToolContext(
        db=db,
        principal=principal,
        # No keys from the client, ever. A tool that embeds (search_help_knowledge)
        # resolves the server's own key when it runs.
        keys=(),
        bearer_token=platform_token,
        images_as_content=True,  # image fields become ImageContent below
        via_mcp=True,  # mcp_only tools (design_import, website_publish) run only here
        client_id=client_id,
    )

    started = time.monotonic()
    raw = await execute_tool(name, arguments or {}, ctx, gate_setting)
    duration_ms = int((time.monotonic() - started) * 1000)
    if before_audit is not None:
        before_audit()

    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        payload = {"result": raw}

    ok, error_code = _summarize(payload)

    if repo is not None:
        repo.log_tool_call(
            user_id=principal.user_id,
            institute_id=principal.institute_id,
            client_id=client_id,
            client_name=client_name,
            tool_name=name,
            args=arguments or {},
            ok=ok,
            error_code=error_code,
            duration_ms=duration_ms,
        )

    # A tool may hand back a rendered image (website preview): send it as image
    # content so the model can SEE it, with the rest of the result as text. A
    # tall page comes as several tiles (`images_base64`, top to bottom).
    if isinstance(payload, dict) and (
        isinstance(payload.get("image_png_base64"), str) or isinstance(payload.get("images_base64"), list)
    ):
        images = []
        if isinstance(payload.get("image_png_base64"), str):
            images.append(payload.pop("image_png_base64"))
        images.extend(i for i in payload.pop("images_base64", None) or [] if isinstance(i, str) and i)
        return CallToolResult(
            content=[
                *(ImageContent(type="image", data=image, mime_type="image/jpeg") for image in images),
                TextContent(type="text", text=json.dumps(payload, ensure_ascii=False, default=str)),
            ],
            is_error=not ok,
        )

    return CallToolResult(
        content=[TextContent(type="text", text=raw)],
        is_error=not ok,
    )


__all__ = ["call_tool", "exposed_specs", "list_tools_for", "tool_catalog"]
