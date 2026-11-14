"""
The OAuth routes and the consent page with the lanes on and off, through the real mounted
app (app_factory._mount_mcp) on real Postgres with the real driver.

Pinned here: the whole sign-in, a tool call, a refresh and a revoke on both protocol
versions, where the database work ran, single use of a refresh token and a code under
concurrent requests, what each endpoint answers when the OAuth lane is busy or the database
fails, what it answers for a value the database refuses, a revoke and a rotation of one pair
at once, the MCP settings routes, and what MCP calls answer when a database error reaches them.

Nothing but auth-service's user lookup is left out: with no CLIENT_SECRET the platform JWT
is verified locally. Skipped unless MCP_ADMISSION_TEST_PG_URL is set.
"""
import asyncio
import base64
import contextlib
import hashlib
import json
import logging
import os
import sys
import threading
import time
import uuid
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import jwt  # noqa: E402
import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from sqlalchemy import create_engine, event, text  # noqa: E402
from sqlalchemy.engine import Engine  # noqa: E402
from mcp.server.auth.provider import TokenError  # noqa: E402
from sqlalchemy.exc import (  # noqa: E402
    IntegrityError,
    InterfaceError,
    OperationalError,
    ProgrammingError,
    SQLAlchemyError,
)
from sqlalchemy.exc import TimeoutError as PoolTimeoutError  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import Pool  # noqa: E402

from app import app_factory  # noqa: E402
from app import db as app_db  # noqa: E402
from app.config import MCP_OAUTH_WORKERS, Settings, get_settings  # noqa: E402
from app.mcp import admission, consent, lanes, oauth_provider, server  # noqa: E402
from app.mcp.constants import BUSY_RETRY_HIGH_S, BUSY_RETRY_LOW_S, MCP_SERVER_SETTING_KEY  # noqa: E402
from app.mcp.crypto import ACCESS_TOKEN_PREFIX, TokenCipher, has_access_token_shape, new_token  # noqa: E402
from app.mcp.oauth_provider import VacademyOAuthProvider  # noqa: E402
from app.mcp.principal import PinnedPrincipal  # noqa: E402
from app.mcp.repository import McpOAuthRepository  # noqa: E402
from app.mcp.schema import _ENSURE_TABLE_STATEMENTS  # noqa: E402

PG_URL = os.getenv("MCP_ADMISSION_TEST_PG_URL")
BASE = "/ai-service/mcp"
ISSUER = f"https://mcp.test{BASE}"
INSTITUTE = "institute-oauth-1"
SCOPED_PATH = f"{BASE}/i/{INSTITUTE}"
SCOPED_URL = f"https://mcp.test{SCOPED_PATH}"
REDIRECT = "https://client.test/cb"
VERIFIER = "v" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).decode().rstrip("=")
SIGNING_KEY = base64.b64encode(b"local-test-signing-key-0123456789-0123456789").decode()
PROTOCOLS = ["2025-06-18", "2026-07-28"]
LANE_TOOL = "crm_collections"
SQL_MARKERS = ("SELECT", "UPDATE", "INSERT", "psycopg", "sqlalche", "[SQL", "parameters", "127.0.0.1")


def platform_jwt(role="ADMIN"):
    claims = {"sub": "staff-1", "user": "user-oauth-1", "fullname": "Staff One", "exp": int(time.time()) + 3600,
              "authorities": {INSTITUTE: {"roles": [role], "permissions": []}}}
    return jwt.encode(claims, base64.b64decode(SIGNING_KEY), algorithm="HS256")


class DbTrace:
    """Every statement and pool checkout from every engine, with the thread it ran on."""

    def __init__(self):
        self.threads = []
        self.engines = set()
        self.on = False

    def _note(self):
        if self.on:
            self.threads.append(threading.current_thread().name)

    def _statement(self, conn, cursor, statement, parameters, context, executemany):
        self._note()

    def _checkout(self, dbapi_conn, record, proxy):
        self._note()

    def start(self):
        event.listen(Engine, "before_cursor_execute", self._statement)
        event.listen(Pool, "checkout", self._checkout)
        self.on = True

    def stop(self):
        self.on = False
        event.remove(Engine, "before_cursor_execute", self._statement)
        event.remove(Pool, "checkout", self._checkout)

    def lanes_seen(self):
        return {name.split("-")[1] for name in self.threads if name.startswith("mcp-")}


class Harness:
    def __init__(self, engine, schema, flag):
        self.engine = engine
        self.schema = schema
        self.flag = flag
        self.client = None
        self.trace = DbTrace()

    # ── the database, directly ───────────────────────────────────────────
    def sql(self, statement, **params):
        was_on, self.trace.on = self.trace.on, False
        try:
            with self.engine.begin() as conn:
                result = conn.execute(text(statement), params)
                return result.fetchall() if result.returns_rows else None
        finally:
            self.trace.on = was_on

    def count(self, table, where="TRUE", **params):
        return self.sql(f"SELECT count(*) FROM {table} WHERE {where}", **params)[0][0]

    # ── one step of the sign-in each ─────────────────────────────────────
    async def register(self):
        return await self.client.post(f"{BASE}/register", json={
            "redirect_uris": [REDIRECT], "client_name": "Test app", "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
        })

    async def client_id(self):
        response = await self.register()
        assert response.status_code == 201, response.text
        return response.json()["client_id"]

    async def authorize(self, client_id):
        return await self.client.get(f"{BASE}/authorize", params={
            "response_type": "code", "client_id": client_id, "redirect_uri": REDIRECT, "code_challenge": CHALLENGE,
            "code_challenge_method": "S256", "state": "state-1", "scope": "vacademy.read", "resource": SCOPED_URL,
        })

    async def txn(self, client_id):
        response = await self.authorize(client_id)
        assert response.status_code == 302, response.text
        location = urlparse(response.headers["location"])
        assert location.path == "/mcp/authorize"
        return parse_qs(location.query)["txn"][0]

    async def read_txn(self, txn):
        return await self.client.get(f"{BASE}/oauth/txn/{txn}")

    async def consent(self, txn, approve=True):
        return await self.client.post(
            f"{BASE}/oauth/consent",
            json={"txn": txn, "approve": approve, "refresh_token": "platform-refresh"},
            headers={"authorization": f"Bearer {platform_jwt()}", "clientId": INSTITUTE},
        )

    async def code(self, client_id):
        response = await self.consent(await self.txn(client_id))
        assert response.status_code == 200, response.text
        query = parse_qs(urlparse(response.json()["redirect_to"]).query)
        assert query["state"] == ["state-1"]
        return query["code"][0]

    async def exchange_code(self, client_id, code):
        return await self.client.post(f"{BASE}/token", data={
            "grant_type": "authorization_code", "code": code, "client_id": client_id,
            "redirect_uri": REDIRECT, "code_verifier": VERIFIER,
        })

    async def tokens(self, client_id):
        response = await self.exchange_code(client_id, await self.code(client_id))
        assert response.status_code == 200, response.text
        return response.json()

    async def refresh(self, client_id, refresh_token):
        return await self.client.post(f"{BASE}/token", data={
            "grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": client_id,
        })

    async def revoke(self, client_id, token, hint=None):
        form = {"token": token, "client_id": client_id, "client_secret": ""}
        if hint:
            form["token_type_hint"] = hint
        return await self.client.post(f"{BASE}/revoke", data=form)

    # ── the settings routes ──────────────────────────────────────────────
    def admin_headers(self, role="ADMIN"):
        return {"authorization": f"Bearer {platform_jwt(role)}", "clientId": INSTITUTE}

    async def connection_info(self, role="ADMIN"):
        return await self.client.get(f"{BASE}/oauth/connection-info", headers=self.admin_headers(role))

    async def add_manual_client(self, name="My app", uris=(REDIRECT,), role="ADMIN"):
        return await self.client.post(f"{BASE}/oauth/manual-client", headers=self.admin_headers(role),
                                      json={"client_name": name, "redirect_uris": list(uris)})

    async def delete_manual_client(self, client_id, role="ADMIN"):
        return await self.client.delete(f"{BASE}/oauth/manual-client/{client_id}", headers=self.admin_headers(role))

    async def revoke_connection(self, pair_id, role="ADMIN"):
        return await self.client.delete(f"{BASE}/oauth/connection/{pair_id}", headers=self.admin_headers(role))

    def pair_ids(self):
        return {row[0] for row in self.sql("SELECT DISTINCT pair_id FROM mcp_oauth_token")}

    async def mcp(self, token, method="tools/list", params=None, version="2025-06-18"):
        meta = {"io.modelcontextprotocol/protocolVersion": version, "io.modelcontextprotocol/clientCapabilities": {},
                "io.modelcontextprotocol/clientInfo": {"name": "test", "version": "1"}}
        headers = {"authorization": f"Bearer {token}", "accept": "application/json, text/event-stream",
                   "mcp-protocol-version": version, "mcp-method": method}
        if params and "name" in params:
            headers["mcp-name"] = params["name"]
        body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": {**(params or {}), "_meta": meta}}
        return await self.client.post(SCOPED_PATH, headers=headers, json=body)

    async def call_lane_tool(self, token, version="2025-06-18"):
        return await self.mcp(token, "tools/call", {"name": LANE_TOOL, "arguments": {"action": "unknown"}}, version)

    @contextlib.asynccontextmanager
    async def jammed(self):
        """Every OAuth worker in use and nobody may wait: the lane is really busy."""
        async with jam_lane():
            yield


