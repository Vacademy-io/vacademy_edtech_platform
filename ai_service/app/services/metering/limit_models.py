"""
Usage-limit tables (contract N1): institute_ai_limits_policy, ai_usage_limit,
ai_usage_counter, ai_usage_reservation.

Created by the admin_core Flyway migration V587__ai_usage_limits.sql (keep these
models identical to it, column for column; tests/test_limit_models_parity.py
checks the parity when the migration is in the checkout). ai_service runs NO DDL
for them, like every other Flyway-owned table (models/flyway_owned.py). The
models use their own declarative Base (separate from metering/models.py, so the
metering-core SQLite fixtures are unchanged) and nothing ever calls create_all
for them in the app; the limits engine (metering/limits.py) reads and writes
through these Table objects (SQLAlchemy Core), which lets the same code run on
Postgres and on the SQLite test database.

Postgres-only types carry a SQLite variant (uuid -> varchar(36), jsonb -> json,
text[] -> json) for the offline tests only. Postgres-only server defaults
(gen_random_uuid(), now()) must be stripped for SQLite, as test_metering_core's
_stripped_metadata does; engine code therefore always supplies id / timestamps
explicitly.

The enum-like columns have no CHECK constraint in the database (like V586); the
vocabularies below are the single place ai_service validates them against.
"""
from __future__ import annotations

from sqlalchemy import (
    JSON, Boolean, CheckConstraint, Column, DateTime, Index, Numeric, String, Text, func, text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PG_UUID
from sqlalchemy.orm import declarative_base

LimitsBase = declarative_base()

UUIDType = PG_UUID(as_uuid=False).with_variant(String(36), "sqlite")
JSONBType = JSONB().with_variant(JSON(), "sqlite")
TextArray = ARRAY(Text).with_variant(JSON(), "sqlite")

# ── vocabularies (validated in code; documented in V587) ─────────────────────
POLICY_MODES = ("OFF", "SHADOW", "ENFORCE")
SUBJECT_KINDS = ("INSTITUTE", "ROLE_CLASS", "ROLE", "USER")
SCOPE_KINDS = ("ALL", "GROUP", "USE_CASE")
PERIODS = ("DAY", "WEEK", "MONTH", "PLAN_PERIOD")      # PLAN_PERIOD reserved until AI plans ship
ACTIVE_PERIODS = ("DAY", "WEEK", "MONTH")
METRICS = ("CREDITS", "COUNT", "COST_USD")
ORIGINS = ("TENANT", "PLATFORM")
RESERVATION_STATUSES = ("OPEN", "SETTLED", "RELEASED")
DEFAULT_TIMEZONE = "Asia/Kolkata"

# column widths (keep in step with V587)
W_INSTITUTE = 64
W_MODE = 8
W_TIMEZONE = 48
W_SUBJECT_KIND = 16
W_SUBJECT_VALUE = 255
W_SCOPE_KIND = 16
W_SCOPE_VALUE = 64
W_PERIOD = 12
W_METRIC = 8
W_ORIGIN = 10
W_COUNTER_KEY = 320
W_USE_CASE = 64
W_USER_ID = 255
W_STATUS = 10


class InstituteAiLimitsPolicy(LimitsBase):
    """One row per institute that has limits configured; no row = OFF (today)."""

    __tablename__ = "institute_ai_limits_policy"

    institute_id = Column(String(64), primary_key=True)
    #: OFF | SHADOW | ENFORCE
    mode = Column(String(8), nullable=False, server_default=text("'OFF'"))
    tenant_may_enforce = Column(Boolean, nullable=False, server_default=text("false"))
    timezone = Column(String(48), nullable=False, server_default=text("'Asia/Kolkata'"))
    notify_admins_on_soft = Column(Boolean, nullable=False, server_default=text("true"))
    show_numbers_to_learners = Column(Boolean, nullable=False, server_default=text("false"))
    updated_by = Column(String(255), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=text("now()"))
    reason = Column(Text, nullable=True)


class AiUsageLimit(LimitsBase):
    """A soft / hard cap for one subject x scope x period x metric (d_credits §4.1)."""

    __tablename__ = "ai_usage_limit"

    id = Column(UUIDType, primary_key=True, server_default=text("gen_random_uuid()"))
    institute_id = Column(String(64), nullable=False)
    #: INSTITUTE | ROLE_CLASS | ROLE | USER
    subject_kind = Column(String(16), nullable=False)
    #: NULL for INSTITUTE; role class; role name; user id
    subject_value = Column(String(255), nullable=True)
    #: ROLE*: TRUE = each member capped; FALSE = pooled across the role
    per_member = Column(Boolean, nullable=False, server_default=text("true"))
    #: ALL | GROUP | USE_CASE
    scope_kind = Column(String(16), nullable=False)
    #: feature_group or use_case; NULL for ALL
    scope_value = Column(String(64), nullable=True)
    #: DAY | WEEK | MONTH | PLAN_PERIOD
    period = Column(String(12), nullable=False)
    #: CREDITS | COUNT | COST_USD
    metric = Column(String(8), nullable=False)
    #: warn at or above
    soft_limit = Column(Numeric(14, 4), nullable=True)
    #: block at or above; 0 = feature off for the subject; NULL = unlimited
    hard_limit = Column(Numeric(14, 4), nullable=True)
    #: TENANT | PLATFORM
    origin = Column(String(10), nullable=False, server_default=text("'TENANT'"))
    locked = Column(Boolean, nullable=False, server_default=text("false"))
    effective_from = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    effective_to = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    reason = Column(Text, nullable=True)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True, server_default=text("now()"))
    updated_by = Column(String(255), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("soft_limit IS NULL OR hard_limit IS NULL OR soft_limit <= hard_limit",
                        name="ck_aul_soft_le_hard"),
        CheckConstraint("soft_limit IS NULL OR soft_limit >= 0", name="ck_aul_soft_nonneg"),
        CheckConstraint("hard_limit IS NULL OR hard_limit >= 0", name="ck_aul_hard_nonneg"),
        Index("ux_ai_usage_limit_open",
              "institute_id", "subject_kind", func.coalesce(text("subject_value"), text("''")),
              "per_member", "scope_kind", func.coalesce(text("scope_value"), text("''")),
              "period", "metric", "origin",
              unique=True,
              postgresql_where=text("is_active AND effective_to IS NULL"),
              sqlite_where=text("is_active AND effective_to IS NULL")),
        Index("ix_aul_inst", "institute_id"),
    )


