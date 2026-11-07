"""The small video-utility LLM calls run on the 'video' default model (GLM)
with one retry on the non-GLM fallback.

Intent router, video-type classifier, regen intent classifier and the
reference-file image description used to name google/gemini-2.5-flash
directly. They now read ai_model_defaults('video') (GLM when the read fails),
send reasoning effort 'low' explicitly (on the OpenRouter failover leg a
payload with no reasoning object runs GLM at its heavy default and comes back
empty), carry a max_tokens with thinking headroom, and retry once on
NON_GLM_FALLBACK inside the caller's time budget.

Also: constants.models defaults to GLM, and KB Companions record the registry
id rather than the gateway's echoed wire id.
"""
import asyncio
import json
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.constants import models as models_mod  # noqa: E402
from app.constants.model_defaults import GLM_DEFAULT, NON_GLM_FALLBACK  # noqa: E402
from app.services import intent_router_service as irs  # noqa: E402
from app.services import llm_router  # noqa: E402
from app.services import reference_file_service as rfs  # noqa: E402
from app.services import regen_intent_classifier as ric  # noqa: E402
from app.services import video_type_classifier_service as vtc  # noqa: E402


class _Resp:
    def __init__(self, content="", status=200, model=None, finish="stop"):
        self.status_code = status
        self.text = "" if status == 200 else "error body"
        body = {"choices": [{"message": {"content": content}, "finish_reason": finish}],
                "usage": {"prompt_tokens": 11, "completion_tokens": 7}}
        if model:
            body["model"] = model
        self._body = body

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


@pytest.fixture(autouse=True)
def _video_default_is_glm(monkeypatch):
    """ai_model_defaults('video') = GLM, with a fresh per-test cache."""
    monkeypatch.setattr(models_mod, "_use_case_defaults_cache", None)
    monkeypatch.setattr(
        models_mod, "_get_use_case_defaults_from_db",
        lambda: {"video": {"default": GLM_DEFAULT, "fallback": "minimax/minimax-m3", "free": None}},
    )


_PLAN = json.dumps({
    "tools": [{"name": "scrape_url", "enabled": False, "params": {}, "reason": "No URL."}],
    "config": {"mute_tts_on_source_clips": False, "source_clip_priority": "medium",
               "infographic_mode": "side", "narration_fit_to_source": False, "coverage_min_pct": 0},
    "explanation": "Plain explainer.",
})
_TYPE = json.dumps({"type": "tutorial", "confidence": 0.9, "reason": "how-to", "cadence_hint": "education"})
_REGEN = json.dumps({"intent": "full_remake", "patch_ops": [], "rationale": "layout change"})


# ---------------------------------------------------------------------------
# constants/models.py
# ---------------------------------------------------------------------------


def test_default_model_is_glm_and_fallback_registry_has_a_default_glm_row():
    assert models_mod.DEFAULT_MODEL == GLM_DEFAULT
    rows = {m.id: m for m in models_mod._get_fallback_models()}
    assert rows[GLM_DEFAULT].is_default is True
    assert rows[GLM_DEFAULT].input_price_per_1m == 0.027
    assert rows[GLM_DEFAULT].output_price_per_1m == 0.49
    assert rows[NON_GLM_FALLBACK].is_default is False
    assert [m.id for m in rows.values() if m.is_default] == [GLM_DEFAULT]
    # The dash-slug Opus row (priced 3x the real Opus 4.8) is gone.
    assert "anthropic/claude-opus-4-8" not in rows


def test_use_case_default_reads_the_db_row_and_caches_it(monkeypatch):
    calls = []

    def _read():
        calls.append(1)
        return {"video": {"default": "some/model", "fallback": None, "free": None}}

    monkeypatch.setattr(models_mod, "_get_use_case_defaults_from_db", _read)
    assert models_mod.get_use_case_default_model("video") == "some/model"
    assert models_mod.get_use_case_default_model("video") == "some/model"
    assert len(calls) == 1  # cached inside the TTL
    assert models_mod.get_use_case_default_model("missing") == GLM_DEFAULT
    assert models_mod.get_use_case_default_model("missing", "x/y") == "x/y"


def test_use_case_default_falls_back_to_glm_when_the_read_fails(monkeypatch):
    monkeypatch.setattr(models_mod, "_get_use_case_defaults_from_db", lambda: {})
    assert models_mod.get_use_case_default_model("video") == GLM_DEFAULT


