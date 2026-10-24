"""MP4 render for LMS AI videos (/lms-video/v1/render/{video_id}) and the
external /external/video/v1/render routes it shares code with
(submit_video_render + render_state_with_watchdog).

No DB, no network: the repository, render server, settings and timeline probe
are stubbed; the routes run through FastAPI apps with dependency overrides.
"""
from __future__ import annotations

import io
import json
import os
import sys
import types
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:  # the routers import s3_service → boto3; stub it where it isn't installed
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover - depends on the test venv
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.security import get_pinned_principal
from app.db import db_dependency
from app.dependencies import get_institute_from_api_key
from app.routers import external_video_generation as ext
from app.routers import lms_video as lms
from app.schemas.auth import PinnedPrincipal

INST = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
USER = "user-1"
LMS = lms.router.prefix
EXT = ext.router.prefix

READY_URLS = {"timeline": "https://s3/v/timeline.json", "audio": "https://s3/v/narration.mp3",
              "words": "https://s3/v/words.json"}


def _iso(seconds_ago: float = 0.0) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)).isoformat()


def _rec(owner=INST, *, status="COMPLETED", stage="HTML", s3=None, meta=None):
    m = {"institute_id": owner} if owner else {}
    m.update(meta or {})
    return SimpleNamespace(extra_metadata=m, status=status, current_stage=stage,
                           s3_urls=dict(READY_URLS if s3 is None else s3))


class FakeRepo:
    records: dict = {}
    writes: list = []

    def __init__(self, session=None):
        pass

    def get_by_video_id(self, vid):
        return FakeRepo.records.get(vid)

    def update_metadata(self, vid, meta):
        FakeRepo.writes.append((vid, meta))
        FakeRepo.records[vid].extra_metadata = meta


class FakeRenderService:
    submits: list = []
    fail: bool = False

    def __init__(self, render_server_url, render_key=None, **kw):
        self.url = render_server_url

    def submit(self, **kw):
        if FakeRenderService.fail:
            raise RuntimeError("render server said no")
        FakeRenderService.submits.append(kw)
        return f"job-{len(FakeRenderService.submits)}"


class FakeService:
    """VideoGenerationService.get_video_status over the fake records."""

    def get_video_status(self, vid):
        rec = FakeRepo.records.get(vid)
        if rec is None:
            return None
        return {"status": rec.status, "s3_urls": dict(rec.s3_urls), "metadata": dict(rec.extra_metadata)}


@pytest.fixture
def stubs(monkeypatch):
    FakeRepo.records, FakeRepo.writes = {}, []
    FakeRenderService.submits, FakeRenderService.fail = [], False
    refunds: list = []
    monkeypatch.setattr(lms, "AiVideoRepository", FakeRepo)
    monkeypatch.setattr(ext, "AiVideoRepository", FakeRepo)
    monkeypatch.setattr(lms, "_video_service", lambda db: FakeService())
    import app.services.render_service as rs_mod
    monkeypatch.setattr(rs_mod, "RenderService", FakeRenderService)
    import app.config as cfg
    monkeypatch.setattr(cfg, "get_settings", lambda: SimpleNamespace(
        render_server_url="http://render.test", render_server_key="k",
        ai_service_public_url="https://backend.test", api_base_path="/ai-service"))
    import urllib.request

    def fake_urlopen(url, timeout=None):
        assert url == READY_URLS["timeline"]
        return io.BytesIO(json.dumps({"entries": [{"exitTime": 40}, {"exitTime": 150.5}]}).encode())
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    import app.services.token_usage_service as tus
    monkeypatch.setattr(tus, "TokenUsageService", lambda db: SimpleNamespace(
        refund_video_credits=lambda vid, inst: refunds.append((vid, inst))))
    for k in ("RENDER_TIMEOUT_SECONDS", "RENDER_TIMEOUT_FLOOR", "RENDER_TIMEOUT_CEILING"):
        monkeypatch.delenv(k, raising=False)
    return SimpleNamespace(records=FakeRepo.records, writes=FakeRepo.writes,
                           submits=FakeRenderService.submits, refunds=refunds)


@pytest.fixture
def lms_client(stubs):
    roles = {"value": ["TEACHER"]}
    app = FastAPI()
    app.include_router(lms.router)
    app.dependency_overrides[get_pinned_principal] = lambda: PinnedPrincipal(
        user_id=USER, institute_id=INST, roles=roles["value"], is_root_user=False)
    app.dependency_overrides[db_dependency] = lambda: object()
    with TestClient(app) as client:
        client.roles = roles
        yield client