@contextlib.asynccontextmanager
async def jam_lane(max_waiters=0):
    lane = lanes.oauth_lane()
    waiters, lane.max_waiters = lane.max_waiters, max_waiters
    release = threading.Event()

    async def blocked():
        release.wait(30)

    tasks = [asyncio.create_task(lane.run(blocked)) for _ in range(MCP_OAUTH_WORKERS)]
    while lane._idle:
        await asyncio.sleep(0.002)
    try:
        yield
    finally:
        release.set()
        await asyncio.gather(*tasks)
        lane.max_waiters = waiters


@pytest.fixture(params=[True, False], ids=["lanes-on", "lanes-off"])
def flag(request):
    return request.param


def make_harness(monkeypatch, flag):
    if not PG_URL:
        pytest.skip("MCP_ADMISSION_TEST_PG_URL not set")
    schema = "mcp_oauth_" + uuid.uuid4().hex[:12]
    admin = create_engine(PG_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    url = f"{PG_URL}{'&' if '?' in PG_URL else '?'}options=-csearch_path%3D{schema}"

    settings = get_settings()
    monkeypatch.setattr(Settings, "build_sqlalchemy_url", lambda self: url)
    for name, value in {
        "mcp_issuer_url": ISSUER, "mcp_token_encryption_key": "a-test-passphrase", "jwt_secret_key": SIGNING_KEY,
        "client_secret": "", "admin_dashboard_url": "https://dash.test", "mcp_off_loop_enabled": flag,
        "mcp_max_tool_calls_per_pod": 4, "mcp_max_tool_calls_per_institute": 3,
        "db_pool_size": 5, "db_max_overflow": 10, "db_schema": None,
    }.items():
        monkeypatch.setattr(settings, name, value)
    for name in ("_engine", "_SessionLocal", "_mcp_engine", "_McpSessionLocal"):
        monkeypatch.setattr(app_db, name, None)

    harness = Harness(create_engine(url), schema, flag)
    for statement in _ENSURE_TABLE_STATEMENTS:
        harness.sql(statement)
    harness.sql("CREATE TABLE institutes (id TEXT PRIMARY KEY, name TEXT, setting_json TEXT, admin_portal_base_url TEXT)")
    harness.sql("CREATE TABLE institute_domain_routing (institute_id TEXT, domain TEXT, subdomain TEXT, role TEXT)")
    harness.sql("CREATE TABLE client_secret_key (client_name TEXT PRIMARY KEY, secret_key TEXT)")
    setting = {"setting": {MCP_SERVER_SETTING_KEY: {"data": {
        "enabled": True, "allowed_roles": ["ADMIN"], "enabled_tools": [LANE_TOOL, "whoami"],
    }}}}
    harness.sql("INSERT INTO institutes VALUES (:id, 'Test Institute', :setting, 'https://admin.institute.test')",
                id=INSTITUTE, setting=json.dumps(setting))

    def cleanup():
        harness.engine.dispose()
        for engine in (app_db._engine, app_db._mcp_engine):
            if engine is not None:
                engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()

    harness.cleanup = cleanup
    harness.settings = settings
    return harness


@pytest.fixture
def hx(monkeypatch, flag):
    harness = make_harness(monkeypatch, flag)
    yield harness
    harness.cleanup()


@pytest.fixture
def on(monkeypatch):
    harness = make_harness(monkeypatch, True)
    yield harness
    harness.cleanup()


@contextlib.asynccontextmanager
async def serving(harness):
    """The app as app_factory mounts it, with what its lifespan starts for MCP."""
    app = FastAPI()
    app_factory._mount_mcp(app, harness.settings)
    assert hasattr(app.state, "mcp_server")
    admission.reset_instance()
    lanes.start(harness.settings)
    assert lanes.active() is harness.flag
    try:
        async with app.state.mcp_server.session_manager.run():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="https://mcp.test") as client:
                harness.client = client
                yield harness
    finally:
        await lanes.stop()


def assert_busy(response):
    """503 with one wait in the header and the body, nothing about the database and no verdict on any grant."""
    assert response.status_code == 503, response.text
    wait = int(response.headers["retry-after"])
    assert BUSY_RETRY_LOW_S <= wait <= BUSY_RETRY_HIGH_S
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["error"] == "temporarily_unavailable"
    assert body["retry_after_s"] == wait
    assert str(wait) in body["error_description"]
    for marker in SQL_MARKERS:
        assert marker not in response.text
    assert "invalid" not in response.text


def assert_consent_busy(response):
    assert response.status_code == 503, response.text
    wait = int(response.headers["retry-after"])
    assert BUSY_RETRY_LOW_S <= wait <= BUSY_RETRY_HIGH_S
    assert response.json()["detail"]["reason"] == "server_busy"
    assert response.json()["detail"]["retry_after_s"] == wait
    for marker in SQL_MARKERS:
        assert marker not in response.text


def tool_result(response):
    assert response.status_code == 200, response.text
    return response.json()["result"]


# ── the whole path ───────────────────────────────────────────────────────
@pytest.mark.parametrize("version", PROTOCOLS)
async def test_register_to_revoke(hx, version):
    async with serving(hx):
        hx.trace.start()
        try:
            client_id = await hx.client_id()

            txn = await hx.txn(client_id)
            described = await hx.read_txn(txn)
            assert described.status_code == 200
            assert described.json()["client_name"] == "Test app"
            assert described.json()["institute_name"] == "Test Institute"

            approved = await hx.consent(txn)
            assert approved.status_code == 200
            code = parse_qs(urlparse(approved.json()["redirect_to"]).query)["code"][0]
            assert (await hx.consent(txn)).status_code == 404

            issued = await hx.exchange_code(client_id, code)
            assert issued.status_code == 200, issued.text
            tokens = issued.json()
            assert has_access_token_shape(tokens["access_token"])
            assert issued.headers["cache-control"] == "no-store"
            replayed = await hx.exchange_code(client_id, code)
            assert replayed.status_code == 400 and replayed.json()["error"] == "invalid_grant"

            listed = tool_result(await hx.mcp(tokens["access_token"], version=version))
            assert LANE_TOOL in {tool["name"] for tool in listed["tools"]}
            called = tool_result(await hx.call_lane_tool(tokens["access_token"], version))
            assert called["content"][0]["type"] == "text"
            assert hx.count("mcp_tool_call_log", "tool_name = :tool", tool=LANE_TOOL) == 1

            rotated = await hx.refresh(client_id, tokens["refresh_token"])
            assert rotated.status_code == 200, rotated.text
            fresh = rotated.json()
            assert fresh["access_token"] != tokens["access_token"]
            assert (await hx.mcp(tokens["access_token"], version=version)).status_code == 401
            again = await hx.refresh(client_id, tokens["refresh_token"])
            assert again.status_code == 400 and again.json()["error"] == "invalid_grant"
            assert (await hx.mcp(fresh["access_token"], version=version)).status_code == 200

            revoked = await hx.revoke(client_id, fresh["access_token"])
            assert revoked.status_code == 200
            assert (await hx.mcp(fresh["access_token"], version=version)).status_code == 401
            after = await hx.refresh(client_id, fresh["refresh_token"])
            assert after.status_code == 400 and after.json()["error"] == "invalid_grant"

            second = await hx.tokens(client_id)
            assert (await hx.revoke(client_id, second["refresh_token"], hint="refresh_token")).status_code == 200
            assert (await hx.mcp(second["access_token"], version=version)).status_code == 401
        finally:
            hx.trace.stop()

    assert hx.trace.threads
    main = threading.main_thread().name
    if hx.flag:
        assert main not in hx.trace.threads
        assert hx.trace.lanes_seen() == {"oauth", "verify", "control", "tool"}
    else:
        assert main in hx.trace.threads
        assert hx.trace.lanes_seen() == set()


