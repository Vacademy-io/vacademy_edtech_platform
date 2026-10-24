"""Resolve the real text of a PDF slide for the learner chatbot.

Why this exists
---------------
The learner app builds `context_meta` client-side and sends
`document_slide.published_data` as the slide's `content`
(`useChatbot.ts` buildContextMeta). For `type='CODE'` and `type='DOC'` that
field genuinely holds text, but for `type='PDF'` it holds a **media fileId** —
and PDF is the platform's dominant slide type (9,711 of 16,732 document_slide
rows; 9,173 of them store a bare UUID there).

So the tutor was being handed a string like
"487fc9b7-e886-4a6a-a517-123162a99fa7" as the lesson content. Measured in
production: of 705 DOCUMENT slide sessions only 27 carried usable text, and of
500 VIDEO sessions, none did. The model then answered from the slide *title*
plus general knowledge, and sometimes invented what was on the slide
("this slide is essentially the title page for the chapter…"). A 36-char UUID
also passes the `len > 20` topic check in
`IntentClassifierService.get_practice_topic`, so it could be used as a quiz topic.

Design constraints
------------------
1. **Never download or parse inside a held DB session.** `resolve_context()`
   runs inside one of the agent's short-lived DB blocks, and a multi-second
   fetch+parse there is exactly the pattern that exhausted the SQLAlchemy pool
   in the 2026-08-19 incident. So the request path does one cheap indexed cache
   read and nothing else; extraction happens on a bounded background task with
   its own session.
2. **No paid OCR.** `kb.parsing.parse_pdf` routes scanned pages to MathPix,
   which bills per page. Extracting on every slide view would be an unbounded
   cost, so this calls the free PyMuPDF pass (`_extract_sync`) directly and
   simply discards `ocr_payloads`. A scanned/image-only PDF therefore yields no
   text — and the tutor is told it cannot read the slide, which is the honest
   outcome and costs nothing.
3. **Reuse the existing cache table, read by vendor.** `file_conversion` is
   already a fileId -> extracted-text cache with an idempotent boot-time DDL.
   It is shared with MathPix HTML and the tutor's caches (including the
   `tutor_pdf_probe` JSON of page counts), so this service reads and writes
   only rows tagged `SLIDE_TEXT_VENDOR`; any other vendor's row for the same
   fileId would reach the learner as slide text.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Optional, Set

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import background_db_session
from ..models.file_conversion import FileConversionRepository

logger = logging.getLogger(__name__)

# `vendor` marker for rows this service writes, so they are distinguishable
# from the MathPix conversions that share the table.
SLIDE_TEXT_VENDOR = "slide_pdf_text"

# A slide deck should be small. Far below kb.ingest's 220MB book ceiling.
MAX_SLIDE_PDF_BYTES = 40 * 1024 * 1024

# Cap what we cache. resolve_context truncates to 4000 for the prompt anyway;
# keeping a bit more lets the limit be raised without re-extracting.
MAX_CACHED_CHARS = 12_000

# Bound background extraction so a burst of learners opening slides cannot
# saturate the worker or the DB pool.
MAX_CONCURRENT_EXTRACTIONS = 4
_semaphore = asyncio.Semaphore(MAX_CONCURRENT_EXTRACTIONS)

# asyncio.create_task keeps only a weak reference; hold strong ones.
_running: Set[asyncio.Task] = set()

# fileIds currently being extracted, so N learners on the same slide trigger one
# download rather than N. In-process only — a second replica may duplicate work
# once, which is harmless because the write is an upsert.
_in_flight: Set[str] = set()

# fileIds that produced no digital text — image-only/scanned decks. Without this,
# every view of a scanned slide re-downloads and re-parses a multi-MB PDF forever,
# because nothing is ever written to the cache to say "we tried". Bounded so a
# long-lived pod cannot accumulate unboundedly; a restart simply re-tries once.
_no_text: Set[str] = set()
_NO_TEXT_MAX = 2000

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

# What the model is told when we have no text. Deliberately explicit: the
# failure mode being fixed is the tutor confidently describing a slide it has
# never seen.
UNREADABLE_SLIDE_NOTE = (
    "[The contents of this slide could not be read, so you have NOT been shown "
    "them. Do not describe, summarise or characterise what is on this slide, and "
    "do not claim it is a title page or an introduction. You may use the slide's "
    "title and the chapter/subject names for orientation only. Say plainly that "
    "you cannot see the slide contents, and ask the student what they would like "
    "help with.]"
)


def looks_like_file_id(value: Optional[str]) -> bool:
    """True when a slide's `content` is really a bare media fileId."""
    if not value:
        return False
    return bool(_UUID_RE.match(value.strip()))


_OWNERSHIP_SQL = text(
    """
    SELECT 1
    FROM document_slide d
    JOIN slide sl ON sl.source_id = d.id AND sl.source_type = 'DOCUMENT'
    JOIN chapter_to_slides cts
        ON cts.slide_id = sl.id AND cts.status <> 'DELETED'
    JOIN chapter_package_session_mapping cpsm
        ON cpsm.chapter_id = cts.chapter_id AND cpsm.status <> 'DELETED'
    JOIN package_session ps ON ps.id = cpsm.package_session_id
    JOIN package_institute pi ON pi.package_id = ps.package_id
    WHERE d.published_data = :file_id
      AND sl.status <> 'DELETED'
      AND pi.institute_id = :institute_id
    LIMIT 1
    """
)


