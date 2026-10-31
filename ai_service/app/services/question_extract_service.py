"""Digitise an EXISTING question paper — every question, verbatim, with its key.

This is the `mode=extract` path of /math-parser/pdf-to-questions. The older
path (question_gen_service.questions_from_html) is a GENERATOR: one model
call over the whole document, "include the first 20 questions", free to
paraphrase. That is right for "make me 10 MCQs from this chapter" and wrong
for "put my 60-question mock test into Vacademy", which is what Vsmart
Extract promises. This module does what a careful person does with a paper:

  1. cut the paper into parts at question boundaries so no call is asked to
     return more than it can without truncating;
  2. set the answer key / solutions section aside — it must not be read as
     questions, and it must be applied to them afterwards;
  3. read each part with a prompt that forbids inventing, rephrasing,
     solving or skipping, and keeps shared passages / data tables with every
     question that depends on them;
  4. merge, de-duplicate on the paper's own numbering, and map the printed
     key onto the options.

The result is the same RAW question JSON the rest of the pipeline consumes
(question_format.convert_to_question_paper_response on read), plus
`passage`, `section`, `marks`, `negative_marks`, `option_label` per question
and an `extraction` summary at the root.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from ..models.ai_token_usage import RequestType
from ..utils.html_tags import HtmlTagProtector
from . import ai_billing, llm_json
from .ai_billing import metering_user
from .ai_prompts import question_extract as prompts

logger = logging.getLogger(__name__)

# Characters of (tag-protected) HTML per model call. A 15k-char part is
# roughly 8–12 printed questions with options — comfortably inside what a
# model returns without cutting the JSON short.
CHUNK_TARGET = 15_000
CHUNK_MAX = 22_000
# A shared passage / data table sits between question starts. Cutting right
# after one would orphan it from its questions, so a cut is only allowed
# when the material since the last question start is shorter than this.
MAX_TAIL_WITHOUT_QUESTION = 2_500
# Worked solutions can outrun the questions (a 67-page mock: 21 pages of
# questions, 43 of solutions). They are read in parts like the paper, capped
# so a pathological appendix cannot run up the bill.
MAX_KEY_PARTS = 12
PARALLEL_PARTS = 3

# Block boundaries in MathPix / pymupdf HTML. The closing tag is captured so
# it stays with the block it closes.
_BLOCK_END = re.compile(r"(</p>|</div>|</table>|</h[1-6]>|</li>|<br\s*/?>)", re.I)
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")

# "1.", "1)", "(1)", "Q1.", "Q. 12 …", "Question 3:", "7 – …" at the start of a
# block. After a bare number a separator is required (or "2024 was a leap
# year" would start a question) and a "." must not continue into a decimal
# ("1.9 min" is a timing, not question 1); after a Q / Question marker no
# separator is needed, but the number must end there ("Q30S", a code in a
# series puzzle; "Q 30% 7 : 5" and "Q 1,20,000 …", table rows, are not
# questions 30 and 1).
_QUESTION_START = re.compile(
    r"^\s*(?:"
    r"(?:q(?:uestion)?\.?\s*)\(?(\d{1,3})(?![A-Za-z0-9%]|,\d)\)?\s*[\.\):\-–]?\s*"
    r"|\(?(\d{1,3})\)?\s*(?:\.(?!\d)|[\):\-–])\s*"
    r")", re.I
)
# A heading that opens the answer key / solutions: "ANSWER KEY", "Answers",
# "Answers and Explained Solutions", "Hints & Solutions", "Part Two: Solutions",
# "उत्तरमाला". Anchored at both ends with room for a couple of extra words, so
# "Answer the following questions" (a section instruction) and "…the cases
# then answer themselves" (a sentence in a solution) do not qualify.
_KEY_HEADING = re.compile(
    r"^\s*(?:(?:part|section)\s+\w+\s*[:\-–.]?\s*)?"
    r"(?:answer\s*keys?|answers|solutions?|hints?|key|marking\s*scheme|उत्तर\s*कुंजी|उत्तरमाला)"
    r"(?:\s*(?:and|&|with|to|,)\s*\w+(?:\s+\w+){0,2})?\s*[:\-–.]?\s*$",
    re.I,
)
# Phrases that only ever open a key / solutions section, wherever they sit.
_KEY_PHRASE = re.compile(
    r"\b(?:answer\s*keys?|answers?\s+(?:and|&|with)\s+(?:explained\s+|detailed\s+)?solutions?|"
    r"solutions?\s+(?:and|&)\s+explanations?|hints?\s+(?:and|&)\s+solutions?|"
    r"उत्तरमाला|उत्तर\s*कुंजी)\b",
    re.I,
)
# A block that is itself a run of "1. B  2. C  3. A …" — a key without a heading.
# Either a separator after the number ("1. b", "1) (b)", "1: b", "1 – b") or a
# bare letter after whitespace ("1 b", a table read as text). NOT "10 (b)" —
# that is an option line "(a) 10 (b) 12 …", which must never be taken for a key.
_KEY_RUN = re.compile(
    r"(?<![A-Za-z0-9)])(?:q\.?\s*)?(\d{1,3})"
    r"(?:\s*[\.\):\-–]\s*\(?([A-Da-d]|[1-4]|i{1,3}|iv)\)?|\s+([A-Da-d]|i{1,3}|iv))(?=\s|$|,|;)",
    re.I,
)
_OPTION_LINE = re.compile(r"^\s*\(?[a-dA-D][\)\.]\s")


def _key_pairs(text: str) -> List[Tuple[str, str]]:
    """(question number, answer label) pairs printed in a line of key."""
    if _OPTION_LINE.match(text):
        return []
    return [(m.group(1), m.group(2) or m.group(3)) for m in _KEY_RUN.finditer(text)]

_ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5}


def _text_of(block: str) -> str:
    return _WS.sub(" ", _TAG.sub(" ", block)).strip()


# A block that is only a range of numbers ("1–15", the questions column of
# a front-page section table) is not question 1.
_PURE_RANGE = re.compile(r"^\s*\d{1,3}\s*(?:[–\-—]|to)\s*\d{1,3}\s*$", re.I)


def _question_no(block: str) -> Optional[str]:
    text = _text_of(block)
    if _PURE_RANGE.match(text):
        return None
    m = _QUESTION_START.match(text)
    return (m.group(1) or m.group(2)) if m else None


# ---------------------------------------------------------------------------
# 1 + 2. Splitting the paper
# ---------------------------------------------------------------------------

def split_blocks(html: str) -> List[str]:
    """The document as a list of block-level fragments, in order."""
    pieces = _BLOCK_END.split(html or "")
    blocks: List[str] = []
    # split() alternates [text, closing-tag, text, closing-tag, …]; glue each
    # closing tag back onto the text before it.
    for i in range(0, len(pieces), 2):
        body = pieces[i] + (pieces[i + 1] if i + 1 < len(pieces) else "")
        if body.strip():
            blocks.append(body)
    return blocks


def find_answer_key(blocks: Sequence[str]) -> Optional[int]:
    """Index of the block that opens the answer key, or None.

    Prefers an explicit heading ("ANSWER KEY", "Solutions", "उत्तरमाला") in the
    second half of the paper — a paper's own "Answers" heading in an
    instructions box on page 1 is not the key. Falls back to the first block
    that is a dense run of "n. X" pairs.
    """
    n = len(blocks)
    # The key comes after the questions — but not necessarily late in the
    # document (43 pages of worked solutions can follow 20 pages of
    # questions), so the scan starts after the first few question starts
    # rather than at a fixed fraction. The FIRST key heading opens the
    # section; later ones ("Solutions" inside it) belong to the same section.
    seen = 0
    start = n
    for i, block in enumerate(blocks):
        if _question_no(block) is not None:
            seen += 1
            if seen == 3:
                start = i + 1
                break
    for i in range(start, n):
        text = _text_of(blocks[i])
        if _question_no(blocks[i]):
            continue
        if len(text) <= 60 and _KEY_HEADING.match(text):
            return i
        # A heading swept into one line with a subtitle ("PART TWO Answers
        # and Explained Solutions Method, working, …"): the unambiguous
        # two-word phrases are safe to find anywhere in a short block.
        if len(text) <= 160 and _KEY_PHRASE.search(text):
            return i
    # Enough pairs to be a key: eight, or half the paper's questions for a
    # short paper ("Answers: 1. b 2. c 3. a" after three questions).
    question_count = sum(1 for st in question_starts(blocks[:start + 1]) if st)
    need = max(3, min(8, question_count // 2))
    for i in range(start, n):
        text = _text_of(blocks[i])
        hits = len(_key_pairs(text))
        # A key line is nothing but "n. X" pairs; a question that happens to
        # mention numbers has far more text per pair.
        if hits >= need and len(text) / hits < 14:
            return i
        # "Answers: 1. b 2. c …" — the heading and the key on one line.
        if hits >= need and re.match(r"^\s*(?:answer\s*keys?|answers?|key)\s*[:\-–]", text, re.I):
            return i
        # A key TABLE: a row of question numbers over a row of letters
        # ("1 2 3 … 10 / A A C … D"), read cell by cell.
        if blocks[i].lstrip().lower().startswith("<table") and _looks_like_key_table(text):
            return i
    return None


def _looks_like_key_table(text: str) -> bool:
    """Question numbers paired with option letters, roughly one to one — the
    surrounding table may carry more ("What it tests", "Level", "Target")."""
    tokens = text.split()
    numbers = sum(1 for t in tokens if t.isdigit() and len(t) <= 3)
    letters = sum(1 for t in tokens if re.fullmatch(r"[A-Da-d]|i{1,3}|iv|\(?[a-d]\)", t))
    return numbers >= 8 and letters >= 8 and 0.6 <= letters / numbers <= 1.6


_EXPLICIT_Q = re.compile(r"^\s*\(?\s*q(?:uestion)?\.?\s*\(?\d", re.I)


# The block(s) just before a numbered list that make it the instructions,
# not the questions: "General Instructions", "Instructions to Candidates",
# "Note:", "निर्देश".
_INSTRUCTIONS_HEAD = re.compile(
    r"^\s*(?:general\s+|important\s+)?instructions?\b|^\s*note\s*:|^\s*(?:सामान्य\s+)?निर्देश", re.I
)
# Runs shorter than this that sit before a fresh "1." are an instructions
# list when nothing says otherwise; a section restarts numbering after a
# heading, and that is kept.
_LIST_MAX = 10


def question_runs(blocks: Sequence[str]) -> List[List[int]]:
    """The blocks that open questions, grouped into the paper's RUNS of
    numbering (one run, or one per section when the paper restarts at 1).

    Numbered blocks continue a run when they follow its sequence (a number
    up to three ahead is accepted, so a misread or a skipped number does
    not stall the cursor). A number that restarts at 1:
      - after a section heading, with a "Q" marker, or after the
        instructions list, starts a new run — the paper numbers each
        section from 1;
      - otherwise opens a nested run, the statements "1) 2) 3) 4)" inside a
        question, which is dropped as soon as the outer run continues.
    A leading run is the instructions list, not questions, when the paper
    goes on to restart at 1 and the run was headed "General Instructions"
    / "Note:", or is short with no options under its items and the restart
    is longer. A paper that never restarts keeps its first run whatever
    line sits above it.
    """
    from .paper_outline import is_section_heading

    texts = [_text_of(b) for b in blocks]
    runs: List[Dict[str, Any]] = []
    open_runs: List[Dict[str, Any]] = []
    heading_since_start = False
    for i, block in enumerate(blocks):
        no = _question_no(block)
        if no is None:
            if len(texts[i]) <= 90 and is_section_heading(texts[i]):
                heading_since_start = True
            continue
        n = int(no)
        explicit = bool(_EXPLICIT_Q.match(texts[i]))
        # Outermost first: statements nest inside a question, so the outer
        # sequence resuming ends the inner one.
        matched = next((r for r in open_runs if r["expected"] <= n <= r["expected"] + 3), None)
        if matched is None and explicit and n != 1:
            # "Question 3" after a run that just took a bare "3." — the last
            # item of a "1. 2. 3." list inside the previous entry, which
            # happened to be the number the run expected. The marker is the
            # question; the list items (at most a few) go back to the entry.
            matched = _rewind_to(open_runs, n)
        if matched is not None:
            while open_runs[-1] is not matched:
                open_runs.pop()["nested"] = True
        elif n == 1 or explicit:
            # A fresh "1." nests inside a question (its statements) unless
            # a heading or a "Q" marker restarts the paper — or the run it
            # would nest in is the instructions list, which has no statements.
            # A "Q" marker on any other number out of sequence (a misread
            # "Q77", a stray "Q 30 …" in a table) only opens a candidate
            # under the current run, dropped as soon as that run resumes.
            restart = n == 1 and (explicit or heading_since_start or not open_runs or open_runs[-1]["instructions"])
            if restart:
                open_runs.clear()
            before = texts[max(0, i - 3):i]
            after_heading = any(is_section_heading(t) for t in before if len(t) <= 90)
            matched = {"idx": [], "nos": [], "bare": [], "expected": n, "nested": False,
                       "restart": restart and bool(runs),
                       "instructions": any(_INSTRUCTIONS_HEAD.match(t) for t in before) and not after_heading,
                       "after_heading": after_heading}
            runs.append(matched)
            open_runs.append(matched)
        else:
            continue
        matched["idx"].append(i)
        matched["nos"].append(n)
        matched["bare"].append(not explicit)
        matched["expected"] = n + 1
        heading_since_start = False

    kept = [r for r in runs if not r["nested"]]

    def reads_like_a_list(r: Dict[str, Any]) -> bool:
        # Instructions are numbered sentences: no "Q" markers, no options
        # under them. Questions without options (long answers) that also
        # sit under no heading are the residual risk, accepted.
        if r["after_heading"] or any(_EXPLICIT_Q.match(texts[i]) for i in r["idx"]):
            return False
        with_options = sum(
            1 for i in r["idx"] if any(_OPTION_LINE.match(texts[j]) for j in range(i + 1, min(i + 3, len(texts))))
        )
        return with_options * 2 < len(r["idx"])

    # The instructions list only ever sits before a restart: "Note: … 1. 2."
    # followed by Q1 again. With no restart, the first run is the questions,
    # whatever line sits above it ("Note: all questions are compulsory").
    while len(kept) >= 2 and kept[1]["restart"] and (
        kept[0]["instructions"]
        or (len(kept[0]["idx"]) <= _LIST_MAX and reads_like_a_list(kept[0])
            and len(kept[1]["idx"]) > len(kept[0]["idx"]))
    ):
        kept.pop(0)
    # Only a restart opens a run of its own. A candidate the outer run never
    # came back to (the statements of the last question, a numbering gap)
    # belongs to the outer run's numbering.
    merged: List[List[int]] = []
    for r in kept:
        if merged and not r["restart"]:
            merged[-1] = sorted(merged[-1] + r["idx"])
        else:
            merged.append(list(r["idx"]))
    return merged


def _rewind_to(open_runs: List[Dict[str, Any]], n: int) -> Optional[Dict[str, Any]]:
    """The open run whose last few entries are bare numbers ≥ n sitting
    right after an explicit "Question m" entry that expects n (within the
    usual slack) — in a run of markers, bare numbers are a list inside the
    entry, not questions. Drops them and returns the run, now expecting n;
    None when no run reads that way. A bare-numbered run is never rewound:
    a stray "Q 6 …" (a table with a Q column) must not evict question 6."""
    for r in open_runs:
        tail = 0
        while tail < len(r["idx"]) and r["nos"][-1 - tail] >= n and r["bare"][-1 - tail]:
            tail += 1
        if not 0 < tail <= 3 or tail == len(r["idx"]) or r["bare"][-1 - tail]:
            continue
        last = r["nos"][-1 - tail]
        if last < n <= last + 3:
            for key in ("idx", "nos", "bare"):
                del r[key][-tail:]
            r["expected"] = n
            return r
    return None


def question_starts(blocks: Sequence[str]) -> List[bool]:
    """Which blocks open a question (see question_runs)."""
    out = [False] * len(blocks)
    for run in question_runs(blocks):
        for i in run:
            out[i] = True
    return out


def chunk_blocks(blocks: Sequence[str]) -> List[str]:
    """Group blocks into parts of about CHUNK_TARGET chars, cutting only at a
    question start that is not preceded by a long unnumbered stretch (a
    passage or table that belongs to the questions after it)."""
    parts: List[str] = []
    current: List[str] = []
    size = 0
    since_question = 0     # chars appended since the last question start
    has_question = False
    starts = question_starts(blocks)
    for block, starts_question in zip(blocks, starts):
        if current and starts_question and has_question:
            cut = (size + len(block) > CHUNK_TARGET and since_question <= MAX_TAIL_WITHOUT_QUESTION) \
                or size + len(block) > CHUNK_MAX
            if cut:
                parts.append("".join(current))
                current, size, has_question, since_question = [], 0, False, 0
        elif current and size + len(block) > CHUNK_MAX:
            # A monster stretch with no question starts at all (a long
            # passage): cut anyway rather than exceed what one call can hold.
            parts.append("".join(current))
            current, size, has_question, since_question = [], 0, False, 0
        current.append(block)
        size += len(block)
        if starts_question:
            has_question = True
            since_question = 0
        else:
            since_question += len(block)
    if current:
        parts.append("".join(current))
    return parts


# ---------------------------------------------------------------------------
# 3. The key and the printed solutions, read without a model
# ---------------------------------------------------------------------------
#
# Reading worked solutions through the model meant paying for it to type them
# out again — 83k of the 127k output characters of a 60-question mock. The
# solutions section is numbered like the paper, so it is cut at question
# numbers exactly as the paper is, and each slice becomes that question's
# explanation verbatim. The answer letter is read from the slice's first
# line, from "n. b" runs, from "Q Ans" rows and from number-row / letter-row
# tables. The model is asked for the key only when all of that finds fewer
# than 70% of the questions.

_ANSWER_LINE = re.compile(
    r"(?:^|\b(?:ans(?:wer)?|correct\s+(?:option|answer)|key)\b\s*[:.\-–]?\s*)\(?([A-Da-d]|i{1,3}|iv)\)?(?=\s|$|[.,;])",
    re.I,
)
_ENTRY_HEAD = re.compile(
    r"^\s*(?:q(?:uestion)?\.?\s*)?\(?(\d{1,3})\)?\s*[\.\):\-–]?\s*\(?([A-Da-d]|i{1,3}|iv)\)?(?=\s|$|[.,;])",
    re.I,
)
_LETTER = re.compile(r"^(?:[A-Da-d]|i{1,3}|iv)$")


def _pairs_from_tables(blocks: Sequence[str]) -> Dict[str, str]:
    """A number row over a letter row ("1 2 3 … / A A C …"), column by column."""
    out: Dict[str, str] = {}
    for block in blocks:
        if not block.lstrip().lower().startswith("<table"):
            continue
        rows = [[_text_of(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S | re.I)]
                for row in re.findall(r"<tr[^>]*>(.*?)</tr>", block, re.S | re.I)]
        for a, b in zip(rows, rows[1:]):
            nums = [c for c in a if c]
            lets = [c for c in b if c]
            if len(nums) >= 4 and len(nums) == len(lets) and all(n.isdigit() for n in nums) \
                    and all(_LETTER.match(l) for l in lets):
                out.update(dict(zip(nums, lets)))
    return out


_PIPE_RULE = re.compile(r"^[\s|:\-]+$")
# A row that ends in the middle of an answer: "… 6-A, 7-".
_CUT_PAIR = re.compile(r"(?<![A-Za-z0-9)])\d{1,3}\s*[\.\):\-–]\s*$")
# A row that opens with the rest of it: "C, 8-B …".
_CUT_REST = re.compile(r"^\(?(?:[A-Da-d]|i{1,3}|iv)\)?(?=\s|$|[,;])", re.I)


def _rows_cut_by_a_page_break(blocks: Sequence[str]) -> List[str]:
    """A markdown key row (MathPix prints one block per "| … |" row) that a
    page break cut mid-answer — "… 6-A, 7-", the header again, "C, 8-B …" —
    stitched back to its continuation. On its own the first half is short
    of a key line's pairs and the cut answer is lost."""
    texts = [_text_of(b) for b in blocks]
    out: List[str] = []
    for i, text in enumerate(texts):
        row = text.replace("|", " ").strip()
        if not text.lstrip().startswith("|") or not _CUT_PAIR.search(row):
            continue
        for nxt in texts[i + 1:i + 6]:
            if not nxt.lstrip().startswith("|"):
                break
            rest = nxt.replace("|", " ").strip()
            # the rule rows and the header the new page repeats
            if _PIPE_RULE.match(nxt) or not re.search(r"\d", nxt):
                continue
            if _CUT_REST.match(rest):
                out.append(f"{row} {rest}")
            break
    return out


