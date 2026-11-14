"""AI subscription plan engine (services/metering/plans.py) on a REAL Postgres 16
with the real Flyway migrations V586 (metering) + V587 (limits) + V588 (plans),
driven through SQLAlchemy + psycopg 3 (the prod driver, where INSERT .. ON
CONFLICT reports rowcount -1: every decision here is made by RETURNING).

What must hold:
  * two threads racing for the last allowance credit: one ALLOWANCE and one
    CHARGED (or SPLIT for a half credit); many threads never consume more than
    the allowance (row lock + guarded UPDATE .. RETURNING);
  * many threads against a fair-use unit cap: exactly the cap is INCLUDED;
  * a lazily opened period is created exactly once under a race;
  * a lock timeout inside the plan savepoint fails SAFE (CHARGED) and the
    caller's (ledger) transaction stays usable and commits (critique C20);
  * release() undoes counters and allowance; SHADOW writes nothing; an
    institute without a subscription issues ZERO statements;
  * the real V586 catalog maps through V588's billing_feature_key;
  * limits' rebuild_counters never touches PLAN_PERIOD counters;
  * simulate / pnl run on Postgres SQL.

Needs a Postgres: AI_LIMITS_PG_URL (server URL, postgresql+psycopg://...) or
AI_LIMITS_PGDATA (a pgserver data directory); AI_LIMITS_PG_TEMPLATE=<db> clones
a template (e.g. 'prodbase'). Skipped otherwise. Run from the repo root:
  AI_LIMITS_PGDATA=<dir> <venv>/bin/python -m pytest ai_service/tests/test_plans_engine_pg.py -q -p no:cacheprovider
"""
from __future__ import annotations

import os
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import create_engine, event, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from ai_service.app.services import model_selection  # noqa: E402
from ai_service.app.services.metering import cache as mcache  # noqa: E402
from ai_service.app.services.metering import limits as L  # noqa: E402
from ai_service.app.services.metering import plans as P  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parents[2] / "admin_core_service/src/main/resources/db/migration"
UTC = timezone.utc
D = Decimal
INST = "inst-plan-pg"
GLM = "z-ai/glm-5.3-flash"

# The pre-existing tables the migrations ALTER / the engine reads (only the columns needed).
STUBS = """
CREATE TABLE IF NOT EXISTS credit_transactions (id UUID PRIMARY KEY, institute_id VARCHAR(64), amount NUMERIC);
CREATE TABLE IF NOT EXISTS ai_token_usage (id UUID PRIMARY KEY, institute_id VARCHAR(64));
CREATE TABLE IF NOT EXISTS ai_model_defaults (use_case VARCHAR(64) PRIMARY KEY, default_model_id VARCHAR(255),
                                              fallback_model_id VARCHAR(255));
CREATE TABLE IF NOT EXISTS plans_test_ledger (id UUID PRIMARY KEY, institute_id VARCHAR(64), amount NUMERIC);
"""


def _migration(prefix: str) -> str:
    hits = sorted(MIGRATIONS.glob(f"{prefix}__*.sql"))
    if not hits:
        pytest.skip(f"{prefix} migration not in this checkout")
    return hits[0].read_text(encoding="utf-8")


def _run_script(engine, body: str) -> None:
    """One migration file in ONE transaction, like Flyway, through the raw DBAPI
    cursor with no parameters (V588's PL/pgSQL RAISE formats contain '%')."""
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute(body)
        raw.commit()
    except Exception:
        raw.rollback()
        raise
    finally:
        raw.close()


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


