"""
"Could not check" is never reported as "not allowed".

Pinned here: a settings read that fails answers settings_unavailable and an
auth-service that cannot answer gives auth_unavailable, neither runs a tool, and
both reach the client as retryable JSON (a -32603 on the listings, a 503 on the
consent page). A saved "off" and a real rejection keep their own answers. Callers
outside MCP keep the old behaviour. CRM admin gates say scope_unavailable when the
caller's scope could not be resolved.

No database and no network: the session is a small fake, auth-service sits behind
httpx.MockTransport, and the MCP SDK's own Streamable HTTP app runs in process.
"""
import json
import sys
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from mcp.shared.exceptions import MCPError  # noqa: E402
from mcp.types import INTERNAL_ERROR, CallToolResult, TextContent  # noqa: E402
from sqlalchemy.exc import OperationalError  # noqa: E402
from sqlalchemy.exc import TimeoutError as SaTimeoutError  # noqa: E402

from app.core import security  # noqa: E402
from app.mcp import adapter, consent, server  # noqa: E402
from app.mcp.access import load_mcp_setting  # noqa: E402
from app.mcp.constants import DENIAL_MESSAGES, DENY_DISABLED, DENY_ROLE, retry_payload  # noqa: E402
from app.mcp.oauth_provider import VacademyAccessToken, VacademyOAuthProvider  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402
from app.services import assistant_tool_registry as reg  # noqa: E402,F401  (load the registry first)
from app.services import assistant_tools_crm_leads as leads  # noqa: E402
from app.services import assistant_tools_crm_reports as reports  # noqa: E402
from app.services import crm_data as cd  # noqa: E402
from app.services.institute_setting_reader import (  # noqa: E402
    SettingReadError,
    load_institute_setting_data,
    read_institute_setting_data,
)
from crm_fakes import CrmBackend, confirm_db, make_ctx  # noqa: E402

INSTITUTE = "inst-1"
KEY = "MCP_SERVER_SETTING"
ISSUER = "https://mcp.test/ai-service/mcp"
AUTH_USER_PATH = "/auth-service/v1/internal/user"
REFRESH_PATH = "/auth-service/v1/refresh-token"
BEARER = {"authorization": "Bearer vmcp-test"}

CLAIMS = {"sub": "asha", "user": "user-1", "authorities": {INSTITUTE: {"roles": ["ADMIN"], "permissions": []}}}
ENABLED = {"setting": {KEY: {"data": {"enabled": True, "allowed_roles": ["ADMIN"], "enabled_tools": ["whoami"]}}}}


class FakeDb:
    """Answers the one settings statement; an exception in ``fail`` makes it raise instead."""

    def __init__(self, raw=None, fail=None):
        self.raw, self.fail = raw, fail
        self.rollbacks = 0
        self.statements = 0

    def execute(self, stmt, params=None):
        self.statements += 1
        if self.fail is not None:
            raise self.fail
        return SimpleNamespace(first=lambda: (self.raw,))

    def rollback(self):
        self.rollbacks += 1

    def commit(self):
        pass


READ_FAILURES = [
    pytest.param({"fail": OperationalError("SELECT 1", {}, Exception("server closed the connection"))}, id="db-error"),
    pytest.param({"fail": SaTimeoutError("QueuePool limit reached")}, id="pool-timeout"),
    pytest.param({"raw": "{not json"}, id="invalid-json"),
    pytest.param({"raw": json.dumps(["a", "list"])}, id="not-a-dict"),
    pytest.param({"raw": json.dumps({"setting": {KEY: "not an object"}})}, id="key-not-a-dict"),
]


class FakeRepo:
    updates = []

    def __init__(self, *a, **k):
        pass

    def update_platform_access_token(self, token_hash, refreshed):
        FakeRepo.updates.append((token_hash, refreshed))

    def get_client(self, client_id):
        return {"client_name": "Test app"}


def access_token(platform="stored-jwt", refresh="stored-refresh"):
    return VacademyAccessToken(
        token="vmcp-test", client_id="client-1", scopes=["vacademy.read"],
        expires_at=4_000_000_000, resource=None, subject="user-1", user_id="user-1",
        institute_id=INSTITUTE, token_hash="hash-1", pair_id="pair-1",
        platform_access_token=platform, platform_refresh_token=refresh,
    )


