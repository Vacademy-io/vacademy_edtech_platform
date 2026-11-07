"""enforce.py — makes copy-check behaviour correct regardless of what the model returns.

Run this between the grader and the renderer:

    fixed = enforce(results, layout_map, questions, paper_max=36)
    render(fixed.annotations)          # + fixed.total, fixed.report

A prompt can ask the model for exactly one score per question; it cannot guarantee it.
This module guarantees it. For every graded question it:

  1. Resolves every annotation to a REAL row id. If `target` does not exist, it finds the row
     whose text best matches `anchor_text` (fuzzy). If that fails, the annotation is dropped
     and logged - never drawn "somewhere".
  2. Forces exactly ONE score per attempted/cancelled question: text "x/max", placement
     right_margin, on the LAST row of the answer. Extra scores removed; missing score added.
  3. Forces ONE deduction note if awarded < max (from the model's note, else from
     criteria_breakdown reason, else from feedback). Placement below_line on the last row,
     left_margin only if that row is the last on its page.
  4. Removes praise on MCQ/short answers and on any partial answer; keeps at most one note
     otherwise.
  5. Cancelled attempt -> 0/max + "Attempt cancelled by student."
  6. Moves any score placed left_margin / below_line to right_margin.
  7. Computes the grand total from marks_awarded and the PAPER max (not the sum of graded
     questions), and emits the `total` annotation for page 1.
  8. Returns a report listing everything it changed and every question that ended with no ink,
     so the pipeline can fail loudly instead of shipping a half-checked copy.

Inputs
  results:    list of grader outputs, one per question, each with question_id/paper_label,
              marks_awarded, annotations[], answer_rows[], criteria_breakdown[], feedback.
  layout_map: {"pages":[{"page_id":"p1","lines":[{"line_id":"p1_r1","text":"..."}, ...]}]}
  questions:  list of {"question_id":..., "paper_label":..., "max_marks":..., "question_type":...}
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from typing import Any

SHORT_TYPES = {"MCQ", "ONE_WORD", "SHORT_ANSWER", "FILL_BLANK", "TRUE_FALSE"}
PRAISE = re.compile(r"^(good|well|excellent|nice|correct|very good|well done|well explained|option correct)[.! ]*$", re.I)
# A criterion's reason that says the student got it right is no reason for a
# deduction, even when the grader's figures took a half mark off there.
_NOT_A_DEDUCTION = re.compile(r"^\s*(full marks|fully correct|correct(ly)?\b|accurate(ly)?\b|well\b|good\b)", re.I)
REASON_MAX_WORDS = 15
REASON_MAX_CHARS = 110
_TRAILING = {"and", "or", "but", "the", "a", "an", "of", "to", "in", "on", "for", "with", "is", "are", "as"}


_RANKED_OPENERS = ((re.compile(r"^\s*(no marks|missing|not (attempted|given|mentioned)|absent|deducted)", re.I), 2),
                   (re.compile(r"^\s*(partial|incomplete|lacks)", re.I), 1))
_LABEL = re.compile(r"^\s*(no marks|partial( credit)?|deducted|full marks)\s*[:\-\u2013]\s*", re.I)
_EXAMPLES = re.compile(r"\s*\((e\.g\.|i\.e\.|eg|ie)[^)]*\)", re.I)


def _deduction_rank(reason: str) -> int:
    for pattern, rank in _RANKED_OPENERS:
        if pattern.match(reason):
            return rank
    return 0


def _as_remark(reason: str) -> str:
    """Grader criterion prose -> a teacher's remark: no "No marks:" label,
    no "(e.g., ...)" list, capital first letter."""
    text = _EXAMPLES.sub("", _LABEL.sub("", reason or "")).strip()
    return text[:1].upper() + text[1:] if text else text


def short_reason(text: str) -> str:
    """A deduction reason as a teacher writes it: at most REASON_MAX_WORDS
    words, cut at a word - never mid-word ("... behaviour, and ins", which a
    [:90] slice put on a copy) and never on a dangling "and"."""
    words = (text or "").split()
    out = words[:REASON_MAX_WORDS]
    while out and len(" ".join(out)) > REASON_MAX_CHARS:
        out.pop()
    while len(out) > 1 and out[-1].lower().strip(",;:-") in _TRAILING:
        out.pop()
    reason = " ".join(out).rstrip(" ,;:-")
    if len(out) < len(words) and reason and reason[-1] not in ".!?":
        reason += "."
    return reason


@dataclass
class Result:
    annotations: list[dict[str, Any]]
    total: dict[str, Any] | None
    report: list[str] = field(default_factory=list)
    unmarked: list[str] = field(default_factory=list)
    # The mark enforce settled on for each result, in input order (key match,
    # half-mark steps, clamp to max): the figure the score on the copy shows.
    awarded: list[float] = field(default_factory=list)


def _rows(layout_map: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for page in layout_map.get("pages") or []:
        lines = page.get("lines") or []
        for i, line in enumerate(lines):
            out[str(line.get("line_id"))] = {
                "page_id": str(page.get("page_id")),
                "text": (line.get("text") or "").strip(),
                "last_on_page": i == len(lines) - 1,
                "index": i,
            }
    return out


def _resolve(target: str | None, anchor: str | None, page_hint: str | None,
             rows: dict[str, dict[str, Any]], report: list[str], tag: str) -> str | None:
    if target and target in rows:
        return target
    if not anchor:
        report.append(f"{tag}: dropped - bad target {target!r} and no anchor_text")
        return None
    cands = [(rid, r) for rid, r in rows.items() if not page_hint or r["page_id"] == page_hint] or list(rows.items())
    best, best_score = None, 0.0
    a = anchor.lower()
    for rid, r in cands:
        t = r["text"].lower()
        if not t:
            continue
        s = difflib.SequenceMatcher(None, a, t).ratio()
        if a in t or t in a:
            s = max(s, 0.9)
        if s > best_score:
            best, best_score = rid, s
    if best and best_score >= 0.55:
        report.append(f"{tag}: target {target!r} not found, re-anchored to {best} ({best_score:.2f})")
        return best
    report.append(f"{tag}: dropped - no row matches anchor {anchor!r}")
    return None


def _fmt(x: float) -> str:
    return f"{x:g}"


def enforce(results: list[dict[str, Any]], layout_map: dict[str, Any],
            questions: list[dict[str, Any]], paper_max: float | None = None,
            first_page_id: str | None = None) -> Result:
    rows = _rows(layout_map)
    qmeta = {str(q.get("question_id")): q for q in questions}
    qmeta.update({str(q.get("paper_label")): q for q in questions if q.get("paper_label")})
    out: list[dict[str, Any]] = []
    report: list[str] = []
    unmarked: list[str] = []
    awarded_sum = 0.0
    awarded_list: list[float] = []
    seen_praise = 0

    for res in results:
        qid = str(res.get("paper_label") or res.get("question_id"))
        q = qmeta.get(qid, {})
        qtype = str(q.get("question_type") or res.get("question_type") or "").upper()
        mx = float(q.get("max_marks") or res.get("max_marks") or 0)
        awarded = float(res.get("marks_awarded") or 0)
        key = str(q.get("correct_answer") or "").strip().lower()
        if qtype in SHORT_TYPES and key and res.get("extracted_answer"):
            # The option the student CHOSE, read strictly: a bracketed letter
            # "(b)", "Ans (B)", or the answer being a bare letter. A
            # startswith() test on a one-letter key matched the "A" of
            # "(A) is false but (R) is true" against key "a" and gave a wrong
            # assertion-reason answer full marks.
            ext = str(res["extracted_answer"]).strip()
            m_opt = (re.search(r"(?:ans\.?|answer|option)\s*[:\-]?\s*\(?\s*([a-dA-D])\s*\)?(?![a-z])", ext, re.I)
                     or re.fullmatch(r"\s*(?:[Qq]\s*\d+\.?\s*)?\(?([a-dA-D])\)?\.?\s*", ext)
                     or (len(ext) <= 20 and re.search(r"\(([a-dA-D])\)\s*\.?\s*$", ext)))
            chosen = m_opt.group(1).lower() if m_opt else None
            keyn = re.sub(r"[^a-z0-9]", "", key)
            if chosen and keyn and chosen == keyn:
                if awarded < mx:
                    report.append(f"Q{qid}: MCQ matches key but grader gave {awarded}/{mx} - overriding to full")
                awarded = mx
        awarded = round(awarded * 2) / 2                      # 0.5 steps
        awarded = max(0.0, min(mx, awarded))
        awarded_sum += awarded
        awarded_list.append(awarded)
        cancelled = str(res.get("verdict") or "").lower() == "cancelled"
        attempted = bool(res.get("extracted_answer")) or bool(res.get("annotations")) or cancelled
        tag = f"Q{qid}"

        if not attempted:
            report.append(f"{tag}: unattempted, no ink")
            continue

        # ---- resolve every annotation to a real row
        anns: list[dict[str, Any]] = []
        for a in res.get("annotations") or []:
            rid = _resolve(a.get("target"), a.get("anchor_text"), a.get("page_id"), rows, report, tag)
            if not rid:
                continue
            b = dict(a)
            b["target"], b["page_id"], b["q"] = rid, rows[rid]["page_id"], qid
            anns.append(b)

        # ---- last row of the answer
        ar = res.get("answer_rows") or []
        last = ar[-1] if ar and ar[-1] in rows else None
        if not last and anns:
            last = max((a["target"] for a in anns), key=lambda r: (rows[r]["page_id"], rows[r]["index"]))
        if not last and ar:
            last = _resolve(ar[-1], res.get("extracted_answer", "")[-60:], None, rows, report, tag + ".last")
        # The model graded from text it read on the page but pointed at no
        # row (no answer_rows, no annotations). That text is still on the
        # page: find it. Try the tail of the extracted answer, then the
        # leading "10)"-style label the model often copies into it.
        ext = str(res.get("extracted_answer") or "").strip()
        if not last and ext:
            last = _resolve(None, ext[-60:], None, rows, report, tag + ".text")
        if not last and ext:
            m_lbl = re.match(r"\s*(?:[Qq](?:ue)?s?\.?\s*)?(\d{1,2})\s*[).:\-]", ext)
            if m_lbl:
                lbl = m_lbl.group(1)
                hit = next((rid for rid, r in rows.items()
                            if re.match(rf"\s*(?:[Qq](?:ue)?s?\.?\s*)?{lbl}\s*[).:\-]", r["text"])), None)
                if hit:
                    report.append(f"{tag}: no rows given, anchored to label row {hit} ({rows[hit]['text'][:30]!r})")
                    last = hit
        if not last:
            unmarked.append(qid)
            report.append(f"{tag}: NO ROW FOUND - question will be unmarked")
            continue

        # ---- praise rules
        kept: list[dict[str, Any]] = []
        for a in anns:
            txt = (a.get("text") or "").strip()
            if a.get("style") in ("margin_note", "region_note") and PRAISE.match(txt):
                if qtype in SHORT_TYPES or awarded < mx or seen_praise >= 1:
                    report.append(f"{tag}: removed praise {txt!r}")
                    continue
                seen_praise += 1
            kept.append(a)
        anns = kept

        # ---- exactly one score, right margin, last row
        anns = [a for a in anns if a.get("style") != "score"]
        anns.append({"style": "score", "q": qid, "target": last, "page_id": rows[last]["page_id"],
                     "placement": "right_margin", "text": f"{_fmt(awarded)}/{_fmt(mx)}",
                     "anchor_text": rows[last]["text"]})

        # ---- deduction note
        if cancelled:
            anns = [a for a in anns if a.get("style") not in ("margin_note",)]
            anns.append({"style": "margin_note", "q": qid, "target": last, "page_id": rows[last]["page_id"],
                         "placement": "left_margin" if rows[last]["last_on_page"] else "below_line",
                         "text": "Attempt cancelled by student.", "anchor_text": rows[last]["text"]})
        elif awarded < mx:
            notes = [a for a in anns if a.get("style") == "margin_note" and (a.get("text") or "").strip()]
            if notes:
                note = notes[0]
                note["text"] = short_reason(note["text"])
                anns = [a for a in anns if a is note or a.get("style") != "margin_note"]
            else:
                # The criterion that cost the most, not merely the first that
                # cost anything - and never one whose reason is praise.
                # The grader often sends no per-criterion maximum; then the
                # reason's own opening says how much was lost.
                lost = [((float(c["max_marks"]) - float(c.get("marks") or 0))
                         if c.get("max_marks") is not None else 0.0,
                         _deduction_rank(c["reason"]), -i, c["reason"])
                        for i, c in enumerate(res.get("criteria_breakdown") or [])
                        if c.get("reason")
                        and float(c.get("marks") or 0) < float(c.get("max_marks") or 1e9)
                        and not _NOT_A_DEDUCTION.match(c["reason"])]
                reason = _as_remark(max(lost)[3]) if lost else ""
                reason = reason or (res.get("feedback") or "Marks deducted: answer incomplete.")
                reason = re.sub(r"\b\d+(\.\d+)?\s*marks?\b.*?(because|as|since)\s*", "", reason, flags=re.I)
                reason = short_reason(reason.strip() if qtype in SHORT_TYPES
                                      else reason.strip().split(". ")[0])
                report.append(f"{tag}: deduction note missing, synthesised from feedback")
                note = {"style": "margin_note", "q": qid, "text": reason, "anchor_text": rows[last]["text"]}
                anns.append(note)
            note["target"], note["page_id"] = last, rows[last]["page_id"]
            note["placement"] = "left_margin" if rows[last]["last_on_page"] else "below_line"
        else:
            # Full marks: only praise survives - plus the one note the guide
            # requires on a second attempt, which is not praise and must stay.
            anns = [a for a in anns if not (a.get("style") == "margin_note"
                                            and not PRAISE.match((a.get("text") or "").strip())
                                            and not (a.get("text") or "").startswith("Answered twice"))]

        # ---- MCQ / short: guarantee a tick or cross on the answer row
        if qtype in SHORT_TYPES and not any(a.get("style") in ("tick", "cross") for a in anns):
            anns.append({"style": "tick" if awarded >= mx else "cross", "q": qid, "target": last,
                         "page_id": rows[last]["page_id"], "placement": "right_of_line",
                         "text": None, "anchor_text": rows[last]["text"]})
            report.append(f"{tag}: added missing tick/cross")

        # ---- tick budget
        ticks = [a for a in anns if a.get("style") == "tick"]
        if len(ticks) > 4:
            for a in ticks[4:]:
                anns.remove(a)
            report.append(f"{tag}: trimmed ticks to 4")

        out.extend(anns)

    # ---- student labels no paper question claimed
    claimed: set[str] = set()
    for res in results:
        for rng in (res.get("answer_rows"), res.get("answer_rows_duplicate")):
            if rng and len(rng) == 2 and rng[0] in rows and rng[1] in rows:
                p0, i0 = rows[rng[0]]["page_id"], rows[rng[0]]["index"]
                p1, i1 = rows[rng[1]]["page_id"], rows[rng[1]]["index"]
                for rid, m in rows.items():
                    if (m["page_id"], m["index"]) >= (p0, i0) and (m["page_id"], m["index"]) <= (p1, i1):
                        claimed.add(rid)
    # A label row ("Q4.") whose answer starts on the very next row is claimed
    # by that answer even when the grader's answer_rows began at the "Ans."
    # line: without this, three correctly graded questions were reported as
    # "not in the paper" alongside the six that really were.
    by_pos = {(m["page_id"], m["index"]): rid for rid, m in rows.items()}
    def _claimed(rid: str) -> bool:
        if rid in claimed:
            return True
        m = rows[rid]
        nxt = by_pos.get((m["page_id"], m["index"] + 1))
        return bool(nxt and nxt in claimed)
    def _scribbled_after(rid: str) -> bool:
        m = rows[rid]
        nxt = by_pos.get((m["page_id"], m["index"] + 1))
        return bool(nxt and re.search(r"crossed|scribbl|~~", rows[nxt]["text"], re.I))
    orphan = [f"{rid} {m['text'][:30]!r}" for rid, m in rows.items()
              if not _claimed(rid) and not _scribbled_after(rid)
              and re.match(r"^\s*[QqO0]\s*\.?\s*\d+", m["text"])]
    if orphan:
        report.append("STUDENT ANSWERS NOT IN THE PAPER (question paper incomplete?): " + "; ".join(orphan))

    # ---- grand total on page 1
    total = None
    if rows:
        pid = first_page_id or (layout_map.get("pages") or [{}])[0].get("page_id")
        first_row = next((r for r, m in rows.items() if m["page_id"] == pid), None)
        mx_total = paper_max if paper_max is not None else sum(float(q.get("max_marks") or 0) for q in questions)
        if paper_max is None:
            report.append("paper_max not supplied - total max computed from the question list")
        total = {"style": "total", "q": "total", "target": first_row, "page_id": pid,
                 "placement": "right_margin", "text": f"{_fmt(awarded_sum)}/{_fmt(mx_total)}"}
    if unmarked:
        report.append(f"UNMARKED QUESTIONS: {', '.join(unmarked)} - shipped without a mark")
    return Result(out, total, report, unmarked, awarded_list)


# ------------------------------------------------------------------ self-test
if __name__ == "__main__":
    layout = {"pages": [
        {"page_id": "p1", "lines": [{"line_id": "p1_r1", "text": "Q1"}, {"line_id": "p1_r2", "text": "Ans (b)"},
                                    {"line_id": "p1_r3", "text": "Q2"}, {"line_id": "p1_r4", "text": "Ans (c)"}]},
        {"page_id": "p2", "lines": [{"line_id": "p2_r1", "text": "Q4 first law the incident ray"},
                                    {"line_id": "p2_r2", "text": "all lie in the same plane"}]}]}
    qs = [{"question_id": "1", "max_marks": 1, "question_type": "MCQ"},
          {"question_id": "2", "max_marks": 1, "question_type": "MCQ"},
          {"question_id": "4", "max_marks": 2, "question_type": "LONG_ANSWER"}]
    res = [
        # old-prompt style MCQ: praise, no score, wrong target
        {"question_id": "1", "marks_awarded": 1, "extracted_answer": "(b)", "answer_rows": ["p1_r2", "p1_r2"],
         "annotations": [{"style": "margin_note", "target": "p1_r9", "anchor_text": "Ans (b)", "text": "Well", "placement": "below_line"}]},
        # nothing at all
        {"question_id": "2", "marks_awarded": 0, "extracted_answer": "(c)", "answer_rows": ["p1_r4", "p1_r4"], "annotations": [],
         "feedback": "Wrong option. Correct option: (a)."},
        # score in left margin, deduction, no note
        {"question_id": "4", "marks_awarded": 1.5, "extracted_answer": "first law ... same plane",
         "answer_rows": ["p2_r1", "p2_r2"],
         "annotations": [{"style": "score", "target": "p2_r1", "anchor_text": "Q4 first law", "text": "1.5/2", "placement": "left_margin"}],
         "criteria_breakdown": [{"criteria_name": "Second law", "marks": 0.5, "max_marks": 1, "reason": "0.5 marks deducted because angle of reflection not stated"}]},
    ]
    r = enforce(res, layout, qs, paper_max=36)
    for a in r.annotations:
        print(a["q"], a["style"], a["target"], a["placement"], a.get("text"))
    print("TOTAL", r.total["text"])
    print("\n".join(r.report))
