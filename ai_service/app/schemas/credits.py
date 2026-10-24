"""
Credit Schemas for request/response validation.

These Pydantic models define the API contracts for the credit system.
"""

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Optional, List, Dict, Any
from uuid import UUID

from pydantic import BaseModel, Field, PrivateAttr


class TransactionType(str, Enum):
    """Types of credit transactions."""
    INITIAL_GRANT = "INITIAL_GRANT"
    ADMIN_GRANT = "ADMIN_GRANT"
    USAGE_DEDUCTION = "USAGE_DEDUCTION"
    REFUND = "REFUND"
    MONTHLY_ALLOCATION = "MONTHLY_ALLOCATION"
    PURCHASE = "PURCHASE"
    PROMOTIONAL = "PROMOTIONAL"
    ADMIN_DEDUCTION = "ADMIN_DEDUCTION"


class AlertType(str, Enum):
    """Types of credit alerts."""
    LOW_BALANCE = "LOW_BALANCE"
    ZERO_BALANCE = "ZERO_BALANCE"
    NEGATIVE_BALANCE = "NEGATIVE_BALANCE"


class ModelTier(str, Enum):
    """Model tier for pricing multipliers."""
    STANDARD = "standard"
    PREMIUM = "premium"
    ULTRA = "ultra"


# ============================================================================
# Credit Balance Schemas
# ============================================================================

class CreditBalanceResponse(BaseModel):
    """Response for getting institute credit balance."""
    institute_id: str
    total_credits: Decimal
    used_credits: Decimal
    current_balance: Decimal
    low_balance_threshold: Decimal
    is_low_balance: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CreditGrantRequest(BaseModel):
    """Request to grant credits to an institute."""
    amount: Decimal = Field(..., gt=0, description="Amount of credits to grant (must be positive)")
    description: Optional[str] = Field(None, description="Reason for granting credits")
    acting_user_id: Optional[str] = Field(
        None,
        description=(
            "Super admin the adjustment is attributed to. Honored ONLY on the "
            "X-Internal-Service-Token path, where the calling service has already "
            "verified the user is a root admin. JWT callers are attributed from "
            "their token and this field is ignored."
        ),
    )


class CreditGrantResponse(BaseModel):
    """Response after granting credits."""
    success: bool
    institute_id: str
    amount_granted: Decimal
    new_balance: Decimal
    transaction_id: str
    message: str


# ============================================================================
# Usage-metering fields (contract K2) — optional, write-only attribution
# ============================================================================

class MeteringFieldsMixin(BaseModel):
    """Optional fields that describe WHO used WHICH AI feature, written only to
    ai_usage_event. They never change the amount, the ledger row or the
    response; leaving them out is exactly the old request. Deliberately
    lenient (no length limits, loose list item types): an odd value is clipped
    or ignored by the metering writer, never a 422 that would cost a charge.
    The ledger's own user_id / user_role / subject_user_id keep their meaning."""
    use_case: Optional[str] = Field(None, description="ai_use_case_catalog key, e.g. 'tutor_chat'")
    actor_kind: Optional[str] = Field(None, description="USER|SYSTEM|API_KEY|PUBLIC|UNKNOWN")
    actor_user_id: Optional[str] = Field(None, description="Event actor when it differs from user_id (metering only)")
    actor_role_class: Optional[str] = Field(None, description="ADMIN|TEACHER|STAFF|PARENT|LEARNER|SYSTEM|API_KEY|PUBLIC")
    actor_roles_raw: Optional[List[Any]] = Field(None, description="The actor's institute roles at spend time")
    role_source: Optional[str] = Field(None, description="JWT|CALLER|AUTH_LOOKUP|CATALOG_DEFAULT|UNRESOLVED")
    actor_display_name: Optional[str] = None
    subject_display_name: Optional[str] = None
    surface: Optional[str] = Field(
        None, description="ADMIN_APP|LEARNER_APP|PUBLIC|PARTNER_API|WHATSAPP|PHONE|SCHEDULED|INTERNAL|UNKNOWN")
    source_service: Optional[str] = Field(None, description="ai_service|admin_core|assessment|community|...")
    usage_context: Optional[Dict[str, Any]] = Field(
        None, description="Small JSON context: course/video/flow/call ids and names; subject_user_id for metering")
    router: Optional[str] = None
    provider: Optional[str] = None
    gateway_key_id: Optional[str] = None
    byo_key: Optional[bool] = None
    parent_event_id: Optional[str] = None
    usage_event_id: Optional[str] = Field(None, description="Caller-generated ai_usage_event id (uuid)")
    tool_key: Optional[str] = Field(None, description="ai_tool_pricing.tool_key behind this charge, if any")