def test_model_chain_is_primary_then_non_glm_fallback(monkeypatch):
    assert models_mod.get_use_case_model_chain("video") == [GLM_DEFAULT, NON_GLM_FALLBACK]
    assert models_mod.get_use_case_model_chain("video", "a/b") == ["a/b", NON_GLM_FALLBACK]
    # De-duplicated when the primary already is the fallback.
    assert models_mod.get_use_case_model_chain("video", NON_GLM_FALLBACK) == [NON_GLM_FALLBACK]

    def _boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(models_mod, "get_use_case_default_model", _boom)
    assert models_mod.get_use_case_model_chain("video") == [GLM_DEFAULT, NON_GLM_FALLBACK]


# ---------------------------------------------------------------------------
# Intent router
# ---------------------------------------------------------------------------


def _fake_post_chat(script, sent):
    """`script` maps model -> callable(payload) returning a _Resp (or raising)."""
    async def _post(client, payload, api_key=None, **kw):
        sent.append(payload)
        out = script[payload["model"]](payload)
        if asyncio.iscoroutine(out):
            out = await out
        return out
    return _post


def test_intent_router_sends_glm_low_effort_and_explicit_max_tokens(monkeypatch):
    sent = []
    monkeypatch.setattr(irs, "post_chat", _fake_post_chat({GLM_DEFAULT: lambda p: _Resp(_PLAN)}, sent))
    plan = asyncio.run(irs.IntentRouterService("key").route("explain photosynthesis"))
    assert plan.explanation == "Plain explainer."
    assert len(sent) == 1
    assert sent[0]["model"] == GLM_DEFAULT
    assert sent[0]["reasoning"] == {"effort": "low"}
    assert sent[0]["max_tokens"] >= 800


def test_intent_router_retries_once_on_fallback_after_an_error(monkeypatch):
    sent = []

    def _fail(p):
        raise RuntimeError("isoquant + openrouter down")

    monkeypatch.setattr(irs, "post_chat", _fake_post_chat(
        {GLM_DEFAULT: _fail, NON_GLM_FALLBACK: lambda p: _Resp(_PLAN)}, sent))
    plan = asyncio.run(irs.IntentRouterService("key").route("explain photosynthesis"))
    assert plan.explanation == "Plain explainer."
    assert [p["model"] for p in sent] == [GLM_DEFAULT, NON_GLM_FALLBACK]
    assert "reasoning" not in sent[1]  # Gemini Flash leg stays thinking-free


def test_intent_router_retries_on_empty_or_unparseable_content(monkeypatch):
    sent = []
    monkeypatch.setattr(irs, "post_chat", _fake_post_chat(
        {GLM_DEFAULT: lambda p: _Resp("", finish="length"), NON_GLM_FALLBACK: lambda p: _Resp(_PLAN)}, sent))
    assert asyncio.run(irs.IntentRouterService("key").route("x")).explanation == "Plain explainer."

    sent.clear()
    monkeypatch.setattr(irs, "post_chat", _fake_post_chat(
        {GLM_DEFAULT: lambda p: _Resp('{"tools": [ trunc'), NON_GLM_FALLBACK: lambda p: _Resp(_PLAN)}, sent))
    assert asyncio.run(irs.IntentRouterService("key").route("x")).explanation == "Plain explainer."
    assert [p["model"] for p in sent] == [GLM_DEFAULT, NON_GLM_FALLBACK]


def test_intent_router_slow_primary_still_fits_the_budget(monkeypatch):
    monkeypatch.setattr(irs, "_HTTP_TIMEOUT_S", 0.6)
    monkeypatch.setattr(irs, "_PRIMARY_TIMEOUT_S", 0.3)

    async def _hang(p):
        await asyncio.sleep(5)

    sent = []
    monkeypatch.setattr(irs, "post_chat", _fake_post_chat(
        {GLM_DEFAULT: _hang, NON_GLM_FALLBACK: lambda p: _Resp(_PLAN)}, sent))
    t0 = time.monotonic()
    plan = asyncio.run(irs.IntentRouterService("key").route("x"))
    assert time.monotonic() - t0 < 1.5
    assert plan.explanation == "Plain explainer."


def test_intent_router_both_legs_failing_returns_the_default_plan(monkeypatch):
    def _fail(p):
        raise RuntimeError("down")

    sent = []
    monkeypatch.setattr(irs, "post_chat", _fake_post_chat({GLM_DEFAULT: _fail, NON_GLM_FALLBACK: _fail}, sent))
    plan = asyncio.run(irs.IntentRouterService("key").route("x", urls_in_prompt=["https://a.b"]))
    assert plan.explanation == "Using default routing (router unavailable)."
    assert len(sent) == 2


