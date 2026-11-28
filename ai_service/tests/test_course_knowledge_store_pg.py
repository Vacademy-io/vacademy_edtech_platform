"""course_knowledge/store.py on a REAL Postgres 16 + pgvector, with the real
V435/V443/V445/V517/V600 migrations (course_knowledge_pg_helpers) and psycopg 3.

What must hold:
  * concurrent ensure_course_kb calls create ONE course KB;
  * write_slide_index replaces a lesson's chunks atomically (a failing write
    keeps the old index) and stores embedding_768 NULL;
  * the legacy readers (KbRepository.search_institute_wide with purposes=None,
    search_chunks) never return course chunks;
  * exact_scan is bounded by both the source ids and the institute;
  * tombstone_slide / delete_course_kb cascade to chunks.

Needs a Postgres: set AI_LIMITS_PG_URL or AI_LIMITS_PGDATA (see the helper).
Skipped otherwise. Run from the repo root:
  AI_LIMITS_PGDATA=<dir> <venv>/bin/python -m pytest ai_service/tests/test_course_knowledge_store_pg.py -q
"""
from __future__ import annotations

import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.exc import DBAPIError  # noqa: E402

from app.services.course_knowledge import store  # noqa: E402
from app.services.kb.repository import ChunkToStore, KbRepository  # noqa: E402
from course_knowledge_pg_helpers import pg_session_factory  # noqa: E402

DIM = 768


@pytest.fixture(scope="module")
def Session():
    factory = pg_session_factory()
    yield factory
    factory.close()


def _inst() -> str:
    return f"inst-{uuid.uuid4().hex[:8]}"


def _slide() -> str:
    return str(uuid.uuid4())


def vec(i: int) -> list:
    """A distinct, non-zero 768-dim direction per i."""
    v = [0.01] * DIM
    v[i % DIM] = 1.0
    return v


def chunks_for(n: int, base: int = 0, **extra) -> list:
    return [
        store.CourseChunk(
            content_text=f"chunk {base + k} text", chunk_index=k, embedding=vec(base + k),
            meta_data={"slide_part": k}, **extra,
        )
        for k in range(n)
    ]


def write(db, kb, slide_id, n, base=0, index_state="READY", **kw):
    return store.write_slide_index(
        db, kb=kb, slide_id=slide_id, title=f"Lesson {slide_id[:6]}",
        fields=kw.pop("fields", {"text_kind": "html", "content_hash": f"h-{base}"}),
        chunks=kw.pop("chunks", None) or chunks_for(n, base),
        centroid=vec(base) if n else None, index_state=index_state, meta={"text_kind": "html"},
    )


def chunk_rows(db, source_id):
    return db.execute(
        text(
            "SELECT content_text, embedding_768 IS NULL, embedding_768_scoped IS NOT NULL, "
            "embedding_dim, institute_id FROM kb_chunk WHERE source_id = :s ORDER BY chunk_index"
        ),
        {"s": source_id},
    ).fetchall()


# ----------------------------------------------------------------------
# ensure_course_kb
# ----------------------------------------------------------------------
def test_concurrent_ensure_course_kb_creates_one(Session):
    inst = _inst()
    n = 8
    barrier = threading.Barrier(n)

    def worker(_):
        db = Session()
        try:
            barrier.wait(timeout=10)
            return store.ensure_course_kb(db, inst).id
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=n) as pool:
        ids = list(pool.map(worker, range(n)))
    assert len(set(ids)) == 1

    with Session() as db:
        rows = db.execute(
            text(
                "SELECT id, name, purpose, embedding_model, embedding_dim, owner_type, meta_json "
                "FROM knowledge_base WHERE institute_id = :i"
            ),
            {"i": inst},
        ).fetchall()
        assert len(rows) == 1
        r = rows[0]
        assert r[0] == ids[0]
        assert r[1] == "Course content (system)"
        assert r[2] == "course_content"
        assert (r[3], r[4]) == ("google/gemini-embedding-001", 768)
        assert r[5] == "INSTITUTE"
        assert r[6] == {"system": True}
        kb = store.get_course_kb(db, inst)
        assert kb == store.CourseKb(ids[0], inst, "google/gemini-embedding-001", 768)
        assert store.get_course_kb(db, _inst()) is None


