"""
The registry -> MCP bridge: what the server exposes, and to whom.

The point of these tests is containment. The Assistant registry holds 21 tools,
including writes; the MCP surface must expose exactly the allow-listed read tools
and nothing else, however the institute's settings are configured.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.mcp import adapter  # noqa: E402
from app.mcp.access import normalize_setting  # noqa: E402
from app.mcp.constants import MCP_ALLOWED_WRITE_TOOLS, MCP_EXPOSED_TOOLS  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services.assistant_tool_registry import ASSISTANT_TOOLS  # noqa: E402

SERVICES = Path(__file__).resolve().parents[1] / "app" / "services"

#: The CRM tools, their settings group and the module that registers them (docs/crm/CRM_MCP.md).
CRM_TOOLS = (
    ("crm_leads", "crm_leads", "assistant_tools_crm_leads"),
    ("crm_lead_activity", "crm_lead_activity", "assistant_tools_crm_lead_edit"),
    ("crm_lead_edit", "crm_lead_edits", "assistant_tools_crm_lead_edit"),
    ("crm_team_edit", "crm_team_edits", "assistant_tools_crm_team"),
    ("crm_lead_intake", "crm_lead_intake", "assistant_tools_crm_lead_edit"),
    ("crm_calls", "crm_calls", "assistant_tools_crm_calls"),
    ("crm_dial", "crm_calling_outbound", "assistant_tools_crm_calls"),
    ("crm_ai_campaign", "crm_ai_campaigns", "assistant_tools_crm_calls"),
    ("crm_meetings", "crm_meetings", "assistant_tools_crm_meetings"),
    ("crm_meetings_edit", "crm_meeting_edits", "assistant_tools_crm_meetings"),
    ("crm_messages", "crm_messages", "assistant_tools_crm_messages"),
    ("crm_send", "crm_messaging_outbound", "assistant_tools_crm_messages"),
    ("crm_reports", "crm_reports", "assistant_tools_crm_reports"),
    ("crm_collections", "crm_collections", "assistant_tools_crm_money"),
    ("crm_payment_reminders", "crm_payment_reminders", "assistant_tools_crm_money"),
)
CRM_TOOL_NAMES = tuple(t for t, _, _ in CRM_TOOLS)
CRM_GROUP = {t: g for t, g, _ in CRM_TOOLS}


def crm_module_present(module: str) -> bool:
    return (SERVICES / f"{module}.py").exists()


def loaded(names):
    """``names`` minus CRM tools whose module has not landed yet (a landed module must register its tools)."""
    return [n for n in names if n in ASSISTANT_TOOLS or n not in CRM_TOOL_NAMES]


def principal(roles=("ADMIN",), is_root=False):
    return PinnedPrincipal(
        user_id="user-1",
        institute_id="inst-1",
        roles=list(roles),
        permissions=[],
        is_root_user=is_root,
    )


def setting(enabled_tools, role_overrides=None):
    return normalize_setting(
        {
            "enabled": True,
            "allowed_roles": ["ADMIN", "TEACHER"],
            "enabled_tools": list(enabled_tools),
            "role_overrides": role_overrides or {},
        }
    )


# ── the exposed set ──────────────────────────────────────────────────────
def test_exposed_set_is_the_documented_one():
    # One tool per feature (with an `action` argument), so the settings tab has
    # one toggle per feature. Adding here means adding a label + docs too.
    assert MCP_EXPOSED_TOOLS == (
        "whoami", "get_institute_overview", "website", "website_edit", "design_import", "catalog_data_edit",
        "website_publish",
        "audience_forms", "audience_forms_edit",
        "workflows", "workflows_edit", "blog", "blog_edit",
        "courses", "course_edit", "course_drip_edit", "course_invites_edit", "course_structure_edit",
        "learners", "learner_report", "learner_enroll", "learner_edit",
        "sub_orgs", "sub_org_edit", "sub_org_enroll",
        "crm_leads", "crm_lead_activity", "crm_lead_edit", "crm_team_edit", "crm_lead_intake",
        "crm_calls", "crm_dial", "crm_ai_campaign",
        "crm_meetings", "crm_meetings_edit",
        "crm_messages", "crm_send",
        "crm_reports",
        "crm_collections", "crm_payment_reminders",
    )
    assert CRM_TOOL_NAMES == MCP_EXPOSED_TOOLS[-len(CRM_TOOL_NAMES):]


def test_every_exposed_name_exists_in_the_registry():
    """Guards against a registry rename silently emptying the MCP surface. A CRM tool may be missing only while
    its module has not landed: once the module file exists, its tools must register."""
    assert [s.name for s in adapter.exposed_specs()] == loaded(MCP_EXPOSED_TOOLS)
    for tool, _group, module in CRM_TOOLS:
        if crm_module_present(module):
            assert tool in ASSISTANT_TOOLS, f"{module}.py exists but did not register {tool}"


def test_exposed_write_tools_are_on_the_allow_list():
    """MCP has no confirm card: a write tool is exposed only when it is draft-only or additive."""
    for spec in adapter.exposed_specs():
        if spec.mode == "WRITE":
            assert spec.name in MCP_ALLOWED_WRITE_TOOLS, spec.name
            assert not spec.default_enabled and not spec.default_roles, "writes are never default-on"


def test_live_write_tools_are_not_exposed():
    """The Assistant's confirm-card writes (update_learner_profile, announcements …) stay off MCP; the learner
    tools exposed instead carry their own preview → confirm_token gate (test_learner_tools.py)."""
    write_tools = {name for name, spec in ASSISTANT_TOOLS.items() if spec.mode == "WRITE"}
    live_writes = write_tools - set(MCP_ALLOWED_WRITE_TOOLS)
    assert live_writes, "registry should contain live write tools for this test to mean anything"
    assert not live_writes & set(MCP_EXPOSED_TOOLS)


def test_draft_write_tool_is_off_unless_its_group_is_enabled():
    assert "website_edit" not in [t.name for t in adapter.list_tools_for(principal(), setting(["website_builder"]))]
    assert "website_edit" in [t.name for t in adapter.list_tools_for(principal(), setting(["website_builder_edits"]))]
    # Unconfigured institute: the write tool is off even for admins.
    assert "website_edit" not in [t.name for t in adapter.list_tools_for(principal(), normalize_setting({"enabled": True}))]


def test_workflow_draft_tool_is_off_unless_its_group_is_enabled():
    """The automations write tool follows the same rule: its own group, never the read group."""
    assert "workflows_edit" not in [t.name for t in adapter.list_tools_for(principal(), setting(["workflows"]))]
    assert gated(adapter.list_tools_for(principal(), setting(["workflows"]))) == ["workflows"]
    assert "workflows_edit" in [t.name for t in adapter.list_tools_for(principal(), setting(["workflows_edits"]))]
    tool = next(t for t in adapter.list_tools_for(principal(), setting(["workflows_edits"])) if t.name == "workflows_edit")
    assert tool.annotations.read_only_hint is False
    assert set(tool.input_schema["properties"]["action"]["enum"]) == {
        "validate", "create_draft", "update_draft", "discard_draft",
        "create_email_template", "create_whatsapp_template", "sync_whatsapp_templates",
    }


# ── schema translation ───────────────────────────────────────────────────
def gated(tools):
    """Tool names minus the always-on identity tool, which every caller gets."""
    return [t.name for t in tools if t.name != "whoami"]


def test_tools_translate_to_valid_mcp_tools():
    tools = adapter.list_tools_for(principal(), setting(["institute_overview"]))
    assert gated(tools) == ["get_institute_overview"]

    tool = next(t for t in tools if t.name == "get_institute_overview")
    assert tool.description
    assert tool.input_schema["type"] == "object"
    assert "sections" in tool.input_schema["properties"]
    assert tool.annotations.read_only_hint is True
    assert tool.annotations.destructive_hint is False


def test_catalog_describes_each_exposed_tool_for_the_settings_ui():
    catalog = adapter.tool_catalog()
    assert [c["name"] for c in catalog] == loaded(MCP_EXPOSED_TOOLS)
    entry = next(c for c in catalog if c["name"] == "get_institute_overview")
    assert entry["key"] == "institute_overview"
    assert entry["label"] == "Institute stats"
    assert entry["mode"] == "READ"
    assert entry["description"]
    assert entry["always_on"] is False
    # The identity tool is listed so the settings page can SHOW it, flagged as not a toggle.
    assert next(c for c in catalog if c["name"] == "whoami")["always_on"] is True


def test_catalog_places_every_tool_in_an_area_with_one_view_and_risk_rated_edits():
    from app.mcp.constants import MCP_TOOL_AREAS
    catalog = adapter.tool_catalog()
    for c in catalog:
        assert c["area"] in MCP_TOOL_AREAS, c["key"]
        assert c["level"] in ("view", "edit")
        # The page shows one row per area: every edit sits next to its area's view
        # (edit turns view on), and a WRITE tool is never presented as a view.
        assert (c["level"] == "edit") == (c["mode"] == "WRITE"), c["key"]
        if c["level"] == "edit":
            assert c["risk"] in ("drafts", "additive", "not_live", "live_additive", "live", "outbound") \
                and c["sub_label"]
    for area in {c["area"] for c in catalog}:
        assert sum(1 for c in catalog if c["area"] == area and c["level"] == "view") == 1, area
    invites = next(c for c in catalog if c["key"] == "course_invite_edits")
    assert invites["area"] == "courses" and invites["risk"] == "live"


# ── the per-tool gate ────────────────────────────────────────────────────
def test_tool_is_hidden_when_the_institute_has_not_enabled_it():
    assert gated(adapter.list_tools_for(principal(), setting([]))) == []


def test_whoami_is_always_offered_to_anyone_who_may_connect():
    """Identity only — no toggle can switch it off, in any configuration."""
    for conf in (setting([]), setting([], {"TEACHER": {"enabled_tools": []}}), normalize_setting(None)):
        assert [t.name for t in adapter.list_tools_for(principal(), conf)] == ["whoami"]


def test_tool_is_hidden_for_a_role_without_an_override():
    """Institute-level tools apply to everyone; overrides only ADD for a role."""
    conf = setting([], {"TEACHER": {"enabled_tools": ["institute_overview"]}})
    assert gated(adapter.list_tools_for(principal(["ADMIN"]), conf)) == []
    assert gated(adapter.list_tools_for(principal(["TEACHER"]), conf)) == ["get_institute_overview"]


def test_role_override_grants_on_top_of_institute_level_tools():
    conf = setting(["institute_overview"], {"TEACHER": {"enabled_tools": []}})
    assert gated(adapter.list_tools_for(principal(["TEACHER"]), conf)) == ["get_institute_overview"]


def test_unconfigured_setting_exposes_nothing():
    """
    The registry treats a falsy setting as 'use Assistant defaults'. MCP must not
    inherit that: an institute that never configured tools exposes none.
    """
    assert gated(adapter.list_tools_for(principal(), normalize_setting(None))) == []


# ── call containment ─────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_calling_an_unexposed_registry_tool_is_refused():
    """Even a real registry tool must be unreachable unless it is allow-listed."""
    result = await adapter.call_tool(
        name="send_announcement",
        arguments={},
        principal=principal(),
        platform_token="jwt",
        db=None,
        mcp_setting=setting(["institute_overview", "announcements"]),
    )
    assert result.is_error is True
    assert "tool_not_available" in result.content[0].text


@pytest.mark.asyncio
async def test_calling_an_unknown_tool_is_refused():
    result = await adapter.call_tool(
        name="definitely_not_a_tool",
        arguments={},
        principal=principal(),
        platform_token="jwt",
        db=None,
        mcp_setting=setting(["institute_overview"]),
    )
    assert result.is_error is True


@pytest.mark.asyncio
async def test_disabled_tool_call_is_denied_by_the_registry_gate():
    """An exposed-but-untoggled tool is refused at dispatch, not just hidden."""
    result = await adapter.call_tool(
        name="get_institute_overview",
        arguments={"sections": ["enrollment_counts"]},
        principal=principal(),
        platform_token="jwt",
        db=None,
        mcp_setting=setting([]),
    )
    assert result.is_error is True
    assert "tool_not_permitted" in result.content[0].text


def test_design_import_is_its_own_opt_in_draft_capability():
    """Off for every existing connection (website view or edit): an admin turns it on; never read-only."""
    for enabled in (["website_builder"], ["website_builder", "website_builder_edits"]):
        assert "design_import" not in [t.name for t in adapter.list_tools_for(principal(), setting(enabled))]
    assert "design_import" not in [t.name for t in adapter.list_tools_for(principal(), normalize_setting({"enabled": True}))]
    tool = next(t for t in adapter.list_tools_for(principal(), setting(["design_import"])) if t.name == "design_import")
    assert tool.annotations.read_only_hint is False and tool.annotations.destructive_hint is True
    assert set(tool.input_schema["properties"]["action"]["enum"]) == {"plan", "save_draft"}
    entry = next(c for c in adapter.tool_catalog() if c["name"] == "design_import")
    assert (entry["area"], entry["level"], entry["risk"]) == ("website", "edit", "drafts")
    assert entry["label"] == "Website: import Figma designs" and entry["sub_label"]
    # The website view tool keeps its own catalogue row and read-only hint.
    website = next(c for c in adapter.tool_catalog() if c["name"] == "website")
    assert website["key"] == "website_builder" and "Figma" not in website["summary"]


def test_website_publish_is_an_opt_in_live_capability_no_existing_connection_has():
    """Off for every existing connection (website view, edit, Figma import) and unconfigured servers."""
    for enabled in (["website_builder"], ["website_builder", "website_builder_edits"],
                    ["website_builder", "website_builder_edits", "design_import"]):
        assert "website_publish" not in [t.name for t in adapter.list_tools_for(principal(), setting(enabled))]
    assert "website_publish" not in [
        t.name for t in adapter.list_tools_for(principal(), normalize_setting({"enabled": True}))]
    tool = next(t for t in adapter.list_tools_for(principal(), setting(["website_publish"])) if t.name == "website_publish")
    assert tool.annotations.read_only_hint is False and tool.annotations.destructive_hint is True
    assert set(tool.input_schema["properties"]["action"]["enum"]) == {"publish", "rollback"}
    entry = next(c for c in adapter.tool_catalog() if c["name"] == "website_publish")
    assert (entry["area"], entry["level"], entry["risk"]) == ("website", "edit", "live")
    assert entry["opt_in"] is True and entry["label"] == "Website: publish" and entry["sub_label"]
    # Every other group keeps the area's Edit level / presets behaviour.
    opt_in_keys = [
        "website_data_edits", "website_publish", "course_structure_edits", "learner_enrollments",
        "learner_profile_edits", "sub_org_edits", "sub_org_enrollments",
        "crm_lead_activity", "crm_lead_edits", "crm_team_edits", "crm_lead_intake",
        "crm_calling_outbound", "crm_ai_campaigns", "crm_meeting_edits", "crm_messaging_outbound",
        "crm_payment_reminders"]
    keys_loaded = {ASSISTANT_TOOLS[n].key() for n in loaded(MCP_EXPOSED_TOOLS) if n in ASSISTANT_TOOLS}
    assert [c["key"] for c in adapter.tool_catalog() if c["opt_in"]] == [k for k in opt_in_keys if k in keys_loaded]
    from app.mcp.constants import MCP_OPT_IN_GROUPS
    assert MCP_OPT_IN_GROUPS == frozenset(opt_in_keys)
    spec = ASSISTANT_TOOLS["website_publish"]
    assert spec.mcp_only and not spec.default_enabled and not spec.default_roles and spec.mode == "WRITE"
    assert "LIVE" in MCP_ALLOWED_WRITE_TOOLS["website_publish"]


def test_learner_writes_are_opt_in_live_capabilities():
    """Enrolling and editing learners change live data: never switched on by the Learners view or a preset."""
    assert gated(adapter.list_tools_for(principal(), setting(["learners"]))) == ["learners"]
    for group, tool in (("learner_enrollments", "learner_enroll"), ("learner_profile_edits", "learner_edit")):
        entry = next(c for c in adapter.tool_catalog() if c["name"] == tool)
        assert (entry["key"], entry["area"], entry["level"], entry["risk"], entry["opt_in"]) == \
               (group, "learners", "edit", "live", True)
        assert tool in [t.name for t in adapter.list_tools_for(principal(), setting([group]))]
        assert "confirm" in MCP_ALLOWED_WRITE_TOOLS[tool]


def test_website_publish_is_never_offered_to_the_in_product_assistant():
    from app.services.assistant_tool_registry import build_offered_tools
    offered = build_offered_tools(principal(), {"enabled_tools": ["website_publish", "website_builder_edits"]})
    assert "website_publish" not in [s["function"]["name"] for s in offered]


def test_opt_in_groups_are_served_only_to_a_settings_page_that_asks_for_them():
    """F1: an older dashboard bundle (no ?opt_in=1) never sees publish / live data edits, so its
    'Turn everything on' and Edit-level presets cannot switch them on."""
    from app.mcp.constants import MCP_OPT_IN_GROUPS
    full = {c["key"] for c in adapter.tool_catalog(include_opt_in=True)}
    legacy = {c["key"] for c in adapter.tool_catalog(include_opt_in=False)}
    # CRM groups whose module has not landed yet are simply absent from both.
    landed = {s.key() for s in adapter.exposed_specs()}
    assert MCP_OPT_IN_GROUPS & landed <= full and MCP_OPT_IN_GROUPS - landed <= set(CRM_GROUP.values())
    assert not (MCP_OPT_IN_GROUPS & legacy)
    assert full - legacy == set(MCP_OPT_IN_GROUPS) & landed


def test_connection_info_defaults_to_the_legacy_catalogue():
    import inspect as _inspect
    from app.mcp import consent
    param = _inspect.signature(consent.connection_info).parameters["opt_in"]
    assert param.default.default is False


# ── outbound risk + CRM placement ────────────────────────────────────────
#: Live groups that predate the rule below and stay on the area's Edit level (changing them would switch a
#: capability off for an older dashboard bundle that already saved it). Never add to this set.
LIVE_NOT_OPT_IN_LEGACY = frozenset({"course_invite_edits"})


def test_every_live_or_outbound_group_is_opt_in():
    """An older dashboard bundle never sees an opt-in group (no ?opt_in=1), so its presets cannot switch on a
    group that changes live data or contacts leads — and it never meets the 'outbound' risk it cannot render."""
    from app.mcp.constants import MCP_OPT_IN_GROUPS, MCP_TOOL_PLACEMENT
    for key, place in MCP_TOOL_PLACEMENT.items():
        if place.get("risk") == "outbound":
            assert key in MCP_OPT_IN_GROUPS, key
        if place.get("risk") == "live" and key not in LIVE_NOT_OPT_IN_LEGACY:
            assert key in MCP_OPT_IN_GROUPS, key
    assert all(MCP_TOOL_PLACEMENT[k]["risk"] == "live" for k in LIVE_NOT_OPT_IN_LEGACY)


def test_crm_groups_sit_in_the_crm_areas_with_opt_in_edits():
    from app.mcp.constants import (MCP_OPT_IN_GROUPS, MCP_TOOL_AREAS, MCP_TOOL_GROUP_LABELS,
                                   MCP_TOOL_GROUP_SUMMARIES, MCP_TOOL_PLACEMENT)
    crm_areas = ["crm_leads", "crm_calls", "crm_meetings", "crm_messages", "crm_reports", "crm_payments"]
    assert [a for a in MCP_TOOL_AREAS if a.startswith("crm_")] == crm_areas
    expected = {
        "crm_leads": ("crm_leads", "view", None), "crm_lead_activity": ("crm_leads", "edit", "live_additive"),
        "crm_lead_edits": ("crm_leads", "edit", "live"), "crm_team_edits": ("crm_leads", "edit", "live"),
        "crm_lead_intake": ("crm_leads", "edit", "live"),
        "crm_calls": ("crm_calls", "view", None), "crm_calling_outbound": ("crm_calls", "edit", "outbound"),
        "crm_ai_campaigns": ("crm_calls", "edit", "outbound"),
        "crm_meetings": ("crm_meetings", "view", None), "crm_meeting_edits": ("crm_meetings", "edit", "outbound"),
        "crm_messages": ("crm_messages", "view", None),
        "crm_messaging_outbound": ("crm_messages", "edit", "outbound"),
        "crm_reports": ("crm_reports", "view", None),
        "crm_collections": ("crm_payments", "view", None),
        "crm_payment_reminders": ("crm_payments", "edit", "outbound"),
    }
    assert set(CRM_GROUP.values()) == set(expected)
    for key, (area, level, risk) in expected.items():
        place = MCP_TOOL_PLACEMENT[key]
        assert (place["area"], place["level"], place.get("risk")) == (area, level, risk), key
        assert MCP_TOOL_GROUP_LABELS[key] and MCP_TOOL_GROUP_SUMMARIES[key], key
        if level == "edit":
            assert place["sub_label"] and key in MCP_OPT_IN_GROUPS, key
        else:
            assert key not in MCP_OPT_IN_GROUPS, key
    for area in crm_areas:
        assert sum(1 for k, p in MCP_TOOL_PLACEMENT.items() if p["area"] == area and p["level"] == "view") == 1


def test_crm_write_tools_carry_a_safety_property_and_reads_none():
    writes = [t for t in CRM_TOOL_NAMES if MCP_TOOL_PLACEMENT_LEVEL(CRM_GROUP[t]) == "edit"]
    assert writes == ["crm_lead_activity", "crm_lead_edit", "crm_team_edit", "crm_lead_intake", "crm_dial",
                      "crm_ai_campaign", "crm_meetings_edit", "crm_send", "crm_payment_reminders"]
    for tool in CRM_TOOL_NAMES:
        assert (tool in MCP_ALLOWED_WRITE_TOOLS) == (tool in writes), tool
    for tool in writes:
        reason = MCP_ALLOWED_WRITE_TOOLS[tool]
        assert "confirm" in reason and ("scope" in reason or "institute" in reason), tool
    for tool in ("crm_dial", "crm_ai_campaign", "crm_send", "crm_payment_reminders"):
        assert MCP_ALLOWED_WRITE_TOOLS[tool].startswith("outbound, ") and "single-use" in MCP_ALLOWED_WRITE_TOOLS[tool]


def MCP_TOOL_PLACEMENT_LEVEL(key):
    from app.mcp.constants import MCP_TOOL_PLACEMENT
    return MCP_TOOL_PLACEMENT[key]["level"]


def _crm_specs():
    return [ASSISTANT_TOOLS[t] for t in CRM_TOOL_NAMES if t in ASSISTANT_TOOLS]


def test_crm_specs_are_mcp_only_off_by_default_and_tied_to_a_module():
    """Runs over the CRM tools whose modules have landed (none yet = nothing to check)."""
    for spec in _crm_specs():
        assert spec.mcp_only, spec.name                      # never offered to the in-product assistant
        assert not spec.default_enabled and spec.default_roles is None, spec.name
        assert spec.key() == CRM_GROUP[spec.name], spec.name
        assert spec.module_feature or spec.module_features_any, spec.name
        assert spec.mode == ("WRITE" if MCP_TOOL_PLACEMENT_LEVEL(spec.key()) == "edit" else "READ"), spec.name
        assert spec.required_permission is None, spec.name   # the RBAC leg would let a root principal through
        props = spec.schema["function"]["parameters"]["properties"]
        assert "user_id" not in props and "institute_id" not in props, spec.name


def _action_table(tool, module):
    """{action: meta} for one CRM tool: ACTION_SPEC is keyed by action, or by tool name and then action."""
    import importlib
    action_spec = getattr(importlib.import_module(f"app.services.{module}"), "ACTION_SPEC")
    enum = ASSISTANT_TOOLS[tool].schema["function"]["parameters"]["properties"]["action"]["enum"]
    nested = all(isinstance(v, dict) and "confirm" not in v for v in action_spec.values())
    return (action_spec[tool] if nested else {a: m for a, m in action_spec.items() if a in enum}), enum, \
        (set() if nested else set(action_spec))


def test_crm_action_specs_match_the_action_enum():
    """Each CRM module's ACTION_SPEC (docs + executor) lists exactly the actions its schemas offer."""
    modules = {}
    for tool, _group, module in CRM_TOOLS:
        if tool in ASSISTANT_TOOLS:
            modules.setdefault(module, []).append(tool)
    if not modules:
        pytest.skip("no CRM tool module has landed yet")
    for module, tools in modules.items():
        flat_keys, offered = set(), set()
        for tool in tools:
            table, enum, flat = _action_table(tool, module)
            flat_keys |= flat
            offered |= set(enum)
            assert set(table) == set(enum), tool
            for action, meta in table.items():
                assert set(meta) >= {"summary", "writes", "confirm", "feature", "admin_only"}, (tool, action)
                assert meta["confirm"] in ("none", "edit_token", "single_use"), (tool, action)
                assert isinstance(meta["writes"], bool) and isinstance(meta["admin_only"], bool), (tool, action)
                if ASSISTANT_TOOLS[tool].mode == "READ":
                    assert meta["writes"] is False and meta["confirm"] == "none", (tool, action)
        if flat_keys:
            assert flat_keys == offered, module


