"""POST /copy-check/scan/build: download the pass files, build one PDF per copy
in the worker pool, upload each one.

Stateless and synchronous: assessment_service owns every result and retries
failed copies. A copy that fails (unreadable source, bad page, too large, upload
refused, out of time) gets its own `error`; the call itself still answers 200.

Bounded twice, like OMR: a spawned process pool (SCAN_BUILD_WORKERS) for the
CPU work, and an admit counter (SCAN_BUILD_MAX_CALLS) on whole calls, so a
second call while one runs gets 429 instead of queueing behind it.
"""
from __future__ import annotations

import asyncio
import logging
import multiprocessing
import os
import shutil
import tempfile
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from typing import Any, Optional

import httpx

from . import builder, media_upload

logger = logging.getLogger(__name__)

MAX_FILE_BYTES = 60 * 1024 * 1024
MAX_CALL_DOWNLOAD_BYTES = 800 * 1024 * 1024
FETCH_TIMEOUT_SECONDS = 60.0
FETCH_CONCURRENCY = 4
UPLOAD_CONCURRENCY = 3
ADMIT_WAIT_SECONDS = 2.0
# Java waits 300 s; finish (with TIMEOUT on the stragglers) well inside that.
CALL_BUDGET_SECONDS = 240.0

SOURCE_UNREADABLE = "SOURCE_UNREADABLE"
UPLOAD_FAILED = "UPLOAD_FAILED"
TIMEOUT = "TIMEOUT"


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


_WORKERS = _env_int("SCAN_BUILD_WORKERS", 2)
_MAX_CALLS = _env_int("SCAN_BUILD_MAX_CALLS", 1)


class ScanBuildBusy(Exception):
    """Every build slot on this pod is taken; the caller should retry later."""


