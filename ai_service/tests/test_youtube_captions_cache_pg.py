"""The caption cache on a REAL Postgres 16 with the real V600 course_extract_cache
and psycopg 3 (course_knowledge_pg_helpers): RETURNING-based upsert, a negative
row never overwriting OK, language keys, the legacy course row, usage rows.

Skipped unless AI_LIMITS_PG_URL or AI_LIMITS_PGDATA is set.
"""
from __future__ import annotations

import json
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import text  # noqa: E402

from app import db as app_db  # noqa: E402
from app.services.youtube_captions import cache  # noqa: E402
from app.services.youtube_captions.types import CaptionResult, CaptionSegment, Outcome  # noqa: E402
from course_knowledge_pg_helpers import pg_session_factory  # noqa: E402


@pytest.fixture(scope="module")
def Session():
    factory = pg_session_factory()
    yield factory
    factory.close()


@pytest.fixture(autouse=True)
def wired(Session, monkeypatch):
    monkeypatch.setattr(app_db, "get_sessionmaker", lambda: Session)


def _vid() -> str:
    return uuid.uuid4().hex[:11]


def ok(vid, text="hello", language="en", kind="manual", route="proxy"):
    return CaptionResult(video_id=vid, outcome=Outcome.OK, route=route, language=language, kind=kind,
                         segments=(CaptionSegment(0, 1500, text), CaptionSegment(1500, 3000, "world")),
                         available=("en:manual", "hi:auto"))


def neg(vid, outcome=Outcome.NO_CAPTIONS):
    return CaptionResult(video_id=vid, outcome=outcome, route="proxy")


def _row(Session, key):
    with Session() as db:
        return db.execute(text("SELECT segments, text_chars, probe FROM course_extract_cache "
                               "WHERE pointer_kind = 'yt_captions' AND pointer_key = :k"), {"k": key}).first()


def test_ok_row_roundtrip_in_course_segment_shape(Session):
    vid = _vid()
    assert cache.write(ok(vid), extra={"bytes": 1234}) is True
    segs, chars, probe = _row(Session, vid)
    assert segs[0] == {"text": "hello", "anchor": "time", "t_start_ms": 0, "t_end_ms": 1500}
    assert chars == len("hello") + len("world")
    assert probe["outcome"] == "OK" and probe["route"] == "proxy" and probe["bytes"] == 1234
    assert probe["lib"] and "expires_at" not in probe and probe["available"] == ["en:manual", "hi:auto"]
    hit = cache.read(vid)
    assert hit.outcome is Outcome.OK and hit.route == "cache" and hit.text == "hello world" and hit.kind == "manual"
    from app.services.course_knowledge.extract.types import Segment
    assert Segment.from_dict(segs[0]).t_end_ms == 1500


def test_negative_never_overwrites_ok_and_ok_overwrites_negative(Session):
    vid = _vid()
    assert cache.write(ok(vid)) is True
    assert cache.write(neg(vid)) is False                     # decided from RETURNING
    assert _row(Session, vid)[2]["outcome"] == "OK"
    vid2 = _vid()
    assert cache.write(neg(vid2)) is True
    assert cache.read(vid2).outcome is Outcome.NO_CAPTIONS
    assert cache.write(ok(vid2, text="now captioned")) is True
    assert cache.read(vid2).text.startswith("now captioned")


def test_negative_rows_expire(Session):
    vid = _vid()
    cache.write(neg(vid, Outcome.PRIVATE))
    probe = _row(Session, vid)[2]
    expires = datetime.fromisoformat(probe["expires_at"])
    assert timedelta(days=2, hours=23) < expires - datetime.now(timezone.utc) <= timedelta(days=3)
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    with Session() as db:
        db.execute(text("UPDATE course_extract_cache SET probe = jsonb_set(probe, '{expires_at}', to_jsonb(CAST(:e AS text))) "
                        "WHERE pointer_kind = 'yt_captions' AND pointer_key = :k"), {"e": past, "k": vid})
        db.commit()
    assert cache.read(vid) is None