class Auth:
    """Scripted auth-service: each path answers with a Response or raises an httpx error; a list plays in order."""

    def __init__(self):
        self.user = httpx.Response(200, json={"username": "asha", "userId": "user-1", "roles": ["ADMIN"]})
        self.refresh = httpx.Response(200, json={"accessToken": "fresh-jwt"})
        self.calls = []

    def __call__(self, request):
        self.calls.append(request.url.path)
        answer = self.user if request.url.path == AUTH_USER_PATH else self.refresh
        if isinstance(answer, list):
            answer = answer.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return httpx.Response(answer.status_code, content=answer.content, headers=answer.headers)

    def count(self, path):
        return self.calls.count(path)


@pytest.fixture
def auth(monkeypatch):
    service = Auth()
    real_client = httpx.AsyncClient

    def client(**kwargs):
        kwargs.setdefault("transport", httpx.MockTransport(service))
        return real_client(**kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client)
    monkeypatch.setattr(security, "_decode_jwt_token", lambda token, settings: dict(CLAIMS))
    return service


@pytest.fixture
def mcp(monkeypatch, auth):
    """server.py handlers with a chosen session and token; a tool run fails the test unless allowed."""
    state = SimpleNamespace(db=FakeDb(raw=json.dumps(ENABLED)), token=access_token(), tool_runs=[])

    @contextmanager
    def session():
        yield state.db

    async def call_tool(**kwargs):
        state.tool_runs.append(kwargs["name"])
        return CallToolResult(content=[TextContent(type="text", text="ran")])

    FakeRepo.updates = []
    settings = SimpleNamespace(
        client_secret="secret", client_name="ai_service", auth_service_base_url="http://auth.test",
        mcp_issuer_url=ISSUER, resolve_mcp_encryption_key=lambda: "key",
    )
    monkeypatch.setattr(server, "db_session", session)
    monkeypatch.setattr(server, "_settings", lambda: settings)
    monkeypatch.setattr(server, "get_access_token", lambda: state.token)
    monkeypatch.setattr(server, "McpOAuthRepository", FakeRepo)
    monkeypatch.setattr(server, "TokenCipher", lambda key: None)
    monkeypatch.setattr(server, "_guide_grants", {})
    monkeypatch.setattr(adapter, "call_tool", call_tool)
    return state


async def call(state):
    result = await server._on_call_tool(None, SimpleNamespace(name="whoami", arguments={}))
    text = result.content[0].text
    assert bool(result.is_error) is (text != "ran")
    return text


def assert_retryable(text, code):
    body = json.loads(text)
    assert body["error"] == code
    assert 10 <= body["retry_after_s"] <= 30
    assert body["retryable"] is True and body["started"] is False and body["changed"] is False
    assert f"about {body['retry_after_s']} seconds" in body["message"]
    assert "not enabled" not in text.lower()
    return body


# ── the reader ───────────────────────────────────────────────────────────
@pytest.mark.parametrize("db_args", READ_FAILURES)
def test_raising_reader_raises_and_the_old_reader_still_returns_none(db_args):
    with pytest.raises(SettingReadError):
        read_institute_setting_data(FakeDb(**db_args), INSTITUTE, KEY)
    assert load_institute_setting_data(FakeDb(**db_args), INSTITUTE, KEY) is None


def test_raising_reader_rolls_back_only_after_a_failed_statement():
    failed = FakeDb(fail=RuntimeError("boom"))
    with pytest.raises(SettingReadError):
        read_institute_setting_data(failed, INSTITUTE, KEY)
    assert failed.rollbacks == 1

    garbled = FakeDb(raw="{not json")
    with pytest.raises(SettingReadError):
        read_institute_setting_data(garbled, INSTITUTE, KEY)
    assert garbled.rollbacks == 0


def test_raising_reader_survives_a_rollback_that_also_fails():
    class Dead(FakeDb):
        def rollback(self):
            raise RuntimeError("connection gone")

    with pytest.raises(SettingReadError):
        read_institute_setting_data(Dead(fail=RuntimeError("boom")), INSTITUTE, KEY)


def test_old_reader_leaves_the_callers_transaction_alone():
    db = FakeDb(fail=RuntimeError("boom"))
    assert load_institute_setting_data(db, INSTITUTE, KEY) is None
    assert db.rollbacks == 0


