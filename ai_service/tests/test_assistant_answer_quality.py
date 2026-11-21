"""
Answer-quality fixes in the Vacademy Assistant.

Pinned here:
- assessment results ask for participants the way the Submissions tab does (one registration
  source per request, a single attempt type, no sort) and merge the lists: batch + individual
  for a private test, plus the public link for a public test; one failing list still answers;
- the institute overview says when no fees are recorded instead of reporting nothing pending;
- a question refused for credits or a usage limit keeps the refusal as its answer.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402

from app.services import assistant_tool_registry as reg  # noqa: E402
from app.services import assistant_service as asv  # noqa: E402
from crm_fakes import principal  # noqa: E402
from test_assistant_suggestions import _Turn  # noqa: E402


def _ctx():
    return SimpleNamespace(principal=principal(user_id="u-1", roles=("ADMIN",)), bearer_token="jwt")


class _Backend:
    """Records participant requests; answers per registration source."""

    def __init__(self, pages=None, fail=()):
        self.calls, self.pages, self.fail = [], dict(pages or {}), set(fail)

    async def __call__(self, ctx, method, path, params=None, body=None, **kw):
        self.calls.append({"path": path, "params": params, "body": body})
        source = body["registration_source"]
        if source in self.fail:
            return {"error": "fetch_failed", "status": 500}
        rows = self.pages.get(source, [])
        return {"content": rows, "totalElements": len(rows)}


def _row(name, status="PENDING"):
    return {"user_id": f"id-{name}", "student_name": name, "batch_id": "b-1", "attempt_date": "2026-11-19",
            "score": 4, "evaluation_status": status, "report_release_result_status": "PENDING"}


async def test_a_private_test_asks_for_batch_and_individual_learners_like_the_submissions_tab(monkeypatch):
    backend = _Backend(pages={"BATCH_PREVIEW_REGISTRATION": [_row("A")], "ADMIN_PRE_REGISTRATION": [_row("B")]})
    monkeypatch.setattr(reg, "_assessment_json", backend)
    out = json.loads(await reg._execute_get_assessment_results(
        {"assessment_id": "t-1", "visibility": "PRIVATE", "evaluation_status": "PENDING"}, _ctx()))
    sources = [c["body"]["registration_source"] for c in backend.calls]
    assert sorted(sources) == ["ADMIN_PRE_REGISTRATION", "BATCH_PREVIEW_REGISTRATION"]
    for call in backend.calls:
        body = call["body"]
        assert isinstance(body["registration_source"], str)
        assert body["attempt_type"] == ["ENDED"] and body["evaluation_status"] == ["PENDING"]
        assert body["sort_columns"] == {} and body["assessment_type"] == "PRIVATE"
        assert call["params"]["instituteId"] == "inst-1" and call["params"]["assessmentId"] == "t-1"
    assert [p["name"] for p in out["participants"]] == ["A", "B"]
    assert out["total_matching"] == 2 and "partial" not in out


async def test_a_public_test_also_includes_people_from_the_public_link(monkeypatch):
    backend = _Backend(pages={"OPEN_REGISTRATION": [_row("C")]})
    monkeypatch.setattr(reg, "_assessment_json", backend)
    out = json.loads(await reg._execute_get_assessment_results(
        {"assessment_id": "t-2", "visibility": "public", "attempt_state": "not_attempted"}, _ctx()))
    assert {c["body"]["registration_source"] for c in backend.calls} == {
        "BATCH_PREVIEW_REGISTRATION", "ADMIN_PRE_REGISTRATION", "OPEN_REGISTRATION"}
    assert all(c["body"]["attempt_type"] == ["PENDING"] for c in backend.calls)
    assert all(c["body"]["assessment_type"] == "PUBLIC" for c in backend.calls)
    assert [p["name"] for p in out["participants"]] == ["C"]


async def test_one_failing_list_still_answers_and_says_it_may_be_incomplete(monkeypatch):
    backend = _Backend(pages={"BATCH_PREVIEW_REGISTRATION": [_row("A")]}, fail={"ADMIN_PRE_REGISTRATION"})
    monkeypatch.setattr(reg, "_assessment_json", backend)
    out = json.loads(await reg._execute_get_assessment_results({"assessment_id": "t-1"}, _ctx()))
    assert [p["name"] for p in out["participants"]] == ["A"] and out["partial"]


async def test_when_every_list_fails_the_error_is_reported(monkeypatch):
    backend = _Backend(fail={"BATCH_PREVIEW_REGISTRATION", "ADMIN_PRE_REGISTRATION"})
    monkeypatch.setattr(reg, "_assessment_json", backend)
    out = json.loads(await reg._execute_get_assessment_results({"assessment_id": "t-1"}, _ctx()))
    assert out["error"] == "fetch_failed"


async def test_more_pages_are_flagged(monkeypatch):
    rows = [_row(str(i)) for i in range(15)]

    async def backend(ctx, method, path, params=None, body=None, **kw):
        if body["registration_source"] == "BATCH_PREVIEW_REGISTRATION":
            return {"content": rows, "totalElements": 40}
        return {"content": [], "totalElements": 0}

    monkeypatch.setattr(reg, "_assessment_json", backend)
    out = json.loads(await reg._execute_get_assessment_results({"assessment_id": "t-1"}, _ctx()))
    assert out["total_matching"] == 40 and out["has_more"] is True and len(out["participants"]) == 15


@pytest.mark.parametrize("dashboard, expect_note", [
    ({"totalOverdue": 0, "collectedToDate": 0, "expectedToDate": 0}, True),
    ({"totalOverdue": None, "collectedToDate": None, "expectedToDate": "0.0"}, True),
    ({"totalOverdue": 0, "collectedToDate": 6500.0, "expectedToDate": 4500.0}, False),
])
async def test_the_overview_says_when_no_fees_are_recorded(monkeypatch, dashboard, expect_note):
    async def admin_core(ctx, method, path, **kw):
        return dashboard

    monkeypatch.setattr(reg, "_admin_core_json", admin_core)
    out = json.loads(await reg._execute_get_institute_overview({"sections": ["outstanding_fees"]}, _ctx()))
    note = out["outstanding_fees"]["note"]
    assert ("not tracked here" in note) is expect_note


async def test_a_credit_refusal_is_kept_as_the_answer(monkeypatch):
    turn = _Turn(monkeypatch, script=["never asked"])
    monkeypatch.setattr(asv, "CreditService", lambda db: SimpleNamespace(
        check_credits=lambda req: SimpleNamespace(has_sufficient_credits=False)))
    events = await turn.ask("How do I invite a team member?")
    assert any(e["event"] == "error" and e["data"]["code"] == 402 for e in events)
    saved = turn.saved()
    assert "credits are exhausted" in saved.content and saved.meta_data == {"refused": "credits"}
    assert _Turn.final(events)["content"] == saved.content
    assert turn.prompts == []  # the model was never called


async def test_a_usage_limit_refusal_is_kept_as_the_answer(monkeypatch):
    turn = _Turn(monkeypatch, script=["never asked"])

    def limited(req):
        raise RuntimeError("limit")

    monkeypatch.setattr(asv, "CreditService", lambda db: SimpleNamespace(check_credits=limited))
    monkeypatch.setattr(asv, "_usage_limit_body", lambda e: {"message": "Daily AI limit reached."})
    events = await turn.ask("Who joined this week?")
    assert any(e["event"] == "error" and e["data"]["code"] == 429 for e in events)
    saved = turn.saved()
    assert saved.content == "Daily AI limit reached." and saved.meta_data == {"refused": "usage_limit"}
    assert turn.prompts == []


async def test_a_broken_credit_check_still_lets_the_question_through(monkeypatch):
    turn = _Turn(monkeypatch, script=["Here is how."])

    def broken(req):
        raise RuntimeError("db down")

    monkeypatch.setattr(asv, "CreditService", lambda db: SimpleNamespace(check_credits=broken))
    monkeypatch.setattr(asv, "_usage_limit_body", lambda e: None)
    events = await turn.ask("How do I invite a team member?")
    assert _Turn.final(events)["content"] == "Here is how."
