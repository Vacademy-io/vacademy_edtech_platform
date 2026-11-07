"""
The worker lanes that keep MCP's CRM reads, listings and token check off the main loop.
The OAuth lane has its own file, test_mcp_oauth_lanes.py.

Pinned here: the request's identity reaches a tool on a worker, and a negative control
proves that test can see it go missing. A reply comes at the deadline while the slot
and worker stay out until the thread ends. Cancelling rolls back and audits from a
separate session. The token check, the control lane, shutdown, the MCP engine, and that
with the flag off everything is as it was.

Tests that need real Postgres use MCP_ADMISSION_TEST_PG_URL and their own schema, and
are skipped otherwise.
"""
import asyncio
import contextlib
import inspect
import json
import logging
import os
import re
import signal
import socket
import subprocess
import sys
import textwrap
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import pytest  # noqa: E402
from mcp.server.auth.middleware.auth_context import auth_context_var  # noqa: E402
from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser  # noqa: E402
from mcp.shared.exceptions import MCPError  # noqa: E402
from mcp.types import INTERNAL_ERROR, CallToolResult, TextContent, Tool  # noqa: E402
from sqlalchemy import create_engine, event, text  # noqa: E402
from sqlalchemy.exc import OperationalError  # noqa: E402

from app import app_factory  # noqa: E402
from app import db as app_db  # noqa: E402
from app.config import MCP_CONTROL_WORKERS, MCP_OAUTH_WORKERS, MCP_VERIFY_WORKERS, Settings  # noqa: E402
from app.mcp import adapter, admission, lanes, oauth_provider, server  # noqa: E402
from app.mcp.admission import McpAdmission, McpEdgeGuard  # noqa: E402
from app.mcp.constants import (  # noqa: E402
    BUSY_RETRY_HIGH_S,
    BUSY_RETRY_LOW_S,
    MCP_ALLOWED_WRITE_TOOLS,
    OFF_LOOP_TOOLS,
    TOOL_LANE_DEADLINE_S,
    tool_timeout_payload,
)
from app.mcp.institute_scope import request_institute_id  # noqa: E402
from app.mcp.oauth_provider import VacademyAccessToken, VacademyOAuthProvider  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import assistant_tool_registry as reg  # noqa: E402
from test_course_knowledge_wiring import lifespan_env  # noqa: E402,F401

A, B = "institute-a", "institute-b"
ISSUER = "https://mcp.test/ai-service/mcp"
TEST_TOKEN = "vcm_at_" + "t" * 43
UNKNOWN_TOKEN = "vcm_at_" + "u" * 43
BEARER = {"authorization": f"Bearer {TEST_TOKEN}"}
PROTOCOLS = ["2025-06-18", "2026-07-28"]
PG_URL = os.getenv("MCP_ADMISSION_TEST_PG_URL")
LANE_TOOL = "crm_collections"


class FakePool:
    def __init__(self, out=0):
        self.out = out

    def checkedout(self):
        return self.out


def make_gate(pool=None, **overrides):
    pool = pool if pool is not None else FakePool()
    args = dict(pod_cap=4, institute_cap=3, max_wait_s=5, waiters_per_institute=3, waiters_per_pod=8,
                pool_reserve=2, pool_capacity=15, pool_getter=lambda: pool)
    args.update(overrides)
    return McpAdmission(**args)


def assert_clean(gate):
    assert gate.running == 0 and gate.running_on_main_pool == 0
    assert gate.running_by_institute == {}
    assert not gate._waiters and not gate._started


def lane_settings(enabled=True, cap=4):
    return SimpleNamespace(mcp_off_loop_enabled=enabled, mcp_max_tool_calls_per_pod=cap)


async def until(predicate, timeout=5.0):
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline, "condition not reached in time"
        await asyncio.sleep(0.005)


def assert_edge_busy(response):
    """HTTP 429 whose header and body give the same wait, from the spread the tool-level answers use."""
    assert response.status_code == 429
    wait = int(response.headers["retry-after"])
    assert BUSY_RETRY_LOW_S <= wait <= BUSY_RETRY_HIGH_S
    assert response.json()["error"]["data"] == {"error": "server_busy", "retry_after_s": wait}
    assert response.json()["error"]["message"] == f"Vacademy is busy right now. Retry after {wait} seconds."


def access_token(institute=A, resource=None, token=TEST_TOKEN):
    return VacademyAccessToken(
        token=token, client_id="client-1", scopes=["vacademy.read"], expires_at=4_000_000_000,
        resource=resource, subject="user-1", user_id="user-1", institute_id=institute, token_hash="hash-1",
        pair_id="pair-1", platform_access_token="stored-jwt", platform_refresh_token="stored-refresh",
    )


def params(name=LANE_TOOL, arguments=None):
    return SimpleNamespace(name=name, arguments=arguments if arguments is not None else {})


class FakeSession:
    def __init__(self, label):
        self.label = label
        self.events = []
        self.thread = None

    def commit(self):
        self.events.append("commit")

    def rollback(self):
        self.events.append("rollback")


class FakeRepo:
    """The audit row goes to ``audit`` with the session it was written on."""

    audit = []

    def __init__(self, db, cipher):
        self.db = db

    def get_client(self, client_id):
        self.db.events.append("get_client")
        return {"client_name": "Test app"}

    def log_tool_call(self, **row):
        self.db.events.append("audit")
        FakeRepo.audit.append({**row, "session": self.db})


@pytest.fixture
def env(monkeypatch):
    """server.py's handlers on fake sessions. The tool's behaviour is the test's to choose."""
    state = SimpleNamespace(gate=make_gate(), token=access_token(), tool=None, runs=[], lane_sessions=[],
                            main_sessions=[], audit=[])
    FakeRepo.audit = state.audit
    monkeypatch.setattr(admission, "_instance", state.gate)

    def factory(bucket, label):
        @contextmanager
        def session():
            db = FakeSession(label)
            db.thread = threading.current_thread().name
            bucket.append(db)
            yield db
        return session

    async def authorize(db, settings):
        principal = PinnedPrincipal(user_id="user-1", institute_id=state.token.institute_id, roles=["ADMIN"])
        return principal, {}, state.token, "jwt"

    async def call_tool(**kwargs):
        state.runs.append({**kwargs, "thread": threading.current_thread().name})
        kwargs["db"].events.append("tool")
        if state.tool is not None:
            await state.tool()
        return CallToolResult(content=[TextContent(type="text", text="ran")])

    monkeypatch.setattr(server, "db_session", factory(state.main_sessions, "main"))
    monkeypatch.setattr(server, "mcp_db_session", factory(state.lane_sessions, "mcp"))
    monkeypatch.setattr(server, "_settings", lambda: SimpleNamespace(resolve_mcp_encryption_key=lambda: "key"))
    monkeypatch.setattr(server, "get_access_token", lambda: state.token)
    monkeypatch.setattr(server, "_authorize", authorize)
    monkeypatch.setattr(server, "McpOAuthRepository", FakeRepo)
    monkeypatch.setattr(server, "TokenCipher", lambda key: None)
    monkeypatch.setattr(adapter, "call_tool", call_tool)
    return state


@pytest.fixture
async def on():
    lanes.start(lane_settings())
    assert lanes.active()
    yield
    await lanes.stop(grace_s=0.5)


def main_thread_name():
    return threading.main_thread().name


async def jam(lane, count=None):
    """Keep every worker of a lane busy until the returned event is set."""
    release = threading.Event()

    async def blocked():
        release.wait(10)

    tasks = [asyncio.create_task(lane.run(blocked)) for _ in range(count if count is not None else len(lane._idle))]
    await until(lambda: not lane._idle)
    return release, tasks


# ── which tools ──────────────────────────────────────────────────────────
def test_only_the_six_read_only_crm_tools_run_off_the_loop():
    assert OFF_LOOP_TOOLS == {"crm_leads", "crm_calls", "crm_meetings", "crm_messages", "crm_reports", "crm_collections"}
    for name in OFF_LOOP_TOOLS:
        spec = reg.ASSISTANT_TOOLS[name]
        assert spec.mode == "READ" and spec.mcp_only
    assert not OFF_LOOP_TOOLS & set(MCP_ALLOWED_WRITE_TOOLS)


def test_crm_modules_take_no_connection_from_the_main_engine_themselves():
    root = Path(__file__).resolve().parents[1] / "app" / "services"
    files = [root / "crm_data.py", root / "course_builder_data.py", *root.glob("assistant_tools_crm_*.py")]
    assert len(files) >= 5
    for path in files:
        assert not re.search(r"\b(db_session|get_engine|get_sessionmaker)\b", path.read_text()), path.name


