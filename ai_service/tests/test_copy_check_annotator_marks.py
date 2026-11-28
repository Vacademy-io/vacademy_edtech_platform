"""Offline tests for the marks the annotator actually draws on a copy.

Both cases here are regressions that shipped a copy a teacher would reject:

  - the tick was drawn with its tail descending, so head, vertex and tail fell
    on one line and every "tick" rendered as a bare diagonal slash. The student
    saw no approval marks anywhere on 13 pages.
  - a note was written only if a free right-hand COLUMN existed. When the
    detected rows span the full width of the sheet — which is what a densely
    written script produces — that column is never there, and all 36 comments
    on a 13-page copy were silently discarded. Every deduction was left with no
    stated reason anywhere on the paper.

No network. Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_copy_check_annotator_marks.py
"""
from __future__ import annotations

import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import fitz
import numpy as np

from ai_service.app.services.copy_check import annotator
from ai_service.app.services.copy_check.annotator import (
    _draw_tick_or_cross,
    _free_band,
    _pen_scale,
    _photo_bounds,
    _place_note,
    _row_ink_span,
)

failures: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        failures.append(f"{label}: {detail}")
        print(f"  FAIL  {label} — {detail}")


def _ink_arms(page: "fitz.Page") -> tuple:
    """Vertex of the drawn mark, and how far each side rises above it."""
    pix = page.get_pixmap(dpi=200)
    arr = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
    ink = (arr[:, :, 0].astype(int) - arr[:, :, 1].astype(int)) > 40
    ys, xs = np.nonzero(ink)
    if ys.size == 0:
        return None
    vy = ys.max()
    vx = xs[ys >= vy - 2].mean()
    left, right = xs < vx - 3, xs > vx + 3
    rise_l = int(vy - ys[left].min()) if left.any() else 0
    rise_r = int(vy - ys[right].min()) if right.any() else 0
    return vx, vy, rise_l, rise_r


def test_tick_tail_rises() -> None:
    print("\n_draw_tick_or_cross — a tick, not a slash")
    for seed in (1, 7, 42):
        doc = fitz.open()
        page = doc.new_page(width=200, height=200)
        _draw_tick_or_cross(page, "tick", 60, 80, 34, (0.85, 0.34, 0.29),
                            random.Random(seed), fitz.Rect(20, 90, 180, 110), 20, 180)
        got = _ink_arms(page)
        check(f"seed {seed}: mark drew ink", got is not None, "no ink")
        if not got:
            continue
        _, _, rise_l, rise_r = got
        # A tick is a V opening upward: BOTH limbs climb away from the vertex.
        # With the tail descending, the right limb measured 3px — flat — which
        # is what made it read as a single diagonal stroke.
        check(f"seed {seed}: short arm rises", rise_l > 4, f"rise {rise_l}px")
        check(f"seed {seed}: tail rises", rise_r > 4, f"rise {rise_r}px")
        check(f"seed {seed}: tail is the longer limb",
              rise_r > rise_l * 1.3, f"left {rise_l}px vs right {rise_r}px")
        doc.close()


def test_free_band_finds_the_gap() -> None:
    print("\n_free_band — the blank paper between answers")
    sheet = fitz.Rect(0, 0, 400, 400)
    written = [fitz.Rect(0, 10, 400, 100), fitz.Rect(0, 250, 400, 300)]
    band = _free_band(sheet, written, 40.0, 110.0)
    check("a gap is found between the two blocks", band is not None, "none")
    if band:
        check("the gap really is blank",
              band[0] >= 100 and band[1] <= 250, f"got {band}")
        check("the gap is tall enough", band[1] - band[0] >= 40, f"got {band}")
    check("a gap shorter than the note is refused",
          _free_band(sheet, [fitz.Rect(0, 10, 400, 380)], 40.0, 20.0) is None,
          "accepted a gap with no room")
    below = _free_band(sheet, written, 30.0, 110.0)
    check("a strip below the marked line is preferred",
          below is not None and below[0] >= 100, f"got {below}")


def test_note_survives_a_full_width_row() -> None:
    print("\n_place_note — a full-width row must not silence the feedback")
    # The drawing helpers read per-document state from module globals; a test
    # that leaves it set makes the next one place marks against another page's
    # geometry. Start from a known state.
    annotator._INK_MAP[0] = None
    annotator._PLACED[0] = None
    annotator._INK_SPAN[0] = None
    annotator._CLIP[0] = None
    doc = fitz.open()
    page = doc.new_page(width=400, height=600)
    sheet = fitz.Rect(10, 10, 390, 590)
    # Exactly the shape that dropped every note: rows spanning the whole sheet,
    # so no right-hand column can ever exist.
    rows = [fitz.Rect(10, 40 + i * 30, 390, 62 + i * 30) for i in range(6)]
    target = rows[2]
    placed = _place_note(page, target, "margin_note",
                         "Risk follows ownership, not possession - s. 26",
                         list(rows), sheet)
    check("the note is written somewhere", placed is not None,
          "dropped — the deduction has no stated reason on the page")
    if placed is not None:
        check("it stays on the paper", sheet.contains(placed), f"at {placed}")
        check("it does not cover the student's writing",
              not any(placed.intersects(r) for r in rows), f"at {placed}")
    doc.close()