def read_key_region(blocks: Sequence[str], min_hits: int = 4) -> Tuple[Dict[str, Dict[str, Any]], int]:
    """(answers by question number, how many carry an explanation).

    answers[n] = {"options": [letter], "ans": "", "exp": html} — the same
    shape the model returns, so apply_answer_key does not care which read it.
    `min_hits` = how many "n. X" pairs a line needs to count as a key run
    (lower for a short paper)."""
    answers: Dict[str, Dict[str, Any]] = {}

    def entry(no: str) -> Dict[str, Any]:
        return answers.setdefault(no, {"options": [], "ans": "", "exp": ""})

    # 1. Tables of numbers over letters, and "1. b 2. c" runs anywhere.
    for no, letter in _pairs_from_tables(blocks).items():
        entry(no)["options"] = [letter]
    # A row a page break cut in two comes after the rows, so it only fills
    # what they left unanswered.
    for text in [_text_of(block) for block in blocks] + _rows_cut_by_a_page_break(blocks):
        hits = _key_pairs(text)
        if len(hits) >= min_hits and (len(text) / len(hits) < 14
                                      or re.match(r"^\s*(?:answer\s*keys?|answers?|key)\s*[:\-–]", text, re.I)):
            for no, letter in hits:
                e = entry(no)
                if not e["options"]:
                    e["options"] = [letter]

    # 2. Solution entries: cut at question numbers, in sequence.
    starts = question_starts(blocks)
    idx = [i for i, st in enumerate(starts) if st]
    explained = 0
    for k, i in enumerate(idx):
        j = idx[k + 1] if k + 1 < len(idx) else len(blocks)
        no = _question_no(blocks[i])
        if not no:
            continue
        head = _text_of(blocks[i])
        e = entry(no)
        m = _ENTRY_HEAD.match(head)
        if m and m.group(2) and not e["options"]:
            e["options"] = [m.group(2)]
        if not e["options"]:
            m2 = _ANSWER_LINE.search(head[:200])
            if m2:
                e["options"] = [m2.group(1)]
        body = "".join(blocks[i:j])
        # The heading line itself carries the number/answer; the rest is the
        # explanation. A bare "n. b" line has nothing left and stays empty.
        rest = "".join(blocks[i + 1:j])
        exp = rest if rest.strip() else _strip_entry_head(body, no)
        if len(_text_of(exp)) >= 25:
            e["exp"] = exp.strip()
            explained += 1
    return answers, explained


