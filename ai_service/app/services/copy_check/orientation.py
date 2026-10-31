"""Turn sideways answer-sheet pages the right way up before anything reads
the copy.

Why this exists
---------------
Copies arrive as phone photos (WhatsApp, camera scans) and a large share are
shot with the phone held sideways: the page is stored turned 90 degrees.
`render_worker`'s deskew only corrects a few degrees of tilt and PaddleOCR's
angle classifier only flips single upside-down lines, so a sideways page went
through the whole pipeline sideways. The vision read still mostly worked, but
OCR boxes came out as page-tall slivers, so ticks, notes and marks were drawn
in the wrong places and the checked copy itself was sideways (2026-10-26:
3 of 4 phone-photo copies in one batch).

How
---
Per page, two cheap steps:

  1. **Sideways?** (no model): handwriting lines and notebook rulings are long
     horizontal structures on an upright page. Smear the ink along x and add
     up the width of the long, thin blobs; do the same on the page turned 90
     degrees. A page is sideways only when the vertical total beats the
     horizontal one SIDEWAYS_MIN_RATIO times. Measured 2026-10-26 on 140 real
     pages: the 14 sideways ones won by 11.9x to 17,000x, and none of the 126
     upright ones won at all.
  2. **Which way** (vision model, sideways pages only): turned 90 or 270
     degrees. The model is shown both and asked which reads the right way up,
     twice with the order swapped; the answer counts only when both agree
     (production request shape: 0 wrong on 17 pages x 4 rotations).

Pages that are not clearly sideways are never sent to the model and never
turned. That includes upside-down pages: asking the model about every upright
page flipped a correctly scanned one (both swapped answers agreed, wrongly),
so 0-vs-180 is deliberately not attempted and an upright copy goes through
exactly as before this step. A sideways page the model cannot settle follows
the other sideways pages of the copy when they clearly agree, and is otherwise
left as uploaded.

If any page needs turning, the rotation is baked into a new PDF (no
re-encode; `remove_rotation` rewrites the content so page coordinates match
what is shown) and that copy is uploaded. Every later step (OCR, vision read,
annotator) then works on the upright copy, and the checked copy comes out
upright too. Any failure here returns the original URL: straightening is an
improvement, never a reason to fail a copy.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Long edge (px) the page is analysed at; ~100 dpi on A4, enough for line structure.
ANALYSIS_EDGE = 1200
# Long edge of each image shown to the vision model.
MODEL_IMAGE_EDGE = 768
# The winning axis must have this many times more line width than the other.
AXIS_MIN_RATIO = 1.5
# A page counts as sideways only with this much more vertical line width.
SIDEWAYS_MIN_RATIO = 4.0
# Pages beyond this are left as they are (the cost and time stay bounded).
MAX_PAGES = 60
# Concurrent model calls per copy.
MODEL_CONCURRENCY = 4
# The whole step gives up after this long and the copy is checked as uploaded.
TIMEOUT_SECONDS = 120.0

DIRECTION_PROMPT = (
    "You are shown two images, A (the first image) and B (the second image). They are the same "
    "handwritten answer-sheet page, and one of them is turned upside down. Which one shows the "
    "writing the right way up, so it reads normally left to right and top to bottom? "
    'Reply with JSON only: {"upright":"A"} or {"upright":"B"}.'
)


@dataclass
class OrientationResult:
    pdf_url: str
    # page index (0-based) -> clockwise degrees applied; only turned pages are listed.
    rotations: dict[int, int] = field(default_factory=dict)
    file_id: Optional[str] = None

    @property
    def changed(self) -> bool:
        return bool(self.rotations)


# ---------------------------------------------------------------------------
# Pure image analysis
# ---------------------------------------------------------------------------

def _ink(gray: Any) -> Any:
    """Binary ink mask, robust to uneven phone lighting (background-subtracted Otsu)."""
    import cv2

    h, w = gray.shape[:2]
    scale = ANALYSIS_EDGE / float(max(h, w))
    if scale < 1.0:
        gray = cv2.resize(gray, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    background = cv2.medianBlur(gray, 31)
    diff = cv2.subtract(background, gray)
    _, binary = cv2.threshold(diff, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    return binary


def _line_width(binary: Any) -> int:
    """Total width of long, thin horizontal blobs once the ink is smeared along x."""
    import cv2

    width = binary.shape[1]
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(9, width // 80), 1))
    smeared = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    count, _labels, stats, _ = cv2.connectedComponentsWithStats(smeared)
    total = 0
    for i in range(1, count):
        _x, _y, w, h, _area = stats[i]
        if w > width // 20 and w > 5 * h:
            total += int(w)
    return total


def detect_axis(gray: Any) -> Optional[bool]:
    """True = the lines run vertically (page is sideways), False = horizontally,
    None = cannot tell (blank page, a full-page diagram, too little writing)."""
    import cv2

    binary = _ink(gray)
    horizontal = _line_width(binary)
    vertical = _line_width(cv2.rotate(binary, cv2.ROTATE_90_CLOCKWISE))
    ratio = (max(horizontal, vertical) + 1) / float(min(horizontal, vertical) + 1)
    if ratio < AXIS_MIN_RATIO:
        return None
    if vertical > horizontal:
        return True if ratio >= SIDEWAYS_MIN_RATIO else None
    return False


def rotate_image(img: Any, clockwise: int) -> Any:
    import cv2

    codes = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}
    code = codes.get(clockwise % 360)
    return img if code is None else cv2.rotate(img, code)


def _encode(img: Any, edge: int = MODEL_IMAGE_EDGE) -> str:
    import cv2

    h, w = img.shape[:2]
    scale = edge / float(max(h, w))
    if scale < 1.0:
        img = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        raise RuntimeError("could not encode page image")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def _parse_choice(content: str) -> Optional[str]:
    match = re.search(r'"upright"\s*:\s*"([ABab])"', content or "")
    return match.group(1).upper() if match else None


def fill_undecided(axes: list[Optional[bool]], decided: dict[int, int]) -> dict[int, int]:
    """Rotation (clockwise degrees) for every page.

    Only sideways pages (axis True) are ever turned. A sideways page keeps the
    model's answer; one the model could not settle takes the rotation the
    other decided sideways pages got when that is a clear majority (more than
    half of them), and otherwise stays as uploaded (0).
    """
    out: dict[int, int] = {}
    for index, sideways in enumerate(axes):
        if sideways is not True:
            out[index] = 0
            continue
        if index in decided:
            out[index] = decided[index]
            continue
        peers = [deg for i, deg in decided.items() if axes[i] is True]
        if peers:
            deg, votes = Counter(peers).most_common(1)[0]
            if votes * 2 > len(peers):
                out[index] = deg
                continue
        out[index] = 0
    return out


# ---------------------------------------------------------------------------
# Model step
# ---------------------------------------------------------------------------

async def _ask(llm: Any, model: str, first_b64: str, second_b64: str,
               institute_id: Optional[str], token_sink: Optional[Any]) -> Optional[str]:
    messages = [{
        "role": "user",
        "content": DIRECTION_PROMPT,
        "attachments": [
            {"type": "image", "url": f"data:image/jpeg;base64,{first_b64}"},
            {"type": "image", "url": f"data:image/jpeg;base64,{second_b64}"},
        ],
    }]
    response = await llm.chat_completion(
        messages=messages, temperature=0.0, max_tokens=300,
        institute_id=institute_id, model=model,
    )
    if token_sink is not None and response.get("usage"):
        try:
            token_sink.add_usage(response["usage"])
        except Exception:
            logger.debug("token sink rejected orientation usage", exc_info=True)
    return _parse_choice(response.get("content") or "")


async def decide_direction(llm: Any, model: str, img: Any, base: int,
                           institute_id: Optional[str] = None,
                           token_sink: Optional[Any] = None) -> Optional[int]:
    """`base` or `base + 180` (clockwise degrees), whichever reads upright, or None
    when the two swapped questions do not agree."""
    a_deg, b_deg = base % 360, (base + 180) % 360
    a = _encode(rotate_image(img, a_deg))
    b = _encode(rotate_image(img, b_deg))
    first, second = await asyncio.gather(
        _ask(llm, model, a, b, institute_id, token_sink),
        _ask(llm, model, b, a, institute_id, token_sink),
    )
    # first: "A" means a_deg is upright; second (order swapped): "B" means a_deg.
    if first == "A" and second == "B":
        return a_deg
    if first == "B" and second == "A":
        return b_deg
    return None


# ---------------------------------------------------------------------------
# PDF in, PDF out
# ---------------------------------------------------------------------------

def page_images(pdf_bytes: bytes, max_pages: int = MAX_PAGES) -> list[Any]:
    """Each page as shown (its /Rotate applied) as a BGR array at ~ANALYSIS_EDGE."""
    return [img for img, _axis in _scan_pages(pdf_bytes, max_pages, keep_edge=ANALYSIS_EDGE)]


def _scan_pages(pdf_bytes: bytes, max_pages: int = MAX_PAGES,
                keep_edge: int = MODEL_IMAGE_EDGE) -> list[tuple[Any, Optional[bool]]]:
    """(page image as shown, axis) per page. The axis is measured on the
    ANALYSIS_EDGE render and only a `keep_edge` copy is kept, so a long copy
    never holds every page at full analysis size in memory."""
    import cv2
    import fitz  # PyMuPDF
    import numpy as np

    out: list[tuple[Any, Optional[bool]]] = []
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        for index, page in enumerate(doc):
            if index >= max_pages:
                break
            rect = page.rect
            zoom = min(4.0, ANALYSIS_EDGE / float(max(rect.width, rect.height) or 1))
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False, colorspace=fitz.csRGB)
            arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
            img = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
            axis = detect_axis(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
            h, w = img.shape[:2]
            scale = keep_edge / float(max(h, w))
            if scale < 1.0:
                img = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
            out.append((img, axis))
    finally:
        doc.close()
    return out


def apply_rotations(pdf_bytes: bytes, rotations: dict[int, int]) -> bytes:
    """A new PDF with each listed page turned clockwise by its degrees, baked
    into the content so /Rotate is 0 and page coordinates match the view."""
    import fitz  # PyMuPDF

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        for index, degrees in rotations.items():
            if degrees % 360 == 0:
                continue
            page = doc[index]
            page.set_rotation((page.rotation + degrees) % 360)
            page.remove_rotation()
        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()


async def plan_rotations(pdf_bytes: bytes, llm: Any, model: str,
                         institute_id: Optional[str] = None,
                         token_sink: Optional[Any] = None) -> dict[int, int]:
    """{page index: clockwise degrees} for the pages that need turning."""
    scanned = await asyncio.to_thread(_scan_pages, pdf_bytes)
    images = [img for img, _axis in scanned]
    axes = [axis for _img, axis in scanned]

    gate = asyncio.Semaphore(MODEL_CONCURRENCY)

    async def _one(index: int) -> tuple[int, Optional[int]]:
        async with gate:
            try:
                return index, await decide_direction(llm, model, images[index], 90, institute_id, token_sink)
            except Exception as e:  # one page failing must not stop the rest
                logger.warning("orientation: page %d direction check failed: %s", index + 1, e)
                return index, None

    sideways = [i for i, axis in enumerate(axes) if axis is True]
    if not sideways:
        return {}
    answers = await asyncio.gather(*(_one(i) for i in sideways))
    decided = {i: deg for i, deg in answers if deg is not None}
    final = fill_undecided(axes, decided)
    logger.info("orientation: axes=%s decided=%s final=%s",
                ["side" if a else ("up" if a is False else "?") for a in axes], decided, final)
    return {i: deg for i, deg in final.items() if deg % 360}


async def straighten_copy(pdf_url: str, llm: Any, model: str, *,
                          institute_id: Optional[str] = None,
                          token_sink: Optional[Any] = None,
                          label: str = "copy") -> OrientationResult:
    """The URL of a copy with its sideways pages turned upright: the original
    URL when no page is clearly sideways or anything goes wrong."""
    try:
        return await asyncio.wait_for(
            _straighten(pdf_url, llm, model, institute_id, token_sink, label), TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning("orientation: gave up after %.0fs, checking the copy as uploaded", TIMEOUT_SECONDS)
        return OrientationResult(pdf_url=pdf_url)


async def _straighten(pdf_url: str, llm: Any, model: str, institute_id: Optional[str],
                      token_sink: Optional[Any], label: str) -> OrientationResult:
    from . import annotator
    from ..media_file_client import get_public_file_url

    try:
        pdf_bytes = await annotator._fetch_pdf(pdf_url)
        rotations = await plan_rotations(pdf_bytes, llm, model, institute_id, token_sink)
        if not rotations:
            return OrientationResult(pdf_url=pdf_url)
        upright = await asyncio.to_thread(apply_rotations, pdf_bytes, rotations)
        upright = await asyncio.to_thread(annotator.shrink_scans, upright)
        file_id = await annotator._upload(upright, f"upright-{label}.pdf")
        if not file_id:
            logger.warning("orientation: media-service returned no id; checking the copy as uploaded")
            return OrientationResult(pdf_url=pdf_url)
        new_url = await get_public_file_url(file_id)
        logger.info("orientation: turned pages %s; checking upright copy %s",
                    {i + 1: d for i, d in rotations.items()}, file_id)
        return OrientationResult(pdf_url=new_url, rotations=rotations, file_id=file_id)
    except Exception as e:
        logger.warning("orientation: straightening failed, checking the copy as uploaded: %s", e)
        return OrientationResult(pdf_url=pdf_url)