def test_pen_scale_normalises_apparent_size() -> None:
    print("\n_pen_scale — a cursive pen must not shrink the note")
    check("an unknown font is left alone", _pen_scale(None) == 1.0,
          f"got {_pen_scale(None)}")
    cursive = "/System/Library/Fonts/Supplemental/SnellRoundhand.ttc"
    if Path(cursive).exists():
        s = _pen_scale(cursive)
        # Snell carries 0.36 of its em in x-height against the print hand's
        # 0.53, so it needs enlarging to read at the same size.
        check("a cursive face is scaled up", 1.2 < s <= 1.6, f"got {s:.3f}")
    else:
        print("  SKIP  cursive face not installed on this machine")


def test_no_ink_leaves_the_paper() -> None:
    print("\n_place_note — a pen cannot write where there is no paper")
    doc = fitz.open()
    page = doc.new_page(width=400, height=600)
    sheet = fitz.Rect(20, 20, 300, 580)      # paper ends well before the page
    rows = [fitz.Rect(20, 40 + i * 30, 300, 62 + i * 30) for i in range(4)]
    # Long enough that a wrap/advance mismatch pushes it past the edge - which
    # is what put comment words on the scanner's white canvas beside the scan.
    _place_note(page, rows[1], "margin_note",
                "Lien is lost once the goods reach the carrier for transmission "
                "to the buyer under s.49(1)(a) of the Act",
                list(rows), sheet)
    pix = page.get_pixmap(dpi=150)
    arr = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
    ink = (arr[:, :, 0].astype(int) - arr[:, :, 1].astype(int)) > 40
    ys, xs = np.nonzero(ink)
    # Silence is not a pass. This sheet has four clear rows and room beside
    # them, so a note that draws nothing has been dropped, not restrained -
    # and skipping here let the boundary rule go unchecked for the whole
    # suite while the gate was in fact rejecting almost every mark.
    check("the note was actually written", xs.size > 0,
          "nothing was drawn - the comment was silently dropped")
    if xs.size == 0:
        doc.close()
        return
    scale = 150.0 / 72.0
    right = xs.max() / scale
    left = xs.min() / scale
    check("no ink past the right edge of the paper", right <= sheet.x1 + 1.0,
          f"ink reaches x={right:.1f}, paper ends at {sheet.x1:.1f}")
    check("no ink left of the paper", left >= sheet.x0 - 1.0,
          f"ink reaches x={left:.1f}, paper starts at {sheet.x0:.1f}")
    check("no ink below the paper", ys.max() / scale <= sheet.y1 + 1.0,
          f"ink reaches y={ys.max() / scale:.1f}, paper ends at {sheet.y1:.1f}")
    doc.close()


def test_photo_bounds_ignores_the_watermark() -> None:
    print("\n_photo_bounds — the scanner's caption is not the photograph")
    doc = fitz.open()
    page = doc.new_page(width=300, height=400)
    # A dense "photograph" in the upper half...
    page.draw_rect(fitz.Rect(30, 20, 270, 250), color=(0.6, 0.6, 0.6),
                   fill=(0.6, 0.6, 0.6))
    # ...and a thin caption line low on the white canvas, as a scanner adds.
    page.insert_text(fitz.Point(90, 380), "Scanned with OKEN Scanner", fontsize=8)
    got = _photo_bounds(page)
    check("a bound is found", got is not None, "none")
    if got:
        # Measuring by any dark pixel drags the bound down to the caption and
        # hands the placer a strip of bare canvas to write on.
        check("the caption is excluded", got.y1 < 300,
              f"bound runs to y={got.y1:.1f}, past the photograph at y=250")


def test_photo_bounds_reach_the_last_written_row() -> None:
    print("\n_reach_written_rows — a whitened blank lower half is still paper")
    from ai_service.app.services.copy_check.annotator import _reach_written_rows

    limit = fitz.Rect(0, 0, 300, 400)
    # _photo_bounds stopped at y=250 because the half-empty page below it was
    # as white as the canvas; the answer's last rows run on to y=330.
    photo = fitz.Rect(30, 20, 270, 250)
    rows = [{"box": [40, 40 + i * 20, 200, 15], "text": f"line {i}"} for i in range(15)]
    caption = {"box": [90, 380, 120, 10], "text": "Scanned with OKEN Scanner"}
    lpage = {"vision_ocr": True, "lines": rows + [caption]}
    got = _reach_written_rows(photo, lpage, 1.0, 1.0, limit)
    check("the bound reaches the last written row", got.y1 >= 320 + 15,
          f"bound stops at y={got.y1:.1f}, above the row ending at y=335")
    check("the scanner's caption is still excluded", got.y1 < 380,
          f"bound runs to y={got.y1:.1f}, onto the caption at y=380")

    near = {"vision_ocr": True, "lines": [{"box": [40, 240, 200, 15], "text": "last line"}]}
    got = _reach_written_rows(photo, near, 1.0, 1.0, limit)
    check("a last line dipping a few points past the bound changes nothing",
          got.y1 == photo.y1, f"bound moved to y={got.y1:.1f}")

    unread = {"lines": rows}
    got = _reach_written_rows(photo, unread, 1.0, 1.0, limit)
    check("rows the vision read never confirmed do not move it",
          got.y1 == photo.y1, f"bound moved to y={got.y1:.1f}")


