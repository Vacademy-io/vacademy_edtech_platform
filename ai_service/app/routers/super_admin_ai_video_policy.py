"""Super admin: per-institute AI video policy (LMS AI Video limits).

GET    /super-admin/v1/institutes/{institute_id}/ai-video-policy
PUT    /super-admin/v1/institutes/{institute_id}/ai-video-policy     body: policy fields + reason
DELETE /super-admin/v1/institutes/{institute_id}/ai-video-policy?reason=

All three answer ``{policy, is_default, usage: {month_credits_used, running_now,
videos_this_month}}``. GET never 404s: an institute without the setting gets the
platform defaults with ``is_default: true``. PUT: a field left out keeps its
value; ``monthly_credit_cap: null`` sent explicitly removes the cap. The audit
fields (updated_by / updated_at / reason) are stored inside the setting data
and returned inside ``policy``.

Same platform-staff gate as routers/super_admin.py (SUPER_ADMIN_USER_IDS).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..constants.ai_video_policy import POLICY_FIELDS
from ..core.security import get_current_user
from ..db import db_dependency
from ..schemas.auth import CustomUserDetails
from ..services import ai_video_policy_service as policy_svc
from .super_admin import _require_super_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/super-admin/v1", tags=["Super Admin"])


class AiVideoPolicyUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: Optional[bool] = None
    allowed_qualities: Optional[List[Literal["standard", "premium", "ultra"]]] = None
    teacher_allowed: Optional[bool] = None
    max_minutes_per_video: Optional[int] = Field(default=None, ge=1, le=30)
    monthly_credit_cap: Optional[float] = Field(default=None, ge=0)
    max_concurrent: Optional[int] = Field(default=None, ge=1, le=20)
    reason: str = Field(..., max_length=500)

    @field_validator("reason")
    @classmethod
    def _reason_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("reason is required")
        return v

    def changes(self) -> Dict[str, Any]:
        """Fields the caller sent. A null keeps the value, except
        monthly_credit_cap, where an explicit null removes the cap."""
        out: Dict[str, Any] = {}
        for k in POLICY_FIELDS:
            if k not in self.model_fields_set:
                continue
            v = getattr(self, k)
            if v is None and k != "monthly_credit_cap":
                continue
            out[k] = v
        return out


def _usage(db: Session, institute_id: str) -> Dict[str, Any]:
    try:
        return policy_svc.usage(db, institute_id)
    except Exception as exc:  # noqa: BLE001 — usage is informational
        logger.warning("[AiVideoPolicy] usage read failed for %s: %s", institute_id, exc)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return {"month_credits_used": 0.0, "running_now": 0, "videos_this_month": 0}


def _response(db: Session, institute_id: str) -> Dict[str, Any]:
    policy, is_default = policy_svc.load_policy(db, institute_id)
    return {"policy": policy, "is_default": is_default, "usage": _usage(db, institute_id)}


@router.get("/institutes/{institute_id}/ai-video-policy", summary="AI video policy + this month's usage")
def get_ai_video_policy(
    institute_id: str,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    return _response(db, institute_id)


@router.put("/institutes/{institute_id}/ai-video-policy", summary="Set an institute's AI video policy")
def put_ai_video_policy(
    institute_id: str,
    body: AiVideoPolicyUpdate,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    current, _ = policy_svc.load_policy(db, institute_id)
    merged = policy_svc.merge_policy_update(current, body.changes())
    if merged["enabled"] and not merged["allowed_qualities"]:
        raise HTTPException(status_code=422,
                            detail="allowed_qualities needs at least one quality while AI video is enabled")
    data = {
        **merged,
        "updated_by": current_user.user_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "reason": body.reason,
    }
    try:
        policy_svc.save_policy(db, institute_id, data)
    except policy_svc.InstituteNotFound:
        raise HTTPException(status_code=404, detail=f"Institute {institute_id} not found")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    logger.info("[AiVideoPolicy] %s set policy for %s: %s (reason: %s)",
                current_user.user_id, institute_id, merged, body.reason)
    return _response(db, institute_id)


@router.delete("/institutes/{institute_id}/ai-video-policy", summary="Reset an institute's AI video policy to defaults")
def delete_ai_video_policy(
    institute_id: str,
    reason: Optional[str] = Query(default=None, max_length=500),
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    try:
        removed = policy_svc.delete_policy(db, institute_id)
    except policy_svc.InstituteNotFound:
        removed = False   # nothing to reset; answer with the defaults
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    logger.info("[AiVideoPolicy] %s reset policy for %s to defaults (removed=%s, reason: %s)",
                current_user.user_id, institute_id, removed, reason)
    return _response(db, institute_id)
