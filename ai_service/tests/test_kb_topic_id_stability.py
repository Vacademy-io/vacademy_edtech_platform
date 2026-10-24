"""Stable topic node ids behind the platform setting kb.stable_topic_ids.

With the flag ON, KbRepository.replace_topic_tree matches the new tree against
the stored one, upserts, then prunes (subtopics before topics), in one
transaction. What must hold:

  * rebuilding an identical tree keeps every id, and kb_chunk.node_id survives;
  * inserting a heading keeps every other id (heading trees and AUTHORED trees,
    including ids stored by the old position-based authored scheme);
  * a lightly renamed LLM topic keeps its id by keyword Jaccard >= 0.5, a
    rewritten one does not;
  * a re-parented subtopic survives its old parent's deletion;
  * no stored id is handed to two nodes;
  * with the flag OFF the old delete-and-re-insert path runs unchanged.

Tree writes run on a REAL Postgres 16 + pgvector with V435..V600 applied
(course_knowledge_pg_helpers; skipped without AI_LIMITS_PG_URL/AI_LIMITS_PGDATA).
The id planner, the normaliser, the flag reader and the authored builder are
also checked without a database.
"""
from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.services.kb import repository as kb_repository  # noqa: E402
from app.services.kb import topics as kb_topics  # noqa: E402
from app.services.kb.repository import (  # noqa: E402
    KbRepository,
    _ExistingTopicNode,
    normalize_topic_title,
    plan_topic_node_ids,
    stable_topic_ids_enabled,
)
from app.services.kb.topics import TopicNode, build_authored_tree  # noqa: E402

MODEL = "google/gemini-embedding-001"


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setattr(kb_repository, "stable_topic_ids_enabled", lambda: True)
    monkeypatch.setattr(kb_topics, "stable_topic_ids_enabled", lambda: True)


@pytest.fixture
def flag_off(monkeypatch):
    monkeypatch.setattr(kb_repository, "stable_topic_ids_enabled", lambda: False)
    monkeypatch.setattr(kb_topics, "stable_topic_ids_enabled", lambda: False)


def T(title, subs=(), keywords=(), id=None, source_id=None, summary=None):
    """A TopicNode; `subs` are titles, (title, keywords) pairs or TopicNodes."""
    node = TopicNode(title=title, keywords=list(keywords), id=id, source_id=source_id,
                     summary=summary)
    for s in subs:
        if isinstance(s, TopicNode):
            node.subtopics.append(s)
        elif isinstance(s, tuple):
            node.subtopics.append(TopicNode(title=s[0], keywords=list(s[1])))
        else:
            node.subtopics.append(TopicNode(title=s))
    return node


# ── No database ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw, norm", [
    ("1.2 Nature of Matter", "nature of matter"),
    ("1.2. Nature of Matter", "nature of matter"),
    ("Chapter 3: Classification of Elements", "classification of elements"),
    ("Unit IV - Motion", "motion"),
    ("2) Forces", "forces"),
    ("  Newton’s   Laws!  ", "newton s laws"),
    ("Ｏｐｔｉｃｓ", "optics"),   # full-width (NFKC)
    ("Did you know?", "did you know"),                     # not a roman numeral
    ("3D Geometry", "3d geometry"),
    ("1.2", "1.2"),                                        # numbering only: kept
])
def test_normalize_topic_title(raw, norm):
    assert normalize_topic_title(raw) == norm


def test_flag_reader_is_false_on_settings_error(monkeypatch):
    from app.services import platform_settings_service as pss

    def boom(*_a, **_k):
        raise RuntimeError("settings down")

    monkeypatch.setattr(pss, "get_platform_setting", boom)
    assert stable_topic_ids_enabled() is False


@pytest.mark.parametrize("value, expected", [
    (True, True), (False, False), ("true", True), ("false", False), (None, False),
])
def test_flag_reader_values(monkeypatch, value, expected):
    from app.services import platform_settings_service as pss

    monkeypatch.setattr(pss, "get_platform_setting", lambda *_a, **_k: value)
    assert stable_topic_ids_enabled() is expected


def test_flag_default_is_off():
    from app.services.platform_settings_service import SETTING_SPECS

    assert SETTING_SPECS["kb.stable_topic_ids"].default() is False


