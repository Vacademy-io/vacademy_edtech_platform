"""Rubric resolution: stored rubrics first, fall back to LLM-derived.

Resolution order (as RubricResolver.resolve() implements it):
  1. CopyCheckQuestionAnswer.step_rubric_json — per-question override
  2. CopyCheckRubric.rubric_json[question_id] — the assessment's rubric
     (teacher/partner-authored, or generated once and persisted by the
     orchestrator so every copy grades against the same criteria)
  3. LLM-derived — generated from the question, its model answer and the exam
     context. A failed generation falls back to a single "Correctness"
     criterion for the current run only; that fallback is never persisted, so
     the next copy tries generation again instead of inheriting it.

DB lifecycle: callers pre-load the assessment's fixed rubric + per-question
overrides into a RubricSnapshot at the top of the pipeline, then close the
session immediately so it isn't held across the (potentially minute-long)
OCR + LLM calls (#17). The resolver itself takes only the snapshot.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy.orm import Session

from ...repositories.copy_check_question_answer_repository import (
    CopyCheckQuestionAnswerRepository,
)
from ...repositories.copy_check_rubric_repository import CopyCheckRubricRepository
from .prompt_builder import CRITERIA_SYSTEM, build_criteria_prompt

logger = logging.getLogger(__name__)


@dataclass
class RubricSnapshot:
    """Plain-data view of the rubric state for one assessment. Built once at
    the start of `run()` so the DB session can be closed immediately."""

    rubric_version: Optional[int] = None
    fixed_rubric: dict[str, Any] = field(default_factory=dict)  # question_id -> CriteriaRubricDto
    per_question_overrides: dict[str, dict[str, Any]] = field(default_factory=dict)
    # question_id -> teacher-authored model answer text. Fed to the grader as a
    # reference for what a full-marks answer contains (previously stored but
    # never read by grading).
    model_answers: dict[str, str] = field(default_factory=dict)


def load_snapshot(db: Session, assessment_id: str) -> RubricSnapshot:
    """Eagerly load everything the pipeline needs from DB so the session can
    be closed before the long-running OCR/LLM calls begin."""
    snapshot = RubricSnapshot()
    rubric_repo = CopyCheckRubricRepository(db)
    qa_repo = CopyCheckQuestionAnswerRepository(db)

    fixed = rubric_repo.get(assessment_id)
    if fixed is not None:
        snapshot.rubric_version = fixed.rubric_version
        try:
            snapshot.fixed_rubric = json.loads(fixed.rubric_json) if fixed.rubric_json else {}
        except Exception as e:
            logger.warning(f"Bad rubric_json for {assessment_id}: {e}")
        # Assessment-level model answers (per-question CopyCheckQuestionAnswer
        # entries below override these).
        try:
            if fixed.model_answers_json:
                answers = json.loads(fixed.model_answers_json)
                if isinstance(answers, dict):
                    snapshot.model_answers.update({k: v for k, v in answers.items() if v})
        except Exception as e:
            logger.warning(f"Bad model_answers_json for {assessment_id}: {e}")

    for qa in qa_repo.list_for_assessment(assessment_id):
        if qa.step_rubric_json:
            try:
                snapshot.per_question_overrides[qa.question_id] = json.loads(qa.step_rubric_json)
            except Exception as e:
                logger.warning(
                    f"Bad step_rubric_json for {assessment_id}/{qa.question_id}: {e}"
                )
        if qa.model_answer:
            snapshot.model_answers[qa.question_id] = qa.model_answer
    return snapshot


def _normalize_marks(rubric: dict[str, Any], max_marks: float) -> dict[str, Any]:
    """Scale rubric[].max_marks so they sum to max_marks. The LLM occasionally
    drifts; this keeps grading consistent with the question's stated max."""
    items = rubric.get("rubric") or []
    total = sum(float(it.get("max_marks", 0)) for it in items)
    if total <= 0:
        return rubric
    if abs(total - max_marks) < 0.01:
        rubric["max_marks"] = max_marks
        return rubric
    factor = max_marks / total
    for it in items:
        it["max_marks"] = round(float(it.get("max_marks", 0)) * factor, 2)
    rubric["max_marks"] = max_marks
    return rubric


class RubricGenerationFailed(Exception):
    """The criteria LLM call failed or returned no usable rubric."""


