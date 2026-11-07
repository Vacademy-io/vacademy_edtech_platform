"""A generation killed mid-HTML resumes from its checkpoints (service side).

The real VideoGenerationService runs against a FAKE pipeline (honours
stop_event / checkpoint_callback / resume_mode like the real one), an
in-memory S3 (dict + list_objects_v2 with pagination) and an in-memory
repository that implements the lease / checkpoint / billing writes. Leg 1 is
killed after 3 of 6 shots (shots finish out of order: 0, 2, 5 first); the
resumer then claims the run and leg 2 must:
  • start at TTS (Phase-B combine) with resume_mode="auto",
  • restore tts/ and shots 0, 2, 5 by LISTING (no gap probing),
  • re-synthesise no TTS and generate only shots 1, 3, 4,
  • never refund, never write CANCELLED, bill each stage key once.
"""
from __future__ import annotations

import asyncio
import contextlib
import copy
import json
import os
import sys
import threading
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("SKIP_NLTK_DOWNLOAD", "1")

try:  # the service imports s3_service → boto3; stub it where it isn't installed
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from app.repositories.ai_video_repository import _preserve_owned_keys  # noqa: E402
from app.services import ai_video_resumer, ai_video_run_lease as run_lease  # noqa: E402
from app.services import cancellation_registry  # noqa: E402
from app.services import video_generation_service as vgs  # noqa: E402
from app.services.video_run_request import capture  # noqa: E402

INST = "11111111-1111-1111-1111-111111111111"
VID = "vid-resume-1"
SHOT_ORDER = [0, 2, 5, 1, 3, 4]


# ── fakes ────────────────────────────────────────────────────────────────────

class FakeS3Client:
    def __init__(self, store):
        self.store = store
        self.list_calls = 0

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None, **_):
        self.list_calls += 1
        keys = sorted(k for k in self.store if k.startswith(Prefix))
        start = int(ContinuationToken or 0)
        page = keys[start:start + 2]  # tiny pages: pagination is exercised
        nxt = start + 2
        return {"Contents": [{"Key": k} for k in page], "IsTruncated": nxt < len(keys),
                "NextContinuationToken": str(nxt) if nxt < len(keys) else None}


class FakeS3:
    public_bucket = "bkt"

    def __init__(self):
        self.store = {}
        self.lock = threading.Lock()
        self.s3_client = FakeS3Client(self.store)
        self.downloads = []

    def _url(self, key):
        return f"https://bkt.s3.amazonaws.com/{key}"

    def upload_file(self, file_path, s3_key=None, content_type=None):
        with self.lock:
            self.store[s3_key] = Path(file_path).read_bytes()
        return self._url(s3_key)

    def upload_video_file(self, file_path, video_id, stage):
        return self.upload_file(file_path, s3_key=f"ai-videos/{video_id}/{stage}/{Path(file_path).name}")

    def upload_video_directory(self, directory_path, video_id, stage):
        out = []
        for f in Path(directory_path).rglob("*"):
            if f.is_file() and not f.name.startswith("."):  # mirrors S3Service
                rel = f.relative_to(directory_path).as_posix()
                out.append(self.upload_file(f, s3_key=f"ai-videos/{video_id}/{stage}/{rel}"))
        return out

    def upload_file_content(self, content, filename, s3_key=None, content_type=None):
        with self.lock:
            self.store[s3_key] = content
        return self._url(s3_key)

    def download_file(self, s3_url, local_path, expected_missing=False):
        key = s3_url.split(".amazonaws.com/", 1)[-1]
        with self.lock:
            data = self.store.get(key)
        if data is None:
            return False
        self.downloads.append(key)
        Path(local_path).parent.mkdir(parents=True, exist_ok=True)
        Path(local_path).write_bytes(data)
        return True

    def delete_file(self, s3_url):
        with self.lock:
            return self.store.pop(s3_url.split(".amazonaws.com/", 1)[-1], None) is not None


def _now():
    return datetime.now(timezone.utc)


