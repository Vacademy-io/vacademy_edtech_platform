"""The video pipeline must tell GLM how hard to think, and survive a gateway outage.

Measured 2026-10-01 on the same 18-shot plan, z-ai/glm-5.3-flash:

    no reasoning setting (what the pipeline sent)   188 s  5,654 reasoning tokens  $0.0046
    explicit effort "high"                          228 s    688 reasoning tokens  $0.00087
    explicit "high", routed to Isoquant              49 s    175 reasoning tokens

Every variant returned a complete 18/18 plan. "Nothing" is not "off" for a
reasoning-mandatory model; it is the model's heavy default.

Run:  cd ai_service && PYTHONPATH=.. python -m pytest tests/test_video_llm_reasoning.py
"""
from __future__ import annotations

import ast
import io
import json
import os
import socket
import sys
import urllib.error
from pathlib import Path
from typing import Any, Dict, Optional

import pytest

HERE = Path(__file__).resolve().parent
PIPELINE_DIR = HERE.parent / "app" / "ai-video-gen-main"
PIPELINE = PIPELINE_DIR / "automation_pipeline.py"
sys.path.insert(0, str(PIPELINE_DIR))
sys.path.insert(0, str(HERE.parent.parent))

import video_llm_reasoning as vlr  # noqa: E402

GLM = "z-ai/glm-5.3-flash"


# --------------------------------------------------------------------------
# Which models get a reasoning setting, and which effort
# --------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("VIDEO_REASONING_EFFORT", raising=False)


def test_glm_is_told_to_think_at_high_by_default():
    assert vlr.reasoning_for(GLM) == {"enabled": True, "effort": "high"}
    assert vlr.reasoning_for("z-ai/glm-5.3-flash:batch") == {"enabled": True, "effort": "high"}
    assert vlr.reasoning_for("z-ai/glm-5.3") == {"enabled": True, "effort": "high"}


def test_every_other_model_is_sent_exactly_what_it_was_sent_before():
    """The fallback chain is Gemini / Claude / whatever the registry lists. A
    reasoning object they did not get before is a behaviour change nobody asked for."""
    for model in ("google/gemini-3.7-flash", "anthropic/claude-sonnet-5", "qwen/qwen3.8-max", "", None):
        assert vlr.reasoning_for(model) is None, model


def test_effort_is_configurable_and_can_be_switched_off(monkeypatch):
    monkeypatch.setenv("VIDEO_REASONING_EFFORT", "medium")
    assert vlr.reasoning_for(GLM) == {"enabled": True, "effort": "medium"}
    for off in ("off", "none", "", "default"):
        monkeypatch.setenv("VIDEO_REASONING_EFFORT", off)
        assert vlr.reasoning_for(GLM) is None, off


def test_an_effort_openrouter_would_reject_falls_back_to_the_default(monkeypatch):
    """Isoquant accepts "max"; OpenRouter's reasoning object does not. A routed
    call that fails over to OpenRouter must still be a request it accepts."""
    for bad in ("max", "xhigh", "turbo"):
        monkeypatch.setenv("VIDEO_REASONING_EFFORT", bad)
        assert vlr.reasoning_for(GLM) == {"enabled": True, "effort": "high"}, bad


# --------------------------------------------------------------------------
# The real router translates it for Isoquant
# --------------------------------------------------------------------------

def _router():
    os.environ.setdefault("OPENROUTER_API_KEY", "or-platform")
    os.environ.setdefault("ISOQUANT_API_KEY", "iq-key")
    try:
        from ai_service.app.config import get_settings
        from ai_service.app.services import llm_router
    except Exception as exc:  # pragma: no cover - app deps not installed
        pytest.skip(f"ai_service app not importable here: {exc}")
    # get_settings is lru_cached: a test file that ran first (test_blog_tools,
    # test_video_glm_release) built it before these keys were in the env, and
    # the Isoquant route then read as "key not set" and fell to OpenRouter.
    if not (get_settings().isoquant_api_key and get_settings().openrouter_api_key):
        get_settings.cache_clear()
    llm_router._FAILED_UNTIL.clear()
    return llm_router


def _payload(model=GLM):
    """What OpenRouterClient.chat builds, prompt cache and all."""
    return {
        "model": model,
        "messages": [{"role": "system", "content": [{"type": "text", "text": "plan",
                                                     "cache_control": {"type": "ephemeral"}}]},
                     {"role": "user", "content": "go"}],
        "temperature": 0.6,
        "max_tokens": 32000,
        "response_format": {"type": "json_object"},
        "reasoning": vlr.reasoning_for(model),
    }


