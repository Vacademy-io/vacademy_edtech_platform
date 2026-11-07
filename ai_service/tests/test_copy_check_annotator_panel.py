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
    assert "VI(iii): Correct" in panel_text
    assert "VI(iv): Partial" in panel_text
    assert "Explain both sides directly." in panel_text


def test_usual_copy_keeps_the_page_size():
    pdf, layout, verdicts = _scan()
    page = fitz.open(stream=annotator.build_annotated_pdf(pdf, layout, verdicts), filetype="pdf")[0]
    assert (page.rect.width, page.rect.height) == (595, 842)
    assert "TEACHER COMMENTS" not in page.get_text()