def test_old_reader_logs_the_same_lines(caplog):
    with caplog.at_level("WARNING", logger="app.services.institute_setting_reader"):
        load_institute_setting_data(FakeDb(fail=RuntimeError("boom")), INSTITUTE, KEY)
        load_institute_setting_data(FakeDb(raw="{not json"), INSTITUTE, KEY)
        load_institute_setting_data(FakeDb(raw=json.dumps([1])), INSTITUTE, KEY)
    messages = [r.getMessage() for r in caplog.records]
    assert len(messages) == 2
    assert messages[0].startswith(f"Could not read institutes.setting_json for {INSTITUTE}: boom")
    assert messages[1].startswith(f"institutes.setting_json for {INSTITUTE} is not valid JSON: ")


@pytest.mark.parametrize("raw", [
    None, "", json.dumps({}), json.dumps({"setting": {"OTHER": {"data": {"x": 1}}}}),
    json.dumps({"setting": {KEY: None}}),
], ids=["no-column", "blank", "empty", "other-key", "null-key"])
def test_raising_reader_returns_none_only_when_absent(raw):
    assert read_institute_setting_data(FakeDb(raw=raw), INSTITUTE, KEY) is None


def test_raising_reader_returns_none_for_a_missing_institute():
    db = FakeDb()
    db.execute = lambda stmt, params=None: SimpleNamespace(first=lambda: None)
    assert read_institute_setting_data(db, INSTITUTE, KEY) is None


def test_raising_reader_finds_both_shapes():
    data = {"enabled": True}
    assert read_institute_setting_data(FakeDb(raw=json.dumps({"setting": {KEY: {"data": data}}})), INSTITUTE, KEY) == data
    assert read_institute_setting_data(FakeDb(raw=json.dumps({KEY: {"data": data}})), INSTITUTE, KEY) == data
    assert read_institute_setting_data(FakeDb(raw={"setting": {KEY: data}}), INSTITUTE, KEY) == data


@pytest.mark.parametrize("db_args", READ_FAILURES)
def test_load_mcp_setting_propagates_a_failed_read(db_args):
    with pytest.raises(SettingReadError):
        load_mcp_setting(FakeDb(**db_args), INSTITUTE)


# ── tools/call and the listings: settings ────────────────────────────────
@pytest.mark.parametrize("db_args", READ_FAILURES)
async def test_unreadable_settings_give_settings_unavailable_and_run_nothing(mcp, db_args):
    mcp.db = FakeDb(**db_args)
    assert_retryable(await call(mcp), "settings_unavailable")
    assert mcp.tool_runs == []


async def test_saved_off_gives_mcp_disabled(mcp):
    mcp.db = FakeDb(raw=json.dumps({"setting": {KEY: {"data": {"enabled": False}}}}))
    assert await call(mcp) == DENIAL_MESSAGES[DENY_DISABLED]
    assert mcp.tool_runs == []


@pytest.mark.parametrize("raw", [None, json.dumps({"setting": {}})], ids=["no-column", "no-key"])
async def test_absent_key_gives_mcp_disabled(mcp, raw):
    mcp.db = FakeDb(raw=raw)
    assert await call(mcp) == DENIAL_MESSAGES[DENY_DISABLED]
    assert mcp.tool_runs == []


async def test_readable_settings_run_the_tool(mcp):
    assert await call(mcp) == "ran"
    assert mcp.tool_runs == ["whoami"]


async def test_tools_list_raises_for_unreadable_settings(mcp):
    mcp.db = FakeDb(fail=SaTimeoutError("QueuePool limit reached"))
    with pytest.raises(MCPError) as caught:
        await server._on_list_tools(None, None)
    assert caught.value.error.code == INTERNAL_ERROR
    assert_retryable(json.dumps(caught.value.error.data), "settings_unavailable")
    assert caught.value.error.message == caught.value.error.data["message"]


async def test_tools_list_is_empty_on_a_real_denial(mcp):
    mcp.db = FakeDb(raw=json.dumps({"setting": {KEY: {"data": {"enabled": False}}}}))
    assert (await server._on_list_tools(None, None)).tools == []

    mcp.db = FakeDb(raw=json.dumps({"setting": {KEY: {"data": {"enabled": True, "allowed_roles": ["TEACHER"]}}}}))
    assert (await server._on_list_tools(None, None)).tools == []
    assert await call(mcp) == DENIAL_MESSAGES[DENY_ROLE]


