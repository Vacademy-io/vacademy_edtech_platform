"""Selective Mathpix fallback: re-OCR low-confidence math lines via cropped
images, then re-grade just those questions if their answer hinges on a
mathematically-precise line.

Hard cap: MAX_CROPS_PER_COPY — keeps Mathpix spend bounded per copy.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import tempfile
from pathlib import Path
from typing import Any, Optional

import httpx

from ..mathpix_service import MathpixService
from .raster import capped_zoom

logger = logging.getLogger(__name__)

MAX_CROPS_PER_COPY = 4


class MathpixFallback:
    def __init__(self):
        self.mathpix = MathpixService()
        self._used = 0

    @property
    def used(self) -> int:
        return self._used

    @property
    def can_run(self) -> bool:
        return self._used < MAX_CROPS_PER_COPY

    async def enrich_layout_for_math(self, pdf_url: str, layout_map: dict[str, Any]) -> dict[str, Any]:
        """Find lines flagged needs_math_fallback, re-OCR via Mathpix, replace
        their text with the LaTeX-bearing version. Mutates `layout_map` in place
        and returns it. Capped at MAX_CROPS_PER_COPY total calls per copy."""
        flagged: list[tuple[dict[str, Any], dict[str, Any]]] = []
        for page in layout_map.get("pages", []):
            for line in page.get("lines", []):
                if line.get("needs_math_fallback"):
                    flagged.append((page, line))
        if not flagged:
            return layout_map
        flagged.sort(key=lambda pl: pl[1].get("conf", 0))  # weakest first

        with tempfile.TemporaryDirectory(prefix="mathpix-crops-") as tmp:
            pdf_path = Path(tmp) / "input.pdf"
            await _download(pdf_url, pdf_path)
            page_imgs = await asyncio.get_event_loop().run_in_executor(
                None, _rasterize_pages, pdf_path,
            )
            for page, line in flagged:
                if not self.can_run:
                    logger.info("Mathpix budget exhausted (%d crops), skipping rest", self._used)
                    break
                page_img = page_imgs.get(page["page_id"])
                if page_img is None:
                    continue
                crop_b64 = _crop_to_base64(page_img, line["box"])
                self._used += 1
                try:
                    result = await self.mathpix.ocr_image_base64(crop_b64, mime_type="image/png")
                    text = result.get("latex") or result.get("text") or ""
                    if text.strip():
                        line["text"] = text.strip()
                        line["conf"] = max(line.get("conf", 0), 0.95)
                        line["needs_math_fallback"] = False
                except Exception as e:
                    logger.warning(f"Mathpix crop OCR failed for {line.get('line_id')}: {e}")
        return layout_map


async def _download(url: str, dest: Path) -> None:
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            with dest.open("wb") as f:
                async for chunk in resp.aiter_bytes(chunk_size=1 << 16):
                    f.write(chunk)


def _rasterize_pages(pdf_path: Path, max_edge: Optional[int] = None) -> dict[str, Any]:
    """Return {page_id: PIL.Image} for all pages of the PDF at 200 DPI.

    `max_edge` caps each image's long edge (raster.py) for a caller that only
    cuts pages by share of their size; without it the images stay at 200 DPI,
    the scale of the layout's pixel boxes, which the crops here rely on.

    Handles all PyMuPDF colorspaces (gray/RGB/CMYK) since PDFs in the wild
    aren't always sRGB. A naive Image.frombytes("RGB", …) corrupts the buffer
    for pix.n != 3.
    """
    import fitz  # PyMuPDF
    from PIL import Image

    out: dict[str, Any] = {}
    doc = fitz.open(pdf_path)
    try:
        for i, page in enumerate(doc):
            zoom = capped_zoom(page.rect, 200, max_edge) if max_edge else 200 / 72.0
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            mode_map = {1: "L", 3: "RGB", 4: "CMYK"}
            mode = mode_map.get(pix.n)
            if mode is None:
                # Drop alpha or unknown channels via an intermediate RGB pixmap.
                pix_rgb = fitz.Pixmap(fitz.csRGB, pix)
                img = Image.frombytes("RGB", (pix_rgb.width, pix_rgb.height), pix_rgb.samples)
            else:
                img = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
                if mode != "RGB":
                    img = img.convert("RGB")
            out[f"p{i + 1}"] = img
    finally:
        doc.close()
    return out


def _crop_to_base64(img, box: list[int]) -> str:
    from PIL import Image  # noqa: F401  — typed via duck typing

    x, y, w, h = box
    pad = 6
    left = max(0, x - pad)
    top = max(0, y - pad)
    right = min(img.width, x + w + pad)
    bottom = min(img.height, y + h + pad)
    crop = img.crop((left, top, right, bottom))
    buf = io.BytesIO()
    crop.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")
