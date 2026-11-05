"""
The admission gate and the edge guard in front of MCP tool calls.

Pinned here: which call waits and which is refused, that a refused call touches
nothing, that slots come back however a call ends, the pool rule, the client
contract, the 429 on all three entry points, and the stats line.

No database and no network, except the confirm_token test, which needs
MCP_ADMISSION_TEST_PG_URL (e.g. postgresql+psycopg://postgres@localhost:55432/postgres)
and works in its own throw-away schema. It is skipped otherwise.
"""
import asyncio
import inspect
import json
import logging
import os
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from mcp.types import CallToolResult, TextContent  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from starlette.routing import Mount  # noqa: E402

from app import app_factory  # noqa: E402
from app import db as app_db  # noqa: E402
from app.config import Settings, get_settings  # noqa: E402
from app.core import security  # noqa: E402
from app.mcp import adapter, admission, server  # noqa: E402
from app.mcp.admission import McpAdmission, McpEdgeGuard  # noqa: E402
from app.mcp.constants import rate_limited_payload, server_busy_payload  # noqa: E402
from app.mcp.oauth_provider import VacademyAccessToken, VacademyOAuthProvider  # noqa: E402
from app.models.crm_confirm import CrmConfirm  # noqa: E402
from app.routers import health  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import assistant_tool_registry as reg  # noqa: E402
from app.services import crm_data as cd  # noqa: E402
from crm_fakes import make_ctx  # noqa: E402

A, B, C = "inst-a", "inst-b", "inst-c"
ISSUER = "https://mcp.test/ai-service/mcp"
BEARER = {"authorization": "Bearer vmcp-test"}
PG_URL = os.getenv("MCP_ADMISSION_TEST_PG_URL")
REAL_AUTHORIZE = server._authorize
RETRY_SENTENCE = ("Run at most 3 tools at a time. If a tool returns rate_limited or server_busy, wait retry_after_s "
                  "and retry the same call; it did not run.")


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


async def tick():
    for _ in range(3):
        await asyncio.sleep(0)


def waiting(gate, institute, tool="t"):
    return asyncio.create_task(gate.enter(institute, tool))


def assert_clean(gate):
    assert gate.running == 0 and gate.running_on_main_pool == 0
    assert gate.running_by_institute == {}
    assert not gate._waiters and not gate._started


# ── who runs, who waits, who is refused ──────────────────────────────────
async def test_fourth_call_waits_and_the_seventh_is_refused_at_once():
    gate = make_gate()
    for _ in range(3):
        assert await gate.enter(A, "t") is None
    tasks = [waiting(gate, A) for _ in range(3)]
    await tick()
    assert not any(t.done() for t in tasks) and gate.snapshot()["waiting"] == 3

    started = asyncio.get_running_loop().time()
    rejection = await gate.enter(A, "t")
    assert rejection.code == "rate_limited"
    assert asyncio.get_running_loop().time() - started < 0.1

    for done in range(3):
        gate.leave(A)
        await tick()
        assert sum(t.done() for t in tasks) == done + 1
    assert [t.result() for t in tasks] == [None, None, None]
    for _ in range(3):
        gate.leave(A)
    assert_clean(gate)


async def test_second_institute_gets_the_fourth_slot_and_then_server_busy():
    gate = make_gate(max_wait_s=0.01)
    for _ in range(3):
        assert await gate.enter(A, "t") is None
    assert await gate.enter(B, "t") is None
    assert (await gate.enter(B, "t")).code == "server_busy"
    assert (await gate.enter(C, "t")).code == "server_busy"
    assert (await gate.enter(A, "t")).code == "rate_limited"


async def test_pod_wide_waiter_allowance_refuses_with_the_blocked_reason():
    gate = make_gate(waiters_per_pod=2)
    for institute in (A, A, B, C):
        assert await gate.enter(institute, "t") is None
    tasks = [waiting(gate, B), waiting(gate, C)]
    await tick()
    started = asyncio.get_running_loop().time()
    assert (await gate.enter("inst-d", "t")).code == "server_busy"
    assert asyncio.get_running_loop().time() - started < 0.1
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


@pytest.mark.parametrize("held, institute, code", [
    ([A, A, A], A, "rate_limited"),
    ([A, A, B, C], "inst-d", "server_busy"),
], ids=["institute-at-cap", "pod-at-cap"])
async def test_a_wait_that_times_out_gives_the_current_reason(held, institute, code):
    gate = make_gate(max_wait_s=0.01)
    for name in held:
        assert await gate.enter(name, "t") is None
    assert (await gate.enter(institute, "t")).code == code
    assert not gate._waiters


async def test_timeout_reports_what_blocks_it_now_not_what_blocked_it_first():
    gate = make_gate(max_wait_s=0.05)
    for name in (A, A, A, B):
        assert await gate.enter(name, "t") is None
    task = waiting(gate, A)
    await tick()
    gate.leave(B)        # the pod has room again; only this institute's cap still blocks the waiter
    assert (await task).code == "rate_limited"


