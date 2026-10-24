"""
Super Admin Router - Platform-wide credit and AI usage endpoints.
"""

import logging
import math
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from typing import List, Optional

from pydantic import BaseModel, Field

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import db_dependency
from ..core.security import get_current_user, is_platform_staff
from ..schemas.auth import CustomUserDetails
from ..schemas.super_admin import (
    AiSettingEntry,
    AiSettingsCatalog,
    AiSettingsResponse,
    AiSettingUpdateRequest,
    LlmModelOption,
    ModelOption,
    TtsProviderOption,
    AllInstitutesCreditsResponse,
    CreditUsageLiveResponse,
    CreditWindowInstitute,
    CreditWindowTotals,
    CreditWindowTypeItem,
    InstituteCreditItem,
    PlatformUsageSummary,
    UsageByTypeItem,
    UsageByDayItem,
    TopInstituteUsage,
)

# Credits are net of refunds: a USAGE_DEDUCTION adds, a REFUND (failed video,
# aborted pipeline) subtracts. ADMIN_GRANT / ADMIN_DEDUCTION / PURCHASE are
# balance movements, not consumption, so they never enter these numbers.
_NET_CREDITS_SQL = (
    "CASE WHEN ct.transaction_type = 'USAGE_DEDUCTION' THEN ABS(ct.amount) "
    "ELSE -ABS(ct.amount) END"
)
_IS_USAGE_SQL = "CASE WHEN ct.transaction_type = 'USAGE_DEDUCTION' THEN 1 ELSE 0 END"

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/super-admin/v1", tags=["Super Admin"])


def _require_super_admin(user: Optional[CustomUserDetails]):
    """Raise 403 unless the user's id is on the platform-staff allowlist
    (SUPER_ADMIN_USER_IDS, see core.security.is_platform_staff).

    is_root_user and the ADMIN role are NOT staff signals: is_root_user is set for
    ordinary institute admins and learners, and ADMIN is an institute role, so
    either one let any institute admin rewrite global settings such as the tool
    rate card. Fails closed: with SUPER_ADMIN_USER_IDS unset, nobody passes.
    """
    if not is_platform_staff(user):
        if not (get_settings().super_admin_user_ids or "").strip():
            logger.warning("SUPER_ADMIN_USER_IDS is not set; refusing super-admin request")
        raise HTTPException(status_code=403, detail="Super admin access required")


