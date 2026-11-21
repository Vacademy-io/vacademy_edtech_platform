"""Source → pages + figures, with per-page routing between free and paid extraction.

The router is the difference between a workable ingest bill and a silly one. A
typical Indian coaching-institute upload is a mixed PDF: some chapters are
publisher-digital (a real text layer), some are photocopied scans. Sending the
whole book to OCR pays per page for text that PyMuPDF extracts perfectly, for
free, and usually more accurately (no OCR transcription error at all on a page
whose characters are already encoded).

So, per page:
  * a usable text layer  → PyMuPDF, free, confidence 1.0
  * no usable text layer → MathPix OCR, paid, one page per request so the
    extracted text keeps its real page number

Formulas and tables survive because MathPix returns Markdown with LaTeX (``$..$``)
and Markdown tables, and that Markdown is stored verbatim as the page text. A
downstream question generator therefore sees ``\\frac{1}{2}mv^2``, not "1 2 mv2".

FIGURE CAPTIONING IS DELIBERATELY NOT LLM-BASED IN V1. Captions come from the
document itself (alt text, or nearby "Figure 3.2 …" text). A vision pass over
every figure would add per-figure cost and latency for marginal gain while the
corpus is still unproven; the `knowledge_base_figure` model-registry use case is
seeded and ready for when it is enabled.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

import httpx

from ..md_to_html import convert_markdown_to_html
from ..s3_service import S3Service
from .. import mathpix_pdf_service

logger = logging.getLogger(__name__)

# --- Routing thresholds ------------------------------------------------------
# A page needs at least this many extractable characters to count as digital.
# Tuned low: a chapter-opener page with a big illustration and two lines of text
# is still digital, and OCRing it would be waste. Below this we assume the glyphs
# are pixels, not characters.
MIN_DIGITAL_CHARS = 180

# Even with enough characters, a page whose text is mostly replacement/control
# junk indicates a broken embedded font — OCR beats garbage.
MAX_GARBLE_RATIO = 0.12

# Pages below this confidence are surfaced in the review queue.
REVIEW_CONFIDENCE_THRESHOLD = 0.85

# Concurrency for per-page OCR. MathPix bills per page, so this only trades
# wall-clock; kept modest to stay well inside vendor rate limits.
OCR_CONCURRENCY = 6

# Hard ceiling per source, so one accidental 4000-page upload cannot run for
# hours or produce a five-figure credit charge. Surfaced to the user, never silent.
MAX_PAGES_PER_SOURCE = 1200

MAX_FIGURES_PER_SOURCE = 400

# An embedded image that repeats across many pages is PAGE FURNITURE — a
# coaching-institute watermark, a publisher logo, a header rule — not a figure.
# Size alone cannot tell them apart (a watermark is often larger than a small
# diagram), but repetition can: a real diagram appears on ONE page, furniture
# appears on all of them. Without this, a 33-page book with a logo on every page
# yielded ~33 "diagrams", uploaded the same logo to S3 33 times, and attached it
# to every citation.
REPEATED_IMAGE_MIN_PAGES = 3
REPEATED_IMAGE_PAGE_RATIO = 0.25

_CAPTION_RE = re.compile(r"\b(fig(?:ure)?|table|exhibit|chart|diagram|plate)\b[\s.:]*\d", re.I)

_EXT_BY_CONTENT_TYPE = {
    "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
    "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg",
}

# Unicode ranges → language tag. Script detection, not language identification:
# cheap, dependency-free, and enough to tag a chunk's script so retrieval and
# output-language selection can reason about it. Devanagari covers hi/mr/sa,
# which we do not try to separate.
_SCRIPT_RANGES: List[Tuple[int, int, str]] = [
    (0x0900, 0x097F, "hi"),   # Devanagari — Hindi / Marathi / Sanskrit
    (0x0980, 0x09FF, "bn"),   # Bengali / Assamese
    (0x0A00, 0x0A7F, "pa"),   # Gurmukhi
    (0x0A80, 0x0AFF, "gu"),   # Gujarati
    (0x0B00, 0x0B7F, "or"),   # Odia
    (0x0B80, 0x0BFF, "ta"),   # Tamil
    (0x0C00, 0x0C7F, "te"),   # Telugu
    (0x0C80, 0x0CFF, "kn"),   # Kannada
    (0x0D00, 0x0D7F, "ml"),   # Malayalam
    (0x0600, 0x06FF, "ur"),   # Arabic script — Urdu
]


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

@dataclass
class ParsedFigure:
    page_number: Optional[int]
    image_url: str                       # our S3, never a vendor CDN
    kind: str = "figure"                 # figure | table | equation | chart
    caption: Optional[str] = None
    alt_text: Optional[str] = None
    table_html: Optional[str] = None


@dataclass
class ParsedPage:
    page_number: int
    text: str
    parser: str                          # pymupdf | mathpix
    confidence: Optional[float] = None
    needs_review: bool = False
    preview_url: Optional[str] = None


@dataclass
class ParsedDocument:
    pages: List[ParsedPage] = field(default_factory=list)
    figures: List[ParsedFigure] = field(default_factory=list)
    parser: str = "unknown"              # pymupdf | mathpix | mixed | scrape | youtube | text
    ocr_pages: int = 0
    languages: List[str] = field(default_factory=list)
    truncated_at: Optional[int] = None   # set when MAX_PAGES_PER_SOURCE clipped it
    # YouTube only, and only when parse_youtube(keep_timing=True): the caption
    # snippets in order, [{"start": s, "duration": s, "text": str}] in seconds.
    caption_timing: Optional[List[Dict[str, Any]]] = None

    @property
    def total_chars(self) -> int:
        return sum(len(p.text or "") for p in self.pages)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def detect_languages(text: str, max_langs: int = 4) -> List[str]:
    """Scripts present in `text`, most frequent first.

    Counts characters per script over a bounded sample. 'en' is reported for
    Latin only when Latin is a meaningful share, so a Tamil page with a stray
    English word is not mislabelled bilingual.
    """
    sample = (text or "")[:20000]
    if not sample:
        return []
    counts: Dict[str, int] = {}
    latin = 0
    total_letters = 0
    for ch in sample:
        cp = ord(ch)
        if not ch.isalpha():
            continue
        total_letters += 1
        if cp < 0x0250:
            latin += 1
            continue
        for lo, hi, tag in _SCRIPT_RANGES:
            if lo <= cp <= hi:
                counts[tag] = counts.get(tag, 0) + 1
                break
    if not total_letters:
        return []
    if latin / total_letters > 0.15:
        counts["en"] = latin
    ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    return [tag for tag, n in ranked if n / total_letters > 0.05][:max_langs]


def _garble_ratio(text: str) -> float:
    """Share of characters that signal a broken embedded font."""
    if not text:
        return 1.0
    bad = sum(1 for ch in text if ch in "�\x00" or (ord(ch) < 32 and ch not in "\n\r\t"))
    return bad / len(text)


def _looks_digital(text: str) -> bool:
    stripped = (text or "").strip()
    if len(stripped) < MIN_DIGITAL_CHARS:
        return False
    return _garble_ratio(stripped) <= MAX_GARBLE_RATIO


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def _upload_bytes(data: bytes, ext: str, content_type: str) -> Optional[str]:
    """Put an image in our own bucket under the KB prefix."""
    try:
        key = f"ai-knowledge-base/figures/{uuid4()}.{ext}"
        return await asyncio.to_thread(
            S3Service().upload_file_content, data, f"figure.{ext}", key, content_type
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("KB figure upload failed: %s", exc)
        return None


async def _rehost_remote_image(url: str) -> Optional[str]:
    """Download a vendor-hosted figure and re-host it on our S3.

    MathPix externalizes figures to cdn.mathpix.com and purges them later, so
    persisting those URLs would silently rot every figure in every question paper
    generated from this corpus. This exact failure was already hit and fixed once
    on the course-ingest path; do not "optimize" it away.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.content
        content_type = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        ext = _EXT_BY_CONTENT_TYPE.get(content_type)
        if not ext:
            tail = url.rsplit(".", 1)[-1].split("?")[0].lower() if "." in url else ""
            ext = tail if tail in _EXT_BY_CONTENT_TYPE.values() else "jpg"
        return await _upload_bytes(data, ext, content_type or "image/jpeg")
    except Exception as exc:  # noqa: BLE001
        logger.warning("KB figure re-host failed for %s: %s", url[:80], exc)
        return None