def file_belongs_to_institute(db: Session, file_id: str, institute_id: str) -> bool:
    """Is this fileId actually the published PDF of a slide in this institute?

    SECURITY GATE — do not remove. `context_meta` is built client-side and the
    /chat-agent routes carry no auth, so `content` is attacker-controllable and
    `institute_id` is client-supplied. Without this check, resolving a fileId to
    text turns the tutor into an arbitrary cross-tenant file reader: anyone could
    open a session, set content to a fileId belonging to another institute, ask
    "summarise this slide", and be read the contents of a file they have no claim
    to. Before slide-text resolution existed the UUID was passed through as inert
    junk, so this capability is new and must be scoped.

    Measured against production traffic: this allows 631 of 636 real slide
    sessions (99.2%). The handful it rejects are learners viewing a slide owned by
    a different institute, which fails closed to "I can't read this slide" —
    exactly the behaviour before this feature.
    """
    if not file_id or not institute_id:
        return False
    try:
        return (
            db.execute(
                _OWNERSHIP_SQL, {"file_id": file_id, "institute_id": institute_id}
            ).first()
            is not None
        )
    except Exception as exc:  # noqa: BLE001
        # Fail closed.
        logger.warning("slide ownership check failed for %s: %s", file_id, exc)
        return False


def get_cached_slide_text(db: Session, file_id: str) -> Optional[str]:
    """One indexed read. Safe to call inside a held DB session.

    Callers MUST have passed file_belongs_to_institute first — the cache is keyed
    by fileId alone, so an unscoped read here would serve another tenant's text.

    Only this service's own rows are read. The table is shared, and the newest
    row of any vendor for a PDF can be the tutor's probe JSON (page counts) or
    MathPix HTML, neither of which is slide text.
    """
    try:
        row = FileConversionRepository(db).find_success_by_vendor_and_file_id(
            SLIDE_TEXT_VENDOR, file_id
        )
        if row and row.html_text:
            return row.html_text
    except Exception as exc:  # noqa: BLE001
        logger.warning("slide text cache read failed for %s: %s", file_id, exc)
    return None


def schedule_slide_text_extraction(file_id: str) -> None:
    """Fire-and-forget warm of the cache. Never raises into the request path."""
    if not file_id or file_id in _in_flight or file_id in _no_text:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return  # no loop (sync context) — nothing to schedule onto
    _in_flight.add(file_id)
    task = loop.create_task(_extract_and_cache(file_id))
    _running.add(task)
    task.add_done_callback(_running.discard)
    task.add_done_callback(lambda _t, fid=file_id: _in_flight.discard(fid))


async def _extract_and_cache(file_id: str) -> None:
    """Resolve -> download -> free PyMuPDF text pass -> cache. Best effort."""
    async with _semaphore:
        try:
            # Late imports: heavy modules, and this path is optional.
            from .kb import parsing
            from .media_file_client import get_file_url, get_public_file_url

            url: Optional[str] = None
            for resolver in (get_public_file_url, get_file_url):
                try:
                    url = await resolver(file_id)
                    if url:
                        break
                except Exception as exc:  # noqa: BLE001
                    logger.debug(
                        "slide text: %s could not resolve %s: %s",
                        resolver.__name__, file_id, exc,
                    )
            if not url:
                logger.info("slide text: no URL for fileId=%s", file_id)
                return

            pdf_bytes = await _download_capped(url)
            if not pdf_bytes:
                return

            # extract_figures=False and ocr_payloads ignored => zero paid OCR.
            extracted = await asyncio.to_thread(parsing._extract_sync, pdf_bytes, False)
            parts = [(p.text or "").strip() for p in extracted.pages]
            body = "\n\n".join(p for p in parts if p).strip()

            if not body:
                # Remember it, or every future view of this scanned deck
                # re-downloads and re-parses several MB for nothing.
                if len(_no_text) < _NO_TEXT_MAX:
                    _no_text.add(file_id)
                logger.info(
                    "slide text: fileId=%s has no digital text (likely scanned); "
                    "recorded as no-text, skipping rather than paying for OCR",
                    file_id,
                )
                return

            if len(body) > MAX_CACHED_CHARS:
                body = body[:MAX_CACHED_CHARS]

            with background_db_session() as db:
                repo = FileConversionRepository(db)
                if repo.find_success_by_vendor_and_file_id(SLIDE_TEXT_VENDOR, file_id) is None:
                    repo.store_success(
                        vendor_file_id=file_id,
                        vendor=SLIDE_TEXT_VENDOR,
                        file_id=file_id,
                        html=body,
                    )
            logger.info(
                "slide text: cached %d chars for fileId=%s (%d pages)",
                len(body), file_id, len(extracted.pages),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("slide text extraction failed for %s: %s", file_id, exc)


async def _download_capped(url: str) -> Optional[bytes]:
    """Stream with a slide-sized ceiling. Mirrors kb.ingest._download."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            async with client.stream("GET", url) as resp:
                resp.raise_for_status()
                declared = resp.headers.get("content-length")
                if declared and int(declared) > MAX_SLIDE_PDF_BYTES:
                    logger.info("slide text: file too large (%s bytes)", declared)
                    return None
                buf = bytearray()
                async for piece in resp.aiter_bytes():
                    buf.extend(piece)
                    if len(buf) > MAX_SLIDE_PDF_BYTES:
                        logger.info("slide text: file exceeded cap mid-stream")
                        return None
                return bytes(buf)
    except Exception as exc:  # noqa: BLE001
        logger.warning("slide text download failed: %s", exc)
        return None
