"""The teacher's pen on a checked copy: ink colour, handwriting and size.
None everywhere keeps the copy exactly as it has always been drawn."""
import fitz

from app.services.copy_check import annotator, pen_style


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
         "annotations": [{"target": "L0", "style": "tick"},
                         {"target": "L0", "style": "score", "text": "1/1", "page_id": "P1"},
                         {"target": "L0", "style": "total", "text": "2/3"}]},
        {"question_id": "q2", "question_number": 2, "marks_awarded": 1, "max_marks": 2,
         "feedback": "Half the answer.",
         "annotations": [{"target": "L2", "style": "deduction_reason", "page_id": "P1",
                          "text": "Explain both sides directly."},
                         {"target": "L2", "style": "score", "text": "1/2", "page_id": "P1"}]},
    ]
    return scan.tobytes(), layout, verdicts


def test_pen_style_parse_defaults_to_none():
    assert pen_style.parse(None) is None
    assert pen_style.parse({}) is None
    assert pen_style.parse({"ink": "RED", "font": "DAWNING_OF_A_NEW_DAY", "size": "MEDIUM", "darkness": 50}) is None
    assert pen_style.parse({"ink": "nonsense", "font": "?", "size": "HUGE"}) is None


def test_pen_style_parse_presets_and_hex():
    s = pen_style.parse({"ink": "blue", "font": "patrick_hand", "size": "LARGE"})
    assert s.ink == pen_style.PRESET_INKS["BLUE"]
    assert s.font_file == "PatrickHand.ttf"
    assert s.scale == pen_style.SIZES["LARGE"]
    h = pen_style.parse({"ink": "#00ff80"})
    assert h.ink == (0.0, 1.0, round(128 / 255, 4))


def test_colour_falls_back_outside_a_render():
    assert pen_style.colour((1, 0, 0)) == (1, 0, 0)
    with pen_style.applied(pen_style.parse({"ink": "BLACK"})):
        assert pen_style.colour((1, 0, 0)) == pen_style.PRESET_INKS["BLACK"]
        assert pen_style.ink_255() is not None
    assert pen_style.colour((1, 0, 0)) == (1, 0, 0)


def _ink_share(pdf: bytes, rgb_test) -> int:
    page = fitz.open(stream=pdf, filetype="pdf")[0]
    pix = page.get_pixmap(dpi=60)
    n = 0
    s = pix.samples
    for i in range(0, len(s), pix.n):
        if rgb_test(s[i], s[i + 1], s[i + 2]):
            n += 1
    return n


def test_blue_pen_draws_blue_not_red():
    pdf, layout, verdicts = _scan()
    usual = annotator._render_sync(pdf, layout, [dict(v) for v in verdicts])
    blue = annotator._render_sync(pdf, layout, [dict(v) for v in verdicts], None, None, None,
                                  pen_style.parse({"ink": "BLUE"}))
    reddish = lambda r, g, b: r > 150 and g < 110 and b < 120
    blueish = lambda r, g, b: b > 110 and r < 90 and g < 120 and b - r > 50
    assert _ink_share(usual, reddish) > 20
    assert _ink_share(blue, reddish) < _ink_share(usual, reddish) / 4
    assert _ink_share(blue, blueish) > _ink_share(usual, blueish)
