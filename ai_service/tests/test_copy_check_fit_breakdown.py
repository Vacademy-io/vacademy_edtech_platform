"""Rubric lines must add up to the mark without lying about where it came from.

A real copy showed "1.4 / 1" on two lines of one answer and "Full marks"
lines worth 0.8 on another: the validator rescaled the whole breakdown to the
headline mark before any line's maximum was known. fit_breakdown (run once a
verdict is final) keeps every line within its maximum, never credits a line
the grader gave nothing, and sends what fits nowhere to the teacher."""
from app.services.copy_check.enforce_bridge import _write_back_marks
from app.services.copy_check.validator import fit_breakdown, validate_and_cap


def _line(name, marks, mx=1.0, reason=""):
    return {"criteria_name": name, "marks": marks, "max": mx, "reason": reason}


def _q5(awarded):
    lines = [_line(f"5(a) point {i + 1}", 0.0, reason="Not attempted") for i in range(6)]
    lines += [_line("rule", 1.0), _line("applied", 0.5), _line("unregistered", 1.0), _line("remedy", 0.0)]
    return {"question_id": "q5", "marks_awarded": awarded, "max_marks": 10.0, "criteria_breakdown": lines}


def test_validator_no_longer_scales_a_short_breakdown_up():
    q = {"question_id": "q5", "max_marks": 10}
    raw = {"marks_awarded": 3.5, "criteria_breakdown": [
        {"criteria_name": "rule", "marks": 1}, {"criteria_name": "applied", "marks": 0.5},
        {"criteria_name": "unregistered", "marks": 1}]}
    v = validate_and_cap(raw, q, {"pages": []})
    assert [c["marks"] for c in v["criteria_breakdown"]] == [1.0, 0.5, 1.0]
    raw["marks_awarded"] = 2.0  # still scaled DOWN to the mark
    v = validate_and_cap(raw, q, {"pages": []})
    assert round(sum(c["marks"] for c in v["criteria_breakdown"]), 2) == 2.0


def test_short_breakdown_is_topped_up_on_credited_lines_within_max():
    v = _q5(3.0)
    assert fit_breakdown(v) == 0.0
    marks = [c["marks"] for c in v["criteria_breakdown"]]
    assert marks[6:] == [1.0, 1.0, 1.0, 0.0]
    assert all(m == 0.0 for m in marks[:6])
    assert "review_reasons" not in v


def test_what_fits_nowhere_stays_off_the_lines_and_goes_to_review():
    v = _q5(4.0)  # the case from the real copy: lines can hold 3
    assert fit_breakdown(v) == 1.0
    marks = [c["marks"] for c in v["criteria_breakdown"]]
    assert all(c["marks"] <= c["max"] for c in v["criteria_breakdown"])
    assert all(m == 0.0 for m in marks[:6]) and marks[9] == 0.0
    assert v["marks_awarded"] == 4.0
    assert v["review_reasons"] == [
        "The mark (4) is more than its rubric lines add up to (3); check the breakdown before accepting it."]


def test_lines_over_their_max_come_down_and_long_breakdowns_scale_down():
    v = {"marks_awarded": 4.0, "criteria_breakdown": [_line("a", 1.4), _line("b", 0.7), _line("c", 1.4)]}
    fit_breakdown(v)
    assert all(c["marks"] <= 1.0 for c in v["criteria_breakdown"])
    v = {"marks_awarded": 4.0, "criteria_breakdown": [_line("a", 1.0, 2.0), _line("b", 2.0, 2.0), _line("c", 2.0, 2.0)]}
    assert fit_breakdown(v) == 0.0
    assert round(sum(c["marks"] for c in v["criteria_breakdown"]), 2) == 4.0


def test_lines_without_a_known_max_take_the_rest():
    v = {"marks_awarded": 5.0, "criteria_breakdown": [
        {"criteria_name": "a", "marks": 2.0, "max": None}, {"criteria_name": "b", "marks": 0.0, "max": None}]}
    assert fit_breakdown(v) == 0.0
    assert [c["marks"] for c in v["criteria_breakdown"]] == [5.0, 0.0]


def test_empty_or_matching_breakdowns_are_left_alone():
    assert fit_breakdown({"marks_awarded": 3}) == 0.0
    v = {"marks_awarded": 2.0, "criteria_breakdown": [_line("a", 1.0), _line("b", 1.0)]}
    assert fit_breakdown(v) == 0.0 and [c["marks"] for c in v["criteria_breakdown"]] == [1.0, 1.0]


def test_enforcement_raise_keeps_lines_within_max():
    v = _q5(3.0)
    v["status"] = "COMPLETED"
    report = []
    _write_back_marks([v], [3.5], [{"question_id": "q5", "max_marks": 10}], report)
    assert v["marks_awarded"] == 3.5
    assert all(c["marks"] <= c["max"] for c in v["criteria_breakdown"])
    assert all(c["marks"] == 0.0 for c in v["criteria_breakdown"][:6])
