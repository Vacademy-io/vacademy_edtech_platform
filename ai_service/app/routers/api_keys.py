"""
Router for API key management endpoints.

SECURITY NOTE: API keys are sensitive data. This router ensures:
- Keys are never logged
- Keys are never returned in GET responses
- Keys are only stored in database (should be encrypted in production)
"""
from __future__ import annotations

from typing import Optional
import logging
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session
from uuid import UUID

from ..core.security import decode_access_token, get_current_user, require_institute_member
from ..db import db_dependency
from ..schemas.auth import CustomUserDetails
from ..repositories.ai_api_keys_repository import AiApiKeysRepository
from ..schemas.api_keys import (
    ApiKeyCreateRequest,
    ApiKeyResponse,
    ApiKeyUpdateRequest,
)

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api-keys", tags=["api-keys"])


def _require_self(authorization: Optional[str], user_id: str) -> None:
    """
    User-level keys belong to one user: only that user's own token may read or
    change them. Verified locally (signature + expiry) instead of through
    get_current_user, because the learner app calls without a clientId header
    and the auth-service lookup needs one.
    """
    token = authorization[len("Bearer "):] if authorization and authorization.startswith("Bearer ") else None
    claims = decode_access_token(token) if token else None
    if claims is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if str(claims.get("user") or "") != str(user_id):
        raise HTTPException(status_code=403, detail="You can only manage your own API keys.")


