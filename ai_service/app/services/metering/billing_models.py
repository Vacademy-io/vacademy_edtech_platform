"""
AI plan payments + storefront tables owned by ai_service (contract S1 / V590):
ai_subscription_charge, ai_subscription_mandate, ai_institute_segment,
ai_storefront_audience, ai_storefront_institute, plus the V590 columns added to
ai_plan (storefront listing) and ai_billing_feature (tenant_label) and the
widening of institute_ai_subscription.status to VARCHAR(16) (adds PENDING).

Created by the admin_core Flyway migration V590__ai_plan_payments_storefront.sql
(keep these models identical to it, column for column;
tests/test_billing_models_parity.py checks it offline and on a real Postgres 16).
ai_service runs NO DDL for them (models/flyway_owned.py); nothing in the app
calls create_all.

Why a separate declarative base (BillingBase) and no SQLAlchemy ForeignKey:
  * plan_models.PlansBase must stay identical to V588 (test_plan_models_parity),
    so the V590 columns on ai_plan / ai_billing_feature cannot be added to those
    models. They are exposed here as lightweight Core views on their own MetaData
    (PLAN_LISTING_TABLE, FEATURE_LABEL_TABLE), like plan_models.CATALOG_FEATURE_TABLE.
  * the new tables reference plan tables (institute_ai_subscription, ai_plan,
    ai_plan_version, ai_subscription_period). A string ForeignKey into another
    MetaData cannot resolve, so the database foreign keys are listed in
    DB_FOREIGN_KEYS instead (the parity test checks them against the migration
    and the live catalog). Engine code joins on the columns explicitly.
  * create_sqlite_billing_schema() builds the whole thing on SQLite for the
    offline tests (PG server defaults stripped; engine code always supplies ids
    and timestamps, like plan_models).

The enum-like columns carry no CHECK constraint (like V586-V588); the
vocabularies are validated in code. The charge / mandate / storefront
vocabularies live in plan_models (next to SUBSCRIPTION_STATUSES) and are
re-exported here; the widths below must fit them (parity test).

Money invariants enforced by the database (V590):
  * ux_asc_period      one non-VOID PERIOD charge per (subscription, service_start),
                       also while period_id is still NULL (critique #5); a FAILED
                       charge must be VOIDed before a replacement is created
  * ux_asc_open_upgrade one open UPGRADE (DUE/LINK_SENT/DEBIT_SCHEDULED/FAILED)
  * ux_asc_vendor      a Razorpay payment pays at most one charge
  * ux_asc_idem        (institute_id, idempotency_key) for checkout retries
  * ck_asc_total       total_minor = base_minor + tax_minor once both are set
                       (inclusive prices: tax = total - base)
  * ck_asc_currency    INR only;  ck_asc_refund refunded_minor <= paid_minor
  * ux_asm_usable      one ACTIVE/PAUSED mandate per subscription; ux_asm_token
  * ux_ias_pending     one PENDING subscription per institute (V590 index on the
                       V588 table; not on the PlansBase model, see above)
"""
from __future__ import annotations