def test_crm_write_reasons_match_what_the_actions_do():
    """MCP_ALLOWED_WRITE_TOOLS is published: it may only promise what each tool's ACTION_SPEC enforces."""
    checked = 0
    for tool, _group, module in CRM_TOOLS:
        if tool not in ASSISTANT_TOOLS or tool not in MCP_ALLOWED_WRITE_TOOLS:
            continue
        table, _enum, _flat = _action_table(tool, module)
        reason = MCP_ALLOWED_WRITE_TOOLS[tool]
        writes = {a: m for a, m in table.items() if m["writes"]}
        assert writes, tool
        if "every write needs" in reason:
            assert all(m["confirm"] != "none" for m in writes.values()), tool
        if "single-use" in reason:
            assert any(m["confirm"] == "single_use" for m in writes.values()), tool
        if "admins only" in reason:
            assert all(m["admin_only"] for m in writes.values()), tool
        checked += 1
    if not checked:
        pytest.skip("no CRM write module has landed yet")


# ── the module (plan) gate ───────────────────────────────────────────────
import json  # noqa: E402
import types  # noqa: E402

from app.services import assistant_tool_registry as registry  # noqa: E402


class _Ent:
    def __init__(self, on, calls):
        self._on, self.calls = set(on), calls

    def on(self, key):
        return key in self._on