@router.post(
    "/v1/institute/{institute_id}",
    response_model=ApiKeyResponse,
    summary="Create or update institute-level API keys",
)
async def create_or_update_institute_keys(
    institute_id: str,
    payload: ApiKeyCreateRequest,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
) -> ApiKeyResponse:
    """
    Create or update API keys for an institute.
    
    If keys already exist for this institute, they will be updated.
    Only provided fields will be updated.
    """
    require_institute_member(authorization, institute_id, admin=True)
    try:
        institute_uuid = UUID(institute_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid institute_id format")
    
    repository = AiApiKeysRepository(db)
    
    try:
        # SECURITY: Never log the actual keys, only log that operation occurred
        logger.info(f"Saving API keys for institute {institute_id} (keys provided: openai={bool(payload.openai_key)}, gemini={bool(payload.gemini_key)})")
        
        keys = repository.create_or_update_institute_keys(
            institute_id=institute_uuid,
            openai_key=payload.openai_key,
            gemini_key=payload.gemini_key,
            default_model=payload.default_model,
            notes=payload.notes,
        )
        return ApiKeyResponse(**keys.to_dict())
    except Exception as e:
        # SECURITY: Don't expose internal errors that might contain key info
        logger.error(f"Failed to save institute keys: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to save keys")


@router.post(
    "/v1/user/{user_id}",
    response_model=ApiKeyResponse,
    summary="Create or update user-level API keys",
)
async def create_or_update_user_keys(
    user_id: str,
    payload: ApiKeyCreateRequest,
    institute_id: Optional[str] = Query(default=None, description="Optional institute context"),
    db: Session = Depends(db_dependency),
    authorization: Optional[str] = Header(None),
) -> ApiKeyResponse:
    """
    Create or update API keys for a user.
    
    If keys already exist for this user, they will be updated.
    Only provided fields will be updated.
    """
    _require_self(authorization, user_id)
    if institute_id:
        require_institute_member(authorization, institute_id)
    try:
        user_uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id format")
    
    institute_uuid = None
    if institute_id:
        try:
            institute_uuid = UUID(institute_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid institute_id format")
    
    repository = AiApiKeysRepository(db)
    
    try:
        # SECURITY: Never log the actual keys
        logger.info(f"Saving API keys for user {user_id} (keys provided: openai={bool(payload.openai_key)}, gemini={bool(payload.gemini_key)})")
        
        keys = repository.create_or_update_user_keys(
            user_id=user_uuid,
            institute_id=institute_uuid,
            openai_key=payload.openai_key,
            gemini_key=payload.gemini_key,
            default_model=payload.default_model,
            notes=payload.notes,
        )
        return ApiKeyResponse(**keys.to_dict())
    except Exception as e:
        # SECURITY: Don't expose internal errors
        logger.error(f"Failed to save user keys: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to save keys")


@router.get(
    "/v1/institute/{institute_id}",
    response_model=ApiKeyResponse,
    summary="Get institute-level API keys",
)
async def get_institute_keys(
    institute_id: str,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
) -> ApiKeyResponse:
    """
    Get API keys for an institute.
    
    Returns key information (but not the actual keys for security).
    """
    require_institute_member(authorization, institute_id, admin=True)
    try:
        institute_uuid = UUID(institute_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid institute_id format")
    
    repository = AiApiKeysRepository(db)
    keys = repository.get_keys_for_institute(institute_uuid)
    
    if not keys:
        raise HTTPException(status_code=404, detail="No keys found for this institute")
    
    return ApiKeyResponse(**keys.to_dict())


@router.get(
    "/v1/user/{user_id}",
    response_model=ApiKeyResponse,
    summary="Get user-level API keys",
)
async def get_user_keys(
    user_id: str,
    institute_id: Optional[str] = Query(default=None, description="Optional institute for fallback lookup"),
    db: Session = Depends(db_dependency),
    authorization: Optional[str] = Header(None),
) -> ApiKeyResponse:
    """
    Get API keys for a user.
    
    Checks user-level keys first, then falls back to institute-level if provided.
    Returns key information (but not the actual keys for security).
    """
    _require_self(authorization, user_id)
    if institute_id:
        require_institute_member(authorization, institute_id)
    try:
        user_uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id format")
    
    institute_uuid = None
    if institute_id:
        try:
            institute_uuid = UUID(institute_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid institute_id format")
    
    repository = AiApiKeysRepository(db)
    keys = repository.get_keys_for_user(user_uuid, institute_uuid)
    
    if not keys:
        raise HTTPException(status_code=404, detail="No keys found for this user")
    
    return ApiKeyResponse(**keys.to_dict())


@router.put(
    "/v1/institute/{institute_id}",
    response_model=ApiKeyResponse,
    summary="Update institute-level API keys",
)
async def update_institute_keys(
    institute_id: str,
    payload: ApiKeyUpdateRequest,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
) -> ApiKeyResponse:
    """
    Update existing institute-level API keys.
    
    Only provided fields will be updated.
    Set a key to empty string to remove it.
    """
    require_institute_member(authorization, institute_id, admin=True)
    try:
        institute_uuid = UUID(institute_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid institute_id format")
    
    repository = AiApiKeysRepository(db)
    existing = repository.get_keys_for_institute(institute_uuid)
    
    if not existing:
        raise HTTPException(status_code=404, detail="No keys found for this institute")
    
    # Update fields
    if payload.openai_key is not None:
        existing.openai_key = payload.openai_key if payload.openai_key else None
    if payload.gemini_key is not None:
        existing.gemini_key = payload.gemini_key if payload.gemini_key else None
    if payload.default_model is not None:
        existing.default_model = payload.default_model
    if payload.notes is not None:
        existing.notes = payload.notes
    if payload.is_active is not None:
        existing.is_active = payload.is_active
    
    db.commit()
    db.refresh(existing)
    
    return ApiKeyResponse(**existing.to_dict())


@router.put(
    "/v1/user/{user_id}",
    response_model=ApiKeyResponse,
    summary="Update user-level API keys",
)
async def update_user_keys(
    user_id: str,
    payload: ApiKeyUpdateRequest,
    db: Session = Depends(db_dependency),
    authorization: Optional[str] = Header(None),
) -> ApiKeyResponse:
    """
    Update existing user-level API keys.
    
    Only provided fields will be updated.
    Set a key to empty string to remove it.
    """
    _require_self(authorization, user_id)
    try:
        user_uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id format")
    
    from ..models.ai_api_keys import AiApiKeys
    existing = db.query(AiApiKeys).filter(
        AiApiKeys.user_id == user_uuid,
        AiApiKeys.is_active == True
    ).first()
    
    if not existing:
        raise HTTPException(status_code=404, detail="No keys found for this user")
    
    # Update fields
    if payload.openai_key is not None:
        existing.openai_key = payload.openai_key if payload.openai_key else None
    if payload.gemini_key is not None:
        existing.gemini_key = payload.gemini_key if payload.gemini_key else None
    if payload.default_model is not None:
        existing.default_model = payload.default_model
    if payload.notes is not None:
        existing.notes = payload.notes
    if payload.is_active is not None:
        existing.is_active = payload.is_active
    
    db.commit()
    db.refresh(existing)
    
    return ApiKeyResponse(**existing.to_dict())


@router.delete(
    "/v1/institute/{institute_id}",
    summary="Deactivate institute-level API keys",
)
async def deactivate_institute_keys(
    institute_id: str,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
) -> dict:
    """
    Deactivate (soft delete) institute-level API keys.
    """
    require_institute_member(authorization, institute_id, admin=True)
    try:
        institute_uuid = UUID(institute_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid institute_id format")
    
    repository = AiApiKeysRepository(db)
    existing = repository.get_keys_for_institute(institute_uuid)
    
    if not existing:
        raise HTTPException(status_code=404, detail="No keys found for this institute")
    
    existing.is_active = False
    db.commit()
    
    return {"message": "Keys deactivated successfully"}


@router.delete(
    "/v1/user/{user_id}",
    summary="Deactivate user-level API keys",
)
async def deactivate_user_keys(
    user_id: str,
    db: Session = Depends(db_dependency),
    authorization: Optional[str] = Header(None),
) -> dict:
    """
    Deactivate (soft delete) user-level API keys.
    """
    _require_self(authorization, user_id)
    try:
        user_uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id format")
    
    from ..models.ai_api_keys import AiApiKeys
    existing = db.query(AiApiKeys).filter(
        AiApiKeys.user_id == user_uuid,
        AiApiKeys.is_active == True
    ).first()
    
    if not existing:
        raise HTTPException(status_code=404, detail="No keys found for this user")
    
    existing.is_active = False
    db.commit()
    
    return {"message": "Keys deactivated successfully"}


@router.delete(
    "/v1/institute/{institute_id}/delete",
    summary="Permanently delete institute-level API keys",
)
async def delete_institute_keys(
    institute_id: str,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
) -> dict:
    """
    Permanently delete institute-level API keys from the database.
    
    This is a hard delete - the keys will be completely removed.
    No key value needs to be provided, only the institute_id.
    """
    require_institute_member(authorization, institute_id, admin=True)
    try:
        institute_uuid = UUID(institute_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid institute_id format")
    
    repository = AiApiKeysRepository(db)
    
    try:
        deleted = repository.delete_institute_keys(institute_uuid)
        
        if not deleted:
            raise HTTPException(status_code=404, detail="No keys found for this institute")
        
        logger.info(f"Deleted API keys for institute {institute_id}")
        return {"message": "Keys deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete institute keys: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to delete keys")


@router.delete(
    "/v1/user/{user_id}/delete",
    summary="Permanently delete user-level API keys",
)
async def delete_user_keys(
    user_id: str,
    db: Session = Depends(db_dependency),
    authorization: Optional[str] = Header(None),
) -> dict:
    """
    Permanently delete user-level API keys from the database.
    
    This is a hard delete - the keys will be completely removed.
    No key value needs to be provided, only the user_id.
    """
    _require_self(authorization, user_id)
    try:
        user_uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id format")
    
    repository = AiApiKeysRepository(db)
    
    try:
        deleted = repository.delete_user_keys(user_uuid)
        
        if not deleted:
            raise HTTPException(status_code=404, detail="No keys found for this user")
        
        logger.info(f"Deleted API keys for user {user_id}")
        return {"message": "Keys deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete user keys: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to delete keys")


__all__ = ["router"]

