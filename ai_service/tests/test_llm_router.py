"""Offline tests for per-model LLM gateway routing (services/llm_router.py).

Covers:
  - unlisted models go to OpenRouter unchanged
  - a routed model gets the gateway's URL, key, ZDR header, bare model id and
    `reasoning_effort` (never OpenRouter's `reasoning` object — Isoquant's GLM
    would silently think at "max")
  - an institute's own OpenRouter key never leaves OpenRouter
  - a missing gateway key or a gateway in cooldown falls back to OpenRouter
  - a bad route map is rejected at save time and ignored at runtime
  - a gateway 5xx / connect error is retried on OpenRouter (non-streaming,
    streaming, and through ChatLLMClient) and billing still sees the registry id

No network. Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_llm_router.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

os.environ["OPENROUTER_API_KEY"] = "or-platform"
os.environ["ISOQUANT_API_KEY"] = "iq-key"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import httpx  # noqa: E402

from ai_service.app.config import get_settings  # noqa: E402
from ai_service.app.services import llm_router  # noqa: E402
from ai_service.app.services.chat_llm_client import ChatLLMClient  # noqa: E402

GLM = "z-ai/glm-5.3-flash"
ROUTES = {GLM: "isoquant", "qwen/qwen3.6-27b": {"router": "isoquant", "reasoning_effort": False}}


def _use_routes(routes):
    llm_router.model_routes = lambda: llm_router.parse_routes(routes)
    llm_router._FAILED_UNTIL.clear()


def _completion(model="glm-5.3-flash", content="hi"):
    return {"model": model, "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4}}


def test_unrouted_model_is_untouched():
    _use_routes(ROUTES)
    payload = {"model": "google/gemini-2.5-flash", "messages": [], "reasoning": {"enabled": False}}
    url, headers, wire, route = llm_router.route_chat(payload)
    assert route.router == "openrouter"
    assert url == get_settings().llm_base_url
    assert headers["Authorization"] == "Bearer or-platform"
    assert wire is payload


def test_routed_model_is_translated():
    _use_routes(ROUTES)
    payload = {"model": GLM, "messages": [{"role": "user", "content": "x"}], "max_tokens": 9,
               "reasoning": {"enabled": True, "effort": "low"}, "provider": {"sort": "price"}}
    url, headers, wire, route = llm_router.route_chat(payload)
    assert url == "https://api.isoquant.ai/v1/chat/completions"
    assert headers["Authorization"] == "Bearer iq-key"
    assert headers["Isoquant-ZDR"] == "required"
    assert wire["model"] == "glm-5.3-flash"
    assert wire["reasoning_effort"] == "low"
    assert "reasoning" not in wire and "provider" not in wire
    assert wire["max_tokens"] == 9
    assert payload["model"] == GLM, "caller's payload must not be mutated"


def test_reasoning_effort_mapping():
    _use_routes(ROUTES)
    def effort(reasoning):
        p = {"model": GLM, "messages": []}
        if reasoning is not None:
            p["reasoning"] = reasoning
        return llm_router.route_chat(p)[2].get("reasoning_effort")
    assert effort(None) == "low", "silence must not leave GLM on its 'max' default"
    assert effort({"enabled": False}) == "low"
    assert effort({"effort": "medium"}) == "high"
    assert effort({"effort": "xhigh"}) == "max"
    # a model without the parameter gets none
    p = llm_router.route_chat({"model": "qwen/qwen3.6-27b", "messages": []})[2]
    assert "reasoning_effort" not in p and p["model"] == "qwen3.6-27b"


def test_streaming_asks_for_usage():
    _use_routes(ROUTES)
    wire = llm_router.route_chat({"model": GLM, "messages": [], "stream": True})[2]
    assert wire["stream_options"] == {"include_usage": True}


def test_byo_key_stays_on_openrouter():
    _use_routes(ROUTES)
    url, headers, wire, route = llm_router.route_chat({"model": GLM, "messages": []}, "sk-or-institute")
    assert route.router == "openrouter" and headers["Authorization"] == "Bearer sk-or-institute"
    assert wire["model"] == GLM
    # the platform key itself is routed
    assert llm_router.route_chat({"model": GLM, "messages": []}, "or-platform")[3].router == "isoquant"


def test_missing_key_and_cooldown_fall_back():
    _use_routes(ROUTES)
    settings = get_settings()
    saved = settings.isoquant_api_key
    settings.isoquant_api_key = None
    try:
        assert llm_router.route_for(GLM).router == "openrouter"
    finally:
        settings.isoquant_api_key = saved
    llm_router.mark_router_failed("isoquant")
    assert llm_router.route_for(GLM).router == "openrouter"
    llm_router._FAILED_UNTIL.clear()
    assert llm_router.route_for(GLM).router == "isoquant"


def test_bad_route_maps():
    for bad in ('["x"]', '{"m": "nope"}', '{"m": {"router": "isoquant", "reasoning_effort": "medium"}}', "{"):
        try:
            llm_router.parse_routes(bad)
        except Exception:
            continue
        raise AssertionError(f"accepted {bad}")
    assert llm_router.parse_routes('{"m": "ISOQUANT"}')["m"]["router"] == "isoquant"


def _transport(handler):
    calls = []

    def wrapped(request: httpx.Request):
        calls.append((str(request.url), json.loads(request.content or b"{}"), dict(request.headers)))
        return handler(request)

    return httpx.MockTransport(wrapped), calls


def test_post_chat_fails_over_on_5xx():
    _use_routes(ROUTES)

    def handler(request):
        if "isoquant" in str(request.url):
            return httpx.Response(503, json={"error": {"message": "down"}})
        return httpx.Response(200, json=_completion(GLM))

    transport, calls = _transport(handler)

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            return await llm_router.post_chat(client, {"model": GLM, "messages": []})

    resp = asyncio.run(run())
    assert resp.status_code == 200
    assert [c[0] for c in calls] == ["https://api.isoquant.ai/v1/chat/completions", get_settings().llm_base_url]
    assert calls[1][1]["model"] == GLM
    assert llm_router.route_for(GLM).router == "openrouter", "gateway should cool down"


def test_post_chat_does_not_fail_over_on_400():
    _use_routes(ROUTES)
    transport, calls = _transport(lambda r: httpx.Response(400, json={"error": {"message": "bad"}}))

    async def run():
        async with httpx.AsyncClient(transport=transport) as client:
            return await llm_router.post_chat(client, {"model": GLM, "messages": []})

    assert asyncio.run(run()).status_code == 400 and len(calls) == 1


def test_stream_fails_over_before_first_token():
    _use_routes(ROUTES)
    sse = b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'

    def handler(request):
        if "isoquant" in str(request.url):
            raise httpx.ConnectError("refused", request=request)
        return httpx.Response(200, content=sse, headers={"content-type": "text/event-stream"})

    transport, calls = _transport(handler)

    async def run():
        lines = []
        async with httpx.AsyncClient(transport=transport) as client:
            async with llm_router.open_chat_stream(client, {"model": GLM, "messages": [], "stream": True}) as resp:
                async for line in resp.aiter_lines():
                    lines.append(line)
        return lines

    lines = asyncio.run(run())
    assert any('"ok"' in l for l in lines)
    assert "isoquant" not in calls[-1][0]


class _Resolver:
    def resolve_keys(self, **_):
        return "or-platform", None, GLM


def test_chat_client_routes_and_bills_registry_id():
    _use_routes(ROUTES)
    transport, calls = _transport(lambda r: httpx.Response(200, json=_completion("glm-5.3-flash")))
    client = ChatLLMClient(_Resolver())
    client.http_client = httpx.AsyncClient(transport=transport)
    out = asyncio.run(client.chat_completion([{"role": "user", "content": "hi"}]))
    assert calls[0][0].startswith("https://api.isoquant.ai/")
    assert calls[0][1]["reasoning_effort"] == "low" and "reasoning" not in calls[0][1]
    assert out["model"] == GLM, "billing prices the registry id"
    assert out["provider"] == "openrouter" and out["router"] == "isoquant"


def test_chat_client_fails_over_without_marking_model_broken():
    _use_routes(ROUTES)
    from ai_service.app.services.chat_llm_client import is_model_broken

    def handler(request):
        if "isoquant" in str(request.url):
            return httpx.Response(502, text="bad gateway")
        return httpx.Response(200, json=_completion(GLM, "from openrouter"))

    transport, calls = _transport(handler)
    client = ChatLLMClient(_Resolver())
    client.http_client = httpx.AsyncClient(transport=transport)
    out = asyncio.run(client.chat_completion([{"role": "user", "content": "hi"}]))
    assert out["content"] == "from openrouter" and out["router"] == "openrouter"
    assert not is_model_broken(GLM)
    assert "reasoning" in calls[1][1], "OpenRouter gets its own reasoning shape back"


def test_chat_client_stream_routes():
    _use_routes(ROUTES)
    sse = (b'data: {"choices":[{"delta":{"content":"he"}}]}\n\n'
           b'data: {"choices":[{"delta":{"content":"y"}}]}\n\n'
           b'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":2},"model":"glm-5.3-flash"}\n\n'
           b'data: [DONE]\n\n')
    transport, calls = _transport(lambda r: httpx.Response(200, content=sse))
    client = ChatLLMClient(_Resolver())
    client.http_client = httpx.AsyncClient(transport=transport)

    async def run():
        return [c async for c in client.chat_completion_stream([{"role": "user", "content": "hi"}])]

    chunks = asyncio.run(run())
    assert "".join(c["content"] for c in chunks if c["type"] == "token") == "hey"
    done = [c for c in chunks if c["type"] == "done" and c.get("usage")]
    assert done and done[0]["model"] == GLM
    assert calls[0][0].startswith("https://api.isoquant.ai/")


def test_saving_a_route_map_probes_the_gateway():
    from ai_service.app.services import platform_settings_service as pss

    seen = []
    real_post = httpx.post

    def fake_post(url, json=None, headers=None, timeout=None):
        seen.append((url, json, headers))
        if json["model"] == "glm-5.3-flash":
            return httpx.Response(200, json=_completion())
        return httpx.Response(404, json={"error": {"message": "model not found"}})

    httpx.post = fake_post
    try:
        assert pss._check_model_routes('{"z-ai/glm-5.3-flash": "isoquant"}') is None
        assert seen[0][0].startswith("https://api.isoquant.ai/") and seen[0][2]["Isoquant-ZDR"] == "required"
        err = pss._check_model_routes('{"z-ai/glm-9": "isoquant"}')
        assert err and "Isoquant 404" in err, err
        assert "unknown router" in pss._check_model_routes('{"m": "nope"}')
        settings = get_settings()
        saved, settings.isoquant_api_key = settings.isoquant_api_key, None
        try:
            assert "not configured" in pss._check_model_routes('{"z-ai/glm-5.3-flash": "isoquant"}')
        finally:
            settings.isoquant_api_key = saved
    finally:
        httpx.post = real_post


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} passed")