def test_refused_score_still_gets_its_mark() -> None:
    print("\n_place_question_scores — a score that found no room is still marked")
    from ai_service.app.services.copy_check.annotator import _place_question_scores

    verdicts = [{"question_number": 6, "question_id": "q6", "marks_awarded": 1.0,
                 "max_marks": 2.0, "annotations": [
                     {"style": "score", "target": "L1_09", "text": "1/2"}]}]

    def red_ink(written) -> int:
        doc = fitz.open()
        page = doc.new_page(width=400, height=500)
        _place_question_scores(doc, {6: (0, 300.0, 250.0)}, verdicts, written=written)
        pix = page.get_pixmap(dpi=72)
        arr = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
        return int(((arr[:, :, 0].astype(int) - arr[:, :, 1].astype(int)) > 40).sum())

    check("a score refused on the page falls back to the badge", red_ink(set()) > 0,
          "the question was left with no mark on the copy")
    check("a score that was drawn gets no second one", red_ink({6}) == 0,
          "the mark was drawn twice")


def test_brace_and_summary_survive_validation() -> None:
    print("\nvalidator — the new teacher-pen styles reach the page")
    from ai_service.app.services.copy_check.validator import validate_and_cap

    layout = {"pages": [{"page_id": "P1", "lines": [
        {"line_id": f"L1_{i:02d}", "box": [40, 40 + i * 20, 300, 18]} for i in range(1, 6)
    ], "regions": []}]}
    raw = {
        "marks_awarded": 4.0,
        "extracted_answer": "x",
        "feedback": "ok",
        "confidence": 0.9,
        "criteria_breakdown": [{"criteria_name": "C1", "marks": 4.0, "reason": "r"}],
        "annotations": [
            {"style": "brace", "target": "L1_01", "target_end": "L1_03",
             "page_id": "P1", "text": "Good explanation", "marks": 3.0},
            {"style": "summary", "target": "L1_05", "page_id": "P1",
             "text": "Well written!", "marks": 4.0},
            {"style": "tick", "target": "L1_02", "page_id": "P1", "text": None},
            # a brace whose closing row does not exist must not be drawn: it
            # would bracket writing that has nothing to do with the comment
            {"style": "brace", "target": "L1_01", "target_end": "L1_99",
             "page_id": "P1", "text": "Bad", "marks": 1.0},
        ],
    }
    out = validate_and_cap(raw, {"question_id": "q1", "max_marks": 8}, layout)
    styles = [a["style"] for a in out["annotations"]]
    check("the brace survives", "brace" in styles, f"got {styles}")
    check("the summary survives", "summary" in styles, f"got {styles}")
    braces = [a for a in out["annotations"] if a["style"] == "brace"]
    check("a brace with a bad end row is dropped", len(braces) == 1,
          f"kept {len(braces)}")
    if braces:
        check("the brace keeps its span", braces[0].get("target_end") == "L1_03",
              f"got {braces[0].get('target_end')}")
        # The lone brace is reconciled up to the question total - a margin
        # figure that does not add up to the mark is worse than none.
        check("the brace carries a reconciled figure",
              braces[0].get("marks") == out["marks_awarded"],
              f"got {braces[0].get('marks')} against {out['marks_awarded']}")
    summ = [a for a in out["annotations"] if a["style"] == "summary"]
    if summ:
        check("the summary keeps its total", summ[0].get("marks") == 4.0,
              f"got {summ[0].get('marks')}")


def test_margin_marks_reconcile_with_the_total() -> None:
    print("\nvalidator — the figures in the margin must add up to the mark")
    from ai_service.app.services.copy_check.validator import validate_and_cap

    layout = {"pages": [{"page_id": "P1", "lines": [
        {"line_id": f"L1_{i:02d}", "box": [40, 40 + i * 20, 300, 18]} for i in range(1, 8)
    ], "regions": []}]}
    raw = {
        "marks_awarded": 7.0,
        "extracted_answer": "x", "feedback": "f", "confidence": 0.9,
        "criteria_breakdown": [{"criteria_name": "C1", "marks": 7.0, "reason": "r"}],
        "annotations": [
            # braces that sum to 4.0 against an awarded 7.0 - exactly what the
            # model returned on Q1 of a real script
            {"style": "brace", "target": "L1_01", "target_end": "L1_02",
             "page_id": "P1", "text": "Rule", "marks": 1.0},
            {"style": "brace", "target": "L1_03", "target_end": "L1_04",
             "page_id": "P1", "text": "Application", "marks": 3.0},
            # a summary disagreeing with the total, as seen on Q2 and Q7
            {"style": "summary", "target": "L1_07", "page_id": "P1",
             "text": "Well reasoned!", "marks": 8.25},
        ],
    }
    out = validate_and_cap(raw, {"question_id": "q1", "max_marks": 10}, layout)
    awarded = out["marks_awarded"]
    braces = [a for a in out["annotations"] if a["style"] == "brace"]
    summ = [a for a in out["annotations"] if a["style"] == "summary"]
    total = sum(a["marks"] for a in braces)
    check("brace marks add up to the mark awarded", abs(total - awarded) < 0.26,
          f"braces sum {total} against {awarded}")
    check("the summary carries the mark awarded",
          summ and abs(summ[0]["marks"] - awarded) < 0.01,
          f"summary {summ[0]['marks'] if summ else None} against {awarded}")


