"""AI subscription plan engine (services/metering/plans.py, contract P-ENGINE)
against a real SQL database (file SQLite with real SAVEPOINTs) plus pure-function
tests.

What must hold (d_plans §3.3 + critique overrides):
  * flag off / no live subscription: CHARGED with ZERO statements on the session;
  * the decision order: eligibility guard (and the hard-coded ai_calling /
    telephony lock) beats any override or item; an active override beats the
    item; no item = CHARGED;
  * INCLUDED needs roles_included, the model policy (DEFAULT_CHAIN / ALLOWLIST /
    MAX_PRICE / ANY, explicit picks) and every fair-use scope; over cap =
    CHARGED and NOTHING reserved (all scopes in one savepoint);
  * allowance exact -> ALLOWANCE, partial -> SPLIT, exhausted -> CHARGED;
  * SHADOW: CHARGED with shadow_mode, no counter / allowance / period writes,
    usage read back from earlier shadow events;
  * GRACE, ENDED, NOT_STARTED, DRAFT version, non-renewing later periods;
  * release() undoes everything in the same transaction and nothing after it;
  * every failure fails SAFE (CHARGED) and leaves the caller's transaction usable;
  * precheck is read-only; simulate and pnl numbers on crafted events.

No network, no Postgres (see test_plans_engine_pg.py). Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_plans_engine.py -q -p no:cacheprovider
"""
from __future__ import annotations

import json
import os
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

from ai_service.app.services import model_selection  # noqa: E402
from ai_service.app.services.metering import cache as mcache  # noqa: E402
from ai_service.app.services.metering import limits as L  # noqa: E402
from ai_service.app.services.metering import plans as P  # noqa: E402
from ai_service.app.services.metering.limit_models import LimitsBase  # noqa: E402
from ai_service.app.services.metering.models import Base as MeteringBase  # noqa: E402
from ai_service.app.services.metering.plan_models import PlansBase  # noqa: E402

_REAL_MAYBE_REFRESH = P._maybe_refresh_index

INST = "inst-plan"
UTC = timezone.utc
D = Decimal
GLM = "z-ai/glm-5.3-flash"
GEMINI = "google/gemini-2.5-flash"
SONNET = "anthropic/claude-sonnet-5"
MINI = "openai/gpt-5-mini"

FEATURES = [
    # key, eligibility, locked
    ("learner_assistant", "INCLUDABLE", False),
    ("tutor_chat", "INCLUDABLE", False),
    ("content_generation", "INCLUDABLE", False),
    ("learner_analytics", "INCLUDABLE", False),
    ("copy_check", "INCLUDABLE", False),
    ("image_generation", "ALLOWANCE_ONLY", False),
    ("video_lesson", "ALLOWANCE_ONLY", False),
    ("premium_tts", "ALWAYS_CHARGED", False),
    ("ai_calling", "ALWAYS_CHARGED", True),
    ("telephony", "ALWAYS_CHARGED", True),
    ("unmapped", "ALWAYS_CHARGED", False),
]

CATALOG = [
    # use_case, group, model_use_case, request types, tool keys, billing feature
    ("learner_assistant", "agent", None, ["agent"], [], "learner_assistant"),
    ("tutor_chat", "tutor", None, ["conversation"], [], "tutor_chat"),
    ("content", "content", "content", ["content"], ["html_document"], "content_generation"),
    ("learner_analytics", "analytics", "analytics", ["analytics"], [], "learner_analytics"),
    ("evaluation", "assessment", "evaluation", ["evaluation"], [], "copy_check"),
    ("content_image", "media", None, ["image"], [], "image_generation"),
    ("lesson_video", "video", "video", ["video"], [], "video_lesson"),
    ("tts", "media", None, ["tts_premium"], [], "premium_tts"),
    ("ai_calling", "calling", None, ["ai_call_out"], [], "ai_calling"),
    ("unknown", "platform", None, [], [], "unmapped"),
]

EXTRA_DDL = """
CREATE TABLE IF NOT EXISTS ai_model_defaults (use_case VARCHAR(64) PRIMARY KEY, default_model_id VARCHAR(255),
                                              fallback_model_id VARCHAR(255));
CREATE TABLE IF NOT EXISTS ai_models (model_id VARCHAR(255) PRIMARY KEY, output_price_per_1m NUMERIC(12,6),
                                      is_active BOOLEAN DEFAULT 1);
CREATE TABLE IF NOT EXISTS institute_credits (institute_id VARCHAR(64) PRIMARY KEY, current_balance NUMERIC);
"""


def _stripped(base):
    md = MetaData()
    for table in base.metadata.tables.values():
        t = table.to_metadata(md)
        for c in t.columns:
            c.server_default = None
    return md


