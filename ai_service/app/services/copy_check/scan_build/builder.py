"""One PDF per copy from scanned pages (runs in the scan-build worker pool).

Pure CPU work on local files, no network: service.py downloads the sources and
uploads the result. Every page comes out upright with its turn baked in, so the
copy-check engine downstream (which never fixes upside-down pages) sees a normal
copy.

  - JPEG with no EXIF turn: embedded as it is (no re-encode), turned by the page
    matrix; the page size is the scan's real size (pixels / dpi * 72 pt).
  - JPEG with an EXIF turn: transposed, then re-encoded at q88.
  - Any other image (PNG, ...): converted to JPEG q85.
  - PDF page: copied with insert_pdf, then the turn is baked into the content the
    way orientation.apply_rotations does (so /Rotate is 0).
"""
from __future__ import annotations

import io
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# A built copy above this is re-encoded by annotator.shrink_scans; one still
# above HARD_CAP_BYTES is refused (assessment_service and /copy-check/inspect
# refuse anything over 50 / 60 MB).
SIZE_CAP_BYTES = 40 * 1024 * 1024
HARD_CAP_BYTES = 50 * 1024 * 1024
MAX_PAGES_PER_COPY = 200

EXIF_ORIENTATION_TAG = 0x0112
REENCODE_EXIF_QUALITY = 88
CONVERT_QUALITY = 85

COPY_TOO_LARGE = "COPY_TOO_LARGE"
BUILD_FAILED = "BUILD_FAILED"


def _jpeg_bytes(img: Any, quality: int) -> bytes:
    """PIL image -> JPEG bytes (RGB or grey; alpha flattened onto white)."""
    from PIL import Image

    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.split()[-1])
        img = flat
    elif img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=quality, optimize=True)
    return out.getvalue()


def image_stream(data: bytes) -> tuple[bytes, int, int, bool]:
    """(jpeg stream to embed, width px, height px, re-encoded?) for one image file."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(data)) as img:
        orientation = 1
        if img.format == "JPEG":
            try:
                orientation = int(img.getexif().get(EXIF_ORIENTATION_TAG, 1) or 1)
            except Exception:  # noqa: BLE001 - a broken EXIF block means "as stored"
                orientation = 1
            if orientation == 1 and img.mode in ("L", "RGB", "CMYK"):
                width, height = img.width, img.height
                # Decode at 1/8 scale: cheap, and a truncated file fails here
                # instead of reaching the engine as a broken page.
                img.draft(img.mode, (max(1, width // 8), max(1, height // 8)))
                img.load()
                return data, width, height, False
        upright = ImageOps.exif_transpose(img)
        quality = REENCODE_EXIF_QUALITY if img.format == "JPEG" else CONVERT_QUALITY
        return _jpeg_bytes(upright, quality), upright.width, upright.height, True


def _add_image_page(doc: Any, data: bytes, dpi: int, rotation: int) -> None:
    stream, w_px, h_px, _ = image_stream(data)
    width_pt, height_pt = w_px / dpi * 72.0, h_px / dpi * 72.0
    if rotation in (90, 270):
        width_pt, height_pt = height_pt, width_pt
    page = doc.new_page(width=width_pt, height=height_pt)
    # PyMuPDF turns anticlockwise; `rotation` is clockwise.
    page.insert_image(page.rect, stream=stream, rotate=(360 - rotation) % 360)


def _add_pdf_page(doc: Any, src: Any, page_index: int, rotation: int) -> None:
    if page_index >= src.page_count:
        raise ValueError(f"page {page_index} is past the end of a {src.page_count}-page source")
    doc.insert_pdf(src, from_page=page_index, to_page=page_index)
    page = doc[doc.page_count - 1]
    if rotation or page.rotation:
        page.set_rotation((page.rotation + rotation) % 360)
        page.remove_rotation()


def build_pdf(pages: list[dict[str, Any]], sources: dict[str, str]) -> bytes:
    """The copy as PDF bytes. `pages` = [{url, kind, page_index, rotation, dpi}],
    `sources` = {url: local path}. Raises on any unreadable page."""
    import fitz  # PyMuPDF

    doc = fitz.open()
    open_pdfs: dict[str, Any] = {}
    image_cache: dict[str, bytes] = {}
    try:
        for p in pages:
            path = sources[p["url"]]
            rotation = int(p.get("rotation") or 0) % 360
            if p["kind"] == "PDF":
                src = open_pdfs.get(path)
                if src is None:
                    src = fitz.open(path, filetype="pdf")
                    if src.needs_pass:
                        raise ValueError("the source PDF is encrypted")
                    open_pdfs[path] = src
                _add_pdf_page(doc, src, int(p.get("page_index") or 0), rotation)
            else:
                if int(p.get("page_index") or 0) != 0:
                    raise ValueError("an image source has only page 0")
                data = image_cache.get(path)
                if data is None:
                    with open(path, "rb") as f:
                        data = f.read()
                    image_cache[path] = data
                _add_image_page(doc, data, int(p.get("dpi") or 300), rotation)
        return doc.tobytes(deflate=True, garbage=3)
    finally:
        for src in open_pdfs.values():
            src.close()
        doc.close()


def build_copy(pages: list[dict[str, Any]], sources: dict[str, str], out_path: str) -> dict[str, Any]:
    """Pool entry: build one copy into `out_path`. Never raises; returns
    {page_count, bytes, error}."""
    if len(pages) > MAX_PAGES_PER_COPY:
        return {"page_count": 0, "bytes": 0, "error": COPY_TOO_LARGE}
    try:
        pdf = build_pdf(pages, sources)
        if len(pdf) > SIZE_CAP_BYTES:
            from .. import annotator

            pdf = annotator.shrink_scans(pdf, cap_bytes=SIZE_CAP_BYTES)
        if len(pdf) > HARD_CAP_BYTES:
            return {"page_count": 0, "bytes": len(pdf), "error": COPY_TOO_LARGE}
        with open(out_path, "wb") as f:
            f.write(pdf)
        return {"page_count": len(pages), "bytes": len(pdf), "error": None}
    except Exception as e:  # noqa: BLE001 - one bad copy never stops the call
        logger.warning("scan-build: copy failed in %s: %s: %s",
                       os.path.basename(out_path), type(e).__name__, str(e)[:200])
        return {"page_count": 0, "bytes": 0, "error": BUILD_FAILED}
