"""Why a checked answer needs a teacher to look at it (`review_reasons`).

The copy check reads handwriting by machine, and a misreading can flip a
meaning: "a deadlock that stops the business can be dissolved" came out as
"deadlock is not a ground for dissolution", and a "no" written in the margin
was dropped, so a right answer was marked wrong. Such an answer is sent with
the reasons below. assessment-service stores them with the question's result
(evaluation_result_json) and the review screens show them, so the teacher
checks the handwriting instead of trusting a confident 0.

Reasons come from:
  - the grader's own `unclear_reads`: points it would have cut only on a
    reading it was unsure of (prompt_builder asks for these);
  - marks cut on a page the handwriting reader itself marked as hard to read
    (vision_legible false), which used to be counted for a quality summary
    and then ignored.
"""
from __future__ import annotations

import re
from typing import Any

MAX_REASONS = 5
MAX_REASON_CHARS = 240
MAX_UNCLEAR_READS = 5

_ROW_ID = re.compile(r"\b(p\d+)_r\d+\b")


def unclear_reads(raw: dict[str, Any]) -> list[dict[str, str]]:
    """The grader's `unclear_reads`, cleaned: at most a few entries, each a
    part label, a row id and why the reading is doubtful."""
    out: list[dict[str, str]] = []
    items = raw.get("unclear_reads") if isinstance(raw, dict) else None
    for item in items if isinstance(items, list) else []:
        if isinstance(item, str):
            item = {"why": item}
        if not isinstance(item, dict):
            continue
        why = str(item.get("why") or item.get("reason") or "").strip()
        if not why:
            continue
        out.append({
            "part": str(item.get("part") or "").strip()[:40],
            "row": str(item.get("row") or "").strip()[:40],
            "why": why[:200],
        })
        if len(out) >= MAX_UNCLEAR_READS:
            break
    return out


def add_reason(verdict: dict[str, Any], text: str) -> None:
    text = " ".join(str(text or "").split())[:MAX_REASON_CHARS]
    if not text:
        return
    reasons = verdict.setdefault("review_reasons", [])
    if text not in reasons and len(reasons) < MAX_REASONS:
        reasons.append(text)


def _page_label(page_id: str) -> str:
    m = re.fullmatch(r"p(\d+)", str(page_id))
    return f"page {m.group(1)}" if m else str(page_id)


def _cut_pages(verdict: dict[str, Any]) -> set[str]:
    """Pages the grader cut marks on: rows named in the reason of a rubric
    line that lost marks, and rows a cross or deduction note points at."""
    pages: set[str] = set()
    for item in verdict.get("criteria_breakdown") or []:
        if not isinstance(item, dict):
            continue
        ceiling = item.get("max", item.get("max_marks"))
        try:
            cut = ceiling is not None and float(item.get("marks") or 0) < float(ceiling)
        except (TypeError, ValueError):
            cut = False
        if cut:
            pages.update(_ROW_ID.findall(str(item.get("reason") or "")))
    for ann in verdict.get("annotations") or []:
        if isinstance(ann, dict) and ann.get("style") in ("cross", "margin_note"):
            if ann.get("page_id"):
                pages.add(str(ann["page_id"]))
            m = _ROW_ID.match(str(ann.get("target") or ""))
            if m:
                pages.add(m.group(1))
    return pages


def drop_unsure_crosses(verdict: dict[str, Any]) -> int:
    """A row the grader itself could not read for sure gets no cross: the
    prompt asks for none, and a cross there is the "marked wrong" the teacher
    review exists to avoid. The cut stays in the marks until the teacher
    decides. Also applied when a saved copy is drawn again (re_render), whose
    verdicts may predate this rule. Returns how many crosses were dropped."""
    unsure_rows = {str(r.get("row")) for r in verdict.get("unclear_reads") or []
                   if isinstance(r, dict) and r.get("row")}
    annotations = verdict.get("annotations") or []
    if not unsure_rows or not annotations:
        return 0
    kept = [a for a in annotations
            if not (isinstance(a, dict) and a.get("style") == "cross"
                    and str(a.get("target")) in unsure_rows)]
    verdict["annotations"] = kept
    return len(annotations) - len(kept)


def flag(verdict: dict[str, Any], layout_map: dict[str, Any]) -> list[str]:
    """Add the reasons this answer needs a teacher's look to
    verdict["review_reasons"]; returns them. A FAILED verdict is left alone:
    it is already sent for manual marking."""
    if str(verdict.get("status") or "").upper() == "FAILED":
        return list(verdict.get("review_reasons") or [])
    drop_unsure_crosses(verdict)
    for read in verdict.get("unclear_reads") or []:
        part = f" in {read['part']}" if read.get("part") else ""
        add_reason(verdict, f"Handwriting unclear{part}: {read.get('why')}")
    hard = {str(p.get("page_id")) for p in (layout_map or {}).get("pages") or []
            if isinstance(p, dict) and p.get("vision_legible") is False}
    for page_id in sorted(_cut_pages(verdict) & hard, key=lambda p: (len(p), p)):
        add_reason(verdict, f"Marks were cut on {_page_label(page_id)}, which the handwriting reader "
                            "marked as hard to read - check what the student wrote.")
    return list(verdict.get("review_reasons") or [])
