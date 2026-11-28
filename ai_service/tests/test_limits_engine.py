"""AI usage limits engine (services/metering/limits.py, contract N2) against a
real SQL database (file SQLite with real SAVEPOINTs) plus pure-function tests.

What must hold:
  * precedence (d_credits §4.2): USER > ROLE (most permissive raw role) >
    ROLE_CLASS per slot; pools and PLATFORM rows always AND; a USER row with a
    NULL hard limit lifts the role cap but never a PLATFORM cap; SYSTEM actors
    meet only INSTITUTE / ROLE_CLASS SYSTEM / PLATFORM rows;
  * soft -> WARN, hard -> BLOCK; SHADOW and enforce=false -> WOULD_BLOCK (allowed);
  * windows: local midnight / Monday / 1st in the policy timezone, as UTC;
  * reservations, OVERRUN, refund decrement (floor 0), rebuild from events,
    preview_impact, effective_limits;
  * an institute without a policy: ZERO calls on the session (spy); every
    failure fails open.

No network, no Postgres (see test_limits_engine_pg.py for that). Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_limits_engine.py -q -p no:cacheprovider
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

from sqlalchemy import MetaData, create_engine, event, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from ai_service.app.services.metering import cache as mcache  # noqa: E402
from ai_service.app.services.metering import limit_gate as G  # noqa: E402
from ai_service.app.services.metering import limits as L  # noqa: E402
from ai_service.app.services.metering.limit_models import LimitsBase  # noqa: E402
from ai_service.app.services.metering.models import Base as MeteringBase  # noqa: E402

sqlite3.register_adapter(Decimal, str)

_REAL_MAYBE_REFRESH = L._maybe_refresh_index

INST = "inst-lim"
UTC = timezone.utc

CATALOG = [
    # use_case, group, label, count unit, limit_eligible, reserve, actor_kind, request types
    ("tutor_chat", "tutor", "AI tutor chat", "requests", True, False, "USER", ["conversation"]),
    ("tutor_live", "tutor", "AI tutor session", "minutes", True, False, "USER", []),
    ("content", "content", "Course content", "requests", True, False, "USER", ["content"]),
    ("lesson_video", "video", "Lesson video", "videos", True, True, "USER", ["video"]),
    ("learner_analytics", "analytics", "Learner insights", "requests", True, False, "ON_BEHALF", ["analytics"]),
    ("voice_bot_llm", "calling", "Voice-bot LLM", "requests", False, False, "SYSTEM", []),
    ("unknown", "platform", "Other AI usage", "requests", True, False, "USER", []),
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
    def __init__(self, *, limit_tables: bool = True):
        fd, self.path = tempfile.mkstemp(suffix=".sqlite3", prefix="limits-test-")
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

        _stripped(MeteringBase).create_all(self.engine)
        if limit_tables:
            _stripped(LimitsBase).create_all(self.engine)
        with self.engine.begin() as c:
            for i, (uc, fg, label, unit, elig, res, kind, rts) in enumerate(CATALOG):
                c.execute(text(
                    "INSERT INTO ai_use_case_catalog (use_case, feature_group, label, count_unit_label, "
                    "legacy_request_types, tool_keys, default_surface, actor_kind, unit_kind, billing_policy, "
                    "plan_eligible, limit_eligible, reserve_on_authorize, intentionally_separate, is_active, "
                    "display_order) VALUES (:u, :f, :l, :cu, :r, '[]', 'UNKNOWN', :a, 'TOKENS', 'AS_TODAY', 1, :e, "
                    ":res, 0, 1, :o)"),
                    {"u": uc, "f": fg, "l": label, "cu": unit, "r": json.dumps(rts), "a": kind, "e": 1 if elig else 0,
                     "res": 1 if res else 0, "o": i * 10})
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)

    def exec(self, sql, **params):
        with self.engine.begin() as c:
            c.execute(text(sql), params)

    def all(self, sql, **params):
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(text(sql), params).mappings().all()]

    def policy(self, mode="ENFORCE", tz="Asia/Kolkata", inst=INST, may=True, show=True):
        # show=True: most tests read the numbers in the 429 body; the
        # test_numbers_hidden_* tests cover show_numbers_to_learners = false.
        self.exec("DELETE FROM institute_ai_limits_policy WHERE institute_id = :i", i=inst)
        self.exec("INSERT INTO institute_ai_limits_policy (institute_id, mode, tenant_may_enforce, timezone, "
                  "notify_admins_on_soft, show_numbers_to_learners, updated_at) VALUES (:i, :m, :t, :z, 1, :sh, :n)",
                  i=inst, m=mode, t=1 if may else 0, z=tz, sh=1 if show else 0, n=datetime.now(UTC))
        L.invalidate(inst, active=mode in ("SHADOW", "ENFORCE"))

    def row(self, subject_kind="INSTITUTE", subject_value=None, *, per_member=True, scope_kind="ALL",
            scope_value=None, period="DAY", metric="CREDITS", soft=None, hard=None, origin="TENANT", locked=False,
            inst=INST):
        rid = str(uuid.uuid4())
        self.exec("INSERT INTO ai_usage_limit (id, institute_id, subject_kind, subject_value, per_member, scope_kind, "
                  "scope_value, period, metric, soft_limit, hard_limit, origin, locked, effective_from, is_active, "
                  "created_by, created_at, updated_at) VALUES (:id, :i, :sk, :sv, :pm, :sck, :scv, :p, :m, :s, :h, "
                  ":o, :lk, :ef, 1, 'test', :n, :n)",
                  id=rid, i=inst, sk=subject_kind, sv=subject_value, pm=1 if per_member else 0, sck=scope_kind,
                  scv=scope_value, p=period, m=metric, s=soft, h=hard, o=origin, lk=1 if locked else 0,
                  ef=datetime.now(UTC) - timedelta(days=400), n=datetime.now(UTC))
        L.invalidate(inst)
        return rid

    def event(self, *, at=None, user="u1", role_class="TEACHER", roles=("TEACHER",), kind="USER", use_case="tutor_chat",
              group="tutor", credits=1, refunded=0, request_count=1, cost=None, free_reason=None, parent=None,
              inst=INST, name=None):
        eid = str(uuid.uuid4())
        self.exec("INSERT INTO ai_usage_event (id, occurred_at, institute_id, actor_kind, actor_user_id, "
                  "actor_role_class, actor_roles_raw, role_source, actor_display_name, use_case, use_case_source, "
                  "feature_group, surface, source_service, byo_key, request_count, cost_source, list_credits, "
                  "credits_charged, refunded_credits, billing_mode, charge_status, free_reason, limit_decision, "
                  "parent_event_id, real_cost_usd, created_at) VALUES (:id, :at, :i, :k, :u, :rc, :rr, 'JWT', :nm, "
                  ":uc, 'EXPLICIT', :g, 'UNKNOWN', 'ai_service', 0, :n, 'UNKNOWN', :c, :c, :rf, 'CHARGED', 'POSTED', "
                  ":fr, 'NONE', :par, :cost, :at)",
                  id=eid, at=at or datetime.now(UTC), i=inst, k=kind, u=user, rc=role_class,
                  rr=json.dumps(list(roles)) if roles is not None else None, nm=name, uc=use_case, g=group,
                  n=request_count, c=credits, rf=refunded, fr=free_reason, par=parent, cost=cost)
        return eid

    def counters(self, inst=INST):
        return {(r["counter_key"], r["period"]): r for r in self.all(
            "SELECT * FROM ai_usage_counter WHERE institute_id = :i", i=inst)}


def ev(**kw):
    """An event_row dict as the metering writer builds it."""
    base = dict(id=str(uuid.uuid4()), occurred_at=datetime.now(UTC), institute_id=INST, actor_kind="USER",
                actor_user_id="u1", actor_role_class="TEACHER", actor_roles_raw=["TEACHER"], use_case="tutor_chat",
                feature_group="tutor", list_credits=Decimal("1"), refunded_credits=Decimal("0"), request_count=1,
                real_cost_usd=Decimal("0.01"), free_reason=None, parent_event_id=None, limit_decision="NONE")
    base.update(kw)
    return base


TEACHER = dict(actor_kind="USER", actor_user_id="u1", actor_roles_raw=["TEACHER"])


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    L.reset_for_tests()
    mcache.reset_cache()
    settings = {"metering.events.enabled": True, "metering.limits.enforce": True}
    monkeypatch.setattr(mcache, "setting_value", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(mcache, "peek_setting", lambda key, default: settings.get(key, default))
    # never spawn the background index refresh against a real database
    monkeypatch.setattr(L, "_maybe_refresh_index", lambda: None)
    yield settings
    L.reset_for_tests()
    mcache.reset_cache()
    while _CREATED:
        db = _CREATED.pop()
        db.engine.dispose()
        try:
            os.unlink(db.path)
        except OSError:
            pass


@pytest.fixture
def db():
    d = Db()
    d.policy("ENFORCE")
    return d


def _auth(d, **kw):
    s = d.Session()
    try:
        kw.setdefault("institute_id", INST)
        kw.setdefault("use_case", "tutor_chat")
        kw.setdefault("ctx", TEACHER)
        return L.authorize(s, **kw)
    finally:
        s.close()


def _apply(d, row):
    s = d.Session()
    try:
        with s.begin():
            return L.apply_event_to_counters(s, row)
    finally:
        s.close()


# ── pure precedence ──────────────────────────────────────────────────────────

def _r(kind, value=None, **kw):
    kw.setdefault("period", "DAY")
    kw.setdefault("metric", "CREDITS")
    kw.setdefault("scope_kind", "ALL")
    d = dict(id=kw.pop("id", f"{kind}:{value}:{kw.get('scope_kind')}:{kw.get('origin', 'TENANT')}"),
             institute_id=INST, subject_kind=kind, subject_value=value, **kw)
    return L.row_from_mapping(d)


def _sel(rows, actor, uc="tutor_chat", group="tutor"):
    return {a.row.id: a for a in L.select_rows(rows, actor, uc, group)}


ACTOR = L.Actor(kind="USER", user_id="u1", role_class="TEACHER", roles=["TEACHER", "EVALUATOR"])


def test_user_beats_role_beats_role_class():
    rows = [_r("USER", "u1", hard=50, id="user"), _r("ROLE", "TEACHER", hard=20, id="role"),
            _r("ROLE_CLASS", "TEACHER", hard=10, id="class")]
    got = _sel(rows, ACTOR)
    assert got["user"].selected and not got["role"].selected and not got["class"].selected
    assert got["user"].key == got["role"].key == "U:u1|ALL"
    got = _sel(rows[1:], ACTOR)
    assert got["role"].selected and not got["class"].selected
    got = _sel(rows[2:], ACTOR)
    assert got["class"].selected and got["class"].subject == "ROLE_CLASS"


def test_most_permissive_raw_role_wins():
    rows = [_r("ROLE", "TEACHER", hard=20, id="t"), _r("ROLE", "EVALUATOR", hard=80, id="e")]
    got = _sel(rows, ACTOR)
    assert got["e"].selected and not got["t"].selected
    # NULL hard (unlimited) is the most permissive of all
    rows.append(_r("ROLE", "EVALUATOR", hard=None, soft=5, id="e2", scope_kind="ALL", metric="CREDITS",
                   period="DAY", origin="TENANT"))
    got = _sel(rows[0:1] + rows[2:], ACTOR)
    assert got["e2"].selected


def test_slots_are_per_scope_period_and_metric():
    rows = [_r("USER", "u1", hard=5, period="DAY", id="ud"), _r("ROLE", "TEACHER", hard=100, period="MONTH", id="rm"),
            _r("ROLE", "TEACHER", hard=3, scope_kind="USE_CASE", scope_value="tutor_chat", id="ruc")]
    got = _sel(rows, ACTOR)
    assert all(a.selected for a in got.values())  # different slots never out-rank each other
    assert got["ruc"].key == "U:u1|UC:tutor_chat"
    assert "ruc" not in _sel(rows, ACTOR, uc="content", group="content")


def test_pools_and_platform_always_apply():
    rows = [_r("USER", "u1", hard=None, id="exempt"), _r("ROLE", "TEACHER", hard=10, id="role"),
            _r("INSTITUTE", hard=1000, id="pool"), _r("ROLE", "TEACHER", per_member=False, hard=300, id="rpool"),
            _r("ROLE_CLASS", "TEACHER", hard=7, origin="PLATFORM", locked=True, id="plat")]
    got = _sel(rows, ACTOR)
    assert got["exempt"].selected and not got["role"].selected
    assert got["pool"].selected and got["pool"].key == "I|ALL"
    assert got["rpool"].selected and got["rpool"].key == "R:TEACHER|ALL"
    assert got["plat"].selected and got["plat"].subject == "PLATFORM" and got["plat"].key == "U:u1|ALL"


def test_system_actor_only_meets_pools_system_class_and_platform():
    sysactor = L.Actor(kind="SYSTEM", user_id="job-1", role_class="SYSTEM", roles=["ADMIN"])
    rows = [_r("USER", "job-1", hard=1, id="user"), _r("ROLE", "ADMIN", hard=1, id="role"),
            _r("ROLE_CLASS", "SYSTEM", hard=50, id="sys"), _r("INSTITUTE", hard=100, id="pool"),
            _r("INSTITUTE", hard=500, origin="PLATFORM", id="plat")]
    got = _sel(rows, sysactor, "learner_analytics", "analytics")
    assert set(got) == {"sys", "pool", "plat"}
    assert got["sys"].key == "RC:SYSTEM|ALL"


def test_evaluate_row_soft_hard_and_zero():
    row = _r("INSTITUTE", soft=8, hard=10)
    assert L.evaluate_row(row, Decimal("5"), Decimal("0"))[0] == "OK"
    assert L.evaluate_row(row, Decimal("8"), Decimal("0")) == ("WARN", 80)
    assert L.evaluate_row(row, Decimal("10"), Decimal("0"))[0] == "BLOCK"
    assert L.evaluate_row(row, Decimal("7"), Decimal("4"))[0] == "BLOCK"   # estimate pushes past hard
    assert L.evaluate_row(row, Decimal("6"), Decimal("4"))[0] == "WARN"    # exactly at hard is allowed
    off = _r("INSTITUTE", hard=0)
    assert L.evaluate_row(off, Decimal("0"), Decimal("0"))[0] == "BLOCK"   # 0 = feature off


# ── windows ──────────────────────────────────────────────────────────────────

def test_day_window_turns_at_ist_midnight():
    before = datetime(2026, 10, 15, 18, 29, 59, tzinfo=UTC)   # 23:59:59 IST on the 15th
    after = datetime(2026, 10, 15, 18, 30, 0, tzinfo=UTC)     # 00:00 IST on the 16th
    s1, e1 = L.window_bounds("DAY", before)
    s2, e2 = L.window_bounds("DAY", after)
    assert s1 == datetime(2026, 10, 14, 18, 30, tzinfo=UTC) and e1 == s2 == datetime(2026, 10, 15, 18, 30, tzinfo=UTC)
    assert e2 == datetime(2026, 10, 16, 18, 30, tzinfo=UTC)
    assert L._local_iso(e1, "Asia/Kolkata") == "2026-10-16T00:00:00+05:30"


def test_week_window_starts_monday_local():
    # Sunday 2026-10-18 23:00 IST -> week of Monday 12th; Monday 00:10 IST -> week of the 19th
    s, e = L.window_bounds("WEEK", datetime(2026, 10, 18, 17, 30, tzinfo=UTC))
    assert s == datetime(2026, 10, 11, 18, 30, tzinfo=UTC) and e == datetime(2026, 10, 18, 18, 30, tzinfo=UTC)
    s2, _ = L.window_bounds("WEEK", datetime(2026, 10, 18, 18, 40, tzinfo=UTC))
    assert s2 == e


def test_month_window_and_year_rollover():
    s, e = L.window_bounds("MONTH", datetime(2026, 12, 31, 18, 29, tzinfo=UTC))   # Dec 31 23:59 IST
    assert s == datetime(2026, 11, 30, 18, 30, tzinfo=UTC) and e == datetime(2026, 12, 31, 18, 30, tzinfo=UTC)
    s2, e2 = L.window_bounds("MONTH", datetime(2026, 12, 31, 18, 31, tzinfo=UTC))  # Jan 1 00:01 IST
    assert s2 == e and e2 == datetime(2027, 1, 31, 18, 30, tzinfo=UTC)


def test_generic_timezone_with_dst():
    # New York: EDT (-4) on 2026-10-31, EST (-5) after Nov 1 -> the day after DST ends is 25 h long
    s, e = L.window_bounds("DAY", datetime(2026, 11, 1, 12, 0, tzinfo=UTC), "America/New_York")
    assert s == datetime(2026, 11, 1, 4, 0, tzinfo=UTC) and e == datetime(2026, 11, 2, 5, 0, tzinfo=UTC)
    # an unknown zone name falls back to IST
    assert L.window_bounds("DAY", datetime(2026, 10, 15, 12, tzinfo=UTC), "Nowhere/City")[0] == \
        datetime(2026, 10, 14, 18, 30, tzinfo=UTC)


# ── zero-cost fast path + fail open ─────────────────────────────────────────

class SpySession:
    """Records every attribute touched: the no-policy path must touch none."""

    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        self.calls.append(name)
        raise AssertionError(f"session.{name} used on the no-policy path")


def test_no_policy_fast_path_makes_zero_db_calls():
    spy = SpySession()
    L.set_policy_index_for_tests([])
    d = L.authorize(spy, institute_id="other-inst", use_case="tutor_chat", ctx=TEACHER, estimate_credits=5,
                    reserve=True)
    assert d.allow and d.decision == "NONE" and d.block is None and d.reservation_id is None
    assert L.apply_event_to_counters(spy, ev(institute_id="other-inst")) == "NONE"
    assert L.decrement_for_refund(spy, ev(institute_id="other-inst"), 1) == "NONE"
    assert L.authorize(spy, institute_id=None, use_case="tutor_chat").decision == "NONE"
    assert spy.calls == []
    assert L.has_policy("other-inst") is False


def test_index_refresh_never_uses_the_caller_session(monkeypatch):
    d = Db()
    d.policy("SHADOW")
    d.policy("OFF", inst="off-inst")
    L.reset_for_tests()
    L.configure(engine=d.engine)
    assert L.refresh_policy_index() is True
    assert L.has_policy(INST) and not L.has_policy("off-inst") and not L.has_policy("nope")


def test_has_policy_refreshes_in_the_background_off_the_caller(monkeypatch):
    import time as _time

    d = Db()
    d.policy("ENFORCE")
    L.reset_for_tests()
    L.configure(engine=d.engine)
    monkeypatch.setattr(L, "_maybe_refresh_index", _REAL_MAYBE_REFRESH)
    spy = SpySession()
    assert L.authorize(spy, institute_id=INST, use_case="tutor_chat").decision == "NONE"   # not loaded yet
    deadline = _time.monotonic() + 5
    while not L.has_policy(INST) and _time.monotonic() < deadline:
        _time.sleep(0.01)
    assert L.has_policy(INST) and spy.calls == []
    # within the TTL no second refresh is started
    before = L._index.attempted_at
    L.has_policy(INST)
    assert L._index.attempted_at == before


def test_index_refresh_failure_keeps_last_good():
    d = Db(limit_tables=False)
    L.reset_for_tests()
    L.set_policy_index_for_tests([INST])
    L.configure(engine=d.engine)
    assert L.refresh_policy_index() is False      # table missing
    assert L.has_policy(INST)                       # last good kept


def test_missing_tables_fail_open():
    d = Db(limit_tables=False)
    L.set_policy_index_for_tests([INST])
    out = _auth(d, estimate_credits=5)
    assert out.allow and out.decision == "NONE"
    assert _apply(d, ev()) == "NONE"
    assert L.stats().get("fail_open", 0) >= 1


def test_policy_off_or_not_limit_eligible_is_none(db):
    db.row("INSTITUTE", hard=0)
    assert _auth(db, use_case="voice_bot_llm").decision == "NONE"
    db.policy("OFF")
    L.set_policy_index_for_tests([INST])   # stale index: the cached policy row still says OFF
    assert _auth(db).decision == "NONE"


# ── authorize decisions ─────────────────────────────────────────────────────

def test_soft_then_hard_then_block_body(db):
    db.row("USER", "u1", soft=8, hard=10)
    assert _auth(db).decision == "OK"
    for _ in range(8):
        assert _apply(db, ev()) == "OK"
    warn = _auth(db)
    assert warn.allow and warn.decision == "WARN"
    assert warn.warnings[0]["pct"] == 80 and warn.warnings[0]["scope"] == "USER"
    assert L.warning_header(warn) == "tutor_chat;pct=80"
    for _ in range(2):
        _apply(db, ev())
    blk = _auth(db)
    assert not blk.allow and blk.decision == "BLOCK"
    b = blk.block
    assert b["error"] == "AI_USAGE_LIMIT" and b["use_case"] == "tutor_chat" and b["use_case_label"] == "AI tutor chat"
    assert b["scope"] == "USER" and b["period"] == "DAY" and b["limit"] == 10 and b["used"] == 10
    assert b["unit"] == "credits" and b["set_by"] == "INSTITUTE" and b["resets_at"].endswith("T00:00:00+05:30")
    assert "today's limit for AI tutor chat" in b["message"]
    assert 0 < blk.retry_after_seconds <= 86400
    with pytest.raises(L.LimitExceeded) as ei:
        blk.raise_if_blocked()
    assert ei.value.body == b and ei.value.headers()["Retry-After"] == str(blk.retry_after_seconds)
    # another user is unaffected; the dict-style access works
    other = _auth(db, ctx=dict(actor_kind="USER", actor_user_id="u2", actor_roles_raw=["TEACHER"]))
    assert other["allow"] and other["decision"] == "OK"


def test_shadow_records_would_block_and_allows(db):
    db.policy("SHADOW")
    db.row("INSTITUTE", hard=2)
    _apply(db, ev(list_credits=Decimal("2")))
    out = _auth(db)
    assert out.allow and out.decision == "WOULD_BLOCK" and out.block is None
    assert out.would_block["scope"] == "INSTITUTE" and out.limit_decision == "WOULD_BLOCK"


def test_global_enforce_off_turns_block_into_would_block(db, _isolate):
    db.row("INSTITUTE", hard=0)
    assert _auth(db).decision == "BLOCK"
    _isolate["metering.limits.enforce"] = False
    out = _auth(db)
    assert out.allow and out.decision == "WOULD_BLOCK"


def test_user_null_hard_exempts_from_role_but_not_platform(db):
    db.row("ROLE", "TEACHER", hard=1)
    db.row("USER", "u1", hard=None)
    db.row("INSTITUTE", hard=4, origin="PLATFORM", locked=True)
    _apply(db, ev(list_credits=Decimal("2")))
    assert _auth(db).decision == "OK"                               # role cap (1) lifted for u1
    u2 = dict(actor_kind="USER", actor_user_id="u2", actor_roles_raw=["TEACHER"])
    assert _auth(db, ctx=u2).decision == "OK"                       # u2 has used nothing yet
    _apply(db, ev(actor_user_id="u2", list_credits=Decimal("1")))
    blocked = _auth(db, ctx=u2)
    assert blocked.decision == "BLOCK" and blocked.block["scope"] == "ROLE"
    assert _auth(db).decision == "OK"                               # platform pool 3/4
    _apply(db, ev(list_credits=Decimal("1")))
    out = _auth(db)                                                  # platform pool now 4/4
    assert out.decision == "BLOCK" and out.block["scope"] == "PLATFORM" and out.block["set_by"] == "PLATFORM"


def test_pool_and_individual_both_must_pass(db):
    db.row("USER", "u1", hard=100)
    db.row("ROLE", "TEACHER", per_member=False, hard=3)
    _apply(db, ev(actor_user_id="u9", list_credits=Decimal("3")))
    out = _auth(db)
    assert out.decision == "BLOCK" and out.block["scope"] == "ROLE"
    assert "Your institute has reached" in out.block["message"]


def test_count_metric_allows_exactly_n_and_scopes(db):
    db.row("USER", "u1", scope_kind="USE_CASE", scope_value="tutor_chat", metric="COUNT", hard=3)
    for _ in range(3):
        assert _auth(db).allow
        _apply(db, ev())
    out = _auth(db)
    assert out.decision == "BLOCK" and out.block["unit"] == "requests" and out.block["limit"] == 3
    assert _auth(db, use_case="content").decision == "OK"          # other use case: not in scope


def test_group_scope_and_request_type_resolution(db):
    db.row("ROLE_CLASS", "TEACHER", scope_kind="GROUP", scope_value="tutor", hard=0)
    assert _auth(db, use_case=None, request_type="conversation").decision == "BLOCK"   # -> tutor_chat
    assert _auth(db, use_case=None, request_type="content").decision == "OK"


def test_estimate_blocks_before_the_overshoot(db):
    db.row("INSTITUTE", hard=10)
    _apply(db, ev(list_credits=Decimal("7")))
    assert _auth(db, estimate_credits=3).decision == "OK"
    assert _auth(db, estimate_credits=4).decision == "BLOCK"


def test_cost_usd_metric(db):
    db.row("INSTITUTE", metric="COST_USD", hard=Decimal("0.05"))
    for _ in range(5):
        _apply(db, ev(real_cost_usd=Decimal("0.01")))
    out = _auth(db)
    assert out.decision == "BLOCK" and out.block["unit"] == "usd"


# ── reservations ────────────────────────────────────────────────────────────

def test_reservations_hold_capacity_and_release(db):
    db.row("USER", "u1", scope_kind="USE_CASE", scope_value="lesson_video", hard=10)
    first = _auth(db, use_case="lesson_video", estimate_credits=6)        # catalog reserve_on_authorize
    assert first.allow and first.reservation_id
    second = _auth(db, use_case="lesson_video", estimate_credits=6)
    assert second.decision == "BLOCK" and second.reservation_id is None
    assert second.block["used"] == 6                                       # the open reservation counts
    s = db.Session()
    assert L.release_reservation(s, first.reservation_id) is True
    assert L.release_reservation(s, first.reservation_id) is False         # idempotent
    s.close()
    third = _auth(db, use_case="lesson_video", estimate_credits=6)
    assert third.allow and third.reservation_id
    # settling via the event: counter += actual, reservation closed, no double count
    _apply(db, ev(use_case="lesson_video", feature_group="video", list_credits=Decimal("5"),
                  reservation_id=third.reservation_id))
    st = db.all("SELECT status, credits FROM ai_usage_reservation WHERE id = :i", i=third.reservation_id)[0]
    assert st["status"] == "SETTLED" and Decimal(str(st["credits"])) == 5
    assert _auth(db, use_case="lesson_video", estimate_credits=5).allow
    assert _auth(db, use_case="lesson_video", estimate_credits=6).decision == "BLOCK"


def test_expired_reservations_are_ignored(db):
    db.row("INSTITUTE", hard=10)
    r = _auth(db, use_case="tutor_chat", estimate_credits=9, reserve=True)
    assert r.reservation_id
    assert _auth(db, estimate_credits=2).decision == "BLOCK"
    db.exec("UPDATE ai_usage_reservation SET expires_at = :t", t=datetime.now(UTC) - timedelta(seconds=1))
    assert _auth(db, estimate_credits=2).decision == "OK"
    rid = _auth(db, use_case="lesson_video", estimate_credits=1).reservation_id
    exp = db.all("SELECT created_at, expires_at FROM ai_usage_reservation WHERE id = :i", i=rid)[0]
    span = L._utc(exp["expires_at"]) - L._utc(exp["created_at"])
    assert timedelta(hours=1, minutes=59) < span <= timedelta(hours=2)    # video TTL


# ── counters: OVERRUN, refunds, what counts ─────────────────────────────────

def test_overrun_marking(db):
    db.row("USER", "u1", hard=5)
    assert _apply(db, ev(list_credits=Decimal("4"))) == "OK"
    assert _apply(db, ev(list_credits=Decimal("1"))) == "OK"       # exactly at the cap: not an overrun
    assert _apply(db, ev(list_credits=Decimal("0.5"))) == "OVERRUN"
    c = db.counters()[("U:u1|ALL", "DAY")]
    assert Decimal(str(c["credits_used"])) == Decimal("5.5") and Decimal(str(c["count_used"])) == 3


def test_overridden_rows_never_report_overrun(db):
    db.row("ROLE", "TEACHER", hard=1)
    db.row("USER", "u1", hard=None)
    assert _apply(db, ev(list_credits=Decimal("3"))) == "OK"


def test_counts_list_credits_not_charged_and_skips_bundled_children(db):
    db.row("INSTITUTE", hard=100)
    db.row("INSTITUTE", metric="COUNT", hard=100)
    _apply(db, ev(list_credits=Decimal("2.5"), credits_charged=Decimal("0")))     # e.g. INCLUDED in a plan
    assert _apply(db, ev(free_reason="BUNDLED")) == "NONE"
    assert _apply(db, ev(parent_event_id=str(uuid.uuid4()))) == "NONE"
    assert _apply(db, ev(limit_decision="BLOCKED_SKIPPED")) == "NONE"
    assert _apply(db, ev(use_case="voice_bot_llm", feature_group="calling")) == "NONE"   # not limit_eligible
    c = db.counters()[("I|ALL", "DAY")]
    assert Decimal(str(c["credits_used"])) == Decimal("2.5") and Decimal(str(c["count_used"])) == 1


def test_minutes_count_unit(db):
    db.row("INSTITUTE", scope_kind="USE_CASE", scope_value="tutor_live", metric="COUNT", hard=10)
    _apply(db, ev(use_case="tutor_live", minutes=Decimal("3")))
    c = db.counters()[("I|UC:tutor_live", "DAY")]
    assert Decimal(str(c["count_used"])) == 3


def test_refund_decrement_floors_at_zero(db):
    db.row("INSTITUTE", hard=100)
    db.row("INSTITUTE", metric="COUNT", hard=100)
    row = ev(list_credits=Decimal("4"))
    _apply(db, row)
    _apply(db, ev(list_credits=Decimal("1")))
    db.exec("UPDATE ai_usage_counter SET credits_used = 2")   # drift: counter lower than the event
    s = db.Session()
    with s.begin():
        assert L.decrement_for_refund(s, dict(row, refunded_credits=Decimal("0")), Decimal("3")) == "OK"
    s.close()
    c = db.counters()[("I|ALL", "DAY")]
    assert Decimal(str(c["credits_used"])) == 0 and Decimal(str(c["count_used"])) == 2
    s = db.Session()
    with s.begin():
        assert L.decrement_for_refund(s, dict(row, refunded_credits=Decimal("3")), Decimal("1")) == "OK"
        assert L.decrement_for_refund(s, row, Decimal("0")) == "NONE"
    s.close()
    c = db.counters()[("I|ALL", "DAY")]
    assert Decimal(str(c["credits_used"])) == 0 and Decimal(str(c["count_used"])) == 1   # fully refunded -> -1


def test_apply_uses_the_event_time_window(db):
    db.row("INSTITUTE", hard=100)
    yesterday = datetime.now(UTC) - timedelta(days=1)
    _apply(db, ev(occurred_at=yesterday, list_credits=Decimal("50")))
    assert _auth(db, estimate_credits=60).decision == "OK"          # yesterday's window is not today's


# ── rebuild ──────────────────────────────────────────────────────────────────

def test_rebuild_from_events(db):
    db.row("USER", "u1", hard=100)
    db.row("INSTITUTE", period="MONTH", hard=1000)
    db.row("ROLE", "TEACHER", per_member=False, hard=500)
    db.event(credits=2)
    db.event(credits=3, refunded=1)
    db.event(user="u2", credits=5)
    db.event(credits=7, free_reason="BUNDLED")                     # never counted
    db.event(credits=9, at=datetime.now(UTC) - timedelta(days=60))  # outside the scan
    db.exec("INSERT INTO ai_usage_counter (institute_id, counter_key, period, window_start, credits_used, "
            "count_used, cost_usd, updated_at) VALUES (:i, 'U:u1|ALL', 'DAY', :ws, 999, 999, 0, :n)",
            # stored in the format the ORM writes (SQLite has no timestamptz to normalise it)
            i=INST, ws=L.window_start("DAY", datetime.now(UTC)).strftime("%Y-%m-%d %H:%M:%S.%f"),
            n=datetime.now(UTC))
    s = db.Session()
    report = L.rebuild_counters(s, days=35)
    s.close()
    assert report["institutes"] == 1 and not report["errors"] and report["counters_fixed"] == 3
    c = db.counters()
    assert Decimal(str(c[("U:u1|ALL", "DAY")]["credits_used"])) == 4      # 2 + (3-1)
    assert Decimal(str(c[("U:u1|ALL", "DAY")]["count_used"])) == 2
    assert Decimal(str(c[("R:TEACHER|ALL", "DAY")]["credits_used"])) == 9
    month_start = L.window_start("MONTH", datetime.now(UTC))
    if month_start >= datetime.now(UTC) - timedelta(days=35):
        assert Decimal(str(c[("I|ALL", "MONTH")]["credits_used"])) == 9
    s = db.Session()
    again = L.rebuild_counters(s, days=35, institute_id=INST)
    s.close()
    assert again["counters_fixed"] == 0 and again["counters_checked"] >= 2


def test_live_counting_matches_rebuild(db):
    db.row("USER", "u1", hard=100)
    rows = [ev(list_credits=Decimal("1.25")), ev(list_credits=Decimal("2"))]
    for r in rows:
        _apply(db, r)
        db.event(credits=r["list_credits"], cost=r["real_cost_usd"])
    s = db.Session()
    assert L.rebuild_counters(s, days=35)["counters_fixed"] == 0
    s.close()


# ── preview + effective ─────────────────────────────────────────────────────

def test_preview_impact_replays_history(db):
    db.policy("OFF")
    base = datetime.now(UTC) - timedelta(days=2)
    for i in range(5):
        db.event(at=base + timedelta(minutes=i), credits=2, name="Ravi")
    db.event(at=base + timedelta(minutes=10), user="u2", credits=1)
    s = db.Session()
    out = L.preview_impact(s, INST, [{"subject_kind": "ROLE_CLASS", "subject_value": "TEACHER", "scope_kind": "ALL",
                                      "period": "DAY", "metric": "CREDITS", "soft_limit": 4, "hard_limit": 6}])
    s.close()
    # u1, judged as authorize does (use before the call + this call's estimate,
    # here its own 2 credits): 0+2 ok; 2+2, 4+2 warn; 6, 6 blocked; u2 fine
    assert out["events_considered"] == 6 and out["would_block"] == 2 and out["would_warn"] == 2
    assert out["affected_users"] == 1
    assert out["by_user"][0]["user_id"] == "u1" and out["by_user"][0]["name"] == "Ravi"
    assert out["by_use_case"][0]["use_case"] == "tutor_chat" and out["by_use_case"][0]["credits_blocked"] == 4.0
    assert out["by_row"][0]["row_id"] == "proposed:0"
    with pytest.raises(ValueError):
        L.preview_impact(db.Session(), INST, [{"subject_kind": "NOPE", "period": "DAY"}])


def test_effective_limits_explains(db):
    db.row("ROLE", "TEACHER", hard=10)
    db.row("USER", "u1", hard=None, soft=50)
    db.row("INSTITUTE", hard=1000, origin="PLATFORM", locked=True)
    _apply(db, ev(list_credits=Decimal("3")))
    s = db.Session()
    rows = L.effective_limits(s, INST, user_id="u1", role_class="TEACHER", raw_roles=["TEACHER"])
    s.close()
    by = {(e["scope"], e["selected"]): e for e in rows}
    assert by[("USER", True)]["used"] == 3 and by[("USER", True)]["decision"] == "OK"
    assert by[("ROLE", False)]["decision"] == "OVERRIDDEN" and "own limit" in by[("ROLE", False)]["why"]
    assert by[("PLATFORM", True)]["used"] == 3 and by[("PLATFORM", True)]["resets_at"].endswith("+05:30")
    # roles looked up from the user's latest event when not given
    db.event(user="u7", role_class="TEACHER", roles=["TEACHER"])
    s = db.Session()
    rows = L.effective_limits(s, INST, user_id="u7")
    s.close()
    assert any(e["scope"] == "ROLE" and e["selected"] for e in rows)


def test_validate_row_input():
    ok = L.validate_row_input({"subject_kind": "role", "subject_value": "content creator", "scope_kind": "use_case",
                               "scope_value": "Tutor_Chat", "period": "week", "metric": "count", "soft_limit": "2",
                               "hard_limit": 5, "per_member": False}, use_cases=["tutor_chat"])
    assert ok["subject_value"] == "CONTENT_CREATOR" and ok["scope_value"] == "tutor_chat" and ok["per_member"] is False
    assert ok["hard_limit"] == Decimal("5") and ok["locked"] is False
    for bad in ({"subject_kind": "USER", "period": "DAY"},
                {"subject_kind": "INSTITUTE", "period": "YEAR"},
                {"subject_kind": "INSTITUTE", "period": "DAY", "soft_limit": 5, "hard_limit": 2},
                {"subject_kind": "INSTITUTE", "period": "DAY", "hard_limit": -1},
                {"subject_kind": "INSTITUTE", "period": "DAY", "scope_kind": "GROUP"},
                {"subject_kind": "INSTITUTE", "period": "DAY", "scope_kind": "USE_CASE", "scope_value": "x"}):
        with pytest.raises(ValueError):
            L.validate_row_input(bad, use_cases=["tutor_chat"])


def test_usage_windows_and_labels(db):
    db.row("INSTITUTE", period="DAY", hard=10)
    _apply(db, ev(list_credits=Decimal("4")))
    s = db.Session()
    out = L.usage_windows(s, INST, "DAY")
    s.close()
    assert out == [dict(out[0], key="I|ALL", label="Institute · All AI", credits_used=4, hard=10, pct=40)]


def test_session_left_clean_after_authorize(db):
    db.row("INSTITUTE", hard=10)
    s = db.Session()
    try:
        assert not s.in_transaction()
        L.authorize(s, institute_id=INST, use_case="tutor_chat", ctx=TEACHER)
        assert not s.in_transaction()           # no idle-in-transaction behind a long AI call
        s.execute(text("SELECT 1"))
        assert s.in_transaction()
        L.authorize(s, institute_id=INST, use_case="lesson_video", ctx=TEACHER, estimate_credits=1)
        assert s.in_transaction()               # caller's transaction left as it was (SAVEPOINT / own session)
    finally:
        s.close()


# ── review fixes (2026-10-15) ────────────────────────────────────────────────

def test_preview_user_row_outranks_role_class_and_still_counts(db):
    """An out-ranked row must not end the event's evaluation: the USER row
    replaces the ROLE_CLASS row for u1 and is what the preview judges by."""
    db.policy("SHADOW")
    db.row("ROLE_CLASS", "TEACHER", hard=100)
    base = datetime.now(UTC) - timedelta(hours=3)
    for i in range(5):
        db.event(at=base + timedelta(minutes=i), credits=1)
    s = db.Session()
    out = L.preview_impact(s, INST, [{"subject_kind": "USER", "subject_value": "u1", "scope_kind": "ALL",
                                      "period": "DAY", "metric": "CREDITS", "hard_limit": 2}])
    s.close()
    assert out["events_considered"] == 5
    assert out["would_block"] == 3 and out["affected_users"] == 1, out
    assert out["by_user"][0]["user_id"] == "u1" and out["by_user"][0]["would_block"] == 3


def test_preview_uses_the_estimate_authorize_uses(db):
    """hard 10, calls of 3: authorize blocks the 4th (9 + 3 > 10); so must the preview."""
    db.policy("SHADOW")
    base = datetime.now(UTC) - timedelta(hours=3)
    for i in range(5):
        db.event(at=base + timedelta(minutes=i), credits=3)
    s = db.Session()
    out = L.preview_impact(s, INST, [{"subject_kind": "USER", "subject_value": "u1", "scope_kind": "ALL",
                                      "period": "DAY", "metric": "CREDITS", "hard_limit": 10}])
    s.close()
    assert out["would_block"] == 2, out          # the 4th and the 5th
    # and the live gate agrees: three calls counted, the 4th refused
    db.policy("ENFORCE")
    db.row("USER", "u1", hard=10)
    for _ in range(3):
        _apply(db, ev(list_credits=Decimal("3")))
    assert _auth(db, estimate_credits=3).decision == "BLOCK"


def test_per_member_role_class_counts_events_without_a_role(db):
    """A charge path that only knows the user id (role UNRESOLVED) still
    counts toward the per-member ROLE_CLASS cap the gate enforces."""
    db.row("ROLE_CLASS", "TEACHER", scope_kind="USE_CASE", scope_value="tutor_chat", hard=3)
    for _ in range(3):
        assert _apply(db, ev(actor_role_class=None, actor_roles_raw=None, list_credits=Decimal("1"))) in ("OK", "OVERRUN")
    c = db.counters()
    assert Decimal(str(c[("U:u1|UC:tutor_chat", "DAY")]["credits_used"])) == 3
    assert _auth(db).decision == "BLOCK"


def test_pooled_role_class_takes_the_gate_role_for_unresolved_events(db):
    db.row("ROLE_CLASS", "TEACHER", per_member=False, hard=100)
    assert _auth(db).decision == "OK"                         # the gate sees the JWT roles: remembered
    _apply(db, ev(actor_role_class=None, actor_roles_raw=None, list_credits=Decimal("2")))
    assert Decimal(str(db.counters()[("RC:TEACHER|ALL", "DAY")]["credits_used"])) == 2


def test_gate_without_roles_uses_the_latest_resolved_event(db):
    """admin_core's agent / workflow gates send only a user id: the role
    comes from the user's latest event with a resolved role."""
    db.row("ROLE_CLASS", "TEACHER", per_member=False, hard=2)
    db.event(credits=2)                                       # resolved TEACHER event
    _apply(db, ev(list_credits=Decimal("2")))
    out = _auth(db, ctx={"actor_kind": "USER", "actor_user_id": "u1"})
    assert out.decision == "BLOCK" and out.block["scope"] == "ROLE_CLASS"
    # an unknown user has no role: the ROLE_CLASS row does not apply (fail open)
    assert _auth(db, ctx={"actor_kind": "USER", "actor_user_id": "nobody"}).decision == "OK"