class FakeRepo:
    """In-memory ai_gen_video with the atomic lease / checkpoint semantics."""

    def __init__(self):
        self.rows = {}
        self.lock = threading.RLock()

    def _row(self, vid):
        return self.rows.get(vid)

    def create(self, video_id, prompt, language="English", content_type="VIDEO", metadata=None):
        with self.lock:
            self.rows[video_id] = SimpleNamespace(
                video_id=video_id, prompt=prompt, language=language, content_type=content_type,
                current_stage="PENDING", status="PENDING", extra_metadata=dict(metadata or {}),
                s3_urls={}, file_ids={}, error_message=None, created_at=_now(), updated_at=_now(),
            )
            return copy.deepcopy(self.rows[video_id])

    def get_by_video_id(self, video_id):
        with self.lock:
            r = self._row(video_id)
            return copy.deepcopy(r) if r is not None else None

    def update_stage(self, video_id, stage, status="IN_PROGRESS", **_):
        with self.lock:
            r = self._row(video_id)
            if r:
                r.current_stage, r.status, r.updated_at = stage, status, _now()
            return copy.deepcopy(r)

    def update_files(self, video_id, file_ids=None, s3_urls=None):
        with self.lock:
            r = self._row(video_id)
            r.file_ids.update(file_ids or {})
            r.s3_urls.update(s3_urls or {})
            return copy.deepcopy(r)

    def update_metadata(self, video_id, metadata):
        with self.lock:
            r = self._row(video_id)
            if r:
                r.extra_metadata = _preserve_owned_keys(r.extra_metadata, copy.deepcopy(metadata))

    def update_assist_state(self, video_id, assist_block, status=None, current_stage=None):
        with self.lock:
            r = self._row(video_id)
            r.extra_metadata["assist"] = assist_block
            if status:
                r.status = status
            if current_stage:
                r.current_stage = current_stage

    def update_live_snapshot(self, video_id, snapshot):
        pass

    def update_generation_progress(self, video_id, event):
        pass

    def update_thumbnails(self, video_id, thumbnails):
        pass

    def record_warning(self, video_id, message):
        pass

    def mark_failed(self, video_id, error_message, current_stage=None):
        with self.lock:
            r = self._row(video_id)
            r.status, r.error_message = "FAILED", error_message

    # atomic writes
    def merge_metadata(self, video_id, patch):
        with self.lock:
            r = self._row(video_id)
            if not r:
                return False
            r.extra_metadata.update(copy.deepcopy(patch))
            return True

    def update_checkpoint(self, video_id, fields=None, add_stages=()):
        with self.lock:
            r = self._row(video_id)
            ck = dict(r.extra_metadata.get("checkpoint") or {})
            ck.update({k: v for k, v in (fields or {}).items() if k != "completed_stages"})
            ck["completed_stages"] = sorted(set(ck.get("completed_stages") or []) | set(add_stages))
            r.extra_metadata["checkpoint"] = ck
            return True

    def record_stage_billed(self, video_id, stage, info):
        with self.lock:
            r = self._row(video_id)
            b = r.extra_metadata.setdefault("billing", {}).setdefault("stages_billed", {})
            b[stage] = info
            return True

    def acquire_lease(self, video_id, lease, stale_s=180):
        with self.lock:
            r = self._row(video_id)
            if not r or r.status == "CANCELLED":
                return False
            cur = r.extra_metadata.get("run_lease")
            ok = (
                cur is None
                or cur.get("state") in ("released", "interrupted", "handoff")
                or datetime.fromisoformat(cur["heartbeat_at"]) < _now() - timedelta(seconds=stale_s)
                or cur.get("owner_boot") == lease.get("owner_boot")
            )
            if ok:
                r.extra_metadata["run_lease"] = copy.deepcopy(lease)
            return ok

    def heartbeat(self, video_id, leg_id):
        with self.lock:
            r = self._row(video_id)
            cur = (r.extra_metadata.get("run_lease") or {}) if r else {}
            if cur.get("leg_id") != leg_id:
                return None
            cur["heartbeat_at"] = _now().isoformat()
            return r.status

    def release_lease(self, video_id, leg_id, state, history=None, **fields):
        with self.lock:
            r = self._row(video_id)
            cur = r.extra_metadata.get("run_lease") or {}
            if cur.get("leg_id") != leg_id:
                return False
            cur.update({"state": state, **fields})
            if history:
                r.extra_metadata["resume_history"] = (r.extra_metadata.get("resume_history") or [])[-9:] + [history]
            return True

    def claim_for_resume(self, video_id, observed_leg_id, new_lease):
        with self.lock:
            r = self._row(video_id)
            cur = r.extra_metadata.get("run_lease") or {}
            if cur.get("leg_id") != observed_leg_id or r.status in ("FAILED", "CANCELLED", "AWAITING_INPUT"):
                return False
            r.extra_metadata["run_lease"] = copy.deepcopy(new_lease)
            return True

    def find_resumable(self, limit, my_boot_at):
        out = []
        boot = datetime.fromisoformat(my_boot_at)
        with self.lock:
            for r in self.rows.values():
                lease = r.extra_metadata.get("run_lease") or {}
                if r.status in ("FAILED", "CANCELLED", "AWAITING_INPUT") or "run_request" not in r.extra_metadata:
                    continue
                if lease.get("state") not in ("running", "handoff", "interrupted"):
                    continue
                interrupted = lease.get("state") == "interrupted" and lease.get("interrupted_at") and \
                    datetime.fromisoformat(lease["interrupted_at"]) < boot
                stale = datetime.fromisoformat(lease["heartbeat_at"]) < _now() - timedelta(seconds=180)
                if interrupted or stale:
                    out.append({"video_id": r.video_id, "lease": copy.deepcopy(lease),
                                "current_stage": r.current_stage, "status": r.status})
        return out[:limit]


