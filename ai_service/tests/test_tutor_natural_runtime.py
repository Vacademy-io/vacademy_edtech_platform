"""Natural teaching (course setting naturalTeaching), runtime side: line
variety (TV / tpl(vary) / tpl_all), the greeting strip, the verdict bridge,
the warm-up acknowledgement and the warm-up's routing helpers. No DB, no model."""
import asyncio
import json
import random
import string

import pytest

from app.routers import tutor_ws
from app.routers.tutor_ws import (
    WARMUP_WAIT_TEXT_SECONDS, WARMUP_WAIT_VOICE_SECONDS, audio_arriving, warmup_command, warmup_gate,
    warmup_wait_seconds,
)
from app.services.tutor import languages as L
from app.services.tutor.runtime import decision as D
from app.services.tutor.runtime import prompts
from app.services.tutor.runtime import state as sm
from app.services.tutor.runtime.intents import detect_intent


VARIED_KEYS = ("predict_intro", "predict_ack", "topic_summary", "skipped", "next_slide", "slower", "faster", "pause",
               "nudge_hint", "nudge_open", "nudge_voice_hint", "nudge_voice_open", "revisit_done_topic",
               "revisit_done_slide", "fallback_correct", "welcome_back")
NEW_KEYS = ("greet_short", "greet_returning_short", "warmup_ask", "warmup_ack", "warmup_move_on")
LANGS = ("en", "hi", "bn", "kn")


def _fields(s: str) -> set:
    return {f for _, f, _, _ in string.Formatter().parse(s) if f}


def _literal(s: str) -> str:
    return "".join(lit for lit, *_ in string.Formatter().parse(s))


# ── line variety ─────────────────────────────────────────────────────────────

def test_every_listed_key_has_two_extra_variants_in_every_language():
    for key in VARIED_KEYS:
        for lang in LANGS:
            assert len(prompts.TV[key][lang]) == 2, f"{key}/{lang}"


def test_variants_keep_placeholders_and_script():
    for key, table in prompts.TV.items():
        assert key in prompts.T, f"TV key {key} has no variant 0 in T"
        want = _fields(prompts.T[key]["en"])
        for lang, alts in table.items():
            assert lang in LANGS
            for alt in alts:
                assert _fields(alt) == want, f"{key}/{lang} placeholders differ: {alt}"
                assert alt not in (prompts.T[key].get(lang),), f"{key}/{lang} repeats variant 0"
                if lang != "en":
                    assert L.in_native_script(_literal(alt), lang), f"{key}/{lang} is not in {lang} script: {alt}"
            assert len(set(alts)) == len(alts), f"{key}/{lang} has duplicate variants"


def test_register_and_english_command_words_kept():
    # Hindi आप, Bengali আপনি, Kannada ನೀವು: never the informal forms.
    for key, table in prompts.TV.items():
        for alt in table.get("hi", []):
            assert " तुम" not in alt and not alt.startswith("तुम"), alt
        for alt in table.get("bn", []):
            assert "তুমি" not in alt and "তোমার" not in alt, alt
        for alt in table.get("kn", []):
            assert "ನೀನು" not in alt and "ನಿನಗೆ" not in alt, alt
    for lang in ("hi", "bn", "kn"):
        assert all("'continue'" in a for a in prompts.TV["pause"][lang])
        assert all("'skip'" in a for a in prompts.TV["nudge_open"][lang])
        assert all("Answer" in a for a in prompts.TV["nudge_voice_open"][lang] + prompts.TV["nudge_voice_hint"][lang])


def test_tpl_without_vary_is_todays_line():
    for key in prompts.T:
        for lang in LANGS:
            kw = {f: "X" for f in _fields(prompts.T[key]["en"])}
            line = prompts.tpl(key, lang, **kw)
            assert line == prompts.T[key][lang].format(**kw)
            assert prompts.tpl_all(key, lang, **kw)[0] == line


def test_tpl_vary_picks_uniformly_among_all_variants(monkeypatch):
    monkeypatch.setattr(prompts, "_rng", random.Random(7))
    seen = {prompts.tpl("topic_summary", "bn", vary=True, topic="Force") for _ in range(200)}
    assert seen == set(prompts.tpl_all("topic_summary", "bn", topic="Force"))
    assert len(seen) == 3 and all("Force" in s and "{" not in s for s in seen)


def test_tpl_vary_on_a_key_without_variants_and_unknown_language():
    assert prompts.tpl("credits_end", "en", vary=True) == prompts.tpl("credits_end", "en")
    assert prompts.tpl_all("credits_end", "kn") == [prompts.T["credits_end"]["kn"]]
    # An unsupported language falls back to English, variants included.
    assert prompts.tpl_all("skipped", "ta") == prompts.tpl_all("skipped", "en")


def test_new_warmup_keys_in_every_language():
    for key in NEW_KEYS:
        for lang in LANGS:
            assert prompts.T[key][lang]
            assert _fields(prompts.T[key][lang]) == _fields(prompts.T[key]["en"])
    assert _fields(prompts.T["warmup_ask"]["en"]) == {"topic"}
    # Prepared once for every course: no placeholders, never a question.
    for key in ("warmup_ack", "warmup_move_on"):
        for line in prompts.tpl_all(key, "en") + prompts.tpl_all(key, "bn") + prompts.tpl_all(key, "kn") + prompts.tpl_all(key, "hi"):
            assert not _fields(line) and "?" not in line
    for line in prompts.tpl_all("warmup_ask", "kn", topic="Force"):
        assert "Force" in line and line.rstrip().endswith("?")