class RubricResolver:
    def __init__(self, snapshot: RubricSnapshot, llm_call, exam_context: Optional[dict[str, Any]] = None):
        """
        snapshot: pre-loaded RubricSnapshot (see load_snapshot) — no DB
            session held by the resolver.
        llm_call: async callable matching grader.call_llm_json signature:
            await llm_call(system: str, user: str, model: Optional[str]) -> dict
        Injected so this module doesn't depend on grader, avoiding a cycle.
        exam_context: {"level","subject","instructions","answer_language"}
            from the grade request, shown to the criteria generator.
        """
        self.snapshot = snapshot
        self.llm_call = llm_call
        self.exam_context = exam_context or None
        # question_id -> the default rubric used after a failed generation in
        # THIS run. Kept out of the snapshot's fixed_rubric so nothing persists it.
        self._run_only_fallbacks: dict[str, dict[str, Any]] = {}

    def has_rubric(self, question_id: str) -> bool:
        """True if a pre-authored / already-persisted rubric exists for this
        question (override or fixed) — i.e. no LLM generation is needed."""
        if self.snapshot.per_question_overrides.get(question_id) is not None:
            return True
        return bool(self.snapshot.fixed_rubric) and self.snapshot.fixed_rubric.get(question_id) is not None

    async def generate(
        self,
        question: dict[str, Any],
        preferred_model: Optional[str] = None,
    ) -> dict[str, Any]:
        """Public entry for pre-generating a rubric up front (the orchestrator
        persists it so every student's job reuses the same criteria).

        Raises RubricGenerationFailed instead of returning the default rubric,
        so the caller cannot persist a fallback for every later candidate. The
        failure is remembered for this run: resolve() then uses the default
        without a second LLM call.
        """
        try:
            return await self._generate(question, preferred_model)
        except RubricGenerationFailed:
            self._run_only_fallbacks[question["question_id"]] = _default_rubric(
                float(question.get("max_marks") or 10)
            )
            raise

    async def resolve(
        self,
        question: dict[str, Any],
        preferred_model: Optional[str] = None,
    ) -> dict[str, Any]:
        question_id = question["question_id"]
        max_marks = float(question.get("max_marks") or 10)

        # 1. Per-question override (pre-loaded).
        override = self.snapshot.per_question_overrides.get(question_id)
        if override is not None:
            return _normalize_marks(override, max_marks)

        # 2. Assessment-level fixed rubric (pre-loaded). After the orchestrator's
        # up-front generate-and-persist step, generated rubrics live here too, so
        # every student's job resolves the same criteria instead of re-inventing.
        fixed = self.snapshot.fixed_rubric.get(question_id) if self.snapshot.fixed_rubric else None
        if fixed is not None:
            return _normalize_marks(fixed, max_marks)

        # 3. Generation already failed in this run: the run-only default.
        fallback = self._run_only_fallbacks.get(question_id)
        if fallback is not None:
            return dict(fallback)

        # 4. LLM-derived (generation was not attempted up front, or persisting
        # it failed). A failure here grades this copy with the default rubric.
        try:
            return await self._generate(question, preferred_model)
        except RubricGenerationFailed:
            fallback = _default_rubric(max_marks)
            self._run_only_fallbacks[question_id] = fallback
            return dict(fallback)

    async def _generate(
        self,
        question: dict[str, Any],
        preferred_model: Optional[str],
    ) -> dict[str, Any]:
        context = self.exam_context or {}
        prompt = build_criteria_prompt(
            subject=question.get("subject") or context.get("subject") or "General",
            question_type=question.get("question_type", "LONG_ANSWER"),
            max_marks=float(question.get("max_marks") or 10),
            question_text=question["question_text"],
            has_options=bool(question.get("options")),
            model_answer=question.get("model_answer"),
            exam_context=self.exam_context,
        )
        try:
            data = await self.llm_call(CRITERIA_SYSTEM, prompt, preferred_model)
        except Exception as e:
            logger.exception("Criteria generation failed for question %s", question.get("question_id"))
            raise RubricGenerationFailed(str(e)) from e
        if not isinstance(data, dict) or not isinstance(data.get("rubric"), list) or not data["rubric"]:
            logger.warning("Criteria generation for question %s returned no rubric", question.get("question_id"))
            raise RubricGenerationFailed("criteria reply had no rubric items")
        return _normalize_marks(data, float(question.get("max_marks") or 10))


def _default_rubric(max_marks: float) -> dict[str, Any]:
    return {
        "max_marks": max_marks,
        "partial_marking_enabled": True,
        "evaluation_instructions": "Award marks based on correctness and completeness.",
        "rubric": [
            {
                "criteria_name": "Correctness",
                "max_marks": max_marks,
                "keywords": [],
                "evaluation_guidelines": "Award proportional to how correct and complete the answer is.",
            }
        ],
    }


