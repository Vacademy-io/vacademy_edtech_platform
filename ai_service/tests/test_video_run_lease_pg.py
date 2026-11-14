"""Run-lease SQL against REAL Postgres (psycopg 3, the prod driver).

Needs a Postgres server: set AI_VIDEO_PG_URL or AI_LIMITS_PG_URL to a server
URL (postgresql+psycopg://user@host:port/postgres). A scratch database is
created (timezone UTC), ai_gen_video is created from the ORM model, and the
database is dropped afterwards. Skipped when no server is configured.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import types
import uuid
from datetime import datetime, timedelta, timezone
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

from sqlalchemy import create_engine, text  # noqa: E402

from app.models.ai_gen_video import AiGenVideo  # noqa: E402
from app.repositories.ai_video_repository import AiVideoRepository  # noqa: E402
from app.services import ai_video_run_lease as run_lease  # noqa: E402
from app.services import ai_video_sweeper  # noqa: E402

BASE_URL = os.environ.get("AI_VIDEO_PG_URL") or os.environ.get("AI_LIMITS_PG_URL")


def _db_url(base: str, name: str) -> str:
    head, _, tail = base.rpartition("/")
    q = ""
    if "?" in tail:
        tail, q = tail.split("?", 1)
        q = "?" + q
    return f"{head}/{name}{q}"


@pytest.fixture(scope="module")
def engine():
    if not BASE_URL:
        pytest.skip("no Postgres configured (set AI_VIDEO_PG_URL or AI_LIMITS_PG_URL)")
    name = f"aivideo_lease_{uuid.uuid4().hex[:10]}"
    try:
        admin = create_engine(BASE_URL, isolation_level="AUTOCOMMIT")
        with admin.connect() as c:
            c.execute(text(f'CREATE DATABASE "{name}"'))
            c.execute(text(f"ALTER DATABASE \"{name}\" SET timezone TO 'UTC'"))
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unavailable: {exc}")
    eng = create_engine(_db_url(BASE_URL, name), pool_size=10)
    with eng.begin() as c:
        c.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
    AiGenVideo.__table__.create(eng)
    yield eng
    eng.dispose()
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    admin.dispose()


@pytest.fixture
def repo(engine):
    with engine.begin() as c:
        c.execute(text("DELETE FROM ai_gen_video"))
    return AiVideoRepository(engine=engine)


def _iso(dt):
    return dt.isoformat()


def _now():
    return datetime.now(timezone.utc)


def _insert(engine, vid, *, status="IN_PROGRESS", meta=None, created_ago_h=0.0):
    with engine.begin() as c:
        c.execute(
            text("INSERT INTO ai_gen_video (id, video_id, current_stage, status, file_ids, s3_urls, language, "
                 "content_type, metadata, thumbnails, created_at, updated_at) VALUES (gen_random_uuid(), :v, "
                 "'HTML', :s, '{}', '{}', 'English', 'VIDEO', CAST(:m AS jsonb), '{}', "
                 "now() - make_interval(secs => :ago), now())"),
            {"v": vid, "s": status, "m": json.dumps(meta or {}), "ago": created_ago_h * 3600},
        )


def _meta(engine, vid):
    with engine.connect() as c:
        return c.execute(text("SELECT metadata FROM ai_gen_video WHERE video_id = :v"), {"v": vid}).scalar()


def _lease(state="running", *, hb_ago=0, leg=None, boot="other-boot", interrupted_at=None, **kw):
    lease = run_lease.new_lease(state=state)
    lease.update({"leg_id": leg or str(uuid.uuid4()), "owner_boot": boot,
                  "heartbeat_at": _iso(_now() - timedelta(seconds=hb_ago)),
                  "interrupted_at": interrupted_at, **kw})
    return lease


def test_exactly_one_concurrent_claimer_wins(engine, repo):
    lease = _lease(hb_ago=400)
    _insert(engine, "v1", meta={"run_request": {"v": 1}, "run_lease": lease})
    results, barrier = [], threading.Barrier(6)

    def claim():
        barrier.wait()
        results.append(repo.claim_for_resume("v1", lease["leg_id"], run_lease.new_lease(origin="auto_resume")))
    threads = [threading.Thread(target=claim) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(True) == 1 and results.count(False) == 5


def test_heartbeat_owner_vs_fenced(engine, repo):
    lease = _lease()
    _insert(engine, "v2", meta={"run_lease": lease})
    assert repo.heartbeat("v2", lease["leg_id"]) == "IN_PROGRESS"
    assert repo.heartbeat("v2", "another-leg") is None


def test_acquire_rules(engine, repo):
    me = run_lease.new_lease()
    _insert(engine, "live", meta={"run_lease": _lease()})
    _insert(engine, "stale", meta={"run_lease": _lease(hb_ago=400)})
    _insert(engine, "released", meta={"run_lease": _lease("released")})
    _insert(engine, "mine", meta={"run_lease": _lease(boot=me["owner_boot"])})
    _insert(engine, "fresh", meta={})
    _insert(engine, "cancelled", status="CANCELLED", meta={})
    assert repo.acquire_lease("live", dict(me), 180) is False
    assert repo.acquire_lease("stale", dict(me), 180) is True
    assert repo.acquire_lease("released", dict(me), 180) is True
    assert repo.acquire_lease("mine", dict(me), 180) is True
    assert repo.acquire_lease("fresh", dict(me), 180) is True
    assert repo.acquire_lease("cancelled", dict(me), 180) is False
    assert repo.acquire_lease("missing", dict(me), 180) is False


def test_whole_column_writers_never_revert_the_lease(engine, repo):
    a = _lease(leg="leg-A")
    _insert(engine, "v3", meta={"run_request": {"v": 1}, "run_lease": a, "checkpoint": {"completed_stages": ["SCRIPT"]}})
    stop = threading.Event()
    errors = []

    def heartbeats():
        while not stop.is_set():
            cur = (_meta(engine, "v3") or {}).get("run_lease") or {}
            repo.heartbeat("v3", cur.get("leg_id"))

    def writers(kind):
        try:
            for i in range(25):
                stale = repo.get_by_video_id("v3")          # holds an old copy of run_lease
                meta = dict(stale.extra_metadata or {})
                if kind == "meta":
                    meta[f"k{i}"] = i
                    repo.update_metadata("v3", meta)
                elif kind == "live":
                    repo.update_live_snapshot("v3", {"i": i})
                else:
                    repo.update_generation_progress("v3", {"type": "shot_done", "shot_index": i})
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    hb = threading.Thread(target=heartbeats)
    hb.start()
    ws = [threading.Thread(target=writers, args=(k,)) for k in ("meta", "live", "progress")]
    for t in ws:
        t.start()
    # A resumer takes the run over while every writer holds stale copies.
    assert repo.claim_for_resume("v3", "leg-A", _lease(leg="leg-B")) is True
    repo.update_checkpoint("v3", {"tts_persisted": True}, add_stages=["TTS"])
    for t in ws:
        t.join()
    stop.set()
    hb.join()
    assert not errors
    meta = _meta(engine, "v3")
    assert meta["run_lease"]["leg_id"] == "leg-B"
    assert sorted(meta["checkpoint"]["completed_stages"]) == ["SCRIPT", "TTS"]
    assert meta["checkpoint"]["tts_persisted"] is True
    assert meta["run_request"] == {"v": 1}
    # (non-owned keys keep today's last-writer-wins semantics; only the
    # resume-owned keys are protected)
    assert meta["k24"] == 24
    # deterministic: stale read → heartbeat → stale whole-column write
    stale = repo.get_by_video_id("v3")
    before = _meta(engine, "v3")["run_lease"]["heartbeat_at"]
    assert repo.heartbeat("v3", "leg-B") == "IN_PROGRESS"
    repo.update_metadata("v3", dict(stale.extra_metadata))
    assert _meta(engine, "v3")["run_lease"]["heartbeat_at"] >= before


def test_find_resumable_rules(engine, repo):
    boot = _now()
    rr = {"run_request": {"v": 1, "kind": "external"}}
    before_boot = _iso(boot - timedelta(seconds=30))
    after_boot = _iso(boot + timedelta(seconds=30))
    _insert(engine, "int-old", meta={**rr, "run_lease": _lease("interrupted", interrupted_at=before_boot)})
    _insert(engine, "int-new", meta={**rr, "run_lease": _lease("interrupted", interrupted_at=after_boot)})
    _insert(engine, "stale", meta={**rr, "run_lease": _lease(hb_ago=200)})
    _insert(engine, "handoff-stale", meta={**rr, "run_lease": _lease("handoff", hb_ago=200)})
    _insert(engine, "fresh", meta={**rr, "run_lease": _lease(hb_ago=10)})
    _insert(engine, "released", meta={**rr, "run_lease": _lease("released", hb_ago=900)})
    _insert(engine, "cancelled", status="CANCELLED", meta={**rr, "run_lease": _lease(hb_ago=900)})
    _insert(engine, "awaiting", status="AWAITING_INPUT", meta={**rr, "run_lease": _lease(hb_ago=900)})
    _insert(engine, "failed", status="FAILED", meta={**rr, "run_lease": _lease(hb_ago=900)})
    _insert(engine, "legacy", meta={"run_lease": _lease(hb_ago=900)})
    _insert(engine, "too-old", meta={**rr, "run_lease": _lease(hb_ago=900)}, created_ago_h=7)
    _insert(engine, "completed-stage", status="COMPLETED", meta={**rr, "run_lease": _lease(hb_ago=900)})
    got = {r["video_id"]: r for r in repo.find_resumable(50, _iso(boot))}
    assert set(got) == {"int-old", "stale", "handoff-stale", "completed-stage"}
    assert got["int-old"]["lease"]["state"] == "interrupted"


def test_sweeper_compare_and_set_loses_to_a_live_resume_claim(engine, repo):
    old = _lease(hb_ago=900, leg="leg-old")
    _insert(engine, "v5", meta={"run_request": {"v": 1}, "run_lease": old})
    stale_row = repo.get_by_video_id("v5")          # what the sweeper loaded
    assert repo.claim_for_resume("v5", "leg-old", _lease(leg="leg-resumed", origin="auto_resume")) is True
    assert ai_video_sweeper._claim_for_sweep(stale_row, repo=repo) is False
    assert _meta(engine, "v5")["run_lease"]["leg_id"] == "leg-resumed"
    # with no competing claim the sweeper takes it
    _insert(engine, "v6", meta={"run_request": {"v": 1}, "run_lease": _lease(hb_ago=900, leg="leg-6")})
    assert ai_video_sweeper._claim_for_sweep(repo.get_by_video_id("v6"), repo=repo) is True
    assert _meta(engine, "v6")["run_lease"]["state"] == "sweeping"
    # an interrupted run is swept too: a row the sweeper sees (untouched for
    # 6 h) is outside the resumer's 6 h window and would otherwise never settle
    _insert(engine, "v7", meta={"run_request": {"v": 1}, "run_lease": _lease("interrupted", hb_ago=900)})
    assert ai_video_sweeper._claim_for_sweep(repo.get_by_video_id("v7"), repo=repo) is True
    assert _meta(engine, "v7")["run_lease"]["state"] == "sweeping"


def test_release_merge_and_billing_writes(engine, repo):
    lease = _lease(leg="leg-R")
    _insert(engine, "v8", meta={"run_lease": lease, "keep": 1})
    for i in range(12):
        assert repo.release_lease("v8", "leg-R", "handoff", history={"i": i}, ended_at="t") is True
    assert repo.release_lease("v8", "not-mine", "released") is False
    meta = _meta(engine, "v8")
    assert meta["run_lease"]["state"] == "handoff" and meta["run_lease"]["ended_at"] == "t"
    assert [h["i"] for h in meta["resume_history"]] == list(range(2, 12))
    assert repo.merge_metadata("v8", {"source": "lms"}) is True and repo.merge_metadata("nope", {"a": 1}) is False
    assert repo.record_stage_billed("v8", "html", {"gen": 0}) is True
    assert repo.record_stage_billed("v8", "script", {"gen": 0}) is True
    meta = _meta(engine, "v8")
    assert meta["keep"] == 1 and meta["source"] == "lms"
    assert set(meta["billing"]["stages_billed"]) == {"html", "script"}
    assert meta["run_lease"]["leg_id"] == "leg-R"
