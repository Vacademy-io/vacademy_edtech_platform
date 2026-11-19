"""Automatic external_api_call_log rows for every third-party call made through httpx.

ai_service builds its httpx clients in over a hundred places, so wrapping `send` on the
client classes is the one spot that also covers clients nobody has written yet. A new vendor
then appears on the health dashboard, named by its host, with no change here or there.

Only metadata is kept: host, method, the first two path segments, status and timing. Bodies,
headers and query strings are never read, because they hold keys and learner content.

Installing is safe: failures are always recorded; successes only while
external_apis.auto_capture is on, and otherwise dropped on the log's pool thread. Nothing
here can change or fail the request it observes, and a streamed response is timed to its
headers.
"""
from __future__ import annotations

import functools
import ipaddress
import logging
import time
from typing import Any, Dict, Optional

import httpx

from .external_api_log import record_external_call
from .integrated_vendors import body_summary, integrated_vendor

logger = logging.getLogger(__name__)

MAX_OPERATION_LENGTH = 64
INTERNAL_SUFFIXES = (".svc", ".local", ".internal", ".cluster.local", ".vacademy.io")
INTERNAL_HOSTS = ("localhost", "vacademy.io")

_installed = False


def vendor_for_host(host: Optional[str]) -> Optional[str]:
    """The host, when it belongs to an integrated vendor; None otherwise.

    Only integrations are recorded: our own services, the cluster, and every other site an
    HTTP client reaches (an institute's website fetched for lead research, a scraped page)
    are not third-party APIs and would bury the real failures."""
    host = (host or "").strip().lower().rstrip(".")
    # A bare name ("admin-core-service") is a Kubernetes service.
    if not host or "." not in host or host in INTERNAL_HOSTS or host.endswith(INTERNAL_SUFFIXES):
        return None
    try:
        ipaddress.ip_address(host)
        return None
    except ValueError:
        pass
    return host if integrated_vendor(host) else None


def _operation(request: httpx.Request) -> str:
    segments = [s for s in request.url.path.split("/") if s][:2]
    return f"{request.method} /{'/'.join(segments)}"[:MAX_OPERATION_LENGTH]


def _request_summary(request: httpx.Request) -> Dict[str, Any]:
    """What we sent, for debugging a failure: method, path, query parameter names (values can
    carry keys), and the body with secrets and personal fields hidden. Never headers."""
    out: Dict[str, Any] = {"method": request.method, "path": request.url.path}
    if request.url.params:
        out["query_params"] = sorted(set(request.url.params.keys()))
    try:
        body = body_summary(request.content)  # raises for a streamed body that was not read
    except Exception:  # noqa: BLE001
        body = None
    if body is not None:
        out["body"] = body
    return out


def _response_summary(response: Optional[httpx.Response], streamed: bool) -> Optional[Dict[str, Any]]:
    """What the vendor answered: status and its body (the error message), when the body was
    already read. A streamed response is left unread so the caller still gets all of it."""
    if response is None:
        return None
    out: Dict[str, Any] = {"status": response.status_code, "reason": response.reason_phrase}
    if not streamed:
        try:
            body = body_summary(response.content)
        except Exception:  # noqa: BLE001
            body = None
        if body is not None:
            out["body"] = body
    return out


def _record(request: httpx.Request, started: float, status: Optional[int], error: Optional[str],
            response: Optional[httpx.Response] = None, streamed: bool = False) -> None:
    try:
        vendor = vendor_for_host(request.url.host)
        if vendor is None:
            return
        failed = bool(error) or (status or 0) >= 400
        record_external_call(
            vendor=vendor,
            operation=_operation(request),
            status="FAILED" if failed else "SUCCESS",
            http_status=status,
            duration_ms=int((time.monotonic() - started) * 1000),
            error_message=error,
            # Bodies only for failures: that is what someone debugs, and successes are many.
            request_summary=_request_summary(request) if failed else None,
            response_summary=_response_summary(response, streamed) if failed else None,
            # Failures are always kept: they are what the dashboard is for. Only successes
            # wait for external_apis.auto_capture.
            automatic=not failed,
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
        _record(request, started, response.status_code, None, response, bool(kwargs.get("stream")))
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
        _record(request, started, response.status_code, None, response, bool(kwargs.get("stream")))
        return response

    httpx.Client.send = send
    httpx.AsyncClient.send = asend


__all__ = ["install", "vendor_for_host"]
