"""
The read-only demo user in ai_service (app/core/demo_read_only.py).

Pinned here: who counts as the demo user (the role under any institute in the token,
root or not), what that user may do (reads pass, every write is refused, the GETs that
call a model or synthesise speech are refused), the exact 403 body shared with the
Java services, that the middleware and the auth dependencies both apply it, that web
sockets and the MCP token replay refuse the demo user outright, and that a user
without the role sees no change at all.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import time
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import Depends, FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from jose import jwt  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.core import demo_read_only as gate  # noqa: E402
from app.core import security  # noqa: E402

BODY = b'{"code":"DEMO_READ_ONLY","message":"This is a demo. Changes are not saved."}'
DEMO_INSTITUTE = "inst-demo"


def _key() -> bytes:
    secret = get_settings().jwt_secret_key
    return base64.b64decode(secret + "=" * (-len(secret) % 4))


def _token(roles_by_institute, root=False, signed=True, **extra) -> str:
    claims = {
        "sub": "demo@example.com",
        "user": "u-demo",
        "is_root_user": root,
        "exp": int(time.time()) + 600,
        "authorities": {
            institute: {"roles": list(roles), "permissions": []}
            for institute, roles in roles_by_institute.items()
        },
        **extra,
    }
    return jwt.encode(claims, _key() if signed else b"x" * 32, algorithm="HS256")


DEMO = _token({DEMO_INSTITUTE: ["ADMIN", "DEMO_READ_ONLY"]})
DEMO_ROOT = _token({DEMO_INSTITUTE: ["ADMIN", "DEMO_READ_ONLY"]}, root=True)
ADMIN = _token({"inst-1": ["ADMIN"]})
ADMIN_ROOT = _token({"inst-1": ["ADMIN"]}, root=True)


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


# ── who is the demo user ────────────────────────────────────────────────────

def test_role_under_any_institute_marks_the_demo_user():
    assert gate.token_holds_role(DEMO)
    assert gate.token_holds_role(DEMO_ROOT)
    assert gate.token_holds_role(_token({"inst-1": ["ADMIN"], DEMO_INSTITUTE: ["demo-read-only"]}))
    assert gate.authorization_holds_role(f"Bearer {DEMO}")
    assert gate.authorization_holds_role(f"bearer {DEMO}")
    assert gate.claims_hold_role({"authorities": {"i": {"roles": ["Demo Read Only"]}}})


def test_users_without_the_role_are_not_the_demo_user():
    assert not gate.token_holds_role(ADMIN)
    assert not gate.token_holds_role(ADMIN_ROOT)
    assert not gate.token_holds_role(_token({"inst-1": ["DEMO_READ_ONLY_EXTRA", "NOT_DEMO_READ_ONLY"]}))
    assert not gate.token_holds_role(_token({}))
    for junk in (None, "", "undefined", "a.b", "a.b.c", "a.!!!.c", 12345):
        assert not gate.token_holds_role(junk)
    assert not gate.authorization_holds_role(None)
    assert not gate.authorization_holds_role(DEMO)  # no Bearer prefix: not a credential here
    assert not gate.authorization_holds_role("Basic abc")
    # claims of other shapes (site assistant / demo guide visitor tokens carry no authorities)
    assert not gate.claims_hold_role({"sid": "s", "product": "vacademy", "vid": "v"})
    assert not gate.claims_hold_role({"authorities": ["DEMO_READ_ONLY"]})
    assert not gate.claims_hold_role({"authorities": {"i": "DEMO_READ_ONLY"}})
    assert not gate.claims_hold_role({"authorities": {"i": {"permissions": ["DEMO_READ_ONLY"]}}})
    assert not gate.claims_hold_role(None)


def test_a_forged_token_naming_the_role_is_treated_as_the_demo_user():
    # Unsigned claims are enough to refuse (never enough to allow anything).
    assert gate.token_holds_role(_token({DEMO_INSTITUTE: ["DEMO_READ_ONLY"]}, signed=False))


# ── the decision ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE", "TRACE", "", None, "post"])
def test_every_write_is_refused(method):
    for path in (
        "/ai-service/assistant/session/init",
        "/ai-service/institute/api-keys/inst-demo",
        "/ai-service/mcp/oauth/txn/abc/decision",
        "/ai-service/credits/v1/check",
        "/ai-service/video/generate",
        "/somewhere/else",
    ):
        assert gate.is_refused(method, path)


def test_reads_pass():
    for method in ("GET", "HEAD", "OPTIONS", "get"):
        assert not gate.is_refused(method, "/ai-service/credits/v1/institutes/inst-demo/balance")
        assert not gate.is_refused(method, "/ai-service/assistant/sessions")
    assert not gate.is_refused("OPTIONS", "/ai-service/assistant/session/init")
    assert not gate.is_refused("GET", "/ai-service/ai/chat-with-pdf/get-chat")
    assert not gate.is_refused("GET", "/ai-service/chat-agent/sessions")


@pytest.mark.parametrize("path", [
    "/ai-service/ai/lecture/generate-plan",
    "/ai-service/ai/lecture/generate-feedback",
    "/ai-service/ai/get-question-pdf/math-parser/pdf-to-questions",
    "/ai-service/ai/get-question-pdf/math-parser/topic-wise/pdf-to-questions",
    "/ai-service/ai/get-question-audio/audio-parser/audio-to-questions",
    "/ai-service/ai/chat-with-pdf/get-response",
    "/ai-service/tts/v1/speak",
    "/ai-service/assistant/session/s-1/stream",
    "/ai-service/chat-agent/session/s-1/stream",
    "/ai-service/chat-agent/session/s-1/updates",
])
def test_gets_that_spend_or_stream_are_refused(path):
    assert gate.is_refused("GET", path)
    assert gate.is_refused("HEAD", path)
    # dressed up
    assert gate.is_refused("GET", path + "/")
    assert gate.is_refused("GET", path.replace("/ai-service/", "/ai-service//"))
    assert gate.is_refused("GET", path + ";x=1")
    # without the service prefix (a proxy that strips it)
    assert gate.is_refused("GET", path[len("/ai-service"):])


def test_unreadable_paths_are_refused_rather_than_waved_through():
    assert gate.is_refused("GET", None)
    assert gate.is_refused("GET", "ai-service/assistant/sessions")
    assert gate.is_refused("GET", "/ai-service/x/../tts/v1/speak")
    assert gate.is_refused("GET", "/ai-service/tts%2Fv1/speak")


def test_no_post_is_on_the_allow_list_today():
    assert gate.READS == []


# ── the middleware, on a small app ──────────────────────────────────────────

def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(gate.DemoReadOnlyMiddleware, base_path="/ai-service")
    app.add_exception_handler(gate.DemoReadOnlyRefused, gate.refused_handler)
    app.add_middleware(CORSMiddleware, allow_origin_regex=".*", allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])
    hits = []
    app.state.hits = hits

    @app.get("/ai-service/things")
    def list_things():
        hits.append("GET things")
        return {"ok": True}

    @app.post("/ai-service/things")
    def make_thing():
        hits.append("POST things")
        return {"ok": True}

    @app.delete("/ai-service/things/{thing_id}")
    def drop_thing(thing_id: str):
        hits.append("DELETE things")
        return {"ok": True}

    @app.get("/ai-service/tts/v1/speak")
    def speak():
        hits.append("GET speak")
        return {"ok": True}

    return app


def _assert_refused(response):
    assert response.status_code == 403
    assert response.content == BODY
    assert response.headers["content-type"] == "application/json"
    assert response.content == gate.REFUSAL_BODY


def test_middleware_refuses_demo_writes_before_the_route_runs():
    app = _app()
    client = TestClient(app)
    for token in (DEMO, DEMO_ROOT):
        _assert_refused(client.post("/ai-service/things", headers=_bearer(token)))
        _assert_refused(client.delete("/ai-service/things/1", headers=_bearer(token)))
        _assert_refused(client.get("/ai-service/tts/v1/speak", headers=_bearer(token)))
        # another institute, or none, in the header changes nothing
        _assert_refused(client.post("/ai-service/things", headers={**_bearer(token), "clientId": "inst-other"}))
    assert app.state.hits == []


def test_middleware_lets_demo_reads_through():
    app = _app()
    client = TestClient(app)
    assert client.get("/ai-service/things", headers=_bearer(DEMO)).json() == {"ok": True}
    assert app.state.hits == ["GET things"]


def test_refusal_carries_cors_headers_so_the_browser_can_read_it():
    client = TestClient(_app())
    response = client.post("/ai-service/things", headers={**_bearer(DEMO), "Origin": "https://demo-app.vacademy.io"})
    _assert_refused(response)
    assert response.headers["access-control-allow-origin"] == "https://demo-app.vacademy.io"


def test_users_without_the_role_see_no_change():
    app = _app()
    client = TestClient(app)
    for headers in (_bearer(ADMIN), _bearer(ADMIN_ROOT), {}, {"Authorization": "Bearer undefined"},
                    {"Authorization": "Basic abc"}):
        assert client.get("/ai-service/things", headers=headers).status_code == 200
        assert client.post("/ai-service/things", headers=headers).status_code == 200
        assert client.delete("/ai-service/things/1", headers=headers).status_code == 200
        assert client.get("/ai-service/tts/v1/speak", headers=headers).status_code == 200
    assert len(app.state.hits) == 20


# ── the auth dependencies ───────────────────────────────────────────────────

def _request(method, path):
    return SimpleNamespace(method=method, url=SimpleNamespace(path=path), headers={"clientId": DEMO_INSTITUTE})


def test_auth_dependencies_refuse_the_demo_user_on_a_write():
    request = _request("POST", "/ai-service/assistant/session/init")
    settings = get_settings()
    for dependency in (security.get_current_user, security.get_optional_user, security.get_pinned_principal):
        with pytest.raises(gate.DemoReadOnlyRefused):
            asyncio.run(dependency(request, authorization=f"Bearer {DEMO_ROOT}", settings=settings))


def test_auth_dependencies_do_not_refuse_the_demo_user_on_a_read(monkeypatch):
    seen = []

    async def fake_verify(auth_header, client_id, settings, **kwargs):
        seen.append(client_id)
        return security.CustomUserDetails(username="demo@example.com", user_id="u-demo", is_root_user=True)

    monkeypatch.setattr(security, "_verify_and_fetch_user", fake_verify)
    request = _request("GET", "/ai-service/assistant/sessions")
    settings = get_settings()
    user = asyncio.run(security.get_current_user(request, authorization=f"Bearer {DEMO}", settings=settings))
    assert user.user_id == "u-demo"
    principal = asyncio.run(security.get_pinned_principal(request, authorization=f"Bearer {DEMO}", settings=settings))
    assert principal.institute_id == DEMO_INSTITUTE
    assert "DEMO_READ_ONLY" in principal.roles and "ADMIN" in principal.roles
    assert seen == [DEMO_INSTITUTE, DEMO_INSTITUTE]


def test_auth_dependencies_leave_other_users_alone(monkeypatch):
    async def fake_verify(auth_header, client_id, settings, **kwargs):
        return security.CustomUserDetails(username="a@example.com", user_id="u-1")

    monkeypatch.setattr(security, "_verify_and_fetch_user", fake_verify)
    request = SimpleNamespace(method="POST", url=SimpleNamespace(path="/ai-service/assistant/session/init"),
                              headers={"clientId": "inst-1"})
    settings = get_settings()
    user = asyncio.run(security.get_current_user(request, authorization=f"Bearer {ADMIN}", settings=settings))
    assert user.user_id == "u-1"
    principal = asyncio.run(security.get_pinned_principal(request, authorization=f"Bearer {ADMIN}", settings=settings))
    assert principal.roles == ["ADMIN"]


def test_dependency_refusal_becomes_the_same_403_without_the_middleware():
    app = FastAPI()
    app.add_exception_handler(gate.DemoReadOnlyRefused, gate.refused_handler)

    @app.post("/ai-service/secured")
    async def secured(user=Depends(security.get_current_user)):
        raise HTTPException(status_code=500, detail="must not run")

    _assert_refused(TestClient(app).post("/ai-service/secured", headers=_bearer(DEMO)))


# ── callers with no HTTP request to judge ───────────────────────────────────

def test_socket_token_check_refuses_the_demo_user():
    assert security.decode_access_token(DEMO) is None
    assert security.decode_access_token(DEMO_ROOT) is None
    claims = security.decode_access_token(ADMIN)
    assert claims is not None and claims["user"] == "u-demo"


def test_mcp_token_replay_refuses_the_demo_user(monkeypatch):
    from app.mcp import principal as mcp_principal

    called = []

    async def fake_resolve(**kwargs):
        called.append(kwargs["client_id"])
        return "principal"

    monkeypatch.setattr(mcp_principal, "resolve_pinned_principal", fake_resolve)
    settings = get_settings()
    with pytest.raises(HTTPException) as refused:
        asyncio.run(mcp_principal.build_pinned_principal(DEMO, DEMO_INSTITUTE, settings))
    assert refused.value.status_code == 403
    assert called == []
    assert asyncio.run(mcp_principal.build_pinned_principal(ADMIN, "inst-1", settings)) == "principal"
    assert called == ["inst-1"]


# ── the real app wires it in ────────────────────────────────────────────────

def test_real_app_has_the_middleware_inside_cors_and_the_handler():
    try:
        import boto3  # noqa: F401
    except ImportError:  # pragma: no cover - depends on the test venv
        pytest.skip("app_factory needs boto3")
    from app.app_factory import create_app

    app = create_app()
    names = [m.cls.__name__ for m in app.user_middleware]
    assert "DemoReadOnlyMiddleware" in names
    # user_middleware is outermost first: CORS must wrap the gate.
    assert names.index("CORSMiddleware") < names.index("DemoReadOnlyMiddleware")
    assert gate.DemoReadOnlyRefused in app.exception_handlers

    client = TestClient(app)
    _assert_refused(client.post("/ai-service/assistant/session/init", headers=_bearer(DEMO), json={}))
    _assert_refused(client.delete("/ai-service/institute/api-keys/inst-demo/k-1", headers=_bearer(DEMO)))
    _assert_refused(client.post("/ai-service/institute/api-keys/inst-demo", headers=_bearer(DEMO), json={}))
    _assert_refused(client.get("/ai-service/tts/v1/speak?text=hello", headers=_bearer(DEMO)))
    _assert_refused(client.post("/ai-service/no/such/route", headers=_bearer(DEMO)))
    # Reads still reach the app, and other users are not touched by the gate.
    assert client.get("/ai-service/health/ping", headers=_bearer(DEMO)).status_code == 200
    assert client.post("/ai-service/no/such/route", headers=_bearer(ADMIN)).status_code == 404