def test_routed_to_isoquant_the_effort_becomes_reasoning_effort_high():
    """Isoquant ignores OpenRouter's `reasoning` object and, told nothing,
    thinks at "max". The effort must arrive as its own top-level field."""
    r = _router()
    routes = r.parse_routes({GLM: "isoquant"})
    _url, headers, wire, route = r.route_chat(_payload(), None, routes=routes)
    assert route.router == "isoquant"
    assert wire["reasoning_effort"] == "high"
    assert "reasoning" not in wire
    assert wire["model"] == "glm-5.3-flash"
    assert headers["Isoquant-ZDR"] == "required"


def test_left_on_openrouter_the_reasoning_object_passes_through():
    r = _router()
    _url, _h, wire, route = r.route_chat(_payload(), None, routes={})
    assert route.is_default
    assert wire["reasoning"] == {"enabled": True, "effort": "high"}


# --------------------------------------------------------------------------
# A gateway outage keeps the model, not the gateway
# --------------------------------------------------------------------------

class _Stage:
    def get(self):
        return "shot_planning"


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _pipeline_ns():
    """The real `_llm_router` and `OpenRouterClient._open_chat`, lifted out of the
    pipeline source into one namespace. Importing automation_pipeline.py pulls
    in the whole renderer; these need only importlib, urllib, json and the router."""
    tree = ast.parse(PIPELINE.read_text())
    resolver = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_llm_router")
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "OpenRouterClient")
    fn = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "_open_chat")
    mod = ast.Module(body=[resolver, fn], type_ignores=[])
    ns: Dict[str, Any] = {"json": json, "Dict": Dict, "Any": Any, "Optional": Optional,
                          "_llm_stage": _Stage(), "_ROUTER_IMPORT_WARNED": False}
    import urllib.request as _ur
    ns["urllib"] = sys.modules["urllib"]
    ns["urllib"].request = _ur
    exec(compile(mod, str(PIPELINE), "exec"), ns)
    return ns


def _load_open_chat():
    return _pipeline_ns()["_open_chat"]


def _as_in_production(monkeypatch):
    """ai-service runs as `uvicorn ai_service.main:app` from /app: the package is
    `ai_service.app`, and `import app` fails. A None entry in sys.modules makes
    that import raise exactly as it does there. The first version of these tests
    aliased `app` to `ai_service.app` instead — which made the broken import
    pass here while every video call in production went to OpenRouter.
    Submodules another test file already imported under `app.` (e.g.
    `app.services.llm_router`) are blocked too — import_module returns a cached
    submodule without touching its parent."""
    for name in [n for n in list(sys.modules) if n == "app" or n.startswith("app.")] or ["app"]:
        monkeypatch.setitem(sys.modules, name, None)
    monkeypatch.setitem(sys.modules, "app", None)


class _Client:
    base_url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {"Authorization": "Bearer or-platform", "Content-Type": "application/json"}


def _harness(monkeypatch, first_error):
    """Fake urlopen: the first call raises `first_error`, later calls succeed."""
    calls = []

    def fake_urlopen(req, timeout=None):
        calls.append({"url": req.full_url, "headers": dict(req.header_items()),
                      "body": json.loads(req.data.decode())})
        if len(calls) == 1 and first_error is not None:
            raise first_error
        return _FakeResponse(b'{"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}]}')

    _router()  # skips the test when the app's deps are not installed
    import urllib.request as _ur
    monkeypatch.setattr(_ur, "urlopen", fake_urlopen)
    _as_in_production(monkeypatch)
    return calls


def _http_error(code):
    return urllib.error.HTTPError("https://api.isoquant.ai/v1/chat/completions", code, "err", {},
                                  io.BytesIO(b'{"error":"x"}'))


def _routed_call(open_chat, r):
    payload = _payload()
    url, headers, wire, route = r.route_chat(payload, None, routes=r.parse_routes({GLM: "isoquant"}))
    return open_chat(_Client(), url, headers, wire, payload, route, GLM, 30)


@pytest.mark.parametrize("error", [_http_error(503), _http_error(429), _http_error(401),
                                   socket.timeout("timed out"), urllib.error.URLError("refused")])
