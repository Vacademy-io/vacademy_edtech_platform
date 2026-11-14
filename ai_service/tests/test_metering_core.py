"""Usage metering core (services/metering, contract K2) against a real SQL
database (in-memory SQLite with real SAVEPOINTs), driving the real
CreditService.deduct_credits / refund_credits and TokenUsageService paths.

What must hold:
  * a CHARGED event mirrors its ledger row exactly (credits_charged = -amount,
    ledger_tx_id, two-way links), and the ledger row / response / balance are
    identical with metering on, off, absent or broken;
  * use_case resolution order, alias normalisation, role mapping;
  * DROPPED_INSUFFICIENT, idempotent replay, refund marking, FREE record-only
    events (upgraded in place by a later deduction), kill switch, tables absent.

No network, no Postgres. Run from the repo root:
  <venv>/bin/python -m pytest ai_service/tests/test_metering_core.py -q -p no:cacheprovider
"""
from __future__ import annotations

import os
import re
import sqlite3
import tempfile
import sys
import uuid
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import MetaData, create_engine, event, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from ai_service.app.schemas.credits import CreditDeductRequest  # noqa: E402
from ai_service.app.services.credit_service import CreditService  # noqa: E402
from ai_service.app.services.metering import cache as mcache  # noqa: E402
from ai_service.app.services.metering import service as msvc  # noqa: E402
from ai_service.app.services.metering.models import Base as MeteringBase  # noqa: E402

sqlite3.register_adapter(Decimal, str)

INST = "inst-1"
PRICE = Decimal("1.2345")
MIGRATIONS = Path(__file__).resolve().parents[2] / "admin_core_service/src/main/resources/db/migration"

LEGACY_DDL = [
    """CREATE TABLE institute_credits (
        id TEXT PRIMARY KEY, institute_id TEXT UNIQUE, total_credits NUMERIC, used_credits NUMERIC,
        current_balance NUMERIC, low_balance_threshold NUMERIC, created_at TIMESTAMP, updated_at TIMESTAMP)""",
    """CREATE TABLE credit_transactions (
        id TEXT PRIMARY KEY, institute_id TEXT, transaction_type TEXT, amount NUMERIC, balance_after NUMERIC,
        description TEXT, reference_id TEXT, request_type TEXT, model_name TEXT, batch_id TEXT,
        external_reference_id TEXT, user_id TEXT, user_role TEXT, subject_user_id TEXT, granted_by TEXT,
        created_at TIMESTAMP)""",
    "CREATE UNIQUE INDEX ux_ct_ext ON credit_transactions(external_reference_id) WHERE external_reference_id IS NOT NULL",
    """CREATE TABLE ai_token_usage (
        id TEXT PRIMARY KEY, institute_id TEXT, model TEXT, request_type TEXT, total_price NUMERIC,
        credits_used NUMERIC)""",
]
# V586's additive columns on the two existing tables.
NEW_LEDGER_COLUMNS = [
    "ALTER TABLE credit_transactions ADD COLUMN usage_event_id TEXT",
    "ALTER TABLE credit_transactions ADD COLUMN use_case TEXT",
    "ALTER TABLE ai_token_usage ADD COLUMN usage_event_id TEXT",
    "ALTER TABLE ai_token_usage ADD COLUMN router TEXT",
    "ALTER TABLE ai_token_usage ADD COLUMN gateway_key_id TEXT",
]

CATALOG = [
    # use_case, feature_group, label, template, legacy request types, tool keys, display_order, active, actor_kind
    ("tutor_chat", "tutor", "AI tutor chat", "{label} — {actor_role_label} {actor_name}", ["conversation"], [], 10, True, "USER"),
    ("chat_with_pdf", "tutor", "Chat with PDF", None, ["conversation"], [], 20, True, "USER"),
    ("content", "content", "Course content", None, ["content"], ["html_document"], 30, True, "USER"),
    ("questions", "assessment", "Question generation", None, ["assessment"], ["assessment"], 40, True, "USER"),
    ("learner_analytics", "analytics", "Learner insights", "Learner insights — {subject_name}", ["analytics"], [], 50, True, "ON_BEHALF"),
    ("lesson_video", "video", "Lesson video", None, ["video"], [], 60, True, "USER"),
    ("retired_feature", "content", "Retired", None, [], [], 70, False, "USER"),
    ("unknown", "platform", "Other AI usage", None, [], [], 999, True, "USER"),
]


def _stripped_metadata():
    """The metering tables without their Postgres-only server defaults."""
    md = MetaData()
    for table in MeteringBase.metadata.tables.values():
        t = table.to_metadata(md)
        for c in t.columns:
            c.server_default = None
    return md