def _caption_near(soup_img) -> Optional[str]:
    """Caption from the alt attribute, else nearby caption-shaped text."""
    alt = (soup_img.get("alt") or "").strip()
    if alt:
        return alt[:300]
    candidates: List[str] = []
    for sib in list(soup_img.next_siblings)[:3] + list(soup_img.previous_siblings)[:3]:
        if sib is None:
            continue
        getter = getattr(sib, "get_text", None)
        txt = getter(strip=True) if getter else str(sib).strip()
        if txt:
            candidates.append(txt)
    parent = soup_img.parent
    if parent is not None:
        candidates.append(parent.get_text(" ", strip=True))
    for txt in candidates:
        if txt and _CAPTION_RE.search(txt):
            return txt[:300]
    return None


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

@dataclass
class _ExtractResult:
    """Everything the synchronous PyMuPDF pass produces, handed back to the
    async caller so no fitz object ever crosses the thread boundary."""
    pages: List[ParsedPage] = field(default_factory=list)
    truncated_at: Optional[int] = None
    ocr_payloads: List[Tuple[int, bytes]] = field(default_factory=list)   # (page_no, single-page pdf)
    # (page_no, bytes, ext, caption, content_hash). The hash lets the caller
    # upload one physical image once even when it legitimately appears on more
    # than one page.
    raw_images: List[Tuple[int, bytes, str, Optional[str], str]] = field(default_factory=list)


