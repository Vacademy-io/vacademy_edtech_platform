"""POST /copy-check/scan/build through the router: flag, token, body caps, busy.

The real token dependency runs (with a stubbed server secret); the build service
is stubbed.
"""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import dependencies  # noqa: E402
from app.routers import copy_check_scan_build as router_module  # noqa: E402
from app.services.copy_check.scan_build import service  # noqa: E402

PATH = router_module.router.prefix + "/build"
TOKEN = {"X-Internal-Service-Token": "svc"}


def _page(i=0):
    return {"url": f"https://m/p{i}.jpg?sig=x", "kind": "IMAGE", "page_index": 0, "rotation": 180, "dpi": 300}


def _body(copies=1, pages_each=1):
    return {
        "institute_id": "inst-1",
        "session_id": "sess-1",
        "source_id": "ASSESSMENT_SCAN_STATION",
        "copies": [{"copy_key": f"L1-S{c}", "file_name": f"scan_l1_c{c}.pdf",
                    "pages": [_page(p) for p in range(pages_each)]} for c in range(copies)],
    }


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(dependencies, "get_settings", lambda: SimpleNamespace(internal_service_token="svc"))
    monkeypatch.setenv("COPY_CHECK_SCAN_STATION", "true")
    seen = {}

    async def fake_build(copies, *, institute_id, source_id, session_id=None, transport=None):
        seen.update(copies=copies, institute_id=institute_id, source_id=source_id, session_id=session_id)
        return [{"copy_key": c["copy_key"], "file_id": "f-" + c["copy_key"], "page_count": len(c["pages"]),
                 "bytes": 1234, "error": None} for c in copies]

    monkeypatch.setattr(service, "build_copies", fake_build)
    app = FastAPI()
    app.include_router(router_module.router)
    with TestClient(app) as c:
        c.seen = seen
        yield c


def test_builds_and_answers_the_contract_shape(client):
    resp = client.post(PATH, json=_body(copies=2, pages_each=3), headers=TOKEN)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"copies": [
        {"copy_key": "L1-S0", "file_id": "f-L1-S0", "page_count": 3, "bytes": 1234, "error": None},
        {"copy_key": "L1-S1", "file_id": "f-L1-S1", "page_count": 3, "bytes": 1234, "error": None},
    ]}
    assert client.seen["institute_id"] == "inst-1"
    assert client.seen["source_id"] == "ASSESSMENT_SCAN_STATION"
    assert client.seen["copies"][0]["pages"][0]["rotation"] == 180


def test_404_when_the_flag_is_off_even_with_the_token(client, monkeypatch):
    monkeypatch.delenv("COPY_CHECK_SCAN_STATION", raising=False)
    assert client.post(PATH, json=_body(), headers=TOKEN).status_code == 404
    monkeypatch.setenv("COPY_CHECK_SCAN_STATION", "0")
    assert client.post(PATH, json=_body()).status_code == 404


def test_401_without_or_with_a_wrong_token(client):
    assert client.post(PATH, json=_body()).status_code == 401
    assert client.post(PATH, json=_body(), headers={"X-Internal-Service-Token": "nope"}).status_code == 401


def test_422_on_more_than_10_copies_or_300_pages(client):
    assert client.post(PATH, json=_body(copies=11), headers=TOKEN).status_code == 422
    assert client.post(PATH, json=_body(copies=10, pages_each=31), headers=TOKEN).status_code == 422
    assert client.post(PATH, json=_body(copies=10, pages_each=30), headers=TOKEN).status_code == 200


def test_422_on_a_bad_body(client):
    bad_rotation = _body()
    bad_rotation["copies"][0]["pages"][0]["rotation"] = 45
    assert client.post(PATH, json=bad_rotation, headers=TOKEN).status_code == 422
    bad_url = _body()
    bad_url["copies"][0]["pages"][0]["url"] = "file:///etc/passwd"
    assert client.post(PATH, json=bad_url, headers=TOKEN).status_code == 422
    dup = _body(copies=2)
    dup["copies"][1]["copy_key"] = "L1-S0"
    assert client.post(PATH, json=dup, headers=TOKEN).status_code == 422


def test_429_with_retry_after_when_busy(client, monkeypatch):
    async def busy(*a, **kw):
        raise service.ScanBuildBusy()

    monkeypatch.setattr(service, "build_copies", busy)
    resp = client.post(PATH, json=_body(), headers=TOKEN)
    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "10"


def test_429_from_the_real_admit(client, monkeypatch):
    # The real service, with its single build slot already taken by another call.
    monkeypatch.undo()
    monkeypatch.setattr(dependencies, "get_settings", lambda: SimpleNamespace(internal_service_token="svc"))
    monkeypatch.setenv("COPY_CHECK_SCAN_STATION", "1")
    monkeypatch.setattr(service, "ADMIT_WAIT_SECONDS", 0.2)
    taken = 0
    while service._admit.try_take():
        taken += 1
    try:
        resp = client.post(PATH, json=_body(), headers=TOKEN)
    finally:
        for _ in range(taken):
            service._admit.give_back()
    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "10"