async def test_waiters_are_woken_in_order_and_one_at_its_institute_cap_is_skipped():
    gate = make_gate()
    for name in (A, A, A, C):
        assert await gate.enter(name, "t") is None
    first_a, then_b, then_c = waiting(gate, A), waiting(gate, B), waiting(gate, C)
    await tick()

    gate.leave(C)        # A is still at its cap, so the slot goes to B
    await tick()
    assert then_b.done() and not first_a.done() and not then_c.done()

    gate.leave(A)        # A is below its cap again and queued first
    await tick()
    assert first_a.done() and not then_c.done()
    then_c.cancel()
    await asyncio.gather(then_c, return_exceptions=True)


async def test_waking_rechecks_the_pool_rule():
    pool = FakePool()
    gate = make_gate(pool=pool)
    for name in (A, A, B, C):
        assert await gate.enter(name, "t") is None
    task = waiting(gate, "inst-d")
    await tick()
    pool.out = 10        # 10 out + 3 running after the leave reaches the 13 admitted
    gate.leave(B)
    await tick()
    assert not task.done()
    pool.out = 0
    gate.leave(C)
    await tick()
    assert task.done() and task.result() is None


async def test_a_new_call_does_not_overtake_a_waiter_the_pool_now_admits():
    pool = FakePool(out=13)
    gate = make_gate(pool=pool)
    task = waiting(gate, A)
    await tick()
    assert not task.done()
    pool.out = 0
    assert await gate.enter(A, "t") is None      # the waiter takes its slot first, then this call
    await tick()
    assert task.done() and task.result() is None and gate.running == 2


# ── slots come back ──────────────────────────────────────────────────────
async def test_cancelled_waiter_leaves_nothing_behind():
    gate = make_gate()
    for _ in range(3):
        await gate.enter(A, "t")
    task = waiting(gate, A)
    await tick()
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert not gate._waiters and gate.running == 3
    for _ in range(3):
        gate.leave(A)
    assert_clean(gate)


async def test_waiter_cancelled_after_its_grant_gives_the_slot_back():
    gate = make_gate()
    for _ in range(3):
        await gate.enter(A, "t")
    task = waiting(gate, A)
    await tick()
    gate.leave(A)                 # granted now; the task has not run yet
    assert not gate._waiters and gate.running == 3
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert task.cancelled() and gate.running == 2
    for _ in range(2):
        gate.leave(A)
    assert_clean(gate)


async def test_a_grant_passes_on_when_the_next_waiter_can_use_it():
    gate = make_gate()
    for _ in range(3):
        await gate.enter(A, "t")
    cancelled, next_up = waiting(gate, A), waiting(gate, A)
    await tick()
    gate.leave(A)
    cancelled.cancel()
    await asyncio.gather(cancelled, return_exceptions=True)
    await tick()
    assert next_up.done() and next_up.result() is None and gate.running == 3


async def test_counters_reach_zero_and_institute_entries_go():
    gate = make_gate()
    await gate.enter(A, "t")
    await gate.enter(B, "t")
    assert gate.running_by_institute == {A: 1, B: 1}
    gate.leave(A)
    assert gate.running_by_institute == {B: 1}
    gate.leave(B)
    assert_clean(gate)


# ── the pool rule ────────────────────────────────────────────────────────
@pytest.mark.parametrize("out, running, admitted", [(10, 3, False), (5, 3, True), (12, 0, True), (13, 0, False)])
async def test_pool_rule(out, running, admitted):
    gate = make_gate(pool=FakePool(out=out), max_wait_s=0, institute_cap=10)
    gate.pool_capacity = 1000
    for _ in range(running):
        assert await gate.enter(A, "t") is None
    gate.pool_capacity = 15
    result = await gate.enter(A, "t")
    assert (result is None) is admitted
    if not admitted:
        assert result.code == "server_busy"


async def test_pool_without_checkedout_skips_the_rule():
    gate = make_gate(pool=SimpleNamespace(), max_wait_s=0)
    assert await gate.enter(A, "t") is None


async def test_pool_that_cannot_be_read_skips_the_rule():
    def broken():
        raise RuntimeError("no database configured")

    gate = make_gate(pool_getter=broken, max_wait_s=0)
    assert await gate.enter(A, "t") is None


async def test_a_call_not_on_the_main_pool_ignores_the_pool_rule():
    gate = make_gate(pool=FakePool(out=15), max_wait_s=0)
    assert await gate.enter(A, "t", uses_main_pool=False) is None
    assert gate.running == 1 and gate.running_on_main_pool == 0
    assert (await gate.enter(A, "t")).code == "server_busy"
    gate.leave(A, uses_main_pool=False)
    assert_clean(gate)


