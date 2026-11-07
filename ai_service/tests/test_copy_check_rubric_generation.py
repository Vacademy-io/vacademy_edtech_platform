"""Criteria generation (spec 7.4, T0.24, gate G5).

  * The criteria prompt now sees the model answer and the exam context; before
    it saw only the question text.
  * A failed generation never yields a rubric the orchestrator can persist:
    generate() raises, and the single "Correctness" default is used for the
    current run only (no second LLM call), so the next copy tries again
    instead of every later candidate inheriting the fallback.
"""
import asyncio

import pytest

from app.services.copy_check import prompt_builder as pb
from app.services.copy_check.rubric import (
    RubricGenerationFailed,
    RubricResolver,
    RubricSnapshot,
)

GOOD = {"max_marks": 4, "partial_marking_enabled": True, "evaluation_instructions": "",
        "rubric": [{"criteria_name": "Definition", "max_marks": 2}, {"criteria_name": "Example", "max_marks": 2}]}


def _q(**over):
    q = {"question_id": "q1", "question_text": "Explain federalism.", "question_type": "LONG_ANSWER",
         "max_marks": 4}
    q.update(over)
    return q


class _LLM:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.prompts = []

    async def __call__(self, system, user, model):
        self.prompts.append(user)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


# ── prompt ──────────────────────────────────────────────────────────────────

def test_criteria_prompt_carries_model_answer_and_exam_context():
    prompt = pb.build_criteria_prompt(
        subject="Polity", question_type="LONG_ANSWER", max_marks=15, question_text="Discuss Article 356.",
        model_answer="S.R. Bommai (1994) limited the use of Article 356.",
        exam_context={"level": "UPSC GS2", "instructions": "Do not reward length.", "answer_language": "English"},
    )
    assert "S.R. Bommai (1994)" in prompt and "MODEL ANSWER" in prompt
    assert "Level / exam: UPSC GS2" in prompt
    assert "Examiner's instructions: Do not reward length." in prompt
    assert "Answers are written in: English" in prompt
    # The schema instructions still follow the context.
    assert prompt.index("MODEL ANSWER") < prompt.index("Return STRICT JSON")


def test_criteria_prompt_without_context_is_unchanged():
    before = pb.build_criteria_prompt("Science", "LONG_ANSWER", 5, "Why is the sky blue?")
    assert "MODEL ANSWER" not in before and "EXAM CONTEXT" not in before
    assert before == pb.build_criteria_prompt("Science", "LONG_ANSWER", 5, "Why is the sky blue?",
                                              model_answer="  ", exam_context={})


def test_objective_prompt_also_gets_the_context_and_stays_one_criterion():
    prompt = pb.build_criteria_prompt("Science", "MCQS", 1, "Which is a metal?", has_options=True,
                                      model_answer="(b) Copper", exam_context={"level": "Class X"})
    assert "(b) Copper" in prompt and "Level / exam: Class X" in prompt
    assert "Exactly ONE criterion" in prompt


def test_oversized_partner_text_is_clipped():
    prompt = pb.build_criteria_prompt("S", "LONG_ANSWER", 5, "Q", model_answer="a" * 20000,
                                      exam_context={"instructions": "b" * 5000})
    assert "a" * 6000 in prompt and "a" * 6001 not in prompt
    assert "b" * 600 in prompt and "b" * 601 not in prompt


# ── resolver ────────────────────────────────────────────────────────────────

def test_generator_receives_the_model_answer_and_exam_context():
    llm = _LLM(dict(GOOD))
    resolver = RubricResolver(RubricSnapshot(), llm, exam_context={"level": "CBSE Class X", "subject": "Civics"})
    asyncio.run(resolver.generate(_q(model_answer="Power is shared between Union and States.")))
    assert "Power is shared between Union and States." in llm.prompts[0]
    assert "CBSE Class X" in llm.prompts[0]
    # The exam's subject stands in when the question carries none.
    assert "Subject: Civics" in llm.prompts[0]


def test_failed_generation_raises_instead_of_returning_the_default():
    resolver = RubricResolver(RubricSnapshot(), _LLM(RuntimeError("provider 502")))
    with pytest.raises(RubricGenerationFailed):
        asyncio.run(resolver.generate(_q()))
    # Nothing landed in the snapshot the orchestrator persists from.
    assert resolver.snapshot.fixed_rubric == {}


def test_after_a_failed_generate_resolve_uses_the_default_without_another_call():
    llm = _LLM(RuntimeError("provider 502"))
    resolver = RubricResolver(RubricSnapshot(), llm)
    with pytest.raises(RubricGenerationFailed):
        asyncio.run(resolver.generate(_q()))
    rubric = asyncio.run(resolver.resolve(_q()))
    assert [c["criteria_name"] for c in rubric["rubric"]] == ["Correctness"]
    assert rubric["max_marks"] == 4.0
    assert len(llm.prompts) == 1


def test_a_reply_without_rubric_items_counts_as_a_failure():
    for reply in ({"max_marks": 4, "rubric": []}, {"oops": True}, ["not", "a", "dict"]):
        resolver = RubricResolver(RubricSnapshot(), _LLM(reply))
        with pytest.raises(RubricGenerationFailed):
            asyncio.run(resolver.generate(_q()))


def test_resolve_falls_back_for_this_run_when_generation_fails_there():
    resolver = RubricResolver(RubricSnapshot(), _LLM(RuntimeError("timeout")))
    rubric = asyncio.run(resolver.resolve(_q()))
    assert rubric["rubric"][0]["criteria_name"] == "Correctness"
    assert resolver.snapshot.fixed_rubric == {}


def test_stored_rubrics_still_win_and_a_new_resolver_retries_generation():
    snapshot = RubricSnapshot(fixed_rubric={"q2": dict(GOOD)})
    failing = RubricResolver(snapshot, _LLM(RuntimeError("x")))
    assert asyncio.run(failing.resolve(_q(question_id="q2")))["rubric"][0]["criteria_name"] == "Definition"
    with pytest.raises(RubricGenerationFailed):
        asyncio.run(failing.generate(_q()))
    # The next copy (a fresh resolver) is not stuck with the fallback.
    llm = _LLM(dict(GOOD))
    assert asyncio.run(RubricResolver(RubricSnapshot(), llm).resolve(_q()))["rubric"][0]["criteria_name"] == "Definition"
    assert len(llm.prompts) == 1
