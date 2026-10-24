"""AI subscription plans on the REAL money path, on a REAL Postgres 16 (unit P3).

CreditService.deduct_credits / check_credits / refund_credits and
TokenUsageService.refund_video_credits (psycopg 3, the prod driver) with the
plan engine (metering/plans.py) and the wiring (metering/plan_wiring.py),
against fresh copies of a template (AI_LIMITS_PG_TEMPLATE, e.g. 'prodbase' =
the prod schema + real ledger rows) plus the Flyway migrations V586, V587 and
V588 from this checkout.

What must hold (contract P-WIRING):
  1. plans disabled: 40+ deductions, refunds and a dropped charge give the same
     responses, ledger rows, balances and usage events as the origin/main
     credit_service (loaded with `git show`), and not one statement touches a
     plan table; the same with plans ENABLED for institutes without a
     subscription;
  2. enabled + ACTIVE LIVE subscription with an INCLUDED feature: no ledger row,
     balance unchanged, INCLUDED events with list_credits, fair-use counters
     move; at the cap the next charge is CHARGED with a normal ledger row;
  3. ALLOWANCE: allowance_used moves, SPLIT when it runs out (ledger row = the
     wallet part only), then CHARGED;
  4. SHADOW: ledger + balance exactly as (1); events carry shadow_billing_mode;
  5. refunding a batch with allowance parts gives the allowance back and
     credits the wallet only for its wallet part;
  6. check_credits with balance 0 (and with no wallet at all) + a LIVE
     included feature is allowed, without creating a wallet or a grant.

Needs Postgres: AI_LIMITS_PG_URL or AI_LIMITS_PGDATA; skipped otherwise.
  AI_LIMITS_PGDATA=<scratch>/pgdata AI_LIMITS_PG_TEMPLATE=prodbase \\
  <venv>/bin/python -m pytest ai_service/tests/test_plans_money_pg.py -q -p no:cacheprovider -o asyncio_mode=auto
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, event, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from ai_service.app.schemas.credits import CreditCheckRequest, CreditDeductRequest  # noqa: E402
from ai_service.app.services import credit_service as new_cs  # noqa: E402
from ai_service.app.services.metering import cache as mcache  # noqa: E402
from ai_service.app.services.metering import limits as L  # noqa: E402
from ai_service.app.services.metering import plans as P  # noqa: E402
from ai_service.app.services.metering import service as msvc  # noqa: E402

MIGRATIONS = ROOT / "admin_core_service/src/main/resources/db/migration"
MODEL = "z-ai/glm-5.3-flash"
USER = "11111111-2222-3333-4444-555555555555"
PLAN_SQL = re.compile(r"ai_plan|ai_subscription|institute_ai_subscription|ai_billing_feature|PLAN_PERIOD|PLAN:")
UTC = timezone.utc

STUBS = """
CREATE TABLE IF NOT EXISTS institute_credits (id VARCHAR(64) PRIMARY KEY, institute_id VARCHAR(64) UNIQUE,
  total_credits NUMERIC(12,2), used_credits NUMERIC(12,2), current_balance NUMERIC(12,2),
  low_balance_threshold NUMERIC(12,2), created_at TIMESTAMP, updated_at TIMESTAMP);
