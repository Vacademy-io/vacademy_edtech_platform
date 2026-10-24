"""
`learner_report` over MCP: the data behind a learner's progress report, for the
connected AI app to write the report itself.

Pins down: no model is called (only the two deterministic admin-core endpoints);
the institute is always the pinned one, never model-supplied; the learner is the
one named (not the connected admin); a learner / report outside the institute is
refused; and the detail defaults leave the large per-question input out.
"""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import assistant_tools_learner_report as lr  # noqa: E402
from app.services import course_builder_data as cbd  # noqa: E402
from app.services import learner_data as ld  # noqa: E402
from app.services.assistant_tool_registry import ASSISTANT_TOOLS, ToolContext, execute_tool  # noqa: E402


class _FakeDb:
    def execute(self, stmt, params=None):
        return SimpleNamespace(first=lambda: None, fetchall=lambda: [])

    def rollback(self):
        pass


def ctx(user_id="admin-1"):
    return ToolContext(db=_FakeDb(), principal=PinnedPrincipal(user_id=user_id, institute_id="inst-1",
                                                               roles=["ADMIN"], permissions=[], is_root_user=False),
                       keys=(), bearer_token="jwt")


LEARNERS = {"u-asha": {"user_id": "u-asha", "full_name": "Asha Rao"},
            "admin-1": {"user_id": "admin-1", "full_name": "The Admin"}}

REPORT = {"student": {"name": "Asha Rao", "avatar_url": None},
          "attendance": {"available": True, "overall_percentage": 80.0, "note": None, "weekly": []},
          "academics": {"available": False}}
DETAIL = {"window": {"start_date": "2026-09-01", "end_date": "2026-09-30"},
          "doubts": {"doubts": [{"question": "Why is the sky blue?", "status": "RESOLVED"}], "total": 1}}


class Backend:
    def __init__(self):
        self.calls = []
        self.status = {"student-360": 200, "raw-detail": 200}
        self.saved = []

    async def get(self, path, params):
        self.calls.append((path, dict(params)))
        code = self.status[path]
        return code, ((REPORT if path == "student-360" else DETAIL) if code == 200 else None)

    def rows(self, c, sql, params):
        self.saved.append(params)
        if "report_json" in sql:
            if params["id"] == "rep-1" and params["inst"] == "inst-1":
                return [{"id": "rep-1", "user_id": "u-asha", "name": "September", "start_date_iso": "2026-09-01",
                         "end_date_iso": "2026-09-30", "report_version": "v2", "created_at": "2026-10-01 10:00:00",
                         "report_json": json.dumps({"overview": {"overall_status": "On Track", "one_line": None}})}]
            return []
        return [{"id": "rep-1", "name": "September", "start_date_iso": "2026-09-01", "end_date_iso": "2026-09-30",
                 "report_version": "v2", "created_at": "2026-10-01 10:00:00", "total": 1}]


@pytest.fixture
def backend(monkeypatch):
    b = Backend()
    monkeypatch.setattr(lr, "_internal_get", b.get)
    monkeypatch.setattr(ld, "learner_profile", lambda c, uid: LEARNERS.get(str(uid)))
    monkeypatch.setattr(cbd, "_rows", b.rows)
    return b


async def run(args, c=None):
    return json.loads(await lr.execute_learner_report(args, c or ctx()))


async def test_data_reads_both_endpoints_with_the_pinned_institute(backend):
    out = await run({"action": "data", "learner_id": "u-asha", "start_date": "2026-09-01",
                     "end_date": "2026-09-30", "institute_id": "inst-OTHER"})
    paths = {p: params for p, params in backend.calls}
    assert set(paths) == {"student-360", "raw-detail"}
    for params in paths.values():
        assert params["userId"] == "u-asha" and params["instituteId"] == "inst-1"
        assert params["startDate"] == "2026-09-01" and params["endDate"] == "2026-09-30"
    assert "modules" not in paths["student-360"]  # all modules
    assert paths["raw-detail"]["parts"].split(",") == list(lr.DEFAULT_DETAIL_PARTS)
    assert "attempt_details" not in paths["raw-detail"]["parts"]
    assert paths["raw-detail"]["attemptLimit"] == lr.DEFAULT_ATTEMPTS
    assert out["learner"] == {"learner_id": "u-asha", "full_name": "Asha Rao"}
    # nulls / empties pruned so the context stays lean
    assert "avatar_url" not in out["report"]["student"] and "weekly" not in out["report"]["attendance"]
    assert out["detail"]["doubts"]["doubts"][0]["question"] == "Why is the sky blue?"


