"""AI usage limits engine (services/metering/limits.py) on a REAL Postgres 16
with the real Flyway migrations V586 (metering) + V587 (limits), driven through
SQLAlchemy + psycopg 3 (the prod driver, where INSERT .. ON CONFLICT reports
rowcount -1: everything here is decided by RETURNING).

What must hold:
  * concurrent reservations on one hard cap: exactly the capacity is granted,
    the rest BLOCK (pg_advisory_xact_lock, sorted keys), no deadlocks;
  * concurrent counter increments sum exactly (multi-row upsert .. RETURNING);
  * OVERRUN, refund decrement, rebuild (FOR UPDATE) and the policy index all
    work on Postgres;
  * an institute without a policy issues ZERO statements.

Needs a Postgres: set AI_LIMITS_PG_URL (a server URL, postgresql+psycopg://...;
a scratch database is created and dropped), or AI_LIMITS_PGDATA (a pgserver
data directory). Skipped otherwise. Run from the repo root:
  AI_LIMITS_PGDATA=<dir> <venv>/bin/python -m pytest ai_service/tests/test_limits_engine_pg.py -q -p no:cacheprovider
"""
from __future__ import annotations

import os
import sys
import threading
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import create_engine, event, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from ai_service.app.services.metering import cache as mcache  # noqa: E402
from ai_service.app.services.metering import limits as L  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parents[2] / "admin_core_service/src/main/resources/db/migration"
UTC = timezone.utc
INST = "inst-pg"

# The two pre-existing tables V586 ALTERs (only the columns it needs).
STUBS = """
CREATE TABLE IF NOT EXISTS credit_transactions (id UUID PRIMARY KEY, institute_id VARCHAR(64), amount NUMERIC);
CREATE TABLE IF NOT EXISTS ai_token_usage (id UUID PRIMARY KEY, institute_id VARCHAR(64));
"""


def _migration(prefix: str) -> str:
    hits = sorted(MIGRATIONS.glob(f"{prefix}__*.sql"))
    if not hits:
        pytest.skip(f"{prefix} migration not in this checkout")
    return hits[0].read_text(encoding="utf-8")


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
    name = f"lim_{uuid.uuid4().hex[:10]}"
    admin = create_engine(base, isolation_level="AUTOCOMMIT", future=True)
    template = os.environ.get("AI_LIMITS_PG_TEMPLATE")
    with admin.connect() as c:
        c.execute(text(f'CREATE DATABASE "{name}"' + (f' TEMPLATE "{template}"' if template else "")))
    url = base.replace("/postgres?", f"/{name}?") if "/postgres?" in base else base.rsplit("/", 1)[0] + f"/{name}"
    engine = create_engine(url, pool_size=20, max_overflow=5, future=True)
    with engine.begin() as c:
        c.exec_driver_sql(STUBS)
    for prefix in ("V586", "V587"):
        sql = _migration(prefix)
        with engine.begin() as c:      # one transaction, like Flyway
            c.exec_driver_sql(sql)
    yield engine
    engine.dispose()
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    L.reset_for_tests()
    mcache.reset_cache()
    settings = {"metering.events.enabled": True, "metering.limits.enforce": True}
    monkeypatch.setattr(mcache, "setting_value", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(mcache, "peek_setting", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(L, "_maybe_refresh_index", lambda: None)
    yield settings
    L.reset_for_tests()
    mcache.reset_cache()


@pytest.fixture
def db(pg):
    with pg.begin() as c:
        for t in ("ai_usage_limit", "ai_usage_counter", "ai_usage_reservation", "institute_ai_limits_policy",
                  "ai_usage_event"):
            c.execute(text(f"DELETE FROM {t}"))
        c.execute(text("INSERT INTO institute_ai_limits_policy (institute_id, mode, tenant_may_enforce) "
                       "VALUES (:i, 'ENFORCE', true)"), {"i": INST})
    L.set_policy_index_for_tests([INST])
    return pg


def _row(engine, **kw):
    vals = dict(subject_kind="INSTITUTE", subject_value=None, per_member=True, scope_kind="ALL", scope_value=None,
                period="DAY", metric="CREDITS", soft_limit=None, hard_limit=None, origin="TENANT")
    vals.update(kw)
    with engine.begin() as c:
        rid = c.execute(text(
            "INSERT INTO ai_usage_limit (institute_id, subject_kind, subject_value, per_member, scope_kind, "
            "scope_value, period, metric, soft_limit, hard_limit, origin, created_by, effective_from) VALUES "
            "(:i, :subject_kind, :subject_value, :per_member, :scope_kind, :scope_value, :period, :metric, "
            ":soft_limit, :hard_limit, :origin, 'test', now() - interval '1 day') RETURNING id"),
            dict(vals, i=INST)).scalar()
    L.invalidate(INST)
    return str(rid)


def _ev(**kw):
    base = dict(id=str(uuid.uuid4()), occurred_at=datetime.now(UTC), institute_id=INST, actor_kind="USER",
                actor_user_id="u1", actor_role_class="TEACHER", actor_roles_raw=["TEACHER"], use_case="tutor_chat",
                feature_group="tutor", list_credits=Decimal("1"), refunded_credits=Decimal("0"), request_count=1,
                real_cost_usd=Decimal("0.001"), free_reason=None, parent_event_id=None, limit_decision="NONE")
    base.update(kw)
    return base


CTX = dict(actor_kind="USER", actor_user_id="u1", actor_roles_raw=["TEACHER"])


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


def test_migrations_create_the_limit_tables(db):
    with db.connect() as c:
        names = {r[0] for r in c.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'ai_usage_%' "
            "OR table_name = 'institute_ai_limits_policy'"))}
    assert {"ai_usage_limit", "ai_usage_counter", "ai_usage_reservation", "institute_ai_limits_policy",
            "ai_usage_event"} <= names