# ============================================================================
# Credit Check Schemas (Pre-flight)
# ============================================================================

class CreditCheckRequest(MeteringFieldsMixin):
    """Request to check if institute has sufficient credits."""
    institute_id: str
    request_type: str  # content, image, embedding, etc.
    model: Optional[str] = None  # Model name for tier multiplier
    estimated_tokens: Optional[int] = 0  # Estimated prompt + completion tokens
    character_count: Optional[int] = 0  # For TTS
    # Metering only (no ledger row on a check).
    user_id: Optional[str] = None
    subject_user_id: Optional[str] = None


class CreditCheckResponse(BaseModel):
    """Response for credit check."""
    has_sufficient_credits: bool
    current_balance: Decimal
    estimated_cost: Decimal
    balance_after: Decimal
    message: str


# ============================================================================
# Credit Deduction Schemas
# ============================================================================

class CreditDeductRequest(MeteringFieldsMixin):
    """Request to deduct credits after AI operation."""
    institute_id: str
    request_type: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    character_count: int = 0  # For TTS
    seconds: int = 0           # For per-second video models (avatar synthesis)
    usage_log_id: Optional[str] = None  # Link to ai_token_usage record
    batch_id: Optional[str] = Field(None, max_length=255, description="Group related transactions (e.g., all charges for one video)")
    precomputed_credits: Optional[Decimal] = Field(
        None,
        description=(
            "Skip calculate_credits and use this exact value. For paths "
            "where the credit amount is derived from an external pricing "
            "table (e.g. fal.ai Veo per-second-and-audio rates) rather "
            "than the model's per-token pricing in ai_models."
        ),
    )
    description: Optional[str] = Field(
        None,
        max_length=500,
        description=(
            "Override for the credit_transactions.description column. "
            "Defaults to '{request_type} using {model}'."
        ),
    )
    idempotency_key: Optional[str] = Field(
        None,
        max_length=255,
        description=(
            "Dedup key written to credit_transactions.external_reference_id "
            "(partial UNIQUE index, V243). When a row with this key already "
            "exists the deduction is a no-op. Used for split/async charges "
            "such as transcription (key='transcription:{extractionId}') where "
            "a callback and a reconciliation watchdog can both fire."
        ),
    )
    # Per-user attribution (academy-credits Phase 3).
    user_id: Optional[str] = Field(None, max_length=255, description="Verified actor who triggered the spend")
    user_role: Optional[str] = Field(None, max_length=32, description="ADMIN|TEACHER|LEARNER|SYSTEM|PLATFORM_BILLING|UNVERIFIED")
    subject_user_id: Optional[str] = Field(None, max_length=255, description="Who the work was about, when != actor (e.g. evaluated learner)")
    allow_negative: bool = Field(
        False,
        description=(
            "When True, deduct even if it drives the balance negative (no "
            "current_balance >= amount guard). Used for post-paid tool charges "
            "where the work was already delivered — better a small negative "
            "balance than a silently-dropped charge. The pre-flight 402 still "
            "gates affordability at request start."
        ),
    )

    # In-process hints for the metering writer (never serialized, never sent).
    _meter_fresh_usage_row: bool = PrivateAttr(default=False)
    _meter_real_cost_usd: Optional[float] = PrivateAttr(default=None)
    _meter_metadata: Optional[Dict[str, Any]] = PrivateAttr(default=None)


class CreditDeductResponse(BaseModel):
    """Response after credit deduction."""
    success: bool
    credits_deducted: Decimal
    new_balance: Decimal
    transaction_id: Optional[str] = None
    message: str


# ============================================================================
# Transaction Schemas
# ============================================================================

