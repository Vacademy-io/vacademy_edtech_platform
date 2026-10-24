"""OMR read requests: download the scan, read it in the worker pool, upload the images.

The CPU work (rendering, marker search, bubble reading) runs in a small pool of
spawned processes - see reader.py for why OMRChecker never runs in this process.
The pool is shared by every request on the pod and bounded twice: by its process
count, and by a semaphore on queued requests, so a burst of uploads gets 429s
(assessment_service retries) instead of a growing queue of pinned CPUs.

Nothing is stored here. The page images are uploaded to media-service and only
their file ids go back; assessment_service keeps every result.
"""
from __future__ import annotations

import asyncio
import logging
import multiprocessing
import os
from concurrent.futures import ProcessPoolExecutor
from typing import Any, Optional

import httpx

from . import reader

logger = logging.getLogger(__name__)

MAX_FILE_BYTES = 60 * 1024 * 1024
MAX_PAGES_PER_CALL = 25

_WORKERS = max(1, int(os.getenv("OMR_WORKERS", "2")))
# Calls admitted at once on this pod (running + waiting for a worker).
_ADMIT = asyncio.Semaphore(max(1, int(os.getenv("OMR_MAX_CALLS", "4"))))

_pool: Optional[ProcessPoolExecutor] = None


class OmrBusy(Exception):
    """Every OMR slot on this pod is taken; the caller should retry later."""


def _get_pool() -> ProcessPoolExecutor:
    global _pool
    if _pool is None:
        _pool = ProcessPoolExecutor(
            max_workers=_WORKERS,
            mp_context=multiprocessing.get_context("spawn"),
            initializer=reader.init_worker,
        )
    return _pool


def _media_base_url() -> str:
    return os.getenv("MEDIA_SERVER_BASE_URL", "http://media-service:8075").rstrip("/")


async def _download(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            chunks, size = [], 0
            async for chunk in resp.aiter_bytes():
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise ValueError(f"the file is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB")
                chunks.append(chunk)
            return b"".join(chunks)


async def _upload(client: httpx.AsyncClient, content: bytes, filename: str, content_type: str) -> Optional[str]:
    """media-service upload-file-v2 -> fileId (see copy_check/annotator._upload for the auth)."""
    from ..internal_auth import internal_auth_headers

    resp = await client.post(
        f"{_media_base_url()}/media-service/internal/upload-file-v2",
        files={"file": (filename, content, content_type)},
        headers=await internal_auth_headers(),
    )
    resp.raise_for_status()
    return (resp.json() or {}).get("id") or None


async def read(req: dict[str, Any]) -> dict[str, Any]:
    """Count the pages of one file, or read the requested pages of it."""
    pages: list[int] = sorted({int(p) for p in (req.get("pages") or [])})
    if len(pages) > MAX_PAGES_PER_CALL:
        raise ValueError(f"at most {MAX_PAGES_PER_CALL} pages per call")

    try:
        await asyncio.wait_for(_ADMIT.acquire(), timeout=2)
    except asyncio.TimeoutError as e:
        raise OmrBusy("OMR reading is busy on this pod") from e
    try:
        content = await _download(req["file_url"])
        kind = req.get("file_kind") or "pdf"
        loop = asyncio.get_running_loop()
        page_count = await loop.run_in_executor(_get_pool(), reader.count_pages, content, kind)
        if not pages:
            return {"page_count": page_count, "pages": []}

        reads: list[reader.PageRead] = await loop.run_in_executor(
            _get_pool(), reader.read_file, content, kind, pages,
            req["template"], req["marker"], req["layout"],
        )
    finally:
        _ADMIT.release()

    prefix = req.get("file_name_prefix") or "omr"
    out_pages = []
    async with httpx.AsyncClient(timeout=120) as client:
        for r in reads:
            ids: dict[str, Optional[str]] = {"sheet_file_id": None, "marked_file_id": None, "name_crop_file_id": None}
            try:
                if r.sheet_pdf:
                    ids["sheet_file_id"] = await _upload(client, r.sheet_pdf, f"{prefix}-p{r.page_no}.pdf", "application/pdf")
                if r.marked_jpeg:
                    ids["marked_file_id"] = await _upload(client, r.marked_jpeg, f"{prefix}-p{r.page_no}-marked.jpg", "image/jpeg")
                if r.name_crop_jpeg:
                    ids["name_crop_file_id"] = await _upload(client, r.name_crop_jpeg, f"{prefix}-p{r.page_no}-name.jpg", "image/jpeg")
            except Exception as e:  # noqa: BLE001
                # The reading stands without its pictures; the reviewer sees no image.
                logger.warning("omr: image upload failed for %s page %s: %s", prefix, r.page_no, e)
            out_pages.append({
                "page_no": r.page_no,
                "status": r.status,
                "error": r.error,
                "rotated": r.rotated,
                "values": r.values,
                "low_confidence": r.low_confidence,
                **ids,
            })
    return {"page_count": page_count, "pages": out_pages}
