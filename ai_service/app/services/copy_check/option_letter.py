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

honour_option_letter only RAISES a mark: a lower mark becomes full marks and
the ink is rewritten to match. Anything less clear is left to the grader.

refuse_wrong_option goes the other way, on the narrow case where there is no
reading it differently: the options carry their own letters and the answer
names another one. A grader gave "10 A. Knows" full marks against the key
"B. knew", and enforcement had nothing to catch it with.
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

# A paper can carry its letters inside the option text ("B. was cooking") while
# the options arrive in any order: on one real paper the option printed "B" was
# third in the list. The letter a student writes then means the PRINTED option,
# and reading it as a position gave a question's key to the wrong letter.
_PRINTED_LABEL = re.compile(r"^\s*\(?\s*([a-hA-H])\s*[).:\-]\s*(.*)$", re.S)
# The student's own question label and letter on such a paper: "7 B. was
# cooking", "Q7) (B) was cooking". Only used when the options are lettered. The
# letter needs its punctuation: "a little" is the words of an option, not (a).
# "A-27)" is "answer 27", not option (A).
_QUESTION_LABEL = (r"(?:[Qq](?:ue)?s?\.?\s*|[Aa]\s*[.\-]\s*(?=\d{1,3}\s*[).:\-]))?"
                   r"(?:\d{1,3}\s*(?:[).:\-]\s*|\s+))?")
_ANSWER_WORD = r"(?:[Aa]ns(?:wer)?\.?\s*[:\-]?\s*)?"
_PRINTED_ANSWER = re.compile(
    r"^\s*" + _QUESTION_LABEL + _ANSWER_WORD + r"\(?\s*([a-hA-H])\s*(?:[).,:\-]\s*|$)(.*)$",
    re.S,
)
_LABEL_AND_WORD = re.compile(r"^\s*" + _QUESTION_LABEL + _ANSWER_WORD)
# Some students write the letter after the words: "3. goes (c)", "7. was cooking b)".
_LETTER_LAST = re.compile(r"^(.*\S)\s*\(?\b([a-hA-H])\s*\)\s*\.?$", re.S)
# A reader's note that the student changed their mind.
_STRUCK = re.compile(r"\(?\b(?:struck out|crossed out|struck through)\b\)?\s*,?\s*", re.I)
_LETTER_FIRST = re.compile(r"\(?\s*[a-hA-H]\s*[).,:\-]")


def printed_letters(options: Optional[list[dict[str, Any]]]) -> dict[str, int]:
    """letter -> 1-based position, when EVERY option carries its own distinct
    printed letter and together they run from A with no gap. {} otherwise, and
    the letter then means the position: options reading "A.C." and "D.C." are
    words, not the options lettered A and D."""
    out: dict[str, int] = {}
    for i, opt in enumerate(options or [], 1):
        m = _PRINTED_LABEL.match(str((opt or {}).get("text") or "") if isinstance(opt, dict) else "")
        if not m or not m.group(2).strip():
            return {}
        letter = m.group(1).lower()
        if letter in out:
            return {}
        out[letter] = i
    if len(out) < 2 or set(out) != {chr(97 + i) for i in range(len(out))}:
        return {}
    return out


def letters_out_of_order(options: Optional[list[dict[str, Any]]]) -> dict[str, int]:
    """printed_letters(), only when a printed letter disagrees with its position:
    the one case where showing a position beside it gives an option two letters."""
    printed = printed_letters(options)
    return printed if any(ord(letter) - 96 != pos for letter, pos in printed.items()) else {}


def without_printed_letter(text: Any) -> str:
    """The option's words, without the letter printed in front of them."""
    raw = str(text or "")
    m = _PRINTED_LABEL.match(raw)
    return m.group(2).strip() if m and m.group(2).strip() else raw.strip()


def _final_answer(extracted: Any) -> str:
    """The answer without the reader's notes on what the student changed. The
    words struck out are not the answer, and a note is not writing:
    "b) will struck out, goes" is "b) goes"; "(B) test struck out, (A) Ought" is
    "(A) Ought"; "A. Knows (A written over B)" is "A. Knows". Everything struck
    and nothing after it is no answer at all."""
    text = re.sub(r"\([^()]*\b(?:written over|overwritten)\b[^()]*\)", " ", str(extracted or ""), flags=re.I)
    parts = _STRUCK.split(text)
    if len(parts) > 1:
        head, tail = parts[0], parts[-1].strip()
        label = _LABEL_AND_WORD.match(head)
        prefix = label.group(0) if label else ""
        letter = _LETTER_FIRST.match(head[len(prefix):])
        if not tail:
            text = ""
        elif letter and not _LETTER_FIRST.match(tail):
            text = f"{prefix}{letter.group(0)} {tail}"
        else:
            text = f"{prefix}{tail}"
    return re.sub(r"\s+", " ", text).strip()


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


def _written_in_full(text: str, options: Optional[list[dict[str, Any]]]) -> Optional[int]:
    """The one lettered option whose words are the whole answer. "A.C." is that
    option's words, not (A) followed by "C."; a lone letter stays a letter."""
    label = _LABEL_AND_WORD.match(text)
    got = _norm(text[label.end():] if label else text)
    if len(got) < 2:
        return None
    hits = {i for i, opt in enumerate(options or [], 1) if got == _norm(without_printed_letter(opt.get("text")))}
    return hits.pop() if len(hits) == 1 else None


