"""Natural teaching, step 1 — the platform side: the per-course setting, the
session's frozen arm, the plan kind the warm-up gate needs, the compile
opening rule (soft) and the voice warm-up of line variants. No DB."""
from types import SimpleNamespace

import pytest

from app.schemas.tutor import TeachingPlanDraft
from app.services.tutor import compile_prompts, plan_store
from app.services.tutor import plan_compiler as pc
from app.services.tutor import voice_cache
from app.services.tutor.plan_validator import DEFAULT_LIMITS, Limits, board_quality_errors, soft_errors
from app.services.tutor.runtime import prompts
from app.services.tutor.runtime import session_service as svc
from app.services.tutor.runtime import state as sm
from app.services.tutor.runtime.settings import TutorSettings, _apply, _extract


# ── E. setting ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,want", [
    (True, True), ("true", True), ("TRUE", True), (" true ", True),
    (False, False), ("false", False), ("False", False), (0, False), (1, False), ("yes", False), ("0", False),
])
def test_natural_teaching_is_parsed_strictly(raw, want):
    s = TutorSettings()
    _apply(s, {"naturalTeaching": raw})
    assert s.natural_teaching is want
    s = TutorSettings()
    _apply(s, {"natural_teaching": raw})
    assert s.natural_teaching is want


def test_natural_teaching_defaults_off_and_package_overrides_institute():
    assert TutorSettings().natural_teaching is False
    s = TutorSettings()
    _apply(s, {})
    _apply(s, {"enabled": True})                       # unrelated key leaves it alone
    assert s.natural_teaching is False
    inst = {"setting": {"TUTOR_MODE_SETTING": {"data": {"data": {"enabled": True, "naturalTeaching": True}}}}}
    pkg = {"setting": {"TUTOR_MODE_SETTING": {"data": {"enabled": True, "naturalTeaching": "false"}}}}
    s = TutorSettings()
    _apply(s, _extract(inst))
    assert s.natural_teaching is True
    _apply(s, _extract(pkg))
    assert s.natural_teaching is False                 # bool("false") would have been True


# ── E. freeze at creation, expose via boot ctx ───────────────────────────────

def test_session_natural_reads_the_frozen_value():
    assert svc.session_natural(None) is False
    assert svc.session_natural({}) is False                       # pre-feature session = off
    assert svc.session_natural({"natural": 0}) is False
    assert svc.session_natural({"natural": 1}) is True
    assert svc.session_natural({"natural": 1, "demo": True}) is False   # demo is never natural


class _Ctx:
    def __init__(self):
        self.added = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        pass

    def flush(self):
        pass


def _start(monkeypatch, *, natural: bool, guest=None):
    db = _Ctx()
    settings = TutorSettings(enabled=True, natural_teaching=natural)
    lesson = sm.LessonPlan(plan_id="p", slide_id="s1", version=1, language="en", objectives=[], topics=[])
    st = SimpleNamespace(current_slide_id=None, current_topic_id=None, current_concept_id=None, current_phase=None,
                         progress_json={}, mastery_json={}, misconceptions_json=[], weak_concepts_json=[],
                         rolling_summary=None, preferred_language=None, pace=None, updated_at=None)

    class _Chats:
        def __init__(self, _db):
            pass

        def create_session(self, **kw):
            return SimpleNamespace(id="chat-1")

    monkeypatch.setattr(svc, "db_session", lambda: db)
    monkeypatch.setattr(svc, "package_of_session", lambda _db, _ps: ("pkg-1", "Course"))
    monkeypatch.setattr(svc, "resolve_settings", lambda _db, **kw: settings)
    monkeypatch.setattr(svc, "get_or_create_state", lambda _db, **kw: st)
    monkeypatch.setattr(svc, "slide_in_package_session", lambda *a: True)
    monkeypatch.setattr(svc, "load_lesson", lambda _db, _sid: lesson)
    monkeypatch.setattr(svc, "resume_position", lambda *a: None)
    monkeypatch.setattr(svc, "ChatSessionRepository", _Chats)
    monkeypatch.setattr(svc, "learner_name", lambda *a: "Riya")
    boot = svc.start_session(user_id="u1", institute_id="i1", package_session_id="ps1", slide_id="s1",
                             mode="VOICE", language=None, guest=guest)
    ts = next(o for o in db.added if isinstance(o, svc.TutorSession))
    return boot, ts


