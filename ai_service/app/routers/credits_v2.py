"""
Credits v2 — AI usage History / Analytics read API (/credits/v2/**).

Reads ai_usage_event (one row per billable AI operation, written by the
metering core inside CreditService.deduct_credits and the record-only paths)
joined to the credit ledger. Read-only and additive: the v1 /credits/v1/**
endpoints and their responses are unchanged.

Who sees what (enforced in SQL, see services/metering_query.py):
  * every route needs a valid user token and membership of the institute
    (require_institute_member: the signed JWT's per-institute authorities);
  * the institute's ADMINs and platform staff see every event of it;
  * anyone else only sees events they performed (actor_user_id = their id),
    whatever filters they send;
  * real_cost_usd (vendor dollars) is returned to platform staff only;
  * the CSV export is for ADMINs / platform staff only.

The endpoints work regardless of metering.history_v2_institutes; that setting
only tells the dashboard (via /usage-config) whether to show the v2 UI.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any, Callable, Iterator, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.security import (
    decode_access_token,
    get_current_user,
    is_platform_staff,
    jwt_institute_roles,
    require_institute_member,
)
from ..db import db_dependency
from ..services import metering_query as mq

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/credits/v2", tags=["Credits v2 — AI usage"])

HISTORY_V2_SETTING = "metering.history_v2_institutes"

# Matches no actor_user_id: a caller whose id cannot be read sees nothing.
_NO_USER = "-no-user-"


# ── dependencies (overridable in tests) ─────────────────────────────────────

def get_metering_query(db: Session = Depends(db_dependency)) -> mq.MeteringQuery:
    return mq.MeteringQuery(db)


def get_export_streamer() -> Callable[..., Iterator[str]]:
    """The streamed CSV body. It opens its own short-lived sessions (the
    request session is closed before a StreamingResponse body runs)."""
    return mq.iter_export_csv


# ── viewer resolution ───────────────────────────────────────────────────────

class Viewer:
    __slots__ = ("user_id", "is_admin", "is_staff")

    def __init__(self, user_id: str, is_admin: bool, is_staff: bool):
        self.user_id = user_id
        self.is_admin = is_admin
        self.is_staff = is_staff


def _caller_id(user: Any, authorization: Optional[str]) -> str:
    """The caller's user id from the signed token ('user' claim), else from
    the auth-service user; a filter that matches nothing when unreadable."""
    token = authorization[len("Bearer "):] if authorization and authorization.startswith("Bearer ") else None
    claims = decode_access_token(token) if token else None
    caller = (claims or {}).get("user") or (
        user.get("user_id") if isinstance(user, dict) else getattr(user, "user_id", None))
    caller = str(caller).strip() if caller else ""
    return caller if caller and caller != "unknown" else _NO_USER


def resolve_viewer(institute_id: str, user: Any, authorization: Optional[str]) -> Viewer:
    """403 unless a member of the institute; then admin = ADMIN role there or
    platform staff."""
    require_institute_member(authorization, institute_id)
    roles = jwt_institute_roles(authorization, institute_id) or set()
    staff = is_platform_staff(user)
    return Viewer(_caller_id(user, authorization), staff or "ADMIN" in roles, staff)


def scope_for(viewer: Viewer, institute_id: str, *, own_only: bool = False) -> mq.Scope:
    actor = None if (viewer.is_admin and not own_only) else viewer.user_id
    return mq.Scope(institute_id=institute_id, actor_user_id=actor, include_cost=viewer.is_staff)


def history_v2_enabled(institute_id: str, db: Optional[Session] = None) -> bool:
    """institute id (or "*") in metering.history_v2_institutes. Uses the
    metering core's reader when it is there, else reads the setting here."""
    try:
        from ..services.metering import cache as core_cache  # type: ignore
        return bool(core_cache.history_v2_enabled(institute_id))
    except Exception:  # noqa: BLE001 - core missing: read the setting directly
        pass
    try:
        from ..services.platform_settings_service import get_platform_setting
        raw = get_platform_setting(HISTORY_V2_SETTING, [], db=db)
    except Exception:  # noqa: BLE001 - setting not registered yet / DB blip = off
        return False
    if isinstance(raw, str):
        try:
            raw = json.loads(raw) if raw.strip() else []
        except ValueError:
            raw = [s.strip() for s in raw.split(",")]
    if not isinstance(raw, (list, tuple, set)):
        return False
    ids = {str(x).strip() for x in raw if x is not None}
    return "*" in ids or str(institute_id) in ids


# ── request parsing ─────────────────────────────────────────────────────────

def _upper_choice(value: Optional[str], allowed: tuple, name: str) -> Optional[str]:
    if value is None or not str(value).strip():
        return None
    v = str(value).strip().upper()
    if v not in allowed:
        raise HTTPException(status_code=422, detail=f"{name} must be one of {', '.join(allowed)}")
    return v


def _clean(value: Optional[str]) -> Optional[str]:
    return str(value).strip() or None if value is not None else None


def event_filters(
    from_: Optional[date] = Query(None, alias="from", description="YYYY-MM-DD (IST day, inclusive)"),
    to: Optional[date] = Query(None, description="YYYY-MM-DD (IST day, inclusive)"),
    user_id: Optional[str] = Query(None, max_length=255),
    role_class: Optional[str] = Query(None, max_length=16),
    feature_group: Optional[str] = Query(None, max_length=48),
    use_case: Optional[str] = Query(None, max_length=64),
    billing_mode: Optional[str] = Query(None, max_length=20),
    surface: Optional[str] = Query(None, max_length=24),
    min_credits: Optional[float] = Query(None, ge=0),
) -> mq.EventFilters:
    if from_ and to and to < from_:
        raise HTTPException(status_code=422, detail="'to' must not be before 'from'")
    return mq.EventFilters(
        from_date=from_,
        to_date=to,
        user_id=_clean(user_id),
        role_class=_upper_choice(role_class, mq.ROLE_CLASSES, "role_class"),
        feature_group=_clean(feature_group),
        use_case=_clean(use_case),
        billing_mode=_upper_choice(billing_mode, mq.BILLING_MODES, "billing_mode"),
        surface=_upper_choice(surface, mq.SURFACES, "surface"),
        min_credits=min_credits,
    )