class Ledger:
    """TokenUsageService / CreditService stand-in: idempotency-keyed charges."""

    def __init__(self):
        self.charges = []   # (key, request_type, model)
        self.noops = []
        self.refunds = []

    def record_usage_and_deduct_credits(self, **kw):
        key = kw.get("idempotency_key")
        if key and any(c[0] == key for c in self.charges):
            self.noops.append(key)
            return None
        self.charges.append((key, str(kw.get("request_type")), kw.get("model")))

    def record_usage(self, **kw):
        return SimpleNamespace(id="u")

    def refund_video_credits(self, video_id, institute_id):
        self.refunds.append((video_id, institute_id))


class PipelineCancelled(Exception):
    pass


class Killed(BaseException):
    """A SIGKILL stand-in: nothing in-process runs after it."""


class FakePipeline:
    state = None

    def __init__(self, **kw):
        self.runs_dir = Path(kw["runs_dir"])

    def run(self, *, run_name, start_from, stop_at, stop_event=None, checkpoint_callback=None,
            resume_mode=None, **kw):
        st = FakePipeline.state
        st.calls.append({"start_from": start_from, "stop_at": stop_at, "resume_mode": resume_mode,
                         "checkpoint_callback": checkpoint_callback is not None})
        run_dir = self.runs_dir / run_name
        run_dir.mkdir(parents=True, exist_ok=True)
        cb = checkpoint_callback or (lambda kind, paths: None)
        usage = {"prompt_tokens": 100, "completion_tokens": 50, "model": "glm"}
        breakdown = {"stages": [{"kind": "llm", "model": "glm", "prompt_tokens": 100, "completion_tokens": 50}]}
        if stop_at == "script":
            if st.kill_in_script:
                raise Killed()
            (run_dir / "script.txt").write_text("the script")
            (run_dir / "shot_plan.json").write_text(json.dumps({"shots": [{"shot_index": i} for i in range(6)]}))
            return {"script_path": str(run_dir / "script.txt"), "run_dir": run_dir,
                    "token_usage": usage, "cost_breakdown": breakdown}
        assert stop_at == "html"
        if start_from == "html" and not (run_dir / "narration_raw.json").exists():
            raise FileNotFoundError("Cannot resume stage; missing narration_raw.json")
        if start_from == "tts":
            tts = run_dir / "tts"
            tts.mkdir(exist_ok=True)
            files = []
            for i in range(6):
                f = tts / f"shot_{i:03d}.mp3"
                if resume_mode == "auto" and f.exists():
                    st.tts_hits.append(i)
                else:
                    f.write_bytes(b"mp3-%d" % i)
                    (tts / f"shot_{i:03d}_raw.json").write_text("{}")
                    st.tts_synth.append(i)
                files += [f, tts / f"shot_{i:03d}_raw.json"]
            (tts / ".shot_000.mp3.0123.tmp").write_bytes(b"half")  # an atomic-write temp: never uploaded
            for name in ("narration.mp3", "narration_raw.json", "narration.words.json", "narration.words.csv"):
                (run_dir / name).write_text(name)
                files.append(run_dir / name)
            cb("tts", files)
        sc = run_dir / "shot_cache"
        sc.mkdir(exist_ok=True)
        made = 0
        for i in SHOT_ORDER:
            if stop_event is not None and stop_event.is_set():
                raise PipelineCancelled("stop")
            f = sc / f"shot_{i:03d}.json"
            if f.exists():
                st.cached.append(i)
                continue
            if st.kill_after is not None and made >= st.kill_after:
                st.kill()
            f.write_text(json.dumps({"entries": [i], "usage": {}}))
            st.generated.append(i)
            made += 1
            cb("shot", [f])
        (run_dir / "time_based_frame.json").write_text(json.dumps({"entries": [{"html": "x"}]}))
        return {"timeline_json": str(run_dir / "time_based_frame.json"),
                "audio_path": str(run_dir / "narration.mp3"),
                "words_json": str(run_dir / "narration.words.json"),
                "run_dir": run_dir,
                "token_usage": {**usage, "tts_character_count": 600}, "cost_breakdown": breakdown}


