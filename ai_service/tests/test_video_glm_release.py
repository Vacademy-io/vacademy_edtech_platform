"""Release 1: every AI-video LLM step runs on the registry's video model (GLM),
and every image and script-stage token reaches the bill.

What this guards, by the defect it replaced:

* QUALITY_TIERS named Opus (`concept_model`) and Gemini 2.5 Pro / Opus
  (`hero_shot_model`) as Python literals the DB matrix could not change - about
  70% of video LLM spend. Hero shots now think harder on the same model
  (Isoquant effort "max"; OpenRouter, which rejects "max", is sent "high").
* GLM's reasoning tokens count against max_tokens. Small calls (judges,
  rankers, the choreographer) at effort "high" stopped on "length" and re-ran
  at double the budget; they now think at "low" with room to finish.
* The v3 script stage returned no total_tokens, so the billing gate
  (`total_tokens > 0`) skipped every script-stage token.
* Images had no cost event: billed at a flat 0.3 credits under the LLM's model
  id, with the image API's tokens folded into the LLM token totals.

Run from the repo root:
    python -m pytest ai_service/tests/test_video_glm_release.py -q
"""
from __future__ import annotations

import __future__
import ast
import base64
import contextvars
import dataclasses
import functools
import io
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import pytest

HERE = Path(__file__).resolve().parent
PIPELINE_DIR = HERE.parent / "app" / "ai-video-gen-main"
PIPELINE = PIPELINE_DIR / "automation_pipeline.py"
sys.path.insert(0, str(PIPELINE_DIR))
sys.path.insert(0, str(HERE.parent.parent))

import cost_event_tracker as cet  # noqa: E402
import video_llm_reasoning as vlr  # noqa: E402

GLM = "z-ai/glm-5.3-flash"
_FUTURE = __future__.annotations.compiler_flag


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("VIDEO_REASONING_EFFORT", raising=False)


def _tree():
    return ast.parse(PIPELINE.read_text())


def _lift(names: Sequence[str], ns: Dict[str, Any], cls_methods: Optional[Dict[str, Sequence[str]]] = None):
    """Exec the named top-level defs/assignments (and named methods of named
    classes, wrapped in a bare shell class) from the pipeline source into `ns`.
    Importing automation_pipeline.py pulls in the whole renderer."""
    tree = _tree()
    body: List[ast.stmt] = []
    for name in names:
        for n in tree.body:
            if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name == name:
                body.append(n)
            elif isinstance(n, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == name for t in n.targets
            ):
                body.append(n)
            elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name) and n.target.id == name:
                body.append(n)
    for cls_name, methods in (cls_methods or {}).items():
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == cls_name)
        fns = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in methods]
        body.append(ast.ClassDef(name=cls_name, bases=[], keywords=[], body=fns, decorator_list=[]))
    mod = ast.fix_missing_locations(ast.Module(body=body, type_ignores=[]))
    exec(compile(mod, str(PIPELINE), "exec", flags=_FUTURE, dont_inherit=True), ns)
    return ns


def _base_ns() -> Dict[str, Any]:
    return {
        "json": json, "time": time, "base64": base64, "functools": functools, "urllib": urllib,
        "Any": Any, "Dict": Dict, "List": List, "Optional": Optional, "Sequence": Sequence,
        "Tuple": Tuple, "Callable": Callable,
        "_llm_stage": contextvars.ContextVar("_llm_stage", default="unknown"),
        "_llm_phase": contextvars.ContextVar("_llm_phase", default="base"),
        "_ROUTER_IMPORT_WARNED": False,
    }


# --------------------------------------------------------------------------
# Tier config: no model literals, GLM-sized budgets, hero effort
# --------------------------------------------------------------------------

def _quality_tiers() -> Dict[str, Dict[str, Any]]:
    tree = _tree()
    node = next(
        n for n in tree.body
        if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name) and n.target.id == "QUALITY_TIERS"
    )
    return eval(compile(ast.Expression(node.value), str(PIPELINE), "eval"),  # noqa: S307 - our own literal
                {"AI_VIDEO_PER_VIDEO_COST_CAP_USD": 24.0})


def test_no_tier_names_a_model():
    for tier, cfg in _quality_tiers().items():
        for key, value in cfg.items():
            assert key not in ("concept_model", "hero_shot_model", "preferred_script_model",
                               "preferred_shot_model"), (tier, key)
            if isinstance(value, str):
                for bad in ("opus", "claude", "gemini", "mimo", "/"):
                    assert bad not in value.lower(), (tier, key, value)


def test_concept_features_stay_on_for_premium_and_up():
    """concept_model doubled as a feature flag: dropping it without a
    replacement would have switched concept enforcement off on premium+."""
    tiers = _quality_tiers()
    for tier in ("premium", "ultra", "super_ultra"):
        assert tiers[tier].get("concept_enabled") is True, tier
    for tier in ("free", "standard"):
        assert not tiers[tier].get("concept_enabled"), tier


