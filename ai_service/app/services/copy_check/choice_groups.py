"""Internal choice on a paper: which questions count (spec 7.2, T1.36).

A grade request may carry
    choice_groups: [{"question_ids": [...], "attempt": n, "policy": "first"|"best"}]
    paper_max:     the paper's maximum
Every question is still graded (and billed); only `attempt` questions of each
group count toward the total. Each question callback says `counted`.

- first: the first `attempt` questions the student attempted, in answer order
  (where the answer sits on the copy). If any attempted member's position is
  unknown (a FAILED question, or answer rows the grader got wrong), the whole
  group falls back to paper order: mixing known and unknown positions would
  push the unknown ones last and drop the answer the student wrote first.
- best:  the `attempt` attempted questions with the highest marks.
If the student attempted fewer than `attempt`, unattempted members fill the
remaining slots (they count as 0), in paper order.

A FAILED question was not marked, so its marks say nothing. It is treated as
attempted, and under `best` it ranks as if it earned its maximum, so the AI
never drops an answer a teacher may still mark highest. assessment_service
recomputes the counted set when a teacher grades it.

Groups referring to questions absent from the request (e.g. typed objective
questions marked in Java) only use the members that are present.
"""
from __future__ import annotations

from typing import Any, Iterable, Optional


def _get(group: Any, key: str, default: Any = None) -> Any:
    if isinstance(group, dict):
        return group.get(key, default)
    return getattr(group, key, default)


def _attempted(v: dict[str, Any]) -> bool:
    if str(v.get("status") or "").upper() == "FAILED":
        return True
    verdict = str(v.get("verdict") or "").strip().lower()
    if verdict in ("unattempted", "cancelled"):
        return False
    try:
        marks = float(v.get("marks_awarded") or 0)
    except (TypeError, ValueError):
        marks = 0.0
    return bool(str(v.get("extracted_answer") or "").strip()) or marks > 0


def row_positions(layout_map: Optional[dict[str, Any]]) -> dict[str, tuple[int, int]]:
    """line_id -> (page order, row order) on the copy."""
    out: dict[str, tuple[int, int]] = {}
    for p_i, page in enumerate((layout_map or {}).get("pages") or []):
        for l_i, line in enumerate(page.get("lines") or []):
            out[str(line.get("line_id"))] = (p_i, l_i)
    return out


def _answer_position(v: dict[str, Any], positions: dict[str, tuple[int, int]]) -> Optional[tuple[int, int]]:
    rows = v.get("answer_rows") or []
    if rows and str(rows[0]) in positions:
        return positions[str(rows[0])]
    return None


def counted_flags(
    verdicts: list[dict[str, Any]],
    groups: Optional[Iterable[Any]],
    layout_map: Optional[dict[str, Any]] = None,
) -> dict[str, bool]:
    """question_id -> counted. Questions in no group are always counted; a
    question in several groups is counted only if every group counts it.
    `verdicts` are in paper order."""
    flags = {str(v.get("question_id")): True for v in verdicts}
    if not groups:
        return flags
    by_id = {str(v.get("question_id")): (i, v) for i, v in enumerate(verdicts)}
    positions = row_positions(layout_map)

    for group in groups:
        try:
            limit = int(_get(group, "attempt") or 0)
        except (TypeError, ValueError):
            continue
        policy = str(_get(group, "policy") or "first").lower()
        members = []
        seen: set[str] = set()
        for qid in _get(group, "question_ids") or []:
            qid = str(qid)
            if qid in by_id and qid not in seen:
                seen.add(qid)
                members.append(by_id[qid])
        if limit <= 0 or len(members) <= limit:
            continue

        attempted = [(i, v) for i, v in members if _attempted(v)]
        unattempted = [(i, v) for i, v in members if not _attempted(v)]
        # Answer order only when every attempted member has a known position;
        # otherwise paper order for all of them (see the module docstring).
        known = {i: _answer_position(v, positions) for i, v in attempted}
        if all(pos is not None for pos in known.values()):
            def order(item: tuple[int, dict[str, Any]]) -> tuple:
                return (known[item[0]], item[0])
        else:
            def order(item: tuple[int, dict[str, Any]]) -> tuple:
                return ((item[0], 0), item[0])
        if policy == "best":
            def rank(item: tuple[int, dict[str, Any]]) -> tuple:
                i, v = item
                failed = str(v.get("status") or "").upper() == "FAILED"
                marks = float(v.get("max_marks") or 0) if failed else float(v.get("marks_awarded") or 0)
                return (-marks, order(item))
            attempted.sort(key=rank)
        else:
            attempted.sort(key=order)
        chosen = attempted[:limit]
        if len(chosen) < limit:
            chosen += unattempted[: limit - len(chosen)]
        chosen_ids = {str(v.get("question_id")) for _, v in chosen}
        for _, v in members:
            qid = str(v.get("question_id"))
            if qid not in chosen_ids:
                flags[qid] = False
    return flags


def resolve_paper_max(
    questions: list[dict[str, Any]],
    groups: Optional[Iterable[Any]],
    paper_max: Optional[float] = None,
) -> Optional[float]:
    """The paper's maximum: the caller's paper_max when given; else, with
    choice groups, ungrouped max + per group the top `attempt` maxima of its
    members present here; else None (callers keep summing every question)."""
    if paper_max is not None:
        return float(paper_max)
    groups = list(groups or [])
    if not groups:
        return None
    max_of = {str(q.get("question_id")): float(q.get("max_marks") or 0) for q in questions}
    grouped: set[str] = set()
    total = 0.0
    for group in groups:
        ids = [str(i) for i in (_get(group, "question_ids") or []) if str(i) in max_of and str(i) not in grouped]
        grouped.update(ids)
        try:
            limit = int(_get(group, "attempt") or 0)
        except (TypeError, ValueError):
            limit = len(ids)
        top = sorted((max_of[i] for i in ids), reverse=True)[: max(limit, 0) or len(ids)]
        total += sum(top)
    total += sum(m for qid, m in max_of.items() if qid not in grouped)
    return total


def counted_awarded(verdicts: list[dict[str, Any]]) -> float:
    """Sum of marks over counted questions (a FAILED question carries 0)."""
    return sum(float(v.get("marks_awarded") or 0) for v in verdicts if v.get("counted", True))