def numbering_runs(questions: Sequence[Dict[str, Any]]) -> List[List[int]]:
    """Indexes of `questions` grouped into runs of numbering: one run, or
    one per section when the paper numbers each section from 1 (a number
    that starts over, at 1 or 2, after a higher one opens a new run; a
    misread "7" for "17" does not)."""
    runs: List[List[int]] = [[]]
    prev: Optional[int] = None
    for i, q in enumerate(questions):
        no = str(q.get("question_number") or "").strip()
        n = int(no) if no.isdigit() else None
        if n is not None and prev is not None and n < prev and n <= 2:
            runs.append([])
        runs[-1].append(i)
        if n is not None:
            prev = n
    return [r for r in runs if r]


def split_key_region(blocks: Sequence[str], min_hits: int = 2) -> List[List[str]]:
    """The key region cut where its numbering restarts — a "1. a … 20. d"
    line followed by another "1. b …", or solution entries starting over at
    "1." after "20." — so a paper that numbers each section from 1 can have
    each section's answers applied to it. Key lines and solution entries
    may each restart, giving two regions per section. Entries are the
    sequence-aware question starts, so a numbered list inside an
    explanation does not cut."""
    runs = question_runs(blocks)
    heads = {run[0] for run in runs[1:]}
    entries = {i for run in runs for i in run}
    cuts = set()
    seen_max = 0
    for i, block in enumerate(blocks):
        text = _text_of(block)
        nos = [int(no) for no, _l in _key_pairs(text) if no.isdigit()]
        if len(nos) < min_hits or len(text) / len(nos) >= 14:
            nos = [int(_question_no(block) or 0)] if i in entries else []
        if not nos:
            continue
        if nos[0] <= 2 and seen_max >= 3 and (i in heads or len(nos) > 1):
            cuts.add(i)
        seen_max = max(seen_max, *nos)
    regions: List[List[str]] = [[]]
    for i, block in enumerate(blocks):
        if i in cuts and regions[-1]:
            regions.append([])
        regions[-1].append(block)
    return [r for r in regions if r]


