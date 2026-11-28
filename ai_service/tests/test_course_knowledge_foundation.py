"""Course knowledge foundation (CK-02): platform flags, the institute setting
store, the staff gate, the embedding helper, the V600 schema check and the
billing vocabulary.

Offline: settings, principals, sessions and the embedding service are faked.
The two PG tests at the end run the real put_setting / schema check against
V600 and are skipped unless AI_LIMITS_PG_URL / AI_LIMITS_PGDATA is set.
"""
from __future__ import annotations

import ast
import asyncio
import json
import logging
import re
import sys
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import app.services.platform_settings_service as pss  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import ai_billing, tool_cost_estimator as tce  # noqa: E402
from app.services.course_knowledge import auth, embedding, flags, schema_check, settings_store  # noqa: E402
from app.services.metering import plan_models  # noqa: E402

V600 = (Path(__file__).resolve().parents[2] / "admin_core_service/src/main/resources/db/migration"
        / "V600__Course_knowledge.sql")


@pytest.fixture
def platform(monkeypatch):
    """Platform settings served from a dict (missing key = the spec default)."""
    values: dict = {}

    def fake_get(key, default=None, db=None):
        if key in values:
            v = values[key]
            if isinstance(v, Exception):
                raise v
            return v
        spec = pss.SETTING_SPECS[key]
        v = spec.default()
        return default if v is None else v

    monkeypatch.setattr(pss, "get_platform_setting", fake_get)
    settings_store.invalidate_cache()
    yield values
    settings_store.invalidate_cache()


# ── platform settings + flags ───────────────────────────────────────────────

def test_setting_specs_declared_with_safe_defaults(monkeypatch):
    monkeypatch.delenv("COURSE_KNOWLEDGE_ENABLED", raising=False)
    specs = pss.SETTING_SPECS
    expected = {
        "course_knowledge.enabled": ("bool", False),
        "course_knowledge.institutes": ("string", "[]"),
        "course_knowledge.retrieval_mode": ("enum", "off"),
        "course_knowledge.paid_enabled": ("bool", False),
        "course_knowledge.links_enabled": ("bool", False),
        "course_knowledge.drip_mode": ("enum", "time_exact"),
        "course_knowledge.max_monthly_auto_cap": ("number", 5000),
        "course_knowledge.max_chunks_per_institute": ("number", 200000),
        "course_knowledge.worker_batch": ("number", 4),
        "kb.stable_topic_ids": ("bool", False),
    }
    for key, (typ, default) in expected.items():
        assert specs[key].type == typ, key
        assert specs[key].default() == default, key
    assert specs["course_knowledge.retrieval_mode"].options == ("off", "shadow", "on")
    assert specs["course_knowledge.drip_mode"].options == ("time_exact", "mirror")
    assert specs["course_knowledge.institutes"].max_length == 6000
    assert (specs["course_knowledge.worker_batch"].min_value, specs["course_knowledge.worker_batch"].max_value) == (1, 16)
    assert specs["kb.stable_topic_ids"].group == "kb"
    assert {s.group for k, s in specs.items() if k.startswith("course_knowledge.")} == {"course_knowledge"}
    monkeypatch.setenv("COURSE_KNOWLEDGE_ENABLED", "true")
    assert specs["course_knowledge.enabled"].default() is True


def test_allowlist_parsing():
    assert flags.parse_allowlist('["*"]') == flags.ALL_INSTITUTES
    assert flags.parse_allowlist('["inst-a", " inst-b ", "", null]') == frozenset({"inst-a", "inst-b"})
    assert flags.parse_allowlist("not json") == frozenset()
    assert flags.parse_allowlist('{"inst-a": true}') == frozenset()
    assert flags.parse_allowlist("") == frozenset()
    assert flags.parse_allowlist(["inst-a", "*"]) == flags.ALL_INSTITUTES


