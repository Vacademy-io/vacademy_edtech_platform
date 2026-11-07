"""Outbound httpx calls become external_api_call_log rows, metadata only.

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
        ("api.newvendor.ai", "api.newvendor.ai"),
        ("OpenRouter.AI.", "openrouter.ai"),
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


def test_a_new_vendor_is_recorded_without_any_registration(capture):
    _, calls = capture
    with httpx.Client(transport=_transport()) as client:
        response = client.post("https://api.brandnew.ai/v2/generate/job/123?key=SECRET", json={"prompt": "learner text"})

    assert response.status_code == 200
    assert len(calls) == 1
    call = calls[0]
    assert call["vendor"] == "api.brandnew.ai"
    assert call["operation"] == "POST /v2/generate"
    assert call["status"] == "SUCCESS"
    assert call["automatic"] is True
    assert "SECRET" not in repr(call) and "learner text" not in repr(call)


def test_vendor_error_status_is_a_failed_row_and_response_is_untouched(capture):
    _, calls = capture
    with httpx.Client(transport=_transport(429)) as client:
        response = client.get("https://api.brandnew.ai/v1/x")

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
            return await client.get("https://api.brandnew.ai/v1/x")

    assert asyncio.run(run()).status_code == 200
    assert calls[0]["vendor"] == "api.brandnew.ai"


def test_transport_error_is_recorded_and_still_raised(capture):
    _, calls = capture

    def boom(request):
        raise httpx.ConnectError("connection refused to secret-host")

    with httpx.Client(transport=httpx.MockTransport(boom)) as client:
        with pytest.raises(httpx.ConnectError):
            client.get("https://api.brandnew.ai/v1/x")

    assert calls[0]["status"] == "FAILED"
    assert calls[0]["error_message"] == "ConnectError"


def test_a_broken_log_never_breaks_the_request(capture, monkeypatch):
    module, _ = capture

    def boom(**_):
        raise RuntimeError("no database")

    monkeypatch.setattr(module, "record_external_call", boom)
    with httpx.Client(transport=_transport()) as client:
        assert client.get("https://api.brandnew.ai/v1/x").status_code == 200


def test_install_wraps_only_once(capture):
    module, calls = capture
    module.install()
    with httpx.Client(transport=_transport()) as client:
        client.get("https://api.brandnew.ai/v1/x")

    assert len(calls) == 1