# ── the request's identity on a worker ───────────────────────────────────
@pytest.fixture
def identity(monkeypatch):
    """The real authorization chain and the real context variables; only its network and database reads are stubbed."""
    token = access_token(resource=f"{ISSUER}/i/{A}")
    settings = SimpleNamespace(mcp_issuer_url=ISSUER, resolve_mcp_encryption_key=lambda: "key")
    principal = PinnedPrincipal(user_id="user-1", institute_id=A, roles=["ADMIN"])

    async def pinned(platform_token, institute_id, settings_obj):
        return principal

    @contextmanager
    def session():
        yield FakeSession("mcp")

    seen = {}

    def read():
        current = server.get_access_token()
        return getattr(current, "institute_id", None), request_institute_id.get(), threading.current_thread().name

    async def call_tool(**kwargs):
        seen["tool"] = read()

        async def nested():
            return read()

        seen["task"] = await asyncio.create_task(nested())
        seen["thread"] = await asyncio.to_thread(read)
        return CallToolResult(content=[TextContent(type="text", text="ran")])

    FakeRepo.audit = []
    monkeypatch.setattr(admission, "_instance", make_gate())
    monkeypatch.setattr(server, "mcp_db_session", session)
    monkeypatch.setattr(server, "_settings", lambda: settings)
    monkeypatch.setattr(server, "build_pinned_principal", pinned)
    monkeypatch.setattr(server, "load_mcp_setting", lambda db, institute: {"enabled": True})
    monkeypatch.setattr(server, "check_mcp_access", lambda p, s: None)
    monkeypatch.setattr(server, "McpOAuthRepository", FakeRepo)
    monkeypatch.setattr(server, "TokenCipher", lambda key: None)
    monkeypatch.setattr(adapter, "call_tool", call_tool)

    user = auth_context_var.set(AuthenticatedUser(token))
    path = request_institute_id.set(A)
    yield seen
    request_institute_id.reset(path)
    auth_context_var.reset(user)


def assert_identity_reached_the_tool(seen, result):
    assert result.is_error is not True, result.content[0].text
    for where in ("tool", "task", "thread"):
        assert seen[where][:2] == (A, A), where


async def test_identity_reaches_a_tool_a_nested_task_and_a_nested_thread(identity, on):
    result = await server._on_call_tool(None, params())
    assert_identity_reached_the_tool(identity, result)
    assert identity["tool"][2].startswith("mcp-tool-")
    assert identity["task"][2].startswith("mcp-tool-")
    assert identity["thread"][2].startswith("mcp-tool-") and "-pool" in identity["thread"][2]


async def test_negative_control_plain_run_in_executor_fails_authorization(identity):
    """Without the context copy the same call is refused, so the test above can see lost context."""
    loop = asyncio.get_running_loop()
    with ThreadPoolExecutor(1) as pool:
        result = await loop.run_in_executor(
            pool, lambda: asyncio.run(server._run_call(params(), server.mcp_db_session))
        )
    assert result.is_error is True
    assert result.content[0].text == "This request is not authenticated."
    assert identity == {}
    with pytest.raises(AssertionError):
        assert_identity_reached_the_tool(identity, result)


async def test_a_path_mismatch_on_a_worker_is_still_refused(identity, on):
    request_institute_id.set(B)
    result = await server._on_call_tool(None, params())
    assert result.is_error is True and "different server URL" in result.content[0].text
    assert identity == {}


# ── normal calls ─────────────────────────────────────────────────────────
async def test_a_lane_tool_runs_on_a_worker_on_the_mcp_engine(env, on):
    seen = {}

    async def tool():
        seen["held"] = (env.gate.running, env.gate.running_on_main_pool, len(lanes.tool_lane()._idle))

    env.tool = tool
    result = await server._on_call_tool(None, params())
    assert result.content[0].text == "ran"
    assert env.runs[0]["thread"].startswith("mcp-tool-")
    assert env.lane_sessions and env.lane_sessions[0].thread.startswith("mcp-tool-")
    assert env.main_sessions == []
    assert seen["held"] == (1, 0, 3)
    assert len(lanes.tool_lane()._idle) == 4
    assert_clean(env.gate)


@pytest.mark.parametrize("name", ["whoami", "website", "crm_lead_edit"])
async def test_every_other_tool_stays_on_the_main_loop(env, on, name):
    await server._on_call_tool(None, params(name))
    assert env.runs[0]["thread"] == main_thread_name()
    assert env.lane_sessions == [] and len(env.main_sessions) == 1
    assert_clean(env.gate)


async def test_an_exception_comes_back_and_the_slot_returns(env, on):
    async def tool():
        raise ValueError("boom")

    env.tool = tool
    with pytest.raises(ValueError, match="boom"):
        await server._on_call_tool(None, params())
    assert_clean(env.gate)
    assert len(lanes.tool_lane()._idle) == 4


async def test_the_main_pool_rule_does_not_apply_to_a_lane_tool(env, on):
    env.gate._pool_getter = lambda: FakePool(out=15)
    env.gate.max_wait_s = 0
    assert (await server._on_call_tool(None, params())).content[0].text == "ran"
    assert json.loads((await server._on_call_tool(None, params("whoami"))).content[0].text)["error"] == "server_busy"


async def test_a_refused_call_never_reaches_a_worker(env, on):
    env.gate.max_wait_s = 0
    for _ in range(3):
        await env.gate.enter(A, "t")
    result = await server._on_call_tool(None, params())
    assert json.loads(result.content[0].text)["error"] == "rate_limited"
    assert env.runs == [] and env.lane_sessions == []
    assert len(lanes.tool_lane()._idle) == 4


async def test_no_free_worker_gives_back_the_slot_and_answers_server_busy(env, on):
    lane = lanes.tool_lane()
    release, tasks = await jam(lane)
    result = await server._on_call_tool(None, params())
    assert json.loads(result.content[0].text)["error"] == "server_busy"
    assert_clean(env.gate)
    release.set()
    await asyncio.gather(*tasks)


async def test_on_finish_leaves_the_ticket_this_call_took(env, on):
    """An older call must stay visible as the oldest after a newer one ends, across the thread hop."""
    release = threading.Event()

    async def tool():
        release.wait(5)

    env.tool = tool
    older = asyncio.create_task(server._on_call_tool(None, params()))
    await until(lambda: env.gate.running == 1 and env.runs)
    started_first = list(env.gate._started)
    env.tool = None
    await server._on_call_tool(None, params())
    assert list(env.gate._started) == started_first
    release.set()
    await older
    assert_clean(env.gate)