def test_ensure_course_kb_rejects_non_768(Session):
    inst = _inst()
    with Session() as db:
        db.execute(
            text(
                "INSERT INTO kb_embedding_model (model_id, dim, vector_column, provider, is_default) "
                "VALUES ('test/wide-1024', 1024, 'embedding_1024', 'test', FALSE) "
                "ON CONFLICT (model_id) DO NOTHING"
            )
        )
        db.execute(
            text(
                "INSERT INTO knowledge_base (institute_id, name, purpose, embedding_model, embedding_dim) "
                "VALUES (:i, 'wide', 'course_content', 'test/wide-1024', 1024)"
            ),
            {"i": inst},
        )
        db.commit()
        with pytest.raises(ValueError):
            store.ensure_course_kb(db, inst)


# ----------------------------------------------------------------------
# write_slide_index
# ----------------------------------------------------------------------
def test_write_slide_index_replaces_chunks_atomically(Session):
    inst = _inst()
    slide = _slide()
    with Session() as db:
        kb = store.ensure_course_kb(db, inst)
        sid = write(db, kb, slide, 3, base=0)
        rows = chunk_rows(db, sid)
        assert [r[0] for r in rows] == ["chunk 0 text", "chunk 1 text", "chunk 2 text"]
        assert all(r[1] and r[2] and r[3] == 768 and r[4] == inst for r in rows)
        src = store.get_source(db, kb.id, slide)
        assert (src.id, src.chunk_count, src.status, src.index_state) == (sid, 3, "READY", "READY")
        assert src.content_hash == "h-0"
        assert src.meta_json == {"text_kind": "html"}

        # Re-index with fewer chunks: same source row, old chunks gone.
        assert write(db, kb, slide, 2, base=10, index_state="NEEDS_PROCESSING") == sid
        rows = chunk_rows(db, sid)
        assert [r[0] for r in rows] == ["chunk 10 text", "chunk 11 text"]
        assert all(r[1] and r[2] for r in rows)
        src = store.get_source(db, kb.id, slide)
        assert (src.chunk_count, src.status, src.index_state) == (2, "PARTIAL", "NEEDS_PROCESSING")
        assert src.content_hash == "h-10"

        # A write that fails inside the transaction (after the DELETE ran)
        # keeps the previous index whole.
        bad = chunks_for(2, base=20)
        bad[1].page_start = "not-a-number"
        with pytest.raises(DBAPIError):
            write(db, kb, slide, 2, base=20, chunks=bad)
        rows = chunk_rows(db, sid)
        assert [r[0] for r in rows] == ["chunk 10 text", "chunk 11 text"]
        src = store.get_source(db, kb.id, slide)
        assert (src.chunk_count, src.content_hash) == (2, "h-10")

        # Validation errors stop before any statement.
        with pytest.raises(ValueError):
            write(db, kb, slide, 1, chunks=[store.CourseChunk("x", 0, embedding=[0.1] * 10)])
        with pytest.raises(ValueError):
            write(db, kb, slide, 1, chunks=[store.CourseChunk("x", 0, embedding=None)])
        assert store.get_source(db, kb.id, slide).chunk_count == 2