def test_natural_is_frozen_into_summary_json_at_creation(monkeypatch):
    boot, ts = _start(monkeypatch, natural=True)
    assert ts.summary_json == {"turns": 0, "natural": 1} and boot["natural"] is True
    boot, ts = _start(monkeypatch, natural=False)
    assert ts.summary_json == {"turns": 0, "natural": 0} and boot["natural"] is False


def test_demo_session_is_never_natural(monkeypatch):
    boot, ts = _start(monkeypatch, natural=True, guest={"name": "Guest", "minutes": 3})
    assert ts.summary_json["natural"] == 0 and ts.summary_json["demo"] is True and boot["natural"] is False


def test_boot_context_uses_the_frozen_value_not_the_live_setting(monkeypatch):
    """An admin flip after the session started does not change its arm."""
    live = TutorSettings(enabled=True, natural_teaching=False)

    def boot_for(summary):
        ts = SimpleNamespace(user_id="u1", institute_id="i1", package_session_id="ps1", chat_session_id="c1",
                             mode="VOICE", language="en", started_slide_id="s1", summary_json=summary)
        db = _Ctx()
        db.get = lambda _model, _id: ts
        monkeypatch.setattr(svc, "db_session", lambda: db)
        monkeypatch.setattr(svc, "package_of_session", lambda _db, _ps: ("pkg-1", "Course"))
        monkeypatch.setattr(svc, "resolve_settings", lambda _db, **kw: live)
        monkeypatch.setattr(svc, "load_lesson", lambda _db, _sid: None)
        monkeypatch.setattr(svc, "get_or_create_state", lambda _db, **kw: SimpleNamespace(rolling_summary=None))
        monkeypatch.setattr(svc, "state_dict", lambda st: {})
        monkeypatch.setattr(svc, "get_platform_setting", lambda *a, **k: None)
        monkeypatch.setattr(svc, "learner_name", lambda *a: "Riya")
        monkeypatch.setattr(svc, "session_max_seconds", lambda _db: 1800)
        return svc.boot_context("ts-1")

    assert boot_for({"turns": 3, "natural": 1})["natural"] is True
    live.natural_teaching = True
    assert boot_for({"turns": 3, "natural": 0})["natural"] is False
    assert boot_for({"turns": 3})["natural"] is False
    assert boot_for({"turns": 3, "natural": 1, "demo": True})["natural"] is False


# ── E. plan kind exposed for the warm-up gate ────────────────────────────────

class _Q:
    def filter(self, *a):
        return self

    def order_by(self, *a):
        return self

    def all(self):
        return []


def _plan_row(compile_inputs):
    return SimpleNamespace(id="p", slide_id="s", version=2, status="READY", language="en", model="m",
                           objectives_json=[], key_terms_json=[], source_description=None, error=None,
                           raw_plan_json=({"compile_inputs": compile_inputs} if compile_inputs is not None else None))


def test_plan_view_and_lesson_plan_carry_the_kind():
    db = SimpleNamespace(query=lambda *a: _Q())
    quiz = plan_store.plan_view(db, _plan_row({"kind": "quiz", "style": "lesson"}))
    assert quiz["kind"] == "quiz" and quiz["style"] == "lesson"
    assert sm.from_plan_view(quiz).kind == "quiz"
    doc = plan_store.plan_view(db, _plan_row({"kind": "document"}))
    assert sm.from_plan_view(doc).kind == "document"
    for missing in ({}, None):
        v = plan_store.plan_view(db, _plan_row(missing))
        assert v["kind"] == "lesson" and sm.from_plan_view(v).kind == "lesson"
    assert sm.from_plan_view({"plan_id": "p", "slide_id": "s", "topics": []}).kind == "lesson"


# ── D. compile opening rule ──────────────────────────────────────────────────

def test_natural_opening_rule_only_when_on_and_only_for_lessons():
    off = compile_prompts.system_prompt("Asha", "en")
    assert "OPENING" not in off
    assert compile_prompts.rules_text(True, "en") == compile_prompts.rules_text(True, "en", natural=False)
    on = compile_prompts.system_prompt("Asha", "en", natural=True)
    assert "15. OPENING" in on and "AT MOST 2 short sentences" in on and "does NOT greet" in on
    assert "{student_name}" in on and "{{" not in compile_prompts.NATURAL_OPENING_RULE
    assert off in on.replace("\n" + compile_prompts.NATURAL_OPENING_RULE, "")     # the rest is unchanged
    for style in ("interview", "practice"):
        assert "15. OPENING" not in compile_prompts.system_prompt("Asha", "en", style=style, natural=True)