def test_institute_allowed_and_available(platform):
    platform["course_knowledge.institutes"] = '["inst-a"]'
    assert flags.institute_allowed("inst-a")
    assert not flags.institute_allowed("inst-b")
    assert not flags.institute_allowed(None)
    # platform switch off (default): nobody is available, allowlist or not
    assert not flags.available("inst-a")
    platform["course_knowledge.enabled"] = True
    assert flags.available("inst-a")
    assert not flags.available("inst-b")
    platform["course_knowledge.institutes"] = '["*"]'
    assert flags.available("inst-b")
    platform["course_knowledge.institutes"] = "[broken"
    assert not flags.available("inst-a")


def test_flags_never_raise_and_fall_back(platform):
    for key in list(pss.SETTING_SPECS):
        if key.startswith("course_knowledge."):
            platform[key] = RuntimeError("settings table unreadable")
    assert flags.platform_enabled() is False
    assert flags.allowed_institutes() == frozenset()
    assert flags.available("inst-a") is False
    assert flags.retrieval_mode() == "off"
    assert flags.paid_enabled() is False
    assert flags.links_enabled() is False
    assert flags.drip_mode() == "time_exact"
    assert flags.max_monthly_auto_cap() == 5000
    assert flags.max_chunks_per_institute() == 200000
    assert flags.worker_batch() == 4


def test_flag_values_are_normalised(platform):
    platform["course_knowledge.enabled"] = "true"
    platform["course_knowledge.retrieval_mode"] = "SHADOW"
    platform["course_knowledge.drip_mode"] = "nonsense"
    platform["course_knowledge.worker_batch"] = 99
    platform["course_knowledge.max_monthly_auto_cap"] = "abc"
    assert flags.platform_enabled() is True
    assert flags.retrieval_mode() == "shadow"
    assert flags.drip_mode() == "time_exact"
    assert flags.worker_batch() == 16
    assert flags.max_monthly_auto_cap() == 5000


# ── staff gate ──────────────────────────────────────────────────────────────

def _request() -> Request:
    return Request({
        "type": "http", "method": "GET", "path": "/", "query_string": b"",
        "headers": [(b"authorization", b"Bearer tok"), (b"clientid", b"inst-a")],
    })


def _principal(monkeypatch, roles, *, is_root=False):
    seen = {}

    async def fake_resolve(token, client_id, settings):
        seen.update(token=token, client_id=client_id)
        return PinnedPrincipal(user_id="u-1", institute_id=client_id, roles=list(roles), is_root_user=is_root)

    monkeypatch.setattr(auth, "resolve_pinned_principal", fake_resolve)
    monkeypatch.setattr(auth, "get_settings", lambda: None)
    return seen


def test_ck_staff_rejects_root_learner(monkeypatch):
    _principal(monkeypatch, ["STUDENT"], is_root=True)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.ck_staff(_request()))
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "forbidden"


def test_ck_staff_rejects_root_with_no_roles(monkeypatch):
    _principal(monkeypatch, [], is_root=True)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.ck_staff(_request()))
    assert exc.value.status_code == 403


def test_ck_staff_accepts_teacher_without_manage(monkeypatch):
    seen = _principal(monkeypatch, ["TEACHER"])
    staff = asyncio.run(auth.ck_staff(_request()))
    assert seen == {"token": "tok", "client_id": "inst-a"}
    assert (staff.user_id, staff.institute_id) == ("u-1", "inst-a")
    assert staff.can_manage is False
    with pytest.raises(HTTPException) as exc:
        auth.require_manage(staff)
    assert exc.value.status_code == 403


@pytest.mark.parametrize("roles,can_manage", [
    (["ADMIN"], True),
    (["admin-non-root"], True),
    (["SUPER ADMIN"], True),
    (["CONTENT CREATOR"], False),
    (["course-creator"], False),
    (["TEACHER", "STUDENT"], False),
])
def test_can_manage_only_for_admin_roles(monkeypatch, roles, can_manage):
    _principal(monkeypatch, roles)
    staff = asyncio.run(auth.ck_staff(_request()))
    assert staff.can_manage is can_manage
    if can_manage:
        assert auth.require_manage(staff) is staff


def test_auth_never_reads_is_root_user():
    tree = ast.parse(Path(auth.__file__).read_text(encoding="utf-8"))
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    names = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    assert "is_root_user" not in attrs and "is_root_user" not in names


