"""Outbound httpx calls to integrated vendors become external_api_call_log rows. Any other
site (an institute's website fetched for lead research) is not recorded. Failures keep what we
sent and what the vendor answered, with secrets and personal fields hidden.

Offline: httpx.MockTransport answers every request. The module loads from its file so
these tests do not need the service's other dependencies.

Run from the repo root:
    <venv>/bin/python -m pytest ai_service/tests/test_httpx_capture.py -q
"""
from __future__ import annotations

import asyncio
import importlib.util
import sys
import types
from pathlib import Path

import httpx
import pytest

SERVICES_DIR = Path(__file__).resolve().parent.parent / "app" / "services"


@pytest.fixture()
def capture(monkeypatch):
    calls = []
    package = types.ModuleType("capture_pkg")
    package.__path__ = [str(SERVICES_DIR)]
    log_module = types.ModuleType("capture_pkg.external_api_log")
    log_module.record_external_call = lambda **kwargs: calls.append(kwargs) or True
    monkeypatch.setitem(sys.modules, "capture_pkg", package)
    monkeypatch.setitem(sys.modules, "capture_pkg.external_api_log", log_module)
    # Restored after each test, so wrapping here never leaks into other tests.
    monkeypatch.setattr(httpx.Client, "send", httpx.Client.send)
    monkeypatch.setattr(httpx.AsyncClient, "send", httpx.AsyncClient.send)
    import requests as _requests
    import urllib.request as _urlreq
    monkeypatch.setattr(_requests.Session, "send", _requests.Session.send)
    monkeypatch.setattr(_urlreq.OpenerDirector, "open", _urlreq.OpenerDirector.open)

    spec = importlib.util.spec_from_file_location("capture_pkg.httpx_capture", SERVICES_DIR / "httpx_capture.py")
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, "capture_pkg.httpx_capture", module)
    spec.loader.exec_module(module)
    module.install()
    return module, calls


def _transport(status=200):
    return httpx.MockTransport(lambda request: httpx.Response(status, json={"ok": True}))


@pytest.mark.parametrize(
    "host, expected",
    [
        ("OpenRouter.AI.", "openrouter.ai"),
        ("api.sarvam.ai", "api.sarvam.ai"),
        ("queue.fal.run", "queue.fal.run"),
        ("api.newvendor.ai", None),          # not an integration
        ("sayajihotels.com", None),          # an institute's website, fetched for lead research
        ("www.linkedin.com", None),
        ("admin-core-service", None),
        ("localhost", None),
        ("10.0.0.5", None),
        ("db.default.svc", None),
        ("backend-stage.vacademy.io", None),
        ("", None),
        (None, None),
    ],
)
def test_vendor_for_host(capture, host, expected):
    module, _ = capture
    assert module.vendor_for_host(host) == expected


def test_a_successful_call_is_recorded_without_bodies(capture):
    _, calls = capture
    with httpx.Client(transport=_transport()) as client:
        response = client.post("https://api.sarvam.ai/v2/generate/job/123?key=SECRET", json={"prompt": "learner text"})

    assert response.status_code == 200
    assert len(calls) == 1
    call = calls[0]
    assert call["vendor"] == "api.sarvam.ai"
    assert call["operation"] == "POST /v2/generate"
    assert call["status"] == "SUCCESS"
    assert call["automatic"] is True
    assert call["request_summary"] is None and call["response_summary"] is None
    assert "SECRET" not in repr(call) and "learner text" not in repr(call)


def test_a_site_that_is_not_an_integration_is_not_recorded(capture):
    _, calls = capture
    with httpx.Client(transport=_transport(403)) as client:
        client.get("https://sayajihotels.com/robots.txt")
    assert calls == []


def test_a_failure_keeps_what_we_sent_and_what_the_vendor_said(capture):
    _, calls = capture

    def answer(request):
        return httpx.Response(402, json={"error": {"code": "insufficient_quota_error",
                                                   "message": "Credits exhausted"}, "api_key": "sk_live_x"})

    with httpx.Client(transport=httpx.MockTransport(answer)) as client:
        response = client.post("https://api.sarvam.ai/text-to-speech?api-key=SECRET",
                               json={"text": "Namaste", "speaker": "priya", "phone": "+919999999999",
                                     "api-subscription-key": "sk_live_y"})

    assert response.status_code == 402 and response.json()["error"]["code"] == "insufficient_quota_error"
    call = calls[0]
    assert call["status"] == "FAILED"
    sent, got = call["request_summary"], call["response_summary"]
    assert sent["method"] == "POST" and sent["path"] == "/text-to-speech"
    assert sent["query_params"] == ["api-key"]
    assert sent["body"]["text"] == "Namaste" and sent["body"]["phone"] == "<hidden>"
    assert got["status"] == 402 and got["body"]["error"]["code"] == "insufficient_quota_error"
    for secret in ("SECRET", "sk_live_x", "sk_live_y", "+919999999999"):
        assert secret not in repr(call)


def test_vendor_error_status_is_a_failed_row_and_response_is_untouched(capture):
    _, calls = capture
    with httpx.Client(transport=_transport(429)) as client:
        response = client.get("https://api.sarvam.ai/v1/x")

    assert response.status_code == 429
    assert (calls[0]["status"], calls[0]["http_status"]) == ("FAILED", 429)


def test_internal_service_calls_are_not_recorded(capture):
    _, calls = capture
    with httpx.Client(transport=_transport()) as client:
        client.get("http://admin-core-service:8072/internal/thing")

    assert calls == []


