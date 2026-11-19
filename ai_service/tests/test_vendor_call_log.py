"""record_vendor_failure: a failed call made with requests or urllib (not httpx) becomes an
external_api_call_log row, only for integrated vendors, with secrets and personal fields hidden.

Run from the repo root:
    <venv>/bin/python -m pytest ai_service/tests/test_vendor_call_log.py -q
"""
from __future__ import annotations

import importlib.util
import io
import sys
import types
import urllib.error
from pathlib import Path

import pytest

SERVICES_DIR = Path(__file__).resolve().parent.parent / "app" / "services"


@pytest.fixture()
def log(monkeypatch):
    calls = []
    package = types.ModuleType("vcl_pkg")
    package.__path__ = [str(SERVICES_DIR)]
    log_module = types.ModuleType("vcl_pkg.external_api_log")
    log_module.record_external_call = lambda **kwargs: calls.append(kwargs) or True
    monkeypatch.setitem(sys.modules, "vcl_pkg", package)
    monkeypatch.setitem(sys.modules, "vcl_pkg.external_api_log", log_module)
    spec = importlib.util.spec_from_file_location("vcl_pkg.vendor_call_log", SERVICES_DIR / "vendor_call_log.py")
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, "vcl_pkg.vendor_call_log", module)
    spec.loader.exec_module(module)
    return module.record_vendor_failure, calls


def test_an_error_status_keeps_what_we_sent_and_what_the_vendor_said(log):
    record, calls = log
    record("https://api.runpod.ai/v2/abc/run", "submit avatar job",
           request={"input": {"text": "hello"}, "api_key": "rp_secret", "email": "a@b.com"},
           status=402, response='{"error":"insufficient balance"}')
    assert len(calls) == 1
    call = calls[0]
    assert call["vendor"] == "api.runpod.ai"
    assert call["operation"] == "submit avatar job"
    assert (call["status"], call["http_status"]) == ("FAILED", 402)
    assert call["request_summary"]["body"]["input"]["text"] == "hello"
    assert call["response_summary"]["body"]["error"] == "insufficient balance"
    assert "automatic" not in call or call["automatic"] is False
    assert "rp_secret" not in repr(call) and "a@b.com" not in repr(call)


def test_a_urllib_http_error_gives_its_status_and_hides_the_key_in_the_url(log):
    record, calls = log
    err = urllib.error.HTTPError("https://pixabay.com/api/?key=PIXKEY&q=cats", 429, "Too Many Requests",
                                 {}, io.BytesIO(b""))
    record("https://pixabay.com/api/?key=PIXKEY&q=cats", "search photos", error=err)
    call = calls[0]
    assert call["vendor"] == "pixabay.com"
    assert call["http_status"] == 429
    assert "PIXKEY" not in repr(call)


def test_presigned_urls_in_the_body_lose_their_query(log):
    record, calls = log
    record("https://api.runpod.ai/v2/x/run", "submit avatar job",
           request={"input": {"audio_url": "https://b.s3.amazonaws.com/a.mp3?X-Amz-Signature=SIG&X-Amz-Expires=60"}},
           status=500)
    assert calls[0]["request_summary"]["body"]["input"]["audio_url"] == "https://b.s3.amazonaws.com/a.mp3?<query>"
    assert "SIG" not in repr(calls[0])


def test_no_answer_is_recorded_without_a_status(log):
    record, calls = log
    record("google.serper.dev", "search images", error=TimeoutError("timed out"))
    assert calls[0]["http_status"] is None
    assert calls[0]["error_message"].startswith("TimeoutError")


def test_success_other_sites_and_our_services_are_not_recorded(log):
    record, calls = log
    record("https://api.runpod.ai/v2/x", "poll", status=200, response="ok")
    record("https://archive.org/download/x.mp3", "download music", error=OSError("x"))
    record("http://admin-core-service:8072/x", "internal", status=500)
    record(None, "nothing", status=500)
    assert calls == []


def test_large_bodies_are_not_kept(log):
    record, calls = log
    record("https://openrouter.ai/api/v1/chat/completions", "chat", request="x" * 70_000, status=500)
    assert calls[0]["request_summary"]["body"] == {"omitted": "70000 bytes"}


def test_it_never_raises(log, monkeypatch):
    record, calls = log
    record(object(), "bad input", status=500)  # not a string
    assert calls == []