class Db:
    def __init__(self, *, metering_tables: bool = True):
        # A file database: the background writer gets its own connection, as in prod.
        fd, self.path = tempfile.mkstemp(suffix=".sqlite3", prefix="metering-test-")
        os.close(fd)
        _CREATED.append(self)
        self.engine = create_engine(f"sqlite:///{self.path}", connect_args={"check_same_thread": False, "timeout": 10})
        self.statements: list = []

        @event.listens_for(self.engine, "connect")
        def _connect(dbapi_conn, _rec):
            dbapi_conn.isolation_level = None  # SQLAlchemy drives BEGIN / SAVEPOINT itself

        @event.listens_for(self.engine, "begin")
        def _begin(conn):
            conn.exec_driver_sql("BEGIN")

        @event.listens_for(self.engine, "before_cursor_execute")
        def _trace(conn, cursor, statement, params, context, executemany):
            self.statements.append(statement)

        with self.engine.begin() as c:
            for ddl in LEGACY_DDL:
                c.execute(text(ddl))
            if metering_tables:
                for ddl in NEW_LEDGER_COLUMNS:
                    c.execute(text(ddl))
        if metering_tables:
            _stripped_metadata().create_all(self.engine)
            with self.engine.begin() as c:
                for uc, fg, label, tpl, rts, tks, order, active, kind in CATALOG:
                    c.execute(text(
                        "INSERT INTO ai_use_case_catalog (use_case, feature_group, label, label_template, "
                        "legacy_request_types, tool_keys, default_surface, actor_kind, unit_kind, billing_policy, "
                        "plan_eligible, limit_eligible, reserve_on_authorize, intentionally_separate, is_active, "
                        "display_order) VALUES (:u, :f, :l, :t, :r, :k, :s, :a, 'TOKENS', 'AS_TODAY', 1, 1, 0, 0, "
                        ":act, :o)"),
                        {"u": uc, "f": fg, "l": label, "t": tpl, "r": _json(rts), "k": _json(tks),
                         "s": "SCHEDULED" if kind != "USER" else "UNKNOWN", "a": kind, "act": 1 if active else 0,
                         "o": order})
                c.execute(text("INSERT INTO ai_model_alias (alias, model_id) VALUES ('glm-5.3-flash', 'z-ai/glm-5.3-flash')"))
                c.execute(text("INSERT INTO ai_role_class_map (role_name, role_class, precedence) VALUES ('COUNSELLOR', 'STAFF', 30)"))
        with self.engine.begin() as c:
            c.execute(text(
                "INSERT INTO institute_credits VALUES ('c1', :i, 100, 0, 100, 10, '2026-10-15', '2026-10-15')"),
                {"i": INST})
        self.Session = sessionmaker(bind=self.engine, future=True)

    def one(self, sql, **params):
        with self.engine.connect() as c:
            row = c.execute(text(sql), params).mappings().first()
            return dict(row) if row else None

    def all(self, sql, **params):
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(text(sql), params).mappings().all()]

    def balance(self):
        return Decimal(str(self.one("SELECT current_balance FROM institute_credits WHERE institute_id = :i", i=INST)["current_balance"]))

    def set_balance(self, value):
        with self.engine.begin() as c:
            c.execute(text("UPDATE institute_credits SET current_balance = :v WHERE institute_id = :i"), {"v": value, "i": INST})

    def usage_row(self, total_price=None, uid=None):
        uid = uid or str(uuid.uuid4())
        with self.engine.begin() as c:
            c.execute(text("INSERT INTO ai_token_usage (id, institute_id, model, request_type, total_price) "
                           "VALUES (:id, :i, 'm', 'content', :p)"), {"id": uid, "i": INST, "p": total_price})
        return uid

    def metering_statements(self):
        return [s for s in self.statements if re.search(r"ai_usage_event|ai_use_case_catalog|ai_role_class_map|"
                                                        r"ai_model_alias|usage_event_id|SAVEPOINT", s)]


_CREATED: list = []


