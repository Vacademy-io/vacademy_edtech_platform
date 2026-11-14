"""
Usage-metering tables (contract K1): ai_use_case_catalog, ai_role_class_map,
ai_usage_event, ai_model_alias.

Created by the admin_core Flyway migration V586__ai_usage_metering.sql (keep
these models identical to it; test_metering_core checks the parity when the
migration is in the checkout). ai_service runs NO DDL for them, like every
other Flyway-owned table (models/flyway_owned.py). The models use their own
declarative Base so nothing ever calls create_all for them in the app; the
metering service writes through these Table objects (SQLAlchemy Core), which
lets the same code run on Postgres and on the SQLite test database.

Postgres-only types carry a SQLite variant (uuid -> varchar(36), jsonb ->
json, text[] -> json) for the offline tests only.
"""
from __future__ import annotations

from sqlalchemy import (
    JSON, BigInteger, Boolean, Column, DateTime, Index, Integer, Numeric, String, Text, text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PG_UUID
from sqlalchemy.orm import declarative_base

Base = declarative_base()

UUIDType = PG_UUID(as_uuid=False).with_variant(String(36), "sqlite")
JSONBType = JSONB().with_variant(JSON(), "sqlite")
TextArray = ARRAY(Text).with_variant(JSON(), "sqlite")


class AiUseCaseCatalog(Base):
    __tablename__ = "ai_use_case_catalog"

    use_case = Column(String(64), primary_key=True)
    #: tutor|video|calling|content|assessment|analytics|kb|crm|engagement|agent|media|platform
    feature_group = Column(String(48), nullable=False)
    label = Column(String(128), nullable=False)
    label_template = Column(String(255), nullable=True)
    count_unit_label = Column(String(32), nullable=True, server_default=text("'requests'"))
    model_use_case = Column(String(64), nullable=True)
    legacy_request_types = Column(TextArray, nullable=False, server_default=text("'{}'"))
    tool_keys = Column(TextArray, nullable=False, server_default=text("'{}'"))
    capability_key = Column(String(64), nullable=True)
    default_surface = Column(String(24), nullable=False, server_default=text("'UNKNOWN'"))
    #: USER | SYSTEM | ON_BEHALF
    actor_kind = Column(String(16), nullable=False, server_default=text("'USER'"))
    #: TOKENS|IMAGES|SECONDS|MINUTES|CHARS|REQUESTS|MIXED
    unit_kind = Column(String(16), nullable=False, server_default=text("'TOKENS'"))
    #: AS_TODAY | CHARGE | FREE
    billing_policy = Column(String(16), nullable=False, server_default=text("'AS_TODAY'"))
    plan_eligible = Column(Boolean, nullable=False, server_default=text("true"))
    limit_eligible = Column(Boolean, nullable=False, server_default=text("true"))
    reserve_on_authorize = Column(Boolean, nullable=False, server_default=text("false"))
    typical_credits = Column(Numeric(12, 4), nullable=True)
    intentionally_separate = Column(Boolean, nullable=False, server_default=text("false"))
    is_active = Column(Boolean, nullable=False, server_default=text("true"))
    display_order = Column(Integer, nullable=False, server_default=text("100"))
    updated_by = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=text("now()"))


class AiRoleClassMap(Base):
    __tablename__ = "ai_role_class_map"

    #: normalized UPPER, spaces/hyphens -> '_' (core/security.py jwt_institute_roles)
    role_name = Column(String(64), primary_key=True)
    #: ADMIN|TEACHER|STAFF|PARENT|LEARNER (|SYSTEM|API_KEY|PUBLIC|UNKNOWN)
    role_class = Column(String(16), nullable=False)
    #: lowest wins: ADMIN 10 > TEACHER 20 > STAFF 30 (unmapped 35) > PARENT 40 > LEARNER 50
    precedence = Column(Integer, nullable=False)
    updated_by = Column(String(255), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=text("now()"))


class AiModelAlias(Base):
    __tablename__ = "ai_model_alias"

    alias = Column(String(255), primary_key=True)
    model_id = Column(String(255), nullable=False)
    note = Column(Text, nullable=True)