# ---------------------------------------------------------------------------
# Video-type classifier
# ---------------------------------------------------------------------------


def test_classifier_uses_glm_low_effort_and_2000_tokens(monkeypatch):
    sent = []
    monkeypatch.setattr(vtc, "post_chat", _fake_post_chat({GLM_DEFAULT: lambda p: _Resp(_TYPE)}, sent))
    plan = asyncio.run(vtc.VideoTypeClassifierService("key").classify("how to set up git"))
    assert plan.type == "tutorial"
    assert sent[0]["model"] == GLM_DEFAULT
    assert sent[0]["reasoning"] == {"effort": "low"}
    assert sent[0]["max_tokens"] == 2000


def test_classifier_retries_on_fallback_when_glm_comes_back_empty(monkeypatch):
    sent = []
    monkeypatch.setattr(vtc, "post_chat", _fake_post_chat(
        {GLM_DEFAULT: lambda p: _Resp(None, finish="length"), NON_GLM_FALLBACK: lambda p: _Resp(_TYPE)}, sent))
    plan = asyncio.run(vtc.VideoTypeClassifierService("key").classify("how to set up git"))
    assert plan.type == "tutorial"
    assert [p["model"] for p in sent] == [GLM_DEFAULT, NON_GLM_FALLBACK]
    assert "reasoning" not in sent[1]


def test_classifier_slow_primary_still_fits_the_budget(monkeypatch):
    monkeypatch.setattr(vtc, "_HTTP_TIMEOUT_S", 0.6)
    monkeypatch.setattr(vtc, "_PRIMARY_TIMEOUT_S", 0.3)

    async def _hang(p):
        await asyncio.sleep(5)

    monkeypatch.setattr(vtc, "post_chat", _fake_post_chat(
        {GLM_DEFAULT: _hang, NON_GLM_FALLBACK: lambda p: _Resp(_TYPE)}, []))
    t0 = time.monotonic()
    plan = asyncio.run(vtc.VideoTypeClassifierService("key").classify("how to set up git"))
    assert time.monotonic() - t0 < 1.5
    assert plan.type == "tutorial"


# ---------------------------------------------------------------------------
# Regen intent classifier (sync, post_chat_sync)
# ---------------------------------------------------------------------------


def _fake_post_chat_sync(script, sent):
    def _post(payload, api_key=None, timeout=60.0):
        sent.append({**payload, "_timeout": timeout})
        return script[payload["model"]](payload)
    return _post


def test_regen_classifier_payload_has_glm_low_effort_and_max_tokens(monkeypatch):
    sent = []
    monkeypatch.setattr(llm_router, "post_chat_sync", _fake_post_chat_sync({GLM_DEFAULT: lambda p: _Resp(_REGEN)}, sent))
    out = ric.classify_intent(user_instruction="redesign it", shot_summary="s", openrouter_api_key="k")
    assert out["intent"] == "full_remake"
    assert sent[0]["model"] == GLM_DEFAULT
    assert sent[0]["reasoning"] == {"effort": "low"}
    assert sent[0]["max_tokens"] == 2000
    # The primary leg leaves room for the retry inside the 12 s budget.
    assert sent[0]["_timeout"] <= 12.0 * ric._PRIMARY_BUDGET_SHARE + 0.01


def test_regen_classifier_retries_on_fallback_after_non_200_or_bad_intent(monkeypatch):
    for primary in (lambda p: _Resp("", status=502), lambda p: _Resp('{"intent": "maybe"}')):
        sent = []
        monkeypatch.setattr(llm_router, "post_chat_sync", _fake_post_chat_sync(
            {GLM_DEFAULT: primary, NON_GLM_FALLBACK: lambda p: _Resp(_REGEN)}, sent))
        out = ric.classify_intent(user_instruction="redesign it", shot_summary="s", openrouter_api_key="k")
        assert out and out["intent"] == "full_remake"
        assert [p["model"] for p in sent] == [GLM_DEFAULT, NON_GLM_FALLBACK]
        assert "reasoning" not in sent[1]


