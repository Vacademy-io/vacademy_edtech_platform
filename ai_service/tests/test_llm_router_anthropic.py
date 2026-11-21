"""Offline tests for the direct-Anthropic route in services/llm_router.py.

Covers:
  - "anthropic" in the route map (string / dict entries, derived wire id), and
    one bad entry skipped at runtime instead of dropping the whole map
  - only callers that send through the router's helpers get the anthropic
    route (raw route_chat stays on OpenRouter), and no key / a BYO key / a
    cooling gateway keeps OpenRouter
  - post_chat / post_chat_sync / open_chat_stream / chat_with_chain /
    ChatLLMClient translate to the Messages API and back (text, tool calls,
    SSE), report the registry id and router "anthropic", meter the key
  - key walk on a key's refusal, OpenRouter failover on 5xx / 529 / 404 / 400,
    and the gateway cooldown only on vendor-side failures
  - saving a route map probes an anthropic entry through the pool

No network, no database.
"""
from __future__ import annotations

import asyncio
import functools
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENROUTER_API_KEY", "or-platform")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import httpx  # noqa: E402
import pytest  # noqa: E402

from ai_service.app.config import get_settings  # noqa: E402
from ai_service.app.services import llm_router  # noqa: E402
from ai_service.app.services.chat_llm_client import ChatLLMClient, is_model_broken  # noqa: E402
from ai_service.app.services.llm_providers import key_pool  # noqa: E402

SONNET = "anthropic/claude-sonnet-4.5"
ROUTES = {SONNET: "anthropic", "z-ai/glm-5.3-flash": "isoquant"}
MESSAGES_URL = "https://api.anthropic.com/v1/messages"
# Other test modules replace llm_router.model_routes for good; keep the real one.
_REAL_MODEL_ROUTES = llm_router.model_routes


def _key(kid, org=None):
    return key_pool.PoolKey(id=kid, provider="anthropic", label=kid, org_label=org, key_hint="…" + kid[-4:],
                            api_key=f"sk-ant-{kid}", monthly_budget_usd=200, soft_limit_pct=95, weight=1)


@pytest.fixture
def env(monkeypatch):
    """Route map with an anthropic entry, two pool keys, captured background writes."""
    key_pool._reset_for_tests()
    llm_router._FAILED_UNTIL.clear()
    state = {"keys": [_key("key-1"), _key("key-2")], "writes": []}
    monkeypatch.setattr(llm_router, "model_routes", lambda: llm_router.parse_routes(state.get("routes", ROUTES)))
    monkeypatch.setattr(key_pool, "_load_from_db", lambda provider: list(state["keys"]))
    monkeypatch.setattr(key_pool, "_submit", lambda fn, *args: state["writes"].append((fn.__name__, args)))
    monkeypatch.setattr(key_pool, "_price", lambda model: (3.0, 15.0))
    monkeypatch.setattr(get_settings(), "openrouter_api_key", "or-platform")
    yield state
    key_pool._reset_for_tests()
    llm_router._FAILED_UNTIL.clear()


def _message(text="hello", **extra):
    body = {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-sonnet-4-5",
            "content": [{"type": "text", "text": text}], "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 100,
                      "cache_creation_input_tokens": 0}}
    body.update(extra)
    return body


def _openrouter_completion(content="from openrouter"):
    return {"model": SONNET, "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4}}


def _sse(*events):
    out = ""
    for name, data in events:
        out += f"event: {name}\ndata: {json.dumps(data)}\n\n"
    return out.encode()


STREAM = _sse(
    ("message_start", {"type": "message_start", "message": {"id": "msg_s", "usage": {"input_tokens": 7, "output_tokens": 1}}}),
    ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
    ("ping", {"type": "ping"}),
    ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "he"}}),
    ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "y"}}),
    ("content_block_stop", {"type": "content_block_stop", "index": 0}),
    ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 2}}),
    ("message_stop", {"type": "message_stop"}),
)


def _transport(handler):
    calls = []

    def wrapped(request: httpx.Request):
        calls.append((str(request.url), json.loads(request.content or b"{}"), dict(request.headers)))
        return handler(request)

    return httpx.MockTransport(wrapped), calls


def _is_anthropic(request):
    return str(request.url).startswith(MESSAGES_URL)


# ── route map ───────────────────────────────────────────────────────────────

