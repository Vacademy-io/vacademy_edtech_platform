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