def test_short_greeting_does_not_say_lets_begin():
    en = prompts.tpl("greet_short", "en", name="Riya", teacher="Asha", slide="Force")
    assert en.startswith("Hi Riya") and "begin" not in en.lower() and "Asha" in en and "Force" in en
    assert "चलिए शुरू करते हैं" not in prompts.tpl("greet_short", "hi", name="R", teacher="A", slide="F")
    assert "চলুন শুরু করি" not in prompts.tpl("greet_short", "bn", name="R", teacher="A", slide="F")
    assert "ಶುರು ಮಾಡೋಣ" not in prompts.tpl("greet_short", "kn", name="R", teacher="A", slide="F")
    back = prompts.tpl("greet_returning_short", "en", name="Riya", previous="Motion", summary="", slide="Force")
    assert back.startswith("Welcome back, Riya") and "begin" not in back.lower()


# ── greeting strip ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("narration,expected", [
    ("নমস্কার রিয়া! আজ আমরা বল শিখব। বল হলো ধাক্কা।", "আজ আমরা বল শিখব। বল হলো ধাক্কা।"),
    ("হ্যালো রিয়া। বল হলো ধাক্কা।", "বল হলো ধাক্কা।"),
    ("ನಮಸ್ಕಾರ ರಿಯಾ! ಬಲ ಎಂದರೆ ತಳ್ಳುವುದು.", "ಬಲ ಎಂದರೆ ತಳ್ಳುವುದು."),
    ("नमस्कार राहुल! बल धक्का है।", "बल धक्का है।"),
    ("नमस्ते राहुल! बल धक्का है।", "बल धक्का है।"),
    ("Hi {student_name}, let's start. A force is a push.", "A force is a push."),
    ("Welcome back! A force is a push.", "A force is a push."),
    # Not greetings: words that merely start with "hi" / "hey".
    ("History is the study of the past. It matters.", "History is the study of the past. It matters."),
    ("Hindi has many dialects. Let's look.", "Hindi has many dialects. Let's look."),
    ("Heyday of Rome. It lasted.", "Heyday of Rome. It lasted."),
])
def test_strip_leading_greeting_all_languages(narration, expected):
    assert prompts.strip_leading_greeting(narration, extended=True) == expected


@pytest.mark.parametrize("narration,expected", [
    # The off arm strips exactly what it always did: Indic greetings other
    # than नमस्ते stay, and "Hi"-prefixed words still lose their sentence.
    ("নমস্কার রিয়া! আজ আমরা বল শিখব। বল হলো ধাক্কা।", "নমস্কার রিয়া! আজ আমরা বল শিখব। বল হলো ধাক্কা।"),
    ("ನಮಸ್ಕಾರ ರಿಯಾ! ಬಲ ಎಂದರೆ ತಳ್ಳುವುದು.", "ನಮಸ್ಕಾರ ರಿಯಾ! ಬಲ ಎಂದರೆ ತಳ್ಳುವುದು."),
    ("नमस्कार राहुल! बल धक्का है।", "नमस्कार राहुल! बल धक्का है।"),
    ("नमस्ते राहुल! बल धक्का है।", "बल धक्का है।"),
    ("Hi {student_name}, let's start. A force is a push.", "A force is a push."),
    ("History is the study of the past. It matters.", "It matters."),
])
def test_strip_leading_greeting_default_is_the_old_pattern(narration, expected):
    assert prompts.strip_leading_greeting(narration) == expected
    import re
    old = re.compile(r"^\s*(?:hi|hello|hey|namaste|नमस्ते|welcome(?: back)?)[^.!?।]*[.!?।]\s*", re.IGNORECASE)
    out = old.sub("", narration, count=1)
    assert prompts.strip_leading_greeting(narration) == (out if out.strip() else narration)


def test_bengali_predict_ack_variants_are_neutral():
    assert all("মজার" not in line for line in prompts.tpl_all("predict_ack", "bn"))


# ── the bridge ───────────────────────────────────────────────────────────────

def _lesson(**extra):
    view = {
        "plan_id": "p", "slide_id": "s", "version": 1, "language": "en", "objectives": ["o"], **extra,
        "topics": [
            {"id": "t1", "title": "Force", "order": 1, "summary_ops": [],
             "concepts": [
                 {"id": "t1c1", "title": "Push and pull", "order": 1, "concept_tags": [],
                  "board_ops": [{"op": "heading", "id": "h", "text": "Force"}],
                  "say": "Hi {student_name}, welcome. A force is a push or a pull.", "say_i18n": {},
                  "teach_notes": None, "check": {"type": "open", "prompt": "Name one.", "expected": "push"}},
                 {"id": "t1c2", "title": "Examples", "order": 2, "concept_tags": [], "board_ops": [],
                  "say": "Kicking, {student_name}, is a push. Pulling a door is a pull.", "say_i18n": {},
                  "teach_notes": None, "check": {"type": "open", "prompt": "Give a push.", "expected": "kick"}},
                 {"id": "t1c3", "title": "Guess first", "order": 3, "concept_tags": [], "board_ops": [],
                  "say": "Heavier things need more force.", "say_i18n": {}, "teach_notes": None,
                  "predict": "Which needs more force, a ball or a car?", "check": {"type": "none"}},
             ]},
            {"id": "t2", "title": "Watch", "order": 2, "summary_ops": [],
             "concepts": [
                 {"id": "t2c1", "title": "Video", "order": 1, "concept_tags": [],
                  "board_ops": [{"op": "media_task", "id": "m", "kind": "video", "url": "https://x/y", "description": "d"}],
                  "say": "Watch.", "say_i18n": {}, "teach_notes": None, "check": {"type": "none"}},
             ]},
        ],
    }
    return sm.from_plan_view(view)


@pytest.mark.parametrize("raw,expected", [
    ("Now let's see some everyday examples", "Now let's see some everyday examples."),
    ('  "That idea leads straight into examples."  ', "That idea leads straight into examples."),
    ("अब कुछ उदाहरण देखते हैं", "अब कुछ उदाहरण देखते हैं।"),
    ("ಈಗ ಕೆಲವು ಉದಾಹರಣೆಗಳನ್ನು ನೋಡೋಣ", "ಈಗ ಕೆಲವು ಉದಾಹರಣೆಗಳನ್ನು ನೋಡೋಣ."),
    ("Ready for some examples?", None),
    ("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen", None),
    ("", None), (None, None), (42, None),
])
def test_clean_bridge(raw, expected):
    assert D.clean_bridge(raw) == expected