@pytest.mark.parametrize("handler", ["_on_list_prompts", "_on_list_resources", "_on_list_resource_templates"])
async def test_guide_listings_raise_for_unreadable_settings_and_stay_empty_on_denial(mcp, handler):
    mcp.db = FakeDb(raw="{not json")
    with pytest.raises(MCPError) as caught:
        await getattr(server, handler)(None, None)
    assert caught.value.error.code == INTERNAL_ERROR
    assert caught.value.error.data["error"] == "settings_unavailable"

    mcp.db = FakeDb(raw=json.dumps({"setting": {KEY: {"data": {"enabled": False}}}}))
    result = await getattr(server, handler)(None, None)
    assert not (getattr(result, "prompts", None) or getattr(result, "resources", None)
                or getattr(result, "resource_templates", None))


async def test_a_failed_guide_read_is_not_remembered_as_a_grant(mcp):
    mcp.db = FakeDb(raw="{not json")
    with pytest.raises(MCPError):
        await server._on_list_prompts(None, None)
    assert server._guide_grants == {}


# ── tools/call and the listings: auth-service ────────────────────────────
@pytest.mark.parametrize("answer", [
    httpx.ReadTimeout("slow"), httpx.ConnectError("refused"),
    httpx.Response(500), httpx.Response(502), httpx.Response(503), httpx.Response(504),
    httpx.Response(511, json={"ex": "could not open a connection"}),
], ids=["timeout", "refused", "500", "502", "503", "504", "511-other"])
async def test_auth_service_failure_gives_auth_unavailable_with_no_token_rewrite(mcp, auth, answer):
    auth.user = answer
    assert_retryable(await call(mcp), "auth_unavailable")
    assert "Do not reconnect" in json.loads(await call(mcp))["message"]
    assert mcp.tool_runs == [] and FakeRepo.updates == []
    assert auth.count(REFRESH_PATH) == 0


@pytest.mark.parametrize("answer", [httpx.ReadTimeout("slow"), httpx.Response(503)], ids=["timeout", "503"])
async def test_refresh_failure_after_a_401_gives_auth_unavailable(mcp, auth, answer):
    auth.user = httpx.Response(401)
    auth.refresh = answer
    assert_retryable(await call(mcp), "auth_unavailable")
    assert mcp.tool_runs == [] and FakeRepo.updates == []


@pytest.mark.parametrize("answer", [httpx.ReadTimeout("slow"), httpx.Response(500)], ids=["timeout", "500"])
async def test_refresh_failure_with_no_stored_jwt_gives_auth_unavailable(mcp, auth, answer):
    mcp.token = access_token(platform=None)
    auth.refresh = answer
    assert_retryable(await call(mcp), "auth_unavailable")
    assert FakeRepo.updates == []


async def test_verify_failure_after_a_good_refresh_gives_auth_unavailable(mcp, auth):
    auth.user = [httpx.Response(401), httpx.Response(503)]
    assert_retryable(await call(mcp), "auth_unavailable")
    assert mcp.tool_runs == []


@pytest.mark.parametrize("refresh", [httpx.Response(403, json={"ex": "expired"}), httpx.Response(200, text="not json"),
                                     httpx.Response(200, json={}), httpx.Response(200, json=["x"])],
                         ids=["403", "bad-body", "no-token", "list-body"])
@pytest.mark.parametrize("user", [httpx.Response(401), httpx.Response(403),
                                  httpx.Response(511, json={"ex": "could not found user..!!"})],
                         ids=["401", "403", "511-unknown-user"])
async def test_real_rejection_goes_refresh_then_session_invalid(mcp, auth, user, refresh):
    auth.user, auth.refresh = user, refresh
    text = await call(mcp)
    assert "Reconnect to continue" in text and "Vacademy rejected this connection's session" in text
    assert auth.count(REFRESH_PATH) == 1
    assert mcp.tool_runs == [] and FakeRepo.updates == []


async def test_refresh_recovers_a_rejected_session_and_stores_the_new_jwt(mcp, auth):
    auth.user = [httpx.Response(401), auth.user]
    assert await call(mcp) == "ran"
    assert FakeRepo.updates == [("hash-1", "fresh-jwt")]


async def test_no_stored_jwt_and_refused_refresh_gives_session_expired(mcp, auth):
    mcp.token = access_token(platform=None)
    auth.refresh = httpx.Response(403)
    assert "session has expired" in await call(mcp)


