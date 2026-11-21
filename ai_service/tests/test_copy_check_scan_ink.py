"""Scan Station ink score and blank classes (scan/ink.py). Synthetic pages, no network.

What matters: only BLANK backs are ever left out of a copy, so nothing a
student wrote may come out BLANK — not grey pencil, not blue pen, not one lone
digit — while ruled lines, the red margin and show-through from the other
side must not count as writing.
"""
from __future__ import annotations

import cv2
import numpy as np

from app.services.copy_check.scan import ink
from copy_check_scan_synth import BLACK, BLUE_PEN, GHOST, PENCIL, H, W, paper, write_lines

BLANK_INK, UNSURE_INK, BLOB = 1.0, 3.0, 4.0


def _cls(page: np.ndarray) -> str:
    score, blob = ink.measure(page, 100)
    return ink.classify(score, blob, BLANK_INK, UNSURE_INK, BLOB)


def test_white_rules_margin_and_ghost_text_are_blank():
    assert _cls(np.full((H, W, 3), 245, np.uint8)) == ink.BLANK
    assert _cls(paper(rules=True, margin=False)) == ink.BLANK
    assert _cls(paper(rules=False, margin=True)) == ink.BLANK
    ghost = write_lines(paper(), seed=4, colour=GHOST, top=150)
    score, _blob = ink.measure(ghost, 100)
    assert score < 0.05
    assert _cls(ghost) == ink.BLANK


def test_pen_and_pencil_are_written():
    for colour in (BLACK, BLUE_PEN, PENCIL):
        page = write_lines(paper(), seed=5, colour=colour, top=200, bottom=500)
        assert _cls(page) == ink.WRITTEN, colour


def test_pencil_luma_is_about_150_and_counts():
    y = ink.luma(np.array([[PENCIL]], np.uint8))[0, 0]
    assert 145 <= y <= 155
    assert ink.ink_mask(np.full((100, 100, 3), PENCIL, np.uint8), border_frac=0.0).all()


def test_lone_small_digit_is_never_blank():
    page = paper()
    # a 3 x 4 mm digit at 100 DPI is about 12 x 16 px
    (tw, th), _ = cv2.getTextSize("8", cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
    assert 10 <= th <= 18, th
    cv2.putText(page, "8", (400, 600), cv2.FONT_HERSHEY_SIMPLEX, 0.55, BLUE_PEN, 2)
    score, blob = ink.measure(page, 100)
    assert score < BLANK_INK * 2
    assert _cls(page) in (ink.UNSURE, ink.WRITTEN), (score, blob)


def test_border_band_is_ignored():
    page = np.full((H, W, 3), 245, np.uint8)
    page[:, :15] = 20            # feeder shadow on the left edge (< 2.5% of 827 px)
    page[H - 20:, :] = 20        # and at the bottom
    assert ink.measure(page, 100)[0] == 0.0
    assert _cls(page) == ink.BLANK


def test_classify_bands():
    assert ink.classify(0.5, 1.0, 1.0, 3.0, 4.0) == ink.BLANK
    assert ink.classify(0.5, 5.0, 1.0, 3.0, 4.0) == ink.UNSURE   # low ink but a real blob
    assert ink.classify(2.0, 0.0, 1.0, 3.0, 4.0) == ink.UNSURE
    assert ink.classify(3.0, 0.0, 1.0, 3.0, 4.0) == ink.WRITTEN


def test_blob_area_in_mm2():
    mask = np.zeros((200, 200), bool)
    mask[50:90, 50:90] = True            # 40 x 40 px at 100 DPI = 10.16 mm square
    area = ink.largest_blob_mm2(mask, 100)
    assert 100 < area < 115              # 103 mm² plus the 1 px dilation ring
    assert ink.largest_blob_mm2(np.zeros((10, 10), bool), 100) == 0.0


def test_blob_dilation_is_physical_not_one_pixel():
    # the same 10 mm square at 100 and 300 DPI: the dilation ring is ~0.25 mm
    # at both, so the area means the same at any resolution
    m100 = np.zeros((200, 200), bool)
    m100[50:90, 50:90] = True
    m300 = np.zeros((600, 600), bool)
    m300[150:270, 150:270] = True
    a100, a300 = ink.largest_blob_mm2(m100, 100), ink.largest_blob_mm2(m300, 300)
    assert abs(a100 - a300) < 1.0, (a100, a300)


def test_banded_mask_matches_whole_page():
    page = write_lines(paper(), seed=9, colour=BLUE_PEN, top=200)
    whole = (~ink.tinted(page) & (ink.luma(page) < ink.NEUTRAL_INK_Y)) | \
            (ink.tinted(page) & (ink.luma(page) < ink.TINTED_INK_Y))
    by, bx = int(round(H * ink.BORDER_FRAC)), int(round(W * ink.BORDER_FRAC))
    whole[:by], whole[H - by:], whole[:, :bx], whole[:, W - bx:] = False, False, False, False
    assert (ink.ink_mask(page) == whole).all()