class CreditTransactionResponse(BaseModel):
    """A single credit transaction."""
    id: str
    institute_id: str
    transaction_type: str
    amount: Decimal
    balance_after: Decimal
    description: Optional[str]
    request_type: Optional[str]
    model_name: Optional[str]
    granted_by: Optional[str]
    # Per-user attribution (Phase 3) — NULL on rows written before V323.
    user_id: Optional[str] = None
    user_role: Optional[str] = None
    subject_user_id: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class TransactionHistoryRequest(BaseModel):
    """Request for transaction history."""
    page: int = Field(1, ge=1)
    page_size: int = Field(50, ge=1, le=200)
    transaction_types: Optional[List[str]] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class TransactionHistoryResponse(BaseModel):
    """Response with paginated transaction history."""
    transactions: List[CreditTransactionResponse]
    total_count: int
    page: int
    page_size: int
    total_pages: int


# ============================================================================
# Usage Analytics Schemas
# ============================================================================

class UsageBreakdownItem(BaseModel):
    """Usage breakdown for a single category."""
    request_type: str
    total_requests: int
    total_credits: Decimal
    percentage: Decimal


class UsageByDayItem(BaseModel):
    """Daily usage summary."""
    date: str
    total_requests: int
    total_credits: Decimal


class UsageAnalyticsResponse(BaseModel):
    """Comprehensive usage analytics."""
    institute_id: str
    period_start: datetime
    period_end: datetime
    total_requests: int
    total_credits_used: Decimal
    by_request_type: List[UsageBreakdownItem]
    by_day: List[UsageByDayItem]
    top_models: List[Dict[str, Any]]


class UsageForecastResponse(BaseModel):
    """Credit usage forecast."""
    institute_id: str
    current_balance: Decimal
    average_daily_usage: Decimal
    estimated_days_remaining: Optional[int]
    projected_zero_date: Optional[str]
    recommendation: str


# ============================================================================
# Pricing Schemas
# ============================================================================

class PricingConfigResponse(BaseModel):
    """Pricing configuration for a request type."""
    request_type: str
    base_cost: Decimal
    token_rate: Decimal
    minimum_charge: Decimal
    unit_type: str
    description: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


class PricingUpdateRequest(BaseModel):
    """Request to update pricing for a request type."""
    base_cost: Optional[Decimal] = None
    token_rate: Optional[Decimal] = None
    minimum_charge: Optional[Decimal] = None
    is_active: Optional[bool] = None


class ModelPricingResponse(BaseModel):
    """Model tier pricing configuration."""
    model_pattern: str
    tier: str
    multiplier: Decimal
    description: Optional[str]
    is_active: bool

    class Config:
        from_attributes = True


class AllPricingResponse(BaseModel):
    """All pricing configurations."""
    request_types: List[PricingConfigResponse]
    model_tiers: List[ModelPricingResponse]


# ============================================================================
# Rate Config Schemas (V252 — DB-driven USD↔credits ratio + margin)
# ============================================================================

class CreditRateConfigResponse(BaseModel):
    """Current credit↔USD rate.

    `effective_ratio = usd_to_credits × (1 + margin_pct/100)` is the
    multiplier callers apply (`credits = usd × effective_ratio`).
    """
    usd_to_credits: Decimal
    margin_pct: Decimal
    effective_ratio: Decimal
    currency_code: str = "USD"


class CreditRateConfigUpdateRequest(BaseModel):
    """Append a new rate row. Past rows are kept for audit; the latest
    one with `effective_from <= now` is treated as active."""
    usd_to_credits: Decimal = Field(..., gt=0)
    margin_pct: Decimal = Field(..., ge=0)
    notes: Optional[str] = None


# ============================================================================
# Alert Schemas
# ============================================================================

class CreditAlertResponse(BaseModel):
    """A credit alert."""
    id: str
    institute_id: str
    alert_type: str
    threshold_value: Optional[Decimal]
    current_balance: Optional[Decimal]
    acknowledged: bool
    acknowledged_by: Optional[str]
    acknowledged_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class AlertsListResponse(BaseModel):
    """List of pending alerts."""
    alerts: List[CreditAlertResponse]
    total_count: int


class AcknowledgeAlertRequest(BaseModel):
    """Request to acknowledge an alert."""
    acknowledged_by: str


# ============================================================================
# Internal Service-to-Service Schemas (credit pack purchase fulfillment)
# Called by admin_core_service from the Razorpay webhook handler.
# Auth via X-Internal-Service-Token (see dependencies.require_internal_service_token).
# ============================================================================

