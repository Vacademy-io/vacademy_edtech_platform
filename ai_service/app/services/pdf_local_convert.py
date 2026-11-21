"""PDF → HTML without MathPix, for papers that already have a text layer.

Vsmart Extract used to send every PDF through MathPix at upload time — a
per-page charge (67 pages of a mock test with solutions ≈ ₹29) that dwarfed
the model cost of reading it (≈ ₹3). A publisher-digital PDF does not need
OCR: PyMuPDF reads its text layer for free, and the digitisation was
verified on exactly that input (IPMAT Mock 2: 60/60 questions, 60/60 keys).

So `start_for_extraction` looks at the file first:

  * text layer on most pages → this module builds the HTML (blocks as <p>,
    figures and diagrams cropped from the page as <img>, tables as <table>),
    stores it in the same file_conversion cache under a local id, and the
    rest of the pipeline (fetch_or_convert_html → cache hit) never touches
    MathPix;
  * a page with no text layer (a scan) or with drawn mathematics (fraction
    bars, radicals, stacked exponents that a text layer reads as fragments)
    → that PAGE alone goes to MathPix, which returns Markdown with LaTeX;
    the rest of the paper stays free. The OCR page count is kept with the
    cached HTML so the task can charge exactly those pages;
  * no text layer anywhere → the existing whole-file MathPix path.
"""
from __future__ import annotations

import asyncio
import base64
import html as htmlmod
import logging
import re
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

import httpx

from ..db import db_session
from ..models.file_conversion import FileConversionRepository
from ..utils.html_images import convert_base64_to_urls, extract_body
from . import docx_numbering, mathpix_pdf_service, media_file_client, pdf_questions_service
from .md_to_html import convert_markdown_to_html

logger = logging.getLogger(__name__)

LOCAL_VENDOR = "pymupdf"
LOCAL_ID_PREFIX = "local-"
# vendor column of a hybrid conversion: "pymupdf+mathpix:<ocr page count>"
HYBRID_VENDOR = "pymupdf+mathpix"
OCR_CONCURRENCY = 4
# A page is "mathematical" — worth MathPix's LaTeX — when its text layer
# shows this many math glyphs, or its drawings hold this many short
# horizontal bars (fraction bars, radical bars, vinculums).
# Glyphs that only appear in mathematics the text layer cannot lay out
# (× and ² read fine as text; a radical or an integral does not).
MATH_GLYPHS = set("√∫∑∏∂∞πθαβγλμσωΩ⇒∠′″")
MATH_GLYPH_MIN = 4
MATH_BAR_MIN = 2

# A page "has text" with at least this many characters; the PDF is digital
# when at least this share of its non-blank pages do.
MIN_PAGE_CHARS = 60
DIGITAL_PAGE_SHARE = 0.7
# Figures: a picture or a cluster of vector drawing that is worth cropping.
MIN_FIGURE_AREA_SHARE = 0.012     # drawn clusters; smaller = bullets, rules, icons
MIN_IMAGE_AREA_SHARE = 0.004      # pasted pictures are deliberate: a small formula image counts
MAX_FIGURE_AREA_SHARE = 0.85      # bigger = a full-page background / scan
MAX_FIGURES_PER_PAGE = 6
MAX_FIGURES_TOTAL = 80
FIGURE_DPI = 110