class AiUsageEvent(Base):
    """One row per billable AI operation, charged or not (d_credits §1.1)."""

    __tablename__ = "ai_usage_event"

    id = Column(UUIDType, primary_key=True, server_default=text("gen_random_uuid()"))
    occurred_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    institute_id = Column(String(64), nullable=True)
    # who
    actor_kind = Column(String(16), nullable=False)
    actor_user_id = Column(String(255), nullable=True)
    actor_role_class = Column(String(16), nullable=True)
    actor_roles_raw = Column(TextArray, nullable=True)
    role_source = Column(String(16), nullable=False, server_default=text("'UNRESOLVED'"))
    actor_display_name = Column(String(255), nullable=True)
    subject_user_id = Column(String(255), nullable=True)
    subject_display_name = Column(String(255), nullable=True)
    # what
    use_case = Column(String(64), nullable=False)
    use_case_source = Column(String(16), nullable=False)
    feature_group = Column(String(48), nullable=False)
    request_type = Column(String(50), nullable=True)
    tool_key = Column(String(64), nullable=True)
    surface = Column(String(24), nullable=False)
    source_service = Column(String(24), nullable=False)
    context = Column(JSONBType, nullable=True)
    # how it ran
    model_id = Column(String(255), nullable=True)
    model_wire_id = Column(String(255), nullable=True)
    provider = Column(String(32), nullable=True)
    router = Column(String(32), nullable=True)
    gateway_key_id = Column(String(64), nullable=True)
    byo_key = Column(Boolean, nullable=False, server_default=text("false"))
    # units
    prompt_tokens = Column(BigInteger, nullable=True, server_default=text("0"))
    cached_read_tokens = Column(BigInteger, nullable=True, server_default=text("0"))
    cache_write_tokens = Column(BigInteger, nullable=True, server_default=text("0"))
    completion_tokens = Column(BigInteger, nullable=True, server_default=text("0"))
    reasoning_tokens = Column(BigInteger, nullable=True, server_default=text("0"))
    image_tokens = Column(BigInteger, nullable=True, server_default=text("0"))
    image_count = Column(Integer, nullable=True, server_default=text("0"))
    seconds = Column(Numeric(12, 3), nullable=True, server_default=text("0"))
    minutes = Column(Numeric(12, 3), nullable=True, server_default=text("0"))
    characters = Column(Integer, nullable=True, server_default=text("0"))
    request_count = Column(Integer, nullable=False, server_default=text("1"))
    # money
    real_cost_usd = Column(Numeric(14, 8), nullable=True)
    cost_source = Column(String(16), nullable=False, server_default=text("'UNKNOWN'"))
    price_snapshot = Column(JSONBType, nullable=True)
    list_credits = Column(Numeric(14, 4), nullable=False, server_default=text("0"))
    credits_charged = Column(Numeric(14, 4), nullable=False, server_default=text("0"))
    refunded_credits = Column(Numeric(14, 4), nullable=False, server_default=text("0"))
    #: CHARGED | INCLUDED | ALLOWANCE | SPLIT | FREE | BYO_KEY
    billing_mode = Column(String(20), nullable=False)
    shadow_billing_mode = Column(String(20), nullable=True)
    #: POSTED | DROPPED_INSUFFICIENT | SKIPPED_NO_INSTITUTE | NOT_APPLICABLE | REFUNDED | PARTIAL_REFUND
    charge_status = Column(String(24), nullable=False)
    #: BUNDLED | POLICY_FREE | UNBILLED_GAP | NO_INSTITUTE | INTERNAL_TEST
    free_reason = Column(String(24), nullable=True)
    subscription_id = Column(UUIDType, nullable=True)
    plan_id = Column(UUIDType, nullable=True)
    plan_item_id = Column(UUIDType, nullable=True)
    limit_decision = Column(String(16), nullable=False, server_default=text("'NONE'"))
    reservation_id = Column(UUIDType, nullable=True)
    # links
    ledger_tx_id = Column(UUIDType, nullable=True)
    parent_event_id = Column(UUIDType, nullable=True)
    batch_id = Column(String(255), nullable=True)
    idempotency_key = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ux_ai_usage_event_idem", "idempotency_key", unique=True,
              postgresql_where=text("idempotency_key IS NOT NULL"),
              sqlite_where=text("idempotency_key IS NOT NULL")),
        Index("ix_aue_inst_time", "institute_id", "occurred_at"),
        Index("ix_aue_inst_user_time", "institute_id", "actor_user_id", "occurred_at"),
        Index("ix_aue_ledger", "ledger_tx_id"),
        Index("ix_aue_batch", "batch_id"),
    )


EVENT_TABLE = AiUsageEvent.__table__
CATALOG_TABLE = AiUseCaseCatalog.__table__
ROLE_MAP_TABLE = AiRoleClassMap.__table__
ALIAS_TABLE = AiModelAlias.__table__

__all__ = [
    "Base", "AiUseCaseCatalog", "AiRoleClassMap", "AiModelAlias", "AiUsageEvent",
    "EVENT_TABLE", "CATALOG_TABLE", "ROLE_MAP_TABLE", "ALIAS_TABLE",
]
