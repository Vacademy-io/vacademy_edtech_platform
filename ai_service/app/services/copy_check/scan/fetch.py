"""Capped downloads of one load's pass files into a temp dir.

Same rules as upload_inspect._fetch: streamed, aborted past the per-file cap
(60 MB), 30 s per file, at most 3 redirects, and the URL is only ever logged
without its query string (a signed URL carries credentials). Each file is
isolated: a failed download is that file's error and the load carries on.
The whole load is capped too (400 MB): past it the remaining files are not
fetched and the load is reported LOAD_TOO_LARGE.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Sequence

import httpx

from . import config

logger = logging.getLogger(__name__)

ERR_FETCH = "fetch_failed"
ERR_FILE_TOO_LARGE = "file_too_large"
ERR_LOAD_TOO_LARGE = "load_too_large"

CONCURRENCY = 4


class _FileTooLarge(Exception):
    pass


class _LoadTooLarge(Exception):
    pass


@dataclass
class Fetched:
    path: Optional[str] = None
    error: Optional[str] = None
    size: int = 0


@dataclass
class FetchSpec:
    key: str           # caller's id for the file (e.g. "1:0")
    url: str
    suffix: str        # ".pdf" / ".img"


def safe_url(url: str) -> str:
    return (url or "").split("?", 1)[0][:120]


class _LoadBudget:
    def __init__(self, cap: int):
        self.cap = cap
        self.used = 0
        self.exceeded = False

    def take(self, n: int) -> None:
        self.used += n
        if self.used > self.cap:
            self.exceeded = True
            raise _LoadTooLarge()


async def _stream_to(client: httpx.AsyncClient, url: str, dest: Path, max_bytes: int,
                     budget: _LoadBudget) -> int:
    async with client.stream("GET", url) as resp:
        resp.raise_for_status()
        declared = resp.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > max_bytes:
            raise _FileTooLarge(declared)
        size = 0
        with open(dest, "wb") as out:
            async for chunk in resp.aiter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise _FileTooLarge(str(size))
                budget.take(len(chunk))
                out.write(chunk)
        return size


async def fetch_all(
    specs: Sequence[FetchSpec],
    tmpdir: Path,
    *,
    max_file_bytes: int = config.MAX_FILE_BYTES,
    max_load_bytes: int = config.MAX_LOAD_BYTES,
    timeout: float = config.FETCH_TIMEOUT_SECONDS,
    transport: Optional[httpx.AsyncBaseTransport] = None,
) -> tuple[dict[str, Fetched], bool]:
    """Download every file. Returns ({key: Fetched}, load_too_large)."""
    budget = _LoadBudget(max_load_bytes)
    results: dict[str, Fetched] = {}
    sem = asyncio.Semaphore(CONCURRENCY)
    kwargs: dict[str, Any] = {"timeout": timeout, "follow_redirects": True, "max_redirects": 3}
    if transport is not None:
        kwargs["transport"] = transport

    async with httpx.AsyncClient(**kwargs) as client:
        async def one(index: int, spec: FetchSpec) -> None:
            async with sem:
                if budget.exceeded:
                    results[spec.key] = Fetched(error=ERR_LOAD_TOO_LARGE)
                    return
                if not spec.url.lower().startswith(("https://", "http://")):
                    results[spec.key] = Fetched(error=ERR_FETCH)
                    return
                dest = tmpdir / f"f{index}{spec.suffix}"
                try:
                    size = await asyncio.wait_for(
                        _stream_to(client, spec.url, dest, max_file_bytes, budget), timeout=timeout)
                    results[spec.key] = Fetched(path=str(dest), size=size)
                except _LoadTooLarge:
                    results[spec.key] = Fetched(error=ERR_LOAD_TOO_LARGE)
                except _FileTooLarge:
                    logger.info("scan fetch: file over %d bytes: %s", max_file_bytes, safe_url(spec.url))
                    results[spec.key] = Fetched(error=ERR_FILE_TOO_LARGE)
                except Exception as e:  # noqa: BLE001 - class name only: messages carry the signed URL
                    logger.info("scan fetch: failed for %s: %s", safe_url(spec.url), type(e).__name__)
                    results[spec.key] = Fetched(error=ERR_FETCH)
                if results[spec.key].error and dest.exists():
                    try:
                        dest.unlink()
                    except OSError:
                        pass

        await asyncio.gather(*(one(i, s) for i, s in enumerate(specs)))
    return results, budget.exceeded