async def test_data_scopes_modules_detail_and_attempts(backend):
    await run({"action": "data", "learner_id": "u-asha", "modules": ["academics", "nope"],
               "detail": ["attempt_details", "bogus"], "attempt_limit": 500, "batch_id": "ps-9"})
    paths = {p: params for p, params in backend.calls}
    assert paths["student-360"]["modules"] == "academics"
    assert paths["raw-detail"]["parts"] == "attempt_details"
    assert paths["raw-detail"]["attemptLimit"] == lr.MAX_ATTEMPTS
    assert paths["student-360"]["batchId"] == paths["raw-detail"]["batchId"] == "ps-9"
    assert "startDate" not in paths["student-360"]  # admin-core defaults to the last 30 days


async def test_detail_none_skips_the_raw_detail_call(backend):
    out = await run({"action": "data", "learner_id": "u-asha", "detail": ["none"]})
    assert [p for p, _ in backend.calls] == ["student-360"]
    assert "detail" not in out


async def test_unknown_learner_and_bad_windows_never_call_admin_core(backend):
    assert (await run({"action": "data", "learner_id": "u-stranger"}))["error"] == "unknown_learner"
    assert (await run({"action": "data"}))["error"] == "missing_learner_id"
    assert (await run({"action": "data", "learner_id": "u-asha", "start_date": "01/09/2026"}))["error"] == "bad_date"
    assert (await run({"action": "data", "learner_id": "u-asha", "start_date": "2026-09-30",
                       "end_date": "2026-09-01"}))["error"] == "bad_window"
    assert (await run({"action": "data", "learner_id": "u-asha", "start_date": "2024-01-01",
                       "end_date": "2026-09-01"}))["error"] == "window_too_long"
    assert backend.calls == []


async def test_admin_core_404_is_reported_as_not_in_institute(backend):
    backend.status["student-360"] = 404
    backend.status["raw-detail"] = 404
    out = await run({"action": "data", "learner_id": "u-asha", "batch_id": "ps-foreign"})
    assert out["error"] == "not_found"


async def test_a_failed_detail_call_still_returns_the_report(backend):
    backend.status["raw-detail"] = 500
    out = await run({"action": "data", "learner_id": "u-asha"})
    assert out["report"]["attendance"]["overall_percentage"] == 80.0
    assert out["detail"]["error"] == "fetch_failed"


async def test_saved_reports_are_scoped_to_the_institute(backend):
    listed = await run({"action": "saved_reports", "learner_id": "u-asha"})
    assert listed["reports"][0]["report_id"] == "rep-1" and listed["total"] == 1
    assert backend.saved[-1]["inst"] == "inst-1" and backend.saved[-1]["uid"] == "u-asha"
    one = await run({"action": "saved_report", "report_id": "rep-1"})
    assert one["report"] == {"overview": {"overall_status": "On Track"}}
    assert (await run({"action": "saved_report", "report_id": "rep-other"}))["error"] == "unknown_report"


async def test_through_the_runner_the_target_is_the_learner_not_the_admin(backend):
    """execute_tool forces args['user_id'] = the caller; learner_id must win."""
    setting = {"enabled_tools": ["learner_reports"], "role_overrides": {}}
    out = json.loads(await execute_tool("learner_report", {"action": "data", "learner_id": "u-asha",
                                                           "detail": ["none"]}, ctx(), setting))
    assert out["learner"]["learner_id"] == "u-asha"
    assert backend.calls[0][1]["userId"] == "u-asha"


async def test_gated_by_its_own_group():
    from app.mcp.constants import MCP_ALLOWED_WRITE_TOOLS, MCP_EXPOSED_TOOLS
    spec = ASSISTANT_TOOLS["learner_report"]
    assert "learner_report" in MCP_EXPOSED_TOOLS and "learner_report" not in MCP_ALLOWED_WRITE_TOOLS
    assert spec.mode == "READ" and spec.setting_key == "learner_reports" and not spec.default_enabled
    # "Learners: view" alone does not open academic data.
    denied = json.loads(await execute_tool("learner_report", {"action": "guide"}, ctx(),
                                           {"enabled_tools": ["learners"], "role_overrides": {}}))
    assert "error" in denied


async def test_guide_lists_every_module_and_part(backend):
    out = await run({"action": "guide"})
    assert out["modules"] == list(lr.REPORT_MODULES) and out["detail_parts"] == list(lr.DETAIL_PARTS)
    for part in lr.DETAIL_PARTS:
        assert f"detail.{part}" in out["guide"]["fields"]
    assert backend.calls == []
