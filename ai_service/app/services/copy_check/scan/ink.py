"""How much writing is on a page: the colour-aware ink score and blank classes.

Ported from the 2026-11-18 prototype (scantest/tools/assemble.swift,
analysePixels). Luma Y = (299r + 587g + 114b) / 1000. A pixel is "tinted" when
|b - r| >= 25 (blue or red), else neutral.
  - light-blue ruled lines sit at Y 160..230 and the red margin at Y 160..240:
    tinted and lighter than 160, so never ink;
  - show-through from the other side is faint neutral grey at Y >= 180, so
    never ink;
  - ink = neutral and Y < 180 (black pen, grey pencil) OR tinted and Y < 160
    (blue / black pen).
A 2.5% border is ignored (feeder edge shadows). On the test scans the darkest
blank page scored 0.15 ink px per 10k and the faintest written one 10.8.

Resolution matters: the cuts are absolute lumas, and downsampling averages a
thin stroke with the paper around it. A 2 px pencil stroke at Y 170 on a 300
DPI scan is ink there, but rendered at 100 DPI it lands above Y 180 and
vanishes. So pages.py measures ink at the scan's own resolution (capped at
300 DPI, the prototype's), never on a downsampled render.

Blank classes. Only BLANK backs are ever left out of a built copy, so BLANK
must be sure: a page is BLANK only when its ink is below SCAN_BLANK_INK AND it
has no blob of SCAN_BLOB_MM2 or more (one short pencil answer, a lone digit).
Below SCAN_UNSURE_INK it is UNSURE and is kept. numpy + cv2 only (no scipy).
"""
from __future__ import annotations

import cv2
import numpy as np

BLANK = "BLANK"
UNSURE = "UNSURE"
WRITTEN = "WRITTEN"

BORDER_FRAC = 0.025
TINT_DELTA = 25
# Blob dilation radius in mm: 1 px at 100 DPI, 3 px at 300 DPI.
DILATE_MM = 0.254
# Rows per band in ink_mask: bounds the int32 temporaries on a 300 DPI page.
BAND_ROWS = 512
NEUTRAL_INK_Y = 180
TINTED_INK_Y = 160


def luma(rgb: np.ndarray) -> np.ndarray:
    """Integer luma of an RGB uint8 image, as int32."""
    c = rgb.astype(np.int32)
    return (299 * c[..., 0] + 587 * c[..., 1] + 114 * c[..., 2]) // 1000


def tinted(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.int32)
    return np.abs(c[..., 2] - c[..., 0]) >= TINT_DELTA


def ink_mask(rgb: np.ndarray, border_frac: float = BORDER_FRAC) -> np.ndarray:
    """Boolean ink mask of an RGB page; the border band is always False."""
    h, w = rgb.shape[:2]
    mask = np.empty((h, w), bool)
    for y0 in range(0, h, BAND_ROWS):
        band = rgb[y0:y0 + BAND_ROWS]
        y = luma(band)
        t = tinted(band)
        mask[y0:y0 + BAND_ROWS] = (~t & (y < NEUTRAL_INK_Y)) | (t & (y < TINTED_INK_Y))
    by, bx = int(round(h * border_frac)), int(round(w * border_frac))
    if by or bx:
        mask[:by, :] = False
        mask[h - by:, :] = False
        mask[:, :bx] = False
        mask[:, w - bx:] = False
    return mask


def ink_per_10k(mask: np.ndarray, border_frac: float = BORDER_FRAC) -> float:
    """Ink pixels per 10,000 content pixels (content = inside the border)."""
    h, w = mask.shape
    by, bx = int(round(h * border_frac)), int(round(w * border_frac))
    content = max(1, (h - 2 * by) * (w - 2 * bx))
    return float(np.count_nonzero(mask)) * 10000.0 / content


def largest_blob_mm2(mask: np.ndarray, dpi: float) -> float:
    """Area of the largest connected ink blob, in mm², after a DILATE_MM
    dilation (joins a pencil stroke the scanner broke into dots; 1 px at 100
    DPI, 3 px at 300 DPI, so the area means the same at any resolution)."""
    if not mask.any():
        return 0.0
    r = max(1, int(round(DILATE_MM * float(dpi) / 25.4)))
    m = cv2.dilate(mask.astype(np.uint8), np.ones((2 * r + 1, 2 * r + 1), np.uint8), iterations=1)
    count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(m, connectivity=8)
    if count <= 1:
        return 0.0
    largest = int(stats[1:, cv2.CC_STAT_AREA].max())
    mm_per_px = 25.4 / float(dpi)
    return largest * mm_per_px * mm_per_px


def classify(ink: float, blob_mm2: float, blank_ink: float, unsure_ink: float, blob_min_mm2: float) -> str:
    if ink < blank_ink and blob_mm2 < blob_min_mm2:
        return BLANK
    if ink < unsure_ink:
        return UNSURE
    return WRITTEN


def measure(rgb: np.ndarray, dpi: float) -> tuple[float, float]:
    """(ink_per_10k, largest_blob_mm2) of an RGB page rendered at `dpi`."""
    mask = ink_mask(rgb)
    return ink_per_10k(mask), largest_blob_mm2(mask, dpi)
