"""Release 2 — features moved off hard-coded models onto their use-case keys.

Each feature resolves its model from ai_model_defaults (GLM by default), keeps
an explicit pick (request model / env override / project override) as the
winner, and sends direct calls through llm_router.chat_with_chain so GLM gets
reasoning effort low plus max_tokens headroom and the chain fails over.

No network, no DB: resolution and the HTTP leg are stubbed. Run from the repo
root:  <venv>/bin/python -m pytest ai_service/tests/test_feature_model_use_cases.py -q
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
import types
from pathlib import Path

import pytest

os.environ.setdefault("OPENROUTER_API_KEY", "or-platform")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.services import llm_router, model_selection  # noqa: E402
from ai_service.app.services import use_case_chat  # noqa: E402

GLM = "z-ai/glm-5.3-flash"
GEMINI = "google/gemini-2.5-flash"

# Router-level modules import fastapi (and boto3 via the S3 helpers); a minimal
# test venv without them skips those cases instead of failing collection.
needs_app_deps = pytest.mark.skipif(
    any(importlib.util.find_spec(m) is None for m in ("fastapi", "boto3", "bs4")),
    reason="needs the ai_service runtime deps (fastapi, boto3, bs4)",
)


class _Resp:
    """Minimal httpx.Response stand-in for chat_with_chain's parser."""

    def __init__(self, status: int, body):
        self.status_code = status
        self._body = body
        self.text = body if isinstance(body, str) else json.dumps(body)
        self.request = types.SimpleNamespace(url="https://openrouter.ai/api/v1/chat/completions")

    def json(self):
        if isinstance(self._body, str):
            raise ValueError("not json")
        return self._body


def _ok(content: str, usage=None):
    return _Resp(200, {"choices": [{"message": {"content": content}, "finish_reason": "stop"}],
                       "usage": usage or {"prompt_tokens": 10, "completion_tokens": 5}})


@pytest.fixture
def chain(monkeypatch):
    """Stub resolution (per use case) and the gateway POST. `script` maps a
    model id to a list of responses (consumed in order); every wire payload is
    recorded in `calls`."""
    state = types.SimpleNamespace(calls=[], script={}, resolved=[], rows={})

    def fake_sync(use_case, preferred_model=None, hard_fallback=None):
        state.resolved.append(use_case)
        return state.rows.get(use_case, (GLM, [GEMINI]))

    def fake_db(db, use_case, preferred_model=None, hard_fallback=None):
        state.resolved.append(use_case)
        primary, fallbacks = state.rows.get(use_case, (GLM, [GEMINI]))
        if preferred_model:
            return preferred_model, [m for m in [primary, *fallbacks] if m != preferred_model]
        return primary, fallbacks

    async def fake_post_chat(client, payload, api_key=None, **kwargs):
        state.calls.append(payload)
        queue = state.script.get(payload["model"]) or [_ok("{}")]
        return queue.pop(0) if len(queue) > 1 else queue[0]

    monkeypatch.setattr(model_selection, "resolve_model_sync", fake_sync)
    monkeypatch.setattr(model_selection, "resolve_models", fake_db)
    monkeypatch.setattr(llm_router, "post_chat", fake_post_chat)
    return state


# ── shared helpers ──────────────────────────────────────────────────────────

def test_models_for_puts_explicit_then_env_first_without_duplicates(chain, monkeypatch):
    monkeypatch.setenv("X_MODEL", "anthropic/claude-haiku")
    assert use_case_chat.models_for("x") == [GLM, GEMINI]
    assert use_case_chat.models_for("x", env="X_MODEL") == ["anthropic/claude-haiku", GLM, GEMINI]
    assert use_case_chat.models_for("x", explicit=GEMINI, env="X_MODEL") == [GEMINI, GLM]
    assert chain.resolved == ["x", "x", "x"]


def test_chat_json_retries_the_chain_without_json_mode_after_a_400(chain):
    chain.script = {GLM: [_Resp(400, "response_format unsupported"), _ok('{"a": 1}')],
                    GEMINI: [_Resp(400, "response_format unsupported")]}
    res = asyncio.run(use_case_chat.chat_json(
        {"messages": [], "max_tokens": 500}, use_case="x", models=[GLM, GEMINI],
        api_key="k", timeout=5, label="t"))
    assert res is not None and res.content == '{"a": 1}' and res.model == GLM
    assert [("response_format" in c) for c in chain.calls] == [True, True, False]


