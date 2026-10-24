"""LLM JSON validation + marks cap + annotation target resolution.

Three jobs:
  1. Coerce loose LLM output into the QuestionVerdict shape (with safe defaults).
  2. Cap marks_awarded to question.max_marks and proportionally scale the
     criteria_breakdown so the sum still equals marks_awarded.
  3. Resolve every annotation to a real row: by `target` line_id/region_id
     when that exists, else by matching the verbatim `anchor_text` the model
     quoted from the student's writing. Only an annotation that matches
     nothing at all is dropped — a mark placed a row off is a teacher being
     untidy, a mark silently discarded is a page that comes back unmarked.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)


VALID_STYLES = {"tick", "cross", "circle", "strike", "underline", "margin_note",
                "region_note", "brace", "summary",
                # the marking vocabulary the current guide asks for
                "score", "feedback", "deduction_reason",
                # the copy's grand total, emitted by enforce.py, drawn once on page 1
                "total"}
# Styles that are really a teacher's written comment. They differ in intent -
# praise vs the reason a mark was lost - but they are drawn the same way, and
# keeping them distinct upstream lets the placer give a deduction priority over
# praise when space is short.
NOTE_STYLES = {"margin_note", "region_note", "feedback", "deduction_reason"}
# Styles that carry a mark figure of their own. A brace shows what a block of
# the answer earned; a summary carries the question total at the foot of it.
MARK_BEARING_STYLES = {"brace", "summary", "score"}

# What a model means when it writes a word where a number was asked for.
# "confidence": "low" reached float() and failed the whole question - the
# student got 0 and a "needs your review" card for a field that only decides
# whether the copy is escalated to a stronger model.
WORD_CONFIDENCE = {
    "none": 0.0, "very low": 0.2, "low": 0.3, "lowish": 0.4, "medium": 0.6,
    "moderate": 0.6, "med": 0.6, "mid": 0.6, "fair": 0.6, "high": 0.9,
    "very high": 0.95, "certain": 1.0, "sure": 0.9, "unsure": 0.3,
}
_NUMBER_RE = re.compile(r"-?\d+(?:[.,]\d+)?")


def coerce_number(
    value: Any,
    default: float = 0.0,
    *,
    words: dict[str, float] | None = None,
    percent_of: float | None = None,
) -> float:
    """A float out of whatever the model put in a numeric field.

    Handles the shapes seen in real output: "2", "2.5", "1,5", "2/3" (the
    figure awarded, not the fraction), "2 marks", "0.5 mark", "85%" (with
    `percent_of`), words such as "low"/"high" (with `words`), a one-item
    list, or a dict carrying a `value`/`marks`/`score`. Anything else - None,
    booleans, "N/A", prose without a digit - is `default`. Never raises: a
    cosmetic field must not zero a question.
    """
    if value is None or isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        f = float(value)
        return f if f == f and f not in (float("inf"), float("-inf")) else default
    if isinstance(value, dict):
        for key in ("value", "marks", "score", "marks_awarded", "confidence"):
            if key in value:
                return coerce_number(value[key], default, words=words, percent_of=percent_of)
        return default
    if isinstance(value, (list, tuple)):
        return coerce_number(value[0], default, words=words, percent_of=percent_of) if value else default
    text = str(value).strip().lower()
    if not text:
        return default
    if words and text in words:
        return words[text]
    m = _NUMBER_RE.search(text)
    if not m:
        return default
    try:
        f = float(m.group(0).replace(",", "."))
    except ValueError:
        return default
    if percent_of is not None and "%" in text:
        f = f / 100.0 * percent_of
    return f


def coerce_confidence(value: Any) -> float:
    """Confidence in [0, 1]; "high", "85%" and "85" all read as intended."""
    c = coerce_number(value, 0.0, words=WORD_CONFIDENCE, percent_of=1.0)
    if 1.0 < c <= 100.0:
        c = c / 100.0          # "85" written as a percentage without the sign
    return max(0.0, min(1.0, c))
# Where a mark sits relative to the row it is anchored to. The model states
# this instead of the renderer inferring it, so a score lands in the margin
# beside the last line of an answer rather than wherever there happened to be
# room. Anything unrecognised falls back to the renderer's own choice.
VALID_POSITIONS = {"right_of_line", "left_margin_same_line", "right_margin_same_line",
                   "under_text", "below_line_left", "end_of_answer",
                   # the marking guide's current names for the same six places
                   "right_of_anchor", "right_margin", "left_margin",
                   "below_anchor", "under_anchor", "below_line", "under_word"}
# The guide has used two vocabularies for placement. Normalise to one so the
# renderer has a single set to switch on, and a copy graded under the older
# guide still places its marks.
_POSITION_ALIASES = {
    "right_of_anchor": "right_of_line",
    "right_margin": "right_margin_same_line",
    "left_margin": "left_margin_same_line",
    "below_anchor": "below_line_left",
    "under_anchor": "under_text",
    "below_line": "below_line_left",
    "under_word": "under_text",
}


def _layout_target_index(layout_map: dict[str, Any]) -> dict[str, str]:
    """{target_id: page_id} for every line and region. Used to drop fictitious annotations."""
    idx: dict[str, str] = {}
    for page in layout_map.get("pages", []):
        page_id = page["page_id"]
        for line in page.get("lines", []):
            idx[line["line_id"]] = page_id
        for region in page.get("regions", []):
            idx[region["region_id"]] = page_id
    return idx


_MARK_IN_TEXT = re.compile(r"[\s(\[]*\b(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\b[\s)\]]*\.?\s*$")


def _strip_mark_from_note(text: Any, max_marks: float = 0.0) -> Any:
    """Take a mark figure out of a written comment.

    The score is its own annotation, drawn from the mark this module has
    already capped, quantised to halves and reconciled. A figure the model
    writes INSIDE a note goes through none of that: one copy came back
    carrying "Nature not stated: real & inverted. 2.25/3" against a recorded
    2.0/3.0 - a quarter mark no examiner writes, contradicting the grade the
    student is actually given, and printed a second time beside the score.
    """
    if not isinstance(text, str):
        return text
    # Only a figure OUT OF this question's marks is a mark. A fraction that
    # is the answer - "final answer should be 7/30" - ends a note too, and
    # stripping it printed "final answer should be" on a real maths copy.
    m = _MARK_IN_TEXT.search(text)
    if not m or not max_marks or abs(float(m.group(2)) - float(max_marks)) > 1e-6 \
            or float(m.group(1)) > float(max_marks):
        return text
    cleaned = text[:m.start()].rstrip(" ,;:-")
    # Never return an empty note: if the figure was the whole remark, the
    # score annotation will carry it and the note has nothing left to say.
    return cleaned if cleaned else None


def _norm(text: Any) -> str:
    """Lowercase, strip punctuation, collapse whitespace - for anchor matching."""
    s = str(text or "").lower()
    return " ".join("".join(c if c.isalnum() or c.isspace() else " " for c in s).split())


def _layout_geom_index(layout_map: dict[str, Any]) -> list[tuple[str, str, float, float]]:
    """[(line_id, page_id, cx, cy)] with centres normalised 0-1 per page."""
    out: list[tuple[str, str, float, float]] = []
    for page in layout_map.get("pages", []):
        page_id = page["page_id"]
        try:
            pw = float(page.get("width") or 0) or None
            ph = float(page.get("height") or 0) or None
        except (TypeError, ValueError):
            pw = ph = None
        if not pw or not ph:
            continue
        for line in page.get("lines", []):
            b = line.get("box")
            if not isinstance(b, (list, tuple)) or len(b) != 4:
                continue
            try:
                cx = (float(b[0]) + float(b[2]) / 2.0) / pw
                cy = (float(b[1]) + float(b[3]) / 2.0) / ph
            except (TypeError, ValueError):
                continue
            out.append((line["line_id"], page_id, cx, cy))
    return out


def _bbox_centre(bbox: Any) -> tuple[float, float] | None:
    """Centre of a normalised [x_min, y_min, x_max, y_max], if it is usable."""
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
        return None
    try:
        x0, y0, x1, y1 = (float(v) for v in bbox)
    except (TypeError, ValueError):
        return None
    # The guide asks for 0-1. A model that answers in pixels would otherwise
    # place every mark in the top-left corner of the page.
    if not all(-0.01 <= v <= 1.01 for v in (x0, y0, x1, y1)):
        return None
    if x1 < x0 or y1 < y0:
        return None
    return (x0 + x1) / 2.0, (y0 + y1) / 2.0


def _layout_text_index(layout_map: dict[str, Any]) -> list[tuple[str, str, str]]:
    """[(line_id, page_id, normalised_text)] for every line that has text."""
    out: list[tuple[str, str, str]] = []
    for page in layout_map.get("pages", []):
        page_id = page["page_id"]
        for line in page.get("lines", []):
            norm = _norm(line.get("text"))
            if norm:
                out.append((line["line_id"], page_id, norm))
    return out


def _resolve_target(target: Any, anchor_text: Any, page_hint: Any,
                    idx: dict[str, str],
                    text_idx: list[tuple[str, str, str]],
                    bbox: Any = None,
                    geom_idx: list[tuple[str, str, float, float]] | None = None,
                    ) -> tuple[str, str] | None:
    """(line_id, page_id) for an annotation, or None if it truly cannot be placed.

    A line_id that exists wins outright. When it does not - the model invented
    an id, or drifted one row - fall back to the verbatim student text the
    model quoted and find the row that actually carries it. Dropping was the
    old behaviour and it is the worst of the three outcomes: the mark simply
    vanishes and the page comes back blank with no trace in the output that
    anything was meant to be there. A mark one row off is a teacher being
    untidy; a missing mark is a teacher who did not read the answer.
    """
    if target and target in idx:
        return str(target), idx[target]

    anchor = _norm(anchor_text)
    if not anchor or not text_idx:
        return _resolve_by_bbox(bbox, page_hint, geom_idx)

    from difflib import SequenceMatcher

    best: tuple[float, str, str] | None = None
    for line_id, page_id, norm in text_idx:
        # Containment scores full: the model quotes a phrase out of a longer
        # row far more often than it reproduces the whole row.
        if anchor in norm or norm in anchor:
            score = 1.0 if anchor in norm else len(norm) / max(len(anchor), 1)
        else:
            score = SequenceMatcher(None, anchor, norm).ratio()
        if page_hint and page_id == page_hint:
            score += 0.05          # tie-break toward the page the model named
        if best is None or score > best[0]:
            best = (score, line_id, page_id)

    if best and best[0] >= 0.60:
        return best[1], best[2]
    # Nothing read like the quoted words. The geometry the model reported is
    # the last chance to place the mark near the right writing.
    return _resolve_by_bbox(bbox, page_hint, geom_idx)


def _resolve_by_bbox(bbox: Any, page_hint: Any,
                     geom_idx: list[tuple[str, str, float, float]] | None,
                     ) -> tuple[str, str] | None:
    """The transcript row whose centre is nearest the reported box."""
    centre = _bbox_centre(bbox)
    if centre is None or not geom_idx:
        return None
    cx, cy = centre
    best: tuple[float, str, str] | None = None
    for line_id, page_id, lx, ly in geom_idx:
        if page_hint and page_id != page_hint:
            continue
        d = ((lx - cx) ** 2 + (ly - cy) ** 2) ** 0.5
        if best is None or d < best[0]:
            best = (d, line_id, page_id)
    # A quarter of the page away is not "this line" by any reading; placing a
    # mark there would be worse than the model having said nothing.
    if best and best[0] <= 0.25:
        return best[1], best[2]
    return None


def _unwrap_questions(raw: dict[str, Any], question: dict[str, Any]) -> dict[str, Any]:
    """Accept the whole-paper shape as well as the single-question one.

    The marking guide's output block is written for a full copy - a top-level
    `questions` array - while this service grades one question per call. A
    model that follows the guide literally therefore returns its answer wrapped
    in that array, and reading `marks_awarded` off the wrapper finds nothing
    and silently grades the student zero. Take the entry for this question when
    it is there, else the only entry.
    """
    items = raw.get("questions")
    if not isinstance(items, list) or not items:
        return raw
    wanted = str(question.get("paper_label") or question.get("question_id") or "")
    for item in items:
        if not isinstance(item, dict):
            continue
        if wanted and str(item.get("question_id") or "") == wanted:
            return item
    first = items[0]
    return first if isinstance(first, dict) else raw


def validate_and_cap(
    raw: dict[str, Any],
    question: dict[str, Any],
    layout_map: dict[str, Any],
) -> dict[str, Any]:
    raw = _unwrap_questions(raw, question)
    # Do NOT silently grade against a fictitious denominator. This used to
    # default to 10 whenever max_marks was missing, which quietly misgraded
    # every student of a mis-configured question. A question with no valid max
    # is a configuration problem: raise so the orchestrator routes it to manual
    # review instead of releasing a wrong mark.
    try:
        max_marks = float(question.get("max_marks"))
    except (TypeError, ValueError):
        max_marks = 0.0
    if max_marks <= 0:
        raise ValueError(
            f"question {question.get('question_id')} has no valid max_marks "
            f"({question.get('max_marks')!r})"
        )

    marks_awarded = coerce_number(raw.get("marks_awarded"), 0.0)
    breakdown_raw = raw.get("criteria_breakdown") or []
    if isinstance(breakdown_raw, dict):
        # {"Criterion A": 2, "Criterion B": 0.5} - the model flattened the list
        breakdown_raw = [{"criteria_name": k, "marks": v} for k, v in breakdown_raw.items()]
    breakdown: list[dict[str, Any]] = []
    for item in (breakdown_raw if isinstance(breakdown_raw, list) else []):
        if not isinstance(item, dict):
            # A bare string is a reason with no figure; keep it readable.
            breakdown.append({"criteria_name": str(item), "marks": 0.0, "reason": ""})
            continue
        breakdown.append({
            "criteria_name": str(item.get("criteria_name") or item.get("name") or "Criterion"),
            "marks": coerce_number(item.get("marks", item.get("score")), 0.0),
            "reason": str(item.get("reason") or item.get("comment") or ""),
        })

    # Clamp to [0, max]. LLMs occasionally emit negative marks; floor them.
    if marks_awarded < 0:
        logger.warning(
            "Q%s: LLM awarded negative %.2f — flooring to 0",
            question["question_id"], marks_awarded,
        )
        marks_awarded = 0.0
        for it in breakdown:
            it["marks"] = 0.0

    # Cap + proportionally scale breakdown if total exceeds max_marks.
    if marks_awarded > max_marks:
        logger.warning(
            "Q%s: LLM awarded %.2f > max %.2f — scaling down",
            question["question_id"], marks_awarded, max_marks,
        )
        if marks_awarded > 0 and breakdown:
            factor = max_marks / marks_awarded
            for it in breakdown:
                it["marks"] = round(it["marks"] * factor, 2)
        marks_awarded = max_marks
    else:
        # Under max, reconcile a breakdown that doesn't add up to the awarded
        # total so the teacher isn't shown per-criterion marks that contradict
        # the headline mark. marks_awarded stays authoritative (it feeds totals).
        bsum = round(sum(it["marks"] for it in breakdown), 2)
        if breakdown and bsum > 0 and abs(bsum - marks_awarded) > 0.01:
            logger.info(
                "Q%s: breakdown sum %.2f != awarded %.2f — rescaling breakdown",
                question["question_id"], bsum, marks_awarded,
            )
            factor = marks_awarded / bsum
            for it in breakdown:
                it["marks"] = round(it["marks"] * factor, 2)

    # Resolve every annotation to a real row. A bad line_id is rescued by the
    # verbatim student text the model quoted; only an annotation that matches
    # nothing at all is dropped.
    idx = _layout_target_index(layout_map)
    text_idx = _layout_text_index(layout_map)
    geom_idx = _layout_geom_index(layout_map)
    valid_annotations: list[dict[str, Any]] = []
    dropped = 0
    rescued = 0
    annotations_raw = raw.get("annotations") or []
    for ann in (annotations_raw if isinstance(annotations_raw, list) else []):
        if not isinstance(ann, dict):
            dropped += 1
            continue
        target = ann.get("target")
        style = (ann.get("style") or "").strip().lower() if isinstance(ann.get("style"), str) else None
        if style not in VALID_STYLES:
            dropped += 1
            continue
        anchor_text = ann.get("anchor_text")
        anchor_bbox = ann.get("anchor_bbox")
        resolved = _resolve_target(target, anchor_text, ann.get("page_id"), idx,
                                   text_idx, anchor_bbox, geom_idx)
        if not resolved:
            dropped += 1
            continue
        line_id, page_id = resolved
        if line_id != target:
            rescued += 1
        # The guide has called this field both `placement` and `position`.
        position = ann.get("placement") or ann.get("position")
        position = _POSITION_ALIASES.get(position, position)
        entry = {
            "target": line_id,
            "page_id": page_id,
            "style": style,
            "text": (_strip_mark_from_note(ann.get("text"), max_marks)
                     if style in NOTE_STYLES else ann.get("text")),
            "anchor_text": anchor_text,
            "position": position if position in VALID_POSITIONS else None,
        }
        # A brace spans a block, so it needs its closing row - and it is only
        # meaningful if that row is real and on the same page, at or after the
        # opening one. A brace that runs backwards or off the page would be
        # drawn across unrelated writing.
        if style == "brace":
            end_resolved = _resolve_target(
                ann.get("target_end"), ann.get("anchor_text_end"), page_id, idx, text_idx)
            if not end_resolved or end_resolved[1] != page_id:
                dropped += 1
                continue
            entry["target_end"] = end_resolved[0]
        if style in MARK_BEARING_STYLES:
            figure = coerce_number(ann.get("marks"), float("nan"))
            # A brace or summary with no readable figure is just a note.
            entry["marks"] = None if figure != figure else round(figure, 2)
        valid_annotations.append(entry)
    if rescued:
        logger.info("Q%s: rescued %d annotations via anchor_text (bad line_id)",
                    question["question_id"], rescued)
    if dropped:
        logger.info("Q%s: dropped %d annotations with no matching target", question["question_id"], dropped)

    # Quantise to half marks. No examiner writes 4.4/10 on a script - marks are
    # awarded in halves - and a figure like that is an immediate tell that the
    # paper was machine-marked. Done last, after capping and reconciliation, so
    # the breakdown is scaled against the number actually awarded.
    quantised = round(marks_awarded * 2.0) / 2.0
    quantised = min(quantised, max_marks)
    if breakdown and abs(quantised - marks_awarded) > 0.001 and marks_awarded > 0:
        factor = quantised / marks_awarded
        for it in breakdown:
            it["marks"] = round(it["marks"] * factor, 2)
    marks_awarded = quantised

    # The score written on the page IS the mark. Its text came from the model
    # and went through none of the capping and quantising above: one copy
    # carried "0.4/1" and "0.6/1" beside answers recorded as 0.5 - figures no
    # examiner writes, disagreeing with the mark the student actually gets.
    # Rewrite every score to the reconciled figure.
    def _fmt(v: float) -> str:
        return str(int(v)) if float(v).is_integer() else f"{v:g}"
    for a in valid_annotations:
        if a["style"] == "score":
            a["text"] = f"{_fmt(marks_awarded)}/{_fmt(max_marks)}"
            a["marks"] = marks_awarded

    # The figures written in the margin must reconcile with the total, because
    # that is the whole promise of brace marking: a student adds up the numbers
    # beside each block and gets the mark at the foot of the answer. The model
    # does not reliably manage it (braces summing 4.0 against an awarded 7.0,
    # a summary reading 8.25 under an awarded 8.0), and quantising the total to
    # halves afterwards moves the target again. So reconcile here.
    braces = [a for a in valid_annotations if a["style"] == "brace"
              and a.get("marks") is not None]
    brace_total = sum(a["marks"] for a in braces)
    if braces and brace_total > 0 and abs(brace_total - marks_awarded) > 0.01:
        scale = marks_awarded / brace_total
        for a in braces:
            a["marks"] = round(a["marks"] * scale * 4.0) / 4.0
        # rounding can drift; put any remainder on the largest block
        drift = round(marks_awarded - sum(a["marks"] for a in braces), 2)
        if abs(drift) >= 0.25:
            biggest = max(braces, key=lambda a: a["marks"])
            biggest["marks"] = round(biggest["marks"] + drift, 2)
        logger.info("Q%s: rescaled %d brace marks from %.2f to %.2f",
                    question["question_id"], len(braces), brace_total, marks_awarded)
    for a in valid_annotations:
        if a["style"] == "summary":
            # The circled total IS the mark. It can never disagree with it.
            a["marks"] = round(marks_awarded, 2)

    return {
        "question_id": question["question_id"],
        "marks_awarded": round(marks_awarded, 2),
        "max_marks": max_marks,
        "extracted_answer": str(raw.get("extracted_answer") or ""),
        "feedback": str(raw.get("feedback") or ""),
        "confidence": coerce_confidence(raw.get("confidence")),
        "criteria_breakdown": breakdown,
        "annotations": valid_annotations,
        # What the grader decided about WHERE the answer is and WHAT KIND of
        # attempt it was. enforce.py places the score on answer_rows[-1] and
        # applies the cancelled-attempt rule from verdict; dropping them here
        # left it inferring the last row from the annotations and never
        # seeing a cancellation at all.
        "verdict": (str(raw.get("verdict") or "").strip().lower()
                    if str(raw.get("verdict") or "").strip().lower()
                    in ("correct", "partial", "wrong", "cancelled", "unattempted") else None),
        "student_label": (str(raw.get("student_label")).strip()
                          if raw.get("student_label") else None),
        "answer_rows": [str(r) for r in (raw.get("answer_rows") or [])
                        if r and str(r) in idx][:2] or None,
        # A second attempt at the same question (graded first-in-page-order;
        # the second gets a note) and rows that answer no question in the
        # paper - enforce.py reports both so an incomplete paper is caught.
        "answer_rows_duplicate": [str(r) for r in (raw.get("answer_rows_duplicate") or [])
                                  if r and str(r) in idx][:2] or None,
        "unmapped_rows": [str(r) for r in (raw.get("unmapped_rows") or [])
                          if r and str(r) in idx] or None,
        "status": "COMPLETED",
    }


def _criterion_key(name: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(name or "").lower()).strip()


def attach_criteria_max(verdict: dict[str, Any], rubric: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Give each criteria_breakdown item the `max` of its criterion in the
    rubric the question was graded against (spec 7.8, T1.13).

    Matched by name (case and punctuation ignored). When names do not match
    but the grader returned exactly one item per rubric criterion, items are
    paired in order (the prompt asks for the rubric's order). Anything still
    unmatched gets max None rather than a guess. In place; returns verdict."""
    breakdown = verdict.get("criteria_breakdown") or []
    items = [it for it in (rubric or {}).get("rubric") or [] if isinstance(it, dict)]
    if not breakdown:
        return verdict
    maxima: dict[str, float] = {}
    ordered: list[Optional[float]] = []
    for it in items:
        value = coerce_number(it.get("max_marks"), float("nan"))
        value = None if value != value else round(value, 2)
        ordered.append(value)
        key = _criterion_key(it.get("criteria_name"))
        if key and value is not None and key not in maxima:
            maxima[key] = value
    by_name = [maxima.get(_criterion_key(c.get("criteria_name"))) if isinstance(c, dict) else None
               for c in breakdown]
    positional = len(ordered) == len(breakdown)
    for i, c in enumerate(breakdown):
        if not isinstance(c, dict):
            continue
        value = by_name[i]
        if value is None and positional:
            value = ordered[i]
        c["max"] = value
    return verdict
