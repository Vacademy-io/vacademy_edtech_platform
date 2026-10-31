"""Regressions from the 2026-09-04 deep review of the Live AI Tutor.

Each test pins one confirmed finding: staff-role names, per-slide billing
counters, truncated replies, STALE plans still serving, SVG size, media-task
url rules, resume replay, the final-attempt prompt line, and the settings
fields the compile router now resolves from the course.
"""
import asyncio
import json
from dataclasses import replace

import pytest

from app.schemas.tutor import TeachingPlanDraft
from app.services.tutor import board_ops, plan_store
from app.services.tutor.plan_validator import DEFAULT_LIMITS, validate_plan
from app.services.tutor.roles import STAFF_ROLES, is_staff, normalize_roles
from app.services.tutor.runtime import state as sm
from app.services.tutor.runtime.prompts import turn_prompt
from app.services.tutor.runtime.settings import TutorSettings, _apply


# ── roles ────────────────────────────────────────────────────────────────────

def test_platform_role_names_with_spaces_are_staff():
    assert is_staff(["CONTENT CREATOR"])
    assert is_staff(["course creator"])
    assert is_staff(["STUDENT", "TEACHER"])
    assert not is_staff(["STUDENT"])
    assert not is_staff([])
    assert not is_staff([], is_root=True)  # is_root_user never grants staff
    assert normalize_roles(["Content Creator", None, ""]) == {"CONTENT_CREATOR"}
    assert "CONTENT_CREATOR" in STAFF_ROLES


# ── compiler: per-slide counters, truncation, model fallback ────────────────

def test_usage_counters_are_per_slide_not_per_compiler(monkeypatch):
    """Two slides compiled concurrently on one PlanCompiler must bill their
    own tokens (the review found a shared self._usage)."""
    from app.services.tutor import plan_compiler as pc

    compiler = pc.PlanCompiler(institute_id="i", user_id="u")
    calls = {"n": 0}

    class _Client:
        def __init__(self, *_a, **_k):
            pass

        async def chat_completion(self, messages, **kw):
            calls["n"] += 1
            n = calls["n"]
            await asyncio.sleep(0.01 if n == 1 else 0)
            return {"content": "{}", "usage": {"prompt_tokens": 100 * n, "completion_tokens": 10 * n},
                    "model": f"m{n}", "finish_reason": "stop"}

    class _DB:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class _Keys:
        def __init__(self, db):
            pass

        def resolve_keys(self, *a, **k):
            return (None, None, None)

    monkeypatch.setattr(pc, "ChatLLMClient", _Client)
    monkeypatch.setattr(pc, "ApiKeyResolver", _Keys)
    monkeypatch.setattr(pc, "db_session", lambda: _DB())

    async def go():
        r1, r2 = pc._Run(), pc._Run()
        await asyncio.gather(compiler._chat([], r1), compiler._chat([], r2))
        return r1, r2

    r1, r2 = asyncio.run(go())
    totals = sorted((r.usage["prompt_tokens"], r.usage["completion_tokens"]) for r in (r1, r2))
    assert totals == [(100, 10), (200, 20)]
    assert {r1.model_used, r2.model_used} == {"m1", "m2"}


def test_truncated_reply_is_never_repaired_into_a_plan(monkeypatch):
    from app.services.tutor import plan_compiler as pc
    from app.services.tutor.slide_source import SlideSource

    compiler = pc.PlanCompiler(institute_id="i", user_id="u")
    seen = []

    async def fake_chat(messages, run):
        seen.append(len(messages))
        run.model_used = "m"
        return '{"language":"en","objectives":["x"],"topics":[', "length"

    monkeypatch.setattr(compiler, "_chat", fake_chat)

    async def no_kb(source):
        return None

    monkeypatch.setattr(compiler, "_kb_block", no_kb)
    src = SlideSource(slide_id="s", title="T", source_type="DOCUMENT", source_id="d", kind="document", text="body")
    with pytest.raises(RuntimeError) as ei:
        asyncio.run(compiler._build_draft(src, None, pc._Run()))
    assert "cut off" in str(ei.value)
    assert seen == [2, 4, 6]            # initial + two repair rounds, each asking for a shorter plan


def test_a_cut_off_reply_is_not_echoed_back_whole(monkeypatch):
    """The partial goes back as a short head, not 60k chars that triple the
    next prompt (2026-10-22: 11k → 40k prompt tokens)."""
    from app.services.tutor import plan_compiler as pc
    from app.services.tutor.slide_source import SlideSource

    compiler = pc.PlanCompiler(institute_id="i", user_id="u")
    echoes = []

    async def fake_chat(messages, run):
        if len(messages) > 2:
            echoes.append(messages[-2]["content"])
        return '{"language":"en","topics":[' + "x" * 50_000, "length"

    async def no_kb(source):
        return None

    monkeypatch.setattr(compiler, "_chat", fake_chat)
    monkeypatch.setattr(compiler, "_kb_block", no_kb)
    src = SlideSource(slide_id="s", title="T", source_type="DOCUMENT", source_id="d", kind="document", text="body")
    with pytest.raises(RuntimeError):
        asyncio.run(compiler._build_draft(src, None, pc._Run()))
    assert echoes and all(len(e) < pc.TRUNCATED_ECHO_CHARS + 100 and "cut off" in e for e in echoes)