def test_chat_json_gives_up_without_a_plain_retry_on_other_failures(chain):
    chain.script = {GLM: [_Resp(503, "down")], GEMINI: [_Resp(500, "boom")]}
    res = asyncio.run(use_case_chat.chat_json(
        {"messages": []}, use_case="x", models=[GLM, GEMINI], api_key="k", timeout=5, label="t"))
    assert res is None and len(chain.calls) == 2


# ── reels selection / preview / director, studio plan ──────────────────────

def test_reels_selection_goes_through_the_chain_with_glm_headroom(chain):
    from ai_service.app.services import reels_rerank_service as rr

    cands = [{"id": f"c{i}", "transcript": "hello world", "t_start": i, "t_end": i + 20,
              "predicted_duration_s": 20, "scores": {}} for i in range(3)]
    chain.script = {GLM: [_ok(json.dumps({"selection": [{"id": "c2", "reason": "r"}, {"id": "c0", "reason": "r"}]}))]}
    out = asyncio.run(rr.select_top_candidates(
        candidates=cands, select_n=2, target_duration_sec=20, api_key="k", models=[GLM, GEMINI]))
    assert out == [("c2", "r"), ("c0", "r")]
    wire = chain.calls[0]
    assert wire["model"] == GLM
    assert wire["reasoning"]["effort"] == "low"
    assert wire["max_tokens"] > rr._SELECT_MAX_TOKENS  # reasoning allowance on top
    assert wire["response_format"] == {"type": "json_object"}


def test_reels_selection_falls_over_to_the_next_model(chain):
    from ai_service.app.services import reels_rerank_service as rr

    cands = [{"id": "a", "transcript": "x", "t_start": 0, "t_end": 1, "predicted_duration_s": 1, "scores": {}},
             {"id": "b", "transcript": "y", "t_start": 1, "t_end": 2, "predicted_duration_s": 1, "scores": {}}]
    chain.script = {GLM: [_ok("")], GEMINI: [_ok(json.dumps({"selection": [{"id": "b", "reason": "ok"}]}))]}
    out = asyncio.run(rr.select_top_candidates(
        candidates=cands, select_n=1, target_duration_sec=1, api_key="k", models=[GLM, GEMINI]))
    assert out == [("b", "ok")]
    assert [c["model"] for c in chain.calls] == [GLM, GEMINI]
    assert "reasoning" not in chain.calls[1]  # non-GLM leg is sent as the caller built it


def test_reels_preview_models_come_from_the_use_case_and_env_wins(chain, monkeypatch):
    from ai_service.app.services import reels_preview_service as rp

    monkeypatch.delenv("REELS_PREVIEW_LLM_MODEL", raising=False)
    assert rp.preview_models() == [GLM, GEMINI]
    monkeypatch.setenv("REELS_PREVIEW_LLM_MODEL", "anthropic/claude-3-5-haiku")
    assert rp.preview_models()[0] == "anthropic/claude-3-5-haiku"
    assert set(chain.resolved) == {"reels_preview"}


def test_reels_director_uses_its_use_case_with_low_effort(chain, monkeypatch):
    from ai_service.app.services import reels_llm_director_service as rd

    monkeypatch.delenv("REELS_DIRECTOR_LLM_MODEL", raising=False)
    director = rd.LLMDirector()
    director._api_key = "k"
    chain.script = {GLM: [_ok('{"overlays": []}')]}
    raw = asyncio.run(director._call_llm("prompt"))
    assert raw == '{"overlays": []}'
    assert chain.resolved == ["reels_director"]
    wire = chain.calls[0]
    assert wire["model"] == GLM and wire["reasoning"]["effort"] == "low"
    assert wire["max_tokens"] >= 3000  # 800 asked + reasoning allowance


