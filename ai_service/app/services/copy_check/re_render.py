"""Re-draw a checked copy with the teacher's corrections.

The AI's checked copy is a flat PDF. When a teacher changes a question's mark
or remark on the review page, or removes / rewrites a pen note the AI wrote,
the copy the student downloads must say the same thing as the released marks.

The render inputs of every checked copy are saved when it is first drawn
(copy_check_render_snapshot, see orchestrator.run). A re-render loads them,
applies the teacher's corrections and draws the copy again with the same
annotator - same placement, same hand - so only what the teacher changed
differs. The snapshot itself is never modified: assessment_service sends every
current correction each time, which makes a re-render idempotent.
"""
from __future__ import annotations

import copy
import logging
from typing import Any, Optional

from sqlalchemy.orm import Session

from ...repositories import copy_check_render_snapshot_repository as snapshots
from . import annotator
from .choice_groups import counted_awarded
# The words the grading run writes beside an answer a choice group leaves out.
from .orchestrator import NOT_COUNTED_NOTE

logger = logging.getLogger(__name__)


class SnapshotMissing(LookupError):
    """The copy was drawn before render inputs were saved (or never drawn)."""


class SnapshotForbidden(PermissionError):
    """The snapshot belongs to another institute."""


class RenderFailed(RuntimeError):
    """The annotator or the upload failed; the old copy stays as it was."""


