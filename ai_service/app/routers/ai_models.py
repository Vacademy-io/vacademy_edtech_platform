"""
AI Models Registry Router - Centralized API for model management.

Endpoints:
- List all models (with filtering)
- Get model details
- Get models for specific use case
- Get free tier models
- Get use case defaults
- Admin: Create/update models
- Admin: Update free tier
- Admin: Update use case defaults

This replaces the hardcoded model list in constants/models.py with
a database-backed, dynamically manageable model registry.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..db import db_dependency
from ..core.security import get_current_user, is_platform_staff
from ..services.ai_models_service import AIModelsService
from ..schemas.ai_models import (
    AIModelResponse,
    ModelsListResponse,
    ModelsForUseCaseResponse,
    FreeModelsResponse,
    AllUseCaseDefaultsResponse,
    UseCaseDefaultResponse,
    CreateModelRequest,
    UpdateModelRequest,
    UpdateFreeTierRequest,
    UpdateUseCaseDefaultRequest,
    ProvidersListResponse,
    TiersListResponse,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/models/v2", tags=["Models Registry"])


# ============================================================================
# Helpers
# ============================================================================

def get_models_service(db: Session = Depends(db_dependency)) -> AIModelsService:
    """Dependency to get models service instance."""
    return AIModelsService(db)


def check_root_admin(user) -> bool:
    """
    Gate for the registry writes below, which are GLOBAL (every institute's
    models and defaults). Platform staff only (SUPER_ADMIN_USER_IDS): is_root_user
    and the ROOT_ADMIN role are set for ordinary admins and learners, so they no
    longer pass.
    """
    return is_platform_staff(user)


# ============================================================================
# Public Endpoints
# ============================================================================

@router.get(
    "/list",
    response_model=ModelsListResponse,
    summary="Get all available AI models",
    description="Get list of all AI models. Can filter by tier, provider, category, or use case.",
)
def list_models(
    tier: Optional[str] = Query(None, description="Filter by tier: free, standard, premium, ultra"),
    provider: Optional[str] = Query(None, description="Filter by provider: Google, OpenAI, Anthropic, etc."),
    category: Optional[str] = Query(None, description="Filter by category: general, coding, embedding, etc."),
    is_free: Optional[bool] = Query(None, description="Filter by free status"),
    use_case: Optional[str] = Query(None, description="Filter by recommended use case: content, video, evaluation, etc."),
    service: AIModelsService = Depends(get_models_service),
):
    """
    Get a list of all available AI models.
    
    This endpoint provides the source of truth for model selection in the frontend.
    Models include pricing info, capabilities, and recommendations.
    """
    return service.get_all_models(
        tier=tier,
        provider=provider,
        category=category,
        is_free=is_free,
        use_case=use_case,
        active_only=True,
    )


@router.get(
    "/free",
    response_model=FreeModelsResponse,
    summary="Get currently active free tier models",
    description="Get the list of models that are currently free to use.",
)
def get_free_models(
    service: AIModelsService = Depends(get_models_service),
):
    """
    Get all currently active free tier models.
    
    Free tier models change frequently as providers update their offerings.
    Use this endpoint to always get the current free models.
    """
    return service.get_free_models()


@router.get(
    "/use-case/{use_case}",
    response_model=ModelsForUseCaseResponse,
    summary="Get models recommended for a use case",
    description="Get default and recommended models for a specific use case (content, video, evaluation, etc.)",
)
def get_models_for_use_case(
    use_case: str,
    service: AIModelsService = Depends(get_models_service),
):
    """
    Get models recommended for a specific use case.
    
    Returns the default model, fallback, free tier option, and all recommended models.
    Use cases: content, outline, video, image, evaluation, embedding, copilot, agent, analytics, tts
    """
    return service.get_models_for_use_case(use_case)


@router.get(
    "/defaults",
    response_model=AllUseCaseDefaultsResponse,
    summary="Get all use case defaults",
    description="Get the default model configuration for all use cases.",
)
def get_all_defaults(
    service: AIModelsService = Depends(get_models_service),
):
    """
    Get default model assignments for all use cases.
    
    Useful for initializing frontend model selectors.
    """
    return service.get_all_use_case_defaults()


@router.get(
    "/providers",
    response_model=ProvidersListResponse,
    summary="Get model providers",
    description="Get list of model providers with counts.",
)
def get_providers(
    service: AIModelsService = Depends(get_models_service),
):
    """Get list of available model providers with model counts."""
    return service.get_providers()


@router.get(
    "/tiers",
    response_model=TiersListResponse,
    summary="Get model tiers",
    description="Get list of model tiers with pricing stats.",
)
def get_tiers(
    service: AIModelsService = Depends(get_models_service),
):
    """Get list of model tiers with average pricing."""
    return service.get_tiers()


@router.get(
    "/{model_id:path}",
    response_model=AIModelResponse,
    summary="Get model details",
    description="Get detailed information about a specific model.",
)
def get_model(
    model_id: str,
    service: AIModelsService = Depends(get_models_service),
):
    """
    Get detailed information about a specific model.
    
    Model ID format: "provider/model-name" or "provider/model-name:variant"
    Examples: "google/gemini-2.5-flash", "xiaomi/mimo-v2-flash:free"
    """
    model = service.get_model_by_id(model_id)
    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model '{model_id}' not found",
        )
    return model


# ============================================================================
# Admin Endpoints (ROOT_ADMIN only)
# ============================================================================

@router.post(
    "/",
    response_model=AIModelResponse,
    summary="Create a new model (ROOT_ADMIN only)",
)
def create_model(
    request: CreateModelRequest,
    service: AIModelsService = Depends(get_models_service),
    current_user: Optional[dict] = Depends(get_current_user),
):
    """Create a new model in the registry."""
    if not check_root_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only ROOT_ADMIN can create models",
        )
    
    # Check if model already exists
    existing = service.get_model_by_id(request.model_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Model '{request.model_id}' already exists",
        )
    
    return service.create_model(request)


@router.put(
    "/free-tier",
    response_model=FreeModelsResponse,
    summary="Update free tier models (ROOT_ADMIN only)",
)
def update_free_tier(
    request: UpdateFreeTierRequest,
    service: AIModelsService = Depends(get_models_service),
    current_user: Optional[dict] = Depends(get_current_user),
):
    """
    Update which models are in the free tier.
    
    This is useful when OpenRouter changes which models are free.
    Replaces the current free tier with the specified models.
    """
    if not check_root_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only ROOT_ADMIN can update free tier",
        )
    
    return service.update_free_tier(request)


@router.patch(
    "/defaults/{use_case}",
    response_model=UseCaseDefaultResponse,
    summary="Update use case defaults (ROOT_ADMIN only)",
)
def update_use_case_default(
    use_case: str,
    request: UpdateUseCaseDefaultRequest,
    service: AIModelsService = Depends(get_models_service),
    current_user: Optional[dict] = Depends(get_current_user),
):
    """Update the default models for a use case."""
    if not check_root_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only ROOT_ADMIN can update defaults",
        )

    try:
        updated = service.update_use_case_default(use_case, request)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    if updated is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Use case '{use_case}' has no defaults row",
        )
    return updated


# Registered LAST: the catch-all path parameter would otherwise swallow
# PATCH /defaults/{use_case} (model_id="defaults/agent" -> 404).
@router.patch(
    "/{model_id:path}",
    response_model=AIModelResponse,
    summary="Update a model (ROOT_ADMIN only)",
)
def update_model(
    model_id: str,
    request: UpdateModelRequest,
    service: AIModelsService = Depends(get_models_service),
    current_user: Optional[dict] = Depends(get_current_user),
):
    """Update an existing model."""
    if not check_root_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only ROOT_ADMIN can update models",
        )
    
    model = service.update_model(model_id, request)
    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model '{model_id}' not found",
        )
    return model
