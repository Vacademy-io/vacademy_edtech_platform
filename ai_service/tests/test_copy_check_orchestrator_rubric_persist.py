"""The orchestrator's up-front rubric step (spec 7.4, T0.24, gate G5).

Before: a failed criteria call returned the single "Correctness" rubric, and
the orchestrator persisted it, so every later candidate on that exam was
graded against the fallback. Now only a real generated rubric is persisted; a
failure grades this copy with the default and leaves the store untouched.
The model answer stored with the rubric reaches the criteria prompt, and the
request's exam_context reaches the generator.
"""
import asyncio
from types import SimpleNamespace

import pytest

from app.services.copy_check import orchestrator
from app.services.copy_check.rubric import RubricSnapshot

GOOD = {"max_marks": 5, "partial_marking_enabled": True, "evaluation_instructions": "",
        "rubric": [{"criteria_name": "Point A", "max_marks": 3}, {"criteria_name": "Point B", "max_marks": 2}]}


class _Cancelled(Exception):
    pass


class _FakeRepo:
    merges = []

    def __init__(self, db):
        pass

    def merge_generated_rubrics(self, assessment_id, institute_id, generated):
        _FakeRepo.merges.append((assessment_id, institute_id, dict(generated)))
        return dict(generated)

    def get(self, assessment_id):
        return SimpleNamespace(rubric_version=7)


def _payload(**over):
    payload = {
        "process_id": "p1", "attempt_id": "a1", "assessment_id": "asmt-1", "institute_id": "inst-1",
        "answer_mode": "TYPED", "pdf_url": None, "preferred_model": None, "callback_base_url": "http://cb",
        "exam_context": {"level": "CBSE Class X", "subject": "Science"},
        "questions": [{"question_id": "q1", "question_text": "Explain refraction.", "question_type": "LONG_ANSWER",
                       "max_marks": 5, "student_answer": "Light bends."}],
    }
    payload.update(over)
    return payload


@pytest.fixture
def harness(monkeypatch):
    _FakeRepo.merges = []
    state = {"criteria_replies": [], "criteria_prompts": [], "resolved": [], "failed": []}

    async def fake_criteria(llm, system, user, model, institute_id, token_sink=None):
        state["criteria_prompts"].append(user)
        reply = state["criteria_replies"].pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    async def fake_grade_typed(questions, rubric_resolver, grader, preferred_model, on_verdict, check_cancelled):
        for q in questions:
            state["resolved"].append(await rubric_resolver.resolve(q, preferred_model))
        return 0.0, 5.0, len(questions), len(questions)

    async def _noop(*args, **kwargs):
        return None

    async def _failed(*args, **kwargs):
        state["failed"].append(args)

    snapshot = RubricSnapshot(model_answers={"q1": "Refraction is the bending of light at a boundary."})
    monkeypatch.setattr(orchestrator, "load_snapshot", lambda db, assessment_id: snapshot)
    monkeypatch.setattr(orchestrator, "call_llm_for_criteria", fake_criteria)
    monkeypatch.setattr(orchestrator, "_grade_typed", fake_grade_typed)
    monkeypatch.setattr(orchestrator, "CopyCheckRubricRepository", _FakeRepo)
    monkeypatch.setattr(orchestrator, "ChatLLMClient", lambda resolver: object())
    monkeypatch.setattr(orchestrator, "ApiKeyResolver", lambda db: object())
    monkeypatch.setattr(orchestrator, "CopyCheckGrader",
                        lambda *a, **k: SimpleNamespace(tokens_used=0, prompt_tokens=0, completion_tokens=0))
    monkeypatch.setattr(orchestrator, "token_budget_for", lambda n: 100000)
    monkeypatch.setattr(orchestrator, "MathpixFallback", lambda: SimpleNamespace(used=0))
    monkeypatch.setattr(orchestrator, "record_tool_billing", lambda **kw: None)
    monkeypatch.setattr(orchestrator, "callbacks", SimpleNamespace(
        progress=_noop, question_done=_noop, complete=_noop, failed=_failed))
    monkeypatch.setattr(orchestrator, "cancellation", SimpleNamespace(
        Cancelled=_Cancelled, check=lambda *a: None, is_cancelled=lambda *a: False, cleanup=lambda *a, **k: None))
    monkeypatch.setattr(orchestrator, "OcrCancelled", type("OcrCancelled", (Exception,), {}))
    return state


def _run(payload):
    asyncio.run(orchestrator.run(payload, "job-1", SimpleNamespace(close=lambda: None)))


def test_failed_generation_is_not_persisted_and_the_copy_still_grades(harness):
    harness["criteria_replies"] = [RuntimeError("provider 502")]
    _run(_payload())
    assert _FakeRepo.merges == []
    assert [c["criteria_name"] for c in harness["resolved"][0]["rubric"]] == ["Correctness"]
    # One criteria call only: the run-only fallback is reused by resolve().
    assert len(harness["criteria_prompts"]) == 1
    assert harness["failed"] == []


def test_successful_generation_is_persisted_and_saw_model_answer_and_context(harness):
    harness["criteria_replies"] = [dict(GOOD)]
    _run(_payload())
    assert len(_FakeRepo.merges) == 1
    assert _FakeRepo.merges[0][1] == "inst-1"
    assert [c["criteria_name"] for c in _FakeRepo.merges[0][2]["q1"]["rubric"]] == ["Point A", "Point B"]
    prompt = harness["criteria_prompts"][0]
    assert "Refraction is the bending of light at a boundary." in prompt
    assert "CBSE Class X" in prompt
    assert [c["criteria_name"] for c in harness["resolved"][0]["rubric"]] == ["Point A", "Point B"]