def test_route_map_accepts_anthropic():
    routes = llm_router.parse_routes({SONNET: "anthropic",
                                      "anthropic/claude-opus-5.5": {"router": "anthropic", "model": "claude-opus-5-5"}})
    assert routes[SONNET]["router"] == "anthropic" and routes[SONNET]["model"] is None
    assert routes["anthropic/claude-opus-5.5"]["model"] == "claude-opus-5-5"
    assert llm_router.anthropic_wire_model(SONNET) == "claude-sonnet-4-5"
    assert llm_router.anthropic_wire_model("anthropic/claude-haiku-4.5:beta") == "claude-haiku-4-5"


def test_one_bad_entry_is_skipped_at_runtime_but_refused_at_save(monkeypatch):
    from ai_service.app.services import platform_settings_service as pss

    raw = {"z-ai/glm-5.3-flash": "isoquant", "m": "nope", SONNET: "anthropic"}
    monkeypatch.setattr(pss, "get_platform_setting", lambda key, default=None, db=None: json.dumps(raw))
    monkeypatch.setattr(llm_router, "model_routes", _REAL_MODEL_ROUTES)
    routes = llm_router.model_routes()
    assert set(routes) == {"z-ai/glm-5.3-flash", SONNET}, "a typo must not move every model off its gateway"
    with pytest.raises(ValueError):
        llm_router.parse_routes(raw)
    assert "unknown router" in pss._check_model_routes(json.dumps(raw))


def test_runtime_map_that_is_not_an_object_still_means_openrouter(monkeypatch):
    from ai_service.app.services import platform_settings_service as pss

    monkeypatch.setattr(pss, "get_platform_setting", lambda key, default=None, db=None: '["x"]')
    monkeypatch.setattr(llm_router, "model_routes", _REAL_MODEL_ROUTES)
    assert llm_router.model_routes() == {}


# ── who may get the anthropic route ─────────────────────────────────────────

def test_raw_route_chat_never_gets_anthropic(env):
    payload = {"model": SONNET, "messages": [{"role": "user", "content": "x"}]}
    url, headers, wire, route = llm_router.route_chat(payload)
    assert route.router == "openrouter" and route.transport == "openai"
    assert wire is payload and url == get_settings().llm_base_url


def test_allowed_caller_gets_anthropic_with_a_pool_key(env):
    payload = {"model": SONNET, "messages": [{"role": "user", "content": "x"}], "reasoning": {"enabled": False}}
    url, headers, wire, route = llm_router.route_chat(payload, allow_translated=True)
    assert route.router == "anthropic" and route.transport == "anthropic" and route.is_translated
    assert url == MESSAGES_URL
    assert route.key_id in ("key-1", "key-2") and route.registry_model == SONNET
    assert headers["x-api-key"] == route.api_key and headers["anthropic-version"] == "2023-06-01"
    assert wire["model"] == "claude-sonnet-4-5" and payload["model"] == SONNET


def test_no_key_byo_key_or_cooldown_stay_on_openrouter(env):
    payload = {"model": SONNET, "messages": []}
    env["keys"] = []
    key_pool.invalidate()
    assert llm_router.route_chat(payload, allow_translated=True)[3].router == "openrouter"
    env["keys"] = [_key("key-1")]
    key_pool.invalidate()
    assert llm_router.route_chat(payload, "sk-or-institute", allow_translated=True)[3].router == "openrouter"
    assert llm_router.route_chat(payload, "or-platform", allow_translated=True)[3].router == "anthropic"
    llm_router.mark_router_failed("anthropic")
    assert llm_router.route_chat(payload, allow_translated=True)[3].router == "openrouter"


def test_tables_absent_stays_on_openrouter(env, monkeypatch):
    def boom(provider):
        raise RuntimeError('relation "llm_provider_keys" does not exist')

    monkeypatch.setattr(key_pool, "_load_from_db", boom)
    key_pool.invalidate()
    route = llm_router.route_chat({"model": SONNET, "messages": []}, allow_translated=True)[3]
    assert route.router == "openrouter"


# ── sending ─────────────────────────────────────────────────────────────────

def _post(transport, payload, api_key=None):
    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            return await llm_router.post_chat(client, payload, api_key)
    return asyncio.run(run())


