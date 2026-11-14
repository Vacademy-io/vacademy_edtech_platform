"""Kept transcripts ("no clear speech", used anyway) and shadow-mode results,
on a real Postgres + pgvector with the V600 / V602 schema (course_knowledge_pg_helpers)."""
from __future__ import annotations

import asyncio
import sys
import uuid
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import text  # noqa: E402

from app import db as app_db  # noqa: E402
from app.services.course_knowledge import (  # noqa: E402
    billing, coverage, flags, kept_transcript, shadow_events, store,
)
from app.services.course_knowledge.extract import cache, describe, media  # noqa: E402
from app.services.course_knowledge.extract.types import Segment, SlideRef  # noqa: E402
from course_knowledge_pg_helpers import pg_session_factory  # noqa: E402


@pytest.fixture(scope="module")
def Session():
    factory = pg_session_factory()
    yield factory
    factory.close()


@pytest.fixture(autouse=True)
def wired(Session, monkeypatch):
    monkeypatch.setattr(app_db, "get_sessionmaker", lambda: Session)
    monkeypatch.setattr(flags, "available", lambda i: True)


def _inst() -> str:
    return f"inst-{uuid.uuid4().hex[:8]}"


def _ref(slide_id: str, file_id: str) -> SlideRef:
    return SlideRef(slide_id=slide_id, title="Chanting", description="", status="PUBLISHED", source_type="VIDEO",
                    doc_type=None, pointer_kind="file", pointer_key=file_id, length_ms=74 * 60000)


# ── kept transcripts ─────────────────────────────────────────────────────────

def test_a_rejected_transcript_is_kept_and_flagged_not_charged():
    file_id = f"file-{uuid.uuid4().hex[:8]}"
    segs = [Segment(text="om namah shivaya " * 50)]
    ext = asyncio.run(media._hold(_ref("s1", file_id), segs, 74, "openrouter:m", 0.31, {"seconds": 4440}))
    assert ext.status == "EMPTY" and ext.note == media.NO_SPEECH_NOTE and ext.paid_delivered is None
    assert ext.detail == {"kept_transcript": {"units": 74}}
    held = cache.get(media.HELD_POINTER_KIND, file_id)
    assert held is not None and held.probe["units"] == 74 and held.probe["model"] == "openrouter:m"
    assert cache.get("file", file_id) is None              # never read as the lesson's text


def _rejected_lesson(Session, inst, slide_id, file_id, monkeypatch, minutes=10):
    with Session() as db:
        kb = store.ensure_course_kb(db, inst)
        store.set_source_state(db, kb=kb, slide_id=slide_id, title="Chanting", index_state="EMPTY", status="READY",
                               meta={"note": media.NO_SPEECH_NOTE, "kept_transcript": {"units": minutes}})
    asyncio.run(media._hold(_ref(slide_id, file_id), [Segment(text="hari om tat sat " * 80)], minutes,
                            "openrouter:m", 0.05, {}))
    monkeypatch.setattr(describe, "describe_slides", lambda db, ids: [_ref(i, file_id) for i in ids])
    monkeypatch.setattr(billing, "quote_credits", lambda db, i, tool, units: Decimal(units) / 2)
    return kb


def test_find_prices_the_kept_transcript_and_use_charges_once(Session, monkeypatch):
    inst, slide, file_id = _inst(), "s-kept", f"file-{uuid.uuid4().hex[:8]}"
    kb = _rejected_lesson(Session, inst, slide, file_id, monkeypatch)
    charges = []

    def fake_charge(delivered, **kw):
        charges.append((delivered.idempotency_key, delivered.units, kw.get("manual")))
        return Decimal("5")

    monkeypatch.setattr(billing, "charge", fake_charge)
    with Session() as db:
        kept = kept_transcript.find(db, inst, slide)
    assert kept is not None and kept.units == 10 and kept.credits == Decimal("5") and kept.words == 320
    assert kept.to_dict()["preview"].startswith("hari om")

    assert kept_transcript.use(inst, kept, "admin-1") == Decimal("5")
    assert charges == [(f"course_kb_transcribe:{inst}:{file_id}", 10, True)]
    hit = cache.get("file", file_id)
    assert hit is not None and hit.tier == "PAID" and hit.probe.get("kept") is True
    with Session() as db:
        src = store.get_source(db, kb.id, slide)
        assert src.credits_charged == Decimal("5")
        row = db.execute(text("SELECT status, reason FROM content_index_queue WHERE institute_id = :i "
                              "AND slide_id = :s"), {"i": inst, "s": slide}).fetchone()
        assert tuple(row) == ("PENDING", kept_transcript.REASON)


