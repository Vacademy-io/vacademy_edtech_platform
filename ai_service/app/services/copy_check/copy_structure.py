"""Look at the copy's structure before marking it.

Two defects on a real 50-question MCQ copy had one cause: nothing knew what the
copy looks like. A grader asked about question 7 alone took question 6's row
now and then (a right answer scored 0), and the renderer, sizing each mark for
a page of essays, wrote scores taller than the rows, so they were refused from
row to row and landed beside other questions' answers.

So once, before grading, the copy's structure is read:

  * which row(s) hold each objective question's answer, from the numbering the
    student wrote when it is plain, and from one look by the model otherwise;
  * whether each page is a list of one-line answers or written work, which the
    renderer uses to lay marks out row by row (annotator._draw_list_marks).

Only papers with objective questions take this path, and it stays advisory:
anything that goes wrong leaves a copy graded and drawn as before.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

from .option_letter import CHOICE_TYPES, names_another_option, without_printed_letter

logger = logging.getLogger(__name__)

ONE_LINE_LIST = "one_line_list"
MIXED = "mixed"
WRITTEN = "written"
LAYOUTS = (ONE_LINE_LIST, MIXED, WRITTEN)

OBJECTIVE_TYPES = {"MCQ", "MCQS", "MCQM", "TRUE_FALSE", "ONE_WORD", "SHORT_ANSWER", "NUMERIC"}
# Below this the marks have room anyway, and a call would cost more than it saves.
MIN_OBJECTIVE_QUESTIONS = 5
# Numbering is believed only when it covers most of the paper.
MIN_NUMBERED_SHARE = 0.6
# Numbers climbing by at most this are one run (a skipped question or two).
MAX_NUMBER_STEP = 3
# Shorter than this and two numbers in a row are as likely a coincidence.
MIN_RUN = 3
# A page is a list when most of its rows start a numbered answer.
MIN_LIST_ROWS = 8
MIN_LIST_SHARE = 0.5
# Every row of a very long copy would not fit one cheap call; numbering still works.
MAX_PROMPT_CHARS = 40_000
MAX_QUESTION_CHARS = 90
# When more than this share of answers land off the structure's rows, the
# structure is what is wrong: stop steering the grader with it.
MAX_MISS_SHARE = 0.3
MIN_CHECKS_BEFORE_DOUBT = 8
# The look at the copy, and the second asks the misses above can cost.
TOKENS_ALLOWANCE = 30_000

_ROW_NUMBER = re.compile(r"^\s*(?:[Qq](?:ue)?s?\.?\s*)?(\d{1,3})(?=$|[\s).:\-])[\s).:\-]*(.*)$", re.S)

# "Sec:- D" between two answers belongs to neither.
_HEADING = re.compile(r"^\s*(?:q\.?\s*)?(?:sec(?:tion)?|part)\b", re.I)

STRUCTURE_SYSTEM = """You look at a student's handwritten exam copy before a teacher marks it. You do NOT grade.
The attached images show some of its pages, and every row of writing is listed with its id.
For each page say how it is written:
- "one_line_list": a list of short answers, roughly one line each, one after another
- "written": paragraphs or worked answers
- "mixed": both
For each question listed, give the row ids holding the student's answer to it: first and last row, the same
id twice for a one-line answer. Use the numbers the student wrote and the content of the answer. Each row
belongs to one question only. Leave out a question the student did not answer.
Faint writing showing through from the other side of the paper is not on this page; ignore it.
Return STRICT JSON only."""


def enabled() -> bool:
    return os.getenv("COPY_CHECK_STRUCTURE", "1").strip().lower() not in ("0", "false", "off", "no")


def is_objective(question: dict[str, Any]) -> bool:
    return str(question.get("question_type") or "").upper() in OBJECTIVE_TYPES


def _is_choice(question: dict[str, Any]) -> bool:
    return str(question.get("question_type") or "").upper() in CHOICE_TYPES


def _rows(layout_map: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    return [(str(p.get("page_id")), line)
            for p in layout_map.get("pages") or []
            for line in p.get("lines") or []
            if line.get("line_id")]


def _question_number(question: dict[str, Any]) -> Optional[int]:
    label = str(question.get("paper_label") or "").strip() or str(question.get("question_number") or "")
    m = re.fullmatch(r"[Qq]?\.?\s*(\d{1,3})\.?", label)
    return int(m.group(1)) if m else None


def _numbered_starts(layout_map: dict[str, Any]) -> list[tuple[int, int]]:
    """(number, index into _rows) of the rows that start a numbered answer.

    A number counts when it belongs to a run that climbs (7, 8, 9...), since a
    worked answer's "25 cm" looks like a label too. Runs, not one run from 1:
    real copies answer section D before section A, and leave the first dozen
    answers unnumbered. A number in two runs (answered twice, a stray match)
    stays with the longer one.
    """
    found = []
    for i, (_pid, line) in enumerate(_rows(layout_map)):
        if line.get("printed"):
            continue
        m = _ROW_NUMBER.match(str(line.get("text") or ""))
        if m:
            found.append((int(m.group(1)), i))
    runs: list[list[tuple[int, int]]] = []
    current: list[tuple[int, int]] = []
    for k, (n, i) in enumerate(found):
        if not current or current[-1][0] < n <= current[-1][0] + MAX_NUMBER_STEP:
            current.append((n, i))
            continue
        # Not the next number. If the one after it carries on, this one was
        # something in the writing, not a label.
        following = found[k + 1][0] if k + 1 < len(found) else None
        if following is not None and current[-1][0] < following <= current[-1][0] + MAX_NUMBER_STEP:
            continue
        runs.append(current)
        current = [(n, i)]
    if current:
        runs.append(current)
    kept: dict[int, int] = {}
    for run in sorted((r for r in runs if len(r) >= MIN_RUN), key=len, reverse=True):
        for n, i in run:
            kept.setdefault(n, i)
    return sorted(kept.items(), key=lambda t: t[1])


def numbered_answers(questions: list[dict[str, Any]], layout_map: dict[str, Any]) -> dict[str, list[str]]:
    """{question_id: [row ids]} from the student's own numbering, or {} when the
    numbering cannot be trusted for this paper (numbers repeat by section, or it
    does not run through most of the questions)."""
    by_number: dict[int, str] = {}
    choice: set[str] = set()
    for q in questions:
        n = _question_number(q)
        if n is None or n in by_number:
            return {}
        by_number[n] = str(q["question_id"])
        if _is_choice(q):
            choice.add(str(q["question_id"]))
    rows = _rows(layout_map)
    starts = _numbered_starts(layout_map)
    if not rows or not by_number:
        return {}
    if sum(1 for n, _i in starts if n in by_number) < MIN_NUMBERED_SHARE * len(by_number):
        return {}
    out: dict[str, list[str]] = {}
    for k, (n, i) in enumerate(starts):
        qid = by_number.get(n)
        if qid is None:
            continue
        end = starts[k + 1][1] if k + 1 < len(starts) else len(rows)
        # A chosen option stops with its page: the next page's first rows are
        # its header (a roll number) far more often than the end of a one-line answer.
        # A short answer can truly run on, and a row it runs onto is not a miss.
        taken = [str(line["line_id"]) for pid, line in rows[i:end]
                 if (pid == rows[i][0] or qid not in choice) and not line.get("printed")
                 and not _HEADING.match(str(line.get("text") or ""))]
        # A label alone on its row ("Q. 1"): the answer is on what follows.
        m = _ROW_NUMBER.match(str(rows[i][1].get("text") or ""))
        if m and not m.group(2).strip():
            taken = taken[1:]
        if taken:
            out[qid] = taken
    return out


def measured_layouts(layout_map: dict[str, Any]) -> dict[str, str]:
    """Each page's layout from the numbering alone, for a copy the model did not
    look at."""
    rows = _rows(layout_map)
    started = {i for _n, i in _numbered_starts(layout_map)}
    counts: dict[str, list[int]] = {}
    for i, (pid, line) in enumerate(rows):
        if line.get("printed"):
            continue
        slot = counts.setdefault(pid, [0, 0])
        slot[0] += 1
        slot[1] += int(i in started)
    return {pid: (ONE_LINE_LIST if total >= MIN_LIST_ROWS and hits >= MIN_LIST_SHARE * total else WRITTEN)
            for pid, (total, hits) in counts.items()}


def _question_line(index: int, question: dict[str, Any]) -> str:
    text = re.sub(r"\s+", " ", str(question.get("question_text") or "")).strip()[:MAX_QUESTION_CHARS]
    heads = [re.sub(r"\s+", " ", without_printed_letter(o.get("text") if isinstance(o, dict) else o))[:24]
             for o in (question.get("options") or [])[:6]]
    options = f" | options: {'; '.join(heads)}" if heads else ""
    number = question.get("paper_label") or question.get("question_number") or index
    return f"#{index} [printed {number}] {text}{options}"


def build_prompt(questions: list[dict[str, Any]], layout_map: dict[str, Any]) -> str:
    blocks = []
    for page in layout_map.get("pages") or []:
        rows = [f"[{line.get('line_id')}] {str(line.get('text') or '').strip()}"
                for line in page.get("lines") or [] if line.get("line_id") and not line.get("printed")]
        blocks.append(f"---- {page.get('page_id')} ----\n" + "\n".join(rows))
    q_block = "\n".join(_question_line(i + 1, q) for i, q in enumerate(questions))
    page_ids = ", ".join(str(p.get("page_id")) for p in layout_map.get("pages") or [])
    return f"""**The copy's rows:**
{chr(10).join(blocks)}