def test_parse_decision_keeps_bridge_only_on_advance():
    raw = {"action": "advance", "say": "Exactly right.", "board_ops": [], "assessment": {"score": 0.9},
           "bridge": "That push idea carries into everyday examples."}
    d = D.parse_decision(json.dumps(raw), board_ops=[], pass_threshold=0.7)
    assert d["say"] == "Exactly right." and d["bridge"] == "That push idea carries into everyday examples."
    # Demoted to remediate (score below the threshold): no bridge.
    raw["assessment"]["score"] = 0.3
    assert D.parse_decision(json.dumps(raw), board_ops=[], pass_threshold=0.7)["bridge"] is None
    # Never asked for (flag off): the key is simply absent from the reply.
    d = D.parse_decision(json.dumps({"action": "advance", "say": "Yes.", "assessment": {"score": 1}}),
                         board_ops=[], pass_threshold=0.7)
    assert d["bridge"] is None and d["say"] == "Yes."


@pytest.mark.parametrize("action,next_kind,bridge,expected", [
    ("advance", "teach", "Now, examples.", "Right! Now, examples."),
    ("advance", "predict", "Now, a guess.", "Right! Now, a guess."),
    ("advance", "media_task", "Now, a video.", "Right! Now, a video."),
    ("advance", "topic_summary", "Now, examples.", "Right!"),
    ("advance", "slide_done", "Now, examples.", "Right!"),
    ("remediate", "teach", "Now, examples.", "Right!"),
    ("advance", "teach", None, "Right!"),
])
def test_append_bridge_rules(action, next_kind, bridge, expected):
    assert D.append_bridge("Right!", bridge, action=action, next_kind=next_kind) == expected
    # Untouched when nothing is appended (the off path's verdict, byte for byte).
    if expected == "Right!":
        assert D.append_bridge("Right! ", bridge, action=action, next_kind=next_kind) == "Right! "


def test_append_bridge_comes_after_a_trailing_question():
    # The socket's "?" fallback runs on the model's say before the bridge is added.
    out = D.append_bridge("Nice — see why?", "Now, examples.", action="advance", next_kind="teach")
    assert out == "Nice — see why? Now, examples."


def test_bridge_target_peeks_the_next_step():
    les = _lesson()
    p_c1 = sm.Pointer(topic=0, concept=0, phase=sm.AWAIT_ANSWER)
    nxt = sm.advance(les, p_c1, mark_done=True)
    assert nxt.kind == "teach"
    # Teach next: its title plus its opening sentence, name neutralised.
    assert D.bridge_target(nxt, "en") == "Examples (it opens with: Kicking is a push.)"
    # Predict next: the title only (its narration answers the guess).
    p_c2 = sm.Pointer(topic=0, concept=1, phase=sm.AWAIT_ANSWER)
    nxt = sm.advance(les, p_c2, mark_done=True)
    assert nxt.kind == "predict" and D.bridge_target(nxt, "en") == "Guess first"
    # End of topic: nothing to bridge into.
    p_c3 = sm.Pointer(topic=0, concept=2, phase=sm.TEACH, predicted=True)
    assert D.bridge_target(sm.advance(les, p_c3, mark_done=True), "en") is None
    # Media task next: title only.
    media = sm.next_topic(les, sm.Pointer(topic=0, concept=3, phase=sm.TOPIC_SUMMARY))
    assert media.kind == "media_task" and D.bridge_target(media, "en") == "Video"
    assert D.bridge_target(None, "en") is None


def test_peek_is_pure():
    les = _lesson()
    p = sm.Pointer(topic=0, concept=0, phase=sm.AWAIT_ANSWER)
    a = sm.advance(les, p, mark_done=True)
    b = sm.advance(les, p, mark_done=True)
    assert p.done == 0 and p.concept == 0 and a.pointer == b.pointer and a.kind == b.kind


def test_bridge_prompt_only_when_asked():
    off = prompts.system_prompt("Asha", "en", "normal")
    assert '"bridge"' not in off and off.endswith(prompts.DECISION_SCHEMA)
    on = prompts.system_prompt("Asha", "en", "normal", bridge=True)
    assert on.startswith(off) and '"bridge"' in on and "15 words" in on
    base = dict(learner_name="R", learner_block="", slide_title="S", objectives=[], board_ops=[], concept_title="C",
                concept_say="x", teach_notes=None, check={}, transcript=[], learner_message="push", remediation_no=0,
                mode="text")
    assert "NEXT CONCEPT" not in prompts.turn_prompt(**base)
    assert "NEXT CONCEPT" in prompts.turn_prompt(**base, next_concept="Examples") and "Examples" in prompts.turn_prompt(**base, next_concept="Examples")


class _FakeClient:
    seen = []
    reply = ""

    def __init__(self, *a, **k):
        pass

    async def chat_completion(self, messages, **kw):
        _FakeClient.seen.append(messages)
        return {"content": _FakeClient.reply, "usage": {"prompt_tokens": 10, "completion_tokens": 5}, "model": "m"}


class _NullDb:
    def __enter__(self):
        return None

    def __exit__(self, *a):
        return False


class _Keys:
    def __init__(self, db):
        pass

    def resolve_keys(self, *a, **k):
        return {}


@pytest.fixture
def fake_llm(monkeypatch):
    _FakeClient.seen = []
    monkeypatch.setattr(D, "ChatLLMClient", _FakeClient)
    monkeypatch.setattr(D, "ApiKeyResolver", _Keys)
    monkeypatch.setattr(D, "db_session", lambda: _NullDb())
    billed = []
    monkeypatch.setattr(D, "record_llm_billing", lambda **kw: billed.append(kw))
    return billed


