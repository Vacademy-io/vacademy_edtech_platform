"""Second reading of the maths lines on an answer sheet, by the vision model.

Replaces the Mathpix fallback (mathpix_fallback.py) for copy-check.

Why
---
render_worker flags low-confidence OCR lines `needs_math_fallback`, and the old
step sent up to four of them to Mathpix and OVERWROTE the row text with the
answer. Measured on two real Maths copies (2026-10-01, 25 flagged lines, every
disputed crop checked by eye), out of 23 lines that could be judged:

  full-page vision read (already done)   19 right
  GLM-5.3-flash on the crop              14 right
  Mathpix on the crop                    12 right

Mathpix misread digits (-1 as -4, 2ca as 20a) and garbled prose ("Cliven that
the twa chards"). Worse, some OCR row boxes are narrower than the line they
carry (42 px for "x² + 1/x² = 27"), so the crop held one letter and Mathpix's
"\\chi" replaced a correct reading. Most flagged lines on non-maths copies were
plain prose ("(ii) Troposphere", "to vote"). Mathpix is billed per image on
every copy; the same close-up through the vision model we already run costs a
small fraction of that.

The crop readers were still right on a few lines where the full-page read was
wrong (164/3 read as "161/3 + 3", "(a-d)(a+d)" as "(a+d)(a+d)"), because a
close-up resolves small fractions and signs better than a whole page does.

So this step
------------
  * re-reads every row whose text looks like maths, flagged by the OCR or not.
    The flag alone missed most of them: on a page of fraction working only 2
    of 23 rows were flagged, the full-page read had turned every 7 into a 1
    ("1/5 ... = 1/30" for "7/5 ... = 7/30"), and the one flagged row's
    close-up read it right ("7/5 x 1/6");
  * takes a stacked fraction's other half into the same crop - its numerator
    or denominator is often a row of its own ("= 7" over "30");
  * widens each crop to the full width of the page's writing, and pads it
    vertically so a fraction's numerator and denominator are both inside —
    a crop narrower than the line was the main way the old step failed;
  * reads it with the same vision model as the page read;
  * NEVER overwrites the row. The close-up goes into `second_reading` and the
    grading prompt shows both, so the grader decides with the page in view
    instead of being handed one reader's guess as fact.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import re
import tempfile
from pathlib import Path
from typing import Any, Callable, Optional

from .mathpix_fallback import _download, _rasterize_pages

logger = logging.getLogger(__name__)

# Hard fallback only; the live model is the 'evaluation' use case
# (grader.evaluation_model), the same model that read the page.
MODEL = "z-ai/glm-5.3-flash"
# A copy with more flagged maths lines than this keeps the full-page reading
# for the rest. Each close-up is a tiny call; the cap exists to stop a
# pathological upload, not to save money.
MAX_ROWS_PER_COPY = 150
CONCURRENCY = 6
# Vertical padding as a share of the row height: enough to take in a stacked
# fraction above and below the row's centre line.
VERTICAL_PAD = 0.45
MIN_VERTICAL_PAD = 10
HORIZONTAL_PAD = 12

PROMPT = (
    "Transcribe the handwriting in this image exactly as written, keeping the student's own "
    "mistakes. Write maths in plain text: ^ for powers, / for fractions, sqrt() for roots. "
    "A fraction written stacked (top over a bar over bottom) is ONE number: write it top/bottom. "
    "A number written over another one: write it as '350 written over 360'. "
    "If a line is crossed out, write [crossed out]. Output only the transcription."
)

# Something a maths reader can add value on: an operator or relation between
# terms, a power, a fraction, a root, a maths symbol or function name. Plain
# prose ("to vote", "(ii) Troposphere") and bare question numbers do not match.
_MATHY = re.compile(
    r"(\w\s*[=<>≤≥≠]\s*\S)"            # relation:  x = 5, a<b
    r"|(^\s*[=∴]\s*[-−(]?\s*[\dA-Za-z])"  # working that starts "= 7/30", "∴ x = 5"
    r"|(\d\s*[+\-×x*/÷]\s*\d)"          # arithmetic between digits
    r"|([A-Za-z0-9)\]]\s*\^)"           # caret power
    r"|[²³⁴ⁿ√∫∑π∞θ∆Δ±∠⊥]"               # maths glyphs
    r"|\b\d+\s*/\s*\d+\b"               # fraction 7/15
    r"|\b(sin|cos|tan|log|ln|lim)\b"
)


def looks_mathy(text: str) -> bool:
    return bool(_MATHY.search(text or ""))


# A stacked fraction's other half: a short row of digits (and signs) right
# above or below a maths row - "30" under "= 7", "5" under "= 1 (".
_FRACTION_PART = re.compile(r"^[\s\d\-−+×x*/()=.^a-zA-Z]{1,8}$")


def rows_to_reread(layout_map: dict[str, Any], limit: int = MAX_ROWS_PER_COPY) -> list[tuple[dict, dict]]:
    """(page, row) pairs worth a close-up: maths-looking student rows, not
    printed question text and not illegible. Page order; capped at `limit`."""
    picked: list[tuple[dict, dict]] = []
    for page in layout_map.get("pages") or []:
        for row in page.get("lines") or []:
            if row.get("illegible") or row.get("printed"):
                continue
            if not isinstance(row.get("box"), (list, tuple)) or len(row["box"]) != 4:
                continue
            if looks_mathy(row.get("text") or ""):
                picked.append((page, row))
    return picked[:limit]


def crop_box(page: dict[str, Any], row: dict[str, Any], image_size: tuple[int, int]) -> tuple[int, int, int, int]:
    """(left, top, right, bottom) of the close-up for `row`.

    Horizontally it spans everything written on the page, not just the row's
    own box: OCR boxes are often narrower than the line they carry, and a crop
    of one letter is what turned "x² + 1/x² = 27" into "\\chi". Vertically it
    pads by a share of the row height so a stacked fraction stays whole.
    """
    width, height = image_size
    x, y, w, h = (float(v) for v in row["box"])
    boxes = [r["box"] for r in page.get("lines") or []
             if isinstance(r.get("box"), (list, tuple)) and len(r["box"]) == 4]
    left = min([x] + [float(b[0]) for b in boxes])
    right = max([x + w] + [float(b[0]) + float(b[2]) for b in boxes])
    top, bottom = y, y + h
    for part in fraction_parts(page, row):
        _, py, _, ph = (float(v) for v in part["box"])
        top, bottom = min(top, py), max(bottom, py + ph)
    pad = max(MIN_VERTICAL_PAD, h * VERTICAL_PAD)
    return (
        max(0, int(left - HORIZONTAL_PAD)),
        max(0, int(top - pad)),
        min(width, int(right + HORIZONTAL_PAD)),
        min(height, int(bottom + pad)),
    )


def fraction_parts(page: dict[str, Any], row: dict[str, Any]) -> list[dict[str, Any]]:
    """Short digit rows directly above or below `row` that overlap it
    sideways: the other half of a stacked fraction the OCR split off."""
    x, y, w, h = (float(v) for v in row["box"])
    out = []
    for other in page.get("lines") or []:
        if other is row or not isinstance(other.get("box"), (list, tuple)) or len(other["box"]) != 4:
            continue
        text = (other.get("text") or "").strip()
        ox, oy, ow, oh = (float(v) for v in other["box"])
        gap = max(oy - (y + h), y - (oy + oh))
        overlap = min(x + w, ox + ow) - max(x, ox)
        if overlap <= 0.3 * min(w, ow):
            continue
        # Rows touching each other are the two levels of one stacked line,
        # whatever text the page read put in them; a short digit row a little
        # further off is a numerator or denominator too.
        touching = gap <= 0.25 * max(h, oh)
        digit_part = bool(text) and bool(re.search(r"\d", text)) and bool(_FRACTION_PART.match(text))
        if touching or (digit_part and gap <= 0.9 * max(h, oh)):
            out.append(other)
    return out


def _crop_png_b64(img: Any, box: tuple[int, int, int, int]) -> str:
    buf = io.BytesIO()
    img.crop(box).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def plausible_reading(close_up: str, row_text: str) -> bool:
    """Is the close-up a second reading of THIS row, rather than of a
    neighbour? When the page read put a line's text on the wrong row, the
    crop of that row's box shows a different line ("25)" for "= 1/6 (...)"),
    and handing that to the grader as a "reading of the same line" misleads
    it. A real second reading shares most of its characters with the first
    and is not a fragment of it ("30" for "= 1/30")."""
    from difflib import SequenceMatcher

    def norm(s: str) -> str:
        return re.sub(r"[^0-9a-z=+\-*/^()]", "", (s or "").lower().replace("×", "*").replace("−", "-"))
    a, b = norm(close_up), norm(row_text)
    if not a or not b:
        return bool(a)
    if len(a) < 0.5 * len(b):
        return False
    return SequenceMatcher(None, a, b).ratio() >= 0.4


def _same(a: str, b: str) -> bool:
    def norm(s: str) -> str:
        s = (s or "").lower()
        s = s.replace("²", "^2").replace("³", "^3").replace("×", "*").replace("−", "-")
        return re.sub(r"[\s·.,:;|]", "", s)
    return norm(a) == norm(b)


async def reread_math_rows(
    pdf_url: str,
    layout_map: dict[str, Any],
    llm: Any,
    model: Optional[str] = None,
    institute_id: Optional[str] = None,
    token_sink: Optional[Any] = None,
    cancellation_check: Optional[Callable[[], bool]] = None,
) -> int:
    """Attach `second_reading` to flagged maths rows whose close-up reads
    differently. Mutates `layout_map`; returns how many rows were read.
    Best effort: any failure leaves the full-page reading as it was."""
    targets = rows_to_reread(layout_map)
    if not targets:
        return 0
    if not model:
        from .grader import evaluation_model
        model = evaluation_model() or MODEL

    with tempfile.TemporaryDirectory(prefix="copycheck-mathread-") as tmp:
        pdf_path = Path(tmp) / "input.pdf"
        await _download(pdf_url, pdf_path)
        page_imgs = await asyncio.get_event_loop().run_in_executor(None, _rasterize_pages, pdf_path)

    semaphore = asyncio.Semaphore(CONCURRENCY)
    read = 0

    async def one(page: dict[str, Any], row: dict[str, Any]) -> None:
        nonlocal read
        img = page_imgs.get(page.get("page_id"))
        if img is None or (cancellation_check is not None and cancellation_check()):
            return
        async with semaphore:
            try:
                b64 = _crop_png_b64(img, crop_box(page, row, img.size))
                response = await llm.chat_completion(
                    messages=[{
                        "role": "user",
                        "content": PROMPT,
                        "attachments": [{"type": "image", "url": f"data:image/png;base64,{b64}"}],
                    }],
                    temperature=0.0,
                    max_tokens=400,
                    institute_id=institute_id,
                    model=model,
                )
            except Exception as e:
                logger.warning("Maths re-read failed for %s: %s", row.get("line_id"), e)
                return
        if token_sink is not None:
            try:
                token_sink.add_usage(response.get("usage"))
            except Exception:
                logger.debug("token sink rejected maths re-read usage", exc_info=True)
        read += 1
        text = (response.get("content") or "").strip().strip("`").strip()
        if text and not _same(text, row.get("text") or "") and plausible_reading(text, row.get("text") or ""):
            row["second_reading"] = text[:300]

    await asyncio.gather(*(one(p, r) for p, r in targets))
    logger.info(
        "Maths re-read: %d of %d flagged maths row(s) read, %d with a different second reading",
        read, len(targets), sum(1 for _, r in targets if r.get("second_reading")),
    )
    return read