def _fmt(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f"{round(float(x), 2):g}"


def _norm(x: Any) -> str:
    return " ".join(str(x or "").split())


def _same_mark(a: dict[str, Any], edit: dict[str, Any]) -> bool:
    """Is annotation `a` the one the teacher's edit names? Matched on the fields
    assessment_service stored it with; an edit naming no field matches nothing."""
    keys = [k for k in ("style", "target", "page_id", "text") if edit.get(k) not in (None, "")]
    if not keys:
        return False
    return all(_norm(a.get(k)) == _norm(edit.get(k)) for k in keys)


def _apply_annotation_edits(annotations: list[Any], edits: list[dict[str, Any]], qid: str) -> list[Any]:
    out = [a for a in annotations]
    for edit in edits:
        idx = next((i for i, a in enumerate(out) if isinstance(a, dict) and _same_mark(a, edit)), None)
        if idx is None and edit.get("text"):
            # The teacher saw the note as first reported; enforcement may have
            # reworded it since. The one note of that kind on that line is it.
            loose = {k: edit.get(k) for k in ("style", "target", "page_id")}
            hits = [i for i, a in enumerate(out) if isinstance(a, dict) and _same_mark(a, loose)]
            idx = hits[0] if len(hits) == 1 else None
        if idx is None:
            logger.info("copy-check re-render: Q%s pen mark not found for edit %s", qid,
                        {k: edit.get(k) for k in ("style", "target", "page_id")})
            continue
        if edit.get("action") == "EDIT" and _norm(edit.get("new_text")):
            out[idx] = dict(out[idx], text=str(edit["new_text"]).strip())
        else:
            out.pop(idx)
    return out




def _apply_counted(verdicts: list[dict[str, Any]], counted: dict[str, bool], api_copy: bool) -> None:
    """Which answers an "any N of M" group counts can change with the teacher's
    marks (the best N win). Take the system's decision and move the "not
    counted" note with it. Partner copies never carry the note."""
    for v in verdicts:
        qid = str(v.get("question_id"))
        if qid in counted:
            v["counted"] = bool(counted[qid])
        anns = [a for a in v.get("annotations") or []
                if not (isinstance(a, dict) and a.get("style") == "margin_note"
                        and a.get("text") == NOT_COUNTED_NOTE)]
        if (not api_copy and not v.get("counted", True)
                and str(v.get("status") or "").upper() != "FAILED"):
            score = next((a for a in anns if isinstance(a, dict) and a.get("style") == "score"), None)
            if score and score.get("target"):
                anns.append({
                    "style": "margin_note", "q": score.get("q"), "target": score["target"],
                    "page_id": score.get("page_id"), "placement": "below_line",
                    "position": "below_line_left", "text": NOT_COUNTED_NOTE,
                    "anchor_text": score.get("anchor_text"),
                })
        v["annotations"] = anns


def apply_overrides(verdicts: list[dict[str, Any]], overrides: list[dict[str, Any]],
                    evaluation_table: Optional[dict[str, Any]],
                    counted: Optional[dict[str, bool]] = None,
                    system_total: Optional[float] = None,
                    api_copy: bool = False) -> tuple[float, float]:
    """Apply the teacher's corrections in place. Returns (total awarded, total max).

    `counted` / `system_total`: what assessment_service stores after the
    corrections; the copy shows those, so it never disagrees with the result."""
    by_q = {str(o.get("question_id")): o for o in overrides or []}
    changed_marks: set[str] = set()
    for v in verdicts:
        qid = str(v.get("question_id"))
        o = by_q.get(qid)
        if not o:
            continue
        if o.get("marks_awarded") is not None:
            mx = float(v.get("max_marks") or 0)
            mark = max(0.0, float(o["marks_awarded"]))
            if mx > 0:
                mark = min(mark, mx)
            if abs(mark - float(v.get("marks_awarded") or 0)) > 1e-9:
                changed_marks.add(qid)
            v["marks_awarded"] = mark
            if str(v.get("status") or "").upper() == "FAILED":
                v["status"] = "COMPLETED"
            v["annotations"] = [
                dict(a, text=f"{_fmt(mark)}/{_fmt(mx)}", marks=mark)
                if isinstance(a, dict) and a.get("style") == "score" else a
                for a in v.get("annotations") or []
            ]
        if o.get("feedback") is not None:
            v["feedback"] = str(o["feedback"])
        edits = o.get("annotation_edits") or []
        if edits:
            v["annotations"] = _apply_annotation_edits(list(v.get("annotations") or []), edits, qid)

    if counted:
        _apply_counted(verdicts, counted, api_copy)
    total = float(system_total) if system_total is not None else counted_awarded(verdicts)
    out_of = sum(float(v.get("max_marks") or 0) for v in verdicts if v.get("counted", True))
    # The circled total: enforcement wrote it against the PAPER's maximum
    # ("27/40"), so keep that maximum and replace only the marks.
    for v in verdicts:
        for a in v.get("annotations") or []:
            if isinstance(a, dict) and a.get("style") == "total" and "/" in str(a.get("text") or ""):
                try:
                    out_of = float(str(a["text"]).split("/", 1)[1])
                except ValueError:
                    pass
                a["text"] = f"{_fmt(total)}/{_fmt(out_of)}"

    if evaluation_table and changed_marks:
        rows = evaluation_table.get("rows") or []
        by_id = {str(v.get("question_id")): v for v in verdicts}
        for r in rows:
            v = by_id.get(str(r.get("question_id")))
            if v is None or str(r.get("question_id")) not in changed_marks:
                continue
            got = float(v.get("marks_awarded") or 0)
            mx = float(r.get("max") or v.get("max_marks") or 0)
            r["obtained"] = round(got, 2)
            r["deducted"] = round(max(0.0, mx - got), 2)
            r["percent"] = round(100.0 * got / mx, 1) if mx else 0.0
        tot = evaluation_table.get("total")
        if isinstance(tot, dict) and rows:
            obtained = round(sum(float(r.get("obtained") or 0) for r in rows), 2)
            tmax = float(tot.get("max") or 0)
            tot["obtained"] = obtained
            tot["percent"] = round(100.0 * obtained / tmax, 1) if tmax else 0.0
    return round(total, 2), round(out_of, 2)


async def re_render(db: Session, *, process_id: str, pdf_url: str, institute_id: Optional[str],
                    attempt_id: Optional[str], overrides: list[dict[str, Any]],
                    pen_style: Optional[dict[str, Any]] = None,
                    comment_placement: Optional[str] = None,
                    counted: Optional[dict[str, bool]] = None,
                    total_marks_awarded: Optional[float] = None) -> dict[str, Any]:
    snap = snapshots.get(db, process_id)
    if snap is None:
        raise SnapshotMissing(process_id)
    if snap.institute_id and institute_id and snap.institute_id != institute_id:
        raise SnapshotForbidden(process_id)
    verdicts = copy.deepcopy(snap.verdicts)
    options = copy.deepcopy(snap.options or {})
    table = options.get("evaluation_table") or None
    total, out_of = apply_overrides(verdicts, overrides, table, counted=counted,
                                    system_total=total_marks_awarded,
                                    api_copy=bool(options.get("api_copy")))

    placement = comment_placement if comment_placement is not None else options.get("comment_placement")
    panel: dict[str, Any] = {}
    if str(placement or "").strip().upper() == "OUTSIDE":
        panel["comment_placement"] = "OUTSIDE"
        panel["question_labels"] = options.get("question_labels") or {}
    if table:
        panel["evaluation_table"] = table
    style = pen_style if pen_style is not None else options.get("pen_style")
    if style:
        panel["pen_style"] = style

    file_id = await annotator.render_and_upload(
        pdf_url, snap.layout_map, verdicts, attempt_id or snap.attempt_id or process_id, **panel,
    )
    if not file_id:
        raise RenderFailed(process_id)
    logger.info("copy-check re-render %s: %d override(s), pen %s -> %s",
                process_id, len(overrides or []), style or "usual", file_id)
    return {"evaluated_file_id": file_id, "total_marks_awarded": total, "total_max_marks": out_of}