async def test_tools_list_raises_when_auth_service_cannot_answer(mcp, auth):
    auth.user = httpx.ReadTimeout("slow")
    with pytest.raises(MCPError) as caught:
        await server._on_list_tools(None, None)
    assert caught.value.error.code == INTERNAL_ERROR
    assert_retryable(json.dumps(caught.value.error.data), "auth_unavailable")


async def test_tools_list_is_empty_on_a_real_auth_rejection(mcp, auth):
    auth.user = httpx.Response(401)
    auth.refresh = httpx.Response(403)
    assert (await server._on_list_tools(None, None)).tools == []


async def test_wrong_resource_still_refused_after_auth(mcp, auth):
    mcp.token = access_token().model_copy(update={"resource": f"{ISSUER}/i/other-institute"})
    assert "different server URL" in await call(mcp)
    assert mcp.tool_runs == []


# ── on the wire, through the SDK ─────────────────────────────────────────
PROTOCOLS = ["2025-06-18", "2026-07-28"]


@pytest.fixture
def wire(mcp, monkeypatch):
    """POST to the real Streamable HTTP app. Only the token lookup and the session are replaced."""
    async def load(self, token):
        return mcp.token

    monkeypatch.setattr(VacademyOAuthProvider, "load_access_token", load)

    async def post(method, params, version):
        meta = {"io.modelcontextprotocol/protocolVersion": version,
                "io.modelcontextprotocol/clientCapabilities": {},
                "io.modelcontextprotocol/clientInfo": {"name": "test", "version": "1"}}
        headers = {**BEARER, "accept": "application/json, text/event-stream",
                   "mcp-protocol-version": version, "mcp-method": method}
        if method == "tools/call":
            headers["mcp-name"] = params["name"]
        body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": {**params, "_meta": meta}}
        mcp_server = server.build_mcp_server()
        app = server.build_mcp_asgi_app(server._settings(), mcp_server)
        async with mcp_server.session_manager.run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://mcp.test") as client:
                return await client.post("/", headers=headers, json=body)

    return post


@pytest.mark.parametrize("version", PROTOCOLS)
async def test_tools_list_on_the_wire_is_a_32603_with_the_reason(wire, mcp, version):
    mcp.db = FakeDb(fail=SaTimeoutError("QueuePool limit reached"))
    response = await wire("tools/list", {}, version)
    assert response.status_code == 200
    error = response.json()["error"]
    assert error["code"] == -32603
    assert_retryable(json.dumps(error["data"]), "settings_unavailable")


@pytest.mark.parametrize("version", PROTOCOLS)
async def test_tools_list_on_the_wire_is_empty_on_a_real_denial(wire, mcp, version):
    mcp.db = FakeDb(raw=json.dumps({"setting": {KEY: {"data": {"enabled": False}}}}))
    response = await wire("tools/list", {}, version)
    assert response.status_code == 200 and response.json()["result"]["tools"] == []


@pytest.mark.parametrize("version", PROTOCOLS)
async def test_tools_call_on_the_wire_is_is_error_json(wire, mcp, auth, version):
    auth.user = httpx.ReadTimeout("slow")
    response = await wire("tools/call", {"name": "whoami", "arguments": {}}, version)
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["isError"] is True
    assert_retryable(result["content"][0]["text"], "auth_unavailable")
    assert mcp.tool_runs == []


async def test_a_failed_listing_does_not_block_a_modern_tools_call(wire, mcp, auth):
    """The SDK lists tools first to check Mcp-Param headers, and carries on when that listing fails."""
    auth.user = [httpx.ReadTimeout("slow"), auth.user]
    response = await wire("tools/call", {"name": "whoami", "arguments": {"detail": "short"}}, "2026-07-28")
    assert response.status_code == 200
    assert response.json()["result"]["content"][0]["text"] == "ran"
    assert auth.count(AUTH_USER_PATH) == 2 and mcp.tool_runs == ["whoami"]


# ── callers outside MCP ──────────────────────────────────────────────────
class _Request:
    def __init__(self):
        self.headers = {"authorization": "Bearer platform-jwt", "clientId": INSTITUTE}