@pytest.fixture
def ext_client(stubs):
    app = FastAPI()
    app.include_router(ext.router)
    app.dependency_overrides[get_institute_from_api_key] = lambda: INST
    app.dependency_overrides[db_dependency] = lambda: object()
    app.dependency_overrides[ext.get_video_service] = lambda: FakeService()
    with TestClient(app) as client:
        yield client


# ── POST /lms-video/v1/render ────────────────────────────────────────────────

def test_render_submits_a_new_job_through_the_shared_path(lms_client, stubs):
    stubs.records["v1"] = _rec()
    r = lms_client.post(LMS + "/render/v1")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "queued" and body["progress"] == 0 and body["video_url"] is None
    assert body["error"] is None and body["updated_at"]
    assert set(body) == {"status", "progress", "video_url", "error", "updated_at"}

    (sub,) = stubs.submits
    assert sub["video_id"] == "v1" and sub["timeline_url"] == READY_URLS["timeline"]
    assert sub["audio_url"] == READY_URLS["audio"] and sub["words_url"] == READY_URLS["words"]
    assert (sub["width"], sub["height"]) == (1920, 1080) and sub["show_captions"] is True
    assert sub["callback_url"] == "https://backend.test/ai-service/external/video/v1/render-callback/v1"
    meta = stubs.records["v1"].extra_metadata
    assert meta["render_job_id"] == "job-1" and meta["render_planned_duration"] == 150.5
    assert meta["render_status"]["status"] == "queued"
    assert meta["institute_id"] == INST   # existing metadata kept

    # GET now reads the queued job back.
    g = lms_client.get(LMS + "/render/v1").json()
    assert g["status"] == "queued" and g["updated_at"] == meta["render_status"]["last_seen_at"]


def test_render_options_reach_the_render_server(lms_client, stubs):
    stubs.records["v1"] = _rec(meta={"orientation": "portrait"})
    assert lms_client.post(LMS + "/render/v1", json={"resolution": "720p", "show_captions": False}).status_code == 200
    (sub,) = stubs.submits
    assert (sub["width"], sub["height"]) == (720, 1280) and sub["show_captions"] is False
    assert lms_client.post(LMS + "/render/v2", json={"resolution": "4k"}).status_code == 422


def test_render_returns_an_existing_mp4_without_a_new_job(lms_client, stubs):
    stubs.records["v1"] = _rec(
        s3={**READY_URLS, "video": "https://s3/v/video.mp4"},
        meta={"render_job_id": "job-old", "render_status": {
            "status": "completed", "progress": 100, "video_url": "https://s3/v/video.mp4",
            "last_seen_at": "2026-10-13T10:00:00+00:00"}})
    r = lms_client.post(LMS + "/render/v1")
    assert r.status_code == 200
    assert r.json() == {"status": "completed", "progress": 100, "video_url": "https://s3/v/video.mp4",
                        "error": None, "updated_at": "2026-10-13T10:00:00+00:00"}
    assert stubs.submits == []


def test_render_in_progress_is_not_duplicated(lms_client, stubs):
    stubs.records["v1"] = _rec(meta={"render_job_id": "job-live", "render_status": {
        "status": "running", "progress": 37.5, "last_seen_at": _iso(30)}})
    r = lms_client.post(LMS + "/render/v1")
    assert r.status_code == 200
    assert r.json()["status"] == "running" and r.json()["progress"] == 37.5
    assert stubs.submits == []


def test_a_stale_render_is_failed_without_refund_and_retried(lms_client, stubs):
    stubs.records["v1"] = _rec(meta={"render_job_id": "job-dead", "render_started_at": _iso(4000),
                                     "render_status": {"status": "running", "progress": 12,
                                                       "last_seen_at": _iso(4000)}})
    g = lms_client.get(LMS + "/render/v1").json()
    assert g["status"] == "failed" and g["video_url"] is None
    assert "timed out" in g["error"] and "refund" not in g["error"].lower()
    meta = stubs.records["v1"].extra_metadata
    assert "render_job_id" not in meta and meta["render_status"]["status"] == "failed"
    assert stubs.refunds == []      # renders are not billed: never refund the generation

    # "Try again" submits a fresh job.
    r = lms_client.post(LMS + "/render/v1").json()
    assert r["status"] == "queued" and len(stubs.submits) == 1


