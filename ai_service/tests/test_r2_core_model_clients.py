"""Release 2 (B1): every core LLM client reads its model from the DB-backed use
case, GLM by default, with a vendor-diverse failover — and explicit
user/institute picks keep winning.

Run from the repo root:
    <venv>/bin/python -m pytest ai_service/tests/test_r2_core_model_clients.py -q
No DB and no network: the resolver and HTTP are stubbed.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("OPENROUTER_API_KEY", "or-platform")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import httpx  # noqa: E402
import pytest  # noqa: E402

from ai_service.app.constants.model_defaults import GLM_DEFAULT, NON_GLM_FALLBACK  # noqa: E402
from ai_service.app.services import chat_llm_client as clc  # noqa: E402
from ai_service.app.services import llm_router  # noqa: E402
from ai_service.app.services import model_selection  # noqa: E402
from ai_service.app.services.chat_llm_client import ChatLLMClient  # noqa: E402

GLM = GLM_DEFAULT
GEMINI = NON_GLM_FALLBACK


@pytest.fixture(autouse=True)
def _no_routes_no_broken():
    """Everything on OpenRouter (one URL), no model marked broken."""
    saved = llm_router.model_routes
    llm_router.model_routes = lambda: llm_router.parse_routes({})
    clc._BROKEN_UNTIL.clear()
    yield
    llm_router.model_routes = saved
    clc._BROKEN_UNTIL.clear()


def _transport(handler):
    calls = []

    def wrapped(request: httpx.Request):
        calls.append(json.loads(request.content or b"{}"))
        return handler(request)

    return httpx.MockTransport(wrapped), calls


def _completion(model, content="ok"):
    return {"model": model, "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4}}


class _Resolver:
    def __init__(self, model=GLM):
        self.model = model

    def resolve_keys(self, **_):
        return "or-platform", None, self.model


def _client(handler, model=GLM):
    transport, calls = _transport(handler)
    client = ChatLLMClient(_Resolver(model))
    client.http_client = httpx.AsyncClient(transport=transport)
    return client, calls


# ---------------------------------------------------------------- config / env


def test_config_defaults_are_glm_with_a_non_glm_fallback():
    import subprocess

    env = {k: v for k, v in os.environ.items() if k not in ("LLM_DEFAULT_MODEL", "LLM_FALLBACK_MODEL")}
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(Path(__file__).resolve().parents[2]), env.get("PYTHONPATH")]))
    out = subprocess.run(
        [sys.executable, "-c",
         "from ai_service.app.config import Settings; s = Settings(); "
         "print(s.llm_default_model); print(s.llm_fallback_model)"],
        env=env, capture_output=True, text=True, check=True,
    ).stdout.split()
    assert out == [GLM, GEMINI]


def test_deploy_workflow_sets_glm_default_and_fallback_together():
    wf = (Path(__file__).resolve().parents[2] / ".github/workflows/docker-publish-ai-service.yml").read_text()
    assert "LLM_DEFAULT_MODEL=z-ai/glm-5.3-flash" in wf
    assert "LLM_FALLBACK_MODEL=google/gemini-2.5-flash" in wf
    assert "LLM_DEFAULT_MODEL=google/gemini-2.5-flash" not in wf


# --------------------------------------------------------- ChatLLMClient chain


def _settings(default=GLM, fallback=GEMINI):
    return SimpleNamespace(llm_default_model=default, llm_fallback_model=fallback)


def test_fallback_model_is_llm_fallback_model_not_the_glm_default(monkeypatch):
    monkeypatch.setattr("ai_service.app.config.get_settings", lambda: _settings())
    assert ChatLLMClient._fallback_model_for(GLM, None) == GEMINI
    # The failing model IS the fallback model: fall to the default instead.
    assert ChatLLMClient._fallback_model_for(GEMINI, None) == GLM
    # An explicit pick without a chain still fails loudly.
    assert ChatLLMClient._fallback_model_for(GLM, GLM) is None


def test_explicit_model_fails_over_through_fallback_models():
    def handler(request):
        body = json.loads(request.content)
        if body["model"] == GLM:
            return httpx.Response(400, json={"error": {"message": "nope"}})
        return httpx.Response(200, json=_completion(body["model"], "from fallback"))

    client, calls = _client(handler)
    out = asyncio.run(client.chat_completion(
        [{"role": "user", "content": "hi"}], model=GLM, fallback_models=[GLM, GEMINI],
    ))
    assert out["content"] == "from fallback" and out["fallback_from"] == GLM
    assert [c["model"] for c in calls] == [GLM, GEMINI]


def test_explicit_model_without_chain_does_not_fail_over():
    client, calls = _client(lambda r: httpx.Response(400, json={"error": {"message": "nope"}}))
    with pytest.raises(Exception):
        asyncio.run(client.chat_completion([{"role": "user", "content": "hi"}], model=GLM))
    assert {c["model"] for c in calls} == {GLM}


def test_implicit_model_fails_over_to_llm_fallback_model(monkeypatch):
    monkeypatch.setattr("ai_service.app.config.get_settings", lambda: _settings())

    def handler(request):
        body = json.loads(request.content)
        if body["model"] == GLM:
            return httpx.Response(400, json={"error": {"message": "nope"}})
        return httpx.Response(200, json=_completion(body["model"]))

    client, calls = _client(handler)
    out = asyncio.run(client.chat_completion([{"role": "user", "content": "hi"}]))
    assert out["model"] == GEMINI and calls[-1]["model"] == GEMINI


def test_whole_chain_is_walked_in_order():
    def handler(request):
        body = json.loads(request.content)
        if body["model"] != "third/model":
            return httpx.Response(400, json={"error": {"message": "nope"}})
        return httpx.Response(200, json=_completion(body["model"]))

    client, calls = _client(handler)
    out = asyncio.run(client.chat_completion(
        [{"role": "user", "content": "hi"}], model=GLM, fallback_models=[GEMINI, "third/model"],
    ))
    assert out["model"] == "third/model"
    assert [c["model"] for c in calls] == [GLM, GEMINI, "third/model"]


# ------------------------------------------------------------------- streaming

_SSE_USAGE_BEFORE_DONE = (
    b'data: {"choices":[{"delta":{"content":"he"}}]}\n\n'
    b'data: {"choices":[{"delta":{"content":"y"}}]}\n\n'
    b'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":2},"model":"x"}\n\n'
    b'data: [DONE]\n\n'
)


def _collect(gen):
    async def run():
        return [c async for c in gen]
    return asyncio.run(run())


def test_stream_emits_exactly_one_done_carrying_the_usage():
    client, _ = _client(lambda r: httpx.Response(200, content=_SSE_USAGE_BEFORE_DONE))
    chunks = _collect(client.chat_completion_stream([{"role": "user", "content": "hi"}]))
    done = [c for c in chunks if c["type"] == "done"]
    assert len(done) == 1, done
    assert done[0]["usage"] == {"prompt_tokens": 2, "completion_tokens": 2}
    # Consumers keep the LAST done (assistant_service / ai_chat_agent_service).
    assert chunks[-1]["type"] == "done" and chunks[-1]["usage"]


def test_stream_usage_on_a_choice_chunk_is_kept_too():
    sse = (b'data: {"choices":[{"delta":{"content":"a"}}]}\n\n'
           b'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n'
           b'data: [DONE]\n\n')
    client, _ = _client(lambda r: httpx.Response(200, content=sse))
    chunks = _collect(client.chat_completion_stream([{"role": "user", "content": "hi"}]))
    done = [c for c in chunks if c["type"] == "done"]
    assert len(done) == 1 and done[0]["usage"]["prompt_tokens"] == 5


def test_stream_without_done_marker_still_hands_over_tool_calls_and_usage():
    sse = (b'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t1","function":{"name":"f","arguments":"{}"}}]}}]}\n\n'
           b'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n')
    client, _ = _client(lambda r: httpx.Response(200, content=sse))
    chunks = _collect(client.chat_completion_stream([{"role": "user", "content": "hi"}]))
    assert [c["type"] for c in chunks] == ["tool_calls", "done"]
    assert chunks[1]["usage"] == {"prompt_tokens": 1, "completion_tokens": 1}


def test_stream_honours_explicit_model_over_the_resolver():
    client, calls = _client(lambda r: httpx.Response(200, content=_SSE_USAGE_BEFORE_DONE), model=GEMINI)
    chunks = _collect(client.chat_completion_stream([{"role": "user", "content": "hi"}], model=GLM))
    assert calls[0]["model"] == GLM
    # OpenRouter echoes the served id in the usage chunk; that is what bills.
    assert [c for c in chunks if c["type"] == "done"][0]["model"] == "x"


def test_stream_broken_model_streams_with_first_fallback():
    clc.mark_model_broken(GLM)
    client, calls = _client(lambda r: httpx.Response(200, content=_SSE_USAGE_BEFORE_DONE))
    _collect(client.chat_completion_stream(
        [{"role": "user", "content": "hi"}], model=GLM, fallback_models=[GEMINI],
    ))
    assert calls[0]["model"] == GEMINI


def test_stream_failure_falls_back_to_non_streaming_chain():
    def handler(request):
        body = json.loads(request.content)
        if body["model"] == GLM:
            return httpx.Response(400, json={"error": {"message": "nope"}})
        return httpx.Response(200, json=_completion(body["model"], "rescued"))

    client, calls = _client(handler)
    chunks = _collect(client.chat_completion_stream(
        [{"role": "user", "content": "hi"}], model=GLM, fallback_models=[GEMINI],
    ))
    assert "".join(c.get("content", "") for c in chunks if c["type"] == "token") == "rescued"
    assert calls[-1]["model"] == GEMINI


def test_dead_mimo_param_defaults_are_gone():
    src = Path(clc.__file__).read_text()
    assert "mimo" not in src


# --------------------------------------------------------------- ApiKeyResolver


class _Repo:
    def __init__(self, user=None, institute=None):
        self.user, self.institute = user, institute

    def get_keys_for_user(self, *_):
        return self.user

    def get_keys_for_institute(self, *_):
        return self.institute


INST = "c3149e00-0000-4000-8000-000000000001"
USER = "70013056-0000-4000-8000-000000000002"


def _resolver(monkeypatch, repo=None, platform_default=GLM, platform_setting=None):
    from ai_service.app.services import api_key_resolver as akr

    seen = []

    def fake_resolve(db, use_case, preferred_model=None, **_):
        seen.append(use_case)
        return platform_default, [GEMINI]

    monkeypatch.setattr(model_selection, "resolve_models", fake_resolve)
    monkeypatch.setattr(
        "ai_service.app.services.platform_settings_service.get_platform_setting",
        lambda key, default=None, db=None: platform_setting,
    )
    r = akr.ApiKeyResolver.__new__(akr.ApiKeyResolver)
    r._session = object()
    r._repository = repo or _Repo()
    r._settings = SimpleNamespace(openrouter_api_key="or", gemini_api_key=None, llm_default_model="env/model")
    return r, seen


def test_base_tier_is_the_platform_default_use_case_not_env(monkeypatch):
    r, seen = _resolver(monkeypatch, platform_default="portal/model")
    assert r.resolve_keys(INST)[2] == "portal/model"
    assert seen == ["platform_default"]


def test_platform_setting_key_beats_the_use_case(monkeypatch):
    r, seen = _resolver(monkeypatch, platform_setting="setting/model")
    assert r.resolve_keys(INST, platform_default_key="chatbot.text.model")[2] == "setting/model"
    assert seen == [], "no use-case read when the platform setting answered"


def test_institute_and_user_picks_and_request_model_still_win(monkeypatch):
    repo = _Repo(institute=SimpleNamespace(openai_key=None, gemini_key=None, default_model="inst/model"))
    r, _ = _resolver(monkeypatch, repo=repo)
    assert r.resolve_keys(INST)[2] == "inst/model"
    assert r.resolve_keys(INST, request_model="req/model")[2] == "req/model"
    repo.user = SimpleNamespace(openai_key="own", gemini_key=None, default_model="user/model")
    keys = r.resolve_keys(INST, user_id=USER)
    assert keys[0] == "own" and keys[2] == "user/model"


def test_resolver_failure_keeps_env_as_last_resort(monkeypatch):
    r, _ = _resolver(monkeypatch)

    def boom(*_a, **_k):
        raise RuntimeError("db down")

    monkeypatch.setattr(model_selection, "resolve_models", boom)
    assert r.resolve_keys(INST)[2] == "env/model"


def test_byo_default_model_helper(monkeypatch):
    repo = _Repo(institute=SimpleNamespace(default_model="inst/model"))
    r, _ = _resolver(monkeypatch, repo=repo)
    assert r.byo_default_model(INST) == "inst/model"
    repo.user = SimpleNamespace(default_model=None)
    assert r.byo_default_model(INST, USER) is None, "a user row hides the institute row"
    assert r.byo_default_model("not-a-uuid") is None
    repo.user, repo.institute = None, SimpleNamespace(default_model="auto")
    assert r.byo_default_model(INST) is None


# ------------------------------------------------------------- quiz / routers


class _RecordingLLM:
    def __init__(self, content='{"title":"T","questions":[{"question":"Q?","options":["a","b","c","d"],"correct_answer_index":0}]}',
                 answered_by=None):
        self.kwargs = None
        self.content = content
        self.answered_by = answered_by

    async def chat_completion(self, **kwargs):
        self.kwargs = kwargs
        return {"content": self.content, "usage": {}, "model": self.answered_by or kwargs.get("model")}


def test_assessment_from_transcript_really_uses_the_resolved_model_and_chain():
    from ai_service.app.services.quiz_service import QuizService

    llm = _RecordingLLM(answered_by=GEMINI)
    out = asyncio.run(QuizService(llm).generate_assessment_from_transcript(
        "transcript", model=GLM, fallback_models=[GEMINI],
    ))
    assert llm.kwargs["model"] == GLM and llm.kwargs["fallback_models"] == [GEMINI]
    assert out["model_used"] == GEMINI, "bill the model that answered"


def test_assessment_max_tokens_is_capped_for_reasoning_models():
    from ai_service.app.services.quiz_service import QuizService

    llm = _RecordingLLM()
    asyncio.run(QuizService(llm).generate_assessment_from_transcript("t", model=GLM))
    glm_cap = llm.kwargs["max_tokens"]
    with_allowance = clc.apply_reasoning_mode({"max_tokens": glm_cap}, "on-low")["max_tokens"]
    assert with_allowance <= 32768, with_allowance
    asyncio.run(QuizService(llm).generate_assessment_from_transcript("t", model=GEMINI))
    assert llm.kwargs["max_tokens"] == 32768


def test_router_fallback_constants_are_glm():
    pytest.importorskip("fastapi")
    from ai_service.app.routers import assessment_generation, coding_question_gen

    assert assessment_generation.FALLBACK_MODEL == GLM
    assert coding_question_gen.FALLBACK_MODEL == GLM


# ---------------------------------------------------------------- outline path


def test_outline_prompt_carries_no_model_hints():
    src = (Path(__file__).resolve().parents[1] / "app/services/prompt_builder.py").read_text()
    assert "gemini" not in src and '"model":' not in src and "`model`" not in src


def test_adapter_model_less_call_runs_the_chat_use_case_chain(monkeypatch):
    from ai_service.app.adapters.openrouter_llm_client import OpenRouterOutlineLLMClient

    asked = []

    def fake_sync(use_case, *a, **k):
        asked.append(use_case)
        return GLM, [GEMINI]

    monkeypatch.setattr(model_selection, "resolve_model_sync", fake_sync)
    tried = []

    async def fake_post(client, payload, api_key):
        tried.append(payload["model"])
        if payload["model"] == GLM:
            return httpx.Response(500, json={}, request=httpx.Request("POST", "http://x"))
        return httpx.Response(200, json=_completion(payload["model"], "outline"), request=httpx.Request("POST", "http://x"))

    monkeypatch.setattr("ai_service.app.adapters.openrouter_llm_client.post_chat", fake_post)
    client = OpenRouterOutlineLLMClient(api_key="k")
    content, usage = asyncio.run(client.generate_outline_with_usage("p", None))
    assert content == "outline" and tried == [GLM, GEMINI] and asked == ["chat"]

    asked.clear(), tried.clear()
    asyncio.run(client.generate_outline_with_usage("p", None, use_case="outline"))
    assert asked == ["outline"]

    asked.clear(), tried.clear()
    asyncio.run(client.generate_outline_with_usage("p", "user/pick", fallback_models=[GEMINI]))
    assert asked == [] and tried == ["user/pick"], "an explicit pick is honoured (it answered)"


def test_outline_service_resolves_the_outline_use_case(monkeypatch):
    pytest.importorskip("boto3")
    from ai_service.app.services import course_outline_service as cos

    calls = []

    def fake_resolve(db, use_case, preferred_model=None, **_):
        calls.append((use_case, preferred_model))
        return (preferred_model or "outline/default"), [GEMINI]

    monkeypatch.setattr(model_selection, "resolve_models", fake_resolve)

    class _AKR:
        def __init__(self, db):
            pass

        def resolve_keys(self, **_):
            return "or", "gm", "ignored/model"

        def byo_default_model(self, *_):
            return byo["model"]

    byo = {"model": None}
    monkeypatch.setattr(cos, "ApiKeyResolver", _AKR)
    svc = cos.CourseOutlineGenerationService.__new__(cos.CourseOutlineGenerationService)
    svc._db_session = object()
    req = SimpleNamespace(model=None, institute_id=INST, user_id=None)
    assert svc._resolve_outline_llm(req) == ("or", "gm", "outline/default", [GEMINI])
    req.model = "wizard/pick"
    assert svc._resolve_outline_llm(req)[2] == "wizard/pick"
    assert calls[-1] == ("outline", "wizard/pick")
    req.model, byo["model"] = None, "inst/model"
    _k, _g, model, chain = svc._resolve_outline_llm(req)
    assert model == "inst/model" and chain == ["outline/default", GEMINI]


# ---------------------------------------------------------- content generation


def _content_service(monkeypatch, content=(GLM, [GEMINI]), html=(GLM, [GEMINI])):
    pytest.importorskip("boto3")
    from ai_service.app.services import content_generation_service as cgs

    svc = cgs.ContentGenerationService.__new__(cgs.ContentGenerationService)
    svc._content_model, svc._content_fallbacks = content
    svc._html_doc_model, svc._html_doc_fallbacks = html
    svc._course_model = None
    return svc


def test_llm_authored_todo_model_is_ignored_wizard_pick_wins(monkeypatch):
    svc = _content_service(monkeypatch)
    todo = SimpleNamespace(model="google/gemini-2.5-pro", metadata={})
    assert svc._model_for(todo) == GLM
    todo.metadata = {"model": "wizard/pick"}
    assert svc._model_for(todo) == "wizard/pick"
    svc._course_model = "course/pick"
    assert svc._model_for(SimpleNamespace(model="google/gemini-2.5-pro", metadata={})) == "course/pick"


def test_content_use_case_is_resolved_at_construction(monkeypatch):
    pytest.importorskip("boto3")
    from ai_service.app.services import content_generation_service as cgs

    monkeypatch.setattr(model_selection, "resolve_models",
                        lambda db, uc, *a, **k: (f"{uc}/default", [f"{uc}/fallback"]))
    monkeypatch.delenv("HTML_DOC_MODEL", raising=False)
    assert cgs.ContentGenerationService._resolve_use_case("content", object()) == (
        "content/default", ["content/fallback"])


def test_content_retry_walks_the_use_case_chain(monkeypatch):
    svc = _content_service(monkeypatch)
    tried = []

    class _LLM:
        async def generate_outline_with_usage(self, prompt, model):
            tried.append(model)
            if model != GEMINI:
                raise RuntimeError("down")
            return "content", {}

    svc._llm_client = _LLM()
    content, _usage, used = asyncio.run(svc._generate_with_model_fallback("p", "user/pick"))
    assert used == GEMINI and tried == ["user/pick", GLM, GEMINI]


# --------------------------------------------------------------------- copy-check


def test_evaluation_model_reads_the_use_case_and_degrades_to_glm(monkeypatch):
    from ai_service.app.services.copy_check import grader

    monkeypatch.setattr(model_selection, "resolve_models",
                        lambda db, uc, *a, **k: ("eval/model" if uc == "evaluation" else "x", []))
    assert grader.evaluation_model(object()) == "eval/model"

    def boom(*_a, **_k):
        raise RuntimeError("db down")

    monkeypatch.setattr(model_selection, "resolve_models", boom)
    assert grader.evaluation_model(object()) == grader.DEFAULT_MODEL == GLM


def test_grader_uses_its_default_model_unless_the_teacher_picked_one():
    from ai_service.app.services.copy_check.grader import CopyCheckGrader

    class _LLM:
        def __init__(self):
            self.models = []

        async def chat_completion(self, **kw):
            self.models.append(kw["model"])
            return {"content": '{"marks_awarded": 1, "confidence": 0.9}', "usage": {}}

    llm = _LLM()
    g = CopyCheckGrader(llm, default_model="eval/model")
    q = {"question_id": "1", "student_answer": "x"}
    asyncio.run(g.grade_typed_question(q, {}))
    asyncio.run(g.grade_typed_question(q, {}, preferred_model="teacher/pick"))
    assert llm.models == ["eval/model", "teacher/pick"]
    assert CopyCheckGrader(llm).default_model == GLM


def test_deduction_check_has_its_own_use_case(monkeypatch):
    from ai_service.app.services.copy_check import deduction_check as dc

    asked = []

    def fake_sync(use_case, *a, **k):
        asked.append(use_case)
        return "switched/back", []

    monkeypatch.setattr(model_selection, "resolve_model_sync", fake_sync)
    assert dc.USE_CASE == "copy_check_deduction" and dc.MODEL == GLM
    assert dc.deduction_model() == "switched/back" and asked == ["copy_check_deduction"]
    assert dc.DeductionChecker("u", {}, None).model is None
    assert dc.DeductionChecker("u", {}, None, model="m").model == "m"


# ------------------------------------------------------------ call intelligence


def test_call_intel_chain_uses_use_case_then_llm_fallback_model(monkeypatch):
    from ai_service.app.services import call_intelligence_service as cis

    monkeypatch.delenv("CALL_INTEL_LLM_MODEL", raising=False)
    monkeypatch.setattr(cis, "get_settings", lambda: SimpleNamespace(
        call_intel_llm_model=GLM, llm_default_model=GLM, llm_fallback_model=GEMINI))
    monkeypatch.setattr(model_selection, "resolve_model_sync", lambda uc, *a, **k: (GLM, []))
    assert cis._analysis_models() == [GLM, GEMINI], "GLM default never de-duplicates the fallback away"
    monkeypatch.setenv("CALL_INTEL_LLM_MODEL", "emergency/model")
    assert cis._analysis_models()[:2] == ["emergency/model", GLM]


def test_call_intel_price_comes_from_the_registry(monkeypatch):
    from contextlib import contextmanager

    from ai_service.app.services import call_intelligence_service as cis

    class _DB:
        def execute(self, _sql, params):
            row = (0.075, 0.25) if params["m"] == GLM else None
            return SimpleNamespace(fetchone=lambda: row)

    @contextmanager
    def fake_session():
        yield _DB()

    monkeypatch.setattr(cis, "db_session", fake_session)
    cost = cis._llm_cost_usd(GLM, {"prompt_tokens": 1_000_000, "completion_tokens": 1_000_000})
    assert cost == pytest.approx(0.325)
    assert cis._llm_cost_usd("unknown/model", {"prompt_tokens": 10}) is None
    assert not hasattr(cis, "_LLM_PRICE_PER_M")


# ---------------------------------------------------------------------- assistant


def test_assistant_chain_byo_wins_else_use_case(monkeypatch):
    from ai_service.app.services import assistant_service as asv

    monkeypatch.setattr(model_selection, "resolve_models",
                        lambda db, uc, *a, **k: ("assistant/default", [GEMINI]) if uc == "assistant" else ("x", []))
    kr = SimpleNamespace(byo_default_model=lambda i, u: None)
    assert asv._assistant_model_chain(object(), kr, INST, USER) == ("assistant/default", [GEMINI])
    kr = SimpleNamespace(byo_default_model=lambda i, u: "byo/model")
    assert asv._assistant_model_chain(object(), kr, INST, USER) == ("byo/model", ["assistant/default", GEMINI])


# -------------------------------------------------------------------------- tutor


def test_tutor_compile_code_default_is_glm():
    pytest.importorskip("fastapi")
    from ai_service.app.services.tutor import plan_compiler

    assert plan_compiler.DEFAULT_COMPILE_MODEL == GLM


def test_tutor_live_turns_pass_the_chatbot_platform_key():
    root = Path(__file__).resolve().parents[1] / "app/services/tutor/runtime"
    for name in ("decision.py", "summary.py", "revisit.py"):
        src = (root / name).read_text()
        n_resolves = src.count(".resolve_keys(")
        assert n_resolves and src.count('platform_default_key="chatbot.text.model"') == n_resolves, name


# ── A one-off failure must not park the platform default model ────────────
def test_only_model_level_errors_park_a_model():
    from ai_service.app.services.chat_llm_client import is_model_level_error

    assert is_model_level_error("OpenRouter 404 for z-ai/glm-5.3-flash [as-configured]: No endpoints found")
    assert is_model_level_error("OpenRouter 400 for x/y [as-configured]: x/y is not a valid model ID")
    assert not is_model_level_error("OpenRouter 429 for z-ai/glm-5.3-flash [as-configured]: rate limited")
    assert not is_model_level_error("OpenRouter 502 for z-ai/glm-5.3-flash [as-configured]: upstream error")
    assert not is_model_level_error("ReadTimeout('')")
    assert not is_model_level_error("OpenRouter 400 for z-ai/glm-5.3-flash [as-configured]: messages too long")


def test_transient_failure_falls_back_without_parking(monkeypatch):
    import asyncio
    from ai_service.app.services import chat_llm_client as mod

    mod._BROKEN_UNTIL.clear()
    client = mod.ChatLLMClient.__new__(mod.ChatLLMClient)
    monkeypatch.setattr(client, "_resolve", lambda i, u: ("key", None, "z-ai/glm-5.3-flash"), raising=False)
    monkeypatch.setattr(client, "_fallback_chain", lambda m, e, f: ["google/gemini-2.5-flash"], raising=False)
    monkeypatch.setattr(client, "_note_model_ok", lambda m: None, raising=False)
    monkeypatch.setattr(client, "_note_model_failure", lambda *a: None, raising=False)

    async def fake_call(messages, tools, temperature, max_tokens, key, model):
        if model == "z-ai/glm-5.3-flash":
            raise Exception("OpenRouter 502 for z-ai/glm-5.3-flash [as-configured]: upstream error")
        return {"content": "ok", "model": model}

    monkeypatch.setattr(client, "_call_openrouter", fake_call, raising=False)
    out = asyncio.run(client.chat_completion([{"role": "user", "content": "hi"}]))
    assert out["content"] == "ok" and out["fallback_from"] == "z-ai/glm-5.3-flash"
    assert not mod.is_model_broken("z-ai/glm-5.3-flash")