def _draft(say0: str, say0_hi: str = "बल एक धक्का है।"):
    return TeachingPlanDraft.model_validate({
        "language": "en", "objectives": ["o"], "key_terms": [],
        "topics": [{"id": "t1", "title": "Force", "concepts": [
            {"id": "t1c1", "title": "Push", "concept_tags": ["force.push"], "board_ops": [],
             "say": say0, "say_i18n": {"hi": say0_hi}, "teach_notes": "n", "check": {"type": "none"}},
            {"id": "t1c2", "title": "Pull", "concept_tags": ["force.pull"], "board_ops": [],
             "say": "Hello there. One. Two. Three.", "say_i18n": {"hi": "एक।"}, "teach_notes": "n",
             "check": {"type": "none"}},
        ]}],
    })


def test_natural_opening_is_a_soft_check_on_t1c1_only():
    on = Limits(natural_opening=True)
    long_greeting = "Hi {student_name}, welcome! A force is a push. It can move things. Look at the arrow."
    errs = " | ".join(board_quality_errors(_draft(long_greeting), limits=on))
    assert "topics[0].concepts[0]('Push'): say has 4 sentences; the opening concept says at most 2" in errs
    assert "topics[0].concepts[0]('Push'): say greets the learner" in errs
    assert "concepts[1]" not in errs                      # t1c2 may say hello and run long
    # also flags the other-language narration and every supported greeting word
    for word in ("नमस्ते", "नमस्कार", "নমস্কার", "হ্যালো", "ನಮಸ್ಕಾರ", "Namaste", "Welcome"):
        assert "say_i18n['hi'] greets" in " | ".join(board_quality_errors(_draft("A force is a push.", f"{word} बल।"), limits=on))
    ok = _draft("A force is a push. Look at the arrow.")
    assert not [e for e in board_quality_errors(ok, limits=on) if "concepts[0]" in e and ("greets" in e or "opening" in e)]
    # "History…" / "Heyday…" are not greetings
    for say in ("History of force. It moves.", "Heyday of steam. It moved."):
        assert not [e for e in board_quality_errors(_draft(say), limits=on) if "greets" in e]
    # off: nothing new, and soft_errors carries it when on
    assert not [e for e in board_quality_errors(_draft(long_greeting)) if "opening concept" in e or "greets" in e]
    assert any("greets the learner" in e for e in soft_errors(_draft(long_greeting), limits=on))


def test_compiler_threads_natural_into_prompt_limits_and_inputs():
    c = pc.PlanCompiler(institute_id="i", user_id="u", natural_teaching=True)
    assert c.natural_teaching is True
    lesson = SimpleNamespace(style="lesson")
    assert c._limits(lesson).natural_opening is True
    assert c._limits(SimpleNamespace(style="interview")).natural_opening is False
    off = pc.PlanCompiler(institute_id="i", user_id="u")
    assert off.natural_teaching is False and off._limits(lesson) == DEFAULT_LIMITS
    assert DEFAULT_LIMITS.natural_opening is False


def test_voice_prepare_forwards_natural_to_warm_plan(monkeypatch):
    import asyncio
    seen = {}

    async def fake_warm_plan(*, plan_id, slide_id, institute_id, user_id, provider, voice, base_pace, languages,
                             course_lang, request_id=None, metering=None, natural=False):
        seen["natural"] = natural
        return {}

    monkeypatch.setattr(voice_cache, "warm_plan", fake_warm_plan)

    async def go(compiler):
        compiler._schedule_voice_prepare("p", "s")
        await asyncio.gather(*list(pc._VOICE_TASKS))

    asyncio.run(go(pc.PlanCompiler(institute_id="i", user_id="u", voice_prepare={"natural": True})))
    assert seen["natural"] is True
    asyncio.run(go(pc.PlanCompiler(institute_id="i", user_id="u", voice_prepare={"provider": "sarvam"})))
    assert seen["natural"] is False


# ── voice warm-up of variants ────────────────────────────────────────────────

