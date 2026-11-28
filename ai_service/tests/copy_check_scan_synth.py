"""Synthetic scanned answer-sheet pages for the Scan Station tests (no network).

Pages are RGB uint8 at 100 DPI (A4 = 827 x 1169), in the style of
test_copy_check_orientation._written_page: off-white paper, light-blue rules,
a light red margin, and rows of word-like ink blobs. A sheet's back carries a
faint mirrored copy of its front's ink (show-through) plus, optionally, its own
writing in blue pen.
"""
from __future__ import annotations

import io
from typing import Optional

import cv2
import numpy as np

W, H = 827, 1169
PAPER = (242, 242, 240)
RULE = (175, 200, 235)        # light blue: tinted, Y ~ 197
MARGIN = (235, 150, 150)      # light red: tinted, Y ~ 175
BLACK = (35, 35, 35)
BLUE_PEN = (40, 60, 150)
PENCIL = (150, 150, 150)
GHOST = (205, 205, 205)


def paper(rules: bool = True, margin: bool = True) -> np.ndarray:
    page = np.empty((H, W, 3), np.uint8)
    page[:] = PAPER
    if rules:
        for y in range(160, H - 50, 32):
            cv2.line(page, (0, y), (W - 1, y), RULE, 1)
    if margin:
        cv2.line(page, (95, 0), (95, H - 1), MARGIN, 2)
    return page


def write_lines(page: np.ndarray, seed: int, colour=BLACK, top: int = 520, bottom: Optional[int] = None,
                density: float = 1.0) -> np.ndarray:
    """Rows of word-like blobs (thin strokes inside a word box), different per seed."""
    rnd = np.random.default_rng(seed)
    bottom = bottom or H - 80
    for y in range(top, bottom, 32):
        if rnd.random() > density:
            continue
        x = 110 + int(rnd.integers(0, 40))
        end = int(rnd.integers(W // 2, W - 50))
        while x < end:
            w = int(rnd.integers(20, 75))
            for k in range(int(rnd.integers(3, 7))):
                x0 = x + int(rnd.integers(0, max(1, w - 6)))
                cv2.line(page, (x0, y - 4 - int(rnd.integers(0, 14))),
                         (x0 + int(rnd.integers(3, 10)), y - 3), colour, 2)
            cv2.line(page, (x, y - 6), (min(x + w, end), y - 8 - int(rnd.integers(0, 6))), colour, 2)
            x += w + int(rnd.integers(10, 18))
    return page


def label_header(page: np.ndarray, name_seed: int = 0, with_value: bool = True) -> np.ndarray:
    """A printed name field: a ruled box with 'Name' and 'Roll No.' at the top."""
    cv2.rectangle(page, (60, 50), (W - 60, 150), BLACK, 2)
    cv2.line(page, (60, 100), (W - 60, 100), BLACK, 1)
    cv2.putText(page, "Name:", (75, 85), cv2.FONT_HERSHEY_SIMPLEX, 0.8, BLACK, 2)
    cv2.putText(page, "Roll No.:", (75, 135), cv2.FONT_HERSHEY_SIMPLEX, 0.8, BLACK, 2)
    cv2.putText(page, "Class:", (480, 135), cv2.FONT_HERSHEY_SIMPLEX, 0.8, BLACK, 2)
    if with_value:
        rnd = np.random.default_rng(1000 + name_seed)
        x = 190
        for _ in range(int(rnd.integers(5, 9))):
            cv2.line(page, (x, 88), (x + int(rnd.integers(6, 14)), 64 + int(rnd.integers(0, 10))), BLUE_PEN, 2)
            x += int(rnd.integers(14, 24))
    return page


def question_header(page: np.ndarray) -> np.ndarray:
    """No printed field: an answer line that starts 'Name the gas ...'."""
    cv2.putText(page, "Q3. Name the gas given off when", (110, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.9, BLUE_PEN, 2)
    cv2.putText(page, "zinc reacts with acid.", (110, 245), cv2.FONT_HERSHEY_SIMPLEX, 0.9, BLUE_PEN, 2)
    return page


def front_page(seed: int, label: bool, name_seed: int = 0, with_value: bool = True) -> np.ndarray:
    page = paper()
    if label:
        label_header(page, name_seed, with_value)
    return write_lines(page, seed, BLACK, top=200)


def ghost_of(page: np.ndarray, other: np.ndarray, shift=(3, -2)) -> np.ndarray:
    """`page` with the other side's ink showing through faintly, mirrored."""
    c = other.astype(np.int32)
    y = (299 * c[..., 0] + 587 * c[..., 1] + 114 * c[..., 2]) // 1000
    ink = np.ascontiguousarray((y < 120).astype(np.uint8)[:, ::-1])
    m = np.float32([[1, 0, shift[0]], [0, 1, shift[1]]])
    ink = cv2.warpAffine(ink, m, (W, H)) > 0
    out = page.copy()
    out[ink] = np.minimum(out[ink], np.array(GHOST, np.uint8))
    return out


def back_page(front: np.ndarray, seed: int, written: bool, shift=(3, -2)) -> np.ndarray:
    """The back of `front`: faint mirrored show-through, optionally own writing."""
    page = paper()
    if written:
        write_lines(page, seed + 500, BLUE_PEN, top=200, density=0.8)
    return ghost_of(page, front, shift)


def rot180(img: np.ndarray) -> np.ndarray:
    return np.ascontiguousarray(img[::-1, ::-1])


def jpeg_bytes(rgb: np.ndarray, dpi: Optional[int] = 100, quality: int = 90) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    kwargs = {"quality": quality}
    if dpi:
        kwargs["dpi"] = (dpi, dpi)
    Image.fromarray(rgb).save(buf, format="JPEG", **kwargs)
    return buf.getvalue()


def dmap(rgb: np.ndarray) -> np.ndarray:
    """The show-through map pages.features() would keep for this page."""
    from app.services.copy_check.scan import pages, showthrough

    gray75 = pages._resize_to(showthrough.showthrough_gray(rgb), 0.75)
    return showthrough.dark_map(gray75)


def pile(n: int, labels: set[int], written_backs: set[int], seed: int = 7):
    """n sheets: (fronts, backs) RGB lists in physical order."""
    fronts, backs = [], []
    for i in range(n):
        f = front_page(seed * 100 + i, label=i in labels, name_seed=i)
        b = back_page(f, seed * 100 + i, written=i in written_backs)
        # the back's own writing shows through onto the front too
        own_back = write_lines(paper(), seed * 100 + i + 500, BLUE_PEN, top=200, density=0.8)
        fronts.append(ghost_of(f, own_back, (-3, 2)) if i in written_backs else f)
        backs.append(b)
    return fronts, backs
