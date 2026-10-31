"""Resumer decisions, give-up path, LMS resume hooks and the checkpoint
uploader — no DB, no S3 (fakes)."""
from __future__ import annotations

import asyncio
import os
import sys
import threading
import time
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path
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
from app.services.video_checkpoint import CheckpointUploader, s3_key_for  # noqa: E402

NOW = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)


def _lease(**kw):
    base = {"leg_id": "L0", "state": "running", "heartbeat_at": (NOW - timedelta(seconds=200)).isoformat(),
            "crash_resumes": 0, "drain_resumes": 0}
    base.update(kw)
    return base


# ── decide ───────────────────────────────────────────────────────────────────

def test_crash_resumes_are_capped_with_backoff():
    assert resumer.decide(_lease(), NOW) == ("resume", "crash", {"crash_resumes": 1, "drain_resumes": 0})
    # second crash resume waits 180 s + 1 × 5 min after the stale heartbeat
    assert resumer.decide(_lease(crash_resumes=1), NOW)[0] == "wait"
    later = _lease(crash_resumes=1, heartbeat_at=(NOW - timedelta(seconds=500)).isoformat())
    assert resumer.decide(later, NOW)[:2] == ("resume", "crash")
    cap = resumer.MAX_CRASH_RESUMES
    assert cap == 4  # default until the graceful drain ships (deploy kills count as crashes)
    assert resumer.decide(_lease(crash_resumes=cap), NOW)[0] == "give_up"


def test_drain_resumes_are_capped_at_eight():
    assert resumer.decide(_lease(state="interrupted", drain_resumes=7), NOW) == \
        ("resume", "drain", {"crash_resumes": 0, "drain_resumes": 8})
    assert resumer.decide(_lease(state="interrupted", drain_resumes=8), NOW)[0] == "give_up"


def test_postgres_text_timestamps_parse():
    assert resumer._parse_ts("2026-10-22 12:00:00.123+00") == datetime(2026, 10, 22, 12, 0, 0, 123000,
                                                                     tzinfo=timezone.utc)


# ── scan / give up ───────────────────────────────────────────────────────────

class Repo:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def find_resumable(self, limit, boot):
        return [{"video_id": v, "lease": dict(r.extra_metadata["run_lease"]), "current_stage": r.current_stage,
                 "status": r.status} for v, r in self.rows.items()]

    def get_by_video_id(self, vid):
        return self.rows.get(vid)

    def claim_for_resume(self, vid, observed, new):
        self.calls.append(("claim", vid, new["state"]))
        cur = self.rows[vid].extra_metadata["run_lease"]
        if cur["leg_id"] != observed:
            return False
        self.rows[vid].extra_metadata["run_lease"] = dict(new)
        return True

    def mark_failed(self, vid, msg, current_stage=None):
        self.calls.append(("failed", vid))
        self.rows[vid].status = "FAILED"

    def release_lease(self, vid, leg, state, history=None, **kw):
        self.calls.append(("release", vid, state))
        return True


def _row(vid, *, lease, meta=None, stage="HTML", status="IN_PROGRESS"):
    m = {"run_lease": lease, "institute_id": "inst",
         "run_request": {"v": 1, "kind": "external", "final_target_stage": "HTML",
                         "kwargs": {"institute_id": "inst", "user_id": "u", "quality_tier": "ultra"}},
         "checkpoint": {"completed_stages": ["SCRIPT"]}}
    m.update(meta or {})
    return SimpleNamespace(video_id=vid, prompt="p", current_stage=stage, status=status, extra_metadata=m)


