"""The natural pen, its darkness, the point marks and the pen preview."""
import asyncio

import fitz
from PIL import Image

from app.services.copy_check import annotator, hand_render, pen_preview, pen_style


def _ink_fill(font: str, seed: int = 3) -> tuple[float, int]:
    """(ink fill inside the written box, connected strokes) of one remark."""
    import cv2
    import numpy as np

    page = Image.new("RGBA", (1200, 260), (255, 255, 255, 0))
    hand_render.Pen(seed, font=font).text(page, (60, 90), "Formula missing", 76)
    alpha = np.asarray(page)[..., 3] > 90
    ys, xs = np.where(alpha)
    box = alpha[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    count, _ = cv2.connectedComponents(box.astype("uint8"))
    return float(box.mean()), count - 1


def test_natural_hands_stay_legible():
    # A cursive hand joins its letters, so it is judged on the ink alone.
    for font, min_strokes in (("DawningofaNewDay.ttf", 2), ("CoveredByYourGrace.ttf", 6), ("OvertheRainbow.ttf", 6),
                              ("Caveat.ttf", 6), ("Cedarville-Cursive.ttf", 2)):
        fill, strokes = _ink_fill(font)
        assert fill < 0.30, font
        assert strokes >= min_strokes, font


def test_natural_writing_is_never_the_same_twice():
    def written(seed: int) -> bytes:
        page = Image.new("RGBA", (900, 240), (255, 255, 255, 0))
        hand_render.Pen(seed).text(page, (60, 80), "Formula missing", 60)
        return page.tobytes()

    assert written(1) != written(2)
    assert written(1) == written(1)    # one copy re-draws identically


def test_joined_hand_is_one_steady_pen_line():
    import cv2
    import numpy as np

    page = Image.new("RGBA", (1600, 400), (255, 255, 255, 0))
    pen = hand_render.Pen(4)
    assert pen.joined
    px = pen.fitted_px(70)
    pen.text(page, (80, 90), "long answer needs more", px)
    ink = (np.asarray(page)[..., 3] > 128).astype("uint8")
    assert ink.any()
    widths = cv2.distanceTransform(ink, cv2.DIST_L2, 5)
    ridge = widths[(widths > 0) & (widths == cv2.dilate(widths, np.ones((3, 3), "uint8")))] * 2.0
    # A font swings between hairlines and fat strokes; one pen stays close to its width.
    assert np.percentile(ridge, 90) / max(1.0, np.percentile(ridge, 50)) < 1.6
    assert pen.text_width("long answer", px) > pen.text_width("long", px)


def test_joined_hand_starts_a_remark_in_small_letters_only():
    drawn: list[str] = []

    class Spy:
        def __init__(self, inner):
            self.inner = inner

        def text(self, xy, word, **kw):
            drawn.append(word)
            return self.inner.text(xy, word, **kw)

    original = hand_render.ImageDraw.Draw
    hand_render.ImageDraw.Draw = lambda im, *a: Spy(original(im, *a)) if im.mode == "L" else original(im, *a)
    try:
        for remark in ("Long answer", "HCF wrong", "Q4: missing"):
            page = Image.new("RGBA", (1400, 300), (255, 255, 255, 0))
            hand_render.Pen(2).text(page, (60, 60), remark, 90)
    finally:
        hand_render.ImageDraw.Draw = original
    assert drawn == ["long", "answer", "HCF", "wrong", "Q4:", "missing"]


def test_classic_faces_keep_the_old_setter():
    assert not hand_render.Pen(1, font="Kalam.ttf").natural
    assert hand_render.Pen(1).natural


def test_kalam_stays_a_choice_and_the_default_is_natural():
    assert pen_style.parse({"font": "KALAM"}).font_file == "Kalam.ttf"
    assert pen_style.parse({"font": "DAWNING_OF_A_NEW_DAY"}) is None


def test_darkness_shades_the_ink_within_readable_limits():
    assert pen_style.parse({"darkness": 50}) is None
    assert pen_style.parse({"darkness": True}) is None
    light = pen_style.parse({"ink": "BLUE", "darkness": 0})
    dark = pen_style.parse({"ink": "BLUE", "darkness": 100})
    assert pen_style.parse({"darkness": 900}).darkness == 100
    with pen_style.applied(light):
        pale = pen_style.ink()
    with pen_style.applied(dark):
        deep = pen_style.ink()
    assert sum(pale) > sum(pen_style.PRESET_INKS["BLUE"]) > sum(deep) > 0
    assert max(pale) < 1.0
    with pen_style.applied(pen_style.parse({"darkness": 80})):
        assert pen_style.ink_255() is not None    # a darkness alone still shades the red pen


def test_remark_loses_only_its_last_full_stop():
    assert annotator._pen_remark("Example missing.") == "Example missing"
    assert annotator._pen_remark("Wrong option. Correct: (c)") == "Wrong option. Correct: (c)"
    assert annotator._pen_remark("Exceptions?") == "Exceptions?"


def test_preview_is_a_full_page_and_cached():
    async def run():
        first = await pen_preview.render_preview({"ink": "BLUE"})
        again = await pen_preview.render_preview({"ink": "#173d9e", "size": "MEDIUM"})
        same = await pen_preview.render_preview({"ink": "BLUE"})
        return first, again, same

    first, again, same = asyncio.run(run())
    assert first[:8] == b"\x89PNG\r\n\x1a\n" and first is same and first != again
    pix = fitz.Pixmap(first)
    assert pix.height > pix.width > 600


def _ticks_page(marks: float, ticks: int) -> list:
    """Spot checks of _write_point_marks' rule, by counting ink it adds."""
    drawn: list = []
    original = annotator._pen_text
    annotator._pen_text = lambda *a, **k: drawn.append(a[2])
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    for name, value in (("_PLACED", []), ("_CLIP", None), ("_PAPER", None), ("_INK_MAP", None)):
        getattr(annotator, name)[0] = value
    verdict = {"marks_awarded": marks}
    log = [(verdict, "P1", 0, (200.0, 100.0 + 60.0 * i, 24.0)) for i in range(ticks)]
    try:
        annotator._write_point_marks(doc, log, lambda pid, pno: None)
    finally:
        annotator._pen_text = original
    assert page is not None
    return drawn


def test_point_marks_only_when_they_add_up_to_the_score():
    assert _ticks_page(3, 3) == ["+1", "+1", "+1"]
    assert _ticks_page(3, 2) == []
    assert _ticks_page(2.5, 3) == []
    assert _ticks_page(1, 1) == []


def test_preview_endpoint_answers_a_png_and_needs_the_service_token():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.dependencies import require_internal_service_token
    from app.routers import copy_check as router_mod

    app = FastAPI()
    app.include_router(router_mod.router)
    assert TestClient(app).post("/copy-check/pen-preview", json={}).status_code in (401, 403, 503)

    app.dependency_overrides[require_internal_service_token] = lambda: None
    res = TestClient(app).post("/copy-check/pen-preview", json={"pen_style": {"font": "CAVEAT", "darkness": 80}})
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert res.content[:4] == b"\x89PNG"
    assert TestClient(app).post("/copy-check/pen-preview", json={}).status_code == 200


def _rendered_ink(pen) -> "list":
    """The strongest colours a real render puts on a page beyond the student's own ink."""
    import numpy as np

    pdf, layout, verdicts = pen_preview._sample()
    marked = annotator._render_sync(pdf, layout, verdicts, pen_style=pen_style.parse(pen))
    with fitz.open(stream=marked, filetype="pdf") as doc:
        pix = doc[0].get_pixmap(dpi=100, alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, 3).astype(int)


def test_a_real_copy_is_drawn_in_the_pen_that_was_set():
    """The same dict the Settings page saves and assessment_service sends, through the real render."""
    import numpy as np

    purple = _rendered_ink({"ink": "#7a10b0", "font": "CEDARVILLE_CURSIVE", "size": "LARGE"})
    usual = _rendered_ink(None)
    is_purple = (np.abs(purple[..., 0] - 0x7a) < 45) & (purple[..., 1] < 70) & (np.abs(purple[..., 2] - 0xb0) < 50)
    assert is_purple.sum() > 400
    assert ((np.abs(usual[..., 0] - 0x7a) < 45) & (usual[..., 1] < 70) & (np.abs(usual[..., 2] - 0xb0) < 50)).sum() < 40
    # None of the usual red is left once a colour is chosen.
    assert ((purple[..., 0] > 170) & (purple[..., 1] < 70) & (purple[..., 2] < 80)).sum() < 40

    def ink_amount(pen) -> int:
        page = _rendered_ink(pen)
        return int(((page[..., 0] > 150) & (page[..., 1] < 110) & (page[..., 2] < 110)).sum())

    # Handwriting and darkness each change what lands on the page.
    assert not np.array_equal(_rendered_ink({"font": "KALAM"}), usual)
    assert not np.array_equal(_rendered_ink({"darkness": 90}), usual)
    assert ink_amount(None) > 0


def test_every_font_the_settings_page_offers_exists_and_renders():
    for name, file_name in pen_style.FONTS.items():
        path = hand_render.FONT_DIR / (file_name or hand_render.DEFAULT_FONT)
        assert path.exists(), name