def _json(v):
    import json
    return json.dumps(v)


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    mcache.reset_cache()
    msvc._last_log.clear()
    settings = {"metering.events.enabled": True}
    monkeypatch.setattr(mcache, "setting_value", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(mcache, "peek_setting", lambda key, default: settings.get(key, default))
    monkeypatch.setattr(CreditService, "calculate_credits", lambda self, **kw: PRICE)
    monkeypatch.setattr(CreditService, "_check_and_create_alerts", lambda self, *a, **k: None)
    yield settings
    msvc.wait_for_background()
    mcache.reset_cache()
    while _CREATED:
        db = _CREATED.pop()
        db.engine.dispose()
        try:
            os.unlink(db.path)
        except OSError:
            pass


def _deduct(db, **kw):
    fields = dict(institute_id=INST, request_type="conversation", model="glm-5.3-flash", prompt_tokens=100,
                  completion_tokens=50)
    fields.update(kw)
    s = db.Session()
    try:
        return CreditService(s).deduct_credits(CreditDeductRequest(**fields))
    finally:
        s.close()


def _events(db):
    import json

    rows = db.all("SELECT * FROM ai_usage_event ORDER BY occurred_at, id")
    for r in rows:
        for k in ("context", "actor_roles_raw", "price_snapshot"):
            if isinstance(r.get(k), str):
                r[k] = json.loads(r[k])
    return rows


LEDGER_COLS = ("institute_id", "transaction_type", "amount", "balance_after", "description", "reference_id",
               "request_type", "model_name", "batch_id", "external_reference_id", "user_id", "user_role",
               "subject_user_id")


def _ledger(db):
    return db.all("SELECT * FROM credit_transactions ORDER BY created_at, id")


# ── CHARGED event mirrors the ledger row ──────────────────────────────────────

def test_charged_event_mirrors_the_ledger_row_exactly():
    db = Db()
    usage = db.usage_row()
    resp = _deduct(db, usage_log_id=usage, user_id="u-1", user_role="STUDENT", batch_id="b-1",
                   idempotency_key="k-1")
    assert resp.success and resp.credits_deducted == PRICE

    (ledger,) = _ledger(db)
    (ev,) = _events(db)
    assert Decimal(str(ev["credits_charged"])) == -Decimal(str(ledger["amount"])) == PRICE
    assert Decimal(str(ev["list_credits"])) == PRICE
    assert ev["ledger_tx_id"] == ledger["id"] == resp.transaction_id
    assert ledger["usage_event_id"] == ev["id"] and ledger["use_case"] == "tutor_chat"
    assert db.one("SELECT usage_event_id FROM ai_token_usage WHERE id = :u", u=usage)["usage_event_id"] == ev["id"]
    assert (ev["billing_mode"], ev["charge_status"], ev["limit_decision"]) == ("CHARGED", "POSTED", "NONE")
    assert (ev["use_case"], ev["use_case_source"], ev["feature_group"]) == ("tutor_chat", "REQUEST_TYPE", "tutor")
    assert ev["model_id"] == "z-ai/glm-5.3-flash" and ev["model_wire_id"] == "glm-5.3-flash"
    assert (ev["actor_kind"], ev["actor_user_id"], ev["actor_role_class"], ev["role_source"]) == (
        "USER", "u-1", "LEARNER", "CALLER")
    assert (ev["batch_id"], ev["idempotency_key"], ev["institute_id"]) == ("b-1", "k-1", INST)
    assert (ev["prompt_tokens"], ev["completion_tokens"]) == (100, 50)
    assert ev["source_service"] == "ai_service" and ev["surface"] == "UNKNOWN"
    # the legacy columns are exactly what the caller sent
    assert (ledger["user_id"], ledger["user_role"], ledger["subject_user_id"]) == ("u-1", "STUDENT", None)
    assert db.balance() == Decimal("100") - PRICE


def _run_one(metering: str, monkeypatch, settings):
    db = Db(metering_tables=(metering != "absent"))
    settings["metering.events.enabled"] = metering != "off"
    if metering == "broken":
        monkeypatch.setattr(msvc, "_insert_ignore", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    if metering == "broken_after_insert":
        monkeypatch.setattr(msvc, "_link_ledger", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    usage = db.usage_row(uid="11111111-2222-3333-4444-555555555555")
    resp = _deduct(db, usage_log_id=usage, user_id="u-1", user_role="ADMIN", batch_id="b-9",
                   idempotency_key="k-9", description="conversation using glm [x; rate y]",
                   use_case="tutor_chat", surface="ADMIN_APP", actor_roles_raw=["ADMIN"])
    mcache.reset_cache()
    return db, resp


@pytest.mark.parametrize("metering", ["off", "absent", "broken", "broken_after_insert"])
def test_ledger_response_and_balance_are_identical_whatever_metering_does(metering, monkeypatch, _isolate):
    base_db, base = _run_one("on", monkeypatch, _isolate)
    db, resp = _run_one(metering, monkeypatch, _isolate)
    strip = lambda r: {k: v for k, v in r.model_dump().items() if k != "transaction_id"}  # noqa: E731
    assert strip(resp) == strip(base) and resp.success
    (l0,), (l1,) = _ledger(base_db), _ledger(db)
    assert {k: l0[k] for k in LEDGER_COLS} == {k: l1[k] for k in LEDGER_COLS}
    assert db.balance() == base_db.balance()
    assert l1["id"] == resp.transaction_id
    if metering != "absent":
        assert _events(db) == [], "no event and no half-written link"
        assert l1["usage_event_id"] is None and l1["use_case"] is None


def test_an_exception_inside_record_event_does_not_change_the_deduct_response(monkeypatch):
    db = Db()
    monkeypatch.setattr(msvc, "build_row", lambda *a, **k: 1 / 0)
    resp = _deduct(db)
    assert resp.success and resp.credits_deducted == PRICE and resp.transaction_id
    assert len(_ledger(db)) == 1 and _events(db) == []
    assert msvc.stats()["failed"] >= 1


# ── resolution: use case, model alias, roles ──────────────────────────────────

def _snap(db):
    s = db.Session()
    try:
        return mcache.get_snapshot(s)
    finally:
        s.close()


def test_use_case_resolution_order():
    snap = _snap(Db())
    row = lambda **kw: msvc.build_row(snap, msvc.input_from(None, **kw), billing_mode="CHARGED",  # noqa: E731
                                      charge_status="POSTED")
    # explicit active key wins over tool key and request type
    r = row(use_case="Lesson_Video", tool_key="html_document", request_type="content")
    assert (r["use_case"], r["use_case_source"], r["feature_group"]) == ("lesson_video", "EXPLICIT", "video")
    # tool key beats request type; it is also read from usage_context and the charge_tool description
    assert row(tool_key="html_document", request_type="conversation")["use_case"] == "content"
    assert row(usage_context={"tool_key": "assessment"}, request_type="content")["use_case"] == "questions"
    r = row(description="assessment using m [assessment; rate default]", request_type="content")
    assert (r["use_case"], r["use_case_source"], r["tool_key"]) == ("questions", "TOOL_KEY", "assessment")
    # request type: first catalog row by display_order
    assert row(request_type="conversation")["use_case"] == "tutor_chat"
    # an unknown explicit key is stored as unknown, with the asked-for key kept in context
    r = row(use_case="no_such_feature", request_type="conversation")
    assert (r["use_case"], r["use_case_source"], r["feature_group"]) == ("unknown", "UNKNOWN", "platform")
    assert r["context"]["requested_use_case"] == "no_such_feature"
    # an inactive key falls through to the defaults
    assert row(use_case="retired_feature", request_type="content")["use_case"] == "content"
    # nothing maps
    assert row(request_type="never_seen")["use_case"] == "unknown"


def test_model_alias_normalisation():
    snap = _snap(Db())
    assert msvc.resolve_model(snap, "glm-5.3-flash") == "z-ai/glm-5.3-flash"
    assert msvc.resolve_model(snap, "anthropic/claude-sonnet-4.5") == "anthropic/claude-sonnet-4.5"
    assert msvc.resolve_model(snap, None) is None


@pytest.mark.parametrize("kw, expected", [
    ({"user_id": "u", "user_role": "STUDENT"}, ("USER", "LEARNER", "CALLER")),
    ({"user_id": "u", "actor_roles_raw": ["Admin"]}, ("USER", "ADMIN", "JWT")),
    ({"user_id": "u", "actor_roles_raw": ["CONTENT CREATOR"]}, ("USER", "TEACHER", "JWT")),
    ({"user_id": "u", "actor_roles_raw": ["EVALUATOR"], "source_service": "admin_core"}, ("USER", "TEACHER", "CALLER")),
    ({"user_id": "u", "actor_roles_raw": ["COUNSELLOR", "STUDENT"]}, ("USER", "STAFF", "JWT")),
    ({"user_id": "u", "actor_roles_raw": ["SOME_CUSTOM_ROLE", "STUDENT"]}, ("USER", "STAFF", "JWT")),
    ({"user_role": "SYSTEM"}, ("SYSTEM", "SYSTEM", "CALLER")),
    ({"actor_kind": "SYSTEM", "actor_role_class": "SYSTEM"}, ("SYSTEM", "SYSTEM", "CALLER")),
    ({"user_id": "apikey:k1"}, ("API_KEY", "API_KEY", "CALLER")),
    ({"user_id": "demo-123"}, ("PUBLIC", "PUBLIC", "CALLER")),
    ({"user_id": "u"}, ("USER", None, "UNRESOLVED")),
    ({"request_type": "analytics"}, ("SYSTEM", "SYSTEM", "CATALOG_DEFAULT")),
    ({}, ("UNKNOWN", None, "UNRESOLVED")),
])
def test_role_mapping(kw, expected):
    snap = _snap(Db())
    r = msvc.build_row(snap, msvc.input_from(None, **kw), billing_mode="CHARGED", charge_status="POSTED")
    assert (r["actor_kind"], r["actor_role_class"], r["role_source"]) == expected


@pytest.mark.parametrize("kw", [
    {"user_id": "u", "user_role": "ADMIN"},  # the hard-coded ledger billing label
    {"user_id": "u", "user_role": "ADMIN", "actor_kind": "USER", "role_source": "UNRESOLVED",
     "source_service": "admin_core"},
    {"user_id": "u", "user_role": "TEACHER"},
])
def test_legacy_ledger_role_labels_are_not_trusted_as_the_actor_role(kw):
    snap = _snap(Db())
    r = msvc.build_row(snap, msvc.input_from(None, **kw), billing_mode="CHARGED", charge_status="POSTED")
    # left for the nightly AUTH_LOOKUP job
    assert (r["actor_kind"], r["actor_role_class"], r["role_source"]) == ("USER", None, "UNRESOLVED")


def test_claimed_body_user_id_never_becomes_the_actor():
    snap = _snap(Db())
    r = msvc.build_row(snap, msvc.input_from(None, user_id="victim", usage_context={"claimed_user_id": "victim"},
                                             actor_kind="UNKNOWN", role_source="UNRESOLVED"),
                       billing_mode="CHARGED", charge_status="POSTED")
    assert r["actor_user_id"] is None and r["actor_kind"] == "UNKNOWN"
    assert r["context"]["claimed_user_id"] == "victim"


def test_usage_metadata_reaches_the_context_only_through_the_whitelist():
    snap = _snap(Db())
    meta = {"video_id": "v1", "stage": "html", "purpose": "lesson_teacher", "vendor_usd": 0.1211,
            "price_source": "vendor_usd", "content_preview": "secret prompt", "router": "openrouter",
            "quiz_data": {"q": 1}, "course_name": "Algebra", "total_price": 1.0}
    r = msvc.build_row(snap, msvc.input_from(None, metadata=meta, usage_context={"agent_name": "Riya", "cost_usd": 2}),
                       billing_mode="FREE", charge_status="NOT_APPLICABLE")
    assert r["context"] == {"video_id": "v1", "stage": "html", "purpose": "lesson_teacher", "course_name": "Algebra",
                            "agent_name": "Riya"}


def test_values_are_clipped_and_bad_enums_fall_back_never_rejected():
    snap = _snap(Db())
    r = msvc.build_row(snap, msvc.input_from(None, surface="nonsense", actor_kind="ROBOT", source_service="x" * 99,
                                             parent_event_id="not-a-uuid", usage_event_id="nope",
                                             actor_display_name="n" * 400, usage_context={"subject_user_id": "s-1"}),
                       billing_mode="WHAT", charge_status="EVER")
    assert r["surface"] == "UNKNOWN" and r["actor_kind"] == "UNKNOWN" and len(r["source_service"]) == 24
    assert r["parent_event_id"] is None and uuid.UUID(r["id"])
    assert len(r["actor_display_name"]) == 255
    assert r["subject_user_id"] == "s-1" and r["context"] is None, "context subject is lifted, not duplicated"
    assert (r["billing_mode"], r["charge_status"]) == ("CHARGED", "NOT_APPLICABLE")


def test_catalog_default_surface_and_subject_from_usage_context():
    db = Db()
    _deduct(db, request_type="analytics", usage_context={"subject_user_id": "learner-7", "course_name": "Maths"})
    (ev,) = _events(db)
    assert (ev["use_case"], ev["surface"], ev["actor_kind"]) == ("learner_analytics", "SCHEDULED", "SYSTEM")
    assert ev["subject_user_id"] == "learner-7"
    assert _ledger(db)[0]["subject_user_id"] is None, "the ledger subject column is untouched"


# ── DROPPED, idempotency, refunds ─────────────────────────────────────────────

def test_dropped_charge_writes_a_dropped_insufficient_event_then_a_retry_charges():
    db = Db()
    db.set_balance(0)
    resp = _deduct(db, idempotency_key="tx:1")
    assert resp.success is False and _ledger(db) == []
    assert msvc.wait_for_background()
    (ev,) = _events(db)
    assert (ev["billing_mode"], ev["charge_status"]) == ("CHARGED", "DROPPED_INSUFFICIENT")
    assert Decimal(str(ev["credits_charged"])) == 0 and Decimal(str(ev["list_credits"])) == PRICE
    assert ev["ledger_tx_id"] is None and ev["idempotency_key"] == "dropped:tx:1"

    _deduct(db, idempotency_key="tx:1")  # still short: no second dropped event
    assert msvc.wait_for_background() and len(_events(db)) == 1

    db.set_balance(50)
    ok = _deduct(db, idempotency_key="tx:1")
    assert ok.success
    charged = [e for e in _events(db) if e["charge_status"] == "POSTED"]
    assert len(charged) == 1 and charged[0]["ledger_tx_id"] == ok.transaction_id


def test_idempotent_replay_writes_one_event():
    db = Db()
    first = _deduct(db, idempotency_key="transcription:abc")
    again = _deduct(db, idempotency_key="transcription:abc")
    assert first.success and again.success and again.credits_deducted == 0
    assert len(_ledger(db)) == 1 and len(_events(db)) == 1


def _refund(db, amount, batch, description="refund"):
    s = db.Session()
    try:
        out = CreditService(s).refund_credits(INST, Decimal(amount), description, batch_id=batch)
        # The refunding session is left with no open transaction (the marking
        # runs on a background session of its own).
        assert not s.in_transaction()
    finally:
        s.close()
    assert msvc.wait_for_background()
    return out


def test_refunds_mark_the_batch_events():
    db = Db()
    a = _deduct(db, batch_id="video-1", precomputed_credits=Decimal("3"))
    b = _deduct(db, batch_id="video-1", precomputed_credits=Decimal("2"))
    _deduct(db, batch_id="video-2", precomputed_credits=Decimal("4"))
    by_tx = lambda: {e["ledger_tx_id"]: e for e in _events(db)}  # noqa: E731

    _refund(db, "1", "video-1")  # a per-shot refund: oldest event first
    ev = by_tx()
    assert (ev[a.transaction_id]["charge_status"], Decimal(str(ev[a.transaction_id]["refunded_credits"]))) == (
        "PARTIAL_REFUND", Decimal("1"))
    assert ev[b.transaction_id]["charge_status"] == "POSTED"

    _refund(db, "4", "video-1")  # the pipeline's full refund of the rest
    ev = by_tx()
    assert all(ev[t]["charge_status"] == "REFUNDED" for t in (a.transaction_id, b.transaction_id))
    assert Decimal(str(ev[b.transaction_id]["refunded_credits"])) == Decimal("2")
    other = [e for e in _events(db) if e["batch_id"] == "video-2"][0]
    assert other["charge_status"] == "POSTED" and Decimal(str(other["refunded_credits"])) == 0
    assert db.balance() == Decimal("100") - Decimal("4")


def test_refund_video_credits_marks_events(monkeypatch):
    from ai_service.app.services.token_usage_service import TokenUsageService

    db = Db()
    _deduct(db, batch_id="video-9", precomputed_credits=Decimal("3"))
    s = db.Session()
    try:
        TokenUsageService(s).refund_video_credits("video-9", INST)
    finally:
        s.close()
    assert msvc.wait_for_background()
    (ev,) = _events(db)
    assert ev["charge_status"] == "REFUNDED" and Decimal(str(ev["refunded_credits"])) == Decimal("3")


def test_per_shot_refunds_go_to_that_shots_charges():
    db = Db()
    s0 = _deduct(db, batch_id="vid-s", precomputed_credits=Decimal("5"), description="AI video shot 0 (8s, audio)")
    s6a = _deduct(db, batch_id="vid-s", precomputed_credits=Decimal("4"), description="AI video shot 6 (8s, audio)")
    s6b = _deduct(db, batch_id="vid-s", precomputed_credits=Decimal("4"), description="AI video shot 6 (8s, audio)")
    seg = _deduct(db, batch_id="vid-s", precomputed_credits=Decimal("2"),
                  description="AI video shot 7/seg1 (4s, silent)")
    by_tx = lambda: {e["ledger_tx_id"]: e for e in _events(db)}  # noqa: E731

    _refund(db, "4", "vid-s", "AI video shot 6 refund: render failed")
    _refund(db, "4", "vid-s", "AI video shot 6 refund: render failed")
    _refund(db, "2", "vid-s", "AI video shot 7/seg1 refund: timeout")
    ev = by_tx()
    assert ev[s0.transaction_id]["charge_status"] == "POSTED"
    assert Decimal(str(ev[s0.transaction_id]["refunded_credits"])) == 0
    for t in (s6a.transaction_id, s6b.transaction_id, seg.transaction_id):
        assert ev[t]["charge_status"] == "REFUNDED"
    # the pipeline's full refund of what is left (net of the per-shot ones)
    _refund(db, "5", "vid-s", "Full refund for failed video generation vid-s")
    ev = by_tx()
    assert all(e["charge_status"] == "REFUNDED" for e in ev.values())
    assert sum(Decimal(str(e["refunded_credits"])) for e in ev.values()) == Decimal("15")


def test_allocate_refunds_is_pure_and_caps_at_the_charge():
    events = [("a", Decimal("3"), "AI video shot 1 (8s, audio)"), ("b", Decimal("2"), "AI video shot 2 (8s, audio)")]
    shares = msvc.allocate_refunds([(Decimal("9"), "AI video shot 2 refund: x")], events)
    # 2 to shot 2, the 7 left over spills oldest-first and is capped at the charge
    assert shares == {"a": Decimal("3"), "b": Decimal("2")}
    assert msvc.allocate_refunds([], events) == {"a": Decimal("0"), "b": Decimal("0")}


# ── FREE record-only events ───────────────────────────────────────────────────

def _fake_repository(db, monkeypatch):
    """TokenUsageService's repository writes a minimal ai_token_usage row."""
    from ai_service.app.services import token_usage_service as tus_mod

    def create_usage_record(self, **kw):
        uid = uuid.uuid4()
        self._session.execute(text(
            "INSERT INTO ai_token_usage (id, institute_id, model, request_type, total_price) "
            "VALUES (:id, :i, :m, :r, :p)"),
            {"id": str(uid), "i": str(kw.get("institute_id")) if kw.get("institute_id") else None,
             "m": kw.get("model"), "r": getattr(kw.get("request_type"), "value", kw.get("request_type")),
             "p": kw.get("total_price")})
        self._session.commit()
        return SimpleNamespace(id=uid, total_price=kw.get("total_price"))

    monkeypatch.setattr(tus_mod.AiTokenUsageRepository, "create_usage_record", create_usage_record)
    return tus_mod.TokenUsageService


def test_record_only_usage_writes_a_free_event_that_a_later_deduction_upgrades(monkeypatch):
    from ai_service.app.models.ai_token_usage import ApiProvider, RequestType

    db = Db()
    TUS = _fake_repository(db, monkeypatch)
    s = db.Session()
    try:
        usage = TUS(s).record_usage(api_provider=ApiProvider.OPENAI, prompt_tokens=10, completion_tokens=5,
                                    total_tokens=15, request_type=RequestType.CONTENT, institute_id=INST,
                                    user_id=str(uuid.uuid4()), model="glm-5.3-flash", total_price=0.002,
                                    metadata={"video_id": "v1"}, use_case="lesson_video")
    finally:
        s.close()
    assert msvc.wait_for_background()
    (ev,) = _events(db)
    assert (ev["billing_mode"], ev["charge_status"], ev["free_reason"]) == ("FREE", "NOT_APPLICABLE", "UNBILLED_GAP")
    assert Decimal(str(ev["credits_charged"])) == 0 and Decimal(str(ev["list_credits"])) == PRICE
    assert ev["use_case"] == "lesson_video" and ev["context"] == {"video_id": "v1"}
    assert Decimal(str(ev["real_cost_usd"])) == Decimal("0.002")
    assert db.one("SELECT usage_event_id FROM ai_token_usage WHERE id = :u", u=str(usage.id))["usage_event_id"] == ev["id"]

    resp = _deduct(db, request_type="avatar_video", usage_log_id=str(usage.id), precomputed_credits=Decimal("7"))
    (ev2,) = _events(db)
    assert ev2["id"] == ev["id"], "upgraded in place, not a second event"
    assert (ev2["billing_mode"], ev2["charge_status"], ev2["free_reason"]) == ("CHARGED", "POSTED", None)
    assert Decimal(str(ev2["credits_charged"])) == Decimal("7") and ev2["ledger_tx_id"] == resp.transaction_id
    assert ev2["use_case"] == "lesson_video", "an unknown/default resolution never overwrites a known use case"
    assert _ledger(db)[0]["usage_event_id"] == ev["id"]


def test_record_usage_and_deduct_writes_exactly_one_charged_event(monkeypatch):
    from ai_service.app.models.ai_token_usage import ApiProvider, RequestType

    db = Db()
    TUS = _fake_repository(db, monkeypatch)
    s = db.Session()
    try:
        before = len(db.statements)
        TUS(s).record_usage_and_deduct_credits(
            api_provider=ApiProvider.OPENAI, prompt_tokens=10, completion_tokens=5, total_tokens=15,
            request_type=RequestType.CONTENT, institute_id=INST, user_id="u-2", model="m", total_price=0.01,
            use_case="content", surface="ADMIN_APP", actor_roles_raw=["TEACHER"], usage_context={"course_id": "c1"})
        stmts = db.statements[before:]
    finally:
        s.close()
    assert msvc.wait_for_background()
    (ev,) = _events(db)
    assert (ev["billing_mode"], ev["use_case"], ev["surface"], ev["actor_role_class"]) == (
        "CHARGED", "content", "ADMIN_APP", "TEACHER")
    assert Decimal(str(ev["real_cost_usd"])) == Decimal("0.01") and ev["context"] == {"course_id": "c1"}
    # overhead on the charge path: savepoint + insert + 2 links + release (+ the 5-minute lookup load)
    metering = [x for x in stmts if re.search(r"ai_usage_event|usage_event_id|SAVEPOINT", x)
                and "ai_use_case_catalog" not in x]
    lookup = [x for x in stmts if re.search(r"ai_use_case_catalog|ai_role_class_map|ai_model_alias", x)]
    assert len(lookup) == 3
    print("metering statements on the charge path:", metering)
    assert len(metering) <= 9, metering  # 5 for the event + 4 for the lookup savepoint pair


def test_internal_llm_rows_charged_by_the_caller_are_bundled_with_no_list_credits(monkeypatch):
    from ai_service.app.models.ai_token_usage import ApiProvider, RequestType

    db = Db()
    TUS = _fake_repository(db, monkeypatch)
    s = db.Session()
    try:
        TUS(s).record_usage(api_provider=ApiProvider.OPENAI, prompt_tokens=1, completion_tokens=1, total_tokens=2,
                            request_type=RequestType.EVALUATION, institute_id=INST, model="m",
                            metadata={"charged_by_caller": True}, use_case="questions", source_service="assessment")
    finally:
        s.close()
    assert msvc.wait_for_background()
    (ev,) = _events(db)
    assert (ev["billing_mode"], ev["free_reason"], ev["use_case"], ev["source_service"]) == (
        "FREE", "BUNDLED", "questions", "assessment")
    assert Decimal(str(ev["list_credits"])) == 0, "the caller's own charge carries the credits"


def test_usage_without_institute_is_a_no_institute_event(monkeypatch):
    from ai_service.app.models.ai_token_usage import ApiProvider, RequestType

    db = Db()
    TUS = _fake_repository(db, monkeypatch)
    s = db.Session()
    try:
        TUS(s).record_usage_and_deduct_credits(api_provider=ApiProvider.OPENAI, prompt_tokens=1,
                                               completion_tokens=1, total_tokens=2,
                                               request_type=RequestType.ANALYTICS, model="m")
    finally:
        s.close()
    assert msvc.wait_for_background()
    (ev,) = _events(db)
    assert (ev["free_reason"], ev["charge_status"], ev["institute_id"]) == ("NO_INSTITUTE", "SKIPPED_NO_INSTITUTE", None)
    assert _ledger(db) == []


def test_usage_record_only_writes_a_bundled_event(monkeypatch):
    from ai_service.app.models.ai_token_usage import ApiProvider, RequestType
    from ai_service.app.services import usage_record_only as uro

    db = Db()
    _fake_repository(db, monkeypatch)
    uid = db.usage_row()
    s = db.Session()
    try:
        uro._meter_free_event(s, SimpleNamespace(id=uid), {
            "api_provider": ApiProvider.OPENAI, "request_type": RequestType.EMBEDDING, "model": "emb",
            "prompt_tokens": 100, "completion_tokens": 0, "institute_id": INST, "user_id": None,
            "metadata": '{"charged": false, "kb_id": "kb1"}'}, 0.0001)
        s.commit()
    finally:
        s.close()
    (ev,) = _events(db)
    assert (ev["billing_mode"], ev["free_reason"]) == ("FREE", "BUNDLED")
    assert ev["context"] == {"charged": False, "kb_id": "kb1"}


# ── switches and absence ─────────────────────────────────────────────────────

def test_charged_event_is_skipped_rather_than_waiting_for_a_busy_pool(monkeypatch):
    db = Db()
    monkeypatch.setattr(msvc, "_pool_would_wait", lambda _db: True)
    before = msvc.stats().get("skipped_busy", 0)
    res = _deduct(db)
    assert res.success and len(_ledger(db)) == 1 and _events(db) == []
    assert msvc.stats()["skipped_busy"] == before + 1


def test_pool_would_wait_reads_a_bounded_pool_only():
    class _Pool:
        def __init__(self, out, size=2, over=1):
            self._out, self._size, self._max_overflow = out, size, over

        def size(self):
            return self._size

        def checkedout(self):
            return self._out

    def _db(pool):
        return SimpleNamespace(get_bind=lambda: SimpleNamespace(engine=SimpleNamespace(pool=pool)))

    assert msvc._pool_would_wait(_db(_Pool(3))) is True
    assert msvc._pool_would_wait(_db(_Pool(2))) is False
    assert msvc._pool_would_wait(_db(_Pool(99, over=-1))) is False  # unbounded overflow
    assert msvc._pool_would_wait(_db(object())) is False  # no size(): never guess


def test_kill_switch_means_no_metering_queries_at_all(_isolate):
    db = Db()
    _isolate["metering.events.enabled"] = False
    before = len(db.statements)
    resp = _deduct(db, use_case="tutor_chat")
    during = db.statements[before:]
    assert resp.success and _events(db) == []
    assert [s for s in during if re.search(r"ai_usage_event|ai_use_case_catalog|SAVEPOINT", s)] == []


def test_tables_absent_probe_once_then_no_queries():
    db = Db(metering_tables=False)
    before = len(db.statements)
    assert _deduct(db).success
    first = db.statements[before:]
    assert any("ai_use_case_catalog" in s for s in first), "one probe"
    mid = len(db.statements)
    assert _deduct(db).success and _deduct(db).success
    later = db.statements[mid:]
    assert [s for s in later if re.search(r"ai_usage_event|ai_use_case_catalog|SAVEPOINT|usage_event_id", s)] == []
    assert len(_ledger(db)) == 3 and round(db.balance(), 4) == Decimal("100") - 3 * PRICE


def test_settings_are_registered():
    from ai_service.app.services.platform_settings_service import SETTING_SPECS

    assert SETTING_SPECS["metering.events.enabled"].default() is True
    assert SETTING_SPECS["metering.admin_hosts"].default() == '["dash.vacademy.io"]'
    assert SETTING_SPECS["metering.history_v2_institutes"].default() == "[]"


def test_history_v2_flag(monkeypatch, _isolate):
    _isolate["metering.history_v2_institutes"] = '["a", "b"]'
    assert mcache.history_v2_enabled("a") and not mcache.history_v2_enabled("c")
    _isolate["metering.history_v2_institutes"] = '["*"]'
    assert mcache.history_v2_enabled("c")
    _isolate["metering.history_v2_institutes"] = "garbage"
    assert not mcache.history_v2_enabled("c")


# ── schema parity with the admin_core migration ──────────────────────────────

def _migration_sql():
    if not MIGRATIONS.is_dir():
        return None
    for f in sorted(MIGRATIONS.glob("V*.sql")):
        body = f.read_text(encoding="utf-8")
        if re.search(r"CREATE TABLE IF NOT EXISTS ai_usage_event\b", body):
            return re.sub(r"--[^\n]*", "", body)
    return None


def _sql_columns(sql, table):
    m = re.search(rf"CREATE TABLE IF NOT EXISTS {table}\s*\((.*?)\n\);", sql, re.S)
    assert m, f"CREATE TABLE IF NOT EXISTS {table} not found"
    cols = {}
    # split on commas that are not inside parentheses
    depth, cur, parts = 0, "", []
    for ch in m.group(1):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    for p in parts:
        p = " ".join(p.split())
        if not p or re.match(r"(PRIMARY KEY|UNIQUE|CONSTRAINT|CHECK)\b", p, re.I):
            continue
        name, sql_type = p.split()[0].lower(), p.split()[1].lower()
        rest = p.upper()
        if sql_type == "timestamp" and "WITH TIME ZONE" in rest:
            sql_type = "timestamptz"
        cols[name] = {"type": sql_type.replace(" ", ""), "not_null": "NOT NULL" in rest or "PRIMARY KEY" in rest}
    return cols


def _model_type(col):
    from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Integer, Numeric, String, Text
    from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

    t = col.type
    t = getattr(t, "impl", t)
    if isinstance(t, UUID):
        return "uuid"
    if isinstance(t, ARRAY):
        return "text[]"
    if isinstance(t, (JSONB, JSON)):
        return "jsonb"
    if isinstance(t, Text):
        return "text"
    if isinstance(t, String):
        return f"varchar({t.length})"
    if isinstance(t, BigInteger):
        return "bigint"
    if isinstance(t, Integer):
        return "int"
    if isinstance(t, Boolean):
        return "boolean"
    if isinstance(t, Numeric):
        return f"numeric({t.precision},{t.scale})"
    if isinstance(t, DateTime):
        return "timestamptz" if t.timezone else "timestamp"
    raise AssertionError(f"unmapped type {t!r}")


_TYPE_SYNONYMS = {"integer": "int", "timestamptz": "timestamptz", "jsonb": "jsonb", "bool": "boolean"}


def test_models_match_the_migration():
    sql = _migration_sql()
    if sql is None:
        pytest.skip("V586 ai_usage_metering migration not in this checkout yet")
    from ai_service.app.services.metering.models import AiModelAlias, AiRoleClassMap, AiUsageEvent, AiUseCaseCatalog

    for model in (AiUseCaseCatalog, AiRoleClassMap, AiUsageEvent, AiModelAlias):
        expected = {k: {"type": _TYPE_SYNONYMS.get(v["type"], v["type"]), "not_null": v["not_null"]}
                    for k, v in _sql_columns(sql, model.__tablename__).items()}
        actual = {c.name: {"type": _model_type(c), "not_null": not c.nullable} for c in model.__table__.columns}
        assert actual == expected, model.__tablename__
