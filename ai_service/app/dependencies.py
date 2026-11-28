from __future__ import annotations

from functools import lru_cache

from .adapters.admin_core_client import AdminCoreCourseMetadataClient
from .adapters.openrouter_llm_client import OpenRouterOutlineLLMClient
from .ports.course_metadata_port import CourseMetadataPort
from .ports.llm_client import OutlineLLMClient
from .services.course_outline_service import CourseOutlineGenerationService
from .services.parser import CourseOutlineParser
from .services.prompt_builder import CourseOutlinePromptBuilder
from .services.image_service import ImageGenerationService
from .services.content_generation_service import ContentGenerationService
from .services.content_generation_service import ContentGenerationService
from .services.ai_chat_service import AiChatService
from .services.youtube_service import YouTubeService
from .services.api_key_resolver import ApiKeyResolver
from .services.context_resolver_service import ContextResolverService
from .services.tool_manager_service import ToolManagerService
from .services.chat_llm_client import ChatLLMClient
from .services.institute_settings_service import InstituteSettingsService
from .services.ai_chat_agent_service import AiChatAgentService
from .services.embedding_service import EmbeddingService
from .services.rag_service import RAGService
from .services.learning_analytics_service import LearningAnalyticsService
from .config import get_settings
from .db import db_dependency
from sqlalchemy.orm import Session
from fastapi import Depends, Header, HTTPException, Request, status
from typing import Optional
from .config import Settings
from .core.security import get_pinned_principal


@lru_cache(maxsize=1)
def get_llm_client() -> OutlineLLMClient:
    """
    Singleton OutlineLLMClient for the application.
    """
    return OpenRouterOutlineLLMClient()


@lru_cache(maxsize=1)
def get_course_metadata_port() -> CourseMetadataPort:
    """
    Singleton CourseMetadataPort for the application.
    """
    return AdminCoreCourseMetadataClient()


@lru_cache(maxsize=1)
def get_image_service() -> ImageGenerationService:
    """
    Singleton ImageGenerationService for the application.
    
    Initializes with S3 configuration from environment variables.
    If S3 is not configured, image generation will be skipped gracefully.
    """
    settings = get_settings()

    # Initialize S3 client only if credentials are provided
    s3_client = None
    if settings.s3_aws_access_key and settings.s3_aws_access_secret and settings.s3_aws_region:
        try:
            import boto3
            s3_client = boto3.client(
                's3',
                aws_access_key_id=settings.s3_aws_access_key,
                aws_secret_access_key=settings.s3_aws_access_secret,
                region_name=settings.s3_aws_region
            )
        except Exception as e:
            s3_client = None
    
    return ImageGenerationService(
        s3_client=s3_client,
        s3_bucket=settings.aws_bucket_name,
        gemini_api_key=settings.gemini_api_key,
        openrouter_api_key=settings.openrouter_api_key,
        # No llm_model: the keyword LLM resolves the 'image_keyword' use case
        # (super-admin portal) instead of riding the platform env default.
    )


@lru_cache(maxsize=1)
def get_youtube_service() -> YouTubeService:
    """
    Singleton YouTubeService for the application.
    """
    settings = get_settings()
    return YouTubeService(api_key=settings.youtube_api_key)


# Removed lru_cache to ensure per-request instance with correct DB session
def get_content_generation_service(db: Optional[Session] = None) -> ContentGenerationService:
    """
    ContentGenerationService for the application.
    Created per-request to ensure correct DB session handling.
    """
    llm_client = get_llm_client()
    youtube_service = get_youtube_service()
    return ContentGenerationService(
        llm_client=llm_client, 
        youtube_service=youtube_service,
        db_session=db
    )


def get_course_outline_service(db: Session = Depends(db_dependency)) -> CourseOutlineGenerationService:
    """
    High-level service dependency that wires up all collaborators.
    Accepts DB session for API key resolution.
    """
    llm_client = get_llm_client()
    metadata_port = get_course_metadata_port()
    institute_settings_service = InstituteSettingsService(db)
    prompt_builder = CourseOutlinePromptBuilder(institute_settings_service)
    parser = CourseOutlineParser()
    image_service = get_image_service()
    content_generation_service = get_content_generation_service(db)
    return CourseOutlineGenerationService(
        llm_client=llm_client,
        metadata_port=metadata_port,
        prompt_builder=prompt_builder,
        parser=parser,
        image_service=image_service,
        content_generation_service=content_generation_service,
        db_session=db,
        institute_settings_service=institute_settings_service,
    )