def test_a_gateway_outage_retries_the_same_model_on_openrouter(monkeypatch, error):
    """Before: the error escaped into chat()'s model loop, which moved on to the
    NEXT model - an Isoquant blip silently made a GLM video into a Gemini one."""
    open_chat = _load_open_chat()
    calls = _harness(monkeypatch, error)
    r = _router()

    resp = _routed_call(open_chat, r)

    assert resp is not None
    assert len(calls) == 2
    assert calls[0]["url"] == "https://api.isoquant.ai/v1/chat/completions"
    assert calls[1]["url"] == _Client.base_url
    assert calls[1]["body"]["model"] == GLM, "failover must keep the model the user chose"
    assert calls[1]["body"]["reasoning"] == {"enabled": True, "effort": "high"}
    assert "reasoning_effort" not in calls[1]["body"], "OpenRouter gets OpenRouter's shape"
    assert r._router_cooling_down("isoquant"), "a dead gateway must not be hit on every call"


def test_a_bad_request_is_not_retried_on_openrouter(monkeypatch):
    """A 400 is the request's own fault; OpenRouter would reject it too."""
    open_chat = _load_open_chat()
    calls = _harness(monkeypatch, _http_error(400))
    r = _router()
    with pytest.raises(urllib.error.HTTPError):
        _routed_call(open_chat, r)
    assert len(calls) == 1
    assert not r._router_cooling_down("isoquant")


def test_an_unrouted_call_raises_exactly_as_before(monkeypatch):
    open_chat = _load_open_chat()
    calls = _harness(monkeypatch, _http_error(503))
    with pytest.raises(urllib.error.HTTPError):
        open_chat(_Client(), _Client.base_url, _Client.headers, _payload(), _payload(), None, GLM, 30)
    assert len(calls) == 1


# --------------------------------------------------------------------------
# The router is found under the name the service actually runs as
# --------------------------------------------------------------------------

def test_the_router_resolves_under_the_production_package_name(monkeypatch):
    """The regression. With `app` unimportable — as in the live process — the
    old import found nothing and every video call went to OpenRouter."""
    real = _router()
    _as_in_production(monkeypatch)
    resolved = _pipeline_ns()["_llm_router"]()
    assert resolved is real, "the video client must reach the same router module the service uses"


def test_a_dev_layout_where_only_app_resolves_still_routes(monkeypatch):
    """Run from the service root (tests, local dev) `app.` is the importable name."""
    real = _router()
    monkeypatch.setitem(sys.modules, "ai_service.app.services.llm_router", None)
    monkeypatch.setitem(sys.modules, "app", sys.modules.get("app") or __import__("ai_service.app", fromlist=["services"]))
    monkeypatch.setitem(sys.modules, "app.services", sys.modules["ai_service.app.services"])
    monkeypatch.setitem(sys.modules, "app.services.llm_router", real)
    assert _pipeline_ns()["_llm_router"]() is real


def test_no_router_inside_ai_service_is_reported_not_swallowed(monkeypatch, capsys):
    """The silent `except ImportError: pass` is what hid this for four days."""
    _router()
    monkeypatch.setitem(sys.modules, "ai_service.app.services.llm_router", None)
    _as_in_production(monkeypatch)
    ns = _pipeline_ns()
    assert ns["_llm_router"]() is None
    out = capsys.readouterr().out
    assert "llm_router could not be imported inside ai-service" in out
    ns["_llm_router"]()
    assert "could not be imported" not in capsys.readouterr().out, "warn once, not on every call"


# --------------------------------------------------------------------------
# Wiring
# --------------------------------------------------------------------------

def test_the_client_sends_the_setting_and_opens_through_the_failover():
    src = PIPELINE.read_text()
    assert "_reasoning, _gateway_effort, _planned_max_tokens = _plan_reasoning(" in src
    assert "_effective_max_tokens = _planned_max_tokens" in src
    assert 'payload["reasoning"] = _reasoning' in src
    assert "with self._open_chat(_url, _headers, _wire, payload, _route," in src
    # the bare urlopen of the routed request is gone
    assert "with urllib.request.urlopen(request, timeout=_req_timeout) as response:" not in src


def test_the_router_is_never_imported_by_the_bare_name_alone():
    """`from app.services.llm_router import …` fails in production. Every use
    must go through _llm_router(), which tries `ai_service.app` first."""
    src = PIPELINE.read_text()
    assert "from app.services.llm_router import" not in src
    assert "_router = _llm_router()" in src
    assert "router = _llm_router() if route is not None else None" in src


def test_each_call_says_which_gateway_served_it():
    src = PIPELINE.read_text()
    assert 'f"   ⇢ {model_to_use} via "' in src
    assert "_route.label if _route is not None else 'OpenRouter'" in src


def test_the_shot_planner_starts_with_room_for_a_full_plan():
    src = PIPELINE.read_text()
    call = src[src.index("sp_result = plan_shots("):]
    call = call[:call.index("\n        )\n")]
    assert "max_tokens=32000" in call