def test_long_material_gets_a_bigger_output_budget(monkeypatch):
    from app.services.tutor import plan_compiler as pc
    from app.services.tutor.slide_source import SlideSource

    assert pc.compile_max_tokens(0) == pc.compile_max_tokens(pc.LONG_SOURCE_CHARS[0]) == pc.COMPILE_MAX_TOKENS
    assert pc.compile_max_tokens(10**6) == pc.COMPILE_MAX_TOKENS_LONG
    assert pc.COMPILE_MAX_TOKENS < pc.compile_max_tokens(24_000) < pc.COMPILE_MAX_TOKENS_LONG

    compiler = pc.PlanCompiler(institute_id="i", user_id="u")
    caps = []

    async def fake_chat(messages, run):
        caps.append(run.max_tokens)
        return "{}", "stop"

    async def no_kb(source):
        return None

    monkeypatch.setattr(compiler, "_chat", fake_chat)
    monkeypatch.setattr(compiler, "_kb_block", no_kb)
    src = SlideSource(slide_id="s", title="T", source_type="SCORM", source_id="d", kind="scorm", text="w " * 20_000)
    with pytest.raises(RuntimeError):
        asyncio.run(compiler._build_draft(src, None, pc._Run()))
    assert caps and set(caps) == {pc.COMPILE_MAX_TOKENS_LONG}


def test_a_huge_valid_plan_skips_the_quality_rewrite(monkeypatch):
    from tests.test_tutor_compile import _plan
    from app.services.tutor import plan_compiler as pc
    from app.services.tutor.slide_source import SlideSource

    body = json.dumps(_plan().model_dump(by_alias=True))
    compiler = pc.PlanCompiler(institute_id="i", user_id="u")
    calls = []

    async def fake_chat(messages, run):
        calls.append(1)
        return body, "stop"

    async def no_kb(source):
        return None

    async def no_media(draft, source, run):
        return None

    monkeypatch.setattr(compiler, "_chat", fake_chat)
    monkeypatch.setattr(compiler, "_kb_block", no_kb)
    monkeypatch.setattr(compiler, "_resolve_media", no_media)
    monkeypatch.setattr(pc, "soft_errors", lambda *a, **k: ["add a recap"])
    monkeypatch.setattr(pc, "QUALITY_ROUND_MAX_CHARS", 100)
    src = SlideSource(slide_id="s", title="T", source_type="DOCUMENT", source_id="d", kind="document", text="body")
    draft, _raw = asyncio.run(compiler._build_draft(src, None, pc._Run()))
    assert draft is not None and len(calls) == 1


def test_extract_json_takes_the_plan_out_of_trailing_text_and_value_lists():
    from app.services.tutor import compile_prompts as cp
    plan = {"language": "en", "topics": [{"id": "t1"}]}
    assert cp.extract_json(json.dumps(plan) + '\n{"note": "second try"}') == plan
    assert cp.extract_json(json.dumps(plan) + " } ] trailing") == plan
    assert "strict parse OK" == cp.json_error_at(json.dumps(plan))
    broken = '{"language":"en","topics":[{"id":"t1","svg":"<svg viewBox="0 0 1 1">"}]}'
    assert "near" in cp.json_error_at(broken)


def test_provider_rejection_falls_back_but_timeouts_do_not(monkeypatch):
    import httpx
    from app.services.tutor import plan_compiler as pc

    compiler = pc.PlanCompiler(institute_id="i", user_id="u", model_override="bad/model")
    attempts = []

    class _DB:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class _Keys:
        def __init__(self, db):
            pass

        def resolve_keys(self, *a, **k):
            return (None, None, None)

    class _Client:
        def __init__(self, *_a, **_k):
            pass

        async def chat_completion(self, messages, **kw):
            attempts.append(kw.get("model"))
            if kw.get("model") == "bad/model":
                req = httpx.Request("POST", "https://x")
                raise httpx.HTTPStatusError("nope", request=req, response=httpx.Response(404, request=req))
            return {"content": "{}", "usage": {}, "model": "default", "finish_reason": "stop"}

    monkeypatch.setattr(pc, "ChatLLMClient", _Client)
    monkeypatch.setattr(pc, "ApiKeyResolver", _Keys)
    monkeypatch.setattr(pc, "db_session", lambda: _DB())
    content, fr = asyncio.run(compiler._chat([], pc._Run()))
    assert attempts == ["bad/model", None] and fr == "stop"

    class _Timeout(_Client):
        async def chat_completion(self, messages, **kw):
            attempts.append(kw.get("model"))
            raise httpx.ReadTimeout("slow")

    attempts.clear()
    monkeypatch.setattr(pc, "ChatLLMClient", _Timeout)
    with pytest.raises(httpx.ReadTimeout):
        asyncio.run(compiler._chat([], pc._Run()))
    assert attempts == ["bad/model"]    # no second, expensive attempt


# ── plans: STALE serves, hash reinstates ────────────────────────────────────

def test_serving_statuses_include_stale():
    assert plan_store.SERVING_STATUSES == ("READY", "STALE")


def test_description_unchanged_reads_compile_inputs():
    from app.services.tutor.plan_compiler import _description_unchanged
    from types import SimpleNamespace as NS
    assert _description_unchanged(NS(raw_plan_json={"compile_inputs": {"source_description": " a "}}, source_description="a"))
    assert not _description_unchanged(NS(raw_plan_json={"compile_inputs": {"source_description": "a"}}, source_description="b"))
    assert _description_unchanged(NS(raw_plan_json=None, source_description="b"))   # legacy row: trust the hash


# ── board ops: svg size, media_task url rule ────────────────────────────────

def test_oversized_svg_is_rejected_not_truncated():
    big = "<svg viewBox='0 0 10 10'>" + "<circle r='1'/>" * 2000 + "</svg>"
    assert len(big) > board_ops._MAX_SVG_CHARS
    assert board_ops.sanitize_svg(big) == ""
    errors, _ = board_ops.validate_ops([{"op": "svg", "id": "d", "svg": big, "description": "x"}])
    assert errors and "too long" in errors[0]


def test_media_task_with_file_id_shaped_url_fails_validation_like_storage():
    uuid_url = "5d4a0e0e-1111-2222-3333-444444444444"
    op = {"op": "media_task", "id": "m", "kind": "video", "url": uuid_url, "description": "watch"}
    errors, _ = board_ops.validate_ops([op])
    assert errors and "https" in errors[0]
    assert board_ops.clean_ops([op]) == []
    ok = {"op": "media_task", "id": "m", "kind": "video", "file_id": uuid_url, "description": "watch"}
    assert board_ops.validate_ops([ok])[0] == [] and len(board_ops.clean_ops([ok])) == 1


