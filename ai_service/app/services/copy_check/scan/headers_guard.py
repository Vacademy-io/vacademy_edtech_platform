"""Model-free check of the printed name box: does this header look like the others?

The vision model says which fronts carry the printed Name field. Two of its
mistakes are expensive, so a plain picture comparison backs it up:
  - a front it calls PRINTED_FIELD whose header looks unlike every other
    labelled front (an answer line "Name the gas ..." read as a label) gets
    LABEL_UNUSUAL (REVIEW);
  - a BACK whose header looks like the label template means a sheet was turned
    over in the pile (its front was scanned with the backs). Its pages would be
    merged into the wrong student's copy, so BACK_HAS_LABEL is a BLOCK.

Maps: the top 42% of the upright page, as an ink mask (ink.py), pooled to
~4 px cells at 100 DPI on a fixed 200x120 grid and binarised. The template is
the per-cell median of the labelled fronts' maps, which keeps the printed box
and drops each student's handwriting.
"""
from __future__ import annotations

from typing import Optional, Sequence

import cv2
import numpy as np

from .ink import ink_mask

HEADER_FRACTION = 0.42
MAP_W, MAP_H = 200, 120
BIN_THRESHOLD = 0.02
SHIFT = 4          # cells searched each way (~4 mm), for paper offset
BLUR_SIGMA = 1.0


def header_region(rgb: np.ndarray) -> np.ndarray:
    h = rgb.shape[0]
    return rgb[: max(1, int(round(h * HEADER_FRACTION)))]


def header_map(rgb_upright: np.ndarray) -> np.ndarray:
    """Binarised (120, 200) uint8 map of an upright page's header."""
    mask = ink_mask(header_region(rgb_upright)).astype(np.float32)
    pooled = cv2.resize(mask, (MAP_W, MAP_H), interpolation=cv2.INTER_AREA)
    return (pooled >= BIN_THRESHOLD).astype(np.uint8)


def template(maps: Sequence[np.ndarray]) -> Optional[np.ndarray]:
    if not maps:
        return None
    return np.median(np.stack([m.astype(np.float32) for m in maps]), axis=0).astype(np.float32)


def similarity(templ: Optional[np.ndarray], m: Optional[np.ndarray]) -> Optional[float]:
    """Best normalised correlation of the template with a map within +-SHIFT cells."""
    if templ is None or m is None:
        return None
    a = cv2.GaussianBlur(templ.astype(np.float32), (0, 0), BLUR_SIGMA)
    b = cv2.GaussianBlur(m.astype(np.float32), (0, 0), BLUR_SIGMA)
    inner = a[SHIFT:-SHIFT, SHIFT:-SHIFT]
    if float(inner.std()) < 1e-6 or float(b.std()) < 1e-6:
        return 0.0
    res = cv2.matchTemplate(b, inner, cv2.TM_CCOEFF_NORMED)
    res = np.nan_to_num(res, nan=0.0, posinf=0.0, neginf=0.0)
    return round(float(res.max()), 4)
