"""Offline tests for render_worker's line detection (pdf_ocr/layout_ocr.py).

The regression here dropped real answers: RapidOCR's own recognition cutoff
(text_score 0.5) threw away the BOX of any line whose handwriting it read
badly. On a 2026-09-30 copy "ans3. We, the People of India" (score 0.44) and
"ans7. Tigris and Euphrates" (read as empty text) never became rows, the
vision read was never asked about them, and the grader marked both correct
answers "not attempted".

No network, no OCR models - RapidOCR is replaced by a fake. Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_copy_check_layout_ocr.py
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "render_worker"))

import numpy as np

from pdf_ocr import layout_ocr

failures: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        failures.append(f"{label}: {detail}")
        print(f"  FAIL  {label} — {detail}")


def _quad(x: int, y: int, w: int, h: int) -> list:
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]


class _FakeRapid:
    def __init__(self, result):
        self.result = result

    def __call__(self, img, **kwargs):
        return self.result, [0.0]


def _with_rapid(result):
    layout_ocr._rapid_singleton = _FakeRapid(result)


_PAGE = np.zeros((5556, 4167, 3), np.uint8)


def test_unread_lines_keep_their_box() -> None:
    print("\n_rapid_page_lines — a line the recogniser cannot read is still a line")
    _with_rapid([
        (_quad(360, 1268, 1219, 226), "ansae Rule By thefeofle", 0.90),
        (_quad(326, 1571, 1485, 229), "pu togoaf aufd fesue", 0.44),   # ans3
        (_quad(296, 2811, 1543, 159), "", 0.0),                        # ans7
        (_quad(100, 100, 50, 2), "-", 0.95),                           # a speck
    ])
    try:
        lines = layout_ocr._rapid_page_lines(_PAGE, 0)
    finally:
        layout_ocr._rapid_singleton = None
    ys = [ln["box"][1] for ln in lines]
    check("the low-score line is kept", 1571 in ys, str(ys))
    check("the empty-text line is kept", 2811 in ys, str(ys))
    check("a speck under 3px is still dropped", 100 not in ys, str(ys))
    weak = {ln["box"][1]: ln for ln in lines if ln.get("weak_read")}
    check("both unread lines are marked weak_read", set(weak) == {1571, 2811}, str(sorted(weak)))
    check("an unread line carries no garbage text",
          all(ln["text"] == "" for ln in weak.values()), str([ln["text"] for ln in weak.values()]))
    check("unread lines are not sent to Mathpix (its 4-crop budget is unchanged)",
          not any(ln["needs_math_fallback"] for ln in weak.values()))
    read = next(ln for ln in lines if ln["box"][1] == 1268)
    check("a read line is unchanged", read["text"] == "ansae Rule By thefeofle"
          and not read.get("weak_read"), str(read))


def test_weak_read_math_line_still_flagged() -> None:
    print("\n_rapid_page_lines — a readable but uncertain line still goes to Mathpix")
    _with_rapid([(_quad(300, 400, 900, 150), "2x + 3 = 7", 0.55)])
    try:
        lines = layout_ocr._rapid_page_lines(_PAGE, 0)
    finally:
        layout_ocr._rapid_singleton = None
    check("0.55 is read, not weak", len(lines) == 1 and not lines[0].get("weak_read"), str(lines))
    check("and is flagged for the math fallback", lines and lines[0]["needs_math_fallback"])


def test_fallback_counts_only_read_lines() -> None:
    print("\nocr_page — a page of unreadable detections still tries PaddleOCR")
    two_read_five_weak = (
        [(_quad(300, 300 + i * 400, 900, 150), "real words", 0.9) for i in range(2)]
        + [(_quad(300, 1500 + i * 400, 900, 150), "", 0.1) for i in range(5)]
    )
    real_paddle = layout_ocr._paddle_page_lines
    try:
        _with_rapid(two_read_five_weak)
        layout_ocr._paddle_page_lines = lambda img, idx: [
            {"line_id": f"L1_{n}", "text": "p", "box": [10, 10 + n * 300, 500, 100],
             "conf": 0.9, "needs_math_fallback": False} for n in range(3)]
        out = layout_ocr.ocr_page(_PAGE, 0)
        check("Paddle wins when it reads more than RapidOCR did",
              len(out) == 3 and out[0]["text"] == "p", f"{len(out)} lines")

        _with_rapid(two_read_five_weak)
        layout_ocr._paddle_page_lines = lambda img, idx: [
            {"line_id": "L1_1", "text": "p", "box": [10, 10, 500, 100],
             "conf": 0.9, "needs_math_fallback": False}]
        out = layout_ocr.ocr_page(_PAGE, 0)
        check("otherwise RapidOCR's lines come back WITH the unread boxes",
              len(out) == 7, f"{len(out)} lines")

        _with_rapid([(_quad(300, 300 + i * 400, 900, 150), "real words", 0.9) for i in range(3)]
                    + [(_quad(300, 2000, 900, 150), "", 0.0)])
        layout_ocr._paddle_page_lines = lambda img, idx: (_ for _ in ()).throw(
            AssertionError("Paddle must not run"))
        out = layout_ocr.ocr_page(_PAGE, 0)
        check("three read lines is enough - no fallback, weak box kept", len(out) == 4, str(len(out)))
    finally:
        layout_ocr._paddle_page_lines = real_paddle
        layout_ocr._rapid_singleton = None


def test_crop_reread_keeps_the_old_cutoff() -> None:
    print("\n_rapid_text_conf — the Paddle-path re-read still ignores reads under 0.5")
    _with_rapid([(_quad(0, 0, 10, 10), "abc", 0.3), (_quad(0, 0, 10, 10), "def", 0.8)])
    try:
        got = layout_ocr._rapid_text_conf(np.zeros((40, 200, 3), np.uint8))
        check("only the confident read counts", got == ("def", 0.8), str(got))
        _with_rapid([(_quad(0, 0, 10, 10), "abc", 0.3)])
        got = layout_ocr._rapid_text_conf(np.zeros((40, 200, 3), np.uint8))
        check("all reads weak -> no second opinion", got is None, str(got))
    finally:
        layout_ocr._rapid_singleton = None


def test_engine_built_without_a_score_cutoff() -> None:
    print("\n_get_rapid — the engine hands back every detected box")
    seen: dict = {}

    class _Recorder:
        def __init__(self, **kwargs):
            seen.update(kwargs)

    fake = types.ModuleType("rapidocr_onnxruntime")
    fake.RapidOCR = _Recorder
    real = sys.modules.get("rapidocr_onnxruntime")
    sys.modules["rapidocr_onnxruntime"] = fake
    layout_ocr._rapid_singleton = None
    try:
        layout_ocr._get_rapid()
        check("constructed with text_score=0", seen.get("text_score") == 0.0, str(seen))
    finally:
        layout_ocr._rapid_singleton = None
        if real is not None:
            sys.modules["rapidocr_onnxruntime"] = real
        else:
            sys.modules.pop("rapidocr_onnxruntime", None)


if __name__ == "__main__":
    test_unread_lines_keep_their_box()
    test_weak_read_math_line_still_flagged()
    test_fallback_counts_only_read_lines()
    test_crop_reread_keeps_the_old_cutoff()
    test_engine_built_without_a_score_cutoff()

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("All copy-check layout OCR tests passed.")
