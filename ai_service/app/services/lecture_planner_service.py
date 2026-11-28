"""
LecturePlannerService — the LLM half of the migrated lecture planner.

Replaces media_service DeepSeekLectureService, with the model id resolved from
the DB-backed registry (/models/v2) instead of the hardcoded
`google/gemini-2.5-flash-preview-09-2025` string that caused the prod 404.

The prompt template and field defaults are copied verbatim from
media_service ConstantAiTemplate#getLecturePlannerTemplate and
DeepSeekLectureService so the generated JSON shape matches LecturePlanDto.

Model resolution, the prompt→JSON LLM call, and usage/credit billing are all
delegated to the shared foundation modules (model_selection, llm_json,
ai_billing) used by every migrated feature.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from ..models.ai_token_usage import RequestType
# Re-exported so existing callers/tests can use lecture_planner_service.extract_and_sanitize_json.
from ..utils.json_extract import extract_and_sanitize_json  # noqa: F401
from . import ai_billing, llm_json
from .ai_billing import metering_user
from .model_selection import resolve_models

logger = logging.getLogger(__name__)

LECTURE_USE_CASE = "lecture"


@dataclass
class LectureGenerationResult:
    """Output of a successful lecture generation: the sanitized JSON plus the
    model actually used and its token usage (for billing/usage logging)."""
    content_json: str
    model_used: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


# Verbatim from ConstantAiTemplate#getLecturePlannerTemplate (Java uses Spring
# PromptTemplate {placeholder} substitution; we use str.format with the same
# names, doubling the literal JSON braces for Python formatting).
_TEMPLATE = """User Prompt: {userPrompt}
        Lecture Duration: {lectureDuration}
        language: {language}
        Method Of Teaching: {methodOfTeaching}
        Class Level: {level}

        Prompt:
         -Generate a Lecture Plan Using User Prompt and follow the {methodOfTeaching} method with following Json Format:
         -Planing should be of {lectureDuration} in {language} and Class Level is {level}.


        Json Format:
            {{
               "heading":"String",  //Provide Heading of the Lecture
               "mode": {methodOfTeaching},
               "duration": {lectureDuration},
               "language": {language},
               "level": {level},
               "timeWiseSplit":[
                               {{
                                   "sectionHeading": "String" //Include section heading
                                   "timeSplit":"String",   //Include Splitted Time e.g - 1-5mins, 2-10mins (Split the time according to the section) more time for more important section and less time for less important section
                                   "content":"String",     //Provide a long, content as if a teacher is explaining it to {level} students in class. The explanation must be detailed enough to cover the entire allocated time slot (e.g. for 1-10 mins, write 500+ words). Use simple, engaging language, examples, analogies to explain the topic clearly and interestingly.
                                   "topicCovered":["String"],  //Include the topic covered in this section
                                   "questionToStudents":["String"],  //Include Question which should be asked to students during teaching this section
                                   "activity":["String"]  //Include activities which can be performed during teaching this section if possible
                                }}
                                ],
               "assignment":{{
                               "topicCovered":["String"], //Include topic covered in assignments
                               "tasks":["String"], //Include Tasks which student have to complete as Homework
                             }},
               "summary": ["String"]   //Provide summary of the lecture plan (Not the summary of topic but the plan)
            }}


            Rules To be followed while generating plan:
            - timeWiseSplit should cover {lectureDuration}
            - content in each timeWiseSplit should be descriptive and it should cover the timeSplit

            Important: {userPrompt}
"""


def resolve_model(db: Session, preferred_model: Optional[str]) -> Tuple[str, List[str]]:
    """Resolve (primary_model, [fallback_models]) for lecture generation via the
    shared registry resolver (use case 'lecture')."""
    return resolve_models(db, LECTURE_USE_CASE, preferred_model)


def build_prompt(
    *,
    user_prompt: str,
    lecture_duration: str,
    language: Optional[str],
    method_of_teaching: Optional[str],
    level: Optional[str],
) -> str:
    # Defaults copied from DeepSeekLectureService.generateLecturePlannerFromPrompt.
    return _TEMPLATE.format(
        userPrompt=user_prompt,
        lectureDuration=lecture_duration,
        language=language if language else "en",
        methodOfTeaching=method_of_teaching if method_of_teaching else "Concept First",
        level=level if level else "",
    )


async def generate(
    *,
    prompt: str,
    primary_model: str,
    fallback_models: List[str],
) -> LectureGenerationResult:
    """Call the LLM (primary then fallbacks) and return sanitized JSON + the
    model used + token usage."""
    sanitized, model_used, usage = await llm_json.generate_json(
        prompt, [primary_model, *fallback_models], label="lecture_planner"
    )
    return LectureGenerationResult(
        content_json=sanitized,
        model_used=model_used,
        prompt_tokens=usage.get("prompt_tokens", 0),
        completion_tokens=usage.get("completion_tokens", 0),
        total_tokens=usage.get("total_tokens", 0),
    )


def record_lecture_billing(
    *,
    institute_id: Optional[str],
    user_id: Optional[str],
    task_id: str,
    result: LectureGenerationResult,
    generate_questions: bool = False,
    generate_homework: bool = False,
) -> None:
    """Charge institute credits for a completed lecture plan (best-effort; runs on
    its own session in the background worker).

    Uses the parametric tool path so the charge == the previewed price
    (flat + question/homework add-ons), with the actual token cost as the
    overage floor — `max(parametric, actual)`. Idempotent on the task id so a
    retried task can't double-charge.
    """
    ai_billing.record_tool_billing(
        tool_key="lecture",
        tool_params={
            "generate_questions": bool(generate_questions),
            "generate_homework": bool(generate_homework),
        },
        request_type=RequestType.LECTURE,
        model=result.model_used,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        institute_id=institute_id,
        user_id=user_id,
        user_role="ADMIN" if user_id else None,
        request_id=task_id,
        idempotency_key=f"lecture:{task_id}",
        # Usage-event attribution only (the ledger role above is unchanged).
        use_case="lecture",
        metering=metering_user(user_id, surface="ADMIN_APP"),
        usage_context={"task_id": task_id},
    )