def test_write_slide_index_fields_status_and_dict_chunks(Session):
    inst = _inst()
    slide = _slide()
    with Session() as db:
        kb = store.ensure_course_kb(db, inst)
        # No chunks: status as given.
        sid = write(db, kb, slide, 0, index_state="FAILED",
                    fields={"status": "FAILED", "content_hash": "h"}, chunks=[])
        src = store.get_source(db, kb.id, slide)
        assert (src.id, src.status, src.chunk_count) == (sid, "FAILED", 0)

        # ChunkToStore objects and dicts are both accepted; pages and fields stored.
        mixed = [
            ChunkToStore(content_text="page one", chunk_index=0, embedding=vec(1),
                         page_start=1, page_end=1, lang="en", meta_data={"label": "p1"}),
            {"content_text": "page two", "chunk_index": 1, "embedding": vec(2),
             "page_start": 2, "page_end": 3, "meta_data": {"label": "p2"}},
        ]
        store.write_slide_index(
            db, kb=kb, slide_id=slide, title="  " + "T" * 600, chunks=mixed, centroid=vec(1),
            fields={"file_id": "file-1", "text_kind": "pdf_text", "page_count": 3,
                    "ocr_pages": 1, "credits_charged": "1.50", "content_hash": "h2"},
            index_state="EMPTY", meta={"note": "n"},
        )
        r = db.execute(
            text(
                "SELECT title, file_id, parser, page_count, ocr_pages, credits_charged, status, "
                "source_kind, institute_id, centroid_768 IS NOT NULL FROM knowledge_base_source "
                "WHERE id = :s"
            ),
            {"s": sid},
        ).fetchone()
        assert len(r[0]) == 500
        assert r[1:5] == ("file-1", "pdf_text", 3, 1)
        assert float(r[5]) == 1.5
        assert r[6:] == ("READY", "SLIDE", inst, True)
        pages = db.execute(
            text("SELECT page_start, page_end, lang, meta_data FROM kb_chunk WHERE source_id = :s "
                 "ORDER BY chunk_index"),
            {"s": sid},
        ).fetchall()
        assert [tuple(p) for p in pages] == [(1, 1, "en", {"label": "p1"}), (2, 3, None, {"label": "p2"})]

        # credits_charged omitted keeps the stored total.
        write(db, kb, slide, 1, base=5)
        assert store.get_source(db, kb.id, slide).credits_charged == pytest.approx(1.5)

        # More than MAX_CHUNKS_PER_SLIDE are capped.
        many = chunks_for(store.MAX_CHUNKS_PER_SLIDE + 3)
        write(db, kb, slide, 1, chunks=many)
        assert store.get_source(db, kb.id, slide).chunk_count == store.MAX_CHUNKS_PER_SLIDE
        assert store.institute_chunk_total(db, kb.id) == store.MAX_CHUNKS_PER_SLIDE


def test_set_source_state_keeps_chunks(Session):
    inst = _inst()
    slide = _slide()
    with Session() as db:
        kb = store.ensure_course_kb(db, inst)
        sid = write(db, kb, slide, 2, base=30)
        assert store.set_source_state(
            db, kb=kb, slide_id=slide, title="Lesson", index_state="PENDING", status="PENDING",
            meta={"note": "transcribing"},
        ) == sid
        src = store.get_source(db, kb.id, slide)
        assert (src.index_state, src.status, src.chunk_count) == ("PENDING", "PENDING", 2)
        assert src.content_hash == "h-30"  # None keeps the stored hash
        assert src.meta_json == {"note": "transcribing"}
        assert len(chunk_rows(db, sid)) == 2

        fresh = _slide()
        new_id = store.set_source_state(
            db, kb=kb, slide_id=fresh, title="", index_state="UNSUPPORTED", status="FAILED",
            meta={}, content_hash="hx",
        )
        src = store.get_source(db, kb.id, fresh)
        assert (src.id, src.content_hash, src.chunk_count, src.title) == (new_id, "hx", 0, f"Lesson {fresh}")
        with pytest.raises(ValueError):
            store.set_source_state(db, kb=kb, slide_id=fresh, title="x", index_state="BOGUS",
                                   status="PENDING", meta={})