def test_post_chat_translates_both_ways(env):
    transport, calls = _transport(lambda r: httpx.Response(200, json=_message("hello"),
                                                           headers={"request-id": "req_1"}))
    payload = {"model": SONNET, "max_tokens": 50, "temperature": 0.2,
               "messages": [{"role": "system", "content": "Be brief."}, {"role": "user", "content": "hi"}]}
    resp = _post(transport, payload)
    url, body, headers = calls[0]
    assert url == MESSAGES_URL
    assert headers["x-api-key"].startswith("sk-ant-key-") and headers["anthropic-version"] == "2023-06-01"
    assert "authorization" not in headers, "the OpenRouter bearer key must never reach Anthropic"
    assert body["model"] == "claude-sonnet-4-5" and body["max_tokens"] == 50
    assert body["messages"][0]["role"] == "user" and "system" in body
    assert resp.status_code == 200 and resp.headers.get("request-id") == "req_1"
    data = resp.json()
    assert data["model"] == SONNET and data["choices"][0]["message"]["content"] == "hello"
    assert data["usage"]["prompt_tokens"] == 110 and data["usage"]["completion_tokens"] == 5
    assert llm_router._router_of(resp) == "anthropic"
    spend = [a for n, a in env["writes"] if n == "_write_spend"]
    assert spend and spend[0][0] in ("key-1", "key-2") and spend[0][5] == 100  # cache_read tokens


def test_post_chat_tool_call_comes_back_openai_shaped(env):
    reply = _message(content=[{"type": "tool_use", "id": "toolu_1", "name": "get_weather", "input": {"city": "Pune"}}],
                     stop_reason="tool_use")
    transport, calls = _transport(lambda r: httpx.Response(200, json=reply))
    tools = [{"type": "function", "function": {"name": "get_weather", "description": "w",
                                                "parameters": {"type": "object", "properties": {"city": {"type": "string"}}}}}]
    resp = _post(transport, {"model": SONNET, "messages": [{"role": "user", "content": "weather?"}],
                             "tools": tools, "tool_choice": "auto"})
    assert calls[0][1]["tools"][0]["name"] == "get_weather"
    choice = resp.json()["choices"][0]
    assert choice["finish_reason"] == "tool_calls"
    call = choice["message"]["tool_calls"][0]
    assert call["function"]["name"] == "get_weather" and json.loads(call["function"]["arguments"]) == {"city": "Pune"}


def test_post_chat_sync_translates(env, monkeypatch):
    transport, calls = _transport(lambda r: httpx.Response(200, json=_message("sync ok")))
    monkeypatch.setattr(httpx, "Client", functools.partial(httpx.Client, transport=transport))
    resp = llm_router.post_chat_sync({"model": SONNET, "messages": [{"role": "user", "content": "hi"}]})
    assert calls[0][0] == MESSAGES_URL and resp.json()["choices"][0]["message"]["content"] == "sync ok"


def test_key_refusal_walks_to_the_next_key(env):
    seen = []

    def handler(request):
        key = request.headers["x-api-key"]
        seen.append(key)
        if len(seen) == 1:
            return httpx.Response(401, json={"type": "error", "error": {"type": "authentication_error",
                                                                        "message": "invalid x-api-key"}})
        return httpx.Response(200, json=_message("second key"))

    transport, calls = _transport(handler)
    resp = _post(transport, {"model": SONNET, "messages": [{"role": "user", "content": "hi"}]})
    assert resp.json()["choices"][0]["message"]["content"] == "second key"
    assert len(set(seen)) == 2 and all(c[0] == MESSAGES_URL for c in calls)
    failures = [a for n, a in env["writes"] if n == "_write_failure"]
    assert failures and failures[0][2] == "auth_failed"
    assert not llm_router._router_cooling_down("anthropic"), "a bad key must not cool the whole gateway"


def test_every_key_refused_falls_over_to_openrouter_without_cooldown(env):
    def handler(request):
        if _is_anthropic(request):
            return httpx.Response(429, json={"error": {"type": "rate_limit_error", "message": "slow down"}},
                                  headers={"retry-after": "7"})
        return httpx.Response(200, json=_openrouter_completion())

    transport, calls = _transport(handler)
    resp = _post(transport, {"model": SONNET, "messages": [{"role": "user", "content": "hi"}]})
    assert [c[0] for c in calls] == [MESSAGES_URL, MESSAGES_URL, get_settings().llm_base_url]
    assert calls[-1][1]["model"] == SONNET, "OpenRouter gets the registry id"
    assert calls[-1][2]["authorization"] == "Bearer or-platform"
    assert resp.json()["choices"][0]["message"]["content"] == "from openrouter"
    assert not llm_router._router_cooling_down("anthropic")


