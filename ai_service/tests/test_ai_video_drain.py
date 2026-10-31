"""Graceful drain of in-flight AI-video legs on pod shutdown — no DB (fakes)."""
from __future__ import annotations

import asyncio
import os
import sys
import threading
import time
import types
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
try:
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from app.services import ai_video_resumer as resumer  # noqa: E402
from app.services import ai_video_run_lease as run_lease  # noqa: E402
from app.services import cancellation_registry  # noqa: E402

NOW = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _clean():
    yield
    run_lease._draining.clear()
    for v in list(run_lease._ACTIVE_LEGS):
        run_lease._ACTIVE_LEGS.pop(v, None)
        cancellation_registry.clear(v)


class LeaseRepo:
    """release_lease is the compare-and-set on leg_id: `owner` says whether
    the lease is still this leg's."""

    def __init__(self, owner=True):
        self.owner = owner
        self.releases = []

    def release_lease(self, vid, leg, state, history=None, **fields):
        self.releases.append((vid, leg, state, fields))
        return self.owner


class Uploader:
    def __init__(self):
        self.flushed = []

    def flush(self, timeout=25.0):
        self.flushed.append(timeout)
        return True


def _leg(vid, repo, *, uploader=None):
    h = run_lease.LegHandle(video_id=vid, leg_id=f"leg-{vid}", lease={"leg_id": f"leg-{vid}"},
                            repository=repo, uploader=uploader)
    run_lease._ACTIVE_LEGS[vid] = h
    cancellation_registry.register(vid)
    return h


def test_a_leg_that_does_not_unwind_is_flushed_and_marked_interrupted():
    repo, up = LeaseRepo(), Uploader()
    h = _leg("v1", repo, uploader=up)
    out = run_lease.drain(wait_s=0.05, flush_s=1.5)
    assert out == {"v1": "marked"}
    assert up.flushed == [1.5], "checkpoint uploads are flushed before the lease is handed back"
    (vid, leg, state, fields) = repo.releases[0]
    assert (vid, leg, state) == ("v1", "leg-v1", "interrupted")
    assert fields["interrupt_reason"] == "drain" and fields["interrupted_at"]
    assert cancellation_registry.reason("v1") == "drain" and cancellation_registry.is_takeover("v1")
    assert h.stop_reason == "drain" and h.ended and run_lease.is_draining()


def test_a_leg_that_unwinds_in_time_finishes_itself_once():
    repo = LeaseRepo()
    h = _leg("v2", repo)

    def pipeline():  # the leg sees the stop flag, unwinds and finishes its own lease
        cancellation_registry.get("v2").wait(2)
        time.sleep(0.05)
        run_lease.end_leg(h, "interrupted", outcome="interrupted", reason="drain",
                          interrupted_at=run_lease.now_iso(), interrupt_reason="drain")
    t = threading.Thread(target=pipeline)
    t.start()
    out = run_lease.drain(wait_s=2)
    t.join()
    assert out == {"v2": "unwound"}
    assert [r[2] for r in repo.releases] == ["interrupted"], "one write, by the leg itself"


def test_a_lease_another_pod_already_took_is_left_alone():
    repo = LeaseRepo(owner=False)  # CAS on leg_id fails
    _leg("v3", repo)
    assert run_lease.drain(wait_s=0) == {"v3": "not_owner"}


def test_a_fenced_leg_is_never_written():
    repo = LeaseRepo()
    h = _leg("v4", repo)
    h.stop_reason = "fenced"
    assert run_lease.drain(wait_s=0) == {"v4": "fenced"}
    assert repo.releases == []
    assert cancellation_registry.reason("v4") == "drain"  # stop raised; a fenced leg exits silently anyway


def test_drain_is_idempotent_and_a_later_finish_does_not_clobber_interrupted():
    repo = LeaseRepo()
    h = _leg("v5", repo)
    assert run_lease.drain(wait_s=0) == {"v5": "marked"}
    assert run_lease.drain(wait_s=0) == {}
    # the leg's own finish arrives later (e.g. _finish_leg after the stop unwound it)
    assert run_lease.end_leg(h, "released", outcome="completed") is False
    assert [r[2] for r in repo.releases] == ["interrupted"]


