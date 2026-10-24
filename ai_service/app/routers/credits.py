"""
Credit Router - API endpoints for credit management.

Endpoints for managing institute credits:
- Balance management (view, grant)
- Pre-flight credit checks
- Credit deduction
- Transaction history
- Usage analytics
- Alert management
- Pricing configuration
"""

import hmac
import logging
from typing import Optional, List
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import db_dependency
from ..core.security import (
    decode_access_token,
    get_current_user,
    get_optional_user,
    is_platform_staff,
    jwt_institute_roles,
    require_institute_member,
)
from ..dependencies import require_internal_service_token
from ..services.credit_service import CreditService
from ..services.credit_rate_service import CreditRateService
from ..schemas.credits import (
    CreditBalanceResponse,
    CreditGrantRequest,
    CreditGrantResponse,
    CreditCheckRequest,
    CreditCheckResponse,
    CreditDeductRequest,
    CreditDeductResponse,
    CreditRateConfigResponse,
    CreditRateConfigUpdateRequest,
    InternalGrantFromPaymentRequest,
    InternalRefundFromPaymentRequest,
    InternalGrantOrRefundResponse,
    InternalChargeToolRequest,
    InternalChargeToolResponse,
    ToolEstimateRequest,
    TransactionHistoryRequest,
    TransactionHistoryResponse,
    UsageAnalyticsResponse,
    UsageForecastResponse,
    AllPricingResponse,
    AlertsListResponse,
    AcknowledgeAlertRequest,
)


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/credits/v1", tags=["Credits"])


# ============================================================================
# Helper Functions
# ============================================================================

def get_credit_service(db: Session = Depends(db_dependency)) -> CreditService:
    """Dependency to get credit service instance."""
    return CreditService(db)


def check_root_admin(user) -> bool:
    """
    Root user or ROOT_ADMIN role. NOT a platform-staff check (is_root_user is set
    for ordinary admins and learners) — global writes use is_platform_staff. Left
    only as the in-institute cross-user bypass on the usage reads below.
    """
    if not user:
        return False
    # Primary check: is_root_user boolean flag (matches Java User.isRootUser)
    if hasattr(user, "is_root_user") and user.is_root_user:
        return True
    # Fallback: check roles list
    roles = getattr(user, "roles", []) if not isinstance(user, dict) else user.get("roles", [])
    if isinstance(roles, str):
        roles = [r.strip() for r in roles.split(",")]
    return "ROOT_ADMIN" in roles


def _actor_id(user) -> str:
    """
    Actor id for the audit trail. get_current_user/get_optional_user return a
    CustomUserDetails (a pydantic model, NOT a dict), so `user.get("user_id")`
    raises AttributeError — read the attribute, tolerating either shape.
    """
    if not user:
        return "system"
    if isinstance(user, dict):
        return user.get("user_id") or "system"
    return getattr(user, "user_id", None) or "system"


def _internal_token_matches(token: Optional[str]) -> bool:
    """True when the caller presented this server's service-to-service secret."""
    expected = get_settings().internal_service_token
    if not expected or not token:
        return False
    return hmac.compare_digest(token, expected)


def _require_user_or_internal(
    user,
    internal_token: Optional[str],
    institute_id: Optional[str] = None,
    authorization: Optional[str] = None,
) -> None:
    """
    Gate for endpoints that BOTH a signed-in dashboard user and our own backend
    call. admin_core_service's CreditClient reaches us over the cluster network
    with no JWT to forward — it is frequently acting for a scheduler rather than
    a request (EngagementDispatchJob, AiCallService) — so a JWT-only gate 401s
    every server-to-server read.

    When the request names an institute, a JWT caller must also be a member of
    it (read from the token's per-institute authorities; no root bypass).
    """
    if _internal_token_matches(internal_token):
        return
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    if institute_id:
        require_institute_member(authorization, institute_id)