@pytest.fixture
def plan(monkeypatch):
    """Stand-in for app/services/entitlements.py: plan['on'] is the set of features the institute has."""
    state = {"on": set(), "loads": 0, "raise": False}

    def entitlements(db, institute_id):
        state["loads"] += 1
        if state["raise"]:
            raise RuntimeError("boom")
        return _Ent(state["on"], state)

    fake = types.ModuleType("app.services.entitlements")
    fake.entitlements = entitlements
    monkeypatch.setitem(sys.modules, "app.services.entitlements", fake)
    return state


@pytest.fixture
def gated_tool(monkeypatch):
    ran = []

    async def executor(args, ctx):
        ran.append(dict(args))
        return json.dumps({"ok": True})

    def register(name="zz_module_tool", **kw):
        spec = registry.ToolSpec(
            name=name,
            schema={"type": "function", "function": {"name": name, "description": "test",
                                                     "parameters": {"type": "object", "properties": {}}}},
            executor=executor, setting_key=name, mcp_only=True, **kw)
        monkeypatch.setitem(ASSISTANT_TOOLS, name, spec)
        monkeypatch.setattr(adapter, "MCP_EXPOSED_TOOLS", adapter.MCP_EXPOSED_TOOLS + (name,))
        return spec

    register.ran = ran
    return register


