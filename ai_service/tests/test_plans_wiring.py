"""AI subscription plans wired into the money paths (contract P-WIRING, unit P3):
CreditService.deduct_credits / check_credits / refund_credits,
TokenUsageService.refund_video_credits, require_credits, preflight_tool_credits,
the tutor live-minute gate, the internal authorize endpoint (billing_mode),
limits.Decision and the metering writer's plan fields.

The real plan engine (metering/plans.py) and the real metering writer on a file
SQLite database with real SAVEPOINTs; the Postgres money run (and the
byte-for-byte comparison with origin/main) is test_plans_money_pg.py.

What must hold:
  * plans off, or no live subscription: not one plan function runs past the
    in-memory gate (deduct, check, refund, pre-flight, authorize), the
    authorize JSON has no billing_mode key;
  * any failure in the plan logic charges exactly as today (CHARGED, a
    ledger row) and gives back what was reserved;
  * LIVE INCLUDED: no ledger row, event is the record (and the idempotency
    record), limits counters count list_credits; no event -> charged;
  * LIVE SPLIT whose wallet part cannot be paid: dropped like today and the
    allowance take is given back;
  * pre-checks: covered -> allowed without a balance and without a wallet.

Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_plans_wiring.py -q -p no:cacheprovider -o asyncio_mode=auto
"""
from __future__ import annotations

import json
import os
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
from ai_service.app.services import model_selection  # noqa: E402
from ai_service.app.services.credit_service import CreditService  # noqa: E402
from ai_service.app.services.metering import cache as mcache  # noqa: E402
from ai_service.app.services.metering import limits as L  # noqa: E402
from ai_service.app.services.metering import plan_wiring as W  # noqa: E402
from ai_service.app.services.metering import plans as P  # noqa: E402
from ai_service.app.services.metering import service as msvc  # noqa: E402
from ai_service.app.services.metering.limit_models import LimitsBase  # noqa: E402
from ai_service.app.services.metering.models import Base as MeteringBase  # noqa: E402
from ai_service.app.services.metering.plan_models import PlansBase  # noqa: E402

sqlite3.register_adapter(Decimal, str)

INST = "inst-plan"
OTHER = "inst-none"
NOWALLET = "inst-nowallet"
PRICE = Decimal("1.2345")
UTC = timezone.utc
TOKEN = "svc-secret"
D = Decimal
PLAN_RE = __import__("re").compile(r"ai_plan|ai_subscription|institute_ai_subscription|ai_billing_feature|PLAN_PERIOD")

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
    """CREATE TABLE ai_model_defaults (use_case VARCHAR(64) PRIMARY KEY, default_model_id VARCHAR(255),
        fallback_model_id VARCHAR(255))""",
    """CREATE TABLE ai_models (model_id VARCHAR(255) PRIMARY KEY, output_price_per_1m NUMERIC(12,6),
        is_active BOOLEAN DEFAULT 1)""",
]

FEATURES = [("tutor_chat", "INCLUDABLE", False), ("content_generation", "INCLUDABLE", False),
            ("tutor_live_minutes", "ALLOWANCE_ONLY", False), ("ai_video_clips", "ALLOWANCE_ONLY", False),
            ("ai_calling", "ALWAYS_CHARGED", True), ("unmapped", "ALWAYS_CHARGED", False)]

