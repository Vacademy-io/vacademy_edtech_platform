"""Automatic external_api_call_log rows for every third-party call made through httpx.

ai_service builds its httpx clients in over a hundred places, so wrapping `send` on the
client classes is the one spot that also covers clients nobody has written yet. A new vendor
then appears on the health dashboard, named by its host, with no change here or there.

Only metadata is kept: host, method, the first two path segments, status and timing. Bodies,
headers and query strings are never read, because they hold keys and learner content.

Installing is safe: while external_apis.auto_capture is off, rows are dropped on the log's
pool thread. Nothing here can change or fail the request it observes, and a streamed
response is timed to its headers.
"""
from __future__ import annotations

import functools
import ipaddress
import logging
import time
from typing import Any, Optional

import httpx

from .external_api_log import record_external_call

logger = logging.getLogger(__name__)

MAX_OPERATION_LENGTH = 64
INTERNAL_SUFFIXES = (".svc", ".local", ".internal", ".cluster.local", ".vacademy.io")
INTERNAL_HOSTS = ("localhost", "vacademy.io")

_installed = False


def vendor_for_host(host: Optional[str]) -> Optional[str]:
    """The host as a vendor name, or None for our own services, which are not external APIs."""
    host = (host or "").strip().lower().rstrip(".")
    # A bare name ("admin-core-service") is a Kubernetes service.
    if not host or "." not in host or host in INTERNAL_HOSTS or host.endswith(INTERNAL_SUFFIXES):
        return None
    try:
        ipaddress.ip_address(host)
        return None
    except ValueError:
        return host


def _operation(request: httpx.Request) -> str:
    segments = [s for s in request.url.path.split("/") if s][:2]
    return f"{request.method} /{'/'.join(segments)}"[:MAX_OPERATION_LENGTH]


def _record(request: httpx.Request, started: float, status: Optional[int], error: Optional[str]) -> None:
    try:
        vendor = vendor_for_host(request.url.host)
        if vendor is None:
            return
        record_external_call(
            vendor=vendor,
            operation=_operation(request),
            status="FAILED" if error or (status or 0) >= 400 else "SUCCESS",
            http_status=status,
            duration_ms=int((time.monotonic() - started) * 1000),
            error_message=error,
            automatic=True,
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("httpx-capture: skipped: %s", exc)


def _request_of(args: tuple, kwargs: dict) -> Any:
    return args[0] if args else kwargs.get("request")


def install() -> None:
    """Wrap httpx's send methods once per process."""
    global _installed
    if _installed:
        return
    _installed = True
    sync_send = httpx.Client.send
    async_send = httpx.AsyncClient.send

    @functools.wraps(sync_send)
    def send(self: httpx.Client, *args: Any, **kwargs: Any) -> httpx.Response:
        started = time.monotonic()
        request = _request_of(args, kwargs)
        try:
            response = sync_send(self, *args, **kwargs)
        except Exception as exc:
            _record(request, started, None, type(exc).__name__)
            raise
        _record(request, started, response.status_code, None)
        return response

    @functools.wraps(async_send)
    async def asend(self: httpx.AsyncClient, *args: Any, **kwargs: Any) -> httpx.Response:
        started = time.monotonic()
        request = _request_of(args, kwargs)
        try:
            response = await async_send(self, *args, **kwargs)
        except Exception as exc:
            _record(request, started, None, type(exc).__name__)
            raise
        _record(request, started, response.status_code, None)
        return response

    httpx.Client.send = send
    httpx.AsyncClient.send = asend


__all__ = ["install", "vendor_for_host"]