def test_uploaded_video_url_becomes_file_id():
    from app.services.tutor.slide_source import SlideSource, _video

    class _DB:
        def execute(self, *_a, **_k):
            class R:
                def first(self):
                    # url, published_url, published_video_length, video_length, description
                    return ("5d4a0e0e-1111-2222-3333-444444444444", None, None, 4672000, " what it teaches ")
            return R()

    src = SlideSource(slide_id="s", title="v", source_type="VIDEO", source_id="x", kind="other")
    _video(_DB(), src, "x", html_video=False)
    assert src.media_file_id and src.media_url is None
    assert src.video_length_ms == 4672000 and src.video_description == "what it teaches"


# ── runtime: resume replay, final attempt, settings ─────────────────────────

def _lesson():
    view = {
        "plan_id": "p", "slide_id": "s", "version": 1, "language": "en", "objectives": [], "slide_title": "Force basics",
        "topics": [{"id": "t1", "title": "Force", "order": 1, "summary_ops": [], "concepts": [
            {"id": "c1", "title": "A", "order": 1, "concept_tags": [], "board_ops": [{"op": "heading", "id": "h", "text": "F"}],
             "say": "one", "say_i18n": {}, "teach_notes": None, "check": {"type": "none"}},
            {"id": "c2", "title": "B", "order": 2, "concept_tags": [], "board_ops": [{"op": "text", "id": "t", "text": "x"}],
             "say": "two", "say_i18n": {}, "teach_notes": None, "check": {"type": "none"}},
            {"id": "c3", "title": "C", "order": 3, "concept_tags": [], "board_ops": [{"op": "text", "id": "u", "text": "y"}],
             "say": "three", "say_i18n": {}, "teach_notes": None, "check": {"type": "open", "prompt": "?", "expected": "y"}},
        ]}],
    }
    return sm.from_plan_view(view)


def test_resume_replays_earlier_concepts_and_carries_slide_title():
    L = _lesson()
    assert L.slide_title == "Force basics"
    p = L.find("c3")
    ids = [op["id"] for op in sm.replay_ops(L, p)]
    assert ids == ["h", "t"]
    assert sm.replay_ops(L, sm.Pointer()) == []
    assert sm.enter(L, p).clear_board is False


def test_final_attempt_line_tells_model_not_to_reask():
    kw = dict(learner_name=None, learner_block="", slide_title="s", objectives=[], board_ops=[], concept_title="c",
              concept_say="say", teach_notes=None, check={"type": "open", "prompt": "?"}, transcript=[],
              learner_message="dunno", remediation_no=1, mode="text")
    assert "FINAL ATTEMPT" in turn_prompt(final_attempt=True, **kw)
    assert "FINAL ATTEMPT" not in turn_prompt(final_attempt=False, **kw)


def test_settings_carry_kb_grounding_and_only_valid_modes():
    s = TutorSettings()
    _apply(s, {"kbGrounding": {"knowledge_base_id": "kb1", "mode": "BLENDED"}})
    assert s.kb_grounding == {"knowledge_base_id": "kb1", "mode": "BLENDED"}
    _apply(s, {"kbGrounding": {"knowledge_base_id": "kb2", "mode": "weird"}})
    assert s.kb_grounding["mode"] == "STRICT"
    _apply(s, {"kbGrounding": None})
    assert s.kb_grounding["knowledge_base_id"] == "kb2"     # empty values never override


def test_post_media_validation_tolerates_a_dropped_image():
    """A topic whose only visual was an image the system could not fill is
    still delivered (with its text) instead of failing the whole plan."""
    from tests.test_tutor_compile import _plan
    data = _plan().model_dump(by_alias=True)
    for t in data["topics"]:
        for c in t["concepts"]:
            c["board_ops"] = [op for op in c["board_ops"] if op["op"] not in ("svg", "image", "video", "media_task")]
    p = TeachingPlanDraft.model_validate(data)
    from app.services.tutor.plan_validator import board_quality_errors
    # Servable either way — a missing picture is advice, not a failed compile.
    assert validate_plan(p, "en", limits=DEFAULT_LIMITS) == []
    assert any("nothing to look at" in n for n in board_quality_errors(p, limits=DEFAULT_LIMITS))
    assert not board_quality_errors(p, limits=replace(DEFAULT_LIMITS, require_visual_per_topic=False))


def test_lesson_frame_shape_is_json_serialisable():
    L = _lesson()
    frame = {"type": "lesson", "slide_id": L.slide_id, "slide_title": L.slide_title,
             "topics": [{"id": t.id, "title": t.title, "concepts": len(t.concepts)} for t in L.topics],
             "progress": sm.Pointer().progress(L)}
    assert json.loads(json.dumps(frame))["topics"][0]["concepts"] == 3


def test_sarvam_speaker_rejects_unknown_voices():
    from app.services.voice_tts import SARVAM_DEFAULT_FEMALE, sarvam_speaker
    assert sarvam_speaker("anushka", SARVAM_DEFAULT_FEMALE) == "priya"     # bulbul:v2 name → silent lesson before
    assert sarvam_speaker("nirupma", SARVAM_DEFAULT_FEMALE) == "priya"     # a Smallest.ai voice
    assert sarvam_speaker(" Ritu ", SARVAM_DEFAULT_FEMALE) == "ritu"
    assert sarvam_speaker(None, "shubh") == "shubh"


def test_quiz_checks_carry_question_and_option_ids():
    from app.services.tutor.quiz_compiler import compile_quiz
    from app.services.tutor.slide_source import QuizQuestion, SlideSource
    q = QuizQuestion(id="q1", order=1, question_type="MCQS", stem="2+2?", options=[{"id": "o1", "text": "3"}, {"id": "o2", "text": "4"}],
                     correct_option_ids=["o2"], correct_texts=["4"])
    src = SlideSource(slide_id="s", title="Quiz", source_type="QUIZ", source_id="q", kind="quiz", questions=[q])
    draft = compile_quiz(src, "en")
    chk = draft.topics[1].concepts[0].check
    assert chk.question_id == "q1" and chk.option_ids == ["o1", "o2"]
    assert "question_id" in chk.model_dump()