def _authorize_credit_adjustment(
    user,
    internal_token: Optional[str],
    acting_user_id: Optional[str],
    action: str,
) -> str:
    """
    Authorize a super-admin credit adjustment and return the actor id recorded
    on the transaction. Two accepted callers:

      - admin_core_service's /super-admin/v1/institutes/{id}/grant-credits
        controller, presenting X-Internal-Service-Token. It has already enforced
        isRootUser via SuperAdminAuthUtil, so the acting_user_id it sends in the
        body is trusted — that path is unreachable without the shared secret.
      - a platform-staff JWT (SUPER_ADMIN_USER_IDS) hitting this endpoint
        directly, in which case the actor comes from the verified token and the
        body field is ignored.
    """
    if _internal_token_matches(internal_token):
        return acting_user_id or "system"
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )
    if not is_platform_staff(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Only platform staff can {action} credits",
        )
    return _actor_id(user)


# ============================================================================
# Balance Endpoints
# ============================================================================

@router.get(
    "/institutes/{institute_id}/balance",
    response_model=CreditBalanceResponse,
    summary="Get institute credit balance",
    description="Get the current credit balance for an institute.",
)
def get_balance(
    institute_id: str,
    service: CreditService = Depends(get_credit_service),
    current_user: Optional[dict] = Depends(get_optional_user),
    x_internal_service_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Get current credit balance for an institute."""
    _require_user_or_internal(current_user, x_internal_service_token, institute_id, authorization)

    balance = service.get_balance(institute_id)
    
    if not balance:
        # Create initial credits for this institute
        balance = service.create_initial_credits(institute_id)
    
    return balance


@router.post(
    "/institutes/{institute_id}/grant",
    response_model=CreditGrantResponse,
    summary="Grant credits to institute (platform staff only)",
    description=(
        "Grant credits to an institute. Callable with a platform-staff JWT or with "
        "X-Internal-Service-Token (admin_core_service's super-admin console)."
    ),
)
def grant_credits(
    institute_id: str,
    request: CreditGrantRequest,
    service: CreditService = Depends(get_credit_service),
    current_user: Optional[dict] = Depends(get_optional_user),
    x_internal_service_token: Optional[str] = Header(None),
):
    """Grant credits to an institute (admin action)."""
    granted_by = _authorize_credit_adjustment(
        current_user, x_internal_service_token, request.acting_user_id, "grant"
    )
    return service.grant_credits(institute_id, request, granted_by=granted_by)


# ============================================================================
# Admin Credit Deduction Endpoint (platform staff only)
# ============================================================================

@router.post(
    "/institutes/{institute_id}/deduct-admin",
    response_model=CreditGrantResponse,
    summary="Deduct credits from institute (platform staff only)",
    description=(
        "Admin deduction of credits from an institute. Callable with a platform-staff "
        "JWT or with X-Internal-Service-Token (admin_core_service's super-admin "
        "console)."
    ),
)
def admin_deduct_credits(
    institute_id: str,
    request: CreditGrantRequest,
    service: CreditService = Depends(get_credit_service),
    current_user: Optional[dict] = Depends(get_optional_user),
    x_internal_service_token: Optional[str] = Header(None),
):
    """Deduct credits from an institute (admin action)."""
    deducted_by = _authorize_credit_adjustment(
        current_user, x_internal_service_token, request.acting_user_id, "deduct"
    )
    return service.admin_deduct_credits(institute_id, request, deducted_by=deducted_by)


# ============================================================================
# Credit Check Endpoint (Internal - for pre-flight checks)
# ============================================================================

@router.post(
    "/check",
    response_model=CreditCheckResponse,
    summary="Check if institute has sufficient credits",
    description="Pre-flight credit check before AI operations.",
)
def check_credits(
    request: CreditCheckRequest,
    service: CreditService = Depends(get_credit_service),
    current_user: Optional[dict] = Depends(get_optional_user),
    x_internal_service_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """
    Check if an institute has sufficient credits for an operation.
    
    This is called before making AI API calls to prevent work on 
    requests that will fail due to insufficient credits.
    """
    _require_user_or_internal(
        current_user, x_internal_service_token, request.institute_id, authorization
    )
    # Usage limits: only our own services (internal token) may name the actor
    # in the body; a signed-in caller is limited as themselves (JWT), so a
    # member cannot read another user's limit verdict / usage or pose as SYSTEM.
    return service.check_credits(
        request, trust_actor_fields=_internal_token_matches(x_internal_service_token))


@router.post(
    "/deduct",
    response_model=CreditDeductResponse,
    summary="Deduct credits after AI operation (internal)",
    description=(
        "Deduct credits after an AI operation completes. Requires "
        "X-Internal-Service-Token: this endpoint honors request-supplied "
        "precomputed_credits and allow_negative, and the /ai-service/ prefix is "
        "publicly routed — left unauthenticated, anyone on the internet could drain "
        "or overdraw ANY institute's wallet. Only trusted services may call it "
        "(admin_core CreditClient sends the token). The only HTTP caller is "
        "admin_core's CreditClient — verified repo-wide before gating."
    ),
)
def deduct_credits(
    request: CreditDeductRequest,
    service: CreditService = Depends(get_credit_service),
    _: None = Depends(require_internal_service_token),
):
    """
    Deduct credits after an AI operation.

    This is called after the AI operation completes with actual token counts.
    """
    return service.deduct_credits(request)


# ============================================================================
# Transaction History
# ============================================================================

@router.get(
    "/institutes/{institute_id}/transactions",
    response_model=TransactionHistoryResponse,
    summary="Get credit transaction history",
)
def get_transactions(
    institute_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    transaction_types: Optional[List[str]] = Query(None),
    service: CreditService = Depends(get_credit_service),
    current_user: Optional[dict] = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
):
    """Get paginated transaction history for an institute."""
    require_institute_member(authorization, institute_id)
    request = TransactionHistoryRequest(
        page=page,
        page_size=page_size,
        transaction_types=transaction_types,
    )
    own_only = _own_transactions_only(current_user, authorization, institute_id, service.db)
    if own_only is not None:
        return _own_transaction_history(service, institute_id, own_only, request)
    return service.get_transaction_history(institute_id, request)


def _credit_history_scope(db: Optional[Session] = None) -> str:
    """security.credit_history_scope; any failure reads as the default ('institute')."""
    try:
        from ..services.platform_settings_service import get_platform_setting
        return str(get_platform_setting("security.credit_history_scope", "institute", db=db) or "institute")
    except Exception:
        return "institute"


# Matches no credit_transactions.user_id (real ids are UUIDs).
_NO_USER = "-no-user-"


def _own_transactions_only(
    user, authorization: Optional[str], institute_id: str, db: Optional[Session] = None
) -> Optional[str]:
    """
    The user id to restrict the history to, or None for the whole institute.

    Default scope 'institute' = every member sees every row (today). Under
    'own_unless_admin' a member without the ADMIN role in THIS institute (read
    from the signed JWT) sees only rows they caused; platform staff keep the
    full view. A caller whose id cannot be read gets a filter that matches
    nothing rather than the full ledger.
    """
    if _credit_history_scope(db) != "own_unless_admin":
        return None
    if is_platform_staff(user):
        return None
    roles = jwt_institute_roles(authorization, institute_id) or set()
    if "ADMIN" in roles:
        return None
    token = authorization[len("Bearer "):] if authorization and authorization.startswith("Bearer ") else None
    claims = decode_access_token(token) if token else None
    caller = (claims or {}).get("user") or getattr(user, "user_id", None)
    caller = str(caller).strip() if caller else ""
    return caller if caller and caller != "unknown" else _NO_USER


def _own_transaction_history(
    service: CreditService,
    institute_id: str,
    user_id: str,
    request: TransactionHistoryRequest,
) -> TransactionHistoryResponse:
    """CreditService.get_transaction_history narrowed to user_id = :user_id (same shape)."""
    from sqlalchemy import text
    from ..schemas.credits import CreditTransactionResponse

    params = {"institute_id": institute_id, "user_id": user_id}
    total_count = service.db.execute(
        text(
            "SELECT COUNT(*) FROM credit_transactions "
            "WHERE institute_id = :institute_id AND user_id = :user_id"
        ),
        params,
    ).scalar() or 0
    rows = service.db.execute(
        text(
            "SELECT id, institute_id, transaction_type, amount, balance_after, "
            "description, request_type, model_name, granted_by, "
            "user_id, user_role, subject_user_id, created_at "
            "FROM credit_transactions "
            "WHERE institute_id = :institute_id AND user_id = :user_id "
            "ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
        ),
        {**params, "limit": request.page_size, "offset": (request.page - 1) * request.page_size},
    ).fetchall()
    transactions = [
        CreditTransactionResponse(
            id=str(row.id),
            institute_id=row.institute_id,
            transaction_type=row.transaction_type,
            amount=row.amount,
            balance_after=row.balance_after,
            description=row.description,
            request_type=row.request_type,
            model_name=row.model_name,
            granted_by=row.granted_by,
            user_id=getattr(row, "user_id", None),
            user_role=getattr(row, "user_role", None),
            subject_user_id=getattr(row, "subject_user_id", None),
            created_at=row.created_at,
        )
        for row in rows
    ]
    total_pages = (total_count + request.page_size - 1) // request.page_size if total_count > 0 else 0
    return TransactionHistoryResponse(
        transactions=transactions,
        total_count=total_count,
        page=request.page,
        page_size=request.page_size,
        total_pages=total_pages,
    )


# ============================================================================
# Usage Analytics
# ============================================================================

@router.get(
    "/institutes/{institute_id}/usage",
    response_model=UsageAnalyticsResponse,
    summary="Get usage analytics",
)
def get_usage_analytics(
    institute_id: str,
    days: int = Query(30, ge=1, le=365),
    service: CreditService = Depends(get_credit_service),
    current_user: Optional[dict] = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
):
    """Get usage analytics for an institute."""
    require_institute_member(authorization, institute_id)
    return service.get_usage_analytics(institute_id, days)


@router.get(
    "/institutes/{institute_id}/usage-by-user",
    summary="Per-user credit usage breakdown",
    description=(
        "Credits consumed grouped by user (academy-credits Phase 3). Splits "
        "admin/teacher vs learner consumption via user_role, attributes "
        "work-done-on-a-learner to the learner via COALESCE(subject_user_id, "
        "user_id), and is net of refunds. Forward-only — pre-V323 rows are "
        "institute-level (no user) and excluded."
    ),
)
def get_usage_by_user(
    institute_id: str,
    days: int = Query(30, ge=1, le=365),
    service: CreditService = Depends(get_credit_service),
    current_user: Optional[dict] = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
):
    """Per-user credit usage breakdown for an institute (caller's own institute)."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required."
        )
    require_institute_member(authorization, institute_id)
    # Tenant isolation: a non-root user may only read their own institute's data.
    if not check_root_admin(current_user):
        user_inst = getattr(current_user, "institute_id", None)
        if user_inst is None and isinstance(current_user, dict):
            user_inst = current_user.get("institute_id")
        if not user_inst or str(user_inst) != str(institute_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only view your own institute's usage.",
            )
    return service.get_usage_by_user(institute_id, days)


@router.get(
    "/institutes/{institute_id}/users/{user_id}/usage",
    summary="A single user's own credit usage (for the 'your usage' widget stat)",
    description=(
        "Net credits a user consumed over the last N days. Scoped: the caller "
        "must be that user, or an institute ROOT_ADMIN. Net of refunds, and "
        "attributes work-done-on-a-learner to the learner."
    ),
)
def get_user_usage(
    institute_id: str,
    user_id: str,
    days: int = Query(7, ge=1, le=365),
    service: CreditService = Depends(get_credit_service),
    current_user: Optional[dict] = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
):
    """A single user's own credit usage total."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required."
        )
    require_institute_member(authorization, institute_id)
    caller_id = getattr(current_user, "user_id", None)
    if caller_id is None and isinstance(current_user, dict):
        caller_id = current_user.get("user_id")
    if not check_root_admin(current_user) and str(caller_id) != str(user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own usage.",
        )
    return service.get_user_usage_total(institute_id, user_id, days)


@router.get(
    "/institutes/{institute_id}/forecast",
    response_model=UsageForecastResponse,
    summary="Get usage forecast",
)
def get_usage_forecast(
    institute_id: str,
    service: CreditService = Depends(get_credit_service),
    current_user: Optional[dict] = Depends(get_current_user),
    authorization: Optional[str] = Header(None),
):
    """Get usage forecast for an institute."""
    require_institute_member(authorization, institute_id)
    return service.get_usage_forecast(institute_id)


# ============================================================================
# Pricing Configuration
# ============================================================================

@router.get(
    "/pricing",
    response_model=AllPricingResponse,
    summary="Get all pricing configurations",
)
def get_pricing(
    service: CreditService = Depends(get_credit_service),
):
    """Get all pricing configurations."""
    return service.get_all_pricing()


# ============================================================================
# Alert Management
# ============================================================================

@router.get(
    "/alerts",
    response_model=AlertsListResponse,
    summary="Get pending credit alerts (platform staff only)",
)
def get_alerts(
    limit: int = Query(100, ge=1, le=500),
    service: CreditService = Depends(get_credit_service),
    current_user: Optional[dict] = Depends(get_current_user),
):
    """Get pending credit alerts (platform staff only)."""
    if not is_platform_staff(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only platform staff can view alerts",
        )
    
    return service.get_pending_alerts(limit)


@router.post(
    "/alerts/{alert_id}/acknowledge",
    summary="Acknowledge a credit alert (platform staff only)",
)
def acknowledge_alert(
    alert_id: str,
    request: AcknowledgeAlertRequest,
    service: CreditService = Depends(get_credit_service),
    current_user: Optional[dict] = Depends(get_current_user),
):
    """Acknowledge a credit alert."""
    if not is_platform_staff(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only platform staff can acknowledge alerts",
        )
    
    success = service.acknowledge_alert(alert_id, request.acknowledged_by)
    return {"success": success, "message": "Alert acknowledged"}


# ============================================================================
# Institute Initialization
# ============================================================================

@router.post(
    "/institutes/{institute_id}/initialize",
    response_model=CreditBalanceResponse,
    summary="Initialize credits for new institute",
)
def initialize_credits(
    institute_id: str,
    service: CreditService = Depends(get_credit_service),
    current_user: Optional[dict] = Depends(get_optional_user),
    x_internal_service_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """
    Initialize credits for a new institute.
    Called when an institute is created to give them initial credits (200).
    """
    _require_user_or_internal(current_user, x_internal_service_token, institute_id, authorization)
    balance = service.get_balance(institute_id)
    if balance:
        return balance

    return service.create_initial_credits(institute_id)


# ============================================================================
# Cost Estimation
# ============================================================================

@router.get(
    "/estimate",
    summary="Estimate credit cost before an operation",
)
def estimate_cost(
    request_type: str = Query(..., description="Type: content, video, outline, image, tts, evaluation, etc."),
    model: Optional[str] = Query(default=None, description="Model ID (e.g. google/gemini-2.5-flash)"),
    estimated_tokens: int = Query(default=1000, description="Estimated total tokens (prompt + completion)"),
    character_count: int = Query(default=0, description="Character count (for TTS)"),
    institute_id: Optional[str] = Query(default=None, description="Institute ID (to include current balance)"),
    service: CreditService = Depends(get_credit_service),
    current_user: Optional[dict] = Depends(get_optional_user),
    x_internal_service_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """
    Estimate the credit cost of an AI operation before executing it.
    Returns a cost breakdown so the frontend can show "This will cost ~X credits".
    """
    _require_user_or_internal(current_user, x_internal_service_token, institute_id, authorization)
    estimated_cost = service.calculate_credits(
        request_type=request_type,
        model=model,
        prompt_tokens=estimated_tokens,
        completion_tokens=0,
        character_count=character_count,
    )

    result = {
        "request_type": request_type,
        "model": model,
        "estimated_tokens": estimated_tokens,
        "estimated_cost": float(estimated_cost),
    }

    if institute_id:
        balance = service.get_balance(institute_id)
        if balance:
            result["current_balance"] = float(balance.current_balance)
            result["balance_after"] = float(balance.current_balance - estimated_cost)
            result["has_sufficient_credits"] = balance.current_balance >= estimated_cost

    return result


# ============================================================================
# Tool Cost Preview (parametric, predictable "≈ N credits" estimates)
#
# These power the admin-facing cost preview on the AI tools. Unlike `/estimate`
# above (token-based), these use the DB-tunable `ai_tool_pricing` rates so the
# previewed number is stable and explainable ("10 questions = 10 credits").
# Both endpoints are READ-ONLY — they never deduct.
# ============================================================================

def get_tool_estimator(db: Session = Depends(db_dependency)):
    """Dependency to get a tool cost estimator instance."""
    from ..services.tool_cost_estimator import ToolCostEstimator
    return ToolCostEstimator(db)


@router.get(
    "/tool-pricing",
    summary="Get parametric AI-tool credit rates",
    description=(
        "Returns the active parametric rate rows the frontend caches to render "
        "a live '≈ N credits' badge locally (no per-keystroke network call). "
        "When the bearer token is a member of the `clientId` institute, that "
        "institute's price overrides are merged in; everyone else gets the "
        "global rates."
    ),
)
def get_tool_pricing(
    request: Request,
    estimator=Depends(get_tool_estimator),
    authorization: Optional[str] = Header(None),
):
    """List the active parametric tool pricing rows (for FE local computation)."""
    pricing = estimator.get_tool_pricing(institute_id=_member_institute(request, authorization))
    tools = []
    for tool_key, cfg in pricing.items():
        tools.append({
            "tool_key": tool_key,
            "request_type": cfg["request_type"],
            "flat_base_credits": float(cfg["flat_base_credits"]),
            "per_unit_credits": float(cfg["per_unit_credits"]),
            "unit_field": cfg["unit_field"],
            "params": cfg.get("params", {}),
            "rate_source": cfg.get("rate_source"),
        })
    return {"tools": tools}


def _member_institute(request: Request, authorization: Optional[str]) -> Optional[str]:
    """The `clientId` institute when the verified JWT is a member of it, else
    None (no overrides: an anonymous caller or a non-member never sees another
    institute's contract price)."""
    institute_id = request.headers.get("clientId") or request.headers.get("client_id")
    if not institute_id or not authorization:
        return None
    return institute_id if jwt_institute_roles(authorization, institute_id) is not None else None


@router.post(
    "/estimate-tool",
    summary="Estimate the credit cost of an AI-tool invocation",
    description=(
        "Authoritative parametric estimate for one tool run (used by the "
        "confirm dialog). Pass `institute_id` to also get balance + "
        "affordability. Read-only — never deducts."
    ),
)
def estimate_tool_cost(
    request: ToolEstimateRequest,
    estimator=Depends(get_tool_estimator),
    current_user: Optional[dict] = Depends(get_optional_user),
    x_internal_service_token: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Estimate the parametric credit cost of a tool invocation."""
    _require_user_or_internal(
        current_user, x_internal_service_token, request.institute_id, authorization
    )
    try:
        return estimator.estimate_with_balance(
            request.tool_key, request.params, request.institute_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


# ============================================================================
# Rate Config (V252 — DB-driven USD↔credits ratio + margin)
#
# Read endpoint is public so the FE can render rate footnotes / convert
# USD-denominated upper bounds (e.g. AI video cost cap) into credits.
# Write endpoint is gated to platform staff — changing the ratio reprices
# every future deduction across all institutes.
# ============================================================================


def get_rate_service(
    db: Session = Depends(db_dependency),
) -> CreditRateService:
    return CreditRateService(db)


def _rate_response(svc: CreditRateService) -> CreditRateConfigResponse:
    usd_to_credits, margin_pct = svc.get_current_rate()
    effective = svc.get_effective_ratio()
    return CreditRateConfigResponse(
        usd_to_credits=usd_to_credits,
        margin_pct=margin_pct,
        effective_ratio=effective,
    )


@router.get(
    "/rate-config",
    response_model=CreditRateConfigResponse,
    summary="Get current credit↔USD rate + margin",
    description=(
        "Returns the active row from `credit_rate_config`. The frontend uses "
        "this to convert USD upper-bounds (e.g. AI video cost cap) into the "
        "credit equivalent shown to users."
    ),
)
def get_rate_config(
    svc: CreditRateService = Depends(get_rate_service),
):
    return _rate_response(svc)


@router.post(
    "/admin/rate-config",
    response_model=CreditRateConfigResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Append a new credit↔USD rate (platform staff)",
    description=(
        "Inserts a new rate row with `effective_from = now`. Historical "
        "credit_transactions are NOT repriced — `amount` and `balance_after` "
        "are already credit-denominated snapshots."
    ),
)
def create_rate_config(
    request: CreditRateConfigUpdateRequest,
    svc: CreditRateService = Depends(get_rate_service),
    current_user: Optional[dict] = Depends(get_current_user),
):
    if not is_platform_staff(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only platform staff can change the credit rate.",
        )

    created_by = None
    if current_user:
        created_by = (
            getattr(current_user, "user_id", None)
            or getattr(current_user, "id", None)
            or (current_user.get("user_id") or current_user.get("id") if isinstance(current_user, dict) else None)
        )

    svc.insert_new_rate(
        usd_to_credits=request.usd_to_credits,
        margin_pct=request.margin_pct,
        notes=request.notes,
        created_by=created_by,
    )
    return _rate_response(svc)


# ============================================================================
# Internal Endpoints (service-to-service, X-Internal-Service-Token gated)
#
# Called by admin_core_service from the Razorpay webhook handler after a
# credit-pack purchase succeeds (or is refunded). NOT exposed to end users —
# auth is via shared secret, not user JWT.
#
# Idempotency: both endpoints dedup on `external_reference_id` (Razorpay
# payment_id for grants, refund_id for refunds) via a partial UNIQUE index
# on credit_transactions.external_reference_id (V243).
# ============================================================================

@router.post(
    "/internal/grant-from-payment",
    response_model=InternalGrantOrRefundResponse,
    summary="Grant credits as fulfillment of a paid order (internal)",
    description=(
        "Service-to-service endpoint called by admin_core_service after a "
        "Razorpay credit-pack payment is captured. Idempotent on Razorpay "
        "payment_id. Requires X-Internal-Service-Token header."
    ),
)
def grant_from_payment(
    request: InternalGrantFromPaymentRequest,
    service: CreditService = Depends(get_credit_service),
    _: None = Depends(require_internal_service_token),
):
    return service.grant_from_purchase(request)


@router.post(
    "/internal/refund-from-payment",
    response_model=InternalGrantOrRefundResponse,
    summary="Reverse a previously-granted purchase (internal)",
    description=(
        "Service-to-service endpoint called by admin_core_service when "
        "Razorpay sends a refund.processed webhook. Idempotent on Razorpay "
        "refund_id. Balance is allowed to go negative (logged for ops)."
    ),
)
def refund_from_payment(
    request: InternalRefundFromPaymentRequest,
    service: CreditService = Depends(get_credit_service),
    _: None = Depends(require_internal_service_token),
):
    return service.refund_from_purchase(request)


@router.post(
    "/internal/charge-tool",
    response_model=InternalChargeToolResponse,
    summary="Charge credits for a metered AI tool (internal)",
    description=(
        "Service-to-service endpoint for charging a parametric tool from another "
        "service (e.g. admin_core billing transcription in applyTerminalState). "
        "Charge = max(parametric estimate, actual token cost), or exactly the "
        "estimate for a fixed-price tool; priced at the institute's rate "
        "(override, else global) or the optional rate_snapshot. Idempotent on "
        "idempotency_key so a callback + reconciliation watchdog can't double-charge. "
        "Requires X-Internal-Service-Token."
    ),
)
def charge_tool_internal(
    request: InternalChargeToolRequest,
    db: Session = Depends(db_dependency),
    _: None = Depends(require_internal_service_token),
):
    from ..services.ai_billing import charge_tool
    from ..models.ai_token_usage import RequestType
    from decimal import Decimal as _Decimal

    try:
        request_type = RequestType(request.request_type)
    except ValueError:
        request_type = request.request_type  # charge_tool accepts a raw string too

    try:
        charged = charge_tool(
            db,
            tool_key=request.tool_key,
            tool_params=request.params,
            request_type=request_type,
            model=request.model or "system",
            prompt_tokens=request.prompt_tokens,
            completion_tokens=request.completion_tokens,
            institute_id=request.institute_id,
            user_id=request.user_id,
            user_role=request.user_role,
            subject_user_id=request.subject_user_id,
            idempotency_key=request.idempotency_key,
            rate_snapshot=request.rate_snapshot,
        )
    except ValueError as exc:
        # Unknown tool_key / unpriceable request from an internal caller. Surface
        # as 5xx (retryable) + ERROR log so a dropped internal charge is
        # observable, rather than a silent 400 the caller logs and forgets.
        logger.error(
            "charge-tool DROPPED for institute %s tool_key=%s: %s",
            request.institute_id, request.tool_key, exc,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not price tool '{request.tool_key}': {exc}",
        )

    return InternalChargeToolResponse(
        success=True,
        institute_id=request.institute_id,
        credits_charged=charged if charged is not None else _Decimal("0"),
        message="Charged",
    )