@pytest.mark.parametrize("status,cools", [(529, True), (500, True), (404, False), (400, False)])
def test_vendor_failure_fails_over_to_openrouter(env, status, cools):
    def handler(request):
        if _is_anthropic(request):
            return httpx.Response(status, json={"error": {"type": "x", "message": "nope"}})
        return httpx.Response(200, json=_openrouter_completion())

    transport, calls = _transport(handler)
    resp = _post(transport, {"model": SONNET, "messages": [{"role": "user", "content": "hi"}]})
    assert resp.status_code == 200 and len(calls) == 2, "no key walk on a vendor-side failure"
    assert llm_router._router_cooling_down("anthropic") is cools


def test_transport_error_fails_over_and_cools(env):
    def handler(request):
        if _is_anthropic(request):
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(200, json=_openrouter_completion())

    transport, calls = _transport(handler)
    assert _post(transport, {"model": SONNET, "messages": []}).status_code == 200
    assert llm_router._router_cooling_down("anthropic")


def test_open_chat_stream_yields_openai_sse(env):
    transport, calls = _transport(lambda r: httpx.Response(200, content=STREAM,
                                                           headers={"content-type": "text/event-stream"}))

    async def run():
        lines = []
        async with httpx.AsyncClient(transport=transport) as client:
            async with llm_router.open_chat_stream(client, {"model": SONNET, "stream": True,
                                                            "messages": [{"role": "user", "content": "hi"}]}) as resp:
                assert resp.status_code == 200
                async for line in resp.aiter_lines():
                    if line:
                        lines.append(line)
        return lines

    lines = asyncio.run(run())
    assert calls[0][0] == MESSAGES_URL and calls[0][1]["stream"] is True
    chunks = [json.loads(l[6:]) for l in lines if l.startswith("data: ") and l != "data: [DONE]"]
    text = "".join((c["choices"][0]["delta"].get("content") or "") for c in chunks if c.get("choices"))
    assert text == "hey" and lines[-1] == "data: [DONE]"
    assert chunks[-1]["usage"]["completion_tokens"] == 2 and chunks[-1]["model"] == SONNET
    assert any(n == "_write_spend" for n, _ in env["writes"])


def test_open_chat_stream_fails_over_before_the_first_byte(env):
    sse = b'data: {"choices":[{"delta":{"content":"or"}}]}\n\ndata: [DONE]\n\n'

    def handler(request):
        if _is_anthropic(request):
            return httpx.Response(529, json={"error": {"type": "overloaded_error", "message": "busy"}})
        return httpx.Response(200, content=sse)

    transport, calls = _transport(handler)

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            async with llm_router.open_chat_stream(client, {"model": SONNET, "stream": True, "messages": []}) as resp:
                return [l async for l in resp.aiter_lines()]

    lines = asyncio.run(run())
    assert any('"or"' in l for l in lines) and calls[-1][0] == get_settings().llm_base_url


_EARLY_ERROR_STREAM = _sse(
    ("message_start", {"type": "message_start", "message": {"id": "msg_e", "usage": {"input_tokens": 7, "output_tokens": 1}}}),
    ("ping", {"type": "ping"}),
    ("error", {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}),
)
_OR_SSE = b'data: {"choices":[{"delta":{"content":"or"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}\n\ndata: [DONE]\n\n'


def test_stream_error_after_200_before_content_fails_over_to_openrouter(env):
    def handler(request):
        if _is_anthropic(request):
            return httpx.Response(200, content=_EARLY_ERROR_STREAM, headers={"content-type": "text/event-stream"})
        return httpx.Response(200, content=_OR_SSE)

    transport, calls = _transport(handler)

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            async with llm_router.open_chat_stream(client, {"model": SONNET, "stream": True,
                                                            "messages": [{"role": "user", "content": "hi"}]}) as resp:
                return [l async for l in resp.aiter_lines()]

    lines = asyncio.run(run())
    assert calls[0][0] == MESSAGES_URL and calls[-1][0] == get_settings().llm_base_url
    assert any('"or"' in l for l in lines)
    failures = [a for n, a in env["writes"] if n == "_write_failure"]
    assert failures and "529" in failures[0][5]
    assert llm_router._router_cooling_down("anthropic"), "an overloaded upstream cools the gateway"