# ── the deadline ─────────────────────────────────────────────────────────
async def test_a_call_past_the_deadline_replies_and_returns_its_slot_when_it_ends(env, on, monkeypatch):
    monkeypatch.setattr(server, "TOOL_LANE_DEADLINE_S", 0.25)
    release = threading.Event()
    finished = threading.Event()

    async def tool():
        release.wait(10)
        finished.set()

    env.tool = tool
    lag = []

    async def heartbeat():
        while True:
            before = time.perf_counter()
            await asyncio.sleep(0.005)
            lag.append(time.perf_counter() - before - 0.005)

    beat = asyncio.create_task(heartbeat())
    started = time.perf_counter()
    result = await server._on_call_tool(None, params())
    elapsed = time.perf_counter() - started
    beat.cancel()

    assert 0.2 <= elapsed < 2
    assert result.is_error is True
    assert json.loads(result.content[0].text) == tool_timeout_payload()
    # A loop blocked by the call would show one gap as long as the deadline. The rest allows for a busy test machine.
    assert sorted(lag)[len(lag) * 9 // 10] < 0.05
    assert max(lag) < 0.2

    # The client has its answer; the thread is still inside the call.
    assert not finished.is_set()
    assert env.gate.running == 1 and env.gate.running_by_institute == {A: 1}
    assert len(lanes.tool_lane()._idle) == 3
    await asyncio.sleep(0.05)
    assert env.gate.running == 1

    release.set()
    await until(lambda: env.gate.running == 0)
    assert_clean(env.gate)
    assert len(lanes.tool_lane()._idle) == 4


def test_tool_timeout_contract():
    assert TOOL_LANE_DEADLINE_S == 200
    assert tool_timeout_payload() == {
        "error": "tool_timeout", "limit_s": 200, "retryable": True, "started": True, "changed": False,
        "message": ("This read took longer than 200 seconds and was stopped. Nothing changed. "
                    "Try again with a shorter date range or fewer records."),
    }


async def test_a_waiter_gets_the_slot_only_after_the_thread_ends(env, on, monkeypatch):
    monkeypatch.setattr(server, "TOOL_LANE_DEADLINE_S", 0.05)
    release = threading.Event()

    async def tool():
        release.wait(10)

    env.tool = tool
    env.gate.pod_cap = 1
    await server._on_call_tool(None, params())
    env.tool = None
    waiting = asyncio.create_task(server._on_call_tool(None, params()))
    await asyncio.sleep(0.05)
    assert not waiting.done() and env.gate.snapshot()["waiting"] == 1
    release.set()
    assert (await waiting).content[0].text == "ran"
    assert_clean(env.gate)


# ── cancelling and its audit row ─────────────────────────────────────────
async def test_the_deadline_cancels_the_tool_rolls_back_and_audits_separately(env, on, monkeypatch):
    monkeypatch.setattr(server, "TOOL_LANE_DEADLINE_S", 0.05)
    seen = []

    async def tool():
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            seen.append("cancelled")
            raise

    env.tool = tool
    result = await server._on_call_tool(None, params(arguments={"action": "lead_dues"}))
    assert json.loads(result.content[0].text)["error"] == "tool_timeout"
    await until(lambda: env.gate.running == 0)

    assert seen == ["cancelled"]
    tool_session = env.lane_sessions[0]
    after_tool = tool_session.events[tool_session.events.index("tool") + 1:]
    assert after_tool == ["rollback"]
    assert "commit" not in after_tool and "audit" not in after_tool

    assert len(env.audit) == 1
    row = env.audit[0]
    assert row["session"] is not tool_session
    assert row["ok"] is False and row["error_code"] == "tool_timeout"
    assert row["tool_name"] == LANE_TOOL and row["institute_id"] == A and row["client_name"] == "Test app"
    assert row["args"] == {"action": "lead_dues"} and row["duration_ms"] >= 0
    assert_clean(env.gate)
    assert len(lanes.tool_lane()._idle) == 4


REAL_CALL_TOOL = adapter.call_tool


@pytest.fixture
def real_adapter(env, monkeypatch):
    """adapter.call_tool as it runs, around a tool the test chooses. It writes the tool's own audit row."""
    def use(execute_tool):
        monkeypatch.setattr(adapter, "call_tool", REAL_CALL_TOOL)
        monkeypatch.setattr(adapter, "execute_tool", execute_tool)
        monkeypatch.setattr(adapter, "setting_for_tool_gate", lambda setting, principal: setting)
    return use


def audit_rows(env):
    return [(row["ok"], row["error_code"]) for row in env.audit]


@pytest.mark.parametrize("answer", [{"report": "funnel"}, {"error": "query_failed"}])
async def test_a_call_that_runs_on_to_its_end_past_the_deadline_is_audited_as_stopped(env, on, monkeypatch, real_adapter,
                                                                                     answer):
    monkeypatch.setattr(server, "TOOL_LANE_DEADLINE_S", 0.05)

    async def execute_tool(name, args, ctx, setting):
        time.sleep(0.3)
        return json.dumps(answer)

    real_adapter(execute_tool)
    result = await server._on_call_tool(None, params())
    assert json.loads(result.content[0].text)["error"] == "tool_timeout"
    await until(lambda: env.gate.running == 0)

    assert audit_rows(env) == [(False, "tool_timeout")]
    tool_session = env.lane_sessions[0]
    assert env.audit[0]["session"] is not tool_session and env.audit[0]["duration_ms"] >= 300
    assert tool_session.events == ["get_client", "commit", "rollback"]
    assert_clean(env.gate)
    assert len(lanes.tool_lane()._idle) == 4


async def test_a_real_suspension_after_the_deadline_still_writes_one_row(env, on, monkeypatch, real_adapter):
    monkeypatch.setattr(server, "TOOL_LANE_DEADLINE_S", 0.05)

    async def execute_tool(name, args, ctx, setting):
        time.sleep(0.3)
        await asyncio.sleep(0)
        return json.dumps({"report": "funnel"})

    real_adapter(execute_tool)
    await server._on_call_tool(None, params())
    await until(lambda: env.gate.running == 0)
    assert audit_rows(env) == [(False, "tool_timeout")]


async def test_a_caller_cancelled_while_the_tool_runs_on_to_its_end_is_audited_cancelled(env, on, real_adapter):
    started = threading.Event()

    async def execute_tool(name, args, ctx, setting):
        started.set()
        time.sleep(0.2)
        return json.dumps({"report": "funnel"})

    real_adapter(execute_tool)
    call = asyncio.ensure_future(server._on_call_tool(None, params()))
    await until(started.is_set)
    call.cancel()
    with pytest.raises(asyncio.CancelledError):
        await call
    await until(lambda: env.gate.running == 0)
    assert audit_rows(env) == [(False, "cancelled")]
    assert env.audit[0]["session"] is not env.lane_sessions[0]


async def test_a_call_that_finished_in_time_keeps_its_answer_and_row(env, on, real_adapter):
    async def execute_tool(name, args, ctx, setting):
        return json.dumps({"report": "funnel"})

    real_adapter(execute_tool)
    result = await server._on_call_tool(None, params())
    assert json.loads(result.content[0].text) == {"report": "funnel"} and not result.is_error
    assert audit_rows(env) == [(True, None)]
    assert env.audit[0]["session"] is env.lane_sessions[0] and len(env.lane_sessions) == 1


def slow_audit(monkeypatch, seconds):
    real = FakeRepo.log_tool_call

    def log_tool_call(self, **row):
        time.sleep(seconds)
        real(self, **row)

    monkeypatch.setattr(FakeRepo, "log_tool_call", log_tool_call)


async def test_a_tool_that_finished_by_the_deadline_is_answered_even_if_its_row_crosses_it(env, on, monkeypatch,
                                                                                           real_adapter):
    monkeypatch.setattr(server, "TOOL_LANE_DEADLINE_S", 0.05)
    slow_audit(monkeypatch, 0.3)

    async def execute_tool(name, args, ctx, setting):
        return json.dumps({"report": "funnel"})

    real_adapter(execute_tool)
    result = await server._on_call_tool(None, params())
    assert json.loads(result.content[0].text) == {"report": "funnel"} and not result.is_error
    assert audit_rows(env) == [(True, None)]
    assert_clean(env.gate)


async def test_the_wait_for_a_finished_tools_row_is_bounded(env, on, monkeypatch, real_adapter):
    monkeypatch.setattr(server, "TOOL_LANE_DEADLINE_S", 0.05)
    monkeypatch.setattr(server, "TOOL_LANE_FINISH_GRACE_S", 0.05)
    slow_audit(monkeypatch, 0.4)

    async def execute_tool(name, args, ctx, setting):
        return json.dumps({"report": "funnel"})

    real_adapter(execute_tool)
    begun = time.monotonic()
    result = await server._on_call_tool(None, params())
    assert json.loads(result.content[0].text)["error"] == "tool_timeout" and time.monotonic() - begun < 0.35
    assert env.gate.running == 1
    await until(lambda: env.gate.running == 0)
    assert_clean(env.gate)


async def test_an_on_loop_tool_is_given_no_stop_check(env, on):
    await server._on_call_tool(None, params(name="whoami"))
    assert env.runs[0]["before_audit"] is None


async def test_cancelling_the_caller_cancels_the_tool_and_audits_cancelled(env, on):
    seen = []

    async def tool():
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            seen.append("cancelled")
            raise

    env.tool = tool
    call = asyncio.create_task(server._on_call_tool(None, params()))
    await until(lambda: env.runs)
    call.cancel()
    with pytest.raises(asyncio.CancelledError):
        await call
    await until(lambda: env.gate.running == 0)
    assert seen == ["cancelled"]
    assert [row["error_code"] for row in env.audit] == ["cancelled"]
    assert env.lane_sessions[0].events[-1] == "rollback"
    assert_clean(env.gate)


async def test_a_failed_rollback_or_audit_does_not_hide_the_cancel(env, on, monkeypatch):
    monkeypatch.setattr(server, "TOOL_LANE_DEADLINE_S", 0.05)

    async def tool():
        await asyncio.sleep(30)

    def bad_rollback(self):
        raise RuntimeError("gone")

    def bad_audit(self, **row):
        raise RuntimeError("gone")

    monkeypatch.setattr(FakeSession, "rollback", bad_rollback)
    monkeypatch.setattr(FakeRepo, "log_tool_call", bad_audit)
    env.tool = tool
    result = await server._on_call_tool(None, params())
    assert json.loads(result.content[0].text)["error"] == "tool_timeout"
    await until(lambda: env.gate.running == 0)
    assert_clean(env.gate)


async def test_an_on_loop_tool_never_takes_the_lanes_audit_path(env, on):
    async def tool():
        await asyncio.sleep(30)

    env.tool = tool
    call = asyncio.create_task(server._on_call_tool(None, params("whoami")))
    await until(lambda: env.runs)
    call.cancel()
    with pytest.raises(asyncio.CancelledError):
        await call
    assert env.audit == []
    assert "rollback" not in env.main_sessions[0].events


async def test_a_task_that_outlives_the_call_logs_a_warning_and_is_left_alone(env, on, caplog):
    survivor = {}

    async def tool():
        async def linger():
            try:
                await asyncio.sleep(0.2)
                survivor["finished"] = True
            except asyncio.CancelledError:
                survivor["killed"] = True
                raise

        survivor["task"] = asyncio.create_task(linger())

    env.tool = tool
    with caplog.at_level(logging.WARNING, logger="app.mcp.lanes"):
        await server._on_call_tool(None, params())
    assert any("outlived the call" in r.getMessage() for r in caplog.records)
    await until(lambda: survivor.get("finished"))
    assert "killed" not in survivor


# ── the bridge and the lane ──────────────────────────────────────────────
async def test_submit_frees_nothing_until_the_thread_returns():
    worker = lanes.Worker("mcp-test")
    freed = []
    release = threading.Event()

    async def blocked():
        release.wait(10)
        return "done"

    result, cancel = lanes.submit(worker, blocked, lambda: freed.append(True))
    await asyncio.sleep(0.02)
    cancel()
    result.cancel()
    await asyncio.sleep(0.05)
    assert freed == []
    release.set()
    await until(lambda: freed)
    worker.stop()
    await until(lambda: not worker.is_alive())


async def test_a_dead_worker_is_replaced_and_logged(caplog):
    lane = lanes.WorkerLane("mcp-test", 1)
    dead = lane._idle[0]
    dead.stop()
    await until(lambda: not dead.is_alive())
    with caplog.at_level(logging.ERROR, logger="app.mcp.lanes"):
        fresh = lane.try_checkout()
    assert fresh is not dead and fresh.is_alive()
    assert any("has died" in r.getMessage() for r in caplog.records)
    assert lane.workers() == [fresh]
    fresh.stop()
    await until(lambda: not fresh.is_alive())


async def test_lane_waiters_are_served_first_come_first_served():
    lane = lanes.WorkerLane("mcp-test", 1, max_waiters=2, wait_s=5)
    release, tasks = await jam(lane)
    order = []

    def job(label):
        async def run():
            order.append(label)
        return run

    first = asyncio.create_task(lane.run(job("first")))
    await asyncio.sleep(0)
    second = asyncio.create_task(lane.run(job("second")))
    await asyncio.sleep(0)
    with pytest.raises(lanes.LaneBusy):
        await lane.run(job("third"))
    release.set()
    await asyncio.gather(first, second, *tasks)
    assert order == ["first", "second"]
    assert len(lane._idle) == 1 and not lane._waiters
    for worker in lane.workers():
        worker.stop()


async def test_a_lane_wait_times_out_and_leaves_nothing_behind():
    lane = lanes.WorkerLane("mcp-test", 1, max_waiters=2, wait_s=0.02)
    release, tasks = await jam(lane)
    with pytest.raises(lanes.LaneBusy):
        await lane.run(lambda: asyncio.sleep(0))
    assert not lane._waiters
    release.set()
    await asyncio.gather(*tasks)
    assert len(lane._idle) == 1
    for worker in lane.workers():
        worker.stop()


async def test_a_cancelled_lane_waiter_leaves_nothing_behind():
    lane = lanes.WorkerLane("mcp-test", 1, max_waiters=2, wait_s=5)
    worker = lane.try_checkout()
    waiting = asyncio.create_task(lane.run(lambda: asyncio.sleep(0)))
    await asyncio.sleep(0)
    assert len(lane._waiters) == 1
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    assert not lane._waiters
    lane.checkin(worker)
    assert list(lane._idle) == [worker]
    worker.stop()


async def test_a_waiter_cancelled_after_its_grant_hands_the_worker_back():
    lane = lanes.WorkerLane("mcp-test", 1, max_waiters=2, wait_s=5)
    worker = lane.try_checkout()
    waiting = asyncio.create_task(lane.run(lambda: asyncio.sleep(0)))
    await asyncio.sleep(0)
    lane.checkin(worker)
    assert not lane._idle  # It went to the waiter, which has not run yet.
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    assert list(lane._idle) == [worker] and not lane._waiters
    worker.stop()


def test_workers_are_daemon_threads():
    worker = lanes.Worker("mcp-test")
    assert worker.thread.daemon is True
    worker.stop()


async def test_run_total_limit_answers_busy_and_the_worker_stays_out_until_it_ends():
    lane = lanes.WorkerLane("mcp-test", 1, max_waiters=1, wait_s=5)
    release = threading.Event()

    async def blocked():
        release.wait(10)

    with pytest.raises(lanes.LaneBusy):
        await lane.run(blocked, total_s=0.02)
    assert not lane._idle
    release.set()
    await until(lambda: lane._idle)
    for worker in lane.workers():
        worker.stop()


def test_the_bridge_works_under_uvloop(env, monkeypatch):
    uvloop = pytest.importorskip("uvloop")
    monkeypatch.setattr(server, "TOOL_LANE_DEADLINE_S", 0.1)
    outcome = {}

    async def scenario():
        assert type(asyncio.get_running_loop()).__module__.startswith("uvloop")
        lanes.start(lane_settings())
        try:
            outcome["ran"] = (await server._on_call_tool(None, params())).content[0].text

            release = threading.Event()

            async def blocked():
                release.wait(10)

            env.tool = blocked
            outcome["blocked"] = json.loads((await server._on_call_tool(None, params())).content[0].text)["error"]
            outcome["running_after_reply"] = env.gate.running
            release.set()
            await until(lambda: env.gate.running == 0)

            async def slow():
                await asyncio.sleep(30)

            env.tool = slow
            outcome["slow"] = json.loads((await server._on_call_tool(None, params())).content[0].text)["error"]
            await until(lambda: env.gate.running == 0)
        finally:
            await lanes.stop(grace_s=0.5)

    uvloop.run(scenario())
    assert outcome == {"ran": "ran", "blocked": "tool_timeout", "running_after_reply": 1, "slow": "tool_timeout"}
    assert [row["error_code"] for row in env.audit] == ["tool_timeout"]
    assert_clean(env.gate)


# ── control lane ─────────────────────────────────────────────────────────
@pytest.fixture
def listing(env, monkeypatch):
    seen = SimpleNamespace(threads=[])

    def list_tools_for(principal, setting, db=None):
        seen.threads.append(threading.current_thread().name)
        return [Tool(name="whoami", input_schema={"type": "object", "properties": {}})]

    monkeypatch.setattr(adapter, "list_tools_for", list_tools_for)
    return seen


async def test_tools_list_runs_on_the_control_lane(env, on, listing):
    result = await server._on_list_tools(None, None)
    assert [tool.name for tool in result.tools] == ["whoami"]
    assert listing.threads[0].startswith("mcp-control-")
    assert env.main_sessions == [] and env.lane_sessions[0].thread.startswith("mcp-control-")


async def test_a_busy_control_lane_raises_server_busy_not_an_empty_list(env, on, listing):
    lane = lanes.control_lane()
    assert (lane.max_waiters, lane.wait_s) == (16, 5.0)
    lane.max_waiters = 0
    release, tasks = await jam(lane)
    with pytest.raises(MCPError) as caught:
        await server._on_list_tools(None, None)
    assert caught.value.error.code == INTERNAL_ERROR
    assert caught.value.error.data["error"] == "server_busy" and caught.value.error.data["retryable"] is True
    release.set()
    await asyncio.gather(*tasks)


async def test_a_control_wait_that_times_out_raises_server_busy(env, on, listing):
    lane = lanes.control_lane()
    lane.wait_s = 0.02
    release, tasks = await jam(lane)
    with pytest.raises(MCPError) as caught:
        await server._on_list_tools(None, None)
    assert caught.value.error.data["error"] == "server_busy"
    release.set()
    await asyncio.gather(*tasks)


async def test_a_real_denial_on_the_control_lane_is_still_an_empty_list(env, on, monkeypatch):
    async def denied(db, settings):
        raise server.McpAuthError("mcp_disabled", "off")

    monkeypatch.setattr(server, "_authorize", denied)
    assert (await server._on_list_tools(None, None)).tools == []


async def test_unavailable_settings_on_the_control_lane_raise(env, on, monkeypatch):
    async def trouble(db, settings):
        raise server._unavailable("settings_unavailable")

    monkeypatch.setattr(server, "_authorize", trouble)
    with pytest.raises(MCPError) as caught:
        await server._on_list_tools(None, None)
    assert caught.value.error.data["error"] == "settings_unavailable"


async def test_guides_authorize_off_the_loop_and_keep_the_cache_on_it(env, on, monkeypatch):
    class Spy(dict):
        writers = []

        def __setitem__(self, key, value):
            Spy.writers.append(threading.current_thread().name)
            super().__setitem__(key, value)

    monkeypatch.setattr(server, "_guide_grants", Spy())
    threads = []
    real_authorize = server._authorize

    async def authorize(db, settings):
        threads.append(threading.current_thread().name)
        return await real_authorize(db, settings)

    monkeypatch.setattr(server, "_authorize", authorize)
    monkeypatch.setattr(reg, "is_tool_allowed", lambda *a: True)

    assert await server._may_read_guides() == (True, "")
    assert threads[0].startswith("mcp-control-")
    assert Spy.writers == [main_thread_name()]

    # A hit needs no worker at all.
    lane = lanes.control_lane()
    lane.max_waiters = 0
    release, tasks = await jam(lane)
    assert await server._may_read_guides() == (True, "")
    assert len(threads) == 1
    release.set()
    await asyncio.gather(*tasks)


async def test_a_guides_denial_is_not_cached(env, on, monkeypatch):
    async def denied(db, settings):
        raise server.McpAuthError("mcp_disabled", "off")

    monkeypatch.setattr(server, "_guide_grants", {})
    monkeypatch.setattr(server, "_authorize", denied)
    assert await server._may_read_guides() == (False, "off")
    assert server._guide_grants == {}


async def test_guides_on_a_busy_control_lane_raise_server_busy(env, on, monkeypatch):
    monkeypatch.setattr(server, "_guide_grants", {})
    lane = lanes.control_lane()
    lane.max_waiters = 0
    release, tasks = await jam(lane)
    with pytest.raises(MCPError) as caught:
        await server._on_list_prompts(None, None)
    assert caught.value.error.data["error"] == "server_busy"
    release.set()
    await asyncio.gather(*tasks)


# ── the token check, through the real SDK app ────────────────────────────
class TokenStore:
    """Stands in for the token table. Every read and touch records its thread."""

    def __init__(self):
        self.rows = {TEST_TOKEN: self.row()}
        self.reads = []
        self.touches = []
        self.failure = None
        self.delay = 0.0

    @staticmethod
    def row():
        return {
            "token_hash": "hash-1", "kind": "access", "pair_id": "pair-1", "client_id": "client-1",
            "user_id": "user-1", "institute_id": A, "username": "u", "scopes": ["vacademy.read"], "resource": None,
            "platform_access_token": "jwt", "platform_refresh_token": "ref",
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1), "revoked_at": None, "last_used_at": None,
        }

    def repo(self, db, cipher):
        store = self

        class Repo:
            def get_token(self, token, kind):
                store.reads.append(threading.current_thread().name)
                if store.delay:
                    time.sleep(store.delay)
                if store.failure:
                    raise store.failure
                return store.rows.get(token)

            def touch_token(self, token_hash):
                store.touches.append(threading.current_thread().name)
                store.rows[TEST_TOKEN]["last_used_at"] = datetime.now(timezone.utc)

        return Repo()


