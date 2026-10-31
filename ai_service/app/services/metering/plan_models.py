"""
AI subscription plan tables (contract P-DDL): ai_billing_feature, ai_plan,
ai_plan_version, ai_plan_item, institute_ai_subscription, ai_subscription_period,
ai_subscription_override, ai_subscription_event, plus the ai_use_case_catalog
column billing_feature_key.

Created by the admin_core Flyway migration V588__ai_subscription_plans.sql (keep
these models identical to it, column for column; tests/test_plan_models_parity.py
checks the parity when the migration is in the checkout). ai_service runs NO DDL
for them, like every other Flyway-owned table (models/flyway_owned.py). The
models use their own declarative Base (separate from metering/models.py and
metering/limit_models.py, so the existing SQLite fixtures are unchanged) and
nothing ever calls create_all for them in the app; the plan engine
(metering/plans.py) reads and writes through these Table objects (SQLAlchemy
Core), so the same code runs on Postgres and on the SQLite test database.

Postgres-only types carry a SQLite variant (uuid -> varchar(36), jsonb -> json,
text[] -> json) for the offline tests only. Postgres-only server defaults
(gen_random_uuid(), now()) must be stripped for SQLite (see the parity test);
engine code therefore always supplies id / timestamps explicitly.

The freeze triggers (PUBLISHED / RETIRED versions and their items) exist only in
Postgres; SQLite tests do not get them.

The enum-like columns have no CHECK constraint in the database (like V586/V587);
the vocabularies below are the single place ai_service validates them against.
"""
from __future__ import annotations

import hashlib