def _ctx(db=object()):
    return registry.ToolContext(db=db, principal=principal(), keys=(), via_mcp=True)


@pytest.mark.asyncio
async def test_a_tool_outside_the_plan_is_refused_before_it_runs(plan, gated_tool):
    gated_tool(module_feature="crm.leads")
    out = json.loads(await registry.execute_tool("zz_module_tool", {}, _ctx(), {"enabled_tools": ["zz_module_tool"]}))
    assert out["error"] == "module_not_enabled" and out["feature"] == "crm.leads" and out["message"]
    assert gated_tool.ran == []
    plan["on"] = {"crm.leads"}
    out = json.loads(await registry.execute_tool("zz_module_tool", {}, _ctx(), {"enabled_tools": ["zz_module_tool"]}))
    assert out == {"ok": True} and len(gated_tool.ran) == 1


@pytest.mark.asyncio
async def test_any_of_features_needs_one_of_them(plan, gated_tool):
    gated_tool(module_features_any=("crm.calling", "crm.ai_calling"))
    setting_ = {"enabled_tools": ["zz_module_tool"]}
    out = json.loads(await registry.execute_tool("zz_module_tool", {}, _ctx(), setting_))
    assert out["error"] == "module_not_enabled" and out["features_any"] == ["crm.calling", "crm.ai_calling"]
    plan["on"] = {"crm.ai_calling"}
    assert json.loads(await registry.execute_tool("zz_module_tool", {}, _ctx(), setting_)) == {"ok": True}