def test_upgrade_takes_back_a_zero_credit_counted_event_completely(db):
    db.row("USER", "u1", metric="COUNT", hard=20)
    free = ev(list_credits=Decimal("0"), real_cost_usd=Decimal("0"))
    assert _apply(db, free) == "OK"
    s = db.Session()
    with s.begin():
        assert L.remove_event_contribution(s, dict(free, limit_decision="OK")) == "OK"
    s.close()
    _apply(db, dict(free, list_credits=Decimal("2")))         # the same request, now charged
    c = db.counters()[("U:u1|ALL", "DAY")]
    assert Decimal(str(c["count_used"])) == 1 and Decimal(str(c["credits_used"])) == 2


def test_numbers_hidden_from_learners_by_default(db):
    db.policy("ENFORCE", show=False)
    db.row("INSTITUTE", soft=1, hard=5)
    db.row("INSTITUTE", metric="COST_USD", hard=1000)
    learner = {"actor_kind": "USER", "actor_user_id": "l1", "actor_roles_raw": ["STUDENT"]}
    admin = {"actor_kind": "USER", "actor_user_id": "a1", "actor_roles_raw": ["ADMIN"]}
    _apply(db, ev(actor_user_id="l1", actor_role_class="LEARNER", actor_roles_raw=["STUDENT"],
                  list_credits=Decimal("2")))
    warn = _auth(db, ctx=learner)
    assert warn.decision == "WARN" and all(w.get("hide_pct") for w in warn.warnings)
    assert L.warning_header(warn) == "tutor_chat"            # no institute percentage for a learner
    assert G.warning_header_value(warn.warnings) == "tutor_chat"
    _apply(db, ev(actor_user_id="l1", actor_role_class="LEARNER", actor_roles_raw=["STUDENT"],
                  list_credits=Decimal("4")))
    blk = _auth(db, ctx=learner)
    assert blk.decision == "BLOCK" and blk.block["limit"] is None and blk.block["used"] is None
    assert blk.block["scope"] == "INSTITUTE" and blk.block["resets_at"] and blk.block["message"]
    adm = _auth(db, ctx=admin)
    assert adm.block["limit"] == 5 and adm.block["used"] == 6   # institute admins see the numbers
    # a learner allowed to see numbers sees credit amounts, never vendor dollars
    db.policy("ENFORCE", show=True)
    assert _auth(db, ctx=learner).block["limit"] == 5
    db.exec("UPDATE ai_usage_limit SET hard_limit = 0.000001 WHERE metric = 'COST_USD'")
    db.exec("UPDATE ai_usage_limit SET hard_limit = 1000 WHERE metric = 'CREDITS'")
    L.invalidate(INST)
    _apply(db, ev(actor_user_id="l1", actor_role_class="LEARNER", actor_roles_raw=["STUDENT"],
                  list_credits=Decimal("1"), real_cost_usd=Decimal("0.5")))
    usd = _auth(db, ctx=admin)
    assert usd.block["unit"] == "usd" and usd.block["limit"] is None and usd.block["used"] is None