class _Admit:
    """Thread-safe call counter. Not an asyncio.Semaphore, so it is not tied to
    one event loop."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.taken = 0
        self._lock = threading.Lock()

    def try_take(self) -> bool:
        with self._lock:
            if self.taken >= self.limit:
                return False
            self.taken += 1
            return True

    def give_back(self) -> None:
        with self._lock:
            self.taken = max(0, self.taken - 1)

    async def take(self, wait: float) -> bool:
        deadline = time.monotonic() + wait
        while True:
            if self.try_take():
                return True
            if time.monotonic() >= deadline:
                return False
            await asyncio.sleep(0.1)


_admit = _Admit(_MAX_CALLS)
_pool: Optional[ProcessPoolExecutor] = None
_pool_lock = threading.Lock()


def _get_pool() -> ProcessPoolExecutor:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ProcessPoolExecutor(max_workers=_WORKERS,
                                        mp_context=multiprocessing.get_context("spawn"))
        return _pool


def _drop_broken_pool(pool: ProcessPoolExecutor) -> None:
    global _pool
    with _pool_lock:
        if _pool is pool:
            _pool = None
    pool.shutdown(wait=False, cancel_futures=True)


def _bare(url: str) -> str:
    return url.split("?", 1)[0][:120]


class _CallTooLarge(Exception):
    pass


async def _download(url: str, dest: str, budget: list[int],
                    transport: Optional[httpx.AsyncBaseTransport]) -> None:
    """Stream `url` into `dest`, at most MAX_FILE_BYTES; `budget` = bytes left
    for the whole call (shared, decremented as bytes arrive)."""
    kwargs: dict[str, Any] = {"timeout": FETCH_TIMEOUT_SECONDS, "follow_redirects": True, "max_redirects": 3}
    if transport is not None:
        kwargs["transport"] = transport
    async with httpx.AsyncClient(**kwargs) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            size = 0
            with open(dest, "wb") as f:
                async for chunk in resp.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_FILE_BYTES:
                        raise ValueError("source file over the size cap")
                    budget[0] -= len(chunk)
                    if budget[0] < 0:
                        raise _CallTooLarge()
                    f.write(chunk)


async def _fetch_all(urls: list[str], workdir: str, deadline: float,
                     transport: Optional[httpx.AsyncBaseTransport]) -> dict[str, str]:
    """{url: local path} for every url that downloaded; failures are left out."""
    gate = asyncio.Semaphore(FETCH_CONCURRENCY)
    budget = [MAX_CALL_DOWNLOAD_BYTES]
    paths: dict[str, str] = {}

    async def _one(i: int, url: str) -> None:
        dest = os.path.join(workdir, f"src_{i}")
        async with gate:
            left = deadline - time.monotonic()
            if left <= 0:
                return
            try:
                await asyncio.wait_for(_download(url, dest, budget, transport),
                                       timeout=min(FETCH_TIMEOUT_SECONDS, left))
                paths[url] = dest
            except Exception as e:  # noqa: BLE001 - one bad file only fails its copies
                # Class name only: httpx messages carry the full signed URL.
                logger.info("scan-build: fetch failed for %s: %s", _bare(url), type(e).__name__)

    await asyncio.gather(*(_one(i, u) for i, u in enumerate(urls)))
    return paths


async def _build_in_pool(pages: list[dict[str, Any]], sources: dict[str, str], out_path: str) -> dict[str, Any]:
    pool = _get_pool()
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(pool, builder.build_copy, pages, sources, out_path)
    except BrokenProcessPool:
        # A worker died (out of memory?): start a fresh pool for the next call.
        logger.warning("scan-build: worker pool broke; restarting it")
        _drop_broken_pool(pool)
        return {"page_count": 0, "bytes": 0, "error": builder.BUILD_FAILED}


def _result(copy_key: str, error: Optional[str] = None, **kw: Any) -> dict[str, Any]:
    return {"copy_key": copy_key, "file_id": kw.get("file_id"), "page_count": kw.get("page_count", 0),
            "bytes": kw.get("bytes", 0), "error": error}


async def build_copies(
    copies: list[dict[str, Any]],
    *,
    institute_id: str,
    source_id: str,
    session_id: Optional[str] = None,
    transport: Optional[httpx.AsyncBaseTransport] = None,
    budget_seconds: float = CALL_BUDGET_SECONDS,
) -> list[dict[str, Any]]:
    """One result per copy, in request order. Raises only ScanBuildBusy.

    `copies` = [{copy_key, file_name, pages: [{url, kind, page_index, rotation, dpi}]}]
    """
    if not await _admit.take(ADMIT_WAIT_SECONDS):
        raise ScanBuildBusy()
    started = time.monotonic()
    deadline = started + budget_seconds
    workdir = tempfile.mkdtemp(prefix="scan_build_")
    try:
        urls = list(dict.fromkeys(p["url"] for c in copies for p in c["pages"]))
        sources = await _fetch_all(urls, workdir, deadline, transport)
        upload_gate = asyncio.Semaphore(UPLOAD_CONCURRENCY)

        async def _one(i: int, c: dict[str, Any]) -> dict[str, Any]:
            key = c["copy_key"]
            if any(p["url"] not in sources for p in c["pages"]):
                return _result(key, SOURCE_UNREADABLE)
            out_path = os.path.join(workdir, f"copy_{i}.pdf")
            mine = {p["url"]: sources[p["url"]] for p in c["pages"]}
            built = await _build_in_pool(c["pages"], mine, out_path)
            if built.get("error"):
                return _result(key, built["error"])
            with open(out_path, "rb") as f:
                content = f.read()
            async with upload_gate:
                try:
                    file_id = await media_upload.upload_pdf(
                        content, c["file_name"], institute_id=institute_id,
                        source_id=source_id, transport=transport)
                except Exception as e:  # noqa: BLE001 - this copy only
                    logger.warning("scan-build: upload failed for %s/%s: %s",
                                   session_id, key, type(e).__name__)
                    return _result(key, UPLOAD_FAILED)
            return _result(key, None, file_id=file_id, page_count=built["page_count"], bytes=built["bytes"])

        tasks = [asyncio.ensure_future(_one(i, c)) for i, c in enumerate(copies)]
        left = max(0.0, deadline - time.monotonic())
        _done, pending = await asyncio.wait(tasks, timeout=left)
        for t in pending:
            t.cancel()
        if pending:
            # Let the cancellations land before the temp dir goes away. A worker
            # already running finishes in the background; its output is dropped.
            await asyncio.gather(*pending, return_exceptions=True)
        results = []
        for c, t in zip(copies, tasks):
            if t.done() and not t.cancelled() and t.exception() is None:
                results.append(t.result())
            elif t.done() and not t.cancelled():
                logger.warning("scan-build: copy %s failed: %s", c["copy_key"], type(t.exception()).__name__)
                results.append(_result(c["copy_key"], builder.BUILD_FAILED))
            else:
                results.append(_result(c["copy_key"], TIMEOUT))
        logger.info("scan-build: session %s institute %s: %d copies, %d ok, %.1f s",
                    session_id, institute_id, len(copies),
                    sum(1 for r in results if not r["error"]), time.monotonic() - started)
        return results
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        _admit.give_back()