@pytest.fixture(scope="module")
def pg():
    base = _server_url()
    if not base:
        pytest.skip("no Postgres: set AI_LIMITS_PG_URL or AI_LIMITS_PGDATA")
    try:
        import psycopg  # noqa: F401,PLC0415
    except Exception:  # noqa: BLE001
        pytest.skip("psycopg 3 not installed")
    name = f"plans_{uuid.uuid4().hex[:10]}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT", future=True)
    template = os.environ.get("AI_LIMITS_PG_TEMPLATE")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"' + (f' TEMPLATE "{template}"' if template else "")))
    url = base.replace("/postgres?", f"/{name}?") if "/postgres?" in base else base.rsplit("/", 1)[0] + f"/{name}"
    engine = create_engine(url, pool_size=30, max_overflow=10, future=True)
    with engine.begin() as c:
        c.exec_driver_sql(STUBS)
    for prefix in ("V586", "V587", "V588"):
        _run_script(engine, _migration(prefix))
    yield engine
    engine.dispose()
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    P.reset_for_tests()
    L.reset_for_tests()
    mcache.reset_cache()
    model_selection.invalidate_cache()
    settings = {"billing.plans.enabled": True, "billing.inr_per_usd": 86, "metering.events.enabled": True,
                "metering.limits.enforce": True}
    monkeypatch.setattr(mcache, "setting_value", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(mcache, "peek_setting", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(P, "_maybe_refresh_index", lambda: None)
    monkeypatch.setattr(L, "_maybe_refresh_index", lambda: None)
    yield settings
    P.reset_for_tests()
    L.reset_for_tests()
    mcache.reset_cache()
    model_selection.invalidate_cache()


@pytest.fixture
def db(pg):
    with pg.begin() as c:
        for t in ("ai_usage_counter", "ai_usage_event", "ai_usage_limit", "institute_ai_limits_policy",
                  "ai_subscription_override", "ai_subscription_event", "ai_subscription_period",
                  "institute_ai_subscription", "plans_test_ledger"):
            c.execute(text(f"DELETE FROM {t}"))
        # plans stay (unique keys per test; PUBLISHED versions and their items are frozen by V588)
    Session = sessionmaker(bind=pg, future=True, expire_on_commit=False)
    s = Session()
    assert mcache.get_snapshot(s) is not None
    s.commit()
    s.close()
    P.configure(sessionmaker=Session)
    assert P.refresh_index()
    return pg


def _plan(engine, items, *, allowance=0, cost_cap=None):
    """A PUBLISHED version (items inserted while DRAFT: the freeze trigger forbids it later)."""
    key = f"pgt_{uuid.uuid4().hex[:8]}"
    with engine.begin() as c:
        pid = c.execute(text("INSERT INTO ai_plan (plan_key, name, created_by) VALUES (:k, 'PG test', 't') "
                             "RETURNING id"), {"k": key}).scalar()
        vid = c.execute(text("INSERT INTO ai_plan_version (plan_id, version_no, status, price_minor, allowance_credits, "
                             "internal_cost_cap_usd, created_by) VALUES (:p, 1, 'DRAFT', 500000, :a, :cc, 't') "
                             "RETURNING id"), {"p": pid, "a": allowance, "cc": cost_cap}).scalar()
        for fk, spec in items.items():
            c.execute(text("INSERT INTO ai_plan_item (plan_version_id, feature_key, mode, model_policy, inst_units_cap, "
                           "user_units_cap) VALUES (:v, :f, :m, :mp, :iu, :uu)"),
                      {"v": vid, "f": fk, "m": spec["mode"], "mp": spec.get("model_policy", "DEFAULT_CHAIN"),
                       "iu": spec.get("inst_units_cap"), "uu": spec.get("user_units_cap")})
        c.execute(text("UPDATE ai_plan_version SET status = 'PUBLISHED', published_at = now() WHERE id = :v"),
                  {"v": vid})
    P.invalidate()
    return str(vid)


def _subscribe(engine, vid, *, enforcement="LIVE", inst=INST):
    with engine.begin() as c:
        sid = c.execute(text(
            "INSERT INTO institute_ai_subscription (institute_id, plan_version_id, status, enforcement, anchor_at, "
            "start_at, created_by) VALUES (:i, :v, 'ACTIVE', :e, now() - interval '3 days', "
            "now() - interval '3 days', 't') RETURNING id"), {"i": inst, "v": vid, "e": enforcement}).scalar()
    P.invalidate()
    P.set_index_for_tests([inst])
    return str(sid)


def _threads(n, fn):
    barrier = threading.Barrier(n)
    out, errors = [None] * n, []

    def run(i):
        try:
            barrier.wait(10)
            out[i] = fn(i)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    ts = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(60)
    assert not errors, errors
    return out


def _decide_and_commit(engine, hold=0.0, **kw):
    Session = sessionmaker(bind=engine, future=True)
    s = Session()
    try:
        args = dict(institute_id=INST, list_credits=1, use_case="content_image", model=None, actor_user_id="u1")
        args.update(kw)
        d = P.decide(s, **args)
        if hold:
            time.sleep(hold)       # keep the row lock like a real ledger transaction would
        s.commit()
        return d
    finally:
        s.close()


def _allowance_used(engine, sid):
    with engine.connect() as c:
        return c.execute(text("SELECT allowance_used FROM ai_subscription_period WHERE subscription_id = :s"),
                         {"s": sid}).scalar()


def _set_used(engine, sid, used):
    with engine.begin() as c:
        c.execute(text("UPDATE ai_subscription_period SET allowance_used = :u WHERE subscription_id = :s"),
                  {"u": used, "s": sid})


# ── real catalog ─────────────────────────────────────────────────────────────

def test_real_catalog_maps_through_v588(db):
    assert P.feature_for(request_type="agent") == "learner_assistant"
    assert P.feature_for(request_type="ai_call_out") == "ai_calling"
    assert P.feature_for(request_type="voice_call_in") == "telephony"
    assert P.feature_for(use_case="evaluation") == "copy_check"
    assert P.feature_for(tool_key="tutor_live_minute") == "tutor_live_minutes"
    assert P.feature_for(use_case="vacademy_assistant") == "admin_assistant"
    lk = P.lookups()
    assert lk.features["ai_calling"].locked and lk.features["ai_calling"].eligibility == "ALWAYS_CHARGED"
    with db.connect() as c:
        assert c.execute(text("SELECT count(*) FROM ai_use_case_catalog WHERE billing_feature_key IS NULL")).scalar() == 0


def test_seeded_ai_pro_draft_is_inert(db):
    with db.connect() as c:
        vid = c.execute(text("SELECT v.id FROM ai_plan_version v JOIN ai_plan p ON p.id = v.plan_id "
                             "WHERE p.plan_key = 'ai_pro'")).scalar()
    _subscribe(db, str(vid))
    d = _decide_and_commit(db, use_case="learner_assistant", model=GLM)
    assert (d.billing_mode, d.reason) == ("CHARGED", "VERSION_NOT_LIVE")


# ── races ────────────────────────────────────────────────────────────────────

def test_two_threads_race_for_the_last_allowance_credit(db):
    vid = _plan(db, {"image_generation": {"mode": "ALLOWANCE"}}, allowance=10)
    sid = _subscribe(db, vid)
    assert _decide_and_commit(db).billing_mode == "ALLOWANCE"     # opens the period
    for _round in range(8):
        _set_used(db, sid, 9)
        res = _threads(2, lambda _i: _decide_and_commit(db, hold=0.05))
        assert sorted(d.billing_mode for d in res) == ["ALLOWANCE", "CHARGED"]
        charged = [d for d in res if d.billing_mode == "CHARGED"][0]
        assert (charged.reason, charged.wallet_credits) == ("ALLOWANCE_EXHAUSTED", D("1"))
        assert _allowance_used(db, sid) == D("10")


def test_two_threads_race_for_one_and_a_half_credits(db):
    vid = _plan(db, {"image_generation": {"mode": "ALLOWANCE"}}, allowance=10)
    sid = _subscribe(db, vid)
    _decide_and_commit(db)
    for _round in range(6):
        _set_used(db, sid, D("8.5"))
        res = _threads(2, lambda _i: _decide_and_commit(db, hold=0.05))
        modes = sorted(d.billing_mode for d in res)
        assert modes == ["ALLOWANCE", "SPLIT"]
        split = [d for d in res if d.billing_mode == "SPLIT"][0]
        assert (split.allowance_credits, split.wallet_credits) == (D("0.5"), D("0.5"))
        assert _allowance_used(db, sid) == D("10")


def test_many_threads_never_over_consume_the_allowance(db):
    vid = _plan(db, {"image_generation": {"mode": "ALLOWANCE"}}, allowance=12)
    sid = _subscribe(db, vid)
    _decide_and_commit(db, list_credits=2)
    res = _threads(16, lambda _i: _decide_and_commit(db, hold=0.01))
    modes = [d.billing_mode for d in res]
    assert modes.count("ALLOWANCE") == 10 and modes.count("CHARGED") == 6
    assert _allowance_used(db, sid) == D("12")
    assert sum(d.allowance_credits for d in res) == D("10")


def test_many_threads_against_a_fair_use_cap(db):
    vid = _plan(db, {"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 5}})
    sid = _subscribe(db, vid)
    res = _threads(16, lambda i: _decide_and_commit(db, use_case="learner_assistant", model=GLM, hold=0.01,
                                                     actor_user_id=f"u{i}"))
    modes = [d.billing_mode for d in res]
    assert modes.count("INCLUDED") == 5 and modes.count("CHARGED") == 11
    assert {d.reason for d in res if d.billing_mode == "CHARGED"} == {"OVER_CAP"}
    with db.connect() as c:
        row = c.execute(text("SELECT count_used, period FROM ai_usage_counter WHERE counter_key = :k"),
                        {"k": f"PLAN:{sid}|F:learner_assistant"}).first()
    assert row[0] == D("5") and row[1] == "PLAN_PERIOD"
    with db.connect() as c:
        assert c.execute(text("SELECT count(*) FROM ai_subscription_period WHERE subscription_id = :s"),
                         {"s": sid}).scalar() == 1     # opened once under the race


# ── fail safe inside the caller's transaction (C20) ─────────────────────────

def test_lock_timeout_fails_safe_and_the_ledger_transaction_commits(db):
    vid = _plan(db, {"image_generation": {"mode": "ALLOWANCE"}}, allowance=10)
    sid = _subscribe(db, vid)
    _decide_and_commit(db)
    holder = db.connect()
    tx = holder.begin()
    holder.execute(text("SELECT 1 FROM ai_subscription_period WHERE subscription_id = :s FOR UPDATE"), {"s": sid})
    try:
        s = sessionmaker(bind=db, future=True)()
        tid = str(uuid.uuid4())
        s.execute(text("INSERT INTO plans_test_ledger (id, institute_id, amount) VALUES (:i, :n, -1)"),
                  {"i": tid, "n": INST})
        t0 = time.monotonic()
        d = P.decide(s, institute_id=INST, list_credits=1, use_case="content_image")
        took = time.monotonic() - t0
        assert (d.billing_mode, d.wallet_credits, d.reason) == ("CHARGED", D("1"), "ERROR")
        assert took < 10
        s.execute(text("UPDATE plans_test_ledger SET amount = -2 WHERE id = :i"), {"i": tid})
        s.commit()
        s.close()
    finally:
        tx.rollback()
        holder.close()
    with db.connect() as c:
        assert c.execute(text("SELECT amount FROM plans_test_ledger WHERE id = :i"), {"i": tid}).scalar() == -2
        lt = c.execute(text("SHOW lock_timeout")).scalar()
    assert lt in ("0", "0ms")
    assert _allowance_used(db, sid) == D("1")


def test_lock_timeout_is_restored_after_a_successful_reservation(db):
    vid = _plan(db, {"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 9}})
    _subscribe(db, vid)
    s = sessionmaker(bind=db, future=True)()
    s.execute(text("SET LOCAL lock_timeout = '7s'"))
    d = P.decide(s, institute_id=INST, list_credits=1, use_case="learner_assistant", model=GLM)
    assert d.billing_mode == "INCLUDED"
    assert s.execute(text("SHOW lock_timeout")).scalar() == "7s"
    s.commit()
    s.close()


# ── release / shadow / zero statements ───────────────────────────────────────

def test_release_undoes_everything_on_postgres(db):
    vid = _plan(db, {"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 9, "user_units_cap": 9},
                     "image_generation": {"mode": "ALLOWANCE"}}, allowance=10, cost_cap=5)
    sid = _subscribe(db, vid)
    _decide_and_commit(db)                                    # period open, 1 allowance credit used
    s = sessionmaker(bind=db, future=True)()
    a = P.decide(s, institute_id=INST, list_credits=3, use_case="content_image")
    i = P.decide(s, institute_id=INST, list_credits=2, use_case="learner_assistant", model=GLM, actor_user_id="u1")
    assert a.billing_mode == "ALLOWANCE" and i.billing_mode == "INCLUDED"
    assert P.release(s, a.release_token) and P.release(s, i.release_token)
    s.commit()
    s.close()
    assert _allowance_used(db, sid) == D("1")
    with db.connect() as c:
        rows = c.execute(text("SELECT counter_key, credits_used, count_used FROM ai_usage_counter")).all()
    assert rows and all(r[1] == 0 and r[2] == 0 for r in rows)


def test_shadow_writes_nothing_on_postgres(db):
    vid = _plan(db, {"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 9},
                     "image_generation": {"mode": "ALLOWANCE"}}, allowance=10)
    _subscribe(db, vid, enforcement="SHADOW")
    d1 = _decide_and_commit(db, use_case="learner_assistant", model=GLM)
    d2 = _decide_and_commit(db)
    assert (d1.billing_mode, d1.shadow_mode) == ("CHARGED", "INCLUDED")
    assert (d2.billing_mode, d2.shadow_mode) == ("CHARGED", "ALLOWANCE")
    with db.connect() as c:
        assert c.execute(text("SELECT count(*) FROM ai_usage_counter")).scalar() == 0
        assert c.execute(text("SELECT count(*) FROM ai_subscription_period")).scalar() == 0


def test_no_subscription_issues_zero_statements_on_postgres(db):
    P.set_index_for_tests([])
    seen = []

    def spy(conn, cursor, statement, params, context, executemany):
        seen.append(statement)

    event.listen(db, "before_cursor_execute", spy)
    try:
        s = sessionmaker(bind=db, future=True)()
        d = P.decide(s, institute_id="nobody", list_credits=5, use_case="learner_assistant", model=GLM)
        pc = P.precheck(s, institute_id="nobody", use_case="learner_assistant")
        s.close()
    finally:
        event.remove(db, "before_cursor_execute", spy)
    assert seen == []
    assert (d.billing_mode, d.wallet_credits) == ("CHARGED", D("5")) and pc["covered"] is False


# ── cross-module: limits never touch plan counters ───────────────────────────

def test_limits_rebuild_leaves_plan_counters_alone(db):
    vid = _plan(db, {"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 9}})
    sid = _subscribe(db, vid)
    assert _decide_and_commit(db, use_case="learner_assistant", model=GLM).billing_mode == "INCLUDED"
    with db.begin() as c:
        c.execute(text("INSERT INTO institute_ai_limits_policy (institute_id, mode) VALUES (:i, 'ENFORCE')"),
                  {"i": INST})
        c.execute(text("INSERT INTO ai_usage_limit (institute_id, subject_kind, scope_kind, period, metric, "
                       "hard_limit, created_by) VALUES (:i, 'INSTITUTE', 'ALL', 'MONTH', 'CREDITS', 100, 't')"),
                  {"i": INST})
    L.invalidate(INST, active=True)
    L.set_policy_index_for_tests([INST])
    s = sessionmaker(bind=db, future=True)()
    L.rebuild_counters(s, days=35, institute_id=INST)
    s.close()
    with db.connect() as c:
        row = c.execute(text("SELECT count_used FROM ai_usage_counter WHERE counter_key = :k"),
                        {"k": f"PLAN:{sid}|F:learner_assistant"}).first()
    assert row is not None and row[0] == D("1")


# ── reports on Postgres SQL ──────────────────────────────────────────────────

def _event(engine, **kw):
    vals = dict(institute_id=INST, actor_kind="USER", actor_user_id="u1", use_case="learner_assistant",
                use_case_source="EXPLICIT", feature_group="agent", surface="ADMIN_APP", source_service="ai_service",
                model_id=GLM, list_credits=1, credits_charged=1, billing_mode="CHARGED", charge_status="POSTED",
                real_cost_usd=0.01, shadow_billing_mode=None, occurred_at=datetime.now(UTC) - timedelta(minutes=5))
    vals.update(kw)
    cols = ", ".join(vals)
    with engine.begin() as c:
        c.execute(text(f"INSERT INTO ai_usage_event ({cols}) VALUES ({', '.join(':' + k for k in vals)})"), vals)


def test_simulate_and_pnl_on_postgres(db):
    vid = _plan(db, {"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 2},
                     "image_generation": {"mode": "ALLOWANCE"}}, allowance=3)
    _subscribe(db, vid)
    _decide_and_commit(db, list_credits=1)          # opens the period (1 allowance credit)
    for _ in range(3):
        _event(db)
    _event(db, use_case="content_image", model_id=None, list_credits=2, credits_charged=2, real_cost_usd=0.02)
    _event(db, use_case="content_image", model_id=None, list_credits=2, credits_charged=0, billing_mode="ALLOWANCE",
           real_cost_usd=0.02)
    _event(db, billing_mode="INCLUDED", credits_charged=0, real_cost_usd=0.5)
    s = sessionmaker(bind=db, future=True)()
    sim = P.simulate(s, vid, INST, days=30)
    rows = P.pnl(s, institute_id=INST)
    s.close()
    f = {e["feature_key"]: e for e in sim["features"]}
    assert f["learner_assistant"]["included_credits"] == 2 and f["learner_assistant"]["over_cap_events"] == 2
    assert f["image_generation"]["allowance_credits"] == 3 and f["image_generation"]["charged_credits"] == 1
    assert len(rows) == 1
    r = rows[0]
    assert r["basis"] == "LIVE" and r["included_list_credits"] == 1 and r["allowance_used"] == 1
    assert abs(r["included_cost_usd"] - 0.5) < 1e-9 and abs(r["allowance_cost_usd"] - 0.02) < 1e-9
    assert abs(r["margin_inr"] - (5000 - 0.52 * 86)) < 0.011


def test_release_is_exact_after_an_outer_savepoint_rollback_commit_or_twice(db):
    vid = _plan(db, {"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 50},
                     "image_generation": {"mode": "ALLOWANCE"}}, allowance=10)
    sid = _subscribe(db, vid)
    _decide_and_commit(db, list_credits=2)                      # period open, allowance_used 2
    key = f"PLAN:{sid}|F:learner_assistant"

    def count():
        with db.connect() as c:
            return c.execute(text("SELECT coalesce(max(count_used), 0) FROM ai_usage_counter WHERE counter_key = :k"),
                             {"k": key}).scalar()

    s = sessionmaker(bind=db, future=True)()
    # 1) the caller wraps decide in its own savepoint and rolls it back: release must not undo again
    sp = s.begin_nested()
    a = P.decide(s, institute_id=INST, list_credits=3, use_case="content_image")
    i = P.decide(s, institute_id=INST, list_credits=1, use_case="learner_assistant", model=GLM)
    assert a.billing_mode == "ALLOWANCE" and i.billing_mode == "INCLUDED"
    sp.rollback()
    assert P.release(s, a.release_token) is False and P.release(s, i.release_token) is False
    s.commit()
    assert _allowance_used(db, sid) == D("2") and count() == 0
    # 2) committed: final
    i2 = P.decide(s, institute_id=INST, list_credits=1, use_case="learner_assistant", model=GLM)
    s.commit()
    assert P.release(s, i2.release_token) is False
    s.commit()
    assert count() == 1
    # 3) same transaction: undone once, the second call is a no-op
    a3 = P.decide(s, institute_id=INST, list_credits=4, use_case="content_image")
    i3 = P.decide(s, institute_id=INST, list_credits=1, use_case="learner_assistant", model=GLM)
    other = P.decide(s, institute_id=INST, list_credits=1, use_case="learner_assistant", model=GLM)
    assert P.release(s, i3.release_token) is True and P.release(s, a3.release_token) is True
    i3.release_token.released = False                            # even a forged retry finds no mark
    assert P.release(s, i3.release_token) is False
    s.commit()
    s.close()
    assert _allowance_used(db, sid) == D("2")
    assert count() == 2 and other.billing_mode == "INCLUDED"    # i2 + other; i3 undone
    with db.connect() as c:
        assert c.execute(text("SELECT coalesce(current_setting('vacademy_plans.live_tokens', true), '')")).scalar() \
            == ""


def test_default_chain_models_on_postgres(db):
    models = P.default_chain_models(sessionmaker(bind=db, future=True)(), "learner_assistant")
    assert GLM in models


# ── review fix: pre-check vs charge model consistency (off-chain strikes) ────

OFF_CHAIN = "anthropic/claude-opus-4.1"


def test_off_chain_model_strike_closes_the_precheck_gate(db):
    """Model-less pre-checks say covered for an INCLUDED DEFAULT_CHAIN item; once
    a LIVE charge of that actor ran a model OUTSIDE the chain, later model-less
    pre-checks of that actor and feature are NOT covered for the rest of the
    period (the balance check applies), whatever happened to the charge. Other
    actors are unaffected; a fallback inside the chain never strikes."""
    vid = _plan(db, {"content_generation": {"mode": "INCLUDED", "inst_units_cap": 3}})
    _subscribe(db, vid)
    S = sessionmaker(bind=db, future=True)

    def pre(actor):
        s = S()
        try:
            return P.precheck(s, institute_id=INST, use_case="page_builder", model=None, actor_user_id=actor,
                              role_class="ADMIN", estimate=Decimal("5"))
        finally:
            s.close()

    def charge(actor, model, rollback=False):
        s = S()
        try:
            d = P.decide(s, institute_id=INST, list_credits=Decimal("5"), use_case="page_builder", model=model,
                         actor_user_id=actor, role_class="ADMIN", reserve=True)
            (s.rollback if rollback else s.commit)()
            return d
        finally:
            s.close()

    assert pre("u1")["covered"] is True
    d = charge("u1", OFF_CHAIN, rollback=True)          # e.g. a dropped (insufficient) charge rolls back
    assert (d.billing_mode, d.reason) == ("CHARGED", "MODEL_NOT_INCLUDED")
    P._strikes.clear()                                   # another pod: only the persisted strike is known
    got = pre("u1")
    assert (got["covered"], got["reason"]) == (False, "MODEL_STRIKE")
    assert pre("u2")["covered"] is True                  # another actor
    with db.connect() as c:
        n = c.execute(text("SELECT count(*) FROM ai_usage_counter WHERE period = 'PLAN_PERIOD' "
                           "AND counter_key LIKE '%|X:%'")).scalar()
    assert n == 1
    # the 10-round loop of the review: never more than one uncovered-but-passed gate per actor
    rounds = []
    for _ in range(10):
        p = pre("u3")
        d = charge("u3", OFF_CHAIN)
        rounds.append((p["covered"], d.billing_mode))
    assert rounds[0] == (True, "CHARGED") and all(r == (False, "CHARGED") for r in rounds[1:])


def test_lazy_period_open_never_for_a_non_renewing_subscription(db):
    vid = _plan(db, {"learner_assistant": {"mode": "INCLUDED", "model_policy": "ANY"}}, allowance=100)
    sid = _subscribe(db, vid)
    with db.begin() as c:
        c.execute(text("UPDATE institute_ai_subscription SET anchor_at = now() - interval '35 days', "
                       "start_at = now() - interval '35 days', auto_renew = false, updated_at = now() WHERE id = :s"),
                  {"s": sid})
    P.invalidate()
    s = sessionmaker(bind=db, future=True)()
    try:
        d = P.decide(s, institute_id=INST, list_credits=Decimal("5"), use_case="learner_assistant", reserve=True)
        s.commit()
    finally:
        s.close()
    assert (d.billing_mode, d.reason) == ("CHARGED", "NO_PERIOD")
    with db.connect() as c:
        assert c.execute(text("SELECT count(*) FROM ai_subscription_period WHERE subscription_id = :s"),
                         {"s": sid}).scalar() == 0
