from __future__ import annotations
import logging
from typing import Any, Dict, Optional
from sqlalchemy.orm import Session
from ..ports.llm_client import OutlineLLMClient
from ..schemas.chat_bot import ChatRequest, ChatResponse, CompletionRequest, CompletionResponse
from .chat_prompts import ChatPrompts
from ..models.ai_token_usage import ApiProvider, RequestType

logger = logging.getLogger(__name__)

# Use case for /chat/v1/ask and for /chat/v1/complete callers that name none.
CHAT_USE_CASE = "chat"
# Use cases a /chat/v1/complete caller may name (ai_model_defaults rows).
COMPLETION_USE_CASES = frozenset({"chat", "parent_assistant"})
_MAX_TOKENS = 4000


class AiChatService:
    """
    Service for handling AI Chat Bot interactions.

    The model comes from a use case in ai_model_defaults (GLM by default),
    walked through llm_router.chat_with_chain (gateway failover + the row's
    fallback), and usage is recorded under the registry id that answered.
    """

    def __init__(
        self,
        llm_client: OutlineLLMClient,
        db_session: Optional[Session] = None
    ) -> None:
        # Kept for the DI signature; completions go through llm_router.chat_with_chain.
        self._llm_client = llm_client
        self._db_session = db_session

    async def _complete(self, prompt: str, use_case: str, session: Optional[Session],
                        preferred_model: Optional[str] = None):
        from .llm_router import chat_with_chain

        return await chat_with_chain(
            {"messages": [{"role": "user", "content": prompt}], "max_tokens": _MAX_TOKENS},
            use_case=use_case,
            db=session,
            preferred_model=preferred_model,
        )

    @staticmethod
    def _record(session: Optional[Session], result, institute_id: Optional[str], user_id: Optional[str],
                use_case: str) -> None:
        usage: Dict[str, Any] = result.usage or {}
        if not session or not usage:
            return
        try:
            from .token_usage_service import TokenUsageService
            TokenUsageService(session).record_usage_and_deduct_credits(
                api_provider=ApiProvider.OPENAI,  # OpenRouter-compatible format
                prompt_tokens=usage.get("prompt_tokens", 0) or 0,
                completion_tokens=usage.get("completion_tokens", 0) or 0,
                total_tokens=usage.get("total_tokens", 0) or 0,
                request_type=RequestType.COPILOT,
                institute_id=institute_id,
                user_id=user_id,
                model=result.model,  # registry id that answered — never "default"
                metadata={"use_case": use_case, "router": result.router},
            )
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Failed to record chat usage: {e}")

    async def generate_chat_response(self, request: ChatRequest, db_session: Optional[Session] = None) -> ChatResponse:
        """
        Generates a response to the student's prompt using the LLM.
        """
        session = db_session or self._db_session

        try:
            logger.info(f"Generating chat response for prompt: {request.prompt[:50]}...")
            prompt = ChatPrompts.build_chat_prompt(request.prompt, request.context)
            result = await self._complete(prompt, CHAT_USE_CASE, session)
            self._record(session, result, request.institute_id, request.user_id, CHAT_USE_CASE)
            return ChatResponse(content=result.content)

        except Exception as e:
            logger.error(f"Error generating chat response: {e}")
            # Return a friendly error message instead of crashing
            return ChatResponse(
                content="I'm sorry, I encountered an error while processing your request. Please try again later."
            )

    async def generate_completion(
        self, request: CompletionRequest, db_session: Optional[Session] = None,
        allow_model_override: bool = False,
    ) -> CompletionResponse:
        """Generic single-prompt completion for internal service callers. The
        caller owns the full prompt; on any error we return empty content so the
        caller can fall back gracefully (rather than surfacing an error string).

        The model is the `use_case` row (parent_assistant / chat). A body
        `model` is honoured only when `allow_model_override` (the user is
        platform staff); otherwise it is ignored."""
        session = db_session or self._db_session
        use_case = request.use_case if request.use_case in COMPLETION_USE_CASES else CHAT_USE_CASE
        preferred = request.model if (allow_model_override and request.model) else None
        if request.model and not preferred:
            logger.info("chat/v1/complete: ignoring body model %s (caller is not platform staff)", request.model)

        try:
            result = await self._complete(request.prompt, use_case, session, preferred_model=preferred)
            self._record(session, result, request.institute_id, request.user_id, use_case)
            return CompletionResponse(content=result.content or "")

        except Exception as e:
            logger.error(f"Error generating completion: {e}")
            return CompletionResponse(content="")

__all__ = ["AiChatService", "CHAT_USE_CASE", "COMPLETION_USE_CASES"]