def test_two_concurrent_reserves_on_a_hard_cap_exactly_one_blocked(db):
    _row(db, subject_kind="USER", subject_value="u1", scope_kind="USE_CASE", scope_value="lesson_video",
         hard_limit=10)
    Session = sessionmaker(bind=db, future=True)
    for round_ in range(15):
        with db.begin() as c:
            c.execute(text("DELETE FROM ai_usage_reservation"))

        def go(_i):
            s = Session()
            try:
                return L.authorize(s, institute_id=INST, use_case="lesson_video", ctx=CTX, estimate_credits=6)
            finally:
                s.close()

        res = _threads(2, go)
        allowed = [d for d in res if d.allow]
        blocked = [d for d in res if d.decision == "BLOCK"]
        assert len(allowed) == 1 and len(blocked) == 1, (round_, [d.to_dict() for d in res])
        assert allowed[0].reservation_id and blocked[0].reservation_id is None
        with db.connect() as c:
            assert c.execute(text("SELECT count(*) FROM ai_usage_reservation WHERE status = 'OPEN'")).scalar() == 1


def test_many_concurrent_reserves_grant_exactly_the_capacity(db):
    _row(db, subject_kind="INSTITUTE", hard_limit=10)
    _row(db, subject_kind="ROLE_CLASS", subject_value="TEACHER", hard_limit=100)   # second key: sorted locking
    Session = sessionmaker(bind=db, future=True)

    def go(i):
        s = Session()
        try:
            ctx = dict(actor_kind="USER", actor_user_id=f"u{i}", actor_roles_raw=["TEACHER"])
            return L.authorize(s, institute_id=INST, use_case="lesson_video", ctx=ctx, estimate_credits=2)
        finally:
            s.close()

    res = _threads(12, go)
    assert sum(1 for d in res if d.allow) == 5
    assert sum(1 for d in res if d.decision == "BLOCK") == 7
    with db.connect() as c:
        assert c.execute(text("SELECT coalesce(sum(credits), 0) FROM ai_usage_reservation "
                              "WHERE status = 'OPEN'")).scalar() == Decimal("10")


def test_concurrent_increments_sum_exactly_and_overrun(db):
    _row(db, subject_kind="INSTITUTE", hard_limit=1000)
    _row(db, subject_kind="ROLE_CLASS", subject_value="TEACHER", per_member=False, hard_limit=1000)
    Session = sessionmaker(bind=db, future=True)

    def go(i):
        out = []
        for _ in range(10):
            s = Session()
            try:
                with s.begin():
                    out.append(L.apply_event_to_counters(s, _ev(actor_user_id=f"u{i % 3}",
                                                                list_credits=Decimal("0.5"))))
            finally:
                s.close()
        return out

    res = _threads(10, go)
    assert all(r == "OK" for rs in res for r in rs)
    with db.connect() as c:
        rows = {r[0]: (r[1], r[2]) for r in c.execute(text(
            "SELECT counter_key, credits_used, count_used FROM ai_usage_counter WHERE period = 'DAY'"))}
    assert rows["I|ALL"] == (Decimal("50.0000"), Decimal("100.0000"))
    assert rows["RC:TEACHER|ALL"] == (Decimal("50.0000"), Decimal("100.0000"))
    _row(db, subject_kind="USER", subject_value="u1", hard_limit=1)
    s = Session()
    with s.begin():
        assert L.apply_event_to_counters(s, _ev(list_credits=Decimal("2"))) == "OVERRUN"
    s.close()


