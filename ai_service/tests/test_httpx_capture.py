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
    log_module.key_hint = lambda key: None if not key else key[-4:] if len(key) >= 12 else "****"
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


KEYED = {"Authorization": "Bearer sk-or-v1-secret-value-ab12"}


def _sequence(*statuses):
    remaining = list(statuses)
    return httpx.MockTransport(lambda request: httpx.Response(remaining.pop(0)))


def test_a_failure_with_a_key_is_kept_with_capture_off_and_shows_only_the_hint(capture):
    _, calls = capture
    with httpx.Client(transport=_transport(402), headers=KEYED) as client:
        client.post("https://openrouter.ai/api/v1/chat")

    assert calls[0]["automatic"] is False
    assert calls[0]["hint"] == "ab12"
    assert "secret" not in repr(calls[0])


def test_only_the_first_success_after_a_failure_is_kept(capture):
    _, calls = capture
    with httpx.Client(transport=_sequence(200, 500, 200, 200), headers=KEYED) as client:
        for _ in range(4):
            client.get("https://openrouter.ai/api/v1/chat")

    assert [(c["status"], c["automatic"]) for c in calls] == [
        ("SUCCESS", True),
        ("FAILED", False),
        ("SUCCESS", False),
        ("SUCCESS", True),
    ]


def test_a_failed_call_with_no_key_is_not_an_api_problem(capture):
    """An integrated vendor called without a key (a public endpoint) is recorded, but not as a key's run."""
    _, calls = capture
    with httpx.Client(transport=_transport(403)) as client:
        client.get("https://api.sarvam.ai/v1/text")

    assert calls[0]["automatic"] is True
    assert calls[0]["hint"] is None


@pytest.mark.parametrize(
    "header",
    ["x-api-key", "api-key", "x-goog-api-key", "xi-api-key"],
)
def test_other_key_headers_are_recognised(capture, header):
    _, calls = capture
    with httpx.Client(transport=_transport(500), headers={header: "vendor-secret-value-cd34"}) as client:
        client.get("https://api.sarvam.ai/v1/x")

    assert calls[0]["hint"] == "cd34"


def test_a_key_in_the_query_string_is_recognised(capture):
    _, calls = capture
    with httpx.Client(transport=_transport(500)) as client:
        client.get("https://api.sarvam.ai/v1/x?key=vendor-secret-value-ef56")

    assert calls[0]["hint"] == "ef56"


def test_install_wraps_only_once(capture):
    module, calls = capture
    module.install()
    with httpx.Client(transport=_transport()) as client:
        client.get("https://api.sarvam.ai/v1/x")

    assert len(calls) == 1


def test_a_call_to_a_free_model_is_marked(capture):
    _, calls = capture
    with httpx.Client(transport=_transport(200)) as client:
        client.post("https://openrouter.ai/api/v1/chat/completions",
                    json={"model": "xiaomi/mimo-v2-flash:free", "messages": []})
        client.post("https://openrouter.ai/api/v1/chat/completions",
                    json={"model": "google/gemini-2.5-flash", "messages": []})

    assert calls[0]["operation"] == "POST /api/v1 (free model)"
    assert calls[1]["operation"] == "POST /api/v1"


def test_the_free_mark_matches_what_the_alerts_look_for(capture):
    module, _ = capture
    alerts_src = (Path(__file__).resolve().parent.parent / "app" / "services" / "external_api_alerts.py").read_text(encoding="utf-8")

    assert f'FREE_MODEL_MARK = "{module.FREE_MODEL_MARK}"' in alerts_src