# ── setting store ───────────────────────────────────────────────────────────

class _Result:
    def __init__(self, row):
        self._row = row

    def mappings(self):
        return self

    def first(self):
        return self._row


class _RecordingSession:
    """Records every statement; the upsert returns the row the params describe."""

    def __init__(self):
        self.calls = []
        self.commits = 0

    def execute(self, stmt, params=None):
        sql = str(stmt)
        self.calls.append((sql, dict(params or {})))
        if "INSERT INTO course_knowledge_setting" in sql:
            p = params
            return _Result({
                "enabled": bool(p["enabled"]),
                "learner_answers_enabled": True if p["learner_answers_enabled"] is None else p["learner_answers_enabled"],
                "auto_paid_enabled": bool(p["auto_paid_enabled"]),
                "monthly_auto_cap_credits": p["monthly_auto_cap_credits"] or 0,
                "allow_ocr": True, "allow_transcription": True,
                "enabled_at": None, "updated_by": p["updated_by"], "updated_at": None,
            })
        return _Result(None)

    def commit(self):
        self.commits += 1


def test_get_setting_defaults_without_row():
    db = _RecordingSession()
    s = settings_store.get_setting(db, "inst-a")
    assert s == settings_store.CourseKnowledgeSetting()
    assert (s.enabled, s.learner_answers_enabled, s.auto_paid_enabled, s.monthly_auto_cap_credits) == (False, True, False, 0)
    assert (s.allow_ocr, s.allow_transcription) == (True, True)


def test_put_setting_clamps_cap_and_ignores_unknown_fields(platform):
    db = _RecordingSession()
    out = settings_store.put_setting(
        db, "inst-a", {"monthly_auto_cap_credits": 999999, "enabled": True, "bogus": 1, "institute_id": "x"}, "admin-1",
    )
    sql, params = db.calls[-1]
    assert params["monthly_auto_cap_credits"] == 5000
    assert params["institute_id"] == "inst-a"
    assert params["updated_by"] == "admin-1"
    assert "bogus" not in params
    assert params["learner_answers_enabled"] is None  # not in the patch: keep the stored value
    assert db.commits == 1
    assert out.monthly_auto_cap_credits == 5000 and out.enabled is True

    platform["course_knowledge.max_monthly_auto_cap"] = 120
    settings_store.put_setting(db, "inst-a", {"monthly_auto_cap_credits": "500"}, "admin-1")
    assert db.calls[-1][1]["monthly_auto_cap_credits"] == 120
    settings_store.put_setting(db, "inst-a", {"monthly_auto_cap_credits": -7}, "admin-1")
    assert db.calls[-1][1]["monthly_auto_cap_credits"] == 0


def test_put_setting_rejects_bad_values(platform):
    db = _RecordingSession()
    with pytest.raises(ValueError):
        settings_store.put_setting(db, "inst-a", {"enabled": "maybe"}, "admin-1")
    with pytest.raises(ValueError):
        settings_store.put_setting(db, "inst-a", {"monthly_auto_cap_credits": "lots"}, "admin-1")
    for huge in ("inf", "-inf", "nan", 1e400):  # OverflowError / ValueError both surface as ValueError
        with pytest.raises(ValueError):
            settings_store.put_setting(db, "inst-a", {"monthly_auto_cap_credits": huge}, "admin-1")
    assert db.calls == [] and db.commits == 0


def test_upsert_sql_is_one_statement_with_returning_and_no_bind_casts(platform):
    db = _RecordingSession()
    settings_store.put_setting(db, "inst-a", {"enabled": True}, "admin-1")
    sql = db.calls[-1][0]
    assert len(db.calls) == 1
    assert "ON CONFLICT (institute_id) DO UPDATE" in sql and "RETURNING" in sql
    assert "AND NOT s.enabled THEN now()" in sql
    assert not re.search(r":\w+::", sql)
    src = Path(settings_store.__file__).read_text(encoding="utf-8")
    assert ".rowcount" not in src