def test_svg_part_step_is_bounded():
    from app.schemas.tutor import SvgPart
    assert SvgPart(id="a", label="A").step == 0
    assert SvgPart(id="a", label="A", step=3).step == 3
    with pytest.raises(Exception):
        SvgPart(id="a", label="A", step=99)


def test_live_minute_tool_is_priced():
    from app.services.tool_cost_estimator import DEFAULT_TOOL_PRICING
    row = DEFAULT_TOOL_PRICING["tutor_live_minute"]
    assert row["unit_field"] == "audio_minutes" and row["per_unit_credits"] > 0


def test_smallest_engine_is_registered_and_falls_back_without_key(monkeypatch):
    from app.services import voice_tts
    monkeypatch.delenv("SMALLEST_API_KEY", raising=False)
    assert "smallest" in voice_tts._ENGINES and not voice_tts.smallest_available()
    assert voice_tts.default_voice_for("smallest", "hi-IN") == voice_tts.SMALLEST_DEFAULT_VOICE


def test_quiz_results_resolve_option_ids_for_the_activity_log():
    from app.services.tutor.runtime.session_service import quiz_results
    view = {"plan_id": "p", "slide_id": "s", "version": 1, "language": "en", "objectives": [], "topics": [
        {"id": "t2", "title": "Q1", "order": 1, "summary_ops": [], "concepts": [
            {"id": "c1", "title": "Q1", "order": 1, "concept_tags": [], "board_ops": [], "say": "", "say_i18n": {}, "teach_notes": None,
             "check": {"type": "mcq", "prompt": "2+2?", "options": ["3", "4", "5"], "expected": "4",
                       "question_id": "q1", "option_ids": ["o1", "o2", "o3"]}}]},
        {"id": "t3", "title": "Q2", "order": 2, "summary_ops": [], "concepts": [
            {"id": "c2", "title": "Q2", "order": 1, "concept_tags": [], "board_ops": [], "say": "", "say_i18n": {}, "teach_notes": None,
             "check": {"type": "open", "prompt": "Define force", "options": [], "expected": "a push or pull", "question_id": "q2"}}]},
        {"id": "t4", "title": "Q3", "order": 3, "summary_ops": [], "concepts": [
            {"id": "c3", "title": "Q3", "order": 1, "concept_tags": [], "board_ops": [], "say": "", "say_i18n": {}, "teach_notes": None,
             "check": {"type": "mcq", "prompt": "colour?", "options": ["red", "blue"], "expected": "blue",
                       "question_id": "q3", "option_ids": ["r", "b"]}}]},
    ]}
    L = sm.from_plan_view(view)
    rows = quiz_results(L, {
        "c1": {"answer": "I think it is 4", "score": 1.0, "correct": True, "action": "advance"},
        "c2": {"answer": "pushing", "score": 0.3, "correct": False, "action": "advance_weak"},
        "c3": {"answer": "option 1", "score": 0.0, "correct": False, "action": "advance_weak"},
    })
    by = {r["question_id"]: r for r in rows}
    assert by["q1"]["correct"] and by["q1"]["selected_option_ids"] == ["o2"] and by["q1"]["correct_option_ids"] == ["o2"]
    assert by["q2"]["selected_option_ids"] == [] and not by["q2"]["correct"]        # open: server keeps our status
    assert by["q3"]["selected_option_ids"] == ["r"]                                  # "option 1" → first option
    assert len(rows) == 3 and all(r["answered"] for r in rows)
    assert quiz_results(L, {})[0]["answered"] is False


def test_resume_positions_for_summary_and_slide_end():
    L = _lesson()
    p = sm.pointer_at_topic_end(L, 0)
    assert p.phase == sm.TOPIC_SUMMARY and p.concept == 3 and p.done == 3
    assert sm.enter(L, p).kind == "topic_summary"
    q = sm.pointer_at_slide_end(L)
    assert q.phase == sm.SLIDE_DONE and q.done == L.total_concepts and sm.enter(L, q).kind == "slide_done"
    assert sm.replay_ops(L, p) and [op["id"] for op in sm.replay_ops(L, p)] == ["h", "t", "u"]


def test_resume_position_reads_per_slide_progress_and_phase():
    from types import SimpleNamespace as NS
    from app.services.tutor.runtime.session_service import previous_slide, resume_position, slide_progress
    L = _lesson()
    st = NS(progress_json={"s": {"concept_id": "c2", "phase": sm.TEACH, "topic_id": "t1"},
                           "other": {"slide_title": "Older slide", "phase": sm.SLIDE_DONE, "updated_at": "2026-09-04T01:00:00"}},
            current_slide_id="s", current_concept_id="c2", current_phase=sm.TEACH, current_topic_id="t1")
    p = resume_position(None, L, st)
    assert p is not None and (p.topic, p.concept) == (0, 1)
    st.progress_json["s"] = {"concept_id": "c3", "phase": sm.TOPIC_SUMMARY, "topic_id": "t1"}
    assert resume_position(None, L, st).phase == sm.TOPIC_SUMMARY
    st.progress_json["s"] = {"concept_id": "c3", "phase": sm.SLIDE_DONE, "topic_id": "t1"}
    assert resume_position(None, L, st).phase == sm.SLIDE_DONE
    assert previous_slide(st, "s")["slide_title"] == "Older slide"
    # The legacy columns are not a fallback: start_session points current_slide_id at the slide
    # being opened while phase/concept still belong to the previous one (a fresh slide must start fresh).
    legacy = NS(progress_json={}, current_slide_id="s", current_concept_id="c3", current_phase=sm.SLIDE_DONE, current_topic_id=None)
    assert slide_progress(legacy, "s") == {}
    assert resume_position(None, L, legacy) is None
    assert resume_position(None, L, NS(progress_json={}, current_slide_id="x", current_concept_id=None, current_phase=None, current_topic_id=None)) is None