def test_reserve_settle_and_concurrent_apply_do_not_deadlock(db):
    _row(db, subject_kind="INSTITUTE", hard_limit=100000)
    _row(db, subject_kind="ROLE_CLASS", subject_value="TEACHER", hard_limit=100000)
    _row(db, subject_kind="INSTITUTE", scope_kind="GROUP", scope_value="video", hard_limit=100000)
    Session = sessionmaker(bind=db, future=True)

    def go(i):
        for _ in range(8):
            s = Session()
            try:
                ctx = dict(actor_kind="USER", actor_user_id=f"u{i % 2}", actor_roles_raw=["TEACHER"])
                d = L.authorize(s, institute_id=INST, use_case="lesson_video", ctx=ctx, estimate_credits=1)
                assert d.allow and d.reservation_id
                with s.begin():
                    r = L.apply_event_to_counters(s, _ev(actor_user_id=f"u{i % 2}", use_case="lesson_video",
                                                         feature_group="video", reservation_id=d.reservation_id))
                assert r == "OK"
            finally:
                s.close()
        return True

    assert all(_threads(8, go))
    with db.connect() as c:
        assert c.execute(text("SELECT count(*) FROM ai_usage_reservation WHERE status = 'SETTLED'")).scalar() == 64
        assert c.execute(text("SELECT credits_used FROM ai_usage_counter WHERE counter_key = 'I|G:video'")).scalar() \
            == Decimal("64")


def test_refund_and_rebuild_on_postgres(db):
    _row(db, subject_kind="USER", subject_value="u1", hard_limit=100)
    Session = sessionmaker(bind=db, future=True)
    events = []
    for credits in ("3", "4"):
        e = _ev(list_credits=Decimal(credits))
        events.append(e)
        with db.begin() as c:
            c.execute(text(
                "INSERT INTO ai_usage_event (id, occurred_at, institute_id, actor_kind, actor_user_id, "
                "actor_role_class, actor_roles_raw, use_case, use_case_source, feature_group, surface, "
                "source_service, billing_mode, charge_status, list_credits, credits_charged, real_cost_usd) "
                "VALUES (:id, :at, :i, 'USER', 'u1', 'TEACHER', ARRAY['TEACHER'], 'tutor_chat', 'EXPLICIT', 'tutor', "
                "'UNKNOWN', 'ai_service', 'CHARGED', 'POSTED', :c, :c, 0.001)"),
                {"id": e["id"], "at": e["occurred_at"], "i": INST, "c": Decimal(credits)})
        s = Session()
        with s.begin():
            L.apply_event_to_counters(s, e)
        s.close()
    s = Session()
    with s.begin():
        assert L.decrement_for_refund(s, events[0], Decimal("3")) == "OK"
    s.close()
    with db.begin() as c:
        c.execute(text("UPDATE ai_usage_event SET refunded_credits = 3, charge_status = 'REFUNDED' WHERE id = :i"),
                  {"i": events[0]["id"]})
    s = Session()
    report = L.rebuild_counters(s, days=35)
    s.close()
    assert not report["errors"] and report["counters_fixed"] == 0, report   # live == rebuilt
    with db.begin() as c:
        c.execute(text("UPDATE ai_usage_counter SET credits_used = 77"))
    s = Session()
    report = L.rebuild_counters(s, days=35, institute_id=INST)
    s.close()
    assert report["counters_fixed"] == 1
    with db.connect() as c:
        row = c.execute(text("SELECT credits_used, count_used FROM ai_usage_counter")).one()
    assert row == (Decimal("4.0000"), Decimal("1.0000"))