def test_give_up_refunds_first_then_fails_and_notifies_lms(monkeypatch):
    repo = Repo({"v1": _row("v1", lease=_lease(crash_resumes=resumer.MAX_CRASH_RESUMES),
                            meta={"source": "lms", "created_by_user_id": "u9", "lms_topic": "Cells"})})
    order = []

    def refund(vid, inst):
        order.append(("refund", vid, inst))
    orig_failed = repo.mark_failed

    def failed(vid, msg, current_stage=None):
        order.append(("failed", vid))
        orig_failed(vid, msg)
    repo.mark_failed = failed
    sent = []

    async def notify(inst, user, vid, topic, ctx, final):
        sent.append((inst, user, vid, final))
    from app.routers import lms_video
    monkeypatch.setattr(lms_video, "notify_creator", notify)
    monkeypatch.setattr(resumer, "_refund", refund)

    async def go():
        lease = repo.rows["v1"].extra_metadata["run_lease"]
        return await resumer.fail_and_refund("v1", "cap", lease, repo=repo, refund=refund)
    assert asyncio.run(go()) is True
    assert order == [("refund", "v1", "inst"), ("failed", "v1")]
    assert ("release", "v1", "released") in repo.calls
    assert sent == [("inst", "u9", "v1", "FAILED")]
    # a second pod observing the same old leg loses the claim and does nothing
    assert asyncio.run(resumer.fail_and_refund("v1", "cap", _lease(crash_resumes=2), repo=repo,
                                               refund=refund)) is False
    assert order == [("refund", "v1", "inst"), ("failed", "v1")]


def test_scan_resumes_external_runs_up_to_the_pod_cap(monkeypatch):
    monkeypatch.setenv("AI_VIDEO_RESUME_MAX_CONCURRENT", "1")
    rows = {f"v{i}": _row(f"v{i}", lease=_lease(leg_id=f"L{i}")) for i in range(3)}
    rows["legacy"] = _row("legacy", lease=_lease(leg_id="Lx"))
    rows["legacy"].extra_metadata.pop("run_request")
    repo = Repo(rows)
    started = []

    def fake_start(payload, vid, target, inst, **kw):
        started.append((vid, target, inst, kw))
        # the dispatched leg registers itself, which is what the cap counts
        run_lease._ACTIVE_LEGS[vid] = run_lease.LegHandle(video_id=vid, leg_id=kw["lease"]["leg_id"],
                                                          lease=kw["lease"], origin="auto_resume")
    try:
        res = asyncio.run(resumer.scan_once(repo=repo, start=fake_start, now=NOW))
    finally:
        for v in list(run_lease._ACTIVE_LEGS):
            run_lease._ACTIVE_LEGS.pop(v, None)
    assert len(res["resumed"]) == 1
    (vid, target, inst, kw) = started[0]
    assert target == "HTML" and inst == "inst"
    assert kw["resume"] is True and kw["resume_mode"] == "auto" and kw["resume_from_stage"] == "TTS"
    assert kw["lease"]["origin"] == "auto_resume" and kw["lease"]["crash_resumes"] == 1
    assert kw["generate_kwargs"]["prompt"] == "p" and kw["generate_kwargs"]["quality_tier"] == "ultra"
    assert kw["track_concurrency"] is False


def test_scan_never_resumes_a_legacy_row():
    rows = {"legacy": _row("legacy", lease=_lease())}
    rows["legacy"].extra_metadata.pop("run_request")
    started = []
    res = asyncio.run(resumer.scan_once(repo=Repo(rows), start=lambda *a, **k: started.append(a), now=NOW))
    assert started == [] and res["resumed"] == []


def test_lms_resume_hooks_notify_only_on_the_final_outcome(monkeypatch):
    from app.routers import lms_video
    sent = []

    async def notify(inst, user, vid, topic, ctx, final):
        sent.append(final)
    monkeypatch.setattr(lms_video, "notify_creator", notify)
    meta = {"institute_id": "inst", "created_by_user_id": "u", "lms_topic": "T", "context": {},
            "run_request": {"kwargs": {"language": "English"}}}

    async def go(final):
        monkeypatch.setattr(lms_video, "_finish_record", lambda *a, **k: final)
        hooks = lms_video.resume_hooks("v", meta)
        assert hooks.merged and hooks.responded
        await hooks.on_event({"type": "progress"})
        await hooks.on_finished(None)
    asyncio.run(go("IN_PROGRESS"))   # an interrupted leg: no bell
    asyncio.run(go("COMPLETED"))
    assert sent == ["COMPLETED"]


# ── heartbeat ────────────────────────────────────────────────────────────────