# ── harness ──────────────────────────────────────────────────────────────────

@pytest.fixture
def env(monkeypatch, tmp_path):
    st = SimpleNamespace(calls=[], tts_hits=[], tts_synth=[], cached=[], generated=[],
                         kill_after=None, kill=None, kill_in_script=False)
    FakePipeline.state = st
    monkeypatch.setitem(sys.modules, "automation_pipeline",
                        SimpleNamespace(VideoGenerationPipeline=FakePipeline))
    import app.config as cfg
    monkeypatch.setattr(cfg, "get_settings", lambda: SimpleNamespace(
        openrouter_api_key="k", pexels_api_keys="", pixabay_api_keys="", serper_api_keys="",
        aws_bucket_name="bkt", aws_s3_public_bucket="bkt", fal_api_key=""))
    monkeypatch.setattr(vgs, "_video_default_model_id", lambda *a, **k: "glm")
    monkeypatch.setattr(vgs.VideoGenerationService, "_build_sentence_clips_safe", lambda self, vid: None)

    from app.schemas.routing import RoutingPlan, VideoTypePlan
    import app.services.intent_router_service as irs
    import app.services.video_type_classifier_service as vtc

    class _Router:
        def __init__(self, **kw):
            pass

        async def route(self, **kw):
            return RoutingPlan()

    class _Typer:
        def __init__(self, **kw):
            pass

        async def classify(self, **kw):
            return VideoTypePlan()
    monkeypatch.setattr(irs, "IntentRouterService", _Router)
    monkeypatch.setattr(vtc, "VideoTypeClassifierService", _Typer)

    ledger = Ledger()

    @contextlib.contextmanager
    def fresh_session():
        yield SimpleNamespace(execute=lambda *a, **k: SimpleNamespace(scalar=lambda: 0),
                              begin_nested=contextlib.nullcontext)
    monkeypatch.setattr(vgs, "_fresh_db_session", fresh_session)
    import app.services.token_usage_service as tus
    import app.services.credit_service as cs
    monkeypatch.setattr(tus, "TokenUsageService", lambda db=None: ledger)
    monkeypatch.setattr(cs, "CreditService", lambda db=None: SimpleNamespace(
        usd_to_credits=lambda usd: usd, _get_model_video_per_second=lambda m: None))
    import app.services.metering.plan_wiring as pw
    monkeypatch.setattr(pw, "known", lambda inst: False)

    repo, s3 = FakeRepo(), FakeS3()
    svc = vgs.VideoGenerationService(repository=repo, s3_service=s3)
    yield SimpleNamespace(st=st, repo=repo, s3=s3, svc=svc, ledger=ledger, monkeypatch=monkeypatch)
    for vid in list(run_lease._ACTIVE_LEGS):
        run_lease._ACTIVE_LEGS.pop(vid, None)
    cancellation_registry.clear(VID)