def _ids(planned):
    return [p.id for tp in planned for p in [tp, *tp.children]]


def test_plan_never_reuses_one_old_id_twice():
    old = [_ExistingTopicNode("old-optics", None, "topic", None, "Optics", ["lens"])]
    planned = plan_topic_node_ids("kb", old, [T("Optics", keywords=["lens"]),
                                              T("Optics", keywords=["lens"])])
    ids = _ids(planned)
    assert ids[0] == "old-optics"
    assert ids[1] != "old-optics"
    assert len(set(ids)) == 2


def test_plan_mints_distinct_deterministic_ids_for_duplicates():
    tree = lambda: [T("Waves", subs=["Sound", "Sound"]), T("Waves")]  # noqa: E731
    first = _ids(plan_topic_node_ids("kb", [], tree()))
    again = _ids(plan_topic_node_ids("kb", [], tree()))
    assert len(set(first)) == 4
    assert first == again                     # uuid5 of the normalised path
    assert first != _ids(plan_topic_node_ids("other-kb", [], tree()))


def test_plan_exact_match_wins_over_an_earlier_fuzzy_candidate():
    old = [
        _ExistingTopicNode("id-a", None, "topic", None, "Acids", ["acid", "base", "ph"]),
        _ExistingTopicNode("id-b", None, "topic", None, "Bases", ["acid", "base", "ph"]),
    ]
    # "Acids and Bases" would fuzzy-match id-a; "Acids" (later in the list)
    # matches id-a exactly and must keep it.
    planned = plan_topic_node_ids("kb", old, [
        T("Acids and Bases", keywords=["acid", "base", "ph"]),
        T("Acids", keywords=["acid", "base", "ph"]),
    ])
    assert _ids(planned)[1] == "id-a"
    assert _ids(planned)[0] == "id-b"         # the only fuzzy candidate left


def test_plan_authored_trees_never_fuzzy_match():
    old = [_ExistingTopicNode("ch1", None, "topic", "src", "Chapter 1: Motion", ["speed"])]
    planned = plan_topic_node_ids("kb", old, [
        T("Chapter 1: Kinematics", keywords=["speed"], id="new-ch1", source_id="src"),
    ])
    assert _ids(planned) == ["new-ch1"]


# Authored builder (no database): a fake repo serving cached headings.

class _FakeAuthoredRepo:
    def __init__(self, headings):
        self.source = {
            "id": "src-1", "title": "Motion", "status": "READY", "is_active": True,
            "page_count": 20, "created_at": "2026-01-01",
            "meta": {"chapter_no": 1, "chapter_title": "Motion", "headings": headings},
        }

    def sources_with_chunks(self, kb_id):
        return ["src-1"]

    def list_sources(self, kb_id):
        return [self.source]


def _headings(*titles):
    return [{"title": t, "page": i + 2, "level": 1} for i, t in enumerate(titles)]


def _authored(headings):
    repo = _FakeAuthoredRepo(headings)
    kb = {"id": "kb-1", "institute_id": "inst-1"}
    return asyncio.run(build_authored_tree(None, repo, kb))


def test_authored_builder_flag_on_ids_ignore_heading_position(flag_on):
    before = _authored(_headings("1.1 Speed", "1.2 Velocity"))[0]
    after = _authored(_headings("1.1 Distance", "1.2 Speed", "1.3 Velocity"))[0]
    ids_before = {s.title.split(" ", 1)[1]: s.id for s in before.subtopics}
    ids_after = {s.title.split(" ", 1)[1]: s.id for s in after.subtopics}
    assert ids_after["Speed"] == ids_before["Speed"]
    assert ids_after["Velocity"] == ids_before["Velocity"]
    assert before.id == after.id


def test_authored_builder_flag_on_repeated_heading_gets_occurrence_suffix(flag_on):
    subs = _authored(_headings("Exercises", "Summary", "Exercises"))[0].subtopics
    assert len({s.id for s in subs}) == 3
    first = _authored(_headings("Exercises"))[0].subtopics[0]
    assert subs[0].id == first.id             # the first occurrence has no suffix


