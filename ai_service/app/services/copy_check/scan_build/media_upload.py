"""Upload a built copy PDF to media-service as a file the institute owns.

Two steps:
  1. POST {media}/media-service/internal/get-signed-url?fileName&fileType&source&sourceId
     with the clientName/Signature internal headers (NOT the internal service
     token). media-service saves file_metadata with source=institute_id at this
     point, which is what assessment_service's InstituteFileOwnership checks, and
     answers {id, url}.
  2. PUT the bytes to that signed url (Content-Type application/pdf).

A non-2xx on either step raises MediaUploadError; a transport error is retried
once. No acknowledge call is needed for ownership.

Never upload-file-v2: it carries no source, lands in the public bucket and caps
uploads at 20 MB.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any, Awaitable, Callable, Optional

import httpx

from ...internal_auth import internal_auth_headers

logger = logging.getLogger(__name__)

SIGNED_URL_PATH = "/media-service/internal/get-signed-url"
TIMEOUT_SECONDS = 120.0
RETRY_PAUSE_SECONDS = 1.0


class MediaUploadError(Exception):
    """media-service refused the upload, or answered something unusable."""


def _media_base_url() -> str:
    return os.getenv("MEDIA_SERVER_BASE_URL", "http://media-service:8075").rstrip("/")


def safe_file_name(name: str) -> str:
    """Lowercase, no spaces, ends in .pdf (media-service builds the S3 key from it)."""
    stem = (name or "").strip().lower()
    if stem.endswith(".pdf"):
        stem = stem[:-4]
    stem = re.sub(r"[^a-z0-9._-]+", "_", stem).strip("._-") or "scan_copy"
    return stem[:120] + ".pdf"


def _bare(url: str) -> str:
    return url.split("?", 1)[0][:120]


async def _once_more_on_transport_error(step: Callable[[], Awaitable[httpx.Response]]) -> httpx.Response:
    try:
        return await step()
    except httpx.TransportError:
        await asyncio.sleep(RETRY_PAUSE_SECONDS)
        return await step()


async def upload_pdf(
    content: bytes,
    file_name: str,
    *,
    institute_id: str,
    source_id: str,
    transport: Optional[httpx.AsyncBaseTransport] = None,
) -> str:
    """Upload and return the media file id."""
    params = {
        "fileName": safe_file_name(file_name),
        "fileType": "application/pdf",
        "source": institute_id,
        "sourceId": source_id,
    }
    headers = await internal_auth_headers()
    kwargs: dict[str, Any] = {"timeout": TIMEOUT_SECONDS}
    if transport is not None:
        kwargs["transport"] = transport
    async with httpx.AsyncClient(**kwargs) as client:
        signed = await _once_more_on_transport_error(
            lambda: client.post(f"{_media_base_url()}{SIGNED_URL_PATH}", params=params, headers=headers))
        if not signed.is_success:
            raise MediaUploadError(f"get-signed-url answered {signed.status_code}")
        try:
            body = signed.json() or {}
        except ValueError as e:
            raise MediaUploadError("get-signed-url answered no JSON") from e
        file_id, put_url = body.get("id"), body.get("url")
        if not file_id or not put_url:
            raise MediaUploadError("get-signed-url answered without id or url")

        put = await _once_more_on_transport_error(
            lambda: client.put(put_url, content=content, headers={"Content-Type": "application/pdf"}))
        if not put.is_success:
            # The signed url carries credentials in its query string; log the path only.
            logger.info("scan-build: PUT %s answered %s", _bare(put_url), put.status_code)
            raise MediaUploadError(f"upload PUT answered {put.status_code}")
    return str(file_id)
