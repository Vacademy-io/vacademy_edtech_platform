"""
Super Admin — model defaults for every AI feature (/super-admin/v1/models/*).

Which model each use case (`ai_model_defaults`) and each video pipeline stage
(`ai_model_stage_assignments`) uses, edited with a reason and recorded in
`ai_model_change_log`. Platform staff only (SUPER_ADMIN_USER_IDS), the same
gate as routers/super_admin.py. The logic lives in services/model_defaults_admin.py.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.security import get_current_user
from ..db import db_dependency
from ..schemas.auth import CustomUserDetails
from ..services import model_defaults_admin as admin
from .super_admin import _require_super_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/super-admin/v1/models", tags=["Super Admin — Model defaults"])


class UseCaseDefaultPatch(BaseModel):
    """Only fields present in the body change. An explicit null clears the
    fallback / free tier. reason is required."""
    default_model_id: Optional[str] = Field(None, max_length=100)
    fallback_model_id: Optional[str] = Field(None, max_length=100)
    free_tier_model_id: Optional[str] = Field(None, max_length=100)
    reason: str = Field(..., max_length=2000)


class BulkDefaultsRequest(BaseModel):
    model_id: str = Field(..., max_length=100)
    # Omitted = fallbacks untouched; explicit null = clear them.
    fallback_model_id: Optional[str] = Field(None, max_length=100)
    # Omitted = every chat use case that is not held.
    use_cases: Optional[List[str]] = None
    dry_run: bool = True
    reason: str = Field(..., max_length=2000)


class StagePatch(BaseModel):
    use_case: str = Field("video", max_length=50)
    stage_id: str = Field(..., max_length=64)
    quality_tiers: List[str] = Field(..., description="['*'] = every tier")
    model_id: str = Field(..., max_length=100)
    reason: str = Field(..., max_length=2000)


class BulkStagesRequest(BaseModel):
    use_case: str = Field("video", max_length=50)
    model_id: str = Field(..., max_length=100)
    dry_run: bool = True
    reason: str = Field(..., max_length=2000)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except admin.ModelAdminError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


def _actor(user: CustomUserDetails) -> Optional[str]:
    return str(getattr(user, "user_id", "") or "") or None


@router.get("/catalog", summary="Every AI use case with its model row, the model registry and gateway routes")
def models_catalog(
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    return _call(admin.catalog, db)


@router.post("/defaults/bulk", summary="Set one model as the default of many use cases (dry run first)")
def models_bulk_defaults(
    body: BulkDefaultsRequest,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    kwargs = {}
    if "fallback_model_id" in body.model_fields_set:
        kwargs["fallback_model_id"] = body.fallback_model_id
    return _call(
        admin.bulk_set_defaults, db, body.model_id, use_cases=body.use_cases,
        dry_run=body.dry_run, reason=body.reason, actor=_actor(current_user), **kwargs,
    )


@router.patch("/defaults/{use_case}", summary="Change one use case's default / fallback / free-tier model")
def models_patch_default(
    use_case: str,
    body: UseCaseDefaultPatch,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    changes = {f: getattr(body, f) for f in body.model_fields_set if f != "reason"}
    return _call(admin.update_use_case, db, use_case, changes, body.reason, _actor(current_user))


@router.get("/stages", summary="The per-stage model matrix of a use case (video)")
def models_stages(
    use_case: str = Query("video", max_length=50),
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    return _call(admin.list_stages, db, use_case)


@router.patch("/stages", summary="Set one stage's model on some or all quality tiers")
def models_patch_stage(
    body: StagePatch,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    return _call(admin.update_stage, db, body.use_case, body.stage_id, body.quality_tiers,
                 body.model_id, body.reason, _actor(current_user))


@router.post("/stages/bulk", summary="Set one model on every stage row of a use case (dry run first)")
def models_bulk_stages(
    body: BulkStagesRequest,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    return _call(admin.bulk_set_stages, db, body.use_case, body.model_id, dry_run=body.dry_run,
                 reason=body.reason, actor=_actor(current_user))


@router.get("/change-log", summary="Model changes, newest first")
def models_change_log(
    limit: int = Query(50, ge=1, le=500),
    use_case: Optional[str] = Query(None, max_length=50),
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    return _call(admin.change_log, db, limit, use_case or None)


@router.get("/overrides", summary="Institute / user default models on ai_api_keys (read-only)")
def models_overrides(
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    return _call(admin.overrides, db)
