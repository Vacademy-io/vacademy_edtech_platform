"""PDF lessons (and DOC/DOCX lessons whose body is an uploaded PDF): text pages
free, scanned pages paid (spec §6.5).

Free pass: download (40 MB cap, no DB session open), PyMuPDF on a worker
thread (kb.parsing._extract_sync with no figures), one Segment per page
that has a text layer. Scanned pages are the empty mathpix placeholders the
router leaves behind; their count is the OCR quote. Cached FREE under
(file, file_id) with probe {pages, scanned_pages, scanned_page_numbers}.

Paid pass (only with a permit for ocr_pages that covers every scanned page):
kb.parsing.parse_pdf, which sends ONLY the scanned pages to MathPix, merged
over the free pages, cached PAID and written back to the tutor's OCR cache.

Only pages MathPix actually returned text for are billed. When some scanned
pages fail (timeout, 5xx, a poll that gives up), the read pages are billed
and kept, but nothing is cached PAID: the FREE row is rewritten with the
merged text and probe {scanned_pages, scanned_page_numbers} = the pages still
unread plus ocr_read_pages, so the next paid pass quotes, OCRs and charges
only those (under a key of its own, so the ledger does not swallow it).
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Dict, List, Optional, Tuple

from ...kb import parsing
from ...tutor import source_text
from . import cache
from .types import Extraction, PaidDelivered, PaidNeed, PaidPermit, Segment, SlideRef, TOOL_OCR_PAGE

logger = logging.getLogger(__name__)

WORD_FILE_NOTE = "Word file: upload it as PDF to make it readable"
OVER_APPROVED_NOTE = "Over the approved amount"
PARTIAL_OCR_NOTE = "{n} scanned page{s} could not be read yet; they are left for a later pass"


def _page_segments(pages) -> List[Segment]:
    return [Segment(text=p.text.strip(), anchor="page", page=int(p.page_number), label=f"Page {p.page_number}")
            for p in pages if (p.text or "").strip()]


def _scanned(pages) -> List[int]:
    return [int(p.page_number) for p in pages if p.parser == "mathpix" and not (p.text or "").strip()]


async def _download(ref: SlideRef) -> Tuple[Optional[bytes], Optional[str]]:
    """(bytes, None) or (None, why). The file id may also be a direct https link."""
    key = (ref.pointer_key or "").strip()
    url = key if key.lower().startswith("https://") else await source_text._file_url(key)
    if not url:
        return None, "The PDF file could not be resolved"
    data = await source_text._download(url, max_bytes=source_text.MAX_PDF_BYTES)
    if data is None:
        return None, "The PDF is larger than 40 MB"
    return data, None


def _need(ref: SlideRef, scanned: int) -> PaidNeed:
    return PaidNeed(kind="ocr_pages", tool_key=TOOL_OCR_PAGE, unit_field="pages", units=int(scanned),
                    approx=False, pointer_kind="file", pointer_key=ref.pointer_key)


async def extract_pdf(ref: SlideRef, permit: Optional[PaidPermit] = None) -> Extraction:
    file_id = ref.pointer_key or ""
    hit = await asyncio.to_thread(cache.get, "file", file_id)
    if hit is not None and hit.tier == "PAID":
        return Extraction(ref.slide_id, "pdf", segments=hit.segments, status="READY" if hit.segments else "EMPTY")

    tutor_text = await asyncio.to_thread(cache.tutor_pdf_ocr, file_id)
    if tutor_text:
        return Extraction(ref.slide_id, "pdf", segments=[Segment(text=tutor_text)], status="READY",
                          note="Read from the AI tutor's copy of this PDF")

    data: Optional[bytes] = None
    read_before: List[int] = []
    if hit is not None:
        segments, probe = hit.segments, hit.probe
        scanned = int(probe.get("scanned_pages") or 0)
        read_before = _int_list(probe.get("ocr_read_pages"))
    else:
        data, why = await _download(ref)
        if data is None:
            return Extraction(ref.slide_id, "pdf", status="UNSUPPORTED" if why and "40 MB" in why else "FAILED", note=why)
        if not data.lstrip()[:5].startswith(b"%PDF"):
            note = WORD_FILE_NOTE if (ref.doc_type or "") in ("DOC", "DOCX") else "This file is not a readable PDF"
            return Extraction(ref.slide_id, "pdf", status="UNSUPPORTED", note=note)
        try:
            extracted = await asyncio.to_thread(parsing._extract_sync, data, False)
        except ValueError as exc:
            return Extraction(ref.slide_id, "pdf", status="UNSUPPORTED", note=str(exc)[:200])
        segments = _page_segments(extracted.pages)
        scanned_numbers = _scanned(extracted.pages)
        scanned = len(scanned_numbers)
        probe: Dict[str, object] = {"pages": len(extracted.pages), "scanned_pages": scanned,
                                    "scanned_page_numbers": scanned_numbers[:2000]}
        if extracted.truncated_at:
            probe["truncated_at"] = extracted.truncated_at
        await asyncio.to_thread(cache.put, "file", file_id, "FREE", segments, probe)

    if scanned <= 0:
        return Extraction(ref.slide_id, "pdf", segments=segments, status="READY" if segments else "EMPTY",
                          note=None if segments else "This PDF has no readable text")
    need = _need(ref, scanned)
    if permit is None or not permit.allows("ocr_pages"):
        return Extraction(ref.slide_id, "pdf", segments=segments, status="NEEDS_PAID", paid_need=need,
                          note=f"{scanned} scanned page{'s' if scanned != 1 else ''} need reading (OCR)")
    if scanned > permit.limit("ocr_pages"):
        return Extraction(ref.slide_id, "pdf", segments=segments, status="NEEDS_PAID", paid_need=need,
                          note=OVER_APPROVED_NOTE)
    return await _ocr(ref, permit, need, segments, data, read_before)


def _int_list(raw) -> List[int]:
    out: List[int] = []
    for v in raw if isinstance(raw, list) else []:
        try:
            out.append(int(v))
        except (TypeError, ValueError):
            continue
    return out


async def _ocr_remaining(data: bytes, read_before: List[int]) -> "parsing.ParsedDocument":
    """parse_pdf without figures, OCR'ing only the scanned pages an earlier
    partial pass left unread (the read ones are already paid for)."""
    extracted = await asyncio.to_thread(parsing._extract_sync, data, False)
    done = set(read_before)
    payloads = [(n, b) for n, b in extracted.ocr_payloads if int(n) not in done]
    doc = parsing.ParsedDocument(parser="pymupdf")
    doc.pages = extracted.pages
    doc.truncated_at = extracted.truncated_at
    if payloads:
        await parsing._ocr_pages(doc, payloads)
        doc.ocr_pages = len(payloads)
    return doc


async def _ocr(ref: SlideRef, permit: PaidPermit, need: PaidNeed, free_segments: List[Segment],
               data: Optional[bytes], read_before: Optional[List[int]] = None) -> Extraction:
    file_id = ref.pointer_key or ""
    read_before = list(read_before or [])
    if data is None:
        data, why = await _download(ref)
        if data is None:
            return Extraction(ref.slide_id, "pdf", segments=free_segments, status="FAILED", paid_need=need, note=why)
    if read_before:
        doc = await _ocr_remaining(data, read_before)
        # Pages an earlier pass read (and billed) come back from the FREE row.
        prior = {int(s.page): s.text for s in free_segments if s.anchor == "page" and s.page is not None}
        done = set(read_before)
        for p in doc.pages:
            if p.parser == "mathpix" and int(p.page_number) in done and not (p.text or "").strip():
                p.text = prior.get(int(p.page_number), "")
    else:
        doc = await parsing.parse_pdf(data, extract_figures=False)
    done = set(read_before)
    scanned_pages = [p for p in doc.pages if p.parser == "mathpix"]
    # Bill only pages MathPix actually returned text for in THIS pass: a page
    # it failed on (timeout, 5xx, a poll that gave up) was not delivered.
    newly_read = sorted(int(p.page_number) for p in scanned_pages
                        if (p.text or "").strip() and int(p.page_number) not in done)
    unread = sorted(int(p.page_number) for p in scanned_pages if not (p.text or "").strip())
    if int(doc.ocr_pages or 0) <= 0 or not newly_read:
        # Nothing came back from OCR: not delivered, never charged.
        return Extraction(ref.slide_id, "pdf", segments=free_segments, status="FAILED", paid_need=need,
                          note="OCR found no readable text on the scanned pages")
    segments = _page_segments(doc.pages)
    note: Optional[str] = None
    if unread:
        # Partial: keep (and bill) what was read, but never cache it PAID, or
        # the unread pages would never be OCR'd again. The FREE row now quotes
        # only the unread pages for the next paid pass.
        read_all = sorted(done | set(newly_read))
        probe: Dict[str, object] = {"pages": len(doc.pages), "scanned_pages": len(unread),
                                    "scanned_page_numbers": unread[:2000], "ocr_read_pages": read_all}
        if doc.truncated_at:
            probe["truncated_at"] = doc.truncated_at
        await asyncio.to_thread(cache.put, "file", file_id, "FREE", segments, probe)
        note = PARTIAL_OCR_NOTE.format(n=len(unread), s="s" if len(unread) != 1 else "")
    else:
        await asyncio.to_thread(cache.put, "file", file_id, "PAID", segments,
                                {"pages": len(doc.pages), "ocr_pages": len(done) + len(newly_read),
                                 "parser": doc.parser})
        await asyncio.to_thread(cache.store_tutor_pdf_ocr, file_id, cache.plain_text(segments))
    units = len(newly_read)
    key = f"course_kb_ocr:{permit.institute_id}:{file_id}"
    if done:
        # A follow-up pass over pages an earlier partial pass left unread: its
        # own key (the pages it read), so the ledger does not treat it as a
        # replay of the first charge; the same pass re-driven keeps the key.
        key += ":" + hashlib.sha1(",".join(map(str, newly_read)).encode()).hexdigest()[:16]
    from ...provider_rates import ocr_cost_usd
    delivered = PaidDelivered(
        tool_key=TOOL_OCR_PAGE, unit_field="pages", units=units, provider_cost_usd=ocr_cost_usd(units),
        model="mathpix", idempotency_key=key,
    )
    return Extraction(ref.slide_id, "pdf", segments=segments, status="READY", paid_delivered=delivered, note=note)


__all__ = ["extract_pdf", "WORD_FILE_NOTE", "OVER_APPROVED_NOTE", "PARTIAL_OCR_NOTE"]