def test_every_tier_gives_a_shot_room_for_glm_reasoning():
    for tier, cfg in _quality_tiers().items():
        assert cfg.get("per_shot_max_tokens") == 24000, tier
    src = PIPELINE.read_text()
    assert '"per_shot_max_tokens", 16000)' not in src, "the .get default readers must follow"
    assert "_PER_SHOT_MAX_TOKENS = 24000" in src
    assert "_PER_SHOT_RETRY_MAX_TOKENS = 16000" in src
    assert "8000 if attempt > 0" not in src


def test_hero_effort_only_on_the_top_tiers():
    tiers = _quality_tiers()
    for tier in ("ultra", "super_ultra"):
        assert tiers[tier].get("hero_effort") == "max", tier
        assert tiers[tier].get("hero_max_tokens") == 24000, tier
    for tier in ("free", "standard", "premium"):
        assert "hero_effort" not in tiers[tier], tier


def test_no_gemini_pro_or_flash_literal_is_left_as_a_model_in_code():
    """The vision/judge/stock fallbacks named gemini-2.5-pro; with no stage
    map (single-shot, insert) they sent those calls to Gemini Pro."""
    for path in (PIPELINE, PIPELINE_DIR / "shot_visual_reviewer.py", PIPELINE_DIR / "shot_creativity_critic.py",
                 PIPELINE_DIR / "single_shot_generator.py"):
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            code = line.split("#", 1)[0]
            for bad in ('"google/gemini-2.5-pro"', '"google/gemini-3-flash-preview"',
                        '"xiaomi/mimo-v2-flash:free"', '"anthropic/claude-opus-4-8"'):
                assert bad not in code, f"{path.name}:{lineno}: {line.strip()}"
    # The one non-GLM model left in the pipeline is the clip-QC second opinion,
    # and it comes from the shared constant.
    src = PIPELINE.read_text()
    assert "_qc_attempts = ((model, 1500), (NON_GLM_FALLBACK, 800))" in src
    assert 'model = self._resolve_vision_stage_model("dialogue_clip_qc")' in src


def test_the_vision_banner_names_the_model_that_will_run():
    src = PIPELINE.read_text()
    assert "Vision review: model=google/gemini-2.5-pro" not in src
    assert 'f"      • Vision review: model={_vr_model}, cap=${cap:.2f}/run"' in src


def test_new_stages_read_their_own_rows():
    src = PIPELINE.read_text()
    for stage in ("edit_choreographer", "design_identity", "hero_shot"):
        assert f'_resolve_stage_model("{stage}")' in src, stage
    # Vision gates resolve to a model id, never None (see below).
    for stage in ("shot_creativity_critic", "stock_photo_ranking", "dialogue_clip_qc"):
        assert f'_resolve_vision_stage_model("{stage}")' in src, stage
        assert f'_resolve_stage_model("{stage}")' not in src, stage


def _vision_resolver(stage_map, registry_default):
    ns = _base_ns()
    ns["GLM_DEFAULT"] = GLM
    _lift([], ns,
          cls_methods={"VideoGenerationPipeline": ["_resolve_stage_model", "_resolve_vision_stage_model"]})
    pipe = object.__new__(ns["VideoGenerationPipeline"])
    pipe._stage_model_map = stage_map
    pipe.html_client = dataclasses.make_dataclass("C", ["use_case_default_model"])(registry_default)
    return pipe


def test_vision_gates_never_fall_through_to_the_users_model():
    """chat(model=None) resolves the enclosing stage row and then the user's
    video-wide pick before the registry default — a text-only or premium user
    model would run the critic / clip QC / visual stock ranking with images."""
    user_pick = {"per_shot_html": ("openai/text-only", "user_default")}
    pipe = _vision_resolver(user_pick, "z-ai/registry-video-default")
    for stage in ("shot_creativity_critic", "stock_photo_ranking", "dialogue_clip_qc", "vision_review"):
        assert pipe._resolve_vision_stage_model(stage) == "z-ai/registry-video-default"
    assert _vision_resolver({}, None)._resolve_vision_stage_model("dialogue_clip_qc") == GLM
    own = _vision_resolver({"shot_creativity_critic": ("x/vision", "matrix")}, "z-ai/d")
    assert own._resolve_vision_stage_model("shot_creativity_critic") == "x/vision"


def test_the_best_of_n_visual_judge_has_room_to_answer():
    src = PIPELINE.read_text()
    judge = src[src.index("_judge_model = self._resolve_vision_stage_model(\"vision_review\")"):][:900]
    assert "max_tokens=1500," in judge


# --------------------------------------------------------------------------
# Stage taxonomy
# --------------------------------------------------------------------------