def test_strip_leading_greeting_keeps_the_lesson():
    from app.services.tutor.runtime.prompts import strip_leading_greeting
    assert strip_leading_greeting("Hi Shreyash, let's start with the core idea. Think of it as a bridge.") == "Think of it as a bridge."
    assert strip_leading_greeting("नमस्ते राहुल! आज हम बल के बारे में सीखेंगे। बल धक्का है।") == "आज हम बल के बारे में सीखेंगे। बल धक्का है।"
    assert strip_leading_greeting("A force is a push or a pull.") == "A force is a push or a pull."
    assert strip_leading_greeting("Hello there!") == "Hello there!"     # nothing else to say: keep it


def test_image_model_routing_and_platform_default(monkeypatch):
    import asyncio
    from app.services import image_service as im
    # Registry list unavailable → the id's family decides.
    im._chat_model_ids = set()
    im._chat_model_ids_loaded_at = 0.0

    class _Client:
        async def get(self, *a, **k):
            raise RuntimeError("offline")

    assert asyncio.run(im._uses_chat_completions(_Client(), "google/gemini-3.1-flash-image")) is True
    assert asyncio.run(im._uses_chat_completions(_Client(), "qwen/qwen-image-3")) is False
    assert asyncio.run(im._uses_chat_completions(_Client(), "bytedance-seed/seedream-4.5")) is False
    # With the list loaded, membership decides.
    im._chat_model_ids = {"google/gemini-3.1-flash-image"}
    im._chat_model_ids_loaded_at = 10**12
    assert asyncio.run(im._uses_chat_completions(_Client(), "qwen/qwen-image-3")) is False
    im._chat_model_ids = set()
    assert im.resolve_image_model("x/y") == "x/y"
    monkeypatch.setattr(im, "get_platform_setting", lambda *a, **k: "qwen/qwen-image-3", raising=False)
    assert im.resolve_image_model(None)


def test_platform_setting_specs_carry_catalogs():
    from app.services.platform_settings_service import SETTING_SPECS, GROUP_LABELS
    assert SETTING_SPECS["image.model"].catalog == "image"
    assert SETTING_SPECS["tutor.image.model"].catalog == "image" and SETTING_SPECS["tutor.image.model"].nullable
    assert SETTING_SPECS["tutor.live.model"].catalog == "llm" and SETTING_SPECS["tutor.live.model"].nullable
    assert SETTING_SPECS["tutor.compile.model"].catalog == "llm"
    assert SETTING_SPECS["tutor.voice.provider"].type == "enum" and "smallest" in SETTING_SPECS["tutor.voice.provider"].options
    assert "tutor" in GROUP_LABELS and "images" in GROUP_LABELS


def test_settings_voice_pace_and_avatar():
    s = TutorSettings()
    _apply(s, {"voicePace": "0.9", "teacherAvatarFileId": "file-1"})
    assert s.voice_pace == 0.9 and s.teacher_avatar_file_id == "file-1"
    _apply(s, {"voicePace": 5})
    assert s.voice_pace == 1.3          # clamped
    _apply(s, {"voicePace": "fast"})
    assert s.voice_pace == 1.3          # unparsable: unchanged
    _apply(s, {"teacherAvatarFileId": ""})
    assert s.teacher_avatar_file_id == "file-1"


def test_compile_prompt_states_the_image_rule_by_mode():
    from app.services.tutor import compile_prompts as P
    on = P.system_prompt("Asha", "en", images_enabled=True)
    off = P.system_prompt("Asha", "en", images_enabled=False)
    assert "IMAGES ARE ON" in on and "one illustration per two boards" in on and "AI IMAGES ARE OFF" not in on
    assert "AI IMAGES ARE OFF" in off and "IMAGES ARE ON" not in off
    assert "PREVIOUS JSON" in P.image_repair_prompt("{}")


def test_no_image_plan_gets_one_image_repair_round_then_is_accepted(monkeypatch):
    """Images on + valid plan without pictures → exactly one extra round; if
    the model still returns none, the plan is delivered, not failed."""
    from tests.test_tutor_compile import _plan
    from app.services.tutor import plan_compiler as pc
    from app.services.tutor.slide_source import SlideSource
    data = _plan().model_dump(by_alias=True)
    for t in data["topics"]:
        for c in t["concepts"]:
            c["board_ops"] = [op for op in c["board_ops"] if op["op"] != "image"]
    body = json.dumps(data)
    compiler = pc.PlanCompiler(institute_id="i", user_id="u", generate_images=True)
    calls = []

    async def fake_chat(messages, run):
        calls.append(messages[-1]["content"][:40])
        run.model_used = "m"
        return body, "stop"

    async def no_kb(source):
        return None

    async def no_media(draft, source, run):
        return None

    monkeypatch.setattr(compiler, "_chat", fake_chat)
    monkeypatch.setattr(compiler, "_kb_block", no_kb)
    monkeypatch.setattr(compiler, "_resolve_media", no_media)
    src = SlideSource(slide_id="s", title="T", source_type="DOCUMENT", source_id="d", kind="document", text="body")
    draft, _raw = asyncio.run(compiler._build_draft(src, None, pc._Run()))
    # initial, the image round, then the one quality round (engagement rules)
    assert draft is not None and len(calls) == 3 and calls[1].startswith("Your plan is valid but has NO image")
    assert calls[2].startswith("Your plan is valid but misses")