class World:
    def __init__(self):
        fd, self.path = tempfile.mkstemp(suffix=".sqlite3", prefix="plans-test-")
        os.close(fd)
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
        _stripped(LimitsBase).create_all(self.engine)
        _stripped(PlansBase).create_all(self.engine)
        with self.engine.begin() as c:
            c.exec_driver_sql("ALTER TABLE ai_use_case_catalog ADD COLUMN billing_feature_key VARCHAR(48)")
            for stmt in EXTRA_DDL.strip().split(";"):
                if stmt.strip():
                    c.exec_driver_sql(stmt)
            for i, (key, elig, locked) in enumerate(FEATURES):
                c.execute(text("INSERT INTO ai_billing_feature (feature_key, label, eligibility, locked, display_order, "
                               "is_active) VALUES (:k, :l, :e, :lk, :o, 1)"),
                          {"k": key, "l": key.replace("_", " ").title(), "e": elig, "lk": 1 if locked else 0,
                           "o": i * 10})
            for i, (uc, fg, muc, rts, tks, fk) in enumerate(CATALOG):
                c.execute(text(
                    "INSERT INTO ai_use_case_catalog (use_case, feature_group, label, count_unit_label, model_use_case, "
                    "legacy_request_types, tool_keys, default_surface, actor_kind, unit_kind, billing_policy, "
                    "plan_eligible, limit_eligible, reserve_on_authorize, intentionally_separate, is_active, "
                    "display_order, billing_feature_key) VALUES (:u, :f, :u, 'requests', :m, :r, :t, 'UNKNOWN', "
                    "'USER', 'TOKENS', 'AS_TODAY', 1, 1, 0, 0, 1, :o, :fk)"),
                    {"u": uc, "f": fg, "m": muc, "r": json.dumps(rts), "t": json.dumps(tks), "o": i * 10, "fk": fk})
            for uc, dm, fm in (("content", GLM, MINI), ("analytics", GLM, None), ("evaluation", GLM, None),
                               ("video", GLM, None)):
                c.execute(text("INSERT INTO ai_model_defaults VALUES (:u, :d, :f)"), {"u": uc, "d": dm, "f": fm})
            for m, price in ((GLM, 0.4), (SONNET, 15), (MINI, 2), (GEMINI, 2.5)):
                c.execute(text("INSERT INTO ai_models (model_id, output_price_per_1m, is_active) VALUES (:m, :p, 1)"),
                          {"m": m, "p": price})
        self.Session = sessionmaker(bind=self.engine, future=True, expire_on_commit=False)
        s = self.Session()
        assert mcache.get_snapshot(s) is not None
        s.commit()
        s.close()
        P.configure(sessionmaker=self.Session)
        assert P.refresh_index()

    # ── data helpers ─────────────────────────────────────────────────────────
    def exec(self, sql, **params):
        with self.engine.begin() as c:
            c.execute(text(sql), params)

    def all(self, sql, **params):
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(text(sql), params).mappings().all()]

    def one(self, sql, **params):
        rows = self.all(sql, **params)
        return rows[0] if rows else None

    def plan(self, items, *, allowance=0, cost_cap=None, status="PUBLISHED", grace_behaviour="CHARGED",
             period_months=1, price_minor=500000):
        pid, vid = str(uuid.uuid4()), str(uuid.uuid4())
        now = datetime.now(UTC)
        self.exec("INSERT INTO ai_plan (id, plan_key, name, is_active, created_at, updated_at) "
                  "VALUES (:i, :k, 'Test plan', 1, :n, :n)", i=pid, k=f"p_{pid[:8]}", n=now)
        self.exec("INSERT INTO ai_plan_version (id, plan_id, version_no, status, currency, price_minor, "
                  "is_tax_inclusive, period_months, allowance_credits, internal_cost_cap_usd, grace_days, "
                  "grace_behaviour, migrate_existing_at_renewal, created_at, updated_at) VALUES (:v, :p, 1, :st, "
                  "'INR', :pr, 0, :pm, :a, :cc, 7, :gb, 0, :n, :n)",
                  v=vid, p=pid, st=status, pr=price_minor, pm=period_months, a=allowance, cc=cost_cap,
                  gb=grace_behaviour, n=now)
        for fk, spec in items.items():
            spec = dict(spec)
            roles = spec.pop("roles_included", None)
            allow = spec.pop("model_allowlist", None)
            vals = dict(id=str(uuid.uuid4()), plan_version_id=vid, feature_key=fk, mode=spec.pop("mode"),
                        model_policy=spec.pop("model_policy", "DEFAULT_CHAIN"),
                        model_allowlist=json.dumps(allow) if allow is not None else None,
                        max_output_price_per_1m=spec.pop("max_output_price_per_1m", None),
                        on_model_violation=spec.pop("on_model_violation", "CHARGE"),
                        roles_included=json.dumps(roles) if roles is not None else None,
                        inst_units_cap=spec.pop("inst_units_cap", None),
                        inst_credits_cap=spec.pop("inst_credits_cap", None),
                        inst_cost_usd_cap=spec.pop("inst_cost_usd_cap", None),
                        user_units_cap=spec.pop("user_units_cap", None),
                        user_credits_cap=spec.pop("user_credits_cap", None),
                        user_cap_basis=spec.pop("user_cap_basis", "ACTOR"),
                        over_cap_action=spec.pop("over_cap_action", "CHARGE"),
                        display_cap_text=spec.pop("display_cap_text", None))
            assert not spec, spec
            cols = ", ".join(vals)
            self.exec(f"INSERT INTO ai_plan_item ({cols}) VALUES ({', '.join(':' + k for k in vals)})", **vals)
        P.invalidate()
        return vid

    def subscribe(self, version_id, *, enforcement="LIVE", status="ACTIVE", start=None, anchor=None, end=None,
                  auto_renew=True, cancel_at_period_end=False, grace_days=7, source="MANUAL", inst=INST,
                  pending=None, updated_at=None, price_override=None, period_months=1):
        sid = str(uuid.uuid4())
        now = datetime.now(UTC)
        start = start or now - timedelta(days=3)
        self.exec("INSERT INTO institute_ai_subscription (id, institute_id, plan_version_id, status, enforcement, "
                  "source, anchor_at, start_at, end_at, period_months, auto_renew, grace_days, cancel_at_period_end, "
                  "pending_plan_version_id, price_override_minor, created_by, created_at, updated_at) VALUES "
                  "(:id, :i, :v, :st, :en, :src, :an, :sa, :ea, :pm, :ar, :gd, :cp, :pv, :po, 'test', :n, :u)",
                  id=sid, i=inst, v=version_id, st=status, en=enforcement, src=source, an=anchor or start, sa=start,
                  ea=end, pm=period_months, ar=1 if auto_renew else 0, gd=grace_days,
                  cp=1 if cancel_at_period_end else 0, pv=pending, po=price_override, n=now, u=updated_at or now)
        P.invalidate()
        P.set_index_for_tests([r["institute_id"] for r in self.all(
            "SELECT institute_id FROM institute_ai_subscription WHERE status IN ('TRIAL','ACTIVE','GRACE')")])
        return sid

    def override(self, sub_id, feature, *, active=True, **caps):
        oid = str(uuid.uuid4())
        vals = dict(id=oid, subscription_id=sub_id, feature_key=feature, mode=caps.pop("mode", None),
                    reason="deal", created_by="test", created_at=datetime.now(UTC), is_active=1 if active else 0)
        vals.update(caps)
        cols = ", ".join(vals)
        self.exec(f"INSERT INTO ai_subscription_override ({cols}) VALUES ({', '.join(':' + k for k in vals)})", **vals)
        P.invalidate()
        return oid

    def event(self, **kw):
        now = datetime.now(UTC)
        vals = dict(id=str(uuid.uuid4()), occurred_at=now, institute_id=INST, actor_kind="USER", actor_user_id="u1",
                    actor_role_class="TEACHER", role_source="CALLER", subject_user_id=None, use_case="content",
                    use_case_source="EXPLICIT", feature_group="content", surface="ADMIN_APP", source_service="ai_service",
                    model_id=GLM, byo_key=0, request_count=1, real_cost_usd=None, cost_source="UNKNOWN",
                    list_credits=D("1"), credits_charged=D("1"), refunded_credits=D("0"), billing_mode="CHARGED",
                    shadow_billing_mode=None, charge_status="POSTED", limit_decision="NONE", parent_event_id=None,
                    free_reason=None, subscription_id=None, created_at=now)
        vals.update(kw)
        for k, v in list(vals.items()):
            if isinstance(v, Decimal):
                vals[k] = float(v)
        cols = ", ".join(vals)
        self.exec(f"INSERT INTO ai_usage_event ({cols}) VALUES ({', '.join(':' + k for k in vals)})", **vals)

    def counters(self):
        return {r["counter_key"]: (D(str(r["credits_used"])), D(str(r["count_used"])), D(str(r["cost_usd"])))
                for r in self.all("SELECT * FROM ai_usage_counter WHERE period = 'PLAN_PERIOD'")}

    def decide(self, commit=True, **kw):
        args = dict(institute_id=INST, list_credits=1, use_case="learner_assistant", model=GLM, actor_user_id="u1",
                    role_class="TEACHER")
        args.update(kw)
        s = self.Session()
        try:
            d = P.decide(s, **args)
            if commit:
                s.commit()
            else:
                s.rollback()
            return d
        finally:
            s.close()


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    P.reset_for_tests()
    L.reset_for_tests()
    mcache.reset_cache()
    model_selection.invalidate_cache()
    settings = {"billing.plans.enabled": True, "billing.inr_per_usd": 86, "metering.events.enabled": True}
    monkeypatch.setattr(mcache, "setting_value", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(mcache, "peek_setting", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(P, "_maybe_refresh_index", lambda: None)
    yield settings
    P.reset_for_tests()
    mcache.reset_cache()
    model_selection.invalidate_cache()


@pytest.fixture
def w():
    world = World()
    yield world
    world.engine.dispose()
    try:
        os.unlink(world.path)
    except OSError:
        pass


LA_INCLUDED = {"learner_assistant": {"mode": "INCLUDED"}}


# ── gate: zero statements ────────────────────────────────────────────────────

def test_flag_off_is_charged_with_zero_statements(w, _isolate):
    vid = w.plan(LA_INCLUDED)
    w.subscribe(vid)
    _isolate["billing.plans.enabled"] = False
    assert P.has_live_subscription(INST) is False
    s = w.Session()
    w.statements.clear()
    d = P.decide(s, institute_id=INST, list_credits=5, use_case="learner_assistant", model=GLM)
    assert w.statements == []
    assert (d.billing_mode, d.wallet_credits, d.reason) == ("CHARGED", D("5.0000"), "PLANS_OFF")
    assert P.precheck(s, institute_id=INST, use_case="learner_assistant")["covered"] is False
    assert w.statements == []
    s.close()


def test_flag_off_starts_no_thread_and_never_reloads_settings(w, _isolate, monkeypatch):
    """Review fix: with the flag off the gate only PEEKS the settings cache: no
    background thread, no settings reload on a fresh session (the platform's
    other settings readers keep the cache fresh)."""
    started = []
    monkeypatch.setattr(P, "_background", lambda target, name: started.append(name))
    monkeypatch.setattr(mcache, "setting_value", lambda key, default: started.append(f"setting_value:{key}"))
    _isolate["billing.plans.enabled"] = False
    for _ in range(5):
        assert P.has_live_subscription(INST) is False
    assert started == []
    assert not hasattr(P, "_maybe_refresh_settings")


def test_had_subscription_is_in_memory_and_never_forgets(w, _isolate):
    P.set_index_for_tests(["i-live"], known=["i-ended"])
    assert P.had_subscription("i-live") and P.had_subscription("i-ended") and not P.had_subscription("i-never")
    P.invalidate("i-cancelled", live=False)
    assert P.had_subscription("i-cancelled")
    _isolate["billing.plans.enabled"] = False             # flag off: the last good set is kept
    assert P.had_subscription("i-ended") and not P.had_subscription("i-never")
    P.reset_for_tests()                                  # a new pod, flag off: nothing known, no I/O
    assert not P.had_subscription("i-ended")
    _isolate["billing.plans.enabled"] = True             # a new pod, flag on, index not loaded: unknown = True
    assert P.had_subscription("i-never")


def test_tool_level_features_beat_the_use_case_mapping(w):
    for i, (key, elig) in enumerate((("kb_qa", "INCLUDABLE"), ("kb_ingest", "ALLOWANCE_ONLY"),
                                     ("tutor_live_minutes", "ALLOWANCE_ONLY"),
                                     ("tutor_avatar_minutes", "ALLOWANCE_ONLY"))):
        w.exec("INSERT INTO ai_billing_feature (feature_key, label, eligibility, locked, display_order, is_active) "
               "VALUES (:k, :k, :e, 0, :o, 1)", k=key, e=elig, o=500 + i)
    for i, (uc, tks, fk) in enumerate((("knowledge_base", ["kb_ingest_page", "kb_ingest_url", "kb_ask",
                                                           "kb_library_unlock"], "kb_qa"),
                                       ("tutor_live", ["tutor_live_minute", "tutor_avatar_minute"],
                                        "tutor_live_minutes"))):
        w.exec("INSERT INTO ai_use_case_catalog (use_case, feature_group, label, count_unit_label, model_use_case, "
               "legacy_request_types, tool_keys, default_surface, actor_kind, unit_kind, billing_policy, plan_eligible, "
               "limit_eligible, reserve_on_authorize, intentionally_separate, is_active, display_order, "
               "billing_feature_key) VALUES (:u, 'kb', :u, 'requests', NULL, '[]', :t, 'UNKNOWN', 'USER', 'TOKENS', "
               "'AS_TODAY', 1, 1, 0, 0, 1, :o, :fk)", u=uc, t=json.dumps(tks), o=900 + i, fk=fk)
    mcache.reset_cache()
    s = w.Session()
    mcache.get_snapshot(s)
    s.commit()
    s.close()
    assert P.refresh_index()
    vid = w.plan({"kb_qa": {"mode": "INCLUDED", "model_policy": "ANY"}, "kb_ingest": {"mode": "ALLOWANCE"},
                  "tutor_live_minutes": {"mode": "ALLOWANCE"}}, allowance=100)
    w.subscribe(vid)
    assert P.feature_for(use_case="knowledge_base", tool_key="kb_ask") == "kb_qa"
    for tk in ("kb_ingest_page", "kb_ingest_url", "kb_library_unlock", "KB_INGEST_PAGE"):
        assert P.feature_for(use_case="knowledge_base", tool_key=tk) == "kb_ingest", tk
    assert P.feature_for(tool_key="tutor_avatar_minute") == "tutor_avatar_minutes"
    assert w.decide(use_case="knowledge_base", tool_key="kb_ask").billing_mode == "INCLUDED"
    d = w.decide(use_case="knowledge_base", tool_key="kb_ingest_page", list_credits=5)
    assert (d.billing_mode, d.feature_key) == ("ALLOWANCE", "kb_ingest")


def test_no_subscription_is_charged_with_zero_statements(w):
    P.set_index_for_tests([])
    s = w.Session()
    w.statements.clear()
    d = P.decide(s, institute_id=INST, list_credits=3, use_case="learner_assistant", model=GLM)
    pc = P.precheck(s, institute_id=INST, use_case="learner_assistant", estimate=3)
    assert w.statements == []
    assert (d.billing_mode, d.wallet_credits, d.reason, d.subscription_id) == ("CHARGED", D("3"), "NO_SUBSCRIPTION",
                                                                               None)
    assert pc["covered"] is False
    s.close()


def test_index_refresh_loads_live_institutes_only(w):
    vid = w.plan(LA_INCLUDED)
    w.subscribe(vid, inst="i-active")
    w.subscribe(vid, inst="i-expired", status="EXPIRED")
    w.subscribe(vid, inst="i-sched", status="SCHEDULED")
    P.set_index_for_tests([])
    assert P.refresh_index()
    assert P.has_live_subscription("i-active")
    assert not P.has_live_subscription("i-expired")
    assert not P.has_live_subscription("i-sched")
    assert P.feature_for("learner_assistant") == "learner_assistant"


# ── feature mapping ──────────────────────────────────────────────────────────

def test_feature_for_resolves_use_case_tool_key_request_type_and_unmapped(w):
    assert P.feature_for(use_case="content") == "content_generation"
    assert P.feature_for(tool_key="html_document") == "content_generation"
    assert P.feature_for(request_type="evaluation") == "copy_check"
    assert P.feature_for(request_type="ai_call_out") == "ai_calling"
    assert P.feature_for(use_case="no_such_thing") == "unmapped"
    assert P.feature_for(request_type="never_seen") == "unmapped"


# ── INCLUDED, roles, models ──────────────────────────────────────────────────

def test_included_writes_plan_counters_and_no_wallet_part(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 10, "user_units_cap": 5}},
                 cost_cap=1)
    sid = w.subscribe(vid)
    d = w.decide(list_credits=2, cost_usd=0.01)
    assert d.billing_mode == "INCLUDED"
    assert (d.wallet_credits, d.included_credits, d.allowance_credits) == (0, D("2.0000"), 0)
    assert d.subscription_id == sid and d.plan_version_id == vid and d.plan_item_id
    assert d.enforcement == "LIVE" and d.period_id
    assert d.event_fields()["billing_mode"] == "INCLUDED"
    c = w.counters()
    assert c[f"PLAN:{sid}|ALL"] == (D("2"), D("1"), D("0.01"))
    assert c[f"PLAN:{sid}|F:learner_assistant"] == (D("2"), D("1"), D("0.01"))
    assert c[f"PLAN:{sid}|F:learner_assistant|U:u1"][1] == D("1")
    row = w.one("SELECT * FROM ai_usage_counter WHERE counter_key = :k", k=f"PLAN:{sid}|ALL")
    period = w.one("SELECT * FROM ai_subscription_period WHERE subscription_id = :s", s=sid)
    assert row["institute_id"] == INST and str(row["window_start"]) == str(period["period_start"])


