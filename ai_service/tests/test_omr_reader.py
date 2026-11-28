"""OMR reader round trip: draw a filled sheet, read it back with the vendored OMRChecker.

The sheet is drawn here with the same millimetre geometry assessment_service's
OmrSheetLayout prints (markers, roll grid, set grid, LARGE question rows), and the
template is built with the same formulas OmrSheetLayout.toTemplate() uses - so this
exercises everything the ai_service side does with a real sheet: marker search,
warp, orientation, bubble reading, multi-mark and low-confidence reporting.

Needs opencv, numpy, pymupdf and OMRChecker's own deps (see requirements.txt).

Run from the repo root:
    <venv>/bin/python -m pytest ai_service/tests/test_omr_reader.py -q
"""
from __future__ import annotations

import math
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")
pytest.importorskip("dotmap")

from app.services.omr import reader  # noqa: E402

# ---- geometry: mirrors OmrSheetLayout (assessment_service) -------------------

PAGE_W, PAGE_H = 210.0, 297.0
INSET = 10.0
MARKER = {"outer_mm": 8.0, "inner_mm": 5.2, "core_mm": 2.4, "pad_mm": 1.5}
PX_PER_MM = 6.0
SAMPLE = 0.8

ROLL_X0, ROLL_ROW0_Y, ROLL_COL_PITCH, ROLL_ROW_PITCH, ROLL_BUBBLE = 16, 66, 6.5, 5.0, 4.2
SET_X0, SET_ROW_Y, SET_PITCH, SET_BUBBLE = 128, 66, 7.0, 4.6
Q_TOP, Q_BOTTOM, Q_LEFT, Q_RIGHT = 120, 278, 16, 196
LARGE = {"columns": 4, "bubble": 4.4, "pitch": 6.2, "row_pitch": 6.0, "label_width": 9.0}
ORIENTATION_BAR = (20, 12.5, 14, 3)
NAME_BOX = (16, 38, 104, 10)
LETTERS = "ABCDE"


def tx(x):
    return (x - INSET) * PX_PER_MM


def ty(y):
    return (y - INSET) * PX_PER_MM


def layout(roll_digits, set_codes, option_counts):
    roll = [[(ROLL_X0 + ROLL_COL_PITCH * c + ROLL_COL_PITCH / 2, ROLL_ROW0_Y + ROLL_ROW_PITCH * d, ROLL_BUBBLE, str(d))
             for d in range(10)] for c in range(roll_digits)]
    sets = ([(SET_X0 + 3 + SET_PITCH * i, SET_ROW_Y, SET_BUBBLE, code) for i, code in enumerate(set_codes)]
            if len(set_codes) > 1 else [])
    dens = LARGE
    rows_max = math.floor((Q_BOTTOM - Q_TOP) / dens["row_pitch"])
    rows = min(rows_max, math.ceil(len(option_counts) / dens["columns"]))
    col_w = dens["label_width"] + 5 * dens["pitch"]
    gap = (Q_RIGHT - Q_LEFT - dens["columns"] * col_w) / (dens["columns"] - 1)
    questions = []
    for i, n in enumerate(option_counts):
        col, row = divmod(i, rows)
        col_x = Q_LEFT + col * (col_w + gap)
        cy = Q_TOP + dens["row_pitch"] * (row + 0.5)
        questions.append([(col_x + dens["label_width"] + dens["pitch"] * k + dens["pitch"] / 2, cy, dens["bubble"], LETTERS[k])
                          for k in range(n)])
    return roll, sets, questions


def origin(b):
    half = b[2] * SAMPLE / 2
    return [round(tx(b[0] - half)), round(ty(b[1] - half))]


def sample(d):
    return round(d * SAMPLE * PX_PER_MM)


def template(roll, sets, questions):
    blocks = {"Roll": {
        "origin": origin(roll[0][0]),
        "fieldLabels": [f"roll{c + 1}" for c in range(len(roll))],
        "bubbleValues": [str(d) for d in range(10)],
        "direction": "vertical",
        "bubblesGap": ROLL_ROW_PITCH * PX_PER_MM,
        "labelsGap": ROLL_COL_PITCH * PX_PER_MM,
        "bubbleDimensions": [sample(ROLL_BUBBLE)] * 2,
    }}
    if sets:
        blocks["Set"] = {
            "origin": origin(sets[0]), "fieldLabels": ["set"], "bubbleValues": [s[3] for s in sets],
            "direction": "horizontal", "bubblesGap": SET_PITCH * PX_PER_MM, "labelsGap": 0,
            "bubbleDimensions": [sample(SET_BUBBLE)] * 2,
        }
    for no, q in enumerate(questions, start=1):
        blocks[f"Q{no}"] = {
            "origin": origin(q[0]), "fieldLabels": [f"q{no}"], "bubbleValues": [b[3] for b in q],
            "direction": "horizontal", "bubblesGap": LARGE["pitch"] * PX_PER_MM, "labelsGap": 0,
            "bubbleDimensions": [sample(LARGE["bubble"])] * 2,
        }
    return {
        "pageDimensions": [round((PAGE_W - 2 * INSET) * PX_PER_MM), round((PAGE_H - 2 * INSET) * PX_PER_MM)],
        "bubbleDimensions": [sample(LARGE["bubble"])] * 2,
        "emptyValue": "",
        "preProcessors": [{"name": "CropOnMarkers", "options": {
            "relativePath": "marker.png", "sheetToMarkerWidthRatio": round(PAGE_W / (8.0 + 3.0)),
            "marker_rescale_range": [45, 115], "marker_rescale_steps": 14}}],
        "fieldBlocks": blocks,
    }


