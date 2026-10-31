"""Weak-concept revisits, the model-written rolling summary and the
institute insights export (design §6.6, §6.9, WP9) — the pure parts."""
import asyncio

from app.services.tutor.insights_export import SHEETS, insights_csv_text
from app.services.tutor.runtime import state as sm
from app.services.tutor.runtime.prompts import (
    learner_block, resume_line, revisit_question_prompt, summary_notes, summary_prompt, tpl, turn_prompt,
)
from app.services.tutor.runtime.revisit import fallback_check, fresh_check


def _lesson():
    return sm.from_plan_view({
        "plan_id": "p", "slide_id": "s", "version": 1, "language": "en", "objectives": [],
        "topics": [
            {"id": "t1", "title": "Force", "order": 1, "summary_ops": [], "concepts": [
                {"id": "a", "title": "Push", "order": 1, "concept_tags": [], "board_ops": [], "say": "push", "say_i18n": {},
                 "teach_notes": None, "check": {"type": "open", "prompt": "Q a?", "expected": "x"}},
                {"id": "b", "title": "Pull", "order": 2, "concept_tags": [], "board_ops": [], "say": "pull", "say_i18n": {},
                 "teach_notes": None, "check": {"type": "open", "prompt": "Q b?", "expected": "y"}},
                {"id": "m", "title": "Clip", "order": 3, "concept_tags": [], "say": "watch", "say_i18n": {}, "teach_notes": None,
                 "board_ops": [{"op": "media_task", "id": "mt", "kind": "video", "url": "https://x/y", "description": "d"}], "check": {"type": "none"}},
            ]},
            {"id": "t2", "title": "Friction", "order": 2, "summary_ops": [], "concepts": [
                {"id": "c", "title": "Grip", "order": 1, "concept_tags": [], "board_ops": [], "say": "grip", "say_i18n": {},
                 "teach_notes": None, "check": {"type": "none"}},
                {"id": "d", "title": "Heat", "order": 2, "concept_tags": [], "board_ops": [], "say": "heat", "say_i18n": {},
                 "teach_notes": None, "check": {"type": "mcq", "prompt": "Q d?", "options": ["1", "2"], "expected": "1"}},
            ]},
        ],
    })


def test_topic_revisit_takes_only_that_topics_weak_concepts_never_media():
    L = _lesson()
    p = sm.pointer_at_topic_end(L, 0)
    got = sm.revisit_candidates(L, p, stage="topic", weak_ids={"a", "m", "d"}, skipped_ids={"b"})
    assert [c.id for c in got] == ["a"]          # b was skipped (slide stage), m is a media task, d is topic 2


def test_slide_revisit_is_weakest_first_capped_and_skips_already_revisited():
    L = _lesson()
    p = sm.pointer_at_slide_end(L)
    got = sm.revisit_candidates(L, p, stage="slide", weak_ids={"a", "d"}, skipped_ids={"b", "c"},
                                scores={"a": 0.4, "d": 0.1}, revisited={"c"})
    # unscored (skipped b) and the 0.1 first, then 0.4; c was already revisited this session
    assert [c.id for c in got] == ["b", "d", "a"]
    assert len(sm.revisit_candidates(L, p, stage="slide", weak_ids={"a", "b", "d"}, skipped_ids={"c"}, limit=2)) == 2


def test_clear_weak_removes_from_weak_and_skipped():
    p = sm.Pointer(weak=["a", "b"], skipped=["a"])
    q = sm.clear_weak(p, "a")
    assert q.weak == ["b"] and q.skipped == [] and p.weak == ["a", "b"]


def test_fallback_check_reasks_the_original_or_asks_in_own_words():
    L = _lesson()
    a = L.topics[0].concepts[0]
    chk = fallback_check(a, "en")
    assert chk["prompt"].endswith("Q a?") and chk["expected"] == "x" and chk["fresh"] is False
    c = L.topics[1].concepts[0]        # no check
    chk = fallback_check(c, "hi")
    assert "Grip" in chk["prompt"] and chk["type"] == "open"


def test_fresh_check_falls_back_when_the_model_is_unavailable(monkeypatch):
    L = _lesson()
    a = L.topics[0].concepts[0]

    def boom(*_a, **_k):
        raise RuntimeError("no db")
    monkeypatch.setattr("app.services.tutor.runtime.revisit.db_session", boom)
    chk, usage = asyncio.run(fresh_check(institute_id="i", user_id="u", model=None, lang="en", concept=a,
                                         previous_answer="dunno", misconception=None, tutor_session_id="t"))
    assert chk["fresh"] is False and chk["prompt"].endswith("Q a?") and usage == {"prompt_tokens": 0, "completion_tokens": 0}


def test_revisit_prompt_lines_and_templates():
    up = turn_prompt(learner_name="N", learner_block="", slide_title="S", objectives=[], board_ops=[], concept_title="Push",
                     concept_say="push", teach_notes=None, check={"type": "open", "prompt": "fresh?", "expected": "x"},
                     transcript=[], learner_message="ans", remediation_no=0, mode="text", final_attempt=True, revisit=True)
    assert "THIS IS A REVISIT" in up and "FINAL ATTEMPT" in up and "FIRST ANSWER" not in up
    q = revisit_question_prompt(lang="hi", concept_title="Push", concept_say="push", teach_notes=None,
                                check={"prompt": "Q a?", "expected": "x"}, previous_answer="dunno", misconception="mixes push and pull")
    assert "do not reuse" in q.lower() and "Hindi" in q and "mixes push and pull" in q
    assert "2" in tpl("revisit_intro_topic", "en", n=2) and "दोहराव" in tpl("revisit_done_slide", "hi")
    assert tpl("revisit_ask", "en", concept="Push", prompt="fresh?") == "About Push. fresh?"