def test_included_without_caps_writes_no_counter(w):
    vid = w.plan(LA_INCLUDED)
    w.subscribe(vid)
    assert w.decide(list_credits=1).billing_mode == "INCLUDED"
    assert w.counters() == {}


def test_roles_included_uses_role_classes(w):
    vid = w.plan({"tutor_chat": {"mode": "INCLUDED", "roles_included": ["LEARNER"]}})
    w.subscribe(vid)
    assert w.decide(use_case="tutor_chat", role_class=None, user_role="STUDENT").billing_mode == "INCLUDED"
    assert w.decide(use_case="tutor_chat", role_class="LEARNER").billing_mode == "INCLUDED"
    d = w.decide(use_case="tutor_chat", role_class="TEACHER")
    assert (d.billing_mode, d.reason) == ("CHARGED", "ROLE_NOT_INCLUDED")
    d = w.decide(use_case="tutor_chat", role_class=None, user_role=None)
    assert (d.billing_mode, d.reason) == ("CHARGED", "ROLE_NOT_INCLUDED")
    assert w.decide(use_case="tutor_chat", role_class=None, actor_roles=["TEACHER", "STUDENT"]).reason == \
        "ROLE_NOT_INCLUDED"  # most privileged role wins


def test_roles_included_empty_array_includes_nobody(w):
    vid = w.plan({"tutor_chat": {"mode": "INCLUDED", "roles_included": []}})
    w.subscribe(vid)
    assert w.decide(use_case="tutor_chat", role_class="LEARNER").reason == "ROLE_NOT_INCLUDED"


