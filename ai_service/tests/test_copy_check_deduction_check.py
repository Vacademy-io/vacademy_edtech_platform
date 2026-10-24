"""Offline tests for re-checking cut marks against the answer's image.

No network. Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_copy_check_deduction_check.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from PIL import Image

from ai_service.app.services.copy_check import deduction_check as dc

failures: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        failures.append(f"{label}: {detail}")
        print(f"  FAIL  {label} — {detail}")


LAYOUT = {"pages": [
    {"page_id": "p4", "lines": [
        {"line_id": "p4_r3", "box": [86, 259, 59, 43], "text": "25)"},
        {"line_id": "p4_r4", "box": [72, 320, 457, 48], "text": "= 1/6 (-3/12 + 5/12)"},
        {"line_id": "p4_r11", "box": [321, 848, 56, 44], "text": "= 1/30"},
        {"line_id": "p4_r12", "box": [56, 1041, 685, 51], "text": "26) Speed: 210/3 = 70 km/h"},
    ]},
    {"page_id": "p5", "lines": [
        {"line_id": "p5_r1", "box": [100, 100, 600, 50], "text": "continued"},
        {"line_id": "p5_r2", "box": [100, 200, 300, 50], "text": "x = 5"},
    ]},
]}


def _verdict(marks=1.0):
    return {
        "question_id": "q25", "marks_awarded": marks, "max_marks": 2.0, "status": "COMPLETED",
        "extracted_answer": "= 1/6 (-3/12 + 5/12) ... = 1/30", "answer_rows": ["p4_r3", "p4_r11"],
        "criteria_breakdown": [
            {"criteria_name": "Method", "marks": 1.0, "max_marks": 1.0, "reason": "ok"},
            {"criteria_name": "Final answer", "marks": 0.0, "max_marks": 1.0, "reason": "final answer 1/30, not 7/30"},
        ],
        "annotations": [
            {"style": "cross", "target": "p4_r11", "page_id": "p4"},
            {"style": "score", "target": "p4_r11", "page_id": "p4", "text": "1/2"},
            {"style": "margin_note", "target": "p4_r11", "page_id": "p4", "text": "Final answer should be 7/30"},
        ],
    }


def test_regions() -> None:
    print("\nanswer_regions — the answer's rows, full writing width, padded, per page")
    regions = dc.answer_regions(LAYOUT, ["p4_r3", "p4_r11"])
    check("one region on p4", [r[0] for r in regions] == ["p4"], str(regions))
    left, top, right, bottom = regions[0][1]
    check("starts above the label", top < 259, str(top))
    check("reaches below the last row (stacked denominator room)", bottom > 892, str(bottom))
    check("stops before the next answer", bottom < 1041, str(bottom))
    check("full width of the writing", left <= 56 and right >= 741, str((left, right)))
    regions = dc.answer_regions(LAYOUT, ["p4_r11", "p5_r2"])
    check("runs on to the next page", [r[0] for r in regions] == ["p4", "p5"], str(regions))
    check("unknown rows -> nothing", dc.answer_regions(LAYOUT, ["p9_r1"]) == [])


def test_apply() -> None:
    print("\napply_check — raise on a misreading, never lower, keep real cuts")
    v = _verdict()
    raised = dc.apply_check(v, {"what_the_student_wrote": "7/5 (-3/12 + 5/12) = 7/5 x 1/6 = 7/30",
                                "cuts": [{"reason": "final answer 1/30", "finding": "misread", "why": "the image shows 7/30"}],
                                "marks_awarded": 2, "note": ""})
    check("raised to full", raised and v["marks_awarded"] == 2.0, str(v["marks_awarded"]))
    styles = [a["style"] for a in v["annotations"]]
    check("cross -> tick, note dropped", "cross" not in styles and "margin_note" not in styles, str(styles))
    check("score rewritten", [a["text"] for a in v["annotations"] if a["style"] == "score"] == ["2/2"])
    check("breakdown sums to the mark", sum(c["marks"] for c in v["criteria_breakdown"]) == 2.0)

    v = _verdict()
    check("a real cut is kept", not dc.apply_check(v, {"cuts": [{"finding": "real"}], "marks_awarded": 2}) and v["marks_awarded"] == 1.0)
    v = _verdict()
    check("never lowered", not dc.apply_check(v, {"cuts": [{"finding": "misread"}], "marks_awarded": 0}) and v["marks_awarded"] == 1.0)
    v = _verdict()
    dc.apply_check(v, {"cuts": [{"finding": "misread", "why": "x"}], "marks_awarded": 9})
    check("capped at max", v["marks_awarded"] == 2.0)
    v = _verdict(0.5)
    dc.apply_check(v, {"cuts": [{"finding": "misread", "why": "7 not 1"}, {"finding": "real"}],
                       "marks_awarded": 1.5, "note": "Common factor not shown."})
    check("partial raise keeps a note", v["marks_awarded"] == 1.5 and
          [a["text"] for a in v["annotations"] if a["style"] == "margin_note"] == ["Common factor not shown."])


class FakeLLM:
    def __init__(self, reply):
        self.reply, self.calls, self.images = reply, 0, 0

    async def chat_completion(self, **kw):
        self.calls += 1
        self.images = len(kw["messages"][1]["attachments"])
        return {"content": json.dumps(self.reply), "usage": {"prompt_tokens": 1500, "completion_tokens": 100}}


def test_checker() -> None:
    print("\nDeductionChecker — only cut marks are checked, and it never breaks grading")
    async def fake_download(url, dest):
        dest.write_bytes(b"%PDF")
    dc._download = fake_download
    dc.DeductionChecker._render = lambda self, pdf, pid: Image.new("RGB", (1400, 2200), "white") if pid in ("p4", "p5") else None
    llm = FakeLLM({"cuts": [{"finding": "misread", "why": "7/30"}], "marks_awarded": 2})
    ck = dc.DeductionChecker("http://x/c.pdf", LAYOUT, llm)
    q = {"question_id": "q25", "question_text": "7/5 x (-3/12) + 7/5 x (5/12)", "max_marks": 2.0, "paper_label": "25"}
    v = _verdict()
    check("cut answer raised", asyncio.run(ck.check(v, q, {"rubric": []})) and v["marks_awarded"] == 2.0)
    check("one image sent", llm.images == 1, str(llm.images))
    check("pdf fetched once and kept as bytes", ck._pdf == b"%PDF")
    full = _verdict(2.0)
    calls = llm.calls
    check("full marks not re-checked", not asyncio.run(ck.check(full, q, {})) and llm.calls == calls)

    calls = llm.calls
    mcq = {"question_id": "q6", "question_type": "MCQS", "question_text": "reciprocal of -7/19", "max_marks": 1.0}
    v = _verdict(0.0); v["max_marks"] = 1.0
    check("MCQs are left to the option-letter rule", not asyncio.run(ck.check(v, mcq, {})) and llm.calls == calls)

    class Boom(FakeLLM):
        async def chat_completion(self, **kw):
            raise RuntimeError("provider down")
    v = _verdict()
    check("provider failure leaves the verdict alone",
          not asyncio.run(dc.DeductionChecker("http://x", LAYOUT, Boom({})).check(v, q, {})) and v["marks_awarded"] == 1.0)


def test_reading_borrowed_from_the_paper() -> None:
    print("\nborrowed_phrases — a reading copied from the question or scheme raises nothing")
    layout = {"pages": [{"page_id": "p4", "lines": [
        {"line_id": "p4_r1", "box": [0, 0, 500, 40],
         "text": "Consideration can be inadequate. A contract cannot be void just because of its consideration."},
        {"line_id": "p4_r2", "box": [0, 50, 500, 40],
         "text": "Anita let her neighbour Sohan use her van for Rs 3000 a month and Sohan paid in advance."},
        {"line_id": "p4_r3", "box": [0, 100, 500, 40], "text": "It is not a void contract and is enforceable."},
    ]}]}
    q = {"question_id": "q4", "max_marks": 3.0, "question_text": (
        "Anita agreed to let her neighbour Sohan use her van for six months for Rs 3,000 a month. "
        "Anita fixed the hire herself after consulting her chartered accountant, and nobody pressed "
        "her to agree. Decide whether Anita is right.")}
    rubric = {"rubric": [{"criteria_name": "Free consent", "max_marks": 1.0, "evaluation_guidelines":
                          "Anita fixed the hire herself after advice and nobody pressed her, so her consent was free"}]}
    v = {"extracted_answer": "Consideration can be inadequate ... It is not a void contract and is enforceable.",
         "answer_rows": ["p4_r1", "p4_r3"]}
    # What the check claimed on a real copy: a sentence of the question.
    copied = {"what_the_student_wrote": (
        "Consideration can be inadequate; contract cannot be void just because of its consideration. "
        "Anita fixed the hire herself after consulting her chartered accountant and nobody pressed her to agree.")}
    n = dc.borrowed_phrases(copied, q, rubric, v, layout)
    check("a sentence of the question is caught", n > dc.MAX_BORROWED, f"{n} borrowed phrases")
    faithful = {"what_the_student_wrote": "Anita let her neighbour Sohan use her van for Rs 3000 a month. "
                                          "It is not a void contract and is enforceable."}
    n = dc.borrowed_phrases(faithful, q, rubric, v, layout)
    check("facts of the question the student restated are not borrowed", n == 0, f"{n} borrowed phrases")
    maths = {"what_the_student_wrote": "7/5 (-3/12 + 5/12) = 7/5 x 1/6 = 7/30"}
    check("maths working is never affected", dc.borrowed_phrases(maths, q, rubric, v, layout) == 0)

    async def fake_download(url, dest):
        dest.write_bytes(b"%PDF")
    dc._download = fake_download
    dc.DeductionChecker._render = lambda self, pdf, pid: Image.new("RGB", (1400, 2200), "white")
    llm = FakeLLM({**copied, "cuts": [{"finding": "misread", "why": "free consent is stated"}], "marks_awarded": 3})
    cut = dict(v, question_id="q4", marks_awarded=2.0, max_marks=3.0, status="COMPLETED",
               criteria_breakdown=[{"criteria_name": "Free consent", "marks": 0.0, "max_marks": 1.0, "reason": "missing"}],
               annotations=[])
    raised = asyncio.run(dc.DeductionChecker("http://x/c.pdf", layout, llm).check(cut, q, rubric))
    check("a borrowed reading does not raise the mark", not raised and cut["marks_awarded"] == 2.0,
          f"raised to {cut['marks_awarded']}")


if __name__ == "__main__":
    test_regions()
    test_apply()
    test_checker()
    test_reading_borrowed_from_the_paper()
    print()
    if failures:
        print(f"{len(failures)} FAILED")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("all passed")