def test_studio_plan_project_override_then_env_then_use_case(chain, monkeypatch):
    from ai_service.app.services.studio_plan_service import StudioPlanService

    monkeypatch.setenv("STUDIO_PLAN_LLM_MODEL", "anthropic/claude-3-5-haiku")
    assert StudioPlanService._models("openai/gpt-5.6-luna")[:2] == ["openai/gpt-5.6-luna", GLM]
    assert StudioPlanService._models(None)[0] == "anthropic/claude-3-5-haiku"
    monkeypatch.delenv("STUDIO_PLAN_LLM_MODEL")
    assert StudioPlanService._models(None) == [GLM, GEMINI]
    assert set(chain.resolved) == {"studio_plan"}


# ── image keyword ───────────────────────────────────────────────────────────

def test_image_keyword_runs_on_the_use_case_chain_with_headroom(chain):
    from ai_service.app.services.image_service import ImageGenerationService

    svc = ImageGenerationService(openrouter_api_key="k")
    assert svc._llm_model is None
    chain.script = {GLM: [_ok('"machine learning"\n')]}
    kw = asyncio.run(svc._get_image_search_keyword("Complete ML Course", "about"))
    assert kw == "machine learning"
    assert chain.resolved == ["image_keyword"]
    wire = chain.calls[0]
    assert wire["model"] == GLM and wire["reasoning"]["effort"] == "low"
    assert wire["max_tokens"] >= 3000  # a bare max_tokens=10 left GLM no room


def test_image_keyword_explicit_model_wins_and_failure_returns_course_name(chain):
    from ai_service.app.services.image_service import ImageGenerationService

    svc = ImageGenerationService(openrouter_api_key="k", llm_model=GEMINI)
    chain.script = {GEMINI: [_Resp(500, "x")], GLM: [_Resp(500, "x")]}
    assert asyncio.run(svc._get_image_search_keyword("Python 101", "")) == "Python 101"
    assert [c["model"] for c in chain.calls] == [GEMINI, GLM]


def test_dependencies_no_longer_pin_the_keyword_model_to_the_env_default():
    src = (Path(__file__).resolve().parent.parent / "app" / "dependencies.py").read_text()
    assert "llm_model=settings.llm_default_model" not in src


# ── course assist / transcript notes / html document / engagement plan ─────

def _platform_key(monkeypatch):
    """course_assist reads the platform OpenRouter key at call time; other test
    modules reset the settings cache, so pin it here (order-independent)."""
    from ai_service.app.config import get_settings

    monkeypatch.setattr(get_settings(), "openrouter_api_key", "k", raising=False)


@needs_app_deps
def test_course_assist_text_uses_its_chain_and_env_override(chain, monkeypatch):
    from ai_service.app.routers import course_assist as ca

    monkeypatch.setenv("COURSE_ASSIST_TEXT_MODEL", "anthropic/claude-sonnet-5")
    _platform_key(monkeypatch)
    chain.script = {"anthropic/claude-sonnet-5": [_Resp(502, "x")], GLM: [_ok("<p>Hi</p>")]}
    res = asyncio.run(ca._text_chat({"messages": [{"role": "user", "content": "x"}], "temperature": 0.7}))
    assert res.content == "<p>Hi</p>" and res.model == GLM  # billed under the registry id that answered
    assert [c["model"] for c in chain.calls] == ["anthropic/claude-sonnet-5", GLM]
    assert chain.resolved == ["course_assist"]


@needs_app_deps
def test_course_assist_text_chain_exhausted_is_a_502(chain, monkeypatch):
    from fastapi import HTTPException

    from ai_service.app.routers import course_assist as ca

    monkeypatch.delenv("COURSE_ASSIST_TEXT_MODEL", raising=False)
    _platform_key(monkeypatch)
    chain.script = {GLM: [_Resp(500, "x")], GEMINI: [_Resp(500, "x")]}
    with pytest.raises(HTTPException) as exc:
        asyncio.run(ca._text_chat({"messages": []}))
    assert exc.value.status_code == 502


@needs_app_deps
def test_transcript_notes_resolve_the_use_case_with_the_request_session(chain):
    from ai_service.app.routers import transcript_notes as tn

    chain.script = {GLM: [_ok("# Notes")]}
    md, model = asyncio.run(tn._call_openrouter("prompt", "k", db=object()))
    assert (md, model) == ("# Notes", GLM)
    assert chain.resolved == ["transcript_notes"]
    assert chain.calls[0]["max_tokens"] > 8192  # GLM reasoning allowance on top