def test_use_again_after_the_ledger_has_the_charge_does_not_add_credits(Session, monkeypatch):
    inst, slide, file_id = _inst(), "s-twice", f"file-{uuid.uuid4().hex[:8]}"
    kb = _rejected_lesson(Session, inst, slide, file_id, monkeypatch)
    monkeypatch.setattr(billing, "charge", lambda d, **kw: Decimal("5"))
    with Session() as db:
        kept = kept_transcript.find(db, inst, slide)
    kept_transcript.use(inst, kept, "admin-1")
    monkeypatch.setattr(billing, "ledger_charge", lambda db, key: (True, Decimal("5")))
    kept_transcript.use(inst, kept, "admin-1")
    with Session() as db:
        assert store.get_source(db, kb.id, slide).credits_charged == Decimal("5")


def test_a_failed_charge_changes_nothing(Session, monkeypatch):
    inst, slide, file_id = _inst(), "s-nocharge", f"file-{uuid.uuid4().hex[:8]}"
    _rejected_lesson(Session, inst, slide, file_id, monkeypatch)
    monkeypatch.setattr(billing, "charge", lambda d, **kw: None)
    with Session() as db:
        kept = kept_transcript.find(db, inst, slide)
    with pytest.raises(kept_transcript.KeptError):
        kept_transcript.use(inst, kept, "admin-1")
    assert cache.get("file", file_id) is None


def test_find_is_none_for_a_lesson_that_was_read(Session, monkeypatch):
    inst, slide, file_id = _inst(), "s-read", f"file-{uuid.uuid4().hex[:8]}"
    kb = _rejected_lesson(Session, inst, slide, file_id, monkeypatch)
    with Session() as db:
        store.set_source_state(db, kb=kb, slide_id=slide, title="Chanting", index_state="READY", status="READY",
                               meta={"note": None})
        assert kept_transcript.find(db, inst, slide) is None


def test_coverage_offers_the_kept_transcript_with_its_price():
    src = store.SourceRow(id="x", slide_id="s", title="t", content_hash=None, index_state="EMPTY", status="READY", chunk_count=0,
                          meta_json={"note": media.NO_SPEECH_NOTE, "kept_transcript": {"units": 74}},
                          credits_charged=Decimal("0"), is_active=True, updated_at=None)
    lesson = coverage.LessonCoverage(slide_id="s", title="t", chapter_id=None, chapter_name=None,
                                     source_type="VIDEO", doc_type=None, state=coverage.STATE_NOT_SCANNED)
    coverage._from_source(lesson, src)
    assert lesson.state == coverage.STATE_CANT_READ and lesson.kept_minutes == 74
    lesson.kept_credits = Decimal("37")
    assert lesson.to_dict()["kept_transcript"] == {"minutes": 74, "credits": 37}


# ── shadow results ───────────────────────────────────────────────────────────

def test_shadow_results_survive_and_summarise(Session):
    inst = _inst()
    for ms, hits in ((120, 3), (180, 0), (240, 2), (900, 1)):
        assert shadow_events.record(institute_id=inst, session_id="sess-1", open_lessons=39, hits=hits,
                                    top_similarity=0.61 if hits else None, latency_ms=ms - 20, total_ms=ms)
    shadow_events.record(institute_id=inst, session_id="sess-2", total_ms=5, error="no_lessons")
    with Session() as db:
        out = shadow_events.summary(db, inst, hours=24)
    assert out["turns"] == 5 and out["sessions"] == 2 and out["turns_with_hits"] == 3
    assert out["turns_with_no_open_lessons"] == 1 and out["errors"] == 0 and out["leak_blocked"] == 0
    assert out["hit_rate"] == 0.6 and out["total_ms_p95"] > 400 and out["meets_latency_bar"] is False
    with Session() as db:
        empty = shadow_events.summary(db, _inst())
    assert empty["turns"] == 0 and empty["hit_rate"] is None and empty["meets_latency_bar"] is None


def test_old_shadow_results_are_purged(Session):
    inst = _inst()
    shadow_events.record(institute_id=inst, session_id="old", total_ms=10)
    shadow_events.record(institute_id=inst, session_id="new", total_ms=10)
    with Session() as db:
        db.execute(text("UPDATE course_knowledge_shadow_event SET created_at = now() - interval '31 days' "
                        "WHERE institute_id = :i AND session_id = 'old'"), {"i": inst})
        db.commit()
        assert shadow_events.purge(db) >= 1
        db.commit()
        left = db.execute(text("SELECT session_id FROM course_knowledge_shadow_event WHERE institute_id = :i"),
                          {"i": inst}).scalars().all()
    assert left == ["new"]


def test_record_never_raises_without_the_table(monkeypatch):
    class _Broken:
        def __enter__(self):
            raise RuntimeError('relation "course_knowledge_shadow_event" does not exist')

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(shadow_events, "db_session", lambda: _Broken())
    assert shadow_events.record(institute_id="i", session_id="s") is False
