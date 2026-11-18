"""
Settings → AI access: one row per capability area, with the in-product
assistant's settings groups and the MCP tools side by side.

The catalogue the page renders comes from the registry (app/mcp/adapter.py
``assistant_catalog`` / ``access_areas``), so the dashboard keeps no list of
its own. These tests pin that every assistant group the page offers is a real
in-product group placed in a known area, that every labelled group is placed,
that the defaults match the registry, that edits turned on one by one are
marked, that saved role lists match a role in any spelling, and that the
endpoint answers staff only.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from app.mcp import adapter, consent  # noqa: E402
from app.mcp.constants import (  # noqa: E402
    AI_ACCESS_SETTINGS_PATH,
    ASSISTANT_GROUP_PLACEMENT,
    DENIAL_MESSAGES,
    MCP_OPT_IN_GROUPS,
    MCP_SETTINGS_PATH,
    MCP_TOOL_AREAS,
)
from app.mcp.access import normalize_setting, setting_for_tool_gate  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services.assistant_tool_registry import (  # noqa: E402
    ASSISTANT_TOOLS,
    GROUP_LABELS,
    _effective_enabled_tools,
    role_match_key,
)

#: The groups the assistant settings screen offered before the two screens became one.
PREVIOUSLY_OFFERED = (
    "search_help_knowledge", "learner_data", "payments", "batch_data", "schedule", "institute_overview",
    "learner_edits", "assessments", "website_builder", "website_builder_edits", "audience_forms",
    "audience_forms_edits", "workflows", "workflows_edits", "crm_leads", "crm_calls", "crm_meetings",
    "crm_messages", "crm_reports", "crm_collections", "announcements",
)
CRM_READS = ("crm_leads", "crm_calls", "crm_meetings", "crm_messages", "crm_reports", "crm_collections")
#: The capability catalogue the dashboard reads plans from (governs.assistant_groups).
CAPABILITY_CATALOG = Path(__file__).resolve().parents[2] / "admin_core_service" / "src" / "main" / "resources" \
    / "capabilities" / "catalog.json"


class _Ent:
    def __init__(self, on):
        self._on = set(on)

    def on(self, key):
        return key in self._on


def _in_product_keys():
    return {spec.key() for spec in ASSISTANT_TOOLS.values() if not spec.mcp_only}


def test_every_placed_assistant_group_is_an_in_product_group_in_a_known_area():
    keys = _in_product_keys()
    for key, place in ASSISTANT_GROUP_PLACEMENT.items():
        assert key in keys, key
        assert place["area"] in MCP_TOOL_AREAS, key
        assert place["level"] in ("view", "edit"), key


def test_the_page_still_offers_every_group_the_assistant_screen_offered():
    offered = [entry["key"] for entry in adapter.assistant_catalog()]
    for key in PREVIOUSLY_OFFERED:
        assert key in offered, key


@pytest.mark.skipif(not CAPABILITY_CATALOG.exists(), reason="admin_core_service not in this checkout")
def test_every_group_a_plan_governs_is_placed_on_the_page():
    raw = json.loads(CAPABILITY_CATALOG.read_text())
    catalog = raw.get("catalog", raw)
    governed = {g for m in catalog["modules"] for f in m["features"]
                for g in (f.get("governs") or {}).get("assistant_groups") or []}
    assert governed and governed <= set(ASSISTANT_GROUP_PLACEMENT)


def test_assistant_entries_carry_the_registry_defaults_and_area():
    catalog = {entry["key"]: entry for entry in adapter.assistant_catalog()}
    for key in CRM_READS:
        entry = catalog[key]
        assert entry["default_enabled"] is False
        assert entry["default_roles"] == ["ADMIN", "COUNSELLOR", "COUNSELOR"]
        assert entry["mode"] == "READ"
    assert catalog["crm_collections"]["area"] == "crm_payments"
    assert catalog["search_help_knowledge"]["default_enabled"] is True
    assert catalog["learner_edits"]["level"] == "edit" and catalog["learner_edits"]["mode"] == "WRITE"
    assert catalog["identity"]["always_on"] is True
    assert catalog["payments"]["module_feature"] == "finance.fees"
    assert all(entry["area_label"] == MCP_TOOL_AREAS[entry["area"]]["label"] for entry in catalog.values())


def test_assistant_entries_say_whether_the_plan_includes_them():
    assert all("entitled" not in entry for entry in adapter.assistant_catalog())
    without_crm = {e["key"]: e["entitled"] for e in adapter.assistant_catalog(entitlements=_Ent({"finance.fees"}))}
    assert without_crm["crm_leads"] is False and without_crm["crm_calls"] is False
    assert without_crm["payments"] is True and without_crm["learner_data"] is True
    with_crm = {e["key"]: e["entitled"] for e in adapter.assistant_catalog(entitlements=_Ent({"crm.leads"}))}
    assert with_crm["crm_leads"] is True and with_crm["crm_calls"] is False


@pytest.mark.parametrize("roles", [
    ["ADMIN"], ["COUNSELLOR"], ["TEACHER"], ["ADMIN", "TEACHER"],
    # Login tokens spell roles as the institute saved them.
    ["Admin"], ["Counsellor"], ["counselor"], [" admin "], ["Content Creator"], ["CONTENT_CREATOR"],
])
def test_the_default_setting_grants_what_an_unsaved_institute_already_has(roles):
    """
    Saved, the default setting grants each role what the registry defaults grant
    it while nothing is saved, whatever the spelling of the role in the token.
    """
    default = adapter.assistant_default_setting()
    always = {spec.key() for spec in ASSISTANT_TOOLS.values() if spec.always_allowed}
    assert _effective_enabled_tools(default, roles) == _effective_enabled_tools(None, roles) - always


def test_every_labelled_in_product_group_is_placed_on_the_page():
    """A labelled group left unplaced would show as "Not offered" for something the assistant has."""
    unplaced = sorted(k for k in _in_product_keys() if k in GROUP_LABELS and k not in ASSISTANT_GROUP_PLACEMENT)
    assert unplaced == []


def test_groups_sit_next_to_the_mcp_tools_of_the_same_key():
    """An assistant group that shares its key with an MCP tool sits in that tool's area, at its level."""
    mcp = {t["key"]: t for t in adapter.tool_catalog(include_opt_in=True)}
    for entry in adapter.assistant_catalog():
        tool = mcp.get(entry["key"])
        if tool is not None and entry["key"] != "announcements":
            assert (entry["area"], entry["level"]) == (tool["area"], tool["level"]), entry["key"]