def test_async_client_is_captured_too(capture):
    _, calls = capture

    async def run():
        async with httpx.AsyncClient(transport=_transport()) as client:
            return await client.get("https://api.sarvam.ai/v1/x")

    assert asyncio.run(run()).status_code == 200
    assert calls[0]["vendor"] == "api.sarvam.ai"


def test_transport_error_is_recorded_and_still_raised(capture):
    _, calls = capture

    def boom(request):
        raise httpx.ConnectError("connection refused to secret-host")

    with httpx.Client(transport=httpx.MockTransport(boom)) as client:
        with pytest.raises(httpx.ConnectError):
            client.get("https://api.sarvam.ai/v1/x")

    assert calls[0]["status"] == "FAILED"
    assert calls[0]["error_message"] == "ConnectError"


def test_a_broken_log_never_breaks_the_request(capture, monkeypatch):
    module, _ = capture

    def boom(**_):
        raise RuntimeError("no database")

    monkeypatch.setattr(module, "record_external_call", boom)
    with httpx.Client(transport=_transport()) as client:
        assert client.get("https://api.sarvam.ai/v1/x").status_code == 200


def test_install_wraps_only_once(capture):
    module, calls = capture
    module.install()
    with httpx.Client(transport=_transport()) as client:
        client.get("https://api.sarvam.ai/v1/x")

    assert len(calls) == 1


# --- requests and urllib (the video pipeline, avatars, music) ---------------------------------

import io  # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402

import requests  # noqa: E402
from requests.adapters import BaseAdapter  # noqa: E402


class _Adapter(BaseAdapter):
    def __init__(self, status, body=b'{"error":{"code":"insufficient_quota_error","message":"out of credits"}}'):
        super().__init__()
        self.status, self.body = status, body

    def send(self, request, **kwargs):
        response = requests.Response()
        response.status_code = self.status
        response.reason = "Payment Required" if self.status == 402 else "OK"
        response._content = self.body
        response.url = request.url
        response.request = request
        return response

    def close(self):
        pass


def test_requests_failure_is_recorded_with_both_bodies(capture):
    _, calls = capture
    session = requests.Session()
    session.mount("https://", _Adapter(402))
    response = session.post("https://api.runpod.ai/v2/abc/run?api_key=SECRET",
                            json={"input": {"text": "hi"}, "api_key": "sk-123"})

    assert response.status_code == 402
    assert b"insufficient_quota_error" in response.content  # caller still gets the body
    assert len(calls) == 1
    call = calls[0]
    assert call["status"] == "FAILED" and call["http_status"] == 402
    assert call["automatic"] is False  # kept even while auto-capture is off
    assert call["operation"] == "POST /v2/abc"
    assert call["request_summary"]["query_params"] == ["api_key"]
    assert call["request_summary"]["body"]["api_key"] == "<hidden>"
    assert call["response_summary"]["body"]["error"]["code"] == "insufficient_quota_error"
    assert "SECRET" not in repr(call) and "sk-123" not in repr(call)


def test_requests_to_a_website_is_not_recorded(capture):
    _, calls = capture
    session = requests.Session()
    session.mount("https://", _Adapter(500))
    session.get("https://sayajihotels.com/about")
    assert calls == []


class _Handler(urllib.request.BaseHandler):
    handler_order = 100  # ahead of the real HTTPS handler

    def __init__(self, status, body):
        self.status, self.body = status, body

    def https_open(self, req):
        if self.status >= 400:
            raise urllib.error.HTTPError(req.full_url, self.status, "Too Many Requests", {}, io.BytesIO(self.body))
        import email.message
        response = urllib.response.addinfourl(io.BytesIO(self.body), email.message.Message(), req.full_url, self.status)
        response.msg = "OK"
        return response


def test_urllib_failure_is_recorded_and_the_caller_can_still_read_the_error(capture):
    _, calls = capture
    opener = urllib.request.build_opener(_Handler(429, b'{"message":"rate limited"}'))
    request = urllib.request.Request("https://google.serper.dev/search", data=b'{"q":"physics"}', method="POST")
    with pytest.raises(urllib.error.HTTPError) as caught:
        opener.open(request)

    assert caught.value.read() == b'{"message":"rate limited"}'
    call = calls[0]
    assert call["vendor"] == "google.serper.dev" and call["http_status"] == 429
    assert call["status"] == "FAILED" and call["automatic"] is False
    assert call["request_summary"]["body"] == {"q": "physics"}
    assert call["response_summary"]["body"] == {"message": "rate limited"}


def test_urllib_success_is_left_unread(capture):
    _, calls = capture
    opener = urllib.request.build_opener(_Handler(200, b"payload"))
    with opener.open("https://api.pexels.com/v1/search?query=cat") as response:
        assert response.read() == b"payload"
    assert calls[0]["status"] == "SUCCESS" and calls[0]["automatic"] is True
    assert calls[0]["response_summary"] is None


def test_urllib_connection_error_is_recorded(capture):
    _, calls = capture

    class _Down(urllib.request.BaseHandler):
        handler_order = 100

        def https_open(self, req):
            raise urllib.error.URLError("timed out")

    with pytest.raises(urllib.error.URLError):
        urllib.request.build_opener(_Down()).open("https://openrouter.ai/api/v1/chat/completions", data=b"{}")
    assert calls[0]["status"] == "FAILED" and calls[0]["error_message"] == "URLError"
