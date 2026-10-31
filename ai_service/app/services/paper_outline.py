"""What a question paper prints about its own structure — its sections and
its marking scheme — read from the text, no model.

Used twice by Vsmart Extract. At upload, so the credit line can say "3
sections · +3 / −1" and ask whether the assessment should follow the
paper's sections or hold every question in one. After extraction, to name
each question's section and give it its marks: what is printed at the
question wins, then what the section's instructions say, then the paper's
general scheme.

Sections come from, in order of trust:
  1. a front-page table of question ranges ("English Comprehension 1–15",
     "Section A: Q1–20") — exact, so it wins when present;
  2. headings in the body ("SECTION – B", "Part II", "Logical Reasoning");
  3. "END OF SECTION I" markers, when the paper has nothing else.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence

from .question_extract_service import (
    _OPTION_LINE,
    _question_no,
    _text_of,
    find_answer_key,
    question_runs,
    split_blocks,
)

_NUM = r"(\d+(?:\.\d+)?)"
_MINUS = r"[-−–—]"

# "Section A", "SECTION – B (Physics)", "Part II: Reading", "Section 3",
# "Part One", "खण्ड क". A label must follow the word, so "Part of the marks"
# and "Section 3.2 of the Act" do not qualify.
_LABEL_HEADING = re.compile(
    r"^\s*(section|part|paper|group|unit|खण्ड|खंड|भाग)(?:\s+|\s*[-–—:.]\s*)\(?"
    r"(one|two|three|four|five|six|first|second|third|fourth|fifth|[IVXivx]{1,4}|\d{1,2}|[A-Za-z]|[अ-ह])"
    r"\)?(?![A-Za-z0-9.])\s*[:\-–—.)]?\s*(.*)$",
    re.I,
)
# A verb in the tail turns a heading into a sentence of the instructions
# ("Section A consists of 20 questions"); "Section C – Long Answer
# Questions" has none and stays a heading.
_SENTENCE_TAIL = re.compile(
    r"\b(?:consists?|contains?|comprises?|carr(?:y|ies|ying)|has|have|are|is|will|shall|should|must|"
    r"attempt|answer\s+(?:any|all|the)|based\s+on)\b",
    re.I,
)
# Subject / skill names that stand alone as section headings in mocks.
_SUBJECT = re.compile(
    r"\b(?:physics|chemistry|mathematics|mathematical|maths?|biology|botany|zoology|english|hindi|"
    r"sanskrit|reasoning|quantitative|aptitude|verbal|comprehension|data\s+interpretation|"
    r"general\s+(?:knowledge|awareness|studies|science|english|intelligence|ability)|current\s+affairs|"
    r"numerical|science|social\s+(?:science|studies)|history|geography|civics|political\s+science|"
    r"economics|accountancy|business\s+studies|computer|informatics|statistics|language|vocabulary|"
    r"grammar|logical|analytical|mental\s+ability|legal|environment(?:al)?|literature|reading|writing|"
    r"listening|arithmetic|algebra|geometry|trigonometry|calculus|mensuration)\b",
    re.I,
)
_NOT_HEADING_START = re.compile(
    r"^(?:read|answer|attempt|choose|select|fill|write|solve|find|state|explain|directions?|note|"
    r"instructions?|the|a|an|in|on|for|which|what|how|why|who|when|end\s+of)\b",
    re.I,
)
# "END OF SECTION II" — also "E ND OF" as a spaced-out text layer reads it.
_PASSAGE_INTRO = re.compile(r"^\s*(?:directions?|instructions?\s+for|read\s+the|passage|study\s+the)\b", re.I)
_END_MARK = re.compile(r"^\s*e\s?nd\s+of\s+(?:section|part)\s*[-–—:]?\s*(\w+)", re.I)
# "Directions for Questions 25–28", "Directions (Q. 25–28)" — opens a set of
# questions; the range follows the word, so "Instructions for candidates …
# 1–30" is not one.
_SET_INTRO = re.compile(
    r"^\s*(?:directions?|instructions?)\s*(?:for\s+)?[(\[]?\s*(?:the\s+)?(?:(?:q(?:uestions?|s)?|nos?)\.?\s*)*"
    r"\d{1,3}\s*(?:[–\-—]|to)\s*\d{1,3}",
    re.I,
)
# A line that is one bracketed caption: "(Seating arrangement)", "[DI set]".
_BRACKETED = re.compile(r"\([^()]*\)|\[[^\[\]]*\]")
_RANGE_IN_NAME = re.compile(
    r"\(?\s*(?:q(?:uestions?|s)?\.?\s*(?:nos?\.?)?\s*)?\d{1,3}\s*(?:[–\-—]|to)\s*\d{1,3}\s*\)?", re.I
)
_RANGE_FROM = re.compile(r"(\d{1,3})\s*(?:[–\-—]|to)\s*\d{1,3}\b", re.I)
_MARKS_IN_NAME = re.compile(r"\(?\s*\d+\s*[x×*]\s*\d+(?:\.\d+)?\s*=\s*\d+(?:\.\d+)?\s*(?:marks?)?\s*\)?", re.I)
_NOISE_WORD = re.compile(
    r"^(?:minutes?|mins?|marks?|questions?|qs|q\.?|nos?\.?|time|duration|hrs?|hours?|no\.?\s*of|"
    r"section|part|name|subject|total|sr\.?|s\.?no\.?|\d+)\b\.?\s*",
    re.I,
)
# "English Comprehension 1–15", "Section A: Q1–20", "Physics (Q. 1 to 30)".
_RANGE_ROW = re.compile(
    r"(?P<name>[A-Za-zऀ-ॿ][^\d]{1,70}?)\s*[:\-–—(]?\s*"
    r"(?:q(?:uestions?|s)?\.?\s*(?:nos?\.?)?\s*)?(?P<a>\d{1,3})\s*(?:[–\-—]|to)\s*(?P<b>\d{1,3})(?![\d.%])",
    re.I,
)

# ---- marking scheme ----------------------------------------------------------

_MARKS = [
    # "+3 for a correct answer", "+4 marks for each right answer"
    re.compile(r"\+\s*" + _NUM + r"\s*(?:marks?)?\s*(?:will be |shall be |is |are )?(?:awarded |given )?"
               r"(?:for|per)?\s*(?:a |an |each |every )?(?:correct|right)", re.I),
    # "1 mark each", "2 marks per question", "3 marks for each correct answer"
    re.compile(_NUM + r"\s*marks?\s*(?:each|per\s+(?:question|item|correct)|for\s+(?:each|every|a)\s+"
               r"(?:correct|right|question))", re.I),
    # "each question carries 4 marks", "every question is of 2 marks"
    re.compile(r"(?:each|every)\s+(?:question|item|mcq|problem)\s+(?:carries|carry|is\s+of|has|will\s+carry|"
               r"is\s+worth|worth|of)\s+" + _NUM + r"\s*marks?", re.I),
    # "questions carrying 2 marks each", "questions of 5 marks each"
    re.compile(r"(?:carry|carries|carrying|of|worth)\s+" + _NUM + r"\s*marks?\s*each", re.I),
    # "4 marks will be awarded for each correct answer"
    re.compile(_NUM + r"\s*marks?\s*(?:will|shall|would)?\s*(?:be\s+)?(?:awarded|given)\s+for\s+"
               r"(?:each|every|a|an)\s+(?:correct|right)", re.I),
    # "(20 × 1 = 20)" on a section heading
    re.compile(r"\d+\s*[x×*]\s*" + _NUM + r"\s*=\s*\d+", re.I),
]
_NEGATIVE = [
    # "−1 for an incorrect answer", "-0.25 marks for each wrong answer"
    re.compile(_MINUS + r"\s*" + _NUM + r"\s*(?:marks?)?\s*(?:will be |shall be |is |are )?(?:deducted )?"
               r"(?:for|per)?\s*(?:a |an |each |every )?(?:incorrect|wrong)", re.I),
    # "1 mark will be deducted", "0.25 marks shall be deducted for every wrong answer"
    re.compile(_NUM + r"\s*marks?\s*(?:will|shall|would|is|are|to)?\s*(?:be\s+)?deducted", re.I),
    # "negative marking of 1 mark", "penalty of 0.5"
    re.compile(r"(?:negative\s+marking|penalty)\s*(?:of|is|:|=)?\s*" + _NUM, re.I),
    # "deduction of 1 mark", "deduct 0.25 marks"
    re.compile(r"deduct(?:ed|ion)?\s+(?:of\s+)?" + _NUM + r"\s*marks?", re.I),
    # "+4 / −1", "+3, -1"
    re.compile(r"\+\s*\d+(?:\.\d+)?\s*(?:marks?)?\s*[/,]\s*" + _MINUS + r"\s*" + _NUM, re.I),
]
# "1/4th of the marks will be deducted", "one-third mark deducted"
_FRACTION_NEGATIVE = re.compile(
    r"(1/4|1/3|1/2|¼|⅓|½|one[- ]fourth|one[- ]third|half|25\s*%|33(?:\.33)?\s*%|50\s*%)"
    r"(?:th|rd)?\s*(?:of\s+(?:the\s+)?)?(?:marks?|mark\s+allotted|marks\s+assigned)?[^.;]{0,60}?deducted",
    re.I,
)
_FRACTIONS = {"1/4": 0.25, "¼": 0.25, "one fourth": 0.25, "one-fourth": 0.25, "25%": 0.25, "25 %": 0.25,
              "1/3": 1 / 3, "⅓": 1 / 3, "one third": 1 / 3, "one-third": 1 / 3, "33%": 1 / 3, "33.33%": 1 / 3,
              "1/2": 0.5, "½": 0.5, "half": 0.5, "50%": 0.5, "50 %": 0.5}
_NO_NEGATIVE = re.compile(r"no\s+negative\s+marking|without\s+negative\s+marking|no\s+penalty", re.I)
# "Section A consists of 20 questions of 1 mark each" — marks by section label.
_LABEL_MARKS = re.compile(
    r"(?:section|part|खण्ड|खंड|भाग)(?:\s+|\s*[-–—:.]\s*)\(?([A-Za-z]|[IVXivx]{1,4}|\d{1,2}|[अ-ह])\)?(?![A-Za-z0-9])"
    r"([^.;\n]{0,120})",
    re.I,
)
# "Questions 1 to 20 carry 1 mark each", "Q. 21–25 are of 2 marks"
_RANGE_MARKS = re.compile(
    r"q(?:uestions?|s)?\.?\s*(?:nos?\.?\s*)?(\d{1,3})\s*(?:to|[–\-—])\s*(\d{1,3})\b([^.;\n]{0,80}?)"
    + _NUM + r"\s*marks?",
    re.I,
)
# Marks printed at the end of a question: "[2]", "(3 marks)", "5 Marks",
# "(2 M)", "(1)" — but not the argument of "f(3)": a bracket that follows
# a letter or digit is part of an expression.
_TRAILING_MARKS = re.compile(
    r"(?:\[\s*" + _NUM + r"\s*(?:marks?|m)?\s*\]|(?<![A-Za-z0-9])\(\s*" + _NUM + r"\s*(?:marks?|m)?\s*\)|"
    + _NUM + r"\s*marks?)\s*$",
    re.I,
)
# "(20 Marks)", "(10 M)" on a section heading — the section's total, not
# part of its name and not a per-question mark.
_MARKS_NOTE_IN_NAME = re.compile(r"\(?\s*\d+(?:\.\d+)?\s*(?:marks?|m)\b\s*(?:each\b)?\s*\)?", re.I)


# ---- time allowed -------------------------------------------------------------

_HOURS = r"(?:hours?|hrs?|h)"
_MINS = r"(?:minutes?|mins?|m)"
# "Time allowed: 3 hours", "Time: 1 hr 30 min", "Duration: 90 minutes",
# "Total time – 2 hours"
_DURATION = re.compile(
    r"(?:time(?:\s+(?:allowed|allotted|limit))?|duration|total\s+time)\s*[:\-–—]?\s*"
    r"(\d+(?:\.\d+)?)\s*(" + _HOURS + r"|" + _MINS + r")\b(?:\s*(?:and\s*)?(\d+)\s*" + _MINS + r"\b)?",
    re.I,
)
# "120-minute limit", "a 90 minute test", the "Total 60 120 minutes" row of
# a section table
_DURATION_LOOSE = re.compile(
    r"(\d+)\s*[-‑–]?\s*minutes?\s*(?:limit|allowed|test|paper|exam)\b|total\s+\d+\s+(\d+)\s*" + _MINS + r"\b",
    re.I,
)
# In a section's own line ("Questions 1 to 15 · 30 minutes", "Time: 45 min").
# No bare "m": "(20 M)" on a section heading is marks, not minutes (after
# an hour count, "2 h 30 m", it is).
_DURATION_SHORT = re.compile(
    r"(\d+(?:\.\d+)?)\s*(" + _HOURS + r"|minutes?|mins?)\b(?:\s*(\d+)\s*" + _MINS + r"\b)?", re.I
)


def _minutes(amount: str, unit: str, extra: Optional[str]) -> Optional[int]:
    try:
        n = float(amount)
    except ValueError:
        return None
    total = n * 60 if unit.lower().startswith("h") else n
    if extra:
        total += int(extra)
    total = int(round(total))
    return total if 0 < total <= 24 * 60 else None


def duration_of(text: str, *, loose: bool = False) -> Optional[int]:
    """Minutes the paper allows, from "Time allowed: 3 hours" and the like;
    `loose` also accepts a bare "30 minutes" (a section's own line)."""
    m = _DURATION.search(text)
    if m:
        return _minutes(m.group(1), m.group(2), m.group(3))
    m = _DURATION_LOOSE.search(text)
    if m:
        return _minutes(m.group(1) or m.group(2), "m", None)
    if loose:
        m = _DURATION_SHORT.search(text)
        if m:
            return _minutes(m.group(1), m.group(2), m.group(3))
    return None


def _num(s: Optional[str]) -> Optional[float]:
    try:
        v = float(s) if s is not None else None
    except ValueError:
        return None
    return v if v is not None and 0 < v < 1000 else None


def marking_of(text: str) -> Dict[str, Any]:
    """{"marks", "negative_marks", "negative_fraction"} printed in a stretch of
    instructions; each None when nothing says so. "no negative marking"
    yields negative_marks 0."""
    marks: Optional[float] = None
    for rx in _MARKS:
        m = rx.search(text)
        if m and _num(m.group(1)) is not None:
            marks = _num(m.group(1))
            break
    negative: Optional[float] = None
    fraction: Optional[float] = None
    for rx in _NEGATIVE:
        m = rx.search(text)
        if m and _num(m.group(1)) is not None:
            negative = _num(m.group(1))
            break
    if negative is None:
        m = _FRACTION_NEGATIVE.search(text)
        if m:
            key = re.sub(r"\s+", " ", m.group(1).lower())
            fraction = _FRACTIONS.get(key) or _FRACTIONS.get(key.replace(" ", ""))
            if fraction and marks:
                negative = round(fraction * marks, 2)
    # "No negative marking" only when nothing states a deduction — a paper
    # may say both ("−1 … no negative marking for numerical questions").
    if negative is None and fraction is None and _NO_NEGATIVE.search(text):
        negative = 0.0
    return {"marks": marks, "negative_marks": negative, "negative_fraction": fraction}


def _label_key(label: str) -> str:
    return label.strip().upper()


def _tidy_name(raw: str) -> str:
    # MathPix escapes "&" in prose ("ABILITY \&amp; DATA"); the name is text.
    name = raw.replace("&amp;", "&").replace("\\&", "&").replace("\\%", "%")
    name = _MARKS_IN_NAME.sub(" ", name)
    name = _RANGE_IN_NAME.sub(" ", name)
    name = re.sub(r"\s+", " ", name).strip(" :-–—.,()|·")
    # The strip also takes the ")" of a name's own "(VARC)"; give it back.
    opened, closed = name.count("("), name.count(")")
    if opened > closed:
        name += ")" * (opened - closed)
    elif closed > opened:
        name = "(" * (closed - opened) + name
    if name.isupper() and len(name) > 3:
        # "ENGLISH COMPREHENSION (VARC)" → "English Comprehension (VARC)"
        name = re.sub(r"\(([A-Za-z]{2,5})\)", lambda m: f"({m.group(1).upper()})", name.title())
    return name


def _label_heading(text: str) -> Optional[Dict[str, str]]:
    m = _LABEL_HEADING.match(text)
    if not m or len(text) > 90:
        return None
    word, label, tail = m.group(1), m.group(2), m.group(3) or ""
    if _SENTENCE_TAIL.search(tail) and not _MARKS_IN_NAME.search(tail):
        return None
    head = f"{word.title() if word.isascii() else word} {label.upper() if len(label) <= 4 else label.title()}"
    # "SECTION A (20 Marks)": the section's total is not part of its name.
    rest = _tidy_name(_MARKS_NOTE_IN_NAME.sub(" ", tail))
    return {"label": _label_key(label), "name": f"{head}: {rest}" if rest else head}


def _subject_heading(text: str) -> Optional[str]:
    if len(text) > 60 or "?" in text or text.endswith(".") or _NOT_HEADING_START.match(text):
        return None
    if "following" in text.lower() or _OPTION_LINE.match(text):
        return None
    name = _tidy_name(text)
    if not name or re.search(r"\d", name) or len(name.split()) > 7 or not _SUBJECT.search(name):
        return None
    return name


def is_section_heading(text: str) -> bool:
    """A block that opens a section: "SECTION – B", "Part II", "Physics"."""
    return _label_heading(text) is not None or _subject_heading(text) is not None


def _range_rows(texts: Sequence[str]) -> List[Dict[str, Any]]:
    """The front page's table of sections and their question ranges. The
    text layer splits a table into one block per cell, so the front matter
    is read as one line: "… English Comprehension 1–15 30 minutes Logical
    Reasoning 16–30 …"; the words left of a range, less the table's own
    column words ("minutes", "questions"), are the section's name."""
    rows: List[Dict[str, Any]] = []
    for m in _RANGE_ROW.finditer(" ".join(texts)):
        name = _row_name(m.group("name"))
        a, b = int(m.group("a")), int(m.group("b"))
        if not name or a > b or b - a > 300 or len(name) < 2:
            continue
        # The table is over once a range does not continue the last one:
        # what follows is the sections' own headings ("Questions 1 to 15").
        if rows and (a <= rows[-1]["to"] or a - rows[-1]["to"] > 3):
            break
        # The row's time column, right after the range ("1–15 30 minutes",
        # "1–15 15 questions 30 minutes").
        tail = m.string[m.end():m.end() + 40]
        t = re.match(r"\s*(?:\d+\s+(?:questions?|qs?)\s+)?(\d+)\s*" + _MINS + r"\b", tail, re.I)
        rows.append({"name": name, "from": a, "to": b, "minutes": int(t.group(1)) if t else None})
    # A real table of sections starts at the first question; years, page
    # ranges and data tables do not.
    if len(rows) < 2 or rows[0]["from"] > 3:
        return []
    return rows


# "S E C T I O N" — a letter-spaced heading as the text layer reads it.
_SPACED = re.compile(r"\b(?:[A-Za-z] ){2,}[A-Za-z]\b")
_LABEL_ANYWHERE = re.compile(
    r"(?:section|part|paper|group|unit|खण्ड|खंड|भाग)(?:\s+|\s*[-–—:.]\s*)\(?(?:[A-Za-z]|[IVXivx]{1,4}|\d{1,2}|[अ-ह])\)?(?![A-Za-z0-9])",
    re.I,
)


def _row_name(raw: str) -> str:
    """The section's name out of the words left of its range: the table's
    column words and whatever the title line left behind are dropped, and
    the name starts at its subject word or "Section X"."""
    name = _SPACED.sub(" ", raw)
    m = _LABEL_ANYWHERE.search(name) or _SUBJECT.search(name)
    if m:
        name = name[m.start():]
    else:
        while True:
            stripped = _NOISE_WORD.sub("", name.strip(), count=1)
            if stripped == name.strip():
                break
            name = stripped
    name = _tidy_name(name)
    words = name.split()
    return " ".join(words[-6:]) if len(words) > 6 else name


def _section_shell(name: str, source: str, label: Optional[str] = None) -> Dict[str, Any]:
    return {"name": name, "label": label, "source": source, "numbers": [], "from": None, "to": None,
            "count": 0, "marks": None, "negative_marks": None, "instruction": "", "duration_minutes": None}


def outline_of_blocks(blocks: Sequence[str], key_at: Optional[int]) -> Dict[str, Any]:
    """{"question_count", "sections": [...], "marking": {...}} for a paper's
    blocks (the answer key, from `key_at`, excluded)."""
    body = list(blocks[:key_at] if key_at is not None else blocks)
    runs = question_runs(body)
    starts = [False] * len(body)
    for run in runs:
        for i in run:
            starts[i] = True
    texts = [_text_of(b) for b in body]
    first_q = next((i for i, s in enumerate(starts) if s), len(body))
    numbers = [int(_question_no(b)) for b, s in zip(body, starts) if s]
    # Distinct numbers within each run of numbering: an empty "1. 2. 3."
    # is not counted twice against the real Q1–Q3, and a paper that
    # numbers every section from 1 counts every section.
    count = sum(len({_question_no(body[i]) for i in run}) for run in runs)
    front = " ".join(texts[:first_q])
    # The paper's general scheme is what the instructions say about EVERY
    # question; a line about one section ("Section A … 1 mark each") is
    # that section's and must not become the default for the rest.
    by_label: Dict[str, Dict[str, Any]] = {}
    general = front
    for m in _LABEL_MARKS.finditer(front):
        scheme = marking_of(m.group(2))
        if scheme["marks"] is not None or scheme["negative_marks"] is not None:
            by_label.setdefault(_label_key(m.group(1)), scheme)
            general = general.replace(m.group(0), " ")
    paper_marking = marking_of(general)

    sections: List[Dict[str, Any]] = []
    # 1. A table of ranges on the front page.
    for row in _range_rows(texts[:first_q]):
        sec = _section_shell(row["name"], "table")
        sec["from"], sec["to"] = row["from"], row["to"]
        sec["numbers"] = [n for n in numbers if row["from"] <= n <= row["to"]]
        sec["duration_minutes"] = row.get("minutes")
        sections.append(sec)
    if sections and sum(len(s["numbers"]) for s in sections) < 0.8 * count:
        sections = []  # the table is not about this paper's questions
    # 2. Headings in the body.
    if not sections:
        heads: List[tuple] = []
        for i, text in enumerate(texts):
            if starts[i] or _END_MARK.match(text):
                continue
            lab = _label_heading(text)
            if lab:
                # Before the first question, the instructions' own list
                # ("Section B: Questions 21–40 …") names ranges that start
                # elsewhere; only a heading for the questions that follow
                # counts, whatever marks note it carries.
                rng = _RANGE_FROM.search(text) if i < first_q else None
                if rng and numbers and int(rng.group(1)) != numbers[0]:
                    continue
                heads.append((i, lab["name"], lab["label"]))
                continue
            sub = _subject_heading(text)
            # "(Science fair scores logic)" under "Directions for Questions
            # 25–28:" captions that set of questions, not a new section.
            if sub and not (i > 0 and _BRACKETED.fullmatch(text.strip()) and _SET_INTRO.match(texts[i - 1])):
                heads.append((i, sub, None))
        # In the front matter keep only the last heading.
        front_heads = [h for h in heads if h[0] < first_q]
        heads = ([front_heads[-1]] if front_heads else []) + [h for h in heads if h[0] >= first_q]
        for k, (i, name, label) in enumerate(heads):
            end = heads[k + 1][0] if k + 1 < len(heads) else len(body)
            sec = _section_shell(name, "heading", label)
            sec["numbers"] = [int(_question_no(body[j])) for j in range(i, end) if starts[j]]
            # The section's own instructions: the short lines between the
            # heading and its first question ("Attempt all. 1 mark each."),
            # stopping at anything long or passage-like ("Directions for
            # questions 1–5: read the passage…"), which is not the section's.
            first = next((j for j in range(i, end) if starts[j]), end)
            lines: List[str] = []
            for j in range(i + 1, first):
                if len(texts[j]) > 160 or _PASSAGE_INTRO.match(texts[j]):
                    break
                lines.append(texts[j])
            sec["instruction"] = " ".join(lines)[:400]
            sec["heading_text"] = texts[i]
            sec["heading_at"] = i
            if sec["numbers"]:
                sections.append(sec)
    # 3. "END OF SECTION I" markers.
    if not sections:
        marks = [(i, m.group(1)) for i, t in enumerate(texts) if (m := _END_MARK.match(t))]
        if marks:
            start = 0
            for k, (i, label) in enumerate(marks):
                sec = _section_shell(f"Section {label.upper()}", "marker", _label_key(label))
                sec["numbers"] = [int(_question_no(body[j])) for j in range(start, i) if starts[j]]
                if sec["numbers"]:
                    sections.append(sec)
                start = i + 1
            tail = [int(_question_no(body[j])) for j in range(start, len(body)) if starts[j]]
            if tail:
                sec = _section_shell(f"Section {len(marks) + 1}", "marker")
                sec["numbers"] = tail
                sections.append(sec)
    if len(sections) < 2:
        sections = []

    # Marks per section: its own instruction, else the general instructions'
    # line about it ("Section A … 1 mark each"), else the paper's scheme.
    ranges: List[Dict[str, Any]] = []
    for m in _RANGE_MARKS.finditer(front):
        marks = _num(m.group(4))
        if marks is not None:
            ranges.append({"from": int(m.group(1)), "to": int(m.group(2)), "marks": marks})
    paper_minutes = duration_of(front)
    first_heading_at = sections[0].get("heading_at") if sections else None
    for sec in sections:
        sec.pop("heading_at", None)
        own_text = " ".join(t for t in (sec.pop("heading_text", ""), sec["instruction"]) if t)
        own = marking_of(own_text) if own_text else {"marks": None, "negative_marks": None}
        if sec["duration_minutes"] is None and own_text:
            sec["duration_minutes"] = duration_of(own_text, loose=True)
        labelled = by_label.get(sec["label"] or "", {})
        ranged = next((r for r in ranges if sec["numbers"] and r["from"] <= sec["numbers"][0] <= r["to"]), None)
        sec["marks"] = (own["marks"] if own["marks"] is not None
                        else labelled.get("marks") if labelled.get("marks") is not None
                        else ranged["marks"] if ranged
                        else paper_marking["marks"])
        neg = own["negative_marks"] if own["negative_marks"] is not None else labelled.get("negative_marks")
        if neg is None:
            neg = paper_marking["negative_marks"]
            if neg is None and paper_marking["negative_fraction"] and sec["marks"]:
                neg = round(paper_marking["negative_fraction"] * sec["marks"], 2)
        sec["negative_marks"] = neg
        sec["count"] = len(set(sec["numbers"]))
        if sec["numbers"]:
            sec["from"], sec["to"] = min(sec["numbers"]), max(sec["numbers"])
        sec.pop("numbers", None)
    # "Time: 30 minutes" under the first section's heading, with no time
    # printed above it, is that section's own time, not the paper's.
    if (paper_minutes is not None and first_heading_at is not None and first_heading_at < first_q
            and duration_of(" ".join(texts[:first_heading_at])) is None
            and all(sec["duration_minutes"] for sec in sections)):
        paper_minutes = None
    # A paper that times each section separately is as long as the sections
    # together, when it does not say so itself.
    if paper_minutes is None and sections and all(sec["duration_minutes"] for sec in sections):
        paper_minutes = sum(sec["duration_minutes"] for sec in sections)
    return {
        "question_count": count,
        "sections": sections,
        "marking": {"marks": paper_marking["marks"], "negative_marks": paper_marking["negative_marks"]},
        "duration_minutes": paper_minutes,
        "ranges": ranges,
    }


def outline_of_html(html: str) -> Dict[str, Any]:
    blocks = split_blocks(html or "")
    return outline_of_blocks(blocks, find_answer_key(blocks))


def _printed_marks(q: Dict[str, Any]) -> Optional[float]:
    v = q.get("marks")
    if isinstance(v, (int, float)) and 0 < v < 1000:
        return float(v)
    if isinstance(v, str) and _num(v) is not None:
        return _num(v)
    text = _text_of(str((q.get("question") or {}).get("content") or ""))
    m = _TRAILING_MARKS.search(text)
    return _num(next((g for g in m.groups() if g), None)) if m else None


def apply_outline(questions: List[Dict[str, Any]], outline: Dict[str, Any]) -> None:
    """Name each question's section and settle its marks in place. Sections
    are matched by question number; when the paper restarts numbering in
    every section, by the restarts instead."""
    sections: List[Dict[str, Any]] = outline.get("sections") or []
    paper = outline.get("marking") or {}
    ranges = outline.get("ranges") or []
    nos: List[Optional[int]] = []
    for q in questions:
        s = str(q.get("question_number") or "").strip()
        nos.append(int(s) if s.isdigit() else None)
    known = [n for n in nos if n is not None]
    by_number = len(known) == len(set(known))

    k = 0
    prev: Optional[int] = None
    for q, n in zip(questions, nos):
        sec: Optional[Dict[str, Any]] = None
        if sections:
            if by_number and n is not None:
                sec = next((s for s in sections if s["from"] is not None and s["from"] <= n <= s["to"]), None)
                if sec is not None:
                    k = sections.index(sec)
                else:
                    sec = sections[k]
            else:
                if n is not None and prev is not None and n < prev and k + 1 < len(sections):
                    k += 1
                sec = sections[k]
        q["section"] = sec["name"] if sec else None
        marks = _printed_marks(q)
        if marks is None and n is not None:
            marks = next((r["marks"] for r in ranges if r["from"] <= n <= r["to"]), None)
        if marks is None:
            marks = (sec or {}).get("marks") if sec else None
        if marks is None:
            marks = paper.get("marks")
        neg = q.get("negative_marks")
        neg = float(neg) if isinstance(neg, (int, float)) and neg >= 0 else None
        if neg is None:
            neg = (sec or {}).get("negative_marks") if sec else None
        if neg is None:
            neg = paper.get("negative_marks")
        q["marks"] = marks
        q["negative_marks"] = neg
        if n is not None:
            prev = n


__all__ = ["outline_of_html", "outline_of_blocks", "marking_of", "duration_of", "apply_outline", "is_section_heading"]