@lru_cache(maxsize=1)
def get_ai_chat_service() -> AiChatService:
    """
    Singleton AiChatService for the application.
    """
    llm_client = get_llm_client()
    return AiChatService(llm_client=llm_client)


def get_chat_agent_service() -> AiChatAgentService:
    """
    Chat Agent Service — manages its own short-lived DB sessions
    to avoid holding connections during long LLM calls / SSE streams.
    """
    from .db import db_session
    return AiChatAgentService(db_session_factory=db_session)


def get_assistant_service():
    """
    Vacademy Assistant (admin) service — separate, JWT-gated agent. Like the chat
    agent it manages its own short-lived DB sessions across LLM calls / SSE.
    """
    from .db import db_session
    from .services.assistant_service import AssistantAgentService
    return AssistantAgentService(db_session_factory=db_session)



def get_institute_from_api_key(
    x_institute_key: str = Header(..., description="API Key for Institute Authentication"),
    db: Session = Depends(db_dependency)
) -> str:
    """
    Validate API key and return institute_id.
    """
    settings_service = InstituteSettingsService(db)
    institute_id = settings_service.validate_api_key(x_institute_key)

    if not institute_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or inactive API Key"
        )
    return institute_id


def require_internal_service_token(
    x_internal_service_token: Optional[str] = Header(
        None, description="Service-to-service shared secret"
    ),
) -> None:
    """
    Gate for internal endpoints called by other Vacademy services
    (e.g. admin_core_service's Razorpay webhook handler invoking
    /credits/v1/internal/grant-from-payment after a successful pack purchase).

    Compares the supplied header to settings.internal_service_token in constant
    time. If the server has no token configured, every request is rejected —
    there is no implicit-allow fallback.
    """
    expected = get_settings().internal_service_token
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal service token is not configured on this server",
        )
    if not x_internal_service_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Internal-Service-Token header",
        )
    # Constant-time comparison to defeat timing-attack inference of the secret.
    import hmac
    if not hmac.compare_digest(x_internal_service_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid X-Internal-Service-Token",
        )


def get_institute_id_or_internal(
    x_institute_key: Optional[str] = Header(None, description="API Key for institute auth"),
    x_internal_service_token: Optional[str] = Header(
        None, description="Server-to-server token (admin-core ↔ ai-service)"
    ),
) -> tuple[Optional[str], str]:
    """
    Dual-auth dependency: either an institute API key OR an internal
    service token (e.g. from admin_core_service).

    Returns (resolved_institute_id_or_None, mode):
      - mode='INSTITUTE': caller presented X-Institute-Key, institute_id is resolved.
      - mode='INTERNAL':  caller presented X-Internal-Service-Token, institute_id
        must be supplied by the handler from the request body.

    The DB session is created lazily inside the INSTITUTE branch so callers
    using INTERNAL auth don't require DB connectivity at all.
    """
    if x_institute_key:
        db_gen = db_dependency()
        db = next(db_gen)
        try:
            settings_service = InstituteSettingsService(db)
            institute_id = settings_service.validate_api_key(x_institute_key)
        finally:
            try:
                next(db_gen)
            except StopIteration:
                pass
        if not institute_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or inactive API Key",
            )
        return institute_id, "INSTITUTE"

    if x_internal_service_token:
        expected = get_settings().internal_service_token
        if not expected:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Internal service token is not configured on this server",
            )
        import hmac
        if not hmac.compare_digest(x_internal_service_token, expected):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid X-Internal-Service-Token",
            )
        return None, "INTERNAL"

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing auth: provide X-Institute-Key or X-Internal-Service-Token",
    )