@pytest.mark.asyncio
async def test_module_gate_runs_after_the_settings_gate_and_once_per_call(plan, gated_tool):
    gated_tool(module_feature="crm.leads")
    out = json.loads(await registry.execute_tool("zz_module_tool", {}, _ctx(), {"enabled_tools": []}))
    assert out["error"] == "tool_not_permitted" and plan["loads"] == 0
    plan["on"] = {"crm.leads"}
    ctx = _ctx()
    await registry.execute_tool("zz_module_tool", {}, ctx, {"enabled_tools": ["zz_module_tool"]})
    assert registry.context_entitlements(ctx).on("crm.leads") and plan["loads"] == 1   # memoised on ctx


@pytest.mark.asyncio
async def test_module_gate_is_skipped_without_a_db_and_fails_closed_on_error(plan, gated_tool):
    gated_tool(module_feature="crm.leads")
    setting_ = {"enabled_tools": ["zz_module_tool"]}
    assert json.loads(await registry.execute_tool("zz_module_tool", {}, _ctx(db=None), setting_)) == {"ok": True}
    assert plan["loads"] == 0
    plan["raise"] = True
    out = json.loads(await registry.execute_tool("zz_module_tool", {}, _ctx(), setting_))
    assert out["error"] == "module_not_enabled" and len(gated_tool.ran) == 1