def test_default_chain_policy(w):
    vid = w.plan({"content_generation": {"mode": "INCLUDED"}, "learner_analytics": {"mode": "INCLUDED"}})
    w.subscribe(vid)
    assert w.decide(use_case="content", model=GLM).billing_mode == "INCLUDED"
    # a fallback model is what a user could also pick: with no word on whether it was picked,
    # only the chain's primary is included (critique C12 fail-safe); "not picked" includes the chain
    assert w.decide(use_case="content", model=MINI).reason == "MODEL_NOT_INCLUDED"
    assert w.decide(use_case="content", model=MINI, preferred_model_explicit=False).billing_mode == "INCLUDED"
    # content's chain already has a non-GLM fallback (MINI), so gemini is not appended to it
    assert w.decide(use_case="content", model=GEMINI, preferred_model_explicit=False).reason == "MODEL_NOT_INCLUDED"
    assert w.decide(use_case="learner_analytics", model=GEMINI).reason == "MODEL_NOT_INCLUDED"
    assert w.decide(use_case="learner_analytics", model=GEMINI,
                    preferred_model_explicit=False).billing_mode == "INCLUDED"   # GLM-only chain
    d = w.decide(use_case="content", model=SONNET)
    assert (d.billing_mode, d.reason, d.block) == ("CHARGED", "MODEL_NOT_INCLUDED", False)
    assert w.decide(use_case="content", model=None).billing_mode == "INCLUDED"        # tool-priced
    # an explicit pick is never included under DEFAULT_CHAIN, even of the default model
    assert w.decide(use_case="content", model=GLM, preferred_model_explicit=True).reason == "MODEL_NOT_INCLUDED"


def test_default_chain_without_model_use_case_is_the_platform_chain(w):
    vid = w.plan(LA_INCLUDED)
    w.subscribe(vid)
    assert w.decide(model=GLM).billing_mode == "INCLUDED"
    assert w.decide(model=GEMINI).reason == "MODEL_NOT_INCLUDED"            # fallback, maybe picked
    assert w.decide(model=GEMINI, preferred_model_explicit=False).billing_mode == "INCLUDED"
    assert w.decide(model=MINI, preferred_model_explicit=False).reason == "MODEL_NOT_INCLUDED"


def test_alias_is_canonicalised_before_the_chain_check(w):
    w.exec("INSERT INTO ai_model_alias (alias, model_id) VALUES ('glm-5.3-flash', :m)", m=GLM)
    mcache.reset_cache()
    s = w.Session()
    mcache.get_snapshot(s)
    s.commit()
    s.close()
    vid = w.plan({"content_generation": {"mode": "INCLUDED"}})
    w.subscribe(vid)
    assert w.decide(use_case="content", model="glm-5.3-flash").billing_mode == "INCLUDED"


def test_any_allowlist_max_price_policies_and_block_flag(w):
    vid = w.plan({
        "content_generation": {"mode": "INCLUDED", "model_policy": "ANY"},
        "copy_check": {"mode": "INCLUDED", "model_policy": "ALLOWLIST", "model_allowlist": [MINI]},
        "learner_analytics": {"mode": "INCLUDED", "model_policy": "MAX_PRICE", "max_output_price_per_1m": 1,
                              "on_model_violation": "BLOCK"},
    })
    w.subscribe(vid)
    assert w.decide(use_case="content", model=SONNET).billing_mode == "INCLUDED"
    assert w.decide(use_case="content", model=GLM, preferred_model_explicit=True).billing_mode == "INCLUDED"
    assert w.decide(use_case="content", model=SONNET, preferred_model_explicit=True).reason == "MODEL_NOT_INCLUDED"
    assert w.decide(use_case="evaluation", model=MINI).billing_mode == "INCLUDED"
    assert w.decide(use_case="evaluation", model=GLM).reason == "MODEL_NOT_INCLUDED"
    assert w.decide(use_case="learner_analytics", model=GLM).billing_mode == "INCLUDED"     # 0.4 <= 1
    d = w.decide(use_case="learner_analytics", model=SONNET)                                # 15 > 1
    assert (d.billing_mode, d.reason, d.block) == ("CHARGED", "MODEL_NOT_INCLUDED", True)
    assert w.decide(use_case="learner_analytics", model="x/unknown-model").reason == "MODEL_NOT_INCLUDED"


# ── fair use ─────────────────────────────────────────────────────────────────

def test_institute_unit_cap_then_over_cap_charged_and_not_counted(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 2}})
    sid = w.subscribe(vid)
    assert [w.decide().billing_mode for _ in range(2)] == ["INCLUDED", "INCLUDED"]
    d = w.decide()
    assert (d.billing_mode, d.reason, d.wallet_credits, d.release_token) == ("CHARGED", "OVER_CAP", D("1"), None)
    assert w.counters()[f"PLAN:{sid}|F:learner_assistant"][1] == D("2")


def test_credit_cap_and_one_use_larger_than_the_cap(w):
    vid = w.plan({"content_generation": {"mode": "INCLUDED", "inst_credits_cap": 10,
                                         "over_cap_action": "BLOCK"}})
    sid = w.subscribe(vid)
    d = w.decide(use_case="content", list_credits=11)
    assert (d.billing_mode, d.reason, d.block) == ("CHARGED", "OVER_CAP", True)
    assert w.counters() == {}
    assert w.decide(use_case="content", list_credits=6).billing_mode == "INCLUDED"
    assert w.decide(use_case="content", list_credits=4).billing_mode == "INCLUDED"   # exactly at the cap
    assert w.decide(use_case="content", list_credits=0.5).reason == "OVER_CAP"
    assert w.counters()[f"PLAN:{sid}|F:content_generation"][0] == D("10")


def test_user_cap_actor_basis_per_user(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED", "user_units_cap": 1}})
    w.subscribe(vid)
    assert w.decide(actor_user_id="u1").billing_mode == "INCLUDED"
    assert w.decide(actor_user_id="u1").reason == "OVER_CAP"
    assert w.decide(actor_user_id="u2").billing_mode == "INCLUDED"
    assert w.decide(actor_user_id=None, user_id="u2").reason == "OVER_CAP"    # legacy user_id = the actor
    # no user at all: only the institute caps apply (none here)
    assert w.decide(actor_user_id=None).billing_mode == "INCLUDED"


def test_user_cap_subject_basis_for_analytics(w):
    vid = w.plan({"learner_analytics": {"mode": "INCLUDED", "user_credits_cap": 3, "user_cap_basis": "SUBJECT",
                                        "inst_credits_cap": 100}})
    sid = w.subscribe(vid)
    for _ in range(3):
        assert w.decide(use_case="learner_analytics", actor_user_id=None, role_class="SYSTEM",
                        subject_user_id="s1").billing_mode == "INCLUDED"
    assert w.decide(use_case="learner_analytics", actor_user_id=None, subject_user_id="s1",
                    role_class="SYSTEM").reason == "OVER_CAP"
    assert w.decide(use_case="learner_analytics", actor_user_id=None, subject_user_id="s2",
                    role_class="SYSTEM").billing_mode == "INCLUDED"
    c = w.counters()
    assert c[f"PLAN:{sid}|F:learner_analytics|U:s1"][0] == D("3")
    assert c[f"PLAN:{sid}|F:learner_analytics"][0] == D("4")   # the refused one was not counted


def test_failing_scope_releases_the_scopes_already_reserved(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 100, "user_units_cap": 1}},
                 cost_cap=100)
    sid = w.subscribe(vid)
    assert w.decide(actor_user_id="u1").billing_mode == "INCLUDED"
    before = w.counters()
    assert w.decide(actor_user_id="u1").reason == "OVER_CAP"   # 'ALL' and 'F:' sort before '|U:' and fit
    assert w.counters() == before
    assert before[f"PLAN:{sid}|ALL"][1] == D("1")