async def test_a_denied_consent_redirects_with_access_denied(hx):
    async with serving(hx):
        txn = await hx.txn(await hx.client_id())
        denied = await hx.consent(txn, approve=False)
        assert denied.status_code == 200
        query = parse_qs(urlparse(denied.json()["redirect_to"]).query)
        assert query == {"error": ["access_denied"], "state": ["state-1"]}
        assert (await hx.read_txn(txn)).status_code == 404


async def test_with_the_lanes_on_the_main_engine_takes_no_oauth_connection(on):
    async with serving(on):
        before = app_db.get_engine().pool.checkedin() + app_db.get_engine().pool.checkedout()
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        assert (await on.refresh(client_id, tokens["refresh_token"])).status_code == 200
        assert app_db.get_engine().pool.checkedin() + app_db.get_engine().pool.checkedout() == before == 0
        assert app_db.mcp_pool_checked_out() == 0


# ── single use ───────────────────────────────────────────────────────────
async def test_concurrent_refreshes_of_one_token_have_one_winner(hx):
    async with serving(hx):
        client_id = await hx.client_id()
        tokens = await hx.tokens(client_id)
        before = hx.count("mcp_oauth_token")
        answers = await asyncio.gather(*(hx.refresh(client_id, tokens["refresh_token"]) for _ in range(6)))
        statuses = sorted(answer.status_code for answer in answers)
        assert statuses == [200, 400, 400, 400, 400, 400]
        for answer in answers:
            if answer.status_code == 400:
                assert answer.json()["error"] == "invalid_grant"
        assert hx.count("mcp_oauth_token") == before + 2


async def test_two_rotations_inside_the_body_at_once_have_one_winner(on, monkeypatch):
    """Both reach the lock together, after each has read the token as live."""
    barrier = threading.Barrier(2, timeout=10)
    real = McpOAuthRepository.lock_pair

    def together(self, pair_id, institute_id=None):
        barrier.wait()
        return real(self, pair_id, institute_id)

    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        before = on.count("mcp_oauth_token")
        monkeypatch.setattr(McpOAuthRepository, "lock_pair", together)
        answers = await asyncio.gather(*(on.refresh(client_id, tokens["refresh_token"]) for _ in range(2)))
        assert sorted(answer.status_code for answer in answers) == [200, 400]
        loser = next(answer for answer in answers if answer.status_code == 400)
        assert loser.json()["error"] == "invalid_grant"
        assert on.count("mcp_oauth_token") == before + 2
        winner = next(answer for answer in answers if answer.status_code == 200).json()
        assert (await on.mcp(winner["access_token"])).status_code == 200


async def test_two_exchanges_of_one_code_inside_the_body_at_once_have_one_winner(on, monkeypatch):
    barrier = threading.Barrier(2, timeout=10)
    real = McpOAuthRepository.consume_code

    def together(self, code, **kwargs):
        barrier.wait()
        return real(self, code, **kwargs)

    async with serving(on):
        client_id = await on.client_id()
        code = await on.code(client_id)
        monkeypatch.setattr(McpOAuthRepository, "consume_code", together)
        answers = await asyncio.gather(*(on.exchange_code(client_id, code) for _ in range(2)))
        assert sorted(answer.status_code for answer in answers) == [200, 400]
        assert on.count("mcp_oauth_token") == 2


# ── a busy lane, endpoint by endpoint ────────────────────────────────────
def busy_after(monkeypatch, method, jam_state):
    """The lane turns busy once ``method`` has answered, so the next step of the request finds it busy."""
    real = getattr(VacademyOAuthProvider, method)

    async def wrapped(self, *args, **kwargs):
        result = await real(self, *args, **kwargs)
        release = threading.Event()
        lane = lanes.oauth_lane()
        lane.max_waiters = 0

        async def blocked():
            release.wait(30)

        jam_state["release"] = release
        jam_state["tasks"] = [asyncio.create_task(lane.run(blocked)) for _ in range(MCP_OAUTH_WORKERS)]
        while lane._idle:
            await asyncio.sleep(0.002)
        return result

    monkeypatch.setattr(VacademyOAuthProvider, method, wrapped)
    return real


async def free(jam_state, monkeypatch, method, real):
    jam_state["release"].set()
    await asyncio.gather(*jam_state["tasks"])
    lanes.oauth_lane().max_waiters = lanes.OAUTH_WAITERS
    monkeypatch.setattr(VacademyOAuthProvider, method, real)


async def test_register_on_a_busy_lane(on):
    async with serving(on):
        async with on.jammed():
            assert_busy(await on.register())
        assert on.count("mcp_oauth_client") == 0
        assert (await on.register()).status_code == 201
        assert admission.instance().snapshot()["by_reject"].get("oauth_busy") == 1


async def test_a_browser_app_can_read_the_busy_answer(on):
    async with serving(on):
        async with on.jammed():
            response = await on.client.post(f"{BASE}/token", data={"client_id": "x", "grant_type": "refresh_token"},
                                            headers={"origin": "https://app.test"})
            assert_busy(response)
            assert response.headers["access-control-allow-origin"] == "*"


async def test_authorize_with_the_client_lookup_on_a_busy_lane(on):
    async with serving(on):
        client_id = await on.client_id()
        async with on.jammed():
            response = await on.authorize(client_id)
        assert_busy(response)
        assert "location" not in response.headers
        assert on.count("mcp_oauth_txn") == 0


async def test_authorize_stays_503_when_the_lane_frees_during_the_request(on, monkeypatch):
    """The SDK looks the client up a second time. That must not turn the answer into a redirect."""
    real = lanes.WorkerLane.run
    refused = []

    async def refuse_once(self, factory, total_s=None):
        if self.name == "mcp-oauth" and not refused:
            refused.append(True)
            raise lanes.LaneBusy("busy")
        return await real(self, factory, total_s)

    async with serving(on):
        client_id = await on.client_id()
        monkeypatch.setattr(lanes.WorkerLane, "run", refuse_once)
        response = await on.authorize(client_id)
        assert_busy(response)
        assert "location" not in response.headers
        following = await on.authorize(client_id)
        assert following.status_code == 302 and "txn=" in following.headers["location"]


async def test_authorize_busy_is_not_logged_as_an_unexpected_error(on, caplog):
    async with serving(on):
        client_id = await on.client_id()
        with caplog.at_level(logging.ERROR, logger="mcp.server.auth.handlers.authorize"):
            async with on.jammed():
                assert_busy(await on.authorize(client_id))
    assert [r for r in caplog.records if r.name == "mcp.server.auth.handlers.authorize"] == []


async def test_authorize_with_the_parking_on_a_busy_lane_goes_back_with_the_oauth_code(on, monkeypatch):
    state = {}
    async with serving(on):
        client_id = await on.client_id()
        real = busy_after(monkeypatch, "get_client", state)
        response = await on.authorize(client_id)
        await free(state, monkeypatch, "get_client", real)
        assert response.status_code == 302
        location = urlparse(response.headers["location"])
        assert f"{location.scheme}://{location.netloc}{location.path}" == REDIRECT
        query = parse_qs(location.query)
        assert query["error"] == ["temporarily_unavailable"] and query["state"] == ["state-1"]
        assert on.count("mcp_oauth_txn") == 0
        assert (await on.authorize(client_id)).status_code == 302


async def test_token_with_the_client_lookup_on_a_busy_lane(on):
    async with serving(on):
        client_id = await on.client_id()
        code = await on.code(client_id)
        async with on.jammed():
            assert_busy(await on.exchange_code(client_id, code))
        assert (await on.exchange_code(client_id, code)).status_code == 200


async def test_token_with_the_code_lookup_on_a_busy_lane(on, monkeypatch):
    state = {}
    async with serving(on):
        client_id = await on.client_id()
        code = await on.code(client_id)
        real = busy_after(monkeypatch, "get_client", state)
        assert_busy(await on.exchange_code(client_id, code))
        await free(state, monkeypatch, "get_client", real)
        assert (await on.exchange_code(client_id, code)).status_code == 200


async def test_token_with_the_code_exchange_on_a_busy_lane_keeps_the_code_good(on, monkeypatch):
    state = {}
    async with serving(on):
        client_id = await on.client_id()
        code = await on.code(client_id)
        real = busy_after(monkeypatch, "load_authorization_code", state)
        assert_busy(await on.exchange_code(client_id, code))
        await free(state, monkeypatch, "load_authorization_code", real)
        assert on.count("mcp_oauth_code", "used_at IS NOT NULL") == 0
        assert (await on.exchange_code(client_id, code)).status_code == 200


async def test_refresh_with_the_client_lookup_on_a_busy_lane(on):
    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        async with on.jammed():
            assert_busy(await on.refresh(client_id, tokens["refresh_token"]))
        assert (await on.refresh(client_id, tokens["refresh_token"])).status_code == 200