def test_regen_classifier_hung_primary_is_cut_at_its_share_of_the_budget(monkeypatch):
    # Budget 3 s: GLM gets its 2 s share, the fallback the remaining ~1 s —
    # enough for the shared pool to pick it up under a loaded full-suite run
    # (0.9 s left it ~0.3 s and the leg sometimes never started). The hang
    # waits on an Event, not time.sleep: test_status_retry replaces the
    # global time.sleep with a no-op for the rest of a full-suite run.
    _never = threading.Event()

    def _hang(p):
        _never.wait(4)
        return _Resp(_REGEN)

    sent = []
    monkeypatch.setattr(llm_router, "post_chat_sync", _fake_post_chat_sync(
        {GLM_DEFAULT: _hang, NON_GLM_FALLBACK: lambda p: _Resp(_REGEN)}, sent))
    t0 = time.monotonic()
    out = ric.classify_intent(user_instruction="redesign", shot_summary="s", openrouter_api_key="k", timeout_s=3.0)
    assert time.monotonic() - t0 < 3.5
    assert out["intent"] == "full_remake"
    assert [p["model"] for p in sent] == [GLM_DEFAULT, NON_GLM_FALLBACK]


def test_regen_classifier_returns_none_when_both_legs_fail(monkeypatch):
    sent = []
    monkeypatch.setattr(llm_router, "post_chat_sync", _fake_post_chat_sync(
        {GLM_DEFAULT: lambda p: _Resp("", status=500), NON_GLM_FALLBACK: lambda p: _Resp("not json")}, sent))
    assert ric.classify_intent(user_instruction="x", shot_summary="s", openrouter_api_key="k") is None
    assert len(sent) == 2


# ---------------------------------------------------------------------------
# Reference-file image description
# ---------------------------------------------------------------------------


def test_reference_image_description_glm_then_fallback(monkeypatch, tmp_path):
    img = tmp_path / "logo.png"
    img.write_bytes(b"\x89PNG fake")
    svc = rfs.ReferenceFileService.__new__(rfs.ReferenceFileService)
    svc._openrouter_key = "k"

    sent = []

    def _fail(p):
        raise RuntimeError("400 images not supported")

    monkeypatch.setattr(llm_router, "post_chat_sync", _fake_post_chat_sync(
        {GLM_DEFAULT: _fail, NON_GLM_FALLBACK: lambda p: _Resp("[LOGO] a blue logo")}, sent))
    assert svc._describe_image(img, "logo.png") == "[LOGO] a blue logo"
    assert [p["model"] for p in sent] == [GLM_DEFAULT, NON_GLM_FALLBACK]
    assert sent[0]["reasoning"] == {"effort": "low"} and "reasoning" not in sent[1]
    assert sent[0]["max_tokens"] >= 1000
    assert sent[0]["_timeout"] <= rfs._VISION_PRIMARY_TIMEOUT_S

    sent.clear()
    monkeypatch.setattr(llm_router, "post_chat_sync", _fake_post_chat_sync(
        {GLM_DEFAULT: lambda p: _Resp("[PHOTO] x")}, sent))
    assert svc._describe_image(img, "logo.png") == "[PHOTO] x"
    assert len(sent) == 1


def test_reference_image_description_placeholder_when_both_fail(monkeypatch, tmp_path):
    img = tmp_path / "a.png"
    img.write_bytes(b"x")
    svc = rfs.ReferenceFileService.__new__(rfs.ReferenceFileService)
    svc._openrouter_key = "k"
    monkeypatch.setattr(llm_router, "post_chat_sync", _fake_post_chat_sync(
        {GLM_DEFAULT: lambda p: _Resp("", status=500), NON_GLM_FALLBACK: lambda p: _Resp("")}, []))
    assert svc._describe_image(img, "a.png") == "[Image: a.png — description unavailable]"


# ---------------------------------------------------------------------------
# KB Companions bill under the registry id
# ---------------------------------------------------------------------------


def test_kb_companion_records_the_registry_id_not_the_wire_id(monkeypatch):
    from types import SimpleNamespace

    from app.services.kb_companion import llm

    monkeypatch.setattr(llm, "get_settings", lambda: SimpleNamespace(openrouter_api_key="k"))

    async def _post(client, payload, api_key=None, **kw):
        return _Resp("hello", model="glm-5.3-flash")  # Isoquant's echoed wire id

    monkeypatch.setattr(llm, "post_chat", _post)
    res = asyncio.run(llm._call(GLM_DEFAULT, [{"role": "user", "content": "hi"}],
                                max_tokens=100, temperature=0.1, json_mode=False))
    assert res.model == GLM_DEFAULT
    assert res.extra == {"response_model": "glm-5.3-flash"}
    assert (res.prompt_tokens, res.completion_tokens) == (11, 7)