async def test_cap_zero_turns_the_gate_off():
    gate = make_gate(pod_cap=0, pool=FakePool(out=15))
    for _ in range(20):
        assert await gate.enter(A, "t") is None
    assert gate.running == 0
    gate.leave(A)
    assert_clean(gate)


def test_settings_defaults_and_capacity():
    defaults = {name: field.default for name, field in Settings.model_fields.items()}
    assert defaults["mcp_max_tool_calls_per_pod"] == 4
    assert defaults["mcp_max_tool_calls_per_institute"] == 3
    assert defaults["mcp_gate_max_wait_s"] == 5
    assert defaults["mcp_gate_waiters_per_institute"] == 3
    assert defaults["mcp_gate_waiters_per_pod"] == 8
    assert defaults["mcp_pool_reserve"] == 2

    gate = McpAdmission.from_settings(SimpleNamespace(
        mcp_max_tool_calls_per_pod=4, mcp_max_tool_calls_per_institute=3, mcp_gate_max_wait_s=5,
        mcp_gate_waiters_per_institute=3, mcp_gate_waiters_per_pod=8, mcp_pool_reserve=2,
        db_pool_size=5, db_max_overflow=10,
    ))
    assert gate.pool_capacity == 15


# ── the client contract ──────────────────────────────────────────────────
def test_retry_ranges_hold():
    limited = [rate_limited_payload(3)["retry_after_s"] for _ in range(300)]
    busy = [server_busy_payload()["retry_after_s"] for _ in range(300)]
    assert set(limited) == set(range(5, 16))
    assert min(busy) == 10 and max(busy) == 30


def test_rate_limited_contract():
    body = rate_limited_payload(3)
    n = body.pop("retry_after_s")
    assert body == {
        "error": "rate_limited", "limit_type": "concurrent_calls", "limit": 3,
        "retryable": True, "started": False, "changed": False,
        "message": ("Too many calls from this institute are running on this server right now. That can include "
                    "colleagues' calls and calls your app stopped waiting for. This call did not run and nothing "
                    f"changed. Retry in about {n} seconds and run at most 3 calls at a time. Any confirm_token you "
                    "hold still works until it expires."),
    }


def test_server_busy_contract():
    body = server_busy_payload()
    n = body.pop("retry_after_s")
    assert body == {
        "error": "server_busy", "retryable": True, "started": False, "changed": False,
        "message": (f"Vacademy is at capacity right now. This call did not run and nothing changed. Retry in about {n} "
                    "seconds. This is not caused by your usage."),
    }


async def test_rejection_to_result_is_is_error_json():
    gate = make_gate(max_wait_s=0, institute_cap=0)
    result = (await gate.enter(A, "t")).to_result()
    assert result.is_error is True
    assert json.loads(result.content[0].text)["error"] == "rate_limited"


def test_field_names_match_crm_data():
    """An hourly refusal and a concurrency refusal are read the same way by a client."""
    hourly = cd.err("rate_limited", limit_type="hourly", cap_per_hour=1, retry_after_s=120, message="x")
    assert {"error", "retry_after_s", "limit_type", "message"} <= set(hourly)
    assert {"error", "retry_after_s", "limit_type", "message"} <= set(rate_limited_payload(3))
    assert "retry_after_s" in server_busy_payload() and "retry_after_seconds" not in server_busy_payload()


def test_instructions_lead_with_the_retry_rule():
    assert server.SERVER_INSTRUCTIONS.startswith(RETRY_SENTENCE)
    assert "Access to an education institute's operational data." in server.SERVER_INSTRUCTIONS


@pytest.mark.parametrize("tool", ["crm_collections", "crm_leads"])
def test_tool_descriptions_carry_the_retry_rule(tool):
    assert RETRY_SENTENCE in reg.ASSISTANT_TOOLS[tool].schema["function"]["description"]


def test_health_routes_answer_without_a_thread():
    assert inspect.iscoroutinefunction(health.health_root) and inspect.iscoroutinefunction(health.health_legacy)
    assert not inspect.iscoroutinefunction(health.get_database_latency)


# ── through the real handler ─────────────────────────────────────────────
class FakeDb:
    def __init__(self):
        self.events = []

    def commit(self):
        self.events.append("commit")

    def rollback(self):
        self.events.append("rollback")


class FakeRepo:
    def __init__(self, db, cipher):
        self.db = db

    def get_client(self, client_id):
        self.db.events.append("get_client")
        return {"client_name": "Test app"}


def access_token(institute=A):
    return VacademyAccessToken(
        token="vmcp-test", client_id="client-1", scopes=["vacademy.read"], expires_at=4_000_000_000,
        resource=None, subject="user-1", user_id="user-1", institute_id=institute, token_hash="hash-1",
        pair_id="pair-1", platform_access_token="stored-jwt", platform_refresh_token="stored-refresh",
    )