def test_stream_rate_limit_error_after_200_moves_to_the_next_key(env):
    seen = []

    def handler(request):
        if _is_anthropic(request):
            seen.append(request.headers["x-api-key"])
            if len(seen) == 1:
                err = _sse(("message_start", {"type": "message_start", "message": {"id": "m", "usage": {}}}),
                           ("error", {"type": "error", "error": {"type": "rate_limit_error", "message": "slow"}}))
                return httpx.Response(200, content=err)
            return httpx.Response(200, content=STREAM)
        raise AssertionError("must not reach OpenRouter")

    transport, _ = _transport(handler)

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            async with llm_router.open_chat_stream(client, {"model": SONNET, "stream": True,
                                                            "messages": [{"role": "user", "content": "hi"}]}) as resp:
                return [l async for l in resp.aiter_lines()]

    lines = asyncio.run(run())
    assert len(seen) == 2 and seen[0] != seen[1]
    chunks = [json.loads(l[6:]) for l in lines if l.startswith("data: ") and l != "data: [DONE]"]
    assert "".join((c["choices"][0]["delta"].get("content") or "") for c in chunks if c.get("choices")) == "hey"


def test_chat_client_answers_from_openrouter_when_the_stream_errors_early(env):
    def handler(request):
        if _is_anthropic(request):
            return httpx.Response(200, content=_EARLY_ERROR_STREAM)
        return httpx.Response(200, content=_OR_SSE)

    transport, _ = _transport(handler)

    async def run():
        return [c async for c in _client(transport).chat_completion_stream([{"role": "user", "content": "hi"}])]

    chunks = asyncio.run(run())
    assert "".join(c["content"] for c in chunks if c["type"] == "token") == "or"


def test_stream_error_after_content_keeps_the_partial_answer_and_meters_it(env):
    mid = _sse(
        ("message_start", {"type": "message_start", "message": {"id": "m", "usage": {"input_tokens": 9, "output_tokens": 1}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "par"}}),
        ("error", {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}),
    )
    transport, calls = _transport(lambda r: httpx.Response(200, content=mid))

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            async with llm_router.open_chat_stream(client, {"model": SONNET, "stream": True,
                                                            "messages": [{"role": "user", "content": "hi"}]}) as resp:
                return [l async for l in resp.aiter_lines()]

    lines = asyncio.run(run())
    assert len(calls) == 1, "content already reached the caller: no replay on OpenRouter"
    chunks = [json.loads(l[6:]) for l in lines if l.startswith("data: ") and l != "data: [DONE]"]
    assert chunks[-1]["choices"][0]["finish_reason"] == "error"
    assert chunks[-1]["usage"]["prompt_tokens"] == 9
    assert any(n == "_write_spend" for n, _ in env["writes"])


def test_chat_with_chain_reports_the_anthropic_router(env):
    transport, _ = _transport(lambda r: httpx.Response(200, json=_message("chained")))

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            return await llm_router.chat_with_chain({"messages": [{"role": "user", "content": "hi"}]},
                                                    models=[SONNET], client=client)

    result = asyncio.run(run())
    assert result.content == "chained" and result.model == SONNET and result.router == "anthropic"


# ── ChatLLMClient ───────────────────────────────────────────────────────────

class _Resolver:
    def resolve_keys(self, **_):
        return "or-platform", None, SONNET


def _client(transport):
    c = ChatLLMClient(_Resolver())
    c.http_client = httpx.AsyncClient(transport=transport)
    return c


def test_chat_client_non_stream_via_anthropic(env):
    transport, calls = _transport(lambda r: httpx.Response(200, json=_message("claude says hi")))
    out = asyncio.run(_client(transport).chat_completion([{"role": "user", "content": "hi"}]))
    assert calls[0][0] == MESSAGES_URL
    assert out["content"] == "claude says hi"
    assert out["provider"] == "openrouter", "billing keys on the OpenAI usage shape"
    assert out["router"] == "anthropic" and out["model"] == SONNET
    assert out["usage"]["prompt_tokens"] == 110