# ----------------------------------------------------------------------
# legacy readers are blind to course chunks
# ----------------------------------------------------------------------
def test_legacy_readers_never_return_course_chunks(Session):
    inst = _inst()
    q = vec(40)
    with Session() as db:
        kb = store.ensure_course_kb(db, inst)
        course_sid = write(db, kb, _slide(), 1, base=40)

        repo = KbRepository(db)
        general = repo.create_kb(institute_id=inst, name="Notes", description=None,
                                 purpose="general", language_hint=None, created_by=None)
        legacy_sid = repo.create_source(kb_id=general["id"], institute_id=inst, source_kind="TEXT",
                                        title="Legacy", raw_text="legacy")
        stored = repo.insert_chunks(
            kb_id=general["id"], institute_id=inst, source_id=legacy_sid,
            chunks=[ChunkToStore(content_text="legacy chunk", chunk_index=0, embedding=vec(40))],
            model=repo.get_default_embedding_model(),
        )
        assert stored == 1

        wide = repo.search_institute_wide(institute_id=inst, query_embedding=q, embedding_dim=768,
                                          top_k=50, similarity_threshold=-1.0, purposes=None)
        assert [h["content_text"] for h in wide] == ["legacy chunk"]
        assert all(h["source_id"] != course_sid for h in wide)

        in_course_kb = repo.search_chunks(kb_id=kb.id, institute_id=inst, query_embedding=q,
                                          embedding_dim=768, top_k=50, similarity_threshold=-1.0)
        assert in_course_kb == []
        with_sources = repo.search_chunks(kb_id=kb.id, institute_id=inst, query_embedding=q,
                                          embedding_dim=768, top_k=50, similarity_threshold=-1.0,
                                          source_ids=[course_sid])
        assert with_sources == []


# ----------------------------------------------------------------------
# retrieval reads
# ----------------------------------------------------------------------
def test_exact_scan_respects_source_ids_and_institute(Session):
    inst_a, inst_b = _inst(), _inst()
    s1, s2, s3 = _slide(), _slide(), _slide()
    with Session() as db:
        kb_a = store.ensure_course_kb(db, inst_a)
        kb_b = store.ensure_course_kb(db, inst_b)
        src1 = write(db, kb_a, s1, 2, base=100)
        src2 = write(db, kb_a, s2, 2, base=110)
        src3 = write(db, kb_b, s3, 2, base=100)

        hits = store.exact_scan(db, kb=kb_a, source_ids=[src1], qvec=vec(100), floor=-1.0, limit=50)
        assert {h.source_id for h in hits} == {src1}
        assert {h.slide_id for h in hits} == {s1}
        assert hits[0].similarity > hits[-1].similarity
        assert hits[0].similarity == pytest.approx(1.0, abs=1e-4)
        assert not hasattr(hits[0], "content_text")
        assert hits[0].meta == {"slide_part": 0}

        both = store.exact_scan(db, kb=kb_a, source_ids=[src1, src2], qvec=vec(110), floor=-1.0, limit=50)
        assert {h.slide_id for h in both} == {s1, s2}
        assert both[0].slide_id == s2

        # Another institute's source id through this institute's KB: nothing.
        assert store.exact_scan(db, kb=kb_a, source_ids=[src3], qvec=vec(100), floor=-1.0, limit=50) == []
        # This KB's id with another institute: nothing.
        forged = store.CourseKb(kb_a.id, inst_b, kb_a.embedding_model, 768)
        assert store.exact_scan(db, kb=forged, source_ids=[src1, src2, src3], qvec=vec(100),
                                floor=-1.0, limit=50) == []
        # Floor and limit apply; another embedding model matches nothing.
        assert len(store.exact_scan(db, kb=kb_a, source_ids=[src1, src2], qvec=vec(100),
                                    floor=0.9, limit=50)) == 1
        assert len(store.exact_scan(db, kb=kb_a, source_ids=[src1, src2], qvec=vec(100),
                                    floor=-1.0, limit=3)) == 3
        other_model = store.CourseKb(kb_a.id, inst_a, "test/other", 768)
        assert store.exact_scan(db, kb=other_model, source_ids=[src1], qvec=vec(100),
                                floor=-1.0, limit=50) == []
        # Inactive sources drop out.
        db.execute(text("UPDATE knowledge_base_source SET is_active = FALSE WHERE id = :s"), {"s": src2})
        db.commit()
        assert {h.slide_id for h in store.exact_scan(db, kb=kb_a, source_ids=[src1, src2],
                                                     qvec=vec(110), floor=-1.0, limit=50)} == {s1}
        assert store.candidate_stats(db, kb_a.id, inst_a, [s1, s2, s3]) == {s1: (src1, 2)}
        db.execute(text("UPDATE knowledge_base_source SET is_active = TRUE WHERE id = :s"), {"s": src2})
        db.commit()

        texts = store.fetch_texts(db, [h.chunk_id for h in hits])
        assert sorted(texts.values()) == ["chunk 100 text", "chunk 101 text"]
        assert store.fetch_texts(db, []) == {}