async def test_refresh_with_the_token_lookup_on_a_busy_lane(on, monkeypatch):
    state = {}
    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        real = busy_after(monkeypatch, "get_client", state)
        assert_busy(await on.refresh(client_id, tokens["refresh_token"]))
        await free(state, monkeypatch, "get_client", real)
        assert (await on.refresh(client_id, tokens["refresh_token"])).status_code == 200


async def test_refresh_with_the_rotation_on_a_busy_lane_keeps_the_token_good(on, monkeypatch):
    state = {}
    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        real = busy_after(monkeypatch, "load_refresh_token", state)
        assert_busy(await on.refresh(client_id, tokens["refresh_token"]))
        await free(state, monkeypatch, "load_refresh_token", real)
        assert on.count("mcp_oauth_token", "revoked_at IS NOT NULL") == 0
        assert (await on.mcp(tokens["access_token"])).status_code == 200
        assert (await on.refresh(client_id, tokens["refresh_token"])).status_code == 200


@pytest.mark.parametrize("step", ["get_client", "load_access_token"])
async def test_revoke_on_a_busy_lane_changes_nothing_and_can_be_repeated(on, monkeypatch, step):
    """After the client lookup the token lookup finds the lane busy; after the token lookup, the revoke does."""
    state = {}
    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        real = busy_after(monkeypatch, step, state)
        assert_busy(await on.revoke(client_id, tokens["access_token"]))
        await free(state, monkeypatch, step, real)
        assert on.count("mcp_oauth_token", "revoked_at IS NOT NULL") == 0
        assert (await on.revoke(client_id, tokens["access_token"])).status_code == 200
        assert on.count("mcp_oauth_token", "revoked_at IS NOT NULL") == 2


async def test_revoke_with_the_client_lookup_on_a_busy_lane(on):
    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        async with on.jammed():
            assert_busy(await on.revoke(client_id, tokens["access_token"]))
        assert on.count("mcp_oauth_token", "revoked_at IS NOT NULL") == 0


async def test_consent_routes_on_a_busy_lane(on):
    async with serving(on):
        client_id = await on.client_id()
        txn = await on.txn(client_id)
        async with on.jammed():
            assert_consent_busy(await on.read_txn(txn))
            assert_consent_busy(await on.consent(txn))
        assert on.count("mcp_oauth_txn", "consumed_at IS NOT NULL") == 0
        assert (await on.read_txn(txn)).status_code == 200
        assert (await on.consent(txn)).status_code == 200


async def test_a_busy_oauth_lane_leaves_the_mcp_endpoint_working(on):
    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        async with on.jammed():
            assert LANE_TOOL in {tool["name"] for tool in tool_result(await on.mcp(tokens["access_token"]))["tools"]}


async def test_every_request_on_the_oauth_lane_is_answered(on):
    async with serving(on):
        client_id = await on.client_id()
        answers = await asyncio.gather(*(on.authorize(client_id) for _ in range(40)))
        statuses = {answer.status_code for answer in answers}
        assert statuses <= {302, 503}
        assert 302 in statuses
        for answer in answers:
            if answer.status_code == 302:
                location = answer.headers["location"]
                assert "txn=" in location or "error=temporarily_unavailable" in location
            else:
                assert_busy(answer)


# ── a failed database ────────────────────────────────────────────────────
def point_at_a_closed_port(monkeypatch):
    dead = create_engine("postgresql+psycopg://nobody:not-a-password@127.0.0.1:1/none", hide_parameters=True,
                         connect_args={"connect_timeout": 1})
    monkeypatch.setattr(app_db, "_mcp_engine", dead)
    monkeypatch.setattr(app_db, "_McpSessionLocal", sessionmaker(bind=dead, expire_on_commit=False, future=True))
    return dead


async def test_a_failed_database_gets_busy_from_every_endpoint_and_no_grant_verdict(on, monkeypatch, caplog):
    async with serving(on):
        client_id = await on.client_id()
        txn = await on.txn(client_id)
        code = await on.code(client_id)
        tokens = await on.exchange_code(client_id, code)
        tokens = tokens.json()
        live = app_db._mcp_engine
        real_factory = app_db._McpSessionLocal
        point_at_a_closed_port(monkeypatch)
        with caplog.at_level(logging.WARNING):
            assert_busy(await on.register())
            assert_busy(await on.authorize(client_id))
            assert_busy(await on.exchange_code(client_id, "vcm_ac_never"))
            assert_busy(await on.refresh(client_id, tokens["refresh_token"]))
            assert_busy(await on.revoke(client_id, tokens["access_token"]))
            assert_consent_busy(await on.read_txn(txn))
            assert_consent_busy(await on.consent(txn))
        assert any("OperationalError" in r.getMessage() for r in caplog.records)
        for record in caplog.records:
            if record.name.startswith("app.mcp"):
                assert "not-a-password" not in record.getMessage() and "SELECT" not in record.getMessage()
        monkeypatch.setattr(app_db, "_mcp_engine", live)
        monkeypatch.setattr(app_db, "_McpSessionLocal", real_factory)
        assert (await on.refresh(client_id, tokens["refresh_token"])).status_code == 200


async def test_the_mcp_engine_hides_bound_values_in_its_errors(on, monkeypatch):
    async with serving(on):
        with pytest.raises(Exception) as caught:
            with app_db.mcp_db_session() as db:
                db.execute(text("SELECT no_such_column WHERE 'a' = :secret"), {"secret": "value-to-keep-out"})
        assert "value-to-keep-out" not in str(caught.value)
        assert "SQL parameters hidden" in str(caught.value)


# ── a sign-in step that does not commit ──────────────────────────────────
class EndsConnection:
    """Ends the backend of the connection about to run the nth statement holding ``needle``, or about to commit it."""

    def __init__(self, harness, needle, nth, at_commit):
        self.harness, self.needle, self.nth, self.at_commit = harness, needle, nth, at_commit
        self.seen = 0
        self.fired = False

    def _end(self, conn):
        self.fired = True
        pid = conn.connection.dbapi_connection.info.backend_pid
        self.harness.sql("SELECT pg_terminate_backend(:pid)", pid=pid)
        deadline = time.monotonic() + 5
        while self.harness.count("pg_stat_activity", "pid = :pid", pid=pid) and time.monotonic() < deadline:
            time.sleep(0.01)

    def _statement(self, conn, cursor, statement, parameters, context, executemany):
        if self.fired or self.needle not in statement:
            return
        self.seen += 1
        if self.seen == self.nth and not self.at_commit:
            self._end(conn)

    def _commit(self, conn):
        if not self.fired and self.at_commit and self.seen == self.nth:
            self._end(conn)

    def __enter__(self):
        event.listen(Engine, "before_cursor_execute", self._statement)
        event.listen(Engine, "commit", self._commit)
        return self

    def __exit__(self, *exc):
        event.remove(Engine, "before_cursor_execute", self._statement)
        event.remove(Engine, "commit", self._commit)


async def answer_with_connection_ended(harness, point, request, busy=assert_busy):
    """The request with its connection ended at ``point``: busy with the lanes on, a server error with them off."""
    with EndsConnection(harness, *point) as ended:
        try:
            response = await request()
        except SQLAlchemyError:
            response = None
    assert ended.fired
    if harness.flag:
        busy(response)
    else:
        assert response is None


NEW_TOKEN = "INSERT INTO mcp_oauth_token"
NEW_CODE = "INSERT INTO mcp_oauth_code"


@pytest.mark.parametrize("point", [
    ("FOR UPDATE", 1, False), ("SET revoked_at = %(now)s WHERE pair_id", 1, False),
    (NEW_TOKEN, 1, False), (NEW_TOKEN, 2, False), (NEW_TOKEN, 2, True),
], ids=["at-the-lock", "at-the-revoke", "at-the-access-token", "at-the-refresh-token", "at-the-commit"])
async def test_a_rotation_that_does_not_commit_keeps_the_grant_as_it_was(hx, point):
    async with serving(hx):
        client_id = await hx.client_id()
        tokens = await hx.tokens(client_id)
        await answer_with_connection_ended(hx, point, lambda: hx.refresh(client_id, tokens["refresh_token"]))

        assert hx.count("mcp_oauth_token") == 2
        assert hx.count("mcp_oauth_token", "revoked_at IS NOT NULL") == 0
        assert (await hx.mcp(tokens["access_token"])).status_code == 200

        repeated = await hx.refresh(client_id, tokens["refresh_token"])
        assert repeated.status_code == 200, repeated.text
        assert (await hx.mcp(repeated.json()["access_token"])).status_code == 200
        assert (await hx.mcp(tokens["access_token"])).status_code == 401
        assert hx.count("mcp_oauth_token", "revoked_at IS NULL") == 2