def _strip_entry_head(html: str, no: str) -> str:
    """Drop the leading "12. (b)" from a one-block entry, keep the prose."""
    return re.sub(r"^(\s*(?:<p>|<div>)?\s*)(?:q(?:uestion)?\.?\s*)?\(?" + re.escape(no)
                  + r"\)?\s*[\.\):\-–]?\s*\(?(?:[A-Da-d]|i{1,3}|iv)?\)?\s*[\.\):\-–]?\s*",
                  r"\1", html, count=1, flags=re.I)


# ---------------------------------------------------------------------------
# 4. Merging and the key
# ---------------------------------------------------------------------------

def _label_to_index(label: str, option_labels: Sequence[str]) -> Optional[int]:
    """Printed answer label → 0-based option index, by the options' own
    printed labels first, then by convention (A/B/C/D, a/b, i/ii, 1/2)."""
    key = re.sub(r"[^a-z0-9]", "", (label or "").lower())
    if not key:
        return None
    for i, printed in enumerate(option_labels):
        if printed and re.sub(r"[^a-z0-9]", "", printed.lower()) == key:
            return i
    if key in _ROMAN:
        return _ROMAN[key] - 1
    if key.isdigit():
        return int(key) - 1
    if len(key) == 1 and key.isalpha():
        return ord(key) - ord("a")
    return None


