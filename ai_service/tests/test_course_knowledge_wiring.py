"""Course knowledge wiring in app_factory (CK-14).

What must hold:
  * with MCP off, the app serves the course knowledge admin routes and the
    course-to-KB links routes under {api_base_path}/course-knowledge/v1;
  * the lifespan runs the V600 schema check (in its own db_session) and
    starts the indexing worker BEFORE the MCP early return, so both run
    whether or not MCP is on;
  * neither can stop the pod: a failing schema check or worker start is
    logged and the app still starts.

No database: db_session is faked and the unrelated startup pollers are
replaced by no-ops, so the lifespan runs without any network or DB.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app_factory  # noqa: E402
from app.services.course_knowledge import schema_check, worker  # noqa: E402

_REAL_SETTINGS = app_factory.get_settings()
BASE = _REAL_SETTINGS.api_base_path

# Lazily imported starters of the lifespan that have nothing to do with course
# knowledge: (module, function). Each is swapped for a no-op module.
_OTHER_STARTERS = (
    ("app.services.ai_video_sweeper", "start_ai_video_sweeper"),
    ("app.services.reels_render_orchestrator", "start_reels_reaper"),
    ("app.services.call_intelligence_poller", "start_call_intelligence_poller"),
    ("app.services.copy_check.billing_reconciliation", "start_billing_reconciliation"),
    ("app.services.help_corpus_sync", "start_help_corpus_sync"),
)


def _settings(mcp_on: bool):
    return _REAL_SETTINGS.model_copy(update={"mcp_server_enabled": mcp_on})


@pytest.fixture(scope="module")
def app_mcp_off():
    mp = pytest.MonkeyPatch()
    mp.setattr(app_factory, "get_settings", lambda: _settings(False))
    try:
        yield app_factory.create_app()
    finally:
        mp.undo()


def _routes(app):
    out = set()
    for r in app.routes:
        for m in (getattr(r, "methods", None) or ()):
            out.add((m, r.path))
    return out


def test_mcp_is_off_in_the_built_app(app_mcp_off):
    assert getattr(app_mcp_off.state, "mcp_server", None) is None
    assert not any(r.path.startswith(f"{BASE}/mcp") for r in app_mcp_off.routes)


def test_course_knowledge_admin_routes_are_mounted(app_mcp_off):
    routes = _routes(app_mcp_off)
    p = f"{BASE}/course-knowledge/v1"
    for want in (
        ("GET", f"{p}/status"),
        ("GET", f"{p}/settings"),
        ("PUT", f"{p}/settings"),
        ("GET", f"{p}/packages/{{package_id}}/coverage"),
        ("POST", f"{p}/packages/{{package_id}}/scan"),
        ("POST", f"{p}/packages/{{package_id}}/process"),
        ("GET", f"{p}/runs/{{run_id}}"),
        ("POST", f"{p}/runs/{{run_id}}/cancel"),
        ("POST", f"{p}/packages/{{package_id}}/lessons/{{slide_id}}/retry"),
        ("POST", f"{p}/packages/{{package_id}}/preview-search"),
        ("DELETE", f"{p}/data"),
    ):
        assert want in routes, want


def test_course_knowledge_links_routes_are_mounted(app_mcp_off):
    routes = _routes(app_mcp_off)
    p = f"{BASE}/course-knowledge/v1/packages/{{package_id}}/links"
    assert ("GET", p) in routes
    assert ("PUT", p) in routes
    assert ("DELETE", f"{p}/{{link_id}}") in routes


def test_status_route_answers_without_mcp(app_mcp_off):
    # No token: the route exists and its auth dependency answers (not a 404).
    from fastapi.testclient import TestClient

    client = TestClient(app_mcp_off)  # no `with`: the lifespan is not run here
    r = client.get(f"{BASE}/course-knowledge/v1/status")
    assert r.status_code in (401, 403), r.text
    r = client.get(f"{BASE}/course-knowledge/v1/packages/p1/links")
    assert r.status_code in (401, 403), r.text


# ── lifespan ────────────────────────────────────────────────────────────────


class _FakeDb:
    """Stands in for a Session: any ensure_* call on it fails, as with a DB down."""

    def rollback(self):
        pass


@pytest.fixture
def lifespan_env(monkeypatch):
    calls = []
    sessions = []

    @contextlib.contextmanager
    def fake_db_session():
        db = _FakeDb()
        sessions.append(db)
        yield db

    monkeypatch.setattr(app_factory, "db_session", fake_db_session)
    monkeypatch.setattr(app_factory, "sweep_stale_tasks", lambda: None)
    monkeypatch.setattr(app_factory, "_warm_billing_indexes", lambda _logger: None)
    for mod, fn in _OTHER_STARTERS:
        fake = types.ModuleType(mod)
        setattr(fake, fn, lambda fn=fn: calls.append(fn))
        monkeypatch.setitem(sys.modules, mod, fake)

    def fake_check(db):
        calls.append(("schema_check", db))
        return True

    monkeypatch.setattr(schema_check, "check_course_knowledge_schema", fake_check)
    monkeypatch.setattr(worker, "start_course_knowledge_worker", lambda: calls.append("worker_start"))
    return types.SimpleNamespace(calls=calls, sessions=sessions)


def _run_lifespan(app) -> list:
    """Enter and leave the lifespan; returns what happened before the yield."""
    seen = []

    async def go():
        async with contextlib.asynccontextmanager(app_factory._lifespan)(app):
            seen.append("served")

    asyncio.run(go())
    return seen


def _ck_calls(calls):
    return [c for c in calls if c == "worker_start" or (isinstance(c, tuple) and c[0] == "schema_check")]


def test_lifespan_runs_schema_check_and_worker_with_mcp_off(lifespan_env):
    app = types.SimpleNamespace(state=types.SimpleNamespace())  # no mcp_server
    assert _run_lifespan(app) == ["served"]
    ck = _ck_calls(lifespan_env.calls)
    assert len(ck) == 2
    assert ck[0][0] == "schema_check" and ck[1] == "worker_start"
    # The check got a session of its own from db_session.
    assert ck[0][1] in lifespan_env.sessions
    # The unrelated starters still ran (nothing was displaced).
    for _mod, fn in _OTHER_STARTERS:
        assert fn in lifespan_env.calls


def test_lifespan_runs_them_once_with_mcp_on(lifespan_env):
    entered = []

    class _Manager:
        @contextlib.asynccontextmanager
        async def run(self):
            entered.append(True)
            yield

    mcp = types.SimpleNamespace(session_manager=_Manager())
    app = types.SimpleNamespace(state=types.SimpleNamespace(mcp_server=mcp))
    assert _run_lifespan(app) == ["served"]
    assert entered == [True]
    ck = _ck_calls(lifespan_env.calls)
    assert [c if isinstance(c, str) else c[0] for c in ck] == ["schema_check", "worker_start"]


def test_failing_schema_check_does_not_stop_boot(lifespan_env, monkeypatch, caplog):
    def boom(db):
        raise RuntimeError("relation does not exist")

    monkeypatch.setattr(schema_check, "check_course_knowledge_schema", boom)
    app = types.SimpleNamespace(state=types.SimpleNamespace())
    with caplog.at_level(logging.ERROR, logger=app_factory.__name__):
        assert _run_lifespan(app) == ["served"]
    assert "worker_start" in lifespan_env.calls
    assert any("course knowledge schema check skipped" in r.getMessage() for r in caplog.records)


def test_failing_worker_start_does_not_stop_boot(lifespan_env, monkeypatch, caplog):
    def boom():
        raise RuntimeError("no loop")

    monkeypatch.setattr(worker, "start_course_knowledge_worker", boom)
    app = types.SimpleNamespace(state=types.SimpleNamespace())
    with caplog.at_level(logging.WARNING, logger=app_factory.__name__):
        assert _run_lifespan(app) == ["served"]
    assert any("course knowledge worker startup skipped" in r.getMessage() for r in caplog.records)


def test_real_worker_idles_and_stops_cleanly(monkeypatch):
    """The real start is idempotent and the task cancels cleanly (shutdown path)."""

    async def go():
        started = []
        orig_loop = worker._loop

        async def fake_loop():
            started.append(True)
            await asyncio.sleep(3600)

        monkeypatch.setattr(worker, "_loop", fake_loop)
        try:
            worker.start_course_knowledge_worker()
            first = worker._TASK
            worker.start_course_knowledge_worker()
            assert worker._TASK is first
            await asyncio.sleep(0)
            assert started == [True]
            await worker.stop_course_knowledge_worker()
            assert worker._TASK is None and first.cancelled()
        finally:
            monkeypatch.setattr(worker, "_loop", orig_loop)

    asyncio.run(go())
