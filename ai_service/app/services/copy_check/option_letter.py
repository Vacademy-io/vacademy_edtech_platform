"""The option a student named - by letter or by its text - decides an MCQ mark.

Students answer an MCQ as "6) b) 19/7": the option letter, then the option's
text copied by hand. The copy is where slips happen - a minus sign dropped
from "-19/7", "₹720" written so the 7 reads as 1. On a real copy the grader
judged those by the copied text and gave 0 to two answers whose letter was
right; the teacher gave both full marks.

enforce.py has a letter check of its own, but it never ran on platform
papers: it looks for type "MCQ" (the platform says "MCQS") and a key that is
a bare letter (the platform sends "Option 2: -19/7"), and the orchestrator
does not pass it the key at all.

The same teacher also gave full marks the other way round: "19) c) Both (b)
and (c)" where option (d) is "Both (b) and (c)" - the right option's text
under a wrong letter. So an answer counts when EITHER its letter OR its text
clearly names the key's option.

This module only ever RAISES a mark: a lower mark becomes full marks and the
ink is rewritten to match. Anything less clear is left to the grader.
"""
from __future__ import annotations

import re
from typing import Any, Optional

CHOICE_TYPES = {"MCQS", "MCQ", "TRUE_FALSE"}

# "6) b) 19/7", "Q6. (b) -19/7", "b) -1", "(c)", "Ans: c": the letter right
# after the student's own question label (if any).
_AFTER_LABEL = re.compile(
    r"^\s*(?:[Qq](?:ue)?s?\.?\s*)?(?:\d{1,2}\s*[).:\-]\s*)?"
    r"(?:ans(?:wer)?\.?\s*[:\-]?\s*)?\(?\s*([a-hA-H])\s*\)\s*(.*)$",
    re.S,
)
_BARE = re.compile(r"^\s*(?:[Qq]?\s*\d{1,2}\s*[).:\-]\s*)?\(?\s*([a-hA-H])\s*\)?\s*\.?\s*$")
# What may follow the letter and still be "the option's text copied": short,
# or close to the chosen option. "(A) is false but (R) is true" - a student
# describing an assertion-reason option in words - is neither, and must not
# be read as option (a).
_MAX_TRAILING = 30


def key_positions(correct_answer: Any) -> list[int]:
    """1-based option positions in the key Java sends ("Option 2: ...";
    several joined by "; ")."""
    return [int(n) for n in re.findall(r"Option\s+(\d+)", str(correct_answer or ""))]


def _similar(a: str, b: str) -> bool:
    from difflib import SequenceMatcher

    def norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]", "", s.lower())
    a, b = norm(a), norm(b)
    return bool(a and b) and SequenceMatcher(None, a, b).ratio() >= 0.6


def chosen_position(extracted: Any, options: Optional[list[dict[str, Any]]]) -> Optional[int]:
    """The option the student picked, as a 1-based position, or None when the
    answer does not clearly name one by its letter."""
    text = str(extracted or "").strip()
    if not text:
        return None
    m = _BARE.match(text)
    if m:
        return ord(m.group(1).lower()) - 96
    m = _AFTER_LABEL.match(text)
    if not m:
        return None
    pos = ord(m.group(1).lower()) - 96
    trailing = m.group(2).strip()
    if len(trailing) <= _MAX_TRAILING:
        return pos
    opts = options or []
    if 0 < pos <= len(opts) and _similar(trailing, str(opts[pos - 1].get("text") or "")):
        return pos
    return None


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def text_position(extracted: Any, options: Optional[list[dict[str, Any]]]) -> Optional[int]:
    """The option whose TEXT the student wrote (after any label and letter),
    or None. Short texts ("7", "-1", "₹720") must match exactly; longer ones
    may differ by a few letters of handwriting."""
    from difflib import SequenceMatcher

    text = str(extracted or "").strip()
    m = _AFTER_LABEL.match(text)
    if m:
        text = m.group(2)
    else:
        text = re.sub(r"^\s*(?:[Qq]?\s*\d{1,2}\s*[).:\-]\s*)", "", text)
    got = _norm(text)
    if not got:
        return None
    best, best_ratio = None, 0.0
    for i, opt in enumerate(options or [], 1):
        want = _norm(opt.get("text"))
        if not want:
            continue
        if got == want:
            return i
        if len(want) >= 8:
            r = SequenceMatcher(None, got, want).ratio()
            if r >= 0.85 and r > best_ratio:
                best, best_ratio = i, r
    return best


def honour_option_letter(verdict: dict[str, Any], question: dict[str, Any]) -> bool:
    """Give full marks to a single-answer MCQ whose chosen letter OR copied
    option text is the key's. Mutates `verdict`; True when it changed the mark."""
    qtype = str(question.get("question_type") or "").upper()
    if qtype not in CHOICE_TYPES:
        return False
    keys = key_positions(question.get("correct_answer"))
    if len(keys) != 1:
        return False
    options = question.get("options")
    chosen = chosen_position(verdict.get("extracted_answer"), options)
    by_text = text_position(verdict.get("extracted_answer"), options)
    if keys[0] not in (chosen, by_text):
        return False
    mx = float(verdict.get("max_marks") or question.get("max_marks") or 0)
    if mx <= 0 or float(verdict.get("marks_awarded") or 0) >= mx:
        return False

    letter = chr(96 + keys[0])
    verdict["marks_awarded"] = mx
    verdict["verdict"] = "correct"
    verdict["feedback"] = (f"Correct option ({letter}) chosen; a slip in how it was written "
                           "does not change the answer.")
    for item in verdict.get("criteria_breakdown") or []:
        item["marks"] = item.get("max_marks", item.get("marks"))
        item["reason"] = f"Full marks - option ({letter}) is the correct option."
    if len(verdict.get("criteria_breakdown") or []) == 1:
        verdict["criteria_breakdown"][0]["marks"] = mx
    anns = []
    for a in verdict.get("annotations") or []:
        style = a.get("style")
        if style == "margin_note":
            continue  # the "Wrong option" note no longer applies
        a = dict(a)
        if style == "cross":
            a["style"] = "tick"
        elif style == "score":
            a["text"] = f"{mx:g}/{mx:g}"
        anns.append(a)
    verdict["annotations"] = anns
    verdict["option_letter_override"] = True
    return True


__all__ = ["honour_option_letter", "chosen_position", "text_position", "key_positions"]
