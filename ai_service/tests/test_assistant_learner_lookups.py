"""
Learner lookups in the in-product assistant: `learners` and `learner_report`
are also offered to the "learner_data" group. A caller who has that group but
not the tool's own group gets what the group gives: `learners` find through the
dashboard's learner list with their own token (masked phones), and
`learner_report` data with the report sections and no detail. A caller with
the tool's own group, and every MCP caller, gets the whole tool.
"""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import assistant_tool_registry as reg  # noqa: E402
from app.services import assistant_tools_learner_report as lr  # noqa: E402
from app.services import assistant_tools_learners as lt  # noqa: E402
from app.services import course_builder_data as cbd  # noqa: E402
from app.services import learner_data as ld  # noqa: E402

LOOKUPS_ONLY = {"enabled_tools": [], "role_overrides": {"TEACHER": {"enabled_tools": ["learner_data"]}}}
FULL = {"enabled_tools": [], "role_overrides": {"TEACHER": {"enabled_tools": ["learner_data", "learners",
                                                                            "learner_reports"]}}}


class _FakeDb:
    def execute(self, stmt, params=None):
        return SimpleNamespace(first=lambda: None, fetchall=lambda: [])

    def rollback(self):
        pass


def ctx(via_mcp=False):
    p = PinnedPrincipal(user_id="teacher-1", institute_id="inst-1", roles=["TEACHER"], permissions=[],
                        is_root_user=False)
    return reg.ToolContext(db=_FakeDb(), principal=p, keys=(), bearer_token="jwt", via_mcp=via_mcp)


ROW = {"user_id": "u-asha", "full_name": "Asha Rao", "email": "asha@x.com", "mobile_number": "+919876543210",
       "institute_enrollment_number": "ENR-7", "package_session_id": "ps-1", "status": "ACTIVE",
       "payment_status": "PAID", "expiry_date": "2027-03-31"}
PROFILE = {"user_id": "u-asha", "full_name": "Asha Rao", "email": "asha@x.com", "username": "asha",
           "mobile_number": "+919876543210"}


@pytest.fixture
def backend(monkeypatch):
    calls = {"dashboard": [], "internal": [], "db_search": 0}

    async def admin_core_json(c, method, path, **kw):
        calls["dashboard"].append({"path": path, "token": c.bearer_token, **kw})
        return {"content": [dict(ROW)], "total_elements": 1}

    def search(c, q, limit=10):
        calls["db_search"] += 1
        return [dict(PROFILE)]

    async def internal_get(path, params):
        calls["internal"].append((path, dict(params)))
        return 200, {"attendance": {"available": True, "overall_percentage": 90.0}}

    monkeypatch.setattr(reg, "_admin_core_json", admin_core_json)
    monkeypatch.setattr(ld, "search_learners", search)
    monkeypatch.setattr(ld, "enrolments", lambda c, ids: {i: [{"course": "Biology", "batch": "2026", "batch_id": "ps-1",
                                                              "status": "ACTIVE", "expires_on": "2027-03-31",
                                                              "enrolment_no": "ENR-7"}] for i in ids})
    monkeypatch.setattr(ld, "learner_profile", lambda c, uid: dict(PROFILE) if uid == "u-asha" else None)
    monkeypatch.setattr(lr, "_internal_get", internal_get)
    monkeypatch.setattr(cbd, "_rows", lambda c, sql, params: [])
    return calls


async def run(tool, args, setting, via_mcp=False):
    return json.loads(await reg.execute_tool(tool, args, ctx(via_mcp), setting, in_product=not via_mcp))


async def test_lookups_only_find_uses_the_dashboard_search_with_the_callers_token(backend):
    out = await run("learners", {"action": "find", "query": "asha"}, LOOKUPS_ONLY)
    assert backend["db_search"] == 0
    [call] = backend["dashboard"]
    assert call["path"] == lt.DASHBOARD_SEARCH_PATH and call["token"] == "jwt"
    assert call["body"]["institute_ids"] == ["inst-1"] and call["body"]["name"] == "asha"
    [match] = out["matches"]
    assert match["learner_id"] == "u-asha" and match["batch_id"] == "ps-1" and match["enrolment_no"] == "ENR-7"
    assert match["mobile_number"].endswith("3210") and "9876" not in match["mobile_number"]


@pytest.mark.parametrize("action", ["get", "enroll_options", "enroll_template"])
async def test_lookups_only_callers_get_find_only(backend, action):
    out = await run("learners", {"action": action, "learner_id": "u-asha", "course_ids": ["c-1"]}, LOOKUPS_ONLY)
    assert out["error"] == "tool_not_permitted" and "Learners: view" in out["message"]
    assert not backend["dashboard"]


async def test_with_its_own_group_find_is_the_whole_tool(backend):
    out = await run("learners", {"action": "find", "query": "asha"}, FULL)
    assert backend["db_search"] == 1 and not backend["dashboard"]
    [match] = out["matches"]
    assert match["mobile_number"] == "+919876543210" and match["enrolment_no"] == "ENR-7"
    assert match["courses"][0]["batch_id"] == "ps-1"


async def test_mcp_is_never_narrowed(backend):
    out = await run("learners", {"action": "find", "query": "asha"}, {"enabled_tools": ["learners"]}, via_mcp=True)
    assert backend["db_search"] == 1 and out["matches"][0]["username"] == "asha"


async def test_lookups_only_report_data_has_the_sections_and_no_detail(backend):
    out = await run("learner_report", {"action": "data", "learner_id": "u-asha",
                                       "modules": ["attendance", "learning_insights"],
                                       "detail": ["doubts"]}, LOOKUPS_ONLY)
    assert [path for path, _ in backend["internal"]] == ["student-360"]
    assert backend["internal"][0][1]["modules"] == "attendance"
    assert backend["internal"][0][1]["instituteId"] == "inst-1"
    assert "detail" not in out and out["ignored_modules"] == ["learning_insights"]
    assert "Progress reports: view data" in out["not_included"]


async def test_lookups_only_report_without_modules_reads_the_lookup_sections(backend):
    await run("learner_report", {"action": "data", "learner_id": "u-asha"}, LOOKUPS_ONLY)
    [(path, params)] = backend["internal"]
    assert params["modules"].split(",") == list(lr.LOOKUP_MODULES)


@pytest.mark.parametrize("action", ["saved_reports", "saved_report"])
async def test_lookups_only_callers_do_not_read_saved_reports(backend, action):
    out = await run("learner_report", {"action": action, "learner_id": "u-asha", "report_id": "r-1"}, LOOKUPS_ONLY)
    assert out["error"] == "tool_not_permitted" and "Progress reports: view data" in out["message"]


async def test_with_its_own_group_report_data_includes_the_detail(backend):
    await run("learner_report", {"action": "data", "learner_id": "u-asha"}, FULL)
    assert [path for path, _ in backend["internal"]] == ["student-360", "raw-detail"]


def test_the_assistant_and_mcp_word_learner_report_for_their_door():
    spec = reg.ASSISTANT_TOOLS["learner_report"]
    assert spec.schema_for(via_mcp=True) is lr.LEARNER_REPORT_SCHEMA
    assistant = spec.schema_for()["function"]
    assert "selected student" in assistant["description"] and "['none']" in assistant["description"]
    assert assistant["parameters"] == {
        **lr.LEARNER_REPORT_SCHEMA["function"]["parameters"],
        "properties": assistant["parameters"]["properties"],
    }
    assert set(assistant["parameters"]["properties"]) == set(lr.LEARNER_REPORT_SCHEMA["function"]["parameters"]
                                                             ["properties"])