def test_put_setting_invalidates_cache(platform, monkeypatch):
    opened = []

    @contextmanager
    def fake_session():
        opened.append(1)
        yield _RecordingSession()

    monkeypatch.setattr(settings_store, "db_session", fake_session)
    settings_store.cached_setting("inst-a")
    settings_store.cached_setting("inst-a")
    assert len(opened) == 1
    settings_store.put_setting(_RecordingSession(), "inst-a", {"enabled": True}, "admin-1")
    settings_store.cached_setting("inst-a")
    assert len(opened) == 2


def test_cached_setting_never_raises(platform, monkeypatch):
    @contextmanager
    def broken():
        raise RuntimeError("pool exhausted")
        yield  # pragma: no cover

    monkeypatch.setattr(settings_store, "db_session", broken)
    assert settings_store.cached_setting("inst-a") == settings_store.CourseKnowledgeSetting()


def test_learner_gate(platform, monkeypatch):
    stored = {"value": settings_store.CourseKnowledgeSetting(enabled=True)}
    reads = []

    def fake_cached(iid):
        reads.append(iid)
        return stored["value"]

    monkeypatch.setattr(settings_store, "cached_setting", fake_cached)
    platform["course_knowledge.institutes"] = '["inst-a"]'
    platform["course_knowledge.retrieval_mode"] = "on"
    # platform switch off: inactive, and no DB read at all
    assert settings_store.learner_gate("inst-a") == settings_store.LearnerGate(active=False, mode="on")
    assert reads == []
    platform["course_knowledge.enabled"] = True
    assert settings_store.learner_gate("inst-a") == settings_store.LearnerGate(active=True, mode="on")
    assert not settings_store.learner_gate("inst-b").active
    platform["course_knowledge.retrieval_mode"] = "shadow"
    assert settings_store.learner_gate("inst-a") == settings_store.LearnerGate(active=True, mode="shadow")
    platform["course_knowledge.retrieval_mode"] = "off"
    assert not settings_store.learner_gate("inst-a").active
    platform["course_knowledge.retrieval_mode"] = "on"
    stored["value"] = settings_store.CourseKnowledgeSetting(enabled=True, learner_answers_enabled=False)
    assert not settings_store.learner_gate("inst-a").active
    stored["value"] = settings_store.CourseKnowledgeSetting(enabled=False)
    assert not settings_store.learner_gate("inst-a").active


# ── embedding helper ────────────────────────────────────────────────────────

class _EmbedHarness:
    def __init__(self, monkeypatch, vectors):
        self.session_open = False
        self.http_calls = 0
        self.closed = 0
        self.resolver_kwargs = None
        harness = self

        @contextmanager
        def fake_db_session():
            harness.session_open = True
            try:
                yield object()
            finally:
                harness.session_open = False

        class FakeResolver:
            def __init__(self, db):
                assert harness.session_open

            def resolve_keys(self, institute_id, **_kw):
                assert harness.session_open
                return ("or-key", None, None)

        class FakeService:
            def __init__(self, resolver):
                self.resolver = resolver

            async def _call(self):
                assert not harness.session_open, "HTTP call made while a DB session was open"
                harness.http_calls += 1
                harness.resolver_kwargs = self.resolver.resolve_keys(institute_id="inst-a")

            async def embed_batch(self, texts, institute_id="default", model=None):
                await self._call()
                return list(vectors)[: len(texts)]

            async def embed_query(self, text, institute_id="default", model=None):
                await self._call()
                return list(vectors)[0]

            async def close(self):
                harness.closed += 1

        monkeypatch.setattr(embedding, "db_session", fake_db_session)
        monkeypatch.setattr(embedding, "ApiKeyResolver", FakeResolver)
        monkeypatch.setattr(embedding, "EmbeddingService", FakeService)


def test_embed_texts_calls_http_only_after_session_closed(monkeypatch):
    h = _EmbedHarness(monkeypatch, [[0.1, 0.2], [0.0, 0.0], None])
    out = asyncio.run(embedding.embed_texts("inst-a", "google/gemini-embedding-001", ["a", "b", "c"]))
    assert out == [[0.1, 0.2], None, None]
    assert h.http_calls == 1 and h.closed == 1
    assert h.resolver_kwargs == ("or-key", None, None)  # the static resolver hands back the keys