_VIEW = {"style": "lesson", "kind": "document", "topics": [
    {"title": "Force", "summary_say": None, "summary_say_i18n": {}, "concepts": [
        {"say": "A force is a push.", "say_i18n": {"hi": "बल एक धक्का है।"}, "board_ops": [],
         "check": {"type": "none"}},
        {"say": "Look at the arrow.", "say_i18n": {"hi": "तीर देखिए।"}, "board_ops": [],
         "check": {"type": "open", "prompt": "Why?", "prompt_i18n": {"hi": "क्यों?"}, "hint": "Think of kicking.",
                   "hint_i18n": {"hi": "लात के बारे में सोचिए।"}, "expected": "kicking"},
         "predict": "What moves it?", "predict_i18n": {"hi": "इसे क्या हिलाता है?"}}]},
]}


@pytest.fixture
def natural_prompts(monkeypatch):
    """The real tpl_all and warm-up keys when runtime/prompts.py has them;
    stand-ins otherwise (that part lands separately)."""
    if not hasattr(prompts, "tpl_all"):
        alts = {"skipped": {"en": ["Alright, moving on.", "Fine, let's keep going."]},
                "nudge_voice_open": {"en": ["Tap the Answer button to speak."]},
                "warmup_ack": {"en": ["Nice thought — let's see how it fits."]}}

        def tpl_all(key, lang, **kw):
            out = [prompts.tpl(key, lang, **kw)]
            for t in (alts.get(key) or {}).get(lang, []):
                out.append(t.format(**kw))
            return out
        monkeypatch.setattr(prompts, "tpl_all", tpl_all, raising=False)
    for key, en in (("warmup_ask", "Before we start: what comes to mind when you hear {topic}?"),
                    ("warmup_move_on", "No problem, let's start."),
                    ("warmup_ack", "Good thought. Let's see.")):
        if key not in prompts.T:
            monkeypatch.setitem(prompts.T, key, {"en": en, "hi": en})
    return prompts


def _old_spoken_lines(view, lang, course_lang):
    """voice_cache.spoken_lines as it was before natural teaching (verbatim logic)."""
    lines = []

    def alt(base, i18n):
        if lang != course_lang:
            return ((i18n or {}).get(lang) or "").strip() or None
        return (base or "").strip() or None

    for t in view.get("topics") or []:
        for c in t.get("concepts") or []:
            say = alt(c.get("say"), c.get("say_i18n"))
            if say:
                lines.append(prompts.neutralize_name(say) if voice_cache.NAME_PLACEHOLDER in say else say)
            chk = c.get("check") or {}
            if (chk.get("type") or "none") != "none":
                p = alt(chk.get("prompt"), chk.get("prompt_i18n"))
                if p:
                    lines.append(prompts.tpl("ask", lang, prompt=p))
                h = alt(chk.get("hint"), chk.get("hint_i18n"))
                if h:
                    lines.append(prompts.tpl("nudge_hint", lang, hint=h))
                exp = (chk.get("expected") or "").strip()
                if exp and lang == course_lang:
                    lines.append(prompts.tpl("fallback_move_on", lang, expected=exp[:160]))
            pr = alt(c.get("predict"), c.get("predict_i18n"))
            if pr:
                lines.append(prompts.tpl("predict_intro", lang, question=pr))
        recap = alt(t.get("summary_say"), t.get("summary_say_i18n"))
        lines.append(recap or prompts.tpl("topic_summary", lang, topic=t.get("title") or ""))
    for key in ("revisit_done_topic", "revisit_done_slide", "revisit_skipped", "skipped", "pause", "slower", "faster",
                "fallback_correct", "predict_ack", "nudge_open", "idle_end", "credits_end", "media_task_video", "media_task_pdf"):
        lines.append(prompts.tpl(key, lang))
    for n in (1, 2, 3):
        lines.append(prompts.tpl("revisit_intro_topic", lang, n=n))
        lines.append(prompts.tpl("revisit_intro_slide", lang, n=n))
    seen, out = set(), []
    for ln in lines:
        ln = " ".join((ln or "").split())
        if not ln or voice_cache.NAME_PLACEHOLDER in ln or ln in seen:
            continue
        seen.add(ln)
        out.append(ln)
    return out


