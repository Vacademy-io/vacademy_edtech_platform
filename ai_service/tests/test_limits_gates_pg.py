"""Usage limits through the REAL charge path on a REAL Postgres 16 (unit L2b):
CreditService.deduct_credits (psycopg 3, the prod driver) -> post-commit usage
event -> usage counters -> the next check / HTTP gate answers 429.

The database is a fresh copy of a template (AI_LIMITS_PG_TEMPLATE, e.g. the
prod-schema snapshot 'prodbase' with real ledger rows) plus the Flyway
migrations V586 + V587 from this checkout; without a template a bare database
with stub ledger tables is used.

What must hold:
  * an institute WITHOUT a policy: identical response / ledger / balance, and
    not one statement touches a limits table;
  * WITH an ENFORCE policy: counters equal the sum of list_credits of the
    real charges, the event that crosses the hard limit is OVERRUN, the next
    check raises LimitExceeded and the HTTP gate returns 429 + Retry-After;
  * a refund takes its credits back out; the nightly rebuild agrees.

Needs Postgres: AI_LIMITS_PG_URL (server URL, postgresql+psycopg://...) or
AI_LIMITS_PGDATA (a pgserver data directory); skipped otherwise. Example:
  AI_LIMITS_PGDATA=<scratch>/pgdata AI_LIMITS_PG_TEMPLATE=prodbase \\
  <venv>/bin/python -m pytest ai_service/tests/test_limits_gates_pg.py -q -p no:cacheprovider -o asyncio_mode=auto
"""
from __future__ import annotations

import os
import re
import sys
import uuid
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from fastapi import Depends, FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from ai_service.app import dependencies as deps  # noqa: E402
from ai_service.app.config import get_settings  # noqa: E402
from ai_service.app.db import db_dependency  # noqa: E402
from ai_service.app.schemas.credits import CreditCheckRequest, CreditDeductRequest  # noqa: E402
from ai_service.app.services.credit_service import CreditService  # noqa: E402
from ai_service.app.services.metering import cache as mcache  # noqa: E402
from ai_service.app.services.metering import limit_gate as G  # noqa: E402
from ai_service.app.services.metering import limits as L  # noqa: E402
from ai_service.app.services.metering import service as msvc  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parents[2] / "admin_core_service/src/main/resources/db/migration"
TOKEN = "svc-secret"
LIMITED = f"lim-{uuid.uuid4().hex[:8]}"
FREE = f"free-{uuid.uuid4().hex[:8]}"
MODEL = "z-ai/glm-5.3-flash"
LIMIT_SQL = re.compile(r"ai_usage_counter|ai_usage_limit|institute_ai_limits_policy|ai_usage_reservation")

STUBS = """
CREATE TABLE IF NOT EXISTS institute_credits (id VARCHAR(64) PRIMARY KEY, institute_id VARCHAR(64) UNIQUE,
  total_credits NUMERIC, used_credits NUMERIC, current_balance NUMERIC, low_balance_threshold NUMERIC,
  created_at TIMESTAMP, updated_at TIMESTAMP);
CREATE TABLE IF NOT EXISTS credit_transactions (id UUID PRIMARY KEY, institute_id VARCHAR(64),
  transaction_type VARCHAR(32), amount NUMERIC, balance_after NUMERIC, description TEXT, reference_id VARCHAR(64),
  request_type VARCHAR(64), model_name VARCHAR(128), batch_id VARCHAR(255), external_reference_id VARCHAR(255),
  user_id VARCHAR(255), user_role VARCHAR(64), subject_user_id VARCHAR(255), created_at TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ct_ext ON credit_transactions(external_reference_id)
  WHERE external_reference_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS ai_token_usage (id UUID PRIMARY KEY, institute_id VARCHAR(64), credits_used NUMERIC);
"""


def _server_url():
    url = os.environ.get("AI_LIMITS_PG_URL")
    if url:
        return url
    data = os.environ.get("AI_LIMITS_PGDATA")
    if not data:
        return None
    try:
        import pgserver  # noqa: PLC0415

        uri = pgserver.get_server(data, cleanup_mode=None).get_uri()
    except Exception:  # noqa: BLE001
        return None
    return uri.replace("postgresql://", "postgresql+psycopg://", 1)