def _run_turn(les, *, kind="answer", revisit=False, next_concept="Examples"):
    return asyncio.run(D.run_turn(
        institute_id="i", user_id="u", model=None, teacher="Asha", lang="en", strictness="normal", learner_name="R",
        state={}, lesson=les, pointer=sm.Pointer(phase=sm.AWAIT_ANSWER), board_ops=[], transcript=[],
        learner_message="a push", kind=kind, mode="text", tutor_session_id="ts", revisit=revisit,
        next_concept=next_concept))


def test_run_turn_asks_for_the_bridge_only_on_graded_answers(fake_llm):
    les = _lesson()
    _FakeClient.reply = json.dumps({"action": "advance", "say": "Yes!", "assessment": {"score": 0.9},
                                    "bridge": "Pushes are everywhere around us."})
    d, _ = _run_turn(les)
    sys_, user = _FakeClient.seen[-1][0]["content"], _FakeClient.seen[-1][1]["content"]
    assert '"bridge"' in sys_ and "NEXT CONCEPT" in user and d["bridge"] == "Pushes are everywhere around us."
    for kw in ({"kind": "doubt"}, {"revisit": True}, {"next_concept": None}):
        _run_turn(les, **kw)
        sys_, user = _FakeClient.seen[-1][0]["content"], _FakeClient.seen[-1][1]["content"]
        assert '"bridge"' not in sys_ and "NEXT CONCEPT" not in user, kw


# ── the warm-up acknowledgement ──────────────────────────────────────────────

def _ack(**kw):
    args = dict(institute_id="i", user_id="u", model=None, teacher="Asha", lang="bn", learner_name="Riya",
                question="শুরু করার আগে: Force শুনলে আপনার মনে কী আসে?", answer="ঠেলা দেওয়া", topic="Force",
                first_concept="Push and pull", tutor_session_id="ts")
    args.update(kw)
    return asyncio.run(D.run_warmup_ack(**args))


def test_warmup_ack_happy_path_bills_as_warmup(fake_llm):
    _FakeClient.reply = json.dumps({"say": "ঠেলার কথা ভেবেছেন, দারুণ। চলুন সেটাই বোর্ডে দেখি।"})
    say, usage, fell_back = _ack()
    assert say == "ঠেলার কথা ভেবেছেন, দারুণ। চলুন সেটাই বোর্ডে দেখি।" and not fell_back
    assert usage == {"prompt_tokens": 10, "completion_tokens": 5}
    assert fake_llm and fake_llm[-1]["usage_context"]["feature"] == "warmup" and fake_llm[-1]["metadata"]["kind"] == "warmup"
    user = _FakeClient.seen[-1][1]["content"]
    assert "Reply in Bengali" in user and "do not quote their words" in user and "Push and pull" in user


def test_warmup_ack_falls_back_on_error(monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("model down")
    monkeypatch.setattr(D, "_warmup_completion", boom)
    say, usage, fell_back = _ack(lang="kn")
    assert fell_back and say in prompts.tpl_all("warmup_ack", "kn") and usage["prompt_tokens"] == 0


def test_warmup_ack_falls_back_on_timeout(monkeypatch):
    async def slow(*a, **k):
        await asyncio.sleep(5)
        return {"content": json.dumps({"say": "too late"})}
    monkeypatch.setattr(D, "_warmup_completion", slow)
    say, _usage, fell_back = _ack(lang="en", timeout=0.05)
    assert fell_back and say in prompts.tpl_all("warmup_ack", "en")


@pytest.mark.parametrize("reply", ["", "not json", json.dumps({"say": ""}), json.dumps({"say": "Nice! What else do you know?"})])
def test_warmup_ack_falls_back_on_unusable_reply(fake_llm, reply):
    _FakeClient.reply = reply
    say, _usage, fell_back = _ack(lang="hi")
    assert fell_back and say in prompts.tpl_all("warmup_ack", "hi")


def test_warmup_ack_default_timeout_is_short():
    assert 3 <= D.WARMUP_ACK_TIMEOUT_S <= 6 and D.WARMUP_MAX_TOKENS <= 150


def test_clean_warmup_ack_keeps_whole_sentences():
    long = " ".join(["This is one sentence about pushes."] * 15)
    out = D.clean_warmup_ack(json.dumps({"say": long}))
    assert out and len(out) <= D.WARMUP_ACK_MAX_CHARS and out.endswith(".")


# ── warm-up routing helpers ──────────────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    # Short answers that the intent patterns would misread.
    ("moving again and again", None), ("slow and fast", None), ("aage badhna", None), ("next to me", None),
    ("I don't understand", None), ("explain", None), ("gravity", None), ("a push or a pull", None),
    # Exactly one command word.
    ("skip", "skip"), ("next", "skip"), ("Next.", "skip"), ("ok", "skip"), ("hmm", "skip"), ("continue", "skip"),
    ("done", "skip"), ("again", "repeat"), ("repeat", "repeat"), ("pause", "pause"), ("faster", "faster"),
    ("आगे", "skip"), ("চলুন", "skip"), ("ಮುಂದುವರಿಸಿ", "skip"),
])
def test_warmup_command_spoken_or_typed(text, expected):
    assert warmup_command(text, detect_intent(text), from_control=False) == expected


@pytest.mark.parametrize("intent,expected", [
    ("repeat", "repeat"), ("slower", "slower"), ("faster", "faster"), ("pause", "pause"),
    ("skip", "skip"), ("resume", "skip"), ("done", "skip"),
])
def test_warmup_command_from_buttons(intent, expected):
    assert warmup_command(intent, detect_intent(intent), from_control=True) == expected