def test_smallest_speed_calibration_is_monotonic_and_hits_the_measured_points():
    from app.services.voice_tts import smallest_speed_for_ratio as f
    assert f(1.0) == 1.0
    assert abs(f(0.86) - 0.8) < 0.01 and abs(f(1.45) - 1.5) < 0.01   # measured points map back
    assert f(0.9) < 0.9                                                # 0.9× needs a lower engine speed than 0.9
    xs = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 2.0]
    ys = [f(x) for x in xs]
    assert ys == sorted(ys) and 0.5 <= min(ys) and max(ys) <= 2.0
    assert f(0.1) == 0.5 and f(5) == 2.0                              # clamped


def test_number_settings_are_bounded_and_listed():
    from app.services.platform_settings_service import SETTING_SPECS, _coerce
    spec = SETTING_SPECS["tutor.live.preflight_minutes"]
    assert spec.type == "number" and _coerce(spec, "5") == 5 and _coerce(spec, 2.5) == 2.5
    with pytest.raises(ValueError):
        _coerce(spec, 500)
    with pytest.raises(ValueError):
        _coerce(spec, "many")
    assert SETTING_SPECS["tutor.live.max_minutes"].max_value == 240


def test_kb_source_block_is_skipped_for_ungrounded_plans():
    from app.services.tutor.runtime.session_service import kb_source_block
    L = _lesson()
    assert asyncio.run(kb_source_block(L, "inst", "Force", "why?")) is None
    view = {"plan_id": "p", "slide_id": "s", "version": 1, "language": "en", "objectives": [], "topics": [],
            "kb": {"knowledge_base_id": "kb1", "mode": "STRICT"}}
    assert sm.from_plan_view(view).kb == {"knowledge_base_id": "kb1", "mode": "STRICT"}
    assert sm.from_plan_view({**view, "kb": {"mode": "STRICT"}}).kb is None


# ── a structurally sound plan is never thrown away for board quality ────────

def _draft(**over):
    """Smallest valid draft: one topic, one concept, a real check on the second."""
    from app.schemas.tutor import TeachingPlanDraft
    base = {
        "language": "en",
        "objectives": ["understand it"],
        "key_terms": [],
        "topics": [{
            "id": "t1", "title": "Lagrange identity", "order": 1,
            "summary_ops": [{"op": "bullet", "id": "t1-s1", "items": ["one", "two", "three"]}],
            "summary_say": "That is the identity.",
            "summary_say_i18n": {"hi": "यही identity है।"},
            "concepts": [{
                "id": "t1c1", "title": "Collapse with Lagrange", "order": 1, "concept_tags": ["algebra.lagrange"],
                "say": "Look at the board and follow the collapse.", "say_i18n": {"hi": "बोर्ड देखिए और collapse follow कीजिए।"},
                "board_ops": over.pop("ops", [{"op": "heading", "id": "t1c1-h", "text": "Lagrange identity"},
                                              {"op": "formula", "id": "t1c1-f", "latex": "(a^2+b^2)(c^2+d^2)"}]),
                "check": {"type": "none"},
            }],
        }],
    }
    base.update(over)
    return TeachingPlanDraft.model_validate(base)


def test_a_wordy_board_with_no_diagram_is_a_note_not_a_failure():
    from app.services.tutor.plan_validator import validate_plan, soft_errors, board_quality_errors
    wordy = [{"op": "heading", "id": "t1c1-h", "text": "Lagrange identity"},
             {"op": "text", "id": "t1c1-t", "text": " ".join(["word"] * 80)}]
    plan = _draft(ops=wordy)
    # Structurally fine → the compile ships it.
    assert validate_plan(plan, "en", require_media_urls=False) == []
    # And the pedagogy asks come back as advice, once.
    notes = board_quality_errors(plan)
    assert any("keep a concept under 60" in n for n in notes)
    assert any("nothing to look at" in n for n in notes)
    assert set(notes) <= set(soft_errors(plan))


def test_a_formula_board_satisfies_the_visual_rule():
    from app.services.tutor.plan_validator import board_quality_errors
    assert not any("nothing to look at" in n for n in board_quality_errors(_draft()))
    table = [{"op": "heading", "id": "t1c1-h", "text": "Compare"},
             {"op": "table", "id": "t1c1-tb", "rows": [["a", "b"], ["1", "2"]]}]
    assert not any("nothing to look at" in n for n in board_quality_errors(_draft(ops=table)))


def test_structural_problems_stay_fatal():
    from app.services.tutor.plan_validator import validate_plan
    silent = _draft()
    silent.topics[0].concepts[0].say = "  "
    assert any("say is empty" in e for e in validate_plan(silent, "en", require_media_urls=False))
    dup = _draft()
    dup.topics[0].concepts[0].id = "t1"
    assert any("duplicate id" in e for e in validate_plan(dup, "en", require_media_urls=False))


def test_problem_slide_first_board_must_carry_the_ask_and_options():
    from app.services.tutor.plan_validator import question_coverage_errors
    source = "\n".join([
        r"Let a, b, c have magnitudes 1, 2, 3 satisfying \[ |(a\times b)\cdot c| = 6 \]",
        "If d is a unit vector coplanar with b and c, find the value of:",
        r"\[ \left|(\vec{a}\times\vec{c})\cdot\vec{d}\right|^{2} + \left|(\vec{a}\times\vec{c})\times\vec{d}\right|^{2} \]",
        "(A) 9", "", "(B) 3", "", "(C) −9/2", "", "(D) 9/2",
    ])
    givens_only = _draft(ops=[{"op": "heading", "id": "t1c1-h", "text": "The Question"},
                              {"op": "formula", "id": "t1c1-f", "latex": r"|(\vec{a}\times\vec{b})\cdot\vec{c}| = 6"}])
    notes = question_coverage_errors(givens_only, source)
    assert any("ask is missing" in n for n in notes) and any("options are missing" in n for n in notes)
    full = _draft(ops=[{"op": "heading", "id": "t1c1-h", "text": "The Question"},
                       {"op": "formula", "id": "t1c1-f", "latex": r"|(\vec a\times\vec b)\cdot\vec c| = 6"},
                       {"op": "formula", "id": "t1c1-g", "latex": r"\left|(\vec{a}\times\vec{c})\cdot\vec{d}\right|^{2}+\left|(\vec{a}\times\vec{c})\times\vec{d}\right|^{2}"},
                       {"op": "bullet", "id": "t1c1-o", "items": ["(A) 9", "(B) 3", "(C) −9/2", "(D) 9/2"]}])
    assert question_coverage_errors(full, source) == []
    # Prose slides with no ask are untouched.
    assert question_coverage_errors(givens_only, "Plants make sugar from light. Chlorophyll is green.") == []


