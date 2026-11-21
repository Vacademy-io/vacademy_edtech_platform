from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

from ..core.security import get_current_user, require_institute_member
from ..db import db_dependency
from ..schemas.auth import CustomUserDetails
from ..services.institute_settings_service import InstituteSettingsService

router = APIRouter(prefix="/institute/api-keys", tags=["institute-api-keys"])

class GenerateApiKeyRequest(BaseModel):
    institute_id: str
    name: str = "Default API Key"

class ApiKeyResponse(BaseModel):
    id: str
    name: str
    key: str # Full key for generation, masked for list
    created_at: str
    status: str

@router.post("/generate", response_model=ApiKeyResponse)
def generate_api_key(
    payload: GenerateApiKeyRequest,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
):
    # A minted key spends this institute's credits on /external/video/v1.
    require_institute_member(authorization, payload.institute_id, admin=True)
    service = InstituteSettingsService(db)
    try:
        return service.generate_api_key(payload.institute_id, payload.name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{institute_id}", response_model=List[ApiKeyResponse])
def get_api_keys(
    institute_id: str,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
):
    require_institute_member(authorization, institute_id, admin=True)
    service = InstituteSettingsService(db)
    return service.get_api_keys(institute_id)

@router.delete("/{institute_id}/{key_id}")
def revoke_api_key(
    institute_id: str,
    key_id: str,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
):
    require_institute_member(authorization, institute_id, admin=True)
    service = InstituteSettingsService(db)
    success = service.revoke_api_key(institute_id, key_id)
    if not success:
        raise HTTPException(status_code=404, detail="Key not found")
    return {"status": "success", "message": "Key revoked"}