@pytest.mark.parametrize("answer", [httpx.ReadTimeout("slow"), httpx.Response(503)], ids=["timeout", "503"])
async def test_default_verify_still_returns_none_when_auth_service_fails(auth, answer):
    auth.user = answer
    settings = SimpleNamespace(client_secret="secret", client_name="ai_service", auth_service_base_url="http://auth.test")
    assert await security._verify_and_fetch_user("Bearer t", INSTITUTE, settings) is None
    with pytest.raises(HTTPException) as caught:
        await security.resolve_pinned_principal(token="t", client_id=INSTITUTE, settings=settings)
    assert caught.value.status_code == 401


@pytest.mark.parametrize("answer", [httpx.ReadTimeout("slow"), httpx.Response(503)], ids=["timeout", "503"])
async def test_get_pinned_principal_still_answers_401(auth, answer):
    auth.user = answer
    settings = SimpleNamespace(client_secret="secret", client_name="ai_service", auth_service_base_url="http://auth.test")
    with pytest.raises(HTTPException) as caught:
        await security.get_pinned_principal(_Request(), "Bearer platform-jwt", settings)
    assert caught.value.status_code == 401


@pytest.mark.parametrize("answer", [httpx.ReadTimeout("slow"), httpx.Response(503)], ids=["timeout", "503"])
async def test_site_assistant_staff_check_still_answers_401(auth, monkeypatch, answer):
    from app.site_assistant import service as site_assistant

    auth.user = answer
    import app.config as config
    monkeypatch.setattr(config, "get_settings", lambda: SimpleNamespace(
        client_secret="secret", client_name="ai_service", auth_service_base_url="http://auth.test"))
    with pytest.raises(HTTPException) as caught:
        await site_assistant.staff_from_request(_Request())
    assert caught.value.status_code == 401


@pytest.mark.parametrize("answer", [httpx.ReadTimeout("slow"), httpx.Response(503)], ids=["timeout", "503"])
async def test_course_knowledge_staff_check_still_answers_401(auth, monkeypatch, answer):
    from app.services.course_knowledge import auth as ck_auth

    auth.user = answer
    monkeypatch.setattr(ck_auth, "get_settings", lambda: SimpleNamespace(
        client_secret="secret", client_name="ai_service", auth_service_base_url="http://auth.test"))
    with pytest.raises(HTTPException) as caught:
        await ck_auth.ck_staff(_Request())
    assert caught.value.status_code == 401


# ── consent ──────────────────────────────────────────────────────────────
def staff():
    return PinnedPrincipal(user_id="user-1", institute_id=INSTITUTE, roles=["ADMIN"], permissions=[], is_root_user=False)


@pytest.mark.parametrize("db_args", READ_FAILURES)
def test_consent_gate_gives_503_for_unreadable_settings(db_args):
    with pytest.raises(HTTPException) as caught:
        consent._require_can_connect(staff(), FakeDb(**db_args))
    assert caught.value.status_code == 503
    assert caught.value.detail["reason"] == "settings_unavailable"
    assert "not enabled" not in caught.value.detail["message"].lower()


def test_consent_gate_gives_403_for_a_saved_off():
    with pytest.raises(HTTPException) as caught:
        consent._require_can_connect(staff(), FakeDb(raw=json.dumps({"setting": {KEY: {"data": {"enabled": False}}}})))
    assert caught.value.status_code == 403 and caught.value.detail["reason"] == DENY_DISABLED


async def test_consent_503_leaves_the_request_pending(monkeypatch):
    consumed = []

    class Repo:
        def get_txn(self, txn):
            return {"consumed_at": None, "state": None, "redirect_uri": "https://app.test/cb", "resource": None}

        def consume_txn(self, txn):
            consumed.append(txn)
            return True

    monkeypatch.setattr(consent, "_repo", lambda db, settings: Repo())
    with pytest.raises(HTTPException) as caught:
        await consent.consent(
            SimpleNamespace(headers={"authorization": "Bearer j"}),
            consent.ConsentRequest(txn="t-1", approve=True),
            principal=staff(), db=FakeDb(fail=RuntimeError("boom")), settings=SimpleNamespace(mcp_issuer_url=ISSUER),
        )
    assert caught.value.status_code == 503 and consumed == []


# ── the payload ──────────────────────────────────────────────────────────
def test_retry_payload_shape_and_range():
    seen = set()
    for _ in range(200):
        body = retry_payload("x", "Retry in about {n} seconds.", 10, 30, limit=3)
        assert 10 <= body["retry_after_s"] <= 30
        assert body["message"] == f"Retry in about {body['retry_after_s']} seconds."
        assert (body["error"], body["retryable"], body["started"], body["changed"], body["limit"]) == ("x", True, False, False, 3)
        seen.add(body["retry_after_s"])
    assert len(seen) > 1


