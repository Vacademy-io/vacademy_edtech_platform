"""POST /copy-check/inspect (spec 7.5, T1.14): page count and encryption of an
uploaded answer sheet, with the 60 MB / 200-page / parse-time caps. PyMuPDF is
replaced by a small double so the cases (encrypted, broken, huge) are exact;
the download goes through httpx.MockTransport.
"""
import asyncio
import sys
import time
import types

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.dependencies import require_internal_service_token
from app.routers import copy_check as router_module
from app.services.copy_check import upload_inspect as ui

PDF = b"%PDF-1.7\n" + b"x" * 100


class _Doc:
    def __init__(self, pages=3, needs_pass=False, password_ok=False, encryption=None, broken_count=False, sleep=0):
        self._pages, self.needs_pass, self._password_ok = pages, needs_pass, password_ok
        self.is_encrypted = needs_pass or bool(encryption)
        self.metadata = {"encryption": encryption}
        self._broken, self._sleep, self.closed = broken_count, sleep, False

    def authenticate(self, password):
        if self._password_ok:
            self.needs_pass = False
            return 1
        return 0

    @property
    def page_count(self):
        if self._sleep:
            time.sleep(self._sleep)
        if self._broken:
            raise RuntimeError("xref broken")
        return self._pages

    def close(self):
        self.closed = True


@pytest.fixture
def fake_fitz(monkeypatch):
    state = {"doc": _Doc(), "open_error": None}

    def _open(stream=None, filetype=None):
        assert filetype == "pdf" and stream is not None
        if state["open_error"]:
            raise state["open_error"]
        return state["doc"]

    monkeypatch.setitem(sys.modules, "fitz", types.SimpleNamespace(open=_open))
    return state


def test_counts_pages(fake_fitz):
    fake_fitz["doc"] = _Doc(pages=12)
    assert ui.inspect_pdf_bytes(PDF) == {"pages": 12, "encrypted": False, "error": None}
    assert fake_fitz["doc"].closed


def test_not_a_pdf_is_unparseable_without_opening_it(fake_fitz):
    fake_fitz["open_error"] = AssertionError("must not be opened")
    assert ui.inspect_pdf_bytes(b"PK\x03\x04 a zip file")["error"] == "unparseable"
    assert ui.inspect_pdf_bytes(b"")["error"] == "unparseable"


def test_open_failure_and_broken_xref_are_unparseable(fake_fitz):
    fake_fitz["open_error"] = RuntimeError("cannot open broken document")
    assert ui.inspect_pdf_bytes(PDF) == {"pages": None, "encrypted": False, "error": "unparseable"}
    fake_fitz["open_error"] = None
    fake_fitz["doc"] = _Doc(broken_count=True)
    assert ui.inspect_pdf_bytes(PDF)["error"] == "unparseable"


def test_zero_pages_is_unparseable(fake_fitz):
    fake_fitz["doc"] = _Doc(pages=0)
    assert ui.inspect_pdf_bytes(PDF)["error"] == "unparseable"


def test_more_than_200_pages(fake_fitz):
    fake_fitz["doc"] = _Doc(pages=201)
    assert ui.inspect_pdf_bytes(PDF) == {"pages": 201, "encrypted": False, "error": "too_many_pages"}
    fake_fitz["doc"] = _Doc(pages=200)
    assert ui.inspect_pdf_bytes(PDF)["error"] is None


def test_user_password_pdf_is_encrypted_and_unparseable(fake_fitz):
    fake_fitz["doc"] = _Doc(needs_pass=True, password_ok=False)
    assert ui.inspect_pdf_bytes(PDF) == {"pages": None, "encrypted": True, "error": "unparseable"}


def test_owner_password_only_pdf_is_encrypted_but_usable(fake_fitz):
    fake_fitz["doc"] = _Doc(pages=4, needs_pass=True, password_ok=True)
    assert ui.inspect_pdf_bytes(PDF) == {"pages": 4, "encrypted": True, "error": None}
    fake_fitz["doc"] = _Doc(pages=4, encryption="Standard V2 R3 128-bit RC4")
    assert ui.inspect_pdf_bytes(PDF) == {"pages": 4, "encrypted": True, "error": None}


def _transport(body=PDF, status=200, headers=None):
    def handler(request):
        return httpx.Response(status, content=body, headers=headers or {})
    return httpx.MockTransport(handler)


def test_url_fetch_and_inspect(fake_fitz):
    fake_fitz["doc"] = _Doc(pages=7)
    out = asyncio.run(ui.inspect_pdf_url("https://bucket/eval-api/x.pdf?sig=1", transport=_transport()))
    assert out == {"pages": 7, "encrypted": False, "error": None}