def test_embed_texts_all_failed_is_none(monkeypatch):
    h = _EmbedHarness(monkeypatch, [[0.0, 0.0], None])
    assert asyncio.run(embedding.embed_texts("inst-a", None, ["a", "b"])) is None
    assert h.closed == 1
    assert asyncio.run(embedding.embed_texts("inst-a", None, [])) == []


def test_embed_query_refuses_zero_vector(monkeypatch):
    _EmbedHarness(monkeypatch, [[0.0, 0.0, 0.0]])
    assert asyncio.run(embedding.embed_query("inst-a", None, "what is osmosis")) is None
    h = _EmbedHarness(monkeypatch, [[0.3, 0.0, 0.1]])
    assert asyncio.run(embedding.embed_query("inst-a", None, "what is osmosis")) == [0.3, 0.0, 0.1]
    assert h.closed == 1


def test_embed_key_resolution_failure_is_none(monkeypatch):
    @contextmanager
    def broken():
        raise RuntimeError("pool exhausted")
        yield  # pragma: no cover

    monkeypatch.setattr(embedding, "db_session", broken)
    assert asyncio.run(embedding.embed_query("inst-a", None, "q")) is None
    assert asyncio.run(embedding.embed_texts("inst-a", None, ["q"])) is None


def test_embed_key_resolution_runs_off_the_event_loop(monkeypatch):
    import threading
    _EmbedHarness(monkeypatch, [[0.3, 0.1]])
    seen = []
    real = embedding._resolve_keys
    monkeypatch.setattr(embedding, "_resolve_keys", lambda i: seen.append(threading.get_ident()) or real(i))
    loop_thread = threading.get_ident()  # asyncio.run drives the loop on this thread
    assert asyncio.run(embedding.embed_query("inst-a", None, "q")) == [0.3, 0.1]
    assert asyncio.run(embedding.embed_texts("inst-a", None, ["q"])) == [[0.3, 0.1]]
    assert len(seen) == 2 and loop_thread not in seen

# ── schema check ────────────────────────────────────────────────────────────

class _SchemaSession:
    def __init__(self, tables, columns):
        self.tables, self.columns = tables, columns

    def execute(self, stmt, params=None):
        sql = str(stmt)
        rows = [(t,) for t in self.tables] if "information_schema.tables" in sql else list(self.columns)
        return type("R", (), {"fetchall": lambda _self: rows})()

    def rollback(self):
        pass