def test_plan_cost_cap_counts_included_cost_across_features(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED"}, "content_generation": {"mode": "INCLUDED"}},
                 cost_cap=0.05)
    w.subscribe(vid)
    assert w.decide(cost_usd=0.03).billing_mode == "INCLUDED"
    assert w.decide(use_case="content", cost_usd=0.03).reason == "OVER_CAP"
    assert w.decide(use_case="content", cost_usd=0.02).billing_mode == "INCLUDED"
    # no cost given: list_credits / 150 is the estimate (0.0067 > 0)
    assert w.decide(list_credits=1).reason == "OVER_CAP"


# ── allowance ────────────────────────────────────────────────────────────────

def _allowance_used(w, sid):
    return D(str(w.one("SELECT allowance_used FROM ai_subscription_period WHERE subscription_id = :s",
                       s=sid)["allowance_used"]))


def test_allowance_exact_partial_exhausted(w):
    vid = w.plan({"image_generation": {"mode": "ALLOWANCE"}}, allowance=10)
    sid = w.subscribe(vid)
    d = w.decide(use_case="content_image", list_credits=6, model=None)
    assert (d.billing_mode, d.allowance_credits, d.wallet_credits) == ("ALLOWANCE", D("6.0000"), 0)
    assert _allowance_used(w, sid) == D("6")
    d = w.decide(use_case="content_image", list_credits=4, model=None)
    assert d.billing_mode == "ALLOWANCE" and _allowance_used(w, sid) == D("10")
    d = w.decide(use_case="content_image", list_credits=2, model=None)
    assert (d.billing_mode, d.reason, d.wallet_credits) == ("CHARGED", "ALLOWANCE_EXHAUSTED", D("2"))


def test_allowance_partial_take_is_split(w):
    vid = w.plan({"video_lesson": {"mode": "ALLOWANCE"}}, allowance=5)
    sid = w.subscribe(vid)
    d = w.decide(use_case="lesson_video", list_credits=7.5, model=None)
    assert (d.billing_mode, d.allowance_credits, d.wallet_credits) == ("SPLIT", D("5.0000"), D("2.5000"))
    assert d.release_token.allowance_take == D("5")
    assert _allowance_used(w, sid) == D("5")


def test_included_item_on_allowance_only_feature_uses_the_allowance(w):
    vid = w.plan({"image_generation": {"mode": "INCLUDED"}}, allowance=1)
    w.subscribe(vid)
    assert w.decide(use_case="content_image", list_credits=1, model=None).billing_mode == "ALLOWANCE"
    assert w.decide(use_case="content_image", list_credits=1, model=None).reason == "ALLOWANCE_EXHAUSTED"


def test_allowance_on_an_includable_feature(w):
    vid = w.plan({"content_generation": {"mode": "ALLOWANCE"}}, allowance=3)
    w.subscribe(vid)
    # the allowance pays list price for any model (no model policy on ALLOWANCE)
    assert w.decide(use_case="content", list_credits=2, model=SONNET).billing_mode == "ALLOWANCE"
    assert w.decide(use_case="content", list_credits=2, model=SONNET).billing_mode == "SPLIT"


def test_zero_allowance_plan_charges(w):
    vid = w.plan({"image_generation": {"mode": "ALLOWANCE"}}, allowance=0)
    w.subscribe(vid)
    assert w.decide(use_case="content_image", list_credits=1).reason == "ALLOWANCE_EXHAUSTED"


# ── guards and overrides ─────────────────────────────────────────────────────

def test_eligibility_guard_beats_the_plan_item_and_override(w):
    vid = w.plan({"premium_tts": {"mode": "INCLUDED"}, "unmapped": {"mode": "INCLUDED"}})
    sid = w.subscribe(vid)
    d = w.decide(use_case="tts", model=None)
    assert (d.billing_mode, d.reason) == ("CHARGED", "FEATURE_ALWAYS_CHARGED")
    w.override(sid, "premium_tts", mode="INCLUDED")
    assert w.decide(use_case="tts", model=None).reason == "FEATURE_ALWAYS_CHARGED"
    assert w.decide(use_case="no_such_use_case").reason == "FEATURE_ALWAYS_CHARGED"   # unmapped


def test_ai_calling_is_charged_even_with_a_tampered_feature_row(w):
    w.exec("UPDATE ai_billing_feature SET eligibility = 'INCLUDABLE', locked = 0 WHERE feature_key IN "
           "('ai_calling', 'telephony')")
    vid = w.plan({"ai_calling": {"mode": "INCLUDED", "model_policy": "ANY"}}, allowance=1000)
    sid = w.subscribe(vid)
    w.override(sid, "ai_calling", mode="ALLOWANCE")
    d = w.decide(use_case="ai_calling", model=None, list_credits=5)
    assert (d.billing_mode, d.reason, d.wallet_credits) == ("CHARGED", "LOCKED_FEATURE", D("5"))
    assert w.decide(request_type="ai_call_out", use_case=None, model=None).reason == "LOCKED_FEATURE"
    assert w.counters() == {}


def test_not_in_plan_and_plan_charged(w):
    vid = w.plan({"content_generation": {"mode": "CHARGED"}})
    w.subscribe(vid)
    assert w.decide().reason == "NOT_IN_PLAN"
    assert w.decide(use_case="content").reason == "PLAN_CHARGED"


