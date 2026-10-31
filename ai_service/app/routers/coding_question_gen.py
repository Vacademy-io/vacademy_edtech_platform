"""
AI coding-question generation.

Takes a rough problem idea from an admin and returns a complete coding-question
config (problem statement + test cases with accepted outputs + per-language
starter code + settings + a reference solution). The admin dashboard populates
its Question-Mode tabs with the result and runs the reference solution
in-browser against the generated tests before the admin reviews & saves.

Sibling of assessment_generation.py — same credit preflight/charge shape, but
authenticated with the caller's JWT (this is a direct browser -> ai-service
call, like the AI-credits meter) rather than the internal service token.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.security import get_current_user
from ..db import db_dependency
from ..models.ai_token_usage import RequestType
from ..schemas.auth import CustomUserDetails
from ..services.ai_billing import metering_from_request, preflight_tool_credits, record_tool_billing
from ..constants.model_defaults import GLM_DEFAULT
from ..services.ai_models_service import AIModelsService
from ..services.api_key_resolver import ApiKeyResolver
from ..services.chat_llm_client import ChatLLMClient
from ..services.coding_question_service import (
    SUPPORTED_LANGUAGES,
    CodingQuestionService,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/coding-question", tags=["coding-question-generation"])

# Fallback if ai_model_defaults isn't populated.
FALLBACK_MODEL = GLM_DEFAULT


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class GenerateCodingQuestionRequest(BaseModel):
    idea: str = Field(
        ...,
        description="The problem idea / prompt. Rough is fine — the model fills gaps.",
    )
    allowed_languages: list[str] = Field(
        default_factory=lambda: ["python"],
        description=f"Target languages (subset of {list(SUPPORTED_LANGUAGES)}).",
    )
    difficulty: str = Field(default="medium", description="easy | medium | hard")
    num_test_cases: int = Field(default=5, ge=2, le=12, description="Total test cases (2-12).")
    model: Optional[str] = Field(None, description="Optional explicit model override.")
    institute_id: Optional[str] = Field(
        None, description="Institute for credit attribution. Falls back to the JWT's institute.",
    )
    idempotency_key: Optional[str] = Field(
        None, description="Dedup key so a retry / double-click can't double-charge.",
    )


class GeneratedTestCase(BaseModel):
    label: Optional[str] = None
    input: str
    accepted_outputs: list[str]
    visible: bool


class GeneratedSolution(BaseModel):
    language: str
    source_code: str


class GeneratedSettings(BaseModel):
    max_points: int = 100
    cpu_seconds: float = 2
    memory_kb: int = 256000
    session_time_minutes: Optional[int] = None


class GenerateCodingQuestionResponse(BaseModel):
    title: str
    problem_html: str
    allowed_languages: list[str]
    starter_code: dict[str, str]
    test_cases: list[GeneratedTestCase]
    solution: GeneratedSolution
    settings: GeneratedSettings
    model_used: str


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=GenerateCodingQuestionResponse)
async def generate_coding_question(
    request: GenerateCodingQuestionRequest,
    institute_id: Optional[str] = Query(
        None, description="Institute id (also settable in the body). Query param wins."
    ),
    user: CustomUserDetails = Depends(get_current_user),
    db: Session = Depends(db_dependency),
    http_request: Request = None,
):
    """Generate a coding-question config from a natural-language idea.

    Returns generated content only — does NOT persist. The admin dashboard is
    responsible for reviewing and saving it.
    """
    if not request.idea or not request.idea.strip():
        raise HTTPException(status_code=400, detail="idea must not be empty")

    resolved_institute_id = institute_id or request.institute_id or user.institute_id
    user_id = user.user_id

    # Pre-flight credit gate. Coding-question generation is priced flat.
    estimate = preflight_tool_credits(
        db, tool_key="coding_question", tool_params={}, institute_id=resolved_institute_id
    )
    if estimate.get("sufficient") is False:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Insufficient credits: generating this question needs "
                f"~{estimate['estimated_credits']} credits but the balance is "
                f"{estimate.get('current_balance')}."
            ),
        )

    # Resolve model: explicit override > `questions` use-case default > fallback.
    model = request.model
    if not model:
        try:
            resp = AIModelsService(db).get_models_for_use_case("questions")
            if resp and resp.default_model:
                model = resp.default_model.model_id
        except Exception as e:  # noqa: BLE001
            logger.warning("[coding-gen] AIModelsService lookup failed, using fallback: %s", e)
    if not model:
        model = FALLBACK_MODEL

    api_key_resolver = ApiKeyResolver(db)
    llm_client = ChatLLMClient(api_key_resolver)
    svc = CodingQuestionService(llm_client=llm_client)

    try:
        result = await svc.generate(
            idea=request.idea,
            allowed_languages=request.allowed_languages or ["python"],
            difficulty=request.difficulty,
            num_test_cases=request.num_test_cases,
            institute_id=resolved_institute_id,
            user_id=user_id,
            model=model,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    # Charge credits: max(parametric estimate, actual token cost). Best-effort.
    usage = result.get("usage") or {}
    record_tool_billing(
        tool_key="coding_question",
        tool_params={"languages": len(result.get("allowed_languages") or ["python"])},
        request_type=RequestType.CODING_QUESTION,
        model=model,
        prompt_tokens=int(usage.get("prompt_tokens") or 0),
        completion_tokens=int(usage.get("completion_tokens") or 0),
        institute_id=resolved_institute_id,
        user_id=user_id,
        user_role="ADMIN" if user_id else None,
        idempotency_key=request.idempotency_key,
        # Usage-event attribution only (the ledger role above is unchanged).
        use_case="questions",
        metering=metering_from_request(http_request, resolved_institute_id, user=user),
    )

    logger.info(
        "[coding-gen] [%s] generated question '%s' (%d tests, langs=%s, model=%s)",
        resolved_institute_id, result["title"], len(result["test_cases"]),
        ",".join(result["allowed_languages"]), model,
    )

    return GenerateCodingQuestionResponse(
        title=result["title"],
        problem_html=result["problem_html"],
        allowed_languages=result["allowed_languages"],
        starter_code=result["starter_code"],
        test_cases=[GeneratedTestCase(**tc) for tc in result["test_cases"]],
        solution=GeneratedSolution(**result["solution"]),
        settings=GeneratedSettings(**result["settings"]),
        model_used=model,
    )