def _extract_sync(pdf_bytes: bytes, extract_figures: bool) -> _ExtractResult:
    """ALL PyMuPDF work, in one synchronous pass, for a worker thread.

    Deliberately does no network I/O: it classifies pages, isolates the scanned
    ones into single-page PDFs for OCR, and pulls embedded images out as raw
    bytes. Uploading and OCR happen back on the event loop.
    """
    import fitz  # PyMuPDF — imported lazily; heavy C extension

    out = _ExtractResult()
    try:
        pdf = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        logger.error("Could not open PDF: %s", exc)
        raise ValueError(f"Not a readable PDF: {exc}") from exc

    try:
        total = pdf.page_count
        if total > MAX_PAGES_PER_SOURCE:
            out.truncated_at = MAX_PAGES_PER_SOURCE
            logger.warning(
                "PDF has %s pages; ingesting the first %s only", total, MAX_PAGES_PER_SOURCE
            )
        limit = min(total, MAX_PAGES_PER_SOURCE)

        scanned: List[int] = []
        page_texts: Dict[int, str] = {}
        for idx in range(limit):
            page_no = idx + 1
            try:
                page = pdf.load_page(idx)
                raw = page.get_text("text") or ""
            except Exception as exc:  # noqa: BLE001
                logger.warning("Page %s text extraction failed: %s", page_no, exc)
                raw = ""
            page_texts[page_no] = raw

            if _looks_digital(raw):
                out.pages.append(
                    ParsedPage(
                        page_number=page_no,
                        text=raw.strip(),
                        parser="pymupdf",
                        # A real text layer is a transcription, not a guess.
                        confidence=1.0,
                        needs_review=False,
                    )
                )
            else:
                scanned.append(idx)
                # Placeholder, replaced (or left flagged) by the OCR pass.
                out.pages.append(
                    ParsedPage(
                        page_number=page_no, text="", parser="mathpix",
                        confidence=None, needs_review=True,
                    )
                )

        # Isolate scanned pages as single-page PDFs — one MathPix job each is
        # what preserves page attribution (its multi-page Markdown has no page
        # delimiters).
        for idx in scanned:
            page_no = idx + 1
            try:
                single = fitz.open()
                single.insert_pdf(pdf, from_page=idx, to_page=idx)
                out.ocr_payloads.append((page_no, single.tobytes()))
                single.close()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Could not isolate page %s for OCR: %s", page_no, exc)

        # Embedded images from DIGITAL pages only. On a scanned page the whole
        # page IS one image, so extracting it would store a picture of text.
        if extract_figures:
            skip = {i + 1 for i in scanned}

            # Pass 1 — collect candidates, keyed by content hash so the same
            # image is held in memory once no matter how many pages repeat it.
            blobs: Dict[str, Tuple[bytes, str]] = {}
            pages_by_hash: Dict[str, set] = {}
            occurrences: List[Tuple[int, str]] = []   # (page_no, hash), document order

            for idx in range(limit):
                page_no = idx + 1
                if page_no in skip:
                    continue
                try:
                    page = pdf.load_page(idx)
                    images = page.get_images(full=True)
                except Exception:  # noqa: BLE001
                    continue
                for img_meta in images:
                    try:
                        info = pdf.extract_image(img_meta[0])
                    except Exception:  # noqa: BLE001
                        continue
                    data, ext = info.get("image"), (info.get("ext") or "png")
                    width, height = info.get("width") or 0, info.get("height") or 0
                    # Rules, bullets and icons: a real textbook diagram is not
                    # 40px tall. (Size alone will NOT catch a watermark — see
                    # the repetition filter below.)
                    if not data or width < 120 or height < 120:
                        continue
                    digest = hashlib.sha1(data).hexdigest()
                    if digest not in blobs:
                        blobs[digest] = (data, ext)
                    pages_by_hash.setdefault(digest, set()).add(page_no)
                    occurrences.append((page_no, digest))

            # Pass 2 — drop page furniture, then emit one entry per (page, image).
            content_pages = max(1, limit - len(skip))
            furniture_at = max(
                REPEATED_IMAGE_MIN_PAGES,
                int(content_pages * REPEATED_IMAGE_PAGE_RATIO),
            )
            emitted: set = set()
            dropped_pages = 0
            dropped_kinds = 0
            for page_no, digest in occurrences:
                if len(out.raw_images) >= MAX_FIGURES_PER_SOURCE:
                    break
                if len(pages_by_hash[digest]) >= furniture_at:
                    dropped_pages += 1
                    continue
                if (page_no, digest) in emitted:
                    continue
                emitted.add((page_no, digest))
                data, ext = blobs[digest]
                out.raw_images.append(
                    (page_no, data, ext,
                     _caption_from_page_text(page_texts.get(page_no, "")), digest)
                )
            dropped_kinds = sum(
                1 for d, pgs in pages_by_hash.items() if len(pgs) >= furniture_at
            )
            if dropped_pages:
                logger.info(
                    "Dropped %s repeated image placement(s) (%s distinct watermark/logo "
                    "image(s) appearing on >=%s of %s content pages); kept %s figure(s)",
                    dropped_pages, dropped_kinds, furniture_at, content_pages,
                    len(out.raw_images),
                )
    finally:
        try:
            pdf.close()
        except Exception:  # noqa: BLE001
            pass
    return out