def test_warmup_gate():
    ok = dict(fresh=True, style="lesson", plan_kind="lesson", step_kind="teach", topic_index=0, concept_index=0,
              is_demo=False)
    assert warmup_gate(**ok)
    for change in ({"fresh": False}, {"style": "interview"}, {"style": "practice"}, {"plan_kind": "quiz"},
                   {"step_kind": "predict"}, {"step_kind": "media_task"}, {"concept_index": 1}, {"topic_index": 1},
                   {"is_demo": True}):
        assert not warmup_gate(**{**ok, **change}), change
    assert warmup_gate(**{**ok, "style": None, "plan_kind": None})       # older plans: lesson


def test_warmup_gate_on_a_real_plan():
    les = _lesson()
    step = sm.enter(les, sm.Pointer())
    assert step.kind == "teach" and getattr(les, "kind", "lesson") == "lesson"
    assert warmup_gate(fresh=True, style=les.style, plan_kind=les.kind, step_kind=step.kind,
                       topic_index=step.pointer.topic, concept_index=step.pointer.concept, is_demo=False)
    quiz = _lesson(kind="quiz")
    assert quiz.kind == "quiz" and not warmup_gate(fresh=True, style=quiz.style, plan_kind=quiz.kind, step_kind="teach",
                                                   topic_index=0, concept_index=0, is_demo=False)


def test_warmup_waits_and_audio_guard():
    assert warmup_wait_seconds("voice") == WARMUP_WAIT_VOICE_SECONDS == 15
    assert warmup_wait_seconds("text") == WARMUP_WAIT_TEXT_SECONDS == 40
    assert WARMUP_WAIT_VOICE_SECONDS < tutor_ws.NUDGE_SECONDS
    assert audio_arriving(1, 0.0, 100.0)                  # bytes buffered: a recording is open
    assert audio_arriving(0, 98.0, 100.0)                 # a chunk two seconds ago
    assert not audio_arriving(0, 90.0, 100.0)


def test_short_ok_unchanged_for_the_off_path():
    assert tutor_ws.SHORT_OK == ("ok", "okay", "yes", "haan", "हाँ", "ji", "जी", "hmm", "sure", "next", "fine")


# ── the socket, end to end (text mode, services faked) ──────────────────────

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from app.services.tutor.runtime.settings import TutorSettings  # noqa: E402


def _socket(monkeypatch, *, natural, resumed=False, mode="TEXT", tts_delay=0.0, ack_fell_back=False, **extra):
    calls = {"tele": [], "saves": 0, "attempts": 0, "tts": 0}
    les = _lesson()
    svc = tutor_ws.svc
    monkeypatch.setattr(svc, "session_owner", lambda sid: {"user_id": "u", "status": "ACTIVE", "package_session_id": "ps"})
    monkeypatch.setattr(tutor_ws, "decode_access_token", lambda t: {"user": "u"})
    ctx = {"lesson": les, "institute_id": "i", "package_session_id": "ps", "chat_session_id": "c", "mode": mode,
           "settings": TutorSettings(), "state": {}, "language": "en", "learner_name": "Riya",
           "pointer": sm.Pointer(topic=0, concept=0, phase=sm.TEACH) if resumed else None,
           "tts_provider": "sarvam", "tts_voice": None, "natural": natural, **extra}
    monkeypatch.setattr(svc, "boot_context", lambda sid: ctx)
    monkeypatch.setattr(svc, "limit_roles_for", lambda *a: None)
    monkeypatch.setattr(svc, "note_start_progress", lambda *a: None)
    def save(**kw): calls["saves"] += 1
    monkeypatch.setattr(svc, "save_pointer", save)
    monkeypatch.setattr(svc, "append_transcript", lambda *a, **k: None)
    monkeypatch.setattr(svc, "bump_telemetry", lambda sid, **kw: calls["tele"].append(kw))
    def att(**kw): calls["attempts"] += 1
    monkeypatch.setattr(svc, "record_attempt", att)
    monkeypatch.setattr(svc, "end_session", lambda **kw: {"transitioned": False})
    async def ack(**kw):
        calls["ack_args"] = kw
        return "Nice idea, let's look.", {"prompt_tokens": 1, "completion_tokens": 1}, ack_fell_back
    monkeypatch.setattr(tutor_ws, "run_warmup_ack", ack)
    # Voice: no real TTS (no audio bytes), the first line optionally slow so a
    # test can barge in while the opening is still being said; no billing.
    async def tts(**kw):
        calls["tts"] += 1
        if tts_delay and calls["tts"] == 1:
            await asyncio.sleep(tts_delay)
        return b"", "audio/wav", "sarvam"
    monkeypatch.setattr(tutor_ws, "synthesize_speech", tts)
    monkeypatch.setattr(tutor_ws.voice_cache, "lookup", lambda key: None)
    monkeypatch.setattr(svc, "bill_live_minute", lambda **kw: True)
    async def turn(**kw):
        calls.setdefault("turns", []).append(kw)
        return ({"action": "answer_doubt", "say": "Good question, we will see.", "board_ops": [], "assessment": {},
                 "learner_state_delta": {}}, {"prompt_tokens": 1, "completion_tokens": 1})
    monkeypatch.setattr(tutor_ws, "run_turn", turn)
    async def kb(*a, **k):
        return None
    monkeypatch.setattr(svc, "kb_source_block", kb)
    app = FastAPI(); app.include_router(tutor_ws.router)
    return TestClient(app), calls


def _auth(ws, caps=True):
    ws.send_text(json.dumps({"type": "auth", "token": "t", **({"caps": ["warmup"]} if caps else {})}))


def _kinds(seen):
    return [(m.get("meta") or {}).get("kind") for m in seen if m["type"] == "ai_text"]


def _frames_until(ws, pred, limit=40):
    seen = []
    for _ in range(limit):
        m = ws.receive_json(); seen.append(m)
        if pred(m):
            return seen
    raise AssertionError(seen)