async def get_institute_id_or_internal_or_user(
    request: Request,
    x_institute_key: Optional[str] = Header(None, description="API Key for institute auth"),
    x_internal_service_token: Optional[str] = Header(
        None, description="Server-to-server token (admin-core ↔ ai-service)"
    ),
    authorization: Optional[str] = Header(None, description="Bearer JWT (dashboard callers)"),
    settings: Settings = Depends(get_settings),
) -> tuple[Optional[str], str]:
    """
    Triple-auth dependency for endpoints that BOTH machines and signed-in
    dashboard users call. Returns the same (institute_id, mode) tuple as
    get_institute_id_or_internal, so handlers are identical either way:

      - X-Institute-Key          → ('<institute>', 'INSTITUTE')
      - X-Internal-Service-Token → (None, 'INTERNAL')   [institute from body]
      - Authorization: Bearer    → ('<clientId>', 'INSTITUTE')

    The JWT branch exists because the admin/learner dashboards authenticate with
    a Bearer token + clientId header (their axios interceptors attach both) and
    have no institute API key — a router wired to key/token auth alone rejects
    every request the UI makes.

    SECURITY: the JWT branch goes through get_pinned_principal, NOT
    get_current_user. get_current_user trusts the clientId header verbatim,
    which would let a member of institute A pass clientId=B and spend B's
    credits on B's content. get_pinned_principal verifies membership of the
    pinned institute against the token's per-institute authorities map (with the
    documented root-user exception), so the returned institute id is always one
    the caller may act for.
    """
    if x_institute_key or x_internal_service_token:
        return get_institute_id_or_internal(x_institute_key, x_internal_service_token)

    if authorization:
        principal = await get_pinned_principal(request, authorization, settings)
        return principal.institute_id, "INSTITUTE"

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=(
            "Missing auth: provide Authorization: Bearer <jwt> with a clientId "
            "header, X-Institute-Key, or X-Internal-Service-Token"
        ),
    )


def get_embedding_service(db: Session = Depends(db_dependency)) -> EmbeddingService:
    """Create an EmbeddingService with a fresh DB session."""
    api_key_resolver = ApiKeyResolver(db)
    return EmbeddingService(api_key_resolver)


def _limit_actor_fields(request: Request, institute_id: Optional[str]) -> dict:
    """Usage-limit attribution for require_credits' check (the X-Institute-Key
    caller is a PARTNER_API / API_KEY actor). Empty — so the check request is
    exactly today's — unless the institute has a limits policy or a live AI
    subscription (in-memory lookups; no I/O). Never raises."""
    try:
        from .services.metering import limit_gate

        if not limit_gate.policy_active(institute_id):
            # AI plans: a live subscription's roles_included check needs the
            # actor too (in-memory lookup; {} for everyone else, as before).
            from .services.metering import plan_wiring

            if not plan_wiring.live(institute_id):
                return {}
        from .services.metering.context import MeteringContext

        ctx = MeteringContext.from_request(request, institute_id, auth_mode="INSTITUTE")
        return {k: v for k, v in ctx.as_fields().items() if k != "subject_user_id"}
    except Exception:  # noqa: BLE001
        return {}


def require_credits(request_type: str, estimated_tokens: int = 1000):
    """
    Factory that returns a FastAPI dependency to check if institute has
    sufficient credits before an AI operation proceeds.
    Raises HTTP 402 if balance is insufficient.
    """
    async def _check(
        request: Request,
        institute_id: str = Depends(get_institute_from_api_key),
        db: Session = Depends(db_dependency),
    ):
        from .services.credit_service import CreditService
        from .schemas.credits import CreditCheckRequest

        service = CreditService(db)
        result = service.check_credits(CreditCheckRequest(
            institute_id=institute_id,
            request_type=request_type,
            estimated_tokens=estimated_tokens,
            **_limit_actor_fields(request, institute_id),
        ))
        if not result.has_sufficient_credits:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=result.message,
            )
        return result
    return _check


__all__ = [
    "get_course_outline_service", "get_image_service", "get_ai_chat_service",
    "get_chat_agent_service", "get_assistant_service", "get_institute_from_api_key",
    "get_embedding_service", "require_credits", "require_internal_service_token",
]