# ── CRM admin gates ──────────────────────────────────────────────────────
@pytest.fixture
def backend(monkeypatch):
    be = CrmBackend().install(monkeypatch)
    be.admin_core.on("GET", cd.LEAD_SCOPE_PATH, cd.cbd.err("admin_core_unreachable", message=""))
    return be


async def test_require_admin_says_scope_unavailable_for_a_real_admin(backend):
    assert (await cd.require_admin(make_ctx()))["error"] == "scope_unavailable"


async def test_require_admin_still_refuses_a_non_admin_with_a_known_scope(backend):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    assert (await cd.require_admin(make_ctx("c-1", ("COUNSELLOR",))))["error"] == "admin_only"
    backend.lead_scope("ADMIN")
    assert await cd.require_admin(make_ctx()) is None


async def test_crm_reports_says_scope_unavailable_on_an_admin_report(backend):
    out = json.loads(await reports.execute_crm_reports({"action": "revenue"}, make_ctx()))
    assert out["error"] == "scope_unavailable"
    assert backend.sql.calls == []


async def test_crm_reports_still_refuses_a_non_admin_with_a_known_scope(backend):
    backend.lead_scope("COUNSELLOR_TREE", owner_ids=["c-1"])
    out = json.loads(await reports.execute_crm_reports({"action": "revenue"}, make_ctx("c-1", ("COUNSELLOR",))))
    assert out["error"] == "admin_only"


async def test_crm_leads_says_scope_unavailable_on_an_admin_action(backend, monkeypatch):
    monkeypatch.setitem(leads.ACTION_SPEC, "list", {**leads.ACTION_SPEC["list"], "admin_only": True})
    out = json.loads(await leads.execute_crm_leads({"action": "list", "filter": {}}, make_ctx()))
    assert out["error"] == "scope_unavailable"


async def test_crm_leads_list_says_scope_unavailable_for_a_real_admin(backend):
    out = json.loads(await leads.execute_crm_leads({"action": "list", "filter": {}}, make_ctx()))
    assert out["error"] == "scope_unavailable"


async def test_crm_leads_catalog_still_answers_without_a_scope(backend):
    backend.counsellors({})
    out = json.loads(await leads.execute_crm_leads({"action": "catalog"}, make_ctx()))
    assert out["lists"]["error"] == "scope_unavailable" and out["my_scope"]["mode"] == "UNAVAILABLE"


# ── confirm tokens ───────────────────────────────────────────────────────
PURPOSE = "crm.crm_lead_edit.set_status"
REQ = {"lead_id": "r-1"}


@pytest.fixture
def tctx():
    return make_ctx(db=confirm_db())


def test_confirm_token_used_carries_the_timeout_advice(tctx):
    token = cd.issue_once(tctx, PURPOSE, REQ, {})
    assert cd.spend_once(tctx, PURPOSE, REQ, token)[1] is None
    _, refusal = cd.spend_once(tctx, PURPOSE, REQ, token)
    assert refusal["error"] == "confirm_token_used"
    assert refusal["message"] == (
        "That confirm_token was already used, or a newer preview replaced it. If an earlier call timed out it may "
        "have completed, so check the result with a read before repeating. Otherwise call again without "
        "confirm_token to preview."
    )


def test_hourly_cap_says_which_limit_and_keeps_the_token(tctx, monkeypatch):
    token = cd.issue_once(tctx, PURPOSE, REQ, {})
    monkeypatch.setattr(cd, "cap_for", lambda purpose: 1)
    monkeypatch.setattr(cd, "hourly_count", lambda ctx, purpose: 1)
    monkeypatch.setattr(cd, "_lock", lambda ctx, purpose: None)
    monkeypatch.setattr(cd, "_retry_after", lambda ctx, purpose: 120)
    _, refusal = cd.spend_once(tctx, PURPOSE, REQ, token)
    assert refusal["error"] == "rate_limited" and refusal["limit_type"] == "hourly"
    assert refusal["cap_per_hour"] == 1 and refusal["retry_after_s"] == 120
    monkeypatch.setattr(cd, "hourly_count", lambda ctx, purpose: 0)
    assert cd.spend_once(tctx, PURPOSE, REQ, token)[1] is None