def test_authored_builder_flag_off_keeps_position_ids(flag_off):
    subs = _authored(_headings("Speed", "Velocity"))[0].subtopics
    assert [s.id for s in subs] == [
        kb_topics._node_id("kb-1", "src-1", "0", "Speed"),
        kb_topics._node_id("kb-1", "src-1", "1", "Velocity"),
    ]


# ── Real Postgres ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def Session():
    from course_knowledge_pg_helpers import pg_session_factory

    factory = pg_session_factory()
    yield factory
    factory.close()


@pytest.fixture
def kb(Session):
    institute = f"inst-{uuid.uuid4().hex[:8]}"
    with Session() as db:
        kb_id = db.execute(text(
            "INSERT INTO knowledge_base (institute_id, name, purpose, embedding_model, embedding_dim) "
            "VALUES (:i, 'Physics', 'general', :m, 768) RETURNING id"),
            {"i": institute, "m": MODEL}).scalar_one()
        db.commit()
    return {"id": kb_id, "institute": institute}


def _replace(Session, kb, tree):
    with Session() as db:
        return KbRepository(db).replace_topic_tree(kb["id"], kb["institute"], tree)


def _stored(Session, kb):
    """{(level, title): (id, parent title, ordinal)} of the stored topic tree."""
    with Session() as db:
        rows = db.execute(text(
            "SELECT n.id, n.level, n.title, p.title, n.ordinal FROM knowledge_base_node n "
            "LEFT JOIN knowledge_base_node p ON p.id = n.parent_id "
            "WHERE n.knowledge_base_id = :kb AND n.level IN ('topic', 'subtopic')"),
            {"kb": kb["id"]}).fetchall()
    out = {(r[1], r[2]): (r[0], r[3], r[4]) for r in rows}
    assert len(out) == len(rows), "titles in these fixtures are unique per level"
    return out


def _id_of(stored, level, title):
    return stored[(level, title)][0]


def _source(Session, kb, title):
    with Session() as db:
        sid = db.execute(text(
            "INSERT INTO knowledge_base_source (knowledge_base_id, institute_id, source_kind, title, status) "
            "VALUES (:kb, :i, 'PDF', :t, 'READY') RETURNING id"),
            {"kb": kb["id"], "i": kb["institute"], "t": title}).scalar_one()
        db.commit()
    return sid


def _chunk_on(Session, kb, source_id, node_id):
    with Session() as db:
        cid = db.execute(text(
            "INSERT INTO kb_chunk (knowledge_base_id, source_id, institute_id, content_text, node_id, "
            "embedding_model, embedding_dim, embedding_768) "
            "VALUES (:kb, :s, :i, 'text', :n, :m, 768, CAST(:v AS vector)) RETURNING id"),
            {"kb": kb["id"], "s": source_id, "i": kb["institute"], "n": node_id, "m": MODEL,
             "v": str([0.1] * 768)}).scalar_one()
        db.commit()
    return cid


def _chunk_node(Session, chunk_id):
    with Session() as db:
        return db.execute(text("SELECT node_id FROM kb_chunk WHERE id = :c"),
                          {"c": chunk_id}).scalar_one()


def _llm_tree():
    return [
        T("Electrochemistry", keywords=["cell", "electrode", "emf", "nernst"],
          subs=[("Galvanic cells", ["cell", "salt bridge"]), ("Electrolysis", ["faraday"])]),
        T("Kinetics", keywords=["rate", "order", "arrhenius"],
          subs=[("Rate laws", ["rate", "order"])]),
    ]


def test_identical_rebuild_keeps_every_id_and_chunk_links(Session, kb, flag_on):
    assert _replace(Session, kb, _llm_tree()) == 5
    before = _stored(Session, kb)
    src = _source(Session, kb, "Book")
    chunk = _chunk_on(Session, kb, src, _id_of(before, "subtopic", "Galvanic cells"))

    assert _replace(Session, kb, _llm_tree()) == 5
    after = _stored(Session, kb)
    assert after == before
    assert _chunk_node(Session, chunk) == _id_of(before, "subtopic", "Galvanic cells")


def test_rows_written_with_the_flag_off_keep_their_ids_when_it_turns_on(
        Session, kb, monkeypatch):
    monkeypatch.setattr(kb_repository, "stable_topic_ids_enabled", lambda: False)
    _replace(Session, kb, _llm_tree())
    before = _stored(Session, kb)
    monkeypatch.setattr(kb_repository, "stable_topic_ids_enabled", lambda: True)
    _replace(Session, kb, _llm_tree())
    assert _stored(Session, kb) == before


