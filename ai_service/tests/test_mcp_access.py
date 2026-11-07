"""
The MCP access gate. No DB, no HTTP — pure decisions about who may connect.

These are the rules the product cares about most: MCP is opt-in per institute,
restricted to allow-listed staff roles, and closed to learners unconditionally.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.mcp.access import (  # noqa: E402
    check_mcp_access,
    normalize_setting,
    sanitize_allowed_roles,
    setting_for_tool_gate,
)
from app.mcp.constants import DENY_DISABLED, DENY_LEARNER, DENY_ROLE  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402


def principal(roles, is_root=False):
    return PinnedPrincipal(
        user_id="user-1",
        institute_id="inst-1",
        username="someone@test",
        roles=roles,
        permissions=[],
        is_root_user=is_root,
    )


def enabled_setting(**overrides):
    base = {
        "enabled": True,
        "allowed_roles": ["ADMIN", "TEACHER"],
        "enabled_tools": ["institute_overview"],
        "role_overrides": {},
    }
    base.update(overrides)
    return normalize_setting(base)


# ── the institute leg ────────────────────────────────────────────────────
def test_unconfigured_institute_is_disabled():
    """Never configured must mean OFF, not 'fall back to defaults'."""
    assert check_mcp_access(principal(["ADMIN"]), normalize_setting(None)) == DENY_DISABLED


def test_explicitly_disabled_institute_denies_everyone():
    setting = enabled_setting(enabled=False)
    assert check_mcp_access(principal(["ADMIN"]), setting) == DENY_DISABLED
    assert check_mcp_access(principal([], is_root=True), setting) == DENY_DISABLED


# ── the role leg ─────────────────────────────────────────────────────────
def test_allowlisted_roles_pass():
    assert check_mcp_access(principal(["ADMIN"]), enabled_setting()) is None
    assert check_mcp_access(principal(["TEACHER"]), enabled_setting()) is None


def test_role_not_on_the_allowlist_is_denied():
    assert check_mcp_access(principal(["COUNSELLOR"]), enabled_setting()) == DENY_ROLE


def test_counsellor_passes_once_allowlisted():
    setting = enabled_setting(allowed_roles=["ADMIN", "COUNSELLOR"])
    assert check_mcp_access(principal(["COUNSELLOR"]), setting) is None


def test_role_matching_ignores_case_spacing_and_hyphens():
    setting = enabled_setting(allowed_roles=["Content Creator"])
    assert check_mcp_access(principal(["CONTENT_CREATOR"]), setting) is None
    assert check_mcp_access(principal(["content-creator"]), setting) is None


def test_one_allowed_role_out_of_several_is_enough():
    setting = enabled_setting(allowed_roles=["ADMIN"])
    assert check_mcp_access(principal(["COUNSELLOR", "ADMIN"]), setting) is None


def test_non_root_user_without_roles_is_denied():
    assert check_mcp_access(principal([]), enabled_setting()) == DENY_ROLE


def test_root_user_without_roles_in_this_institute_is_denied():
    # resolve_pinned_principal pins a root user to any institute they name, with
    # no roles; is_root_user is set for ordinary users, so it is not membership.
    assert check_mcp_access(principal([], is_root=True), enabled_setting()) == DENY_ROLE


def test_root_user_still_needs_an_allowed_role():
    setting = enabled_setting(allowed_roles=["ADMIN"])
    assert check_mcp_access(principal(["TEACHER"], is_root=True), setting) == DENY_ROLE
    assert check_mcp_access(principal(["ADMIN"], is_root=True), setting) is None


# ── learners are never allowed ───────────────────────────────────────────
def test_learner_is_denied():
    assert check_mcp_access(principal(["STUDENT"]), enabled_setting()) == DENY_LEARNER


def test_learner_denied_even_when_explicitly_allowlisted():
    """An admin ticking the wrong box, or hand-editing the JSON, must not matter."""
    setting = enabled_setting(allowed_roles=["ADMIN", "STUDENT"])
    assert "STUDENT" not in setting["allowed_roles"]
    assert check_mcp_access(principal(["STUDENT"]), setting) == DENY_LEARNER


def test_parent_and_learner_aliases_are_denied():
    for role in ("LEARNER", "PARENT", "student"):
        assert check_mcp_access(principal([role]), enabled_setting()) == DENY_LEARNER


def test_staff_who_also_hold_a_learner_role_are_judged_on_staff_role():
    setting = enabled_setting(allowed_roles=["TEACHER"])
    assert check_mcp_access(principal(["STUDENT", "TEACHER"]), setting) is None


def test_sanitize_allowed_roles_strips_learners_and_dedupes():
    assert sanitize_allowed_roles(["ADMIN", "admin", "STUDENT", "Teacher", None, 7]) == ["ADMIN", "TEACHER"]


# ── normalization ────────────────────────────────────────────────────────
def test_normalize_setting_is_always_truthy():
    """
    A falsy setting would make the registry's tool gate fall back to the
    Assistant's default-on tools — which must never happen for MCP.
    """
    for raw in (None, {}, {"enabled": False}, "nonsense"):
        normalized = normalize_setting(raw)
        assert normalized
        assert "enabled_tools" in normalized and "role_overrides" in normalized


def test_normalize_setting_defaults_to_admin_only_and_no_tools():
    normalized = normalize_setting({"enabled": True})
    assert normalized["allowed_roles"] == ["ADMIN"]
    assert normalized["enabled_tools"] == []


def test_normalize_setting_drops_learner_role_overrides():
    normalized = normalize_setting(
        {
            "enabled": True,
            "role_overrides": {
                "STUDENT": {"enabled_tools": ["institute_overview"]},
                "TEACHER": {"enabled_tools": ["institute_overview"]},
            },
        }
    )
    assert "STUDENT" not in normalized["role_overrides"]
    assert normalized["role_overrides"]["TEACHER"] == {"enabled_tools": ["institute_overview"]}


def test_setting_for_tool_gate_rekeys_overrides_to_the_callers_spelling():
    """The registry gate matches role_overrides by exact string, so re-key them."""
    setting = normalize_setting(
        {"enabled": True, "enabled_tools": [], "role_overrides": {"Content Creator": {"enabled_tools": ["x"]}}}
    )
    projected = setting_for_tool_gate(setting, principal(["content creator"]))
    assert projected["role_overrides"] == {"content creator": {"enabled_tools": ["x"]}}


def test_setting_for_tool_gate_omits_roles_the_caller_does_not_hold():
    setting = enabled_setting(role_overrides={"TEACHER": {"enabled_tools": ["institute_overview"]}})
    assert setting_for_tool_gate(setting, principal(["ADMIN"]))["role_overrides"] == {}
