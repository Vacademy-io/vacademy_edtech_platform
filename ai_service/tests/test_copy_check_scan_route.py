"""POST /copy-check/scan/analyse-load through the app (contract C1 status codes).

Everything behind the route is stubbed (no DB, no network, no model); the
router's lazy collaborators still run, so a wrong import path fails here.
"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import cv2
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import dependencies
from app.db import db_dependency
from app.routers import copy_check_scan as route
from app.services.copy_check.scan import analyse, fetch, header_read
from copy_check_scan_synth import front_page, jpeg_bytes, pile

TOKEN = "tok-123"
URL = route.router.prefix + "/analyse-load"


def _body(n=2):
    return {
        "institute_id": "inst", "session_id": "s1", "load_no": 1, "preferred_model": None,
        "passes": [{"pass_no": p, "files": [
            {"file_id": f"f{p}{i}", "url": f"https://media.test/{p}/{i}", "kind": "IMAGE", "name": f"Scan {i}.jpeg"}
            for i in range(n)]} for p in (1, 2)],
    }


class _LLM:
    def __init__(self, fail=False):
        self.fail = fail

    async def chat_completion(self, messages, **_kw):
        if self.fail:
            raise RuntimeError("provider down")
        k = sum(1 for p in messages[1]["content"] if p["type"] == "image_url")
        return {"content": json.dumps([{"i": i, "label_kind": "PRINTED_FIELD" if i % 2 else "NONE",
                                        "name_value": "A", "name_legible": True} for i in range(1, k + 1)]),
                "usage": {}}


class _DB:
    """Stands in for the request's Session; records when the route closes it."""

    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


@pytest.fixture
def db():
    return _DB()


@pytest.fixture
def client(monkeypatch, db):
    monkeypatch.setenv("COPY_CHECK_SCAN_STATION", "true")
    monkeypatch.setattr(dependencies, "get_settings", lambda: SimpleNamespace(internal_service_token=TOKEN))
    monkeypatch.setattr(header_read, "header_model", lambda db, preferred=None: "m-x")
    monkeypatch.setattr(header_read, "RETRY_SLEEP_SECONDS", 0.0)
    fronts, backs = pile(2, labels={0}, written_backs={0}, seed=2)
    blobs = {1: [jpeg_bytes(cv2.resize(b, None, fx=2, fy=2), dpi=200) for b in backs],
             2: [jpeg_bytes(cv2.resize(f, None, fx=2, fy=2), dpi=200) for f in fronts]}

    async def fake_fetch(specs, tmp):
        got = {}
        for idx, spec in enumerate(specs):
            p, i = (int(x) for x in spec.url.rsplit("/", 2)[-2:])
            path = tmp / f"f{idx}.img"
            path.write_bytes(blobs[p][i])
            got[spec.key] = fetch.Fetched(path=str(path), size=len(blobs[p][i]))
        return got, False

    monkeypatch.setattr(fetch, "fetch_all", fake_fetch)
    pool = ThreadPoolExecutor(2)
    monkeypatch.setattr(analyse, "_get_pool", lambda: pool)
    app = FastAPI()
    app.include_router(route.router)
    app.dependency_overrides[db_dependency] = lambda: db
    with TestClient(app) as c:
        yield c
    pool.shutdown()
    analyse.slots.in_use = 0


def _post(client, body=None, token=TOKEN):
    headers = {"X-Internal-Service-Token": token} if token else {}
    return client.post(URL, json=body if body is not None else _body(), headers=headers)


def test_404_when_switched_off(client, monkeypatch):
    monkeypatch.delenv("COPY_CHECK_SCAN_STATION")
    assert _post(client).status_code == 404
    assert _post(client, token=None).status_code == 404       # off wins over a missing token
    monkeypatch.setenv("COPY_CHECK_SCAN_STATION", "yes")       # only '1' / 'true' switch it on
    assert _post(client).status_code == 404


def test_401_without_or_with_a_bad_token(client):
    assert _post(client, token=None).status_code == 401
    assert _post(client, token="wrong").status_code == 401


def test_422_on_a_bad_body(client):
    assert _post(client, body={"institute_id": "x"}).status_code == 422
    one_pass = _body()
    one_pass["passes"] = one_pass["passes"][:1]
    assert _post(client, body=one_pass).status_code == 422
    same = _body()
    same["passes"][1]["pass_no"] = 1
    assert _post(client, body=same).status_code == 422
    heic = _body()
    heic["passes"][0]["files"][0]["kind"] = "HEIC"
    assert _post(client, body=heic).status_code == 422
    big = _body()
    big["passes"][0]["files"] = big["passes"][0]["files"] * 51
    assert _post(client, body=big).status_code == 422