GEN_KWARGS = dict(prompt="Explain photosynthesis", target_stage="HTML", quality_tier="ultra", tts_provider="premium",
                  content_type="VIDEO", institute_id=INST, user_id="u-1", language="English")


async def _consume(agen, events):
    async for ev in agen:
        events.append(ev)


def _leg1(env, *, hard_kill: bool):
    """Run leg 1 and kill it after 3 shots. hard_kill: SIGKILL (nothing runs
    after, only incremental uploads survive); else the asyncio task is
    cancelled (process shutdown)."""
    st, events = env.st, []
    st.kill_after = 3
    run_request = capture("external", "HTML", GEN_KWARGS)
    if hard_kill:
        # SIGKILL: no leg epilogue, no final flush (instance-level overrides).
        env.svc._finish_leg = lambda vid, leg: None

        async def _no_flush(uploader, timeout):
            return None
        env.svc._flush_uploader = _no_flush

        def kill():
            run_lease.active_leg(VID).uploader.flush(5)  # what had reached S3 before the kill
            raise Killed()
        st.kill = kill

        async def go():
            with pytest.raises(Killed):
                await _consume(env.svc.generate_till_stage(video_id=VID, run_request=run_request, **GEN_KWARGS),
                               events)
        asyncio.run(go())
        _process_died(env)
        return events
    reached, proceed = threading.Event(), threading.Event()

    def kill():
        run_lease.active_leg(VID).uploader.flush(5)
        reached.set()
        proceed.wait(5)
        raise Killed()  # the thread ends; its result is never read (task cancelled)
    st.kill = kill

    async def go():
        task = asyncio.ensure_future(_consume(
            env.svc.generate_till_stage(video_id=VID, run_request=run_request, **GEN_KWARGS), events))
        await asyncio.to_thread(reached.wait, 5)
        task.cancel()
        proceed.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(go())
    return events


def _process_died(env):
    """Forget everything the killed process held in memory; its heartbeat
    stopped long enough ago to read as dead."""
    for attr in ("_finish_leg", "_flush_uploader"):
        env.svc.__dict__.pop(attr, None)
    run_lease._ACTIVE_LEGS.pop(VID, None)
    cancellation_registry.clear(VID)
    lease = env.repo.rows[VID].extra_metadata.get("run_lease")
    if lease:
        lease["heartbeat_at"] = (_now() - timedelta(seconds=400)).isoformat()


def _resume_via_resumer(env, *, boot_later: bool):
    """Scan as a freshly booted pod, then run the dispatched leg."""
    started = []

    def fake_start(payload, vid, target, inst, **kw):
        started.append(SimpleNamespace(vid=vid, target=target, inst=inst, kw=kw))

    if boot_later:
        env.monkeypatch.setattr(run_lease, "BOOT_AT", (_now() + timedelta(seconds=5)).isoformat())
    res = asyncio.run(ai_video_resumer.scan_once(repo=env.repo, start=fake_start))
    assert res["resumed"] == [VID], res
    (s,) = started
    env.st.kill_after = None
    env.st.generated.clear()
    events = []
    kw = dict(s.kw["generate_kwargs"])

    async def go():
        await _consume(env.svc.generate_till_stage(
            video_id=VID, resume=True, resume_from_stage=s.kw["resume_from_stage"],
            resume_mode=s.kw["resume_mode"], lease=s.kw["lease"], **kw), events)
    asyncio.run(go())
    return s, events