# ── visual density: institutes asked for textbook illustration, not walls of text ──

def _img_draft(n_images=3, n_topics=2):
    """A draft whose concepts each carry one image op needing generation."""
    from app.schemas.tutor import TeachingPlanDraft
    topics = []
    made = 0
    for t in range(n_topics):
        concepts = []
        for c in range(2):
            ops = [{"op": "heading", "id": f"t{t}c{c}-h", "text": f"Board {t} step {c}"}]
            if made < n_images:
                ops.append({"op": "image", "id": f"t{t}c{c}-img", "description": "a labelled cutaway of a leaf",
                            "generate": "textbook illustration of a leaf cross-section"})
                ops.append({"op": "annotate", "id": f"t{t}c{c}-a", "target": f"t{t}c{c}-img", "text": "stomata"})
                made += 1
            concepts.append({
                "id": f"t{t}c{c}", "title": f"Step {c}", "order": c + 1, "concept_tags": ["bio.leaf"],
                "say": "Look at the illustration.", "say_i18n": {"hi": "चित्र देखिए।"},
                "board_ops": ops,
                "check": {"type": "none"} if c == 0 else {"type": "open", "prompt": "Why?", "rubric": "because", "hint": "look"},
            })
        topics.append({"id": f"t{t}", "title": f"Board {t}", "order": t + 1, "concepts": concepts,
                       "summary_ops": [], "summary_say": "Done.", "summary_say_i18n": {"hi": "हो गया।"}})
    return TeachingPlanDraft.model_validate({"language": "en", "objectives": ["see it"], "key_terms": [], "topics": topics})


def _compiler(**kw):
    from app.services.tutor.plan_compiler import PlanCompiler
    return PlanCompiler(institute_id="i", user_id="u", model_override="m", generate_images=True, **kw)


def test_board_illustrations_are_drawn_concurrently_and_capped(monkeypatch):
    """A picture takes about a minute from the vendor; drawing a board's worth
    of them sequentially is what kept boards text-heavy."""
    import asyncio
    from app.services.tutor import plan_compiler as pc

    monkeypatch.setattr(pc, "MAX_GENERATED_IMAGES_PER_SLIDE", 3)
    monkeypatch.setattr(pc, "IMAGE_CONCURRENCY", 3)
    live, peak, drawn = 0, 0, []

    async def fake(self, prompt, course_name, run):
        nonlocal live, peak
        live += 1
        peak = max(peak, live)
        await asyncio.sleep(0.05)
        live -= 1
        drawn.append(prompt)
        return f"https://cdn/{len(drawn)}.png"

    monkeypatch.setattr(pc.PlanCompiler, "_generate_image", fake)
    draft = _img_draft(n_images=4)                       # one more than the cap
    src = type("S", (), {"media_url": None, "media_file_id": None, "course_name": "Bio", "kind": "document"})()
    asyncio.run(_compiler()._resolve_media(draft, src, pc._Run()))

    assert len(drawn) == 3 and peak == 3                 # capped, and all at once
    urls = [op.url for t in draft.topics for c in t.concepts for op in c.board_ops if getattr(op, "op", "") == "image"]
    assert urls and all(urls)                            # every kept image has a real url
    assert len(urls) == 3                                # the uncapped fourth was dropped


def test_an_image_that_fails_takes_its_annotation_with_it(monkeypatch):
    import asyncio
    from app.services.tutor import plan_compiler as pc

    async def fake(self, prompt, course_name, run):
        return None                                       # the vendor failed

    monkeypatch.setattr(pc.PlanCompiler, "_generate_image", fake)
    draft = _img_draft(n_images=1, n_topics=1)
    src = type("S", (), {"media_url": None, "media_file_id": None, "course_name": "Bio", "kind": "document"})()
    asyncio.run(_compiler()._resolve_media(draft, src, pc._Run()))
    ops = [op for c in draft.topics[0].concepts for op in c.board_ops]
    assert not [o for o in ops if getattr(o, "op", "") == "image"]          # dropped
    assert not [o for o in ops if getattr(o, "op", "") == "annotate"]       # and its label


def test_thin_illustration_coverage_is_advice_and_scales_with_the_slide():
    from app.services.tutor.plan_compiler import _image_target
    from app.services.tutor.plan_validator import DEFAULT_LIMITS, board_quality_errors, validate_plan
    from dataclasses import replace

    with_images = replace(DEFAULT_LIMITS, expect_images=True)
    bare = _img_draft(n_images=0, n_topics=5)
    notes = board_quality_errors(bare, limits=with_images)
    assert any("real illustration" in n for n in notes)
    assert validate_plan(bare, "en", limits=with_images, require_media_urls=False) == []   # never fatal
    # Images off for the course: no nagging.
    assert not any("real illustration" in n for n in board_quality_errors(bare, limits=DEFAULT_LIMITS))
    # A long slide is expected to carry more pictures than a short one.
    assert _image_target(_img_draft(n_topics=1)) == 1 and _image_target(_img_draft(n_topics=5)) == 3


# ── the visual unit is the concept, not the board ────────────────────────────
# A five-concept board with one diagram in concept three passed every rule while
# the learner sat through two reveals of definition + callouts (owner, 2026-09-22).

