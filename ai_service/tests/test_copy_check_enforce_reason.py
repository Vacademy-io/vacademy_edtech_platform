"""Offline tests for the deduction reason enforce.py writes when the grader
gave none.

On 2026-09-30 a copy came back with "Full marks: correctly identifies study of
human society, relationships, behaviour, and ins" beside a 1.5/2: the first
criterion that lost anything was picked (its reason was praise) and cut at 90
characters, mid-word. A reason is a teacher's remark - at most 15 words, cut
at a word, and about what was actually missing.

No network. Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_copy_check_enforce_reason.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from ai_service.app.services.copy_check.enforce import REASON_MAX_WORDS, enforce, short_reason

failures: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        failures.append(f"{label}: {detail}")
        print(f"  FAIL  {label} — {detail}")


def test_short_reason_cuts_at_a_word() -> None:
    print("\nshort_reason — at most 15 words, never mid-word")
    long = ("Correctly identifies study of human society, relationships, behaviour, and institutions "
            "but gives no purpose and no method of study at all")
    got = short_reason(long)
    check("no more than the word limit", len(got.split()) <= REASON_MAX_WORDS, got)
    check("every word is whole", all(w in long.replace(".", "") for w in got.rstrip(".").split()), got)
    check("does not end on a dangling connective",
          got.rstrip(".").split()[-1].lower() not in {"and", "or", "the", "of"}, got)
    check("a short reason is left alone",
          short_reason("Only one feature given; second feature missing.")
          == "Only one feature given; second feature missing.")


def _layout() -> dict:
    return {"pages": [{"page_id": "p1", "width": 1000, "height": 1400, "lines": [
        {"line_id": "p1_r1", "text": "ans 21. Social science is the academic study of human society",
         "box": [50, 100, 800, 40]},
        {"line_id": "p1_r2", "text": "relationships, behaviour and how people interact within communities",
         "box": [50, 150, 800, 40]},
    ]}]}


def test_synthesised_reason_names_what_was_missing() -> None:
    print("\nenforce — a synthesised reason comes from the criterion that lost marks")
    verdict = {
        "question_id": "q21", "paper_label": "21", "marks_awarded": 1.5, "max_marks": 2.0,
        "feedback": "",
        "criteria_breakdown": [
            {"criteria_name": "Core Definition", "marks": 0.8,
             "reason": "Full marks: correctly identifies study of human society, relationships, "
                       "behaviour, and institutions."},
            {"criteria_name": "Methodology", "marks": 0.3,
             "reason": "Partial: mentions 'academic study' but lacks explicit reference to method."},
            {"criteria_name": "Purpose", "marks": 0.4,
             "reason": "No marks: does not explain the purpose of studying Social Science "
                       "(e.g., understanding, explaining, or improving society); focuses purely on scope."},
        ],
        "annotations": [{"style": "tick", "target": "p1_r1"}, {"style": "score", "target": "p1_r2",
                                                                "text": "1.5/2"}],
    }
    meta = [{"question_id": "q21", "paper_label": "21", "max_marks": 2.0, "question_type": "LONG_ANSWER"}]
    fixed = enforce([verdict], _layout(), meta)
    notes = [a.get("text") for a in fixed.annotations if a.get("style") == "margin_note"]
    check("one deduction note", len(notes) == 1, str(notes))
    note = notes[0] if notes else ""
    check("not the praise criterion", not note.lower().startswith("full marks"), note)
    check("the 'No marks' criterion wins", "purpose" in note.lower(), note)
    check("its label and e.g. list are gone",
          not note.lower().startswith("no marks") and "e.g." not in note, note)
    check("within the word limit", len(note.split()) <= REASON_MAX_WORDS, note)


if __name__ == "__main__":
    test_short_reason_cuts_at_a_word()
    test_synthesised_reason_names_what_was_missing()

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("All copy-check enforce reason tests passed.")
