"""Caption requeue (course_knowledge/caption_requeue.py) on a REAL Postgres 16 with
the real V600 schema and psycopg 3 (course_knowledge_pg_helpers).

Selected: legacy-note EMPTY rows, transient FAILED rows, NO_CAPTIONS rows older
than 14 days. Skipped: PRIVATE / AGE_RESTRICTED rows, rows re-queued under 24 h
ago, non-caption rows. Selected rows get content_hash NULL and a
caption_requeued_at stamp and are queued with reason YT_CAPTIONS_RETRY; the
sweep step runs only with captions_ok.

Skipped unless AI_LIMITS_PG_URL or AI_LIMITS_PGDATA is set.
"""
from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import text  # noqa: E402

from app import db as app_db  # noqa: E402
from app.services.course_knowledge import caption_requeue, flags, store, sweep  # noqa: E402
from app.services.course_knowledge.extract.media import LEGACY_NO_CAPTIONS_NOTE  # noqa: E402
from app.services.youtube_captions import service as yt_service  # noqa: E402
from app.services.youtube_captions.service import Config  # noqa: E402
from course_knowledge_pg_helpers import make_course, pg_session_factory  # noqa: E402


@pytest.fixture(scope="module")
def Session():
    factory = pg_session_factory()
    yield factory
    factory.close()


@pytest.fixture(autouse=True)
def wired(Session, monkeypatch):
    monkeypatch.setattr(app_db, "get_sessionmaker", lambda: Session)
    monkeypatch.setattr(flags, "available", lambda i: True)
    monkeypatch.setattr(flags, "paid_enabled", lambda: False)
    monkeypatch.setattr(yt_service, "load_config", lambda: Config(requeue_enabled=True, requeue_per_sweep=300,
                                                                  canary_video_ids=("aaaaaaaaaaa",)))
    caption_requeue._CANARY.update(at=None, ok=False)


def _inst(Session) -> str:
    inst = f"inst-{uuid.uuid4().hex[:8]}"
    with Session() as db:
        db.execute(text("INSERT INTO course_knowledge_setting (institute_id, enabled, enabled_at) "
                        "VALUES (:i, TRUE, now() - interval '30 days')"), {"i": inst})
        db.commit()
    return inst


def _source(Session, inst, *, state="EMPTY", meta=None, age_days=0, parser=None, chash="h1",
            slide=None) -> str:
    slide = slide or f"slide-{uuid.uuid4().hex[:10]}"
    with Session() as db:
        kb = store.ensure_course_kb(db, inst)
        db.commit()
        store.set_source_state(db, kb=kb, slide_id=slide, title="Video lesson", index_state=state,
                               status="FAILED" if state == "FAILED" else "PENDING",
                               meta=meta or {}, content_hash=chash)
        db.execute(text("UPDATE knowledge_base_source SET updated_at = now() - (CAST(:d AS integer) * interval '1 day'), "
                        "parser = :p WHERE slide_id = :s"), {"d": age_days, "p": parser, "s": slide})
        db.commit()
    return slide


def _src(Session, slide):
    with Session() as db:
        return db.execute(text("SELECT content_hash, meta_json FROM knowledge_base_source WHERE slide_id = :s"),
                          {"s": slide}).first()


def _queued(Session, inst):
    with Session() as db:
        return {r[0]: (r[1], r[2]) for r in db.execute(
            text("SELECT slide_id, reason, allow_paid FROM content_index_queue WHERE institute_id = :i"), {"i": inst})}


CAPTIONS = {"text_kind": "captions"}


def _seed(Session, inst):
    s = {}
    s["legacy"] = _source(Session, inst, meta={**CAPTIONS, "note": LEGACY_NO_CAPTIONS_NOTE})
    s["legacy_parser_only"] = _source(Session, inst, meta={"note": LEGACY_NO_CAPTIONS_NOTE}, parser="captions")
    s["blocked_failed"] = _source(Session, inst, state="FAILED", meta={**CAPTIONS, "caption_outcome": "BLOCKED",
                                                                       "caption_transient": True})
    s["unconfirmed"] = _source(Session, inst, state="FAILED", meta={**CAPTIONS, "caption_outcome": "NO_CAPTIONS",
                                                                    "caption_transient": True})
    s["old_no_captions"] = _source(Session, inst, meta={**CAPTIONS, "caption_outcome": "NO_CAPTIONS"}, age_days=15)
    s["new_no_captions"] = _source(Session, inst, meta={**CAPTIONS, "caption_outcome": "NO_CAPTIONS"}, age_days=3)
    s["private"] = _source(Session, inst, meta={**CAPTIONS, "caption_outcome": "PRIVATE"}, age_days=40)
    s["age"] = _source(Session, inst, meta={**CAPTIONS, "caption_outcome": "AGE_RESTRICTED"}, age_days=40)
    s["recent_requeue"] = _source(Session, inst, meta={**CAPTIONS, "note": LEGACY_NO_CAPTIONS_NOTE,
                                                        "caption_requeued_at": "2999-01-01T00:00:00+00:00"})
    s["ready"] = _source(Session, inst, state="READY", meta={**CAPTIONS, "note": LEGACY_NO_CAPTIONS_NOTE})
    s["pdf_empty"] = _source(Session, inst, meta={"text_kind": "pdf", "note": LEGACY_NO_CAPTIONS_NOTE})
    return s


