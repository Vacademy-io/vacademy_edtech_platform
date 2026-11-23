"""Scan Station built-copy upload: internal get-signed-url (institute-owned), then PUT.

httpx MockTransport only; internal_auth_headers is stubbed (it would read the DB).
"""
from __future__ import annotations

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

httpx = pytest.importorskip("httpx")

from app.services.copy_check.scan_build import media_upload  # noqa: E402

PUT_URL = "https://bucket.s3.amazonaws.com/inst-1/scan.pdf?X-Amz-Signature=abc"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    async def fake_headers(extra=None):
        return {"clientName": "admin_core_service", "Signature": "sig"}

    monkeypatch.setattr(media_upload, "internal_auth_headers", fake_headers)
    monkeypatch.setattr(media_upload, "RETRY_PAUSE_SECONDS", 0)
    monkeypatch.setenv("MEDIA_SERVER_BASE_URL", "http://media:8075/")


def _upload(transport, name="Scan L3 C5.PDF"):
    return asyncio.run(media_upload.upload_pdf(
        b"%PDF-1.7 bytes", name, institute_id="inst-1",
        source_id="ASSESSMENT_SCAN_STATION", transport=transport))


def test_signed_url_call_is_institute_owned_and_put_follows():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.method == "POST":
            return httpx.Response(200, json={"id": "file-9", "url": PUT_URL})
        return httpx.Response(200)

    assert _upload(httpx.MockTransport(handler)) == "file-9"
    post, put = seen
    assert post.url.path == "/media-service/internal/get-signed-url"
    assert str(post.url).startswith("http://media:8075/media-service/")
    q = post.url.params
    assert q["source"] == "inst-1"
    assert q["sourceId"] == "ASSESSMENT_SCAN_STATION"
    assert q["fileType"] == "application/pdf"
    assert q["fileName"] == "scan_l3_c5.pdf"
    assert post.headers["clientName"] == "admin_core_service" and post.headers["Signature"] == "sig"
    assert "x-internal-service-token" not in post.headers
    assert put.method == "PUT" and str(put.url) == PUT_URL
    assert put.headers["content-type"] == "application/pdf"
    assert put.content == b"%PDF-1.7 bytes"
    assert "signature" not in put.headers  # the internal credentials never go to S3


def test_put_403_raises():
    def handler(request):
        if request.method == "POST":
            return httpx.Response(200, json={"id": "file-9", "url": PUT_URL})
        return httpx.Response(403)

    with pytest.raises(media_upload.MediaUploadError):
        _upload(httpx.MockTransport(handler))


def test_signed_url_refusal_raises():
    with pytest.raises(media_upload.MediaUploadError):
        _upload(httpx.MockTransport(lambda r: httpx.Response(401)))
    with pytest.raises(media_upload.MediaUploadError):
        _upload(httpx.MockTransport(lambda r: httpx.Response(200, json={"id": "x"})))


def test_one_retry_on_a_transport_error():
    attempts = {"POST": 0, "PUT": 0}

    def handler(request):
        attempts[request.method] += 1
        if attempts[request.method] == 1:
            raise httpx.ConnectError("reset")
        if request.method == "POST":
            return httpx.Response(200, json={"id": "file-9", "url": PUT_URL})
        return httpx.Response(204)

    assert _upload(httpx.MockTransport(handler)) == "file-9"
    assert attempts == {"POST": 2, "PUT": 2}


def test_two_transport_errors_raise():
    def handler(request):
        raise httpx.ConnectError("down")

    with pytest.raises(httpx.TransportError):
        _upload(httpx.MockTransport(handler))


def test_safe_file_name():
    assert media_upload.safe_file_name("Load 3 copy 5") == "load_3_copy_5.pdf"
    assert media_upload.safe_file_name("scan_l3_c5.pdf") == "scan_l3_c5.pdf"
    assert media_upload.safe_file_name("  ") == "scan_copy.pdf"