async def parse_pdf(pdf_bytes: bytes, *, extract_figures: bool = True) -> ParsedDocument:
    """Parse a PDF into pages + figures, routing each page free/paid.

    The PyMuPDF pass runs on a worker thread. It is CPU-bound and, on a
    several-hundred-page book, takes long enough that running it inline froze
    every other request the worker was serving — health checks included.

    Never raises for a single bad page: a page that fails extraction becomes an
    empty, needs_review page so the rest of a 300-page book still lands.
    """
    extracted = await asyncio.to_thread(_extract_sync, pdf_bytes, extract_figures)

    doc = ParsedDocument(parser="pymupdf")
    doc.pages = extracted.pages
    doc.truncated_at = extracted.truncated_at

    # --- Paid OCR for scanned pages only ---
    if extracted.ocr_payloads:
        await _ocr_pages(doc, extracted.ocr_payloads)
        doc.ocr_pages = len(extracted.ocr_payloads)
        digital = len(doc.pages) - doc.ocr_pages
        doc.parser = "mixed" if digital else "mathpix"

    # --- Upload embedded figures from digital pages ---
    # Keyed by content hash: an image that genuinely appears on two pages is
    # stored in S3 once and cited from both.
    uploaded: Dict[str, str] = {}
    for page_no, data, ext, caption, digest in extracted.raw_images:
        if len(doc.figures) >= MAX_FIGURES_PER_SOURCE:
            break
        hosted = uploaded.get(digest)
        if hosted is None:
            hosted = await _upload_bytes(data, ext, f"image/{'jpeg' if ext == 'jpg' else ext}")
            if not hosted:
                continue
            uploaded[digest] = hosted
        doc.figures.append(
            ParsedFigure(page_number=page_no, image_url=hosted, kind="figure", caption=caption)
        )

    doc.languages = detect_languages("\n".join(p.text for p in doc.pages[:60]))
    return doc