@pytest.mark.parametrize("point", [
    (NEW_TOKEN, 1, False), (NEW_TOKEN, 2, False), (NEW_TOKEN, 2, True),
], ids=["at-the-access-token", "at-the-refresh-token", "at-the-commit"])
async def test_a_code_exchange_that_does_not_commit_keeps_the_code_good(hx, point):
    async with serving(hx):
        client_id = await hx.client_id()
        code = await hx.code(client_id)
        await answer_with_connection_ended(hx, point, lambda: hx.exchange_code(client_id, code))

        assert hx.count("mcp_oauth_code", "used_at IS NOT NULL") == 0
        assert hx.count("mcp_oauth_token") == 0

        repeated = await hx.exchange_code(client_id, code)
        assert repeated.status_code == 200, repeated.text
        assert hx.count("mcp_oauth_token") == 2
        assert (await hx.exchange_code(client_id, code)).status_code == 400


@pytest.mark.parametrize("point", [(NEW_CODE, 1, False), (NEW_CODE, 1, True)], ids=["at-the-code", "at-the-commit"])
async def test_a_consent_that_does_not_commit_leaves_the_request_pending(hx, point):
    async with serving(hx):
        client_id = await hx.client_id()
        txn = await hx.txn(client_id)
        await answer_with_connection_ended(hx, point, lambda: hx.consent(txn), busy=assert_consent_busy)

        assert hx.count("mcp_oauth_txn", "consumed_at IS NOT NULL") == 0
        assert hx.count("mcp_oauth_code") == 0
        assert (await hx.read_txn(txn)).status_code == 200

        repeated = await hx.consent(txn)
        assert repeated.status_code == 200, repeated.text
        code = parse_qs(urlparse(repeated.json()["redirect_to"]).query)["code"][0]
        assert (await hx.exchange_code(client_id, code)).status_code == 200


async def test_a_consent_has_committed_when_it_answers(hx):
    """Called as the route is, with the request's session still open."""
    principal = PinnedPrincipal(user_id="user-oauth-1", institute_id=INSTITUTE, roles=["ADMIN"], permissions=[],
                                is_root_user=False)
    async with serving(hx):
        txn = await hx.txn(await hx.client_id())
        with app_db.db_session() as session:
            answer = await consent.consent(
                SimpleNamespace(headers={"authorization": f"Bearer {platform_jwt()}"}),
                consent.ConsentRequest(txn=txn, approve=True),
                principal=principal, db=session, settings=hx.settings,
            )
            assert "code=" in answer.redirect_to
            assert hx.count("mcp_oauth_code") == 1
            assert hx.count("mcp_oauth_txn", "consumed_at IS NOT NULL") == 1


async def test_a_rotation_past_the_lock_wait_keeps_the_grant_as_it_was(on, monkeypatch):
    monkeypatch.setattr(app_db, "_MCP_TIMEOUTS_SQL", text(
        "SELECT set_config('statement_timeout', '60000', true), set_config('lock_timeout', '200ms', true)"))
    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        with on.engine.connect() as holder:
            holder.execute(text("SELECT 1 FROM mcp_oauth_token WHERE kind = 'access' FOR UPDATE"))
            assert_busy(await on.refresh(client_id, tokens["refresh_token"]))
            holder.rollback()
        assert on.count("mcp_oauth_token", "revoked_at IS NOT NULL") == 0
        assert (await on.refresh(client_id, tokens["refresh_token"])).status_code == 200


async def test_a_refresh_asking_for_more_than_the_grant_keeps_the_token_good(hx):
    """The SDK's handler refuses this first when it has the token's scopes. The provider holds to the same answer."""
    async with serving(hx):
        client_id = await hx.client_id()
        tokens = await hx.tokens(client_id)
        provider = VacademyOAuthProvider(hx.settings, TokenCipher(hx.settings.resolve_mcp_encryption_key()))
        client = await provider.get_client(client_id)
        stored = await provider.load_refresh_token(client, tokens["refresh_token"])
        with pytest.raises(TokenError) as caught:
            await provider.exchange_refresh_token(client, stored, ["vacademy.read", "vacademy.other"])
        assert caught.value.error == "invalid_scope"
        assert hx.count("mcp_oauth_token", "revoked_at IS NOT NULL") == 0
        assert (await hx.refresh(client_id, tokens["refresh_token"])).status_code == 200


# ── database errors on MCP calls ─────────────────────────────────────────
def break_platform_token_update(harness):
    harness.sql("""
        CREATE FUNCTION refuse_update() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'refused value %', NEW.token_hash; END
        $$ LANGUAGE plpgsql""")
    harness.sql("""
        CREATE TRIGGER refuse_update BEFORE UPDATE OF platform_access_enc ON mcp_oauth_token
        FOR EACH ROW EXECUTE FUNCTION refuse_update()""")


async def stale_grant(harness, monkeypatch):
    """A grant whose stored platform token is gone, so the next call refreshes and stores a new one."""
    client_id = await harness.client_id()
    tokens = await harness.tokens(client_id)
    harness.sql("UPDATE mcp_oauth_token SET platform_access_enc = NULL")
    fresh = platform_jwt()

    async def refreshed(refresh_token, settings):
        return fresh

    monkeypatch.setattr(server, "refresh_platform_token", refreshed)
    break_platform_token_update(harness)
    return client_id, tokens


def assert_retryable_payload(payload):
    assert payload["error"] == "auth_unavailable"
    assert payload["retryable"] is True and payload["started"] is False and payload["changed"] is False
    assert BUSY_RETRY_LOW_S <= payload["retry_after_s"] <= 30
    assert "Do not reconnect" in payload["message"]


@pytest.mark.parametrize("version", PROTOCOLS)
async def test_a_failed_store_of_the_platform_token_is_a_retryable_answer_on_a_call(hx, monkeypatch, version, caplog):
    async with serving(hx):
        _, tokens = await stale_grant(hx, monkeypatch)
        with caplog.at_level(logging.WARNING, logger="app.mcp.server"):
            response = await hx.call_lane_tool(tokens["access_token"], version)
        result = tool_result(response)
        assert result["isError"] is True
        assert_retryable_payload(json.loads(result["content"][0]["text"]))
        for marker in SQL_MARKERS + ("refused value",):
            assert marker not in response.text
        assert any("ProgrammingError" in r.getMessage() or "InternalError" in r.getMessage() for r in caplog.records)
        assert all("refused value" not in r.getMessage() for r in caplog.records)
        assert hx.count("mcp_tool_call_log") == 0


@pytest.mark.parametrize("version", PROTOCOLS)
async def test_a_failed_store_of_the_platform_token_is_a_retryable_error_on_a_listing(hx, monkeypatch, version):
    async with serving(hx):
        _, tokens = await stale_grant(hx, monkeypatch)
        response = await hx.mcp(tokens["access_token"], version=version)
        assert response.status_code == 200
        error = response.json()["error"]
        assert error["code"] == -32603
        assert_retryable_payload(error["data"])
        for marker in SQL_MARKERS + ("refused value",):
            assert marker not in response.text


@pytest.mark.parametrize("version", PROTOCOLS)
async def test_an_unreadable_answer_from_auth_service_is_retryable(hx, monkeypatch, version):
    async with serving(hx):
        tokens = await hx.tokens(await hx.client_id())

        async def not_json(*args, **kwargs):
            return json.loads("<html>")

        monkeypatch.setattr(server, "build_pinned_principal", not_json)
        result = tool_result(await hx.call_lane_tool(tokens["access_token"], version))
        assert result["isError"] is True
        assert_retryable_payload(json.loads(result["content"][0]["text"]))


@pytest.mark.parametrize("version", PROTOCOLS)
async def test_a_failed_client_lookup_before_the_tool_is_retryable(hx, monkeypatch, version):
    async with serving(hx):
        tokens = await hx.tokens(await hx.client_id())

        def broken(self, client_id):
            raise OperationalError("SELECT secret", {"p": "value-to-keep-out"}, Exception("gone"))

        monkeypatch.setattr(McpOAuthRepository, "get_client", broken)
        response = await hx.call_lane_tool(tokens["access_token"], version)
        result = tool_result(response)
        assert result["isError"] is True
        assert_retryable_payload(json.loads(result["content"][0]["text"]))
        assert "value-to-keep-out" not in response.text and "SELECT" not in response.text
        assert hx.count("mcp_tool_call_log") == 0


# ── many requests at once ────────────────────────────────────────────────
def test_the_oauth_lane_has_the_settings_of_the_verify_lane():
    assert lanes.OAUTH_WAITERS == lanes.VERIFY_WAITERS
    assert lanes.OAUTH_WAIT_S == lanes.VERIFY_WAIT_S