def test_opt_in_follows_the_mcp_opt_in_groups():
    catalog = {entry["key"]: entry for entry in adapter.assistant_catalog()}
    for key in ("course_structure_edits", "learner_enrollments", "learner_profile_edits",
                "sub_org_edits", "sub_org_enrollments"):
        assert key in MCP_OPT_IN_GROUPS and catalog[key]["opt_in"] is True, key
    # A group one of whose changes is an MCP opt-in group is turned on one by one too.
    assert catalog["learner_edits"]["opt_in"] is True
    assert catalog["announcements"]["opt_in"] is True
    for key in ("course_edits", "course_drip_edits", "blog_edits", "website_builder_edits", "learner_data"):
        assert catalog[key]["opt_in"] is False, key
    assert all(isinstance(entry["opt_in"], bool) for entry in catalog.values())


@pytest.mark.parametrize("saved_role,token_role", [
    ("COUNSELLOR", "Counsellor"), ("Counsellor", "COUNSELLOR"), ("CONTENT CREATOR", "Content_Creator"),
    ("content_creator", "CONTENT CREATOR"), ("Teacher", " teacher "),
])
def test_saved_role_lists_match_the_role_in_any_spelling(saved_role, token_role):
    setting = {"enabled_tools": ["search_help_knowledge"],
               "role_overrides": {saved_role: {"enabled_tools": ["crm_leads"]}}}
    assert _effective_enabled_tools(setting, [token_role]) == {"search_help_knowledge", "crm_leads"}
    assert _effective_enabled_tools(setting, ["EVALUATOR"]) == {"search_help_knowledge"}


