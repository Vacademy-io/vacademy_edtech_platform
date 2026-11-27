"""The marking strip added beside a page written to the edge.

The strip was added to the canvas, but the paper mask the pen checks is
measured from the photograph and knew nothing of it: every remark written
there was refused as off the paper and drawn with nothing showing. A copy
whose rows run to the sheet's edge now gets the strip, and its pen works there."""
import fitz
import numpy as np

from app.services.copy_check import annotator as A


def test_the_strip_is_paper_to_the_pen():
    rows = {"mask": np.zeros((100, 60), bool), "lo": np.full(100, -1.0), "hi": np.full(100, -1.0),
            "sx": 10.0, "sy": 10.0, "rows": 100, "cols": 60}
    rows["mask"][:, :40] = True
    out = A._with_strip(rows, 400.0, fitz.Rect(0, 50, 590, 900))
    assert A._on_paper(out, fitz.Rect(420, 300, 580, 340))
    assert not A._on_paper(out, fitz.Rect(420, 920, 580, 960))   # below the sheet
    assert not A._on_paper(rows, fitz.Rect(420, 300, 580, 340))  # the input is not changed


def _layout(right_end, n=12, width=1000.0):
    return {"pages": [{"page_id": "p1", "width": width, "height": 1400.0,
                       "lines": [{"line_id": f"p1_r{i}", "box": [60.0, 100.0 + 60 * i, right_end - 60.0, 40.0],
                                  "text": "x"} for i in range(n)]}]}


def test_only_a_page_written_to_the_edge_gets_a_marking_strip():
    assert A._written_to_the_edge(_layout(right_end=990.0))
    assert not A._written_to_the_edge(_layout(right_end=700.0))
    assert not A._written_to_the_edge({"pages": []})


def test_a_copy_with_room_is_drawn_as_before(monkeypatch):
    seen = []
    monkeypatch.setattr(A, "build_annotated_pdf",
                        lambda pdf_bytes, layout_map, verdicts, **kwargs: seen.append(kwargs) or b"%PDF")
    monkeypatch.setattr(A, "shrink_scans", lambda pdf: pdf)
    A._render_with_pen(b"%PDF", _layout(right_end=700.0), [])
    A._render_with_pen(b"%PDF", _layout(right_end=990.0), [])
    assert seen == [{}, {"margin_ratio": A._MARGIN_RATIO}]