from sqlalchemy import (
    JSON, BigInteger, Boolean, CheckConstraint, Column, DateTime, Index, Integer, MetaData, String, Table, Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import declarative_base

from .plan_models import (  # noqa: F401  (re-exported vocabularies)
    AUDIENCE_MODES, BRAND_MODES, CHARGE_KINDS, CHARGE_OPEN_STATUSES, CHARGE_PAID_STATUSES, CHARGE_STATUSES,
    MANDATE_METHODS, MANDATE_STATUSES, STOREFRONT_MODES, SUBSCRIPTION_STATUSES,
)

BillingBase = declarative_base()

UUIDType = PG_UUID(as_uuid=False).with_variant(String(36), "sqlite")
JSONBType = JSONB().with_variant(JSON(), "sqlite")

# ── vocabularies only this module defines ───────────────────────────────────
AUDIENCE_RULES = ("INCLUDE", "EXCLUDE")
TAX_HEADS = ("CGST_SGST", "IGST", "EXPORT")
#: subscriptions are INR-only in v1 (owner default 2026-10-16; DB CHECK ck_asc_currency)
CHARGE_CURRENCY = "INR"
#: SAC for new plan versions (owner default; V588 seeded 998313 on the AI Pro DRAFT)
DEFAULT_SUBSCRIPTION_SAC_CODE = "998315"
#: RBI e-mandate additional-factor-authentication-free ceiling per debit, in paise (Rs 15,000).
#: Plans whose period total exceeds it are collected by payment link only (owner decision D5).
AUTOPAY_AFA_FREE_MAX_MINOR = 1_500_000
#: subscription status values that hold the per-institute PENDING slot (= ux_ias_pending)
PENDING_STATUS = "PENDING"

# column widths (keep in step with V590)
W_SUB_STATUS_V590 = 16          # institute_ai_subscription.status after V590 (model still says 12 = V588)
W_CHARGE_KIND = 8
W_CHARGE_STATUS = 20
W_MANDATE_METHOD = 10
W_MANDATE_STATUS = 12
W_AUDIENCE_RULE = 8
W_AUDIENCE_MODE = 10
W_BRAND_MODE = 10
W_TAX_HEAD = 12
W_INSTITUTE = 64
W_SEGMENT_KEY = 48

#: database foreign keys of the BillingBase tables (column -> referenced table.column)
DB_FOREIGN_KEYS = {
    "ai_storefront_audience": {"plan_id": "ai_plan.id"},
    "ai_subscription_mandate": {"subscription_id": "institute_ai_subscription.id"},
    "ai_subscription_charge": {
        "subscription_id": "institute_ai_subscription.id",
        "plan_version_id": "ai_plan_version.id",
        "mandate_id": "ai_subscription_mandate.id",
        "period_id": "ai_subscription_period.id",
    },
}


class AiInstituteSegment(BillingBase):
    """Hand-filled institute -> segment key (storefront SEGMENTS rollout, plan SEGMENT audience)."""

    __tablename__ = "ai_institute_segment"

    institute_id = Column(String(64), primary_key=True)
    segment_key = Column(String(48), primary_key=True)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (Index("ix_ais_segment", "segment_key"),)


class AiStorefrontAudience(BillingBase):
    """Who may see the storefront (plan_id NULL) or one plan (plan_id set). EXCLUDE beats INCLUDE."""

    __tablename__ = "ai_storefront_audience"

    id = Column(UUIDType, primary_key=True, server_default=text("gen_random_uuid()"))
    #: ai_plan.id; NULL = access to the storefront itself
    plan_id = Column(UUIDType, nullable=True)
    #: INCLUDE | EXCLUDE
    rule = Column(String(8), nullable=False, server_default=text("'INCLUDE'"))
    #: exactly one of institute_id / segment_key (ck_asa_target)
    institute_id = Column(String(64), nullable=True)
    segment_key = Column(String(48), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    reason = Column(Text, nullable=True)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("(institute_id IS NULL) <> (segment_key IS NULL)", name="ck_asa_target"),
        Index("ux_asa_rule", text("COALESCE(CAST(plan_id AS TEXT), '')"), "rule", text("COALESCE(institute_id, '')"),
              text("COALESCE(segment_key, '')"), unique=True,
              postgresql_where=text("is_active"), sqlite_where=text("is_active")),
        Index("ix_asa_institute", "institute_id"),
    )


class AiStorefrontInstitute(BillingBase):
    """Super-admin per-institute switches (tenants never write this table).

    storefront_enabled: NULL = the rollout mode decides, TRUE = on (allow-listed),
    FALSE = off whatever the mode. brand_mode_override: NULL = resolve from the
    institute's admin domain, else VACADEMY | NEUTRAL.
    """

    __tablename__ = "ai_storefront_institute"

    institute_id = Column(String(64), primary_key=True)
    #: VACADEMY | NEUTRAL | NULL
    brand_mode_override = Column(String(10), nullable=True)
    storefront_enabled = Column(Boolean, nullable=True)
    reason = Column(Text, nullable=True)
    updated_by = Column(String(255), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class AiSubscriptionMandate(BillingBase):
    """UPI Autopay / card / e-mandate token on the platform Razorpay account."""

    __tablename__ = "ai_subscription_mandate"

    id = Column(UUIDType, primary_key=True, server_default=text("gen_random_uuid()"))
    institute_id = Column(String(64), nullable=False)
    #: institute_ai_subscription.id (DB foreign key)
    subscription_id = Column(UUIDType, nullable=True)
    razorpay_customer_id = Column(String(64), nullable=True)
    #: Razorpay token id (token_...), set on token.confirmed
    token_id = Column(String(64), nullable=True)
    #: UPI | CARD | EMANDATE (NULL until the buyer picks a method on the Razorpay page)
    method = Column(String(10), nullable=True)
    max_amount_minor = Column(BigInteger, nullable=True)
    frequency = Column(String(16), nullable=True)
    #: PENDING | ACTIVE | PAUSED | CANCELLED | REJECTED | EXPIRED
    status = Column(String(12), nullable=False, server_default=text("'PENDING'"))
    registration_link_id = Column(String(64), nullable=True)
    registration_link_url = Column(Text, nullable=True)
    auth_order_id = Column(String(64), nullable=True)
    auth_payment_id = Column(String(64), nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    failure_reason = Column(String(255), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    #: created_at of the newest token.* webhook applied (older events are dropped)
    last_event_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("max_amount_minor IS NULL OR max_amount_minor > 0", name="ck_asm_max_amount"),
        Index("ux_asm_token", "token_id", unique=True,
              postgresql_where=text("token_id IS NOT NULL"), sqlite_where=text("token_id IS NOT NULL")),
        Index("ux_asm_usable", "subscription_id", unique=True,
              postgresql_where=text("status IN ('ACTIVE','PAUSED')"),
              sqlite_where=text("status IN ('ACTIVE','PAUSED')")),
        Index("ix_asm_inst", "institute_id", "created_at"),
        Index("ix_asm_customer", "razorpay_customer_id"),
        Index("ix_asm_order", "auth_order_id",
              postgresql_where=text("auth_order_id IS NOT NULL"), sqlite_where=text("auth_order_id IS NOT NULL")),
    )


class AiSubscriptionCharge(BillingBase):
    """One amount owed by a source=PAYMENT subscription (a PERIOD, or an UPGRADE pro-rata).

    period_id stays NULL until the charge is paid (no period is pre-created at
    T-7). tax_minor / total_minor / place_of_supply / tax_head are the snapshot
    admin_core writes when it prices the charge; /paid must compare the paid
    amount with total_minor.
    """

    __tablename__ = "ai_subscription_charge"

    id = Column(UUIDType, primary_key=True, server_default=text("gen_random_uuid()"))
    #: institute_ai_subscription.id (DB foreign key)
    subscription_id = Column(UUIDType, nullable=False)
    institute_id = Column(String(64), nullable=False)
    #: PERIOD | UPGRADE
    kind = Column(String(8), nullable=False)
    #: DUE | LINK_SENT | DEBIT_SCHEDULED | PAID | FAILED | VOID | REFUNDED | PARTIALLY_REFUNDED
    status = Column(String(20), nullable=False, server_default=text("'DUE'"))
    service_start = Column(DateTime(timezone=True), nullable=False)
    service_end = Column(DateTime(timezone=True), nullable=False)
    #: ai_plan_version.id (DB foreign key): the version this charge pays for
    plan_version_id = Column(UUIDType, nullable=False)
    #: UPGRADE: the version being left
    from_plan_version_id = Column(UUIDType, nullable=True)
    currency = Column(String(3), nullable=False, server_default=text("'INR'"))
    is_tax_inclusive = Column(Boolean, nullable=False, server_default=text("false"))
    sac_code = Column(String(16), nullable=True)
    description = Column(String(255), nullable=True)
    #: taxable value in paise (after any pro-rata netting)
    base_minor = Column(BigInteger, nullable=False)
    tax_minor = Column(BigInteger, nullable=True)
    total_minor = Column(BigInteger, nullable=True)
    place_of_supply = Column(String(2), nullable=True)
    #: CGST_SGST | IGST | EXPORT
    tax_head = Column(String(12), nullable=True)
    #: the quote / proration arithmetic, for audit
    quote_json = Column(JSONBType, nullable=True)
    idempotency_key = Column(String(64), nullable=True)
    platform_payment_id = Column(String(255), nullable=True)
    vendor_payment_id = Column(String(64), nullable=True)
    payment_link_id = Column(String(64), nullable=True)
    payment_link_url = Column(Text, nullable=True)
    link_expires_at = Column(DateTime(timezone=True), nullable=True)
    #: ai_subscription_mandate.id (DB foreign key)
    mandate_id = Column(UUIDType, nullable=True)
    debit_attempts = Column(Integer, nullable=False, server_default=text("0"))
    next_attempt_at = Column(DateTime(timezone=True), nullable=True)
    pre_debit_notice_sent_at = Column(DateTime(timezone=True), nullable=True)
    #: ai_subscription_period.id (DB foreign key); NULL until paid
    period_id = Column(UUIDType, nullable=True)
    paid_minor = Column(BigInteger, nullable=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    refunded_minor = Column(BigInteger, nullable=False, server_default=text("0"))
    void_reason = Column(String(64), nullable=True)
    last_error = Column(String(255), nullable=True)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("currency = 'INR'", name="ck_asc_currency"),
        CheckConstraint("service_end > service_start", name="ck_asc_window"),
        CheckConstraint("base_minor >= 0 AND (tax_minor IS NULL OR tax_minor >= 0) "
                        "AND (total_minor IS NULL OR total_minor >= 0)", name="ck_asc_amounts"),
        CheckConstraint("total_minor IS NULL OR tax_minor IS NULL OR total_minor = base_minor + tax_minor",
                        name="ck_asc_total"),
        CheckConstraint("refunded_minor >= 0 AND (paid_minor IS NULL OR refunded_minor <= paid_minor)",
                        name="ck_asc_refund"),
        CheckConstraint("debit_attempts >= 0", name="ck_asc_attempts"),
        Index("ux_asc_period", "subscription_id", "service_start", unique=True,
              postgresql_where=text("kind = 'PERIOD' AND status <> 'VOID'"),
              sqlite_where=text("kind = 'PERIOD' AND status <> 'VOID'")),
        Index("ux_asc_open_upgrade", "subscription_id", unique=True,
              postgresql_where=text("kind = 'UPGRADE' AND status IN ('DUE','LINK_SENT','DEBIT_SCHEDULED','FAILED')"),
              sqlite_where=text("kind = 'UPGRADE' AND status IN ('DUE','LINK_SENT','DEBIT_SCHEDULED','FAILED')")),
        Index("ux_asc_vendor", "vendor_payment_id", unique=True,
              postgresql_where=text("vendor_payment_id IS NOT NULL"),
              sqlite_where=text("vendor_payment_id IS NOT NULL")),
        Index("ux_asc_idem", "institute_id", "idempotency_key", unique=True,
              postgresql_where=text("idempotency_key IS NOT NULL"),
              sqlite_where=text("idempotency_key IS NOT NULL")),
        Index("ix_asc_collect", "status", "next_attempt_at"),
        Index("ix_asc_sub", "subscription_id", "service_start"),
        Index("ix_asc_payment", "platform_payment_id",
              postgresql_where=text("platform_payment_id IS NOT NULL"),
              sqlite_where=text("platform_payment_id IS NOT NULL")),
        Index("ix_asc_link", "payment_link_id",
              postgresql_where=text("payment_link_id IS NOT NULL"),
              sqlite_where=text("payment_link_id IS NOT NULL")),
    )


SEGMENT_TABLE = AiInstituteSegment.__table__
AUDIENCE_TABLE = AiStorefrontAudience.__table__
STOREFRONT_INSTITUTE_TABLE = AiStorefrontInstitute.__table__
MANDATE_TABLE = AiSubscriptionMandate.__table__
CHARGE_TABLE = AiSubscriptionCharge.__table__

BILLING_TABLES = (SEGMENT_TABLE, AUDIENCE_TABLE, STOREFRONT_INSTITUTE_TABLE, MANDATE_TABLE, CHARGE_TABLE)

# ── V590 columns on V588 tables (Core views on their OWN MetaData) ──────────
# Read / write the storefront listing through these; plan_models.AiPlan /
# AiBillingFeature stay identical to V588. Never create_all this MetaData.
v590_columns_metadata = MetaData()
PLAN_LISTING_TABLE = Table(
    "ai_plan", v590_columns_metadata,
    Column("id", UUIDType, primary_key=True),
    Column("listed", Boolean, nullable=False, server_default=text("false")),
    Column("tagline", String(160), nullable=True),
    Column("highlights", JSONBType, nullable=True),
    Column("badge", String(32), nullable=True),
    Column("sort_order", Integer, nullable=False, server_default=text("100")),
    #: ALL | ALLOWLIST | SEGMENT
    Column("audience_mode", String(10), nullable=False, server_default=text("'ALLOWLIST'")),
    Column("listing_updated_by", String(255), nullable=True),
    Column("listing_updated_at", DateTime(timezone=True), nullable=True),
)
FEATURE_LABEL_TABLE = Table(
    "ai_billing_feature", v590_columns_metadata,
    Column("feature_key", String(48), primary_key=True),
    #: tenant-facing label; NULL = ai_billing_feature.label
    Column("tenant_label", String(128), nullable=True),
)
#: CHECK V590 adds on ai_plan
PLAN_HIGHLIGHTS_CHECK = ("ck_ai_plan_highlights_array", "highlights IS NULL OR jsonb_typeof(highlights) = 'array'")
#: the V590 index on institute_ai_subscription (not on the PlansBase model; see the module docstring)
SUBSCRIPTION_PENDING_INDEX = ("ux_ias_pending", ("institute_id",), "status = 'PENDING'")

#: SQLite DDL that gives an offline test database the V590 shape of the V588
#: tables (run AFTER the PlansBase tables exist; see create_sqlite_billing_schema)
SQLITE_V590_DDL = (
    "ALTER TABLE ai_billing_feature ADD COLUMN tenant_label VARCHAR(128)",
    "ALTER TABLE ai_plan ADD COLUMN listed BOOLEAN NOT NULL DEFAULT 0",
    "ALTER TABLE ai_plan ADD COLUMN tagline VARCHAR(160)",
    "ALTER TABLE ai_plan ADD COLUMN highlights JSON",
    "ALTER TABLE ai_plan ADD COLUMN badge VARCHAR(32)",
    "ALTER TABLE ai_plan ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100",
    "ALTER TABLE ai_plan ADD COLUMN audience_mode VARCHAR(10) NOT NULL DEFAULT 'ALLOWLIST'",
    "ALTER TABLE ai_plan ADD COLUMN listing_updated_by VARCHAR(255)",
    "ALTER TABLE ai_plan ADD COLUMN listing_updated_at DATETIME",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_ias_pending ON institute_ai_subscription (institute_id) "
    "WHERE status = 'PENDING'",
)


def stripped_billing_metadata() -> MetaData:
    """Copy of the BillingBase tables without the Postgres-only server defaults (SQLite tests)."""
    md = MetaData()
    for table in BillingBase.metadata.tables.values():
        t = table.to_metadata(md)
        for c in t.columns:
            c.server_default = None
    return md


def create_sqlite_billing_schema(engine, *, alter_plan_tables: bool = True) -> None:
    """Offline tests: create the V590 tables, and (when the V588 plan tables already exist on
    this engine) add the V590 columns / index to them. Engine code must supply ids, timestamps
    and the NOT NULL defaults explicitly, exactly as on Postgres."""
    stripped_billing_metadata().create_all(engine)
    if not alter_plan_tables:
        return
    with engine.begin() as conn:
        for stmt in SQLITE_V590_DDL:
            conn.exec_driver_sql(stmt)


__all__ = [
    "BillingBase", "AiInstituteSegment", "AiStorefrontAudience", "AiStorefrontInstitute",
    "AiSubscriptionMandate", "AiSubscriptionCharge",
    "SEGMENT_TABLE", "AUDIENCE_TABLE", "STOREFRONT_INSTITUTE_TABLE", "MANDATE_TABLE", "CHARGE_TABLE",
    "BILLING_TABLES", "PLAN_LISTING_TABLE", "FEATURE_LABEL_TABLE", "v590_columns_metadata",
    "PLAN_HIGHLIGHTS_CHECK", "SUBSCRIPTION_PENDING_INDEX", "SQLITE_V590_DDL", "DB_FOREIGN_KEYS",
    "stripped_billing_metadata", "create_sqlite_billing_schema",
    "AUDIENCE_RULES", "TAX_HEADS", "CHARGE_CURRENCY", "DEFAULT_SUBSCRIPTION_SAC_CODE", "AUTOPAY_AFA_FREE_MAX_MINOR",
    "PENDING_STATUS", "AUDIENCE_MODES", "BRAND_MODES", "CHARGE_KINDS", "CHARGE_OPEN_STATUSES",
    "CHARGE_PAID_STATUSES", "CHARGE_STATUSES", "MANDATE_METHODS", "MANDATE_STATUSES", "STOREFRONT_MODES",
    "SUBSCRIPTION_STATUSES",
    "W_SUB_STATUS_V590", "W_CHARGE_KIND", "W_CHARGE_STATUS", "W_MANDATE_METHOD", "W_MANDATE_STATUS",
    "W_AUDIENCE_RULE", "W_AUDIENCE_MODE", "W_BRAND_MODE", "W_TAX_HEAD", "W_INSTITUTE", "W_SEGMENT_KEY",
]
