"""Offline tests for POST /ai-service/internal/llm/v1/chat/completions — the
bridge admin_core's LlmGatewayRouter uses for models routed to "anthropic".

Covers: the X-Internal-Service-Token guard, metadata (institute_id, user_id,
use_case) and streaming keys stripped before anything goes upstream, the
registry id + `router` on the reply, upstream non-2xx passed through with an
OpenAI-style error body, a transport failure as a 502, and one end-to-end run
through the real router (anthropic route -> translated reply). No network.
"""
from __future__ import annotations

import functools
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENROUTER_API_KEY", "or-platform")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from ai_service.app.config import get_settings  # noqa: E402
from ai_service.app.routers import internal_llm  # noqa: E402
from ai_service.app.services import llm_router  # noqa: E402
from ai_service.app.services.llm_providers import key_pool  # noqa: E402

URL = "/ai-service/internal/llm/v1/chat/completions"
TOKEN = {"X-Internal-Service-Token": "svc-secret"}
SONNET = "anthropic/claude-sonnet-4.5"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(get_settings(), "internal_service_token", "svc-secret")
    monkeypatch.setattr(get_settings(), "openrouter_api_key", "or-platform")
    app = FastAPI()
    app.include_router(internal_llm.router, prefix="/ai-service")
    return TestClient(app)


def _fake_post_chat(monkeypatch, response):
    seen = {}

    async def fake(client, payload, api_key=None, **kwargs):
        seen["payload"], seen["api_key"] = payload, api_key
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(llm_router, "post_chat", fake)
    return seen


def _resp(status, body, url="https://api.anthropic.com/v1/messages"):
    return httpx.Response(status, json=body, request=httpx.Request("POST", url))


def test_token_is_required(client):
    body = {"model": SONNET, "messages": [{"role": "user", "content": "hi"}]}
    assert client.post(URL, json=body).status_code == 401
    assert client.post(URL, json=body, headers={"X-Internal-Service-Token": "wrong"}).status_code == 401


def test_metadata_is_stripped_and_reply_carries_registry_id_and_router(client, monkeypatch):
    seen = _fake_post_chat(monkeypatch, _resp(200, {
        "model": "claude-sonnet-4-5", "choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4}}))
    body = {"model": SONNET, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 64,
            "temperature": 0.1, "tools": [{"type": "function", "function": {"name": "f", "parameters": {}}}],
            "tool_choice": "auto", "response_format": {"type": "json_object"},
            "institute_id": "inst-1", "user_id": "u-1", "use_case": "crm_agent",
            "stream": True, "stream_options": {"include_usage": True}}
    r = client.post(URL, json=body, headers=TOKEN)
    assert r.status_code == 200
    sent = seen["payload"]
    for k in ("institute_id", "user_id", "use_case", "stream", "stream_options"):
        assert k not in sent
    assert sent["model"] == SONNET and sent["tools"] and sent["tool_choice"] == "auto"
    assert sent["max_tokens"] == 64 and sent["response_format"] == {"type": "json_object"}
    assert seen["api_key"] is None, "the platform key, never a caller-supplied one"
    data = r.json()
    assert data["model"] == SONNET and data["router"] == "anthropic"
    assert data["usage"]["total_tokens"] == 4


@pytest.mark.parametrize("status", [400, 429, 503])
def test_upstream_status_passes_through(client, monkeypatch, status):
    _fake_post_chat(monkeypatch, _resp(status, {"error": {"message": "nope", "type": "x", "code": status}},
                                       url="https://openrouter.ai/api/v1/chat/completions"))
    r = client.post(URL, json={"model": SONNET, "messages": [{"role": "user", "content": "hi"}]}, headers=TOKEN)
    assert r.status_code == status
    assert r.json()["error"]["message"] == "nope" and r.json()["router"] == "openrouter"


def test_non_json_upstream_error_gets_an_openai_error_body(client, monkeypatch):
    _fake_post_chat(monkeypatch, httpx.Response(502, text="<html>bad gateway</html>",
                                                request=httpx.Request("POST", "https://openrouter.ai/x")))
    r = client.post(URL, json={"model": SONNET, "messages": [{"role": "user", "content": "x"}]}, headers=TOKEN)
    assert r.status_code == 502
    err = r.json()["error"]
    assert err["code"] == 502 and "bad gateway" in err["message"]


def test_transport_failure_is_a_502(client, monkeypatch):
    _fake_post_chat(monkeypatch, httpx.ConnectError("refused"))
    r = client.post(URL, json={"model": SONNET, "messages": [{"role": "user", "content": "x"}]}, headers=TOKEN)
    assert r.status_code == 502 and r.json()["error"]["code"] == 502


def test_bad_bodies_are_422(client):
    assert client.post(URL, json={"messages": [{"role": "user", "content": "x"}]}, headers=TOKEN).status_code == 422
    assert client.post(URL, json={"model": SONNET, "messages": []}, headers=TOKEN).status_code == 422


def test_end_to_end_through_the_anthropic_route(client, monkeypatch):
    key_pool._reset_for_tests()
    llm_router._FAILED_UNTIL.clear()
    monkeypatch.setattr(llm_router, "model_routes", lambda: llm_router.parse_routes({SONNET: "anthropic"}))
    monkeypatch.setattr(key_pool, "_load_from_db", lambda p: [key_pool.PoolKey(
        id="k1", provider="anthropic", label="k1", org_label=None, key_hint="…k1", api_key="sk-ant-k1")])
    monkeypatch.setattr(key_pool, "_submit", lambda fn, *a: None)
    monkeypatch.setattr(key_pool, "_price", lambda m: (3.0, 15.0))
    calls = []

    def handler(request):
        calls.append((str(request.url), json.loads(request.content)))
        return httpx.Response(200, json={"id": "msg", "content": [{"type": "text", "text": "bridged"}],
                                         "stop_reason": "end_turn", "usage": {"input_tokens": 4, "output_tokens": 2}})

    real_async_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient",
                        functools.partial(real_async_client, transport=httpx.MockTransport(handler)))
    r = client.post(URL, json={"model": SONNET, "institute_id": "inst-1",
                               "messages": [{"role": "user", "content": "hi"}]}, headers=TOKEN)
    assert r.status_code == 200, r.text
    assert calls[0][0] == "https://api.anthropic.com/v1/messages"
    assert "institute_id" not in json.dumps(calls[0][1])
    data = r.json()
    assert data["router"] == "anthropic" and data["model"] == SONNET
    assert data["choices"][0]["message"]["content"] == "bridged"
    key_pool._reset_for_tests()
