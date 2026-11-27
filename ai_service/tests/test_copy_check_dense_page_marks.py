"""Marks on a page written edge to edge.

On a real copy the annotator skipped every tick on the first page (and one or
two on others) because all of its candidate spots had some writing under them,
and squeezed one question's circled score to half size until its "5" read as a
squiggle. The pages looked unchecked. These keep both from coming back, and
keep the guard that never draws a tick off the paper."""
import fitz
import numpy as np
import pytest

from app.services.copy_check import annotator as A


@pytest.fixture
def dense_page():
    doc = fitz.open()
    page = doc.new_page(width=400, height=500)
    A._INK_MAP[0] = {"ink": np.ones((500, 400), dtype=float), "sx": 1.0, "sy": 1.0, "x0": 0}
    A._PAPER[0] = None
    A._PLACED[0] = []
    A._INK_SPAN[0] = None
    A._CLIP[0] = None
    A._ROW_SLOPE[0] = 0.0
    yield page
    A._INK_MAP[0] = None
    A._PLACED[0] = None


def _spy_marks(monkeypatch):
    drawn = []
    monkeypatch.setattr(A, "_draw_tick_or_cross",
                        lambda page, style, cx, cy, size, *a, **k: drawn.append((style, cx, cy, size)))
    return drawn


def test_a_tick_on_a_fully_written_row_is_still_drawn(dense_page, monkeypatch):
    drawn = _spy_marks(monkeypatch)
    A._draw_mark(dense_page, fitz.Rect(40, 200, 360, 220), "tick")
    assert len(drawn) == 1
    style, cx, cy, size = drawn[0]
    assert style == "tick" and 0 <= cx <= 400 - size and 180 <= cy <= 230


def test_a_cross_on_a_fully_written_row_is_still_drawn(dense_page, monkeypatch):
    drawn = _spy_marks(monkeypatch)
    A._draw_mark(dense_page, fitz.Rect(40, 300, 360, 320), "cross")
    assert [d[0] for d in drawn] == ["cross"]


def test_never_off_the_paper(dense_page, monkeypatch):
    drawn = _spy_marks(monkeypatch)
    monkeypatch.setattr(A, "_on_paper", lambda paper, box: False)
    A._draw_mark(dense_page, fitz.Rect(40, 200, 360, 220), "tick")
    assert drawn == []


def test_never_through_a_comment(dense_page, monkeypatch):
    drawn = _spy_marks(monkeypatch)
    A._PLACED[0] = [fitz.Rect(0, 150, 400, 270)]  # a comment across the whole row band
    A._draw_mark(dense_page, fitz.Rect(40, 200, 360, 220), "tick")
    assert drawn == []


def test_a_score_is_never_squeezed_below_a_readable_size(monkeypatch):
    badges = []
    monkeypatch.setattr(A, "_draw_score_badge",
                        lambda page, centre, awarded, out_of=None, radius=15.0: badges.append((centre, radius)))
    A._INK_MAP[0] = None
    A._PLACED[0] = []
    verdicts = [{"question_number": 4, "question_id": "q4", "marks_awarded": 5.0, "max_marks": 10.0,
                 "annotations": []}]

    def place(drawn):
        doc = fitz.open()
        doc.new_page(width=400, height=500)
        A._place_question_scores(doc, {4: (0, 300.0, 200.0)}, verdicts, order={"p1": 0},
                                 drawn={"p1": drawn}, written=set())

    place([])  # nothing on the page: the score's own spot and size
    (centre, base) = badges.pop()
    # Writing everywhere except a hole that only a half-size ring fits in.
    hole = 0.55 * base
    x, y = centre.x, centre.y
    place([fitz.Rect(0, 0, 400, y - hole), fitz.Rect(0, y + hole, 400, 500),
           fitz.Rect(0, y - hole, x - hole, y + hole), fitz.Rect(x + hole, y - hole, 400, y + hole)])
    (_, radius) = badges.pop()
    assert radius >= 0.8 * base