def apply_answer_key(questions: List[Dict[str, Any]], key: Dict[str, Any]) -> int:
    """Fill correct_options / ans from the printed key where the question has
    none. Returns how many questions were keyed."""
    keyed = 0
    for q in questions:
        entry = key.get(str(q.get("question_number") or "").strip())
        if not entry:
            continue
        qtype = str(q.get("question_type") or "").upper()
        options = q.get("options") or []
        if qtype in ("MCQS", "MCQM", "TRUE_FALSE") and options:
            if q.get("correct_options"):
                continue
            labels = [str(o.get("option_label") or "") for o in options]
            chosen: List[str] = []
            for lab in entry.get("options") or []:
                idx = _label_to_index(str(lab), labels)
                if idx is not None and 0 <= idx < len(options):
                    chosen.append(str(options[idx].get("preview_id") or idx + 1))
            if chosen:
                q["correct_options"] = list(dict.fromkeys(chosen))
                keyed += 1
                if entry.get("exp") and not q.get("exp"):
                    q["exp"] = entry["exp"]
        else:
            if q.get("ans"):
                continue
            ans = entry.get("ans") or " / ".join(str(x) for x in (entry.get("options") or []))
            if ans:
                q["ans"] = ans
                keyed += 1
                if entry.get("exp") and not q.get("exp"):
                    q["exp"] = entry["exp"]
    return keyed


_LEADING_NO = re.compile(
    r"^(\s*(?:<p>|<div>)?\s*)(?:q(?:uestion)?\.?\s*)?\(?(\d{1,3})\)?\s*[\.\):\-–]\s*", re.I
)


def strip_question_number(q: Dict[str, Any]) -> None:
    """"Q1. What is…" → "What is…", but only when the number IS the question's
    own number: "2024 is divisible by…" keeps its 2024."""
    content = (q.get("question") or {}).get("content")
    if not isinstance(content, str):
        return
    m = _LEADING_NO.match(content)
    if m and m.group(2) == str(q.get("question_number") or "").strip():
        q["question"]["content"] = m.group(1) + content[m.end():]


# MathPix writes markdown, which escapes "%" and "&" in prose ("12.5\%",
# "KV Mysore \&amp;"). Only math reads the escape; outside $…$ the learner
# would see the backslash.
_MATH_SPAN = re.compile(r"\$\$.*?\$\$|\$[^$]*\$|\\\(.*?\\\)|\\\[.*?\\\]", re.S)
_PROSE_ESCAPE = re.compile(r"\\(%|&)")


