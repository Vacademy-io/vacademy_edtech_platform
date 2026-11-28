"""PDF question pipeline — migrated from media_service PDFQuestionGeneratorController
+ NewDocConverterService.

Flow: media fileId → presigned URL → MathPix submit (pdfId) → poll → Markdown →
HTML (md_to_html) → body-extract + base64→S3 → cache. The pdf-to-questions worker
then feeds that HTML to the shared question engine (question_gen_service).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional, Tuple

import httpx

from ..db import db_session
from ..models.file_conversion import FileConversionRepository
from ..utils.html_images import convert_base64_to_urls, extract_body
from . import docx_numbering, mathpix_pdf_service, media_file_client

logger = logging.getLogger(__name__)


DOCX = "docx"


class StillProcessing(Exception):
    """PDF not yet converted by MathPix (sync pdf-to-html should retry)."""


async def start_from_file_id(file_id: str, file_type: Optional[str] = None) -> str:
    """Resolve fileId → URL, submit to MathPix, register the cache row. Returns pdfId.
    `file_type` "docx" has the paper's printed question numbers restored once
    MathPix is done (docx_numbering)."""
    url = await media_file_client.get_file_url(file_id)
    pdf_id = await mathpix_pdf_service.submit(url)
    if not pdf_id:
        raise RuntimeError(f"MathPix did not return a pdf_id for fileId={file_id}")
    await asyncio.to_thread(_cache_start, pdf_id, file_id, file_type)
    return pdf_id


async def start_from_url(url: str) -> str:
    """Submit an already-hosted PDF URL to MathPix (used by the multipart
    start-process-pdf after the file is uploaded to S3). Returns pdfId."""
    pdf_id = await mathpix_pdf_service.submit(url)
    if not pdf_id:
        raise RuntimeError("MathPix did not return a pdf_id")
    await asyncio.to_thread(_cache_start, pdf_id, None)
    return pdf_id


async def start_from_bytes(pdf_bytes: bytes, filename: str = "paper.pdf") -> str:
    """Submit PDF bytes we already hold (a downloaded question paper) straight
    to MathPix — no public S3 object needed first. Returns pdfId."""
    pdf_id = await mathpix_pdf_service.submit_bytes(pdf_bytes, filename)
    if not pdf_id:
        raise RuntimeError("MathPix did not return a pdf_id")
    await asyncio.to_thread(_cache_start, pdf_id, None)
    return pdf_id


async def fetch_or_convert_html(pdf_id: str, *, allow_poll: bool) -> str:
    """Return the cached HTML for a pdfId, or convert it. With allow_poll=False
    (sync pdf-to-html) raises StillProcessing if MathPix isn't done yet; with
    allow_poll=True (background worker) it waits for completion."""
    cached = await asyncio.to_thread(_cache_get, pdf_id)
    if cached:
        return cached

    if allow_poll:
        raw_html = await mathpix_pdf_service.poll_for_html(pdf_id)
    else:
        if not await mathpix_pdf_service.is_completed(pdf_id):
            raise StillProcessing(pdf_id)
        raw_html = await mathpix_pdf_service.get_converted_html(pdf_id)
        if not raw_html:
            raise StillProcessing(pdf_id)

    body = extract_body(raw_html)
    networked = convert_base64_to_urls(body)
    networked = await _restore_docx_numbers(pdf_id, networked)
    await asyncio.to_thread(_cache_html, pdf_id, networked)
    return networked


async def _restore_docx_numbers(pdf_id: str, html: str) -> str:
    """A Word paper's question numbers as printed, where MathPix renumbered a
    list (docx_numbering). Best effort: on any failure the HTML is kept."""
    source = await asyncio.to_thread(_cache_source, pdf_id)
    if not source or source[1] != DOCX:
        return html
    try:
        url = await media_file_client.get_file_url(source[0])
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
        printed = await asyncio.to_thread(docx_numbering.printed_numbers, resp.content)
        restored, changed = docx_numbering.restore_numbers(html, printed)
        if changed:
            logger.info("docx %s: restored %d printed question number(s) MathPix renumbered", pdf_id, changed)
        return restored
    except Exception as exc:  # noqa: BLE001
        logger.warning("docx %s: could not restore printed numbers: %s", pdf_id, exc)
        return html


# --- sync DB cache helpers (run via to_thread from async callers) ---

def _cache_start(pdf_id: str, file_id: Optional[str], file_type: Optional[str] = None) -> None:
    try:
        with db_session() as db:
            FileConversionRepository(db).start(pdf_id, "mathpix", file_id, file_type)
    except Exception as exc:  # noqa: BLE001
        logger.warning("file_conversion start failed for %s: %s", pdf_id, exc)


def _cache_get(pdf_id: str) -> Optional[str]:
    try:
        with db_session() as db:
            row = FileConversionRepository(db).find_by_vendor_file_id(pdf_id)
            return row.html_text if row and row.html_text else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("file_conversion lookup failed for %s: %s", pdf_id, exc)
        return None


def _cache_source(pdf_id: str) -> Optional[Tuple[str, Optional[str]]]:
    """(source fileId, file_type) of a conversion, when it has a source."""
    try:
        with db_session() as db:
            row = FileConversionRepository(db).find_by_vendor_file_id(pdf_id)
            return (row.file_id, row.file_type) if row and row.file_id else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("file_conversion lookup failed for %s: %s", pdf_id, exc)
        return None


def _cache_html(pdf_id: str, html: str) -> None:
    try:
        with db_session() as db:
            FileConversionRepository(db).cache_html(pdf_id, html)
    except Exception as exc:  # noqa: BLE001
        logger.warning("file_conversion cache write failed for %s: %s", pdf_id, exc)