def test_override_beats_the_item(w):
    vid = w.plan({"content_generation": {"mode": "CHARGED"},
                  "learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 100}})
    sid = w.subscribe(vid)
    oid = w.override(sid, "content_generation", mode="INCLUDED")
    d = w.decide(use_case="content")
    assert d.billing_mode == "INCLUDED" and d.override_id == oid
    w.override(sid, "learner_assistant", inst_units_cap=1)          # mode NULL = inherit INCLUDED
    assert w.decide().billing_mode == "INCLUDED"
    assert w.decide().reason == "OVER_CAP"
    w.override(sid, "copy_check", mode="INCLUDED")                  # not in the plan at all
    assert w.decide(use_case="evaluation").billing_mode == "INCLUDED"
    w.override(sid, "tutor_chat", mode="INCLUDED", active=False)    # inactive: ignored
    assert w.decide(use_case="tutor_chat").reason == "NOT_IN_PLAN"
    w.override(sid, "image_generation")                             # no item, mode NULL: nothing
    assert w.decide(use_case="content_image").reason == "NOT_IN_PLAN"


# ── lifecycle ────────────────────────────────────────────────────────────────

def test_grace_behaviour(w):
    vid_c = w.plan(LA_INCLUDED, grace_behaviour="CHARGED")
    w.subscribe(vid_c, status="GRACE", inst="i-gc")
    assert w.decide(institute_id="i-gc").reason == "GRACE_CHARGED"
    vid_i = w.plan(LA_INCLUDED, grace_behaviour="INCLUDED")
    now = datetime.now(UTC)
    w.subscribe(vid_i, status="GRACE", inst="i-gi", start=now - timedelta(days=2))
    assert w.decide(institute_id="i-gi").billing_mode == "INCLUDED"
    w.subscribe(vid_i, status="GRACE", inst="i-go", start=now - timedelta(days=10), grace_days=7)
    assert w.decide(institute_id="i-go").reason == "GRACE_OVER"


def test_expired_ended_not_started_draft(w):
    vid = w.plan(LA_INCLUDED)
    now = datetime.now(UTC)
    w.subscribe(vid, inst="i-exp", status="EXPIRED")
    assert w.decide(institute_id="i-exp").reason == "NO_SUBSCRIPTION"
    w.subscribe(vid, inst="i-end", start=now - timedelta(days=10), end=now - timedelta(seconds=1))
    assert w.decide(institute_id="i-end").reason == "ENDED"
    w.subscribe(vid, inst="i-fut", start=now + timedelta(days=1))
    assert w.decide(institute_id="i-fut").reason == "NOT_STARTED"
    draft = w.plan(LA_INCLUDED, status="DRAFT")
    w.subscribe(draft, inst="i-draft")
    assert w.decide(institute_id="i-draft").reason == "VERSION_NOT_LIVE"
    retired = w.plan(LA_INCLUDED, status="RETIRED")
    w.subscribe(retired, inst="i-ret")
    assert w.decide(institute_id="i-ret").billing_mode == "INCLUDED"   # existing subscribers keep it


def test_index_says_live_but_row_gone_is_charged(w):
    P.set_index_for_tests([INST])
    assert w.decide().reason == "NO_SUBSCRIPTION"


def test_non_renewing_subscription_is_not_covered_in_a_later_period(w):
    vid = w.plan(LA_INCLUDED)
    now = datetime.now(UTC)
    old = now - timedelta(days=45)
    w.subscribe(vid, inst="i-nr", start=old, auto_renew=False, updated_at=old)
    assert w.decide(institute_id="i-nr").reason == "NO_PERIOD"
    w.subscribe(vid, inst="i-ar", start=old, auto_renew=True, updated_at=old)
    assert w.decide(institute_id="i-ar").billing_mode == "INCLUDED"
    # any later edit (grace days, enforcement...) never re-opens renewal: no free next period
    w.subscribe(vid, inst="i-nr2", start=old, auto_renew=False, updated_at=now - timedelta(minutes=1))
    assert w.decide(institute_id="i-nr2").reason == "NO_PERIOD"
    # cancel at period end with no row for the current period yet: charged (the admin API opens
    # the current period before it switches renewal off, so a real cancel never lands here)
    w.subscribe(vid, inst="i-cp", start=old, cancel_at_period_end=True, updated_at=now - timedelta(hours=1))
    assert w.decide(institute_id="i-cp").reason == "NO_PERIOD"


def test_current_period_is_opened_once_and_uses_pending_version_later(w):
    v1 = w.plan(LA_INCLUDED, allowance=5)
    v2 = w.plan(LA_INCLUDED, allowance=50, price_minor=900000)
    now = datetime.now(UTC)
    sid = w.subscribe(v1, start=now - timedelta(days=40), pending=v2, source="COMPLIMENTARY")
    w.decide()
    P.invalidate()
    w.decide()
    rows = w.all("SELECT * FROM ai_subscription_period WHERE subscription_id = :s", s=sid)
    assert len(rows) == 1
    assert rows[0]["plan_version_id"] == v2 and D(str(rows[0]["allowance_credits"])) == D("50")
    assert rows[0]["price_minor_snapshot"] == 900000 and rows[0]["payment_status"] == "COMPLIMENTARY"
    sid1 = w.subscribe(v1, inst="i-first", pending=v2, price_override=1234)
    w.decide(institute_id="i-first")
    r = w.one("SELECT * FROM ai_subscription_period WHERE subscription_id = :s", s=sid1)
    assert r["plan_version_id"] == v1 and r["price_minor_snapshot"] == 1234 and r["payment_status"] == "DUE"


def test_period_window_calendar_months():
    a = datetime(2026, 1, 31, 10, 0, tzinfo=UTC)
    assert P.period_window(a, 1, datetime(2026, 2, 15, tzinfo=UTC)) == (a, datetime(2026, 2, 28, 10, 0, tzinfo=UTC))
    assert P.period_window(a, 1, datetime(2026, 3, 1, tzinfo=UTC)) == (
        datetime(2026, 2, 28, 10, 0, tzinfo=UTC), datetime(2026, 3, 31, 10, 0, tzinfo=UTC))
    assert P.period_window(a, 1, datetime(2026, 3, 31, 10, 0, tzinfo=UTC))[0] == datetime(2026, 3, 31, 10, 0,
                                                                                          tzinfo=UTC)
    assert P.period_window(a, 3, datetime(2026, 7, 1, tzinfo=UTC)) == (
        datetime(2026, 4, 30, 10, 0, tzinfo=UTC), datetime(2026, 7, 31, 10, 0, tzinfo=UTC))
    assert P.period_window(a, 1, datetime(2025, 12, 1, tzinfo=UTC))[0] == a     # before the anchor
    assert P.period_window(datetime(2024, 2, 29, tzinfo=UTC), 12, datetime(2025, 3, 1, tzinfo=UTC))[0] == \
        datetime(2025, 2, 28, tzinfo=UTC)


# ── SHADOW ───────────────────────────────────────────────────────────────────

def test_shadow_has_no_side_effects(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 5},
                  "image_generation": {"mode": "ALLOWANCE"}}, allowance=10, cost_cap=1)
    sid = w.subscribe(vid, enforcement="SHADOW")
    d = w.decide(list_credits=2)
    assert (d.billing_mode, d.wallet_credits, d.shadow_mode, d.reason) == ("CHARGED", D("2"), "INCLUDED",
                                                                           "SHADOW:INCLUDED")
    assert d.subscription_id == sid and d.enforcement == "SHADOW" and d.release_token is None
    d = w.decide(use_case="content_image", list_credits=4, model=None)
    assert (d.billing_mode, d.shadow_mode) == ("CHARGED", "ALLOWANCE")
    assert w.counters() == {}
    assert w.all("SELECT * FROM ai_subscription_period") == []


def test_shadow_reads_usage_back_from_shadow_events(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 2},
                  "image_generation": {"mode": "ALLOWANCE"}}, allowance=10)
    w.subscribe(vid, enforcement="SHADOW")
    for _ in range(2):
        w.event(use_case="learner_assistant", shadow_billing_mode="INCLUDED")
    w.event(use_case="learner_assistant", shadow_billing_mode="INCLUDED", institute_id="other")
    w.event(use_case="learner_assistant", shadow_billing_mode="INCLUDED",
            occurred_at=datetime.now(UTC) - timedelta(days=40))
    d = w.decide()
    assert (d.billing_mode, d.shadow_mode, d.reason) == ("CHARGED", "CHARGED", "SHADOW:OVER_CAP")
    w.event(use_case="content_image", shadow_billing_mode="ALLOWANCE", list_credits=D("7"))
    d = w.decide(use_case="content_image", list_credits=5, model=None)
    assert d.shadow_mode == "SPLIT"
    w.event(use_case="content_image", shadow_billing_mode="SPLIT", list_credits=D("5"))
    assert w.decide(use_case="content_image", list_credits=1, model=None).shadow_mode == "CHARGED"


# ── release ──────────────────────────────────────────────────────────────────

def test_release_undoes_counters_and_allowance_in_the_same_transaction(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 5},
                  "image_generation": {"mode": "ALLOWANCE"}}, allowance=10, cost_cap=1)
    sid = w.subscribe(vid)
    w.decide()   # opens the period, 1 unit counted
    s = w.Session()
    d = P.decide(s, institute_id=INST, list_credits=1, use_case="learner_assistant", model=GLM, actor_user_id="u1")
    a = P.decide(s, institute_id=INST, list_credits=4, use_case="content_image", actor_user_id="u1")
    assert d.billing_mode == "INCLUDED" and a.billing_mode == "ALLOWANCE"
    assert P.release(s, d.release_token) is True
    assert P.release(s, a.release_token) is True
    assert P.release(s, a.release_token) is False      # once only
    s.commit()
    s.close()
    assert w.counters()[f"PLAN:{sid}|F:learner_assistant"][1] == D("1")
    assert _allowance_used(w, sid) == D("0")


