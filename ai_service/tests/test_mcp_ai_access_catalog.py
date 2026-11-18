"""
Settings → AI access: one row per capability area, with the in-product
assistant's settings groups and the MCP tools side by side.

The catalogue the page renders comes from the registry (app/mcp/adapter.py
``assistant_catalog`` / ``access_areas``), so the dashboard keeps no list of
its own. These tests pin that every assistant group the page offers is a real
in-product group placed in a known area, that the defaults match the registry,
and that the endpoint answers staff only.
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
    MCP_SETTINGS_PATH,
    MCP_TOOL_AREAS,
)
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services.assistant_tool_registry import ASSISTANT_TOOLS, _effective_enabled_tools  # noqa: E402

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


@pytest.mark.parametrize("roles", [["ADMIN"], ["COUNSELLOR"], ["TEACHER"], ["ADMIN", "TEACHER"]])
def test_the_default_setting_grants_what_an_unsaved_institute_already_has(roles):
    """A first save starts from this setting, so each role keeps exactly what it had."""
    default = adapter.assistant_default_setting()
    always = {spec.key() for spec in ASSISTANT_TOOLS.values() if spec.always_allowed}
    assert _effective_enabled_tools(default, roles) == _effective_enabled_tools(None, roles) - always


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