from sqlalchemy import (
    JSON, BigInteger, Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, MetaData,
    Numeric, String, Table, Text, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PG_UUID
from sqlalchemy.orm import declarative_base

PlansBase = declarative_base()

UUIDType = PG_UUID(as_uuid=False).with_variant(String(36), "sqlite")
JSONBType = JSONB().with_variant(JSON(), "sqlite")
TextArray = ARRAY(Text).with_variant(JSON(), "sqlite")

# ── vocabularies (validated in code; documented in V588) ─────────────────────
ELIGIBILITIES = ("INCLUDABLE", "ALLOWANCE_ONLY", "ALWAYS_CHARGED")
VERSION_STATUSES = ("DRAFT", "PUBLISHED", "RETIRED")
GRACE_BEHAVIOURS = ("INCLUDED", "CHARGED")
ITEM_MODES = ("INCLUDED", "ALLOWANCE", "CHARGED")
MODEL_POLICIES = ("ANY", "DEFAULT_CHAIN", "ALLOWLIST", "MAX_PRICE")
MODEL_VIOLATION_ACTIONS = ("CHARGE", "BLOCK")
OVER_CAP_ACTIONS = ("CHARGE", "BLOCK")
USER_CAP_BASES = ("ACTOR", "SUBJECT")
#: PENDING (V590, paid plans): a checkout / PAYMENT assignment waiting for its first
#: payment. Never live (outside ux_ias_live), never gives benefits; becomes ACTIVE
#: when its first PERIOD charge is paid, EXPIRED when the checkout lapses unpaid.
SUBSCRIPTION_STATUSES = ("SCHEDULED", "PENDING", "TRIAL", "ACTIVE", "GRACE", "EXPIRED", "CANCELLED")
LIVE_STATUSES = ("TRIAL", "ACTIVE", "GRACE")          # = ux_ias_live
ENFORCEMENTS = ("SHADOW", "LIVE")
SOURCES = ("MANUAL", "COMPLIMENTARY", "PAYMENT")
#: REFUNDED (V590): a PAYMENT period whose charge was refunded in full (no benefits)
PAYMENT_STATUSES = ("DUE", "PAID", "COMPLIMENTARY", "WAIVED", "REFUNDED")
#: period payment statuses that give plan benefits to a source=PAYMENT subscription
PAID_PERIOD_STATUSES = ("PAID", "WAIVED", "COMPLIMENTARY")

# ── paid plans (V590 ai_subscription_charge / ai_subscription_mandate) ───────
CHARGE_KINDS = ("PERIOD", "UPGRADE")
CHARGE_STATUSES = ("DUE", "LINK_SENT", "DEBIT_SCHEDULED", "PAID", "FAILED", "VOID", "REFUNDED",
                   "PARTIALLY_REFUNDED")
#: a charge that is still owed (collectable: a link, a mandate debit or a retry)
CHARGE_OPEN_STATUSES = ("DUE", "LINK_SENT", "DEBIT_SCHEDULED", "FAILED")
#: a charge that was paid (whatever happened to the money afterwards)
CHARGE_PAID_STATUSES = ("PAID", "REFUNDED", "PARTIALLY_REFUNDED")
MANDATE_STATUSES = ("PENDING", "ACTIVE", "PAUSED", "CANCELLED", "REJECTED", "EXPIRED")
MANDATE_METHODS = ("UPI", "CARD", "EMANDATE")
STOREFRONT_MODES = ("OFF", "ALLOWLIST", "SEGMENTS", "ALL")
AUDIENCE_MODES = ("ALL", "ALLOWLIST", "SEGMENT")
BRAND_MODES = ("VACADEMY", "NEUTRAL")
#: role classes usable in ai_plan_item.roles_included (V586 ai_role_class_map + system kinds)
ROLE_CLASSES = ("ADMIN", "TEACHER", "STAFF", "PARENT", "LEARNER", "SYSTEM", "API_KEY", "PUBLIC")
#: features the voice-bot domain owns: always charged and locked (d_plans §3.6)
LOCKED_ALWAYS_CHARGED = ("ai_calling", "telephony")
UNMAPPED_FEATURE = "unmapped"
#: tool-level billing features that beat the use case's catalog mapping: one
#: catalog use case carries tools of different billing features (V586
#: knowledge_base = Q&A + ingest + library unlock; tutor_live = live minutes +
#: the avatar minute). A tool listed here bills as its own feature whatever the
#: use case maps to (kb_ingest is ALLOWANCE_ONLY, kb_qa is INCLUDABLE).
TOOL_FEATURE_OVERRIDES = {
    "kb_ingest_page": "kb_ingest",
    "kb_ingest_url": "kb_ingest",
    "kb_library_unlock": "kb_ingest",
    "course_kb_ocr_page": "kb_ingest",
    "course_kb_transcribe_minute": "transcription",
    "tutor_avatar_minute": "tutor_avatar_minutes",
}
#: ai_usage_counter.period for plan fair-use counters (V587 reserved it)
PLAN_COUNTER_PERIOD = "PLAN_PERIOD"
DEFAULT_SAC_CODE = "998313"

# column widths (keep in step with V588)
W_FEATURE_KEY = 48
W_ELIGIBILITY = 16
W_PLAN_KEY = 48
W_VERSION_STATUS = 12
W_GRACE_BEHAVIOUR = 10
W_ITEM_MODE = 10
W_MODEL_POLICY = 14
W_MODEL_VIOLATION = 8
W_USER_CAP_BASIS = 8
W_OVER_CAP = 8
W_SUB_STATUS = 12
W_ENFORCEMENT = 8
W_SOURCE = 16
W_PAYMENT_STATUS = 14
W_EVENT_TYPE = 32
W_INSTITUTE = 64
W_COUNTER_KEY = 320          # ai_usage_counter.counter_key (V587)


def plan_counter_key(subscription_id: str, feature_key: str | None = None, user_id: str | None = None) -> str:
    """ai_usage_counter.counter_key for plan fair use (V588 header).

    'PLAN:<sub>|ALL' (plan cost cap), 'PLAN:<sub>|F:<feature>' (institute x feature),
    'PLAN:<sub>|F:<feature>|U:<uid>' (user x feature).

    ai_usage_counter.counter_key is VARCHAR(320) (V587) while user ids may be up to
    255 chars: a key that would not fit carries 'U:h:<sha256 prefix>' instead of the
    raw id (deterministic, so the same user always lands on the same counter).
    """
    if feature_key is None:
        return f"PLAN:{subscription_id}|ALL"
    key = f"PLAN:{subscription_id}|F:{feature_key}"
    if user_id is None:
        return key
    full = f"{key}|U:{user_id}"
    if len(full) <= W_COUNTER_KEY:
        return full
    return f"{key}|U:h:{hashlib.sha256(str(user_id).encode('utf-8')).hexdigest()[:40]}"


class AiBillingFeature(PlansBase):
    """Customer-facing billing feature: a group of ai_use_case_catalog rows."""

    __tablename__ = "ai_billing_feature"

    feature_key = Column(String(48), primary_key=True)
    label = Column(String(128), nullable=False)
    description = Column(Text, nullable=True)
    #: INCLUDABLE | ALLOWANCE_ONLY | ALWAYS_CHARGED
    eligibility = Column(String(16), nullable=False)
    #: eligibility editable only with an unlock reason
    locked = Column(Boolean, nullable=False, server_default=text("false"))
    display_order = Column(Integer, nullable=False, server_default=text("100"))
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    updated_by = Column(String(255), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=text("now()"))


class AiPlan(PlansBase):
    """Stable plan identity (plan_key, name)."""

    __tablename__ = "ai_plan"

    id = Column(UUIDType, primary_key=True, server_default=text("gen_random_uuid()"))
    plan_key = Column(String(48), nullable=False, unique=True)
    name = Column(String(128), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class AiPlanVersion(PlansBase):
    """Commercial terms. DRAFT editable; PUBLISHED / RETIRED frozen by trigger."""

    __tablename__ = "ai_plan_version"

    id = Column(UUIDType, primary_key=True, server_default=text("gen_random_uuid()"))
    plan_id = Column(UUIDType, ForeignKey("ai_plan.id"), nullable=False)
    version_no = Column(Integer, nullable=False)
    #: DRAFT | PUBLISHED | RETIRED
    status = Column(String(12), nullable=False, server_default=text("'DRAFT'"))
    currency = Column(String(3), nullable=False, server_default=text("'INR'"))
    #: paise per period, before GST
    price_minor = Column(BigInteger, nullable=False, server_default=text("0"))
    is_tax_inclusive = Column(Boolean, nullable=False, server_default=text("false"))
    sac_code = Column(String(16), nullable=True, server_default=text("'998313'"))
    period_months = Column(Integer, nullable=False, server_default=text("1"))
    allowance_credits = Column(Numeric(14, 4), nullable=False, server_default=text("0"))
    #: internal; NULL = none; never shown to tenants
    internal_cost_cap_usd = Column(Numeric(14, 4), nullable=True)
    grace_days = Column(Integer, nullable=False, server_default=text("7"))
    #: INCLUDED | CHARGED
    grace_behaviour = Column(String(10), nullable=False, server_default=text("'CHARGED'"))
    supersedes_version_id = Column(UUIDType, nullable=True)
    migrate_existing_at_renewal = Column(Boolean, nullable=False, server_default=text("false"))
    published_at = Column(DateTime(timezone=True), nullable=True)
    published_by = Column(String(255), nullable=True)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (UniqueConstraint("plan_id", "version_no"),)


class AiPlanItem(PlansBase):
    """One feature's treatment in one plan version. No row = CHARGED."""

    __tablename__ = "ai_plan_item"

    id = Column(UUIDType, primary_key=True, server_default=text("gen_random_uuid()"))
    plan_version_id = Column(UUIDType, ForeignKey("ai_plan_version.id"), nullable=False)
    feature_key = Column(String(48), ForeignKey("ai_billing_feature.feature_key"), nullable=False)
    #: INCLUDED | ALLOWANCE | CHARGED
    mode = Column(String(10), nullable=False)
    #: ANY | DEFAULT_CHAIN | ALLOWLIST | MAX_PRICE
    model_policy = Column(String(14), nullable=False, server_default=text("'DEFAULT_CHAIN'"))
    model_allowlist = Column(TextArray, nullable=True)
    max_output_price_per_1m = Column(Numeric(12, 6), nullable=True)
    #: CHARGE | BLOCK
    on_model_violation = Column(String(8), nullable=False, server_default=text("'CHARGE'"))
    #: role classes; NULL = all
    roles_included = Column(TextArray, nullable=True)
    inst_units_cap = Column(Numeric(14, 4), nullable=True)
    inst_credits_cap = Column(Numeric(14, 4), nullable=True)
    inst_cost_usd_cap = Column(Numeric(14, 6), nullable=True)
    user_units_cap = Column(Numeric(14, 4), nullable=True)
    user_credits_cap = Column(Numeric(14, 4), nullable=True)
    #: ACTOR | SUBJECT
    user_cap_basis = Column(String(8), nullable=False, server_default=text("'ACTOR'"))
    #: CHARGE | BLOCK
    over_cap_action = Column(String(8), nullable=False, server_default=text("'CHARGE'"))
    display_cap_text = Column(String(255), nullable=True)

    __table_args__ = (UniqueConstraint("plan_version_id", "feature_key"),)


class InstituteAiSubscription(PlansBase):
    """An institute's plan subscription. At most one TRIAL/ACTIVE/GRACE row per institute."""

    __tablename__ = "institute_ai_subscription"

    id = Column(UUIDType, primary_key=True, server_default=text("gen_random_uuid()"))
    institute_id = Column(String(64), nullable=False)
    plan_version_id = Column(UUIDType, ForeignKey("ai_plan_version.id"), nullable=False)
    #: SCHEDULED | TRIAL | ACTIVE | GRACE | EXPIRED | CANCELLED
    status = Column(String(12), nullable=False)
    #: SHADOW | LIVE
    enforcement = Column(String(8), nullable=False, server_default=text("'SHADOW'"))
    #: MANUAL | COMPLIMENTARY | PAYMENT
    source = Column(String(16), nullable=False, server_default=text("'MANUAL'"))
    anchor_at = Column(DateTime(timezone=True), nullable=False)
    start_at = Column(DateTime(timezone=True), nullable=False)
    end_at = Column(DateTime(timezone=True), nullable=True)
    period_months = Column(Integer, nullable=False, server_default=text("1"))
    auto_renew = Column(Boolean, nullable=False, server_default=text("true"))
    grace_days = Column(Integer, nullable=False, server_default=text("7"))
    cancel_at_period_end = Column(Boolean, nullable=False, server_default=text("false"))
    pending_plan_version_id = Column(UUIDType, nullable=True)
    price_override_minor = Column(BigInteger, nullable=True)
    reason = Column(Text, nullable=True)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_by = Column(String(255), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ux_ias_live", "institute_id", unique=True,
              postgresql_where=text("status IN ('TRIAL','ACTIVE','GRACE')"),
              sqlite_where=text("status IN ('TRIAL','ACTIVE','GRACE')")),
        Index("ix_ias_inst", "institute_id", "created_at"),
    )


class AiSubscriptionPeriod(PlansBase):
    """One billing / allowance period of a subscription (created lazily)."""

    __tablename__ = "ai_subscription_period"

    id = Column(UUIDType, primary_key=True, server_default=text("gen_random_uuid()"))
    subscription_id = Column(UUIDType, ForeignKey("institute_ai_subscription.id"), nullable=False)
    period_start = Column(DateTime(timezone=True), nullable=False)
    period_end = Column(DateTime(timezone=True), nullable=False)
    plan_version_id = Column(UUIDType, nullable=False)
    price_minor_snapshot = Column(BigInteger, nullable=False)
    allowance_credits = Column(Numeric(14, 4), nullable=False, server_default=text("0"))
    allowance_used = Column(Numeric(14, 4), nullable=False, server_default=text("0"))
    #: DUE | PAID | COMPLIMENTARY | WAIVED
    payment_status = Column(String(14), nullable=False, server_default=text("'DUE'"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        UniqueConstraint("subscription_id", "period_start"),
        CheckConstraint("allowance_used >= 0", name="ck_asp_allowance_used_nonneg"),
    )


class AiSubscriptionOverride(PlansBase):
    """Per-subscription custom deal for one feature (NULL field = inherit the plan item)."""

    __tablename__ = "ai_subscription_override"

    id = Column(UUIDType, primary_key=True, server_default=text("gen_random_uuid()"))
    subscription_id = Column(UUIDType, ForeignKey("institute_ai_subscription.id"), nullable=False)
    feature_key = Column(String(48), nullable=False)
    #: INCLUDED | ALLOWANCE | CHARGED; NULL = inherit
    mode = Column(String(10), nullable=True)
    inst_units_cap = Column(Numeric(14, 4), nullable=True)
    inst_credits_cap = Column(Numeric(14, 4), nullable=True)
    inst_cost_usd_cap = Column(Numeric(14, 6), nullable=True)
    user_units_cap = Column(Numeric(14, 4), nullable=True)
    user_credits_cap = Column(Numeric(14, 4), nullable=True)
    reason = Column(Text, nullable=False)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    is_active = Column(Boolean, nullable=False, server_default=text("true"))

    __table_args__ = (
        Index("ux_aso_active", "subscription_id", "feature_key", unique=True,
              postgresql_where=text("is_active"), sqlite_where=text("is_active")),
    )


class AiSubscriptionEvent(PlansBase):
    """Audit trail of every subscription change."""

    __tablename__ = "ai_subscription_event"

    id = Column(UUIDType, primary_key=True, server_default=text("gen_random_uuid()"))
    subscription_id = Column(UUIDType, nullable=True)
    institute_id = Column(String(64), nullable=False)
    event_type = Column(String(32), nullable=False)
    from_state = Column(JSONBType, nullable=True)
    to_state = Column(JSONBType, nullable=True)
    actor = Column(String(255), nullable=True)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_ase_sub", "subscription_id", "created_at"),
        Index("ix_ase_inst", "institute_id", "created_at"),
    )


FEATURE_TABLE = AiBillingFeature.__table__
PLAN_TABLE = AiPlan.__table__
VERSION_TABLE = AiPlanVersion.__table__
ITEM_TABLE = AiPlanItem.__table__
SUBSCRIPTION_TABLE = InstituteAiSubscription.__table__
PERIOD_TABLE = AiSubscriptionPeriod.__table__
OVERRIDE_TABLE = AiSubscriptionOverride.__table__
SUB_EVENT_TABLE = AiSubscriptionEvent.__table__

PLAN_TABLES = (FEATURE_TABLE, PLAN_TABLE, VERSION_TABLE, ITEM_TABLE, SUBSCRIPTION_TABLE, PERIOD_TABLE,
               OVERRIDE_TABLE, SUB_EVENT_TABLE)

# The two catalog columns the plan engine reads (use_case -> billing_feature_key).
# A lightweight Core view of the V586 table with the V588 column, on its OWN
# MetaData so PlansBase.metadata.create_all never creates a partial catalog table.
catalog_link_metadata = MetaData()
CATALOG_FEATURE_TABLE = Table(
    "ai_use_case_catalog", catalog_link_metadata,
    Column("use_case", String(64), primary_key=True),
    Column("billing_feature_key", String(48), nullable=True),
)

__all__ = [
    "PlansBase", "AiBillingFeature", "AiPlan", "AiPlanVersion", "AiPlanItem", "InstituteAiSubscription",
    "AiSubscriptionPeriod", "AiSubscriptionOverride", "AiSubscriptionEvent",
    "FEATURE_TABLE", "PLAN_TABLE", "VERSION_TABLE", "ITEM_TABLE", "SUBSCRIPTION_TABLE", "PERIOD_TABLE",
    "OVERRIDE_TABLE", "SUB_EVENT_TABLE", "PLAN_TABLES", "CATALOG_FEATURE_TABLE", "catalog_link_metadata",
    "ELIGIBILITIES", "VERSION_STATUSES", "GRACE_BEHAVIOURS", "ITEM_MODES", "MODEL_POLICIES",
    "MODEL_VIOLATION_ACTIONS", "OVER_CAP_ACTIONS", "USER_CAP_BASES", "SUBSCRIPTION_STATUSES", "LIVE_STATUSES",
    "ENFORCEMENTS", "SOURCES", "PAYMENT_STATUSES", "PAID_PERIOD_STATUSES", "CHARGE_KINDS", "CHARGE_STATUSES",
    "CHARGE_OPEN_STATUSES", "CHARGE_PAID_STATUSES", "MANDATE_STATUSES", "MANDATE_METHODS", "STOREFRONT_MODES",
    "AUDIENCE_MODES", "BRAND_MODES", "ROLE_CLASSES", "LOCKED_ALWAYS_CHARGED", "UNMAPPED_FEATURE",
    "TOOL_FEATURE_OVERRIDES", "PLAN_COUNTER_PERIOD", "DEFAULT_SAC_CODE", "plan_counter_key",
]