def _assert_resumed_correctly(env, s, events2):
    st, repo = env.st, env.repo
    rec = repo.rows[VID]
    # (b) resumed at TTS (combine) in auto mode
    assert s.kw["resume_from_stage"] == "TTS" and s.kw["resume_mode"] == "auto" and s.kw["resume"] is True
    html_call = st.calls[-1]
    assert html_call["start_from"] == "tts" and html_call["resume_mode"] == "auto"
    # tts/ restored → zero re-synthesis; shots 0,2,5 restored by listing; only 1,3,4 made
    assert st.tts_hits[-6:] == list(range(6))
    assert sorted(st.cached) == [0, 2, 5]
    assert sorted(st.generated) == [1, 3, 4]
    assert env.s3.s3_client.list_calls >= 2
    assert not any(".tmp" in k for k in env.s3.store), "atomic-write temps must never be uploaded"
    # finished, lease released, no refund ever
    assert rec.status == "COMPLETED" and rec.current_stage == "HTML"
    assert rec.extra_metadata["run_lease"]["state"] == "released"
    assert set(rec.extra_metadata["checkpoint"]["completed_stages"]) >= {"SCRIPT", "TTS", "WORDS", "HTML"}
    assert env.ledger.refunds == []
    assert not [e for e in events2 if e.get("type") == "error"]
    # one charge per stage key
    keys = [c[0] for c in env.ledger.charges]
    assert all(keys) and len(keys) == len(set(keys))
    assert f"{VID}:stage:script:llm:glm" in keys and f"{VID}:stage:html:llm:glm" in keys
    assert f"{VID}:stage:html:tts" in keys
    assert set(rec.extra_metadata["billing"]["stages_billed"]) == {"script", "html"}


# ── tests ────────────────────────────────────────────────────────────────────

def test_task_cancelled_mid_html_is_an_interruption_and_resumes(env):
    events1 = _leg1(env, hard_kill=False)
    rec = env.repo.rows[VID]
    # (a) no refund, no CANCELLED, no error event, lease interrupted
    assert env.ledger.refunds == []
    assert rec.status != "CANCELLED"
    assert not [e for e in events1 if e.get("type") in ("error", "cancelled")]
    lease = rec.extra_metadata["run_lease"]
    assert lease["state"] == "interrupted" and lease["interrupt_reason"] == "task_cancelled"
    assert sorted(env.st.generated) == [0, 2, 5]
    assert {k.rsplit("/", 1)[-1] for k in env.s3.store if "/checkpoints/shot_cache/" in k} == \
        {"shot_000.json", "shot_002.json", "shot_005.json"}
    assert rec.extra_metadata["checkpoint"]["shots_persisted"] == ["shot_000.json", "shot_002.json", "shot_005.json"]
    assert rec.extra_metadata["checkpoint"]["tts_persisted"] is True
    # the run request was stored with the row
    assert rec.extra_metadata["run_request"]["final_target_stage"] == "HTML"
    # an old replica (booted before the interruption) never picks it up
    assert asyncio.run(ai_video_resumer.scan_once(repo=env.repo, start=lambda *a, **k: None))["resumed"] == []

    s, events2 = _resume_via_resumer(env, boot_later=True)
    assert env.repo.rows[VID].extra_metadata["run_lease"]["drain_resumes"] == 1
    _assert_resumed_correctly(env, s, events2)


def test_hard_kill_mid_html_resumes_from_incremental_uploads(env):
    _leg1(env, hard_kill=True)
    rec = env.repo.rows[VID]
    assert rec.extra_metadata["run_lease"]["state"] == "running"   # nothing ran after the kill
    assert rec.current_stage == "WORDS"                           # the combine skip's pointer
    s, events2 = _resume_via_resumer(env, boot_later=False)
    assert env.repo.rows[VID].extra_metadata["run_lease"]["crash_resumes"] == 1
    _assert_resumed_correctly(env, s, events2)


def test_kill_during_script_resumes_at_script(env):
    env.st.kill_in_script = True
    run_request = capture("external", "HTML", GEN_KWARGS)
    env.svc._finish_leg = lambda vid, leg: None

    async def go():
        with pytest.raises(Killed):
            await _consume(env.svc.generate_till_stage(video_id=VID, run_request=run_request, **GEN_KWARGS), [])
    asyncio.run(go())
    rec = env.repo.rows[VID]
    assert rec.current_stage == "SCRIPT" and rec.status == "IN_PROGRESS"
    # (d) the manifest has nothing completed → SCRIPT, not TTS
    assert vgs.VideoGenerationService.resume_start_stage(rec) == "SCRIPT"
    # and the legacy fallback (no manifest) agrees
    legacy = SimpleNamespace(extra_metadata={}, current_stage="SCRIPT", status="IN_PROGRESS")
    assert vgs.VideoGenerationService.resume_start_stage(legacy) == "SCRIPT"
    done_legacy = SimpleNamespace(extra_metadata={}, current_stage="SCRIPT", status="COMPLETED")
    assert vgs.VideoGenerationService.resume_start_stage(done_legacy) == "TTS"
    _process_died(env)
    env.st.kill_in_script = False
    s, _ = _resume_via_resumer(env, boot_later=False)
    assert s.kw["resume_from_stage"] == "SCRIPT"
    assert env.st.calls[1]["start_from"] == "script"    # the script really re-ran
    assert env.repo.rows[VID].status == "COMPLETED"