def _days(days: int) -> int:
    if days not in mq.SUMMARY_DAYS:
        raise HTTPException(status_code=422, detail=f"days must be one of {', '.join(map(str, mq.SUMMARY_DAYS))}")
    return days


# ── endpoints ───────────────────────────────────────────────────────────────

@router.get("/institutes/{institute_id}/usage-config",
            summary="Whether the dashboard shows History/Analytics v2 here, and whether the caller is an admin")
def usage_config(
    institute_id: str,
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(db_dependency),
):
    viewer = resolve_viewer(institute_id, current_user, authorization)
    return {"history_v2_enabled": history_v2_enabled(institute_id, db), "is_admin": viewer.is_admin}


@router.get("/institutes/{institute_id}/usage-events",
            summary="AI usage events (plus non-usage ledger rows), newest first")
def usage_events(
    institute_id: str,
    filters: mq.EventFilters = Depends(event_filters),
    page: int = Query(1, ge=1, le=100_000),
    page_size: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    query: mq.MeteringQuery = Depends(get_metering_query),
):
    viewer = resolve_viewer(institute_id, current_user, authorization)
    scope = scope_for(viewer, institute_id)
    if not query.tables_ready():
        return {"items": [], "page": page, "page_size": page_size, "total": 0}
    return query.list_events(scope, filters, page, page_size)


@router.get("/institutes/{institute_id}/usage-summary",
            summary="AI credits grouped by use case / feature / role / user / IST day / model")
def usage_summary(
    institute_id: str,
    days: int = Query(30),
    group_by: str = Query("use_case", pattern="^(use_case|feature_group|role_class|user|day|model)$"),
    metric: str = Query("charged", pattern="^(charged|list)$"),
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    query: mq.MeteringQuery = Depends(get_metering_query),
):
    viewer = resolve_viewer(institute_id, current_user, authorization)
    days = _days(days)
    scope = scope_for(viewer, institute_id)
    if not query.tables_ready():
        return mq.empty_summary(group_by, days, metric)
    return query.summary(scope, days, group_by, metric)


@router.get("/institutes/{institute_id}/usage-events/export",
            summary="CSV export of usage events (institute admins / platform staff; max 100k rows)")
def usage_events_export(
    institute_id: str,
    format: str = Query("csv", pattern="^csv$"),
    filters: mq.EventFilters = Depends(event_filters),
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    query: mq.MeteringQuery = Depends(get_metering_query),
    streamer: Callable[..., Iterator[str]] = Depends(get_export_streamer),
):
    viewer = resolve_viewer(institute_id, current_user, authorization)
    if not viewer.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Only institute admins can export AI usage.")
    scope = scope_for(viewer, institute_id)
    ready = query.tables_ready()
    total = query.count_events(scope, filters) if ready else 0
    cap = mq.EXPORT_CAP
    headers = {
        "Content-Disposition": f'attachment; filename="ai-usage-{institute_id[:8]}.csv"',
        "X-Total-Rows": str(total),
        "X-Truncated": "true" if total > cap else "false",
        "Cache-Control": "no-store",
    }
    body = streamer(scope, filters, cap=cap) if ready else iter([mq._csv_line(mq.csv_header(scope.include_cost))])
    return StreamingResponse(body, media_type="text/csv; charset=utf-8", headers=headers)


def get_limits_db(db: Session = Depends(db_dependency)) -> Optional[Session]:
    """The session the caller's limits are read on (overridable in tests)."""
    return db


def caller_limits(db: Optional[Session], institute_id: str, viewer: Viewer,
                  authorization: Optional[str]) -> Optional[list]:
    """The caller's usage limits (routers/credits_limits.my_limits). None, with
    no query at all, for an institute without a limits policy; never raises."""
    try:
        from .credits_limits import my_limits
        roles = jwt_institute_roles(authorization, institute_id) or set()
        return my_limits(db, institute_id, user_id=None if viewer.user_id == _NO_USER else viewer.user_id,
                         is_admin=viewer.is_admin, is_staff=viewer.is_staff, raw_roles=sorted(roles))
    except Exception:  # noqa: BLE001 - display only
        logger.debug("me/usage limits unavailable", exc_info=True)
        return None


@router.get("/me/usage", summary="The caller's own AI usage in one institute, grouped by use case")
def my_usage(
    institute_id: str = Query(..., min_length=1, max_length=64),
    days: int = Query(30),
    current_user=Depends(get_current_user),
    authorization: Optional[str] = Header(None),
    query: mq.MeteringQuery = Depends(get_metering_query),
    limits_db: Optional[Session] = Depends(get_limits_db),
):
    viewer = resolve_viewer(institute_id, current_user, authorization)
    days = _days(days)
    scope = scope_for(viewer, institute_id, own_only=True)
    if not query.tables_ready():
        out = mq.empty_summary("use_case", days, "charged")
    else:
        out = query.summary(scope, days, "use_case", "charged")
    # Additive: the caller's limits, only for an institute with a limits policy
    # (every other institute gets exactly today's response).
    limits = caller_limits(limits_db, institute_id, viewer, authorization)
    if limits is not None:
        out["limits"] = limits
    return out