def _migration(prefix: str) -> str:
    hits = sorted(MIGRATIONS.glob(f"{prefix}__*.sql"))
    if not hits:
        pytest.skip(f"{prefix} migration not in this checkout")
    return hits[0].read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def pg():
    base = _server_url()
    if not base:
        pytest.skip("no Postgres: set AI_LIMITS_PG_URL or AI_LIMITS_PGDATA")
    try:
        import psycopg  # noqa: F401,PLC0415
    except Exception:  # noqa: BLE001
        pytest.skip("psycopg 3 not installed")
    name = f"gates_{uuid.uuid4().hex[:10]}"
    template = os.environ.get("AI_LIMITS_PG_TEMPLATE")
    admin = create_engine(base, isolation_level="AUTOCOMMIT", future=True)
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"' + (f' TEMPLATE "{template}"' if template else "")))
    url = base.replace("/postgres?", f"/{name}?") if "/postgres?" in base else base.rsplit("/", 1)[0] + f"/{name}"
    engine = create_engine(url, pool_size=10, max_overflow=5, future=True)
    if not template:
        with engine.begin() as c:
            c.exec_driver_sql(STUBS)
    for prefix in ("V586", "V587"):
        with engine.begin() as c:      # one transaction, like Flyway
            c.exec_driver_sql(_migration(prefix))
    statements: list = []

    @event.listens_for(engine, "before_cursor_execute")
    def _trace(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    engine.statements = statements  # type: ignore[attr-defined]
    engine.has_pricing = bool(template)  # type: ignore[attr-defined]
    yield engine
    engine.dispose()
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


@pytest.fixture(autouse=True)
def _isolate(monkeypatch, pg):
    L.reset_for_tests()
    mcache.reset_cache()
    settings = {"metering.events.enabled": True, "metering.limits.enforce": True}
    monkeypatch.setattr(mcache, "setting_value", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(mcache, "peek_setting", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(L, "_maybe_refresh_index", lambda: None)
    monkeypatch.setattr(CreditService, "_check_and_create_alerts", lambda self, *a, **k: None)
    if not pg.has_pricing:
        monkeypatch.setattr(CreditService, "calculate_credits", lambda self, **kw: Decimal("1.2345"))
    monkeypatch.setattr(get_settings(), "internal_service_token", TOKEN)
    yield settings
    msvc.wait_for_background()
    L.reset_for_tests()
    mcache.reset_cache()


def _session(pg):
    return sessionmaker(bind=pg, future=True, expire_on_commit=False)()


def _deduct(pg, inst, i, **kw):
    fields = dict(institute_id=inst, request_type="conversation", model=MODEL, prompt_tokens=4000 + i,
                  completion_tokens=1500, user_id="11111111-2222-3333-4444-555555555555", user_role="STUDENT",
                  batch_id=f"b-{inst}", idempotency_key=f"k-{inst}-{i}", use_case="tutor_chat",
                  surface="LEARNER_APP", actor_kind="USER")
    fields.update(kw)
    s = _session(pg)
    try:
        return CreditService(s).deduct_credits(CreditDeductRequest(**fields))
    finally:
        s.close()


def _policy(pg, inst, mode, hard):
    with pg.begin() as c:
        c.execute(text("INSERT INTO institute_ai_limits_policy (institute_id, mode, tenant_may_enforce) "
                       "VALUES (:i, :m, true) ON CONFLICT (institute_id) DO UPDATE SET mode = EXCLUDED.mode"),
                  {"i": inst, "m": mode})
        c.execute(text("INSERT INTO ai_usage_limit (institute_id, subject_kind, scope_kind, period, metric, "
                       "hard_limit, origin, created_by, effective_from) VALUES (:i, 'INSTITUTE', 'ALL', 'DAY', "
                       "'CREDITS', :h, 'TENANT', 'test', now() - interval '1 day')"), {"i": inst, "h": hard})
    L.refresh_policy_index(_session(pg))   # the real bulk index query, on Postgres
    L.invalidate(inst)


def _app(pg, inst):
    app = FastAPI()
    for t in G.limit_exceeded_types():
        app.add_exception_handler(t, G.limit_exceeded_handler)
    app.add_middleware(G.LimitHeadersMiddleware)

    @app.get("/op")
    def op(_c=Depends(deps.require_credits("conversation", estimated_tokens=100))):
        return {"ok": True}

    def _db():
        s = _session(pg)
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[db_dependency] = _db
    app.dependency_overrides[deps.get_institute_from_api_key] = lambda: inst
    return TestClient(app)


def test_real_charges_feed_counters_and_the_next_gate_blocks(pg):
    # 1. No policy anywhere: today's path, not one limits statement.
    pg.statements.clear()
    first = _deduct(pg, FREE, 0)
    assert first.success and first.credits_deducted > 0
    s = _session(pg)
    try:
        assert CreditService(s).check_credits(CreditCheckRequest(
            institute_id=FREE, request_type="conversation", model=MODEL, estimated_tokens=100)).has_sufficient_credits
    finally:
        s.close()
    assert [x for x in pg.statements if LIMIT_SQL.search(x)] == []

    # 2. ENFORCE, a daily hard cap a little above two charges.
    per = first.credits_deducted
    hard = (per * Decimal("2.5")).quantize(Decimal("0.0001"))
    _policy(pg, LIMITED, "ENFORCE", hard)
    r1, r2, r3 = (_deduct(pg, LIMITED, i) for i in range(3))
    assert r1.success and r2.success and r3.success   # post-call never blocks: the work is done
    with pg.connect() as c:
        evs = c.execute(text("SELECT list_credits, limit_decision FROM ai_usage_event WHERE institute_id = :i "
                             "ORDER BY occurred_at"), {"i": LIMITED}).all()
        cnt = c.execute(text("SELECT credits_used, count_used FROM ai_usage_counter WHERE institute_id = :i "
                             "AND counter_key = 'I|ALL' AND period = 'DAY'"), {"i": LIMITED}).one()
        ledger = c.execute(text("SELECT COALESCE(SUM(-amount), 0) FROM credit_transactions WHERE institute_id = :i "
                                "AND transaction_type = 'USAGE_DEDUCTION'"), {"i": LIMITED}).scalar()
    assert [e[1] for e in evs] == ["OK", "OK", "OVERRUN"]
    assert Decimal(cnt[0]) == sum(Decimal(e[0]) for e in evs) == Decimal(ledger)
    assert Decimal(cnt[1]) == 3

    # 3. The next check refuses; over HTTP that is a 429 with the N3 body.
    s = _session(pg)
    try:
        with pytest.raises(L.LimitExceeded) as ei:
            CreditService(s).check_credits(CreditCheckRequest(
                institute_id=LIMITED, request_type="conversation", model=MODEL, estimated_tokens=100))
        assert ei.value.body["error"] == "AI_USAGE_LIMIT" and ei.value.body["scope"] == "INSTITUTE"
    finally:
        s.close()
    r = _app(pg, LIMITED).get("/op")
    assert r.status_code == 429 and r.json()["use_case"] == "tutor_chat"
    assert int(r.headers["retry-after"]) > 0 and r.json()["resets_at"].endswith("+05:30")
    assert _app(pg, FREE).get("/op").status_code == 200

    # 4. A refund takes its credits back; the rebuild agrees with the live counter.
    s = _session(pg)
    try:
        CreditService(s).refund_credits(LIMITED, per, "AI video shot 1 refund: test", batch_id=f"b-{LIMITED}")
    finally:
        s.close()
    msvc.wait_for_background()
    with pg.connect() as c:
        live = Decimal(c.execute(text("SELECT credits_used FROM ai_usage_counter WHERE institute_id = :i "
                                      "AND counter_key = 'I|ALL' AND period = 'DAY'"), {"i": LIMITED}).scalar())
    assert live == Decimal(cnt[0]) - per
    s = _session(pg)
    try:
        L.rebuild_counters(s, days=35, institute_id=LIMITED)
        s.commit()
    finally:
        s.close()
    with pg.connect() as c:
        rebuilt = Decimal(c.execute(text("SELECT credits_used FROM ai_usage_counter WHERE institute_id = :i "
                                         "AND counter_key = 'I|ALL' AND period = 'DAY'"), {"i": LIMITED}).scalar())
    assert rebuilt == live


def test_internal_authorize_on_postgres(pg):
    from ai_service.app.routers import metering_internal

    app = FastAPI()
    app.include_router(metering_internal.router, prefix="/ai-service")

    def _db():
        s = _session(pg)
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[db_dependency] = _db
    L.refresh_policy_index(_session(pg))
    c = TestClient(app)
    h = {"X-Internal-Service-Token": TOKEN}
    blocked = c.post("/ai-service/internal/metering/v1/authorize",
                     json={"institute_id": LIMITED, "use_case": "tutor_chat", "estimate_credits": 1000}, headers=h).json()
    assert blocked["allow"] is False and blocked["block"]["error"] == "AI_USAGE_LIMIT"
    free = c.post("/ai-service/internal/metering/v1/authorize",
                  json={"institute_id": FREE, "use_case": "tutor_chat"}, headers=h).json()
    assert free == {"allow": True, "decision": "NONE", "warnings": [], "block": None, "reservation_id": None}
    rep = c.post("/ai-service/internal/metering/v1/counters/rebuild?days=35", headers=h)
    assert rep.status_code == 200