def test_two_spellings_of_one_role_add_up_and_odd_values_are_ignored():
    setting = {"enabled_tools": [],
               "role_overrides": {"TEACHER": {"enabled_tools": ["schedule"]},
                                  "Teacher": {"enabled_tools": ["assessments"]},
                                  "teacher ": None,
                                  "TEACHER_": {"enabled_tools": "blog"}}}
    assert _effective_enabled_tools(setting, ["Teacher"]) == {"schedule", "assessments"}
    assert role_match_key("Content Creator") == role_match_key("CONTENT_CREATOR") == "CONTENTCREATOR"
    assert role_match_key(None) == ""


def test_both_doors_match_saved_role_lists_alike():
    """The MCP gate passes on the caller's role lists in any spelling, as the assistant reads them."""
    setting = normalize_setting({"enabled": True, "allowed_roles": ["ADMIN", "COUNSELLOR"],
                                 "enabled_tools": [],
                                 "role_overrides": {"COUNSELLOR": {"enabled_tools": ["crm_leads"]},
                                                    "Counsellor": {"enabled_tools": ["crm_calls"]}}})
    assert setting["role_overrides"] == {"COUNSELLOR": {"enabled_tools": ["crm_leads", "crm_calls"]}}
    gate = setting_for_tool_gate(setting, _principal(["Counsellor"]))
    assert gate["role_overrides"] == {"Counsellor": {"enabled_tools": ["crm_leads", "crm_calls"]}}
    assert {"crm_leads", "crm_calls"} <= _effective_enabled_tools(gate, ["Counsellor"])
    assert setting_for_tool_gate(setting, _principal(["ADMIN"]))["role_overrides"] == {}


def test_areas_are_the_mcp_areas_in_display_order():
    areas = adapter.access_areas()
    assert [a["key"] for a in areas] == list(MCP_TOOL_AREAS)
    assert [a["order"] for a in areas] == list(range(len(areas)))


def test_denials_point_at_the_ai_access_screen():
    assert MCP_SETTINGS_PATH == AI_ACCESS_SETTINGS_PATH == "/settings?selectedTab=aiAccess"
    assert all("Settings → AI access" in message for message in
               (DENIAL_MESSAGES["mcp_disabled"], DENIAL_MESSAGES["role_not_allowed"]))


def _principal(roles):
    return PinnedPrincipal(user_id="u-1", institute_id="inst-1", roles=roles)


@pytest.mark.asyncio
async def test_access_catalog_answers_staff_with_both_doors(monkeypatch):
    monkeypatch.setattr(consent.lanes, "active", lambda: False)
    out = await consent.access_catalog(principal=_principal(["TEACHER"]), db=None, opt_in=True)
    assert [a["key"] for a in out.areas] == list(MCP_TOOL_AREAS)
    assert {e["key"] for e in out.assistant_groups} >= set(PREVIOUSLY_OFFERED)
    assert any(t.get("opt_in") for t in out.mcp_tools)
    # No database here: the plan reads as "everything on".
    assert all(t["entitled"] for t in out.mcp_tools) and all(e["entitled"] for e in out.assistant_groups)
    assert out.assistant_default_setting == adapter.assistant_default_setting()


@pytest.mark.asyncio
@pytest.mark.parametrize("roles", [[], ["STUDENT"], ["LEARNER", "PARENT"]])
async def test_access_catalog_refuses_learners_and_non_members(monkeypatch, roles):
    monkeypatch.setattr(consent.lanes, "active", lambda: False)
    with pytest.raises(HTTPException) as exc:
        await consent.access_catalog(principal=_principal(roles), db=None, opt_in=False)
    assert exc.value.status_code == 403