@pytest.mark.asyncio
async def test_tools_without_a_module_never_load_entitlements(plan):
    out = json.loads(await registry.execute_tool("get_institute_overview", {"sections": []}, _ctx(db=None),
                                                 {"enabled_tools": []}))
    assert out["error"] == "tool_not_permitted" and plan["loads"] == 0


def test_tools_list_hides_tools_outside_the_plan_only_with_a_db(plan, gated_tool):
    gated_tool(module_feature="crm.leads")
    conf = setting(["zz_module_tool", "institute_overview"])
    assert "zz_module_tool" in [t.name for t in adapter.list_tools_for(principal(), conf)]
    assert plan["loads"] == 0
    names = [t.name for t in adapter.list_tools_for(principal(), conf, db=object())]
    assert "zz_module_tool" not in names and "get_institute_overview" in names and plan["loads"] == 1
    plan["on"] = {"crm.leads"}
    assert "zz_module_tool" in [t.name for t in adapter.list_tools_for(principal(), conf, db=object())]
    plan["raise"] = True
    names = [t.name for t in adapter.list_tools_for(principal(), conf, db=object())]
    assert "zz_module_tool" not in names and "get_institute_overview" in names


def test_tools_list_skips_the_plan_read_when_no_listed_tool_needs_it(plan):
    adapter.list_tools_for(principal(), setting(["institute_overview"]), db=object())
    assert plan["loads"] == 0