def test_socket_warmup_answer_then_teach(monkeypatch):
    client, calls = _socket(monkeypatch, natural=True)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        kinds = [(m["type"], (m.get("meta") or {}).get("kind")) for m in seen]
        assert ("ai_text", "greet") in kinds and ("ai_text", "warmup_ask") in kinds
        chk = [m for m in seen if m["type"] == "check"][0]
        assert chk["warmup"] and chk["concept_id"] is None and chk["predict"]
        assert not any(m["type"] == "board" and m.get("ops") for m in seen)
        assert calls["saves"] == 0
        ws.send_text(json.dumps({"type": "answer", "text": "again and again"}))   # NOT a repeat
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        kinds = [(m["type"], (m.get("meta") or {}).get("kind")) for m in seen]
        assert ("ai_text", "warmup_ack") in kinds, kinds
        teach = [m for m in seen if m["type"] == "ai_text" and m["meta"].get("kind") == "teach"][0]
        assert not teach["text"].lower().startswith("hi"), teach["text"]     # greeting stripped once
        assert seen[-1]["what"] == "answer"     # concept 1's real check after teaching
        assert calls["ack_args"]["answer"] == "again and again"
        assert calls["attempts"] == 0 and calls["saves"] >= 1
        t = {k for d in calls["tele"] for k in d}
        assert {"warmup_eligible", "warmups_offered", "warmups_answered"} <= t
        # The warm-up is not a learner turn (it would make an open-and-close
        # session "worth summarising") and its fallback is not a decision fallback.
        bump = [d for d in calls["tele"] if "warmups_answered" in d][0]
        assert "turns" not in bump and "fallbacks" not in bump and bump["warmup_ack_fallbacks"] == 0
        assert bump["llm_prompt_tokens"] == 1
        ws.send_text(json.dumps({"type": "end_session"}))


def test_socket_warmup_continue_and_single_word_skip(monkeypatch):
    client, calls = _socket(monkeypatch, natural=True)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "await")
        ws.send_text(json.dumps({"type": "answer", "text": "again"}))         # one word: repeat the question
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert any((m.get("meta") or {}).get("kind") == "warmup_ask" for m in seen) and calls["saves"] == 0
        ws.send_text(json.dumps({"type": "config", "pace": "slow"}))
        _frames_until(ws, lambda m: m.get("type") == "pace")
        assert calls["saves"] == 0        # a pace change during the warm-up is not saved (refresh = fresh)
        ws.send_text(json.dumps({"type": "continue"}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        kinds = [(m.get("meta") or {}).get("kind") for m in seen if m["type"] == "ai_text"]
        assert kinds[0] == "warmup_ack" and "teach" in kinds and "ask" in kinds
        assert any("warmups_skipped" in d for d in calls["tele"])
        ws.send_text(json.dumps({"type": "end_session"}))


def test_socket_warmup_silence_moves_on(monkeypatch):
    monkeypatch.setattr(tutor_ws, "WARMUP_WAIT_TEXT_SECONDS", 1)
    client, calls = _socket(monkeypatch, natural=True)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "await")
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        kinds = [(m.get("meta") or {}).get("kind") for m in seen if m["type"] == "ai_text"]
        assert kinds[0] == "warmup_ack" and "teach" in kinds
        assert any("warmups_silent" in d for d in calls["tele"])
        ws.send_text(json.dumps({"type": "end_session"}))


def test_socket_off_arm_opening_unchanged(monkeypatch):
    client, calls = _socket(monkeypatch, natural=False)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        kinds = [(m.get("meta") or {}).get("kind") for m in seen if m["type"] == "ai_text"]
        assert kinds == ["greet", "teach", "ask"], kinds
        assert "Let's begin" in [m for m in seen if m["type"] == "ai_text"][0]["text"]
        assert any("warmup_eligible" in d for d in calls["tele"])
        assert not any(k.startswith("warmups_") for d in calls["tele"] for k in d)
        ws.send_text(json.dumps({"type": "end_session"}))


def test_socket_resumed_gets_no_warmup(monkeypatch):
    client, calls = _socket(monkeypatch, natural=True, resumed=True)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        kinds = [(m.get("meta") or {}).get("kind") for m in seen if m["type"] == "ai_text"]
        assert "warmup_ask" not in kinds and not any("warmup_eligible" in d for d in calls["tele"])
        ws.send_text(json.dumps({"type": "end_session"}))


def test_socket_warmup_ack_fallback_has_its_own_counter(monkeypatch):
    client, calls = _socket(monkeypatch, natural=True, ack_fell_back=True)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "await")
        ws.send_text(json.dumps({"type": "answer", "text": "pushing a cart"}))
        _frames_until(ws, lambda m: m.get("type") == "await")
        assert not any("fallbacks" in d for d in calls["tele"])
        assert any(d.get("warmup_ack_fallbacks") == 1 for d in calls["tele"])
        assert not any(d.get("turns") for d in calls["tele"])
        ws.send_text(json.dumps({"type": "end_session"}))


def test_socket_no_warmup_for_a_bundle_without_the_capability(monkeypatch):
    """An open tab with a bundle from before the warm-up gets the ordinary opening."""
    client, calls = _socket(monkeypatch, natural=True)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws, caps=False)
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert _kinds(seen) == ["greet", "teach", "ask"]
        assert not any(m["type"] == "check" and m.get("warmup") for m in seen)
        assert any("warmup_unsupported_client" in d for d in calls["tele"])
        assert not any("warmups_offered" in d for d in calls["tele"])
        ws.send_text(json.dumps({"type": "end_session"}))


@pytest.mark.parametrize("natural", [True, False])
def test_socket_eligibility_counts_once_per_learner_and_slide(monkeypatch, natural):
    """An earlier session already had an eligible opening of this slide (e.g.
    the learner closed during the warm-up): neither arm counts it again, and
    the natural arm does not offer the warm-up a second time."""
    client, calls = _socket(monkeypatch, natural=natural, warmup_seen=True)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert _kinds(seen) == ["greet", "teach", "ask"]
        assert not any(k.startswith("warmup") for d in calls["tele"] for k in d)
        ws.send_text(json.dumps({"type": "end_session"}))


