"""Automatic external_api_call_log rows for every third-party call made through httpx.

ai_service builds its httpx clients in over a hundred places, so wrapping `send` on the
client classes is the one spot that also covers clients nobody has written yet. A new vendor
then appears on the health dashboard, named by its host, with no change here or there.

Only metadata is kept: host, method, the first two path segments, status and timing. Bodies,
headers and query strings are never read, because they hold keys and learner content.

Calls made with `requests` and `urllib` (the video pipeline's OpenRouter, Serper, Pexels,
Pixabay and RunPod calls) are watched the same way. A failure is always recorded; successes only
while external_apis.auto_capture is on. Nothing here can change or fail the request it observes, and a streamed
response is timed to its headers.
"""
from __future__ import annotations

import functools
import io
import ipaddress
import logging
import time
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl, urlsplit

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
            # A failure is always kept. Successes are many, so they follow external_apis.auto_capture.
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
    _install_requests()
    _install_urllib()



def _record_plain(method: str, url: str, started: float, status: Optional[int], error: Optional[str],
                  sent: Any = None, reason: Optional[str] = None, answered: Any = None,
                  read_answer: bool = True) -> None:
    """The same row as _record, for clients that are not httpx (requests, urllib)."""
    try:
        parsed = urlsplit(url or "")
        vendor = vendor_for_host(parsed.hostname)
        if vendor is None:
            return
        failed = bool(error) or (status or 0) >= 400
        request_summary = response_summary = None
        if failed:
            request_summary = {"method": method, "path": parsed.path}
            if parsed.query:
                request_summary["query_params"] = sorted({k for k, _ in parse_qsl(parsed.query, keep_blank_values=True)})
            body = body_summary(sent) if sent is not None else None
            if body is not None:
                request_summary["body"] = body
            if status is not None:
                response_summary = {"status": status, "reason": reason}
                body = body_summary(answered) if (read_answer and answered is not None) else None
                if body is not None:
                    response_summary["body"] = body
        segments = [s for s in parsed.path.split("/") if s][:2]
        record_external_call(
            vendor=vendor,
            operation=f"{method} /{'/'.join(segments)}"[:MAX_OPERATION_LENGTH],
            status="FAILED" if failed else "SUCCESS",
            http_status=status,
            duration_ms=int((time.monotonic() - started) * 1000),
            error_message=error,
            request_summary=request_summary,
            response_summary=response_summary,
            automatic=not failed,
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("http-capture: skipped: %s", exc)


def _install_requests() -> None:
    try:
        import requests
    except Exception:  # noqa: BLE001
        return
    original = requests.Session.send

    @functools.wraps(original)
    def send(self: Any, request: Any, **kwargs: Any) -> Any:
        started = time.monotonic()
        try:
            response = original(self, request, **kwargs)
        except Exception as exc:
            _record_plain(request.method or "GET", request.url, started, None, type(exc).__name__, request.body)
            raise
        streamed = bool(kwargs.get("stream"))
        status = response.status_code
        _record_plain(request.method or "GET", request.url, started, status, None,
                      request.body if status >= 400 else None, response.reason,
                      response.content if (status >= 400 and not streamed) else None, not streamed)
        return response

    requests.Session.send = send


def replay_http_error(err: Any) -> bytes:
    """Read an urllib HTTPError's body and put it back, so the caller can still read it."""
    body = err.read() or b""
    fresh = io.BytesIO(body)
    err.fp = fresh
    err.__dict__["file"] = fresh
    # tempfile's wrapper caches bound methods of the old file on first use.
    for name in ("read", "readline", "readlines", "readinto", "__iter__", "__next__"):
        err.__dict__.pop(name, None)
    return body


def _install_urllib() -> None:
    import urllib.error
    import urllib.request

    original = urllib.request.OpenerDirector.open

    @functools.wraps(original)
    def open_(self: Any, fullurl: Any, data: Any = None, *args: Any, **kwargs: Any) -> Any:
        started = time.monotonic()
        url = fullurl if isinstance(fullurl, str) else getattr(fullurl, "full_url", "")
        method = "POST" if data is not None else "GET"
        sent = data
        if not isinstance(fullurl, str):
            method = fullurl.get_method()
            sent = data if data is not None else getattr(fullurl, "data", None)
        try:
            response = original(self, fullurl, data, *args, **kwargs)
        except urllib.error.HTTPError as err:
            answered = None
            try:
                if vendor_for_host(urlsplit(url).hostname):
                    answered = replay_http_error(err)
            except Exception:  # noqa: BLE001
                answered = None
            _record_plain(method, url, started, err.code, None, sent, str(err.reason), answered)
            raise
        except Exception as exc:
            _record_plain(method, url, started, None, type(exc).__name__, sent)
            raise
        status = getattr(response, "status", None) or getattr(response, "code", None)
        # A success body is left unread: the caller is about to read it.
        _record_plain(method, url, started, status, None, read_answer=False)
        return response

    urllib.request.OpenerDirector.open = open_


__all__ = ["install", "vendor_for_host", "replay_http_error"]
