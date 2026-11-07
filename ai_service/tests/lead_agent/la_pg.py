"""Real-Postgres scaffolding for the Lead Agent tests (test_la_*.py).

A scratch database gets minimal stubs of the admin_core tables the Lead Agent
reads but does not own (institutes, audience, the pricing / catalog tables V612
seeds, the credit ledger, the wallet), then the REAL Flyway file
V612__lead_agent.sql, in one transaction like Flyway. Driver: SQLAlchemy +
psycopg 3 (the prod driver; INSERT .. ON CONFLICT reports rowcount -1).

Server: AI_LIMITS_PG_URL (a server URL, postgresql+psycopg://...), or a pgserver
data directory (AI_LIMITS_PGDATA, else a temp directory). Skips without either.
"""
from __future__ import annotations

import atexit
import os
import re
import tempfile
import uuid
from pathlib import Path
from typing import List, Optional

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

MIGRATIONS = Path(__file__).resolve().parents[3] / "admin_core_service/src/main/resources/db/migration"

STUBS = """
CREATE TABLE IF NOT EXISTS institutes (
    id   VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255)
);
CREATE TABLE IF NOT EXISTS audience (
    id            VARCHAR(50) PRIMARY KEY,
    institute_id  VARCHAR(50) NOT NULL,
    campaign_name VARCHAR(255) NOT NULL,
    status        VARCHAR(20) DEFAULT 'ACTIVE'
);
CREATE TABLE IF NOT EXISTS ai_tool_pricing (
    tool_key          VARCHAR(64)   PRIMARY KEY,
    request_type      VARCHAR(64)   NOT NULL,
    flat_base_credits DECIMAL(10,4) NOT NULL DEFAULT 0,
    per_unit_credits  DECIMAL(10,4) NOT NULL DEFAULT 0,
    unit_field        VARCHAR(32)   NOT NULL,
    params_json       JSONB         NOT NULL DEFAULT '{}'::jsonb,
    is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
    CONSTRAINT ai_tool_pricing_unit_field_valid
        CHECK (unit_field IN ('questions', 'audio_minutes', 'chars', 'flat', 'pages', 'images'))
);
CREATE TABLE IF NOT EXISTS ai_use_case_catalog (
    use_case               VARCHAR(64) PRIMARY KEY,
    feature_group          VARCHAR(48) NOT NULL,
    label                  VARCHAR(128) NOT NULL,
    label_template         VARCHAR(255),
    count_unit_label       VARCHAR(32) DEFAULT 'requests',
    model_use_case         VARCHAR(64),
    legacy_request_types   TEXT[] NOT NULL DEFAULT '{}',
    tool_keys              TEXT[] NOT NULL DEFAULT '{}',
    capability_key         VARCHAR(64),
    default_surface        VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
    actor_kind             VARCHAR(16) NOT NULL DEFAULT 'USER',
    unit_kind              VARCHAR(16) NOT NULL DEFAULT 'TOKENS',
    plan_eligible          BOOLEAN NOT NULL DEFAULT TRUE,
    limit_eligible         BOOLEAN NOT NULL DEFAULT TRUE,
    reserve_on_authorize   BOOLEAN NOT NULL DEFAULT FALSE,
    intentionally_separate BOOLEAN NOT NULL DEFAULT FALSE,
    display_order          INT NOT NULL DEFAULT 100,
    updated_by             VARCHAR(255),
    billing_feature_key    VARCHAR(48)
);
CREATE TABLE IF NOT EXISTS ai_billing_feature (
    feature_key    VARCHAR(48) PRIMARY KEY,
    label          VARCHAR(128) NOT NULL,
    description    TEXT,
    eligibility    VARCHAR(16) NOT NULL,
    locked         BOOLEAN NOT NULL DEFAULT FALSE,
    display_order  INT NOT NULL DEFAULT 100,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by     VARCHAR(255),
    updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS credit_transactions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institute_id          VARCHAR(255) NOT NULL,
    amount                DECIMAL(12,4) NOT NULL,
    transaction_type      VARCHAR(50) NOT NULL,
    external_reference_id VARCHAR(255),
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_transactions_external_reference_id
    ON credit_transactions (external_reference_id) WHERE external_reference_id IS NOT NULL;
"""

TRUNCATE = ("TRUNCATE lead_fetch_task, lead_org_page, lead_candidate, lead_agent_day, lead_agent, lead_org, "
            "lead_agent_worker, lead_suppression, lead_search_cache, credit_transactions, audience, institutes")

_open: List = []
_server = {"obj": None}


def _server_url() -> Optional[str]:
    url = os.environ.get("AI_LIMITS_PG_URL")
    if url:
        return url
    try:
        import pgserver  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        return None
    data = os.environ.get("AI_LIMITS_PGDATA") or os.path.join(tempfile.gettempdir(), "la_pgdata")
    try:
        if _server["obj"] is None:
            _server["obj"] = pgserver.get_server(data, cleanup_mode=None)
        uri = _server["obj"].get_uri()
    except Exception:  # noqa: BLE001
        return None
    return uri.replace("postgresql://", "postgresql+psycopg://", 1)


def _db_url(base: str, name: str) -> str:
    if "/postgres?" in base:
        return base.replace("/postgres?", f"/{name}?")
    head, _, tail = base.rpartition("/")
    query = "?" + tail.split("?", 1)[1] if "?" in tail else ""
    return f"{head}/{name}{query}"


def migration_sql(prefix: str) -> str:
    hits = sorted(MIGRATIONS.glob(f"{prefix}__*.sql"))
    if not hits:
        pytest.skip(f"{prefix} migration not in this checkout")
    return hits[0].read_text(encoding="utf-8")


def pg_session_factory():
    base = _server_url()
    if not base:
        pytest.skip("no Postgres: set AI_LIMITS_PG_URL / AI_LIMITS_PGDATA or install pgserver")
    try:
        import psycopg  # noqa: F401,PLC0415
    except Exception:  # noqa: BLE001
        pytest.skip("psycopg 3 not installed")
    name = f"la_{uuid.uuid4().hex[:10]}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT", future=True)
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"'))
    engine = create_engine(_db_url(base, name), pool_size=10, max_overflow=5, future=True)
    with engine.begin() as c:
        c.exec_driver_sql(STUBS)
    with engine.begin() as c:  # V612 exactly as Flyway runs it (one transaction, SET LOCAL holds)
        c.exec_driver_sql(migration_sql("V612"))
    factory = sessionmaker(bind=engine, future=True, expire_on_commit=False)
    state = {"closed": False}

    def close() -> None:
        if state["closed"]:
            return
        state["closed"] = True
        engine.dispose()
        try:
            with admin.connect() as c:
                c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        finally:
            admin.dispose()

    def reset() -> None:
        with engine.begin() as c:
            c.exec_driver_sql(TRUNCATE + " CASCADE")

    factory.engine = engine
    factory.close = close
    factory.reset = reset
    _open.append(factory)
    return factory


@atexit.register
def _drop_leftovers() -> None:
    for f in _open:
        try:
            f.close()
        except Exception:  # noqa: BLE001
            pass


def v612_pricing_rows() -> List[tuple]:
    """(tool_key, request_type, flat, per_unit, unit_field, params) from the V612 file text."""
    sql = migration_sql("V612")
    block = sql[sql.index("INSERT INTO ai_tool_pricing"):]
    block = block[:block.index(";")]
    rows = re.findall(r"\('(\w+)',\s*'(\w+)',\s*([\d.]+),\s*([\d.]+),\s*'(\w+)',\s*'([^']*)'", block)
    return rows