def test_schema_check_reports_missing_pieces(caplog):
    db = _SchemaSession(schema_check.REQUIRED_TABLES[:-1], [("kb_chunk", "embedding_768_scoped")])
    with caplog.at_level(logging.ERROR):
        assert schema_check.check_course_knowledge_schema(db) is False
    errors = [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(errors) == 1
    assert "course_knowledge_link" in errors[0] and "knowledge_base_source.slide_id" in errors[0]
    assert "V600__Course_knowledge.sql" in errors[0]


def test_schema_check_ok_and_never_raises(caplog):
    ok = _SchemaSession(schema_check.REQUIRED_TABLES, schema_check.REQUIRED_COLUMNS)
    assert schema_check.check_course_knowledge_schema(ok) is True

    class Broken:
        def execute(self, *a, **k):
            raise RuntimeError("no database")

        def rollback(self):
            raise RuntimeError("still no database")

    with caplog.at_level(logging.ERROR):
        assert schema_check.check_course_knowledge_schema(Broken()) is False
    assert any("V600__Course_knowledge.sql" in r.getMessage() for r in caplog.records)


# ── billing vocabulary (must equal V600) ────────────────────────────────────

def _v600_pricing_rows():
    sql = V600.read_text(encoding="utf-8")
    rows = re.findall(
        r"\('(course_kb_[a-z_]+)',\s*'([a-z_]+)',\s*([\d.]+),\s*([\d.]+),\s*'([a-z_]+)',\s*'(\{[^']*\})'::jsonb\)", sql,
    )
    return {r[0]: r[1:] for r in rows}


def test_tool_pricing_defaults_equal_v600_seed():
    rows = _v600_pricing_rows()
    assert set(rows) == {"course_kb_ocr_page", "course_kb_transcribe_minute"}
    for key, (request_type, flat, per_unit, unit_field, params) in rows.items():
        code = tce.DEFAULT_TOOL_PRICING[key]
        assert code["request_type"] == request_type
        assert code["flat_base_credits"] == Decimal(flat)
        assert code["per_unit_credits"] == Decimal(per_unit)
        assert code["unit_field"] == unit_field
        assert code["params"] == json.loads(params)
        assert key in tce.KNOWN_TOOLS
        assert tce.is_fixed_price(key, code)


def test_metering_vocabulary():
    assert plan_models.TOOL_FEATURE_OVERRIDES["course_kb_ocr_page"] == "kb_ingest"
    assert plan_models.TOOL_FEATURE_OVERRIDES["course_kb_transcribe_minute"] == "transcription"
    assert ai_billing.UC.COURSE_KNOWLEDGE == "course_knowledge"
    sql = V600.read_text(encoding="utf-8")
    assert "VALUES ('course_knowledge', 'kb'" in sql
    assert "'{course_kb_ocr_page,course_kb_transcribe_minute}'" in sql
    assert "billing_feature_key = 'kb_ingest'" in sql


# ── real Postgres (V600) ────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def PgSession():
    from course_knowledge_pg_helpers import pg_session_factory
    factory = pg_session_factory()
    yield factory
    factory.close()


def test_put_setting_on_postgres(PgSession, platform):
    db = PgSession()
    try:
        assert settings_store.get_setting(db, "pg-inst") == settings_store.CourseKnowledgeSetting()

        s1 = settings_store.put_setting(db, "pg-inst", {"monthly_auto_cap_credits": 10 ** 9}, "admin-1")
        assert (s1.enabled, s1.enabled_at, s1.monthly_auto_cap_credits) == (False, None, 5000)
        assert s1.updated_by == "admin-1" and s1.updated_at is not None

        s2 = settings_store.put_setting(db, "pg-inst", {"enabled": True}, "admin-2")
        assert s2.enabled and s2.enabled_at is not None
        assert s2.monthly_auto_cap_credits == 5000  # untouched field kept
        assert s2.updated_by == "admin-2"

        s3 = settings_store.put_setting(db, "pg-inst", {"enabled": True, "allow_ocr": False}, "admin-2")
        assert s3.enabled_at == s2.enabled_at  # true -> true keeps the first enable time
        assert s3.allow_ocr is False

        s4 = settings_store.put_setting(db, "pg-inst", {"enabled": False}, "admin-2")
        assert not s4.enabled and s4.enabled_at == s2.enabled_at
        s5 = settings_store.put_setting(db, "pg-inst", {"enabled": True}, "admin-2")
        assert s5.enabled_at > s2.enabled_at  # a new false -> true flip stamps again

        s6 = settings_store.put_setting(db, "pg-new", {"enabled": True, "learner_answers_enabled": False}, None)
        assert s6.enabled and s6.enabled_at is not None and s6.learner_answers_enabled is False
        assert settings_store.get_setting(db, "pg-inst") == s5
    finally:
        db.close()


def test_schema_check_on_postgres(PgSession):
    db = PgSession()
    try:
        assert schema_check.missing_course_knowledge_schema(db) == []
        assert schema_check.check_course_knowledge_schema(db) is True
    finally:
        db.close()


def test_ck_staff_accepts_custom_institute_role_without_manage(monkeypatch):
    # A custom role ("Academic Coordinator") is staff, as in Tutor Mode; spending stays admin-only.
    _principal(monkeypatch, ["Academic Coordinator"], is_root=True)
    staff = asyncio.run(auth.ck_staff(_request()))
    assert staff.can_manage is False
    with pytest.raises(HTTPException):
        auth.require_manage(staff)


def test_ck_staff_rejects_learner_holding_a_custom_role(monkeypatch):
    _principal(monkeypatch, ["STUDENT", "Academic Coordinator"], is_root=True)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.ck_staff(_request()))
    assert exc.value.status_code == 403