def test_unleased_legs_are_skipped():
    h = run_lease.LegHandle(video_id="v6", leg_id=None, lease=None, repository=LeaseRepo())
    run_lease._ACTIVE_LEGS["v6"] = h
    assert run_lease.drain(wait_s=0) == {}


def test_drain_is_bounded():
    _leg("v7", LeaseRepo(), uploader=Uploader())
    t0 = time.monotonic()
    run_lease.drain(wait_s=0.2, flush_s=0.1)
    assert time.monotonic() - t0 < 1.5


# ── resumer ──────────────────────────────────────────────────────────────────

def test_an_interrupted_lease_resumes_at_once_as_a_drain():
    fresh = {"leg_id": "L", "state": "interrupted", "heartbeat_at": NOW.isoformat(),
             "interrupted_at": NOW.isoformat(), "interrupt_reason": "drain",
             "crash_resumes": 2, "drain_resumes": 0}
    # no staleness wait and no crash backoff, even with crash resumes on record
    assert resumer.decide(fresh, NOW) == ("resume", "drain", {"crash_resumes": 2, "drain_resumes": 1})


def test_a_draining_pod_takes_on_no_resumes():
    class Repo:
        def find_resumable(self, *a):  # pragma: no cover - must not be reached
            raise AssertionError("a draining pod must not scan")
    run_lease._draining.set()
    assert asyncio.run(resumer.scan_once(repo=Repo(), start=lambda *a, **k: None, now=NOW)) == {
        "resumed": [], "gave_up": [], "waiting": [], "skipped": []}


# ── service: a drained leg finishes as interrupted ────────────────────────────

def test_the_service_finishes_a_drained_leg_as_interrupted():
    from app.services.video_generation_service import VideoGenerationService, _LegState

    repo = LeaseRepo()
    h = _leg("v8", repo)
    cancellation_registry.signal_stop("v8", reason="drain")
    leg = _LegState("HTML")
    leg.handle = h
    VideoGenerationService._finish_leg(SimpleNamespace(repository=None), "v8", leg)
    (_, _, state, fields) = repo.releases[0]
    assert state == "interrupted" and fields["interrupt_reason"] == "drain"


def test_the_service_still_leaves_a_fenced_leg_untouched():
    from app.services.video_generation_service import VideoGenerationService, _LegState

    repo = LeaseRepo()
    h = _leg("v9", repo)
    cancellation_registry.signal_stop("v9", reason="fenced")
    leg = _LegState("HTML")
    leg.handle = h
    VideoGenerationService._finish_leg(SimpleNamespace(repository=None), "v9", leg)
    assert repo.releases == []


def test_a_user_cancel_is_not_a_takeover():
    cancellation_registry.register("v10")
    cancellation_registry.signal_stop("v10", reason="user")
    assert not cancellation_registry.is_takeover("v10")


# ── endpoint ─────────────────────────────────────────────────────────────────

def _client(monkeypatch, override=True):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.dependencies import require_internal_service_token
    from app.routers import ai_video_drain_internal as mod

    calls = []

    def fake_drain(wait_s=None):
        calls.append(wait_s)
        return {"vX": "marked"}
    monkeypatch.setattr(mod.run_lease, "drain", fake_drain)
    app = FastAPI()
    app.include_router(mod.router, prefix="/ai-service")
    if override:
        app.dependency_overrides[require_internal_service_token] = lambda: None
    return TestClient(app), calls


def test_the_drain_endpoint_drains_this_pod(monkeypatch):
    client, calls = _client(monkeypatch)
    r = client.post("/ai-service/internal/ai-video/v1/drain?wait_s=20")
    assert r.status_code == 200 and r.json() == {"draining": True, "legs": {"vX": "marked"}}
    assert calls == [20.0]
    assert client.post("/ai-service/internal/ai-video/v1/drain?wait_s=500").status_code == 422


def test_the_drain_endpoint_needs_the_internal_token(monkeypatch):
    client, calls = _client(monkeypatch, override=False)
    r = client.post("/ai-service/internal/ai-video/v1/drain")
    assert r.status_code in (401, 503) and calls == []