CREATE TABLE IF NOT EXISTS credit_transactions (id UUID PRIMARY KEY, institute_id VARCHAR(64),
  transaction_type VARCHAR(32), amount NUMERIC(12,4), balance_after NUMERIC(12,2), description TEXT,
  reference_id VARCHAR(64),
  request_type VARCHAR(64), model_name VARCHAR(128), batch_id VARCHAR(255), external_reference_id VARCHAR(255),
  user_id VARCHAR(255), user_role VARCHAR(64), subject_user_id VARCHAR(255), granted_by VARCHAR(255),
  created_at TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ct_ext ON credit_transactions(external_reference_id)
  WHERE external_reference_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS ai_token_usage (id UUID PRIMARY KEY, institute_id VARCHAR(64), credits_used NUMERIC);
CREATE TABLE IF NOT EXISTS credit_alerts (id VARCHAR(64) PRIMARY KEY, institute_id VARCHAR(64), alert_type VARCHAR(32),
  threshold_value NUMERIC, current_balance NUMERIC, acknowledged BOOLEAN DEFAULT FALSE, created_at TIMESTAMP);
"""

# institutes (fresh ids: the tests insert their wallets)
RICH = f"rich-{uuid.uuid4().hex[:8]}"        # plans off / on without subscription: compared with origin
RICH2 = f"rich2-{uuid.uuid4().hex[:8]}"
POOR = f"poor-{uuid.uuid4().hex[:8]}"        # dropped charges
SHADOW = f"shadow-{uuid.uuid4().hex[:8]}"    # SHADOW subscription: compared with origin
LIVE = f"live-{uuid.uuid4().hex[:8]}"        # LIVE subscription
ZERO = f"zero-{uuid.uuid4().hex[:8]}"        # LIVE, balance 0
NOWALLET = f"nowallet-{uuid.uuid4().hex[:8]}"  # LIVE, no institute_credits row at all
START_BALANCE = Decimal("5000")


# ── database ─────────────────────────────────────────────────────────────────

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


class _Dbs:
    def __init__(self, base: str, template: str | None):
        self.base, self.template, self.names = base, template, []
        self.admin = create_engine(base, isolation_level="AUTOCOMMIT", future=True)

    def fresh(self, tag: str):
        name = f"plans_{tag}_{uuid.uuid4().hex[:8]}"
        with self.admin.connect() as c:
            c.execute(text(f'CREATE DATABASE "{name}"' + (f' TEMPLATE "{self.template}"' if self.template else "")))
        self.names.append(name)
        url = self.base.replace("/postgres?", f"/{name}?") if "/postgres?" in self.base \
            else self.base.rsplit("/", 1)[0] + f"/{name}"
        engine = create_engine(url, pool_size=10, max_overflow=5, future=True)
        if not self.template:
            with engine.begin() as c:
                c.exec_driver_sql(STUBS)
        for prefix in ("V586", "V587", "V588"):
            raw = engine.raw_connection()  # one transaction, like Flyway; no
            try:                           # placeholder parsing (V588 has '%' in PL/pgSQL)
                cur = raw.cursor()
                cur.execute(_migration(prefix))
                raw.commit()
            finally:
                raw.close()
        with engine.begin() as c:
            # prod has this legacy table (11 rows); the prodbase template does not.
            # Without it calculate_credits' multiplier lookup aborts the transaction.
            c.execute(text("CREATE TABLE IF NOT EXISTS model_pricing (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
                           "model_pattern VARCHAR(255), tier VARCHAR(32), multiplier NUMERIC, description VARCHAR(255), "
                           "is_active BOOLEAN, created_at TIMESTAMP)"))
            for inst in (RICH, RICH2, SHADOW, LIVE):
                c.execute(text("INSERT INTO institute_credits (id, institute_id, total_credits, used_credits, "
                               "current_balance, low_balance_threshold, created_at, updated_at) VALUES "
                               "(:id, :i, :b, 0, :b, 10, now(), now())"),
                          {"id": str(uuid.uuid4()), "i": inst, "b": START_BALANCE})
            for inst, bal in ((POOR, Decimal("0.5")), (ZERO, Decimal("0"))):
                c.execute(text("INSERT INTO institute_credits (id, institute_id, total_credits, used_credits, "
                               "current_balance, low_balance_threshold, created_at, updated_at) VALUES "
                               "(:id, :i, :b, 0, :b, 10, now(), now())"),
                          {"id": str(uuid.uuid4()), "i": inst, "b": bal})
        statements: list = []

        @event.listens_for(engine, "before_cursor_execute")
        def _trace(conn, cursor, statement, params, context, executemany):
            statements.append(statement)

        engine.statements = statements  # type: ignore[attr-defined]
        engine.has_pricing = bool(self.template)  # type: ignore[attr-defined]
        return engine

    def close(self):
        with self.admin.connect() as c:
            for name in self.names:
                c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        self.admin.dispose()


@pytest.fixture(scope="module")
def dbs():
    base = _server_url()
    if not base:
        pytest.skip("no Postgres: set AI_LIMITS_PG_URL or AI_LIMITS_PGDATA")
    try:
        import psycopg  # noqa: F401,PLC0415
    except Exception:  # noqa: BLE001
        pytest.skip("psycopg 3 not installed")
    d = _Dbs(base, os.environ.get("AI_LIMITS_PG_TEMPLATE"))
    yield d
    d.close()


@pytest.fixture(scope="module")
def orig_cs():
    """origin/main's credit_service.py, loaded from git (the code prod runs)."""
    try:
        src = subprocess.check_output(["git", "show", "origin/main:ai_service/app/services/credit_service.py"],
                                      cwd=str(ROOT), stderr=subprocess.DEVNULL)
    except Exception:  # noqa: BLE001
        pytest.skip("origin/main not available")
    name = "ai_service.app.services._orig_credit_service_p3"
    spec = importlib.util.spec_from_loader(name, loader=None)
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "ai_service.app.services"
    sys.modules[name] = mod
    exec(compile(src, "origin/main:credit_service.py", "exec"), mod.__dict__)
    return mod


SETTINGS: dict = {}


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    L.reset_for_tests()
    P.reset_for_tests()
    mcache.reset_cache()
    SETTINGS.clear()
    SETTINGS.update({"metering.events.enabled": True, "metering.limits.enforce": True,
                     "billing.plans.enabled": False})
    monkeypatch.setattr(mcache, "setting_value", lambda key, default: SETTINGS.get(key, default))
    monkeypatch.setattr(mcache, "peek_setting", lambda key, default: SETTINGS.get(key, default))
    monkeypatch.setattr(L, "_maybe_refresh_index", lambda: None)
    monkeypatch.setattr(P, "_maybe_refresh_index", lambda: None)
    yield
    msvc.wait_for_background()
    L.reset_for_tests()
    P.reset_for_tests()
    mcache.reset_cache()


def _session(engine):
    return sessionmaker(bind=engine, future=True, expire_on_commit=False)()


def _alerts_off(monkeypatch, *mods):
    for m in mods:
        monkeypatch.setattr(m.CreditService, "_check_and_create_alerts", lambda self, *a, **k: None)


# ── a workload ───────────────────────────────────────────────────────────────

def _req(inst, i, **kw):
    fields = dict(institute_id=inst, request_type="conversation", model=MODEL, prompt_tokens=1000 + 37 * i,
                  completion_tokens=400 + i, user_id=USER, user_role="STUDENT", batch_id=f"b-{inst}",
                  idempotency_key=f"k-{inst}-{i}", use_case="tutor_chat", surface="LEARNER_APP", actor_kind="USER")
    fields.update(kw)
    return CreditDeductRequest(**fields)


def _workload(engine, cs_mod, inst, *, refund_video):
    """40 deductions + a duplicate + per-shot and full video refunds. Returns
    the responses (transaction ids dropped)."""
    out = []

    def deduct(r):
        s = _session(engine)
        try:
            resp = cs_mod.CreditService(s).deduct_credits(r)
        finally:
            s.close()
        d = resp.model_dump()
        d.pop("transaction_id", None)
        out.append(json.loads(json.dumps(d, default=str)))

    for i in range(30):
        deduct(_req(inst, i))
    for i in range(30, 34):
        deduct(_req(inst, i, request_type="content", precomputed_credits=Decimal("2.5"), allow_negative=True,
                    description=f"content using {MODEL} [html_document; rate default]", use_case=None,
                    batch_id=f"tool-{inst}"))
    deduct(_req(inst, 3))   # duplicate idempotency key -> no-op
    vid = f"vid-{inst}"
    for shot in range(1, 7):
        deduct(_req(inst, 100 + shot, request_type="ai_video", model="fal-ai/veo3", batch_id=vid,
                    precomputed_credits=Decimal("12.5"), description=f"AI video shot {shot} (8s, audio)",
                    use_case="ai_video_clip", idempotency_key=None, user_id=None, user_role=None,
                    actor_kind="SYSTEM", surface="SCHEDULED"))
    s = _session(engine)
    try:
        r = cs_mod.CreditService(s).refund_credits(inst, Decimal("12.5"), "AI video shot 2 refund: safety",
                                                   batch_id=vid)
        out.append({"refund": str(r.credits_deducted), "ok": r.success})
    finally:
        s.close()
    refund_video(engine, inst, vid)
    msvc.wait_for_background()
    return out


def _orig_refund_video(cs_mod):
    def run(engine, inst, vid):
        s = _session(engine)
        try:
            total = s.execute(text(
                "SELECT COALESCE(SUM(CASE WHEN transaction_type = 'USAGE_DEDUCTION' THEN ABS(amount) "
                "WHEN transaction_type = 'REFUND' THEN -ABS(amount) ELSE 0 END), 0) FROM credit_transactions "
                "WHERE batch_id = :v AND transaction_type IN ('USAGE_DEDUCTION', 'REFUND') AND institute_id = :i"),
                {"v": vid, "i": inst}).scalar()
            if Decimal(str(total)) > 0:
                cs_mod.CreditService(s).refund_credits(inst, Decimal(str(total)),
                                                       f"Full refund for failed video generation {vid}", batch_id=vid)
        finally:
            s.close()
    return run


def _new_refund_video(engine, inst, vid):
    from ai_service.app.services.token_usage_service import TokenUsageService

    s = _session(engine)
    try:
        TokenUsageService(s).refund_video_credits(vid, inst)
    finally:
        s.close()


def _ledger(engine, inst):
    with engine.connect() as c:
        return [dict(r._mapping) for r in c.execute(text(
            "SELECT request_type, model_name, amount, balance_after, transaction_type, user_id, user_role, "
            "subject_user_id, batch_id, external_reference_id, description, reference_id "
            "FROM credit_transactions WHERE institute_id = :i ORDER BY created_at, id"), {"i": inst})]


def _ledger_sorted(engine, inst):
    rows = _ledger(engine, inst)
    return sorted(rows, key=lambda r: json.dumps(r, default=str, sort_keys=True))


def _balance(engine, inst):
    with engine.connect() as c:
        r = c.execute(text("SELECT current_balance, used_credits, total_credits FROM institute_credits "
                           "WHERE institute_id = :i"), {"i": inst}).fetchone()
    return [str(x) for x in r] if r else None


EVENT_COLS = ("use_case", "use_case_source", "feature_group", "actor_kind", "actor_role_class", "surface",
              "request_type", "tool_key", "model_id", "billing_mode", "charge_status", "credits_charged",
              "list_credits", "refunded_credits", "batch_id", "idempotency_key", "limit_decision", "free_reason")


def _events(engine, inst, cols=EVENT_COLS):
    with engine.connect() as c:
        rows = [dict(r._mapping) for r in c.execute(text(
            f"SELECT {', '.join(cols)}, (ledger_tx_id IS NOT NULL) AS linked, shadow_billing_mode, subscription_id, "
            "plan_id, plan_item_id FROM ai_usage_event WHERE institute_id = :i"), {"i": inst})]
    return sorted(rows, key=lambda r: json.dumps(r, default=str, sort_keys=True))


def _strip_plan(rows):
    return [{k: v for k, v in r.items() if k not in ("shadow_billing_mode", "subscription_id", "plan_id",
                                                       "plan_item_id")} for r in rows]


# ── plan + subscription fixtures (SQL, like the super-admin API writes them) ──

def _plan(engine, *, tutor_cap, allowance):
    """A PUBLISHED version: tutor_chat INCLUDED (ANY model, institute credit cap
    `tutor_cap`), video features ALLOWANCE, ai_calling CHARGED."""
    with engine.begin() as c:
        pid = c.execute(text("INSERT INTO ai_plan (plan_key, name, created_by) VALUES (:k, 'Test plan', 'test') "
                             "RETURNING id"), {"k": f"t_{uuid.uuid4().hex[:8]}"}).scalar()
        vid = c.execute(text(
            "INSERT INTO ai_plan_version (plan_id, version_no, status, price_minor, allowance_credits, "
            "internal_cost_cap_usd, created_by) VALUES (:p, 1, 'DRAFT', 500000, :a, NULL, 'test') RETURNING id"),
            {"p": pid, "a": allowance}).scalar()
        for fk, mode, cap in (("tutor_chat", "INCLUDED", tutor_cap), ("ai_video_clips", "ALLOWANCE", None),
                              ("video_lesson", "ALLOWANCE", None), ("ai_calling", "CHARGED", None)):
            c.execute(text("INSERT INTO ai_plan_item (plan_version_id, feature_key, mode, model_policy, "
                           "inst_credits_cap) VALUES (:v, :f, :m, 'ANY', :cap)"),
                      {"v": vid, "f": fk, "m": mode, "cap": cap})
        c.execute(text("UPDATE ai_plan_version SET status = 'PUBLISHED', published_at = now(), "
                       "published_by = 'test' WHERE id = :v"), {"v": vid})
    return str(pid), str(vid)


def _subscribe(engine, inst, version_id, enforcement):
    start = datetime.now(UTC) - timedelta(days=1)
    with engine.begin() as c:
        sid = c.execute(text(
            "INSERT INTO institute_ai_subscription (institute_id, plan_version_id, status, enforcement, source, "
            "anchor_at, start_at, period_months, created_by, reason) VALUES (:i, :v, 'ACTIVE', :e, 'MANUAL', :s, :s, "
            "1, 'test', 'test') RETURNING id"), {"i": inst, "v": version_id, "e": enforcement, "s": start}).scalar()
    return str(sid)


def _enable_plans(engine):
    SETTINGS["billing.plans.enabled"] = True
    P.invalidate()
    s = _session(engine)
    try:
        assert P.refresh_index(s)     # the real bulk index query, on Postgres
    finally:
        s.close()


def _period(engine, sub_id):
    with engine.connect() as c:
        r = c.execute(text("SELECT allowance_credits, allowance_used FROM ai_subscription_period "
                           "WHERE subscription_id = :s"), {"s": sub_id}).fetchone()
    return (Decimal(str(r[0])), Decimal(str(r[1]))) if r else None


def _plan_counter(engine, inst, key):
    with engine.connect() as c:
        r = c.execute(text("SELECT credits_used, count_used FROM ai_usage_counter WHERE institute_id = :i "
                           "AND period = 'PLAN_PERIOD' AND counter_key = :k"), {"i": inst, "k": key}).fetchone()
    return (Decimal(str(r[0])), Decimal(str(r[1]))) if r else None


def _q2(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"))


def _deduct(engine, r):
    s = _session(engine)
    try:
        return new_cs.CreditService(s).deduct_credits(r)
    finally:
        s.close()


# ── 1 + 4: zero disruption, compared with origin/main ────────────────────────

def test_plans_off_or_no_subscription_and_shadow_match_origin(dbs, orig_cs, monkeypatch):
    _alerts_off(monkeypatch, orig_cs, new_cs)
    o = dbs.fresh("orig")
    n = dbs.fresh("new")
    if not o.has_pricing:
        for m in (orig_cs, new_cs):
            monkeypatch.setattr(m.CreditService, "calculate_credits", lambda self, **kw: Decimal("1.2345"))

    # origin/main: RICH (for plans off), RICH2 (plans on, no subscription), SHADOW, POOR.
    want = {inst: _workload(o, orig_cs, inst, refund_video=_orig_refund_video(orig_cs))
            for inst in (RICH, RICH2, SHADOW)}
    want_poor = [orig_cs.CreditService(_session(o)).deduct_credits(_req(POOR, i)).model_dump() for i in range(2)]
    msvc.wait_for_background()

    # (1a) new code, plans disabled
    n.statements.clear()
    got = _workload(n, new_cs, RICH, refund_video=_new_refund_video)
    got_poor = [new_cs.CreditService(_session(n)).deduct_credits(_req(POOR, i)).model_dump() for i in range(2)]
    msvc.wait_for_background()
    assert [x for x in n.statements if PLAN_SQL.search(x)] == []
    assert got == want[RICH]
    assert [dict(d, transaction_id="") for d in got_poor] == [dict(d, transaction_id="") for d in want_poor]
    for inst in (RICH, POOR):
        assert _ledger(n, inst) == _ledger(o, inst), inst
        assert _balance(n, inst) == _balance(o, inst), inst
        assert _events(n, inst) == _events(o, inst), inst
    assert len(_ledger(n, RICH)) >= 40 + 2

    # (1b) plans ENABLED; RICH2 has no subscription (SHADOW's sub exists): still today's
    pid, vid = _plan(n, tutor_cap=Decimal("1000000"), allowance=Decimal("1000000"))
    shadow_sub = _subscribe(n, SHADOW, vid, "SHADOW")
    _enable_plans(n)
    assert P.has_live_subscription(SHADOW) and not P.has_live_subscription(RICH2)
    n.statements.clear()
    got2 = _workload(n, new_cs, RICH2, refund_video=_new_refund_video)
    assert [x for x in n.statements if PLAN_SQL.search(x)] == []
    assert got2 == want[RICH2]
    assert _ledger(n, RICH2) == _ledger(o, RICH2)
    assert _balance(n, RICH2) == _balance(o, RICH2)
    assert _events(n, RICH2) == _events(o, RICH2)

    # (4) SHADOW: responses, ledger and balance exactly as origin; events tagged
    got3 = _workload(n, new_cs, SHADOW, refund_video=_new_refund_video)
    assert got3 == want[SHADOW]
    assert _ledger(n, SHADOW) == _ledger(o, SHADOW)
    assert _balance(n, SHADOW) == _balance(o, SHADOW)
    ev_new, ev_old = _events(n, SHADOW), _events(o, SHADOW)
    assert _strip_plan(ev_new) == _strip_plan(ev_old)
    tutor = [e for e in ev_new if e["use_case"] == "tutor_chat"]
    clips = [e for e in ev_new if e["use_case"] == "ai_video_clip"]
    assert tutor and all(e["billing_mode"] == "CHARGED" and e["shadow_billing_mode"] == "INCLUDED"
                         and str(e["subscription_id"]) == shadow_sub and str(e["plan_id"]) == pid for e in tutor)
    assert clips and all(e["shadow_billing_mode"] == "ALLOWANCE" for e in clips)
    # SHADOW reserves nothing: no counters, no allowance consumed
    with n.connect() as c:
        assert c.execute(text("SELECT count(*) FROM ai_usage_counter WHERE institute_id = :i"),
                         {"i": SHADOW}).scalar() == 0
        used = c.execute(text("SELECT COALESCE(SUM(allowance_used), 0) FROM ai_subscription_period "
                              "WHERE subscription_id = :s"), {"s": shadow_sub}).scalar()
    assert Decimal(str(used)) == 0


# ── 2, 3, 5, 6: a LIVE subscription ──────────────────────────────────────────

def test_live_included_allowance_split_refund_and_check(dbs, monkeypatch):
    _alerts_off(monkeypatch, new_cs)
    n = dbs.fresh("live")
    if not n.has_pricing:
        monkeypatch.setattr(new_cs.CreditService, "calculate_credits", lambda self, **kw: Decimal("1.2345"))
    s = _session(n)
    try:
        per = new_cs.CreditService(s).calculate_credits(request_type="conversation", model=MODEL,
                                                        prompt_tokens=1000, completion_tokens=400)
    finally:
        s.close()
    assert per > 0
    clip = Decimal("12.5")
    pid, vid = _plan(n, tutor_cap=per * 3, allowance=clip * Decimal("2.4"))
    sub = _subscribe(n, LIVE, vid, "LIVE")
    zero_sub = _subscribe(n, ZERO, vid, "LIVE")
    _subscribe(n, NOWALLET, vid, "LIVE")
    _enable_plans(n)
    bal0 = _balance(n, LIVE)

    # (2) INCLUDED x3: no ledger row, balance unchanged, counters move
    for i in range(3):
        r = _deduct(n, _req(LIVE, i, prompt_tokens=1000, completion_tokens=400))
        assert r.success and r.credits_deducted == 0 and r.new_balance == Decimal(bal0[0])
        assert r.transaction_id      # the usage event id
    assert _ledger(n, LIVE) == []
    assert _balance(n, LIVE) == bal0
    ev = [e for e in _events(n, LIVE) if e["use_case"] == "tutor_chat"]
    assert len(ev) == 3 and all(e["billing_mode"] == "INCLUDED" and Decimal(e["list_credits"]) == per
                                and Decimal(e["credits_charged"]) == 0 and not e["linked"]
                                and str(e["subscription_id"]) == sub and str(e["plan_id"]) == pid for e in ev)
    cnt = _plan_counter(n, LIVE, f"PLAN:{sub}|F:tutor_chat")
    assert cnt == (per * 3, Decimal("3"))
    # a retry of an included charge is a no-op (its event is the idempotency record)
    again = _deduct(n, _req(LIVE, 1, prompt_tokens=1000, completion_tokens=400))
    assert again.success and again.credits_deducted == 0 and "idempotent" in again.message
    assert _plan_counter(n, LIVE, f"PLAN:{sub}|F:tutor_chat") == cnt
    # cap reached -> the 4th is CHARGED with a normal ledger row
    r4 = _deduct(n, _req(LIVE, 3, prompt_tokens=1000, completion_tokens=400))
    assert r4.success and r4.credits_deducted == per
    led = _ledger(n, LIVE)
    assert len(led) == 1 and Decimal(led[0]["amount"]) == -per and led[0]["transaction_type"] == "USAGE_DEDUCTION"
    # (institute_credits stores 2 decimals in the prod schema: every UPDATE rounds)
    assert Decimal(led[0]["balance_after"]) == _q2(Decimal(bal0[0]) - per)
    assert _plan_counter(n, LIVE, f"PLAN:{sub}|F:tutor_chat") == cnt     # an over-cap charge is not counted

    # (3) ALLOWANCE: 12.5, 12.5, then SPLIT (5 allowance + 7.5 wallet), then CHARGED
    vbatch = f"vid-{LIVE}"
    resp = []
    for shot in range(1, 5):
        resp.append(_deduct(n, _req(LIVE, 200 + shot, request_type="ai_video", model="fal-ai/veo3", batch_id=vbatch,
                                    precomputed_credits=clip, description=f"AI video shot {shot} (8s, audio)",
                                    use_case="ai_video_clip", idempotency_key=None, actor_kind="SYSTEM",
                                    user_id=None, user_role=None, surface="SCHEDULED")))
    assert [x.credits_deducted for x in resp] == [0, 0, Decimal("7.5"), clip]
    allowance, used = _period(n, sub)
    assert allowance == clip * Decimal("2.4") and used == allowance      # 30 of 30
    vled = [x for x in _ledger(n, LIVE) if x["batch_id"] == vbatch]
    assert [Decimal(x["amount"]) for x in vled] == [Decimal("-7.5"), -clip]
    with n.connect() as c:
        modes = [tuple(r) for r in c.execute(text(
            "SELECT billing_mode, list_credits, credits_charged, (ledger_tx_id IS NOT NULL) FROM ai_usage_event "
            "WHERE batch_id = :b ORDER BY occurred_at"), {"b": vbatch})]
    assert [(m, Decimal(lc), Decimal(cc), linked) for m, lc, cc, linked in modes] == [
        ("ALLOWANCE", clip, Decimal("0"), False), ("ALLOWANCE", clip, Decimal("0"), False),
        ("SPLIT", clip, Decimal("7.5"), True), ("CHARGED", clip, clip, True)]
    bal_before_refund = Decimal(_balance(n, LIVE)[0])
    assert bal_before_refund == _q2(_q2(_q2(Decimal(bal0[0]) - per) - Decimal("7.5")) - clip)

    # (5) per-shot refund of an ALLOWANCE shot: allowance back, the wallet gets nothing
    s = _session(n)
    try:
        rr = new_cs.CreditService(s).refund_credits(LIVE, clip, "AI video shot 1 refund: safety", batch_id=vbatch)
    finally:
        s.close()
    assert rr.success and rr.credits_deducted == 0
    assert _period(n, sub)[1] == allowance - clip
    assert Decimal(_balance(n, LIVE)[0]) == bal_before_refund
    assert not [x for x in _ledger(n, LIVE) if x["transaction_type"] == "REFUND"]
    # per-shot refund of the SPLIT shot: 7.5 to the wallet, 5 back to the allowance
    s = _session(n)
    try:
        rr = new_cs.CreditService(s).refund_credits(LIVE, clip, "AI video shot 3 refund: timeout", batch_id=vbatch)
    finally:
        s.close()
    assert rr.credits_deducted == Decimal("7.5")
    assert _period(n, sub)[1] == allowance - clip - Decimal("5")
    assert Decimal(_balance(n, LIVE)[0]) == bal_before_refund + Decimal("7.5")
    # full refund of the failed video: the rest of the allowance and the wallet part (shot 4) come back
    _new_refund_video(n, LIVE, vbatch)
    msvc.wait_for_background()
    assert _period(n, sub)[1] == 0
    assert Decimal(_balance(n, LIVE)[0]) == bal_before_refund + Decimal("7.5") + clip
    refunds = [Decimal(x["amount"]) for x in _ledger(n, LIVE) if x["transaction_type"] == "REFUND"]
    assert sorted(refunds) == sorted([Decimal("7.5"), clip])     # wallet parts only, never the allowance parts
    with n.connect() as c:
        st = [tuple(r) for r in c.execute(text(
            "SELECT billing_mode, charge_status, refunded_credits FROM ai_usage_event WHERE batch_id = :b "
            "ORDER BY occurred_at"), {"b": vbatch})]
    assert [(m, s_, Decimal(rc)) for m, s_, rc in st] == [
        ("ALLOWANCE", "REFUNDED", clip), ("ALLOWANCE", "REFUNDED", clip), ("SPLIT", "REFUNDED", clip),
        ("CHARGED", "REFUNDED", clip)]

    # (6) balance 0 / no wallet + LIVE included feature: allowed, no wallet or grant created
    for inst in (ZERO, NOWALLET):
        s = _session(n)
        try:
            chk = new_cs.CreditService(s).check_credits(CreditCheckRequest(
                institute_id=inst, request_type="conversation", model=MODEL, estimated_tokens=500,
                use_case="tutor_chat", actor_kind="USER", actor_user_id=USER, actor_role_class="LEARNER"))
        finally:
            s.close()
        assert chk.has_sufficient_credits is True and chk.current_balance == 0, inst
    with n.connect() as c:
        assert c.execute(text("SELECT count(*) FROM institute_credits WHERE institute_id = :i"),
                         {"i": NOWALLET}).scalar() == 0
        assert c.execute(text("SELECT count(*) FROM credit_transactions WHERE institute_id IN (:a, :b)"),
                         {"a": ZERO, "b": NOWALLET}).scalar() == 0
    # an always-charged feature on the same zero-balance LIVE institute: today's 402 answer
    s = _session(n)
    try:
        chk = new_cs.CreditService(s).check_credits(CreditCheckRequest(
            institute_id=ZERO, request_type="content", model=MODEL, estimated_tokens=5000, use_case="ai_calling"))
    finally:
        s.close()
    assert chk.estimated_cost > 0 and chk.has_sufficient_credits is False and "AI plan" not in chk.message
    assert _period(n, zero_sub) is None or _period(n, zero_sub)[1] == 0


def test_concurrent_duplicates_and_allowance_race(dbs, monkeypatch):
    """Same idempotency key x8 in parallel on an INCLUDED feature: one event,
    one counter increment. 12 parallel clip charges against a 50-credit
    allowance: allowance never over-spent, wallet ledger = exactly the rest."""
    from concurrent.futures import ThreadPoolExecutor

    _alerts_off(monkeypatch, new_cs)
    n = dbs.fresh("race")
    if not n.has_pricing:
        monkeypatch.setattr(new_cs.CreditService, "calculate_credits", lambda self, **kw: Decimal("1.2345"))
    clip = Decimal("12.5")
    _pid, vid = _plan(n, tutor_cap=Decimal("1000000"), allowance=Decimal("50"))
    sub = _subscribe(n, LIVE, vid, "LIVE")
    _enable_plans(n)
    bal0 = Decimal(_balance(n, LIVE)[0])

    with ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(lambda _i: _deduct(n, _req(LIVE, 7, prompt_tokens=1000, completion_tokens=400)), range(8)))
    assert all(r.success and r.credits_deducted == 0 for r in res)
    with n.connect() as c:
        assert c.execute(text("SELECT count(*) FROM ai_usage_event WHERE idempotency_key = :k"),
                         {"k": f"k-{LIVE}-7"}).scalar() == 1
    assert _plan_counter(n, LIVE, f"PLAN:{sub}|F:tutor_chat")[1] == Decimal("1")
    assert _ledger(n, LIVE) == []

    def clip_charge(i):
        return _deduct(n, _req(LIVE, 500 + i, request_type="ai_video", model="fal-ai/veo3", batch_id="race",
                               precomputed_credits=clip, description=f"AI video shot {i} (8s, audio)",
                               use_case="ai_video_clip", idempotency_key=None, actor_kind="SYSTEM",
                               user_id=None, user_role=None))

    with ThreadPoolExecutor(max_workers=6) as ex:
        res = list(ex.map(clip_charge, range(12)))
    assert all(r.success for r in res)
    wallet = sum((r.credits_deducted for r in res), Decimal("0"))
    allowance, used = _period(n, sub)
    assert used == allowance == Decimal("50")
    assert wallet == clip * 12 - used
    led = sum((-Decimal(x["amount"]) for x in _ledger(n, LIVE) if x["batch_id"] == "race"), Decimal("0"))
    assert led == wallet
    assert Decimal(_balance(n, LIVE)[0]) == _q2(bal0 - wallet)
    with n.connect() as c:
        rows = c.execute(text("SELECT billing_mode, list_credits, credits_charged FROM ai_usage_event "
                              "WHERE batch_id = 'race'")).all()
    assert len(rows) == 12 and all(Decimal(r[1]) == clip for r in rows)
    assert sum((Decimal(r[1]) - Decimal(r[2]) for r in rows), Decimal("0")) == used


# ── review fixes (money): replays, refunds and periods after a plan stops being live ──

def _video_req(inst, shot, batch, credits, **kw):
    fields = dict(request_type="ai_video", model="fal-ai/veo3", batch_id=batch, precomputed_credits=credits,
                  description=f"AI video shot {shot} (8s, audio)", use_case="ai_video_clip", idempotency_key=None,
                  actor_kind="SYSTEM", user_id=None, user_role=None, surface="SCHEDULED")
    fields.update(kw)
    return _req(inst, 900 + shot, **fields)


def _refund(engine, inst, amount, batch, desc):
    s = _session(engine)
    try:
        return new_cs.CreditService(s).refund_credits(inst, Decimal(str(amount)), desc, batch_id=batch)
    finally:
        s.close()


def _cancel_now(engine, inst):
    with engine.begin() as c:
        c.execute(text("UPDATE institute_ai_subscription SET status = 'CANCELLED', end_at = now(), auto_renew = false "
                       "WHERE institute_id = :i"), {"i": inst})
    P.invalidate(inst, live=False)


def test_review_lesson_teacher_rerun_after_allowance_only_refund_is_billed(dbs, monkeypatch):
    """A lesson whose teacher was paid entirely from the allowance, then fully
    refunded (no REFUND ledger row): the re-run gets a NEW idempotency key and
    is paid again (from the allowance), never an idempotent no-op."""
    from ai_service.app.services.video_generation_service import _lesson_teacher_idempotency_key

    _alerts_off(monkeypatch, new_cs)
    n = dbs.fresh("teacher")
    _pid, vid = _plan(n, tutor_cap=Decimal("1000"), allowance=Decimal("100"))
    sub = _subscribe(n, LIVE, vid, "LIVE")
    _enable_plans(n)
    video = f"vid-teacher-{uuid.uuid4().hex[:6]}"

    def teacher(key):
        return _deduct(n, _req(LIVE, 1, request_type="avatar_video", use_case="lesson_video", model="spatius",
                               precomputed_credits=Decimal("30"), batch_id=video, idempotency_key=key,
                               allow_negative=True, description="Lesson teacher (Spatius) for AI video",
                               actor_kind="SYSTEM", user_id=None, user_role=None))

    s = _session(n)
    k1 = _lesson_teacher_idempotency_key(s, video, LIVE)
    s.close()
    r1 = teacher(k1)
    assert r1.success and r1.credits_deducted == 0 and _period(n, sub)[1] == Decimal("30")
    _new_refund_video(n, LIVE, video)
    msvc.wait_for_background()
    assert _period(n, sub)[1] == 0 and _ledger(n, LIVE) == []
    s = _session(n)
    k2 = _lesson_teacher_idempotency_key(s, video, LIVE)
    s.close()
    assert k2 != k1 and k2.endswith(":refund1")
    r2 = teacher(k2)
    assert r2.success and "idempotent" not in r2.message
    assert _period(n, sub)[1] == Decimal("30")           # the re-run is paid (allowance again)


def test_review_refund_after_cancel_credits_only_the_wallet_part(dbs, monkeypatch):
    """Shot 1 all-allowance, shot 2 SPLIT (40 allowance + 20 wallet), then the
    subscription is cancelled, then per-shot refunds of 60 each: the wallet
    gets back 20 (what it paid), never 120."""
    _alerts_off(monkeypatch, new_cs)
    n = dbs.fresh("refcancel")
    _pid, vid = _plan(n, tutor_cap=Decimal("1000"), allowance=Decimal("100"))
    _subscribe(n, LIVE, vid, "LIVE")
    _enable_plans(n)
    bal0 = Decimal(_balance(n, LIVE)[0])
    batch = f"vid-rc-{uuid.uuid4().hex[:6]}"
    r1 = _deduct(n, _video_req(LIVE, 1, batch, Decimal("60")))
    r2 = _deduct(n, _video_req(LIVE, 2, batch, Decimal("60")))
    assert (r1.credits_deducted, r2.credits_deducted) == (0, Decimal("20"))
    _cancel_now(n, LIVE)
    assert not P.has_live_subscription(LIVE) and P.had_subscription(LIVE)
    a = _refund(n, LIVE, 60, batch, "AI video shot 1 refund: veo safety block")
    b = _refund(n, LIVE, 60, batch, "AI video shot 2 refund: veo timeout")
    assert (a.credits_deducted, b.credits_deducted) == (0, Decimal("20"))
    assert Decimal(_balance(n, LIVE)[0]) == bal0
    assert sorted(Decimal(x["amount"]) for x in _ledger(n, LIVE)) == [Decimal("-20"), Decimal("20")]
    # the same with the flag switched OFF afterwards (a pod that loaded the index keeps it)
    batch2 = f"vid-rc2-{uuid.uuid4().hex[:6]}"
    _subscribe(n, RICH, vid, "LIVE")
    _enable_plans(n)
    _deduct(n, _video_req(RICH, 1, batch2, Decimal("10")))
    SETTINGS["billing.plans.enabled"] = False
    assert not P.has_live_subscription(RICH) and P.had_subscription(RICH)
    bal_r = Decimal(_balance(n, RICH)[0])
    c = _refund(n, RICH, 10, batch2, "AI video shot 1 refund: veo safety block")
    assert c.credits_deducted == 0 and Decimal(_balance(n, RICH)[0]) == bal_r


def test_review_fresh_pod_before_index_load_refunds_plan_aware(dbs, monkeypatch):
    """Plans on, the pod has not loaded its index yet: a refund of an
    allowance-paid batch is still plan-aware (not today's full credit)."""
    _alerts_off(monkeypatch, new_cs)
    n = dbs.fresh("freshpod")
    _pid, vid = _plan(n, tutor_cap=Decimal("1000"), allowance=Decimal("100"))
    _subscribe(n, LIVE, vid, "LIVE")
    _enable_plans(n)
    batch = f"vid-fp-{uuid.uuid4().hex[:6]}"
    assert _deduct(n, _video_req(LIVE, 1, batch, Decimal("25"))).credits_deducted == 0
    bal = Decimal(_balance(n, LIVE)[0])
    P.reset_for_tests()                      # a new pod: nothing loaded, flag on
    assert not P.has_live_subscription(LIVE) and P.had_subscription(LIVE)
    r = _refund(n, LIVE, 25, batch, "AI video shot 1 refund: veo safety block")
    assert r.credits_deducted == 0 and Decimal(_balance(n, LIVE)[0]) == bal
    # an institute that never had a subscription: today's refund, unchanged
    rr = _refund(n, RICH2, 5, f"b-{RICH2}", "AI video shot 1 refund: x")
    assert rr.credits_deducted == Decimal("5")


def test_review_idempotent_replay_after_cancel_is_a_noop(dbs, monkeypatch):
    _alerts_off(monkeypatch, new_cs)
    n = dbs.fresh("replay")
    if not n.has_pricing:
        monkeypatch.setattr(new_cs.CreditService, "calculate_credits", lambda self, **kw: Decimal("1.2345"))
    _pid, vid = _plan(n, tutor_cap=Decimal("1000000"), allowance=Decimal("0"))
    _subscribe(n, LIVE, vid, "LIVE")
    _enable_plans(n)
    bal0 = _balance(n, LIVE)
    first = _deduct(n, _req(LIVE, 1))
    assert first.success and first.credits_deducted == 0
    _cancel_now(n, LIVE)
    again = _deduct(n, _req(LIVE, 1))
    assert again.success and again.credits_deducted == 0 and "idempotent" in again.message
    assert _ledger(n, LIVE) == [] and _balance(n, LIVE) == bal0
    # a NEW key after the cancel is charged as today
    third = _deduct(n, _req(LIVE, 2))
    assert third.credits_deducted > 0


def test_review_non_renewing_subscription_gets_no_free_period(dbs, monkeypatch):
    """auto_renew off, its only period ended 5 days ago (allowance used up), an
    admin edit a minute ago, roll not run: charges are CHARGED (no new period),
    and the roll then EXPIRES the subscription."""
    from ai_service.app.routers import plans_internal

    _alerts_off(monkeypatch, new_cs)
    n = dbs.fresh("norenew")
    if not n.has_pricing:
        monkeypatch.setattr(new_cs.CreditService, "calculate_credits", lambda self, **kw: Decimal("1.2345"))
    _pid, vid = _plan(n, tutor_cap=Decimal("1000000"), allowance=Decimal("100"))
    sub = _subscribe(n, LIVE, vid, "LIVE")
    with n.begin() as c:
        c.execute(text("UPDATE institute_ai_subscription SET anchor_at = now() - interval '35 days', "
                       "start_at = now() - interval '35 days', auto_renew = false, "
                       "updated_at = now() - interval '1 minute' WHERE id = :s"), {"s": sub})
        c.execute(text("INSERT INTO ai_subscription_period (subscription_id, period_start, period_end, plan_version_id, "
                       "price_minor_snapshot, allowance_credits, allowance_used) SELECT id, anchor_at, "
                       "anchor_at + interval '1 month', plan_version_id, 500000, 100, 100 "
                       "FROM institute_ai_subscription WHERE id = :s"), {"s": sub})
    _enable_plans(n)
    r = _deduct(n, _req(LIVE, 1))
    assert r.credits_deducted > 0                                 # tutor_chat: charged, not included
    v = _deduct(n, _video_req(LIVE, 1, "nr-batch", Decimal("40")))
    assert v.credits_deducted == Decimal("40")                    # not paid from a new period's allowance
    with n.connect() as c:
        assert c.execute(text("SELECT count(*) FROM ai_subscription_period WHERE subscription_id = :s"),
                         {"s": sub}).scalar() == 1
    s = _session(n)
    try:
        rep = plans_internal.roll(s)
    finally:
        s.close()
    assert any(ch["subscription_id"] == sub and "EXPIRED" in ch["actions"] for ch in rep["changed"]), rep
    with n.connect() as c:
        assert c.execute(text("SELECT status FROM institute_ai_subscription WHERE id = :s"),
                         {"s": sub}).scalar() == "EXPIRED"


def test_review_pnl_estimates_cost_and_wallet_only_charged(dbs, monkeypatch):
    """INCLUDED uses without a real cost are costed at list/150 (like simulate),
    flagged as estimated; refunded allowance parts never make charged_credits
    negative."""
    _alerts_off(monkeypatch, new_cs)
    n = dbs.fresh("pnl")
    _pid, vid = _plan(n, tutor_cap=Decimal("1000000"), allowance=Decimal("100"))
    _subscribe(n, LIVE, vid, "LIVE")
    _enable_plans(n)
    for i in range(3):
        assert _deduct(n, _req(LIVE, i, precomputed_credits=Decimal("150"))).credits_deducted == 0
    batch = f"vid-pnl-{uuid.uuid4().hex[:6]}"
    _deduct(n, _video_req(LIVE, 1, batch, Decimal("30")))
    _refund(n, LIVE, 30, batch, "AI video shot 1 refund: veo safety block")
    msvc.wait_for_background()
    s = _session(n)
    try:
        row = P.pnl(s, institute_id=LIVE)[0]
        sim = P.simulate(s, vid, LIVE, days=1)
    finally:
        s.close()
    assert row["included_list_credits"] == 450
    assert row["included_cost_usd"] == pytest.approx(3.0)
    assert row["plan_cost_inr"] == pytest.approx(3.0 * 86, abs=0.01)
    assert row["margin_pct"] < 100 and row["cost_basis"] == "ESTIMATED" and row["cost_estimated_events"] == 4
    assert row["charged_credits"] == 0
    assert sim["totals"]["plan_cost_inr"] == pytest.approx(row["plan_cost_inr"], abs=0.01)


def test_review_kb_ingest_tool_uses_the_allowance_not_kb_qa(dbs, monkeypatch):
    """knowledge_base maps to kb_qa (INCLUDED); its ingest / unlock tools bill
    as kb_ingest (ALLOWANCE_ONLY): paid from the allowance, never free."""
    _alerts_off(monkeypatch, new_cs)
    n = dbs.fresh("kbingest")
    with n.begin() as c:
        pid = c.execute(text("INSERT INTO ai_plan (plan_key, name, created_by) VALUES (:k, 'KB', 'test') "
                             "RETURNING id"), {"k": f"kb_{uuid.uuid4().hex[:8]}"}).scalar()
        vid = c.execute(text("INSERT INTO ai_plan_version (plan_id, version_no, status, price_minor, allowance_credits, "
                             "created_by) VALUES (:p, 1, 'DRAFT', 500000, 10, 'test') RETURNING id"), {"p": pid}).scalar()
        for fk, mode in (("kb_qa", "INCLUDED"), ("kb_ingest", "ALLOWANCE")):
            c.execute(text("INSERT INTO ai_plan_item (plan_version_id, feature_key, mode, model_policy) "
                           "VALUES (:v, :f, :m, 'ANY')"), {"v": vid, "f": fk, "m": mode})
        c.execute(text("UPDATE ai_plan_version SET status = 'PUBLISHED' WHERE id = :v"), {"v": vid})
    sub = _subscribe(n, LIVE, str(vid), "LIVE")
    _enable_plans(n)
    ask = _deduct(n, _req(LIVE, 1, request_type="content", use_case=None, tool_key="kb_ask",
                          precomputed_credits=Decimal("1"), allow_negative=True))
    assert ask.credits_deducted == 0 and "included" in ask.message
    ing = _deduct(n, _req(LIVE, 2, request_type="content", use_case=None, tool_key="kb_ingest_page",
                          precomputed_credits=Decimal("25"), allow_negative=True))
    assert ing.credits_deducted == Decimal("15")              # 10 from the allowance, 15 from the wallet
    assert _period(n, sub)[1] == Decimal("10")
    with n.connect() as c:
        modes = sorted(r[0] for r in c.execute(text(
            "SELECT billing_mode FROM ai_usage_event WHERE institute_id = :i"), {"i": LIVE}))
    assert modes == ["INCLUDED", "SPLIT"]