SELECTED = {"legacy", "legacy_parser_only", "blocked_failed", "unconfirmed", "old_no_captions"}


def test_selection_marks_and_queues(Session):
    inst = _inst(Session)
    s = _seed(Session, inst)
    with Session() as db:
        dry = caption_requeue.requeue_youtube_caption_lessons(db, institute_id=inst, limit=100, dry_run=True)
    assert dry == {"selected": len(SELECTED), "queued": 0} and _queued(Session, inst) == {}

    with Session() as db:
        got = caption_requeue.requeue_youtube_caption_lessons(db, institute_id=inst, limit=100)
        db.commit()
    assert got == {"selected": len(SELECTED), "queued": len(SELECTED)}
    queued = _queued(Session, inst)
    assert set(queued) == {s[k] for k in SELECTED}
    assert all(v == ("YT_CAPTIONS_RETRY", False) for v in queued.values())
    for k in SELECTED:
        chash, meta = _src(Session, s[k])
        assert chash is None and meta["caption_requeued_at"]
    for k in set(s) - SELECTED:
        chash, meta = _src(Session, s[k])
        assert chash == "h1" and (k == "recent_requeue" or "caption_requeued_at" not in meta)

    # Stamped: nothing is selected again within 24 h.
    with Session() as db:
        again = caption_requeue.requeue_youtube_caption_lessons(db, institute_id=inst, limit=100)
    assert again == {"selected": 0, "queued": 0}


def test_limit_is_respected(Session):
    inst = _inst(Session)
    for _ in range(4):
        _source(Session, inst, meta={**CAPTIONS, "note": LEGACY_NO_CAPTIONS_NOTE})
    with Session() as db:
        got = caption_requeue.requeue_youtube_caption_lessons(db, institute_id=inst, limit=3)
        db.commit()
    assert got["selected"] == 3 and len(_queued(Session, inst)) == 3


def _visible_slide(Session, inst) -> str:
    """A real visible lesson, so the sweep's drift / gone steps leave it alone."""
    with Session() as db:
        return make_course(db, inst, 1).slide_ids[0]


def test_sweep_step_runs_only_with_captions_ok(Session):
    inst = _inst(Session)
    slide = _source(Session, inst, meta={**CAPTIONS, "note": LEGACY_NO_CAPTIONS_NOTE},
                    slide=_visible_slide(Session, inst))
    sweep.run_once(captions_ok=False)
    assert slide not in _queued(Session, inst) and _src(Session, slide)[0] == "h1"
    summary = sweep.run_once(captions_ok=True)
    assert summary["captions"] >= 1 and _queued(Session, inst)[slide] == ("YT_CAPTIONS_RETRY", False)


def test_sweep_step_off_when_requeue_disabled(Session, monkeypatch):
    monkeypatch.setattr(yt_service, "load_config", lambda: Config(requeue_enabled=False))
    inst = _inst(Session)
    slide = _source(Session, inst, meta={**CAPTIONS, "note": LEGACY_NO_CAPTIONS_NOTE},
                    slide=_visible_slide(Session, inst))
    assert sweep.run_once(captions_ok=True)["captions"] == 0 and slide not in _queued(Session, inst)


def test_captions_ok_for_sweep_runs_the_canary_only_when_needed(Session, monkeypatch):
    calls = []

    async def fake_canary(cfg=None):
        calls.append(cfg)
        return True

    monkeypatch.setattr(yt_service, "canary_ok", fake_canary)
    monkeypatch.setattr(caption_requeue, "candidates_exist", lambda: False)
    assert asyncio.run(caption_requeue.captions_ok_for_sweep()) is False and calls == []
    monkeypatch.setattr(caption_requeue, "candidates_exist", lambda: True)
    assert asyncio.run(caption_requeue.captions_ok_for_sweep()) is True and len(calls) == 1
    assert asyncio.run(caption_requeue.captions_ok_for_sweep()) is True and len(calls) == 1   # pass reused
    monkeypatch.setattr(yt_service, "load_config", lambda: Config(canary_video_ids=()))
    caption_requeue._CANARY.update(at=None, ok=False)
    assert asyncio.run(caption_requeue.captions_ok_for_sweep()) is False and len(calls) == 1


def test_candidates_exist_query(Session):
    inst = _inst(Session)
    _source(Session, inst, meta={**CAPTIONS, "note": LEGACY_NO_CAPTIONS_NOTE})
    assert caption_requeue.candidates_exist() is True


