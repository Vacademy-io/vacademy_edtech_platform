"""Live AI Tutor runtime — the pure parts: state machine, intents, settings
resolution, decision parsing, templates. No DB, no model."""
import json

from app.services.tutor.runtime import state as sm
from app.services.tutor.runtime.decision import fallback_decision, parse_decision
from app.services.tutor.runtime.intents import detect_intent
from app.services.tutor.runtime.prompts import learner_block, system_prompt, tpl, turn_prompt
from app.services.tutor.runtime.settings import TutorSettings, _apply, _extract


def _lesson():
    view = {
        "plan_id": "p", "slide_id": "s", "version": 1, "language": "en", "objectives": ["o"],
        "topics": [
            {"id": "t1", "title": "Force", "order": 1, "summary_ops": [{"op": "callout", "id": "t1-sum", "text": "F = push/pull"}],
             "concepts": [
                 {"id": "t1c1", "title": "Push and pull", "order": 1, "concept_tags": ["force.def"],
                  "board_ops": [{"op": "heading", "id": "t1-h", "text": "Force"}], "say": "A force is a push or a pull.",
                  "say_i18n": {"hi": "बल धक्का या खिंचाव है।"}, "teach_notes": None, "check": {"type": "none"}},
                 {"id": "t1c2", "title": "Examples", "order": 2, "concept_tags": ["force.ex"],
                  "board_ops": [{"op": "bullet", "id": "t1c2-b", "items": ["kick", "pull"]}], "say": "Kicking is a push.",
                  "say_i18n": {}, "teach_notes": "x", "check": {"type": "open", "prompt": "Give a push.", "expected": "kick", "pass_threshold": 0.7}},
             ]},
            {"id": "t2", "title": "Watch", "order": 2, "summary_ops": [],
             "concepts": [
                 {"id": "t2c1", "title": "Video", "order": 1, "concept_tags": [], "board_ops": [{"op": "media_task", "id": "m", "kind": "video", "url": "https://x/y", "description": "d"}],
                  "say": "Watch.", "say_i18n": {}, "teach_notes": None, "check": {"type": "none"}},
                 {"id": "t2c2", "title": "Q", "order": 2, "concept_tags": [], "board_ops": [], "say": "Q?", "say_i18n": {},
                  "teach_notes": None, "check": {"type": "mcq", "prompt": "Pick", "options": ["a", "b"], "expected": "a"}},
             ]},
        ],
    }
    return sm.from_plan_view(view)


def test_state_machine_walks_teach_ask_advance_summary_next_topic_and_done():
    L = _lesson()
    p = sm.Pointer()
    s = sm.enter(L, p)
    assert s.kind == "teach" and s.clear_board and s.concept.id == "t1c1"
    s = sm.after_teach(L, s.pointer)                      # no check → straight to next concept
    assert s.kind == "teach" and s.concept.id == "t1c2" and s.pointer.done == 1
    s = sm.after_teach(L, s.pointer)                      # has a check
    assert s.kind == "ask" and s.pointer.phase == sm.AWAIT_ANSWER
    s = sm.advance(L, s.pointer)                          # correct → end of topic
    assert s.kind == "topic_summary" and s.pointer.done == 2 and s.board_ops[0]["id"] == "t1-sum"
    s = sm.next_topic(L, s.pointer)
    assert s.kind == "media_task" and s.pointer.phase == sm.MEDIA_TASK and s.clear_board
    s = sm.after_teach(L, s.pointer)                      # done watching → next concept (mcq)
    assert s.kind == "teach" and s.concept.id == "t2c2"
    s = sm.after_teach(L, s.pointer)
    assert s.kind == "ask"
    s = sm.advance(L, s.pointer)
    assert s.kind == "topic_summary"
    s = sm.next_topic(L, s.pointer)
    assert s.kind == "slide_done" and s.pointer.phase == sm.SLIDE_DONE and s.pointer.done == 4
    assert s.pointer.progress(L)["percent"] == 100


def test_remediation_is_capped_and_flags_weak():
    L = _lesson()
    p = sm.Pointer(topic=0, concept=1, phase=sm.AWAIT_ANSWER)
    s = sm.remediate(L, p)
    assert s.kind == "ask" and s.pointer.remediations == 1 and s.pointer.phase == sm.REMEDIATE
    s = sm.remediate(L, s.pointer)                        # second miss → advance weak
    assert s.kind == "topic_summary" and "t1c2" in s.pointer.weak
    s2 = sm.skip(L, sm.Pointer(topic=0, concept=1, phase=sm.AWAIT_ANSWER))
    assert "t1c2" in s2.pointer.skipped


def test_resume_finds_pointer_by_concept_id_and_narration_language():
    L = _lesson()
    p = L.find("t1c2")
    assert p and (p.topic, p.concept) == (0, 1) and p.done == 1
    assert L.find("nope") is None
    c = L.concept_at(sm.Pointer())
    assert c.narration("hi").startswith("बल") and c.narration("en").startswith("A force")
    assert L.concept_at(sm.Pointer(topic=0, concept=1)).narration("hi") == "Kicking is a push."   # falls back