def test_candidate_stats_shortlist_and_coverage(Session):
    inst = _inst()
    s1, s2, s3, empty = _slide(), _slide(), _slide(), _slide()
    with Session() as db:
        kb = store.ensure_course_kb(db, inst)
        src1 = write(db, kb, s1, 3, base=200)
        src2 = write(db, kb, s2, 1, base=300)
        src3 = write(db, kb, s3, 2, base=400)
        store.set_source_state(db, kb=kb, slide_id=empty, title="e", index_state="PENDING",
                               status="PENDING", meta={})

        stats = store.candidate_stats(db, kb.id, inst, [s1, s2, s3, empty, _slide()])
        assert stats == {s1: (src1, 3), s2: (src2, 1), s3: (src3, 2)}
        assert store.candidate_stats(db, kb.id, _inst(), [s1]) == {}
        assert store.candidate_stats(db, kb.id, inst, []) == {}

        top2 = store.centroid_shortlist(db, kb.id, inst, [s1, s2, s3, empty], vec(300), 2)
        assert len(top2) == 2 and top2[0] == s2 and empty not in top2
        assert store.centroid_shortlist(db, kb.id, inst, [s1, s2, s3], vec(400), 1) == [s3]
        assert store.centroid_shortlist(db, kb.id, _inst(), [s1, s2, s3], vec(400), 5) == []

        cov = store.coverage_rows(db, kb.id, [s1, empty, _slide()])
        assert set(cov) == {s1, empty}
        assert cov[s1].chunk_count == 3 and cov[empty].index_state == "PENDING"
        assert store.institute_chunk_total(db, kb.id) == 6


# ----------------------------------------------------------------------
# tombstone + delete
# ----------------------------------------------------------------------
def test_tombstone_slide_cascades_to_chunks(Session):
    inst = _inst()
    slide, keep = _slide(), _slide()
    with Session() as db:
        kb = store.ensure_course_kb(db, inst)
        sid = write(db, kb, slide, 3, base=500)
        keep_sid = write(db, kb, keep, 1, base=510)
        assert len(chunk_rows(db, sid)) == 3

        assert store.tombstone_slide(db, kb_id=kb.id, slide_id=slide) is True
        assert chunk_rows(db, sid) == []
        assert store.get_source(db, kb.id, slide) is None
        assert len(chunk_rows(db, keep_sid)) == 1
        assert store.tombstone_slide(db, kb_id=kb.id, slide_id=slide) is False
        # Another KB's id never deletes this institute's lesson.
        assert store.tombstone_slide(db, kb_id=str(uuid.uuid4()), slide_id=keep) is False
        assert store.get_source(db, kb.id, keep) is not None


def test_delete_course_kb_cascades(Session):
    inst = _inst()
    with Session() as db:
        kb = store.ensure_course_kb(db, inst)
        sid = write(db, kb, _slide(), 2, base=600)
        assert store.delete_course_kb(db, inst) is True
        assert store.get_course_kb(db, inst) is None
        assert chunk_rows(db, sid) == []
        assert db.execute(text("SELECT count(*) FROM knowledge_base_source WHERE id = :s"),
                          {"s": sid}).scalar() == 0
        assert store.delete_course_kb(db, inst) is False