def test_fetch_errors_are_fetch_failed(fake_fitz):
    assert asyncio.run(ui.inspect_pdf_url("https://b/x.pdf", transport=_transport(status=403)))["error"] == "fetch_failed"
    assert asyncio.run(ui.inspect_pdf_url("file:///etc/passwd"))["error"] == "fetch_failed"
    assert asyncio.run(ui.inspect_pdf_url("ftp://b/x.pdf"))["error"] == "fetch_failed"


def test_size_cap_on_declared_and_streamed_length(fake_fitz):
    big = asyncio.run(ui.inspect_pdf_url("https://b/x.pdf", max_bytes=50, transport=_transport()))
    assert big["error"] == "fetch_failed"
    declared = asyncio.run(ui.inspect_pdf_url(
        "https://b/x.pdf", max_bytes=10_000, transport=_transport(headers={"content-length": "999999"})))
    assert declared["error"] == "fetch_failed"


def test_parse_time_cap(fake_fitz):
    fake_fitz["doc"] = _Doc(pages=3, sleep=0.5)
    out = asyncio.run(ui.inspect_pdf_url("https://b/x.pdf", parse_timeout=0.05, transport=_transport()))
    assert out == {"pages": None, "encrypted": False, "error": "unparseable"}


def test_an_overrun_parse_keeps_its_slot_until_the_thread_ends(fake_fitz, monkeypatch):
    gate = ui._Slots(1)
    monkeypatch.setattr(ui, "slots", gate)
    fake_fitz["doc"] = _Doc(pages=3, sleep=0.4)
    out = asyncio.run(ui.inspect_pdf_url("https://b/x.pdf", parse_timeout=0.05, transport=_transport()))
    assert out["error"] == "unparseable"
    # The parse thread is still running: the slot is not free yet, so a second
    # caller is told to come back instead of starting another unbounded thread.
    assert gate.in_use == 1
    with pytest.raises(ui.InspectBusy):
        asyncio.run(ui.inspect_pdf_url("https://b/y.pdf", slot_wait=0.05, transport=_transport()))
    deadline = time.monotonic() + 3
    while gate.in_use and time.monotonic() < deadline:
        time.sleep(0.02)
    assert gate.in_use == 0
    fake_fitz["doc"] = _Doc(pages=2)
    assert asyncio.run(ui.inspect_pdf_url("https://b/y.pdf", transport=_transport()))["pages"] == 2
    assert gate.in_use == 0


def test_slots_are_released_after_normal_and_failed_inspects(fake_fitz, monkeypatch):
    gate = ui._Slots(1)
    monkeypatch.setattr(ui, "slots", gate)
    asyncio.run(ui.inspect_pdf_url("https://b/x.pdf", transport=_transport()))
    asyncio.run(ui.inspect_pdf_url("https://b/x.pdf", transport=_transport(status=500)))
    asyncio.run(ui.inspect_pdf_url("https://b/x.pdf", max_bytes=5, transport=_transport()))
    assert gate.in_use == 0


def test_fetch_returns_one_buffer_of_the_whole_body():
    body = PDF * 50
    data = asyncio.run(ui._fetch("https://b/x.pdf", 10_000_000, 5, _transport(body=body)))
    assert isinstance(data, bytearray) and bytes(data) == body


def test_inspect_route_answers_429_when_busy(monkeypatch):
    async def busy(url):
        raise ui.InspectBusy()

    monkeypatch.setattr(ui, "inspect_pdf_url", busy)
    app = FastAPI()
    app.include_router(router_module.router)
    app.dependency_overrides[require_internal_service_token] = lambda: None
    resp = TestClient(app).post("/copy-check/inspect", json={"pdf_url": "https://b/x.pdf"})
    assert resp.status_code == 429 and resp.headers.get("Retry-After")


def test_inspect_route(monkeypatch):
    async def fake_inspect(url):
        assert url == "https://b/x.pdf"
        return {"pages": 9, "encrypted": False, "error": None}

    monkeypatch.setattr(ui, "inspect_pdf_url", fake_inspect)
    app = FastAPI()
    app.include_router(router_module.router)
    app.dependency_overrides[require_internal_service_token] = lambda: None
    client = TestClient(app)
    resp = client.post("/copy-check/inspect", json={"pdf_url": "https://b/x.pdf"})
    assert resp.status_code == 200
    assert resp.json() == {"pages": 9, "encrypted": False, "error": None}
    assert client.post("/copy-check/inspect", json={}).status_code == 422


def test_inspect_route_requires_the_internal_token():
    route = next(r for r in router_module.router.routes if getattr(r, "path", "") == "/copy-check/inspect")
    deps = [d.dependency for d in route.dependencies]
    assert require_internal_service_token in deps