def test_429_when_every_slot_is_taken(client, monkeypatch):
    monkeypatch.setenv("SCAN_MAX_CALLS", "1")
    analyse.slots.in_use = 1
    resp = _post(client)
    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "10"


def test_503_retryable_on_a_model_outage(client, monkeypatch):
    monkeypatch.setattr(header_read, "make_llm", lambda db, institute_id=None: _LLM(fail=True))
    resp = _post(client)
    assert resp.status_code == 503
    assert resp.json()["retryable"] is True
    assert analyse.slots.in_use == 0                            # the slot is released


def test_503_retryable_when_the_budget_runs_out(client, monkeypatch):
    import asyncio

    async def slow(*_a, **_k):
        await asyncio.sleep(5)

    monkeypatch.setattr(header_read, "make_llm", lambda db, institute_id=None: _LLM())
    monkeypatch.setattr(analyse, "analyse_load", slow)
    monkeypatch.setattr(route.scan_config, "CALL_BUDGET_SECONDS", 0.05)
    resp = _post(client)
    assert resp.status_code == 503 and resp.json()["retryable"] is True
    assert analyse.slots.in_use == 0                            # no job left running: released at once


def test_budget_timeout_holds_the_slot_until_its_running_job_ends(client, monkeypatch):
    """The timed-out call answers 503 at once, but a job a worker already runs
    cannot be cancelled: the slot stays taken (the retry gets 429, not a seat
    behind orphaned work) and is given back when the job ends."""
    import asyncio
    import threading
    import time

    gate, started = threading.Event(), threading.Event()
    pool = ThreadPoolExecutor(1)

    def busy():
        started.set()
        gate.wait(10)

    async def slow(*_a, jobs, **_k):
        jobs.submit(pool, busy)
        await asyncio.sleep(5)

    monkeypatch.setenv("SCAN_MAX_CALLS", "1")
    monkeypatch.setattr(header_read, "make_llm", lambda db, institute_id=None: _LLM())
    monkeypatch.setattr(analyse, "analyse_load", slow)
    monkeypatch.setattr(route.scan_config, "CALL_BUDGET_SECONDS", 0.2)
    try:
        resp = _post(client)
        assert resp.status_code == 503 and resp.json()["retryable"] is True
        assert started.is_set() and analyse.slots.in_use == 1
        assert _post(client).status_code == 429
        gate.set()
        deadline = time.monotonic() + 5
        while analyse.slots.in_use and time.monotonic() < deadline:
            client.get("/nothing")                 # let the app's loop run the holder task
            time.sleep(0.02)
        assert analyse.slots.in_use == 0
    finally:
        gate.set()
        pool.shutdown()


def test_200_answers_the_c1_shape(client, monkeypatch):
    monkeypatch.setattr(header_read, "make_llm", lambda db, institute_id=None: _LLM())
    resp = _post(client)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"analyser_version", "load_no", "status", "layout", "evidence", "pages", "sheets",
                         "flags", "usage"}
    assert body["layout"]["fronts_pass"] in (1, 2) and len(body["sheets"]) == 2
    assert body["usage"]["model"] == "m-x"
    assert analyse.slots.in_use == 0


def test_db_session_is_closed_before_the_analysis_starts(client, monkeypatch, db):
    """The session is only for the model config and the keys: its pooled
    connection must go back before the up-to-240 s analysis, not after it."""
    seen = {}

    def make_llm(got_db, institute_id=None):
        assert got_db is db and not db.closed
        seen["institute_id"] = institute_id
        return _LLM()

    real = analyse.analyse_load

    async def checked(*a, **k):
        seen["closed_at_start"] = db.closed
        return await real(*a, **k)

    monkeypatch.setattr(header_read, "make_llm", make_llm)
    monkeypatch.setattr(analyse, "analyse_load", checked)
    resp = _post(client)
    assert resp.status_code == 200, resp.text
    assert seen == {"institute_id": "inst", "closed_at_start": True}


def test_db_session_is_closed_when_the_config_read_fails(client, monkeypatch, db):
    def broken(*_a, **_k):
        raise RuntimeError("db down")

    monkeypatch.setattr(header_read, "make_llm", broken)
    with pytest.raises(RuntimeError):
        _post(client)
    assert db.closed is True
    assert analyse.slots.in_use == 0


def test_router_is_mounted_by_the_app_factory():
    src = (route.__file__.rsplit("/routers/", 1)[0] + "/app_factory.py")
    text = open(src).read()
    assert "from .routers.copy_check_scan import router as copy_check_scan_router" in text
    assert "app.include_router(copy_check_scan_router, prefix=settings.api_base_path)" in text


def test_label_page_helper_is_valid():
    assert front_page(1, label=True).shape == (1169, 827, 3)