def test_warmup_seen_before_query_shape(monkeypatch):
    from types import SimpleNamespace
    from app.services.tutor.runtime import session_service as svc_mod

    class _Q:
        def __init__(self, row):
            self.row, self.filters = row, []

        def filter(self, *a):
            self.filters.extend(a)
            return self

        def limit(self, n):
            return self

        def first(self):
            return self.row

    class _Db:
        def __init__(self, row):
            self.q = _Q(row)

        def query(self, *a):
            return self.q

    ts = SimpleNamespace(id="ts2", user_id="u", package_session_id="ps", started_slide_id="s")
    db = _Db(("ts1",))
    assert svc_mod.warmup_seen_before(db, ts) is True and len(db.q.filters) == 5
    assert svc_mod.warmup_seen_before(_Db(None), ts) is False
    assert svc_mod.warmup_seen_before(_Db(("x",)), SimpleNamespace(**{**ts.__dict__, "started_slide_id": None})) is False

    class _Broken:
        def query(self, *a):
            raise RuntimeError("db down")

        def rollback(self):
            raise RuntimeError("still down")

    assert svc_mod.warmup_seen_before(_Broken(), ts) is False


def test_client_supports_warmup():
    assert tutor_ws.client_supports_warmup({"type": "auth", "caps": ["warmup"]})
    for frame in ({"type": "auth"}, {"caps": "warmup"}, {"caps": []}, None, []):
        assert not tutor_ws.client_supports_warmup(frame)


def test_estimated_speech_seconds():
    est = tutor_ws.estimated_speech_seconds
    assert est("") == 0
    line = "Before we start: what comes to mind when you hear Force?"
    assert 3.0 <= est(line) <= 5.0
    assert est(line, 1.5) < est(line) < est(line, 0.8)
    assert est("a   b") == est("a b")


