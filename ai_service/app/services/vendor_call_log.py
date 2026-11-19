"""Record a failed call to an integrated third-party API made WITHOUT httpx.

httpx calls are recorded by httpx_capture. Code that calls a vendor with `requests` or
`urllib` (the video pipeline's OpenRouter, Serper, Pexels and Pixabay calls, RunPod and fal
avatars, Vertex music) calls `record_vendor_failure` from its own error handling, after the
failure, and then carries on exactly as before:

    try:
        resp = requests.post(url, json=payload, timeout=30)
    except requests.RequestException as exc:
        record_vendor_failure(url, "submit avatar job", request=payload, error=exc)
        raise
    if resp.status_code >= 400:
        record_vendor_failure(url, "submit avatar job", request=payload,
                              status=resp.status_code, response=resp.text)

It never raises, never blocks and never reads anything the caller has not already read.
Only integrated vendors are recorded; bodies are redacted (keys, tokens, phones, emails) and
cut, and a body over 64 KB is not kept, only its size.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

from .external_api_log import record_external_call
from .httpx_capture import MAX_OPERATION_LENGTH, vendor_for_host
from .integrated_vendors import body_summary

logger = logging.getLogger(__name__)

MAX_BODY_BYTES = 64 * 1024
_URL_QUERY = re.compile(r"(https?://[^\s?'\"<>]+)\?[^\s'\"<>]*")
_SECRETISH = re.compile(r"(?i)(key|token|secret|authorization|bearer|password)[\s:=\"']+(?:bearer\s+)?[^\s,;\"'&]+")


def _error_text(error: BaseException) -> str:
    """The exception as text without query strings (some vendors take the key there) or
    anything that looks like a credential."""
    text = _URL_QUERY.sub(r"\1?<query>", f"{type(error).__name__}: {error}")
    return _SECRETISH.sub(lambda m: m.group(1) + "=<hidden>", text)[:500]


def _host(url_or_host: Optional[str]) -> Optional[str]:
    text = (url_or_host or "").strip()
    if "://" in text:
        try:
            return urlsplit(text).hostname
        except ValueError:
            return None
    return text or None


def _without_queries(value: Any) -> Any:
    """URLs inside the kept body lose their query: it can hold a key or a presigned signature."""
    if isinstance(value, str):
        return _URL_QUERY.sub(r"\1?<query>", value)
    if isinstance(value, dict):
        return {k: _without_queries(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_without_queries(v) for v in value]
    return value


def _summary(body: Any) -> Optional[Dict[str, Any]]:
    if isinstance(body, (bytes, bytearray, str)) and len(body) > MAX_BODY_BYTES:
        return {"omitted": f"{len(body)} bytes"}
    try:
        return _without_queries(body_summary(body))
    except Exception:  # noqa: BLE001
        return None


def _status_of(error: Optional[BaseException]) -> Optional[int]:
    """The status an HTTP error carries: urllib's HTTPError.code, requests' response."""
    code = getattr(error, "code", None)
    if isinstance(code, int) and code >= 100:
        return code
    response = getattr(error, "response", None)
    status = getattr(response, "status_code", None)
    return status if isinstance(status, int) else None


def record_vendor_failure(
    url_or_host: Optional[str],
    operation: str,
    *,
    request: Any = None,
    status: Optional[int] = None,
    response: Any = None,
    error: Optional[BaseException] = None,
) -> None:
    """Record one failed vendor call: an exception (`error`), or an error status with the
    body the caller already read (`status`, `response`). A status below 400 is not a failure.
    """
    try:
        if status is None:
            status = _status_of(error)
        if error is None and (status is None or status < 400):
            return
        vendor = vendor_for_host(_host(url_or_host))
        if vendor is None:
            return
        request_summary = None
        body = _summary(request)
        if body is not None:
            request_summary = {"body": body}
        response_summary: Dict[str, Any] = {"status": status}
        answer = _summary(response)
        if answer is not None:
            response_summary["body"] = answer
        record_external_call(
            vendor=vendor,
            operation=(operation or "call")[:MAX_OPERATION_LENGTH],
            status="FAILED",
            http_status=status,
            error_message=None if error is None else _error_text(error),
            request_summary=request_summary,
            response_summary=response_summary,
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("vendor-call-log: skipped: %s", exc)


__all__ = ["record_vendor_failure"]