def test_resume_line_only_for_model_written_summaries():
    assert resume_line(None) is None
    assert resume_line("Session on 2026-09-04: 3 answer(s), average score 0.4; 1 concept(s) flagged for review.") is None
    assert resume_line("Only one paragraph, no notes") is None
    s = "Last time you nailed push but mixed up pull. Let's fix that today.\n\nKnows push. Weak: pull. Pace: slow."
    assert resume_line(s).startswith("Last time you nailed") and summary_notes(s).startswith("Knows push")
    # The decision prompt reads the notes, not the spoken line.
    assert "Knows push" in learner_block({"rolling_summary": s, "mastery_json": {}}, []) and "nailed" not in learner_block({"rolling_summary": s, "mastery_json": {}}, [])


def test_summary_prompt_carries_the_session_and_asks_for_both_parts():
    up = summary_prompt(teacher="Asha", learner_name="Riya", lang="hi", digest={
        "date": "2026-09-04", "duration_minutes": 12, "slides": [{"title": "Force", "done": 3, "total": 4}],
        "attempts": [{"concept": "Pull", "score": 0.2, "action": "advance_weak", "misconception": "thinks pull is push", "answer": "same thing"}],
        "weak_titles": ["Pull"], "previous_summary": "Old notes", "pace": "slow"})
    assert "Riya" in up and "3/4 overall" in up and "thinks pull is push" in up and "STILL WEAK: Pull" in up
    assert "PREVIOUS NOTES" in up and "say_next_time" in up and "Hindi" in up


def test_insights_csv_sheets():
    data = {
        "learners": [{"user_id": "u1", "name": "Riya", "courses": 2, "sessions": 3, "minutes": 40, "attempts": 5,
                      "avg_score": 0.5, "weak_attempts": 1, "last_active": "2026-09-04T10:00:00", "note": "Knows push"}],
        "concepts": [{"concept": "Pull", "topic": "Force", "slide": "S", "course": "C", "attempts": 2, "learners": 1,
                      "avg_score": 0.1, "weak_attempts": 2, "weak_learners": 1, "cleared_learners": 0,
                      "misconceptions": ["a", None, "b"], "concept_id": "c1", "slide_id": "s1"}],
        "courses": [{"package_id": "p1", "name": "Physics", "sessions": 3, "learners": 1, "minutes": 40, "attempts": 5,
                     "avg_score": 0.5, "weak_attempts": 1, "last_active": None}],
    }
    for sheet, cols in SHEETS.items():
        txt = insights_csv_text(data, sheet)
        assert txt.startswith("\ufeff" + ",".join(cols))
        assert txt.count("\n") == 2
    assert "a | b" in insights_csv_text(data, "concepts")
    assert "p1,Physics,3" in insights_csv_text(data, "courses")
    try:
        insights_csv_text(data, "nope")
        assert False, "unknown sheet must raise"
    except ValueError:
        pass


def test_csv_cells_that_look_like_formulas_are_neutralised():
    from app.services.tutor.insights_export import _cell
    assert _cell('=HYPERLINK("http://x","o")') == "'=HYPERLINK(\"http://x\",\"o\")"
    assert _cell("-5 marks") == "'-5 marks" and _cell("plain") == "plain" and _cell(3) == 3 and _cell(None) == ""
    assert _cell(["=a", "b"]) == "'=a | b"


def test_summary_gate_skips_empty_reconnects():
    from app.services.tutor.runtime.summary import session_worth_summarising
    assert not session_worth_summarising({"attempts": [], "turns": 0, "concepts_taught": 1, "slides": [{"done": 5, "total": 6}]})
    assert session_worth_summarising({"attempts": [{"concept": "x"}], "turns": 0})
    assert session_worth_summarising({"attempts": [], "turns": 1}) and session_worth_summarising({"attempts": [], "concepts_taught": 2})


def test_run_turn_survives_a_slide_end_pointer(monkeypatch):
    """A slide-end revisit carries a pointer past the last topic; the prompt
    must build (and the model failure fall back) instead of IndexError."""
    from app.services.tutor.runtime.decision import run_turn
    L = _lesson()
    a = L.topics[0].concepts[0]

    def boom(*_a, **_k):
        raise RuntimeError("no db")
    monkeypatch.setattr("app.services.tutor.runtime.decision.db_session", boom)
    d, usage = asyncio.run(run_turn(institute_id="i", user_id="u", model=None, teacher="Asha", lang="en", strictness="normal",
                                    learner_name="N", state={}, lesson=L, pointer=sm.pointer_at_slide_end(L), board_ops=[],
                                    transcript=[], learner_message="ans", kind="answer", mode="text", tutor_session_id="t",
                                    concept=a, final_attempt=True, revisit=True))
    assert d.get("fallback") is True and d["action"] in ("advance", "remediate")