def test_release_after_commit_or_rollback_does_nothing(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 5}})
    sid = w.subscribe(vid)
    w.decide()
    s = w.Session()
    d = P.decide(s, institute_id=INST, list_credits=1, use_case="learner_assistant", model=GLM)
    s.commit()
    assert P.release(s, d.release_token) is False      # committed = final
    s.commit()
    d2 = P.decide(s, institute_id=INST, list_credits=1, use_case="learner_assistant", model=GLM)
    s.rollback()
    assert P.release(s, d2.release_token) is False     # rolled back = already undone
    s.commit()
    s.close()
    assert w.counters()[f"PLAN:{sid}|F:learner_assistant"][1] == D("2")
    assert P.release(None, None) is False


def test_refund_allowance_gives_back_and_floors_at_zero(w):
    vid = w.plan({"image_generation": {"mode": "ALLOWANCE"}}, allowance=10)
    sid = w.subscribe(vid)
    d = w.decide(use_case="content_image", list_credits=3, model=None)
    s = w.Session()
    assert P.refund_allowance(s, d.period_id, 2) == D("2")
    assert P.refund_allowance(s, d.period_id, 5) == D("1")
    assert P.refund_allowance(s, None, 5) == 0
    s.commit()
    s.close()
    assert _allowance_used(w, sid) == D("0")


# ── fail safe ────────────────────────────────────────────────────────────────

def test_broken_counter_table_fails_safe_and_keeps_the_callers_transaction(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 5}})
    w.subscribe(vid)
    w.decide()
    w.exec("DROP TABLE ai_usage_counter")
    s = w.Session()
    s.execute(text("INSERT INTO institute_credits VALUES ('x', 1)"))
    d = P.decide(s, institute_id=INST, list_credits=2, use_case="learner_assistant", model=GLM)
    assert (d.billing_mode, d.wallet_credits, d.reason) == ("CHARGED", D("2"), "ERROR")
    s.execute(text("UPDATE institute_credits SET current_balance = 0 WHERE institute_id = 'x'"))
    s.commit()
    s.close()
    assert w.one("SELECT current_balance FROM institute_credits")["current_balance"] == 0
    assert P.stats().get("fail_safe:reserve", 0) == 1


def test_missing_plan_tables_fail_safe(w):
    vid = w.plan(LA_INCLUDED)
    w.subscribe(vid)
    for t in ("ai_subscription_override", "institute_ai_subscription"):
        w.exec(f"DROP TABLE {t}")
    P.invalidate()
    s = w.Session()
    d = P.decide(s, institute_id=INST, list_credits=2, use_case="learner_assistant")
    assert (d.billing_mode, d.reason) == ("CHARGED", "NO_SUBSCRIPTION")
    s.execute(text("SELECT 1"))
    s.commit()
    s.close()
    assert not P.refresh_index()            # keeps the last good set
    assert P.has_live_subscription(INST)


def test_engine_bug_fails_safe(w, monkeypatch):
    vid = w.plan(LA_INCLUDED)
    w.subscribe(vid)

    def boom(*a, **k):
        raise RuntimeError("bug")

    monkeypatch.setattr(P, "_evaluate", boom)
    d = w.decide(list_credits=4)
    assert (d.billing_mode, d.wallet_credits, d.reason) == ("CHARGED", D("4"), "ERROR")
    s = w.Session()
    assert P.precheck(s, institute_id=INST, use_case="learner_assistant")["covered"] is False
    s.close()


def test_zero_list_credits_is_charged(w):
    vid = w.plan(LA_INCLUDED)
    w.subscribe(vid)
    d = w.decide(list_credits=0)
    assert (d.billing_mode, d.reason, d.wallet_credits) == ("CHARGED", "ZERO_CREDITS", 0)


# ── precheck ─────────────────────────────────────────────────────────────────

def test_precheck_is_read_only_and_plan_aware(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 1},
                  "image_generation": {"mode": "ALLOWANCE"},
                  "content_generation": {"mode": "INCLUDED", "on_model_violation": "BLOCK"}}, allowance=5)
    sid = w.subscribe(vid)
    s = w.Session()
    pc = P.precheck(s, institute_id=INST, use_case="learner_assistant", model=GLM, actor_user_id="u1", estimate=1)
    assert (pc["covered"], pc["mode"], pc["subscription_id"]) == (True, "INCLUDED", sid)
    pc = P.precheck(s, request_type="image", institute_id=INST, estimate=4)
    assert (pc["covered"], pc["mode"], pc["allowance_remaining"]) == (True, "ALLOWANCE", 5)
    pc = P.precheck(s, request_type="image", institute_id=INST, estimate=6)
    assert (pc["covered"], pc["mode"]) == (False, "SPLIT")
    pc = P.precheck(s, institute_id=INST, use_case="content", model=SONNET, estimate=1)
    assert (pc["covered"], pc["reason"], pc["block"]) == (False, "MODEL_NOT_INCLUDED", True)
    pc = P.precheck(s, institute_id=INST, use_case="tts", estimate=1)
    assert pc["covered"] is False and pc["feature_key"] == "premium_tts"
    assert not s.in_transaction()
    s.close()
    assert w.counters() == {}
    assert w.all("SELECT * FROM ai_subscription_period") == []
    assert w.all("SELECT * FROM institute_credits") == []
    w.decide()
    s = w.Session()
    assert P.precheck(s, institute_id=INST, use_case="learner_assistant", model=GLM)["reason"] == "OVER_CAP"
    s.close()


def test_precheck_shadow_is_never_covered(w):
    vid = w.plan(LA_INCLUDED)
    w.subscribe(vid, enforcement="SHADOW")
    s = w.Session()
    pc = P.precheck(s, institute_id=INST, use_case="learner_assistant", model=GLM)
    assert (pc["covered"], pc["mode"], pc["reason"], pc["enforcement"]) == (False, "INCLUDED", "SHADOW:INCLUDED",
                                                                            "SHADOW")
    s.close()


def test_decide_reserve_false_is_read_only(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 3}})
    w.subscribe(vid)
    d = w.decide(reserve=False)
    assert d.billing_mode == "INCLUDED" and d.release_token is None
    assert w.counters() == {}
    assert w.all("SELECT * FROM ai_subscription_period") == []


# ── simulate / pnl ───────────────────────────────────────────────────────────

def test_simulate_on_crafted_events(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 2},
                  "content_generation": {"mode": "INCLUDED"},
                  "image_generation": {"mode": "ALLOWANCE"},
                  "premium_tts": {"mode": "CHARGED"}}, allowance=5, price_minor=304375)
    now = datetime.now(UTC)
    t = now - timedelta(days=5)
    for i in range(3):   # 2 included, 1 over cap
        w.event(use_case="learner_assistant", list_credits=D("1"), credits_charged=D("1"), real_cost_usd=D("0.01"),
                occurred_at=t + timedelta(minutes=i))
    w.event(use_case="content", model_id=GLM, list_credits=D("10"), credits_charged=D("10"), real_cost_usd=D("0.05"),
            occurred_at=t + timedelta(minutes=5))
    w.event(use_case="content", model_id=SONNET, list_credits=D("20"), credits_charged=D("20"),
            real_cost_usd=D("0.2"), occurred_at=t + timedelta(minutes=6))
    w.event(use_case="content_image", model_id=None, list_credits=D("4"), credits_charged=D("4"),
            real_cost_usd=D("0.02"), occurred_at=t + timedelta(minutes=7))
    w.event(use_case="content_image", model_id=None, list_credits=D("4"), credits_charged=D("4"),
            real_cost_usd=D("0.02"), occurred_at=t + timedelta(minutes=8))
    w.event(use_case="tts", model_id=None, list_credits=D("3"), credits_charged=D("3"), real_cost_usd=D("0.03"),
            occurred_at=t + timedelta(minutes=9))
    w.event(use_case="content", list_credits=D("2"), credits_charged=D("2"), refunded_credits=D("2"),
            occurred_at=t + timedelta(minutes=10))                                        # fully refunded
    w.event(use_case="content", list_credits=D("50"), occurred_at=now - timedelta(days=40))   # outside window
    w.event(use_case="content", list_credits=D("50"), institute_id="other", occurred_at=t)    # other institute
    w.event(use_case="content", list_credits=D("50"), parent_event_id=str(uuid.uuid4()), occurred_at=t)  # child
    s = w.Session()
    r = P.simulate(s, vid, INST, days=30, now=now)
    s.close()
    f = {e["feature_key"]: e for e in r["features"]}
    la = f["learner_assistant"]
    assert (la["events"], la["included_credits"], la["charged_credits"], la["over_cap_events"]) == (3, 2, 1, 1)
    cg = f["content_generation"]
    assert (cg["included_credits"], cg["charged_credits"], cg["model_not_included_events"]) == (10, 20, 1)
    assert cg["events"] == 3 and cg["list_credits"] == 30
    ig = f["image_generation"]
    assert (ig["allowance_credits"], ig["charged_credits"]) == (5, 3)
    assert abs(ig["plan_cost_usd"] - (0.02 + 0.02 * 1 / 4)) < 1e-9
    assert f["premium_tts"]["charged_credits"] == 3 and f["premium_tts"]["included_credits"] == 0
    tot = r["totals"]
    assert tot["included_credits"] == 12 and tot["allowance_credits"] == 5 and tot["charged_credits"] == 27
    assert tot["charged_today_credits"] == 44
    assert tot["wallet_saving_credits"] == 17
    plan_cost_usd = 0.02 + 0.05 + 0.025
    assert abs(tot["plan_cost_usd"] - plan_cost_usd) < 1e-9
    assert r["revenue_minor"] == 300000     # 304375 * 30 / 30.4375
    assert abs(tot["plan_cost_inr"] - round(plan_cost_usd * 86, 2)) < 0.011
    assert abs(tot["margin_inr"] - (3000 - plan_cost_usd * 86)) < 0.011
    assert r["periods"] == 1 and r["truncated"] is False


