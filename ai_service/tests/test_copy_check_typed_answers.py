"""Typed answers (online attempts): an essay or email typed in the test player
is graded from its text - no PDF, no OCR, no annotations - and a blank answer
is zeroed without a model call or a charge."""
import asyncio
import json

import pytest

from app.schemas.copy_check import CopyCheckGradeRequest
from app.services.copy_check import grader as g
from app.services.copy_check import orchestrator
from app.services.copy_check import typed_answers as t


def _q(qid="q1", answer=None, max_marks=10):
    return {
        "question_id": qid,
        "question_text": "Write an email to your principal asking for two days' leave.",
        "question_type": "LONG_ANSWER",
        "max_marks": max_marks,
        "student_answer": answer,
    }


RUBRIC = {
    "max_marks": 10,
    "rubric": [
        {"criteria_name": "Format", "max_marks": 3},
        {"criteria_name": "Content", "max_marks": 4},
        {"criteria_name": "Language", "max_marks": 3},
    ],
}


def test_answer_text_keeps_paragraphs_and_drops_markup():
    raw = "<p>Dear Sir,</p><p>I request&nbsp;leave.<br>Thank you</p>"
    assert t.answer_text(raw) == "Dear Sir,\nI request leave.\nThank you"
    assert t.answer_text(None) == ""
    assert t.answer_text("  <p> </p> ") == ""


def test_prompt_carries_the_typed_answer_and_word_count():
    prompt = t.build_typed_grading_prompt(_q(answer="Dear Sir, please grant me leave."), RUBRIC)
    assert "please grant me leave" in prompt
    assert "(6 words)" in prompt
    assert "transcript" not in prompt.lower()


def test_copy_request_still_needs_a_pdf_but_typed_does_not():
    base = {"process_id": "p", "attempt_id": "a", "assessment_id": "x", "institute_id": "inst",
            "questions": [_q(answer="hi")], "callback_base_url": "http://cb"}
    with pytest.raises(ValueError):
        CopyCheckGradeRequest(**base)
    req = CopyCheckGradeRequest(**base, answer_mode="TYPED")
    assert req.pdf_url is None
    assert req.questions[0].student_answer == "hi"


def test_the_questions_own_answer_reaches_the_prompt_as_the_model_answer():
    q = _q(answer="Dear Sir, leave please.")
    q["model_answer"] = "Subject: Leave application. Respected Sir, ..."
    assert "Subject: Leave application" in t.build_typed_grading_prompt(q, RUBRIC)


class _FakeLLM:
    def __init__(self, reply):
        self.reply = reply
        self.calls = []

    async def chat_completion(self, messages, **kwargs):
        self.calls.append(messages)
        return {"content": json.dumps(self.reply), "usage": {"prompt_tokens": 10, "completion_tokens": 5}}


class _FakeResolver:
    async def resolve(self, q, model):
        return RUBRIC


def _run(questions, reply):
    llm = _FakeLLM(reply)
    grader = g.CopyCheckGrader(llm, token_budget=g.token_budget_for(len(questions)))
    posted = []

    async def on_verdict(v):
        posted.append(v)

    result = asyncio.run(orchestrator._grade_typed(
        questions, _FakeResolver(), grader, None, on_verdict, lambda: None))
    return result, posted, llm


def test_typed_answers_are_graded_and_blank_ones_are_free():
    reply = {
        "marks_awarded": 7, "verdict": "partial", "confidence": 0.9,
        "feedback": "Clear request; add a proper closing.",
        "extracted_answer": "model paraphrase",
        "criteria_breakdown": [
            {"criteria_name": "Format", "marks": 2, "reason": "no closing"},
            {"criteria_name": "Content", "marks": 3, "reason": "ok"},
            {"criteria_name": "Language", "marks": 2, "reason": "ok"},
        ],
        "annotations": [{"style": "tick", "target": "p1_r1"}],
    }
    questions = [_q("q1", "Dear Sir, I need leave for two days."), _q("q2", "  ")]
    (awarded, max_marks, evaluated, graded), posted, llm = _run(questions, reply)

    assert (awarded, max_marks, evaluated, graded) == (7.0, 20.0, 2, 1)
    assert len(llm.calls) == 1  # the blank answer never reached the model
    first, second = posted
    assert first["marks_awarded"] == 7.0 and first["status"] == "COMPLETED"
    assert first["extracted_answer"] == "Dear Sir, I need leave for two days."
    assert first["annotations"] == []
    assert llm.calls[0][0]["content"] == t.TYPED_GRADING_SYSTEM
    assert second["verdict"] == "unattempted" and second["marks_awarded"] == 0.0


def test_marks_are_capped_at_the_question_maximum():
    reply = {"marks_awarded": 14, "confidence": 0.9, "feedback": "x", "criteria_breakdown": []}
    (awarded, _, _, _), posted, _ = _run([_q(answer="An essay.")], reply)
    assert awarded == 10.0 and posted[0]["marks_awarded"] == 10.0