def _multi_concept_draft(kinds):
    """One board; `kinds` is a list per concept: 'notes' (text + callouts only),
    'svg', 'image', 'table', or 'annotate' (labels the board's diagram)."""
    from app.schemas.tutor import TeachingPlanDraft
    concepts = []
    for i, kind in enumerate(kinds):
        cid = f"t1c{i + 1}"
        ops = [{"op": "heading", "id": f"{cid}-h", "text": f"Step {i + 1}"},
               {"op": "callout", "id": f"{cid}-c", "kind": "definition", "text": "A short definition."}]
        if kind == "svg":
            ops.append({"op": "svg", "id": f"{cid}-svg", "svg": "<svg viewBox='0 0 640 360'><rect id='p' x='20' y='20' width='200' height='100'/></svg>",
                        "description": "Two boxes and an arrow showing the chain from data to output", "parts": [{"id": "p", "label": "data"}]})
        elif kind == "image":
            ops.append({"op": "image", "id": f"{cid}-img", "description": "a clinician reviewing a suggestion on a screen",
                        "generate": "photo of a clinician reviewing an AI suggestion, no text, no watermark, no logos"})
        elif kind == "table":
            ops.append({"op": "table", "id": f"{cid}-tb", "rows": [["a", "b"], ["1", "2"]]})
        elif kind == "annotate":
            ops.append({"op": "annotate", "id": f"{cid}-a", "target": "t1c1-svg", "text": "human review re-enters here"})
        concepts.append({"id": cid, "title": f"Concept {i + 1}", "order": i + 1, "concept_tags": ["ai.basics"],
                         "say": "Look at the board.", "say_i18n": {"hi": "बोर्ड देखिए।"}, "board_ops": ops,
                         "check": {"type": "none"} if i == 0 else {"type": "open", "prompt": "Why?", "rubric": "because", "hint": "look"}})
    return TeachingPlanDraft.model_validate({
        "language": "en", "objectives": ["see it"], "key_terms": [],
        "topics": [{"id": "t1", "title": "What is AI", "order": 1, "concepts": concepts,
                    "summary_ops": [], "summary_say": "Done.", "summary_say_i18n": {"hi": "हो गया।"}}]})


def test_a_board_that_opens_with_notes_is_told_to_open_with_the_diagram():
    from app.services.tutor.plan_validator import board_quality_errors, validate_plan
    # The prod shape: notes, table, svg, image, notes — one diagram, buried.
    plan = _multi_concept_draft(["notes", "table", "svg", "image", "notes"])
    notes = board_quality_errors(plan)
    assert any("opens with notes only" in n and "concepts[0]" in n for n in notes)
    assert not any("nothing to look at" in n for n in notes)          # the board does have a diagram...
    assert validate_plan(plan, "en", require_media_urls=False) == []   # ...and it is advice, never a failure


def test_two_text_only_concepts_in_a_row_are_flagged_but_an_annotation_counts_as_visual():
    from app.services.tutor.plan_validator import board_quality_errors
    flagged = board_quality_errors(_multi_concept_draft(["svg", "notes", "notes"]))
    assert [n for n in flagged if "two text-only concepts in a row" in n and "concepts[2]" in n]
    # Labelling the board's diagram IS the visual step for that concept.
    fine = board_quality_errors(_multi_concept_draft(["svg", "notes", "annotate", "notes", "table"]))
    assert not any("text-only" in n or "opens with notes" in n for n in fine)


def test_illustration_target_grows_with_concepts_not_only_boards():
    from app.services.tutor.plan_validator import image_target
    from app.services.tutor.plan_compiler import _image_target
    one_board_five_concepts = _multi_concept_draft(["svg", "notes", "annotate", "image", "table"])
    assert image_target(one_board_five_concepts) == 2       # ceil(5/4), not the 1 a one-board slide got before
    assert _image_target(one_board_five_concepts) == 2      # the compiler asks for the same number
    assert image_target(_multi_concept_draft(["svg"])) == 1
    assert image_target(_img_draft(n_topics=5)) == 3 and image_target(_img_draft(n_topics=1)) == 1


def test_rule_five_makes_the_concept_the_unit():
    from app.services.tutor.compile_prompts import rules_text
    text = rules_text(images_enabled=True)
    flat = " ".join(text.split())
    assert "FIRST concept of every board opens with its diagram" in flat
    assert "never count as the visual" in flat
    assert "never fewer than one per four concepts" in flat


def test_a_null_check_is_the_default_check_not_a_failed_compile():
    from app.schemas.tutor import ConceptDraft
    base = {"id": "t1c1", "title": "Open", "say": "Look.", "board_ops": []}
    for absent in (None, "none", "", False, {}):
        c = ConceptDraft.model_validate({**base, "check": absent})
        assert c.check.type == "none", absent
    # A real check still parses as itself.
    c = ConceptDraft.model_validate({**base, "check": {"type": "open", "prompt": "Why?", "rubric": "because"}})
    assert c.check.type == "open" and c.check.prompt == "Why?"


# ── held opening: the teacher waits until the learner's device can show and play her ──

def test_only_a_client_that_asks_gets_its_opening_held():
    from app.routers.tutor_ws import BEGIN_WAIT_SECONDS, client_holds_opening
    assert client_holds_opening({"type": "auth", "token": "t", "hold": True})
    # Older bundles (OTA / electron) send neither flag and open at once, as before.
    assert not client_holds_opening({"type": "auth", "token": "t"})
    assert not client_holds_opening({"type": "auth", "token": "t", "hold": "yes"})
    assert not client_holds_opening({})
    # The server's cap must outlast the client's 25 s wait for the face, or it
    # opens the lesson over a face that is still loading (voice before avatar).
    assert 25 < BEGIN_WAIT_SECONDS <= 40


def test_before_the_opening_a_lesson_message_opens_and_is_dropped_but_begin_and_pings_pass():
    from app.routers.tutor_ws import LESSON_MESSAGES
    assert {"continue", "answer", "ask", "control", "audio_end", "interrupt", "next_slide"} <= LESSON_MESSAGES
    for passthrough in ("begin", "ping", "config", "end_session", "auth"):
        assert passthrough not in LESSON_MESSAGES