async def _ocr_pages(doc: ParsedDocument, payloads: List[Tuple[int, bytes]]) -> None:
    """OCR pre-isolated single-page PDFs, in bounded parallel.

    One page per request is what preserves page attribution. It costs no more —
    MathPix bills per page — and isolates failures so one unreadable page cannot
    fail the book.
    """
    semaphore = asyncio.Semaphore(OCR_CONCURRENCY)
    by_page = {p.page_number: p for p in doc.pages}

    async def ocr_one(page_no: int, page_pdf: bytes) -> None:
        async with semaphore:
            try:
                pdf_id = await mathpix_pdf_service.submit_bytes(page_pdf, f"page-{page_no}.pdf")
                if not pdf_id:
                    return
                md = await mathpix_pdf_service.poll_for_markdown(pdf_id)
                if md is None:
                    return
                target = by_page.get(page_no)
                if target is None:
                    return
                # Markdown is stored verbatim: it carries LaTeX formulas and
                # Markdown tables that plain text would destroy.
                target.text = (md or "").strip()
                # MathPix exposes no per-page confidence on this endpoint, so
                # confidence is inferred from yield: a scanned page that OCRs to
                # almost nothing is the signature of a bad scan.
                chars = len(target.text)
                if chars >= MIN_DIGITAL_CHARS:
                    target.confidence = 0.9
                    target.needs_review = False
                elif chars > 0:
                    target.confidence = 0.5
                    target.needs_review = True
                else:
                    target.confidence = 0.0
                    target.needs_review = True
                await _figures_from_markdown(md, page_no, doc)
            except Exception as exc:  # noqa: BLE001
                logger.warning("OCR failed for page %s: %s", page_no, exc)

    await asyncio.gather(*(ocr_one(n, b) for n, b in payloads))

    # Any page still flagged with no text stays flagged — that is the honest
    # signal the review gate exists to surface.
    still_bad = sum(1 for p in doc.pages if p.parser == "mathpix" and not p.text)
    if still_bad:
        logger.info("%s scanned page(s) produced no text and are flagged for review", still_bad)


_TABLE_ROW_RE = re.compile(r"^\s*\|(.+)\|\s*$")
# The |---|:--:|---| separator line that makes a GFM pipe table a table.
_TABLE_SEP_RE = re.compile(r"^\s*\|[\s:|-]+\|\s*$")