def test_old_resume_path_reproduces_the_missing_narration_failure(env):
    """(e) Regression: without the clamp a kill mid-HTML resumes at HTML
    (current_stage=WORDS + 1) and — with no narration_raw.json in S3, as
    before incremental checkpoints — dies on it. The auto path on the very
    same state succeeds."""
    _leg1(env, hard_kill=True)
    for k in [k for k in env.s3.store if k.endswith("/audio/narration_raw.json")]:
        env.s3.store.pop(k)
    env.repo.rows[VID].extra_metadata.pop("run_lease")  # legacy row: no lease either
    events = []

    async def go():
        await _consume(env.svc.generate_till_stage(video_id=VID, resume=True, **GEN_KWARGS), events)
    asyncio.run(go())
    assert env.st.calls[-1]["start_from"] == "html"
    errs = [e for e in events if e.get("type") == "error"]
    assert errs and "narration_raw.json" in errs[0]["message"]

    # same state, auto mode: restarts at TTS and completes
    env.repo.rows[VID].status = "IN_PROGRESS"
    env.st.generated.clear()
    events = []

    async def go2():
        await _consume(env.svc.generate_till_stage(video_id=VID, resume=True, resume_mode="auto", **GEN_KWARGS),
                       events)
    asyncio.run(go2())
    assert env.st.calls[-1]["start_from"] == "tts" and env.st.calls[-1]["resume_mode"] == "auto"
    assert env.repo.rows[VID].status == "COMPLETED"


def test_fenced_leg_exits_silently(env):
    """A leg whose lease another pod took over stops with no CANCELLED status,
    no refund and no error event."""
    st, events = env.st, []
    st.kill_after = 2

    def fence():
        lease = env.repo.rows[VID].extra_metadata["run_lease"]
        lease["leg_id"] = "someone-else"
        run_lease.heartbeat_once()   # the heartbeat sees the fence and raises the stop flag
    st.kill = lambda: (fence(), setattr(st, "kill_after", None))

    async def go():
        await _consume(env.svc.generate_till_stage(video_id=VID, **GEN_KWARGS), events)
    asyncio.run(go())
    rec = env.repo.rows[VID]
    assert rec.status not in ("CANCELLED", "FAILED")
    assert [e for e in events if e.get("type") == "interrupted"][0]["reason"] == "fenced"
    assert not [e for e in events if e.get("type") in ("error", "cancelled", "completed")]
    assert env.ledger.refunds == []
    assert rec.extra_metadata["run_lease"]["leg_id"] == "someone-else"   # untouched by the fenced leg


def test_assist_pause_releases_the_lease_before_the_decision_is_answerable(env):
    """The pause releases the lease itself (before AWAITING_INPUT is written),
    so a /decision answered at once on the OTHER pod is never refused with
    409 after it already consumed the pending decision."""
    env.repo.create(VID, "p")
    lease = run_lease.new_lease()
    assert env.repo.acquire_lease(VID, lease, 180)
    leg = vgs._LegState()
    leg.handle = run_lease.begin_leg(env.repo, VID, lease=lease)
    asyncio.run(env.svc._release_leg_for_pause(VID, leg))
    assert leg.handle.ended and run_lease.active_leg(VID) is None
    assert env.repo.rows[VID].extra_metadata["run_lease"]["state"] == "released"
    other_pod = dict(run_lease.new_lease(), owner_boot="another-process")
    assert env.repo.acquire_lease(VID, other_pod, 180) is True
    # the generator's own epilogue afterwards is a no-op
    env.svc._finish_leg(VID, leg)
    assert env.repo.rows[VID].extra_metadata["run_lease"]["leg_id"] == other_pod["leg_id"]
