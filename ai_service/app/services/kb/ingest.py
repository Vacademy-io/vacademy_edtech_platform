"""Knowledge-base ingestion job: source → pages → figures → chunks → summary tree.

Runs as a background `ai_task`, never inside a request. A 300-page scanned book
means hundreds of OCR round-trips plus embedding plus the summary tree; the old
KB code did its embedding inline in the POST handler (while its own comment
claimed otherwise) and swallowed every failure, so an item could report success
and never be searchable. Everything here writes real progress and real terminal
state instead.

Stages, each recorded on knowledge_base_source.stage so the UI can say something
truthful while the user waits:

    parsing     → route pages free/paid, extract text + figures
    figures     → persist figures (already re-hosted on our S3)
    chunking    → page-aware chunks with citation anchors
    embedding   → vectors, in batches
    summarizing → the hierarchical index Phase 2 plans from

Billing is charged ONCE at the end, keyed on the source id, so a retry of a
partially-ingested source cannot double-charge.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, Optional

import httpx

from ...db import db_session
from ...models.ai_token_usage import RequestType
from ..ai_billing import UC, metering_user, record_tool_billing
from ..api_key_resolver import ApiKeyResolver
from ..embedding_service import EmbeddingService
from . import parsing
from .chunking import build_chunks
from .repository import KbRepository, is_curriculum_kb
from .summary_index import build_summary_index

logger = logging.getLogger(__name__)

# Ceiling on downloaded source bytes. nginx already caps uploads at 200m
# (proxy-body-size), so this is the belt to that braces — it stops a redirect to
# something enormous from exhausting the pod's memory.
MAX_SOURCE_BYTES = 220 * 1024 * 1024

EMBED_BATCH = 64

# Below this, a single-page source is treated as a note rather than a document:
# no summary tree, because there is no structure to summarise and the LLM calls
# would cost more than the content is worth.
MIN_CHARS_FOR_INDEX = 6000


def _ledger_charge(db, idempotency_key: str) -> float:
    """Credits the ledger recorded under an idempotency key (0 if none)."""
    try:
        from sqlalchemy import text

        row = db.execute(
            text(
                "SELECT COALESCE(SUM(-amount), 0) FROM credit_transactions "
                "WHERE external_reference_id = :k AND transaction_type = 'USAGE_DEDUCTION'"
            ),
            {"k": idempotency_key},
        ).fetchone()
        return float(row[0] or 0) if row else 0.0
    except Exception:  # noqa: BLE001
        logger.warning("Could not read ledger charge for %s", idempotency_key, exc_info=True)
        return 0.0


DOWNLOAD_ATTEMPTS = 3
MAX_REDIRECTS = 5


async def _download(url: str, *, public_only: bool = False) -> bytes:
    """Stream a source file down, refusing anything over the size ceiling.

    Transport errors and 5xx are retried: external publishers' servers
    (ncert.nic.in in particular) drop connections now and then, and a dropped
    connection is not a reason to mark a 30-page chapter FAILED. 4xx is final.

    `public_only` (URL-sourced PDFs) re-runs the SSRF check on EVERY redirect
    hop, so a public URL cannot bounce the fetch onto an internal host.
    media_service URLs are ours and skip that.
    """
    last: Optional[Exception] = None
    for attempt in range(DOWNLOAD_ATTEMPTS):
        try:
            async with httpx.AsyncClient(
                timeout=180.0, follow_redirects=not public_only,
                headers={"User-Agent": "Mozilla/5.0 (compatible; VacademyKB/1.0)"},
            ) as client:
                target = url
                for _hop in range(MAX_REDIRECTS + 1):
                    if public_only:
                        parsing.assert_public_http_url(target)
                    async with client.stream("GET", target) as resp:
                        if public_only and resp.is_redirect:
                            location = resp.headers.get("location")
                            if not location:
                                raise ValueError("Redirect without a Location header")
                            target = str(resp.url.join(location))
                            continue
                        resp.raise_for_status()
                        declared = resp.headers.get("content-length")
                        if declared and int(declared) > MAX_SOURCE_BYTES:
                            raise ValueError(
                                f"File is {int(declared) // (1024 * 1024)}MB; the limit is "
                                f"{MAX_SOURCE_BYTES // (1024 * 1024)}MB"
                            )
                        buf = bytearray()
                        async for piece in resp.aiter_bytes():
                            buf.extend(piece)
                            if len(buf) > MAX_SOURCE_BYTES:
                                raise ValueError(
                                    f"File exceeds the {MAX_SOURCE_BYTES // (1024 * 1024)}MB limit"
                                )
                        return bytes(buf)
                raise ValueError(f"Too many redirects (>{MAX_REDIRECTS})")
        except httpx.HTTPStatusError as exc:
            last = exc
            if exc.response.status_code < 500:
                break  # a 404 / 403 will not improve on the second try
        except httpx.TransportError as exc:
            last = exc
        if attempt < DOWNLOAD_ATTEMPTS - 1:
            await asyncio.sleep(2 * (attempt + 1))
    raise ValueError(f"Could not download the file: {last}")


async def _pdf_url(source: Dict[str, Any]) -> tuple[str, bool]:
    """Where a PDF source's bytes live, and whether they are an outside URL.

    Uploaded documents carry a media_service file_id. Curriculum sources
    (V517) point straight at the publisher's own URL instead — NCERT serves
    every chapter as a public PDF, and copying 750 of them into media_service
    before ingesting would only add a second place for them to rot. The
    scrape-side SSRF guard applies: the URL must be public http(s).
    """
    file_id = source.get("file_id")
    if file_id:
        from ..media_file_client import get_file_url

        url = await get_file_url(file_id)
        if not url:
            raise ValueError("Could not resolve the uploaded file")
        return url, False
    url = (source.get("source_url") or "").strip()
    if not url:
        raise ValueError("This PDF source has no file attached")
    parsing.assert_public_http_url(url)
    return url, True


async def _parse_source(source: Dict[str, Any]) -> parsing.ParsedDocument:
    """Dispatch on source_kind. Returns a ParsedDocument or raises ValueError
    with a message safe to show the admin."""
    kind = source["source_kind"]

    if kind == "PDF":
        url, public_only = await _pdf_url(source)
        return await parsing.parse_pdf(await _download(url, public_only=public_only))

    if kind == "URL":
        return await parsing.parse_url(source["source_url"])

    if kind == "YOUTUBE":
        return await parsing.parse_youtube(source["source_url"])

    if kind == "TEXT":
        return parsing.parse_text(source.get("raw_text") or "")

    raise ValueError(f"Unsupported source kind '{kind}'")


async def ingest_source(
    *,
    source_id: str,
    institute_id: str,
    user_id: Optional[str] = None,
    build_index: bool = True,
    metering: Any = None,
) -> str:
    """Ingest one source end to end. Returns a JSON summary for ai_task.result_json.

    Opens its own DB sessions: this runs on a background task, so it must never
    touch a request-scoped session.
    """
    # --- Load the source and its KB ---
    with db_session() as db:
        repo = KbRepository(db)
        source = repo.get_source(source_id, institute_id)
        if not source:
            raise ValueError("Source not found")
        kb = repo.get_kb(source["knowledge_base_id"], institute_id)
        if not kb:
            raise ValueError("Knowledge base not found")
        kb_id = kb["id"]
        language_hint = kb.get("language_hint")
        source_title = source["title"]
        # A retry must not stack a second set of pages/figures/chunks on top of
        # the first attempt's partial output.
        repo.clear_source_derivatives(source_id)
        # The cached verbatim headings describe the PREVIOUS parse; a re-index
        # (new edition at the same URL, a better OCR) must re-read them.
        repo.clear_source_headings_cache(source_id)
        repo.update_source_progress(
            source_id, status="PROCESSING", progress=5, stage="parsing", error_message=""
        )
        # The model this base was created with — never the current default.
        embedding_model = repo.get_embedding_model(kb.get("embedding_model"))

    outcome: Dict[str, Any] = {
        "source_id": source_id,
        "knowledge_base_id": kb_id,
        "pages": 0,
        "ocr_pages": 0,
        "figures": 0,
        "chunks": 0,
        "nodes": 0,
        "review_pages": 0,
        "languages": [],
        "warnings": [],
    }

    try:
        # ---------------- parse ----------------
        document = await _parse_source(source)
        if not document.pages or not document.total_chars:
            raise ValueError(
                "No readable text was extracted. If this is a scanned book, the "
                "scan may be too low-quality to OCR."
            )
        if document.truncated_at:
            outcome["warnings"].append(
                f"Only the first {document.truncated_at} pages were ingested "
                f"(per-source limit)."
            )

        review_pages = sum(1 for p in document.pages if p.needs_review)
        outcome.update(
            pages=len(document.pages),
            ocr_pages=document.ocr_pages,
            review_pages=review_pages,
            languages=document.languages,
        )

        with db_session() as db:
            repo = KbRepository(db)
            repo.insert_pages(kb_id, institute_id, source_id, document.pages)
            repo.update_source_progress(
                source_id,
                progress=35,
                stage="figures",
                page_count=len(document.pages),
                pages_low_confidence=review_pages,
                ocr_pages=document.ocr_pages,
                parser=document.parser,
                detected_languages=document.languages,
            )

            # ---------------- figures ----------------
            figure_ids = repo.insert_figures(kb_id, institute_id, source_id, document.figures)
            outcome["figures"] = len(figure_ids)
            repo.update_source_progress(
                source_id, progress=45, stage="chunking", figure_count=len(figure_ids)
            )

        # ---------------- chunk ----------------
        chunks = build_chunks(
            document.pages,
            figures=document.figures,
            figure_ids=figure_ids,
            source_title=source_title,
            language_hint=language_hint,
        )
        if not chunks:
            raise ValueError("The extracted text was too short to index")

        # ---------------- embed ----------------
        with db_session() as db:
            KbRepository(db).update_source_progress(source_id, progress=55, stage="embedding")

        embedded_total = 0
        with db_session() as db:
            repo = KbRepository(db)
            embedder = EmbeddingService(ApiKeyResolver(db))
            try:
                for start in range(0, len(chunks), EMBED_BATCH):
                    batch = chunks[start:start + EMBED_BATCH]
                    vectors = await embedder.embed_batch(
                        [c.content_text for c in batch], institute_id,
                        model=embedding_model.model_id,
                    )
                    for chunk, vector in zip(batch, vectors):
                        chunk.embedding = vector
                    embedded_total += repo.insert_chunks(
                        kb_id=kb_id, institute_id=institute_id, source_id=source_id,
                        chunks=batch, model=embedding_model,
                    )
                    # 55 → 80% across the embedding phase.
                    done = min(80, 55 + int(25 * (start + len(batch)) / max(1, len(chunks))))
                    repo.update_source_progress(source_id, progress=done)
            finally:
                await embedder.close()

        outcome["chunks"] = embedded_total
        if embedded_total == 0:
            # Every batch was dropped — almost always a missing/invalid
            # OPENROUTER_API_KEY. Failing loudly beats a KB that looks ingested
            # and answers nothing.
            raise ValueError(
                "Text was extracted but no embeddings could be generated, so "
                "nothing is searchable. Check the AI provider key and retry."
            )
        if embedded_total < len(chunks):
            outcome["warnings"].append(
                f"{len(chunks) - embedded_total} of {len(chunks)} chunks could not "
                "be embedded and are not searchable."
            )

        # ---------------- summary tree ----------------
        # Only for documents substantial enough to HAVE structure. A three-line
        # fee-policy note has no chapters to summarise, and running the indexer
        # on it burnt two LLM calls per note — on a path that is deliberately
        # not metered, so the cost was invisible and unbounded in the number of
        # notes an institute types. Short sources still get a book node below,
        # so they remain visible in the outline.
        substantial = len(document.pages) >= 3 or document.total_chars >= MIN_CHARS_FOR_INDEX
        # Curriculum bases get their structure from the AUTHORED topic tree
        # (chapter = source, subtopics = the book's headings); the LLM summary
        # tree would duplicate it at ~6 model calls per chapter.
        if is_curriculum_kb(kb):
            substantial = False
        if build_index and substantial:
            with db_session() as db:
                KbRepository(db).update_source_progress(
                    source_id, progress=82, stage="summarizing"
                )
            with db_session() as db:
                index = await build_summary_index(
                    db,
                    kb_id=kb_id,
                    institute_id=institute_id,
                    source_id=source_id,
                    source_title=source_title,
                    pages=document.pages,
                    language_hint=language_hint,
                )
            outcome["nodes"] = index.nodes_created
            outcome["warnings"].extend(index.warnings)
            outcome["summary"] = index.book_summary
            outcome["chapters_detected"] = index.chapters_detected

            # Attach chunks to their section node now the tree exists. Chunks are
            # embedded before the tree is built, so node_id can only be filled in
            # here — and without it Phase 2 cannot go outline → passages.
            with db_session() as db:
                linked = KbRepository(db).link_chunks_to_nodes(source_id)
                logger.info("Linked %s chunk(s) to summary nodes for %s", linked, source_id)
        elif build_index:
            # Keep short sources visible in the outline without an LLM call.
            with db_session() as db:
                KbRepository(db).insert_node(
                    kb_id=kb_id, institute_id=institute_id, source_id=source_id,
                    parent_id=None, level="book", title=source_title,
                    summary=None, keywords=[], page_start=1,
                    page_end=len(document.pages), ordinal=0,
                )
            outcome["nodes"] = 1

        # ---------------- topic tree ----------------
        # Rebuilt across the WHOLE knowledge base after every ingest, not just
        # for this source: topics span sources, so adding a fourth past paper has
        # to fold into the existing "Electrochemistry" rather than create a
        # fourth copy of it. Best-effort — a corpus that is searchable but has a
        # stale topic map is far better than a failed ingest.
        if build_index:
            try:
                with db_session() as db:
                    KbRepository(db).update_source_progress(
                        source_id, progress=94, stage="summarizing"
                    )
                with db_session() as db:
                    from .topics import build_topic_tree

                    tree = await build_topic_tree(
                        db, kb_id=kb_id, institute_id=institute_id,
                        # This source is complete but still reads PROCESSING
                        # until finalize; the authored tree admits it by id.
                        current_source_id=source_id,
                    )
                outcome["topics"] = len(tree.topics)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Topic tree rebuild failed for kb=%s: %s", kb_id, exc)

        # ---------------- bill ----------------
        # Charged once, at the end, on delivered pages — never on requested
        # pages. A failed ingest is not billed at all.
        #
        # TEXT is deliberately NOT billed: the API documents pasted notes as free
        # and never pre-flights them, so charging here would take credits with no
        # preview and no warning — and the deprecated items API routes every
        # legacy FAQ edit through this same path.
        kind = source["source_kind"]
        tool_key = (
            "kb_ingest_page" if kind == "PDF"
            else "kb_ingest_url" if kind in ("URL", "YOUTUBE")
            else None
        )
        # Curriculum libraries are the platform's own uploads, made once for
        # every institute: not metered (see is_curriculum_kb).
        if is_curriculum_kb(kb):
            tool_key = None
        if tool_key:
            record_tool_billing(
                tool_key=tool_key,
                tool_params=(
                    {"num_pages": len(document.pages)} if tool_key == "kb_ingest_page" else {}
                ),
                request_type=RequestType.KNOWLEDGE_BASE,
                model=(embedding_model.model_id or "unknown"),
                institute_id=institute_id,
                user_id=user_id,
                user_role="ADMIN",
                request_id=source_id,
                use_case=UC.KNOWLEDGE_BASE,
                metering=metering if metering is not None else metering_user(user_id, surface="ADMIN_APP"),
                usage_context={"kb_id": kb_id, "source_id": source_id, "source_kind": kind},
                # Keyed on the source, so re-indexing or a webhook-style retry of
                # the same source can never charge twice.
                idempotency_key=f"kb_ingest:{source_id}",
            )

        # ---------------- finalize ----------------
        # PARTIAL, not READY, when pages were flagged: the admin should see that
        # a scan was imperfect rather than discover it via a bad question later.
        final_status = "PARTIAL" if (review_pages or outcome["warnings"]) else "READY"
        with db_session() as db:
            repo = KbRepository(db)
            repo.update_source_progress(
                source_id,
                status=final_status,
                progress=100,
                stage=None,
                chunk_count=embedded_total,
                error_message="" if final_status == "READY" else "; ".join(outcome["warnings"])[:2000],
                # What the ledger actually took for this source (0 for TEXT, and
                # the ORIGINAL charge on a re-index, since the key is the same).
                # Before this the column stayed at its default of 0 for every
                # source ever ingested, so the sources table showed nothing.
                credits_charged=_ledger_charge(db, f"kb_ingest:{source_id}") if tool_key else 0,
            )
            repo.refresh_stats(kb_id)

        logger.info(
            "KB ingest done: source=%s pages=%s ocr=%s chunks=%s figures=%s nodes=%s status=%s",
            source_id, outcome["pages"], outcome["ocr_pages"], outcome["chunks"],
            outcome["figures"], outcome["nodes"], final_status,
        )
        return json.dumps(outcome)

    except Exception as exc:  # noqa: BLE001
        logger.exception("KB ingest failed for source %s", source_id)
        with db_session() as db:
            repo = KbRepository(db)
            repo.update_source_progress(
                source_id, status="FAILED", stage=None, error_message=str(exc)[:2000]
            )
            try:
                repo.refresh_stats(kb_id)
            except Exception:  # noqa: BLE001
                pass
        # Re-raised so ai_task records FAILED too and the row is not stranded
        # in PROGRESS until the startup sweep.
        raise


async def probe_pdf(
    file_id: Optional[str] = None, *, source_url: Optional[str] = None
) -> tuple[int, Optional[str]]:
    """(page_count, sha256) for a PDF, from ONE download.

    Either a media_service `file_id` (uploads) or a public `source_url`
    (curriculum sources). add_source needs both numbers before it can dedup,
    pre-flight and enforce the page limit. Fetching separately meant
    downloading a 100MB textbook twice in a single request (three times
    counting the ingest job), which is slow enough on an Indian connection to
    look broken.

    The page count is opened via PyMuPDF on a worker thread — a synchronous
    open() of a large PDF on the event loop stalls every other request the
    worker is serving.
    """
    url, public_only = await _pdf_url({"file_id": file_id, "source_url": source_url})
    data = await _download(url, public_only=public_only)

    def _count(payload: bytes) -> int:
        import fitz

        doc = fitz.open(stream=payload, filetype="pdf")
        try:
            return int(doc.page_count)
        finally:
            doc.close()

    pages = await asyncio.to_thread(_count, data)
    return pages, parsing.sha256_bytes(data)


__all__ = ["ingest_source", "probe_pdf", "MAX_SOURCE_BYTES", "MIN_CHARS_FOR_INDEX"]