def test_a_failed_render_can_be_retried(lms_client, stubs):
    stubs.records["v1"] = _rec(meta={"render_status": {"status": "failed", "error": "ffmpeg exited 1",
                                                       "last_seen_at": _iso(60)}})
    g = lms_client.get(LMS + "/render/v1").json()
    assert g["status"] == "failed" and g["error"] == "ffmpeg exited 1"
    assert lms_client.post(LMS + "/render/v1").json()["status"] == "queued"
    assert len(stubs.submits) == 1


@pytest.mark.parametrize("rec", [
    _rec(s3={"audio": READY_URLS["audio"]}),                       # no timeline
    _rec(s3={"timeline": READY_URLS["timeline"]}),                 # no audio
    _rec(status="IN_PROGRESS"),                                     # still generating
    _rec(status="COMPLETED", stage="TTS", s3={}),                  # between stages
])
def test_render_not_ready_is_409(lms_client, stubs, rec):
    stubs.records["v1"] = rec
    r = lms_client.post(LMS + "/render/v1")
    assert r.status_code == 409
    assert r.json()["code"] == "NOT_READY" and r.json()["detail"]
    assert stubs.submits == []


def test_render_is_tenant_checked(lms_client, stubs):
    stubs.records.update({"theirs": _rec(OTHER), "legacy": _rec(None)})
    for vid in ("theirs", "legacy", "missing"):
        assert lms_client.post(LMS + f"/render/{vid}").status_code == 404
        assert lms_client.get(LMS + f"/render/{vid}").status_code == 404
    assert stubs.submits == []


def test_render_requires_staff(lms_client, stubs):
    stubs.records["v1"] = _rec()
    lms_client.roles["value"] = ["STUDENT"]
    assert lms_client.post(LMS + "/render/v1").status_code == 403
    assert lms_client.get(LMS + "/render/v1").status_code == 403
    assert stubs.submits == []


def test_render_server_refusal_is_502(lms_client, stubs):
    stubs.records["v1"] = _rec()
    FakeRenderService.fail = True
    r = lms_client.post(LMS + "/render/v1")
    assert r.status_code == 502 and "render server said no" in r.json()["detail"]


def test_render_is_claimed_before_the_submit(lms_client, stubs, monkeypatch):
    # A second click / tab while the submit is in flight must read a live render.
    stubs.records["v1"] = _rec()
    seen = []
    orig = FakeRenderService.submit

    def submit(self, **kw):
        seen.append(lms.render_state("v1", INST, stubs.records["v1"], object()))
        return orig(self, **kw)
    monkeypatch.setattr(FakeRenderService, "submit", submit)
    assert lms_client.post(LMS + "/render/v1").json()["status"] == "queued"
    assert [s["status"] for s in seen] == ["queued"]
    assert len(stubs.submits) == 1


@pytest.mark.parametrize("prev", [None, {"status": "failed", "error": "ffmpeg exited 1",
                                          "last_seen_at": "2026-10-13T09:00:00+00:00"}])
def test_a_refused_submit_releases_the_claim(lms_client, stubs, prev):
    stubs.records["v1"] = _rec(meta={"render_status": prev} if prev else None)
    FakeRenderService.fail = True
    assert lms_client.post(LMS + "/render/v1").status_code == 502
    assert stubs.records["v1"].extra_metadata.get("render_status") == prev
    assert lms_client.get(LMS + "/render/v1").json()["status"] == ("failed" if prev else "none")
    FakeRenderService.fail = False
    assert lms_client.post(LMS + "/render/v1").json()["status"] == "queued"
    assert len(stubs.submits) == 1


# ── GET /lms-video/v1/render: states ─────────────────────────────────────────

def test_render_state_none_and_legacy_mp4(lms_client, stubs):
    stubs.records["never"] = _rec()
    assert lms_client.get(LMS + "/render/never").json() == {
        "status": "none", "progress": 0, "video_url": None, "error": None, "updated_at": None}
    # An MP4 rendered before render_status existed.
    stubs.records["old"] = _rec(s3={**READY_URLS, "video": "https://s3/old.mp4"})
    g = lms_client.get(LMS + "/render/old").json()
    assert g["status"] == "completed" and g["video_url"] == "https://s3/old.mp4"


def test_render_state_cleared_mp4_reads_none(lms_client, stubs):
    # DELETE /external/.../render drops s3_urls.video + render_job_id, keeps render_status.
    stubs.records["v1"] = _rec(meta={"render_status": {"status": "completed", "progress": 100,
                                                       "video_url": "https://s3/gone.mp4",
                                                       "last_seen_at": _iso(60)}})
    g = lms_client.get(LMS + "/render/v1").json()
    assert g["status"] == "none" and g["video_url"] is None
    assert lms_client.post(LMS + "/render/v1").json()["status"] == "queued"