async def _download(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content


def page_kind(page) -> str:
    """"scan" (no usable text layer), "math" (text layer, but drawn
    mathematics the text layer would garble), or "text"."""
    import pymupdf

    text = page.get_text()
    if len(text.strip()) < MIN_PAGE_CHARS:
        return "scan" if (page.get_images() or page.get_drawings()) else "text"
    glyphs = sum(1 for ch in text if ch in MATH_GLYPHS)
    if glyphs >= MATH_GLYPH_MIN:
        return "math"
    # A fraction bar is a short rule with text immediately above AND below
    # it; table rules and fill-in-the-blank lines have text on one side only.
    bars = 0
    try:
        rules = [pymupdf.Rect(d["rect"]) for d in page.get_drawings()]
        rules = [r for r in rules if r.height <= 1.5 and 6 <= r.width <= 80]
        for r in rules:
            # A table's row line is drawn cell by cell: many short rules at
            # one height. A fraction bar stands alone at its height.
            if sum(1 for o in rules if o is not r and abs(o.y0 - r.y0) < 2) >= 2:
                continue
            above = page.get_text("text", clip=pymupdf.Rect(r.x0 - 2, r.y0 - 14, r.x1 + 2, r.y0)).strip()
            below = page.get_text("text", clip=pymupdf.Rect(r.x0 - 2, r.y1, r.x1 + 2, r.y1 + 14)).strip()
            if above and below and len(above) <= 12 and len(below) <= 12:
                bars += 1
                if bars >= MATH_BAR_MIN:
                    return "math"
    except Exception:  # noqa: BLE001
        pass
    return "text"


def is_digital(doc) -> Tuple[bool, int]:
    """(has a usable text layer, page count)."""
    pages = len(doc)
    if pages == 0:
        return False, 0
    with_text = sum(1 for page in doc if len(page.get_text().strip()) >= MIN_PAGE_CHARS)
    # Blank separator pages should not count against a digital book.
    non_blank = sum(1 for page in doc if page.get_text().strip() or page.get_images())
    share = with_text / max(non_blank, 1)
    return share >= DIGITAL_PAGE_SHARE, pages


def _is_furniture(rect, page_rect) -> bool:
    """Frames, rules, margins: page-wide or hairline shapes that are layout,
    not content."""
    if rect.width >= 0.8 * page_rect.width or rect.height >= 0.8 * page_rect.height:
        return True
    if rect.height < 3 and rect.width > 60:      # a rule
        return True
    if rect.width < 3 and rect.height > 60:      # a vertical rule / margin line
        return True
    return False


def _figure_rects(page, recurring: Optional[set] = None) -> List[Any]:
    """Regions of the page that are pictures or drawn diagrams, in reading order.

    Vector drawings are clustered AFTER the page furniture is removed —
    otherwise the frame printed on every page swallows every diagram into one
    page-sized cluster. `recurring` holds rounded rects seen on three or more
    pages (headers, logos, footers) and is skipped."""
    import pymupdf

    page_rect = page.rect
    area = page_rect.width * page_rect.height
    rects: List[Tuple[Any, float]] = []       # (rect, minimum share for its kind)
    try:
        for info in page.get_image_info():
            rects.append((pymupdf.Rect(info["bbox"]), MIN_IMAGE_AREA_SHARE))
    except Exception:  # noqa: BLE001
        pass
    try:
        drawings = [d for d in page.get_drawings() if not _is_furniture(pymupdf.Rect(d["rect"]), page_rect)]
        for r in page.cluster_drawings(drawings=drawings):
            rects.append((pymupdf.Rect(r), MIN_FIGURE_AREA_SHARE))
    except Exception:  # noqa: BLE001
        pass
    keep: List[Any] = []
    for r, min_share in sorted(rects, key=lambda x: -(x[0].width * x[0].height)):
        share = (r.width * r.height) / area if area else 0
        if not (min_share <= share <= MAX_FIGURE_AREA_SHARE):
            continue
        if r.width < 30 or r.height < 18 or _is_furniture(r, page_rect):
            continue
        if recurring and _key(r) in recurring:
            continue
        # A box full of text (an instructions panel, a boxed passage) is not a
        # figure; a diagram carries only labels.
        try:
            text = page.get_text("text", clip=r)
        except Exception:  # noqa: BLE001
            text = ""
        if len(text.strip()) > 220:
            continue
        if any(k.contains(r) or (k & r).get_area() > 0.6 * r.get_area() for k in keep):
            continue
        keep.append(r)
        if len(keep) >= MAX_FIGURES_PER_PAGE:
            break
    return sorted(keep, key=lambda x: (x.y0, x.x0))


def _key(rect) -> Tuple[int, int, int, int]:
    return (round(rect.x0 / 4), round(rect.y0 / 4), round(rect.width / 4), round(rect.height / 4))


def _recurring_rects(doc) -> set:
    """Rounded rects that appear on three or more pages: headers, footers, logos."""
    import pymupdf

    seen: Dict[Tuple[int, int, int, int], int] = {}
    for page in doc:
        page_keys = set()
        try:
            for info in page.get_image_info():
                page_keys.add(_key(pymupdf.Rect(info["bbox"])))
            for r in page.cluster_drawings():
                page_keys.add(_key(pymupdf.Rect(r)))
        except Exception:  # noqa: BLE001
            continue
        for k in page_keys:
            seen[k] = seen.get(k, 0) + 1
    return {k for k, n in seen.items() if n >= 3}


def _figure_img(page, rect) -> Optional[str]:
    try:
        pix = page.get_pixmap(clip=rect, dpi=FIGURE_DPI)
        b64 = base64.b64encode(pix.tobytes("png")).decode("ascii")
        return f'<img src="data:image/png;base64,{b64}" alt="figure">'
    except Exception:  # noqa: BLE001
        return None


def _is_prose_row(row: List[str]) -> bool:
    """A "row" that is really a line of text the table detector swept up (a
    heading above the grid, a note below it): one filled cell, long."""
    filled = [c for c in row if c]
    return len(filled) == 1 and len(filled[0]) > 40


def _table_html(rows: List[List[str]]) -> Optional[str]:
    if not rows or not any(any(c for c in row) for row in rows):
        return None
    out = ["<table>"]
    for row in rows:
        out.append("<tr>" + "".join(f"<td>{htmlmod.escape(c)}</td>" for c in row) + "</tr>")
    out.append("</table>")
    return "".join(out)


def _tables(page) -> List[Tuple[Any, str]]:
    """(bbox, <table> html) for the DATA tables on the page.

    find_tables also "sees" text set in columns (a two-column answer key with
    running prose, an instructions box). Those would swallow question text
    into one <td>, so only grids whose cells are short survive."""
    import pymupdf

    out: List[Tuple[Any, str]] = []
    try:
        for t in page.find_tables().tables:
            if t.row_count < 2 or t.col_count < 2:
                continue
            rows = [[str(c or "").strip() for c in row] for row in t.extract()]
            # A heading or note the detector swept into the grid is emitted as
            # its own paragraph, not buried in the first cell — the answer-key
            # heading "Answers and Explained Solutions" was lost that way.
            lead: List[str] = []
            trail: List[str] = []
            while rows and _is_prose_row(rows[0]):
                lead.append(next(c for c in rows.pop(0) if c))
            while rows and _is_prose_row(rows[-1]):
                trail.insert(0, next(c for c in rows.pop() if c))
            cells = [c for row in rows for c in row]
            filled = [c for c in cells if c]
            if len(rows) < 2 or len(filled) < 4:
                continue
            filled.sort(key=len)
            median = len(filled[len(filled) // 2])
            if median > 30 or max(len(c) for c in filled) > 160:
                continue
            html = _table_html(rows)
            if html:
                html = "".join(f"<p>{htmlmod.escape(x)}</p>" for x in lead) + html + \
                       "".join(f"<p>{htmlmod.escape(x)}</p>" for x in trail)
                out.append((pymupdf.Rect(t.bbox), html))
    except Exception:  # noqa: BLE001
        pass
    return out


OCR_MARK = "<!--OCR_PAGE:{n}-->"


def to_html(doc, *, figures: bool = True, ocr_pages: Optional[List[int]] = None) -> Tuple[str, int]:
    """The document as block-level HTML in reading order, one <h6> per page,
    figures cropped in place, tables as <table>. Pages listed in `ocr_pages`
    (0-based) get a placeholder instead, to be filled by MathPix. Returns
    (html, figure count)."""
    import pymupdf

    parts: List[str] = []
    figure_count = 0
    recurring = _recurring_rects(doc) if figures else set()
    ocr = set(ocr_pages or [])
    for pno, page in enumerate(doc):
        parts.append(f"<h6>Page {pno + 1}</h6>")
        if pno in ocr:
            parts.append(OCR_MARK.format(n=pno))
            continue
        items: List[Tuple[float, float, str]] = []      # (y0, x0, html)
        tables = _tables(page)
        table_rects = [r for r, _ in tables]
        for r, html in tables:
            items.append((r.y0, r.x0, html))
        for x0, y0, x1, y1, text, _bno, btype in page.get_text("blocks"):
            if btype != 0 or not text.strip():
                continue
            block_rect = pymupdf.Rect(x0, y0, x1, y1)
            if any(tr.contains(block_rect) or (tr & block_rect).get_area() > 0.7 * block_rect.get_area()
                   for tr in table_rects):
                continue  # already rendered as a table cell
            lines = [htmlmod.escape(re.sub(r"[ \t]+", " ", ln).strip()) for ln in text.splitlines()]
            lines = [ln for ln in lines if ln]
            if lines:
                items.append((y0, x0, "<p>" + "<br>".join(lines) + "</p>"))
        if figures and figure_count < MAX_FIGURES_TOTAL:
            for r in _figure_rects(page, recurring):
                img = _figure_img(page, r)
                if img:
                    items.append((r.y0, r.x0, img))
                    figure_count += 1
                    if figure_count >= MAX_FIGURES_TOTAL:
                        break
        # Reading order: top to bottom; two-column pages read left column
        # first only when the columns really are separate — a heading that
        # spans the page keeps its place because it is sorted by y.
        items.sort(key=lambda t: (round(t[0] / 4), t[1]))
        parts.extend(h for _y, _x, h in items)
    return "\n".join(parts), figure_count


async def _ocr_page_html(doc, pno: int) -> Optional[str]:
    """One page through MathPix → Markdown (with LaTeX) → HTML body."""
    import pymupdf

    single = pymupdf.open()
    try:
        single.insert_pdf(doc, from_page=pno, to_page=pno)
        payload = single.tobytes()
    finally:
        single.close()
    pdf_id = await mathpix_pdf_service.submit_bytes(payload, f"page-{pno + 1}.pdf")
    if not pdf_id:
        return None
    md = await mathpix_pdf_service.poll_for_markdown(pdf_id)
    if md is None:
        return None
    return extract_body(convert_markdown_to_html(md))


async def start_for_extraction(file_id: str) -> Dict[str, Any]:
    """Prepare an uploaded PDF for Vsmart Extract.

    Returns {"pdf_id", "vendor", "pages", "ocr", "ocr_pages"}. Text pages are
    read locally for free; scanned and mathematical pages go to MathPix one
    at a time (LaTeX for the maths, OCR for the scan) and are counted so the
    task can charge exactly those. A file with no text layer at all takes
    the whole-file MathPix path."""
    url = await media_file_client.get_file_url(file_id)
    data = await _download(url)
    if docx_numbering.is_docx(data):
        # A Word file has no PDF text layer to read; MathPix converts it, and
        # the file is tagged so its printed question numbers are put back.
        pdf_id = await pdf_questions_service.start_from_file_id(file_id, pdf_questions_service.DOCX)
        return {"pdf_id": pdf_id, "vendor": "mathpix", "pages": None, "ocr": True, "ocr_pages": None}
    try:
        return await _start_local(file_id, data)
    except Exception as exc:  # noqa: BLE001
        # Whatever the local reader could not handle (an encrypted file, an
        # exotic PDF, a PyMuPDF quirk), the path that always existed still
        # can: fall back to MathPix rather than fail where the old tool worked.
        logger.warning("extract: local conversion of %s failed (%s); falling back to MathPix", file_id, exc)
        pdf_id = await pdf_questions_service.start_from_file_id(file_id)
        return {"pdf_id": pdf_id, "vendor": "mathpix", "pages": None, "ocr": True, "ocr_pages": None}


async def _start_local(file_id: str, data: bytes) -> Dict[str, Any]:
    def _analyse() -> Dict[str, Any]:
        import pymupdf

        doc = pymupdf.open(stream=data, filetype="pdf")
        try:
            digital, pages = is_digital(doc)
            if not digital:
                return {"pages": pages, "digital": False}
            kinds = [page_kind(p) for p in doc]
            ocr_idx = [i for i, k in enumerate(kinds) if k in ("scan", "math")]
            html, figures = to_html(doc, ocr_pages=ocr_idx)
            return {"pages": pages, "digital": True, "html": html, "figures": figures,
                    "ocr_idx": ocr_idx, "kinds": kinds}
        finally:
            doc.close()

    info = await asyncio.to_thread(_analyse)
    if not info["digital"]:
        pdf_id = await pdf_questions_service.start_from_file_id(file_id)
        logger.info("extract: %s has no text layer → MathPix %s (%s pages)", file_id, pdf_id, info["pages"])
        return {"pdf_id": pdf_id, "vendor": "mathpix", "pages": info["pages"], "ocr": True,
                "ocr_pages": info["pages"]}

    html: str = info["html"]
    ocr_done = 0
    if info["ocr_idx"]:
        import pymupdf

        doc = pymupdf.open(stream=data, filetype="pdf")
        semaphore = asyncio.Semaphore(OCR_CONCURRENCY)

        async def one(pno: int) -> Tuple[int, Optional[str]]:
            async with semaphore:
                try:
                    return pno, await _ocr_page_html(doc, pno)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("extract: MathPix failed for page %d: %s", pno + 1, exc)
                    return pno, None

        try:
            results = await asyncio.gather(*(one(i) for i in info["ocr_idx"]))
            for pno, page_html in results:
                mark = OCR_MARK.format(n=pno)
                if page_html:
                    html = html.replace(mark, page_html)
                    ocr_done += 1
                else:
                    # MathPix unavailable: the page's own text layer is better
                    # than nothing (a scan yields little; a maths page reads
                    # with fragments), and nothing is charged for it.
                    fallback, _ = to_html(_single(doc, pno))
                    html = html.replace(mark, fallback.split("\n", 1)[-1])
        finally:
            doc.close()

    html = await asyncio.to_thread(convert_base64_to_urls, html)
    pdf_id = LOCAL_ID_PREFIX + uuid4().hex
    vendor = f"{HYBRID_VENDOR}:{ocr_done}" if ocr_done else LOCAL_VENDOR
    await asyncio.to_thread(_cache, pdf_id, file_id, html, vendor)
    outline = await asyncio.to_thread(outline_of_html, html)
    questions = outline["question_count"]
    logger.info("extract: %s read locally (%d pages, %d figures, %d via MathPix: %s, ~%d questions, %d section(s)) as %s",
                file_id, info["pages"], info["figures"], ocr_done,
                ",".join(str(i + 1) for i in info["ocr_idx"]) or "-", questions, len(outline["sections"]), pdf_id)
    return {"pdf_id": pdf_id, "vendor": vendor, "pages": info["pages"],
            "ocr": ocr_done > 0, "ocr_pages": ocr_done, "question_count": questions,
            "sections": outline["sections"], "marking": outline["marking"],
            "duration_minutes": outline["duration_minutes"]}


def _single(doc, pno: int):
    import pymupdf

    single = pymupdf.open()
    single.insert_pdf(doc, from_page=pno, to_page=pno)
    return single


def _cache(pdf_id: str, file_id: str, html: str, vendor: str) -> None:
    with db_session() as db:
        repo = FileConversionRepository(db)
        repo.start(pdf_id, vendor, file_id)
        repo.cache_html(pdf_id, html)


def vendor_of(pdf_id: str) -> Optional[str]:
    """Which converter produced a pdfId's HTML: "pymupdf", "pymupdf+mathpix:N"
    or "mathpix"."""
    try:
        with db_session() as db:
            row = FileConversionRepository(db).find_by_vendor_file_id(pdf_id)
            return row.vendor if row else None
    except Exception:  # noqa: BLE001
        return None


def outline_of_html(html: str) -> Dict[str, Any]:
    """What the paper prints about itself — its question count (distinct
    numbers, the answer key excluded), its sections and its marking scheme
    — shown to the teacher before extracting."""
    from .paper_outline import outline_of_html as _outline

    return _outline(html or "")


def question_count_of_html(html: str) -> int:
    return outline_of_html(html)["question_count"]


def question_count_of(pdf_id: str) -> Optional[int]:
    """Question count for a converted pdfId whose HTML is cached; None when
    the conversion is still running (whole-file MathPix)."""
    try:
        with db_session() as db:
            row = FileConversionRepository(db).find_by_vendor_file_id(pdf_id)
            if not row or not row.html_text:
                return None
            return question_count_of_html(row.html_text)
    except Exception:  # noqa: BLE001
        return None


def ocr_pages_from_vendor(vendor: Optional[str]) -> Optional[int]:
    """Pages that went through MathPix for a conversion, from its vendor tag:
    0 for a purely local read, N for a hybrid, None for a whole-file MathPix
    job (the caller asks MathPix for the page count)."""
    if not vendor or vendor == LOCAL_VENDOR:
        return 0
    if vendor.startswith(HYBRID_VENDOR + ":"):
        try:
            return int(vendor.split(":", 1)[1])
        except ValueError:
            return 0
    return None


__all__ = [
    "start_for_extraction", "to_html", "is_digital", "page_kind", "vendor_of",
    "ocr_pages_from_vendor", "question_count_of", "question_count_of_html", "LOCAL_VENDOR", "HYBRID_VENDOR",
]
