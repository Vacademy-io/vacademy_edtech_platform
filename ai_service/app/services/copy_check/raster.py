"""How large a copy's page may be drawn as an image.

A phone's "save as PDF" writes each photo at 72 dpi, so the PDF page is the
photo's pixel size in points - a 1899 x 2463 px photo became a 26 x 34 inch
page. Drawn at 200 dpi that is 5275 x 6841 px (36 MP, about 108 MB of RGB) per
page, and the language check holds every page of a copy at once: a 5-page copy
took the ai-service pod past its 3 GiB limit and it was OOM-killed mid-check,
with every other request on it (2026-11-27). The photo itself has only 1899 px
across, so nothing drawn above that is real detail.

The cap is on the image's long edge, and it is applied only where pages are
cut by share of their size (the language check's page images): the layout's
boxes are pixels at 200 dpi, so every crop by box keeps the uncapped image. An
A4 page at 200 dpi (2339 px) is far under it, so ordinary scans are unchanged.
"""
from __future__ import annotations

from typing import Any

MAX_RASTER_EDGE = 3600  # px, long edge of a drawn page


def capped_zoom(rect: Any, dpi: float, max_edge: int = MAX_RASTER_EDGE) -> float:
    """The PyMuPDF zoom for drawing a page of `rect` (points) at `dpi`, lowered
    so the image's long edge stays within `max_edge` pixels."""
    zoom = float(dpi) / 72.0
    longest = max(float(rect.width), float(rect.height), 1.0)
    if longest * zoom > max_edge:
        zoom = max_edge / longest
    return zoom