def _split_table_row(line: str) -> List[str]:
    inner = _TABLE_ROW_RE.match(line)
    if not inner:
        return []
    return [cell.strip() for cell in inner.group(1).split("|")]


def extract_markdown_tables(md: str) -> List[str]:
    """Find GFM pipe tables in Markdown and return them as HTML.

    Necessary because `convert_markdown_to_html` (a deliberately minimal
    line-based converter ported from the Java original) has NO table support — it
    renders a table row as ``<p>| Solid | Fixed |</p>``. MathPix returns real
    tables as pipe tables, and a textbook's tables (reaction conditions, property
    comparisons, data sets) are exactly the material a question paper wants to
    reproduce. Storing them as HTML keeps them usable as text rather than as a
    picture of text.
    """
    lines = (md or "").splitlines()
    tables: List[str] = []
    i = 0
    while i < len(lines):
        header = _split_table_row(lines[i])
        # A table is a header row, a separator row, then >=1 body row.
        if header and i + 1 < len(lines) and _TABLE_SEP_RE.match(lines[i + 1]):
            body: List[List[str]] = []
            j = i + 2
            while j < len(lines):
                cells = _split_table_row(lines[j])
                if not cells:
                    break
                body.append(cells)
                j += 1
            if body:
                head_html = "".join(f"<th>{_escape(c)}</th>" for c in header)
                rows_html = "".join(
                    "<tr>" + "".join(f"<td>{_escape(c)}</td>" for c in row) + "</tr>"
                    for row in body
                )
                tables.append(
                    f"<table><thead><tr>{head_html}</tr></thead><tbody>{rows_html}</tbody></table>"
                )
                i = j
                continue
        i += 1
    return tables


def _escape(s: str) -> str:
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


async def _figures_from_markdown(md: str, page_no: int, doc: ParsedDocument) -> None:
    """Pull figures and tables out of a MathPix page and re-host the images."""
    if len(doc.figures) >= MAX_FIGURES_PER_SOURCE:
        return
    try:
        from bs4 import BeautifulSoup

        # convert_markdown_to_html turns `![alt](url)` into `<img src alt>`, which
        # is the only part of it this needs.
        html = convert_markdown_to_html(md or "")
        soup = BeautifulSoup(html or "", "html.parser")

        for img in soup.find_all("img"):
            if len(doc.figures) >= MAX_FIGURES_PER_SOURCE:
                return
            src = (img.get("src") or "").strip()
            if not src.lower().startswith(("http://", "https://")):
                continue
            hosted = await _rehost_remote_image(src)
            if not hosted:
                continue
            doc.figures.append(
                ParsedFigure(
                    page_number=page_no,
                    image_url=hosted,
                    kind="figure",
                    caption=_caption_near(img),
                )
            )

        # Tables come from the Markdown directly, not the HTML — see
        # extract_markdown_tables for why.
        for table_html in extract_markdown_tables(md):
            if len(doc.figures) >= MAX_FIGURES_PER_SOURCE:
                return
            doc.figures.append(
                ParsedFigure(
                    page_number=page_no,
                    image_url="",
                    kind="table",
                    caption=None,
                    table_html=table_html[:20000],
                )
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Figure parse failed on page %s: %s", page_no, exc)


def _caption_from_page_text(page_text: str) -> Optional[str]:
    """First caption-shaped line on the page ("Fig. 3.2 Human heart")."""
    for line in (page_text or "").splitlines():
        line = line.strip()
        if line and _CAPTION_RE.search(line):
            return line[:300]
    return None


# ---------------------------------------------------------------------------
# URL / YouTube / raw text
# ---------------------------------------------------------------------------

def assert_public_http_url(url: str) -> None:
    """Refuse anything that is not a public http(s) URL.

    Same SSRF rule the scraper applies (no private / loopback / link-local
    targets), surfaced as ValueError so a background ingest records a readable
    failure instead of leaking an HTTPException out of a job.
    """
    from urllib.parse import urlparse

    from fastapi import HTTPException

    from ..scraper_service import ScraperService

    if urlparse(url).scheme not in ("http", "https"):
        raise ValueError("PDF URLs must be http(s)")
    try:
        ScraperService()._validate_url(url)  # noqa: SLF001 — the one shared SSRF gate
    except HTTPException as exc:
        raise ValueError(str(exc.detail)) from exc


async def parse_url(url: str) -> ParsedDocument:
    """Scrape a web page into a single-page document.

    ScraperService does SSRF validation (rejects private/loopback/link-local
    targets) and strips script/style/nav/header/footer before extracting text.

    NOTE: it truncates at 20,000 characters, so a very long syllabus page is
    clipped rather than fully ingested. Acceptable for reference pages; a book
    should be uploaded as a PDF.
    """
    from ..scraper_service import ScraperService

    # Returns exactly {"content": str, "title": str | None}.
    scraped: Dict[str, Any] = await ScraperService().scrape_url(url)
    body = (scraped.get("content") or "").strip()
    title = (scraped.get("title") or "").strip()
    combined = f"{title}\n\n{body}".strip() if title else body
    if not combined:
        raise ValueError("Nothing readable was extracted from that URL")
    doc = ParsedDocument(parser="scrape")
    doc.pages.append(
        ParsedPage(page_number=1, text=combined, parser="scrape", confidence=1.0)
    )
    doc.languages = detect_languages(combined)
    return doc


_YOUTUBE_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)