def test_inserting_a_heading_keeps_all_other_ids(Session, kb, flag_on):
    _replace(Session, kb, [T("1 Motion", subs=["1.1 Speed", "1.2 Velocity"]),
                           T("2 Force", subs=["2.1 Newton's laws"])])
    before = _stored(Session, kb)

    _replace(Session, kb, [T("1 Motion", subs=["1.1 Distance", "1.2 Speed", "1.3 Velocity"]),
                           T("2 Work"),
                           T("3 Force", subs=["3.1 Newton's laws"])])
    after = _stored(Session, kb)
    assert _id_of(after, "topic", "1 Motion") == _id_of(before, "topic", "1 Motion")
    assert _id_of(after, "subtopic", "1.2 Speed") == _id_of(before, "subtopic", "1.1 Speed")
    assert _id_of(after, "subtopic", "1.3 Velocity") == _id_of(before, "subtopic", "1.2 Velocity")
    # Renumbered ("2 Force" -> "3 Force") is still the same node.
    assert _id_of(after, "topic", "3 Force") == _id_of(before, "topic", "2 Force")
    assert (_id_of(after, "subtopic", "3.1 Newton's laws")
            == _id_of(before, "subtopic", "2.1 Newton's laws"))
    new_ids = {_id_of(after, "subtopic", "1.1 Distance"), _id_of(after, "topic", "2 Work")}
    assert not new_ids & {v[0] for v in before.values()}
    # Order and parents follow the new tree.
    assert after[("subtopic", "1.2 Speed")][1:] == ("1 Motion", 2)
    assert after[("topic", "3 Force")][2] == 3


def test_authored_tree_keeps_position_ids_stored_before_the_flag(Session, kb, monkeypatch):
    src = _source(Session, kb, "Chapter 1")
    kid = kb["id"]

    def chapter(headings, *, stable):
        topic = T("Chapter 1: Motion", id=kb_topics._node_id(kid, src, "chapter"), source_id=src)
        for i, h in enumerate(headings):
            sub_id = (kb_topics._node_id(kid, src, "heading", normalize_topic_title(h)) if stable
                      else kb_topics._node_id(kid, src, str(i), h))
            topic.subtopics.append(TopicNode(title=h, id=sub_id, source_id=src))
        return [topic]

    monkeypatch.setattr(kb_repository, "stable_topic_ids_enabled", lambda: False)
    _replace(Session, kb, chapter(["1.1 Speed", "1.2 Velocity"], stable=False))
    before = _stored(Session, kb)
    chunk = _chunk_on(Session, kb, src, _id_of(before, "subtopic", "1.2 Velocity"))

    monkeypatch.setattr(kb_repository, "stable_topic_ids_enabled", lambda: True)
    new_tree = chapter(["1.1 Distance", "1.2 Speed", "1.3 Velocity"], stable=True)
    _replace(Session, kb, new_tree)
    after = _stored(Session, kb)
    assert _id_of(after, "topic", "Chapter 1: Motion") == _id_of(before, "topic", "Chapter 1: Motion")
    assert _id_of(after, "subtopic", "1.2 Speed") == _id_of(before, "subtopic", "1.1 Speed")
    assert _id_of(after, "subtopic", "1.3 Velocity") == _id_of(before, "subtopic", "1.2 Velocity")
    # A heading with no stored match is written under the id it carries.
    assert _id_of(after, "subtopic", "1.1 Distance") == new_tree[0].subtopics[0].id
    assert _chunk_node(Session, chunk) == _id_of(before, "subtopic", "1.2 Velocity")


