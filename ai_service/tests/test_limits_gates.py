"""Usage limits wired into the existing gates (contract N3/N4, unit L2b):
CreditService.check_credits, require_credits, check_video_tier_credits,
preflight_tool_credits, the tutor live-minute gate + socket frame,
internal_llm /complete and the bridge, the post-commit metering counter hook
(charged, dropped, refund), the internal authorize / rebuild endpoints and the
app-level 429 handler + X-AI-Usage-Warning header.

Real limits engine (metering/limits.py) on a file SQLite database with real
SAVEPOINTs; the Postgres run is test_limits_gates_pg.py.

What must hold:
  * NO policy (every institute after deploy): every gate does exactly what it
    did before — the engine is never called, no limits table is touched, the
    402 bodies are unchanged;
  * ENFORCE + hard limit: HTTP 429 with the N3 body and Retry-After;
  * SHADOW: allowed, the usage event says WOULD_BLOCK;
  * soft limit: X-AI-Usage-Warning on the successful response;
  * the counter hook counts list_credits, marks OVERRUN, takes refunds back;
  * internal authorize: 401 without the token, always 200 JSON with it.

Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_limits_gates.py -q -p no:cacheprovider -o asyncio_mode=auto
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from fastapi import Depends, FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import MetaData, create_engine, event, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from ai_service.app import dependencies as deps  # noqa: E402
from ai_service.app.config import get_settings  # noqa: E402
from ai_service.app.db import db_dependency  # noqa: E402
from ai_service.app.schemas.credits import CreditCheckRequest, CreditDeductRequest  # noqa: E402
from ai_service.app.services import ai_billing  # noqa: E402
from ai_service.app.services.credit_service import CreditService  # noqa: E402
from ai_service.app.services.metering import cache as mcache  # noqa: E402
from ai_service.app.services.metering import limit_gate as G  # noqa: E402
from ai_service.app.services.metering import limits as L  # noqa: E402
from ai_service.app.services.metering import service as msvc  # noqa: E402
from ai_service.app.services.metering.limit_models import LimitsBase  # noqa: E402
from ai_service.app.services.metering.models import Base as MeteringBase  # noqa: E402

sqlite3.register_adapter(Decimal, str)

INST = "inst-gate"
OTHER = "inst-free"
PRICE = Decimal("1.2345")
UTC = timezone.utc
TOKEN = "svc-secret"

LEGACY_DDL = [
    """CREATE TABLE institute_credits (
        id TEXT PRIMARY KEY, institute_id TEXT UNIQUE, total_credits NUMERIC, used_credits NUMERIC,
        current_balance NUMERIC, low_balance_threshold NUMERIC, created_at TIMESTAMP, updated_at TIMESTAMP)""",
    """CREATE TABLE credit_transactions (
        id TEXT PRIMARY KEY, institute_id TEXT, transaction_type TEXT, amount NUMERIC, balance_after NUMERIC,
        description TEXT, reference_id TEXT, request_type TEXT, model_name TEXT, batch_id TEXT,
        external_reference_id TEXT, user_id TEXT, user_role TEXT, subject_user_id TEXT, granted_by TEXT,
        created_at TIMESTAMP, usage_event_id TEXT, use_case TEXT)""",
    "CREATE UNIQUE INDEX ux_ct_ext ON credit_transactions(external_reference_id) WHERE external_reference_id IS NOT NULL",
    """CREATE TABLE ai_token_usage (
        id TEXT PRIMARY KEY, institute_id TEXT, model TEXT, request_type TEXT, total_price NUMERIC,
        credits_used NUMERIC, usage_event_id TEXT, router TEXT, gateway_key_id TEXT)""",
]

CATALOG = [
    # use_case, group, label, count unit, request types, tool keys, reserve
    ("tutor_chat", "tutor", "AI tutor chat", "messages", ["conversation"], [], False),
    ("tutor_live", "tutor", "AI tutor session (minutes)", "minutes", [], ["tutor_live_minute"], False),
    ("content", "content", "Course content", "requests", ["content"], ["html_document"], False),
    ("lesson_video", "video", "Lesson video", "videos", ["video"], [], True),
    ("questions", "assessment", "Question generation", "requests", ["assessment"], [], False),
    ("unknown", "platform", "Other AI usage", "requests", [], [], False),
]

LIMIT_TABLES_RE = re.compile(r"ai_usage_counter|ai_usage_limit|institute_ai_limits_policy|ai_usage_reservation")


def _stripped(base):
    md = MetaData()
    for table in base.metadata.tables.values():
        t = table.to_metadata(md)
        for c in t.columns:
            c.server_default = None
    return md


_CREATED: list = []


class Db:
    def __init__(self):
        fd, self.path = tempfile.mkstemp(suffix=".sqlite3", prefix="limits-gates-")
        os.close(fd)
        _CREATED.append(self)
        self.engine = create_engine(f"sqlite:///{self.path}", connect_args={"check_same_thread": False, "timeout": 10})
        self.statements: list = []

        @event.listens_for(self.engine, "connect")
        def _connect(dbapi_conn, _rec):
            dbapi_conn.isolation_level = None

        @event.listens_for(self.engine, "begin")
        def _begin(conn):
            conn.exec_driver_sql("BEGIN")

        @event.listens_for(self.engine, "before_cursor_execute")
        def _trace(conn, cursor, statement, params, context, executemany):
            self.statements.append(statement)

        with self.engine.begin() as c:
            for ddl in LEGACY_DDL:
                c.execute(text(ddl))
        _stripped(MeteringBase).create_all(self.engine)
        _stripped(LimitsBase).create_all(self.engine)
        with self.engine.begin() as c:
            for i, (uc, fg, label, unit, rts, tks, res) in enumerate(CATALOG):
                c.execute(text(
                    "INSERT INTO ai_use_case_catalog (use_case, feature_group, label, count_unit_label, "
                    "legacy_request_types, tool_keys, default_surface, actor_kind, unit_kind, billing_policy, "
                    "plan_eligible, limit_eligible, reserve_on_authorize, intentionally_separate, is_active, "
                    "display_order) VALUES (:u, :f, :l, :cu, :r, :k, 'UNKNOWN', 'USER', 'TOKENS', 'AS_TODAY', 1, 1, "
                    ":res, 0, 1, :o)"),
                    {"u": uc, "f": fg, "l": label, "cu": unit, "r": json.dumps(rts), "k": json.dumps(tks),
                     "res": 1 if res else 0, "o": i * 10})
            for inst in (INST, OTHER):
                c.execute(text("INSERT INTO institute_credits VALUES (:id, :i, 500, 0, 500, 10, :n, :n)"),
                          {"id": f"c-{inst}", "i": inst, "n": datetime.now(UTC)})
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def exec(self, sql, **params):
        with self.engine.begin() as c:
            c.execute(text(sql), params)

    def all(self, sql, **params):
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(text(sql), params).mappings().all()]

    def one(self, sql, **params):
        rows = self.all(sql, **params)
        return rows[0] if rows else None

    def policy(self, mode="ENFORCE", inst=INST, show=True):
        # show=True: these tests read the numbers; test_numbers_hidden_* cover show=False.
        self.exec("DELETE FROM institute_ai_limits_policy WHERE institute_id = :i", i=inst)
        self.exec("INSERT INTO institute_ai_limits_policy (institute_id, mode, tenant_may_enforce, timezone, "
                  "notify_admins_on_soft, show_numbers_to_learners, updated_at) VALUES (:i, :m, 1, "
                  "'Asia/Kolkata', 1, :sh, :n)", i=inst, m=mode, sh=1 if show else 0, n=datetime.now(UTC))
        L.invalidate(inst, active=mode in ("SHADOW", "ENFORCE"))

    def row(self, subject_kind="INSTITUTE", subject_value=None, *, scope_kind="ALL", scope_value=None,
            period="DAY", metric="CREDITS", soft=None, hard=None, inst=INST):
        rid = str(uuid.uuid4())
        self.exec("INSERT INTO ai_usage_limit (id, institute_id, subject_kind, subject_value, per_member, scope_kind, "
                  "scope_value, period, metric, soft_limit, hard_limit, origin, locked, effective_from, is_active, "
                  "created_by, created_at, updated_at) VALUES (:id, :i, :sk, :sv, 1, :sck, :scv, :p, :m, :s, :h, "
                  "'TENANT', 0, :ef, 1, 'test', :n, :n)",
                  id=rid, i=inst, sk=subject_kind, sv=subject_value, sck=scope_kind, scv=scope_value, p=period,
                  m=metric, s=soft, h=hard, ef=datetime.now(UTC) - timedelta(days=400), n=datetime.now(UTC))
        L.invalidate(inst)
        return rid

    def events(self):
        return self.all("SELECT * FROM ai_usage_event ORDER BY occurred_at, id")

    def counters(self, inst=INST):
        return self.all("SELECT counter_key, period, credits_used, count_used FROM ai_usage_counter "
                        "WHERE institute_id = :i ORDER BY counter_key, period", i=inst)

    def balance(self, inst=INST):
        return Decimal(str(self.one("SELECT current_balance FROM institute_credits WHERE institute_id = :i",
                                    i=inst)["current_balance"]))

    def limit_statements(self):
        return [s for s in self.statements if LIMIT_TABLES_RE.search(s)]


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    L.reset_for_tests()
    mcache.reset_cache()
    msvc._last_log.clear()
    settings = {"metering.events.enabled": True, "metering.limits.enforce": True}
    monkeypatch.setattr(mcache, "setting_value", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(mcache, "peek_setting", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(L, "_maybe_refresh_index", lambda: None)
    monkeypatch.setattr(CreditService, "calculate_credits", lambda self, **kw: PRICE)
    monkeypatch.setattr(CreditService, "_check_and_create_alerts", lambda self, *a, **k: None)
    monkeypatch.setattr(get_settings(), "internal_service_token", TOKEN)
    yield settings
    msvc.wait_for_background()
    L.reset_for_tests()
    mcache.reset_cache()
    while _CREATED:
        d = _CREATED.pop()
        d.engine.dispose()
        try:
            os.unlink(d.path)
        except OSError:
            pass


@pytest.fixture
def db():
    return Db()


@pytest.fixture
def no_engine_calls(monkeypatch):
    """Fail loudly if anything past has_policy is reached."""
    def boom(*a, **k):
        raise AssertionError("limits engine called for an institute without a policy")

    for name in ("authorize", "apply_event_to_counters", "decrement_for_refund", "get_policy",
                 "settle_reservation", "release_reservation"):
        monkeypatch.setattr(L, name, boom)


def _check(d, inst=INST, **kw):
    s = d.Session()
    try:
        return CreditService(s).check_credits(CreditCheckRequest(institute_id=inst, request_type="conversation",
                                                                 model="m", estimated_tokens=100, **kw))
    finally:
        s.close()


def _deduct(d, inst=INST, **kw):
    fields = dict(institute_id=inst, request_type="conversation", model="glm", prompt_tokens=100,
                  completion_tokens=50, user_id="u1", user_role="TEACHER", actor_kind="USER",
                  actor_user_id="u1", actor_roles_raw=["TEACHER"], actor_role_class="TEACHER", role_source="JWT")
    fields.update(kw)
    s = d.Session()
    try:
        return CreditService(s).deduct_credits(CreditDeductRequest(**fields))
    finally:
        s.close()


TEACHER = {"actor_kind": "USER", "actor_user_id": "u1", "actor_roles_raw": ["TEACHER"], "actor_role_class": "TEACHER",
           "role_source": "JWT"}


# ── 1. no policy: every gate is today's ──────────────────────────────────────

def test_no_policy_check_credits_and_charge_touch_no_limits(db, no_engine_calls):
    db.statements.clear()
    ok = _check(db)
    assert ok.has_sufficient_credits and ok.estimated_cost == PRICE
    assert ok.message == f"Sufficient credits available. Estimated cost: {PRICE}"
    db.exec("UPDATE institute_credits SET current_balance = 1 WHERE institute_id = :i", i=INST)
    short = _check(db)
    assert not short.has_sufficient_credits
    assert short.message == f"Insufficient credits. Need {PRICE}, have 1"
    db.exec("UPDATE institute_credits SET current_balance = 500 WHERE institute_id = :i", i=INST)
    resp = _deduct(db, batch_id="b1")
    assert resp.success and resp.credits_deducted == PRICE
    s = db.Session()
    try:
        CreditService(s).refund_credits(INST, Decimal("1"), "AI video shot 1 refund: x", batch_id="b1")
    finally:
        s.close()
    msvc.wait_for_background()
    (ev,) = db.events()
    assert ev["limit_decision"] == "NONE"
    assert db.limit_statements() == []
    assert G.stats().get("authorized", 0) == 0


def test_no_policy_video_and_tool_preflight_unchanged(db, no_engine_calls, monkeypatch):
    db.statements.clear()
    s = db.Session()
    try:
        out = CreditService(s).check_video_tier_credits(INST, "ultra")
        assert out.has_sufficient_credits and out.estimated_cost == Decimal("30.0000")
    finally:
        s.close()
    from ai_service.app.services import tool_cost_estimator as tce

    est = {"tool_key": "html_document", "estimated_credits": 3.0, "current_balance": 500.0,
           "balance_after": 497.0, "sufficient": True}
    monkeypatch.setattr(tce.ToolCostEstimator, "estimate_with_balance", lambda self, *a, **k: dict(est))
    s = db.Session()
    try:
        assert ai_billing.preflight_tool_credits(s, tool_key="html_document", tool_params={},
                                                 institute_id=INST) == est
    finally:
        s.close()
    assert db.limit_statements() == []


def test_no_policy_statements_identical_to_no_limits_module(db, monkeypatch):
    """The SQL a check + charge issues with the gate in place equals the SQL
    with the limits module made unimportable (= the code before L2b)."""
    def run():
        db.statements.clear()
        _check(db)
        _deduct(db, idempotency_key=str(uuid.uuid4()))
        msvc.wait_for_background()
        return [re.sub(r"'[^']*'", "?", s_) for s_ in db.statements]

    run()                          # warm the metering lookups once
    with_gate = run()
    monkeypatch.setattr(G, "_limits", lambda: None)
    without = run()
    assert with_gate == without


def test_other_institute_unaffected_when_one_has_a_policy(db, monkeypatch):
    db.policy("ENFORCE")
    db.row(hard=0)
    calls = []
    real = L.authorize
    monkeypatch.setattr(L, "authorize", lambda *a, **k: calls.append(k.get("institute_id")) or real(*a, **k))
    assert _check(db, inst=OTHER).has_sufficient_credits
    assert calls == []
    with pytest.raises(L.LimitExceeded):
        _check(db)
    assert calls == [INST]


# ── 2. HTTP: require_credits -> 429 / warning header / 402 unchanged ─────────

def _app(d):
    app = FastAPI()
    for t in G.limit_exceeded_types():
        app.add_exception_handler(t, G.limit_exceeded_handler)
    app.add_middleware(G.LimitHeadersMiddleware)

    @app.get("/op")
    def op(_c=Depends(deps.require_credits("conversation", estimated_tokens=100))):
        return {"ok": True}

    @app.get("/tool")
    def tool(db=Depends(db_dependency)):
        est = ai_billing.preflight_tool_credits(db, tool_key="html_document", tool_params={}, institute_id=INST)
        return {"sufficient": est.get("sufficient")}

    def _db():
        s = d.Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[db_dependency] = _db
    app.dependency_overrides[deps.get_institute_from_api_key] = lambda: INST
    return app


def test_require_credits_no_policy_200_and_402_unchanged(db, no_engine_calls):
    c = TestClient(_app(db))
    r = c.get("/op")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert "x-ai-usage-warning" not in r.headers
    db.exec("UPDATE institute_credits SET current_balance = 0 WHERE institute_id = :i", i=INST)
    r = c.get("/op")
    assert r.status_code == 402 and r.json() == {"detail": f"Insufficient credits. Need {PRICE}, have 0"}


def test_require_credits_enforce_block_is_429_with_body_and_retry_after(db):
    db.policy("ENFORCE")
    db.row(hard=0)
    r = TestClient(_app(db)).get("/op")
    assert r.status_code == 429
    b = r.json()
    assert b["error"] == "AI_USAGE_LIMIT" and b["use_case"] == "tutor_chat" and b["use_case_label"] == "AI tutor chat"
    assert b["scope"] == "INSTITUTE" and b["period"] == "DAY" and b["limit"] == 0 and b["unit"] == "credits"
    assert b["set_by"] == "INSTITUTE" and b["resets_at"].endswith("T00:00:00+05:30") and b["message"]
    assert 0 < int(r.headers["retry-after"]) <= 86400


def test_insufficient_balance_stays_402_even_over_a_limit(db):
    db.policy("ENFORCE")
    db.row(hard=0)
    db.exec("UPDATE institute_credits SET current_balance = 0 WHERE institute_id = :i", i=INST)
    r = TestClient(_app(db)).get("/op")
    assert r.status_code == 402


def test_shadow_allows(db):
    db.policy("SHADOW")
    db.row(hard=0)
    r = TestClient(_app(db)).get("/op")
    assert r.status_code == 200


def test_global_enforce_off_allows(db, _isolate):
    db.policy("ENFORCE")
    db.row(hard=0)
    _isolate["metering.limits.enforce"] = False
    assert TestClient(_app(db)).get("/op").status_code == 200


def test_soft_limit_sets_warning_header(db):
    db.policy("ENFORCE")
    db.row(soft=1, hard=100)
    r = TestClient(_app(db)).get("/op")
    assert r.status_code == 200
    assert r.headers["x-ai-usage-warning"] == "tutor_chat;pct=1"


def test_warning_header_exposed_on_cors_responses(db):
    from fastapi.middleware.cors import CORSMiddleware

    db.policy("ENFORCE")
    db.row(soft=1, hard=100)
    app = _app(db)
    app.user_middleware.clear()
    app.add_middleware(CORSMiddleware, allow_origin_regex=".*", allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"], expose_headers=["Server-Timing"])
    app.add_middleware(G.LimitHeadersMiddleware)
    r = TestClient(app).get("/op", headers={"Origin": "https://dash.vacademy.io"})
    assert r.headers["x-ai-usage-warning"].startswith("tutor_chat;pct=")
    assert "X-AI-Usage-Warning" in r.headers["access-control-expose-headers"]
    db.row(hard=0, period="WEEK")
    r = TestClient(app).get("/op", headers={"Origin": "https://dash.vacademy.io"})
    assert r.status_code == 429 and "Retry-After" in r.headers["access-control-expose-headers"]


def test_preflight_tool_credits_enforce_429(db, monkeypatch):
    from ai_service.app.services import tool_cost_estimator as tce

    monkeypatch.setattr(tce.ToolCostEstimator, "estimate_with_balance",
                        lambda self, *a, **k: {"estimated_credits": 3.0, "current_balance": 500.0,
                                               "balance_after": 497.0, "sufficient": True})
    db.policy("ENFORCE")
    db.row(scope_kind="USE_CASE", scope_value="content", hard=2)
    r = TestClient(_app(db)).get("/tool")
    assert r.status_code == 429 and r.json()["use_case"] == "content"
    s = db.Session()
    try:  # enforce_limits=False: display-only estimates are never refused
        out = ai_billing.preflight_tool_credits(s, tool_key="html_document", tool_params={}, institute_id=INST,
                                                enforce_limits=False)
        assert out["sufficient"] is True
    finally:
        s.close()


def test_video_tier_check_blocks_and_never_leaves_a_reservation(db):
    db.policy("ENFORCE")
    db.row(scope_kind="USE_CASE", scope_value="lesson_video", hard=100)
    s = db.Session()
    try:
        ok = CreditService(s).check_video_tier_credits(INST, "ultra")  # floor 30 <= 100
        assert ok.has_sufficient_credits
    finally:
        s.close()
    assert db.all("SELECT * FROM ai_usage_reservation WHERE status = 'OPEN'") == []
    db.row(scope_kind="USE_CASE", scope_value="lesson_video", hard=10, period="MONTH")
    s = db.Session()
    try:
        with pytest.raises(L.LimitExceeded) as ei:
            CreditService(s).check_video_tier_credits(INST, "ultra")
        assert ei.value.body["use_case"] == "lesson_video"
    finally:
        s.close()


def test_limits_failure_fails_open(db, monkeypatch):
    db.policy("ENFORCE")
    db.row(hard=0)
    monkeypatch.setattr(L, "_authorize", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db down")))
    assert _check(db).has_sufficient_credits
    monkeypatch.setattr(G, "_limits", lambda: (_ for _ in ()).throw(RuntimeError("bug")))
    with pytest.raises(RuntimeError):
        G._limits()
    monkeypatch.setattr(G, "policy_active", lambda i: True)
    monkeypatch.setattr(G, "_limits", lambda: None)
    assert G.authorize(None, institute_id=INST) is None


# ── 3. post-commit counter hook ──────────────────────────────────────────────

def test_charge_counts_list_credits_and_shadow_marks_would_block(db):
    db.policy("SHADOW")
    db.row(hard=1)
    token = G.bind_state()
    try:
        _check(db)                 # OK: 0 + 1.2345 > 1 -> estimate overshoot -> WOULD_BLOCK
        _deduct(db)
    finally:
        G.reset_state(token)
    (ev,) = db.events()
    assert ev["limit_decision"] == "WOULD_BLOCK"
    (cnt,) = db.counters()
    assert cnt["counter_key"] == "I|ALL" and Decimal(str(cnt["credits_used"])) == PRICE
    assert Decimal(str(cnt["count_used"])) == 1


def test_overrun_then_next_authorize_blocks(db):
    db.policy("ENFORCE")
    db.row(hard=2)
    _deduct(db)
    _deduct(db)                    # 2.469 > 2: this event pushed it over
    first, second = db.events()
    assert first["limit_decision"] == "OK" and second["limit_decision"] == "OVERRUN"
    with pytest.raises(L.LimitExceeded) as ei:
        _check(db)
    assert ei.value.body["used"] == pytest.approx(float(PRICE * 2))


def test_dropped_charge_is_counted_in_the_background(db):
    db.policy("ENFORCE")
    db.row(hard=100)
    db.exec("UPDATE institute_credits SET current_balance = 0 WHERE institute_id = :i", i=INST)
    resp = _deduct(db)
    assert not resp.success
    msvc.wait_for_background()
    (ev,) = db.events()
    assert ev["charge_status"] == "DROPPED_INSUFFICIENT" and ev["limit_decision"] == "OK"
    assert Decimal(str(db.counters()[0]["credits_used"])) == PRICE


def test_refund_decrements_counters(db):
    db.policy("ENFORCE")
    db.row(hard=100)
    _deduct(db, batch_id="vid-1", description="AI video shot 1 (5s, audio)")
    s = db.Session()
    try:
        CreditService(s).refund_credits(INST, Decimal("1"), "AI video shot 1 refund: failed", batch_id="vid-1")
    finally:
        s.close()
    msvc.wait_for_background()
    (cnt,) = db.counters()
    assert float(cnt["credits_used"]) == pytest.approx(float(PRICE - 1))
    s = db.Session()
    try:   # the rest of the charge: fully refunded -> count comes off too
        CreditService(s).refund_credits(INST, PRICE - 1, "AI video shot 1 refund: rest", batch_id="vid-1")
    finally:
        s.close()
    msvc.wait_for_background()
    (cnt,) = db.counters()
    assert float(cnt["credits_used"]) == pytest.approx(0) and Decimal(str(cnt["count_used"])) == 0


def test_counter_failure_keeps_charge_and_event(db, monkeypatch):
    db.policy("ENFORCE")
    db.row(hard=100)

    def broken(dbs, row):
        dbs.execute(text("SELECT * FROM no_such_table"))

    monkeypatch.setattr(L, "apply_event_to_counters", broken)
    resp = _deduct(db)
    assert resp.success
    (ev,) = db.events()
    assert ev["ledger_tx_id"] and ev["limit_decision"] == "NONE"
    assert msvc.stats()["limits_failed"] >= 1


def test_upgraded_free_event_is_not_counted_twice(db):
    db.policy("ENFORCE")
    db.row(hard=100)
    usage_id = str(uuid.uuid4())
    db.exec("INSERT INTO ai_token_usage (id, institute_id, model, request_type) VALUES (:u, :i, 'glm', 'conversation')",
            u=usage_id, i=INST)
    s = db.Session()
    try:
        msvc.write_free_event(s, msvc.EventInput(institute_id=INST, request_type="conversation", model="glm",
                                                 prompt_tokens=10, actor_user_id="u1", actor_kind="USER",
                                                 actor_roles_raw=["TEACHER"]),
                              usage_log_id=usage_id)
        s.commit()
    finally:
        s.close()
    assert Decimal(str(db.counters()[0]["count_used"])) == 1
    _deduct(db, usage_log_id=usage_id)     # upgrades that event to CHARGED
    (ev,) = db.events()
    assert ev["billing_mode"] == "CHARGED"
    (cnt,) = db.counters()
    assert Decimal(str(cnt["credits_used"])) == PRICE and Decimal(str(cnt["count_used"])) == 1


# ── 4. internal endpoints ────────────────────────────────────────────────────

def _internal_app(d):
    from ai_service.app.routers import metering_internal

    app = FastAPI()
    app.include_router(metering_internal.router, prefix="/ai-service")

    def _db():
        s = d.Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[db_dependency] = _db
    return TestClient(app)


AUTH_URL = "/ai-service/internal/metering/v1/authorize"


def test_internal_authorize_requires_token(db):
    c = _internal_app(db)
    assert c.post(AUTH_URL, json={"institute_id": INST}).status_code == 401
    assert c.post("/ai-service/internal/metering/v1/counters/rebuild").status_code == 401


def test_internal_authorize_no_policy_is_none_without_engine(db, no_engine_calls):
    r = _internal_app(db).post(AUTH_URL, json={"institute_id": INST, "use_case": "tutor_chat"},
                               headers={"X-Internal-Service-Token": TOKEN})
    assert r.status_code == 200
    assert r.json() == {"allow": True, "decision": "NONE", "warnings": [], "block": None, "reservation_id": None}


def test_internal_authorize_block_is_200_json(db):
    db.policy("ENFORCE")
    db.row("USER", "u1", hard=0)
    c = _internal_app(db)
    r = c.post(AUTH_URL, json={"institute_id": INST, "use_case": "tutor_chat", "user_id": "u1",
                               "actor_roles_raw": ["TEACHER"]}, headers={"X-Internal-Service-Token": TOKEN})
    assert r.status_code == 200
    b = r.json()
    assert b["allow"] is False and b["decision"] == "BLOCK" and b["block"]["error"] == "AI_USAGE_LIMIT"
    assert b["block"]["scope"] == "USER"
    # a SYSTEM actor (no user) does not meet a USER row
    r = c.post(AUTH_URL, json={"institute_id": INST, "use_case": "tutor_chat"},
               headers={"X-Internal-Service-Token": TOKEN})
    assert r.json()["allow"] is True


def test_internal_authorize_reservation_only_when_asked(db):
    db.policy("ENFORCE")
    db.row(scope_kind="USE_CASE", scope_value="lesson_video", hard=100)
    c = _internal_app(db)
    h = {"X-Internal-Service-Token": TOKEN}
    r = c.post(AUTH_URL, json={"institute_id": INST, "use_case": "lesson_video", "estimate_credits": 10}, headers=h)
    assert r.json()["reservation_id"] is None
    assert db.all("SELECT * FROM ai_usage_reservation WHERE status = 'OPEN'") == []
    r = c.post(AUTH_URL, json={"institute_id": INST, "use_case": "lesson_video", "estimate_credits": 10,
                               "reserve": True}, headers=h)
    rid = r.json()["reservation_id"]
    assert rid and len(db.all("SELECT * FROM ai_usage_reservation WHERE status = 'OPEN'")) == 1
    # the charge carries it in usage_context -> settled by the counter hook
    _deduct(db, request_type="video", use_case="lesson_video", usage_context={"reservation_id": rid})
    assert db.one("SELECT status FROM ai_usage_reservation WHERE id = :r", r=rid)["status"] == "SETTLED"


def test_internal_authorize_engine_failure_allows(db, monkeypatch):
    db.policy("ENFORCE")
    monkeypatch.setattr(G, "authorize", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("bug")))
    r = _internal_app(db).post(AUTH_URL, json={"institute_id": INST}, headers={"X-Internal-Service-Token": TOKEN})
    assert r.status_code == 200 and r.json()["allow"] is True


def test_internal_rebuild(db):
    db.policy("ENFORCE")
    db.row(hard=100)
    _deduct(db)
    db.exec("UPDATE ai_usage_counter SET credits_used = 99")
    r = _internal_app(db).post("/ai-service/internal/metering/v1/counters/rebuild?days=35",
                               headers={"X-Internal-Service-Token": TOKEN})
    assert r.status_code == 200 and isinstance(r.json(), dict)
    # SQLite does the correction in float (99 + (1.2345 - 99)); Postgres NUMERIC is exact.
    assert float(db.counters()[0]["credits_used"]) == pytest.approx(float(PRICE))


# ── 5. internal_llm /complete and the bridge ─────────────────────────────────

def _llm_app(d, monkeypatch):
    from ai_service.app.routers import internal_llm
    from ai_service.app.services import llm_router

    class R:
        content, model, usage, router, finish_reason = "hi", "z-ai/glm", {}, "isoquant", "stop"

    async def fake_chain(payload, **kw):
        return R()

    monkeypatch.setattr(llm_router, "chat_with_chain", fake_chain)
    app = FastAPI()
    for t in G.limit_exceeded_types():
        app.add_exception_handler(t, G.limit_exceeded_handler)
    app.include_router(internal_llm.router, prefix="/ai-service")

    def _db():
        s = d.Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[db_dependency] = _db
    return TestClient(app)


COMPLETE = "/ai-service/internal/llm/v1/complete"
BODY = {"use_case": "evaluation", "messages": [{"role": "user", "content": "x"}], "institute_id": INST}


def test_internal_complete_no_policy_unchanged(db, monkeypatch, no_engine_calls):
    r = _llm_app(db, monkeypatch).post(COMPLETE, json=BODY, headers={"X-Internal-Service-Token": TOKEN})
    assert r.status_code == 200 and r.json()["content"] == "hi"


def test_internal_complete_block_is_429_ai_usage_limit(db, monkeypatch):
    db.policy("ENFORCE")
    db.row(hard=0)
    r = _llm_app(db, monkeypatch).post(COMPLETE, json=BODY, headers={"X-Internal-Service-Token": TOKEN})
    assert r.status_code == 429 and r.json()["error"] == "AI_USAGE_LIMIT" and "retry-after" in r.headers


def test_bridge_never_refuses(db, monkeypatch):
    """admin_core fails a 4xx/429 bridge reply over to OpenRouter and cools the
    gateway down for everyone: the bridge only observes."""
    import httpx

    from ai_service.app.routers import internal_llm
    from ai_service.app.services import llm_router

    db.policy("ENFORCE")
    db.row(hard=0)
    monkeypatch.setattr("ai_service.app.db.db_session", _session_cm(db))

    async def fake_post(client, payload, **kw):
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]},
                              request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))

    monkeypatch.setattr(llm_router, "post_chat", fake_post)
    seen = []
    real = G.authorize
    monkeypatch.setattr(G, "authorize", lambda *a, **k: seen.append(k.get("enforce")) or real(*a, **k))
    c = _llm_app(db, monkeypatch)
    r = c.post("/ai-service/internal/llm/v1/chat/completions",
               json={"model": "anthropic/claude-sonnet-4.5", "messages": [{"role": "user", "content": "x"}],
                     "institute_id": INST, "use_case": "admin_agent"},
               headers={"X-Internal-Service-Token": TOKEN})
    assert r.status_code == 200 and seen == [False]
    assert internal_llm  # imported for the route


def _session_cm(d):
    from contextlib import contextmanager

    @contextmanager
    def cm():
        s = d.Session()
        try:
            yield s
            s.commit()
        finally:
            s.close()

    return cm


# ── 6. tutor live minutes + socket frame ─────────────────────────────────────

def test_tutor_minute_gate_no_policy_unchanged(monkeypatch, no_engine_calls):
    from ai_service.app.services.tutor.runtime import session_service as svc

    calls = []
    monkeypatch.setattr(svc, "record_tool_billing", lambda **k: calls.append(k))
    monkeypatch.setattr(svc, "bump_telemetry", lambda *a, **k: None)
    monkeypatch.setattr(svc, "preflight_tool_credits", lambda db, **k: calls.append(k) or {"sufficient": True})

    class _Cm:
        def __enter__(self):
            return object()

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(svc, "db_session", lambda: _Cm())
    assert svc.bill_live_minute(tutor_session_id="t1", institute_id=OTHER, user_id="u1", minute_no=1) is True
    assert "enforce_limits" not in calls[1]          # exactly today's call
    assert calls[0]["metering"].actor_roles_raw is None
    assert svc.usage_limit_frames("t1") is None
    assert svc.limit_roles_for("tok", OTHER) is None


def test_tutor_minute_gate_block_sends_usage_limit_frame(db, monkeypatch):
    from ai_service.app.services.tutor.runtime import session_service as svc

    db.policy("ENFORCE")
    db.row("ROLE_CLASS", "LEARNER", scope_kind="USE_CASE", scope_value="tutor_live", hard=2)
    monkeypatch.setattr(svc, "bump_telemetry", lambda *a, **k: None)
    monkeypatch.setattr(svc, "db_session", _session_cm(db))
    monkeypatch.setattr(svc, "preflight_tool_credits",
                        lambda dbs, **k: {"estimated_credits": 1.0, "sufficient": True, "current_balance": 9.0})

    def bill(**k):   # the real charge path for one minute (1 credit)
        _deduct(db, request_type="conversation", use_case="tutor_live", tool_key="tutor_live_minute",
                precomputed_credits=Decimal("1"), user_id="learner", user_role="STUDENT",
                actor_user_id="learner", actor_roles_raw=["STUDENT"], actor_role_class=None,
                idempotency_key=k["idempotency_key"])

    monkeypatch.setattr(svc, "record_tool_billing", bill)
    kw = dict(tutor_session_id="t-lim", institute_id=INST, user_id="learner", roles_raw=["STUDENT"])
    assert svc.bill_live_minute(minute_no=1, **kw) is True      # used 1, next 1 -> 2 > 2? no (= hard) ...
    assert svc.bill_live_minute(minute_no=2, **kw) is False     # used 2 >= hard 2 -> BLOCK
    frames = svc.usage_limit_frames("t-lim")
    assert frames[0]["type"] == "usage_limit" and frames[0]["error"] == "AI_USAGE_LIMIT"
    assert frames[0]["use_case"] == "tutor_live" and frames[0]["scope"] == "ROLE_CLASS"
    assert frames[1] == {"type": "ended", "reason": "usage_limit"}
    assert svc.usage_limit_frames("t-lim") is None              # once


def test_tutor_session_start_blocked_is_429(db, monkeypatch):
    from ai_service.app.services.tutor.runtime import session_service as svc

    db.policy("ENFORCE")
    db.row("USER", "learner", scope_kind="USE_CASE", scope_value="tutor_live", hard=0)
    monkeypatch.setattr(svc, "preflight_minutes", lambda db=None: 5)
    monkeypatch.setattr(svc, "preflight_tool_credits",
                        lambda dbs, **k: {"estimated_credits": 5.0, "sufficient": True, "current_balance": 50.0})
    s = db.Session()
    try:
        with pytest.raises(L.LimitExceeded) as ei:
            svc.preflight_live_session(s, INST, user_id="learner", roles_raw=["STUDENT"])
        assert ei.value.body["use_case"] == "tutor_live"
        # balance short: today's 402 text, not a limit
        monkeypatch.setattr(svc, "preflight_tool_credits",
                            lambda dbs, **k: {"estimated_credits": 5.0, "sufficient": False, "current_balance": 1.0})
        assert svc.preflight_live_session(s, INST, user_id="learner").startswith("Not enough credits")
    finally:
        s.close()


def test_tutor_socket_sends_the_frames_before_closing():
    """The socket's meter sends usage_limit_frames() and closes with 4429 (the
    full socket needs a booted lesson; the wiring is checked in its source)."""
    src = (Path(__file__).resolve().parents[1] / "app/routers/tutor_ws.py").read_text()
    block = src[src.index("usage_frames = svc.usage_limit_frames(tutor_session_id)"):]
    block = block[:block.index("credits_end")]
    assert "await _send(frame)" in block and "USAGE_LIMIT_CLOSE_CODE" in block
    assert block.index("await _send(frame)") < block.index("websocket.close(")
    assert "roles_raw=limit_roles" in src


# ── 7. small pure pieces ─────────────────────────────────────────────────────

def test_warning_header_value_and_event_decision_ranking():
    assert G.warning_header_value([{"use_case": "tutor_chat", "pct": 85}, {"use_case": "tutor_chat", "pct": 90.4}]) \
        == "tutor_chat;pct=90"
    assert G.warning_header_value([]) is None
    assert G.combine_event_decision("NONE", "WOULD_BLOCK") == "NONE"
    assert G.combine_event_decision("OK", "WOULD_BLOCK") == "WOULD_BLOCK"
    assert G.combine_event_decision("OVERRUN", "WARN") == "OVERRUN"
    assert G.combine_event_decision("OK", None) == "OK"


def test_middleware_is_a_passthrough_without_any_policy(monkeypatch):
    seen = {}

    async def app(scope, receive, send):
        seen["state"] = G.current_state()

    import asyncio

    mw = G.LimitHeadersMiddleware(app)
    asyncio.run(mw({"type": "http", "headers": []}, None, None))
    assert seen["state"] is None          # no institute has a policy: nothing installed
    L.set_policy_index_for_tests([INST])
    asyncio.run(mw({"type": "http", "headers": []}, None, None))
    assert seen["state"] is not None


# ── review fixes (2026-10-15) ────────────────────────────────────────────────

def _check_app(d, monkeypatch, user):
    from ai_service.app.routers import credits as credits_router

    monkeypatch.setattr(credits_router, "require_institute_member", lambda authorization, institute_id: None)
    app = FastAPI()
    for t in G.limit_exceeded_types():
        app.add_exception_handler(t, G.limit_exceeded_handler)
    app.add_middleware(G.LimitHeadersMiddleware)
    app.include_router(credits_router.router, prefix="/ai-service")

    def _svc():
        s = d.Session()
        try:
            yield CreditService(s)
        finally:
            s.close()

    app.dependency_overrides[credits_router.get_credit_service] = _svc
    app.dependency_overrides[credits_router.get_optional_user] = lambda: user
    return TestClient(app)


CHECK_URL = "/ai-service/credits/v1/check"


def test_check_body_actor_is_ignored_for_a_jwt_caller(db, monkeypatch):
    """Any member could name another user (read their usage) or claim SYSTEM
    (skip every USER row) in the /check body; only the internal token may."""
    db.policy("ENFORCE")
    db.row("USER", "victim", hard=2)
    db.row("ROLE_CLASS", "SYSTEM", hard=0)                     # SYSTEM work refused outright
    victim = dict(user_id="victim", actor_user_id="victim", actor_roles_raw=["STUDENT"], actor_role_class="LEARNER")
    _deduct(db, **victim)
    _deduct(db, **victim)
    msvc.wait_for_background()
    body = {"institute_id": INST, "request_type": "conversation", "model": "m", "estimated_tokens": 100}
    c = _check_app(db, monkeypatch, {"user_id": "attacker"})
    r = c.post(CHECK_URL, json=dict(body, actor_user_id="victim", actor_kind="USER"))
    assert r.status_code == 200 and r.json()["has_sufficient_credits"] is True   # not the victim's 429
    r = c.post(CHECK_URL, json=dict(body, actor_user_id="victim", actor_kind="SYSTEM"))
    assert r.status_code == 200                                 # no SYSTEM verdict either
    # our own services (internal token) still name the actor
    svc = _check_app(db, monkeypatch, None)
    r = svc.post(CHECK_URL, json=dict(body, actor_user_id="victim", actor_kind="USER"),
                 headers={"X-Internal-Service-Token": TOKEN})
    assert r.status_code == 429 and r.json()["scope"] == "USER"
    r = svc.post(CHECK_URL, json=dict(body, actor_kind="SYSTEM", actor_role_class="SYSTEM"),
                 headers={"X-Internal-Service-Token": TOKEN})
    assert r.status_code == 429 and r.json()["scope"] == "ROLE_CLASS"


def test_in_process_gates_do_not_reserve_on_the_catalog_flag(db):
    """A gate that cannot carry a reservation forward does not create one
    (no lock / insert / delete per check, e.g. a /check loop on lesson_video)."""
    db.policy("ENFORCE")
    db.row(hard=1000)
    s = db.Session()
    try:
        d = G.authorize(s, institute_id=INST, use_case="lesson_video", ctx=TEACHER, estimate_credits=5)
    finally:
        s.close()
    assert d and d["allow"] and d["reservation_id"] is None
    assert db.all("SELECT * FROM ai_usage_reservation") == []
    s = db.Session()
    try:
        d = G.authorize(s, institute_id=INST, use_case="lesson_video", ctx=TEACHER, estimate_credits=5,
                        reserve=True)
    finally:
        s.close()
    assert d["reservation_id"] and len(db.all("SELECT * FROM ai_usage_reservation")) == 1