def test_policy_index_and_zero_statements_without_policy(db):
    L.reset_for_tests()
    L.configure(engine=db)
    assert L.refresh_policy_index() is True and L.has_policy(INST)
    statements = []

    @event.listens_for(db, "before_cursor_execute")
    def _trace(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    try:
        s = sessionmaker(bind=db, future=True)()
        d = L.authorize(s, institute_id="no-policy", use_case="lesson_video", ctx=CTX, estimate_credits=5)
        assert d.allow and d.decision == "NONE"
        assert L.apply_event_to_counters(s, _ev(institute_id="no-policy")) == "NONE"
        s.close()
        assert statements == []
    finally:
        event.remove(db, "before_cursor_execute", _trace)


def test_shadow_on_postgres_never_refuses(db):
    with db.begin() as c:
        c.execute(text("UPDATE institute_ai_limits_policy SET mode = 'SHADOW'"))
    L.invalidate(INST, active=True)
    _row(db, subject_kind="INSTITUTE", hard_limit=0)
    s = sessionmaker(bind=db, future=True)()
    d = L.authorize(s, institute_id=INST, use_case="tutor_chat", ctx=CTX)
    s.close()
    assert d.allow and d.decision == "WOULD_BLOCK" and d.would_block["resets_at"].endswith("+05:30")


# ── review fixes (2026-10-15) ────────────────────────────────────────────────

def test_counter_write_never_waits_long_for_a_lock(db):
    """A counter row held by someone else (a stuck writer, an old-style
    rebuild) costs a charge at most the counter lock_timeout: the counter
    SAVEPOINT fails open, the caller's transaction stays usable and its own
    lock_timeout is unchanged."""
    import time as _time

    _row(db, subject_kind="INSTITUTE", hard_limit=1000)
    Session = sessionmaker(bind=db, future=True)
    s = Session()
    with s.begin():
        L.apply_event_to_counters(s, _ev())                 # the row exists now
    s.close()
    holder = db.connect()
    tx = holder.begin()
    holder.execute(text("SELECT 1 FROM ai_usage_counter WHERE counter_key = 'I|ALL' FOR UPDATE"))
    try:
        s = Session()
        with s.begin():
            s.execute(text("SET LOCAL lock_timeout = '17s'"))
            t0 = _time.monotonic()
            assert L.apply_event_to_counters(s, _ev()) == "NONE"   # failed open
            took = _time.monotonic() - t0
            assert took < 5, took
            assert s.execute(text("SELECT current_setting('lock_timeout')")).scalar() == "17s"
            assert s.execute(text("SELECT 1")).scalar() == 1           # transaction still usable
        s.close()
    finally:
        tx.rollback()
        holder.close()
    s = Session()
    with s.begin():
        assert L.apply_event_to_counters(s, _ev()) == "OK"
        assert s.execute(text("SELECT current_setting('lock_timeout')")).scalar() == "0"  # restored
    s.close()


def test_rebuild_scan_holds_no_counter_lock_and_keeps_concurrent_charges(db, monkeypatch):
    """While the rebuild scans the events, a charge's counter write goes
    through at once (no FOR UPDATE on the counters), and its increment
    survives the rebuild's correction."""
    import time as _time

    _row(db, subject_kind="USER", subject_value="u1", hard_limit=1000)
    Session = sessionmaker(bind=db, future=True)

    def charge(credits):
        e = _ev(list_credits=Decimal(credits))
        s = Session()
        with s.begin():
            s.execute(text(
                "INSERT INTO ai_usage_event (id, occurred_at, institute_id, actor_kind, actor_user_id, "
                "actor_role_class, actor_roles_raw, use_case, use_case_source, feature_group, surface, "
                "source_service, billing_mode, charge_status, list_credits, credits_charged, real_cost_usd) "
                "VALUES (:id, :at, :i, 'USER', 'u1', 'TEACHER', ARRAY['TEACHER'], 'tutor_chat', 'EXPLICIT', "
                "'tutor', 'UNKNOWN', 'ai_service', 'CHARGED', 'POSTED', :c, :c, 0.001)"),
                {"id": e["id"], "at": e["occurred_at"], "i": INST, "c": Decimal(credits)})
            L.apply_event_to_counters(s, e)                  # same transaction, like the post-commit writer
        s.close()

    charge("3")
    with db.begin() as c:
        c.execute(text("UPDATE ai_usage_counter SET credits_used = 50, count_used = 9"))   # drift
    real_iter = L._iter_events
    waited = []

    def iter_with_concurrent_charge(s, inst, since):
        for ev in real_iter(s, inst, since):
            yield ev
        t0 = _time.monotonic()
        th = threading.Thread(target=charge, args=("4",))
        th.start()
        th.join(10)
        waited.append(_time.monotonic() - t0)

    monkeypatch.setattr(L, "_iter_events", iter_with_concurrent_charge)
    s = Session()
    rep = L.rebuild_counters(s, days=35, institute_id=INST)
    s.close()
    assert not rep["errors"] and rep["counters_fixed"] == 1, rep
    assert waited and waited[0] < 2, waited                # not blocked by the scan
    with db.connect() as c:
        row = c.execute(text("SELECT credits_used, count_used FROM ai_usage_counter "
                             "WHERE counter_key = 'U:u1|ALL'")).one()
    assert row == (Decimal("7.0000"), Decimal("2.0000"))     # 3 rebuilt + 4 kept
    s = Session()
    assert L.rebuild_counters(s, days=35, institute_id=INST)["counters_fixed"] == 0
    s.close()
