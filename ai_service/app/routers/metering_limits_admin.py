"""
Super Admin — AI usage limits (/super-admin/v1/metering/limits/**).

  GET    /overview                        institutes with a limits policy, their row counts and
                                          the last 7 days' WOULD_BLOCK / BLOCKED_SKIPPED / OVERRUN events
  GET    /{institute_id}/policy           the policy (or the default OFF one)
  PUT    /{institute_id}/policy           any mode, tenant_may_enforce, timezone, notifications
  GET    /{institute_id}/rows             TENANT + PLATFORM rows (include_inactive=true for history)
  POST   /{institute_id}/rows             any row, origin TENANT or PLATFORM, locked or not
  PATCH  /{institute_id}/rows/{row_id}    soft / hard limit, locked (any origin)
  DELETE /{institute_id}/rows/{row_id}    retire any row
  GET    /{institute_id}/usage?period=    this window's counters (with vendor cost)
  GET    /{institute_id}/effective?user_id=
  POST   /{institute_id}/preview

Platform staff only (SUPER_ADMIN_USER_IDS, fail closed), as a ROUTER-level
dependency. Validation, storage and the audit trail are shared with the
tenant API (routers/credits_limits.py); every write needs a reason and logs
actor + reason to ai_model_change_log.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..core.security import get_current_user
from ..schemas.auth import CustomUserDetails
from ..services import metering_query as mq
from . import credits_limits as cl
from .super_admin import _require_super_admin

logger = logging.getLogger(__name__)


def _staff_only(current_user: CustomUserDetails = Depends(get_current_user)) -> None:
    _require_super_admin(current_user)


router = APIRouter(
    prefix="/super-admin/v1/metering/limits",
    tags=["Super Admin — AI usage limits"],
    dependencies=[Depends(_staff_only)],
)


class AdminPolicyPut(BaseModel):
    mode: Optional[str] = Field(None, max_length=8)
    tenant_may_enforce: Optional[bool] = None
    timezone: Optional[str] = Field(None, max_length=48)
    notify_admins_on_soft: Optional[bool] = None
    show_numbers_to_learners: Optional[bool] = None
    reason: str = Field(..., max_length=2000)


class AdminRowCreate(cl.RowCreate):
    origin: str = Field("PLATFORM", max_length=10)
    locked: Optional[bool] = None   # default: PLATFORM rows locked, TENANT rows not


class AdminRowPatch(cl.RowPatch):
    locked: Optional[bool] = None


def _institute(institute_id: str) -> str:
    iid = str(institute_id or "").strip()
    if not iid or len(iid) > 64:
        raise HTTPException(status_code=422, detail="institute_id must be 1-64 characters")
    return iid


@router.get("/overview", summary="Institutes with a limits policy, and what the limits did in 7 days")
def overview(lq: mq.LimitsQuery = Depends(cl.get_limits_query)):
    if not lq.tables_ready():
        return {"institutes": [], "enforce_globally_enabled": cl.enforce_globally_enabled()}
    since = datetime.now(timezone.utc) - timedelta(days=7)
    items = []
    for r in lq.overview(since):
        items.append({
            "institute_id": r.get("institute_id"),
            "institute_name": r.get("institute_name"),
            "mode": str(r.get("mode") or "OFF").upper(),
            "tenant_may_enforce": bool(r.get("tenant_may_enforce")),
            "timezone": r.get("timezone") or mq.DEFAULT_LIMITS_TZ,
            "rows": r["rows"],
            "platform_rows": r["platform_rows"],
            "would_block_7d": r["would_block_7d"],
            "blocked_7d": r["blocked_7d"],
            "overrun_7d": r["overrun_7d"],
            "updated_at": mq._iso(r.get("updated_at")),
        })
    return {"institutes": items, "enforce_globally_enabled": cl.enforce_globally_enabled()}


@router.get("/{institute_id}/policy", summary="An institute's limits policy (default OFF when none)")
def get_policy(institute_id: str, lq: mq.LimitsQuery = Depends(cl.get_limits_query)):
    iid = _institute(institute_id)
    if not lq.tables_ready():
        return {**mq.default_policy(iid), "enforce_globally_enabled": cl.enforce_globally_enabled()}
    return {**mq.policy_item(lq.policy_row(iid), iid), "enforce_globally_enabled": cl.enforce_globally_enabled()}


@router.put("/{institute_id}/policy", summary="Set an institute's limits mode, tenant unlock, timezone")
def put_policy(
    institute_id: str,
    body: AdminPolicyPut,
    lq: mq.LimitsQuery = Depends(cl.get_limits_query),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    iid = _institute(institute_id)
    reason = cl.need_reason(body.reason)
    if body.mode is not None:
        cl._upper(body.mode, mq.LIMIT_MODES, "mode")
    if body.timezone is not None:
        cl.valid_timezone(body.timezone)
    cl.require_tables(lq)
    return cl.save_policy(lq, iid, body.model_dump(exclude={"reason"}), reason, cl.actor_id(current_user),
                          platform=True)


@router.get("/{institute_id}/rows", summary="Every limit row of an institute (TENANT and PLATFORM)")
def get_rows(
    institute_id: str,
    include_inactive: bool = Query(False),
    lq: mq.LimitsQuery = Depends(cl.get_limits_query),
):
    iid = _institute(institute_id)
    out = cl.limits_overview(lq, iid, include_inactive=include_inactive)
    return out


@router.post("/{institute_id}/rows", summary="Add a limit row (PLATFORM by default, locked by default)")
def post_row(
    institute_id: str,
    body: AdminRowCreate,
    lq: mq.LimitsQuery = Depends(cl.get_limits_query),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    iid = _institute(institute_id)
    reason = cl.need_reason(body.reason)
    origin = cl._upper(body.origin, mq.LIMIT_ORIGINS, "origin")
    locked = (origin == "PLATFORM") if body.locked is None else bool(body.locked)
    cl.require_tables(lq)
    fields = cl.validate_row(lq, iid, body, platform=True, origin=origin, locked=locked)
    return cl.create_row(lq, iid, fields, reason, cl.actor_id(current_user))


@router.patch("/{institute_id}/rows/{row_id}", summary="Change any row's soft / hard limit or lock")
def patch_row(
    institute_id: str,
    row_id: str,
    body: AdminRowPatch,
    lq: mq.LimitsQuery = Depends(cl.get_limits_query),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    iid = _institute(institute_id)
    reason = cl.need_reason(body.reason)
    rid = cl.valid_row_id(row_id)
    cl.require_tables(lq)
    changes = body.model_dump(exclude_unset=True, exclude={"reason"})
    return cl.patch_row(lq, iid, rid, changes, reason, cl.actor_id(current_user), platform=True)


@router.delete("/{institute_id}/rows/{row_id}", summary="Retire any limit row (kept for history)")
def delete_row(
    institute_id: str,
    row_id: str,
    reason: Optional[str] = Query(None, max_length=2000),
    lq: mq.LimitsQuery = Depends(cl.get_limits_query),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    iid = _institute(institute_id)
    why = cl.need_reason(reason)
    rid = cl.valid_row_id(row_id)
    cl.require_tables(lq)
    return cl.delete_row(lq, iid, rid, why, cl.actor_id(current_user), platform=True)


@router.get("/{institute_id}/usage", summary="This window's usage counters of an institute (with vendor cost)")
def get_usage(
    institute_id: str,
    period: str = Query("DAY", pattern="^(DAY|WEEK|MONTH)$"),
    lq: mq.LimitsQuery = Depends(cl.get_limits_query),
):
    return cl.usage_items(lq, _institute(institute_id), period, include_cost=True)


@router.get("/{institute_id}/effective", summary="Which limits apply to a user of an institute and why")
def get_effective(
    institute_id: str,
    user_id: Optional[str] = Query(None, max_length=255),
    lq: mq.LimitsQuery = Depends(cl.get_limits_query),
    engine=Depends(cl.get_limits_engine),
):
    iid = _institute(institute_id)
    if not lq.tables_ready():
        return []
    return cl.run_effective(engine, lq, iid, user_id)


@router.post("/{institute_id}/preview", summary="What proposed limits would have done over the last N days")
def post_preview(
    institute_id: str,
    body: cl.PreviewBody,
    lq: mq.LimitsQuery = Depends(cl.get_limits_query),
    engine=Depends(cl.get_limits_engine),
):
    iid = _institute(institute_id)
    cl.require_tables(lq)
    rows = cl.preview_rows(lq, iid, body.rows, platform=True)
    return cl.run_preview(engine, lq, iid, rows, body.days)