def test_chat_client_stream_via_anthropic(env):
    transport, calls = _transport(lambda r: httpx.Response(200, content=STREAM))

    async def run():
        return [c async for c in _client(transport).chat_completion_stream([{"role": "user", "content": "hi"}])]

    chunks = asyncio.run(run())
    assert calls[0][0] == MESSAGES_URL
    assert "".join(c["content"] for c in chunks if c["type"] == "token") == "hey"
    done = [c for c in chunks if c["type"] == "done"]
    assert len(done) == 1 and done[0]["usage"]["completion_tokens"] == 2 and done[0]["model"] == SONNET


def test_chat_client_stream_tool_calls_via_anthropic(env):
    stream = _sse(
        ("message_start", {"type": "message_start", "message": {"id": "m", "usage": {"input_tokens": 3}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0,
                                 "content_block": {"type": "tool_use", "id": "toolu_9", "name": "lookup", "input": {}}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                 "delta": {"type": "input_json_delta", "partial_json": "{\"q\": "}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                 "delta": {"type": "input_json_delta", "partial_json": "\"x\"}"}}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 4}}),
        ("message_stop", {"type": "message_stop"}),
    )
    transport, _ = _transport(lambda r: httpx.Response(200, content=stream))
    tools = [{"type": "function", "function": {"name": "lookup", "parameters": {"type": "object"}}}]

    async def run():
        return [c async for c in _client(transport).chat_completion_stream([{"role": "user", "content": "hi"}], tools=tools)]

    chunks = asyncio.run(run())
    calls = [c for c in chunks if c["type"] == "tool_calls"][0]["tool_calls"]
    assert calls[0]["id"] == "toolu_9" and json.loads(calls[0]["function"]["arguments"]) == {"q": "x"}


def test_chat_client_404_fails_over_without_parking_the_model(env):
    def handler(request):
        if _is_anthropic(request):
            return httpx.Response(404, json={"error": {"type": "not_found_error", "message": "model: x"}})
        return httpx.Response(200, json=_openrouter_completion())

    transport, calls = _transport(handler)
    out = asyncio.run(_client(transport).chat_completion([{"role": "user", "content": "hi"}]))
    assert out["content"] == "from openrouter" and out["router"] == "openrouter"
    assert not is_model_broken(SONNET)
    assert calls[-1][0] == get_settings().llm_base_url


def test_unrouted_model_is_byte_identical(env):
    """A model the map does not mention: same URL, headers and body as before."""
    transport, calls = _transport(lambda r: httpx.Response(200, json=_openrouter_completion()))
    payload = {"model": "google/gemini-2.5-flash", "messages": [{"role": "user", "content": "hi"}]}
    _post(transport, payload)
    url, body, headers = calls[0]
    assert url == get_settings().llm_base_url and body == payload
    assert headers["authorization"] == "Bearer or-platform" and "x-api-key" not in headers


# ── save-time probe ─────────────────────────────────────────────────────────

def test_saving_an_anthropic_route_probes_through_the_pool(env, monkeypatch):
    from ai_service.app.services import platform_settings_service as pss

    transport, calls = _transport(lambda r: httpx.Response(200, json=_message("ok")))
    monkeypatch.setattr(httpx, "Client", functools.partial(httpx.Client, transport=transport))
    assert pss._check_model_routes(json.dumps({SONNET: "anthropic"})) is None
    assert calls[0][0] == MESSAGES_URL and calls[0][1]["model"] == "claude-sonnet-4-5"

    env["keys"] = []
    key_pool.invalidate()
    err = pss._check_model_routes(json.dumps({SONNET: "anthropic"}))
    assert err and "no active Anthropic key" in err


def test_probe_does_not_fail_over_to_openrouter(env, monkeypatch):
    from ai_service.app.services import platform_settings_service as pss

    def handler(request):
        if _is_anthropic(request):
            return httpx.Response(404, json={"error": {"type": "not_found_error", "message": "model: claude-x"}})
        return httpx.Response(200, json=_openrouter_completion())

    transport, calls = _transport(handler)
    monkeypatch.setattr(httpx, "Client", functools.partial(httpx.Client, transport=transport))
    err = pss._check_model_routes(json.dumps({"anthropic/claude-x": "anthropic"}))
    assert err and "Anthropic 404" in err
    assert all(c[0] == MESSAGES_URL for c in calls)