@pytest.fixture
def wire(env, monkeypatch):
    """POST to the real Streamable HTTP app behind the guard. The token table and the tool are replaced."""
    store = TokenStore()
    sessions = []

    @contextmanager
    def session():
        db = FakeSession("verify")
        db.thread = threading.current_thread().name
        sessions.append(db)
        yield db

    settings = SimpleNamespace(
        client_secret="secret", client_name="ai_service", auth_service_base_url="http://auth.test",
        mcp_issuer_url=ISSUER, resolve_mcp_encryption_key=lambda: "a-test-passphrase",
    )
    monkeypatch.setattr(oauth_provider, "McpOAuthRepository", store.repo)
    monkeypatch.setattr(oauth_provider, "mcp_db_session", session)
    monkeypatch.setattr(oauth_provider, "get_settings", lambda: settings)
    monkeypatch.setattr(server, "_settings", lambda: settings)

    async def post(version="2025-06-18", headers=BEARER, method="POST", path="/", tool=LANE_TOOL):
        meta = {"io.modelcontextprotocol/protocolVersion": version,
                "io.modelcontextprotocol/clientCapabilities": {},
                "io.modelcontextprotocol/clientInfo": {"name": "test", "version": "1"}}
        request_headers = {**headers, "accept": "application/json, text/event-stream",
                           "mcp-protocol-version": version, "mcp-method": "tools/call", "mcp-name": tool}
        body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": {}, "_meta": meta}}
        mcp_server = server.build_mcp_server()
        app = McpEdgeGuard(server.build_mcp_asgi_app(settings, mcp_server))
        async with mcp_server.session_manager.run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://mcp.test") as client:
                return await client.request(method, path, headers=request_headers, json=body)

    return SimpleNamespace(post=post, store=store, sessions=sessions, env=env)


