"""Handwriting the checker is unsure of goes to the teacher, not to a 0.

A real copy: "a deadlock that stops the business can be dissolved" was read
as "deadlock is not a ground for dissolution" on a page the reader itself
had marked hard to read, and the answer lost the marks with a confident
cross. These checks protect the review_reasons path (copy_check/review.py):
the grader's unclear_reads and cuts on hard-to-read pages reach the
callback, and the prompt tells the grader how to treat such readings."""
import asyncio

from app.services.copy_check import callbacks, review
from app.services.copy_check.prompt_builder import _transcript_for_prompt, build_grading_prompt
from app.services.copy_check.validator import attach_criteria_max, validate_and_cap


def _layout(hard_pages=()):
    pages = []
    for n in (1, 2, 3):
        pid = f"p{n}"
        pages.append({
            "page_id": pid, "vision_text": f"reading of page {n}",
            "vision_legible": pid not in hard_pages,
            "lines": [{"line_id": f"{pid}_r{i}", "text": f"line {i} of page {n}"} for i in range(1, 6)],
        })
    return {"pages": pages}


def _verdict(**kw):
    v = {
        "question_id": "q2", "marks_awarded": 4.0, "max_marks": 10.0, "status": "COMPLETED",
        "criteria_breakdown": [
            {"criteria_name": "Rule", "marks": 1.0, "max": 1.0, "reason": "Full marks (p1_r2)"},
            {"criteria_name": "Deadlock", "marks": 0.0, "max": 1.0,
             "reason": "0 marks: says deadlock is not a ground (p2_r3)"},
        ],
        "annotations": [{"style": "tick", "target": "p1_r2", "page_id": "p1"}],
        "unclear_reads": [],
    }
    v.update(kw)
    return v


def test_unclear_reads_are_cleaned():
    raw = {"unclear_reads": [
        {"part": "2(a)(iii)", "row": "p2_r3", "why": "'not' may be a misreading"},
        "a margin word next to 5(b)(i)",
        {"part": "x"},  # no reason: dropped
        42,
    ]}
    out = review.unclear_reads(raw)
    assert out == [
        {"part": "2(a)(iii)", "row": "p2_r3", "why": "'not' may be a misreading"},
        {"part": "", "row": "", "why": "a margin word next to 5(b)(i)"},
    ]
    assert review.unclear_reads({"unclear_reads": "nope"}) == []
    assert review.unclear_reads(None) == []


def test_unclear_read_becomes_a_review_reason():
    v = _verdict(unclear_reads=[{"part": "2(a)(iii)", "row": "p2_r3", "why": "reads 'not a ground' against its own conclusion"}])
    reasons = review.flag(v, _layout())
    assert reasons == ["Handwriting unclear in 2(a)(iii): reads 'not a ground' against its own conclusion"]
    assert v["review_reasons"] == reasons


def test_cut_on_a_hard_to_read_page_is_flagged():
    v = _verdict()
    assert review.flag(v, _layout(hard_pages=("p2",))) == [
        "Marks were cut on page 2, which the handwriting reader marked as hard to read - check what the student wrote."]


def test_cross_on_a_hard_to_read_page_is_flagged():
    v = _verdict(criteria_breakdown=[], annotations=[{"style": "cross", "target": "p3_r1", "page_id": "p3"}])
    assert review.flag(v, _layout(hard_pages=("p3",)))[0].startswith("Marks were cut on page 3")


def test_full_marks_on_a_hard_page_and_cuts_on_clear_pages_are_not_flagged():
    v = _verdict()
    assert review.flag(v, _layout(hard_pages=("p1",))) == []  # p1 line got full marks
    assert "review_reasons" not in v or v["review_reasons"] == []
    assert review.flag(_verdict(), _layout()) == []


def test_failed_verdict_is_left_alone_and_reasons_are_capped():
    failed = _verdict(status="FAILED", unclear_reads=[{"why": "x"}])
    assert review.flag(failed, _layout()) == []
    v = _verdict()
    for i in range(10):
        review.add_reason(v, f"reason {i}")
    review.add_reason(v, "reason 0")
    assert len(v["review_reasons"]) == review.MAX_REASONS


def test_validator_keeps_unclear_reads():
    q = {"question_id": "q2", "max_marks": 10, "question_type": "LONG_ANSWER"}
    raw = {"marks_awarded": 4, "criteria_breakdown": [], "annotations": [],
           "unclear_reads": [{"part": "5(b)(i)", "why": "margin word"}]}
    v = attach_criteria_max(validate_and_cap(raw, q, _layout()), None)
    assert v["unclear_reads"] == [{"part": "5(b)(i)", "row": "", "why": "margin word"}]
    assert validate_and_cap({"marks_awarded": 1}, q, _layout())["unclear_reads"] == []


def test_prompt_marks_hard_pages_and_asks_for_unclear_reads():
    text = _transcript_for_prompt(_layout(hard_pages=("p2",)))
    assert text.count("HARD TO READ") == 1
    assert text.index("HARD TO READ") > text.index("---- Page p2")
    q = {"question_id": "q2", "question_text": "Deadlock?", "question_type": "LONG_ANSWER", "max_marks": 10}
    prompt = build_grading_prompt(q, {"max_marks": 10, "rubric": [{"criteria_name": "c", "max_marks": 10}]}, _layout())
    assert '"unclear_reads"' in prompt
    assert "Needs teacher review:" in prompt


def test_callback_carries_review_reasons(monkeypatch):
    sent = []

    async def fake_post(url, payload):
        sent.append(payload)

    monkeypatch.setattr(callbacks, "_post", fake_post)
    v = dict(_verdict(), feedback="f", extracted_answer="e", review_reasons=["Handwriting unclear: x"])
    asyncio.run(callbacks.question_done("http://cb", "p", "j", v))
    asyncio.run(callbacks.question_done("http://cb", "p", "j", dict(_verdict(), feedback="f", extracted_answer="e")))
    assert sent[0]["review_reasons"] == ["Handwriting unclear: x"]
    assert sent[1]["review_reasons"] is None