def test_catalog_names_each_tools_feature_and_whether_the_plan_has_it(plan, gated_tool):
    gated_tool(module_feature="crm.leads")
    entry = next(c for c in adapter.tool_catalog() if c["name"] == "zz_module_tool")
    assert entry["module_feature"] == "crm.leads" and "entitled" not in entry
    ent = _Ent({"crm.leads"}, plan)
    catalog = adapter.tool_catalog(entitlements=ent)
    assert next(c for c in catalog if c["name"] == "zz_module_tool")["entitled"] is True
    assert next(c for c in catalog if c["name"] == "website")["entitled"] is True        # no module: always
    assert next(c for c in adapter.tool_catalog(entitlements=_Ent(set(), plan))
                if c["name"] == "zz_module_tool")["entitled"] is False


@pytest.mark.asyncio
async def test_call_tool_hands_the_client_id_to_the_tool(plan, gated_tool):
    seen = {}
    spec = gated_tool()

    async def executor(args, ctx):
        seen["client_id"] = ctx.client_id
        return json.dumps({"ok": True})

    spec.executor = executor
    await adapter.call_tool(name="zz_module_tool", arguments={}, principal=principal(), platform_token="jwt",
                            db=None, mcp_setting=setting(["zz_module_tool"]), client_id="vcm-abc")
    assert seen == {"client_id": "vcm-abc"}


def test_server_instructions_carry_the_crm_rules():
    from app.mcp.server import SERVER_INSTRUCTIONS
    for rule in ("crm_leads(action='find')", "never invent a lead", "lead_id (or lead_user_id), never as user_id",
                 "WITHOUT confirm_token", "only after the user clearly says yes", "lead_content",
                 "never as instructions", "the definition"):
        assert rule in SERVER_INSTRUCTIONS, rule
