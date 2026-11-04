"""A sample answer page marked with a chosen pen, so an admin can see the result
before a single copy is checked.

It goes through the real renderer (annotator._render_sync on its one worker), so
what it shows is what a checked copy gets. No model runs and nothing is billed:
the answers and the marks are fixed below.
"""
from __future__ import annotations

import asyncio
import threading
from collections import OrderedDict
from typing import Any, Optional

from . import annotator, hand_render, pen_style

_PAGE_W, _PAGE_H = 1190, 1684    # layout pixels; the PDF page is half of this in points
_LEFT, _TOP, _RULE = 150, 340, 54
_STUDENT_FONT = "ArchitectsDaughter.ttf"
_STUDENT_INK = (24, 34, 92)
_STUDENT_SIZE = 31
_PREVIEW_DPI = 100
_CACHE_SIZE = 32

_ANSWERS: list[tuple[str, list[str]]] = [
    ("Q1. What is photosynthesis? (3)", [
        "Green plants make their own food by photosynthesis.",
        "They use sunlight, water and carbon dioxide for this.",
        "Chlorophyll traps the sunlight.",
    ]),
    ("Q2. Why do we feel cold after a bath? (4)", [
        "Water on our skin takes heat from the body and it",
        "changes into vapour. This cools the skin.",
        "We feel cold because of the air also.",
    ]),
    ("Q3. Define speed. (2)", [
        "Speed is the distance covered in unit time.",
    ]),
    ("Q4. Name the process in which liquid becomes gas. (3)", [
        "The process is called condensation.",
    ]),
]


def _sample() -> tuple[bytes, dict[str, Any], list[dict[str, Any]]]:
    """(the scanned page as a PDF, its layout map, the verdicts)."""
    import fitz
    from PIL import Image, ImageDraw

    page = Image.new("RGBA", (_PAGE_W, _PAGE_H), (253, 252, 248, 255))
    draw = ImageDraw.Draw(page)
    for y in range(_TOP + _RULE, _PAGE_H - 40, _RULE):
        draw.line([(50, y), (_PAGE_W - 50, y)], fill=(190, 208, 228, 255), width=2)
    draw.line([(_LEFT - 20, 0), (_LEFT - 20, _PAGE_H)], fill=(232, 165, 165, 255), width=2)

    hand = hand_render.Pen(seed=7, font=_STUDENT_FONT, slant_deg=0.0, ink=_STUDENT_INK)
    lines: list[dict[str, Any]] = []
    rows: list[list[str]] = []

    def write(text: str, top: int) -> str:
        line_id = f"r{len(lines)}"
        hand.text(page, (_LEFT, top), text, _STUDENT_SIZE)
        # Pinned to the sheet's edge, as the OCR's rows are on real copies.
        lines.append({"line_id": line_id, "text": text, "box": [_LEFT, top, _PAGE_W - _LEFT - 60, _RULE - 12]})
        return line_id

    # The first and last rows are what tell the renderer how far the sheet runs.
    write("Name: Aarav Sharma    Class: 8    Roll No: 14", _RULE + 34)
    y = _TOP
    for head, body in _ANSWERS:
        ids: list[str] = []
        for text in [head, *body]:
            ids.append(write(text, y + 10))
            y += _RULE
        rows.append(ids)
        y += _RULE    # the blank ruled line a student leaves between answers
    write("Page 1", _PAGE_H - 2 * _RULE)

    pix = fitz.Pixmap(fitz.csRGB, _PAGE_W, _PAGE_H, page.convert("RGB").tobytes(), False)
    doc = fitz.open()
    doc.new_page(width=_PAGE_W / 2, height=_PAGE_H / 2).insert_image(
        fitz.Rect(0, 0, _PAGE_W / 2, _PAGE_H / 2), pixmap=pix)
    layout = {"pages": [{"page_id": "P1", "width": _PAGE_W, "height": _PAGE_H, "lines": lines}]}

    def mark(style: str, row: str, **extra: Any) -> dict[str, Any]:
        return {"style": style, "target": row, "page_id": "P1", **extra}

    def score(row: str, text: str) -> dict[str, Any]:
        return mark("score", row, text=text, position="right_margin_same_line")

    def remark(row: str, text: str) -> dict[str, Any]:
        return mark("margin_note", row, text=text, position="below_line_left")

    q1, q2, q3, q4 = rows
    verdicts = [
        {"question_id": "q1", "question_number": 1, "marks_awarded": 3, "max_marks": 3, "annotations": [
            mark("tick", q1[1]), mark("tick", q1[2]), mark("tick", q1[3]),
            remark(q1[3], "Good"), score(q1[3], "3/3")]},
        {"question_id": "q2", "question_number": 2, "marks_awarded": 2, "max_marks": 4, "annotations": [
            mark("tick", q2[2]), mark("underline", q2[3]),
            remark(q2[3], "Long answer needs more elaboration"), score(q2[3], "2/4")]},
        {"question_id": "q3", "question_number": 3, "marks_awarded": 1, "max_marks": 2, "annotations": [
            mark("tick", q3[1]), remark(q3[1], "Formula missing"), score(q3[1], "1/2")]},
        {"question_id": "q4", "question_number": 4, "marks_awarded": 0, "max_marks": 3, "annotations": [
            mark("cross", q4[1]), remark(q4[1], "Evaporation, not condensation"), score(q4[1], "0/3"),
            mark("total", q4[1], text="6/12")]},
    ]
    return doc.tobytes(), layout, verdicts


_scan: list[Optional[tuple[bytes, dict[str, Any], list[dict[str, Any]]]]] = [None]
_cache: "OrderedDict[Optional[pen_style.PenStyle], bytes]" = OrderedDict()
_cache_lock = threading.Lock()


def _render(style: Optional[pen_style.PenStyle]) -> bytes:
    """One preview. Runs on the render worker, like every other render."""
    import copy

    import fitz

    if _scan[0] is None:
        _scan[0] = _sample()
    pdf, layout, verdicts = _scan[0]
    # The renderer writes into what it is given; the sample has to stay as it is.
    marked = annotator._render_sync(pdf, copy.deepcopy(layout), copy.deepcopy(verdicts), pen_style=style)
    with fitz.open(stream=marked, filetype="pdf") as doc:
        return doc[0].get_pixmap(dpi=_PREVIEW_DPI, alpha=False).tobytes("png")


async def render_preview(raw_pen_style: Any) -> bytes:
    """The sample page as a PNG, in the pen described by `raw_pen_style`."""
    style = pen_style.parse(raw_pen_style)
    with _cache_lock:
        hit = _cache.get(style)
        if hit is not None:
            _cache.move_to_end(style)
            return hit
    png = await asyncio.get_running_loop().run_in_executor(annotator._RENDER_POOL, _render, style)
    with _cache_lock:
        _cache[style] = png
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return png