async def test_refreshes_of_different_tokens_at_once_all_succeed(on):
    async with serving(on):
        client_id = await on.client_id()
        pairs = [await on.tokens(client_id) for _ in range(30)]
        answers = await asyncio.gather(*(on.refresh(client_id, pair["refresh_token"]) for pair in pairs))
        assert [answer.status_code for answer in answers] == [200] * 30


async def until_in_queue(lane, count):
    deadline = time.monotonic() + 5
    while len(lane._waiters) < count:
        assert time.monotonic() < deadline, f"{len(lane._waiters)} in the queue, expected {count}"
        await asyncio.sleep(0.002)


async def test_registrations_answer_and_other_oauth_calls_still_go_through(on):
    limit = lanes.OAUTH_REGISTER_LIMIT
    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        lane = lanes.oauth_lane()
        async with jam_lane(max_waiters=lanes.OAUTH_WAITERS):
            kept = [asyncio.create_task(on.register()) for _ in range(limit)]
            await until_in_queue(lane, limit)
            for _ in range(40):
                assert_busy(await on.register())
            assert len(lane._waiters) == limit
            assert admission.instance().snapshot()["by_reject"].get("oauth_busy") == 40
            refresh = asyncio.create_task(on.refresh(client_id, tokens["refresh_token"]))
            await until_in_queue(lane, limit + 1)
        assert [answer.status_code for answer in await asyncio.gather(*kept)] == [201] * limit
        assert (await refresh).status_code == 200
        assert on.count("mcp_oauth_client") == limit + 1
        assert (await on.register()).status_code == 201


async def test_a_registration_gives_its_place_back_however_it_ends(on, monkeypatch):
    async with serving(on):
        lane = lanes.oauth_lane()
        async with jam_lane(max_waiters=lanes.OAUTH_WAITERS):
            cancelled = [asyncio.create_task(on.register()) for _ in range(lanes.OAUTH_REGISTER_LIMIT)]
            await until_in_queue(lane, lanes.OAUTH_REGISTER_LIMIT)
            for task in cancelled:
                task.cancel()
            await asyncio.gather(*cancelled, return_exceptions=True)
            assert not lane._waiters

        def refused(self, **kwargs):
            raise OperationalError("INSERT", {}, Exception("gone"))

        with monkeypatch.context() as patch:
            patch.setattr(McpOAuthRepository, "save_client", refused)
            for _ in range(lanes.OAUTH_REGISTER_LIMIT + 1):
                assert_busy(await on.register())
        answers = await asyncio.gather(*(on.register() for _ in range(lanes.OAUTH_REGISTER_LIMIT)))
        assert [answer.status_code for answer in answers] == [201] * lanes.OAUTH_REGISTER_LIMIT


# ── values the database refuses ──────────────────────────────────────────
TOO_LONG = "x" * 300


def assert_not_told_to_retry(harness, response):
    assert response.status_code != 503, response.text
    assert "retry-after" not in response.headers
    assert "busy" not in response.text
    if harness.flag:
        assert "oauth_busy" not in admission.instance().snapshot()["by_reject"]


@pytest.mark.parametrize("name", [TOO_LONG, "a\x00b"], ids=["too-long", "nul"])
async def test_a_registration_with_a_value_the_database_refuses_is_invalid_client_metadata(hx, name):
    async with serving(hx):
        response = await hx.client.post(f"{BASE}/register", json={
            "redirect_uris": [REDIRECT], "client_name": name, "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
        })
        assert response.status_code == 400, response.text
        assert response.json()["error"] == "invalid_client_metadata"
        assert_not_told_to_retry(hx, response)
        assert hx.count("mcp_oauth_client") == 0


@pytest.mark.parametrize("field,value", [
    ("code_challenge", TOO_LONG), ("code_challenge", "a\x00b"), ("resource", "a\x00b"),
], ids=["long-challenge", "nul-challenge", "nul-resource"])
async def test_authorize_with_a_value_the_database_refuses_goes_back_with_invalid_request(hx, field, value):
    async with serving(hx):
        client_id = await hx.client_id()
        params = {"response_type": "code", "client_id": client_id, "redirect_uri": REDIRECT,
                  "code_challenge": CHALLENGE, "code_challenge_method": "S256", "state": "state-1", field: value}
        response = await hx.client.get(f"{BASE}/authorize", params=params)
        assert response.status_code == 302, response.text
        location = urlparse(response.headers["location"])
        assert f"{location.scheme}://{location.netloc}{location.path}" == REDIRECT
        query = parse_qs(location.query)
        assert query["error"] == ["invalid_request"] and query["state"] == ["state-1"]
        assert "busy" not in query["error_description"][0]
        assert_not_told_to_retry(hx, response)
        assert hx.count("mcp_oauth_txn") == 0


async def test_a_nul_in_the_client_id_is_an_unknown_client(hx):
    async with serving(hx):
        bad = "a\x00b"
        token = await hx.client.post(f"{BASE}/token", data={
            "grant_type": "refresh_token", "refresh_token": "vcm_rt_x", "client_id": bad})
        assert token.status_code == 401 and token.json()["error"] == "invalid_client"
        assert_not_told_to_retry(hx, token)
        revoke = await hx.revoke(bad, "vcm_at_x")
        assert revoke.status_code == 401 and revoke.json()["error"] == "unauthorized_client"
        assert_not_told_to_retry(hx, revoke)
        authorize = await hx.authorize(bad)
        assert authorize.status_code == 400 and authorize.json()["error"] == "invalid_request"
        assert_not_told_to_retry(hx, authorize)


@pytest.mark.parametrize("stored", ['["https://exa mple.test/cb"]', "5", '["not a url"]'],
                         ids=["space-in-host", "not-a-list", "not-a-url"])
async def test_a_stored_client_the_sdk_model_refuses_is_an_unknown_client(hx, stored):
    async with serving(hx):
        hx.sql("INSERT INTO mcp_oauth_client (client_id, client_name, redirect_uris, grant_types, scope, source) "
               "VALUES ('bad-client', 'Bad', :uris, '[\"refresh_token\"]', 'vacademy.read', 'manual')", uris=stored)
        for _ in range(2):
            token = await hx.client.post(f"{BASE}/token", data={
                "grant_type": "refresh_token", "refresh_token": "vcm_rt_x", "client_id": "bad-client"})
            assert token.status_code == 401 and token.json()["error"] == "invalid_client"
            assert_not_told_to_retry(hx, token)
        authorize = await hx.authorize("bad-client")
        assert authorize.status_code == 400 and authorize.json()["error"] == "invalid_request"
        assert_not_told_to_retry(hx, authorize)


@pytest.mark.parametrize("error", [
    OperationalError("SELECT", {}, Exception("gone")),
    InterfaceError("SELECT", {}, Exception("gone")),
    PoolTimeoutError("no connection in time"),
    lanes.LaneBusy("busy"),
], ids=["operational", "interface", "pool-timeout", "lane"])
async def test_connection_timeout_and_lock_errors_say_busy(on, monkeypatch, error):
    def raises(self, *args, **kwargs):
        raise error

    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        with monkeypatch.context() as patch:
            patch.setattr(McpOAuthRepository, "get_token", raises)
            assert_busy(await on.refresh(client_id, tokens["refresh_token"]))
        assert (await on.refresh(client_id, tokens["refresh_token"])).status_code == 200


