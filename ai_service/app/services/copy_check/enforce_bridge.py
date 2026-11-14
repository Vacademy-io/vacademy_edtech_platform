"""Run enforce.py over this pipeline's verdicts, in place.

enforce() takes the grader's outputs as a flat list and returns a flat list of
annotations keyed by `q`; this pipeline carries one verdict dict per question
and renders from each verdict's own `annotations`. The bridge converts on the
way in and writes the enforced annotations back on the way out, so the
orchestrator, the renderer and every test keep the shape they already use.

    verdicts, total, report, unmarked = apply_enforcement(verdicts, layout_map)

Marks: each verdict's `marks_awarded` is set to the mark enforce settled on,
so the question callbacks and the totals carry the figure written on the copy
(spec 7.8, gate G9). With choice groups each verdict also gets `counted`, and
the grand total on the copy adds only the counted questions (T1.36).

Placement names: enforce emits the marking guide's names (right_margin,
below_line, ...); the validator's canonical field is `position` in the older
vocabulary. Both are written so either reader works.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from . import choice_groups as _choice
from .enforce import SHORT_TYPES, _fmt, enforce
from .validator import VALID_POSITIONS, _POSITION_ALIASES

logger = logging.getLogger(__name__)


_LABEL = re.compile(r"^\s*[QqO0]\s*\.?\s*(\d{1,2})\b")
_OPTION = re.compile(r"\(\s*([a-dA-D])\s*\)")


def _mcq_attempts(rows_in_order, paper_num, labels):
    """Every place in the copy where a labelled MCQ attempt sits, in page order.

    An attempt is a row whose label is one of `labels`, with the option letter
    on that row or the next one. Returns [(row_id_of_answer, option)].
    """
    out = []
    for i, (rid, page_id, text) in enumerate(rows_in_order):
        m = _LABEL.match(text)
        if not m or int(m.group(1)) not in labels:
            continue
        cand = [(rid, text)]
        if i + 1 < len(rows_in_order) and rows_in_order[i + 1][1] == page_id:
            cand.append((rows_in_order[i + 1][0], rows_in_order[i + 1][2]))
        for arid, atext in cand:
            after = atext[m.end():] if arid == rid else atext
            if re.search(r"crossed|scribbl|~~", after, re.I):
                break
            om = _OPTION.search(after)
            if om:
                out.append((arid, om.group(1).lower()))
                break
    return out


def first_attempt_mcqs(verdicts, layout_map, meta):
    """Grade MCQs that carry a key deterministically, taking the FIRST attempt.

    A per-question grader cannot honour "if the same question is answered
    twice, grade the first attempt": when the second attempt carries the
    paper's own label it matches by label every time - three from-scratch
    runs graded Sagar's page-5 "(d)" and named (b) as correct while his
    page-1 "(b)" went unclaimed. With the key this is arithmetic: find every
    labelled attempt in page order, grade the first against the key, note
    the rest "Answered twice - first attempt taken." The student's labels may
    be offset from the paper's (physics numbered 1-7 here); the offset is
    read off the sibling questions the grader DID place.
    """
    rows_in_order = []
    for page in layout_map.get("pages") or []:
        for line in page.get("lines") or []:
            rows_in_order.append((str(line.get("line_id")), str(page.get("page_id")),
                                  (line.get("text") or "").strip()))
    by_label = {str(m.get("paper_label")): m for m in meta}
    report = []
    for v in verdicts:
        m = by_label.get(str(v.get("label")))
        key = str((m or {}).get("correct_answer") or v.get("correct_answer") or "").strip().lower()
        qtype = str((m or {}).get("question_type") or v.get("question_type") or "").upper()
        if not key or qtype not in SHORT_TYPES:
            continue
        mp = _LABEL.match(str(v.get("label") or ""))
        if not mp:
            continue
        paper_num = int(mp.group(1))
        # The number the STUDENT wrote for this question: the label the grader
        # was given (the caller maps paper -> student numbering, e.g. a paper
        # whose sections are rotated on the students' copies), plus whatever
        # label the grader itself reported. Never an inferred offset: with
        # rotated sections the offsets {-14, 0, +14} all appear at once, and
        # paper Q1 and paper Q15 would each claim the other's answer.
        labels = set()
        for cand in (v.get("student_number"), v.get("student_label")):
            mc = _LABEL.match(str(cand or ""))
            if mc:
                labels.add(int(mc.group(1)))
        if not labels:
            labels = {paper_num}
        attempts = _mcq_attempts(rows_in_order, paper_num, labels)
        if not attempts:
            continue
        first_row, first_opt = attempts[0]
        mx = float(v.get("max_marks") or 1)
        awarded = mx if first_opt == key else 0.0
        page_of = {rid: pg for rid, pg, _ in rows_in_order}
        text_of = {rid: t for rid, _, t in rows_in_order}
        anns = [
            {"style": "tick" if awarded else "cross", "target": first_row, "page_id": page_of[first_row],
             "anchor_text": text_of[first_row], "placement": "right_of_line", "text": None},
            {"style": "score", "target": first_row, "page_id": page_of[first_row],
             "anchor_text": text_of[first_row], "placement": "right_margin",
             "text": f"{awarded:g}/{mx:g}"},
        ]
        if not awarded:
            anns.append({"style": "margin_note", "target": first_row, "page_id": page_of[first_row],
                         "anchor_text": text_of[first_row], "placement": "below_line",
                         "text": f"Wrong option. Correct: ({key})"})
        for rid, _opt in attempts[1:]:
            anns.append({"style": "margin_note", "target": rid, "page_id": page_of[rid],
                         "anchor_text": text_of[rid], "placement": "below_line",
                         "text": "Answered twice - first attempt taken."})
        changed = (abs(float(v.get("marks_awarded") or 0) - awarded) > 0.01
                   or (v.get("answer_rows") or [None])[-1] != first_row)
        v["marks_awarded"] = awarded
        v["verdict"] = "correct" if awarded else "wrong"
        v["answer_rows"] = [first_row, first_row]
        v["answer_rows_duplicate"] = [attempts[1][0], attempts[-1][0]] if len(attempts) > 1 else None
        v["extracted_answer"] = f"({first_opt})"
        v["annotations"] = anns
        if changed or len(attempts) > 1:
            report.append(f"Q{paper_num}: MCQ graded by key - first attempt {first_row} ({first_opt}) "
                          f"{'=' if awarded else '!='} key ({key}) -> {awarded:g}/{mx:g}"
                          + (f"; {len(attempts)-1} later attempt(s) noted" if len(attempts) > 1 else ""))
    return report


def _question_meta(verdicts: list[dict[str, Any]],
                   questions: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """What enforce needs to know per question. Prefer the caller's list;
    otherwise derive it from the verdicts, treating a 1-mark question as
    short-answer, which is the regime the grading prompt itself uses."""
    if questions:
        out = []
        for q in questions:
            out.append({
                "question_id": q.get("question_id"),
                "paper_label": q.get("paper_label") or q.get("label"),
                "max_marks": q.get("max_marks"),
                "question_type": q.get("question_type"),
                # enforce.py overrides a mis-graded MCQ only when a key exists
                "correct_answer": q.get("correct_answer"),
            })
        return out
    out = []
    for v in verdicts:
        mx = float(v.get("max_marks") or 0)
        out.append({
            "question_id": v.get("question_id"),
            "paper_label": v.get("label") or v.get("paper_label"),
            "max_marks": mx,
            "question_type": v.get("question_type") or ("MCQ" if mx <= 1 else "LONG_ANSWER"),
            "correct_answer": v.get("correct_answer"),
        })
    return out


def _write_back_marks(verdicts: list[dict[str, Any]], awarded: list[float],
                      meta: list[dict[str, Any]], report: list[str]) -> None:
    """Put enforce's mark on each verdict. A FAILED verdict keeps its 0 and
    status; a question with no max in the meta (enforce clamps those to 0) is
    left as graded rather than zeroed. The criteria breakdown is rescaled so
    it still adds up to the mark."""
    max_of: dict[str, float] = {}
    for m in meta:
        try:
            max_of[str(m.get("question_id"))] = float(m.get("max_marks") or 0)
        except (TypeError, ValueError):
            pass
    for v, mark in zip(verdicts, awarded):
        if str(v.get("status") or "").upper() == "FAILED":
            continue
        if max_of.get(str(v.get("question_id")), 0.0) <= 0:
            continue
        try:
            before = float(v.get("marks_awarded") or 0)
            vmax = float(v.get("max_marks") or mark)
        except (TypeError, ValueError):
            continue
        mark = min(float(mark), vmax)
        if abs(before - mark) <= 1e-9:
            continue
        v["marks_awarded"] = round(mark, 2)
        report.append(f"Q{v.get('question_id')}: mark {before:g} -> {mark:g} (as written on the copy)")
        breakdown = [c for c in (v.get("criteria_breakdown") or []) if isinstance(c, dict)]
        bsum = sum(float(c.get("marks") or 0) for c in breakdown)
        if bsum > 0:
            for c in breakdown:
                c["marks"] = round(float(c.get("marks") or 0) * mark / bsum, 2)
        elif len(breakdown) == 1:
            breakdown[0]["marks"] = round(mark, 2)


def apply_enforcement(verdicts: list[dict[str, Any]], layout_map: dict[str, Any],
                      questions: list[dict[str, Any]] | None = None,
                      paper_max: float | None = None,
                      choice_groups: list[Any] | None = None,
                      ) -> tuple[list[dict[str, Any]], dict[str, Any] | None, list[str], list[str]]:
    meta = _question_meta(verdicts, questions)
    results = []
    for v in verdicts:
        r = dict(v)
        r["paper_label"] = v.get("label") or v.get("paper_label") or v.get("question_id")
        results.append(r)

    pre_report = first_attempt_mcqs(verdicts, layout_map, meta)
    results = []
    for v in verdicts:
        r = dict(v)
        r["paper_label"] = v.get("label") or v.get("paper_label") or v.get("question_id")
        results.append(r)
    fixed = enforce(results, layout_map, meta, paper_max=paper_max)
    fixed.report[:0] = pre_report
    _write_back_marks(verdicts, fixed.awarded, meta, fixed.report)
    if choice_groups:
        flags = _choice.counted_flags(verdicts, choice_groups, layout_map)
        for v in verdicts:
            v["counted"] = flags.get(str(v.get("question_id")), True)
        if fixed.total:
            mx_total = (paper_max if paper_max is not None
                        else sum(float(m.get("max_marks") or 0) for m in meta))
            fixed.total["text"] = f"{_fmt(_choice.counted_awarded(verdicts))}/{_fmt(mx_total)}"
        dropped = [str(v.get("question_id")) for v in verdicts if not v.get("counted", True)]
        if dropped:
            fixed.report.append(f"choice groups: not counted {', '.join(dropped)}")

    by_q: dict[str, list[dict[str, Any]]] = {}
    for a in fixed.annotations:
        b = dict(a)
        placement = b.get("placement")
        b["position"] = _POSITION_ALIASES.get(placement, placement) if placement in VALID_POSITIONS else None
        by_q.setdefault(str(b.get("q")), []).append(b)

    for v in verdicts:
        key = str(v.get("label") or v.get("paper_label") or v.get("question_id"))
        v["annotations"] = by_q.get(key, [])
        v["enforced"] = True

    if fixed.total and verdicts:
        t = dict(fixed.total)
        t["position"] = "right_margin_same_line"
        verdicts[0].setdefault("annotations", []).append(t)

    for line in fixed.report:
        logger.info("enforce: %s", line)
    if fixed.unmarked:
        logger.warning("enforce: UNMARKED QUESTIONS %s - shipped without a mark", fixed.unmarked)
    return verdicts, fixed.total, fixed.report, fixed.unmarked
