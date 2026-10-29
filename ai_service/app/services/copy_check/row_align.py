"""Which handwritten line an OCR row really sits on.

The layout's row boxes drift from the ink on dense handwriting: on a real essay
copy every row from the fifth line down was boxed one line above its words
(the header rows - name, time, title - took the first boxes), so a language
correction was underlined and written on the line above the wrong word. The
row ORDER is right even when the boxes are not.

So the ink lines are measured off the page (the annotator's ink map) and the
rows are paired with them in order: every uniform shift between the two lists
is scored by how well each row's word count matches the words seen on its
line, with a light pull toward the box position. A pairing is used only when
it moves a row by at most about one line from its box; anything else keeps
the box, as before.
"""
from __future__ import annotations

import re
from typing import Any, Optional

MAX_SHIFT = 6          # rows the two lists may be offset by (header rows, stray ink)
MAX_MOVE_LINES = 1.3   # a row is never moved further than this from its box


def _runs(flags: Any, min_len: int) -> list[tuple[int, int]]:
    out, start = [], None
    for i, f in enumerate(flags):
        if f and start is None:
            start = i
        elif not f and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    if start is not None and len(flags) - start >= min_len:
        out.append((start, len(flags)))
    return out


def ink_lines(ink: Any, min_h: int = 4) -> list[tuple[int, int]]:
    """Row ranges (pixels) of the lines of writing in a boolean ink image."""
    import numpy as np

    if ink is None or getattr(ink, "size", 0) == 0:
        return []
    prof = np.convolve(ink.mean(axis=1), np.ones(3) / 3.0, "same")
    thr = max(float(prof.max()) * 0.18, 0.01)
    lines = _runs(prof > thr, min_h)
    if not lines:
        return []
    # Specks and printed hairlines are not lines of writing.
    heights = sorted(b - a for a, b in lines)
    floor = heights[len(heights) // 2] * 0.4
    return [(a, b) for a, b in lines if b - a >= floor]


def word_count(ink: Any, top: int, bottom: int) -> int:
    """Words on one line of writing: runs of inked columns split by gaps
    wider than about a third of the line height."""
    if bottom <= top:
        return 0
    cols = list(ink[top:bottom].mean(axis=0) > 0.03)
    gap = max(3, int((bottom - top) * 0.35))
    words, in_word, blank = 0, False, 0
    for c in cols:
        if c:
            if not in_word:
                words += 1
                in_word = True
            blank = 0
        elif in_word:
            blank += 1
            if blank >= gap:
                in_word = False
    return words


def pair(rows: list[tuple[str, float, int]], lines: list[tuple[float, float, int]]) -> dict[str, int]:
    """rows: (line_id, box centre, words in its text) in reading order;
    lines: (top, bottom, words seen) of the ink lines in reading order, same
    units. Returns line_id -> index into `lines` for the rows it can place."""
    n, m = len(rows), len(lines)
    if not n or not m:
        return {}
    centres = [(t + b) / 2.0 for t, b, _w in lines]
    unit = (sorted(b - a for a, b in zip(centres, centres[1:]))[(m - 1) // 2]
            if m > 1 else max(1.0, lines[0][1] - lines[0][0]))
    unit = max(unit, 1.0)
    best: Optional[tuple[float, list[tuple[int, int]]]] = None
    for shift in range(-MAX_SHIFT, MAX_SHIFT + 1):
        pairs = [(i, i + shift) for i in range(n) if 0 <= i + shift < m]
        if not pairs or len(pairs) < min(n, m) - MAX_SHIFT:
            continue
        words = sum(abs(rows[i][2] - lines[j][2]) / max(rows[i][2], lines[j][2], 1) for i, j in pairs) / len(pairs)
        drift = sum(abs(rows[i][1] - centres[j]) for i, j in pairs) / len(pairs) / unit
        score = words + 0.05 * drift + 0.02 * (min(n, m) - len(pairs))
        if best is None or score < best[0]:
            best = (score, pairs)
    if best is None:
        return {}
    return {rows[i][0]: j for i, j in best[1] if abs(rows[i][1] - centres[j]) <= MAX_MOVE_LINES * unit}


def row_bands(ink_map: Optional[dict], page_layout: dict[str, Any], layout_to_pt: float) -> dict[str, tuple[float, float]]:
    """line_id -> (top, bottom) in PDF points of the ink line the row's words
    are on, for the student rows of one page. Empty when the ink map is
    missing or nothing could be paired. Never raises."""
    try:
        if not ink_map or ink_map.get("ink") is None:
            return {}
        ink, sy = ink_map["ink"], float(ink_map["sy"])
        rows = [r for r in (page_layout.get("lines") or [])
                if r.get("line_id") and r.get("box") and len(r["box"]) == 4 and not r.get("printed")]
        # Reading order is the row numbering ("p3_r12"); boxes can overlap, so
        # their tops are only used when a row was added outside the numbering.
        numbered = [re.fullmatch(r".*_r(\d+)", str(r["line_id"])) for r in rows]
        if all(numbered):
            rows = [r for _n, r in sorted(zip((int(m.group(1)) for m in numbered), rows), key=lambda t: t[0])]
        else:
            rows.sort(key=lambda r: float(r["box"][1]))
        found = ink_lines(ink)
        if not rows or not found:
            return {}
        lines = [(float(t), float(b), word_count(ink, t, b)) for t, b in found]
        row_keys = [(str(r["line_id"]),
                     (float(r["box"][1]) + float(r["box"][3]) / 2.0) * layout_to_pt / sy,
                     max(1, len(str(r.get("text") or "").split()))) for r in rows]
        return {lid: (lines[j][0] * sy, lines[j][1] * sy) for lid, j in pair(row_keys, lines).items()}
    except Exception:
        return {}