READER_LAYOUT = {
    "processing_width": 1240, "processing_height": 1754, "render_dpi": 200, "low_margin": 20, "faint_delta": 15,
    "name_box": [tx(NAME_BOX[0]), ty(NAME_BOX[1]), NAME_BOX[2] * PX_PER_MM, NAME_BOX[3] * PX_PER_MM],
    "orientation_box": [tx(ORIENTATION_BAR[0]), ty(ORIENTATION_BAR[1]), ORIENTATION_BAR[2] * PX_PER_MM,
                        ORIENTATION_BAR[3] * PX_PER_MM],
}

# ---- drawing a filled sheet --------------------------------------------------

DPI = 200
PX = DPI / 25.4


def draw_sheet(roll, sets, questions, fills: dict[tuple, int]):
    """fills: (kind, index, value) -> ink gray level (0 = black). kind: roll/set/q."""
    img = np.full((round(PAGE_H * PX), round(PAGE_W * PX)), 255, np.uint8)

    def sq(cx, cy, side, val):
        h = side * PX / 2
        cv2.rectangle(img, (round(cx * PX - h), round(cy * PX - h)), (round(cx * PX + h), round(cy * PX + h)), val, -1)

    for cx, cy in [(INSET, INSET), (PAGE_W - INSET, INSET), (INSET, PAGE_H - INSET), (PAGE_W - INSET, PAGE_H - INSET)]:
        sq(cx, cy, 8.0, 0)
        sq(cx, cy, 5.2, 255)
        sq(cx, cy, 2.4, 0)
    x, y, w, h = ORIENTATION_BAR
    cv2.rectangle(img, (round(x * PX), round(y * PX)), (round((x + w) * PX), round((y + h) * PX)), 0, -1)
    x, y, w, h = NAME_BOX
    cv2.rectangle(img, (round(x * PX), round(y * PX)), (round((x + w) * PX), round((y + h) * PX)), 110, 2)
    cv2.putText(img, "Ravi Kumar", (round((x + 3) * PX), round((y + 7) * PX)), cv2.FONT_HERSHEY_SIMPLEX, 1.4, 30, 3)

    def bubble(b, ink=None):
        c = (round(b[0] * PX), round(b[1] * PX))
        r = round(b[2] / 2 * PX)
        cv2.circle(img, c, r, 140, 2)
        cv2.putText(img, b[3], (c[0] - r // 2, c[1] + r // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.6, 175, 1)
        if ink is not None:
            cv2.circle(img, c, r - 1, ink, -1)

    for ci, col in enumerate(roll):
        for b in col:
            bubble(b, fills.get(("roll", ci, b[3])))
    for b in sets:
        bubble(b, fills.get(("set", 0, b[3])))
    for qi, q in enumerate(questions):
        for b in q:
            bubble(b, fills.get(("q", qi, b[3])))
    return img


def encode_png(img) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


def scanned(img, angle=0.0, scale=1.0, noise=0.0, margin=0):
    """Simulate a scanner / phone: rotate, scale into a larger white canvas, add noise."""
    h, w = img.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, scale)
    out = cv2.warpAffine(img, m, (w, h), borderValue=255)
    if margin:
        out = cv2.copyMakeBorder(out, margin, margin, margin, margin, cv2.BORDER_CONSTANT, value=230)
    if noise:
        rng = np.random.default_rng(7)
        out = np.clip(out.astype(np.float32) + rng.normal(0, noise, out.shape), 0, 255).astype(np.uint8)
    return out


@pytest.fixture(scope="module", autouse=True)
def _worker():
    reader.init_worker()


SET_CODES = ["A", "B", "C"]
OPTION_COUNTS = [4] * 18 + [5, 2]  # 20 questions, one with 5 options, one with 2
ANSWERS = ["A", "B", "C", "D"] * 4 + ["A", "C", "E", "B"]
ROLL = "04271"


def fills_for(roll=ROLL, set_code="B", answers=ANSWERS, ink=20):
    f = {("roll", i, d): ink for i, d in enumerate(roll)}
    if set_code:
        f[("set", 0, set_code)] = ink
    for qi, a in enumerate(answers):
        for letter in a:
            f[("q", qi, letter)] = ink
    return f


def read(img, roll_digits=len(ROLL)):
    roll, sets, questions = layout(roll_digits, SET_CODES, OPTION_COUNTS)
    t = template(roll, sets, questions)
    pages = reader.read_file(encode_png(img), "image", [1], t, MARKER, READER_LAYOUT)
    assert len(pages) == 1
    return pages[0]


def sheet(**kw):
    roll, sets, questions = layout(len(ROLL), SET_CODES, OPTION_COUNTS)
    return draw_sheet(roll, sets, questions, fills_for(**kw))


def answers_of(page):
    return [page.values.get(f"q{i + 1}", "") for i in range(len(OPTION_COUNTS))]


def roll_of(page):
    return "".join(page.values.get(f"roll{i + 1}", "?") or "?" for i in range(len(ROLL)))


def test_clean_scan_reads_everything():
    page = read(sheet())
    assert page.status == "READ", page.error
    assert roll_of(page) == ROLL
    assert page.values.get("set") == "B"
    assert answers_of(page) == ANSWERS
    assert page.low_confidence == []
    assert not page.rotated
    assert page.sheet_pdf and page.marked_jpeg and page.name_crop_jpeg


def test_upside_down_sheet_is_turned():
    page = read(cv2.rotate(sheet(), cv2.ROTATE_180))
    assert page.status == "READ", page.error
    assert page.rotated
    assert roll_of(page) == ROLL
    assert answers_of(page) == ANSWERS


@pytest.mark.parametrize("angle,scale,noise,margin", [(1.5, 1.0, 6, 0), (-2.0, 0.92, 10, 40), (0.5, 0.8, 4, 120)])
def test_skewed_noisy_scans(angle, scale, noise, margin):
    page = read(scanned(sheet(), angle=angle, scale=scale, noise=noise, margin=margin))
    assert page.status == "READ", page.error
    assert roll_of(page) == ROLL
    assert page.values.get("set") == "B"
    assert answers_of(page) == ANSWERS


def test_double_marked_question_reads_both_letters():
    answers = list(ANSWERS)
    answers[2] = "AC"
    page = read(sheet(answers=answers))
    assert page.values.get("q3") == "AC"
    assert answers_of(page)[:2] == ANSWERS[:2] and answers_of(page)[3:] == ANSWERS[3:]


def test_blank_question_and_blank_set():
    answers = list(ANSWERS)
    answers[5] = ""
    page = read(sheet(answers=answers, set_code=None))
    assert page.values.get("q6") == ""
    assert page.values.get("set") == ""


@pytest.mark.parametrize("ink,expected_read,expected_flag", [
    (20, "D", False),    # a proper fill
    (185, "D", False),   # a light but clear fill
    (210, "D", True),    # barely counted: within low_margin of the threshold
    (220, "", True),     # read as blank, yet clearly darker than its row's blanks
])
def test_faint_marks_are_flagged(ink, expected_read, expected_flag):
    roll, sets, questions = layout(len(ROLL), SET_CODES, OPTION_COUNTS)
    f = fills_for()
    for letter in "ABCD":
        f.pop(("q", 7, letter), None)
    f[("q", 7, "D")] = ink
    page = read(draw_sheet(roll, sets, questions, f))
    assert page.status == "READ"
    assert page.values.get("q8") == expected_read
    assert ("q8" in page.low_confidence) is expected_flag
    # nothing else on the sheet is doubtful
    assert set(page.low_confidence) - {"q8"} == set()


def test_page_without_markers():
    page = read(np.full((2339, 1654), 255, np.uint8))
    assert page.status == "NO_MARKERS"
    assert page.sheet_pdf  # the reviewer still gets the page


def test_service_reads_through_the_spawned_pool(monkeypatch):
    """service.read: download -> spawned OMRChecker worker -> uploads -> file ids."""
    import asyncio

    pytest.importorskip("httpx")
    from app.services.omr import service as omr_service

    png = encode_png(sheet())
    uploaded = []

    async def fake_download(url):
        assert url == "https://files.example/sheet.png"
        return png

    async def fake_upload(client, content, filename, content_type):
        uploaded.append((filename, content_type, len(content)))
        return f"file-{len(uploaded)}"

    monkeypatch.setattr(omr_service, "_download", fake_download)
    monkeypatch.setattr(omr_service, "_upload", fake_upload)
    roll, sets, questions = layout(len(ROLL), SET_CODES, OPTION_COUNTS)
    req = {"file_url": "https://files.example/sheet.png", "file_kind": "image", "pages": [1],
           "template": template(roll, sets, questions), "marker": MARKER, "layout": READER_LAYOUT,
           "file_name_prefix": "omr-test"}
    try:
        out = asyncio.run(omr_service.read(req))
        counted = asyncio.run(omr_service.read({**req, "pages": []}))
    finally:
        if omr_service._pool is not None:
            omr_service._pool.shutdown(wait=True)
            omr_service._pool = None
    assert counted == {"page_count": 1, "pages": []}
    assert out["page_count"] == 1
    page = out["pages"][0]
    assert page["status"] == "READ", page["error"]
    assert [page["values"][f"q{i + 1}"] for i in range(len(OPTION_COUNTS))] == ANSWERS
    assert page["sheet_file_id"] and page["marked_file_id"] and page["name_crop_file_id"]
    assert [u[1] for u in uploaded] == ["application/pdf", "image/jpeg", "image/jpeg"]


JAVA_FIXTURE = os.environ.get("OMR_JAVA_FIXTURE_DIR")


@pytest.mark.skipif(not JAVA_FIXTURE, reason="set OMR_JAVA_FIXTURE_DIR (see OmrSheetLayoutTest.writesReaderFixtureWhenAsked)")
def test_java_rendered_sheet():
    """The sheet assessment_service actually prints, filled in at its own template's
    bubble positions, read with its own template: the Java <-> reader contract."""
    import json
    from pathlib import Path

    import fitz

    d = Path(JAVA_FIXTURE)
    tpl = json.loads((d / "template.json").read_text())
    reader_layout = json.loads((d / "reader_layout.json").read_text())
    marker = json.loads((d / "marker.json").read_text())

    doc = fitz.open(d / "sheet.pdf")
    pix = doc[0].get_pixmap(matrix=fitz.Matrix(DPI / 72, DPI / 72), colorspace=fitz.csGRAY)
    img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.stride)[:, : pix.width].copy()

    def fill(block, label_index, value):
        """Ink one bubble: template px -> mm (+ the 10 mm marker inset) -> page px."""
        values = block["bubbleValues"]
        k = values.index(value)
        vertical = block["direction"] == "vertical"
        ox, oy = block["origin"]
        side = block["bubbleDimensions"][0]
        x = ox + (block["labelsGap"] * label_index if vertical else block["bubblesGap"] * k)
        y = oy + (block["bubblesGap"] * k if vertical else block["labelsGap"] * label_index)
        cx_mm = (x + side / 2) / 6.0 + 10.0
        cy_mm = (y + side / 2) / 6.0 + 10.0
        r = side / 0.8 / 6.0 / 2 * PX
        cv2.circle(img, (round(cx_mm * PX), round(cy_mm * PX)), round(r - 1), 25, -1)

    blocks = tpl["fieldBlocks"]
    roll = "052719"
    for i, digit in enumerate(roll):
        fill(blocks["Roll"], i, digit)
    fill(blocks["Set"], 0, "B")
    expected = {}
    for name, block in blocks.items():
        if not name.startswith("Q"):
            continue
        no = int(name[1:])
        letter = block["bubbleValues"][(no * 7) % len(block["bubbleValues"])]
        fill(block, 0, letter)
        expected[f"q{no}"] = letter

    for variant in (img, scanned(img, angle=1.2, scale=0.93, noise=6, margin=30), cv2.rotate(img, cv2.ROTATE_180)):
        pages = reader.read_file(encode_png(variant), "image", [1], tpl, marker, reader_layout)
        page = pages[0]
        assert page.status == "READ", page.error
        assert "".join(page.values[f"roll{i + 1}"] for i in range(len(roll))) == roll
        assert page.values["set"] == "B"
        assert {k: page.values[k] for k in expected} == expected
        assert page.low_confidence == []


def test_pdf_input_page_selection():
    import fitz

    png = encode_png(sheet())
    doc = fitz.open()
    for _ in range(2):
        page = doc.new_page(width=595, height=842)
        page.insert_image(page.rect, stream=png)
    pdf = doc.tobytes()
    assert reader.count_pages(pdf, "pdf") == 2
    roll, sets, questions = layout(len(ROLL), SET_CODES, OPTION_COUNTS)
    pages = reader.read_file(pdf, "pdf", [2], template(roll, sets, questions), MARKER, READER_LAYOUT)
    assert [p.page_no for p in pages] == [2]
    assert pages[0].status == "READ", pages[0].error
    assert answers_of(pages[0]) == ANSWERS
