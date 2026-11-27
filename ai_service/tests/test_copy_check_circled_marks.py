"""Every question's mark circled, as "6/10".

Only about a third of the marks had a loop round them, and none showed the
question's maximum, so a lone "1" in the margin read as a stray digit."""
import fitz
import numpy as np

from app.services.copy_check import annotator as A


def _red_box(page, clip=None):
    pix = page.get_pixmap(dpi=72, clip=clip)
    a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n).astype(int)
    ys, xs = np.nonzero((a[:, :, 0] - a[:, :, 2] > 60) & (a[:, :, 0] > 120))
    return None if not len(xs) else (xs.min(), ys.min(), xs.max(), ys.max())


def test_every_question_mark_is_circled_with_its_maximum():
    doc = fitz.open()
    page = doc.new_page(width=300, height=200)
    A._CLIP[0] = None
    A._PAPER[0] = None
    A._draw_score_badge(page, fitz.Point(150, 100), 1.0, out_of=10.0, radius=20.0)
    x0, y0, x1, y1 = _red_box(page)
    # "1/10" with a loop round it: far wider than the figure alone, and tall.
    assert x1 - x0 > 45 and y1 - y0 > 28