def test_heartbeat_fences_and_propagates_cross_pod_cancel():
    class HBRepo:
        def __init__(self, answer):
            self.answer = answer

        def heartbeat(self, vid, leg):
            return self.answer
    try:
        for vid, answer, reason in (("hb-fenced", None, "fenced"), ("hb-cancel", "CANCELLED", "user")):
            cancellation_registry.register(vid)
            run_lease._ACTIVE_LEGS[vid] = run_lease.LegHandle(video_id=vid, leg_id="L", lease={}, repository=HBRepo(answer))
        run_lease._ACTIVE_LEGS["hb-ok"] = run_lease.LegHandle(video_id="hb-ok", leg_id="L", lease={},
                                                              repository=HBRepo("IN_PROGRESS"))
        cancellation_registry.register("hb-ok")
        run_lease.heartbeat_once()
        assert cancellation_registry.reason("hb-fenced") == "fenced" and cancellation_registry.get("hb-fenced").is_set()
        assert cancellation_registry.reason("hb-cancel") == "user"
        assert not cancellation_registry.get("hb-ok").is_set()
    finally:
        for vid in ("hb-fenced", "hb-cancel", "hb-ok"):
            run_lease._ACTIVE_LEGS.pop(vid, None)
            cancellation_registry.clear(vid)


def test_pod_name_falls_back_to_hostname(monkeypatch):
    import socket
    monkeypatch.delenv("POD_NAME", raising=False)
    assert run_lease.pod_name() == socket.gethostname()
    monkeypatch.setenv("POD_NAME", "ai-service-abc")
    assert run_lease.pod_name() == "ai-service-abc"


# ── checkpoint uploader ──────────────────────────────────────────────────────

def test_s3_key_layout(tmp_path):
    rd = tmp_path / "vid"
    cases = {
        rd / "shot_cache" / "shot_004_sub1.json": "ai-videos/vid/checkpoints/shot_cache/shot_004_sub1.json",
        rd / "tts" / "shot_001.mp3": "ai-videos/vid/per_shot_tts/shot_001.mp3",
        rd / "narration.mp3": "ai-videos/vid/audio/narration.mp3",
        rd / "narration_raw.json": "ai-videos/vid/audio/narration_raw.json",
        rd / "narration_unmixed.mp3": "ai-videos/vid/audio/narration_unmixed.mp3",
        rd / "narration.words.csv": "ai-videos/vid/words/narration.words.csv",
        rd / "lesson" / "teacher_raw.mp4": "ai-videos/vid/lesson/teacher_raw.mp4",
        rd / "host_plan.json": "ai-videos/vid/checkpoints/host_plan.json",
        rd / "lesson_teacher.json": "ai-videos/vid/checkpoints/lesson_teacher.json",
    }
    for path, key in cases.items():
        assert s3_key_for("vid", rd, path) == key


def test_uploader_latest_version_wins_and_records_the_manifest(tmp_path):
    gate = threading.Event()
    uploads = []

    class S3:
        def upload_file(self, path, s3_key=None, content_type=None):
            gate.wait(5)
            uploads.append((s3_key, Path(path).read_text()))

    manifest = []

    class Repo2:
        def update_checkpoint(self, vid, fields, add_stages=()):
            manifest.append(fields)

    a, b = tmp_path / "shot_000.json", tmp_path / "shot_001.json"
    a.write_text("v1")
    b.write_text("b")
    up = CheckpointUploader(S3(), "vid", repository=Repo2())
    up.enqueue(b, "k/b")                  # occupies the worker (blocked on the gate)
    time.sleep(0.1)
    up.enqueue(a, "ai-videos/vid/checkpoints/shot_cache/shot_000.json")
    a.write_text("v2")
    up.enqueue(a, "ai-videos/vid/checkpoints/shot_cache/shot_000.json")   # re-queued before upload
    gate.set()
    assert up.flush(5) is True
    up.close(1)
    assert [u for u in uploads if u[0].endswith("shot_000.json")] == [
        ("ai-videos/vid/checkpoints/shot_cache/shot_000.json", "v2")]
    assert manifest[-1]["shots_persisted"] == ["shot_000.json"]


def test_uploader_failure_never_raises(tmp_path):
    class S3:
        def upload_file(self, *a, **k):
            raise RuntimeError("s3 down")
    f = tmp_path / "x.json"
    f.write_text("{}")
    up = CheckpointUploader(S3(), "vid")
    up.enqueue(f, "k")
    assert up.flush(5) is True and up.failed == ["k"]
    up.close(1)
