"""
One registry, two doors: every tool in ASSISTANT_TOOLS is served both by the
in-product assistant (unless ``mcp_only``) and over MCP (when listed in
MCP_EXPOSED_TOOLS). A tool reaches only one of them only when it is listed
below with the reason. A new tool therefore uses both doors unless someone
decides otherwise here, and an entry that no longer applies fails too.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.assistant_tool_registry import ASSISTANT_TOOLS  # noqa: E402
from app.mcp.constants import MCP_EXPOSED_TOOLS  # noqa: E402

_CRM_OUTBOUND = ("contacts leads (a call, a WhatsApp or email, an AI-call campaign or a fee reminder); the in-product "
                 "assistant makes only the CRM changes that contact nobody")

#: Tools served over MCP only (ToolSpec.mcp_only), with the reason.
MCP_ONLY = {
    # The design comes from the AI app's own Figma tools; the dashboard assistant has none.
    "design_import": "imports a design the AI app read with its own design tools",
    # Applied with the plan token of a dry run the AI app shows the admin; no such step in the panel yet.
    "catalog_data_edit": "live additive data edits confirmed with a dry-run plan token",
    # Publishes live after the admin saw the diff; opt-in on MCP only.
    "website_publish": "publishes a site live with its own confirm token",
    # Outbound CRM writes. The other CRM writes use both doors: over MCP a preview + confirm token, in the
    # in-product assistant the same executor confirmed on its card (crm_cards); crm_meetings_edit's book, which
    # sends the lead an invite, is refused there (crm_cards.REFUSED_ACTIONS).
    "crm_dial": _CRM_OUTBOUND,
    "crm_ai_campaign": _CRM_OUTBOUND,
    "crm_send": _CRM_OUTBOUND,
    "crm_payment_reminders": _CRM_OUTBOUND,
}

#: Tools served in the in-product assistant only (not in MCP_EXPOSED_TOOLS), with what each does that no MCP tool
#: does.
ASSISTANT_ONLY = {
    "trigger_full_report": (
        "starts the dashboard's written progress report in the background, which spends AI credits and emails the "
        "report; no MCP tool starts it (over MCP the AI app writes the report itself from learner_report)"
    ),
    "update_learner_profile": (
        "changes a learner's email as well as their details, confirmed on the assistant's card; learner_edit "
        "never changes the email"
    ),
}

#: Assistant tools retired because a tool both doors serve does their job, each with that tool and the
#: assistant settings group the retired tool used. The shared tool is offered to that group too, so the
#: same callers keep the job.
RETIRED = {
    "find_learner": ("learners", "learner_data"),
    "get_student_360": ("learner_report", "learner_data"),
}


def _doors(name: str) -> tuple:
    spec = ASSISTANT_TOOLS[name]
    return (not spec.mcp_only, name in MCP_EXPOSED_TOOLS)


def test_every_tool_uses_both_doors_unless_listed_with_a_reason():
    unlisted = []
    for name in ASSISTANT_TOOLS:
        in_product, over_mcp = _doors(name)
        assert in_product or over_mcp, f"{name} is served by neither the assistant nor MCP"
        if in_product and not over_mcp and name not in ASSISTANT_ONLY:
            unlisted.append(f"{name}: assistant only — add it to MCP_EXPOSED_TOOLS or to ASSISTANT_ONLY with why")
        if over_mcp and not in_product and name not in MCP_ONLY:
            unlisted.append(f"{name}: MCP only — drop mcp_only or add it to MCP_ONLY with why")
    assert not unlisted, "\n".join(unlisted)


def test_every_listed_tool_still_exists_and_still_uses_one_door():
    for name, reason in MCP_ONLY.items():
        assert name in ASSISTANT_TOOLS, f"{name} is gone; drop it from MCP_ONLY"
        assert _doors(name) == (False, True), f"{name} is no longer MCP only; drop it from MCP_ONLY"
        assert reason.strip(), name
    for name, reason in ASSISTANT_ONLY.items():
        assert name in ASSISTANT_TOOLS, f"{name} is gone; drop it from ASSISTANT_ONLY"
        assert _doors(name) == (True, False), f"{name} is no longer assistant only; drop it from ASSISTANT_ONLY"
        assert reason.strip(), name
    assert not set(MCP_ONLY) & set(ASSISTANT_ONLY)


def test_mcp_only_tools_are_all_writes():
    """A read has no reason to skip the in-product assistant (topics keep long schemas off other pages)."""
    for name in MCP_ONLY:
        assert ASSISTANT_TOOLS[name].mode == "WRITE", name


def test_crm_writes_that_contact_nobody_use_both_doors_with_the_card():
    from app.services import crm_cards

    for name in ("crm_lead_activity", "crm_lead_edit", "crm_lead_merge", "crm_lead_intake", "crm_team_edit",
                 "crm_meetings_edit"):
        spec = ASSISTANT_TOOLS[name]
        assert _doors(name) == (True, True), name
        assert spec.card_bridge and spec.opt_in and spec.mode == "WRITE", name
    # The one action of those that contacts a lead is refused in the assistant.
    assert set(crm_cards.REFUSED_ACTIONS) == {"crm_meetings_edit"}
    assert set(crm_cards.REFUSED_ACTIONS["crm_meetings_edit"]) == {"book"}


# ── retired assistant tools ──────────────────────────────────────────────

def _principal(roles=("ADMIN",)):
    from app.schemas.auth import PinnedPrincipal

    return PinnedPrincipal(user_id="u-1", institute_id="inst-1", roles=list(roles), permissions=[],
                           is_root_user=False)


def test_retired_tools_are_gone_and_their_job_uses_both_doors():
    for name, (shared, _group) in RETIRED.items():
        assert name not in ASSISTANT_TOOLS, f"{name} is retired; {shared} does its job"
        assert name not in MCP_EXPOSED_TOOLS
        assert _doors(shared) == (True, True), shared


def test_shared_tools_are_offered_under_the_retired_tools_group_in_the_assistant_only():
    from app.services.assistant_tool_registry import build_offered_tools, is_tool_allowed

    for _name, (shared, group) in RETIRED.items():
        spec = ASSISTANT_TOOLS[shared]
        only_old = {"enabled_tools": [group], "role_overrides": {}}
        own = {"enabled_tools": [spec.key()], "role_overrides": {}}
        nothing = {"enabled_tools": [], "role_overrides": {}}
        for roles in (("ADMIN",), ("TEACHER",)):
            p = _principal(roles)
            assert is_tool_allowed(shared, p, only_old), (shared, roles)
            assert shared in {s["function"]["name"] for s in build_offered_tools(p, only_old)}
            assert not is_tool_allowed(shared, p, nothing)
            # MCP keeps its own groups: the assistant's group switches nothing on there.
            assert not is_tool_allowed(shared, p, only_old, via_mcp=True), shared
            assert is_tool_allowed(shared, p, own, via_mcp=True), shared
        # Role lists saved for the old group carry over.
        by_role = {"enabled_tools": [], "role_overrides": {"Teacher": {"enabled_tools": [group]}}}
        assert is_tool_allowed(shared, _principal(("TEACHER",)), by_role)
        assert not is_tool_allowed(shared, _principal(("EVALUATOR",)), by_role)


def test_defaults_match_the_retired_tools_group():
    """No setting saved: the shared tool is on for exactly the roles the old group defaulted to."""
    from app.mcp.adapter import assistant_default_setting
    from app.services.assistant_tool_registry import is_tool_allowed

    defaults = assistant_default_setting()
    for _name, (shared, group) in RETIRED.items():
        roles_with_group = {r for r, node in defaults["role_overrides"].items() if group in node["enabled_tools"]}
        assert roles_with_group == {"ADMIN"}
        assert group not in defaults["enabled_tools"]
        assert is_tool_allowed(shared, _principal(("ADMIN",)), None)
        assert not is_tool_allowed(shared, _principal(("TEACHER",)), None)


def test_the_old_group_still_has_tools_of_its_own_and_its_settings_switch():
    from app.mcp.adapter import assistant_catalog

    groups = {g["key"]: g for g in assistant_catalog()}
    for _name, (_shared, group) in RETIRED.items():
        assert group in groups and groups[group]["tools"], group


def test_capabilities_list_the_shared_tools_under_the_old_group():
    from app.services.assistant_tool_registry import capability_groups, in_product_specs

    only_old = {"enabled_tools": ["learner_data"], "role_overrides": {}}
    p = _principal(("TEACHER",))
    groups = capability_groups(p, only_old, in_product_specs(p, only_old))
    assert {"learners", "learner_report"} <= set(groups["learner_data"])
    # The shared tools' own groups are not claimed: they stay off for this caller.
    assert "learners" not in groups and "learner_reports" not in groups
    both = {"enabled_tools": ["learner_data", "learners"], "role_overrides": {}}
    groups = capability_groups(p, both, in_product_specs(p, both))
    assert "learners" in groups["learners"] and "learners" in groups["learner_data"]


def test_prompt_and_offered_schemas_never_name_a_retired_tool():
    from contextlib import nullcontext

    from app.services import assistant_service as asv
    from app.services.assistant_tool_registry import ASSISTANT_TOPICS, build_offered_tools, in_product_specs
    from app.services.entitlements import LEGACY

    svc = asv.AssistantAgentService(lambda: nullcontext(None))
    p = _principal(("ADMIN",))
    everything = {"enabled_tools": sorted({s.key() for s in ASSISTANT_TOOLS.values()}), "role_overrides": {}}
    for setting in (None, everything):
        for topics in (set(), set(ASSISTANT_TOPICS)):
            prompt = svc._build_system_prompt(p, setting, usable_specs=in_product_specs(p, setting, LEGACY),
                                              entitlements=LEGACY, active_topics=topics)
            schemas = json.dumps(build_offered_tools(p, setting, topics=topics, entitlements=LEGACY))
            for name in RETIRED:
                assert name not in prompt, name
                assert name not in schemas, name
            assert "`learners`" in prompt and "`learner_report`" in prompt