def test_new_stage_ids_exist_and_are_not_user_overridable():
    from ai_service.app.constants import pipeline_stages as ps
    expected = {
        "HERO_SHOT": "hero_shot", "DESIGN_IDENTITY": "design_identity",
        "EDIT_CHOREOGRAPHER": "edit_choreographer", "SHOT_CREATIVITY_CRITIC": "shot_creativity_critic",
        "STOCK_PHOTO_RANKING": "stock_photo_ranking", "DIALOGUE_CLIP_QC": "dialogue_clip_qc",
    }
    for member, value in expected.items():
        stage = ps.PipelineStage[member]
        assert stage.value == value
        assert not ps.is_user_overridable(stage), member
        assert not ps.is_user_overridable(value), member
        assert stage in ps.STAGE_BUCKETS, member
    assert set(ps.STAGE_BUCKETS) == set(ps.PipelineStage), "every stage has a bucket"


# --------------------------------------------------------------------------
# Reasoning plan: override, small-call floor, never "max" to OpenRouter
# --------------------------------------------------------------------------

def test_a_normal_glm_call_thinks_at_high_with_its_own_ceiling():
    assert vlr.plan_reasoning(GLM, 24000) == ({"enabled": True, "effort": "high"}, None, 24000)


def test_a_small_glm_call_thinks_low_with_room_to_finish():
    for requested in (200, 300, 900, 1500, 3999):
        assert vlr.plan_reasoning(GLM, requested) == ({"enabled": True, "effort": "low"}, None, 4000)
    assert vlr.plan_reasoning(GLM, 4000).reasoning["effort"] == "high"


def test_max_goes_to_the_gateway_and_openrouter_gets_high():
    with vlr.video_effort("max"):
        plan = vlr.plan_reasoning(GLM, 24000)
    assert plan.reasoning == {"enabled": True, "effort": "high"}, "OpenRouter rejects max"
    assert plan.gateway_effort == "max"
    assert plan.max_tokens == 24000


def test_an_override_switches_the_small_call_floor_off():
    with vlr.video_effort("max"):
        assert vlr.plan_reasoning(GLM, 1500) == ({"enabled": True, "effort": "high"}, "max", 1500)
    with vlr.video_effort("low"):
        assert vlr.plan_reasoning(GLM, 24000) == ({"enabled": True, "effort": "low"}, None, 24000)


def test_the_override_is_scoped_and_unknown_levels_are_ignored():
    with vlr.video_effort("max"):
        with vlr.video_effort(None):
            assert vlr.effort_override() is None
        assert vlr.effort_override() == "max"
    assert vlr.effort_override() is None
    with vlr.video_effort("turbo"):
        assert vlr.effort_override() is None


def test_other_models_and_the_off_switch_are_left_alone(monkeypatch):
    with vlr.video_effort("max"):
        assert vlr.plan_reasoning("google/gemini-2.5-flash", 300) == (None, None, 300)
        monkeypatch.setenv("VIDEO_REASONING_EFFORT", "off")
        assert vlr.plan_reasoning(GLM, 300) == (None, None, 300)


def test_max_is_still_not_a_valid_configured_effort(monkeypatch):
    """Only the per-call override may ask for max; the env stays OpenRouter-safe."""
    monkeypatch.setenv("VIDEO_REASONING_EFFORT", "max")
    assert vlr.reasoning_for(GLM) == {"enabled": True, "effort": "high"}


# --------------------------------------------------------------------------
# The real client + router: what goes on the wire
# --------------------------------------------------------------------------