def youtube_video_id(url: str) -> Optional[str]:
    """Extract the 11-character video id from any common YouTube URL shape."""
    match = _YOUTUBE_ID_RE.search(url or "")
    if match:
        return match.group(1)
    bare = (url or "").strip()
    return bare if re.fullmatch(r"[A-Za-z0-9_-]{11}", bare) else None


async def parse_youtube(
    url: str, language_hint: Optional[str] = None, keep_timing: bool = False, *, purpose: str = "kb_ingest",
) -> ParsedDocument:
    """Fetch a YouTube transcript as a single-page document.

    keep_timing=True also returns each caption snippet's start and duration in
    ``doc.caption_timing`` (course knowledge cites the video second). The page
    text is the same either way.

    A thin wrapper over the shared caption service (services/youtube_captions):
    cache, direct, rotating proxy and Supadata fallbacks, with per-pod limits
    and circuit breakers. Raises ValueError (a CaptionsError whose text is the
    user-facing note) when there are no usable captions.
    """
    if not youtube_video_id(url):
        raise ValueError("That does not look like a YouTube video URL")

    from ..youtube_captions import service as yt_service
    result = await yt_service.require_captions(url, language=language_hint, purpose=purpose)
    text_out = result.text.strip()
    if not text_out:
        raise ValueError("That video's transcript came back empty")

    doc = ParsedDocument(parser="youtube")
    doc.pages.append(
        ParsedPage(page_number=1, text=text_out, parser="youtube", confidence=1.0)
    )
    doc.languages = detect_languages(text_out)
    if keep_timing:
        doc.caption_timing = [
            {"start": s.start_ms / 1000.0, "duration": max(0, s.end_ms - s.start_ms) / 1000.0, "text": s.text}
            for s in result.segments
        ]
    return doc


def parse_text(raw: str) -> ParsedDocument:
    """Wrap pasted text as a single-page document."""
    body = (raw or "").strip()
    if not body:
        raise ValueError("Content is empty")
    doc = ParsedDocument(parser="text")
    doc.pages.append(ParsedPage(page_number=1, text=body, parser="text", confidence=1.0))
    doc.languages = detect_languages(body)
    return doc


__all__ = [
    "ParsedDocument", "ParsedPage", "ParsedFigure",
    "parse_pdf", "parse_url", "parse_youtube", "parse_text",
    "detect_languages", "sha256_bytes",
    "MAX_PAGES_PER_SOURCE", "REVIEW_CONFIDENCE_THRESHOLD",
]
