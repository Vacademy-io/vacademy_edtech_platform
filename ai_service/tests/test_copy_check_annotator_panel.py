"""The "Teacher comments outside the copy" template.

The usual checked copy must be untouched by it: same call, same page, and a
failing panel must fall back to the usual copy rather than to no copy at all.
"""
import fitz

from app.services.copy_check import annotator


def _scan() -> tuple[bytes, dict, list]:
    src = fitz.open()
    page = src.new_page(width=595, height=842)
    lines = []
    y = 90
    for i, text in enumerate(["iii) b) The mud on which he stepped.",
                              "iv) According to Griffin the advantage was that he is invisible",
                              "and can take revenge on his landlord."]):
        page.insert_text((48, y), text, fontsize=12, color=(0.1, 0.15, 0.5))
        lines.append({"line_id": f"L{i}", "text": text, "box": [92, (y - 12) * 2, 900, 32]})
        y += 34
    pix = page.get_pixmap(dpi=144)
    scan = fitz.open()
    scan.new_page(width=595, height=842).insert_image(fitz.Rect(0, 0, 595, 842), pixmap=pix)
    layout = {"pages": [{"page_id": "P1", "width": 1190, "height": 1684, "lines": lines}]}
    verdicts = [
        {"question_id": "q1", "question_number": 1, "marks_awarded": 1, "max_marks": 1,
         "feedback": "The footprints were caused by mud.",
         "annotations": [{"target": "L0", "style": "tick"}]},
        {"question_id": "q2", "question_number": 2, "marks_awarded": 1, "max_marks": 2,
         "annotations": [{"target": "L2", "style": "deduction_reason",
                          "text": "Explain both sides directly."}]},
    ]
    return scan.tobytes(), layout, verdicts


def test_usual_copy_is_built_exactly_as_before(monkeypatch):
    calls = []

    def build(pdf_bytes, layout_map, verdicts, **kwargs):
        calls.append(kwargs)
        return b"%PDF-usual"

    monkeypatch.setattr(annotator, "build_annotated_pdf", build)
    monkeypatch.setattr(annotator, "shrink_scans", lambda pdf: pdf)

    for placement in (None, "", "INSIDE", "garbage"):
        assert annotator._render_sync(b"%PDF", {}, [], placement, {"q1": "1"}) == b"%PDF-usual"
    # No template arguments reach the usual render.
    assert calls == [{}, {}, {}, {}]


def test_a_failing_panel_falls_back_to_the_usual_copy(monkeypatch):
    calls = []

    def build(pdf_bytes, layout_map, verdicts, **kwargs):
        calls.append(kwargs.get("comment_placement"))
        if kwargs.get("comment_placement") == "OUTSIDE":
            verdicts[0]["annotations"].clear()   # a half-run must not leak into the fallback
            raise RuntimeError("panel broke")
        assert verdicts[0]["annotations"], "fallback got the grader's verdicts untouched"
        return b"%PDF-usual"

    monkeypatch.setattr(annotator, "build_annotated_pdf", build)
    monkeypatch.setattr(annotator, "shrink_scans", lambda pdf: pdf)

    verdicts = [{"annotations": [{"style": "tick"}]}]
    assert annotator._render_sync(b"%PDF", {}, verdicts, "OUTSIDE", {}) == b"%PDF-usual"
    assert calls == ["OUTSIDE", None]


def test_outside_widens_the_page_and_types_the_remarks_in_the_panel():
    pdf, layout, verdicts = _scan()
    out = annotator.build_annotated_pdf(pdf, layout, verdicts, comment_placement="OUTSIDE",
                                        question_labels={"q1": "VI(iii)", "q2": "VI(iv)"})
    page = fitz.open(stream=out, filetype="pdf")[0]
    assert round(page.rect.width, 2) == round(595 * (1 + annotator._PANEL_RATIO), 2)
    panel_text = page.get_text("text", clip=fitz.Rect(595, 0, page.rect.width, page.rect.height))
    assert "TEACHER COMMENTS" in panel_text
    assert "Total: 2/3" in panel_text
    assert "VI(iii): 1/1 (Correct)" in panel_text
    assert "VI(iv): 1/2 (Partial)" in panel_text
    assert "Explain both sides directly." in panel_text


def test_outside_lists_why_each_mark_was_cut_once():
    pdf, layout, verdicts = _scan()
    verdicts[1]["criteria_breakdown"] = [
        {"criteria_name": "Content", "marks": 1, "max_marks": 1, "reason": "Both points made."},
        {"criteria_name": "Expression", "marks": 0, "max_marks": 1,
         "reason": "Explain both sides directly."},
    ]
    out = annotator.build_annotated_pdf(pdf, layout, verdicts, comment_placement="OUTSIDE")
    page = fitz.open(stream=out, filetype="pdf")[0]
    panel_text = page.get_text("text", clip=fitz.Rect(595, 0, page.rect.width, page.rect.height))
    assert "Q2: 1/2 (Partial)" in panel_text
    assert "-1 Explain both sides directly." in panel_text  # get_text folds the double space
    # The remark at the deduction repeats the reason: typed once, not twice.
    assert panel_text.count("Explain both sides directly.") == 1
    # A criterion with full marks lost nothing and gets no line.
    assert "Both points made." not in panel_text


