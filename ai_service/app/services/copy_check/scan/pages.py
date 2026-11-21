"""One scanned file -> small per-page features. Runs in the spawned worker pool.

A pass file is a JPEG/PNG (one page) or a PDF (pages in order). For every
page this keeps only what the analysis needs, never the full-resolution
pixels:
  - the real DPI and where it came from (JFIF / EXIF / PDF / ASSUMED) and the
    page's pixel size at that DPI;
  - the ink score and largest blob (ink.py), measured at the scan's own
    resolution capped at 300 DPI (a downsampled render lightens thin pencil
    strokes past the ink cut, and a written back would come out BLANK);
  - the show-through darkness map (showthrough.py), from a 75 DPI gray render
    of the 100 DPI working render;
  - binarised header maps (headers_guard.py) for the page as scanned and turned
    180°;
  - the top-42% header strips as scanned and turned 180°, as JPEG q70 with the
    long edge <= 1100 px, for the vision model.

Never raises: a file that cannot be read comes back with `error` set.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

from . import headers_guard, ink, showthrough

logger = logging.getLogger(__name__)

WORK_DPI = 100.0                   # show-through and header maps
INK_MAX_DPI = 300.0                # ink: the scan's own DPI, at most this
GRAY_DPI = 75.0
STRIP_LONG_EDGE = 1100
STRIP_QUALITY = 70
DEFAULT_DPI = 300.0
# A scanner page is A4/Letter/Legal; anything far outside means the stated DPI is wrong.
MIN_DPI, MAX_DPI = 50.0, 1200.0
MIN_EDGE_IN, MAX_EDGE_IN = 3.0, 20.0
MAX_PIXELS = 120_000_000           # ~ A3 at 600 DPI; refuse decompression bombs
MAX_PDF_EDGE_PT = 20 * 72          # a PDF page longer than 20 in is not a scan

SRC_JFIF, SRC_EXIF, SRC_PDF, SRC_ASSUMED = "JFIF", "EXIF", "PDF", "ASSUMED"
ERR_UNREADABLE = "unreadable"
ERR_TOO_LARGE = "too_large"


@dataclass
class PageFeatures:
    page_index: int
    dpi: float
    dpi_source: str
    width_px: int
    height_px: int
    ink_per_10k: float
    blob_mm2: float
    dark: np.ndarray            # show-through map, page as scanned
    header_up: np.ndarray       # guard map, page as scanned
    header_down: np.ndarray     # guard map, page turned 180°
    strip_up: bytes             # JPEG, top 42% as scanned
    strip_down: bytes           # JPEG, top 42% of the page turned 180°


@dataclass
class FileResult:
    pages: list[PageFeatures] = field(default_factory=list)
    error: Optional[str] = None
    total_pages: int = 0        # pages in the file (may exceed len(pages) when capped)


def init_worker() -> None:
    """Pool initializer: one OpenCV thread per worker process."""
    try:
        cv2.setNumThreads(1)
    except Exception:  # pragma: no cover
        pass


def _plausible(dpi: Optional[float], w: int, h: int) -> bool:
    if not dpi or not (MIN_DPI <= dpi <= MAX_DPI):
        return False
    long_in = max(w, h) / dpi
    return MIN_EDGE_IN <= long_in <= MAX_EDGE_IN


def image_dpi(im) -> tuple[float, str]:
    """(dpi, source) of a PIL image: JFIF density (any unit, if plausible), then
    EXIF X resolution, then an embedded dpi (PNG pHYs, reported as EXIF), else
    300 ASSUMED."""
    w, h = im.size
    info = im.info or {}
    unit, density = info.get("jfif_unit"), info.get("jfif_density")
    # Unit 0 is "aspect ratio only", but macOS Image Capture (the 2026-11-18
    # Brother scans) writes the real DPI there: density (300, 300), unit 0.
    # The plausibility check below rejects the usual (1, 1) and (72, 72).
    if unit in (0, 1, 2) and density:
        try:
            d = float(density[0]) * (2.54 if unit == 2 else 1.0)
            if _plausible(d, w, h):
                return d, SRC_JFIF
        except (TypeError, ValueError, IndexError):
            pass
    try:
        exif = im.getexif()
        xres = exif.get(282)
        if xres:
            d = float(xres) * (2.54 if exif.get(296, 2) == 3 else 1.0)
            if _plausible(d, w, h):
                return d, SRC_EXIF
    except Exception:  # noqa: BLE001 - broken EXIF is common; fall through
        pass
    d = info.get("dpi")
    if d and im.format != "JPEG":
        try:
            v = float(d[0])
            if _plausible(v, w, h):
                return v, SRC_EXIF
        except (TypeError, ValueError, IndexError):
            pass
    return DEFAULT_DPI, SRC_ASSUMED


def pdf_page_dpi(page) -> tuple[float, str]:
    """Largest embedded image's pixels over the page's size in inches."""
    try:
        images = page.get_images(full=True)
    except Exception:  # noqa: BLE001
        images = []
    best = None
    for img in images:
        w, h = int(img[2] or 0), int(img[3] or 0)
        if w > 0 and h > 0 and (best is None or w * h > best[0] * best[1]):
            best = (w, h)
    rect = page.rect
    if best and rect.width > 0 and rect.height > 0:
        d = max(best) / (max(rect.width, rect.height) / 72.0)
        if MIN_DPI <= d <= MAX_DPI:
            return d, SRC_PDF
    return DEFAULT_DPI, SRC_ASSUMED


def _resize_to(img: np.ndarray, scale: float) -> np.ndarray:
    h, w = img.shape[:2]
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    if (nw, nh) == (w, h):
        return img
    interp = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR
    return cv2.resize(img, (nw, nh), interpolation=interp)


def _jpeg(rgb: np.ndarray) -> bytes:
    h, w = rgb.shape[:2]
    if max(h, w) > STRIP_LONG_EDGE:
        rgb = _resize_to(rgb, STRIP_LONG_EDGE / float(max(h, w)))
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR),
                           [int(cv2.IMWRITE_JPEG_QUALITY), STRIP_QUALITY])
    if not ok:
        raise ValueError("jpeg encode failed")
    return buf.tobytes()


def _strips(rgb: np.ndarray) -> tuple[bytes, bytes]:
    h = rgb.shape[0]
    cut = max(1, int(round(h * headers_guard.HEADER_FRACTION)))
    up = rgb[:cut]
    down = rgb[h - cut:][::-1, ::-1]
    return _jpeg(np.ascontiguousarray(up)), _jpeg(np.ascontiguousarray(down))


def ink_dpi(dpi: float) -> float:
    return min(float(dpi), INK_MAX_DPI)


def features(index: int, rgb_ink: np.ndarray, at_dpi: float, dpi: float, dpi_source: str,
             width_px: int, height_px: int, strip_up: bytes, strip_down: bytes) -> PageFeatures:
    """Everything the analysis keeps about one page, from its render at
    `at_dpi` (= ink_dpi(dpi)). Ink is measured on that render; the maps on a
    100 DPI copy of it. The caller drops the render afterwards."""
    ink_score, blob = ink.measure(rgb_ink, at_dpi)
    rgb100 = _resize_to(rgb_ink, WORK_DPI / at_dpi)
    gray75 = _resize_to(showthrough.showthrough_gray(rgb100), GRAY_DPI / WORK_DPI)
    turned = np.ascontiguousarray(rgb100[::-1, ::-1])
    return PageFeatures(
        page_index=index,
        dpi=round(float(dpi), 1),
        dpi_source=dpi_source,
        width_px=int(width_px),
        height_px=int(height_px),
        ink_per_10k=float(ink_score),
        blob_mm2=float(blob),
        dark=showthrough.dark_map(gray75),
        header_up=headers_guard.header_map(rgb100),
        header_down=headers_guard.header_map(turned),
        strip_up=strip_up,
        strip_down=strip_down,
    )


def _image_file(path: str) -> FileResult:
    from PIL import Image, ImageOps

    with Image.open(path) as im:
        w, h = im.size
        if w * h > MAX_PIXELS:
            return FileResult(error=ERR_TOO_LARGE, total_pages=1)
        dpi, src = image_dpi(im)
        im = ImageOps.exif_transpose(im) or im
        rgb = np.asarray(im.convert("RGB"))
    height_px, width_px = rgb.shape[:2]
    at = ink_dpi(dpi)
    up, down = _strips(rgb)
    rgb = _resize_to(rgb, at / dpi)
    return FileResult(pages=[features(0, rgb, at, dpi, src, width_px, height_px, up, down)], total_pages=1)


def _render(page, dpi: float, clip=None) -> np.ndarray:
    import fitz  # PyMuPDF

    m = fitz.Matrix(dpi / 72.0, dpi / 72.0)
    pix = page.get_pixmap(matrix=m, clip=clip, alpha=False, colorspace=fitz.csRGB)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)
    return np.ascontiguousarray(arr[:, : pix.width * 3].reshape(pix.height, pix.width, 3))


def _pdf_file(path: str, max_pages: int) -> FileResult:
    import fitz  # PyMuPDF

    doc = fitz.open(path)
    try:
        if getattr(doc, "needs_pass", False) and not doc.authenticate(""):
            return FileResult(error=ERR_UNREADABLE)
        total = int(doc.page_count)
        if total <= 0:
            return FileResult(error=ERR_UNREADABLE)
        out = FileResult(total_pages=total)
        for index in range(min(total, max_pages)):
            page = doc[index]
            rect = page.rect
            if max(rect.width, rect.height) > MAX_PDF_EDGE_PT:
                return FileResult(error=ERR_TOO_LARGE, total_pages=total)
            dpi, src = pdf_page_dpi(page)
            at = ink_dpi(dpi)
            rgb = _render(page, at)
            # Strips are rendered from the PDF itself at up to 150 DPI.
            strip_dpi = min(150.0, STRIP_LONG_EDGE / (rect.width / 72.0))
            cut = rect.height * headers_guard.HEADER_FRACTION
            top = _render(page, strip_dpi, fitz.Rect(rect.x0, rect.y0, rect.x1, rect.y0 + cut))
            bottom = _render(page, strip_dpi, fitz.Rect(rect.x0, rect.y1 - cut, rect.x1, rect.y1))
            up = _jpeg(top)
            down = _jpeg(np.ascontiguousarray(bottom[::-1, ::-1]))
            out.pages.append(features(
                index, rgb, at, dpi, src,
                int(round(rect.width / 72.0 * dpi)), int(round(rect.height / 72.0 * dpi)), up, down))
        return out
    finally:
        doc.close()


def extract_file(path: str, kind: str, max_pages: int) -> FileResult:
    """Worker entry point: features of every page of one file (at most
    `max_pages`). Never raises."""
    try:
        if kind == "PDF":
            return _pdf_file(path, max_pages)
        return _image_file(path)
    except Exception as e:  # noqa: BLE001 - one bad file never stops the load
        logger.info("scan pages: %s file unreadable: %s", kind, type(e).__name__)
        return FileResult(error=ERR_UNREADABLE)
