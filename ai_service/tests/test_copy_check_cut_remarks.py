"""Why each mark was cut, beside the line it is about.

A checked copy carried ticks, one short note per question and a score: nothing
told the student where the lost marks went. Every rubric line that lost marks
now becomes a remark on its row, "Section 28 rule not stated (-1)"."""
import fitz
import numpy as np

from app.services.copy_check import annotator as A
from app.services.copy_check import remarks as R


def _line(marks, reason, ceiling=1.0):
    return {"marks": marks, "max": ceiling, "reason": reason}


def _verdict(lines, annotations=None, **extra):
    v = {"question_number": 2, "status": "COMPLETED", "marks_awarded": 6.0, "max_marks": 10.0,
         "criteria_breakdown": lines,
         "annotations": annotations if annotations is not None else [
             {"style": "tick", "target": "p1_r3"},
             {"style": "margin_note", "target": "p1_r5", "text": "Sections not quoted"},
             {"style": "score", "target": "p1_r9", "text": "6/10"}]}
    v.update(extra)
    return v


ROWS = {f"p1_r{i}" for i in range(1, 12)}


def _remarks(v):
    return [(a["target"], a["text"]) for a in v["annotations"] if a["style"] == "deduction_reason"]


def test_a_reason_becomes_a_short_remark_on_its_own_row():
    v = _verdict([
        _line(0.0, "1 mark deducted because Section 4/6 definition of partnership not stated (p1_r7)"),
        _line(0.5, "0.5 mark deducted because the 6% rule is stated but the ₹7,200 computation "
                   "is not done (p1_r4)"),
        _line(1.0, "Full marks: correct conclusion (p1_r2)"),
        _line(0.5, "Half marks: 'period may not fixed' at p1_r6 is vague, Section 7/43 not cited"),
    ])
    assert R.add_cut_remarks(v, ROWS) == 3
    assert _remarks(v) == [
        ("p1_r7", "Section 4/6 definition of partnership not stated (-1)"),
        ("p1_r4", "₹7,200 computation is not done (-0.5)"),
        ("p1_r6", "'period may not fixed' is vague, Section 7/43 not cited (-0.5)"),
    ]


def test_a_long_reason_keeps_the_clause_that_says_what_is_wrong():
    assert R._short("0.5 mark deducted because only 'no fixed period' is stated in the answer; the "
                    "'no provision for determination' condition is missing (p3_r11-p3_r13)") == \
        "'no provision for determination' condition is missing"


def test_unwritten_parts_are_one_remark_at_the_end_of_the_answer():
    v = _verdict([
        _line(0.0, "Question 5(a)(i) not found in the copy"),
        _line(0.0, "Question 5(a)(i) variation not found in the copy"),
        _line(0.0, "Question 5(a)(ii) not found in the copy"),
        _line(0.0, "Order of application not attempted"),
        _line(0.5, "Bar on suit stated at p1_r6 but the remedy of a fresh suit is missing"),
    ])
    R.add_cut_remarks(v, ROWS)
    assert _remarks(v) == [("p1_r6", "Remedy of a fresh suit is missing (-0.5)"),
                           ("p1_r9", "5(a)(i), 5(a)(ii) not attempted (-4)")]


def test_the_summary_note_gives_way_to_the_remarks():
    v = _verdict([_line(0.0, "Section 28 rule not stated, only conclusion given (p1_r4)")])
    R.add_cut_remarks(v, ROWS)
    assert "margin_note" not in [a["style"] for a in v["annotations"]]
    # ...and stays when nothing was cut.
    full = _verdict([_line(1.0, "Full marks (p1_r4)")])
    assert R.add_cut_remarks(full, ROWS) == 0
    assert "margin_note" in [a["style"] for a in full["annotations"]]


def test_no_remark_on_a_row_the_grader_could_not_read():
    v = _verdict([_line(0.5, "Application conclusion on p1_r8 wrongly says dissolution is allowed")],
                 unclear_reads=[{"part": "5(b)(i)", "row": "p1_r8", "why": "margin word"}])
    assert R.add_cut_remarks(v, ROWS) == 0


def test_a_deduction_scheme_copy_keeps_its_own_reasons():
    v = _verdict([_line(0.0, "Section 28 rule not stated (p1_r4)")],
                 annotations=[{"style": "deduction_reason", "target": "p1_r4", "text": "-1 S.28"}])
    assert R.add_cut_remarks(v, ROWS) == 0
    assert v["annotations"] == [{"style": "deduction_reason", "target": "p1_r4", "text": "-1 S.28"}]


def test_a_row_missing_from_the_layout_falls_back_to_the_answer_end():
    v = _verdict([_line(0.0, "Section 27(a) rule not stated (p9_r1)")])
    R.add_cut_remarks(v, ROWS)
    assert _remarks(v) == [("p1_r9", "Section 27(a) rule not stated (-1)")]


def _red_box(page, clip=None):
    pix = page.get_pixmap(dpi=72, clip=clip)
    a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n).astype(int)
    ys, xs = np.nonzero((a[:, :, 0] - a[:, :, 2] > 60) & (a[:, :, 0] > 120))
    return None if not len(xs) else (xs.min(), ys.min(), xs.max(), ys.max())


def _written_copy(width=595.0, height=842.0):
    doc = fitz.open()
    page = doc.new_page(width=width, height=height)
    for i in range(14):
        y = 80 + 50 * i
        page.draw_line(fitz.Point(30, y + 30), fitz.Point(width - 10, y + 30), color=(0.2, 0.2, 0.6), width=8)
    return doc.tobytes()


def test_a_copy_written_to_the_edge_gets_its_remarks_in_a_strip():
    layout = {"pages": [{"page_id": "p1", "width": 595.0, "height": 842.0, "vision_ocr": True,
                         "lines": [{"line_id": f"p1_r{i}", "box": [30.0, 80.0 + 50 * i, 555.0, 40.0],
                                    "text": "answer words"} for i in range(14)]}]}
    verdicts = [_verdict([_line(0.0, "Section 4 definition not stated (p1_r3)"),
                          _line(0.0, "Section 6 lender rule not stated (p1_r6)")],
                         annotations=[{"style": "tick", "target": "p1_r1"},
                                      {"style": "score", "target": "p1_r9", "text": "6/10"}])]
    stored = [dict(v, annotations=list(v["annotations"])) for v in verdicts]
    out = fitz.open(stream=A._render_with_pen(_written_copy(), layout, verdicts), filetype="pdf")
    page = out[0]
    assert page.rect.width > 700                     # the strip was added
    strip = fitz.Rect(600, 0, page.rect.width, page.rect.height)
    box = _red_box(page, clip=strip)
    assert box is not None                           # remarks and the circled mark are in it
    # Both remarks and the ring: red ink down a good part of the strip.
    assert box[3] - box[1] > 120
    # The stored verdicts are not touched.
    assert verdicts == stored
