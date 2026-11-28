"""Upload inspection for POST /copy-check/inspect (spec 7.5, T1.14).

assessment_service asks this before it accepts an uploaded answer sheet: how
many pages, is it encrypted, can it be parsed at all. PDF parsing lives here so
it never runs in the assessment_service pods that serve live exams.

Caps: 60 MB download (streamed, aborted past the cap), 200 pages, 10 s of
parsing (the parse runs in a worker thread so a hostile PDF cannot stall the
event loop). The download has its own timeout.

Per-pod bound: at most COPY_CHECK_MAX_CONCURRENT_INSPECTS (default 4) inspects
hold a download buffer or a parse thread at once; a caller that cannot get a
slot within COPY_CHECK_INSPECT_SLOT_WAIT_SECONDS gets InspectBusy (429 from the
route). Parsing runs in this module's own small thread pool, never the default
asyncio executor that job_guard's claim/heartbeat calls use. A parse that
overruns its 10 s cannot be killed (it is a thread), so its slot stays taken
until the thread really ends: a burst of hostile PDFs turns into 429s, not into
unbounded threads and memory.

Result: {"pages": int|None, "encrypted": bool, "error": None|"unparseable"|
"too_many_pages"|"fetch_failed"}.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional, Union

import httpx

logger = logging.getLogger(__name__)


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


MAX_PAGES = 200
MAX_BYTES = 60 * 1024 * 1024
PARSE_TIMEOUT_SECONDS = _float_env("COPY_CHECK_INSPECT_PARSE_TIMEOUT_SECONDS", 10.0)
FETCH_TIMEOUT_SECONDS = _float_env("COPY_CHECK_INSPECT_FETCH_TIMEOUT_SECONDS", 30.0)

MAX_CONCURRENT_INSPECTS = max(1, int(_float_env("COPY_CHECK_MAX_CONCURRENT_INSPECTS", 4)))
SLOT_WAIT_SECONDS = _float_env("COPY_CHECK_INSPECT_SLOT_WAIT_SECONDS", 5.0)

UNPARSEABLE = "unparseable"
TOO_MANY_PAGES = "too_many_pages"
FETCH_FAILED = "fetch_failed"


class _TooLarge(Exception):
    pass


class InspectBusy(Exception):
    """Every inspect slot on this pod is taken; retry shortly."""


class _Slots:
    """Thread-safe counter: acquired on the event loop, released either there
    or from the parse thread when an overrun parse finally ends."""

    def __init__(self, limit: int):
        self.limit = limit
        self.in_use = 0
        self._lock = threading.Lock()

    def try_acquire(self) -> bool:
        with self._lock:
            if self.in_use >= self.limit:
                return False
            self.in_use += 1
            return True

    def release(self) -> None:
        with self._lock:
            if self.in_use > 0:
                self.in_use -= 1


slots = _Slots(MAX_CONCURRENT_INSPECTS)
_executor: Optional[ThreadPoolExecutor] = None
_executor_lock = threading.Lock()


def _parse_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_INSPECTS,
                                           thread_name_prefix="copy-check-inspect")
        return _executor


async def _acquire_slot(wait_seconds: float) -> bool:
    deadline = time.monotonic() + max(0.0, wait_seconds)
    while not slots.try_acquire():
        if time.monotonic() >= deadline:
            return False
        await asyncio.sleep(0.05)
    return True


def result(pages: Optional[int] = None, encrypted: bool = False, error: Optional[str] = None) -> dict[str, Any]:
    return {"pages": pages, "encrypted": encrypted, "error": error}


def _looks_like_pdf(data: Union[bytes, bytearray]) -> bool:
    # The header may follow a little junk (some scanners write a BOM or a few
    # bytes first); PDF readers accept it within the first KB.
    return b"%PDF-" in data[:1024]


def inspect_pdf_bytes(data: Union[bytes, bytearray], max_pages: int = MAX_PAGES) -> dict[str, Any]:
    """Page count and encryption of an in-memory PDF. Never raises."""
    if not data or not _looks_like_pdf(data):
        return result(error=UNPARSEABLE)
    try:
        import fitz  # PyMuPDF
    except Exception:  # pragma: no cover - PyMuPDF is in requirements.txt
        logger.exception("copy-check inspect: PyMuPDF is not importable")
        return result(error=UNPARSEABLE)
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:
        logger.info("copy-check inspect: open failed: %s", e)
        return result(error=UNPARSEABLE)
    try:
        metadata = getattr(doc, "metadata", None) or {}
        encrypted = bool(
            getattr(doc, "needs_pass", False)
            or getattr(doc, "is_encrypted", False)
            or metadata.get("encryption")
        )
        if getattr(doc, "needs_pass", False) and not doc.authenticate(""):
            # A user password we do not have: nothing downstream can render it.
            return result(encrypted=True, error=UNPARSEABLE)
        pages = int(doc.page_count)
    except Exception as e:
        logger.info("copy-check inspect: reading the page count failed: %s", e)
        return result(error=UNPARSEABLE)
    finally:
        try:
            doc.close()
        except Exception:
            pass
    if pages <= 0:
        return result(encrypted=encrypted, error=UNPARSEABLE)
    if pages > max_pages:
        return result(pages=pages, encrypted=encrypted, error=TOO_MANY_PAGES)
    return result(pages=pages, encrypted=encrypted)


async def _fetch(url: str, max_bytes: int, timeout: float,
                 transport: Optional[httpx.AsyncBaseTransport]) -> bytearray:
    kwargs: dict[str, Any] = {"timeout": timeout, "follow_redirects": True, "max_redirects": 3}
    if transport is not None:
        kwargs["transport"] = transport
    async with httpx.AsyncClient(**kwargs) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            declared = resp.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > max_bytes:
                raise _TooLarge(declared)
            # One growing buffer (no chunk list + join): peak memory ~ file size.
            data = bytearray()
            async for chunk in resp.aiter_bytes():
                if len(data) + len(chunk) > max_bytes:
                    raise _TooLarge(str(len(data) + len(chunk)))
                data += chunk
            return data


async def inspect_pdf_url(
    url: str,
    *,
    max_bytes: int = MAX_BYTES,
    max_pages: int = MAX_PAGES,
    fetch_timeout: float = FETCH_TIMEOUT_SECONDS,
    parse_timeout: float = PARSE_TIMEOUT_SECONDS,
    transport: Optional[httpx.AsyncBaseTransport] = None,
    slot_wait: float = SLOT_WAIT_SECONDS,
) -> dict[str, Any]:
    """Download (capped) and inspect. Raises only InspectBusy (no free slot);
    every problem with the file itself is reported in the result."""
    if not url.lower().startswith(("https://", "http://")):
        return result(error=FETCH_FAILED)
    if not await _acquire_slot(slot_wait):
        raise InspectBusy()
    release_here = True
    try:
        return await _inspect_with_slot(url, max_bytes, max_pages, fetch_timeout, parse_timeout, transport)
    except _ParseOverrun as overrun:
        # The parse thread still holds the slot; it frees it when it ends.
        release_here = False
        overrun.future.add_done_callback(lambda _f: slots.release())
        return result(error=UNPARSEABLE)
    finally:
        if release_here:
            slots.release()


class _ParseOverrun(Exception):
    def __init__(self, future):
        super().__init__("parse overran its time cap")
        self.future = future


async def _inspect_with_slot(
    url: str,
    max_bytes: int,
    max_pages: int,
    fetch_timeout: float,
    parse_timeout: float,
    transport: Optional[httpx.AsyncBaseTransport],
) -> dict[str, Any]:
    try:
        data = await asyncio.wait_for(_fetch(url, max_bytes, fetch_timeout, transport), timeout=fetch_timeout)
    except _TooLarge as e:
        # Above the cap: assessment_service rejects anything over 50 MB from the
        # object's HEAD before it asks, so this is a defence, not a normal path.
        logger.info("copy-check inspect: file over %d bytes (%s)", max_bytes, e)
        return result(error=FETCH_FAILED)
    except Exception as e:
        # Class name only: httpx error messages carry the full (signed) URL.
        logger.info("copy-check inspect: fetch failed for %s: %s", url.split("?", 1)[0][:120], type(e).__name__)
        return result(error=FETCH_FAILED)
    future = _parse_executor().submit(inspect_pdf_bytes, data, max_pages)
    del data  # the worker holds the only reference now
    try:
        # shield: on timeout the thread keeps running; only our wait ends.
        return await asyncio.wait_for(asyncio.shield(asyncio.wrap_future(future)), timeout=parse_timeout)
    except asyncio.TimeoutError:
        logger.info("copy-check inspect: parse exceeded %.0f s", parse_timeout)
        raise _ParseOverrun(future)