def test_spoken_lines_off_is_the_single_variant_list(natural_prompts):
    """With the flag off nothing changes: one line per template, no warm-up
    lines, no voice nudges (and no extra synthesis to pay for)."""
    off = voice_cache.spoken_lines(_VIEW, "en", "en")
    assert off == voice_cache.spoken_lines(_VIEW, "en", "en", natural=False)
    # Pinned against the list the pre-feature code built (plain prompts.tpl
    # calls, in its order), in the course language and in a translation.
    assert off == _old_spoken_lines(_VIEW, "en", "en")
    assert voice_cache.spoken_lines(_VIEW, "hi", "en") == _old_spoken_lines(_VIEW, "hi", "en")
    assert prompts.tpl("skipped", "en") in off and prompts.tpl("topic_summary", "en", topic="Force") in off
    assert not any(ln.startswith(prompts.tpl("nudge_voice_open", "en")[:20]) for ln in off)
    for key in ("warmup_move_on", "warmup_ack"):
        assert prompts.tpl(key, "en") not in off
    assert prompts.tpl("warmup_ask", "en", topic="Force") not in off
    for alt in natural_prompts.tpl_all("skipped", "en")[1:]:
        assert alt not in off


def _norm(s):
    return " ".join(s.split())


def test_spoken_lines_natural_prepares_every_variant(natural_prompts):
    on = voice_cache.spoken_lines(_VIEW, "en", "en", natural=True)
    off = voice_cache.spoken_lines(_VIEW, "en", "en")
    assert set(off) <= set(on)                                   # variant 0 of everything is still there
    want = []
    for key in ("skipped", "pause", "slower", "faster", "fallback_correct", "predict_ack", "nudge_open",
                "revisit_done_topic", "revisit_done_slide", "nudge_voice_open", "welcome_back",
                "warmup_move_on", "warmup_ack"):
        want += natural_prompts.tpl_all(key, "en")
    want += natural_prompts.tpl_all("topic_summary", "en", topic="Force")
    want += natural_prompts.tpl_all("predict_intro", "en", question="What moves it?")
    want += natural_prompts.tpl_all("nudge_hint", "en", hint="Think of kicking.")
    want += natural_prompts.tpl_all("nudge_voice_hint", "en", hint="Think of kicking.")
    want += natural_prompts.tpl_all("warmup_ask", "en", topic="Force")     # topics[0].title, as the socket asks
    for ln in want:
        assert _norm(ln) in on, ln
    assert len(on) == len(set(on))                                # deduped
    assert not any("{" in ln and "}" in ln for ln in on)


def test_spoken_lines_natural_in_the_other_language(natural_prompts):
    hi = voice_cache.spoken_lines(_VIEW, "hi", "en", natural=True)
    for ln in natural_prompts.tpl_all("nudge_voice_hint", "hi", hint="लात के बारे में सोचिए।"):
        assert _norm(ln) in hi
    for ln in natural_prompts.tpl_all("skipped", "hi"):
        assert _norm(ln) in hi
    assert not any("Think of kicking" in ln for ln in hi)


def test_no_warmup_question_where_the_socket_never_asks_one(natural_prompts):
    ask = _norm(prompts.tpl("warmup_ask", "en", topic="Force"))
    assert ask in voice_cache.spoken_lines(_VIEW, "en", "en", natural=True)
    for change in ({"kind": "quiz"}, {"style": "interview"}, {"style": "practice"}):
        assert ask not in voice_cache.spoken_lines({**_VIEW, **change}, "en", "en", natural=True)
    predict_first = {**_VIEW, "topics": [{**_VIEW["topics"][0], "concepts": [
        {**_VIEW["topics"][0]["concepts"][0], "predict": "Guess?"}, _VIEW["topics"][0]["concepts"][1]]}]}
    assert ask not in voice_cache.spoken_lines(predict_first, "en", "en", natural=True)
    media_first = {**_VIEW, "topics": [{**_VIEW["topics"][0], "concepts": [
        {**_VIEW["topics"][0]["concepts"][0], "board_ops": [{"op": "media_task", "id": "m"}]}]}]}
    assert ask not in voice_cache.spoken_lines(media_first, "en", "en", natural=True)


def test_spoken_lines_survives_a_missing_or_broken_tpl_all(natural_prompts, monkeypatch):
    def broken(*a, **k):
        raise RuntimeError("boom")
    monkeypatch.setattr(prompts, "tpl_all", broken)
    on = voice_cache.spoken_lines(_VIEW, "en", "en", natural=True)
    assert set(voice_cache.spoken_lines(_VIEW, "en", "en")) <= set(on)