@pytest.mark.parametrize("version", PROTOCOLS)
async def test_the_token_check_runs_on_the_verify_lane_once_per_request(wire, on, version):
    response = await wire.post(version)
    assert response.status_code == 200
    assert response.json()["result"]["content"][0]["text"] == "ran"
    assert len(wire.store.reads) == 1
    assert wire.store.reads[0].startswith("mcp-verify-") and wire.store.reads[0] != main_thread_name()
    assert wire.sessions[0].thread.startswith("mcp-verify-")
    assert wire.env.runs[0]["thread"].startswith("mcp-tool-")


@pytest.mark.parametrize("version", PROTOCOLS)
async def test_a_database_failure_in_the_token_check_is_429_not_401_or_500(wire, on, version):
    wire.store.failure = RuntimeError("could not connect")
    response = await wire.post(version)
    assert_edge_busy(response)
    assert wire.env.runs == []
    assert wire.env.gate.snapshot()["by_reject"] == {"edge_busy": 1}


@pytest.mark.parametrize("version", PROTOCOLS)
async def test_a_bad_token_still_gets_the_sdks_401(wire, on, version):
    response = await wire.post(version, headers={"authorization": f"Bearer {UNKNOWN_TOKEN}"})
    assert response.status_code == 401
    assert len(wire.store.reads) == 1 and wire.env.runs == []


MISSHAPEN_TOKENS = ["x", "vcm-test", "vcm_at_", "vcm_at_" + "a" * 42, "vcm_at_" + "a" * 44, "vcm_at_" + "a" * 42 + "+",
                    "vcm_rt_" + "a" * 43, "VCM_AT_" + "a" * 43, " vcm_at_" + "a" * 43, "vcm_at_" + "a" * 43 + " "]


@pytest.mark.parametrize("version", PROTOCOLS)
@pytest.mark.parametrize("value", MISSHAPEN_TOKENS)
async def test_a_value_that_cannot_be_an_issued_token_gets_a_401_with_no_lane_and_no_read(wire, on, version, value):
    lane = lanes.verify_lane()
    lane.max_waiters = 0
    release, tasks = await jam(lane)
    response = await wire.post(version, headers={"authorization": f"Bearer {value}"})
    assert response.status_code == 401
    assert wire.store.reads == [] and wire.sessions == [] and wire.env.runs == []
    assert wire.env.gate.snapshot()["by_reject"] == {}
    release.set()
    await asyncio.gather(*tasks)


async def test_an_issued_token_is_checked_while_a_misshapen_one_is_not(wire, on):
    assert (await wire.post(headers={"authorization": "Bearer x"})).status_code == 401
    assert (await wire.post()).status_code == 200
    assert len(wire.store.reads) == 1


async def test_no_token_gets_a_401_without_a_check(wire, on):
    response = await wire.post(headers={})
    assert response.status_code == 401
    assert wire.store.reads == []


async def test_a_revoked_token_is_refused_on_the_next_request(wire, on):
    assert (await wire.post()).status_code == 200
    wire.store.rows[TEST_TOKEN]["revoked_at"] = datetime.now(timezone.utc)
    assert (await wire.post()).status_code == 401


