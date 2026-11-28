"""Last-resort fit for a shot whose text still runs past the canvas edge.

The bbox lint asks the model to fix an overflow; when its corrected HTML still
overflows, the shot used to ship clipped (video feadce4b, 2026-10-27: a list
read "LIMITED COMMUN" at the right edge). This scales the shot's content
uniformly so every measured rect fits, instead.

`#shot-root` clips its own overflow (`overflow:hidden`), so scaling the root
would shrink the clipping box with it. The root's children are wrapped in an
absolutely-positioned `<div data-fit-wrap>` the same size as the root, and the
wrapper is scaled — positions resolve exactly as before, then shrink together.
Child selectors written against the root (`#shot-root > .x`) are rewritten to
step through the wrapper.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Any, Dict, Iterable, List, Optional, Tuple

# Below this the text gets too small to read; better a model regen than a
# postage stamp.
MIN_SCALE = 0.75
# Breathing room inside the canvas once fitted (fraction of each dimension).
MARGIN = 0.02

_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
         "meta", "param", "source", "track", "wbr"}


class _RootFinder(HTMLParser):
    """Offsets of #shot-root's start-tag end and its matching end-tag start."""

    def __init__(self, text: str) -> None:
        super().__init__(convert_charrefs=False)
        self._text = text
        self._line_starts = [0]
        for m in re.finditer("\n", text):
            self._line_starts.append(m.end())
        self.inner_start: Optional[int] = None
        self.inner_end: Optional[int] = None
        self._depth = 0
        self._tag: Optional[str] = None

    def _offset(self) -> int:
        line, col = self.getpos()
        return self._line_starts[line - 1] + col

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        if self.inner_end is not None:
            return
        if self.inner_start is None:
            if dict(attrs).get("id") == "shot-root" and tag not in _VOID:
                raw = self.get_starttag_text() or ""
                self.inner_start = self._offset() + len(raw)
                self._tag, self._depth = tag, 1
            return
        if tag == self._tag:
            self._depth += 1

    def handle_endtag(self, tag: str) -> None:
        if self.inner_start is None or self.inner_end is not None or tag != self._tag:
            return
        self._depth -= 1
        if self._depth == 0:
            self.inner_end = self._offset()


def _bounds(rects: Iterable[Dict[str, Any]], width: int, height: int) -> Tuple[float, float, float, float]:
    left, top, right, bottom = 0.0, 0.0, float(width), float(height)
    for r in rects:
        try:
            left = min(left, float(r["l"]))
            top = min(top, float(r["t"]))
            right = max(right, float(r["r"]))
            bottom = max(bottom, float(r["b"]))
        except (KeyError, TypeError, ValueError):
            continue
    return left, top, right, bottom


def fit_transform(rects: Iterable[Dict[str, Any]], width: int, height: int) -> Optional[Tuple[float, float, float]]:
    """(scale, tx, ty) that brings every rect inside the canvas with a small
    margin, centred on the overflowing content; None when nothing overflows or
    the content would have to shrink below MIN_SCALE."""
    left, top, right, bottom = _bounds(rects, width, height)
    span_w, span_h = right - left, bottom - top
    if span_w <= width + 1 and span_h <= height + 1 and left >= -1 and top >= -1:
        return None
    k = min(width * (1 - 2 * MARGIN) / span_w, height * (1 - 2 * MARGIN) / span_h, 1.0)
    if k < MIN_SCALE:
        return None
    tx = (width - k * span_w) / 2 - k * left
    ty = (height - k * span_h) / 2 - k * top
    return round(k, 4), round(tx, 1), round(ty, 1)


def apply_fit(html: str, scale: float, tx: float, ty: float) -> Optional[str]:
    """Wrap #shot-root's children in a scaled wrapper. None when the shot has
    no #shot-root (nothing safe to wrap)."""
    finder = _RootFinder(html)
    try:
        finder.feed(html)
        finder.close()
    except Exception:  # noqa: BLE001 - malformed markup: leave the shot alone
        return None
    if finder.inner_start is None or finder.inner_end is None:
        return None
    a, b = finder.inner_start, finder.inner_end
    wrap_open = (
        '<div data-fit-wrap style="position:absolute;inset:0;'
        f'transform-origin:0 0;transform:translate({tx}px,{ty}px) scale({scale});">'
    )
    out = html[:a] + wrap_open + html[a:b] + "</div>" + html[b:]
    # Selectors that name the root's direct children step through the wrapper.
    return re.sub(r"#shot-root\s*>\s*(?!\[data-fit-wrap\])", "#shot-root > [data-fit-wrap] > ", out)


def edge_rects(violations: Iterable[Any]) -> List[Dict[str, Any]]:
    """Rects of TEXT running past the canvas edge. Zoned findings (teacher
    area, squeezed text, overlaps) are not fixed by scaling, and media is
    often bled off the edge on purpose (a cropped photo, a Ken Burns pan)."""
    out: List[Dict[str, Any]] = []
    for v in violations:
        get = v.get if isinstance(v, dict) else (lambda k, d=None: getattr(v, k, d))
        zone, rect = get("zone", ""), get("rect", None)
        if not zone and not get("is_media", False) and isinstance(rect, dict):
            out.append(rect)
    return out


__all__ = ["MIN_SCALE", "apply_fit", "edge_rects", "fit_transform"]