@contextlib.asynccontextmanager
async def database_answering_read_only():
    """New connections to this database run read-only, as they do on a server that is not the primary."""
    admin = create_engine(PG_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        name = conn.execute(text("SELECT current_database()")).scalar()
        conn.execute(text(f'ALTER DATABASE "{name}" SET default_transaction_read_only = on'))
        try:
            for engine in (app_db._engine, app_db._mcp_engine):
                if engine is not None:
                    engine.dispose()
            yield
        finally:
            conn.execute(text(f'ALTER DATABASE "{name}" RESET default_transaction_read_only'))
            for engine in (app_db._engine, app_db._mcp_engine):
                if engine is not None:
                    engine.dispose()
    admin.dispose()


async def test_a_database_answering_read_only_is_busy_on_every_oauth_write_and_keeps_the_grant(on):
    async with serving(on):
        client_id = await on.client_id()
        txn = await on.txn(client_id)
        code = await on.code(client_id)
        tokens = (await on.exchange_code(client_id, code)).json()
        other = await on.code(client_id)
        pair_id = next(iter(on.pair_ids()))
        async with database_answering_read_only():
            assert_busy(await on.register())
            assert_busy(await on.exchange_code(client_id, other))
            assert_busy(await on.refresh(client_id, tokens["refresh_token"]))
            assert_busy(await on.revoke(client_id, tokens["refresh_token"]))
            assert_consent_busy(await on.consent(txn))
            assert_consent_busy(await on.add_manual_client())
            assert_consent_busy(await on.revoke_connection(pair_id))
            parked = await on.authorize(client_id)
            assert parked.status_code == 302
            assert parse_qs(urlparse(parked.headers["location"]).query)["error"] == ["temporarily_unavailable"]
        assert (await on.exchange_code(client_id, other)).status_code == 200
        assert (await on.refresh(client_id, tokens["refresh_token"])).status_code == 200


@pytest.mark.parametrize("error", [
    ProgrammingError("SELECT", {}, Exception("no such column")),
    IntegrityError("INSERT", {}, Exception("duplicate")),
    ValueError("unusable"),
], ids=["programming", "integrity", "value"])
async def test_other_errors_do_not_say_busy_or_give_a_verdict_on_the_token(on, monkeypatch, error):
    def raises(self, *args, **kwargs):
        raise error

    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        with monkeypatch.context() as patch:
            patch.setattr(McpOAuthRepository, "get_token", raises)
            with pytest.raises(type(error)):
                await on.refresh(client_id, tokens["refresh_token"])
        assert "oauth_busy" not in admission.instance().snapshot()["by_reject"]
        assert (await on.refresh(client_id, tokens["refresh_token"])).status_code == 200


@pytest.mark.parametrize("needle", ["SELECT name FROM institutes", "SELECT admin_portal_base_url"])
async def test_a_connection_lost_in_a_lookup_with_a_fallback_still_says_busy(on, needle):
    async with serving(on):
        with EndsConnection(on, needle, 1, False) as ended:
            response = await on.connection_info()
        assert ended.fired
        assert_consent_busy(response)
        assert (await on.connection_info()).status_code == 200


async def test_a_lock_wait_past_its_limit_in_a_lookup_with_a_fallback_still_says_busy(on, monkeypatch):
    monkeypatch.setattr(app_db, "_MCP_TIMEOUTS_SQL", text(
        "SELECT set_config('statement_timeout', '60000', true), set_config('lock_timeout', '200ms', true)"))
    async with serving(on):
        with on.engine.connect() as holder:
            holder.execute(text("LOCK TABLE institutes IN ACCESS EXCLUSIVE MODE"))
            assert_consent_busy(await on.connection_info())
            holder.rollback()
        assert (await on.connection_info()).status_code == 200


async def test_a_nul_in_a_pending_request_id_is_not_found(hx):
    async with serving(hx):
        assert (await hx.read_txn("a%00b")).status_code == 404
        assert (await hx.consent("a\x00b")).status_code == 404


async def test_a_settings_route_with_a_value_the_database_refuses_is_a_bad_request(on):
    async with serving(on):
        response = await on.revoke_connection("a%00b")
        assert response.status_code == 400, response.text
        assert_not_told_to_retry(on, response)


# ── a revoke and a rotation of one pair ──────────────────────────────────
class HoldAt:
    """Holds the nth matching statement on an OAuth worker until released."""

    def __init__(self, needle, nth=1):
        self.needle, self.nth = needle, nth
        self.seen = 0
        self.reached, self.go = threading.Event(), threading.Event()

    def _statement(self, conn, cursor, statement, parameters, context, executemany):
        if self.needle not in statement or not threading.current_thread().name.startswith("mcp-oauth"):
            return
        self.seen += 1
        if self.seen == self.nth:
            self.reached.set()
            self.go.wait(20)

    def __enter__(self):
        event.listen(Engine, "before_cursor_execute", self._statement)
        return self

    def __exit__(self, *exc):
        self.go.set()
        event.remove(Engine, "before_cursor_execute", self._statement)

    async def until_reached(self):
        deadline = time.monotonic() + 5
        while not self.reached.is_set():
            assert time.monotonic() < deadline, f"not reached: {self.needle}"
            await asyncio.sleep(0.002)


async def until_a_worker_waits_for_a_lock(harness):
    """Gives up after a while: a request that never waits still answers, and the test reads the answers."""
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if harness.count("pg_stat_activity", "application_name = 'ai_service_mcp' AND wait_event_type = 'Lock'"):
            return
        await asyncio.sleep(0.01)


SIBLING_REVOKE = "SET revoked_at = %(now)s WHERE pair_id"


async def send_revoke(harness, route, client_id, tokens, pair_id):
    if route == "revoke":
        return await harness.revoke(client_id, tokens["access_token"], "access_token")
    return await harness.revoke_connection(pair_id)


@pytest.mark.parametrize("route", ["revoke", "connection"])
async def test_a_revoke_during_a_rotation_waits_and_reaches_the_new_tokens(on, route):
    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        pair_id = on.pair_ids().pop()
        with HoldAt(SIBLING_REVOKE) as hold:
            rotation = asyncio.create_task(on.refresh(client_id, tokens["refresh_token"]))
            await hold.until_reached()
            revoke = asyncio.create_task(send_revoke(on, route, client_id, tokens, pair_id))
            await until_a_worker_waits_for_a_lock(on)
            hold.go.set()
            rotated, revoked = await asyncio.gather(rotation, revoke)

        assert rotated.status_code == 200, rotated.text
        assert revoked.status_code == 200, revoked.text
        assert on.count("mcp_oauth_token") == 4
        assert on.count("mcp_oauth_token", "revoked_at IS NULL") == 0
        fresh = rotated.json()
        assert (await on.mcp(fresh["access_token"])).status_code == 401
        again = await on.refresh(client_id, fresh["refresh_token"])
        assert again.status_code == 400 and again.json()["error"] == "invalid_grant"


@pytest.mark.parametrize("route", ["revoke", "connection"])
async def test_a_revoke_that_waited_for_a_rotation_locks_the_new_tokens_before_revoking_them(on, route):
    """Whoever rotates the new tokens next finds them taken, in the same order as any other pair."""
    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        pair_id = on.pair_ids().pop()
        with HoldAt(SIBLING_REVOKE) as rotation_hold, HoldAt(SIBLING_REVOKE, nth=2) as revoke_hold:
            rotation = asyncio.create_task(on.refresh(client_id, tokens["refresh_token"]))
            await rotation_hold.until_reached()
            revoke = asyncio.create_task(send_revoke(on, route, client_id, tokens, pair_id))
            await until_a_worker_waits_for_a_lock(on)
            rotation_hold.go.set()
            await revoke_hold.until_reached()
            free = on.sql("SELECT token_hash FROM mcp_oauth_token WHERE revoked_at IS NULL FOR UPDATE SKIP LOCKED")
            revoke_hold.go.set()
            rotated, revoked = await asyncio.gather(rotation, revoke)
        assert free == []
        assert on.count("mcp_oauth_token", "revoked_at IS NULL") == 0
        assert rotated.status_code == 200 and revoked.status_code == 200


@pytest.mark.parametrize("route", ["revoke", "connection"])
async def test_a_rotation_during_a_revoke_waits_and_answers_invalid_grant(on, route):
    async with serving(on):
        client_id = await on.client_id()
        tokens = await on.tokens(client_id)
        pair_id = on.pair_ids().pop()
        with HoldAt(SIBLING_REVOKE) as hold:
            revoke = asyncio.create_task(send_revoke(on, route, client_id, tokens, pair_id))
            await hold.until_reached()
            rotation = asyncio.create_task(on.refresh(client_id, tokens["refresh_token"]))
            await until_a_worker_waits_for_a_lock(on)
            hold.go.set()
            rotated, revoked = await asyncio.gather(rotation, revoke)

        assert revoked.status_code == 200, revoked.text
        assert rotated.status_code == 400 and rotated.json()["error"] == "invalid_grant", rotated.text
        assert on.count("mcp_oauth_token") == 2
        assert on.count("mcp_oauth_token", "revoked_at IS NULL") == 0
        assert (await on.mcp(tokens["access_token"])).status_code == 401


async def test_a_rotation_keeps_the_pair_id_so_a_listed_connection_can_still_be_revoked(hx):
    async with serving(hx):
        client_id = await hx.client_id()
        tokens = await hx.tokens(client_id)
        pair_ids = hx.pair_ids()
        assert len(pair_ids) == 1
        listed = (await hx.connection_info()).json()["connections"]
        assert [connection["pair_id"] for connection in listed] == list(pair_ids)

        fresh = (await hx.refresh(client_id, tokens["refresh_token"])).json()
        assert hx.pair_ids() == pair_ids
        assert hx.count("mcp_oauth_token", "revoked_at IS NULL") == 2
        relisted = (await hx.connection_info()).json()["connections"]
        assert [connection["pair_id"] for connection in relisted] == list(pair_ids)

        assert (await hx.revoke_connection(listed[0]["pair_id"])).json() == {"revoked": True}
        assert hx.count("mcp_oauth_token", "revoked_at IS NULL") == 0
        assert (await hx.mcp(fresh["access_token"])).status_code == 401
        assert (await hx.revoke_connection(listed[0]["pair_id"])).status_code == 404


async def test_two_sign_ins_keep_their_own_pair_ids(hx):
    async with serving(hx):
        client_id = await hx.client_id()
        first = await hx.tokens(client_id)
        second = await hx.tokens(client_id)
        assert len(hx.pair_ids()) == 2
        assert (await hx.revoke(client_id, first["access_token"])).status_code == 200
        assert (await hx.mcp(second["access_token"])).status_code == 200


async def test_a_revoke_of_a_connection_stays_within_the_institute(hx):
    async with serving(hx):
        client_id = await hx.client_id()
        await hx.tokens(client_id)
        pair_id = hx.pair_ids().pop()
        hx.sql("UPDATE mcp_oauth_token SET institute_id = 'institute-oauth-2'")
        assert (await hx.revoke_connection(pair_id)).status_code == 404
        assert hx.count("mcp_oauth_token", "revoked_at IS NULL") == 2


async def test_a_revoke_of_a_connection_does_not_wait_for_another_institutes_rows(on, monkeypatch):
    monkeypatch.setattr(app_db, "_MCP_TIMEOUTS_SQL", text(
        "SELECT set_config('statement_timeout', '60000', true), set_config('lock_timeout', '200ms', true)"))
    async with serving(on):
        await on.tokens(await on.client_id())
        pair_id = on.pair_ids().pop()
        on.sql("UPDATE mcp_oauth_token SET institute_id = 'institute-oauth-2'")
        with on.engine.connect() as holder:
            holder.execute(text("SELECT 1 FROM mcp_oauth_token FOR UPDATE"))
            assert (await on.revoke_connection(pair_id)).status_code == 404
            holder.rollback()


# ── the MCP settings routes ──────────────────────────────────────────────
async def test_the_settings_routes_answer_as_before_and_run_where_the_flag_says(hx):
    async with serving(hx):
        client_id = await hx.client_id()
        await hx.tokens(client_id)
        pair_id = hx.pair_ids().pop()
        hx.trace.start()
        try:
            opened = await hx.connection_info()
            assert opened.status_code == 200, opened.text
            info = opened.json()
            assert set(info) == {"server_url", "legacy_server_url", "issuer", "scope", "admin_portal_url", "tools",
                                 "manual_clients", "connections"}
            assert info["server_url"] == SCOPED_URL and info["legacy_server_url"] == ISSUER
            assert info["admin_portal_url"] == "https://admin.institute.test"
            assert info["tools"]
            assert [client["is_primary"] for client in info["manual_clients"]] == [True]
            assert info["manual_clients"][0]["client_name"] == "Test Institute"
            assert [connection["pair_id"] for connection in info["connections"]] == [pair_id]

            added = await hx.add_manual_client(uris=[f" {REDIRECT} "])
            assert added.status_code == 200, added.text
            body = added.json()
            assert set(body) == {"client_id", "client_name", "redirect_uris", "created_at", "is_primary"}
            assert body["client_name"] == "My app" and body["redirect_uris"] == [REDIRECT]
            assert body["is_primary"] is False

            reopened = (await hx.connection_info()).json()
            assert [client["is_primary"] for client in reopened["manual_clients"]] == [True, False]

            assert (await hx.delete_manual_client(body["client_id"])).json() == {"deleted": True}
            assert (await hx.delete_manual_client(body["client_id"])).status_code == 404
            primary = reopened["manual_clients"][0]["client_id"]
            refused = await hx.delete_manual_client(primary)
            assert refused.status_code == 403 and refused.json()["detail"]["reason"] == "primary_client"

            assert (await hx.revoke_connection(pair_id)).json() == {"revoked": True}
            assert (await hx.revoke_connection(pair_id)).status_code == 404
        finally:
            hx.trace.stop()

    assert hx.trace.threads
    main = threading.main_thread().name
    if hx.flag:
        assert main not in hx.trace.threads
        assert hx.trace.lanes_seen() == {"oauth"}
    else:
        assert main in hx.trace.threads
        assert hx.trace.lanes_seen() == set()


async def test_the_settings_routes_take_nothing_from_the_main_engine_with_the_lanes_on(on):
    async with serving(on):
        before = app_db.get_engine().pool.checkedin() + app_db.get_engine().pool.checkedout()
        assert (await on.connection_info()).status_code == 200
        assert (await on.add_manual_client()).status_code == 200
        assert app_db.get_engine().pool.checkedin() + app_db.get_engine().pool.checkedout() == before == 0


async def test_the_settings_routes_keep_their_auth_checks(hx):
    async with serving(hx):
        client_id = await hx.client_id()
        await hx.tokens(client_id)
        pair_id = hx.pair_ids().pop()
        hx.trace.start()
        try:
            for call in (hx.connection_info(role="TEACHER"), hx.add_manual_client(role="TEACHER"),
                         hx.delete_manual_client("vcm-any", role="TEACHER"), hx.revoke_connection(pair_id, role="TEACHER")):
                refused = await call
                assert refused.status_code == 403 and refused.json()["detail"]["reason"] == "not_admin"
            bad_uris = await hx.add_manual_client(uris=["http://client.test/cb"])
            assert bad_uris.status_code == 400
        finally:
            hx.trace.stop()
        assert hx.trace.threads == []
        assert hx.count("mcp_oauth_token", "revoked_at IS NULL") == 2
        assert hx.count("mcp_oauth_client", "source = 'manual'") == 0


async def test_the_settings_routes_on_a_busy_lane(on):
    async with serving(on):
        client_id = await on.client_id()
        await on.tokens(client_id)
        pair_id = on.pair_ids().pop()
        manual = (await on.add_manual_client()).json()["client_id"]
        before = on.count("mcp_oauth_client")
        async with on.jammed():
            assert_consent_busy(await on.connection_info())
            assert_consent_busy(await on.add_manual_client())
            assert_consent_busy(await on.delete_manual_client(manual))
            assert_consent_busy(await on.revoke_connection(pair_id))
        assert on.count("mcp_oauth_client") == before
        assert on.count("mcp_oauth_token", "revoked_at IS NULL") == 2
        assert (await on.connection_info()).status_code == 200
        assert (await on.revoke_connection(pair_id)).status_code == 200


async def test_the_settings_routes_with_a_failed_database(on, monkeypatch):
    async with serving(on):
        client_id = await on.client_id()
        await on.tokens(client_id)
        pair_id = on.pair_ids().pop()
        point_at_a_closed_port(monkeypatch)
        assert_consent_busy(await on.connection_info())
        assert_consent_busy(await on.add_manual_client())
        assert_consent_busy(await on.delete_manual_client("vcm-any"))
        assert_consent_busy(await on.revoke_connection(pair_id))


async def test_two_first_opens_of_the_settings_page_make_one_primary_client(on, monkeypatch):
    """Both find no primary client before either has saved one."""
    barrier = threading.Barrier(2, timeout=10)
    real = McpOAuthRepository.list_manual_clients
    calls = []

    def together(self, institute_id):
        found = real(self, institute_id)
        calls.append(True)
        if len(calls) <= 2:
            barrier.wait()
        return found

    async with serving(on):
        with monkeypatch.context() as patch:
            patch.setattr(McpOAuthRepository, "list_manual_clients", together)
            answers = await asyncio.gather(on.connection_info(), on.connection_info())
        assert [answer.status_code for answer in answers] == [200, 200]
        assert on.count("mcp_oauth_client", "source = 'manual'") == 1
        assert len((await on.connection_info()).json()["manual_clients"]) == 1


# ── token shape ──────────────────────────────────────────────────────────
def test_every_issued_access_token_has_the_shape_the_edge_expects():
    assert all(has_access_token_shape(new_token(ACCESS_TOKEN_PREFIX)) for _ in range(5000))


def test_tokens_are_issued_only_through_the_prefixed_helper():
    """The edge relies on this: one place stores access tokens, and it makes them with new_token."""
    source = Path(oauth_provider.__file__).read_text()
    assert source.count("new_token(ACCESS_TOKEN_PREFIX)") == 1
    assert source.count('token=access, kind="access"') == 1
    app_root = Path(oauth_provider.__file__).resolve().parents[1]
    writers = [p for p in app_root.rglob("*.py") if "INSERT INTO mcp_oauth_token" in p.read_text(errors="ignore")]
    assert [p.name for p in writers] == ["repository.py"]
    callers = [p.name for p in app_root.rglob("*.py") if ".store_token(" in p.read_text(errors="ignore")]
    assert callers == ["oauth_provider.py"]