@pytest.fixture
def handler(monkeypatch):
    """server.py's tool handler with a fresh gate; the tool's behaviour is the test's to choose."""
    state = SimpleNamespace(gate=make_gate(), db=FakeDb(), token=access_token(), tool=None, runs=[],
                            principal_institutes=[])
    monkeypatch.setattr(admission, "_instance", state.gate)

    @contextmanager
    def session():
        yield state.db

    async def authorize(db, settings):
        state.principal_institutes.append(state.token.institute_id)
        principal = PinnedPrincipal(user_id="user-1", institute_id=state.token.institute_id, roles=["ADMIN"])
        return principal, {}, state.token, "jwt"

    async def call_tool(**kwargs):
        state.runs.append(kwargs)
        state.db.events.append("tool")
        if state.tool is not None:
            await state.tool()
        return CallToolResult(content=[TextContent(type="text", text="ran")])

    monkeypatch.setattr(server, "db_session", session)
    monkeypatch.setattr(server, "_settings", lambda: SimpleNamespace(resolve_mcp_encryption_key=lambda: "key"))
    monkeypatch.setattr(server, "get_access_token", lambda: state.token)
    monkeypatch.setattr(server, "_authorize", authorize)
    monkeypatch.setattr(server, "McpOAuthRepository", FakeRepo)
    monkeypatch.setattr(server, "TokenCipher", lambda key: None)
    monkeypatch.setattr(adapter, "call_tool", call_tool)
    return state


def params(name="whoami", arguments=None):
    return SimpleNamespace(name=name, arguments=arguments if arguments is not None else {})


async def test_slot_returns_after_a_normal_return(handler):
    result = await server._on_call_tool(None, params())
    assert result.content[0].text == "ran"
    assert_clean(handler.gate)


async def test_slot_returns_after_an_exception(handler):
    async def boom():
        raise RuntimeError("tool blew up")

    handler.tool = boom
    with pytest.raises(RuntimeError):
        await server._on_call_tool(None, params())
    assert_clean(handler.gate)


async def test_slot_returns_after_a_cancel(handler):
    started = asyncio.Event()

    async def hang():
        started.set()
        await asyncio.Event().wait()

    handler.tool = hang
    task = asyncio.create_task(server._on_call_tool(None, params()))
    await started.wait()
    assert handler.gate.running == 1
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert_clean(handler.gate)


async def test_the_connection_is_released_before_the_tool_runs(handler):
    await server._on_call_tool(None, params())
    assert handler.db.events == ["get_client", "commit", "tool"]


async def test_no_token_takes_the_existing_refusal_path_without_a_slot(handler, monkeypatch):
    monkeypatch.setattr(server, "_authorize", REAL_AUTHORIZE)
    handler.token = None
    result = await server._on_call_tool(None, params())
    assert result.is_error is True and result.content[0].text == "This request is not authenticated."
    assert_clean(handler.gate)


async def test_a_rejected_call_touches_nothing(handler, monkeypatch):
    """A strict spy on everything a call could reach: the session, the tool layer, auth-service and the audit row."""
    touched = []

    def spy(name):
        def record(*args, **kwargs):
            touched.append(name)
            raise AssertionError(f"{name} reached by a rejected call")
        return record

    monkeypatch.setattr(server, "db_session", spy("db_session"))
    monkeypatch.setattr(server, "_authorize", spy("_authorize"))
    monkeypatch.setattr(server, "McpOAuthRepository", spy("repository"))
    monkeypatch.setattr(adapter, "call_tool", spy("call_tool"))
    monkeypatch.setattr(adapter, "execute_tool", spy("execute_tool"))
    monkeypatch.setattr(httpx, "AsyncClient", spy("auth-service"))
    monkeypatch.setattr(security, "_verify_and_fetch_user", spy("auth-service"))

    gate = handler.gate
    gate.max_wait_s = 0
    for _ in range(3):
        await gate.enter(A, "t")

    result = await server._on_call_tool(None, params("crm_lead_edit", {"confirm_token": "cfm_x"}))
    assert result.is_error is True
    assert json.loads(result.content[0].text)["error"] == "rate_limited"
    assert touched == []
    assert gate.running == 3


async def test_gate_key_comes_from_the_token_not_the_path_or_arguments(handler):
    """A token at its cap stays refused whatever the request names."""
    gate = handler.gate
    gate.max_wait_s = 0
    for _ in range(3):
        await gate.enter(A, "t")

    institute_path = server.request_institute_id.set(B)
    try:
        result = await server._on_call_tool(None, params(arguments={"institute_id": B, "user_id": "other"}))
    finally:
        server.request_institute_id.reset(institute_path)
    assert json.loads(result.content[0].text)["error"] == "rate_limited"
    assert handler.runs == []

    handler.token = access_token(B)      # the other institute's token is counted on its own
    assert (await server._on_call_tool(None, params(arguments={"institute_id": A}))).content[0].text == "ran"
    assert handler.principal_institutes == [B]
    assert gate.running_by_institute == {A: 3}