class InternalGrantFromPaymentRequest(BaseModel):
    """Grant credits to an institute as the fulfillment of a paid order."""
    institute_id: str
    amount: Decimal = Field(..., gt=0, description="Credits to grant")
    # Razorpay payment_id (e.g. "pay_NhfXY..."). Used as the dedup key on
    # credit_transactions.external_reference_id; webhook retries are absorbed
    # by the partial UNIQUE index from V243.
    external_reference_id: str = Field(..., min_length=1, max_length=255)
    # platform_payment.id — populated on credit_transactions.reference_id for
    # reverse lookups ("which transactions belong to this purchase?").
    platform_payment_id: Optional[UUID] = None
    pack_code: Optional[str] = None
    description: Optional[str] = None
    # Verified buyer (Phase 3 attribution). admin_core has this at order time.
    buyer_user_id: Optional[str] = Field(None, max_length=255)


class InternalRefundFromPaymentRequest(BaseModel):
    """Reverse a previously-granted purchase (full or partial)."""
    institute_id: str
    amount: Decimal = Field(..., gt=0, description="Credits to deduct")
    # Razorpay refund_id (e.g. "rfnd_NhfXY..."). Used as the dedup key.
    external_reference_id: str = Field(..., min_length=1, max_length=255)
    platform_payment_id: Optional[UUID] = None
    pack_code: Optional[str] = None
    description: Optional[str] = None
    buyer_user_id: Optional[str] = Field(None, max_length=255)


class InternalGrantOrRefundResponse(BaseModel):
    """Common response shape for grant + refund."""
    success: bool
    institute_id: str
    new_balance: Decimal
    transaction_id: Optional[str] = None
    # True when a row with the same external_reference_id already existed —
    # the operation was a no-op. The webhook can safely retry on errors.
    already_processed: bool = False
    message: str


# ============================================================================
# Tool Cost Preview Schemas (parametric, predictable "≈ N credits" estimates)
# Backed by ToolCostEstimator + the DB-tunable `ai_tool_pricing` table.
# ============================================================================

class InternalChargeToolRequest(MeteringFieldsMixin):
    """Internal (service-to-service) charge for a metered AI tool.

    Used by admin_core to bill transcription from `applyTerminalState` on the
    measured audio duration. The idempotency_key makes the callback + watchdog
    paths safe to both fire. Charge = max(parametric, actual token cost).
    """
    institute_id: str
    tool_key: str = Field(..., description="assessment | transcription | notes | lecture")
    request_type: str = Field(..., description="credit_transactions.request_type bucket")
    params: Dict[str, Any] = Field(default_factory=dict, description="Tool cost drivers, e.g. {'duration_seconds': 3300}")
    model: Optional[str] = Field("system", description="Model attribution; 'system' for non-LLM tools like transcription")
    prompt_tokens: int = 0
    completion_tokens: int = 0
    user_id: Optional[str] = None
    user_role: Optional[str] = Field(None, description="ADMIN|TEACHER|LEARNER|SYSTEM|UNVERIFIED")
    subject_user_id: Optional[str] = Field(None, description="Who the work was about, when != actor")
    idempotency_key: Optional[str] = Field(None, description="Dedup key, e.g. 'transcription:{extractionId}'")
    rate_snapshot: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "Rate quoted at enqueue {tool_key, flat_base_credits, per_unit_credits, unit_field, "
            "params, rate_source}; when it names this tool_key it replaces the current rate"
        ),
    )


class InternalChargeToolResponse(BaseModel):
    success: bool
    institute_id: str
    credits_charged: Decimal
    message: str


class ToolEstimateRequest(BaseModel):
    """Estimate the credit cost of one AI-tool invocation.

    `params` carries the tool-specific cost drivers, e.g.:
      - assessment:    {"num_questions": 10, "include_images": true}
      - transcription: {"duration_seconds": 3300}  (or {"audio_minutes": 55})
      - notes:         {"transcript_chars": 8200}
      - lecture:       {"generate_questions": true, "generate_homework": false}
    """
    tool_key: str = Field(..., description="One of: assessment, transcription, notes, lecture")
    params: Dict[str, Any] = Field(default_factory=dict, description="Tool-specific cost drivers")
    institute_id: Optional[str] = Field(
        None, description="When supplied, the response includes balance + affordability"
    )