@needs_app_deps
def test_html_document_env_wins_else_use_case(chain, monkeypatch):
    from ai_service.app.routers import html_document as hd

    monkeypatch.delenv("HTML_DOCUMENT_MODEL", raising=False)
    chain.rows["html_document"] = (GEMINI, [GLM])
    assert hd._resolve_model(db=object()) == GEMINI
    monkeypatch.setenv("HTML_DOCUMENT_MODEL", "anthropic/claude-sonnet-5")
    assert hd._resolve_model(db=object()) == "anthropic/claude-sonnet-5"
    assert hd._DEFAULT_MODEL == GLM


@needs_app_deps
def test_engagement_plan_env_wins_else_use_case(chain, monkeypatch):
    from ai_service.app.services import engagement_plan_service as ep

    monkeypatch.delenv("ENGAGEMENT_PLAN_MODEL", raising=False)
    chain.rows["engagement_plan"] = (GEMINI, [GLM])
    assert ep.model_name() == GEMINI
    monkeypatch.setenv("ENGAGEMENT_PLAN_MODEL", "x/y")
    assert ep.model_name() == "x/y"
    assert chain.resolved == ["engagement_plan"]


# ── brand kit ───────────────────────────────────────────────────────────────

@needs_app_deps
def test_brand_kit_extraction_runs_on_its_chain(chain, monkeypatch):
    from ai_service.app.services import brand_kit_scrape_service as bk

    monkeypatch.delenv("BRAND_KIT_SCRAPE_MODEL", raising=False)
    monkeypatch.setattr(bk, "get_settings", lambda: types.SimpleNamespace(openrouter_api_key="k"))
    chain.script = {GLM: [_ok(json.dumps({"name": "Acme", "heading_font": "Inter"}))]}
    svc = bk.BrandKitScrapeService.__new__(bk.BrandKitScrapeService)
    monkeypatch.setattr(svc, "_build_system_prompt", lambda: "sys", raising=False)
    monkeypatch.setattr(svc, "_build_user_text", lambda url, signals: "user", raising=False)
    warnings: list = []
    out = asyncio.run(svc._run_llm_extraction("https://acme.test", {}, "https://img/s.png", None, warnings))
    assert out is not None and out.name == "Acme" and warnings == []
    assert chain.resolved == ["brand_kit"]
    wire = chain.calls[0]
    assert wire["model"] == GLM and wire["reasoning"]["effort"] == "low"
    assert wire["messages"][1]["content"][1]["type"] == "image_url"


# ── KB companions ───────────────────────────────────────────────────────────

def test_kb_companion_models_follow_the_use_case_and_env_still_wins(chain, monkeypatch):
    from ai_service.app.services.kb_companion import llm, model_choice

    monkeypatch.setattr(llm, "PRIMARY_MODEL", "old/primary")
    monkeypatch.setattr(llm, "FALLBACK_MODEL", "old/fallback")
    monkeypatch.delenv("KB_COMPANION_MODEL", raising=False)
    monkeypatch.delenv("KB_COMPANION_FALLBACK_MODEL", raising=False)
    chain.rows["kb_companion"] = (GEMINI, [GLM])
    model_choice.refresh()
    assert (llm.PRIMARY_MODEL, llm.FALLBACK_MODEL) == (GEMINI, GLM)

    monkeypatch.setenv("KB_COMPANION_MODEL", "env/primary")
    monkeypatch.setattr(llm, "PRIMARY_MODEL", "env/primary")
    model_choice.refresh()
    assert llm.PRIMARY_MODEL == "env/primary" and llm.FALLBACK_MODEL == GEMINI

    monkeypatch.setenv("KB_COMPANION_MODEL_KN", "lang/override")
    assert llm.primary_for("kn") == "lang/override"  # per-language env still first


# ── page builder ────────────────────────────────────────────────────────────

