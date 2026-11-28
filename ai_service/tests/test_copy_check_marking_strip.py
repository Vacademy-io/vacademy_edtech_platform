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


def test_remarks_run_down_the_strip_in_the_order_of_their_lines(monkeypatch):
    # Written one at a time, a remark that found the strip below its line full
    # climbed above the others: the remark for 2(a)(ii) sat beside 2(a)(i).
    doc = fitz.open()
    page = doc.new_page(width=785, height=842)
    A._CLIP[0] = A._PAPER[0] = None
    A._PLACED[0] = []
    monkeypatch.setattr(A, "_PEN", [A._pen_for(b"%PDF")])  # the copy's pen, as a render sets it
    sheet = fitz.Rect(4, 6, 779, 800)
    ring = fitz.Rect(690, 730, 770, 790)                    # a circled mark at the foot
    rows = [fitz.Rect(40, y, 560, y + 18) for y in (520, 600, 700, 720, 760)]
    items = [(r, f"Remark number {k} about a point the answer left out (-1)") for k, r in enumerate(rows)]
    boxes = A._lay_out_strip(page, list(reversed(items)), sheet, 595.0, [ring])[::-1]
    assert all(b is not None for b in boxes)
    tops = [b.y0 for b in boxes]
    assert tops == sorted(tops)                             # same order as the lines
    assert all(a.y1 <= b.y0 for a, b in zip(boxes, boxes[1:]))
    assert not any(b.intersects(ring) for b in boxes)
    assert boxes[0].y0 >= sheet.y0 and boxes[-1].y1 <= sheet.y1
    # The first remark, with room above the crowd, stays level with its line.
    assert abs(boxes[0].y0 - rows[0].y0) < 200