def test_comment_ink_stays_legible() -> None:
    print("\n_pen_text — a comment must have letters, not be a red slab")
    doc = fitz.open()
    page = doc.new_page(width=420, height=110)
    from ai_service.app.services.copy_check.annotator import _pen_text

    _pen_text(page, fitz.Point(20, 70), "Risk follows ownership",
              18.0, (0.70, 0.24, 0.28), random.Random(4))
    pix = page.get_pixmap(dpi=200)
    arr = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
    ink = (arr[:, :, 0].astype(int) - arr[:, :, 1].astype(int)) > 40
    ys, xs = np.nonzero(ink)
    check("something was written", ys.size > 0, "no ink at all")
    if ys.size == 0:
        doc.close()
        return
    box = (ys.max() - ys.min() + 1) * (xs.max() - xs.min() + 1)
    fill = ink.sum() / box
    # A stroked-glyph experiment welded whole comments into solid lumps at 89%
    # fill - measured on the real reference hand, a written phrase sits well
    # under a quarter ink inside its own bounding box.
    check("the comment is not a solid slab", fill < 0.30, f"ink fill {fill:.3f}")

    # Letters must remain separate marks: a legible phrase breaks into many
    # connected components, a fused blob into one or two.
    seen = np.zeros_like(ink, dtype=bool)
    comps = 0
    h, w = ink.shape
    for sy in range(0, h, 2):
        for sx in range(0, w, 2):
            if not ink[sy, sx] or seen[sy, sx]:
                continue
            comps += 1
            stack = [(sy, sx)]
            seen[sy, sx] = True
            while stack:
                cy, cx = stack.pop()
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and ink[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
    check("the phrase has distinct letter shapes", comps >= 6,
          f"only {comps} connected ink components - the letters have fused")
    doc.close()


def test_whole_paper_shape_is_unwrapped() -> None:
    print("\nvalidator — the whole-copy output shape must not grade a zero")
    from ai_service.app.services.copy_check.validator import validate_and_cap

    layout = {"pages": [{"page_id": "P1", "lines": [
        {"line_id": f"L1_{i:02d}", "box": [40, 40 + i * 20, 300, 18]} for i in range(1, 5)
    ], "regions": []}]}
    # The marking guide's output block describes a WHOLE PAPER: a top-level
    # "questions" array. This service grades one question per call, so a model
    # that follows the guide literally wraps its answer - and reading the
    # wrapper for marks_awarded finds nothing and releases a zero.
    wrapped = {"questions": [{
        "question_id": "Q2",
        "maximum_marks": 10,
        "marks_awarded": 6.0,
        "extracted_answer": "x", "feedback": "f", "confidence": 0.9,
        "criteria_breakdown": [{"criteria_name": "C1", "marks": 6.0, "reason": "r"}],
        "annotations": [{"style": "tick", "target": "L1_01", "page_id": "P1"}],
    }]}
    out = validate_and_cap(wrapped, {"question_id": "Q2", "max_marks": 10}, layout)
    check("the wrapped mark is read, not zeroed", out["marks_awarded"] == 6.0,
          f"got {out['marks_awarded']}")
    check("its annotations survive", len(out["annotations"]) == 1,
          f"got {len(out['annotations'])}")


def test_words_where_numbers_were_asked_for() -> None:
    print("\nvalidator — a word in a numeric field must not fail the question")
    from ai_service.app.services.copy_check.validator import (
        coerce_confidence, coerce_number, validate_and_cap,
    )

    # "confidence": "low" reached float() in production and the student got a
    # zero plus a "needs your review" card - for a field that only decides
    # whether the copy is escalated to a stronger model.
    check("'low' reads as a low confidence", coerce_confidence("low") == 0.3)
    check("'85%' reads as 0.85", abs(coerce_confidence("85%") - 0.85) < 1e-9)
    check("'2/3' is the figure awarded, not a fraction", coerce_number("2/3") == 2.0)
    check("'2.5 marks' keeps its number", coerce_number("2.5 marks") == 2.5)
    check("prose without a digit is the default", coerce_number("not applicable", 0.0) == 0.0)

    layout = {"pages": [{"page_id": "P1", "lines": [
        {"line_id": "L1_01", "box": [40, 60, 300, 18], "text": "hello world"}
    ], "regions": []}]}
    raw = {
        "marks_awarded": "2/3", "confidence": "low",
        "criteria_breakdown": {"Data": "1 mark", "Nature": "0"},
        "annotations": ["garbage", {"style": "Tick", "target": "L1_01", "page_id": "P1"},
                        {"style": "score", "target": "L1_01", "page_id": "P1", "marks": "2 marks"}],
        "feedback": "f", "extracted_answer": "x",
    }
    out = validate_and_cap(raw, {"question_id": "Q3", "max_marks": 3}, layout)
    check("the verdict is produced, not raised", out["marks_awarded"] == 2.0,
          f"got {out['marks_awarded']}")
    check("a dict breakdown becomes criteria", len(out["criteria_breakdown"]) == 2)
    check("junk annotations are dropped, real ones kept",
          [a["style"] for a in out["annotations"]] == ["tick", "score"],
          f"got {[a['style'] for a in out['annotations']]}")


def test_bbox_anchors_and_placement_names() -> None:
    print("\nvalidator — the reported geometry places a mark the text cannot")
    from ai_service.app.services.copy_check.validator import validate_and_cap

    layout = {"pages": [{"page_id": "P1", "width": 1000, "height": 2000, "lines": [
        {"line_id": "L1", "box": [100, 100, 400, 40], "text": "Ans. (d)"},
        {"line_id": "L2", "box": [100, 900, 400, 40], "text": "Magnified."},
    ], "regions": []}]}
    base = {"question_id": "Q1", "maximum_marks": 2, "marks_awarded": 1.0,
            "extracted_answer": "x", "feedback": "f", "confidence": 0.9,
            "criteria_breakdown": []}

    def run(anns):
        return validate_and_cap(dict(base, annotations=anns),
                                {"question_id": "Q1", "max_marks": 2}, layout)["annotations"]

    # Bad id AND unquotable text: the normalised bbox is the last chance.
    got = run([{"style": "tick", "target": "BAD", "page_id": "P1",
                "anchor_text": "zzz nothing like this at all",
                "anchor_bbox": [0.10, 0.45, 0.50, 0.47],
                "placement": "right_of_anchor"}])
    check("geometry placed a mark text could not", len(got) == 1, f"got {len(got)}")
    if got:
        check("it landed on the nearest row", got[0]["target"] == "L2",
              f"got {got[0]['target']}")
        check("the guide's placement name is normalised",
              got[0]["position"] == "right_of_line", f"got {got[0]['position']}")

    check("a far-off bbox is refused, not forced onto a line",
          run([{"style": "tick", "target": "BAD", "page_id": "P1",
                "anchor_text": "zzz nothing like this",
                "anchor_bbox": [0.9, 0.02, 0.99, 0.04]}]) == [], "a mark was placed")
    # Pixels instead of the 0-1 the guide asks for would put every mark in the
    # top-left corner. Refuse rather than trust it.
    check("a bbox given in pixels is refused",
          run([{"style": "tick", "target": "BAD", "page_id": "P1",
                "anchor_text": "zzz nothing like this",
                "anchor_bbox": [100, 100, 400, 140]}]) == [], "pixels were trusted")
    good = run([{"style": "tick", "target": "L1", "page_id": "P1",
                 "anchor_text": "Ans. (d)", "placement": "right_of_anchor"}])
    check("a correct line_id still wins outright",
          good and good[0]["target"] == "L1", "id was overridden")


def test_mark_figure_never_hides_in_a_comment() -> None:
    print("\nvalidator — a mark written inside a comment must not contradict the grade")
    from ai_service.app.services.copy_check.validator import validate_and_cap

    layout = {"pages": [{"page_id": "P1", "lines": [
        {"line_id": "L1_01", "box": [40, 40, 300, 18], "text": "h' = 1.5 x 4 = -6 cm."},
    ], "regions": []}]}
    # Measured on a real copy: the grader recorded 2.0/3.0 and then wrote
    # "2.25/3" inside the note. A quarter mark no examiner writes, disagreeing
    # with the mark the student is actually given, printed beside the score.
    raw = {
        "question_id": "Q20", "maximum_marks": 3, "marks_awarded": 2.0,
        "extracted_answer": "x", "feedback": "f", "confidence": 0.9,
        "criteria_breakdown": [],
        "annotations": [{"style": "margin_note", "target": "L1_01", "page_id": "P1",
                         "anchor_text": "h' = 1.5 x 4 = -6 cm.",
                         "text": "Nature not stated: real & inverted. 2.25/3"}],
    }
    out = validate_and_cap(raw, {"question_id": "Q20", "max_marks": 3}, layout)
    note = out["annotations"][0]["text"]
    check("the comment survives", note is not None, "note was dropped")
    check("the stray mark figure is gone", "2.25" not in (note or ""),
          f"still reads {note!r}")
    check("the teacher's actual words are kept",
          "Nature not stated" in (note or ""), f"got {note!r}")
    check("the recorded mark is untouched", out["marks_awarded"] == 2.0,
          f"got {out['marks_awarded']}")

    # A fraction that is part of the remark, not a mark, must survive.
    keep = dict(raw, annotations=[{"style": "margin_note", "target": "L1_01",
                                   "page_id": "P1", "anchor_text": "h'",
                                   "text": "Use 1/2 mv^2 here"}])
    out2 = validate_and_cap(keep, {"question_id": "Q20", "max_marks": 3}, layout)
    check("a formula containing a fraction is left alone",
          out2["annotations"][0]["text"] == "Use 1/2 mv^2 here",
          f"got {out2['annotations'][0]['text']!r}")


def test_paper_boundary_finds_the_page() -> None:
    print("\n_paper_rows — the notebook page, not the brightest patch of bedsheet")
    from ai_service.app.services.copy_check.annotator import (
        _paper_rows, _on_paper, _point_on_paper, _PAPER)

    # A photograph: a near-white, achromatic sheet lying at a slight angle on a
    # strongly coloured cloth. The old detector scored by brightness alone, so
    # a well-lit patch of cloth outscored a shadowed half of the page and the
    # gate then rejected 86% of the marks - three pages got none at all.
    doc = fitz.open()
    page = doc.new_page(width=400, height=600)
    page.draw_rect(page.rect, color=(0.80, 0.10, 0.55), fill=(0.80, 0.10, 0.55))
    # A bright but SATURATED distractor - the cartoon blanket in the real copies.
    page.draw_rect(fitz.Rect(300, 20, 395, 120), color=(0.95, 0.85, 0.15),
                   fill=(0.95, 0.85, 0.15))
    sheet = [fitz.Point(62, 84), fitz.Point(338, 62),
             fitz.Point(348, 520), fitz.Point(72, 542)]
    page.draw_polyline(sheet + [sheet[0]], color=(1, 1, 1), fill=(0.99, 0.99, 0.98))
    for i in range(8):                      # ruled lines and a little writing
        y = 120 + i * 45
        page.draw_line(fitz.Point(90, y), fitz.Point(320, y), color=(0.6, 0.6, 0.7))
        page.insert_text(fitz.Point(95, y - 6), "the student wrote here", fontsize=11)

    paper = _paper_rows(page)
    check("the page was found", paper is not None, "no paper detected")
    if paper is None:
        doc.close()
        return
    check("a mask is returned, not only row spans", paper.get("mask") is not None,
          "no mask")

    _PAPER[0] = paper
    try:
        check("the middle of the sheet is paper", _point_on_paper(200, 300), "rejected")
        check("a written line is paper", _point_on_paper(150, 210), "rejected")
        # The saturated distractor and the cloth must NOT be paper, or the pen
        # is free to write on the bedsheet.
        check("the coloured distractor is not paper",
              not _point_on_paper(350, 60), "accepted the blanket")
        check("the cloth below the sheet is not paper",
              not _point_on_paper(200, 580), "accepted the cloth")
        check("the cloth beside the sheet is not paper",
              not _point_on_paper(20, 300), "accepted the cloth")
        check("a box inside the sheet is admitted",
              _on_paper(paper, fitz.Rect(100, 200, 300, 240)), "rejected")
        check("a box running off the sheet is refused",
              not _on_paper(paper, fitz.Rect(300, 200, 396, 240)), "admitted")
    finally:
        _PAPER[0] = None
        doc.close()

    # A scan pasted on a white PDF canvas. Its own background is the SAME pure
    # white as the canvas, so keeping the non-white pixels returns the
    # handwriting only - which is how a scanned copy came back nearly unmarked.
    doc = fitz.open()
    page = doc.new_page(width=400, height=600)
    page.draw_rect(fitz.Rect(40, 30, 360, 520), color=(0.93, 0.93, 0.91),
                   fill=(0.93, 0.93, 0.91))
    for i in range(6):
        page.insert_text(fitz.Point(60, 90 + i * 60), "scanned answer text", fontsize=12)
    paper = _paper_rows(page)
    check("the scanned sheet was found", paper is not None, "no paper detected")
    if paper is not None:
        _PAPER[0] = paper
        try:
            check("blank paper BETWEEN the written lines is still paper",
                  _point_on_paper(200, 120), "rejected - a blank row admits nothing")
            check("the margin beside the text is paper",
                  _point_on_paper(330, 300), "rejected - no room for a margin note")
            check("the white canvas outside the scan is not paper",
                  not _point_on_paper(390, 560), "accepted the bare canvas")
        finally:
            _PAPER[0] = None
    doc.close()


def test_shadowed_writing_is_paper() -> None:
    print("\n_paper_rows — a shadow across the page is not the edge of the page")
    from ai_service.app.services.copy_check.annotator import _paper_rows, _on_paper

    # 2026-09-30: a phone photo with a hand's shadow across it. The photo rule
    # read the shadow's edge as the sheet's edge, called 40% of a fully written
    # page "off paper", and every deduction note aimed there was dropped.
    # A dull, near-grey cloth like the real one - the case where lightness and
    # chroma cannot tell shadowed paper from background.
    doc = fitz.open()
    page = doc.new_page(width=400, height=600)
    cloth = (0.38, 0.36, 0.37)
    page.draw_rect(page.rect, color=cloth, fill=cloth)
    sheet = [fitz.Point(62, 84), fitz.Point(338, 62), fitz.Point(348, 520), fitz.Point(72, 542)]
    page.draw_polyline(sheet + [sheet[0]], color=(1, 1, 1), fill=(0.80, 0.80, 0.80))
    shadow = [fitz.Point(62, 84), fitz.Point(190, 74), fitz.Point(140, 537), fitz.Point(72, 542)]
    page.draw_polyline(shadow + [shadow[0]], color=(0.52, 0.52, 0.52), fill=(0.52, 0.52, 0.52))
    rows = []
    for i in range(8):
        y = 120 + i * 45
        page.insert_text(fitz.Point(95, y - 6), "the student wrote this line", fontsize=11)
        rows.append(fitz.Rect(92, y - 17, 318, y - 2))
    gap_in_shadow = fitz.Rect(100, 280, 180, 300)      # blank paper between two rows
    try:
        check("the photo rule alone loses the shadowed paper (the bug)",
              not _on_paper(_paper_rows(page), gap_in_shadow), "fixture no longer reproduces it")
        paper = _paper_rows(page, rows)
        check("with the student's rows, the shadowed paper is paper",
              _on_paper(paper, gap_in_shadow), "still refused")
        check("the lit paper is still paper", _on_paper(paper, fitz.Rect(250, 280, 300, 300)))
        check("the cloth beside the sheet is still not paper",
              not _on_paper(paper, fitz.Rect(10, 290, 40, 310)), "accepted the cloth")
        check("the cloth below the sheet is still not paper",
              not _on_paper(paper, fitz.Rect(180, 560, 220, 590)), "accepted the cloth")
    finally:
        doc.close()


def test_marks_grow_with_the_page() -> None:
    print("\nbuild_annotated_pdf — a big photographed page gets marks to match")
    # 2026-10-01: on 1500pt pages with 54pt rows of handwriting, the A4-tuned
    # caps wrote every score at 24pt - a third of the student's writing.
    def score_size(width: float, height: float, row_h: float) -> float:
        doc = fitz.open()
        page = doc.new_page(width=width, height=height)
        fill = (0.93, 0.93, 0.91)
        page.draw_rect(fitz.Rect(10, 10, width - 10, height - 10), color=fill, fill=fill)
        lines = []
        for i in range(6):
            y = 60 + i * row_h * 2
            page.insert_text(fitz.Point(40, y + row_h * 0.8), "ans answer", fontsize=row_h * 0.8)
            lines.append({"line_id": f"p1_r{i + 1}", "text": "ans", "box": [38, y, width * 0.3, row_h]})
        pdf = doc.tobytes()
        doc.close()
        layout = {"pages": [{"page_id": "p1", "page_index": 0, "width": width, "height": height,
                             "lines": lines, "vision_ocr": True}]}
        verdicts = [{"question_number": 1, "marks_awarded": 1.0, "max_marks": 1.0, "annotations": [
            {"style": "score", "target": "p1_r1", "page_id": "p1", "text": "1/1",
             "position": "right_margin_same_line"}]}]
        sizes: list = []
        real = annotator._pen_text

        def spy(page, origin, text, size, *a, **k):
            if text == "1/1":
                sizes.append(size)
            return real(page, origin, text, size, *a, **k)
        annotator._pen_text = spy
        try:
            annotator.build_annotated_pdf(pdf, layout, verdicts)
        finally:
            annotator._pen_text = real
        return max(sizes) if sizes else 0.0

    a4 = score_size(595, 842, 20)
    big = score_size(1500, 2000, 54)
    check("A4 is unchanged: the score stays within the old 24pt cap", 0 < a4 <= 24.0, str(a4))
    check("a 1500pt page with 54pt rows gets a score well over 24pt", big > 40.0, str(big))


def _written_text(pages: list) -> dict:
    """Spy on the pen: {page number: [text written there]}."""
    written: dict = {}
    real = annotator._pen_text

    def spy(page, origin, text, *a, **k):
        written.setdefault(page.number, []).append(text)
        return real(page, origin, text, *a, **k)
    annotator._pen_text = spy
    return written, real


def test_deduction_reason_is_written_whole() -> None:
    print("\nbuild_annotated_pdf — a deduction reason reaches the copy, whole")
    # 2026-09-30: on a densely written page every placement refused the
    # reason, so a 1/3 and a 2.5/5 went back with no word of why; others came
    # out cut to "Wrong answer." or "Q21". The reason now goes, whole, to the
    # nearest blank paper - here the next page.
    doc = fitz.open()
    lines1, lines2 = [], []
    # Off-white scanned sheets on the white PDF canvas, as a scanner produces.
    sheet_fill = (0.93, 0.93, 0.91)
    p1 = doc.new_page(width=400, height=600)
    p1.draw_rect(fitz.Rect(20, 15, 380, 585), color=sheet_fill, fill=sheet_fill)
    for i in range(34):                                    # edge to edge, no gaps
        y = 30 + i * 16
        p1.insert_text(fitz.Point(40, y + 11), "dense handwriting " * 5, fontsize=11)
        lines1.append({"line_id": f"p1_r{i + 1}", "text": "dense", "box": [38, y, 330, 14]})
    p2 = doc.new_page(width=400, height=600)
    p2.draw_rect(fitz.Rect(20, 15, 380, 585), color=sheet_fill, fill=sheet_fill)
    for i in range(2):
        y = 40 + i * 30
        p2.insert_text(fitz.Point(40, y + 11), "the next answer starts here", fontsize=11)
        lines2.append({"line_id": f"p2_r{i + 1}", "text": "next", "box": [38, y, 200, 14]})
    pdf = doc.tobytes()
    doc.close()
    layout = {"pages": [
        {"page_id": "p1", "page_index": 0, "width": 400, "height": 600, "lines": lines1,
         "ink_boxes": [ln["box"] for ln in lines1], "vision_ocr": True},
        {"page_id": "p2", "page_index": 1, "width": 400, "height": 600, "lines": lines2,
         "ink_boxes": [ln["box"] for ln in lines2], "vision_ocr": True},
    ]}
    reason = "Second feature missing; only one feature given."
    verdicts = [{"question_number": 5, "marks_awarded": 1.0, "max_marks": 3.0, "annotations": [
        {"style": "score", "target": "p1_r34", "page_id": "p1", "text": "1/3",
         "position": "right_margin_same_line"},
        {"style": "margin_note", "target": "p1_r34", "page_id": "p1", "text": reason,
         "position": "below_line_left"},
    ]}]
    written, real = _written_text([])
    try:
        annotator.build_annotated_pdf(pdf, layout, verdicts)
    finally:
        annotator._pen_text = real
    everything = " ".join(t for ts in written.values() for t in ts)
    check("the reason is on the copy, labelled with its question",
          f"Q5: {reason}" in " ".join(written.get(1, [])) or f"Q5: {reason}" in everything,
          str(written))
    check("it is not cut short anywhere",
          not any(t.strip() and t.strip() != reason and reason.startswith(t.strip())
                  for ts in written.values() for t in ts), str(written))


def test_free_band_can_refuse_to_cut() -> None:
    print("\n_write_in_free_band(allow_cut=False) — None rather than half a remark")
    from ai_service.app.services.copy_check.annotator import _write_in_free_band, _pen

    doc = fitz.open()
    page = doc.new_page(width=400, height=600)
    # Written lines every 30pt: gaps a single short line fits, nothing more.
    rows = [fitz.Rect(40, 20 + i * 30, 360, 38 + i * 30) for i in range(19)]
    note = ("Structure of the atmosphere explained but the thermosphere and exosphere "
            "layers are missing entirely")
    fontname, size, font = _pen(page)
    try:
        got = _write_in_free_band(page, rows[5], note, rows, page.rect, fontname, 14.0, font,
                                  allow_cut=False)
        check("refuses instead of shortening", got is None, str(got))
    finally:
        doc.close()


def test_annotation_rescued_by_anchor_text() -> None:
    print("\nvalidator — a wrong line_id must not silently bin the mark")
    from ai_service.app.services.copy_check.validator import validate_and_cap

    layout = {"pages": [{"page_id": "P1", "lines": [
        {"line_id": "L1_01", "box": [40, 40, 300, 18],
         "text": "The incident ray, reflected ray and normal lie in the same plane"},
        {"line_id": "L1_02", "box": [40, 60, 300, 18],
         "text": "The angle of incidence equals the angle of reflection"},
        {"line_id": "L1_03", "box": [40, 80, 300, 18],
         "text": "principal focus."},
    ], "regions": []}]}
    base = {
        "question_id": "Q1", "maximum_marks": 4, "marks_awarded": 2.0,
        "extracted_answer": "x", "feedback": "f", "confidence": 0.9,
        "criteria_breakdown": [],
    }

    # A hallucinated id used to be dropped without trace, which is how a page
    # comes back unmarked while the grader reports it graded the answer.
    raw = dict(base, annotations=[
        {"style": "tick", "target": "L9_99", "page_id": "P1",
         "anchor_text": "incidence equals the angle", "position": "right_of_line"},
        {"style": "cross", "target": "nonsense", "page_id": "P1",
         "anchor_text": "principal focus."},
    ])
    out = validate_and_cap(raw, {"question_id": "Q1", "max_marks": 4}, layout)
    check("both marks survived a bad line_id", len(out["annotations"]) == 2,
          f"got {len(out['annotations'])}")
    by_style = {a["style"]: a for a in out["annotations"]}
    check("the tick landed on the quoted row",
          by_style.get("tick", {}).get("target") == "L1_02",
          f"got {by_style.get('tick', {}).get('target')}")
    check("the cross landed on the quoted row",
          by_style.get("cross", {}).get("target") == "L1_03",
          f"got {by_style.get('cross', {}).get('target')}")
    check("a recognised position is carried through",
          by_style.get("tick", {}).get("position") == "right_of_line",
          f"got {by_style.get('tick', {}).get('position')}")

    # The rescue must not become a way for anything to land anywhere.
    junk = dict(base, annotations=[
        {"style": "tick", "target": "L9_99", "page_id": "P1",
         "anchor_text": "purple monkey dishwasher unrelated nonsense"},
        {"style": "tick", "target": "L9_98", "page_id": "P1"},
        {"style": "not_a_style", "target": "L1_01", "page_id": "P1"},
    ])
    out2 = validate_and_cap(junk, {"question_id": "Q1", "max_marks": 4}, layout)
    check("unmatchable quote, absent quote and bad style are all dropped",
          len(out2["annotations"]) == 0, f"got {len(out2['annotations'])}")

    # An unrecognised position must not be passed on as if it were real.
    odd = dict(base, annotations=[
        {"style": "tick", "target": "L1_01", "page_id": "P1",
         "anchor_text": "The incident ray", "position": "diagonally_across"},
    ])
    out3 = validate_and_cap(odd, {"question_id": "Q1", "max_marks": 4}, layout)
    check("an invented position is discarded, not trusted",
          out3["annotations"][0]["position"] is None,
          f"got {out3['annotations'][0]['position']}")


if __name__ == "__main__":
    test_shadowed_writing_is_paper()
    test_marks_grow_with_the_page()
    test_deduction_reason_is_written_whole()
    test_free_band_can_refuse_to_cut()
    test_bbox_anchors_and_placement_names()
    test_mark_figure_never_hides_in_a_comment()
    test_paper_boundary_finds_the_page()
    test_annotation_rescued_by_anchor_text()
    test_tick_tail_rises()
    test_free_band_finds_the_gap()
    test_note_survives_a_full_width_row()
    test_pen_scale_normalises_apparent_size()
    test_no_ink_leaves_the_paper()
    test_photo_bounds_ignores_the_watermark()
    test_photo_bounds_reach_the_last_written_row()
    test_refused_score_still_gets_its_mark()
    test_brace_and_summary_survive_validation()
    test_margin_marks_reconcile_with_the_total()
    test_comment_ink_stays_legible()
    test_whole_paper_shape_is_unwrapped()
    test_words_where_numbers_were_asked_for()

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("All copy-check annotator mark tests passed.")