async def test_an_expired_token_is_refused(wire, on):
    wire.store.rows[TEST_TOKEN]["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    assert (await wire.post()).status_code == 401
    assert wire.store.touches == []


async def test_touch_runs_once_in_60_seconds(wire, on):
    for _ in range(3):
        assert (await wire.post()).status_code == 200
    assert len(wire.store.touches) == 1
    assert wire.store.touches[0].startswith("mcp-verify-")
    wire.store.rows[TEST_TOKEN]["last_used_at"] = datetime.now(timezone.utc) - timedelta(seconds=61)
    assert (await wire.post()).status_code == 200
    assert len(wire.store.touches) == 2


async def test_a_busy_verify_lane_is_429_at_once(wire, on):
    lane = lanes.verify_lane()
    assert (lane.max_waiters, lane.wait_s, len(lane._idle)) == (32, 5.0, 2)
    lane.max_waiters = 0
    release, tasks = await jam(lane)
    started = time.monotonic()
    response = await wire.post()
    assert response.status_code == 429 and time.monotonic() - started < 1
    assert wire.store.reads == []
    release.set()
    await asyncio.gather(*tasks)


async def test_a_slow_token_check_is_429_at_the_limit_and_its_worker_comes_back(wire, on, monkeypatch):
    monkeypatch.setattr(lanes, "VERIFY_WAIT_S", 0.05)
    wire.store.delay = 0.3
    response = await wire.post()
    assert response.status_code == 429
    assert len(lanes.verify_lane()._idle) == 1
    await until(lambda: len(lanes.verify_lane()._idle) == 2)


async def test_the_body_is_not_read_by_the_guard_with_the_lanes_on(on, monkeypatch):
    reached = {}

    async def check(token):
        reached["token"] = token
        return None

    monkeypatch.setattr(admission, "check_access_token_off_loop", check)

    async def inner(scope, receive, send):
        reached["verified"] = oauth_provider.verified_token.get()

    async def receive():
        raise AssertionError("the guard read the body")

    gate = make_gate()
    monkeypatch.setattr(admission, "_instance", gate)
    scope = {"type": "http", "method": "POST", "path": "/", "root_path": "", "headers": [(b"authorization", f"bEaReR {TEST_TOKEN}".encode())]}
    await McpEdgeGuard(inner)(scope, receive, None)
    assert reached == {"token": TEST_TOKEN, "verified": (TEST_TOKEN, None)}
    assert oauth_provider.verified_token.get() is None


async def test_the_guard_checks_any_issued_shape_token_and_leaves_the_rest_alone_with_the_lanes_on(on, monkeypatch):
    checked = []

    async def check(token):
        checked.append(token)

    monkeypatch.setattr(admission, "check_access_token_off_loop", check)
    monkeypatch.setattr(admission, "_instance", make_gate())
    calls = []

    async def inner(scope, receive, send):
        calls.append(scope["path"])

    guard = McpEdgeGuard(inner)
    headers = [(b"authorization", f"Bearer {TEST_TOKEN}".encode())]
    await guard({"type": "http", "method": "GET", "path": "/", "root_path": "", "headers": headers}, None, None)
    await guard({"type": "http", "method": "POST", "path": "/token", "root_path": "", "headers": headers}, None, None)
    await guard({"type": "http", "method": "POST", "path": "/", "root_path": "", "headers": []}, None, None)
    await guard({"type": "http", "method": "GET", "path": "/", "root_path": "", "headers": []}, None, None)
    await guard({"type": "websocket", "path": "/", "root_path": "", "headers": headers}, None, None)
    assert calls == ["/", "/token", "/", "/", "/"]
    assert checked == [TEST_TOKEN, TEST_TOKEN]


@pytest.mark.parametrize("method,path", [("GET", "/"), ("DELETE", "/"), ("POST", "/register")],
                         ids=["get", "delete", "other-route"])
async def test_a_busy_verify_lane_is_429_for_every_bearer_request(wire, on, method, path):
    lane = lanes.verify_lane()
    lane.max_waiters = 0
    release, tasks = await jam(lane)
    try:
        response = await wire.post(method=method, path=path)
    finally:
        release.set()
        await asyncio.gather(*tasks)
    assert_edge_busy(response)


@pytest.mark.parametrize("method", ["GET", "DELETE"])
async def test_a_database_failure_in_the_token_check_is_429_on_get_and_delete(wire, on, method):
    wire.store.failure = RuntimeError("could not connect")
    response = await wire.post(method=method)
    assert_edge_busy(response)


async def test_without_a_token_or_with_a_healthy_lane_get_and_delete_answer_as_usual(wire, on):
    lane = lanes.verify_lane()
    lane.max_waiters = 0
    release, tasks = await jam(lane)
    try:
        assert (await wire.post(method="GET", headers={})).status_code == 401
        assert (await wire.post(method="DELETE", headers={})).status_code == 401
    finally:
        release.set()
        await asyncio.gather(*tasks)
    assert (await wire.post(method="DELETE")).status_code == 405
    assert len(wire.store.reads) == 1


async def test_verify_token_uses_only_an_answer_for_the_same_token(on, monkeypatch):
    provider = VacademyOAuthProvider(SimpleNamespace(), None)
    checked = []

    async def check(token):
        checked.append(token)
        return "from-the-lane"

    monkeypatch.setattr(oauth_provider, "check_access_token_off_loop", check)
    reset = oauth_provider.verified_token.set(("abc", "stored"))
    try:
        assert await provider.verify_token("abc") == "stored"
        assert checked == []
        assert await provider.verify_token("other") == "from-the-lane"
        assert checked == ["other"]
    finally:
        oauth_provider.verified_token.reset(reset)

    reset = oauth_provider.verified_token.set(("abc", None))
    try:
        assert await provider.verify_token("abc") is None
        assert checked == ["other"]
    finally:
        oauth_provider.verified_token.reset(reset)


async def test_a_busy_control_lane_does_not_stop_a_modern_tools_call(wire, on):
    """The SDK's header validation lists tools first and carries on without it; the call then meets the gate."""
    lane = lanes.control_lane()
    lane.max_waiters = 0
    release, tasks = await jam(lane)
    response = await wire.post("2026-07-28")
    assert response.status_code == 200
    assert response.json()["result"]["content"][0]["text"] == "ran"
    release.set()
    await asyncio.gather(*tasks)


async def test_an_over_limit_call_on_the_wire_is_is_error_json(wire, on):
    gate = wire.env.gate
    gate.max_wait_s = 0
    for _ in range(3):
        await gate.enter(A, "t")
    response = await wire.post()
    assert response.status_code == 200
    body = json.loads(response.json()["result"]["content"][0]["text"])
    assert body["error"] == "rate_limited" and response.json()["result"]["isError"] is True


# ── flag off and gate off ────────────────────────────────────────────────
@pytest.mark.parametrize("flag, cap", [(False, 4), (True, 0), (False, 0)], ids=["flag-off", "gate-off", "both-off"])
def test_lanes_do_not_start(flag, cap):
    before = threading.active_count()
    lanes.start(lane_settings(flag, cap))
    assert not lanes.active()
    assert threading.active_count() == before


@pytest.mark.parametrize("value, expected", [(None, "True"), ("true", "True"), ("false", "False")])
def test_flag_defaults_on_and_reads_its_variable(value, expected):
    child_env = {k: v for k, v in os.environ.items() if k != "MCP_OFF_LOOP_ENABLED"}
    if value is not None:
        child_env["MCP_OFF_LOOP_ENABLED"] = value
    out = subprocess.run(
        [sys.executable, "-c", "from app.config import Settings; print(Settings().mcp_off_loop_enabled)"],
        cwd=Path(__file__).resolve().parents[1], env=child_env, capture_output=True, text=True, check=True,
    )
    assert out.stdout.strip().splitlines()[-1] == expected


async def test_flag_off_a_crm_tool_runs_on_the_main_loop_under_the_pool_rule(env):
    lanes.start(lane_settings(enabled=False))
    seen = {}

    async def tool():
        seen["on_main_pool"] = env.gate.running_on_main_pool

    env.tool = tool
    assert (await server._on_call_tool(None, params())).content[0].text == "ran"
    assert env.runs[0]["thread"] == main_thread_name()
    assert seen["on_main_pool"] == 1
    assert env.lane_sessions == [] and len(env.main_sessions) == 1

    env.gate.max_wait_s = 0
    env.gate._pool_getter = lambda: FakePool(out=13)
    assert json.loads((await server._on_call_tool(None, params())).content[0].text)["error"] == "server_busy"
    assert_clean(env.gate)


async def test_flag_off_a_cancel_is_not_audited(env):
    async def tool():
        await asyncio.sleep(30)

    env.tool = tool
    call = asyncio.create_task(server._on_call_tool(None, params()))
    await until(lambda: env.runs)
    call.cancel()
    with pytest.raises(asyncio.CancelledError):
        await call
    assert env.audit == []
    assert_clean(env.gate)


async def test_flag_off_listings_and_guides_stay_on_the_main_loop(env, monkeypatch):
    threads = []
    monkeypatch.setattr(adapter, "list_tools_for", lambda p, s, db=None: threads.append(threading.current_thread().name) or [])
    monkeypatch.setattr(server, "_guide_grants", {})
    monkeypatch.setattr(reg, "is_tool_allowed", lambda *a: True)
    await server._on_list_tools(None, None)
    assert await server._may_read_guides() == (True, "")
    assert threads == [main_thread_name()]
    assert len(env.main_sessions) == 2 and env.lane_sessions == []


async def test_flag_off_the_guard_uses_the_pool_rule_and_verify_uses_the_main_session(monkeypatch):
    monkeypatch.setattr(admission, "_instance", make_gate(FakePool(out=14)))

    async def check(token):
        raise AssertionError("off-loop check ran")

    monkeypatch.setattr(admission, "check_access_token_off_loop", check)
    monkeypatch.setattr(oauth_provider, "check_access_token_off_loop", check)
    sent = []

    async def send(message):
        sent.append(message)

    guard = McpEdgeGuard(None)
    await guard({"type": "http", "method": "POST", "path": "/", "root_path": "",
                 "headers": [(b"authorization", b"Bearer abc")]}, None, send)
    assert sent[0]["status"] == 429

    async def load(self, token):
        return "from-the-main-session"

    monkeypatch.setattr(VacademyOAuthProvider, "load_access_token", load)
    assert await VacademyOAuthProvider(SimpleNamespace(), None).verify_token("abc") == "from-the-main-session"


# ── lifespan ─────────────────────────────────────────────────────────────
async def test_lifespan_starts_the_lanes_before_the_session_manager_and_stops_them_after(lifespan_env, monkeypatch):  # noqa: F811
    monkeypatch.setattr(lanes, "get_settings", lambda: lane_settings())
    order = []

    class Manager:
        @contextlib.asynccontextmanager
        async def run(self):
            order.append(("enter", lanes.active()))
            yield
            order.append(("leave", lanes.active()))

    app = SimpleNamespace(state=SimpleNamespace(mcp_server=SimpleNamespace(session_manager=Manager())))
    lifespan = contextlib.asynccontextmanager(app_factory._lifespan)(app)
    async with lifespan:
        order.append(("served", lanes.active()))
    assert order == [("enter", True), ("served", True), ("leave", True)]
    assert not lanes.active()


# ── shutdown: real uvicorn, real SDK, real signal ────────────────────────
SHUTDOWN_SERVER = textwrap.dedent('''
    import asyncio, contextlib, sys, time
    from contextlib import contextmanager
    from types import SimpleNamespace
    sys.path.insert(0, sys.argv[2])
    import uvicorn
    from mcp.types import CallToolResult, TextContent
    from starlette.applications import Starlette
    from starlette.routing import Mount
    from app.mcp import adapter, admission, lanes, server
    from app.mcp.admission import McpAdmission, McpEdgeGuard
    from app.mcp.oauth_provider import VacademyAccessToken, VacademyOAuthProvider
    from app.schemas.auth import PinnedPrincipal

    MODE, PORT = sys.argv[1], int(sys.argv[3])
    def say(*a): print(*a, flush=True)
    TOKEN = VacademyAccessToken(token="t", client_id="c", scopes=["vacademy.read"], expires_at=4000000000, resource=None,
                                subject="u", user_id="u", institute_id="i", token_hash="h", pair_id="p",
                                platform_access_token="j", platform_refresh_token="r")
    class Db:
        def commit(self): pass
        def rollback(self): say("rollback")
    @contextmanager
    def session(): yield Db()
    class Repo:
        def __init__(self, db, cipher): pass
        def get_client(self, cid): return {"client_name": "c"}
        def log_tool_call(self, **row): say("audit", row["error_code"])
    async def authorize(db, settings):
        return PinnedPrincipal(user_id="u", institute_id="i", roles=["ADMIN"]), {}, TOKEN, "j"
    async def call_tool(**kwargs):
        say("tool started")
        if MODE == "time_sleep":
            time.sleep(120)
        try:
            await asyncio.sleep(120)
        except asyncio.CancelledError as exc:
            say("tool cancelled", type(exc).__name__)
            raise
    async def check(token): return TOKEN
    admission._instance = McpAdmission(pod_cap=4, institute_cap=3, max_wait_s=5, waiters_per_institute=3, waiters_per_pod=8,
                                       pool_reserve=2, pool_capacity=15, pool_getter=lambda: None)
    admission.check_access_token_off_loop = check
    server.mcp_db_session = session
    server._authorize = authorize
    server.McpOAuthRepository = Repo
    server.TokenCipher = lambda key: None
    adapter.call_tool = call_tool
    settings = SimpleNamespace(mcp_issuer_url="http://127.0.0.1:%d/" % PORT, resolve_mcp_encryption_key=lambda: "a-passphrase",
                               client_secret="s", client_name="a", auth_service_base_url="http://x")
    server._settings = lambda: settings
    mcp = server.build_mcp_server()
    inner = McpEdgeGuard(server.build_mcp_asgi_app(settings, mcp))
    @contextlib.asynccontextmanager
    async def lifespan(app):
        lanes.start(SimpleNamespace(mcp_off_loop_enabled=True, mcp_max_tool_calls_per_pod=4))
        try:
            async with mcp.session_manager.run():
                yield
        finally:
            await lanes.stop()
            say("lanes stopped")
    uvicorn.run(Starlette(routes=[Mount("/", app=inner)], lifespan=lifespan), host="127.0.0.1", port=PORT, loop="uvloop",
                log_level="critical", timeout_graceful_shutdown=1)
    say("server returned")
''')


def _free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _run_shutdown(tmp_path, mode):
    pytest.importorskip("uvloop")
    script = tmp_path / "shutdown_server.py"
    script.write_text(SHUTDOWN_SERVER)
    port = _free_port()
    ai_service = str(Path(__file__).resolve().parents[1])
    proc = subprocess.Popen([sys.executable, str(script), mode, ai_service, str(port)],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            try:
                socket.create_connection(("127.0.0.1", port), 0.2).close()
                break
            except OSError:
                time.sleep(0.05)

        def client():
            with contextlib.suppress(Exception):
                httpx.post(
                    f"http://127.0.0.1:{port}/",
                    json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": LANE_TOOL, "arguments": {}}},
                    headers={"Accept": "application/json, text/event-stream", "Authorization": f"Bearer {TEST_TOKEN}",
                             "MCP-Protocol-Version": "2025-06-18"},
                    timeout=30,
                )

        threading.Thread(target=client, daemon=True).start()
        lines = []
        for line in proc.stdout:
            lines.append(line.strip())
            if "tool started" in line:
                break
        assert "tool started" in lines, lines
        time.sleep(0.2)
        started = time.monotonic()
        proc.send_signal(signal.SIGTERM)
        out, _ = proc.communicate(timeout=30)
        return lines + out.splitlines(), time.monotonic() - started, proc.returncode
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()


def test_sigterm_with_a_slow_tool_cancels_rolls_back_audits_and_exits(tmp_path):
    lines, took, code = _run_shutdown(tmp_path, "slow")
    assert "tool cancelled CancelledError" in lines, lines
    assert "rollback" in lines and "audit cancelled" in lines, lines
    assert lines.index("rollback") < lines.index("audit cancelled") < lines.index("lanes stopped"), lines
    assert took < 10, lines
    assert code in (0, -signal.SIGTERM), lines


def test_sigterm_with_a_worker_in_time_sleep_exits_within_the_grace(tmp_path):
    lines, took, code = _run_shutdown(tmp_path, "time_sleep")
    assert "lanes stopped" in lines, lines
    assert took < 10, lines
    assert code in (0, -signal.SIGTERM), lines


# ── database errors around the tool ──────────────────────────────────────
def db_error():
    return OperationalError("UPDATE t SET a = %(a)s", {"a": "value-to-keep-out"}, Exception("gone"))


def assert_retryable_text(result):
    assert result.is_error is True
    payload = json.loads(result.content[0].text)
    assert payload["error"] == "auth_unavailable"
    assert payload["retryable"] is True and payload["started"] is False and payload["changed"] is False
    assert BUSY_RETRY_LOW_S <= payload["retry_after_s"] <= BUSY_RETRY_HIGH_S
    assert "value-to-keep-out" not in result.content[0].text and "UPDATE" not in result.content[0].text


async def test_a_failed_commit_before_the_tool_is_retryable_and_the_tool_does_not_run(env, monkeypatch, caplog):
    def commit(self):
        raise db_error()

    monkeypatch.setattr(FakeSession, "commit", commit)
    with caplog.at_level(logging.WARNING, logger="app.mcp.server"):
        result = await server._run_call(params(), server.db_session)
    assert_retryable_text(result)
    assert env.runs == []
    assert all("value-to-keep-out" not in r.getMessage() and "UPDATE" not in r.getMessage() for r in caplog.records)
    assert any("OperationalError" in r.getMessage() for r in caplog.records)


async def test_a_session_that_will_not_open_is_retryable(env, monkeypatch):
    @contextmanager
    def broken():
        raise db_error()
        yield

    assert_retryable_text(await server._run_call(params(), broken))
    assert env.runs == []


@pytest.mark.parametrize("error", [db_error(), ValueError("Expecting value: line 1 column 1")], ids=["database", "json"])
async def test_authorize_turns_these_into_the_retryable_payload(env, monkeypatch, error):
    async def chain(db, settings):
        raise error

    monkeypatch.undo()
    monkeypatch.setattr(server, "_authorize_chain", chain)
    with pytest.raises(server.McpAuthError) as caught:
        await server._authorize(None, None)
    assert caught.value.reason == "auth_unavailable"
    assert caught.value.payload["retryable"] is True


async def test_a_failed_commit_after_the_tool_ran_does_not_say_it_did_not_run(env, monkeypatch, caplog):
    @contextmanager
    def fails_on_exit():
        yield FakeSession("main")
        raise db_error()

    with caplog.at_level(logging.WARNING, logger="app.mcp.server"):
        result = await server._run_call(params(), fails_on_exit)
    assert len(env.runs) == 1
    assert result.is_error is True
    assert json.loads(result.content[0].text) == {"error": "tool_failed", "tool": LANE_TOOL}
    assert all("value-to-keep-out" not in r.getMessage() for r in caplog.records)


async def test_a_listing_answers_a_database_error_with_the_retryable_payload(env, monkeypatch):
    @contextmanager
    def fails_on_exit():
        yield FakeSession("main")
        raise db_error()

    monkeypatch.setattr(server, "db_session", fails_on_exit)
    monkeypatch.setattr(adapter, "list_tools_for", lambda principal, setting, db=None: [])
    with pytest.raises(MCPError) as caught:
        await server._on_list_tools(None, None)
    assert caught.value.error.code == INTERNAL_ERROR
    assert caught.value.error.data["error"] == "auth_unavailable"
    assert "value-to-keep-out" not in caught.value.error.message


async def test_a_listing_on_the_control_lane_answers_a_database_error_the_same_way(env, on, monkeypatch):
    @contextmanager
    def fails_on_exit():
        yield FakeSession("mcp")
        raise db_error()

    monkeypatch.setattr(server, "mcp_db_session", fails_on_exit)
    monkeypatch.setattr(adapter, "list_tools_for", lambda principal, setting, db=None: [])
    with pytest.raises(MCPError) as caught:
        await server._on_list_tools(None, None)
    assert caught.value.error.data["error"] == "auth_unavailable"


# ── the MCP engine ───────────────────────────────────────────────────────
def test_mcp_engine_settings(monkeypatch):
    captured = {}

    def fake_create_engine(url, **kwargs):
        captured.update(kwargs, url=url)
        return "engine"

    settings = Settings()
    monkeypatch.setattr(settings.__class__, "build_sqlalchemy_url", lambda self: "postgresql+psycopg://u@h/d")
    monkeypatch.setattr(app_db, "get_settings", lambda: settings)
    monkeypatch.setattr(app_db, "create_engine", fake_create_engine)
    monkeypatch.setattr(app_db, "_listen_for_search_path", lambda schema: None)
    assert app_db._create_mcp_engine() == "engine"
    assert captured["pool_size"] == (
        settings.mcp_max_tool_calls_per_pod + MCP_CONTROL_WORKERS + MCP_VERIFY_WORKERS + MCP_OAUTH_WORKERS
    )
    assert captured["hide_parameters"] is True
    assert captured["max_overflow"] == 0 and captured["pool_timeout"] == 5 and captured["pool_pre_ping"] is True
    assert captured["pool_recycle"] == settings.db_pool_recycle_seconds
    assert captured["connect_args"] == {"application_name": "ai_service_mcp", "connect_timeout": 5, "keepalives_idle": 30,
                                        "keepalives_interval": 10, "keepalives_count": 3}


def test_lane_connections_are_computed_not_settable():
    settings = Settings()
    settings.mcp_max_tool_calls_per_pod = 4
    assert settings.mcp_lane_connections() == 10
    assert "mcp_lane_connections" not in Settings.model_fields


def test_search_path_listener_registers_once_however_many_engines(monkeypatch):
    registered = []

    def listens_for(target, name):
        def wrap(fn):
            registered.append((target, name))
            return fn
        return wrap

    monkeypatch.setattr(app_db.event, "listens_for", listens_for)
    monkeypatch.setattr(app_db, "_search_path_listening", False)
    app_db._listen_for_search_path(None)
    assert registered == []
    app_db._listen_for_search_path("tenant")
    app_db._listen_for_search_path("tenant")
    assert registered == [(app_db.Session, "after_begin")]


def test_mcp_session_commits_on_exit_and_rolls_back_on_an_error(monkeypatch):
    made = []

    class Spy(FakeSession):
        def close(self):
            self.events.append("close")

    def factory():
        made.append(Spy("mcp"))
        return made[-1]

    monkeypatch.setattr(app_db, "get_mcp_sessionmaker", lambda: factory)
    with app_db.mcp_db_session():
        pass
    with pytest.raises(ValueError):
        with app_db.mcp_db_session():
            raise ValueError("x")
    with pytest.raises(asyncio.CancelledError):
        with app_db.mcp_db_session():
            raise asyncio.CancelledError()
    assert made[0].events == ["commit", "close"]
    assert made[1].events == ["rollback", "close"]
    assert made[2].events == ["close"]


def test_stats_line_reads_the_mcp_pool(caplog, monkeypatch):
    monkeypatch.setattr(admission, "mcp_pool_checked_out", lambda: 5)
    with caplog.at_level(logging.INFO, logger="app.mcp.admission"):
        admission.log_stats(make_gate())
    assert any("mcp_pool_out=5 " in r.getMessage() for r in caplog.records)


def test_mcp_pool_count_does_not_create_the_engine(monkeypatch):
    monkeypatch.setattr(app_db, "_mcp_engine", None)
    assert app_db.mcp_pool_checked_out() == 0
    assert app_db._mcp_engine is None


# ── real Postgres ────────────────────────────────────────────────────────
@pytest.fixture
def pg(monkeypatch):
    if not PG_URL:
        pytest.skip("MCP_ADMISSION_TEST_PG_URL not set")
    schema = "mcp_lanes_" + uuid.uuid4().hex[:12]
    admin = create_engine(PG_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    url = f"{PG_URL}{'&' if '?' in PG_URL else '?'}options=-csearch_path%3D{schema}"
    settings = SimpleNamespace(build_sqlalchemy_url=lambda: url, mcp_lane_connections=lambda: 10, db_schema=None,
                               db_pool_recycle_seconds=1800, db_pool_size=5, db_max_overflow=10,
                               db_pool_timeout_seconds=30)
    monkeypatch.setattr(app_db, "get_settings", lambda: settings)
    monkeypatch.setattr(app_db, "_mcp_engine", None)
    monkeypatch.setattr(app_db, "_McpSessionLocal", None)
    monkeypatch.setattr(app_db, "_engine", None)
    monkeypatch.setattr(app_db, "_SessionLocal", None)
    engine = app_db.get_mcp_engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE client_secret_key (client_name TEXT PRIMARY KEY, secret_key TEXT)"))
        conn.execute(text("INSERT INTO client_secret_key VALUES ('admin_core_service', 's')"))
    try:
        yield SimpleNamespace(engine=engine, schema=schema)
    finally:
        engine.dispose()
        if app_db._engine is not None:
            app_db._engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def test_session_timeouts_are_transaction_local_on_real_postgres(pg):
    with app_db.mcp_db_session() as db:
        assert db.execute(text("SHOW statement_timeout")).scalar() == "1min"
        assert db.execute(text("SHOW lock_timeout")).scalar() == "10s"
        assert db.execute(text("SELECT current_setting('application_name')")).scalar() == "ai_service_mcp"
        pid = db.execute(text("SELECT pg_backend_pid()")).scalar()
        db.commit()
        # A new transaction on the same session gets them again.
        assert db.execute(text("SHOW statement_timeout")).scalar() == "1min"
    with pg.engine.connect() as conn:
        # Same pooled connection, outside the session: nothing was left behind.
        assert conn.execute(text("SELECT pg_backend_pid()")).scalar() == pid
        assert conn.execute(text("SHOW statement_timeout")).scalar() != "1min"
        assert conn.execute(text("SHOW lock_timeout")).scalar() != "10s"


def test_mcp_engine_is_created_once_across_threads(pg, monkeypatch):
    monkeypatch.setattr(app_db, "_mcp_engine", None)
    monkeypatch.setattr(app_db, "_McpSessionLocal", None)
    with ThreadPoolExecutor(8) as pool:
        engines = list(pool.map(lambda _: app_db.get_mcp_engine(), range(8)))
    assert len({id(e) for e in engines}) == 1
    engines[0].dispose()


async def test_pool_invariant_with_every_lane_in_use_on_real_postgres(pg, monkeypatch):
    """
    Every lane in use: the MCP engine stays within its pool and no checkout waits. The main
    engine is touched only through internal_auth, whose credential read this tool makes.
    """
    from app.services import internal_auth

    engine = pg.engine
    pool = engine.pool
    peak = {"out": 0, "wait": 0.0}
    real_do_get = pool._do_get

    def timed_do_get():
        began = time.perf_counter()
        try:
            return real_do_get()
        finally:
            peak["wait"] = max(peak["wait"], time.perf_counter() - began)

    monkeypatch.setattr(pool, "_do_get", timed_do_get)
    event.listen(pool, "checkout", lambda *a: peak.__setitem__("out", max(peak["out"], pool.checkedout())))

    main_sites = []
    main_engine = app_db.get_engine()

    def main_checkout(*_):
        main_sites.append("internal_auth.py" in "".join(f.filename for f in inspect.stack()))

    event.listen(main_engine.pool, "checkout", main_checkout)

    principal = PinnedPrincipal(user_id="user-1", institute_id=A, roles=["ADMIN"])
    token = access_token()

    async def authorize(db, settings):
        db.execute(text("SELECT 1")).scalar()
        return principal, {}, token, "jwt"

    credential_reads = []

    async def call_tool(**kwargs):
        db = kwargs["db"]
        db.execute(text("SELECT pg_sleep(0.05)")).scalar()
        if not credential_reads:
            credential_reads.append(True)
            await asyncio.to_thread(internal_auth._read_secret_from_db, "admin_core_service")
        return CallToolResult(content=[TextContent(type="text", text="ran")])

    monkeypatch.setattr(admission, "_instance", make_gate(institute_cap=4, waiters_per_institute=8, max_wait_s=30))
    monkeypatch.setattr(server, "_settings", lambda: SimpleNamespace(resolve_mcp_encryption_key=lambda: "key"))
    monkeypatch.setattr(server, "get_access_token", lambda: token)
    monkeypatch.setattr(server, "_authorize", authorize)
    monkeypatch.setattr(server, "McpOAuthRepository", lambda db, cipher: SimpleNamespace(get_client=lambda client_id: None))
    monkeypatch.setattr(server, "TokenCipher", lambda key: None)
    monkeypatch.setattr(adapter, "call_tool", call_tool)
    monkeypatch.setattr(adapter, "list_tools_for", lambda p, s, db=None: [])

    async def check_token():
        async def check():
            with app_db.mcp_db_session() as db:
                db.execute(text("SELECT pg_sleep(0.02)")).scalar()

        await lanes.verify_lane().run(check)

    async def oauth_work():
        async def check():
            with app_db.mcp_db_session() as db:
                db.execute(text("SELECT pg_sleep(0.02)")).scalar()

        await lanes.oauth_lane().run(check)

    lanes.start(lane_settings())
    try:
        tools = []
        for _ in range(3):
            tools += [server._on_call_tool(None, params()) for _ in range(4)]
            tools += [server._on_list_tools(None, None) for _ in range(6)]
            tools += [check_token() for _ in range(10)]
            tools += [oauth_work() for _ in range(3)]
        results = await asyncio.gather(*tools, return_exceptions=True)
    finally:
        await lanes.stop()

    failures = [r for r in results if isinstance(r, BaseException)]
    assert failures == []
    assert 1 < peak["out"] <= 10
    assert peak["wait"] < 0.1
    assert pool.checkedout() == 0
    assert main_sites and all(main_sites)
