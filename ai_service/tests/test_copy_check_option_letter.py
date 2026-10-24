"""Offline tests: the chosen MCQ letter decides the mark, and a page read as
blank despite plenty of OCR'd writing gets a second, sharper read.

Cases come from a real teacher-vs-AI comparison: "6) b) 19/7" (key: option b,
-19/7) and "18) c) ₹120" (key: option c, ₹720) were both given 0 by the
grader for a slip in the copied text; the teacher gave full marks.

No network. Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_copy_check_option_letter.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.services.copy_check.option_letter import (
    chosen_position,
    honour_option_letter,
    key_positions,
)
from ai_service.app.services.copy_check.orchestrator import label_on_copy
from ai_service.app.services.copy_check.validator import _strip_mark_from_note
from ai_service.app.services.copy_check.vision_transcript import needs_second_read

failures: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        failures.append(f"{label}: {detail}")
        print(f"  FAIL  {label} — {detail}")


def _q(key: str, opts: list[str], qtype: str = "MCQS") -> dict:
    return {"question_id": "q", "question_type": qtype, "max_marks": 1.0, "correct_answer": key,
            "options": [{"id": str(i), "text": t} for i, t in enumerate(opts, 1)]}


def _wrong_verdict(extracted: str) -> dict:
    return {
        "question_id": "q", "marks_awarded": 0.0, "max_marks": 1.0, "extracted_answer": extracted,
        "feedback": "Wrong option.", "verdict": "wrong",
        "criteria_breakdown": [{"criteria_name": "Correct answer", "marks": 0.0, "max_marks": 1.0, "reason": "wrong"}],
        "annotations": [
            {"style": "cross", "target": "p1_r8", "page_id": "p1", "placement": "right_of_line"},
            {"style": "score", "target": "p1_r8", "page_id": "p1", "placement": "right_margin", "text": "0/1"},
            {"style": "margin_note", "target": "p1_r8", "page_id": "p1", "placement": "below_line",
             "text": "Wrong value! Correct: -19/7"},
        ],
    }


def test_parsing() -> None:
    print("\nkey_positions / chosen_position")
    check("single key", key_positions("Option 2: -19/7") == [2])
    check("multi key", key_positions("Option 1: a; Option 3: c") == [1, 3])
    opts = [{"text": "7/19"}, {"text": "-19/7"}, {"text": "19/7"}, {"text": "1"}]
    check("label + letter + copied text", chosen_position("6) b) 19/7", opts) == 2)
    check("bracketed letter", chosen_position("Q6. (b) -19/7", opts) == 2)
    check("bare letter", chosen_position("(c)", opts) == 3)
    check("rupee slip", chosen_position("18) c) ₹120", None) == 3)
    check("assertion text is not option (a)",
          chosen_position("(A) is false but (R) is true, so the reason does not explain it", None) is None)
    check("no letter", chosen_position("19/7", opts) is None)


def test_upgrade() -> None:
    print("\nhonour_option_letter — right letter, slip in the copied text")
    q = _q("Option 2: -19/7", ["7/19", "-19/7", "19/7", "1"])
    v = _wrong_verdict("6) b) 19/7")
    changed = honour_option_letter(v, q)
    check("changed", changed)
    check("full marks", v["marks_awarded"] == 1.0, str(v["marks_awarded"]))
    styles = [a["style"] for a in v["annotations"]]
    check("cross became tick", "tick" in styles and "cross" not in styles, str(styles))
    check("wrong-option note dropped", "margin_note" not in styles, str(styles))
    score = [a["text"] for a in v["annotations"] if a["style"] == "score"]
    check("score rewritten", score == ["1/1"], str(score))
    check("breakdown agrees", v["criteria_breakdown"][0]["marks"] == 1.0)


def test_right_text_wrong_letter() -> None:
    print("\nhonour_option_letter — right option text under a wrong letter (teacher gave the mark)")
    q = _q("Option 4: Both (b) and (c)", ["243", "343", "512", "Both (b) and (c)"])
    v = _wrong_verdict("19) c) Both (b) and (c)")
    check("maths Q19: text names option (d)", honour_option_letter(v, q) and v["marks_awarded"] == 1.0)
    q = _q("Option 2: Pass undeviated without any bending",
           ["Bend towards the normal", "Pass undeviated without any bending", "Bend away", "Reflect back"])
    v = _wrong_verdict("Q16. c) Pass undeviated without any bending.")
    check("science Q16: text names option (b)", honour_option_letter(v, q) and v["marks_awarded"] == 1.0)
    q = _q("Option 3: ₹720", ["₹480", "₹600", "₹720", "₹800"])
    v = _wrong_verdict("18) a) ₹480")
    check("wrong letter AND wrong text stays wrong", not honour_option_letter(v, q))


def test_left_alone() -> None:
    print("\nhonour_option_letter — never lowers, never guesses")
    q = _q("Option 2: 3", ["2", "3", "6", "9"])
    v = _wrong_verdict("3) a) 2")
    check("wrong letter stays wrong", not honour_option_letter(v, q) and v["marks_awarded"] == 0.0)
    v = _wrong_verdict("3) b) 3")
    v["marks_awarded"] = 1.0
    check("already full: untouched", not honour_option_letter(v, q))
    v = _wrong_verdict("1) a), c)")
    check("multi-answer key skipped", not honour_option_letter(v, _q("Option 1: x; Option 3: y", ["x", "w", "y"], "MCQM")))
    check("written answer skipped", not honour_option_letter(_wrong_verdict("b) 19/7"), _q("Option 2: -19/7", [], "LONG_ANSWER")))


def test_second_read() -> None:
    print("\nneeds_second_read — blank read of a page full of writing")
    check("illegible with 29 OCR words", needs_second_read({"legible": False, "page_text": "[illegible]"}, 29))
    check("near-empty prose with 29 OCR words", needs_second_read({"legible": True, "page_text": "x = 5"}, 29))
    check("a real read is kept", not needs_second_read({"legible": True, "page_text": "a" * 400}, 29))
    check("a nearly blank page is not retried", not needs_second_read({"legible": False, "page_text": ""}, 3))


def test_note_keeps_answer_fraction() -> None:
    print("\n_strip_mark_from_note — a score goes, an answer fraction stays")
    check("score out of this question's marks stripped",
          _strip_mark_from_note("Nature not stated: real & inverted. 2.25/3", 3.0) == "Nature not stated: real & inverted.")
    check("answer fraction kept (real copy: Q25 note lost its 7/30)",
          _strip_mark_from_note("Common factor 7/5 missed; final answer should be 7/30", 2.0)
          == "Common factor 7/5 missed; final answer should be 7/30")
    check("negative fraction kept", _strip_mark_from_note("Correct: -19/7", 1.0) == "Correct: -19/7")
    check("a note that is only a score is dropped", _strip_mark_from_note("1/2", 2.0) is None)


def test_label_on_copy() -> None:
    print("\nlabel_on_copy — the locator's 'not attempted' is doubted when the number is on the copy")
    lay = {"pages": [{"page_id": "p2", "lines": [{"text": "16) b) 1:5"}, {"text": "Q17. b) 9"},
                                                 {"text": "1764 = 2 x 882"}]}]}
    check("'16)' found", label_on_copy({"paper_label": "16"}, lay))
    check("'Q17.' found", label_on_copy({"paper_label": "17"}, lay))
    check("'1' is not '16)' or '1764'", not label_on_copy({"paper_label": "1"}, lay))
    check("absent number", not label_on_copy({"paper_label": "18"}, lay))


if __name__ == "__main__":
    test_parsing()
    test_upgrade()
    test_right_text_wrong_letter()
    test_left_alone()
    test_second_read()
    test_note_keeps_answer_fraction()
    test_label_on_copy()
    print()
    if failures:
        print(f"{len(failures)} FAILED")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("all passed")