def _letter_after_words(text: str) -> Optional[tuple[str, str]]:
    """(words, letter) of an answer that ends with its letter. Not when the words
    name a letter too: "Both (b) and (c)" is an option's own wording."""
    m = _LETTER_LAST.match(_LABEL_AND_WORD.sub("", text, count=1))
    if not m or re.search(r"\([a-hA-H]\)", m.group(1)):
        return None
    return m.group(1), m.group(2).lower()


def chosen_position(extracted: Any, options: Optional[list[dict[str, Any]]]) -> Optional[int]:
    """The option the student picked, as a 1-based position, or None when the
    answer does not clearly name one by its letter."""
    text = _final_answer(extracted)
    if not text:
        return None
    printed = printed_letters(options)
    if printed:
        if _written_in_full(text, options) is not None:
            return None         # its words, not a letter: text_position has it
        m = _PRINTED_ANSWER.match(text)
        last = None if m else _letter_after_words(text)
        if not m and not last:
            return None
        pos = printed.get(m.group(1).lower() if m else last[1])
        if pos is None:
            return None
        trailing = m.group(2).strip() if m else last[0]
        if len(trailing) <= _MAX_TRAILING:
            return pos
        wanted = without_printed_letter((options or [])[pos - 1].get("text"))
        return pos if _similar(trailing, wanted) else None
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

    text = _final_answer(extracted)
    printed = printed_letters(options)
    if printed:
        whole = _written_in_full(text, options)
        if whole is not None:
            return whole
        m = _PRINTED_ANSWER.match(text)
        last = None if m else _letter_after_words(text)
        text = m.group(2) if m else last[0] if last else _LABEL_AND_WORD.sub("", text, count=1)
    else:
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
        want = _norm(without_printed_letter(opt.get("text")) if printed else opt.get("text"))
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

    printed = {pos: letter for letter, pos in printed_letters(options).items()}
    letter = printed.get(keys[0]) or chr(96 + keys[0])
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


def names_another_option(extracted: Any, question: dict[str, Any]) -> bool:
    """The answer plainly names an option other than the single key. A letter
    counts only where the options print their own: elsewhere it is a position in
    a list whose order is not the paper's. Words close to the key's are left to
    the grader, since "c) boil" may be a slip for "boils" under a wrong letter."""
    options = question.get("options") or []
    keys = key_positions(question.get("correct_answer"))
    if len(keys) != 1 or not 0 < keys[0] <= len(options) or not isinstance(options[keys[0] - 1], dict):
        return False
    printed = printed_letters(options)
    chosen = chosen_position(extracted, options) if printed else None
    by_text = text_position(extracted, options)
    if keys[0] in (chosen, by_text) or (chosen is None and by_text is None):
        return False
    if by_text is None:
        text = _final_answer(extracted)
        m = _PRINTED_ANSWER.match(text)
        # Two letters in one answer ("d) Several a) Every"): which one stands is
        # for someone who can see the page.
        if m and re.search(r"(?:^|[\s(])[a-hA-H]\)", m.group(2)):
            return False
        key_words = without_printed_letter(options[keys[0] - 1].get("text"))
        if (m and _similar(m.group(2), key_words)) or _similar(_LABEL_AND_WORD.sub("", text, count=1), key_words):
            return False
    return True


def refuse_wrong_option(verdict: dict[str, Any], question: dict[str, Any]) -> bool:
    """Take the marks from a single-answer MCQ whose letter, printed in the
    options, is not the key's and whose words do not name the key either.
    Mutates `verdict`; True when it changed the mark."""
    if str(question.get("question_type") or "").upper() not in CHOICE_TYPES:
        return False
    options = question.get("options")
    keys = key_positions(question.get("correct_answer"))
    if not printed_letters(options) or float(verdict.get("marks_awarded") or 0) <= 0:
        return False
    if (chosen_position(verdict.get("extracted_answer"), options) is None
            or not names_another_option(verdict.get("extracted_answer"), question)):
        return False

    correct = str(options[keys[0] - 1].get("text") or "").strip()
    mx = float(verdict.get("max_marks") or question.get("max_marks") or 0)
    verdict["marks_awarded"] = 0.0
    verdict["verdict"] = "wrong"
    verdict["feedback"] = f"The student wrote: {verdict.get('extracted_answer')}. The correct answer is {correct}."
    for item in verdict.get("criteria_breakdown") or []:
        item["marks"] = 0.0
        item["reason"] = f"Wrong option; the correct answer is {correct}."
    anns, last = [], None
    for a in verdict.get("annotations") or []:
        style = a.get("style")
        if style in ("margin_note", "praise"):
            continue
        a = dict(a)
        if style == "tick":
            a["style"] = "cross"
        elif style == "score":
            a["text"] = f"0/{mx:g}"
            last = a
        anns.append(a)
    if last is not None:
        anns.append({"style": "margin_note", "target": last.get("target"), "page_id": last.get("page_id"),
                     "anchor_text": last.get("anchor_text"), "placement": "below_line",
                     "text": f"Correct: {correct}"})
    verdict["annotations"] = anns
    verdict["option_letter_refused"] = True
    return True


__all__ = ["honour_option_letter", "refuse_wrong_option", "names_another_option", "chosen_position", "text_position", "key_positions",
           "printed_letters", "letters_out_of_order", "without_printed_letter"]
