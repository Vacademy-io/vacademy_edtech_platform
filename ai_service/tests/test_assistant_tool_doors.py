"""
One registry, two doors: every tool in ASSISTANT_TOOLS is served both by the
in-product assistant (unless ``mcp_only``) and over MCP (when listed in
MCP_EXPOSED_TOOLS). A tool reaches only one of them only when it is listed
below with the reason. A new tool therefore uses both doors unless someone
decides otherwise here, and an entry that no longer applies fails too.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.assistant_tool_registry import ASSISTANT_TOOLS  # noqa: E402
from app.mcp.constants import MCP_EXPOSED_TOOLS  # noqa: E402

_CRM_WRITE = "a CRM change or outbound contact; the in-product assistant reads the CRM only for now"

#: Tools served over MCP only (ToolSpec.mcp_only), with the reason.
MCP_ONLY = {
    # The design comes from the AI app's own Figma tools; the dashboard assistant has none.
    "design_import": "imports a design the AI app read with its own design tools",
    # Applied with the plan token of a dry run the AI app shows the admin; no such step in the panel yet.
    "catalog_data_edit": "live additive data edits confirmed with a dry-run plan token",
    # Publishes live after the admin saw the diff; opt-in on MCP only.
    "website_publish": "publishes a site live with its own confirm token",
    # CRM writes: each is a two-step preview + confirm token flow on MCP.
    "crm_lead_activity": _CRM_WRITE,
    "crm_lead_edit": _CRM_WRITE,
    "crm_lead_merge": _CRM_WRITE,
    "crm_lead_intake": _CRM_WRITE,
    "crm_team_edit": _CRM_WRITE,
    "crm_dial": _CRM_WRITE,
    "crm_ai_campaign": _CRM_WRITE,
    "crm_meetings_edit": _CRM_WRITE,
    "crm_send": _CRM_WRITE,
    "crm_payment_reminders": _CRM_WRITE,
}

_PANEL_READ = "an early in-product read; MCP clients use the action tools (learners, courses, …) instead"
_PANEL_WRITE = "proposes a live change that runs only after Confirm on the panel's card; MCP has no card"

#: Tools served in the in-product assistant only (not in MCP_EXPOSED_TOOLS), with the reason.
ASSISTANT_ONLY = {
    "find_learner": _PANEL_READ,
    "get_student_360": _PANEL_READ,
    "find_batch": _PANEL_READ,
    "trigger_full_report": _PANEL_READ,
    "get_payment_history": _PANEL_READ,
    "get_fee_dues": _PANEL_READ,
    "get_subscription_plans": _PANEL_READ,
    "list_batch_learners": _PANEL_READ,
    "get_class_schedule": _PANEL_READ,
    "search_fee_records": _PANEL_READ,
    "get_collections_summary": _PANEL_READ,
    "list_recent_enrollments": _PANEL_READ,
    "find_assessment": _PANEL_READ,
    "get_assessment_results": _PANEL_READ,
    "get_assessment_leaderboard": _PANEL_READ,
    "list_announcements": _PANEL_READ,
    "update_learner_profile": _PANEL_WRITE,
    "manage_enrollment": _PANEL_WRITE,
    "send_announcement": _PANEL_WRITE,
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
