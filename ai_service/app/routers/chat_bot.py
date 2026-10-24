from typing import Optional

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session
from ..schemas.auth import CustomUserDetails
from ..schemas.chat_bot import ChatRequest, ChatResponse, CompletionRequest, CompletionResponse
from ..services.ai_chat_service import AiChatService
from ..dependencies import get_ai_chat_service, require_internal_service_token
from ..core.security import get_current_user, is_platform_staff, require_institute_member
from ..db import db_dependency

router = APIRouter(prefix="/chat", tags=["ai-chat"])

@router.post(
    "/v1/ask",
    response_model=ChatResponse,
    summary="Ask a question to the AI Tutor",
    description="Generates an MDX response to the student's prompt, using the provided context. "
    "Requires a signed-in user; usage is billed to an institute the caller belongs to."
)
async def ask_ai_tutor(
    request: ChatRequest,
    service: AiChatService = Depends(get_ai_chat_service),
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
) -> ChatResponse:
    """
    Ask the AI Tutor a question.

    `user_id` is always the signed-in user. An `institute_id` in the body is
    billed only when the caller is a member of it (platform staff excepted).
    """
    request.user_id = current_user.user_id
    if request.institute_id and not is_platform_staff(current_user):
        require_institute_member(authorization, request.institute_id)
    return await service.generate_chat_response(request, db_session=db)


@router.post(
    "/v1/complete",
    response_model=CompletionResponse,
    summary="Generic single-prompt completion (internal service callers)",
    description="Completes a caller-supplied full prompt. Used by other services "
    "(e.g. the parent assistant) so the LLM API key stays only in ai_service. "
    "Service-to-service only: requires X-Internal-Service-Token.",
    dependencies=[Depends(require_internal_service_token)],
)
async def complete(
    request: CompletionRequest,
    service: AiChatService = Depends(get_ai_chat_service),
    db: Session = Depends(db_dependency),
) -> CompletionResponse:
    # The calling service vouches for user_id; only platform staff may pick the model.
    allow_model = bool(request.model) and is_platform_staff({"user_id": request.user_id})
    return await service.generate_completion(request, db_session=db, allow_model_override=allow_model)

__all__ = ["router"]
