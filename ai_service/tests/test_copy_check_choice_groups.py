"""Internal choice (spec 7.2, T1.36): which questions count toward the total,
the paper maximum, and enforcement writing the copy's marks back onto the
verdicts (T0.21, gate G9)."""
from app.services.copy_check.choice_groups import (
    counted_awarded,
    counted_flags,
    resolve_paper_max,
)
from app.services.copy_check.enforce_bridge import apply_enforcement


def _v(qid, marks, mx=5, answer="text", rows=None, status="COMPLETED", verdict=None):
    return {"question_id": qid, "marks_awarded": marks, "max_marks": mx, "extracted_answer": answer,
            "answer_rows": rows, "status": status, "verdict": verdict, "annotations": [],
            "criteria_breakdown": [], "feedback": ""}


LAYOUT = {"pages": [
    {"page_id": "p1", "lines": [{"line_id": "p1_r1", "text": "Q12 answer"}, {"line_id": "p1_r2", "text": "Q11 answer"}]},
    {"page_id": "p2", "lines": [{"line_id": "p2_r1", "text": "Q13 answer"}]},
]}


def test_no_groups_counts_everything():
    vs = [_v("a", 1), _v("b", 2)]
    assert counted_flags(vs, None) == {"a": True, "b": True}
    assert counted_flags(vs, []) == {"a": True, "b": True}


def test_first_policy_uses_answer_order_on_the_copy():
    # Paper order 11, 12, 13; the student answered 12 first, then 11, then 13.
    vs = [_v("11", 4, rows=["p1_r2", "p1_r2"]), _v("12", 1, rows=["p1_r1", "p1_r1"]),
          _v("13", 5, rows=["p2_r1", "p2_r1"])]
    flags = counted_flags(vs, [{"question_ids": ["11", "12", "13"], "attempt": 2, "policy": "first"}], LAYOUT)
    assert flags == {"11": True, "12": True, "13": False}


def test_first_policy_falls_back_to_paper_order_without_rows():
    vs = [_v("33", 1), _v("33-OR", 5)]
    flags = counted_flags(vs, [{"question_ids": ["33", "33-OR"], "attempt": 1, "policy": "first"}])
    assert flags == {"33": True, "33-OR": False}


def test_first_policy_keeps_a_failed_question_at_its_paper_position():
    # Q33 FAILED (a FAILED verdict carries no answer_rows); Q33-OR graded on p2.
    # The unknown position must not sort after the known one.
    vs = [_v("33", 0, answer="", status="FAILED"), _v("33OR", 3, rows=["p2_r1", "p2_r1"])]
    flags = counted_flags(vs, [{"question_ids": ["33", "33OR"], "attempt": 1, "policy": "first"}], LAYOUT)
    assert flags == {"33": True, "33OR": False}


def test_first_policy_with_a_lost_position_uses_paper_order():
    # A's rows were dropped by the validator (None); B sits on p2. A was
    # written first on the paper, so A counts, not the 1-mark B.
    vs = [_v("A", 4, rows=None), _v("B", 1, rows=["p2_r1", "p2_r1"])]
    flags = counted_flags(vs, [{"question_ids": ["A", "B"], "attempt": 1, "policy": "first"}], LAYOUT)
    assert flags == {"A": True, "B": False}


def test_best_policy_tie_break_falls_back_to_paper_order_too():
    vs = [_v("A", 3, rows=None), _v("B", 3, rows=["p1_r1", "p1_r1"])]
    flags = counted_flags(vs, [{"question_ids": ["A", "B"], "attempt": 1, "policy": "best"}], LAYOUT)
    assert flags == {"A": True, "B": False}


def test_first_policy_skips_unattempted_and_cancelled():
    vs = [_v("33", 0, answer="", verdict="unattempted"), _v("33-OR", 3)]
    assert counted_flags(vs, [{"question_ids": ["33", "33-OR"], "attempt": 1}]) == {"33": False, "33-OR": True}
    vs = [_v("33", 0, verdict="cancelled"), _v("33-OR", 3)]
    assert counted_flags(vs, [{"question_ids": ["33", "33-OR"], "attempt": 1}]) == {"33": False, "33-OR": True}


def test_best_policy_takes_highest_marks():
    vs = [_v("a", 2), _v("b", 5), _v("c", 4), _v("d", 1)]
    flags = counted_flags(vs, [{"question_ids": ["a", "b", "c", "d"], "attempt": 2, "policy": "best"}])
    assert flags == {"a": False, "b": True, "c": True, "d": False}