@needs_app_deps
def test_page_builder_hard_fallback_is_glm():
    from ai_service.app.routers import page_builder as pb

    if not os.getenv("PAGE_BUILDER_MODEL"):
        assert pb._DEFAULT_MODEL == GLM


@needs_app_deps
def test_page_builder_vision_passes_send_the_page_builder_chain(chain, monkeypatch):
    from ai_service.app.routers import page_builder as pb
    from ai_service.app.services import api_key_resolver, chat_llm_client

    chain.rows["page_builder"] = (GLM, [GEMINI])
    seen = []

    class FakeClient:
        def __init__(self, *_a, **_k):
            pass

        async def chat_completion(self, messages, **kwargs):
            seen.append(kwargs)
            return {"content": '{"mood": "calm"}'}

    monkeypatch.setattr(pb, "resolve_models", model_selection.resolve_models)  # bound at import
    monkeypatch.setattr(chat_llm_client, "ChatLLMClient", FakeClient)
    monkeypatch.setattr(api_key_resolver, "ApiKeyResolver", lambda db: None)

    async def fake_inline(url):
        return "data:image/png;base64,AAAA", None

    monkeypatch.setattr(pb, "_inline_image_data_url", fake_inline)
    asyncio.run(pb._describe_attachments(["https://x.test/a.png"], object(), "inst", "u"))
    asyncio.run(pb._analyze_inspiration(["https://x.test/a.png"], object(), "inst", "u"))
    assert len(seen) == 2
    for kw in seen:
        assert kw["model"] == GLM and kw["fallback_models"] == [GEMINI]
    assert chain.resolved == ["page_builder", "page_builder"]


# ── render worker (no DB: env-driven GLM default) ──────────────────────────

def _load_render_module(name: str):
    root = Path(__file__).resolve().parent.parent / "render_worker"
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    return importlib.import_module(f"extractor.{name}")


def test_render_worker_llm_defaults(monkeypatch):
    d = _load_render_module("llm_defaults")
    monkeypatch.delenv("HIGHLIGHT_LLM_MODEL", raising=False)
    monkeypatch.delenv("RENDER_WORKER_LLM_MODEL", raising=False)
    assert d.llm_model("HIGHLIGHT_LLM_MODEL") == GLM
    monkeypatch.setenv("RENDER_WORKER_LLM_MODEL", GEMINI)
    assert d.llm_model("HIGHLIGHT_LLM_MODEL") == GEMINI
    monkeypatch.setenv("HIGHLIGHT_LLM_MODEL", "x/y")
    assert d.llm_model("HIGHLIGHT_LLM_MODEL") == "x/y"
    assert d.reasoning_extra_body(GLM) == {"reasoning": {"enabled": True, "effort": "low"}}
    assert d.reasoning_extra_body(GEMINI) == {}
    assert d.LLM_MAX_TOKENS >= 1500


def test_render_worker_highlight_sends_glm_with_low_effort(monkeypatch):
    pytest.importorskip("numpy")
    hl = _load_render_module("highlight")
    from extractor.schemas import ProsodySummary, Sentence  # type: ignore

    captured = {}

    class _Completions:
        def create(self, **kwargs):
            captured.update(kwargs)
            msg = types.SimpleNamespace(content=json.dumps({"t_start": 1.0, "t_end": 40.0, "reason": "r"}))
            return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])

    class FakeOpenAI:
        def __init__(self, **_k):
            self.chat = types.SimpleNamespace(completions=_Completions())

    monkeypatch.setitem(sys.modules, "openai", types.SimpleNamespace(OpenAI=FakeOpenAI))
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    monkeypatch.delenv("HIGHLIGHT_LLM_MODEL", raising=False)
    monkeypatch.delenv("RENDER_WORKER_LLM_MODEL", raising=False)
    prosody = ProsodySummary(mean_rms=0.1, peak_rms=0.5, mean_pitch_hz=120.0, pause_count=2)
    sentence = Sentence(text="hi", start=0.0, end=2.0)
    win = hl.select_highlight_llm([sentence], [], [], prosody, duration_s=120.0)
    assert win is not None
    assert captured["model"] == GLM
    assert captured["max_tokens"] >= 1500
    assert captured["extra_body"] == {"reasoning": {"enabled": True, "effort": "low"}}