def test_rebuild_adds_corrections_and_keeps_later_increments(db):
    db.row("USER", "u1", hard=100)
    db.event(credits=2)
    _apply(db, ev(list_credits=Decimal("2")))
    db.exec("UPDATE ai_usage_counter SET credits_used = 0, count_used = 0")   # drift
    real_write = L._rebuild_write

    def charge_then_write(s, *a, **kw):
        # a charge (event + its counter increment) lands after the snapshot,
        # before the corrections are written
        db.event(credits=5)
        _apply(db, ev(list_credits=Decimal("5")))
        return real_write(s, *a, **kw)

    L._rebuild_write = charge_then_write
    try:
        s = db.Session()
        rep = L.rebuild_counters(s, days=35, institute_id=INST)
        s.close()
    finally:
        L._rebuild_write = real_write
    assert rep["counters_fixed"] == 1 and not rep["errors"]
    c = db.counters()[("U:u1|ALL", "DAY")]
    assert Decimal(str(c["credits_used"])) == 7 and Decimal(str(c["count_used"])) == 2   # 2 corrected + 5 kept


def test_notify_changed_rebuilds_again_after_the_cache_ttl(db, monkeypatch):
    import time as _time

    monkeypatch.setattr(L, "DELAYED_REBUILD_SECONDS", 0.05)
    db.row("USER", "u1", hard=100)
    s = db.Session()
    L.notify_changed(s, INST)
    s.close()
    # another pod, still on the old rows, wrote the event without this counter
    db.event(credits=4)
    deadline = _time.monotonic() + 5
    while _time.monotonic() < deadline:
        c = db.counters().get(("U:u1|ALL", "DAY"))
        if c and Decimal(str(c["credits_used"])) == 4:
            break
        _time.sleep(0.02)
    assert Decimal(str(db.counters()[("U:u1|ALL", "DAY")]["credits_used"])) == 4