CATALOG = [
    # use_case, group, count unit, request types, tool keys, billing feature
    ("tutor_chat", "tutor", "messages", ["conversation"], [], "tutor_chat"),
    ("tutor_live", "tutor", "minutes", [], ["tutor_live_minute"], "tutor_live_minutes"),
    ("content", "content", "requests", ["content"], ["html_document"], "content_generation"),
    ("ai_video_clip", "video", "requests", ["ai_video"], [], "ai_video_clips"),
    ("ai_calling", "calling", "minutes", ["ai_call_out"], [], "ai_calling"),
    ("unknown", "platform", "requests", [], [], "unmapped"),
]


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
        fd, self.path = tempfile.mkstemp(suffix=".sqlite3", prefix="plans-wiring-")
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
        _stripped(PlansBase).create_all(self.engine)
        now = datetime.now(UTC)
        with self.engine.begin() as c:
            c.exec_driver_sql("ALTER TABLE ai_use_case_catalog ADD COLUMN billing_feature_key VARCHAR(48)")
            for i, (key, elig, locked) in enumerate(FEATURES):
                c.execute(text("INSERT INTO ai_billing_feature (feature_key, label, eligibility, locked, display_order, "
                               "is_active) VALUES (:k, :k, :e, :lk, :o, 1)"),
                          {"k": key, "e": elig, "lk": 1 if locked else 0, "o": i})
            for i, (uc, fg, unit, rts, tks, fk) in enumerate(CATALOG):
                c.execute(text(
                    "INSERT INTO ai_use_case_catalog (use_case, feature_group, label, count_unit_label, "
                    "legacy_request_types, tool_keys, default_surface, actor_kind, unit_kind, billing_policy, "
                    "plan_eligible, limit_eligible, reserve_on_authorize, intentionally_separate, is_active, "
                    "display_order, billing_feature_key) VALUES (:u, :f, :u, :cu, :r, :k, 'UNKNOWN', 'USER', "
                    "'TOKENS', 'AS_TODAY', 1, 1, 0, 0, 1, :o, :fk)"),
                    {"u": uc, "f": fg, "cu": unit, "r": json.dumps(rts), "k": json.dumps(tks), "o": i * 10, "fk": fk})
            for inst, bal in ((INST, D("500")), (OTHER, D("500"))):
                c.execute(text("INSERT INTO institute_credits VALUES (:id, :i, :b, 0, :b, 10, :n, :n)"),
                          {"id": f"c-{inst}", "i": inst, "b": bal, "n": now})
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)
        s = self.Session()
        assert mcache.get_snapshot(s) is not None
        s.commit()
        s.close()
        P.configure(sessionmaker=self.Session)

    def exec(self, sql, **params):
        with self.engine.begin() as c:
            c.execute(text(sql), params)

    def all(self, sql, **params):
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(text(sql), params).mappings().all()]

    def one(self, sql, **params):
        rows = self.all(sql, **params)
        return rows[0] if rows else None

    def plan(self, items, *, allowance=0):
        pid, vid = str(uuid.uuid4()), str(uuid.uuid4())
        now = datetime.now(UTC)
        self.exec("INSERT INTO ai_plan (id, plan_key, name, is_active, created_at, updated_at) "
                  "VALUES (:i, :k, 'Test plan', 1, :n, :n)", i=pid, k=f"p_{pid[:8]}", n=now)
        self.exec("INSERT INTO ai_plan_version (id, plan_id, version_no, status, currency, price_minor, "
                  "is_tax_inclusive, period_months, allowance_credits, grace_days, grace_behaviour, "
                  "migrate_existing_at_renewal, created_at, updated_at) VALUES (:v, :p, 1, 'PUBLISHED', 'INR', "
                  "500000, 0, 1, :a, 7, 'CHARGED', 0, :n, :n)", v=vid, p=pid, a=allowance, n=now)
        for fk, spec in items.items():
            self.exec("INSERT INTO ai_plan_item (id, plan_version_id, feature_key, mode, model_policy, "
                      "on_model_violation, user_cap_basis, over_cap_action, inst_credits_cap, roles_included) "
                      "VALUES (:id, :v, :f, :m, 'ANY', 'CHARGE', 'ACTOR', 'CHARGE', :cap, :roles)",
                      id=str(uuid.uuid4()), v=vid, f=fk, m=spec["mode"], cap=spec.get("cap"),
                      roles=json.dumps(spec["roles"]) if spec.get("roles") else None)
        P.invalidate()
        return pid, vid

    def subscribe(self, vid, *, inst=INST, enforcement="LIVE"):
        sid = str(uuid.uuid4())
        now = datetime.now(UTC)
        start = now - timedelta(days=2)
        self.exec("INSERT INTO institute_ai_subscription (id, institute_id, plan_version_id, status, enforcement, "
                  "source, anchor_at, start_at, period_months, auto_renew, grace_days, cancel_at_period_end, "
                  "created_by, created_at, updated_at) VALUES (:id, :i, :v, 'ACTIVE', :e, 'MANUAL', :s, :s, 1, 1, 7, "
                  "0, 'test', :n, :n)", id=sid, i=inst, v=vid, e=enforcement, s=start, n=now)
        P.invalidate()
        assert P.refresh_index()
        return sid

    def ledger(self, inst=INST):
        return self.all("SELECT * FROM credit_transactions WHERE institute_id = :i ORDER BY created_at", i=inst)

    def events(self, inst=INST):
        return self.all("SELECT * FROM ai_usage_event WHERE institute_id = :i ORDER BY occurred_at, id", i=inst)

    def balance(self, inst=INST):
        r = self.one("SELECT current_balance FROM institute_credits WHERE institute_id = :i", i=inst)
        return D(str(r["current_balance"])) if r else None

    def allowance_used(self, sid):
        r = self.one("SELECT allowance_used FROM ai_subscription_period WHERE subscription_id = :s", s=sid)
        return D(str(r["allowance_used"])) if r else None

    def plan_statements(self):
        return [s for s in self.statements if PLAN_RE.search(s)]


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    L.reset_for_tests()
    P.reset_for_tests()
    mcache.reset_cache()
    model_selection.invalidate_cache()
    settings = {"metering.events.enabled": True, "metering.limits.enforce": True, "billing.plans.enabled": True}
    monkeypatch.setattr(mcache, "setting_value", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(mcache, "peek_setting", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(L, "_maybe_refresh_index", lambda: None)
    monkeypatch.setattr(P, "_maybe_refresh_index", lambda: None)
    monkeypatch.setattr(CreditService, "calculate_credits", lambda self, **kw: PRICE)
    monkeypatch.setattr(CreditService, "_check_and_create_alerts", lambda self, *a, **k: None)
    monkeypatch.setattr(get_settings(), "internal_service_token", TOKEN)
    yield settings
    msvc.wait_for_background()
    L.reset_for_tests()
    P.reset_for_tests()
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


def _req(inst=INST, i=0, **kw):
    fields = dict(institute_id=inst, request_type="conversation", model="glm", prompt_tokens=100,
                  completion_tokens=50, user_id="u1", user_role="STUDENT", use_case="tutor_chat",
                  actor_kind="USER", actor_user_id="u1", actor_role_class="LEARNER", role_source="JWT",
                  idempotency_key=f"k-{inst}-{i}")
    fields.update(kw)
    return CreditDeductRequest(**fields)


def _deduct(d, r):
    s = d.Session()
    try:
        return CreditService(s).deduct_credits(r)
    finally:
        s.close()


def _check(d, inst=INST, **kw):
    s = d.Session()
    try:
        fields = dict(institute_id=inst, request_type="conversation", model="glm", estimated_tokens=100,
                      use_case="tutor_chat", actor_kind="USER", actor_user_id="u1", actor_role_class="LEARNER")
        fields.update(kw)
        return CreditService(s).check_credits(CreditCheckRequest(**fields))
    finally:
        s.close()


@pytest.fixture
def boom(monkeypatch):
    """Fail loudly if anything past the in-memory gate is reached."""
    def _boom(*a, **k):
        raise AssertionError("plan logic called for an institute without a live subscription")

    for name in ("decide_for_deduct", "precheck_mode", "billing_mode_for", "refund_allocation",
                 "restore_batch_allowance"):
        monkeypatch.setattr(W, name, _boom)
    for name in ("decide", "precheck", "release", "live_subscription", "refund_allowance"):
        monkeypatch.setattr(P, name, _boom)


# ── 1. zero disruption: off / no subscription ────────────────────────────────

@pytest.mark.parametrize("enabled", [False, True])
def test_no_live_subscription_never_reaches_plan_code(db, boom, _isolate, enabled):
    _pid, vid = db.plan({"tutor_chat": {"mode": "INCLUDED"}})
    db.subscribe(vid, inst=INST)              # INST has one; OTHER does not
    _isolate["billing.plans.enabled"] = enabled
    db.statements.clear()
    r = _deduct(db, _req(OTHER))
    assert r.success and r.credits_deducted == PRICE and r.message == f"Deducted {PRICE} credits"
    assert len(db.ledger(OTHER)) == 1
    chk = _check(db, OTHER)
    assert chk.has_sufficient_credits and chk.message == f"Sufficient credits available. Estimated cost: {PRICE}"
    s = db.Session()
    try:
        CreditService(s).refund_credits(OTHER, D("1"), "AI video shot 1 refund: x", batch_id="b1")
        assert CreditService(s).restore_plan_allowance(OTHER, "b1") == 0
        out = ai_billing.preflight_tool_credits(s, tool_key="tutor_live_minute", tool_params={"audio_minutes": 1},
                                                institute_id=OTHER)
        assert "plan_covered" not in out
    finally:
        s.close()
    msvc.wait_for_background()
    assert db.plan_statements() == []
    if not enabled:
        # plans off: even the institute WITH a subscription is today's path
        db.statements.clear()
        r = _deduct(db, _req(INST))
        assert r.credits_deducted == PRICE and len(db.ledger(INST)) == 1
        assert db.plan_statements() == []


def test_internal_authorize_has_billing_mode_only_with_a_live_subscription(db, _isolate):
    from ai_service.app.routers import metering_internal

    app = FastAPI()
    app.include_router(metering_internal.router, prefix="/ai-service")

    def _db():
        s = db.Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[db_dependency] = _db
    c = TestClient(app)
    h = {"X-Internal-Service-Token": TOKEN}
    none = {"allow": True, "decision": "NONE", "warnings": [], "block": None, "reservation_id": None}
    body = {"institute_id": INST, "use_case": "tutor_chat", "actor_role_class": "LEARNER", "user_id": "u1",
            "estimate_credits": 2}
    assert c.post("/ai-service/internal/metering/v1/authorize", json=body, headers=h).json() == none
    _pid, vid = db.plan({"tutor_chat": {"mode": "INCLUDED"}})
    db.subscribe(vid)
    assert c.post("/ai-service/internal/metering/v1/authorize", json=body, headers=h).json() == \
        dict(none, billing_mode="INCLUDED")
    assert c.post("/ai-service/internal/metering/v1/authorize", json=dict(body, use_case="ai_calling"),
                  headers=h).json() == dict(none, billing_mode="CHARGED")
    assert c.post("/ai-service/internal/metering/v1/authorize", json=dict(body, institute_id=OTHER),
                  headers=h).json() == none
    _isolate["billing.plans.enabled"] = False
    assert c.post("/ai-service/internal/metering/v1/authorize", json=body, headers=h).json() == none


def test_decision_json_unchanged_without_billing_mode():
    d = L.Decision()
    assert "billing_mode" not in d.to_dict()
    assert L.Decision(billing_mode="INCLUDED").to_dict()["billing_mode"] == "INCLUDED"


def test_setting_specs():
    from ai_service.app.services.platform_settings_service import SETTING_SPECS

    assert SETTING_SPECS["billing.plans.enabled"].type == "bool" and SETTING_SPECS["billing.plans.enabled"].default() is False
    assert SETTING_SPECS["billing.inr_per_usd"].type == "number" and SETTING_SPECS["billing.inr_per_usd"].default() == 86
    assert SETTING_SPECS["billing.plans.roll.enabled"].default() is True


# ── 2. LIVE INCLUDED through the real engine ─────────────────────────────────

def test_live_included_then_over_cap(db):
    pid, vid = db.plan({"tutor_chat": {"mode": "INCLUDED", "cap": PRICE * 2}})
    sid = db.subscribe(vid)
    r1, r2 = _deduct(db, _req(i=1)), _deduct(db, _req(i=2))
    for r in (r1, r2):
        assert r.success and r.credits_deducted == 0 and r.new_balance == D("500") and r.transaction_id
    assert db.ledger() == [] and db.balance() == D("500")
    ev = db.events()
    assert [(e["billing_mode"], D(str(e["list_credits"])), D(str(e["credits_charged"])), e["ledger_tx_id"],
             e["subscription_id"], e["plan_id"]) for e in ev] == [("INCLUDED", PRICE, D("0"), None, sid, pid)] * 2
    assert {e["id"] for e in ev} == {r1.transaction_id, r2.transaction_id}
    # idempotent retry of an included charge
    again = _deduct(db, _req(i=1))
    assert again.credits_deducted == 0 and "idempotent" in again.message and len(db.events()) == 2
    # over the cap -> today's charge
    r3 = _deduct(db, _req(i=3))
    assert r3.credits_deducted == PRICE and len(db.ledger()) == 1 and db.balance() == D("500") - PRICE
    msvc.wait_for_background()
    last = db.events()[-1]
    assert last["billing_mode"] == "CHARGED" and last["ledger_tx_id"] and last["subscription_id"] == sid
    ctx = last["context"] if isinstance(last["context"], dict) else json.loads(last["context"] or "{}")
    assert ctx.get("plan_reason") == "OVER_CAP"


def test_role_not_included_is_charged(db):
    _pid, vid = db.plan({"tutor_chat": {"mode": "INCLUDED", "roles": ["LEARNER"]}})
    db.subscribe(vid)
    r = _deduct(db, _req(actor_role_class="TEACHER", user_role="TEACHER"))
    assert r.credits_deducted == PRICE and len(db.ledger()) == 1


def test_always_charged_feature_is_charged(db):
    _pid, vid = db.plan({"ai_calling": {"mode": "INCLUDED"}})
    db.subscribe(vid)
    r = _deduct(db, _req(use_case="ai_calling", request_type="ai_call_out"))
    assert r.credits_deducted == PRICE and len(db.ledger()) == 1


def test_shadow_charges_as_today_and_tags_the_event(db):
    _pid, vid = db.plan({"tutor_chat": {"mode": "INCLUDED"}})
    sid = db.subscribe(vid, enforcement="SHADOW")
    r = _deduct(db, _req())
    assert r.credits_deducted == PRICE and r.message == f"Deducted {PRICE} credits"
    msvc.wait_for_background()
    (e,) = db.events()
    assert (e["billing_mode"], e["shadow_billing_mode"], e["subscription_id"]) == ("CHARGED", "INCLUDED", sid)
    assert db.all("SELECT * FROM ai_usage_counter") == []


# ── 3. fail safe ─────────────────────────────────────────────────────────────

def test_engine_exception_charges_as_today(db, monkeypatch):
    _pid, vid = db.plan({"tutor_chat": {"mode": "INCLUDED"}})
    db.subscribe(vid)
    monkeypatch.setattr(P, "decide", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("bug")))
    r = _deduct(db, _req())
    assert r.success and r.credits_deducted == PRICE and len(db.ledger()) == 1


def test_inconsistent_decision_is_released_and_charged(db, monkeypatch):
    _pid, vid = db.plan({"tutor_chat": {"mode": "INCLUDED"}})
    db.subscribe(vid)
    released = []
    monkeypatch.setattr(P, "decide", lambda *a, **k: P.PlanDecision(
        billing_mode="INCLUDED", list_credits=PRICE, wallet_credits=D("0"), included_credits=D("0.5"),
        enforcement="LIVE", release_token=P.ReleaseToken(institute_id=INST, allowance_take=D("1"))))
    monkeypatch.setattr(P, "release", lambda db_, token, **k: released.append(token) or True)
    r = _deduct(db, _req())
    assert r.credits_deducted == PRICE and len(db.ledger()) == 1 and len(released) == 1


def test_included_without_an_event_is_charged(db, _isolate):
    _pid, vid = db.plan({"tutor_chat": {"mode": "INCLUDED", "cap": PRICE * 10}})
    sid = db.subscribe(vid)
    _isolate["metering.events.enabled"] = False      # the kill switch: no event can be written
    r = _deduct(db, _req())
    assert r.credits_deducted == PRICE and len(db.ledger()) == 1
    # the reservation was released: the fair-use counter did not move
    rows = db.all("SELECT credits_used FROM ai_usage_counter WHERE counter_key = :k",
                  k=f"PLAN:{sid}|F:tutor_chat")
    assert not rows or D(str(rows[0]["credits_used"])) == 0


# ── 4. allowance, SPLIT, dropped SPLIT ──────────────────────────────────────

def _clip(i, inst=INST, **kw):
    return _req(inst, 100 + i, request_type="ai_video", model="veo", precomputed_credits=D("10"),
                use_case="ai_video_clip", batch_id="vid-1", description=f"AI video shot {i} (8s, audio)",
                idempotency_key=None, **kw)


def test_allowance_split_then_charged_and_refunds(db):
    _pid, vid = db.plan({"ai_video_clips": {"mode": "ALLOWANCE"}}, allowance=D("15"))
    sid = db.subscribe(vid)
    out = [_deduct(db, _clip(i)) for i in (1, 2, 3)]
    assert [o.credits_deducted for o in out] == [0, D("5"), D("10")]
    assert db.allowance_used(sid) == D("15") and db.balance() == D("485")
    msvc.wait_for_background()
    assert [(e["billing_mode"], D(str(e["credits_charged"]))) for e in db.events()] == [
        ("ALLOWANCE", D("0")), ("SPLIT", D("5")), ("CHARGED", D("10"))]
    # per-shot refund of the ALLOWANCE shot: allowance back, no wallet credit
    s = db.Session()
    try:
        rr = CreditService(s).refund_credits(INST, D("10"), "AI video shot 1 refund: x", batch_id="vid-1")
    finally:
        s.close()
    assert rr.credits_deducted == 0 and db.allowance_used(sid) == D("5") and db.balance() == D("485")
    # full refund of the video
    from ai_service.app.services.token_usage_service import TokenUsageService

    s = db.Session()
    try:
        TokenUsageService(s).refund_video_credits("vid-1", INST)
    finally:
        s.close()
    msvc.wait_for_background()
    assert db.allowance_used(sid) == D("0") and db.balance() == D("500")
    assert sorted(D(str(x["amount"])) for x in db.ledger() if x["transaction_type"] == "REFUND") == [D("15")]
    assert [(e["billing_mode"], e["charge_status"], D(str(e["refunded_credits"]))) for e in db.events()] == [
        ("ALLOWANCE", "REFUNDED", D("10")), ("SPLIT", "REFUNDED", D("10")), ("CHARGED", "REFUNDED", D("10"))]


def test_split_with_insufficient_wallet_is_dropped_and_allowance_given_back(db):
    _pid, vid = db.plan({"ai_video_clips": {"mode": "ALLOWANCE"}}, allowance=D("4"))
    sid = db.subscribe(vid)
    db.exec("UPDATE institute_credits SET current_balance = 1 WHERE institute_id = :i", i=INST)
    r = _deduct(db, _clip(1))
    assert r.success is False and r.credits_deducted == 0 and "Need 6" in r.message
    assert db.allowance_used(sid) in (None, D("0")) and db.balance() == D("1") and db.ledger() == []
    msvc.wait_for_background()
    (e,) = db.events()
    assert (e["billing_mode"], e["charge_status"]) == ("CHARGED", "DROPPED_INSUFFICIENT")


# ── 5. pre-checks ────────────────────────────────────────────────────────────

def test_check_credits_covered_without_balance_or_wallet(db):
    _pid, vid = db.plan({"tutor_chat": {"mode": "INCLUDED"}})
    db.subscribe(vid)
    db.subscribe(vid, inst=NOWALLET)
    db.exec("UPDATE institute_credits SET current_balance = 0 WHERE institute_id = :i", i=INST)
    for inst in (INST, NOWALLET):
        chk = _check(db, inst)
        assert chk.has_sufficient_credits and "included in the AI plan" in chk.message and chk.current_balance == 0
    assert db.one("SELECT 1 AS x FROM institute_credits WHERE institute_id = :i", i=NOWALLET) is None
    assert db.ledger(NOWALLET) == []
    # an always-charged feature: today's answer (402 for a zero balance)
    chk = _check(db, INST, use_case="ai_calling", request_type="ai_call_out")
    assert chk.has_sufficient_credits is False and "AI plan" not in chk.message


def test_require_credits_and_preflight_and_tutor_gate(db):
    _pid, vid = db.plan({"tutor_chat": {"mode": "INCLUDED"}, "tutor_live_minutes": {"mode": "ALLOWANCE"}},
                        allowance=D("1000"))
    db.subscribe(vid)
    db.exec("UPDATE institute_credits SET current_balance = 0 WHERE institute_id = :i", i=INST)

    app = FastAPI()

    @app.get("/op")
    def op(_c=Depends(deps.require_credits("conversation", estimated_tokens=100))):
        return {"ok": True}

    def _db():
        s = db.Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[db_dependency] = _db
    app.dependency_overrides[deps.get_institute_from_api_key] = lambda: INST
    # X-Institute-Key callers are API_KEY actors; tutor_chat has no role filter -> covered
    assert TestClient(app).get("/op").status_code == 200
    app.dependency_overrides[deps.get_institute_from_api_key] = lambda: OTHER
    db.exec("UPDATE institute_credits SET current_balance = 0 WHERE institute_id = :i", i=OTHER)
    assert TestClient(app).get("/op").status_code == 402

    from ai_service.app.services.tutor.runtime import session_service as SS

    s = db.Session()
    try:
        est = ai_billing.preflight_tool_credits(s, tool_key="tutor_live_minute", tool_params={"audio_minutes": 5},
                                                institute_id=INST)
        assert est["sufficient"] is True and est["plan_covered"] == "ALLOWANCE"
        assert SS.preflight_live_session(s, INST, user_id="u1") is None
        assert SS.preflight_live_session(s, OTHER, user_id="u1") is not None   # today's 402 detail
    finally:
        s.close()


# ── 6. metering writer: plan fields are additive ─────────────────────────────

def test_mark_batch_refunds_counts_split_allowance_part(db):
    s = db.Session()
    try:
        tx = str(uuid.uuid4())
        db.exec("INSERT INTO credit_transactions (id, institute_id, transaction_type, amount, balance_after, "
                "description, batch_id, created_at) VALUES (:t, :i, 'USAGE_DEDUCTION', -4, 0, "
                "'AI video shot 1 (8s)', 'b9', :n)", t=tx, i=INST, n=datetime.now(UTC))
        db.exec("INSERT INTO credit_transactions (id, institute_id, transaction_type, amount, balance_after, "
                "description, batch_id, created_at) VALUES (:t, :i, 'REFUND', 4, 0, 'AI video shot 1 refund: x', "
                "'b9', :n)", t=str(uuid.uuid4()), i=INST, n=datetime.now(UTC) + timedelta(seconds=1))
        eid = msvc.record_event(s, msvc.input_from(None, institute_id=INST, request_type="ai_video", batch_id="b9",
                                                   use_case="ai_video_clip"),
                                billing_mode="SPLIT", charge_status="POSTED", list_credits=D("10"),
                                credits_charged=D("4"), ledger_tx_id=tx,
                                plan_fields={"context": {"allowance_refunded": 6}})
        s.commit()
        assert msvc.mark_batch_refunds(s, INST, "b9") == 1
    finally:
        s.close()
    e = db.one("SELECT * FROM ai_usage_event WHERE id = :e", e=eid)
    assert (e["charge_status"], D(str(e["refunded_credits"]))) == ("REFUNDED", D("10"))


def test_record_charged_event_defaults_are_unchanged(db, monkeypatch):
    seen = {}
    real = msvc.record_event

    def spy(*a, **k):
        seen.update(k)
        return real(*a, **k)

    monkeypatch.setattr(msvc, "record_event", spy)
    s = db.Session()
    try:
        msvc.record_charged_event(s, _req(OTHER), transaction_id=str(uuid.uuid4()), credits=PRICE)
    finally:
        s.close()
    assert "plan_fields" not in seen and "upgrade_without_ledger" not in seen
    assert seen["billing_mode"] == "CHARGED" and seen["list_credits"] == PRICE


def test_included_links_the_usage_row_and_counts_limits(db):
    _pid, vid = db.plan({"tutor_chat": {"mode": "INCLUDED"}})
    db.subscribe(vid)
    # an ENFORCE limits policy with a generous daily cap: the included use still counts (list_credits)
    db.exec("INSERT INTO institute_ai_limits_policy (institute_id, mode, tenant_may_enforce, timezone, "
            "notify_admins_on_soft, show_numbers_to_learners, updated_at) VALUES (:i, 'ENFORCE', 1, 'Asia/Kolkata', "
            "1, 1, :n)", i=INST, n=datetime.now(UTC))
    db.exec("INSERT INTO ai_usage_limit (id, institute_id, subject_kind, per_member, scope_kind, period, metric, "
            "hard_limit, origin, locked, effective_from, is_active, created_by, created_at, updated_at) VALUES "
            "(:id, :i, 'INSTITUTE', 1, 'ALL', 'DAY', 'CREDITS', 1000, 'TENANT', 0, :ef, 1, 'test', :n, :n)",
            id=str(uuid.uuid4()), i=INST, ef=datetime.now(UTC) - timedelta(days=400), n=datetime.now(UTC))
    L.invalidate(INST, active=True)
    usage = str(uuid.uuid4())
    db.exec("INSERT INTO ai_token_usage (id, institute_id, model, request_type, credits_used) "
            "VALUES (:u, :i, 'glm', 'conversation', NULL)", u=usage, i=INST)
    r = _deduct(db, _req(usage_log_id=usage))
    assert r.credits_deducted == 0 and db.ledger() == []
    row = db.one("SELECT usage_event_id, credits_used FROM ai_token_usage WHERE id = :u", u=usage)
    assert row["usage_event_id"] == r.transaction_id and D(str(row["credits_used"])) == 0
    (e,) = db.events()
    assert e["billing_mode"] == "INCLUDED" and e["limit_decision"] == "OK"
    cnt = db.one("SELECT credits_used FROM ai_usage_counter WHERE institute_id = :i AND counter_key = 'I|ALL' "
                 "AND period = 'DAY'", i=INST)
    assert D(str(cnt["credits_used"])) == PRICE