class AiUsageCounter(LimitsBase):
    """Per-window usage totals per counter key: a cache of ai_usage_event."""

    __tablename__ = "ai_usage_counter"

    institute_id = Column(String(64), primary_key=True)
    #: 'I|ALL', 'I|G:tutor', 'R:TEACHER|UC:lesson_video', 'U:<uid>|ALL', ...
    counter_key = Column(String(320), primary_key=True)
    #: DAY | WEEK | MONTH | PLAN_PERIOD
    period = Column(String(12), primary_key=True)
    #: UTC instant of the local window start (policy timezone)
    window_start = Column(DateTime(timezone=True), primary_key=True)
    #: sum of ai_usage_event.list_credits
    credits_used = Column(Numeric(16, 4), nullable=False, server_default=text("0"))
    count_used = Column(Numeric(16, 4), nullable=False, server_default=text("0"))
    #: sum of ai_usage_event.real_cost_usd
    cost_usd = Column(Numeric(16, 8), nullable=False, server_default=text("0"))
    #: de-dup of soft-limit notifications per window
    warned_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


class AiUsageReservation(LimitsBase):
    """Held capacity for reserve_on_authorize use cases (d_credits §4.4)."""

    __tablename__ = "ai_usage_reservation"

    id = Column(UUIDType, primary_key=True, server_default=text("gen_random_uuid()"))
    institute_id = Column(String(64), nullable=False)
    counter_keys = Column(TextArray, nullable=False)
    #: [{key, period, window_start}, ...]
    period_windows = Column(JSONBType, nullable=False)
    credits = Column(Numeric(14, 4), nullable=False, server_default=text("0"))
    count = Column(Numeric(14, 4), nullable=False, server_default=text("1"))
    use_case = Column(String(64), nullable=False)
    actor_user_id = Column(String(255), nullable=True)
    #: OPEN | SETTLED | RELEASED (expired OPEN rows are ignored)
    status = Column(String(10), nullable=False, server_default=text("'OPEN'"))
    created_at = Column(DateTime(timezone=True), nullable=True, server_default=text("now()"))
    expires_at = Column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("ix_aur_open", "institute_id", "status", "expires_at",
              postgresql_where=text("status = 'OPEN'"),
              sqlite_where=text("status = 'OPEN'")),
    )


POLICY_TABLE = InstituteAiLimitsPolicy.__table__
LIMIT_TABLE = AiUsageLimit.__table__
COUNTER_TABLE = AiUsageCounter.__table__
RESERVATION_TABLE = AiUsageReservation.__table__

LIMIT_TABLES = (POLICY_TABLE, LIMIT_TABLE, COUNTER_TABLE, RESERVATION_TABLE)

__all__ = [
    "LimitsBase", "InstituteAiLimitsPolicy", "AiUsageLimit", "AiUsageCounter", "AiUsageReservation",
    "POLICY_TABLE", "LIMIT_TABLE", "COUNTER_TABLE", "RESERVATION_TABLE", "LIMIT_TABLES",
    "POLICY_MODES", "SUBJECT_KINDS", "SCOPE_KINDS", "PERIODS", "ACTIVE_PERIODS", "METRICS", "ORIGINS",
    "RESERVATION_STATUSES", "DEFAULT_TIMEZONE",
]
