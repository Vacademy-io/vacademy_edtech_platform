"""Which back belongs to which front: show-through pairing.

Writing on one side of a sheet shows faintly through on the other side,
mirrored left-right (the sheet is turned like a book page between the two
passes). So a front's darkness map correlates with its own back's map once the
back is turned upright and mirrored, and not with any other back's. Ported
from the 2026-11-18 prototype (assemble.swift, showThroughScore), which paired
6 of 6 sheets on the reversed diagonal of the live test.

dark_map: 3% crop, a fixed 600x848 grid, residual = max(0, blur(g, 8) - g)
(darkness against the local paper level; clipped like the prototype so faint
show-through counts about as much as strong ink), then a 4x4 mean pool.
Replayed on the 2026-11-18 scans: REVERSED, rot 0, margin ~0.3, 6/6 row maxima.

pair_score: a global alignment (paper shifts a few mm between the passes),
then the page is cut into 4x6 tiles and each tile takes its best
cv2.matchTemplate TM_CCOEFF_NORMED within +-2 cells of it (absorbs feeder
skew); the score is the mean over tiles.

choose_layout scores only the diagonals of the four layouts {back rot 0, 180} x
{SAME j=i, REVERSED j=n-1-i}, then a band of +-2 around each chosen partner.
The n x n matrix is never built: at most 4n + 4n pair scores per load.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

from .ink import TINTED_INK_Y, luma, tinted

GRID_W, GRID_H = 600, 848
POOL = 4
CROP_FRAC = 0.03
BLUR_SIGMA = 8
RESIDUAL_CLIP = 40.0
TILES_X, TILES_Y = 4, 6
TILE_SHIFT = 2        # cells searched around the global alignment, per tile
GLOBAL_SHIFT = 6      # cells (~8 mm) searched for the global alignment
BAND = 2              # rows checked on each side of the chosen partner
# A row whose best partner is a neighbour by less than this counts as noise,
# not as evidence of a shifted pile (T6 recalibrates).
SHIFT_MIN_LEAD = 0.02

SAME = "SAME"
REVERSED = "REVERSED"


def showthrough_gray(rgb: np.ndarray) -> np.ndarray:
    """Luma with light tinted pixels (blue rules, red margin) painted over with
    the paper's own level: they are printed identically on every sheet and
    would match any back. (Plain white would leave a dark halo beside every
    rule once the map subtracts the blurred background.)"""
    y = luma(rgb)
    printed = tinted(rgb) & (y >= TINTED_INK_Y)
    if printed.any():
        rest = y[~printed]
        y[printed] = int(np.median(rest)) if rest.size else 255
    return np.clip(y, 0, 255).astype(np.uint8)


def dark_map(gray: np.ndarray) -> np.ndarray:
    """(212, 150) float32 darkness map of a gray page (any size)."""
    h, w = gray.shape[:2]
    cy, cx = int(h * CROP_FRAC), int(w * CROP_FRAC)
    g = gray[cy:h - cy or h, cx:w - cx or w]
    g = cv2.resize(g, (GRID_W, GRID_H), interpolation=cv2.INTER_AREA).astype(np.float32)
    bg = cv2.GaussianBlur(g, (0, 0), BLUR_SIGMA)
    r = np.clip(bg - g, 0.0, RESIDUAL_CLIP)
    m = r.reshape(GRID_H // POOL, POOL, GRID_W // POOL, POOL).mean(axis=(1, 3))
    # No row/column mean removal (the prototype's coarse step): replayed on the
    # 2026-11-18 scans it lost a row-max (5/6), while this plain map gets 6/6.
    return m.astype(np.float32)


def rot180(m: np.ndarray) -> np.ndarray:
    return np.ascontiguousarray(m[::-1, ::-1])


def back_hypothesis(back_map: np.ndarray, rotation: int) -> np.ndarray:
    """A back map turned by `rotation` and mirrored, ready to lie on its front."""
    m = rot180(back_map) if rotation == 180 else back_map
    return np.ascontiguousarray(m[:, ::-1])


def _match_max(image: np.ndarray, templ: np.ndarray) -> tuple[float, tuple[int, int]]:
    if templ.size == 0 or float(templ.std()) < 1e-6:
        return 0.0, (0, 0)
    res = cv2.matchTemplate(image, templ, cv2.TM_CCOEFF_NORMED)
    res = np.nan_to_num(res, nan=0.0, posinf=0.0, neginf=0.0)
    _mn, mx, _mnl, loc = cv2.minMaxLoc(res)
    return float(mx), (loc[1], loc[0])  # (row, col)


def pair_score(front: np.ndarray, back: np.ndarray) -> float:
    """Show-through score of an upright front map and a back hypothesis map."""
    h, w = front.shape
    pad = GLOBAL_SHIFT + TILE_SHIFT
    b = cv2.copyMakeBorder(back, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0.0)
    # global alignment: the whole front slid over the back +-GLOBAL_SHIFT cells
    g = GLOBAL_SHIFT
    _s, (r, c) = _match_max(b[pad - g:pad + h + g, pad - g:pad + w + g], front)
    dy, dx = r - g, c - g
    total = 0.0
    for ty in range(TILES_Y):
        y0, y1 = ty * h // TILES_Y, (ty + 1) * h // TILES_Y
        for tx in range(TILES_X):
            x0, x1 = tx * w // TILES_X, (tx + 1) * w // TILES_X
            s = TILE_SHIFT
            window = b[pad + y0 + dy - s:pad + y1 + dy + s, pad + x0 + dx - s:pad + x1 + dx + s]
            best, _loc = _match_max(window, front[y0:y1, x0:x1])
            total += best
    return total / float(TILES_X * TILES_Y)


@dataclass
class RowCheck:
    pair_score: float
    runner_up: Optional[float]
    is_row_max: bool
    row_max_offset: int        # sheet offset of the best back in the band (0 = its own)
    row_max_lead: float        # best score in the band minus the pair's own score


@dataclass
class Layout:
    backs_order: str
    backs_rotation: int
    order_margin: float
    order_uncertain: bool
    rows: list[RowCheck] = field(default_factory=list)
    shift: Optional[dict] = None              # {"from_sheet": k, "offset": +-1}
    not_row_max: list[int] = field(default_factory=list)
    hypothesis_scores: dict = field(default_factory=dict)

    def partner(self, i: int, n: int) -> int:
        return partner(i, n, self.backs_order)


def partner(i: int, n: int, order: str) -> int:
    return i if order == SAME else n - 1 - i


def choose_layout(
    fronts: list[Optional[np.ndarray]],
    backs: list[Optional[np.ndarray]],
    min_margin: float,
) -> Layout:
    """fronts: upright front maps in scan order; backs: raw back maps in scan
    order (None for an unreadable page). len(fronts) == len(backs) >= 1."""
    n = len(fronts)
    if n == 0 or len(backs) != n:
        raise ValueError("choose_layout needs two passes of the same, non-zero length")
    cache: dict[tuple[int, int, int], float] = {}
    hyp_maps: dict[tuple[int, int], np.ndarray] = {}

    def score(i: int, j: int, rot: int) -> float:
        key = (i, j, rot)
        if key not in cache:
            f, b = fronts[i], backs[j]
            if f is None or b is None:
                cache[key] = 0.0
            else:
                if (j, rot) not in hyp_maps:
                    hyp_maps[(j, rot)] = back_hypothesis(b, rot)
                cache[key] = float(pair_score(f, hyp_maps[(j, rot)]))
        return cache[key]

    orders = (SAME, REVERSED) if n > 1 else (SAME,)
    means: dict[tuple[int, str], float] = {}
    for rot in (0, 180):
        for order in orders:
            means[(rot, order)] = sum(score(i, partner(i, n, order), rot) for i in range(n)) / n
    ranked = sorted(means.items(), key=lambda kv: kv[1], reverse=True)
    (best_rot, best_order), best = ranked[0]
    second = ranked[1][1]
    margin = (best - second) / best if best > 0 else 0.0
    uncertain = margin < min_margin
    if uncertain:
        # The 2026-11-18 Brother run reversed the backs; that prior breaks a tie.
        floor = best * (1.0 - min_margin) if best > 0 else float("-inf")
        close = [(h, s) for h, s in ranked if s >= floor]
        rev = [(h, s) for h, s in close if h[1] == REVERSED]
        if rev:
            (best_rot, best_order), _s = rev[0]

    layout = Layout(
        backs_order=best_order,
        backs_rotation=best_rot,
        order_margin=round(max(0.0, margin), 4),
        order_uncertain=uncertain,
        hypothesis_scores={f"rot{r}_{o}": round(s, 4) for (r, o), s in means.items()},
    )

    def sheet_of(j: int) -> int:
        return partner(j, n, best_order)  # the mapping is its own inverse

    for i in range(n):
        p = partner(i, n, best_order)
        own = score(i, p, best_rot)
        others: list[tuple[float, int]] = []
        for d in range(-BAND, BAND + 1):
            j = p + d
            if d == 0 or j < 0 or j >= n:
                continue
            others.append((score(i, j, best_rot), sheet_of(j) - i))
        runner = max(others, key=lambda t: t[0]) if others else None
        if runner is not None and runner[0] > own:
            layout.rows.append(RowCheck(own, runner[0], False, runner[1], runner[0] - own))
        else:
            layout.rows.append(RowCheck(own, runner[0] if runner else None, True, 0, 0.0))

    offsets = [r.row_max_offset if r.row_max_lead >= SHIFT_MIN_LEAD else 0 for r in layout.rows]
    shifted: set[int] = set()
    for k in range(n - 1):
        o = offsets[k]
        if o in (1, -1) and offsets[k + 1] == o:
            layout.shift = {"from_sheet": k, "offset": o}
            j = k
            while j < n and offsets[j] == o:
                shifted.add(j)
                j += 1
            break
    layout.not_row_max = [i for i, r in enumerate(layout.rows) if not r.is_row_max and i not in shifted]
    return layout


def count_calls_bound(n: int) -> int:
    """The most pair_score calls choose_layout makes for n sheets."""
    return 4 * n + 2 * BAND * n