async def test_authorization_still_runs_for_every_admitted_call(handler):
    for _ in range(3):
        await server._on_call_tool(None, params())
    assert len(handler.principal_institutes) == 3


# ── a write that was refused still applies, exactly once ─────────────────
PURPOSE = "admission_test_write"


@pytest.fixture
def pg(monkeypatch):
    if not PG_URL:
        pytest.skip("MCP_ADMISSION_TEST_PG_URL not set")
    schema = "mcp_admission_" + uuid.uuid4().hex[:12]
    admin = create_engine(PG_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(PG_URL, connect_args={"options": f"-csearch_path={schema}"})
    CrmConfirm.__table__.create(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE applied (id SERIAL PRIMARY KEY, lead_id TEXT NOT NULL)"))
    monkeypatch.setattr(app_db, "_engine", engine)
    monkeypatch.setattr(app_db, "_SessionLocal", sessionmaker(bind=engine, expire_on_commit=False, future=True))
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


@pytest.mark.parametrize("held, code", [
    ([A, A, A], "rate_limited"),
    ([B, B, C, C], "server_busy"),
], ids=["institute-at-cap", "pod-at-cap"])
async def test_a_write_refused_at_the_gate_then_retried_applies_exactly_once(pg, monkeypatch, held, code):
    gate = make_gate(max_wait_s=0, pool=FakePool())
    monkeypatch.setattr(admission, "_instance", gate)
    monkeypatch.setattr(server, "db_session", app_db.db_session)
    monkeypatch.setattr(server, "get_access_token", lambda: access_token())
    monkeypatch.setattr(server, "_settings", lambda: SimpleNamespace(resolve_mcp_encryption_key=lambda: "key"))
    monkeypatch.setattr(server, "TokenCipher", lambda key: None)

    class Repo:
        def __init__(self, db, cipher):
            pass

        def get_client(self, client_id):
            return {"client_name": "Test app"}

    async def authorize(db, settings):
        return None, {}, access_token(), "jwt"

    monkeypatch.setattr(server, "McpOAuthRepository", Repo)
    monkeypatch.setattr(server, "_authorize", authorize)

    async def write_tool(**kwargs):
        ctx, db = make_ctx(db=kwargs["db"], institute_id=A), kwargs["db"]

        async def preview():
            return {"would_change": 1, "_summary": {"lead_id": "r-1"}}

        async def apply(summary):
            db.execute(text("INSERT INTO applied (lead_id) VALUES (:l)"), {"l": summary["lead_id"]})
            db.commit()
            return {"applied": True}

        out = await cd.preview_or_apply(ctx, kwargs["arguments"], purpose=PURPOSE, confirm="single_use",
                                        request={"lead_id": "r-1"}, preview=preview, apply=apply)
        return CallToolResult(content=[TextContent(type="text", text=json.dumps(out))])

    monkeypatch.setattr(adapter, "call_tool", write_tool)

    async def call(arguments):
        return json.loads((await server._on_call_tool(None, params("crm_write", arguments))).content[0].text)

    def state():
        with pg.connect() as conn:
            applied = conn.execute(text("SELECT COUNT(*) FROM applied")).scalar()
            spent = conn.execute(text("SELECT COUNT(*) FROM mcp_crm_confirm WHERE spent_at IS NOT NULL")).scalar()
        return applied, spent

    preview = await call({})
    token = preview["confirm_token"]
    assert preview["applied"] is False and state() == (0, 0)

    for institute in held:
        assert await gate.enter(institute, "other") is None
    refused = await call({"confirm_token": token})
    assert refused["error"] == code and refused["started"] is False and refused["changed"] is False
    assert state() == (0, 0)      # the token is not read, so it is not spent

    for institute in held:
        gate.leave(institute)
    assert (await call({"confirm_token": token})) == {"applied": True}
    assert state() == (1, 1)

    again = await call({"confirm_token": token})
    assert again["error"] == "confirm_token_used"
    assert state() == (1, 1)
    assert_clean(gate)


# ── the edge guard ───────────────────────────────────────────────────────
class Inner:
    """The app behind the guard. Records what reached it and never reads the body."""

    def __init__(self, status=200, headers=()):
        self.scopes = []
        self.status = status
        self.headers = list(headers)

    async def __call__(self, scope, receive, send):
        self.scopes.append(scope)
        if scope["type"] != "http":
            return
        await send({"type": "http.response.start", "status": self.status, "headers": self.headers})
        await send({"type": "http.response.body", "body": b"inner"})


async def no_receive():
    raise AssertionError("the guard read the request body")


def scope_for(method="POST", path="/", headers=None, type_="http", **extra):
    raw = [(k.encode(), v.encode()) for k, v in (BEARER if headers is None else headers).items()]
    return {"type": type_, "method": method, "path": path, "headers": raw, "root_path": "", **extra}


async def drive(guard, scope):
    sent = []

    async def send(message):
        sent.append(message)

    await guard(scope, no_receive, send)
    return sent


@pytest.fixture
def edge(monkeypatch):
    pool = FakePool()
    gate = make_gate(pool=pool)
    monkeypatch.setattr(admission, "_instance", gate)
    inner = Inner()
    return SimpleNamespace(pool=pool, gate=gate, inner=inner, guard=McpEdgeGuard(inner))


async def test_edge_answers_429_below_two_free(edge):
    edge.pool.out = 14
    sent = await drive(edge.guard, scope_for())
    assert edge.inner.scopes == []
    start, body = sent
    assert start["status"] == 429
    headers = dict(start["headers"])
    assert headers[b"retry-after"] == b"10"
    assert headers[b"content-type"] == b"application/json"
    assert int(headers[b"content-length"]) == len(body["body"])
    assert json.loads(body["body"]) == {
        "jsonrpc": "2.0", "id": None,
        "error": {"code": -32000, "message": "Vacademy is busy right now. Retry after 10 seconds.",
                  "data": {"error": "server_busy", "retry_after_s": 10}},
    }
    assert edge.gate.snapshot()["by_reject"] == {"edge_busy": 1}


async def test_edge_passes_with_two_free(edge):
    edge.pool.out = 13
    await drive(edge.guard, scope_for())
    assert len(edge.inner.scopes) == 1


@pytest.mark.parametrize("scope", [
    scope_for(method="GET"),
    scope_for(method="DELETE"),
    scope_for(headers={}),
    scope_for(headers={"authorization": "Basic abc"}),
    scope_for(path="/token"),
    scope_for(path="/register"),
    scope_for(path="/ai-service/mcp/token", root_path="/ai-service/mcp"),
], ids=["get", "delete", "no-auth", "basic-auth", "token", "register", "mounted-token"])
async def test_edge_leaves_other_requests_alone_when_busy(edge, scope):
    edge.pool.out = 15
    await drive(edge.guard, scope)
    assert len(edge.inner.scopes) == 1


@pytest.mark.parametrize("type_", ["websocket", "lifespan"])
async def test_edge_leaves_non_http_scopes_alone(edge, type_):
    edge.pool.out = 15
    await drive(edge.guard, {"type": type_})
    assert len(edge.inner.scopes) == 1


async def test_edge_matches_a_lowercase_scheme(edge):
    edge.pool.out = 15
    start, _ = await drive(edge.guard, scope_for(headers={"authorization": "bearer abc"}))
    assert start["status"] == 429


async def test_edge_is_off_at_cap_zero(edge):
    edge.gate.pod_cap = 0
    edge.pool.out = 15
    await drive(edge.guard, scope_for())
    assert len(edge.inner.scopes) == 1


async def test_edge_skips_a_pool_without_checkedout(monkeypatch):
    monkeypatch.setattr(admission, "_instance", make_gate(pool=SimpleNamespace()))
    inner = Inner()
    await drive(McpEdgeGuard(inner), scope_for())
    assert len(inner.scopes) == 1


async def test_edge_counts_protocol_versions_and_bounds_them(edge):
    for value in ("2025-06-18", "2025-06-18", "2026-07-28", "not a version"):
        await drive(edge.guard, scope_for(headers={**BEARER, "mcp-protocol-version": value}))
    await drive(edge.guard, scope_for())
    assert edge.gate.snapshot()["protocol_versions"] == {"2025-06-18": 2, "2026-07-28": 1, "other": 1, "none": 1}

    for day in range(1, 29):
        await drive(edge.guard, scope_for(headers={**BEARER, "mcp-protocol-version": f"2030-01-{day:02d}"}))
    assert len(edge.gate.snapshot()["protocol_versions"]) <= 17


# ── all three entry points, wired by the real app factory ────────────────
@pytest.fixture
def mounted(monkeypatch):
    pool = FakePool()
    monkeypatch.setattr(admission, "_instance", make_gate(pool=pool))
    inner = Inner(status=401, headers=[(b"www-authenticate", b'Bearer resource_metadata="https://x/old"')])
    monkeypatch.setattr(server, "build_mcp_asgi_app", lambda settings, mcp_server: inner)
    settings = get_settings()
    app = FastAPI()
    app_factory._mount_mcp(app, settings)
    assert any(isinstance(r, Mount) and r.path == f"{settings.api_base_path}/mcp" for r in app.router.routes)
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://mcp.test")
    return SimpleNamespace(pool=pool, inner=inner, client=client, base=f"{settings.api_base_path}/mcp")


ENTRY_POINTS = ["", "/", "/i/inst-abcdef12", "/i/inst-abcdef12/"]


@pytest.mark.parametrize("suffix", ENTRY_POINTS, ids=["exact", "trailing-slash", "institute", "institute-slash"])
async def test_every_entry_point_goes_through_the_guard(mounted, suffix):
    mounted.pool.out = 14
    async with mounted.client as client:
        response = await client.post(mounted.base + suffix, headers=BEARER, json={"jsonrpc": "2.0"}, follow_redirects=False)
    assert response.status_code == 429 and response.headers["retry-after"] == "10"
    assert mounted.inner.scopes == []


@pytest.mark.parametrize("suffix", ENTRY_POINTS, ids=["exact", "trailing-slash", "institute", "institute-slash"])
async def test_every_entry_point_passes_when_there_is_room(mounted, suffix):
    async with mounted.client as client:
        response = await client.post(mounted.base + suffix, headers=BEARER, json={"jsonrpc": "2.0"}, follow_redirects=False)
    assert response.status_code == 401 and len(mounted.inner.scopes) == 1


async def test_oauth_routes_pass_through_the_mount_when_busy(mounted):
    mounted.pool.out = 15
    async with mounted.client as client:
        response = await client.post(mounted.base + "/token", headers=BEARER, json={})
    assert response.status_code == 401 and len(mounted.inner.scopes) == 1


async def test_institute_path_still_rewrites_the_401_challenge(mounted):
    async with mounted.client as client:
        response = await client.post(mounted.base + "/i/inst-abcdef12", headers=BEARER, json={})
    assert response.status_code == 401
    assert "/i/inst-abcdef12" in response.headers["www-authenticate"]


# ── on the wire, through the SDK ─────────────────────────────────────────
PROTOCOLS = ["2025-06-18", "2026-07-28"]


@pytest.fixture
def wire(handler, monkeypatch):
    """POST to the real Streamable HTTP app behind the guard. Only the token lookup and the tool are replaced."""
    async def load(self, token):
        return handler.token

    monkeypatch.setattr(VacademyOAuthProvider, "load_access_token", load)
    settings = SimpleNamespace(
        client_secret="secret", client_name="ai_service", auth_service_base_url="http://auth.test",
        mcp_issuer_url=ISSUER, resolve_mcp_encryption_key=lambda: "key",
    )
    monkeypatch.setattr(server, "_settings", lambda: settings)

    async def post(version, headers=BEARER):
        meta = {"io.modelcontextprotocol/protocolVersion": version,
                "io.modelcontextprotocol/clientCapabilities": {},
                "io.modelcontextprotocol/clientInfo": {"name": "test", "version": "1"}}
        request_headers = {**headers, "accept": "application/json, text/event-stream",
                           "mcp-protocol-version": version, "mcp-method": "tools/call", "mcp-name": "whoami"}
        body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": {"name": "whoami", "arguments": {}, "_meta": meta}}
        mcp_server = server.build_mcp_server()
        app = McpEdgeGuard(server.build_mcp_asgi_app(settings, mcp_server))
        async with mcp_server.session_manager.run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://mcp.test") as client:
                return await client.post("/", headers=request_headers, json=body)

    return post


@pytest.mark.parametrize("version", PROTOCOLS)
async def test_a_refused_call_on_the_wire_is_http_200_is_error_json(wire, handler, version):
    gate = handler.gate
    gate.max_wait_s = 0
    for _ in range(3):
        await gate.enter(A, "t")
    response = await wire(version)
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["isError"] is True
    body = json.loads(result["content"][0]["text"])
    assert body["error"] == "rate_limited" and body["limit"] == 3 and 5 <= body["retry_after_s"] <= 15
    assert handler.runs == []


@pytest.mark.parametrize("version", PROTOCOLS)
async def test_a_429_on_the_wire_never_reaches_the_token_check(wire, handler, monkeypatch, version):
    async def load(self, token):
        raise AssertionError("token check ran")

    monkeypatch.setattr(VacademyOAuthProvider, "load_access_token", load)
    handler.gate._pool_getter = lambda: FakePool(out=14)
    response = await wire(version)
    assert response.status_code == 429 and response.json()["error"]["data"]["error"] == "server_busy"


async def test_no_token_on_the_wire_still_gets_a_401_when_busy(wire, handler):
    handler.gate._pool_getter = lambda: FakePool(out=15)
    response = await wire("2025-06-18", headers={})
    assert response.status_code == 401


@pytest.mark.parametrize("version", PROTOCOLS)
async def test_an_admitted_call_on_the_wire_runs(wire, handler, version):
    response = await wire(version)
    assert response.status_code == 200
    assert response.json()["result"]["content"][0]["text"] == "ran"
    assert_clean(handler.gate)


# ── logs and the stats line ──────────────────────────────────────────────
async def test_rejections_log_one_warning_per_code_and_institute(caplog):
    gate = make_gate(max_wait_s=0)
    for _ in range(3):
        await gate.enter(A, "crm_leads")
    with caplog.at_level(logging.WARNING, logger=admission.logger.name):
        for _ in range(5):
            await gate.enter(A, "crm_leads")
    lines = [r.getMessage() for r in caplog.records]
    assert len(lines) == 1
    assert "code=rate_limited" in lines[0] and f"institute={A}" in lines[0] and "tool=crm_leads" in lines[0]
    assert "running=3" in lines[0] and "institute_running=3" in lines[0]
    assert gate.snapshot()["by_reject"] == {"rate_limited": 5}


async def test_reject_log_keys_stay_bounded(monkeypatch):
    monkeypatch.setattr(admission, "_REJECT_LOG_MAX_KEYS", 4)
    gate = make_gate(max_wait_s=0, institute_cap=0)
    for i in range(20):
        await gate.enter(f"inst-{i}", "t")
    assert len(gate._reject_logged_at) <= 4


async def test_stats_line_shape_and_interval_reset(caplog):
    gate = make_gate(pool=FakePool(out=2), max_wait_s=0)
    await gate.enter(A, "t")
    gate.note_protocol_version(b"2025-06-18")
    gate.note_lag(12.0)
    gate.institute_cap = 0
    await gate.enter(A, "t")
    gate.institute_cap = 3

    with caplog.at_level(logging.INFO, logger=admission.logger.name):
        admission.log_stats(gate)
    line = [r.getMessage() for r in caplog.records if r.getMessage().startswith("mcp_stats")][0]
    assert line.startswith('mcp_stats running=1 waiting=0 by_reject={"rate_limited":1} pool_out=2 mcp_pool_out=0 ')
    assert "loop_lag_max_ms=12 " in line and line.endswith('protocol_versions={"2025-06-18":1}')
    assert "oldest_call_s=" in line

    snap = gate.snapshot()
    assert snap["by_reject"] == {} and snap["protocol_versions"] == {} and snap["loop_lag_max_ms"] == 0
    assert snap["running"] == 1


async def test_stats_warns_on_lag_and_errors_on_an_old_call(caplog, monkeypatch):
    gate = make_gate()
    await gate.enter(A, "t")
    with caplog.at_level(logging.INFO, logger=admission.logger.name):
        admission.log_stats(gate)
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]

    caplog.clear()
    gate.note_lag(1500.0)
    monkeypatch.setattr(admission, "OLDEST_CALL_ERROR_S", -1.0)
    with caplog.at_level(logging.INFO, logger=admission.logger.name):
        admission.log_stats(gate)
    levels = {r.levelno for r in caplog.records}
    assert logging.WARNING in levels and logging.ERROR in levels


async def test_oldest_call_stays_visible_when_a_newer_one_leaves():
    gate = make_gate()
    release_new = asyncio.Event()

    async def newer():
        assert await gate.enter(A, "t") is None
        await release_new.wait()
        gate.leave(A)

    await gate.enter(A, "t")
    first_started = next(iter(gate._started.values()))
    task = asyncio.create_task(newer())
    await tick()
    assert len(gate._started) == 2
    release_new.set()
    await task
    assert list(gate._started.values()) == [first_started]
    gate.leave(A)
    assert_clean(gate)


async def test_a_finished_old_call_stops_counting_as_oldest():
    gate = make_gate()
    release_old, entered_new, release_new = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def call(release, entered=None):
        assert await gate.enter(A, "t") is None
        if entered:
            entered.set()
        await release.wait()
        gate.leave(A)

    old = asyncio.create_task(call(release_old))
    await tick()
    new = asyncio.create_task(call(release_new, entered_new))
    await entered_new.wait()
    second_started = list(gate._started.values())[1]
    release_old.set()
    await old
    assert list(gate._started.values()) == [second_started]
    release_new.set()
    await new
    assert_clean(gate)


async def test_stats_tasks_measure_lag_and_stop_cleanly(monkeypatch):
    gate = make_gate()
    monkeypatch.setattr(admission, "_instance", gate)
    monkeypatch.setattr(admission, "LAG_TICK_S", 0.005)
    tasks = admission.start_stats_tasks()
    await asyncio.sleep(0.01)
    time.sleep(0.05)     # a blocked loop
    await asyncio.sleep(0.02)
    assert gate.snapshot()["loop_lag_max_ms"] >= 30
    await admission.stop_stats_tasks(tasks)
    assert all(t.done() for t in tasks)


async def test_reset_instance_builds_from_settings(monkeypatch):
    monkeypatch.setattr(admission, "_instance", None)
    gate = admission.reset_instance()
    assert admission.instance() is gate
    assert gate.pod_cap == get_settings().mcp_max_tool_calls_per_pod
