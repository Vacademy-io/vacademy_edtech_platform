"""What a printed paper says about its own numbering and its parts.

Two things go wrong on a paper that opens with a numbered instructions list:

1. MathPix turns the list and the questions under it into ONE Markdown list,
   which numbers by position. Six instructions followed by "1." to "13." come
   back as 1-19; the list on the next page starts from its own printed "14.",
   so the numbers run 1-19, 14-20, 21-30. `restore_list_numbers` puts the
   printed numbers back before anything reads the paper.

2. "Part A contains 20 questions and each question carries 5 marks" is often the
   only place a paper gives its marks. `declared_split` reads those lines so the
   extraction can be held to them, whatever a model made of the headings.

Both only act on what the paper plainly shows. When the signature is not exact,
nothing is changed.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .docx_numbering import _HTML_NO
from .question_extract_service import _text_of, split_blocks

# The most lines an instructions list is taken to have, and how much of it must
# read as instructions. A real question may use one of these words, a list of
# real questions does not use them in most of its lines.
_LIST_MAX = 12
_MIN_INSTRUCTION_SHARE = 0.6

_INSTRUCTION = re.compile(
    r"\b(?:attempt\s+(?:all|any)|all\s+questions|question\s+paper|answer\s+sheet|calculators?|candidates?|"
    r"compulsory|negative\s+marking|rough\s+work|time\s+allowed|mobile\s+phones?|electronic\s+devices?|"
    r"(?:contains?|consists?\s+of|comprises?)\s+\d+\s+questions|each\s+question|"
    r"marks?\s+(?:will|shall)\s+be|write\s+your\s+answers?|in\s+this\s+(?:part|section))\b",
    re.I,
)


def _instruction_list_length(lines: List[Tuple[int, str]]) -> int:
    """How many leading numbered lines are the instructions list, else 0.

    The list ends at its last line that reads as an instruction, so a line in
    the middle that does not ("Take pi as 22/7") stays part of it.
    """
    window = lines[:_LIST_MAX]
    if [n for n, _ in window[:2]] != [1, 2]:
        return 0
    reads = [bool(_INSTRUCTION.search(text)) for _, text in window]
    if not (reads[0] or reads[1]):
        return 0
    last = max((i for i, hit in enumerate(reads) if hit), default=-1)
    length = last + 1
    if length < 2 or sum(reads[:length]) / length < _MIN_INSTRUCTION_SHARE:
        return 0
    if [n for n, _ in window[:length]] != list(range(1, length + 1)):
        return 0
    return length


def restore_list_numbers(html: str) -> Tuple[str, int]:
    """(html, lines renumbered): question numbers as printed, when the
    questions continued the numbering of the instructions list above them.

    The drift is only accepted when it fits exactly: the questions carry on
    from the list, and where the numbers fall back they fall back to the number
    the printed sequence expects (or to 1, a section that restarts).
    """
    matches = list(_HTML_NO.finditer(html or ""))
    if len(matches) < 3:
        return html, 0
    lines = [(int(m.group(2)), _text_of(m.group(4))) for m in matches]
    drift = _instruction_list_length(lines)
    if not drift or drift >= len(lines) or lines[drift][0] != drift + 1:
        return html, 0

    end = drift + 1
    while end < len(lines) and lines[end][0] > lines[end - 1][0]:
        end += 1
    if end < len(lines):
        fell_to = lines[end][0]
        if fell_to != 1 and fell_to != lines[end - 1][0] - drift + 1:
            return html, 0

    out: List[str] = []
    pos = 0
    for i, m in enumerate(matches):
        if drift <= i < end:
            out.append(html[pos:m.start(2)])
            out.append(str(int(m.group(2)) - drift))
            pos = m.end(2)
    out.append(html[pos:])
    return "".join(out), end - drift


# ---- the split the instructions declare -----------------------------------------

_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "twenty five": 25, "thirty": 30,
    "forty": 40, "fifty": 50,
}
_AMOUNT = r"\d+(?:\.\d+)?|" + "|".join(sorted(_WORDS, key=len, reverse=True))
_QUOTE = r"['\"‘’“”]?"
_LABEL = r"[A-Za-z]|[IVXivx]{1,4}|\d{1,2}"
# "Part 'A' contains 20 questions …", "Section B has 5 questions …",
# "Section C: 10 questions …"
_PART_LINE = re.compile(
    r"\b(section|part|group)\s*[-–—:.]?\s*" + _QUOTE + r"\(?(" + _LABEL + r")\)?" + _QUOTE + r"(?![A-Za-z0-9])\s*"
    r"(?:contains?|consists?\s+of|comprises?(?:\s+of)?|has|have|[:\-–—])\s*"
    r"(" + _AMOUNT + r")\s+(?:\w+\s+){0,2}?questions?\b([^\n]{0,120})",
    re.I,
)
_MARKS_EACH = re.compile(_QUOTE + r"(" + _AMOUNT + r")\s*" + _QUOTE + r"\s*marks?\b", re.I)
_SECTION_NAME = re.compile(
    r"^\s*(?:section|part|group)\s*[-–—:.]?\s*" + _QUOTE + r"\(?(" + _LABEL + r")\)?" + _QUOTE + r"(?![A-Za-z0-9])",
    re.I,
)


def _amount(raw: str) -> Optional[float]:
    text = re.sub(r"\s+", " ", raw.strip().lower())
    if text in _WORDS:
        return float(_WORDS[text])
    try:
        value = float(text)
    except ValueError:
        return None
    return value if value > 0 else None


def section_label(name: Any) -> Optional[str]:
    """"A" out of "Part A" / "Section - A: Reading"; None for any other name."""
    m = _SECTION_NAME.match(str(name or ""))
    return m.group(1).upper() if m else None


def declared_split(html: str) -> List[Dict[str, Any]]:
    """[{"label", "name", "count", "marks"}] in the order the paper lists them;
    [] unless at least two parts state both how many questions and how many
    marks each. The same part stated twice keeps its first line."""
    rows: List[Dict[str, Any]] = []
    seen = set()
    for block in split_blocks(html or ""):
        for m in _PART_LINE.finditer(_text_of(block)):
            label = m.group(2).upper()
            count = _amount(m.group(3))
            marks_at = _MARKS_EACH.search(m.group(4))
            marks = _amount(marks_at.group(1)) if marks_at else None
            if label in seen or not count or not marks or not float(count).is_integer():
                continue
            seen.add(label)
            rows.append({"label": label, "name": f"{m.group(1).title()} {label}", "count": int(count), "marks": marks})
    return rows if len(rows) >= 2 else []


__all__ = ["restore_list_numbers", "declared_split", "section_label"]