def test_socket_warmup_answer_on_the_greeting_gets_the_question(monkeypatch):
    """A barge-in on the greeting (before the question went out) is never the
    warm-up answer: the question is asked, and nothing is counted."""
    client, calls = _socket(monkeypatch, natural=True, mode="VOICE", tts_delay=1.0)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "ai_text" and m["meta"].get("kind") == "greet")
        ws.send_text(json.dumps({"type": "answer", "text": "Hi Asha"}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert _kinds(seen) == ["warmup_ask"] and seen[-1]["what"] == "answer"
        assert any(m["type"] == "check" and m.get("warmup") for m in seen)
        assert "ack_args" not in calls and not any("warmups_answered" in d for d in calls["tele"])
        # Continue on the greeting would likewise ask, and only THEN does an answer count.
        ws.send_text(json.dumps({"type": "answer", "text": "pushing things"}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert _kinds(seen) == ["warmup_ack"] and calls["ack_args"]["answer"] == "pushing things"
        ws.send_text(json.dumps({"type": "end_session"}))


def test_socket_continue_on_the_greeting_asks_the_warmup_question(monkeypatch):
    client, calls = _socket(monkeypatch, natural=True, mode="VOICE", tts_delay=1.0)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "ai_text" and m["meta"].get("kind") == "greet")
        ws.send_text(json.dumps({"type": "continue"}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert _kinds(seen) == ["warmup_ask"]
        assert not any(k.startswith("warmups_") and k != "warmups_offered" for d in calls["tele"] for k in d)
        ws.send_text(json.dumps({"type": "end_session"}))


def test_socket_voice_warmup_holds_concept_one_until_the_reply_has_played(monkeypatch):
    """Voice: after her reply the server waits for Continue (the client sends
    it once the audio has played). Anything said meanwhile is never graded."""
    client, calls = _socket(monkeypatch, natural=True, mode="VOICE")
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "await")
        ws.send_text(json.dumps({"type": "answer", "text": "pushing a cart"}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert _kinds(seen) == ["warmup_ack"] and seen[-1]["what"] == "continue"
        assert not any(m["type"] == "check" for m in seen)
        # The learner adds a thought while the reply plays: answered, not graded.
        ws.send_text(json.dumps({"type": "answer", "text": "and also pulling a door"}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert _kinds(seen) == ["answer_doubt"] and seen[-1]["what"] == "continue"
        assert calls["attempts"] == 0 and calls["turns"][-1]["kind"] == "doubt"
        ws.send_text(json.dumps({"type": "continue"}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        kinds = _kinds(seen)
        assert kinds[0] == "teach" and kinds[-1] == "ask" and seen[-1]["what"] == "answer"
        teach = [m for m in seen if m["type"] == "ai_text" and m["meta"].get("kind") == "teach"][0]
        assert not teach["text"].lower().startswith("hi")
        assert calls["attempts"] == 0
        ws.send_text(json.dumps({"type": "end_session"}))


def test_socket_voice_warmup_clock_counts_from_playback(monkeypatch):
    """The voice wait starts when the greeting + question have PLAYED, not
    when their audio was sent."""
    import time as _t
    monkeypatch.setattr(tutor_ws, "WARMUP_WAIT_VOICE_SECONDS", 2)
    monkeypatch.setattr(tutor_ws, "estimated_speech_seconds", lambda text_, pace=1.0: 1.5)
    client, calls = _socket(monkeypatch, natural=True, mode="VOICE")
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "await")
        t0 = _t.time()
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        # greeting 1.5 + beat 0.45 + question 1.5 still playing, then the 2 s wait (fires 1 s early at
        # most): never before ~4.45 s. Counted from the send it would come at 1-4 s.
        assert _kinds(seen) == ["nudge"] and _t.time() - t0 >= 4.4
        ws.send_text(json.dumps({"type": "end_session"}))


@pytest.mark.parametrize("attempt", ["too_short", "discard", "empty_text"])
def test_socket_failed_answer_attempt_restarts_the_warmup_clock(monkeypatch, attempt):
    import time as _t
    monkeypatch.setattr(tutor_ws, "WARMUP_WAIT_TEXT_SECONDS", 5)
    monkeypatch.setattr(tutor_ws, "AUDIO_ACTIVE_GRACE_SECONDS", 0.0)
    async def transcode(audio, mime):
        return b"x", "audio/wav", "n"
    monkeypatch.setattr(tutor_ws, "_transcode_to_wav", transcode)
    client, calls = _socket(monkeypatch, natural=True)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "await")
        _t.sleep(2.5)
        if attempt == "empty_text":
            ws.send_text(json.dumps({"type": "answer", "text": "   "}))
        else:
            ws.send_text(json.dumps({"type": "audio_chunk", "data": "AAAA"}))
            ws.send_text(json.dumps({"type": "audio_end" if attempt == "too_short" else "audio_discard", "mime": "audio/wav"}))
        t1 = _t.time()
        seen = _frames_until(ws, lambda m: m.get("type") == "ai_text" and m["meta"].get("kind") == "warmup_ack")
        assert _t.time() - t1 >= 3.0, "the move-on came from the clock of the first wait"
        assert any("warmups_silent" in d for d in calls["tele"])
        ws.send_text(json.dumps({"type": "end_session"}))


def test_socket_warmup_never_moves_on_while_away(monkeypatch):
    monkeypatch.setattr(tutor_ws, "WARMUP_WAIT_TEXT_SECONDS", 1)
    import time as _t
    client, calls = _socket(monkeypatch, natural=True)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "await")
        ws.send_text(json.dumps({"type": "presence", "present": False}))
        _t.sleep(3.5)
        ws.send_text(json.dumps({"type": "ping"}))
        assert ws.receive_json()["type"] == "pong"        # nothing happened while away
        assert not any("warmups_silent" in d for d in calls["tele"])
        ws.send_text(json.dumps({"type": "presence", "present": True}))
        seen = _frames_until(ws, lambda m: m.get("type") == "ai_text" and m["meta"].get("kind") == "warmup_ack")
        assert any("warmups_silent" in d for d in calls["tele"])
        ws.send_text(json.dumps({"type": "end_session"}))


def test_socket_away_during_the_warmup_greeting_pauses_and_reasks(monkeypatch):
    client, calls = _socket(monkeypatch, natural=True, mode="VOICE", tts_delay=1.0)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "ai_text" and m["meta"].get("kind") == "greet")
        ws.send_text(json.dumps({"type": "presence", "present": False}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert _kinds(seen) == ["away"] and seen[-1]["what"] == "continue"
        assert not any(m["type"] == "board" and m.get("ops") for m in seen)
        ws.send_text(json.dumps({"type": "presence", "present": True}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert _kinds(seen) == ["welcome_back", "warmup_ask"] and seen[-1]["what"] == "answer"
        assert any(m["type"] == "check" and m.get("warmup") for m in seen)
        assert calls["saves"] == 0
        ws.send_text(json.dumps({"type": "end_session"}))


# ── the off arm's greeting fix: only Continue / "go on" changes ─────────────

def test_socket_off_arm_pause_during_greeting_waits_then_teaches(monkeypatch):
    client, calls = _socket(monkeypatch, natural=False, mode="VOICE", tts_delay=1.0)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "ai_text" and m["meta"].get("kind") == "greet")
        ws.send_text(json.dumps({"type": "control", "intent": "pause"}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert _kinds(seen) == ["pause"] and seen[-1]["what"] == "continue"
        ws.send_text(json.dumps({"type": "continue"}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        kinds = _kinds(seen)
        assert kinds == ["teach", "ask"], kinds           # taught first, never its check untaught
        ws.send_text(json.dumps({"type": "end_session"}))


@pytest.mark.parametrize("frame", [{"type": "ask", "text": "what is this lesson about"},
                                   {"type": "answer", "text": "what is this lesson about"}])
def test_socket_off_arm_question_during_greeting_is_answered(monkeypatch, frame):
    client, calls = _socket(monkeypatch, natural=False, mode="VOICE", tts_delay=1.0)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "ai_text" and m["meta"].get("kind") == "greet")
        ws.send_text(json.dumps(frame))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert _kinds(seen) == ["answer_doubt"] and seen[-1]["what"] == "continue"
        assert calls["turns"][-1]["kind"] == "doubt" and calls["attempts"] == 0
        ws.send_text(json.dumps({"type": "continue"}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert _kinds(seen) == ["teach", "ask"]
        ws.send_text(json.dumps({"type": "end_session"}))


def test_socket_off_arm_continue_during_greeting_teaches(monkeypatch):
    client, calls = _socket(monkeypatch, natural=False, mode="VOICE", tts_delay=1.0)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "ai_text" and m["meta"].get("kind") == "greet")
        ws.send_text(json.dumps({"type": "continue"}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        assert _kinds(seen) == ["teach", "ask"]
        ws.send_text(json.dumps({"type": "end_session"}))


def test_socket_off_arm_skip_during_greeting_skips_concept_one(monkeypatch):
    client, calls = _socket(monkeypatch, natural=False, mode="VOICE", tts_delay=1.0)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws)
        _frames_until(ws, lambda m: m.get("type") == "ai_text" and m["meta"].get("kind") == "greet")
        ws.send_text(json.dumps({"type": "control", "intent": "skip"}))
        seen = _frames_until(ws, lambda m: m.get("type") == "await")
        kinds = _kinds(seen)
        assert kinds[0] == "skip" and calls["attempts"] == 1
        teach = [m for m in seen if m["type"] == "ai_text" and m["meta"].get("kind") == "teach"][0]
        assert teach["text"].startswith("Kicking")        # concept 2, concept 1 skipped as before
        ws.send_text(json.dumps({"type": "end_session"}))