def test_slightly_renamed_topic_keeps_its_id_by_keywords(Session, kb, flag_on):
    _replace(Session, kb, _llm_tree())
    before = _stored(Session, kb)

    renamed = _llm_tree()
    # Jaccard {cell, electrode, emf, nernst} vs {cell, electrode, emf, potential} = 3/5.
    renamed[0].title = "Electrochemical cells"
    renamed[0].keywords = ["Cell", "electrode", "EMF", "potential"]
    # Jaccard {rate, order, arrhenius} vs {rate, catalyst, enzyme, collision} = 1/6.
    renamed[1].title = "Reaction dynamics"
    renamed[1].keywords = ["rate", "catalyst", "enzyme", "collision"]
    _replace(Session, kb, renamed)
    after = _stored(Session, kb)

    assert (_id_of(after, "topic", "Electrochemical cells")
            == _id_of(before, "topic", "Electrochemistry"))
    # Its subtopic's exact key carries the parent title, which changed; it
    # keeps its id through the keyword match under the kept parent id.
    assert (_id_of(after, "subtopic", "Galvanic cells")
            == _id_of(before, "subtopic", "Galvanic cells"))
    assert _id_of(after, "topic", "Reaction dynamics") not in {v[0] for v in before.values()}
    assert ("topic", "Kinetics") not in after


def test_reparented_subtopic_survives_its_old_parents_deletion(Session, kb, flag_on):
    src_a = _source(Session, kb, "Chapter A")
    src_b = _source(Session, kb, "Chapter B")
    tree = [
        T("Chapter A", id="topic-a", source_id=src_a,
          subs=[TopicNode(title="Shared idea", id="sub-x", source_id=src_a),
                TopicNode(title="Only in A", id="sub-y", source_id=src_a)]),
        T("Chapter B", id="topic-b", source_id=src_b),
    ]
    _replace(Session, kb, tree)
    chunk_x = _chunk_on(Session, kb, src_a, "sub-x")
    chunk_a = _chunk_on(Session, kb, src_a, "topic-a")

    _replace(Session, kb, [
        T("Chapter B", id="topic-b", source_id=src_b,
          subs=[TopicNode(title="Shared idea", id="sub-x", source_id=src_b)]),
    ])
    after = _stored(Session, kb)
    assert set(after) == {("topic", "Chapter B"), ("subtopic", "Shared idea")}
    assert after[("subtopic", "Shared idea")] == ("sub-x", "Chapter B", 1)
    assert _chunk_node(Session, chunk_x) == "sub-x"
    assert _chunk_node(Session, chunk_a) is None      # ON DELETE SET NULL


def test_flag_off_replaces_every_llm_id_as_before(Session, kb, flag_off, monkeypatch):
    def must_not_run(*_a, **_k):
        raise AssertionError("stable path ran with the flag off")

    monkeypatch.setattr(KbRepository, "_replace_topic_tree_stable", must_not_run)
    assert _replace(Session, kb, _llm_tree()) == 5
    before = _stored(Session, kb)
    src = _source(Session, kb, "Book")
    chunk = _chunk_on(Session, kb, src, _id_of(before, "topic", "Kinetics"))

    assert _replace(Session, kb, _llm_tree()) == 5
    after = _stored(Session, kb)
    assert set(after) == set(before)
    assert not {v[0] for v in after.values()} & {v[0] for v in before.values()}
    assert _chunk_node(Session, chunk) is None


def test_flag_off_writes_carried_ids_as_before(Session, kb, flag_off):
    _replace(Session, kb, [T("Chapter 1", id="carried-topic",
                             subs=[TopicNode(title="Speed", id="carried-sub")])])
    after = _stored(Session, kb)
    assert after[("topic", "Chapter 1")][0] == "carried-topic"
    assert after[("subtopic", "Speed")][:2] == ("carried-sub", "Chapter 1")


def test_stable_rebuild_leaves_the_summary_tree_alone(Session, kb, flag_on):
    with Session() as db:
        book = KbRepository(db).insert_node(
            kb_id=kb["id"], institute_id=kb["institute"], source_id=None, parent_id=None,
            level="book", title="Whole book", summary=None)
    _replace(Session, kb, _llm_tree())
    _replace(Session, kb, [T("Only topic")])
    with Session() as db:
        levels = db.execute(text(
            "SELECT level, COUNT(*) FROM knowledge_base_node WHERE knowledge_base_id = :kb "
            "GROUP BY level"), {"kb": kb["id"]}).fetchall()
        assert dict(levels) == {"book": 1, "topic": 1}
        assert db.execute(text("SELECT title FROM knowledge_base_node WHERE id = :i"),
                          {"i": book}).scalar_one() == "Whole book"
