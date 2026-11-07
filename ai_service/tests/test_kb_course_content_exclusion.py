"""The generic knowledge-base code must never read the course store.

The course store (V600) is one hidden knowledge_base per institute with
purpose 'course_content' and one SLIDE source per lesson. Its lessons are
drip-, enrolment- and status-gated per learner, and only the course-knowledge
gateway applies those rules, so KbRepository must hide it everywhere a legacy
route or the institute-wide chatbot search could reach it:

  * search_institute_wide, even with purposes=None (or naming it);
  * list_kbs (pickers) and get_kb (every /knowledge-base and /kb-companion
    route 404s);
  * get_source for SLIDE sources.

Two layers: SQL-shape checks on a recording session (always run), and the same
behaviour on a REAL Postgres 16 + pgvector with V435..V600 applied
(course_knowledge_pg_helpers; skipped without AI_LIMITS_PG_URL/AI_LIMITS_PGDATA).
"""
from __future__ import annotations

import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.services.kb.repository import KbRepository  # noqa: E402

MODEL = "google/gemini-embedding-001"


# ── SQL shape (no database) ──────────────────────────────────────────────────

class _Result:
    def fetchall(self):
        return []

    def fetchone(self):
        return None


class _RecordingSession:
    def __init__(self):
        self.sql: list[str] = []

    def execute(self, stmt, params=None):
        self.sql.append(" ".join(str(stmt).split()))
        return _Result()


def _only_sql(call) -> str:
    db = _RecordingSession()
    call(KbRepository(db))
    assert len(db.sql) == 1
    return db.sql[0]


def test_sql_search_institute_wide_excludes_course_content_without_purposes():
    sql = _only_sql(lambda r: r.search_institute_wide(
        institute_id="i", query_embedding=[0.1] * 768, embedding_dim=768))
    assert "kb.purpose <> 'course_content'" in sql
    assert "ANY(:purposes)" not in sql


def test_sql_search_institute_wide_excludes_course_content_with_purposes():
    sql = _only_sql(lambda r: r.search_institute_wide(
        institute_id="i", query_embedding=[0.1] * 768, embedding_dim=768,
        purposes=["course_content"]))
    assert "kb.purpose <> 'course_content'" in sql


@pytest.mark.parametrize("include_archived", [False, True])
def test_sql_list_kbs_excludes_course_content(include_archived):
    sql = _only_sql(lambda r: r.list_kbs("i", include_archived=include_archived))
    assert "kb.purpose <> 'course_content'" in sql


def test_sql_get_kb_excludes_course_content():
    assert "kb.purpose <> 'course_content'" in _only_sql(lambda r: r.get_kb("k", "i"))


def test_sql_get_source_excludes_slide_sources():
    assert "source_kind <> 'SLIDE'" in _only_sql(lambda r: r.get_source("s", "i"))


# ── Real Postgres ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def Session():
    from course_knowledge_pg_helpers import pg_session_factory

    factory = pg_session_factory()
    yield factory
    factory.close()


def _vec(seed: float) -> str:
    return str([seed] * 768)


def _kb(db, institute_id: str, purpose: str) -> str:
    kb_id = db.execute(text(
        "INSERT INTO knowledge_base (institute_id, name, purpose, embedding_model, embedding_dim) "
        "VALUES (:i, :n, :p, :m, 768) RETURNING id"),
        {"i": institute_id, "n": f"KB {purpose}", "p": purpose, "m": MODEL}).scalar_one()
    db.commit()
    return kb_id


def _source(db, kb_id: str, institute_id: str, kind: str, slide_id: str | None = None) -> str:
    sid = db.execute(text(
        "INSERT INTO knowledge_base_source "
        "(knowledge_base_id, institute_id, source_kind, title, status, slide_id) "
        "VALUES (:kb, :i, :k, :t, 'READY', :slide) RETURNING id"),
        {"kb": kb_id, "i": institute_id, "k": kind, "t": f"{kind} source", "slide": slide_id},
    ).scalar_one()
    db.commit()
    return sid


def _chunk(db, kb_id: str, source_id: str, institute_id: str, body: str) -> str:
    # The vector goes in embedding_768 on purpose, even for the course chunk:
    # the purpose filter must hold even if a course vector were mis-written to
    # the legacy column (V600 keeps course vectors in embedding_768_scoped).
    cid = db.execute(text(
        "INSERT INTO kb_chunk (knowledge_base_id, source_id, institute_id, content_text, "
        "embedding_model, embedding_dim, embedding_768) "
        "VALUES (:kb, :s, :i, :c, :m, 768, CAST(:v AS vector)) RETURNING id"),
        {"kb": kb_id, "s": source_id, "i": institute_id, "c": body, "m": MODEL, "v": _vec(0.1)},
    ).scalar_one()
    db.commit()
    return cid


@pytest.fixture(scope="module")
def world(Session):
    institute = f"inst-{uuid.uuid4().hex[:8]}"
    with Session() as db:
        general = _kb(db, institute, "general")
        course = _kb(db, institute, "course_content")
        pdf = _source(db, general, institute, "PDF")
        slide = _source(db, course, institute, "SLIDE", slide_id=f"slide-{uuid.uuid4().hex[:8]}")
        general_chunk = _chunk(db, general, pdf, institute, "Library text about osmosis.")
        course_chunk = _chunk(db, course, slide, institute, "Lesson text about osmosis.")
    return {
        "institute": institute, "general": general, "course": course,
        "pdf": pdf, "slide": slide,
        "general_chunk": general_chunk, "course_chunk": course_chunk,
    }


def test_pg_search_institute_wide_never_returns_course_chunks(Session, world):
    with Session() as db:
        repo = KbRepository(db)
        hits = repo.search_institute_wide(
            institute_id=world["institute"], query_embedding=[0.1] * 768,
            embedding_dim=768, top_k=10, similarity_threshold=0.0,
        )
        assert [h["chunk_id"] for h in hits] == [world["general_chunk"]]

        named = repo.search_institute_wide(
            institute_id=world["institute"], query_embedding=[0.1] * 768,
            embedding_dim=768, top_k=10, similarity_threshold=0.0,
            purposes=["course_content"],
        )
        assert named == []


@pytest.mark.parametrize("include_archived", [False, True])
def test_pg_list_kbs_hides_course_content(Session, world, include_archived):
    with Session() as db:
        ids = [kb["id"] for kb in KbRepository(db).list_kbs(
            world["institute"], include_archived=include_archived)]
    assert world["general"] in ids
    assert world["course"] not in ids


def test_pg_get_kb_hides_course_content(Session, world):
    with Session() as db:
        repo = KbRepository(db)
        assert repo.get_kb(world["general"], world["institute"])["id"] == world["general"]
        assert repo.get_kb(world["course"], world["institute"]) is None


def test_pg_get_source_hides_slide_sources(Session, world):
    with Session() as db:
        repo = KbRepository(db)
        assert repo.get_source(world["pdf"], world["institute"])["id"] == world["pdf"]
        assert repo.get_source(world["slide"], world["institute"]) is None