def test_simulate_unknown_version_raises(w):
    s = w.Session()
    with pytest.raises(ValueError):
        P.simulate(s, str(uuid.uuid4()), INST)
    s.close()


def test_pnl_live_and_shadow(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED"}, "image_generation": {"mode": "ALLOWANCE"}},
                 allowance=10)
    w.subscribe(vid)
    w.decide()                       # opens the LIVE period
    w.subscribe(vid, inst="i-sh", enforcement="SHADOW")
    period = w.one("SELECT * FROM ai_subscription_period")
    sh_start = P.period_window(datetime.now(UTC) - timedelta(days=3), 1, datetime.now(UTC))[0]
    sh_sid = w.one("SELECT id FROM institute_ai_subscription WHERE institute_id = 'i-sh'")["id"]
    w.exec("INSERT INTO ai_subscription_period (id, subscription_id, period_start, period_end, plan_version_id, "
           "price_minor_snapshot, allowance_credits, allowance_used, payment_status, created_at) VALUES "
           "(:i, :s, :ps, :pe, :v, 500000, 10, 0, 'COMPLIMENTARY', :n)",
           i=str(uuid.uuid4()), s=sh_sid, ps=sh_start, pe=sh_start + timedelta(days=31), v=vid, n=datetime.now(UTC))
    w.exec("UPDATE ai_subscription_period SET allowance_used = 4 WHERE id = :i", i=period["id"])
    t = datetime.now(UTC) - timedelta(minutes=5)
    w.event(billing_mode="INCLUDED", list_credits=D("3"), credits_charged=D("0"), real_cost_usd=D("0.5"),
            occurred_at=t, use_case="learner_assistant")
    w.event(billing_mode="ALLOWANCE", list_credits=D("4"), credits_charged=D("0"), real_cost_usd=D("0.2"),
            occurred_at=t, use_case="content_image")
    w.event(billing_mode="SPLIT", list_credits=D("4"), credits_charged=D("2"), real_cost_usd=D("0.4"),
            occurred_at=t, use_case="content_image")
    w.event(billing_mode="CHARGED", list_credits=D("5"), credits_charged=D("5"), real_cost_usd=D("1"),
            occurred_at=t, use_case="tts")
    w.event(institute_id="i-sh", billing_mode="CHARGED", shadow_billing_mode="INCLUDED", list_credits=D("2"),
            credits_charged=D("2"), real_cost_usd=D("0.3"), occurred_at=t)
    w.event(institute_id="i-sh", billing_mode="CHARGED", shadow_billing_mode="ALLOWANCE", list_credits=D("12"),
            credits_charged=D("12"), real_cost_usd=D("0.6"), occurred_at=t, use_case="content_image")
    s = w.Session()
    rows = {r["institute_id"]: r for r in P.pnl(s, period="current")}
    assert P.pnl(s, period="previous") == []
    assert P.pnl(s, institute_id="nobody") == []
    s.close()
    live = rows[INST]
    assert live["basis"] == "LIVE" and live["events"] == 4
    assert live["included_list_credits"] == 3 and live["charged_credits"] == 7
    assert abs(live["included_cost_usd"] - 0.5) < 1e-9
    assert abs(live["allowance_cost_usd"] - (0.2 + 0.4 * 0.5)) < 1e-9
    assert live["allowance_used"] == 4
    assert abs(live["real_cost_usd_total"] - 2.1) < 1e-9
    assert abs(live["margin_inr"] - (5000 - (0.5 + 0.4) * 86)) < 0.011
    sh = rows["i-sh"]
    assert sh["basis"] == "SHADOW" and sh["included_list_credits"] == 2
    assert sh["allowance_used"] == 10       # 12 shadow allowance credits capped at 10
    assert abs(sh["allowance_cost_usd"] - 0.6 * 10 / 12) < 1e-9
    assert abs(sh["margin_inr"] - (5000 - (0.3 + 0.5) * 86)) < 0.011


def test_usage_snapshot_reads_counters_and_merged_items(w):
    vid = w.plan({"learner_assistant": {"mode": "INCLUDED", "inst_units_cap": 4, "display_cap_text": "fair"}},
                 allowance=7)
    sid = w.subscribe(vid)
    w.override(sid, "copy_check", mode="INCLUDED")
    w.decide()
    s = w.Session()
    snap = P.usage_snapshot(s, INST)
    s.close()
    assert snap["subscription"].id == sid and snap["version"].id == vid
    assert set(snap["items"]) == {"learner_assistant", "copy_check"}
    assert snap["counters"][f"PLAN:{sid}|F:learner_assistant"][1] == D("1")
    assert snap["allowance_credits"] == D("7")
    s = w.Session()
    assert P.usage_snapshot(s, "nobody") is None
    s.close()


def test_role_class_of():
    assert P.role_class_of("LEARNER") == "LEARNER"
    assert P.role_class_of("student") == "LEARNER"
    assert P.role_class_of(None, "STUDENT") == "LEARNER"
    assert P.role_class_of(None, None, ["TEACHER", "STUDENT"]) == "TEACHER"
    assert P.role_class_of(None, "SYSTEM") == "SYSTEM"
    assert P.role_class_of(None, "MADE_UP_ROLE") is None
    assert P.role_class_of(None, None, None) is None


def test_default_chain_models(w):
    s = w.Session()
    # what is included when nobody says whether the model was picked: the primaries
    assert P.default_chain_models(s, "content_generation") == [GLM]
    assert P.default_chain_models(s, "learner_assistant") == [GLM]
    s.close()


def test_background_index_refresh_picks_up_a_new_subscription(w, monkeypatch):
    import time as _time

    vid = w.plan(LA_INCLUDED)
    w.subscribe(vid, inst="i-bg")
    P.set_index_for_tests([])
    P._index.attempted_at = None
    monkeypatch.setattr(P, "_maybe_refresh_index", _REAL_MAYBE_REFRESH)
    w.statements.clear()
    assert P.has_live_subscription("i-bg") is False      # never waits: the refresh runs in the background
    deadline = _time.monotonic() + 5
    while not P.has_live_subscription("i-bg") and _time.monotonic() < deadline:
        _time.sleep(0.02)
    assert P.has_live_subscription("i-bg") is True
    assert any("institute_ai_subscription" in st for st in w.statements)