**The questions:**
{q_block}

Page ids: {page_ids}.

Key each answer by the # number of its question, not the printed one.

Output (STRICT JSON, nothing else):
{{"pages": {{"p1": "one_line_list"}}, "answers": {{"1": ["p1_r4", "p1_r4"], "2": ["p1_r5", "p1_r6"]}}}}"""


def _load_json(content: str) -> dict[str, Any]:
    text = str(content or "").strip()
    text = re.sub(r"^```(json)?\s*\n", "", text, count=1)
    text = re.sub(r"\n?```\s*$", "", text, count=1)
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise
        payload = json.loads(text[start : end + 1])
    return payload if isinstance(payload, dict) else {}


def parse_reply(content: str, questions: list[dict[str, Any]],
                layout_map: dict[str, Any]) -> tuple[dict[str, str], dict[str, list[str]]]:
    """(layouts, answers). Invented rows and pages are dropped; two questions
    claiming one row lose it, since neither claim can be believed."""
    payload = _load_json(content)
    order = [str(line["line_id"]) for _pid, line in _rows(layout_map)]
    index = {rid: i for i, rid in enumerate(order)}
    valid_pages = {str(p.get("page_id")) for p in layout_map.get("pages") or []}

    layouts = {}
    for pid, kind in (payload.get("pages") or {}).items() if isinstance(payload.get("pages"), dict) else []:
        kind = str(kind or "").strip().lower()
        if str(pid) in valid_pages and kind in LAYOUTS:
            layouts[str(pid)] = kind

    answers: dict[str, list[str]] = {}
    raw = payload.get("answers")
    for key, rows in raw.items() if isinstance(raw, dict) else []:
        m = re.search(r"\d+", str(key))
        if not m or not 0 < int(m.group()) <= len(questions) or not isinstance(rows, list) or not rows:
            continue
        first, last = str(rows[0]), str(rows[-1])
        if first not in index or last not in index or index[last] < index[first]:
            continue
        answers[str(questions[int(m.group()) - 1]["question_id"])] = order[index[first] : index[last] + 1]
    owners: dict[str, list[str]] = {}
    for qid, rows in answers.items():
        for rid in rows:
            owners.setdefault(rid, []).append(qid)
    for rid, qids in owners.items():
        if len(qids) > 1:
            for qid in qids:
                answers.pop(qid, None)
    return layouts, answers


async def analyse(llm: Any, questions: list[dict[str, Any]], layout_map: dict[str, Any],
                  images: Optional[dict[str, Any]], model: str,
                  institute_id: Any = None, token_sink: Any = None) -> dict[str, Any]:
    """The copy's structure: {"pages": {page_id: layout}, "answers": {question_id:
    [rows]}, "pinned": [question ids whose rows come from the student's numbering]}.
    {} on a paper this does not apply to. Never raises."""
    try:
        objective = [q for q in questions if is_objective(q)]
        if not enabled() or len(objective) < MIN_OBJECTIVE_QUESTIONS or not layout_map.get("pages"):
            return {}
        numbered = numbered_answers(questions, layout_map)
        layouts: dict[str, str] = {}
        ai_answers: dict[str, list[str]] = {}
        prompt = build_prompt(objective, layout_map)
        if len(prompt) <= MAX_PROMPT_CHARS:
            try:
                from .language_vision import _encode
                attachments = [{"type": "image", "url": f"data:image/jpeg;base64,{_encode(img)}"}
                               for img in (images or {}).values() if img is not None]
                user: dict[str, Any] = {"role": "user", "content": prompt}
                if attachments:
                    user["attachments"] = attachments
                response = await llm.chat_completion(
                    messages=[{"role": "system", "content": STRUCTURE_SYSTEM}, user],
                    temperature=0.0,
                    max_tokens=max(3_000, 60 * len(objective)),
                    institute_id=institute_id,
                    model=model,
                )
                if token_sink is not None:
                    token_sink.add_usage(response.get("usage"))
                layouts, ai_answers = parse_reply(response.get("content") or "", objective, layout_map)
            except Exception:
                logger.warning("Copy structure: the look at the copy failed; using its numbering", exc_info=True)
        measured = measured_layouts(layout_map)
        pages = {str(p.get("page_id")): layouts.get(str(p.get("page_id")))
                 or measured.get(str(p.get("page_id")), WRITTEN)
                 for p in layout_map.get("pages") or []}
        # The student's numbering beats a reading of it wherever it runs.
        wanted = {str(q["question_id"]) for q in objective}
        answers = {**{k: v for k, v in ai_answers.items() if k in wanted},
                   **{k: v for k, v in numbered.items() if k in wanted}}
        # Pinned: a grader's verdict can be moved onto the numbered row only where
        # the row itself can be re-judged against the key, which means a chosen
        # option. A written mark judged from another row cannot just be carried over.
        choice = {str(q["question_id"]) for q in objective if _is_choice(q)}
        structure = {"pages": pages, "answers": answers,
                     "pinned": sorted(k for k in numbered if k in choice)}
        logger.info("Copy structure: %s; %d/%d objective answers placed (%d from the numbering)",
                    pages, len(answers), len(objective), len(structure["pinned"]))
        return structure
    except Exception:
        logger.warning("Copy structure could not be worked out; grading as before", exc_info=True)
        return {}


def marked_rows(verdict: dict[str, Any]) -> set[str]:
    """The rows the grader's own marks and answer_rows point at."""
    rows = {str(a.get("target")) for a in verdict.get("annotations") or []
            if a.get("target") and a.get("style") in ("tick", "cross", "score")}
    rows.update(str(r) for r in verdict.get("answer_rows") or [])
    return rows


def off_target(verdict: dict[str, Any], expected: list[str]) -> Optional[str]:
    """The row the grader marked outside `expected`; "unmarked" when it found
    no answer where the structure says one is; None when it is on target."""
    if not expected:
        return None
    marked = marked_rows(verdict)
    if not marked:
        return "unmarked"
    outside = sorted(marked - set(expected))
    return outside[0] if outside else None


def pin_to_rows(verdict: dict[str, Any], expected: list[str], layout_map: dict[str, Any],
                question: Optional[dict[str, Any]] = None) -> None:
    """Move a verdict the grader twice placed elsewhere onto the row the
    student's numbering names: the answer is what that row says. A mark given
    for another row's answer does not survive the move when this row plainly
    names a different option from the key. Mutates."""
    wanted = set(expected)
    texts, page_of = [], {}
    for pid, line in _rows(layout_map):
        if str(line["line_id"]) in wanted:
            texts.append(str(line.get("text") or "").strip())
            page_of[str(line["line_id"])] = pid
    last = expected[-1]
    verdict["extracted_answer"] = " ".join(t for t in texts if t)
    verdict["answer_rows"] = [expected[0], last]
    for ann in verdict.get("annotations") or []:
        ann["target"] = last
        ann["page_id"] = page_of.get(last, ann.get("page_id"))
        ann["anchor_text"] = texts[-1] if texts else ann.get("anchor_text")
    verdict["confidence"] = min(float(verdict.get("confidence") or 0.0), 0.4)
    verdict["feedback"] = (f"The student wrote: {verdict['extracted_answer']}. Marked from that row; "
                           "please check this one.")
    for item in verdict.get("criteria_breakdown") or []:
        if isinstance(item, dict):
            item["reason"] = "Marked from the row the student numbered for this question."
    if question is not None and float(verdict.get("marks_awarded") or 0) > 0 \
            and names_another_option(verdict["extracted_answer"], question):
        verdict["marks_awarded"] = 0.0
        verdict["verdict"] = "wrong"
        for item in verdict.get("criteria_breakdown") or []:
            if isinstance(item, dict):
                item["marks"] = 0.0
        out_of = verdict.get("max_marks") or question.get("max_marks") or 0
        for ann in verdict.get("annotations") or []:
            if ann.get("style") == "tick":
                ann["style"] = "cross"
            elif ann.get("style") == "score":
                ann["text"] = f"0/{float(out_of):g}"


__all__ = ["analyse", "enabled", "is_objective", "numbered_answers", "measured_layouts", "parse_reply",
           "off_target", "pin_to_rows", "marked_rows", "build_prompt", "ONE_LINE_LIST", "MIXED", "WRITTEN",
           "MAX_MISS_SHARE"]