def test_run_on_demand(Session):
    inst = _inst(Session)
    slide = _source(Session, inst, meta={**CAPTIONS, "caption_outcome": "TIMEOUT"}, state="FAILED")
    dry = caption_requeue.run_on_demand(institute_id=inst, dry_run=True, limit=10)
    assert dry["selected"] == 1 and dry["queued"] == 0 and slide not in _queued(Session, inst)
    real = caption_requeue.run_on_demand(institute_id=inst, dry_run=False, limit=10)
    assert real["queued"] == 1 and _queued(Session, inst)[slide] == ("YT_CAPTIONS_RETRY", False)
    assert json.dumps(real)


# ── the throttle survives re-indexing; capped with growing gaps ──────────────

def _meta(Session, slide):
    return _src(Session, slide)[1]


def _age_stamp(Session, slide, hours):
    with Session() as db:
        db.execute(text("UPDATE knowledge_base_source SET meta_json = jsonb_set(meta_json, '{caption_requeued_at}', "
                        "to_jsonb(CAST(now() - (CAST(:h AS integer) * interval '1 hour') AS text))) "
                        "WHERE slide_id = :s"), {"h": hours, "s": slide})
        db.commit()


def _requeue(Session, inst):
    with Session() as db:
        got = caption_requeue.requeue_youtube_caption_lessons(db, institute_id=inst, limit=100)
        db.commit()
    return got["selected"]


def _reindex(Session, inst, slide, *, state, via_write=False):
    """What the indexer does after a retry: a NEW meta without the stamp."""
    meta = {**CAPTIONS, "caption_outcome": "BLOCKED", "caption_transient": True, "note": "blocked"}
    with Session() as db:
        kb = store.get_course_kb(db, inst)
        if via_write:
            store.write_slide_index(db, kb=kb, slide_id=slide, title="Video lesson",
                                    fields={"text_kind": "captions", "content_hash": "h2"}, chunks=[],
                                    centroid=None, index_state=state, meta=meta)
        else:
            store.set_source_state(db, kb=kb, slide_id=slide, title="Video lesson", index_state=state,
                                   status="FAILED" if state == "FAILED" else "PENDING", meta=meta,
                                   content_hash="h2")


def test_requeue_throttle_survives_reindex_and_backs_off(Session):
    inst = _inst(Session)
    slide = _source(Session, inst, state="FAILED", meta={**CAPTIONS, "caption_outcome": "BLOCKED",
                                                         "caption_transient": True})
    assert _requeue(Session, inst) == 1 and _meta(Session, slide)["caption_requeues"] == 1

    # The retry ends FAILED-transient again (5 attempts, ~31 min): the stamp stays, so the
    # next 30-minute sweep does not pick it up.
    _reindex(Session, inst, slide, state="FAILED")
    meta = _meta(Session, slide)
    assert meta["caption_requeues"] == 1 and meta["caption_requeued_at"] and meta["caption_outcome"] == "BLOCKED"
    assert _requeue(Session, inst) == 0

    _age_stamp(Session, slide, 25)                      # 1st gap: 24 h
    assert _requeue(Session, inst) == 1 and _meta(Session, slide)["caption_requeues"] == 2

    _reindex(Session, inst, slide, state="EMPTY", via_write=True)   # write_slide_index keeps it too
    assert _meta(Session, slide)["caption_requeues"] == 2
    _age_stamp(Session, slide, 25)                      # 2nd gap: 48 h
    assert _requeue(Session, inst) == 0
    _age_stamp(Session, slide, 49)
    assert _requeue(Session, inst) == 1 and _meta(Session, slide)["caption_requeues"] == 3

    # At MAX_REQUEUES the lesson is left alone, however old the stamp.
    with Session() as db:
        db.execute(text("UPDATE knowledge_base_source SET meta_json = meta_json || "
                        "jsonb_build_object('caption_requeues', CAST(:n AS integer), "
                        "'caption_requeued_at', '2000-01-01T00:00:00+00:00') WHERE slide_id = :s"),
                   {"n": caption_requeue.MAX_REQUEUES, "s": slide})
        db.commit()
    assert _requeue(Session, inst) == 0


def test_ready_reindex_clears_the_requeue_history(Session):
    inst = _inst(Session)
    slide = _source(Session, inst, meta={**CAPTIONS, "note": LEGACY_NO_CAPTIONS_NOTE})
    assert _requeue(Session, inst) == 1
    with Session() as db:
        kb = store.get_course_kb(db, inst)
        store.set_source_state(db, kb=kb, slide_id=slide, title="Video lesson", index_state="READY",
                               status="READY", meta={**CAPTIONS, "caption_outcome": "OK"})
    meta = _meta(Session, slide)
    assert "caption_requeued_at" not in meta and "caption_requeues" not in meta


def test_unconfirmed_no_captions_is_selected(Session):
    inst = _inst(Session)
    slide = _source(Session, inst, meta={**CAPTIONS, "caption_outcome": "NO_CAPTIONS",
                                         "caption_unconfirmed": True})
    assert _requeue(Session, inst) == 1 and slide in _queued(Session, inst)