def test_best_policy_never_drops_a_failed_question():
    vs = [_v("a", 4), _v("b", 0, answer="", status="FAILED"), _v("c", 3)]
    flags = counted_flags(vs, [{"question_ids": ["a", "b", "c"], "attempt": 2, "policy": "best"}])
    assert flags["b"] is True and flags["a"] is True and flags["c"] is False


def test_fewer_attempted_than_allowed_fills_with_unattempted_in_paper_order():
    vs = [_v("a", 0, answer="", verdict="unattempted"), _v("b", 3),
          _v("c", 0, answer="", verdict="unattempted")]
    flags = counted_flags(vs, [{"question_ids": ["a", "b", "c"], "attempt": 2, "policy": "first"}])
    assert flags == {"a": True, "b": True, "c": False}


def test_group_members_absent_from_the_request_are_ignored():
    vs = [_v("a", 2), _v("b", 4)]
    flags = counted_flags(vs, [{"question_ids": ["a", "b", "zz-objective"], "attempt": 2, "policy": "best"}])
    assert flags == {"a": True, "b": True}


def test_paper_max():
    qs = [{"question_id": "1", "max_marks": 1}, {"question_id": "2", "max_marks": 2},
          {"question_id": "a", "max_marks": 5}, {"question_id": "b", "max_marks": 4},
          {"question_id": "c", "max_marks": 3}]
    groups = [{"question_ids": ["a", "b", "c"], "attempt": 2, "policy": "best"}]
    assert resolve_paper_max(qs, groups) == 1 + 2 + 5 + 4
    assert resolve_paper_max(qs, groups, 80) == 80.0
    assert resolve_paper_max(qs, None) is None


def test_counted_awarded_skips_uncounted():
    vs = [dict(_v("a", 2), counted=True), dict(_v("b", 4), counted=False), _v("c", 1)]
    assert counted_awarded(vs) == 3


# ------------------------------------------------------------ enforcement


ENF_LAYOUT = {"pages": [{"page_id": "p1", "lines": [
    {"line_id": "p1_r1", "text": "Q1 first answer"},
    {"line_id": "p1_r2", "text": "Q2 second answer"},
    {"line_id": "p1_r3", "text": "Q3 third answer"},
]}]}


def _meta(*rows):
    return [{"question_id": q, "paper_label": None, "max_marks": m, "question_type": "LONG_ANSWER"} for q, m in rows]


def test_enforcement_writes_the_copy_mark_back_and_rescales_criteria():
    v = _v("q1", 1.3, mx=2, rows=["p1_r1", "p1_r1"])
    v["criteria_breakdown"] = [{"criteria_name": "A", "marks": 0.65, "reason": ""},
                               {"criteria_name": "B", "marks": 0.65, "reason": ""}]
    verdicts, total, report, _ = apply_enforcement([v], ENF_LAYOUT, _meta(("q1", 2)))
    assert verdicts[0]["marks_awarded"] == 1.5
    assert round(sum(c["marks"] for c in verdicts[0]["criteria_breakdown"]), 2) == 1.5
    score = [a for a in verdicts[0]["annotations"] if a.get("style") == "score"]
    assert score and score[0]["text"] == "1.5/2"
    assert total["text"] == "1.5/2"
    assert "counted" not in verdicts[0]


def test_enforcement_leaves_failed_questions_and_missing_max_alone():
    failed = _v("q1", 0, mx=2, answer="", status="FAILED")
    no_max = _v("q2", 1.3, mx=2, rows=["p1_r2", "p1_r2"])
    verdicts, *_ = apply_enforcement([failed, no_max], ENF_LAYOUT, _meta(("q1", 2), ("q2", None)))
    assert verdicts[0]["status"] == "FAILED" and verdicts[0]["marks_awarded"] == 0
    assert verdicts[1]["marks_awarded"] == 1.3


def test_enforcement_with_choice_groups_marks_counted_and_totals_counted_only():
    vs = [_v("q1", 2, mx=5, rows=["p1_r1", "p1_r1"]), _v("q2", 4, mx=5, rows=["p1_r2", "p1_r2"]),
          _v("q3", 3, mx=5, rows=["p1_r3", "p1_r3"])]
    groups = [{"question_ids": ["q1", "q2", "q3"], "attempt": 2, "policy": "best"}]
    verdicts, total, report, _ = apply_enforcement(
        vs, ENF_LAYOUT, _meta(("q1", 5), ("q2", 5), ("q3", 5)), paper_max=10, choice_groups=groups)
    assert [v["counted"] for v in verdicts] == [False, True, True]
    assert total["text"] == "7/10"
    assert any("not counted q1" in line for line in report)
