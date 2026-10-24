"""
Layer 3 — Assessment generation from a class-recording transcript.

Takes the English transcript of a lecture (admin_core_service fetches it from
S3 after Whisper transcription completes), uses the `agent` use-case model
(GLM by default, switchable from the super-admin portal) to author a
concise title + N MCQ questions, and emits them in the original audio language
detected by Whisper (so a Hindi lecture yields Hindi questions even though the
transcript fed to the LLM is the English translation).

Model resolution: request `model` > institute/user ai_api_keys.default_model >
the `agent` use case in `ai_model_defaults` (its fallback chain is the failover).

Auth: same dual-auth shape as the transcription router (institute API key OR
internal service token), so admin_core_service can call it server-to-server.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import db_dependency
from ..dependencies import get_institute_id_or_internal
from ..models.ai_token_usage import RequestType
from ..repositories.ai_api_keys_repository import AiApiKeysRepository  # noqa: F401  (kept for parity)
from ..services.ai_billing import metering_from_request, preflight_tool_credits, record_tool_billing
from ..constants.model_defaults import GLM_DEFAULT
from ..services.model_selection import resolve_models
from ..services.api_key_resolver import ApiKeyResolver
from ..services.chat_llm_client import ChatLLMClient
from ..services.quiz_service import QuizService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assessment", tags=["assessment-generation"])

# Soft cap so a runaway client can't burn an entire LLM context on a single call.
MAX_NUM_QUESTIONS = 50

# Fallback if ai_model_defaults isn't populated for any reason.
FALLBACK_MODEL = GLM_DEFAULT


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class GenerateAssessmentRequest(BaseModel):
    transcript_text: str = Field(
        ...,
        description="The English transcript of the class recording. Pass the full "
                    "transcript — the underlying LLM has a 1M-token context.",
    )
    target_language: str = Field(
        default="en",
        description="ISO 639-1 code of the language to emit questions in. Use "
                    "Whisper's detected_language for the source recording. "
                    "Supported: en, hi, ta, te, bn, mr, gu, kn, ml, pa, or, as.",
    )
    num_questions: int = Field(
        default=20,
        ge=1,
        le=MAX_NUM_QUESTIONS,
        description=f"How many MCQs to generate (1-{MAX_NUM_QUESTIONS}).",
    )
    model: Optional[str] = Field(
        None,
        description="Optional explicit model override (e.g. 'google/gemini-2.5-pro'). "
                    "When None, resolves to the `agent` use case default in ai_model_defaults.",
    )
    institute_id: Optional[str] = Field(
        None,
        description="Required only when calling with X-Internal-Service-Token. "
                    "Ignored when using X-Institute-Key auth.",
    )
    include_images: bool = Field(
        default=False,
        description="When true, also generate a Gemini image illustration for "
                    "each question stem and each option, embedded as inline "
                    "<img> tags. Adds 30-120s of latency and substantial API "
                    "spend (~5 image calls per question), so off by default.",
    )
    user_id: Optional[str] = Field(
        None,
        description="Verified actor (teacher/admin) for credit attribution. "
                    "admin_core forwards CustomUserDetails.getId().",
    )
    idempotency_key: Optional[str] = Field(
        None,
        description="Dedup key for the credit charge so a retry (RestTemplate "
                    "timeout after success, double-click) can't double-charge. "
                    "admin_core sends 'assessment:{artifactId}'.",
    )


class AssessmentQuestion(BaseModel):
    id: str
    question: str
    options: list[str]
    correct_answer_index: int
    explanation: str


class GenerateAssessmentResponse(BaseModel):
    title: str
    questions: list[AssessmentQuestion]
    target_language: str
    model_used: str


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/generate-from-transcript", response_model=GenerateAssessmentResponse)
async def generate_from_transcript(
    request: GenerateAssessmentRequest,
    auth: tuple = Depends(get_institute_id_or_internal),
    db: Session = Depends(db_dependency),
    http_request: Request = None,
):
    """Generate a title + MCQ questions from a lecture transcript.

    Returns generated content only — does NOT persist anywhere. Callers
    (typically admin_core_service) are responsible for storing the output.
    """
    resolved_institute_id, auth_mode = auth
    if auth_mode == "INTERNAL":
        if not request.institute_id:
            raise HTTPException(
                status_code=400,
                detail="institute_id is required in request body when using X-Internal-Service-Token",
            )
        institute_id = request.institute_id
    else:
        institute_id = resolved_institute_id

    if not request.transcript_text or not request.transcript_text.strip():
        raise HTTPException(status_code=400, detail="transcript_text must not be empty")

    # Pre-flight credit gate (academy-credits). Block before spending an LLM
    # call when the institute can't afford the parametric estimate.
    tool_params = {
        "num_questions": request.num_questions,
        "include_images": request.include_images,
    }
    estimate = preflight_tool_credits(
        db, tool_key="assessment", tool_params=tool_params, institute_id=institute_id
    )
    if estimate.get("sufficient") is False:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Insufficient credits: this assessment needs ~{estimate['estimated_credits']} "
                f"credits but the balance is {estimate.get('current_balance')}."
            ),
        )

    # Resolve model: explicit override > `agent` use case default > hardcoded
    # fallback. The explicit override is honoured as sent; the use-case chain
    # (default, fallback, non-GLM tail) is the failover behind it.
    # An institute/user default model (ai_api_keys) still beats the use case.
    model = request.model or ApiKeyResolver(db).byo_default_model(institute_id, request.user_id)
    fallback_models: list = []
    try:
        primary, chain = resolve_models(db, "agent", hard_fallback=FALLBACK_MODEL)
        if not model:
            model = primary
            fallback_models = list(chain)
        else:
            fallback_models = [m for m in [primary, *chain] if m != model]
    except Exception as e:
        logger.warning(f"[assessment-gen] model resolution failed, using fallback: {e}")
    if not model:
        model = FALLBACK_MODEL

    # Build a QuizService instance with a per-request DB-backed key resolver
    # so per-institute key/model overrides (from ai_api_keys table) apply.
    api_key_resolver = ApiKeyResolver(db)
    llm_client = ChatLLMClient(api_key_resolver)
    svc = QuizService(llm_client=llm_client)

    try:
        result = await svc.generate_assessment_from_transcript(
            transcript_text=request.transcript_text,
            target_language=request.target_language,
            num_questions=request.num_questions,
            institute_id=institute_id,
            user_id=request.user_id,
            model=model,
            include_images=request.include_images,
            fallback_models=fallback_models,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    # Bill and report the model that actually answered (a failover leg may
    # have served the call).
    model = result.get("model_used") or model

    # Charge credits: max(parametric estimate, actual token cost). Best-effort —
    # the assessment has already been generated, so billing must never 500.
    # Bill images on the count ACTUALLY delivered (not num_questions × toggle),
    # and dedup on the idempotency key so a retry can't double-charge.
    usage = result.get("usage") or {}
    billing_params = {
        "num_questions": request.num_questions,
        "image_count": int(result.get("images_generated") or 0),
    }
    record_tool_billing(
        tool_key="assessment",
        tool_params=billing_params,
        request_type=RequestType.ASSESSMENT,
        model=model,
        prompt_tokens=int(usage.get("prompt_tokens") or 0),
        completion_tokens=int(usage.get("completion_tokens") or 0),
        institute_id=institute_id,
        user_id=request.user_id,
        user_role="ADMIN" if request.user_id else None,
        idempotency_key=request.idempotency_key,
        # Usage-event attribution only (the ledger role above is unchanged).
        use_case="assessment_generation",
        metering=metering_from_request(http_request, institute_id,
                                       user={"user_id": request.user_id} if request.user_id else None,
                                       auth_mode=auth_mode),
    )

    logger.info(
        f"[assessment-gen] [{institute_id}] generated {len(result['questions'])} "
        f"questions (lang={request.target_language}, model={model})"
    )
    return GenerateAssessmentResponse(
        title=result["title"],
        questions=[AssessmentQuestion(**q) for q in result["questions"]],
        target_language=request.target_language,
        model_used=model,
    )