def test_transient_is_never_written(Session):
    vid = _vid()
    assert cache.write(CaptionResult(video_id=vid, outcome=Outcome.BLOCKED, transient=True)) is False
    assert cache.write(CaptionResult(video_id=vid, outcome=Outcome.NO_CAPTIONS, transient=True)) is False
    assert _row(Session, vid) is None


def test_language_keys_and_default_row_satisfies_r(Session):
    vid = _vid()
    cache.write(ok(vid, language="hi-IN", kind="auto"))
    hit = cache.read(vid, language="hi")
    assert hit is not None and hit.language == "hi-IN"         # default row in R serves an R request
    assert cache.read(vid, language="en") is None              # different base language: a miss
    cache.write(ok(vid, text="english", language="en"), language="en")
    assert _row(Session, f"{vid}:en") is not None
    assert cache.read(vid, language="en").text.startswith("english")
    cache.write(ok(vid, text="translated", language="ta", kind="translated"), language="ta", strict=True)
    assert _row(Session, f"{vid}:ta:t") is not None and cache.read(vid, language="ta", strict=True) is not None


def test_legacy_course_youtube_row_is_read_for_default_language(Session):
    vid = _vid()
    legacy = [{"text": "legacy window", "anchor": "time", "t_start_ms": 0, "t_end_ms": 60000, "label": "0:00"}]
    with Session() as db:
        db.execute(text("INSERT INTO course_extract_cache (pointer_kind, pointer_key, extractor_version, tier, segments, "
                        "text_chars, probe) VALUES ('youtube', :k, 1, 'FREE', CAST(:s AS jsonb), 13, "
                        "CAST('{\"snippets\": 9}' AS jsonb))"), {"k": vid, "s": json.dumps(legacy)})
        db.commit()
    hit = cache.read(vid)
    assert hit.route == "legacy_cache" and hit.kind == "unknown" and hit.segments[0] == CaptionSegment(0, 60000, "legacy window")
    assert cache.read(vid, language="en") is None              # language requests never use legacy rows


def test_supadata_usage_rows_sum_and_purge(Session):
    with Session() as db:
        db.execute(text("DELETE FROM course_extract_cache WHERE pointer_kind = :k"), {"k": cache.USAGE_KIND})
        db.commit()
    assert cache.supadata_credits_today() == 0
    assert cache.record_supadata_usage(1, "v1", Outcome.OK) is True
    assert cache.record_supadata_usage(3, "v2", Outcome.NO_CAPTIONS) is True
    assert cache.record_supadata_usage(0, "v3", Outcome.OK) is False
    assert cache.supadata_credits_today() == 4
    with Session() as db:     # an 8-day-old row from another day: not today, and purged
        db.execute(text("INSERT INTO course_extract_cache (pointer_kind, pointer_key, extractor_version, tier, probe, "
                        "created_at) VALUES (:k, 'supadata:2026-01-01:old', 1, 'FREE', "
                        "CAST('{\"supadata_credits\": 50}' AS jsonb), now() - interval '8 days')"),
                   {"k": cache.USAGE_KIND})
        db.commit()
    assert cache.supadata_credits_today() == 4
    assert cache.purge_usage() == 1 and cache.supadata_credits_today() == 4


def test_proxy_usage_rows_sum_separately_from_supadata(Session):
    with Session() as db:
        db.execute(text("DELETE FROM course_extract_cache WHERE pointer_kind = :k"), {"k": cache.USAGE_KIND})
        db.commit()
    assert cache.proxy_bytes_today() == 0
    assert cache.record_proxy_usage(400_000, "v1", Outcome.OK) is True
    assert cache.record_proxy_usage(3_000_000_000, "v2", Outcome.BLOCKED) is True     # > int32: BIGINT sum
    assert cache.record_proxy_usage(0, "v3", Outcome.OK) is False
    cache.record_supadata_usage(2, "v4", Outcome.OK)
    assert cache.proxy_bytes_today() == 3_000_400_000 and cache.supadata_credits_today() == 2


def test_unconfirmed_negative_is_never_written(Session):
    vid = _vid()
    res = CaptionResult(video_id=vid, outcome=Outcome.NO_CAPTIONS, route="direct", confirmed=False)
    assert cache.cacheable(res) is False and cache.write(res) is False and _row(Session, vid) is None
