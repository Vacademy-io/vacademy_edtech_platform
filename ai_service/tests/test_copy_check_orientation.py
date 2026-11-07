"""Offline tests for turning sideways / upside-down copies upright (orientation.py).

No network. Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python -m pytest tests/test_copy_check_orientation.py -q
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

import cv2
import numpy as np

from ai_service.app.services.copy_check import orientation as ori


def _written_page(width: int = 850, height: int = 1100, seed: int = 3) -> np.ndarray:
    """A white page with ruled lines and rows of word-like ink blobs, upright."""
    rnd = np.random.default_rng(seed)
    page = np.full((height, width, 3), 235, np.uint8)
    for y in range(120, height - 60, 38):
        cv2.line(page, (0, y), (width - 1, y), (190, 170, 150), 1)
        x = 70
        end = int(rnd.integers(width // 2, width - 40))
        while x < end:
            w = int(rnd.integers(18, 70))
            cv2.rectangle(page, (x, y - 22), (min(x + w, end), y - 6), (60, 40, 30), -1)
            x += w + int(rnd.integers(8, 16))
    return page


def _gray(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def test_axis_upright_sideways_and_blank():
    page = _written_page()
    assert ori.detect_axis(_gray(page)) is False
    assert ori.detect_axis(_gray(ori.rotate_image(page, 180))) is False
    assert ori.detect_axis(_gray(ori.rotate_image(page, 90))) is True
    assert ori.detect_axis(_gray(ori.rotate_image(page, 270))) is True
    blank = np.full((1100, 850), 235, np.uint8)
    assert ori.detect_axis(blank) is None


def test_parse_choice():
    assert ori._parse_choice('{"upright":"A"}') == "A"
    assert ori._parse_choice('```json\n{"upright": "b"}\n```') == "B"
    assert ori._parse_choice("I think A") is None


class _ScriptedLLM:
    """Answers the A/B question from a script; records how often it was asked."""

    def __init__(self, answers: list[str]):
        self.answers = list(answers)
        self.calls = 0

    async def chat_completion(self, messages, temperature, max_tokens, institute_id, model):
        self.calls += 1
        assert len(messages[0]["attachments"]) == 2
        return {"content": '{"upright":"%s"}' % self.answers.pop(0), "usage": {"total_tokens": 10}}


class _Sink:
    def __init__(self):
        self.usages = []

    def add_usage(self, usage):
        self.usages.append(usage)


def test_direction_needs_both_orders_to_agree():
    page = _written_page()
    # first call: candidates (base, base+180); second call: swapped.
    assert asyncio.run(ori.decide_direction(_ScriptedLLM(["A", "B"]), "m", page, 90)) == 90
    assert asyncio.run(ori.decide_direction(_ScriptedLLM(["B", "A"]), "m", page, 90)) == 270
    assert asyncio.run(ori.decide_direction(_ScriptedLLM(["A", "A"]), "m", page, 0)) is None
    sink = _Sink()
    asyncio.run(ori.decide_direction(_ScriptedLLM(["B", "A"]), "m", page, 0, token_sink=sink))
    assert len(sink.usages) == 2


def test_fill_undecided_turns_only_sideways_pages():
    axes = [True, True, True, None, False]
    # page 3 undecided, its sideways peers agree on 270 -> 270; unknown / upright never turned.
    assert ori.fill_undecided(axes, {0: 270, 1: 270}) == {0: 270, 1: 270, 2: 270, 3: 0, 4: 0}
    # an upright page is never turned, even if a stray answer says so.
    assert ori.fill_undecided([False], {0: 180}) == {0: 0}
    # peers split -> stay as uploaded.
    assert ori.fill_undecided([True, True, True], {0: 90, 1: 270})[2] == 0
    # no decided peers -> stay as uploaded.
    assert ori.fill_undecided([True], {})[0] == 0


def _pdf_of(images: list[np.ndarray]) -> bytes:
    import fitz

    doc = fitz.open()
    for img in images:
        ok, png = cv2.imencode(".png", img)
        h, w = img.shape[:2]
        page = doc.new_page(width=w * 0.72, height=h * 0.72)
        page.insert_image(page.rect, stream=png.tobytes())
    return doc.tobytes()


def test_apply_rotations_bakes_upright_pages():
    import fitz

    upright = _written_page()
    pdf = _pdf_of([ori.rotate_image(upright, 90), upright])  # page 1 stored turned clockwise
    out = ori.apply_rotations(pdf, {0: 270})
    doc = fitz.open(stream=out, filetype="pdf")
    try:
        assert [p.rotation for p in doc] == [0, 0]
        assert doc[0].rect.width < doc[0].rect.height  # portrait again
    finally:
        doc.close()
    shown = ori.page_images(out)
    assert ori.detect_axis(_gray(shown[0])) is False


def test_plan_turns_only_the_sideways_page():
    upright = _written_page()
    pdf = _pdf_of([ori.rotate_image(upright, 90), upright, ori.rotate_image(upright, 180)])
    # page 1 (sideways): candidates 90 / 270; truth is 270 -> "B" then "A".
    # pages 2 (upright) and 3 (upside down) are never asked and never turned.
    llm = _ScriptedLLM(["B", "A"])
    assert asyncio.run(ori.plan_rotations(pdf, llm, "m")) == {0: 270}
    assert llm.calls == 2


def test_upright_copy_costs_no_model_call():
    pdf = _pdf_of([_written_page(), _written_page(seed=5)])
    llm = _ScriptedLLM([])
    assert asyncio.run(ori.plan_rotations(pdf, llm, "m")) == {}
    assert llm.calls == 0


def test_straighten_falls_back_to_original_url_on_failure(monkeypatch):
    from ai_service.app.services.copy_check import annotator

    async def boom(url):
        raise RuntimeError("download failed")

    monkeypatch.setattr(annotator, "_fetch_pdf", boom)
    result = asyncio.run(ori.straighten_copy("https://x/copy.pdf", _ScriptedLLM([]), "m"))
    assert result.pdf_url == "https://x/copy.pdf" and not result.changed


def test_straighten_keeps_url_when_nothing_to_turn(monkeypatch):
    from ai_service.app.services.copy_check import annotator

    pdf = _pdf_of([_written_page()])

    async def fetch(url):
        return pdf

    async def no_upload(*a, **k):
        raise AssertionError("must not upload an unchanged copy")

    monkeypatch.setattr(annotator, "_fetch_pdf", fetch)
    monkeypatch.setattr(annotator, "_upload", no_upload)
    result = asyncio.run(ori.straighten_copy("https://x/copy.pdf", _ScriptedLLM([]), "m"))
    assert result.pdf_url == "https://x/copy.pdf" and not result.changed


def test_straighten_gives_up_after_timeout(monkeypatch):
    from ai_service.app.services.copy_check import annotator

    async def slow(url):
        await asyncio.sleep(5)
        return b""

    monkeypatch.setattr(annotator, "_fetch_pdf", slow)
    monkeypatch.setattr(ori, "TIMEOUT_SECONDS", 0.05)
    result = asyncio.run(ori.straighten_copy("https://x/copy.pdf", _ScriptedLLM([]), "m"))
    assert result.pdf_url == "https://x/copy.pdf" and not result.changed


def test_existing_rotate_flag_is_respected():
    import fitz

    upright = _written_page()
    # Stored sideways but flagged /Rotate 90 by a scanner app: it already shows upright.
    doc = fitz.open(stream=_pdf_of([ori.rotate_image(upright, 270)]), filetype="pdf")
    doc[0].set_rotation(90)
    shows_upright = doc.tobytes()
    assert asyncio.run(ori.plan_rotations(shows_upright, _ScriptedLLM([]), "m")) == {}

    # Flagged /Rotate 90 but the content still shows sideways: turned on top of the flag.
    doc = fitz.open(stream=_pdf_of([upright]), filetype="pdf")
    doc[0].set_rotation(90)
    shows_sideways = doc.tobytes()
    # shown turned 90 clockwise; the fix is 270 -> "B" then "A".
    rotations = asyncio.run(ori.plan_rotations(shows_sideways, _ScriptedLLM(["B", "A"]), "m"))
    assert rotations == {0: 270}
    fixed = ori.apply_rotations(shows_sideways, rotations)
    out = fitz.open(stream=fixed, filetype="pdf")
    assert out[0].rotation == 0
    assert ori.detect_axis(_gray(ori.page_images(fixed)[0])) is False