def test_intents_only_match_short_utterances():
    assert detect_intent("repeat") == "repeat"
    assert detect_intent("Can you say that again?") == "repeat"
    assert detect_intent("skip") == "skip"
    assert detect_intent("please go slower") == "slower"
    assert detect_intent("I have a doubt") == "doubt"
    assert detect_intent("done") == "done"
    assert detect_intent("दोबारा") == "repeat"
    assert detect_intent("Well, a force is what you apply next to the ball when you kick it, and then it moves") is None


def test_settings_extract_both_envelopes_and_apply():
    pkg = json.dumps({"setting": {"TUTOR_MODE_SETTING": {"key": "TUTOR_MODE_SETTING", "data": {"enabled": True, "teacherName": "Meera", "languages": ["hi", "en"]}}}})
    inst = json.dumps({"setting": {"TUTOR_MODE_SETTING": {"data": {"data": {"enabled": True, "ttsProvider": "google", "defaultOn": False}}}}})
    s = TutorSettings()
    _apply(s, _extract(inst)); _apply(s, _extract(pkg))
    assert s.enabled and s.teacher_name == "Meera" and s.tts_provider == "google" and s.default_on is False
    assert s.course_language == "hi"
    assert _extract("not json") == {} and _extract(None) == {}


def test_parse_decision_validates_targets_and_threshold():
    board = [{"op": "heading", "id": "t1-h", "text": "F"}, {"op": "svg", "id": "d", "svg": "<svg/>", "description": "x", "parts": [{"id": "nucleus", "label": "N"}]}]
    raw = json.dumps({"action": "advance", "say": "Nice.", "assessment": {"score": 0.3},
                      "board_ops": [{"op": "highlight", "target": "nucleus"}, {"op": "highlight", "target": "ghost"},
                                    {"op": "clear"}, {"op": "annotate", "id": "x", "target": "t1-h", "text": "push", "position": "below"}]})
    d = parse_decision(raw, board_ops=board, pass_threshold=0.7)
    assert d["action"] == "remediate"                      # score below threshold cannot advance
    assert [o["target"] for o in d["board_ops"]] == ["nucleus", "t1-h"]
    assert d["board_ops"][1]["op"] == "annotate" and d["board_ops"][1]["position"] == "below"
    assert parse_decision("nonsense", board_ops=board, pass_threshold=0.7) is None
    assert parse_decision(json.dumps({"action": "fly", "say": "x"}), board_ops=board, pass_threshold=0.7) is None


def test_fallback_decisions_keep_the_lesson_moving():
    L = _lesson()
    c = L.concept_at(sm.Pointer(topic=0, concept=1))
    d0 = fallback_decision(kind="answer", lang="en", concept=c, remediation_no=0)
    d1 = fallback_decision(kind="answer", lang="hi", concept=c, remediation_no=1)
    assert d0["action"] == "remediate" and d0["fallback"] and "Try once more" in d0["say"]
    assert d1["action"] == "advance" and "kick" in d1["say"]


def test_templates_and_prompts_render_in_both_languages():
    assert "Asha" in tpl("greet", "en", name="Nikit", teacher="Asha", slide="Force")
    assert "नमस्ते" in tpl("greet", "hi", name="Nikit", teacher="Asha", slide="Force")
    sp = system_prompt("Asha", "hi", "strict")
    assert "Hindi" in sp and '"action"' in sp
    up = turn_prompt(learner_name="Nikit", learner_block=learner_block({"rolling_summary": "ok", "mastery_json": {"force.def": {"score": 0.5}}}, ["force.def"]),
                     slide_title="Force", objectives=["o"], board_ops=[{"op": "heading", "id": "h", "text": "Force"}],
                     concept_title="Examples", concept_say="Kicking is a push.", teach_notes=None,
                     check={"type": "open", "prompt": "Give a push.", "expected": "kick"}, transcript=[{"role": "learner", "text": "hi"}],
                     learner_message="kicking a ball", remediation_no=0, mode="text")
    assert "force.def=0.5" in up and "[heading #h] Force" in up and "FIRST ANSWER" in up


def test_voice_nudge_explains_how_to_answer_in_both_languages():
    # 2026-09-27 review: most voice sessions ended with no answer — students spoke
    # to a microphone that was never on. The silent-mic nudge says how to answer.
    from app.services.tutor.runtime import prompts as p
    for lang in ("en", "hi"):
        with_hint = p.tpl("nudge_voice_hint", lang, hint="Think of your morning.")
        assert "Answer" in with_hint and "Think of your morning." in with_hint
        assert "Answer" in p.tpl("nudge_voice_open", lang)


def test_activeness_report_is_clamped_to_numbers():
    from app.services.tutor.runtime.session_service import clean_activeness
    assert clean_activeness({"avg": "x"}) is None
    assert clean_activeness({}) is None
    out = clean_activeness({"avg": 140, "parts": {"attention": -5, "listening": "72.6", "answering": None, "evil": 9},
                            "seconds": 10 ** 9, "away_count": "3", "note": "<script>"})
    assert out == {"avg": 100, "attention": 0, "listening": 73, "seconds": 6 * 3600, "away_count": 3, "away_seconds": 0}


def test_away_and_welcome_back_lines_exist_in_both_languages():
    from app.services.tutor.runtime import prompts
    for key in ("away", "welcome_back"):
        assert prompts.tpl(key, "en") and prompts.tpl(key, "hi") != prompts.tpl(key, "en")
