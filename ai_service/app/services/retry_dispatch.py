"""Retry dispatch — rebuilds the background work for a failed task from the
params persisted in its dynamic_values_map, so a retry re-runs the exact same
pipeline (with optionally a different model).

Mirrors media_service TaskRetryService.asyncRetryTask, which switched on task
type + the saved dynamic values. Each kickoff stores
dynamic_values_map = {"model": <primary>, "params": {...}}; make_work() reads
`params` and returns the zero-arg coroutine ai_task_service.schedule expects.

Only the task types that surface a "Retry" button in the AI center are
retryable (lecture plan/feedback + the question family). CHAT_WITH_PDF turns are
always stored COMPLETED (a turn never lands as a FAILED row), and the assessment
EVALUATION tool lives on its own route with no retry button — both raise
NotRetryable if ever dispatched here.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional

from . import (
    audio_questions_service,
    lecture_feedback_service,
    lecture_planner_service,
    pdf_questions_service,
    question_gen_service,
)

logger = logging.getLogger(__name__)


class NotRetryable(Exception):
    """Raised for a task type that has no retry pipeline."""


# Question family share the "questions" use case; lecture uses "lecture".
_LECTURE_TYPES = {"LECTURE_PLANNER", "LECTURE_FEEDBACK"}


def use_case_for(task_type: str) -> str:
    return "lecture" if task_type in _LECTURE_TYPES else question_gen_service.QUESTIONS_USE_CASE


def make_work(
    task_type: str,
    params: Dict[str, Any],
    models: List[str],
    *,
    institute_id: Optional[str],
    user_id: Optional[str],
    task_id: str,
) -> Callable[[], Awaitable[str]]:
    """Return the zero-arg coroutine that re-runs `task_type` with `params`."""
    primary = models[0]
    fallbacks = models[1:]
    gen_image = params.get("generateImage", params.get("generate_image", True))

    if task_type == "LECTURE_PLANNER":
        async def work() -> str:
            prompt = lecture_planner_service.build_prompt(
                user_prompt=params.get("userPrompt") or "",
                lecture_duration=params.get("lectureDuration"),
                language=params.get("language"),
                method_of_teaching=params.get("methodOfTeaching"),
                level=params.get("level"),
            )
            result = await lecture_planner_service.generate(
                prompt=prompt, primary_model=primary, fallback_models=fallbacks
            )
            await asyncio.to_thread(
                lecture_planner_service.record_lecture_billing,
                institute_id=institute_id, user_id=user_id, task_id=task_id, result=result,
            )
            return result.content_json
        return work

    if task_type == "LECTURE_FEEDBACK":
        async def work() -> str:
            return await lecture_feedback_service.generate_feedback_result(
                file_id=params.get("fileId"),
                primary_model=primary, fallback_models=fallbacks,
                institute_id=institute_id, user_id=user_id, language=params.get("language"),
            )
        return work

    if task_type == "TEXT_TO_QUESTIONS":
        async def work() -> str:
            num = params.get("num")
            return await question_gen_service.questions_from_text(
                text=params.get("text") or "",
                number_of_questions=str(num) if num is not None else None,
                type_of_question=params.get("question_type"),
                class_level=params.get("class_level"),
                topics=params.get("topics"),
                question_language=params.get("question_language"),
                generate_image=gen_image, models=models,
                institute_id=institute_id, user_id=user_id,
            )
        return work

    if task_type in ("PDF_TO_QUESTIONS", "IMAGE_TO_QUESTIONS"):
        if params.get("tool") == "paper_digitise":
            # An offline-test paper read (paper_digitise). It has no MathPix pdfId to
            # resume from and its own billing/preflight; the generic re-run would fail
            # on a missing pdfId or, worse, bill under the wrong tool.
            raise NotRetryable(
                "This was a question-paper read for an offline test. Re-run it from the "
                "test's create form (Check answer sheets with AI)."
            )

        async def work() -> str:
            html = await pdf_questions_service.fetch_or_convert_html(params.get("pdfId"), allow_poll=True)
            return await question_gen_service.questions_from_html(
                html=html, user_prompt=params.get("userPrompt"), generate_image=gen_image,
                models=models, institute_id=institute_id, user_id=user_id,
            )
        return work

    if task_type == "SORT_QUESTIONS_TOPIC_WISE":
        async def work() -> str:
            html = await pdf_questions_service.fetch_or_convert_html(params.get("pdfId"), allow_poll=True)
            return await question_gen_service.questions_topic_wise(
                html=html, generate_image=gen_image, models=models,
                institute_id=institute_id, user_id=user_id,
            )
        return work

    if task_type == "PDF_TO_QUESTIONS_WITH_TOPIC":
        async def work() -> str:
            html = await pdf_questions_service.fetch_or_convert_html(params.get("pdfId"), allow_poll=True)
            return await question_gen_service.questions_extract_topic(
                html=html, required_topics=params.get("requiredTopics"), generate_image=gen_image,
                models=models, institute_id=institute_id, user_id=user_id,
            )
        return work

    if task_type == "AUDIO_TO_QUESTIONS":
        async def work() -> str:
            return await audio_questions_service.transcribe_and_generate(
                file_id=params.get("fileId"),
                num_questions=params.get("numQuestions"),
                difficulty=params.get("difficulty"),
                language=params.get("language"),
                optional_prompt=params.get("prompt"),
                generate_image=gen_image, models=models,
                institute_id=institute_id, user_id=user_id,
            )
        return work

    raise NotRetryable(f"Task type {task_type} is not retryable")
