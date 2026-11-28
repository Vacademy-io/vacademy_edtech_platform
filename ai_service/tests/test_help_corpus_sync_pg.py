"""Help-corpus sync against a real Postgres (pgvector): each entry is replaced in
place, two syncs running at once leave one copy of each entry, the up-to-date
check notices stray copies, and an entry whose embedding fails keeps its old text.

Needs AI_LIMITS_PG_URL or AI_LIMITS_PGDATA (see course_knowledge_pg_helpers);
skipped otherwise.
"""
from __future__ import annotations

import asyncio
import os
import sys
from contextlib import contextmanager

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text  # noqa: E402

from app.services import help_corpus_sync as hcs  # noqa: E402
from app.services.assistant_tool_registry import HELP_KNOWLEDGE_INSTITUTE_ID as HELP  # noqa: E402

DIM = 768


@pytest.fixture(scope="module")
def Session():
    from course_knowledge_pg_helpers import pg_session_factory

    factory = pg_session_factory()
    with factory() as db:  # the stub table leaves out the institute column the help rows use
        db.execute(text("ALTER TABLE content_embeddings ADD COLUMN IF NOT EXISTS institute_id VARCHAR(255)"))
        db.commit()
    yield factory
    factory.close()


class FakeEmbedder:
    """One chunk per entry; a vector from the text length. ``fail`` texts get no vector."""

    fail: set = set()
    delay = 0.0

    def __init__(self, *_a, **_k):
        pass

    def chunk_text(self, content):
        return [content]

    async def embed_batch(self, texts, institute_id="default", model=None):
        if self.delay:
            await asyncio.sleep(self.delay)
        return [None if t in self.fail else [float(len(t) % 7) / 10.0] * DIM for t in texts]


@pytest.fixture
def env(Session, monkeypatch):
    @contextmanager
    def db_session():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    class Keys:
        def __init__(self, _db):
            pass

        def resolve_keys(self, **_k):
            return {}

    monkeypatch.setattr(hcs, "db_session", db_session)
    monkeypatch.setattr(hcs, "ApiKeyResolver", Keys)
    monkeypatch.setattr(hcs, "EmbeddingService", FakeEmbedder)
    FakeEmbedder.fail = set()
    FakeEmbedder.delay = 0.0
    with Session() as db:
        db.execute(text("DELETE FROM content_embeddings WHERE source_type = 'help_knowledge'"))
        db.commit()
    return Session


def seed(n, prefix="Article"):
    return [{"id": f"a{i}", "task": f"{prefix} {i}", "content_text": f"{prefix} text {i}"} for i in range(n)]


def rows(Session):
    with Session() as db:
        return db.execute(text(
            "SELECT source_id, content_text, meta_data->>'corpus_version' FROM content_embeddings "
            "WHERE institute_id = :i AND source_type = 'help_knowledge' ORDER BY source_id"
        ), {"i": HELP}).all()


def run(entries, monkeypatch, force=False):
    monkeypatch.setattr(hcs, "load_seed", lambda *a, **k: entries)
    asyncio.run(hcs.sync_help_corpus(force=force))


def test_a_first_sync_stores_one_row_per_entry(env, monkeypatch):
    run(seed(5), monkeypatch)
    got = rows(env)
    assert [r[0] for r in got] == ["a0", "a1", "a2", "a3", "a4"]
    assert len({r[2] for r in got}) == 1


def test_an_unchanged_seed_is_left_alone(env, monkeypatch, caplog):
    run(seed(3), monkeypatch)
    caplog.set_level("INFO")
    run(seed(3), monkeypatch)
    assert "up to date (3 entries" in caplog.text


def test_a_changed_entry_is_replaced_and_a_removed_one_is_dropped(env, monkeypatch):
    run(seed(4), monkeypatch)
    changed = seed(3, prefix="Updated")
    run(changed, monkeypatch)
    got = rows(env)
    assert [(r[0], r[1]) for r in got] == [("a0", "Updated text 0"), ("a1", "Updated text 1"), ("a2", "Updated text 2")]


def test_stray_copies_are_noticed_and_cleaned_up(env, monkeypatch):
    entries = seed(3)
    run(entries, monkeypatch)
    with env() as db:  # a second copy of one entry, as an interrupted older sync could leave
        db.execute(text(
            "INSERT INTO content_embeddings (id, institute_id, source_type, source_id, content_text, chunk_index, "
            "embedding, meta_data) SELECT gen_random_uuid()::text, institute_id, source_type, source_id, content_text, "
            "chunk_index, embedding, meta_data FROM content_embeddings WHERE source_type = 'help_knowledge' "
            "AND source_id = 'a1'"
        ))
        db.commit()
    assert hcs._read_marker()[2] == 1
    run(entries, monkeypatch)
    assert [r[0] for r in rows(env)] == ["a0", "a1", "a2"]


def test_two_syncs_at_once_leave_one_copy_of_each_entry(env, monkeypatch):
    entries = seed(12)
    monkeypatch.setattr(hcs, "load_seed", lambda *a, **k: entries)
    FakeEmbedder.delay = 0.01

    async def both():
        await asyncio.gather(hcs.sync_help_corpus(), hcs.sync_help_corpus())

    asyncio.run(both())
    got = [r[0] for r in rows(env)]
    assert got == sorted(f"a{i}" for i in range(12))


def test_entries_stay_searchable_while_a_sync_runs(env, monkeypatch):
    run(seed(6), monkeypatch)
    seen = []
    real_replace = hcs._replace_entry

    def watching(source_id, chunks, metadata):
        seen.append(len(rows(env)))
        real_replace(source_id, chunks, metadata)

    monkeypatch.setattr(hcs, "_replace_entry", watching)
    run(seed(6, prefix="New"), monkeypatch)
    assert seen and min(seen) == 6


def test_an_entry_without_an_embedding_keeps_its_old_text(env, monkeypatch):
    run(seed(3), monkeypatch)
    new = seed(3, prefix="New")
    FakeEmbedder.fail = {"New text 1"}
    run(new, monkeypatch)
    got = {r[0]: r[1] for r in rows(env)}
    assert got == {"a0": "New text 0", "a1": "Article text 1", "a2": "New text 2"}
    # Mixed versions: the next start syncs again rather than calling it up to date.
    assert hcs._read_marker()[0] is None
