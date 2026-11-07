"""Offline tests for the close-up second reading of maths lines.

Covers what decides whether it helps or hurts a student's mark:
  - maths-looking rows are re-read, flagged by the OCR or not (prose is left alone)
  - the crop spans the whole written line, never just a too-narrow OCR box
  - the full-page reading is NEVER overwritten; a differing close-up is shown
    beside it in the grading prompt
  - a failing call leaves the copy exactly as it was
  - usage reaches the per-copy token sink (billing)

No network. Run:
    cd vacademy_platform/ai_service && PYTHONPATH=.. APP_ENV=local \
        .venv/bin/python tests/test_copy_check_math_reread.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from PIL import Image

from ai_service.app.services.copy_check import math_reread
from ai_service.app.services.copy_check.prompt_builder import _transcript_for_prompt

failures: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  PASS  {label}")
    else:
        failures.append(f"{label}: {detail}")
        print(f"  FAIL  {label} — {detail}")


def _layout() -> dict:
    return {"pages": [{
        "page_id": "p1", "width": 1600, "height": 2200,
        "vision_text": "x² + 1/x² = 27",
        "lines": [
            {"line_id": "p1_r1", "box": [150, 200, 1200, 60], "text": "(ii) Troposphere", "needs_math_fallback": True},
            {"line_id": "p1_r2", "box": [325, 400, 42, 43], "text": "x² + 1/x² = 27", "needs_math_fallback": True},
            {"line_id": "p1_r3", "box": [541, 600, 167, 48], "text": "n = 161/3 + 3", "needs_math_fallback": True},
            {"line_id": "p1_r4", "box": [200, 800, 900, 50], "text": "a = 3/2 d", "needs_math_fallback": False},
            {"line_id": "p1_r5", "box": [200, 900, 900, 50], "text": "", "illegible": True, "needs_math_fallback": True},
            {"line_id": "p1_r6", "box": [200, 1000, 900, 50], "text": "Find the value of x = 2", "printed": True},
        ],
    }]}


def test_mathy() -> None:
    print("\nlooks_mathy — real flagged rows from prod copies")
    for text in ("x² + 1/x² = 27", "n = 164/3", "(x - 1/x)^2 = 5^2", "a10 = a + [10+1]d", "= 1", "= 350 km", "∴ x = 5",
                 "3/2 d - 2d = 1 => -1/2 d = -1", "Area (Δ ADE) = AD", "OA=OC (Radii of the same circle"):
        check(f"maths: {text!r}", math_reread.looks_mathy(text))
    for text in ("(ii) Troposphere", "to vote.", "etc.", "DATE NO 880",
                 "Regular elections allow people to change their", "Q1", "ans 25. Scarcity means"):
        check(f"prose: {text!r}", not math_reread.looks_mathy(text))


def test_selection() -> None:
    print("\nrows_to_reread — maths rows, flagged or not; never prose, printed or illegible")
    picked = [r["line_id"] for _, r in math_reread.rows_to_reread(_layout())]
    check("prose row skipped even when flagged", "p1_r1" not in picked, str(picked))
    check("unflagged maths row picked", "p1_r4" in picked, str(picked))
    check("illegible row skipped", "p1_r5" not in picked, str(picked))
    check("printed question row skipped", "p1_r6" not in picked, str(picked))
    check("maths rows picked in page order", picked == ["p1_r2", "p1_r3", "p1_r4"], str(picked))
    check("cap respected", len(math_reread.rows_to_reread(_layout(), limit=1)) == 1)


def test_crop_spans_line() -> None:
    print("\ncrop_box — a 42 px OCR box still yields the whole written line")
    layout = _layout()
    page = layout["pages"][0]
    narrow = page["lines"][1]
    left, top, right, bottom = math_reread.crop_box(page, narrow, (1600, 2200))
    check("starts at the page's writing (x≈150)", left <= 150, str(left))
    check("ends at the page's writing (x≈1350)", right >= 1350, str(right))
    check("pads above for a numerator", top < 400, str(top))
    check("pads below for a denominator", bottom > 443, str(bottom))
    check("clamped to the image", left >= 0 and right <= 1600)


class FakeLLM:
    def __init__(self, replies: dict[str, str], fail: bool = False):
        self.replies = list(replies.values())
        self.calls = 0
        self.fail = fail

    async def chat_completion(self, **kw):
        self.calls += 1
        if self.fail:
            raise RuntimeError("provider down")
        msg = kw["messages"][0]
        assert msg["attachments"][0]["url"].startswith("data:image/png;base64,")
        return {"content": self.replies[self.calls - 1], "usage": {"prompt_tokens": 70, "completion_tokens": 12}}


class Sink:
    def __init__(self):
        self.usages = []

    def add_usage(self, usage):
        self.usages.append(usage)


def _patch_io() -> None:
    async def fake_download(url, dest):
        dest.write_bytes(b"%PDF-1.4")
    math_reread._download = fake_download
    math_reread._rasterize_pages = lambda path: {"p1": Image.new("RGB", (1600, 2200), "white")}


def test_reread_never_overwrites() -> None:
    print("\nreread_math_rows — second reading beside, never instead of, the page read")
    _patch_io()
    layout = _layout()
    # r2's close-up agrees (modulo formatting); r3's differs; r4 agrees.
    llm = FakeLLM({"p1_r2": "x^2 + 1/x^2 = 27", "p1_r3": "n = 164/3", "p1_r4": "a = 3/2 d"})
    sink = Sink()
    n = asyncio.run(math_reread.reread_math_rows("http://x/c.pdf", layout, llm, token_sink=sink))
    rows = {r["line_id"]: r for r in layout["pages"][0]["lines"]}
    check("three maths rows read", n == 3 and llm.calls == 3, f"n={n} calls={llm.calls}")
    check("agreeing close-up adds nothing", "second_reading" not in rows["p1_r2"], str(rows["p1_r2"]))
    check("differing close-up kept as second_reading", rows["p1_r3"].get("second_reading") == "n = 164/3", str(rows["p1_r3"]))
    check("page reading untouched", rows["p1_r3"]["text"] == "n = 161/3 + 3", rows["p1_r3"]["text"])
    check("usage billed to the copy", len(sink.usages) == 3)
    transcript = _transcript_for_prompt(layout)
    check("prompt shows both readings",
          "[p1_r3] n = 161/3 + 3 (close-up reading of the same line: n = 164/3)" in transcript, transcript)


def test_failure_is_harmless() -> None:
    print("\nreread_math_rows — a failing provider changes nothing")
    _patch_io()
    layout = _layout()
    before = [dict(r) for r in layout["pages"][0]["lines"]]
    n = asyncio.run(math_reread.reread_math_rows("http://x/c.pdf", layout, FakeLLM({}, fail=True)))
    check("nothing counted as read", n == 0, str(n))
    check("rows unchanged", layout["pages"][0]["lines"] == before)


def test_crop_takes_stacked_fraction() -> None:
    print("\ncrop_box — '= 1' over '30' (a stacked 7/30 split by the OCR) is one close-up")
    page = {"page_id": "p1", "lines": [
        {"line_id": "p1_r10", "box": [300, 1000, 60, 40], "text": "= 1"},
        {"line_id": "p1_r11", "box": [310, 1052, 50, 38], "text": "30"},
        {"line_id": "p1_r12", "box": [150, 1300, 900, 50], "text": "26) Speed: 210/3 = 70 km/h"},
    ]}
    parts = [r["line_id"] for r in math_reread.fraction_parts(page, page["lines"][0])]
    check("denominator row found", parts == ["p1_r11"], str(parts))
    _, top, _, bottom = math_reread.crop_box(page, page["lines"][0], (1600, 2200))
    check("crop reaches below the denominator", bottom >= 1090, str(bottom))
    check("crop stops before the next answer", bottom < 1300, str(bottom))


def test_plausible_reading() -> None:
    print("\nplausible_reading — a close-up of the wrong line is not passed on")
    check("neighbour's label rejected", not math_reread.plausible_reading("25)", "= 1/6 (-3/12 + 5/12)"))
    check("fragment rejected", not math_reread.plausible_reading("30", "= 1/30"))
    check("real re-read kept", math_reread.plausible_reading("= 7/5 x 1/6", "= 1 × 1 / 5 6"))
    check("digit fix kept", math_reread.plausible_reading("n = 164/3", "n = 161/3 + 3"))


def test_nothing_flagged_costs_nothing() -> None:
    print("\nreread_math_rows — no maths rows → no download, no call")
    called = {"download": False}

    async def boom(url, dest):
        called["download"] = True
    math_reread._download = boom
    layout = {"pages": [{"page_id": "p1", "lines": [{"line_id": "p1_r1", "box": [0, 0, 10, 10], "text": "to vote.", "needs_math_fallback": True}]}]}
    llm = FakeLLM({})
    n = asyncio.run(math_reread.reread_math_rows("http://x/c.pdf", layout, llm))
    check("returns 0", n == 0)
    check("no download", not called["download"])
    check("no model call", llm.calls == 0)


if __name__ == "__main__":
    test_mathy()
    test_selection()
    test_crop_spans_line()
    test_crop_takes_stacked_fraction()
    test_reread_never_overwrites()
    test_failure_is_harmless()
    test_plausible_reading()
    test_nothing_flagged_costs_nothing()
    print()
    if failures:
        print(f"{len(failures)} FAILED")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print("all passed")