def test_outside_keeps_the_feedback_and_a_short_remark_beside_the_cuts():
    pdf, layout, verdicts = _scan()
    verdicts[1]["annotations"] = [{"target": "L2", "style": "margin_note", "text": "Good"}]
    verdicts[1]["feedback"] = "Griffin's advantage is stated."
    verdicts[1]["criteria_breakdown"] = [
        {"criteria_name": "Expression", "marks": 0, "max_marks": 1,
         "reason": "Good start, but explain both sides directly."}]
    out = annotator.build_annotated_pdf(pdf, layout, verdicts, comment_placement="OUTSIDE")
    page = fitz.open(stream=out, filetype="pdf")[0]
    panel_text = page.get_text("text", clip=fitz.Rect(595, 0, page.rect.width, page.rect.height))
    assert "-1 Good start, but explain both sides directly." in panel_text
    # "Good" only occurs inside the reason; it is the teacher's own remark.
    assert "\nGood\n" in panel_text

    verdicts[1]["annotations"] = [{"target": "L2", "style": "cross"}]
    out = annotator.build_annotated_pdf(pdf, layout, verdicts, comment_placement="OUTSIDE")
    page = fitz.open(stream=out, filetype="pdf")[0]
    panel_text = page.get_text("text", clip=fitz.Rect(595, 0, page.rect.width, page.rect.height))
    # No remark: the grader's feedback is typed, as before, under the cuts.
    assert "Griffin's advantage is stated." in panel_text


def test_a_failing_panel_falls_back_to_the_usual_table_copy(monkeypatch):
    from app.services.copy_check import evaluation_table

    def run(placement):
        calls, fills = [], []

        def build(pdf_bytes, layout_map, verdicts, **kwargs):
            if kwargs.get("comment_placement") == "OUTSIDE":
                raise RuntimeError("panel broke")
            calls.append(kwargs)
            return b"%PDF-usual"

        monkeypatch.setattr(annotator, "build_annotated_pdf", build)
        monkeypatch.setattr(annotator, "shrink_scans", lambda pdf: pdf)
        monkeypatch.setattr(evaluation_table, "fill",
                            lambda pdf, layout, table, **k: fills.append((table["rows"][0]["remarks"], k)) or pdf)
        table = {"rows": [{"remarks": ""}], "total": {"obtained": 1, "max": 1}, "located": {"cells": [1]}}
        annotator._render_sync(b"%PDF", {}, [{"max_marks": 1, "annotations": []}], placement, {}, table)
        return calls, fills

    # Exactly what a copy without the template gets: no ring, total in the table.
    assert run("OUTSIDE") == run(None) == ([{"total_ring": False}], [("Total 1/1", {"printed_only": True})])


def test_outside_writes_no_marks_on_the_copy(monkeypatch):
    pdf, layout, verdicts = _scan()
    verdicts[0]["annotations"].append({"target": "L0", "style": "score", "text": "1/1"})
    verdicts[1]["annotations"].append({"target": "L2", "style": "score", "text": "1/2"})
    written = []

    def refuse(name):
        def call(*args, **kwargs):
            written.append(name)
        return call

    for name in ("_draw_grand_total", "_place_question_scores", "_write_point_marks"):
        monkeypatch.setattr(annotator, name, refuse(name))
    for name in ("_place_by_contract", "_place_score_right", "_place_note"):
        monkeypatch.setattr(annotator, name, lambda page, rect, *a, _n=name, **k:
                            written.append((_n, a[0] if a else None)))

    annotator.build_annotated_pdf(pdf, layout, verdicts, comment_placement="OUTSIDE")
    assert written == []

    # The usual copy still writes them.
    annotator.build_annotated_pdf(pdf, layout, verdicts)
    assert "_draw_grand_total" in written and "_place_question_scores" in written


def test_outside_panel_skips_the_printed_evaluation_table(monkeypatch):
    from app.services.copy_check import evaluation_table

    filled = []
    monkeypatch.setattr(annotator, "build_annotated_pdf", lambda *a, **k: b"%PDF-panel")
    monkeypatch.setattr(annotator, "shrink_scans", lambda pdf: pdf)
    monkeypatch.setattr(evaluation_table, "fill", lambda pdf, *a, **k: filled.append(pdf) or pdf)
    table = {"rows": [{"remarks": ""}], "total": {"obtained": 1, "max": 1},
             "located": {"cells": [1]}}
    verdicts = [{"max_marks": 1, "annotations": []}]
    assert annotator._render_sync(b"%PDF", {}, verdicts, "OUTSIDE", {}, table) == b"%PDF-panel"
    assert filled == []
    annotator._render_sync(b"%PDF", {}, verdicts, None, {}, table)
    assert filled


def test_usual_copy_keeps_the_page_size():
    pdf, layout, verdicts = _scan()
    page = fitz.open(stream=annotator.build_annotated_pdf(pdf, layout, verdicts), filetype="pdf")[0]
    assert (page.rect.width, page.rect.height) == (595, 842)
    assert "TEACHER COMMENTS" not in page.get_text()