def _router(monkeypatch, routes):
    try:
        from ai_service.app.services import llm_router
    except Exception as exc:  # pragma: no cover - app deps not installed
        pytest.skip(f"ai_service app not importable here: {exc}")
    llm_router._FAILED_UNTIL.clear()
    monkeypatch.setattr(llm_router, "model_routes", lambda: llm_router.parse_routes(routes))
    spec = llm_router.ROUTERS["isoquant"]
    monkeypatch.setitem(llm_router.ROUTERS, "isoquant", dataclasses.replace(spec, api_key=lambda: "iq-key"))
    return llm_router


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _client(monkeypatch, routes, first_error=None, first_body=None):
    llm_router = _router(monkeypatch, routes)
    calls: List[Dict[str, Any]] = []

    def fake_urlopen(req, timeout=None):
        calls.append({"url": req.full_url, "body": json.loads(req.data.decode())})
        if len(calls) == 1 and first_error is not None:
            raise first_error
        if len(calls) == 1 and first_body is not None:
            return _Resp(json.dumps(first_body).encode())
        return _Resp(json.dumps({
            "choices": [{"message": {"content": "{\"ok\": true}"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }).encode())

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    ns = _base_ns()
    ns["_plan_reasoning"] = vlr.plan_reasoning
    _lift(["retry_with_backoff", "_normalize_stage_to_taxonomy", "_llm_router", "OpenRouterClient"], ns)
    client = object.__new__(ns["OpenRouterClient"])
    client.api_key = None
    client.default_model = GLM
    client.use_prompt_cache = False
    client.current_model = GLM
    client.cost_events = None
    client.stage_model_map = {}
    client.model_chain = []
    client.use_case_fallback_chain = []
    client.use_case_default_model = GLM
    client.base_url = "https://openrouter.ai/api/v1/chat/completions"
    client.headers = {"Authorization": "Bearer or", "Content-Type": "application/json"}
    assert ns["_llm_router"]() is llm_router
    return client, calls


ISOQUANT = {GLM: "isoquant"}


def test_a_hero_call_reaches_isoquant_at_max(monkeypatch):
    client, calls = _client(monkeypatch, ISOQUANT)
    with vlr.video_effort("max"):
        client.chat([{"role": "user", "content": "shot"}], model=GLM, max_tokens=24000)
    assert calls[0]["url"].startswith("https://api.isoquant.ai/")
    assert calls[0]["body"]["reasoning_effort"] == "max"
    assert "reasoning" not in calls[0]["body"]
    assert calls[0]["body"]["max_tokens"] == 24000


def test_a_hero_call_that_fails_over_sends_openrouter_high(monkeypatch):
    err = urllib.error.HTTPError("https://api.isoquant.ai/v1/chat/completions", 503, "down", {},
                                 io.BytesIO(b"{}"))
    client, calls = _client(monkeypatch, ISOQUANT, first_error=err)
    with vlr.video_effort("max"):
        client.chat([{"role": "user", "content": "shot"}], model=GLM, max_tokens=24000)
    assert len(calls) == 2
    assert calls[1]["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert calls[1]["body"]["reasoning"] == {"enabled": True, "effort": "high"}
    assert "reasoning_effort" not in calls[1]["body"]


def test_a_hero_call_left_on_openrouter_never_carries_max(monkeypatch):
    """Cooling-down gateway, no route, or an institute's own key: the call goes
    to OpenRouter directly, and "max" there would be a 400."""
    client, calls = _client(monkeypatch, {})
    with vlr.video_effort("max"):
        client.chat([{"role": "user", "content": "shot"}], model=GLM, max_tokens=24000)
    assert calls[0]["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert calls[0]["body"]["reasoning"] == {"enabled": True, "effort": "high"}


# GLM's usual cut-off: the reasoning filled the budget, content is empty and
# the thinking text comes back in `reasoning`. The salvage of that text must
# not overwrite the planned request setting the doubled-budget retry re-sends.
_CUT_OFF_IN_REASONING = {
    "choices": [{"message": {"content": "", "reasoning": "Let me think about the shot..."},
                 "finish_reason": "length"}],
    "usage": {},
}


def test_a_length_retry_on_openrouter_keeps_the_reasoning_setting(monkeypatch):
    client, calls = _client(monkeypatch, {}, first_body=_CUT_OFF_IN_REASONING)
    client.chat([{"role": "user", "content": "plan"}], model=GLM, max_tokens=16000)
    assert len(calls) == 2
    assert calls[1]["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert calls[1]["body"]["reasoning"] == {"enabled": True, "effort": "high"}
    assert calls[1]["body"]["max_tokens"] == 32000
    assert calls[1]["body"]["model"] == GLM


def test_a_length_retry_of_a_hero_call_stays_at_max_on_isoquant(monkeypatch):
    client, calls = _client(monkeypatch, ISOQUANT, first_body=_CUT_OFF_IN_REASONING)
    with vlr.video_effort("max"):
        client.chat([{"role": "user", "content": "shot"}], model=GLM, max_tokens=24000)
    assert len(calls) == 2
    assert calls[1]["url"].startswith("https://api.isoquant.ai/")
    assert calls[1]["body"]["reasoning_effort"] == "max"
    assert calls[1]["body"]["max_tokens"] == 48000


def test_a_small_call_goes_out_low_with_4000_tokens(monkeypatch):
    client, calls = _client(monkeypatch, ISOQUANT)
    client.chat([{"role": "user", "content": "judge"}], model=GLM, max_tokens=300)
    assert calls[0]["body"]["reasoning_effort"] == "low"
    assert calls[0]["body"]["max_tokens"] == 4000


def test_a_normal_call_is_unchanged(monkeypatch):
    client, calls = _client(monkeypatch, ISOQUANT)
    client.chat([{"role": "user", "content": "plan"}], model=GLM, max_tokens=32000)
    assert calls[0]["body"]["reasoning_effort"] == "high"
    assert calls[0]["body"]["max_tokens"] == 32000


# --------------------------------------------------------------------------
# Image cost events
# --------------------------------------------------------------------------

def test_record_image_keeps_the_old_signature_and_adds_purpose():
    t = cet.CostEventTracker()
    t.record_image("image_x", "recraft/recraft-v4.1")                       # old positional form
    t.record_image(stage="s", model="bytedance-seed/seedream-4.5", cost_usd=None, purpose="thumbnail")
    t.record_image(stage="s", model="recraft/recraft-v4.1", cost_usd=0.041, purpose="no-such-purpose")
    stages = t.build_report(video_id="v", tier="ultra", pipeline_version="v3")["stages"]
    assert [s["purpose"] for s in stages] == ["other", "thumbnail", "other"]
    assert [s["model"] for s in stages] == ["recraft/recraft-v4.1", "bytedance-seed/seedream-4.5",
                                            "recraft/recraft-v4.1"]
    assert "cost_usd" not in stages[1], "no reported cost → billing uses the unit price"
    assert stages[2]["cost_usd"] == 0.041
    # LLM events carry no purpose
    t.record_llm(stage="x", model=GLM, usage={"prompt_tokens": 1, "completion_tokens": 1})
    assert "purpose" not in t.build_report(video_id="v", tier="u", pipeline_version="v3")["stages"][-1]


class _Pipe:
    pass


def _image_pipeline(monkeypatch, response: Dict[str, Any]):
    calls: List[Dict[str, Any]] = []

    def fake_urlopen(req, timeout=None):
        calls.append(json.loads(req.data.decode()))
        return _Resp(json.dumps(response).encode())

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    ns = _base_ns()
    ns["_ImageGenRateLimitError"] = type("_ImageGenRateLimitError", (Exception,), {})
    _lift(["_RUN_TRACKER", "_image_cost_usd", "_record_image_cost_event", "_IMAGE_RESOLVER_MODULE",
           "_image_model_for", "VIDEO_IMAGE_USE_CASE", "VIDEO_IMAGE_DEFAULT",
           "_OPENROUTER_IMAGES_API_URL", "_IMAGES_API_MODEL_PREFIXES", "_uses_images_api"], ns,
          {"VideoGenerationPipeline": ["_call_image_generation_llm", "_call_openrouter_images_api"]})
    ns["_IMAGE_RESOLVER_MODULE"] = None  # no registry here: the 'video_image' literal default
    pipe = object.__new__(ns["VideoGenerationPipeline"])
    pipe.video_width, pipe.video_height = 1920, 1080
    pipe.script_client = type("C", (), {"api_key": "or-key"})()
    pipe._enforce_image_orientation = lambda b, *a, **k: b
    pipe._cost_events = cet.CostEventTracker()
    return pipe, calls


_PNG = base64.b64encode(b"\x89PNG fake").decode()


def _image_response(cost=None):
    usage: Dict[str, Any] = {"prompt_tokens": 7, "completion_tokens": 4000}
    if cost is not None:
        usage["cost"] = cost
    return {"choices": [{"message": {"images": [{"image_url": {"url": f"data:image/png;base64,{_PNG}"}}]}}],
            "usage": usage}


def test_each_generated_image_records_one_event_with_the_real_model_and_cost(monkeypatch):
    pipe, calls = _image_pipeline(monkeypatch, _image_response(cost=0.0398))
    img, usage = pipe._call_image_generation_llm("a cat", purpose="support_visual",
                                                 model_override="bytedance-seed/seedream-4.5")
    assert img == base64.b64decode(_PNG)
    assert calls[0]["usage"] == {"include": True}, "ask OpenRouter for the real cost"
    (ev,) = pipe._cost_events.build_report(video_id="v", tier="t", pipeline_version="v3")["stages"]
    assert ev["kind"] == "image" and ev["model"] == "bytedance-seed/seedream-4.5"
    assert ev["purpose"] == "support_visual" and ev["cost_usd"] == 0.0398
    assert "prompt_tokens" not in ev, "image-API tokens are not LLM tokens"


def test_the_default_model_and_purpose(monkeypatch):
    pipe, _ = _image_pipeline(monkeypatch, _image_response())
    pipe._call_image_generation_llm("a dog")
    (ev,) = pipe._cost_events.build_report(video_id="v", tier="t", pipeline_version="v3")["stages"]
    assert ev["model"] == "recraft/recraft-v4.1" and ev["purpose"] == "other"
    assert "cost_usd" not in ev


def test_an_explicit_tracker_wins_and_none_records_nowhere(monkeypatch):
    """The thumbnail thread binds the tracker of ITS stage: run() swaps
    self._cost_events per stage, so a late read would book it on the next one."""
    pipe, _ = _image_pipeline(monkeypatch, _image_response(cost=0.04))
    own = cet.CostEventTracker()
    pipe._call_image_generation_llm("thumb", purpose="thumbnail", cost_events=own)
    pipe._call_image_generation_llm("thumb", purpose="thumbnail", cost_events=None)
    assert own.event_count == 1
    assert pipe._cost_events.event_count == 0


def test_a_failed_generation_records_nothing(monkeypatch):
    pipe, _ = _image_pipeline(monkeypatch, {"choices": [{"message": {}}], "usage": {}})
    assert pipe._call_image_generation_llm("nothing") == (None, None)
    assert pipe._cost_events.event_count == 0


# --------------------------------------------------------------------------
# Super-admin image models + OpenRouter's /api/v1/images (Qwen)
# --------------------------------------------------------------------------

QWEN = "qwen/qwen-image-2.1-turbo"


def _images_api_response(cost=0.0184):
    return {"created": 1, "data": [{"b64_json": _PNG, "media_type": "image/png"}],
            "usage": {"prompt_tokens": 17, "completion_tokens": 4175, "cost": cost}}


def _routed_pipeline(monkeypatch, responses: Dict[str, Any], admin_model: Optional[str] = None):
    """Pipeline whose fake urlopen answers by URL; `admin_model` is what the
    super-admin 'video_image' row returns (None = no registry)."""
    pipe, _ = _image_pipeline(monkeypatch, _image_response())
    seen: List[Tuple[str, Dict[str, Any]]] = []

    def fake_urlopen(req, timeout=None):
        body = json.loads(req.data.decode())
        seen.append((req.full_url, body))
        resp = responses[req.full_url]
        if isinstance(resp, Exception):
            raise resp
        return _Resp(json.dumps(resp).encode())

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    ns = pipe._call_image_generation_llm.__func__.__globals__
    if admin_model is not None:
        ns["_IMAGE_RESOLVER_MODULE"] = type("R", (), {"image_model_for": staticmethod(
            lambda use_case, hard_default: admin_model if use_case == "video_image" else hard_default)})
    return pipe, seen


CHAT = "https://openrouter.ai/api/v1/chat/completions"
IMAGES = "https://openrouter.ai/api/v1/images"


def test_the_admin_video_image_model_is_used_and_qwen_goes_to_the_images_api(monkeypatch):
    pipe, seen = _routed_pipeline(monkeypatch, {IMAGES: _images_api_response()}, admin_model=QWEN)
    img, usage = pipe._call_image_generation_llm("a resume", purpose="keyframe")
    assert img == base64.b64decode(_PNG)
    ((url, body),) = seen
    assert url == IMAGES and body["model"] == QWEN
    assert body["aspect_ratio"] == "16:9" and body["usage"] == {"include": True}
    (ev,) = pipe._cost_events.build_report(video_id="v", tier="t", pipeline_version="v3")["stages"]
    assert ev["model"] == QWEN and ev["cost_usd"] == 0.0184, "billed at Qwen's real cost"


def test_a_support_visual_override_to_qwen_also_uses_the_images_api(monkeypatch):
    pipe, seen = _routed_pipeline(monkeypatch, {IMAGES: _images_api_response()})
    pipe._call_image_generation_llm("a desk", model_override=QWEN, purpose="support_visual",
                                    fallback_model="bytedance-seed/seedream-4.5")
    assert [u for u, _ in seen] == [IMAGES]


def test_a_reference_image_cannot_go_to_the_images_api_so_it_uses_the_fallback(monkeypatch):
    pipe, seen = _routed_pipeline(monkeypatch, {CHAT: _image_response(cost=0.04)}, admin_model=QWEN)
    pipe._call_image_generation_llm("same person, new pose", reference_image_url="https://x/ref.png")
    ((url, body),) = seen
    assert url == CHAT and body["model"] == "recraft/recraft-v4.1"


def test_an_empty_or_failed_images_api_call_falls_back_on_chat(monkeypatch):
    for bad in ({"data": [], "usage": {}},
                urllib.error.HTTPError(IMAGES, 400, "bad request", {}, None)):
        pipe, seen = _routed_pipeline(monkeypatch, {IMAGES: bad, CHAT: _image_response(cost=0.04)})
        img, _ = pipe._call_image_generation_llm("a desk", model_override=QWEN,
                                                 fallback_model="bytedance-seed/seedream-4.5")
        assert img is not None
        assert [(u, b["model"]) for u, b in seen] == [(IMAGES, QWEN), (CHAT, "bytedance-seed/seedream-4.5")]
        (ev,) = pipe._cost_events.build_report(video_id="v", tier="t", pipeline_version="v3")["stages"]
        assert ev["model"] == "bytedance-seed/seedream-4.5", "only the image that was made is billed"


def test_a_rate_limited_images_api_call_signals_the_caller(monkeypatch):
    pipe, _ = _routed_pipeline(
        monkeypatch, {IMAGES: urllib.error.HTTPError(IMAGES, 429, "slow down", {"Retry-After": "3"}, None)})
    err = pipe._call_image_generation_llm.__func__.__globals__["_ImageGenRateLimitError"]
    with pytest.raises(err):
        pipe._call_image_generation_llm("a desk", model_override=QWEN)


def test_chat_image_models_stay_on_chat(monkeypatch):
    pipe, seen = _routed_pipeline(monkeypatch, {CHAT: _image_response()},
                                  admin_model="bytedance-seed/seedream-4.5")
    pipe._call_image_generation_llm("a desk")
    assert [(u, b["model"]) for u, b in seen] == [(CHAT, "bytedance-seed/seedream-4.5")]


def test_a_broken_settings_read_keeps_the_literal_default():
    ns = _lift(["_IMAGE_RESOLVER_MODULE", "_image_model_for"], _base_ns())

    def boom(*a, **k):
        raise RuntimeError("db down")

    ns["_IMAGE_RESOLVER_MODULE"] = type("R", (), {"image_model_for": staticmethod(boom)})
    assert ns["_image_model_for"]("video_image", "recraft/recraft-v4.1") == "recraft/recraft-v4.1"
    ns["_IMAGE_RESOLVER_MODULE"] = None
    assert ns["_image_model_for"]("video_support_visual", "x") == "x"


def test_support_visuals_read_the_admin_row_not_a_literal():
    src = PIPELINE.read_text()
    body = src[src.index("def _resolve_support_visuals("):]
    body = body[: body.index("\n    def ", 10)]
    assert "_image_model_for(VIDEO_SUPPORT_VISUAL_USE_CASE, VIDEO_SUPPORT_VISUAL_DEFAULT)" in body
    assert body.count("model_override=_sv_model") == 2
    assert '"bytedance-seed/seedream' not in body, "no hard-coded support-visual model"


def test_image_cost_parsing():
    ns = _lift(["_image_cost_usd"], _base_ns())
    f = ns["_image_cost_usd"]
    assert f({"cost": 0.04}) == 0.04
    assert f({"cost": "0.04"}) == 0.04
    for bad in (None, {}, {"cost": None}, {"cost": "x"}, {"cost": -1}, {"cost": True}):
        assert f(bad) is None, bad


def test_every_call_site_says_what_the_image_is_for():
    src = PIPELINE.read_text()
    for purpose, count in (("host_identity", 2), ("cast_sheet", 4), ("keyframe", 2),
                           ("support_visual", 2), ("thumbnail", 1), ("other", 1)):
        assert src.count(f'purpose="{purpose}"') >= count, purpose
    # thumbnails go through a partial that binds this stage's tracker
    assert "seedream_call=_thumb_image_call," in src
    thumb = src[src.index("_thumb_image_call = functools.partial("):][:300]
    assert 'cost_events=getattr(self, "_cost_events", None)' in thumb


def test_image_api_usage_is_not_folded_into_llm_tokens():
    src = PIPELINE.read_text()
    assert "self._v3_accumulate_partial_usage(sp_usage, _sf_usage)" not in src
    assert "usage_meta[k] = usage_meta.get(k, 0) + v" in src  # prompt enhancement only
    task = src[src.index("image_bytes, _image_usage = self._call_image_generation_llm(\n                    prompt,"):]
    assert "usage_meta: Dict[str, Any] = {}" in task[:1500]
    # pipelined images reach the stage usage (they were never billed)
    assert "accumulate_usage(_early_image_usage)" in src


# --------------------------------------------------------------------------
# Script-stage usage carries total_tokens
# --------------------------------------------------------------------------

def test_partial_usage_keeps_total_tokens_equal_to_prompt_plus_completion():
    ns = _lift([], _base_ns(), {"VideoGenerationPipeline": ["_v3_accumulate_partial_usage"]})
    acc = ns["VideoGenerationPipeline"]._v3_accumulate_partial_usage
    target: Dict[str, Any] = {}
    acc(target, {"prompt_tokens": 100, "completion_tokens": 40})
    acc(target, {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 0})
    assert target["total_tokens"] == 155
    assert (target["prompt_tokens"], target["completion_tokens"]) == (110, 45)


def test_the_v3_stage_usage_and_run_totals_include_total_tokens():
    src = PIPELINE.read_text()
    assert 'usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]' in src
    ret = src[src.index('            "token_usage": total_usage,') - 1500:]
    assert 'total_usage["total_tokens"] = (' in ret[:1500]


def test_a_rejected_concept_replan_is_still_billed():
    import shot_planner as sp

    plan = {"shots": [{"shot_index": 0, "shot_type": "KINETIC_TITLE", "narration_brief": "x",
                       "duration_estimate_s": 6}]}
    calls = []

    def llm_chat(messages, **kw):
        calls.append(kw)
        # Never conformant (no creative_concept) → the re-plan is rejected.
        return json.dumps(plan), {"prompt_tokens": 100, "completion_tokens": 20}

    out = sp.plan_shots(prompt="p", target_duration_s=30.0, llm_chat=llm_chat, model=GLM,
                        tier="ultra", enforce_concept=True)
    assert len(calls) == 2, "plan + one corrective re-plan"
    assert out["usage"]["prompt_tokens"] == 200 and out["usage"]["completion_tokens"] == 40
    assert out["usage"]["total_tokens"] == 240


def test_narration_writer_reports_total_tokens():
    import narration_writer as nw
    shots = [{"shot_index": 0, "shot_type": "KINETIC_TITLE", "narration_brief": "open",
              "audio_policy": "narration_only", "duration_estimate_s": 4.0}]

    def llm_chat(messages, **kw):
        return json.dumps({"shots": [{"shot_index": 0, "narration_text": "Hello there."}]}), \
            {"prompt_tokens": 30, "completion_tokens": 12}

    out = nw.write_narration(shot_plan={"shots": shots}, llm_chat=llm_chat, model=GLM,
                             target_duration_s=4.0, target_audience="general")
    assert out["usage"]["total_tokens"] == out["usage"]["prompt_tokens"] + out["usage"]["completion_tokens"]
    assert out["usage"]["total_tokens"] >= 42


# --------------------------------------------------------------------------
# Reviewer / critic: registry model, GLM-priced run caps
# --------------------------------------------------------------------------

def _no_registry(monkeypatch):
    monkeypatch.setitem(sys.modules, "ai_service.app.constants.models", None)
    monkeypatch.setitem(sys.modules, "app.constants.models", None)


def test_reviewer_and_critic_default_to_the_registry_model():
    import inspect
    import shot_creativity_critic as scc
    import shot_visual_reviewer as svr
    assert inspect.signature(svr.review_shot).parameters["model"].default is None
    assert inspect.signature(scc.critique_shot).parameters["model"].default is None


def test_review_cost_uses_glm_rates_when_the_registry_is_unreadable(monkeypatch):
    """At Gemini 2.5 Pro rates a GLM review looked ~10x dearer and tripped the
    per-run review cap early."""
    import shot_visual_reviewer as svr
    _no_registry(monkeypatch)
    assert svr.model_cost_per_m(None) == (0.027, 0.49)

    def chat(messages, **kw):
        return '{"passes": true, "issues": [], "severity_max": 0}', \
            {"prompt_tokens": 1_000_000, "completion_tokens": 1_000_000}

    rec = svr.review_shot(screenshots=[b"png"], shot={"shot_type": "X"}, shot_pack=None,
                          canvas="landscape", timestamps=[1.0], llm_chat=chat)
    assert rec["model"] is None
    assert rec["cost_usd"] == pytest.approx(0.517)


def test_review_cost_reads_the_registry_price_when_it_can(monkeypatch):
    import types
    import shot_visual_reviewer as svr
    fake = types.ModuleType("ai_service.app.constants.models")
    seen = []

    def get_model_pricing(model_id):
        seen.append(model_id)
        return {"input_token_price": 0.1 / 1e6, "output_token_price": 0.9 / 1e6}

    fake.get_model_pricing = get_model_pricing
    monkeypatch.setitem(sys.modules, "ai_service.app.constants.models", fake)
    assert svr.model_cost_per_m(None) == pytest.approx((0.1, 0.9))
    assert seen == [GLM], "no model = the registry's video default, GLM"


def test_critic_cost_uses_glm_rates(monkeypatch):
    import shot_creativity_critic as scc
    _no_registry(monkeypatch)

    def chat(messages, **kw):
        return ('{"scores": {"big_idea": 4, "motion_hook": 4, "beat_delivery": 4, '
                '"compositional_tension": 4}, "elevation_suggestion": "", "verdict": "ok"}'), \
            {"prompt_tokens": 1_000_000, "completion_tokens": 1_000_000}

    rec = scc.critique_shot(html="<div>x</div>", shot={"shot_type": "X"}, creative_concept={},
                            emotional_beat="", canvas="landscape", llm_chat=chat)
    assert rec["model"] is None
    assert rec["cost_usd"] == pytest.approx(0.517)


def test_a_model_less_call_is_priced_as_the_registry_default(monkeypatch):
    """With no stage map the best-of-N judge passes model=None; pricing that at
    the $3/$15 fallback tripped the best-of-N run cap on GLM runs."""
    import types
    fake = types.ModuleType("constants.models")
    seen = []

    def get_model_pricing(model_id):
        seen.append(model_id)
        return {"input_token_price": 0.027 / 1e6, "output_token_price": 0.49 / 1e6}

    fake.get_model_pricing = get_model_pricing
    monkeypatch.setitem(sys.modules, "constants.models", fake)
    ns = _base_ns()
    ns["GLM_DEFAULT"] = GLM
    _lift([], ns, {"VideoGenerationPipeline": ["_estimate_llm_cost_usd"]})
    pipe = object.__new__(ns["VideoGenerationPipeline"])
    pipe.html_client = type("C", (), {"use_case_default_model": GLM})()
    cost = pipe._estimate_llm_cost_usd({"prompt_tokens": 1_000_000, "completion_tokens": 1_000_000}, None)
    assert seen == [GLM]
    assert cost == pytest.approx(0.517)