def test_render_state_completed_before_s3_urls_written(lms_client, stubs):
    # The callback records render_status first, then s3_urls.video.
    stubs.records["v1"] = _rec(meta={"render_job_id": "job-1", "render_status": {
        "status": "completed", "progress": 100, "video_url": "https://s3/new.mp4", "last_seen_at": _iso(1)}})
    g = lms_client.get(LMS + "/render/v1").json()
    assert g["status"] == "completed" and g["video_url"] == "https://s3/new.mp4"


def test_render_state_progress_is_clamped_and_unknown_status_is_running(lms_client, stubs):
    stubs.records["v1"] = _rec(meta={"render_job_id": "j", "render_status": {
        "status": "encoding", "progress": 140, "last_seen_at": _iso(5)}})
    g = lms_client.get(LMS + "/render/v1").json()
    assert g["status"] == "running" and g["progress"] == 100


# ── external /render routes keep their behaviour ─────────────────────────────

def test_external_render_submit_unchanged(ext_client, stubs):
    stubs.records["v1"] = _rec()
    r = ext_client.post(EXT + "/render/v1", json={"resolution": "720p", "fps": 30, "caption_size": "L"})
    assert r.status_code == 200
    assert r.json() == {"job_id": "job-1", "status": "queued", "video_id": "v1"}
    (sub,) = stubs.submits
    assert (sub["width"], sub["height"]) == (1280, 720) and sub["fps"] == 30
    assert sub["caption_font_size"] == ext._CAPTION_SIZE_PX["L"] and sub["show_captions"] is True
    # The external route has no dedupe: a second call submits again.
    assert ext_client.post(EXT + "/render/v1").json()["job_id"] == "job-2"


def test_external_render_errors_unchanged(ext_client, stubs):
    stubs.records.update({"theirs": _rec(OTHER), "legacy": _rec(None),
                          "notl": _rec(s3={"audio": READY_URLS["audio"]}),
                          "noaudio": _rec(s3={"timeline": READY_URLS["timeline"]})})
    assert ext_client.post(EXT + "/render/theirs").status_code == 404
    assert ext_client.post(EXT + "/render/legacy").status_code == 200    # unstamped rows pass (external)
    r = ext_client.post(EXT + "/render/notl")
    assert r.status_code == 400 and "Missing timeline URL" in r.json()["detail"]
    r = ext_client.post(EXT + "/render/noaudio")
    assert r.status_code == 400 and "Missing audio URL" in r.json()["detail"]


def test_external_render_503_when_render_server_unset(ext_client, stubs, monkeypatch):
    import app.config as cfg
    monkeypatch.setattr(cfg, "get_settings", lambda: SimpleNamespace(
        render_server_url="", render_server_key="", ai_service_public_url=None, api_base_path="/ai-service"))
    stubs.records["theirs"] = _rec(OTHER)
    # Render-server check still runs before the tenant check, as before.
    assert ext_client.post(EXT + "/render/theirs").status_code == 503


def test_external_render_status_and_watchdog_unchanged(ext_client, stubs):
    stubs.records["live"] = _rec(meta={"render_job_id": "j1", "render_status": {
        "status": "running", "progress": 40.0, "last_seen_at": _iso(10)}})
    assert ext_client.get(EXT + "/render/status/j1", params={"video_id": "live"}).json() == {
        "job_id": "j1", "video_id": "live", "status": "running", "progress": 40.0,
        "video_url": None, "error": None}

    stubs.records["dead"] = _rec(meta={"render_job_id": "j2", "render_started_at": _iso(5000),
                                       "render_planned_duration": 60, "render_status": {
                                           "status": "running", "progress": 5, "last_seen_at": _iso(5000)}})
    body = ext_client.get(EXT + "/render/status/j2", params={"video_id": "dead"}).json()
    assert body["status"] == "failed" and body["watchdog"] is True and body["video_url"] is None
    assert body["progress"] == 5 and body["error"].endswith("Credits refunded; please retry.")
    assert "(threshold 900s)" in body["error"]
    assert stubs.refunds == [("dead", INST)]
    meta = stubs.records["dead"].extra_metadata
    assert "render_job_id" not in meta and "render_started_at" not in meta
    assert meta["render_last_failure_reason"].startswith("watchdog timeout")

    stubs.records["fresh"] = _rec()
    assert ext_client.get(EXT + "/render/status/j3", params={"video_id": "fresh"}).json()["status"] == "queued"
    assert ext_client.get(EXT + "/render/status/j3").status_code == 400