def unescape_prose(html: Any) -> Any:
    """"12.5\\% increase" → "12.5% increase"; math spans are left as written."""
    if not isinstance(html, str) or "\\" not in html:
        return html
    text = html.replace("\\$", "\x00")  # an escaped dollar opens no math
    out: List[str] = []
    pos = 0
    for m in _MATH_SPAN.finditer(text):
        out.append(_PROSE_ESCAPE.sub(r"\1", text[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(_PROSE_ESCAPE.sub(r"\1", text[pos:]))
    return "".join(out).replace("\x00", "\\$")


def unescape_question_prose(q: Dict[str, Any]) -> None:
    holders = [q.get("question"), *(q.get("options") or [])]
    for holder in holders:
        if isinstance(holder, dict) and "content" in holder:
            holder["content"] = unescape_prose(holder["content"])
    for field in ("exp", "passage"):
        if field in q:
            q[field] = unescape_prose(q[field])


def expand_passages(part: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The model writes each shared passage ONCE ("passages": {"P1": html})
    and points at it from the questions ("passage_id"); put the html back on
    every question so the rest of the pipeline sees the old shape."""
    passages = part.get("passages") if isinstance(part.get("passages"), dict) else {}
    out: List[Dict[str, Any]] = []
    for q in part.get("questions") or []:
        if not isinstance(q, dict):
            continue
        pid = q.get("passage_id")
        if pid and not q.get("passage"):
            q["passage"] = passages.get(str(pid)) or None
        q.pop("passage_id", None)
        out.append(q)
    return out


def merge_questions(parts: Sequence[Sequence[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Concatenate part results in order. A question number read twice ACROSS
    a part boundary (the last of one part and the first of the next — the
    same question seen from both sides) keeps the fuller reading; the same
    number appearing again elsewhere is a paper that restarts numbering in
    every section, and both questions are kept."""
    out: List[Dict[str, Any]] = []

    def fullness(q: Dict[str, Any]) -> int:
        return len(str((q.get("question") or {}).get("content") or "")) + 50 * len(q.get("options") or [])

    for part in parts:
        first_in_part = True
        for q in part or []:
            if not isinstance(q, dict) or not (q.get("question") or {}).get("content"):
                continue
            no = str(q.get("question_number") or "").strip()
            if first_in_part and no and out and str(out[-1].get("question_number") or "").strip() == no:
                if fullness(q) > fullness(out[-1]):
                    out[-1] = q
                first_in_part = False
                continue
            first_in_part = False
            out.append(q)
    # Sequential preview ids, whatever the model wrote; no "Q7." in the text.
    for q in out:
        for i, opt in enumerate(q.get("options") or [], start=1):
            if isinstance(opt, dict):
                opt["preview_id"] = str(i)
        strip_question_number(q)
    return out


_OPTION_MARK = re.compile(r"(?:(?<=\s)|^)\(?([a-dA-D])[\)\.]\s+")


def repair_missing_options(questions: List[Dict[str, Any]], body_blocks: Sequence[str]) -> int:
    """A question the model returned WITHOUT options although the paper
    prints "(a) 10 (b) 12 (c) 14 (d) 100" right under it (read as NUMERIC
    because the options are numbers): take the options from the paper's own
    text and make it the MCQS it is. Returns how many were repaired."""
    starts = question_starts(body_blocks)
    idx = [i for i, st in enumerate(starts) if st]
    span: Dict[str, Tuple[int, int]] = {}
    for k, i in enumerate(idx):
        no = _question_no(body_blocks[i])
        if no and no not in span:
            span[no] = (i, idx[k + 1] if k + 1 < len(idx) else len(body_blocks))
    repaired = 0
    for q in questions:
        if q.get("options") or str(q.get("question_type") or "").upper() == "TRUE_FALSE":
            continue
        no = str(q.get("question_number") or "").strip()
        if no not in span:
            continue
        i, j = span[no]
        text = " ".join(_text_of(b) for b in body_blocks[i:j])
        marks = list(_OPTION_MARK.finditer(text))
        if len(marks) < 2:
            continue
        labels = [m.group(1) for m in marks]
        # Options are printed in order; a run that is not a/b/c… is a list
        # inside the question, not its options.
        if [l.lower() for l in labels] != [chr(97 + k) for k in range(len(labels))]:
            continue
        options = []
        for k, m in enumerate(marks):
            end = marks[k + 1].start() if k + 1 < len(marks) else len(text)
            content = text[m.end():end].strip(" ,;")
            if content:
                options.append({"type": "HTML", "preview_id": str(k + 1), "option_label": labels[k],
                                "content": content})
        if len(options) >= 2:
            q["options"] = options
            q["question_type"] = "MCQM" if q.get("question_type") == "MCQM" else "MCQS"
            q["repaired_options"] = True
            repaired += 1
    return repaired


def merge_keys(parts: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Key read from several parts of the solutions: the first part to name an
    option wins, the longest printed explanation wins."""
    out: Dict[str, Any] = {}
    for part in parts:
        for no, entry in (part or {}).items():
            if not isinstance(entry, dict):
                continue
            cur = out.setdefault(str(no).strip(), {"options": [], "ans": "", "exp": ""})
            if not cur["options"] and entry.get("options"):
                cur["options"] = [str(x) for x in entry["options"] if str(x).strip()]
            if not cur["ans"] and entry.get("ans"):
                cur["ans"] = str(entry["ans"])
            if len(str(entry.get("exp") or "")) > len(cur["exp"]):
                cur["exp"] = str(entry["exp"])
    return out


def _paper_meta(first: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": first.get("title"),
        "tags": first.get("tags"),
        "subjects": first.get("subjects"),
        "classes": first.get("classes"),
        "difficulty": first.get("difficulty"),
    }


# ---------------------------------------------------------------------------
# The pipeline
# ---------------------------------------------------------------------------

TOOL_KEY = "extract_questions"
OCR_TOOL_KEY = "extract_questions_ocr"


def _charge(
    *, usages: Sequence[Tuple[str, Dict[str, int]]], num_questions: int, ocr_pages: int,
    institute_id: Optional[str], user_id: Optional[str], billing_ref: Optional[str],
) -> None:
    """One parametric charge for the whole paper — max(1 + 0.15/question, the
    real token cost of every call) — plus, only when the file had no text
    layer and went through MathPix, 0.5/page for the OCR. Both keyed on the
    task so a retried worker cannot bill twice. Best effort: the questions
    already exist."""
    if not institute_id or not usages:
        return
    model = usages[-1][0]
    ai_billing.record_tool_billing(
        tool_key=TOOL_KEY,
        tool_params={"num_questions": num_questions},
        request_type=RequestType.PDF_QUESTIONS,
        model=model,
        prompt_tokens=sum(int(u.get("prompt_tokens") or 0) for _m, u in usages),
        completion_tokens=sum(int(u.get("completion_tokens") or 0) for _m, u in usages),
        institute_id=institute_id,
        user_id=user_id,
        user_role="ADMIN" if user_id else None,
        request_id=billing_ref,
        idempotency_key=f"{TOOL_KEY}:{billing_ref}" if billing_ref else None,
        # Usage-event attribution only (the ledger role above is unchanged).
        use_case="questions",
        metering=metering_user(user_id, surface="ADMIN_APP"),
        usage_context={"billing_ref": billing_ref, "num_questions": num_questions},
    )
    if ocr_pages > 0:
        ai_billing.record_tool_billing(
            tool_key=OCR_TOOL_KEY,
            tool_params={"num_pages": ocr_pages},
            request_type=RequestType.PDF_QUESTIONS,
            model=model,
            institute_id=institute_id,
            user_id=user_id,
            user_role="ADMIN" if user_id else None,
            request_id=billing_ref,
            idempotency_key=f"{OCR_TOOL_KEY}:{billing_ref}" if billing_ref else None,
            use_case="questions",
            metering=metering_user(user_id, surface="ADMIN_APP"),
            usage_context={"billing_ref": billing_ref, "ocr_pages": ocr_pages},
        )


def _estimated_credits(num_questions: int, ocr_pages: int, institute_id: Optional[str]) -> Optional[float]:
    """What the charge comes to at the list price, for the preview."""
    try:
        from ..db import db_session
        from .tool_cost_estimator import ToolCostEstimator
        with db_session() as db:
            est = ToolCostEstimator(db)
            total = float(est.estimate(TOOL_KEY, {"num_questions": num_questions})["estimated_credits"] or 0)
            if ocr_pages > 0:
                total += float(est.estimate(OCR_TOOL_KEY, {"num_pages": ocr_pages})["estimated_credits"] or 0)
        return total
    except Exception:  # noqa: BLE001
        return None


async def extract_from_html(
    *,
    html: str,
    models: List[str],
    user_notes: Optional[str] = None,
    institute_id: Optional[str] = None,
    user_id: Optional[str] = None,
    billing_ref: Optional[str] = None,
    ocr_pages: int = 0,
    section_mode: Optional[str] = None,
) -> str:
    """The paper's questions as RAW question JSON (a string), key and printed
    solutions applied, the credit charge recorded (`ocr_pages` > 0 adds the
    MathPix surcharge for a scanned file).

    Each question carries its section and its marks as the paper prints them
    (paper_outline). `section_mode` is the teacher's answer to "one section
    per paper section, or everything in one?" — "split" / "single"; recorded
    in the summary for the preview, which builds the assessment accordingly.
    Unasked (a scanned file, whose sections are unknown at upload) a paper
    with sections is split."""
    from .paper_outline import apply_outline, outline_of_blocks

    protector = HtmlTagProtector()
    protected = protector.protect(html or "")
    blocks = split_blocks(protected)
    key_at = find_answer_key(blocks)
    body_blocks = blocks[:key_at] if key_at is not None else blocks
    # The solutions section is read in parts too, so a paper whose worked
    # solutions run for forty pages still yields every printed explanation.
    key_parts = chunk_blocks(blocks[key_at:])[:MAX_KEY_PARTS] if key_at is not None else []
    parts = chunk_blocks(body_blocks)
    logger.info(
        "extract-questions: %d blocks → %d part(s); answer key %s (%d part(s))",
        len(blocks), len(parts), f"from block {key_at}" if key_at is not None else "not found",
        len(key_parts),
    )

    semaphore = asyncio.Semaphore(PARALLEL_PARTS)
    usages: List[Tuple[str, Dict[str, int]]] = []

    async def read_part(index: int, part: str) -> Dict[str, Any]:
        prompt = prompts.build_extract_prompt(
            part, index=index + 1, total=len(parts), user_notes=user_notes or "",
        )
        async with semaphore:
            sanitized, model, usage = await llm_json.generate_json(
                prompt, models, label=f"extract-questions[{index + 1}/{len(parts)}]"
            )
        usages.append((model, usage))
        try:
            data = json.loads(sanitized)
        except Exception:  # noqa: BLE001
            data = {}
        return data if isinstance(data, dict) else {}

    async def read_key(index: int, part: str) -> Dict[str, Any]:
        prompt = prompts.build_key_prompt(part, index=index + 1, total=len(key_parts))
        async with semaphore:
            sanitized, model, usage = await llm_json.generate_json(
                prompt, models, label=f"extract-questions[key {index + 1}/{len(key_parts)}]"
            )
        usages.append((model, usage))
        try:
            data = json.loads(sanitized)
        except Exception:  # noqa: BLE001
            return {}
        answers = data.get("answers") if isinstance(data, dict) else None
        return {str(k).strip(): v for k, v in (answers or {}).items() if isinstance(v, dict)}

    part_results = list(await asyncio.gather(*(read_part(i, p) for i, p in enumerate(parts))))
    questions = merge_questions([expand_passages(r) for r in part_results])
    repaired = repair_missing_options(questions, body_blocks)

    # The key and the printed solutions, free: cut at the numbers the paper
    # itself prints. The model reads the key section only when that leaves
    # most questions unanswered (an unnumbered or oddly laid-out key).
    key: Dict[str, Any] = {}
    key_source = "none"
    keyed = 0
    q_runs = numbering_runs(questions)
    if key_at is not None:
        key_regions = split_key_region(blocks[key_at:]) if len(q_runs) >= 2 else []
        part_keys: List[Dict[str, Any]] = []
        if key_regions and len(key_regions) % len(q_runs) == 0:
            # The paper numbers each section from 1 and so does its key
            # (and its solutions, when printed as a second list): each
            # section's answers go to that section's questions, not to
            # whichever Q1 comes first. Regions cycle through the sections.
            part_keys = [
                merge_keys([
                    read_key_region(region, min_hits=max(3, min(8, len(run) // 2)))[0]
                    for region in key_regions[k::len(q_runs)]
                ])
                for k, run in enumerate(q_runs)
            ]
            covered = sum(
                1 for part, run in zip(part_keys, q_runs) for i in run
                if part.get(str(questions[i].get("question_number") or "").strip(), {}).get("options")
            )
            # Only when the split key really reads the paper; otherwise the
            # whole-key path below, with its model fallback, as before.
            if covered < 0.7 * len(questions):
                part_keys = []
        if part_keys:
            for part, run in zip(part_keys, q_runs):
                keyed += apply_answer_key([questions[i] for i in run], part)
                key.update(part)
            key_source = "regex"
        else:
            key, _explained = read_key_region(
                blocks[key_at:], min_hits=max(3, min(8, len(questions) // 2)),
            )
            key_source = "regex"
            covered = sum(1 for q in questions if key.get(str(q.get("question_number") or "").strip(), {}).get("options"))
            if questions and covered < 0.7 * len(questions) and key_parts:
                model_key = merge_keys(await asyncio.gather(*(read_key(i, p) for i, p in enumerate(key_parts))))
                for no, entry in model_key.items():
                    cur = key.setdefault(no, {"options": [], "ans": "", "exp": ""})
                    cur["options"] = cur["options"] or entry.get("options") or []
                    cur["ans"] = cur["ans"] or entry.get("ans") or ""
                    cur["exp"] = cur["exp"] or entry.get("exp") or ""
                key_source = "regex+model"
            keyed = apply_answer_key(questions, key)
    # The key names an option letter but the question came back without
    # options: the model dropped them (it read "c is … (a) 10 (b) 12" as
    # numeric). Flag it — the teacher must fix that question before use.
    suspect = [
        str(q.get("question_number"))
        for q in questions
        if not (q.get("options") or [])
        and re.fullmatch(r"\(?[A-Da-d]\)?|i{1,3}|iv", str(q.get("ans") or "").strip() or "-")
    ]
    meta = _paper_meta(next((r for r in part_results if r.get("title")), part_results[0] if part_results else {}))
    # Sections and marks as printed — the model's per-question reading of
    # "[2]" wins, then the section's instructions, then the paper's scheme.
    outline = outline_of_blocks(blocks, key_at)
    apply_outline(questions, outline)
    for q in questions:
        unescape_question_prose(q)
    sections = outline["sections"]
    mode = (section_mode or "").strip().lower()
    if mode not in ("split", "single"):
        mode = "split" if len(sections) >= 2 else "single"

    await asyncio.to_thread(
        _charge, usages=usages, num_questions=len(questions), ocr_pages=ocr_pages,
        institute_id=institute_id, user_id=user_id, billing_ref=billing_ref,
    )
    credits = await asyncio.to_thread(_estimated_credits, len(questions), ocr_pages, institute_id)

    out = {
        **meta,
        "questions": questions,
        "extraction": {
            "parts": len(parts),
            "key_parts": len(key_parts),
            "questions": len(questions),
            "key_found": bool(key),
            "key_source": key_source,
            "keyed": keyed,
            "unkeyed": sum(
                1 for q in questions
                if not q.get("correct_options") and not q.get("ans")
            ),
            "explained": sum(1 for q in questions if q.get("exp")),
            "check": suspect,
            "repaired_options": repaired,
            "sections": [
                {"name": sec["name"], "count": sec["count"], "from": sec["from"], "to": sec["to"],
                 "marks": sec["marks"], "negative_marks": sec["negative_marks"],
                 "instruction": sec["instruction"], "duration_minutes": sec["duration_minutes"]}
                for sec in sections
            ],
            "section_mode": mode,
            "marking": outline["marking"],
            "duration_minutes": outline["duration_minutes"],
            "credits": credits,
            "ocr_pages": ocr_pages,
            "prompt_tokens": sum(int(u.get("prompt_tokens") or 0) for _m, u in usages),
            "completion_tokens": sum(int(u.get("completion_tokens") or 0) for _m, u in usages),
        },
    }
    logger.info("extract-questions: %d questions, key %s, %d keyed, %d explained, %d section(s) [%s], marking %s",
                len(questions), "found" if key else "absent", keyed, out["extraction"]["explained"],
                len(sections), mode, outline["marking"])
    return protector.restore_in_json(json.dumps(out, ensure_ascii=False))


__all__ = [
    "TOOL_KEY", "OCR_TOOL_KEY", "extract_from_html", "split_blocks", "find_answer_key", "chunk_blocks",
    "merge_questions", "merge_keys", "apply_answer_key", "strip_question_number",
    "read_key_region", "expand_passages", "question_starts", "question_runs", "repair_missing_options",
    "numbering_runs", "split_key_region",
]