@router.get(
    "/credits/all",
    response_model=AllInstitutesCreditsResponse,
    summary="Get all institutes credit balances (paginated)",
)
def get_all_credits(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    sort_by: str = Query("current_balance", enum=["current_balance", "total_credits", "used_credits"]),
    sort_direction: str = Query("ASC", enum=["ASC", "DESC"]),
    search: Optional[str] = Query(None),
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    try:
        _require_super_admin(current_user)

        offset = (page - 1) * page_size

        where_clause = ""
        params = {"limit": page_size, "offset": offset}
        if search and search.strip():
            where_clause = "WHERE CAST(institute_id AS TEXT) ILIKE :search"
            params["search"] = f"%{search.strip()}%"

        count_result = db.execute(text(f"SELECT COUNT(*) FROM institute_credits {where_clause}"), params)
        total = count_result.scalar() or 0

        query = text(f"""
            SELECT institute_id, total_credits, used_credits, current_balance,
                   low_balance_threshold, created_at, updated_at
            FROM institute_credits
            {where_clause}
            ORDER BY {sort_by} {sort_direction}
            LIMIT :limit OFFSET :offset
        """)
        rows = db.execute(query, params).fetchall()

        items = []
        for row in rows:
            balance = row[3] or Decimal("0")
            threshold = row[4] or Decimal("50")
            items.append(InstituteCreditItem(
                institute_id=str(row[0]),
                total_credits=row[1] or Decimal("0"),
                used_credits=row[2] or Decimal("0"),
                current_balance=balance,
                is_low_balance=balance <= threshold,
                created_at=row[5],
                updated_at=row[6],
            ))

        return AllInstitutesCreditsResponse(
            items=items,
            page=page,
            page_size=page_size,
            total=total,
            total_pages=math.ceil(total / page_size) if total > 0 else 0,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting all credits: {e}")
        return AllInstitutesCreditsResponse(
            items=[], page=page, page_size=page_size, total=0, total_pages=0
        )


@router.get(
    "/usage-summary",
    response_model=PlatformUsageSummary,
    summary="Get platform-wide AI usage summary",
)
def get_usage_summary(
    days: int = Query(30, ge=1, le=90),
    hours: Optional[int] = Query(
        None,
        ge=1,
        le=2160,
        description="Sub-day window (e.g. 1 or 24). Overrides `days` when set.",
    ),
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    window_hours = hours if hours is not None else days * 24
    # A 1h or 24h window bucketed by day is a single useless bar, so switch the
    # time series to hourly buckets for anything up to two days.
    bucket = "hour" if window_hours <= 48 else "day"

    try:
        _require_super_admin(current_user)

        # ai_token_usage.created_at is timestamptz — pass an AWARE instant so the
        # comparison never depends on the session TimeZone (a 5:30 skew is noise
        # over 30 days but wipes out a 1h window entirely).
        start_date = datetime.now(timezone.utc) - timedelta(hours=window_hours)
        # credit_transactions.created_at is a NAIVE timestamp written with
        # utcnow(), so it needs the naive twin of the same instant.
        start_date_naive = start_date.replace(tzinfo=None)

        # Totals
        totals_result = db.execute(
            text("""
                SELECT COALESCE(SUM(total_tokens), 0),
                       COALESCE(SUM(total_price), 0),
                       COUNT(*)
                FROM ai_token_usage
                WHERE created_at >= :start_date
            """),
            {"start_date": start_date},
        ).fetchone()

        total_tokens = int(totals_result[0]) if totals_result else 0
        total_cost = Decimal(str(totals_result[1])) if totals_result else Decimal("0")
        total_requests = int(totals_result[2]) if totals_result else 0

        # Credits burnt platform-wide in the same window (net of refunds)
        credits_total = db.execute(
            text(f"""
                SELECT COALESCE(SUM({_NET_CREDITS_SQL}), 0)
                FROM credit_transactions ct
                WHERE ct.created_at >= :start_date
                  AND ct.transaction_type IN ('USAGE_DEDUCTION', 'REFUND')
            """),
            {"start_date": start_date_naive},
        ).scalar()
        total_credits_used = Decimal(str(credits_total or 0))

        # By type
        type_rows = db.execute(
            text("""
                SELECT request_type,
                       COALESCE(SUM(total_tokens), 0),
                       COALESCE(SUM(total_price), 0),
                       COUNT(*)
                FROM ai_token_usage
                WHERE created_at >= :start_date
                GROUP BY request_type
                ORDER BY SUM(total_tokens) DESC
            """),
            {"start_date": start_date},
        ).fetchall()

        usage_by_type = [
            UsageByTypeItem(
                request_type=row[0] or "unknown",
                total_tokens=int(row[1]),
                total_cost=Decimal(str(row[2])),
                request_count=int(row[3]),
            )
            for row in type_rows
        ]

        # By day (or by hour for sub-2-day windows). Bucketed in UTC so the
        # labels line up with the totals above regardless of the DB session TZ.
        if bucket == "hour":
            bucket_expr = (
                "to_char(date_trunc('hour', created_at AT TIME ZONE 'UTC'), "
                "'YYYY-MM-DD\"T\"HH24:MI:00\"Z\"')"
            )
        else:
            bucket_expr = (
                "to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD')"
            )

        day_rows = db.execute(
            text(f"""
                SELECT {bucket_expr} AS usage_bucket,
                       COALESCE(SUM(total_tokens), 0),
                       COALESCE(SUM(total_price), 0),
                       COUNT(*)
                FROM ai_token_usage
                WHERE created_at >= :start_date
                GROUP BY usage_bucket
                ORDER BY usage_bucket
            """),
            {"start_date": start_date},
        ).fetchall()

        usage_by_day = [
            UsageByDayItem(
                date=str(row[0]),
                total_tokens=int(row[1]),
                total_cost=Decimal(str(row[2])),
                request_count=int(row[3]),
            )
            for row in day_rows
        ]

        # Credits per institute in the window, merged into the token leaderboard
        # below. Keyed by institute_id (VARCHAR here, UUID on ai_token_usage).
        credit_rows = db.execute(
            text(f"""
                SELECT ct.institute_id,
                       COALESCE(SUM({_NET_CREDITS_SQL}), 0)
                FROM credit_transactions ct
                WHERE ct.created_at >= :start_date
                  AND ct.transaction_type IN ('USAGE_DEDUCTION', 'REFUND')
                GROUP BY ct.institute_id
            """),
            {"start_date": start_date_naive},
        ).fetchall()
        credits_by_institute = {
            str(row[0]): Decimal(str(row[1] or 0)) for row in credit_rows
        }

        # Top institutes. ai_token_usage.institute_id is a UUID column and
        # institutes.id is VARCHAR, so the join casts the UUID to text — never
        # the other way round, which would blow up on any non-UUID institute id.
        inst_rows = db.execute(
            text("""
                SELECT CAST(u.institute_id AS TEXT) AS institute_id,
                       i.name AS institute_name,
                       COALESCE(SUM(u.total_tokens), 0),
                       COALESCE(SUM(u.total_price), 0),
                       COUNT(*)
                FROM ai_token_usage u
                LEFT JOIN institutes i ON i.id = CAST(u.institute_id AS TEXT)
                WHERE u.created_at >= :start_date AND u.institute_id IS NOT NULL
                GROUP BY u.institute_id, i.name
                ORDER BY SUM(u.total_tokens) DESC
                LIMIT 20
            """),
            {"start_date": start_date},
        ).fetchall()

        top_institutes = [
            TopInstituteUsage(
                institute_id=str(row[0]),
                institute_name=row[1],
                total_tokens=int(row[2]),
                total_cost=Decimal(str(row[3])),
                request_count=int(row[4]),
                credits_used=credits_by_institute.get(str(row[0]), Decimal("0")),
            )
            for row in inst_rows
        ]

        return PlatformUsageSummary(
            total_tokens=total_tokens,
            total_cost=total_cost,
            total_requests=total_requests,
            total_credits_used=total_credits_used,
            bucket=bucket,
            window_hours=window_hours,
            usage_by_type=usage_by_type,
            usage_by_day=usage_by_day,
            top_institutes=top_institutes,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting usage summary: {e}")
        return PlatformUsageSummary(
            total_tokens=0,
            total_cost=Decimal("0"),
            total_requests=0,
            total_credits_used=Decimal("0"),
            bucket=bucket,
            window_hours=window_hours,
            usage_by_type=[],
            usage_by_day=[],
            top_institutes=[],
        )


@router.get(
    "/credit-usage-live",
    response_model=CreditUsageLiveResponse,
    summary="Platform credit burn over the last 1 hour and last 24 hours",
)
def get_credit_usage_live(
    top: int = Query(10, ge=1, le=50, description="How many institutes/types to return"),
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    """
    Live credit consumption, net of refunds. One pass over the last 24h of
    credit_transactions serves both windows — the 1h numbers are a conditional
    sum over the same rows, so the two windows can never disagree.
    """
    # credit_transactions.created_at is a naive UTC timestamp (written with
    # utcnow()), so compare naive-to-naive and skip session-TZ conversion.
    now = datetime.utcnow()
    since_24h = now - timedelta(hours=24)
    since_1h = now - timedelta(hours=1)
    params = {"since_24h": since_24h, "since_1h": since_1h}

    # Timestamps go out UTC-stamped so clients don't have to guess the zone.
    now_utc = now.replace(tzinfo=timezone.utc)
    since_24h_utc = since_24h.replace(tzinfo=timezone.utc)
    since_1h_utc = since_1h.replace(tzinfo=timezone.utc)

    empty = CreditUsageLiveResponse(
        generated_at=now_utc,
        last_1h=CreditWindowTotals(
            hours=1, since=since_1h_utc, credits_used=Decimal("0"),
            request_count=0, institute_count=0,
        ),
        last_24h=CreditWindowTotals(
            hours=24, since=since_24h_utc, credits_used=Decimal("0"),
            request_count=0, institute_count=0,
        ),
        top_institutes=[],
        by_request_type=[],
    )

    try:
        _require_super_admin(current_user)

        window_cte = f"""
            WITH tx AS (
                SELECT ct.institute_id,
                       ct.request_type,
                       ct.created_at,
                       {_NET_CREDITS_SQL} AS net_credits,
                       {_IS_USAGE_SQL} AS is_usage
                FROM credit_transactions ct
                WHERE ct.created_at >= :since_24h
                  AND ct.transaction_type IN ('USAGE_DEDUCTION', 'REFUND')
            )
        """

        inst_rows = db.execute(
            text(f"""
                {window_cte}
                SELECT tx.institute_id,
                       i.name AS institute_name,
                       COALESCE(SUM(CASE WHEN tx.created_at >= :since_1h THEN tx.net_credits ELSE 0 END), 0),
                       COALESCE(SUM(CASE WHEN tx.created_at >= :since_1h THEN tx.is_usage ELSE 0 END), 0),
                       COALESCE(SUM(tx.net_credits), 0),
                       COALESCE(SUM(tx.is_usage), 0)
                FROM tx
                LEFT JOIN institutes i ON i.id = tx.institute_id
                GROUP BY tx.institute_id, i.name
                ORDER BY SUM(tx.net_credits) DESC
            """),
            params,
        ).fetchall()

        institutes = [
            CreditWindowInstitute(
                institute_id=str(row[0]),
                institute_name=row[1],
                credits_1h=Decimal(str(row[2] or 0)),
                requests_1h=int(row[3] or 0),
                credits_24h=Decimal(str(row[4] or 0)),
                requests_24h=int(row[5] or 0),
            )
            for row in inst_rows
        ]

        type_rows = db.execute(
            text(f"""
                {window_cte}
                SELECT COALESCE(tx.request_type, 'unknown'),
                       COALESCE(SUM(CASE WHEN tx.created_at >= :since_1h THEN tx.net_credits ELSE 0 END), 0),
                       COALESCE(SUM(CASE WHEN tx.created_at >= :since_1h THEN tx.is_usage ELSE 0 END), 0),
                       COALESCE(SUM(tx.net_credits), 0),
                       COALESCE(SUM(tx.is_usage), 0)
                FROM tx
                GROUP BY COALESCE(tx.request_type, 'unknown')
                ORDER BY SUM(tx.net_credits) DESC
                LIMIT :top
            """),
            {**params, "top": top},
        ).fetchall()

        by_request_type = [
            CreditWindowTypeItem(
                request_type=str(row[0]),
                credits_1h=Decimal(str(row[1] or 0)),
                requests_1h=int(row[2] or 0),
                credits_24h=Decimal(str(row[3] or 0)),
                requests_24h=int(row[4] or 0),
            )
            for row in type_rows
        ]

        # Totals roll up from the full (unsliced) institute list, so they stay
        # correct no matter how small `top` is.
        return CreditUsageLiveResponse(
            generated_at=now_utc,
            last_1h=CreditWindowTotals(
                hours=1,
                since=since_1h_utc,
                credits_used=sum((i.credits_1h for i in institutes), Decimal("0")),
                request_count=sum(i.requests_1h for i in institutes),
                institute_count=sum(1 for i in institutes if i.requests_1h > 0),
            ),
            last_24h=CreditWindowTotals(
                hours=24,
                since=since_24h_utc,
                credits_used=sum((i.credits_24h for i in institutes), Decimal("0")),
                request_count=sum(i.requests_24h for i in institutes),
                institute_count=sum(1 for i in institutes if i.requests_24h > 0),
            ),
            top_institutes=institutes[:top],
            by_request_type=by_request_type,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting live credit usage: {e}")
        return empty


# ===========================================================================
# Platform AI runtime settings
# ===========================================================================
#
# Which model answers the learner chatbot, which engine speaks the voice call,
# rollout flags. Stored in ai_platform_settings (V493), declared in
# platform_settings_service.SETTING_SPECS, cached ~30s on every replica.

def _find_setting(db: Session, key: str) -> AiSettingEntry:
    from ..services.platform_settings_service import list_platform_settings

    for entry in list_platform_settings(db):
        if entry["key"] == key:
            return AiSettingEntry(**entry)
    raise HTTPException(status_code=404, detail=f"Unknown setting {key}")


def _llm_model_catalog(db: Session) -> list:
    """Active chat-capable models from the ai_models registry (V101)."""
    rows = db.execute(text(
        """
        SELECT model_id, name, provider, tier, COALESCE(is_free, FALSE)
        FROM ai_models
        WHERE is_active = TRUE
          AND category NOT IN ('embedding', 'image', 'tts', 'video')
        ORDER BY display_order, provider, name
        """
    )).fetchall()
    return [
        LlmModelOption(model_id=r[0], name=r[1], provider=r[2], tier=r[3], is_free=bool(r[4]))
        for r in rows
    ]


def _image_model_catalog(db: Session) -> list:
    """Active image-generation models (category = 'image')."""
    rows = db.execute(text(
        """
        SELECT model_id, name, provider, tier, COALESCE(is_free, FALSE)
        FROM ai_models
        WHERE is_active = TRUE AND category = 'image'
        ORDER BY display_order, provider, name
        """
    )).fetchall()
    return [
        LlmModelOption(model_id=r[0], name=r[1], provider=r[2], tier=r[3] or "", is_free=bool(r[4]))
        for r in rows
    ]


def _all_model_catalog(db: Session) -> list:
    rows = db.execute(text(
        """
        SELECT model_id, name, provider, category, tier, COALESCE(is_free, FALSE)
        FROM ai_models
        WHERE is_active = TRUE
        ORDER BY category, display_order, provider, name
        """
    )).fetchall()
    return [
        ModelOption(model_id=r[0], name=r[1], provider=r[2], category=r[3] or "general", tier=r[4], is_free=bool(r[5]))
        for r in rows
    ]


@router.get(
    "/ai-settings",
    response_model=AiSettingsResponse,
    summary="Platform AI runtime settings with the option catalogue",
)
def get_ai_settings(
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services.platform_settings_service import get_cache_status, list_platform_settings
    from ..services.voice_tts import list_tts_providers

    return AiSettingsResponse(
        settings=[AiSettingEntry(**e) for e in list_platform_settings(db)],
        catalog=AiSettingsCatalog(
            llm_models=_llm_model_catalog(db),
            image_models=_image_model_catalog(db),
            all_models=_all_model_catalog(db),
            tts_providers=[TtsProviderOption(**p) for p in list_tts_providers()],
        ),
        cache=get_cache_status(),
    )


@router.put(
    "/ai-settings/{key}",
    response_model=AiSettingEntry,
    summary="Set one platform AI setting (applies on every replica within ~30s)",
)
def put_ai_setting(
    key: str,
    body: AiSettingUpdateRequest,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services.platform_settings_service import set_platform_setting

    try:
        set_platform_setting(db, key, body.value, updated_by=current_user.user_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown setting {key}")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    logger.info("ai setting %s set by %s", key, current_user.user_id)
    return _find_setting(db, key)


@router.delete(
    "/ai-settings/{key}",
    response_model=AiSettingEntry,
    summary="Reset one platform AI setting to its environment default",
)
def delete_ai_setting(
    key: str,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services.platform_settings_service import reset_platform_setting

    try:
        reset_platform_setting(db, key)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown setting {key}")
    logger.info("ai setting %s reset by %s", key, current_user.user_id)
    return _find_setting(db, key)


# ===========================================================================
# Credits & pricing: the parametric rates every tool charges
# ===========================================================================
#
# `ai_tool_pricing` rows (V321+) are what ToolCostEstimator reads on every
# charge and preflight; Python DEFAULT_TOOL_PRICING only fills gaps. Editing a
# row here changes what institutes pay from the next request — no deploy.

TOOL_LABELS = {
    "tutor_compile_slide": "Live AI Tutor: compile one slide into a teaching plan",
    "tutor_media_image": "Live AI Tutor: one AI image on a whiteboard",
    "tutor_live_minute": "Live AI Tutor: one minute of a voice lesson",
    "tutor_voice_prepare": "Live AI Tutor: prepare the teacher's voice for one slide (per language, one-time)",
    "tutor_avatar_minute": "Live AI Tutor: teacher avatar (premium), per lesson minute on top of the live minute",
    "tutor_voice_clone": "Live AI Tutor: clone a teacher's voice (one-time, per voice)",
    "tutor_avatar_create": "Live AI Tutor: create a custom teacher avatar (one-time, per avatar)",
    "copy_check_evaluation": "AI evaluation — dashboard (per question)",
    "copy_check_evaluation_api": "AI evaluation — API partners (fixed price)",
}


class ToolPricingUpdate(BaseModel):
    flat_base_credits: Optional[float] = None
    per_unit_credits: Optional[float] = None
    params: Optional[dict] = None
    is_active: Optional[bool] = None
    # Required (spec 10.5): written to ai_tool_pricing_history with the change.
    reason: Optional[str] = Field(None, max_length=2000)


class InstituteToolPricingUpdate(BaseModel):
    """A per-institute price (spec 10.7). Null fields inherit the global rate."""
    flat_base_credits: Optional[float] = Field(None, ge=0, le=10000)
    per_unit_credits: Optional[float] = Field(None, ge=0, le=10000)
    params: Optional[dict] = None
    no_token_overage: bool = False
    reason: str = Field(..., max_length=2000, description="Contract reference; required")


def _pricing_call(fn, *args, **kwargs):
    """Run a tool_pricing_admin call, mapping its refusals to HTTP errors."""
    from ..services.tool_pricing_admin import PricingAdminError

    try:
        return fn(*args, **kwargs)
    except PricingAdminError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/tool-pricing", summary="Every tool's credit rate (ai_tool_pricing merged with code defaults)")
def super_tool_pricing(
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services.tool_cost_estimator import DEFAULT_TOOL_PRICING, ToolCostEstimator

    from ..services.tool_pricing_admin import override_counts

    db_rows = {r[0]: r for r in db.execute(text(
        "SELECT tool_key, is_active, updated_at FROM ai_tool_pricing"
    )).fetchall()}
    merged = ToolCostEstimator(db).get_tool_pricing()
    counts = override_counts(db)
    tools = []
    for key, row in sorted(merged.items()):
        tools.append({
            "tool_key": key,
            "label": TOOL_LABELS.get(key, key.replace("_", " ")),
            "request_type": row["request_type"],
            "flat_base_credits": float(row["flat_base_credits"]),
            "per_unit_credits": float(row["per_unit_credits"]),
            "unit_field": row["unit_field"],
            "params": row.get("params") or {},
            "source": "db" if key in db_rows else "default",
            "is_active": bool(db_rows[key][1]) if key in db_rows else True,
            "updated_at": db_rows[key][2].isoformat() if key in db_rows and db_rows[key][2] else None,
            "has_default": key in DEFAULT_TOOL_PRICING,
            "override_count": counts.get(key, 0),
        })
    return {"tools": tools}


@router.put("/tool-pricing/{tool_key}", summary="Set a tool's credit rate (applies to the next request)")
def super_put_tool_pricing(
    tool_key: str,
    body: ToolPricingUpdate,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services.tool_cost_estimator import ToolCostEstimator
    from ..services.tool_pricing_admin import rate_view, record_global_change

    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="reason is required: say why this rate changes")
    current = ToolCostEstimator(db).get_tool_pricing(tool_key).get(tool_key)
    if current is None:
        raise HTTPException(status_code=404, detail=f"Unknown tool {tool_key}")
    flat = float(body.flat_base_credits) if body.flat_base_credits is not None else float(current["flat_base_credits"])
    per_unit = float(body.per_unit_credits) if body.per_unit_credits is not None else float(current["per_unit_credits"])
    if flat < 0 or per_unit < 0 or flat > 10000 or per_unit > 10000:
        raise HTTPException(status_code=422, detail="Rates must be between 0 and 10000 credits")
    params = body.params if body.params is not None else (current.get("params") or {})
    is_active = body.is_active if body.is_active is not None else True
    db.execute(text("""
        INSERT INTO ai_tool_pricing (tool_key, request_type, flat_base_credits, per_unit_credits, unit_field, params_json, is_active, updated_at)
        VALUES (:k, :rt, :flat, :per, :unit, CAST(:params AS JSONB), :active, now())
        ON CONFLICT (tool_key) DO UPDATE SET
            flat_base_credits = EXCLUDED.flat_base_credits,
            per_unit_credits = EXCLUDED.per_unit_credits,
            params_json = EXCLUDED.params_json,
            is_active = EXCLUDED.is_active,
            updated_at = now()
    """), {"k": tool_key, "rt": current["request_type"], "flat": flat, "per": per_unit,
           "unit": current["unit_field"], "params": json.dumps(params), "active": is_active})
    record_global_change(
        db, tool_key,
        old={**rate_view(current), "rate_source": current.get("rate_source")},
        new={"flat": flat, "per_unit": per_unit, "unit_field": current["unit_field"],
             "params": params, "is_active": is_active},
        actor=str(current_user.user_id), reason=reason,
    )
    db.commit()
    logger.info("tool pricing %s set by %s: flat=%s per_unit=%s (%s)",
                tool_key, current_user.user_id, flat, per_unit, reason)
    tools = super_tool_pricing(db=db, current_user=current_user)["tools"]
    return next(t for t in tools if t["tool_key"] == tool_key)


# ── Per-institute prices (spec 10.2, 10.7) ──────────────────────────────────
# A partner's contract price is an institute_tool_pricing row on that tool key
# (for the evaluation API: copy_check_evaluation_api). Append-only: an edit
# closes the open row and inserts a new one; DELETE ends it (back to global).


@router.get("/tool-pricing/history", summary="Global rate edits and per-institute override rows, newest first")
def super_tool_pricing_history(
    tool_key: Optional[str] = Query(None),
    institute_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services import tool_pricing_admin

    return tool_pricing_admin.history(db, tool_key=tool_key, institute_id=institute_id, limit=limit)


@router.get("/tool-pricing/overrides", summary="Institutes with an active price override")
def super_tool_pricing_overrides(
    tool_key: Optional[str] = Query(None),
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services import tool_pricing_admin

    return {"overrides": tool_pricing_admin.active_overrides(db, tool_key=tool_key)}


@router.get("/institutes/{institute_id}/tool-pricing",
            summary="One institute's rate card: global, its override and the effective price per tool")
def super_institute_tool_pricing(
    institute_id: str,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services import tool_pricing_admin

    return {"institute_id": institute_id,
            "tools": tool_pricing_admin.list_institute_pricing(db, institute_id, TOOL_LABELS)}


@router.put("/institutes/{institute_id}/tool-pricing/{tool_key}",
            summary="Set an institute's own price for a tool (applies to the next request)")
def super_put_institute_tool_pricing(
    institute_id: str,
    tool_key: str,
    body: InstituteToolPricingUpdate,
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services import tool_pricing_admin

    return _pricing_call(
        tool_pricing_admin.set_override, db, institute_id, tool_key,
        flat_base_credits=body.flat_base_credits, per_unit_credits=body.per_unit_credits,
        params=body.params, no_token_overage=body.no_token_overage,
        reason=body.reason, actor=str(current_user.user_id),
    )


@router.delete("/institutes/{institute_id}/tool-pricing/{tool_key}",
               summary="End an institute's price override (it reverts to the global price)")
def super_delete_institute_tool_pricing(
    institute_id: str,
    tool_key: str,
    reason: Optional[str] = Query(None, max_length=2000),
    db: Session = Depends(db_dependency),
    current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services import tool_pricing_admin

    return _pricing_call(
        tool_pricing_admin.end_override, db, institute_id, tool_key,
        reason=reason, actor=str(current_user.user_id),
    )


# ── Live AI Tutor asset registry (stock + per-institute voices and avatars) ──

class TutorAssetCreate(BaseModel):
    kind: str = Field(..., pattern="^(voice|avatar)$")
    provider: str = Field(..., min_length=1, max_length=32)
    external_id: str = Field(..., min_length=1, max_length=160)
    display_name: str = Field(..., min_length=1, max_length=120)
    # Blank = platform stock visible to every institute.
    institute_id: Optional[str] = Field(default=None, max_length=255)
    gender: Optional[str] = Field(default=None, max_length=16)
    languages: Optional[List[str]] = None
    preview_url: Optional[str] = None
    notes: Optional[str] = None


class TutorAssetPatch(BaseModel):
    external_id: Optional[str] = Field(default=None, max_length=160)
    display_name: Optional[str] = Field(default=None, max_length=120)
    institute_id: Optional[str] = Field(default=None, max_length=255)
    status: Optional[str] = Field(default=None, pattern="^(requested|processing|ready|failed|disabled)$")
    gender: Optional[str] = Field(default=None, max_length=16)
    languages: Optional[List[str]] = None
    preview_url: Optional[str] = None
    error: Optional[str] = None
    notes: Optional[str] = None
    # Fulfilling an institute's request charges the one-time fee unless false.
    charge: bool = True


@router.get("/tutor-assets", summary="Live AI Tutor: every registered voice and avatar (stock + institutes)")
def super_tutor_assets(
    kind: Optional[str] = None, institute_id: Optional[str] = None, status: Optional[str] = None,
    stock_only: bool = False, limit: int = 500,
    db: Session = Depends(db_dependency), current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services.tutor import asset_registry
    from ..services.tool_cost_estimator import ToolCostEstimator
    pricing = ToolCostEstimator(db).get_tool_pricing()
    fees = {k: float(pricing.get(k, {}).get("flat_base_credits") or 0)
            for k in (asset_registry.VOICE_CLONE_TOOL, asset_registry.AVATAR_CREATE_TOOL)}
    return {"assets": asset_registry.list_all(db, kind=kind, institute_id=institute_id, status=status,
                                              stock_only=stock_only, limit=limit),
            "one_time_credits": {"voice": fees[asset_registry.VOICE_CLONE_TOOL],
                                 "avatar": fees[asset_registry.AVATAR_CREATE_TOOL]}}


@router.post("/tutor-assets", summary="Register a stock (or institute-owned) voice/avatar by its vendor id")
def super_tutor_asset_create(
    body: TutorAssetCreate,
    db: Session = Depends(db_dependency), current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services.tutor import asset_registry
    row = asset_registry.create(db, kind=body.kind, provider=body.provider, external_id=body.external_id.strip(),
                                display_name=body.display_name.strip(), institute_id=body.institute_id or None,
                                status="ready", gender=body.gender, languages=body.languages,
                                preview_url=body.preview_url, requested_by=current_user.user_id, notes=body.notes,
                                consent=bool(body.institute_id))
    logger.info("tutor asset %s registered by %s (%s %s inst=%s)", row["id"], current_user.user_id, body.kind,
                body.external_id, body.institute_id)
    return row


@router.patch("/tutor-assets/{asset_id}", summary="Fulfil, rename, re-home or disable a registered asset")
def super_tutor_asset_patch(
    asset_id: str, body: TutorAssetPatch,
    db: Session = Depends(db_dependency), current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services.tutor import asset_registry
    current = asset_registry.get(db, asset_id)
    if not current:
        raise HTTPException(status_code=404, detail="Asset not found")
    fields = {k: v for k, v in body.model_dump(exclude={"charge"}).items() if v is not None}
    if "external_id" in fields:
        fields["external_id"] = fields["external_id"].strip()
    # Pasting a vendor id into a pending request fulfils it.
    if fields.get("external_id") and current["status"] in ("requested", "processing", "failed") and "status" not in fields:
        fields["status"] = "ready"
    if fields.get("status") == "ready" and not (fields.get("external_id") or current.get("external_id")):
        raise HTTPException(status_code=422, detail="A ready asset needs the vendor's id")
    row = asset_registry.update(db, asset_id, **fields)
    if row and body.charge and row["status"] == "ready" and current["status"] != "ready" and row["institute_id"]:
        tool = asset_registry.AVATAR_CREATE_TOOL if row["kind"] == "avatar" else asset_registry.VOICE_CLONE_TOOL
        try:
            asset_registry.charge_one_time(db, asset=row, tool_key=tool,
                                           model="spatius-avatar" if row["kind"] == "avatar" else "smallest-clone",
                                           user_id=row.get("requested_by"))
            row = asset_registry.get(db, asset_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("one-time charge for asset %s failed: %s", asset_id, e)
    logger.info("tutor asset %s patched by %s: %s", asset_id, current_user.user_id, sorted(fields))
    return row


@router.delete("/tutor-assets/{asset_id}", summary="Delete a registered asset")
def super_tutor_asset_delete(
    asset_id: str,
    db: Session = Depends(db_dependency), current_user: CustomUserDetails = Depends(get_current_user),
):
    _require_super_admin(current_user)
    from ..services.tutor import asset_registry
    if not asset_registry.delete(db, asset_id):
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"deleted": asset_id}


# ── Live AI Tutor public demo topics (tutezy.ai "Try a lesson") ─────────────

class DemoTopicUpsert(BaseModel):
    title: str = Field(..., min_length=1, max_length=160)
    source_text: str = Field(..., min_length=50, max_length=40000)
    emoji: Optional[str] = Field(default=None, max_length=16)
    language: str = Field(default="en", pattern="^(en|hi)$")
    sort_order: int = 100
    is_active: bool = True
    # lesson | interview | practice — the session register (persona, greeting, board shape).
    style: str = Field(default="lesson", pattern="^(lesson|interview|practice)$")
    # Compile right away (background) after saving.
    compile: bool = True


@router.get("/demo-topics", summary="Tutezy demo: topics, their authored text and plan state")
def super_demo_topics(with_source: bool = False, db: Session = Depends(db_dependency),
                      current_user: CustomUserDetails = Depends(get_current_user)):
    _require_super_admin(current_user)
    from ..services.tutor import demo
    return {"topics": demo.list_topics(db, with_source=with_source), "config": demo.config(db)}


def _compile_demo_topic(key: str, institute_id: str, user_id: Optional[str]) -> None:
    import asyncio
    from ..services.tutor.plan_compiler import PlanCompiler
    from ..services.tutor.runtime.settings import resolve_settings
    from ..services.tutor import demo
    from ..db import db_session
    with db_session() as db:
        s = resolve_settings(db, package_id="", institute_id=institute_id)
        c = demo.config(db)
    compiler = PlanCompiler(institute_id=institute_id, user_id=user_id, language="en",
                            teacher_name=c.get("teacher_name") or s.teacher_name, force=True, generate_images=True,
                            model_override=s.compile_model,
                            voice_prepare={"provider": s.tts_provider, "voice": s.tts_voice, "base_pace": s.voice_pace,
                                           "languages": s.languages, "course_lang": s.course_language} if s.tts_provider else None)
    try:
        result = asyncio.run(compiler.compile_slide(demo.slide_id_for(key)))
        logger.info("demo topic %s compiled: %s", key, result.get("type"))
    except Exception as e:  # noqa: BLE001
        logger.exception("demo topic %s compile failed: %s", key, e)


@router.put("/demo-topics/{key}", summary="Tutezy demo: create or update a topic (and compile it)")
def super_demo_topic_put(key: str, body: DemoTopicUpsert, background: BackgroundTasks,
                         db: Session = Depends(db_dependency), current_user: CustomUserDetails = Depends(get_current_user)):
    _require_super_admin(current_user)
    from ..services.tutor import demo
    key = "".join(ch for ch in key.lower() if ch.isalnum() or ch in "-_")[:64]
    if not key:
        raise HTTPException(status_code=422, detail="key must be letters, digits, - or _")
    demo.upsert_topic(db, key=key, title=body.title, source_text=body.source_text, emoji=body.emoji,
                      language=body.language, sort_order=body.sort_order, is_active=body.is_active, style=body.style)
    c = demo.config(db)
    if body.compile and c["institute_id"]:
        background.add_task(_compile_demo_topic, key, c["institute_id"], current_user.user_id)
    return {"key": key, "compiling": bool(body.compile and c["institute_id"])}


@router.post("/demo-topics/{key}/compile", summary="Tutezy demo: (re)compile one topic")
def super_demo_topic_compile(key: str, background: BackgroundTasks, db: Session = Depends(db_dependency),
                             current_user: CustomUserDetails = Depends(get_current_user)):
    _require_super_admin(current_user)
    from ..services.tutor import demo
    c = demo.config(db)
    if not c["institute_id"]:
        raise HTTPException(status_code=422, detail="Set tutor.demo.institute_id first")
    background.add_task(_compile_demo_topic, key, c["institute_id"], current_user.user_id)
    return {"key": key, "compiling": True}


@router.delete("/demo-topics/{key}", summary="Tutezy demo: delete a topic")
def super_demo_topic_delete(key: str, db: Session = Depends(db_dependency),
                            current_user: CustomUserDetails = Depends(get_current_user)):
    _require_super_admin(current_user)
    from ..services.tutor import demo
    if not demo.delete_topic(db, key):
        raise HTTPException(status_code=404, detail="Topic not found")
    return {"deleted": key}
