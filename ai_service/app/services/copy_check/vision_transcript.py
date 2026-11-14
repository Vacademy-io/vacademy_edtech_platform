"""Vision-model re-reading of the answer sheet, replacing PaddleOCR's text.

Why this exists
---------------
`render_worker/pdf_ocr/layout_ocr.py` runs PaddleOCR's **printed-text**
recogniser on handwriting (its own docstring says so — there is no English
handwriting checkpoint). On a real 13-page law copy it produced 686 "lines"
totalling 3,382 characters — about 260 per page against a realistic 800-2,000 —
with a maximum of 30 characters per line and 94 lines that were a single
character. Words came back as `'yromrp'` and `'Maccidinta!'`.

Grading off that transcript is not lenient, it is *random*: the model
reconstructs a plausible textbook answer from keyword fragments and awards
marks at high confidence for prose the student never wrote, or sees nothing
and awards 0 to a full answer. No prompt change can fix a grader that cannot
read the page.

So we re-read each page with a vision model that actually can. Measured on
page 3 of that same copy (2026-09-09, `z-ai/glm-5.3-flash`): 935 characters of
correct, fluent legal prose for $0.00029 — versus PaddleOCR's ~260 characters
of noise for the whole page.

What we keep from PaddleOCR
---------------------------
The **geometry**. PaddleOCR's boxes are positionally accurate even when its
text is wrong, and annotations need boxes to draw on. So this module:

  1. merges PaddleOCR's word-level boxes into true visual rows (pure geometry,
     no model involved) — which also fixes annotation anchoring, since a
     `strike` was previously drawn across one mis-read word rather than the
     line it belonged to; and
  2. asks the vision model to rewrite the text of each row, given the page
     image and the row list.

The row ids stay in the layout map, so `validator._layout_target_index` and
`annotator._target_index` keep working unchanged.

Cost
----
One call per page, not per question — the transcript is then reused by every
question's grading call. A 13-page copy costs roughly $0.004 (~0.6 credits).
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import tempfile
from pathlib import Path
from typing import Any, Callable, Optional

from .mathpix_fallback import _download, _rasterize_pages

logger = logging.getLogger(__name__)

# Vision-capable, cheap, and strong on handwriting. Same model as the grading
# default so a copy is read and graded by one model: the 'evaluation' use case
# (grader.evaluation_model). This literal is only the hard fallback.
VISION_MODEL = "z-ai/glm-5.3-flash"

# Bound the spend on a pathological upload. Beyond this, later pages keep their
# PaddleOCR text and the quality gate will flag the copy for manual review
# rather than pretend it was read.
MAX_VISION_PAGES = 40

# Page images are resized so the long edge is at most this many pixels before
# JPEG encoding. 1600px lost small writing: on a real maths copy the MCQ page
# was read right 10, 8 and 11 times out of 15 answers; at 2400px (the scan's
# own size) 14, 14 and 13. The image costs about twice the prompt tokens.
MAX_IMAGE_EDGE = 2400
JPEG_QUALITY = 80

# A page that comes back "illegible" or nearly empty although the OCR found
# plenty of writing on it is read once more, re-rendered at RETRY_DPI so a
# scan stored above 200 DPI gives up its own detail. On a real maths copy a
# full page of clear working came back "[illegible]" on one run and was read
# fine on the next; with no retry, every answer on it scored 0.
RETRY_DPI = 300
RETRY_IMAGE_EDGE = 3200
RETRY_MIN_OCR_WORDS = 12

# How many page reads run at once. Three keeps a 13-page copy under a minute
# without opening a burst of provider connections.
PAGE_CONCURRENCY = 3

# Below this many characters per page, averaged across the copy, we do not
# believe the sheet was read — see `assess_quality`.
MIN_CHARS_PER_PAGE = 120

# Lines the OCR missed that the vision read may add back per page (see
# add_unlisted_rows). A real miss is one or two lines; a model that returns
# dozens is re-transcribing the page, not filling gaps.
MAX_UNLISTED_PER_PAGE = 8

TRANSCRIBE_SYSTEM = (
    "You transcribe scanned handwritten exam answer sheets. You output the "
    "student's handwriting VERBATIM — preserving their spelling, grammar and "
    "factual errors exactly as written. You never correct, complete, "
    "improve or rewrite what the student wrote, and you never add commentary. "
    "If you cannot read something, you say so rather than guessing: an invented "
    "sentence becomes a mark the student did not earn."
)


def _row_tolerance(words: list[dict[str, Any]]) -> float:
    """Vertical slack for deciding two boxes sit on the same line."""
    heights = [float(w["box"][3]) for w in words if w.get("box") and len(w["box"]) == 4]
    if not heights:
        return 12.0
    heights.sort()
    median = heights[len(heights) // 2]
    return max(6.0, median * 0.6)


def drop_slivers(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fold rows shorter than 40% of the page's median row height into the
    nearest full-height row.

    A sliver is a detector fragment - an underline, a stray tick of the pen,
    the tail of a 'g' - not a line the student wrote. Left in, it is a row
    the grader can anchor to, and a score placed on it lands in the middle of
    the real line below. Its text is kept by appending to the neighbour so no
    reading is lost.
    """
    if len(rows) < 3:
        return rows
    heights = sorted(float(r["box"][3]) for r in rows)
    median = heights[len(heights) // 2]
    keep = [r for r in rows if float(r["box"][3]) >= 0.40 * median]
    if not keep or len(keep) == len(rows):
        return rows
    for r in rows:
        if float(r["box"][3]) >= 0.40 * median:
            continue
        cy = float(r["box"][1]) + float(r["box"][3]) / 2
        near = min(keep, key=lambda k: abs(float(k["box"][1]) + float(k["box"][3]) / 2 - cy))
        if r.get("text"):
            near["text"] = (near.get("text", "") + " " + r["text"]).strip()
    return keep


def merge_words_into_rows(page: dict[str, Any]) -> list[dict[str, Any]]:
    """Group word-level OCR boxes into visual rows. Pure geometry.

    PaddleOCR returns one box per *word* but the pipeline calls them lines, so
    `line_id` has really been a word id all along — which is why an annotation
    anchored to a "line" landed on a single mis-read word. Grouping by vertical
    overlap gives back the row the student actually wrote, and a box wide
    enough for a strike or underline to make sense.
    """
    words = [
        w for w in page.get("lines", [])
        if isinstance(w.get("box"), (list, tuple)) and len(w["box"]) == 4
    ]
    if not words:
        return []

    def centre_y(w: dict[str, Any]) -> float:
        _, y, _, h = (float(v) for v in w["box"])
        return y + h / 2.0

    tol = _row_tolerance(words)
    # A row may not grow taller than this. Without the guard, one oversized box
    # (a margin scrawl, a scan artefact, a diagram caught by the detector) pulls
    # every subsequent word into its band and yields a single "row" hundreds of
    # pixels tall — and a `strike` anchored to it is drawn straight across the
    # whole answer. Splitting instead costs at worst a note on the right line.
    max_row_height = max(tol * 4.0, 60.0)
    ordered = sorted(words, key=centre_y)

    rows: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_centre = 0.0
    current_top = 0.0
    current_bottom = 0.0
    for w in ordered:
        cy = centre_y(w)
        top = float(w["box"][1])
        bottom = top + float(w["box"][3])
        if current and (
            abs(cy - current_centre) > tol
            or max(current_bottom, bottom) - min(current_top, top) > max_row_height
        ):
            rows.append(current)
            current = []
        if not current:
            current_top, current_bottom = top, bottom
        else:
            current_top = min(current_top, top)
            current_bottom = max(current_bottom, bottom)
        current.append(w)
        # Running mean keeps a gently sloping handwritten line together instead
        # of splitting it against the first word's baseline.
        current_centre = sum(centre_y(m) for m in current) / len(current)
    if current:
        rows.append(current)

    page_id = page.get("page_id") or "p1"
    merged: list[dict[str, Any]] = []
    for index, members in enumerate(rows, start=1):
        members = sorted(members, key=lambda m: float(m["box"][0]))
        xs0 = [float(m["box"][0]) for m in members]
        ys0 = [float(m["box"][1]) for m in members]
        xs1 = [float(m["box"][0]) + float(m["box"][2]) for m in members]
        ys1 = [float(m["box"][1]) + float(m["box"][3]) for m in members]
        text = " ".join((m.get("text") or "").strip() for m in members).strip()
        confs = [float(m.get("conf") or 0) for m in members]
        merged.append({
            "line_id": f"{page_id}_r{index}",
            "text": text,
            "box": [
                int(min(xs0)), int(min(ys0)),
                int(max(xs1) - min(xs0)), int(max(ys1) - min(ys0)),
            ],
            "conf": round(min(confs), 3) if confs else 0.0,
            "ocr_text": text,
            "needs_math_fallback": any(m.get("needs_math_fallback") for m in members),
            "source_word_ids": [m.get("line_id") for m in members if m.get("line_id")],
        })
    return merged


def _norm(text: Any) -> str:
    return " ".join(str(text or "").lower().split())


def add_unlisted_rows(
    rows: list[dict[str, Any]],
    unlisted: Any,
    page_id: str,
    page_height: int = 0,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Give each line the vision model saw but the OCR missed a row of its own.

    Returns (rows in top-to-bottom order, texts that got NO row). A row the
    model left blank directly under `after` is filled first - that OCR box is
    the line (marked `recovered`). Otherwise the only evidence of where a
    missed line sits is the model's `after`, so it goes in the gap between
    that row and the next written one, as wide
    as its neighbours (the annotator measures the real ink inside that band).
    A line is left without a row, never forced in, when its anchor is unknown
    or the gap is too thin to hold a line of writing: a box on top of another
    line would put a tick on the wrong answer. Its text still reaches the
    grader through the page prose - see enrich_layout_with_vision.
    """
    if not isinstance(unlisted, list) or not unlisted:
        return rows, []
    boxed = [r for r in rows if isinstance(r.get("box"), (list, tuple)) and len(r["box"]) == 4]
    if not boxed:
        return rows, [str(u.get("text") or "").strip() for u in unlisted
                      if isinstance(u, dict) and str(u.get("text") or "").strip()]
    ordered = sorted(boxed, key=lambda r: float(r["box"][1]))
    heights = sorted(float(r["box"][3]) for r in ordered)
    line_h = heights[len(heights) // 2]
    by_id = {r["line_id"]: r for r in ordered}
    known = {_norm(r.get("text")) for r in rows if (r.get("text") or "").strip()}

    groups: dict[Optional[str], list[dict[str, Any]]] = {}
    orphans: list[str] = []
    for item in unlisted[:MAX_UNLISTED_PER_PAGE]:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text or text == "[illegible]" or _norm(text) in known:
            continue        # nothing to read, or a row the page already has
        after = item.get("after") or None
        if after is not None and after not in by_id:
            orphans.append(text)
            continue
        known.add(_norm(text))
        groups.setdefault(after, []).append({**item, "text": text})

    def blank(r: dict[str, Any]) -> bool:
        return not (r.get("text") or "").strip()

    added: list[dict[str, Any]] = []
    for after, items in groups.items():
        above = by_id.get(after) if after else None
        following = ordered[ordered.index(above) + 1:] if above is not None else ordered
        # The model sometimes answers a row it left blank - usually one the
        # OCR could not read - as an "unlisted" line after the row above it.
        # That row's box IS the line: fill it rather than invent a box beside
        # it. A made-up box squeezed into the gap above the real one put
        # "ans7" and its tick half a line too high, and "ans3", finding no
        # gap at all, lost its row - its tick went on the answer above.
        slots = []
        for r in following:
            if not blank(r):
                break
            slots.append(r)
        for row, item in zip(slots, items):
            row["text"] = item["text"]
            row["printed"] = bool(item.get("printed"))
            row["conf"] = 0.9
            row["recovered"] = True
            row.pop("illegible", None)
        filled = slots[:len(items)]
        items = items[len(filled):]
        if not items:
            continue
        if filled:
            above = filled[-1]
        # The first written row after the blank run - not a row just filled.
        rest = following[len(slots):]
        below = rest[0] if rest else None
        if above is None and below is None:
            orphans.extend(i["text"] for i in items)
            continue
        if above is not None:
            top = float(above["box"][1]) + float(above["box"][3])
        else:
            top = max(0.0, float(below["box"][1]) - line_h * 1.5 * len(items))
        if below is not None:
            bottom = float(below["box"][1])
        else:
            bottom = top + line_h * 1.5 * len(items)
            if page_height:
                bottom = min(float(page_height), bottom)
        slot = (bottom - top) / len(items)
        if slot < line_h * 0.5:
            logger.info("unlisted line(s) after %s on %s: %.0fpx gap cannot hold %d line(s); "
                        "kept in the page prose only", after, page_id, bottom - top, len(items))
            orphans.extend(i["text"] for i in items)
            continue
        near = [r for r in (above, below) if r is not None]
        x0 = min(float(r["box"][0]) for r in near)
        x1 = max(float(r["box"][0]) + float(r["box"][2]) for r in near)
        h = min(line_h, slot * 0.9)
        for n, item in enumerate(items):
            y = top + slot * n + (slot - h) / 2.0
            added.append({
                "line_id": f"{page_id}_u{len(added) + 1}",
                "text": item["text"],
                "box": [int(x0), int(y), int(x1 - x0), int(h)],
                "conf": 0.9,
                "ocr_text": "",
                "needs_math_fallback": False,
                "printed": bool(item.get("printed")),
                "unlisted": True,
            })
    if not added:
        return rows, orphans
    merged = rows + added
    merged.sort(key=lambda r: float((r.get("box") or [0, 0])[1]))
    return merged, orphans


def _encode_page(img: Any, max_edge: int = MAX_IMAGE_EDGE) -> str:
    """PIL image -> base64 JPEG data, downscaled to `max_edge`."""
    from PIL import Image

    longest = max(img.width, img.height)
    if longest > max_edge:
        scale = max_edge / float(longest)
        img = img.resize(
            (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
            Image.LANCZOS,
        )
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _build_page_prompt(rows: list[dict[str, Any]], page_id: str, page_height: int = 0) -> str:
    # Each row carries its vertical position as a percentage down the page.
    # Without it the model can only align its reading to the row list by order,
    # which drifts as soon as the counts differ (blank rows, ruled lines, a
    # heading the OCR split in two) — and a drifted alignment puts every
    # annotation on the wrong line. With it, the model can anchor spatially
    # against what it sees. It also matters when the OCR text is empty, where
    # position is the only signal available.
    def _pos(r: dict[str, Any]) -> str:
        if not page_height:
            return ""
        box = r.get("box") or [0, 0, 0, 0]
        top = float(box[1]) / float(page_height) * 100.0
        return f" (at {top:.0f}% down the page)"

    listing = "\n".join(
        f"[{r['line_id']}]{_pos(r)} {r['text'] or '(writing the OCR could not read)'}" for r in rows
    )
    return f"""This is page {page_id} of a student's handwritten exam answer sheet.

A machine OCR pass located the lines of writing it could find and recorded
where each one sits, but its text is unreliable — it was trained on printed
text, so it mangles handwriting — and it can MISS a line altogether. Its rows,
top to bottom, are:

{listing}

Read the page image yourself and return the text the student ACTUALLY wrote.

Rules:
- Transcribe VERBATIM. Keep the student's spelling, grammar and factual
  mistakes exactly as written. Do not correct, complete or improve anything.
  Do not fill in what you think a good answer would say — you are reading a
  page, not writing one.
- Return one entry per row id above, in the same order, so each line keeps its
  position on the page. Row ids are fixed; do not invent, merge, drop or
  renumber them.
- Use each row's stated position down the page to decide WHICH line of the
  image it is. The row list may contain more rows than there are lines of
  writing (ruled lines and margins get detected too) — in that case leave the
  extra rows blank rather than shifting your text onto them. Anchoring text to
  the wrong row puts a teacher's tick on the wrong line.
- A row shown as "(writing the OCR could not read)" is almost always a real
  line of handwriting at that position — often a short answer. Read it from
  the image and put its text in THAT row; do not report it under
  unlisted_lines. Leave it blank only if there is truly no writing there.
- The row list may also have FEWER rows than there are lines of writing: the
  OCR sometimes misses a line entirely, typically a short answer line between
  two listed rows. Never squeeze such a line into a neighbouring row. List it
  in `unlisted_lines`, with `after` set to the id of the row it sits directly
  below (null if it is above the first row). A line you leave out is an
  answer the grader never sees, and the student gets 0 for it.
- Numbers decide marks, so read every digit, sign and exponent with care. In
  handwriting 1 and 7, 5 and 6 (and 5 and S), 8 and 9, and a minus sign are
  easy to confuse; look at the stroke, and at the same number written
  elsewhere on the page, before you decide. Still write what is there - never
  what the answer should be.
- A fraction written stacked (numerator above the bar, denominator below)
  often spans two listed rows: keep each part on its own row, and write the
  whole fraction as a/b in page_text, e.g. "= 7/30".
- A number or word written OVER another, or struck out and rewritten beside
  or above it: say so in that order - "350 written over 360", "360 struck out,
  350". The one written last (on top, or not struck out) is the student's
  final answer. Never give both as if both were the answer.
- Writing inside a box the student drew around an answer IS the answer:
  always transcribe it ("x = 5").
- If a row is genuinely unreadable, set its text to "[illegible]".
- If a row holds no student writing (a blank, a ruled line, a page number),
  set its text to "".
- Some rows are the PRINTED question paper rather than the student's answer.
  Transcribe those too, and set "printed": true for them, so the grader does
  not mistake the question for the answer.
- `page_text` is the whole page as continuous, readable prose — EVERY line of
  writing on the page, unlisted lines included, in reading order, joined into
  paragraphs. This is what the grader reads, so it matters most.

Return STRICT JSON only, no prose and no code fences:
{{
  "page_text": "<the full page, verbatim, as readable prose>",
  "legible": <true|false — false only if the page is essentially unreadable>,
  "lines": [
    {{"line_id": "<row id from above>", "text": "<verbatim text of that row>",
      "printed": <true|false>}}
  ],
  "unlisted_lines": [
    {{"after": "<row id it sits directly below, or null>",
      "text": "<verbatim text of the line>", "printed": <true|false>}}
  ]
}}"""


async def _transcribe_page(
    llm: Any,
    model: str,
    page: dict[str, Any],
    rows: list[dict[str, Any]],
    image_b64: str,
    institute_id: Optional[str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (parsed_result, usage). Raises on failure — the caller decides."""
    messages = [
        {"role": "system", "content": TRANSCRIBE_SYSTEM},
        {
            "role": "user",
            "content": _build_page_prompt(
                rows, page.get("page_id") or "p1", int(page.get("height") or 0),
            ),
            "attachments": [
                {"type": "image", "url": f"data:image/jpeg;base64,{image_b64}"},
            ],
        },
    ]
    response = await llm.chat_completion(
        messages=messages,
        temperature=0.1,
        # Enough for a dense page of prose plus the per-row array. The client
        # adds a reasoning allowance on top for models that require thinking.
        max_tokens=4000,
        institute_id=institute_id,
        model=model,
    )
    content = (response.get("content") or "").strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    if not content:
        raise RuntimeError("vision transcription returned empty content")
    start, end = content.find("{"), content.rfind("}")
    if start == -1 or end <= start:
        raise RuntimeError("vision transcription returned no JSON object")
    return json.loads(content[start : end + 1]), (response.get("usage") or {})


def assess_quality(layout_map: dict[str, Any]) -> dict[str, Any]:
    """Is this transcript good enough to grade against?

    There was no such check anywhere before, which is how garbage OCR turned
    into confident marks. A copy that fails this should be routed to a human,
    not graded — a wrong mark delivered confidently is worse than no mark.
    """
    pages = layout_map.get("pages", []) or []
    total_chars = 0
    legible_pages = 0
    for page in pages:
        text = page.get("vision_text") or " ".join(
            (line.get("text") or "") for line in page.get("lines", [])
        )
        chars = len((text or "").strip())
        total_chars += chars
        if chars >= MIN_CHARS_PER_PAGE and page.get("vision_legible") is not False:
            legible_pages += 1
    page_count = len(pages)
    avg = (total_chars / page_count) if page_count else 0.0
    read_by_vision = sum(1 for p in pages if p.get("vision_ocr"))
    return {
        "pages": page_count,
        "pages_read_by_vision": read_by_vision,
        "legible_pages": legible_pages,
        "total_chars": total_chars,
        "avg_chars_per_page": round(avg, 1),
        # Never grade a copy where we could not read most of the pages.
        "gradeable": page_count > 0 and legible_pages >= max(1, page_count // 2),
    }


def _render_page(pdf_path: Path, page_id: Any, dpi: int) -> Any:
    """One page ("p3") of the PDF as a PIL image at `dpi`, or None."""
    try:
        import fitz  # PyMuPDF
        from PIL import Image

        index = int(str(page_id).lstrip("p")) - 1
        doc = fitz.open(pdf_path)
        try:
            pix = doc[index].get_pixmap(matrix=fitz.Matrix(dpi / 72.0, dpi / 72.0), alpha=False)
            if pix.n != 3:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        finally:
            doc.close()
    except Exception:
        logger.debug("re-render of page %s failed", page_id, exc_info=True)
        return None


def _read_chars(result: dict[str, Any]) -> int:
    """How much the model says it read on a page: its prose, else its rows."""
    text = (result.get("page_text") or "").strip()
    if not text:
        text = " ".join((item.get("text") or "") for item in result.get("lines") or []
                        if (item.get("text") or "") != "[illegible]")
    return len(text.strip())


def needs_second_read(result: dict[str, Any], ocr_word_count: int) -> bool:
    """The model found (almost) nothing on a page where the OCR saw real
    writing: worth one more, sharper look before the page is given up."""
    if ocr_word_count < RETRY_MIN_OCR_WORDS:
        return False
    return result.get("legible") is False or _read_chars(result) < MIN_CHARS_PER_PAGE


async def enrich_layout_with_vision(
    pdf_url: str,
    layout_map: dict[str, Any],
    llm: Any,
    model: Optional[str] = None,
    institute_id: Optional[str] = None,
    token_sink: Optional[Any] = None,
    cancellation_check: Optional[Callable[[], bool]] = None,
) -> dict[str, Any]:
    """Re-read every page with a vision model. Mutates and returns `layout_map`.

    Best effort per page: a page whose read fails keeps its PaddleOCR text and
    is left out of the legible count, so `assess_quality` still sees the truth.
    """
    if not model:
        from .grader import evaluation_model
        model = evaluation_model() or VISION_MODEL
    pages = layout_map.get("pages", []) or []
    if not pages:
        return layout_map

    # Rows first — this half is pure geometry and is worth keeping even if
    # every model call below fails, because it fixes annotation anchoring.
    rows_by_page: dict[str, list[dict[str, Any]]] = {}
    for page in pages:
        rows = drop_slivers(merge_words_into_rows(page))
        if rows:
            # The word boxes are deliberately NOT kept on the page. This layout
            # is persisted per attempt in copy_check_layout.layout_json, and a
            # 13-page copy carries ~700 of them (~80KB) that nothing reads —
            # the FE overlay and the annotator both index `lines`. Keep the
            # count for diagnostics instead.
            page["ocr_word_count"] = len(page.get("lines", []))
            page["lines"] = rows
            rows_by_page[page["page_id"]] = rows

    with tempfile.TemporaryDirectory(prefix="copycheck-vision-") as tmp:
        pdf_path = Path(tmp) / "input.pdf"
        await _download(pdf_url, pdf_path)
        page_imgs = await asyncio.get_event_loop().run_in_executor(
            None, _rasterize_pages, pdf_path,
        )

        semaphore = asyncio.Semaphore(PAGE_CONCURRENCY)

        async def read_one(page: dict[str, Any]) -> None:
            page_id = page.get("page_id")
            img = page_imgs.get(page_id)
            rows = rows_by_page.get(page_id) or []
            if img is None or not rows:
                return
            if cancellation_check is not None and cancellation_check():
                return
            async with semaphore:
                try:
                    b64 = await asyncio.get_event_loop().run_in_executor(
                        None, _encode_page, img,
                    )
                    result, usage = await _transcribe_page(
                        llm, model, page, rows, b64, institute_id,
                    )
                except Exception as e:
                    logger.warning(
                        "Vision transcription failed for page %s: %s; keeping OCR text",
                        page_id, e,
                    )
                    return
                usages = [usage]
                if needs_second_read(result, int(page.get("ocr_word_count") or 0)):
                    # One sharper read before accepting "nothing here".
                    try:
                        sharp = await asyncio.get_event_loop().run_in_executor(
                            None, _render_page, pdf_path, page_id, RETRY_DPI,
                        )
                        b64 = await asyncio.get_event_loop().run_in_executor(
                            None, _encode_page, sharp or img, RETRY_IMAGE_EDGE,
                        )
                        retry, retry_usage = await _transcribe_page(
                            llm, model, page, rows, b64, institute_id,
                        )
                        usages.append(retry_usage)
                        if _read_chars(retry) > _read_chars(result):
                            logger.info("Vision re-read page %s: %d -> %d chars", page_id,
                                        _read_chars(result), _read_chars(retry))
                            result = retry
                    except Exception as e:
                        logger.warning("Vision re-read of page %s failed: %s", page_id, e)

            if token_sink is not None:
                for u in usages:
                    try:
                        token_sink.add_usage(u)
                    except Exception:
                        logger.debug("token sink rejected vision usage", exc_info=True)

            by_id = {r["line_id"]: r for r in rows}
            replaced = 0
            for item in result.get("lines") or []:
                row = by_id.get(item.get("line_id"))
                if row is None:
                    continue
                text = (item.get("text") or "").strip()
                row["printed"] = bool(item.get("printed"))
                if text and text != "[illegible]":
                    row["text"] = text
                    row["conf"] = 0.9
                    replaced += 1
                elif text == "[illegible]":
                    row["text"] = ""
                    row["illegible"] = True
                else:
                    row["text"] = ""
            # Lines the OCR never found. Without a row they were invisible:
            # the model anchored its page prose to the rows too, so a short
            # answer the detector skipped was graded "not attempted".
            rows, unplaced = add_unlisted_rows(
                rows, result.get("unlisted_lines"), page_id, int(page.get("height") or 0),
            )
            added = sum(1 for r in rows if r.get("unlisted"))
            recovered = sum(1 for r in rows if r.get("recovered"))
            # Rows the model found no student writing on are dropped, so they
            # cannot be chosen as annotation targets. Ruled lines, the printed
            # DATE / PAGE NO. box and margin furniture all survive line
            # detection, and a tick anchored to one lands on blank paper above
            # the answer — which reads to a teacher as a mark on nothing.
            # Illegible rows are KEPT: that is student writing we failed to
            # read, and it is a legitimate thing to put a note against.
            page["lines"] = [
                r for r in rows
                if (r.get("text") or "").strip() or r.get("illegible")
            ]
            page["blank_rows_dropped"] = len(rows) - len(page["lines"])
            # Where the ink is, as opposed to what can be annotated. The
            # annotator places pen notes around these so a note never lands on
            # the student's writing; dropped blank rows still matter here
            # because a row can be blank of TEXT and still sit over a ruled
            # line the note would straddle. Cheap to store (tens of boxes per
            # page, not the ~700 word boxes).
            page["ink_boxes"] = [r["box"] for r in rows if r.get("box")]
            page_text = (result.get("page_text") or "").strip()
            # The prose is what the grader reads. A recovered line the model
            # left out of it - or one that found no room for a row - is added
            # at the end rather than lost.
            prose = _norm(page_text)
            missing = [t for t in [r["text"] for r in rows
                                   if r.get("unlisted") or r.get("recovered")] + unplaced
                       if _norm(t) not in prose]
            if missing:
                page_text = (page_text + "\n" + "\n".join(missing)).strip()
            page["vision_text"] = page_text
            page["vision_legible"] = bool(result.get("legible", True))
            page["vision_ocr"] = True
            if added or recovered or unplaced:
                page["unlisted_rows_added"] = added
                page["unlisted_rows_recovered"] = recovered
            logger.info(
                "Vision read page %s: %d/%d rows rewritten, %d unlisted line(s): %d into "
                "a blank row, %d new row(s), %d prose only; %d chars of page text",
                page_id, replaced, len(rows) - added, recovered + added + len(unplaced),
                recovered, added, len(unplaced), len(page["vision_text"]),
            )

        targets = pages[:MAX_VISION_PAGES]
        if len(pages) > MAX_VISION_PAGES:
            logger.warning(
                "Copy has %d pages; reading only the first %d with vision",
                len(pages), MAX_VISION_PAGES,
            )
        await asyncio.gather(*(read_one(p) for p in targets))

    layout_map["ocr_engine"] = f"paddleocr+vision({model})"
    layout_map["vision_quality"] = assess_quality(layout_map)
    logger.info("Vision transcription quality: %s", layout_map["vision_quality"])
    return layout_map
