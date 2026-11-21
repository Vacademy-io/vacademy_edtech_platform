"""Course to knowledge-base links (CK-13) and the tutor read path.

What must hold:
  * PUT validates the KB like the course outline does: another institute's
    KB is 404, a locked library is 402 LIBRARY_LOCKED;
  * unknown topic node ids (and nodes of another KB) are dropped; chapter
    names resolve to chapter ids within the course, ambiguous ones are
    skipped;
  * the upsert is idempotent (one ACTIVE row per course and KB, decided from
    RETURNING), and a partial update keeps the stored fields;
  * TUTOR_MODE_SETTING.kbGrounding is shown as ``legacy`` but never written;
  * the routes are staff-only by roles (a root learner is refused), 403
    links_not_enabled while the flag is off, 404 for another institute's
    course;
  * the tutor compile picks request override > GROUNDING tutor link > legacy
    only with the flag on; with it off nothing about the compile changes;
  * PlanCompiler grounds a mapped chapter on its first node.

The link tests run on a REAL Postgres 16 + pgvector with the real migrations
(course_knowledge_pg_helpers; skipped without AI_LIMITS_PG_URL /
AI_LIMITS_PGDATA). The flag-off tutor and PlanCompiler tests need no DB.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import sys
import types
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

try:  # the tutor router imports s3_service → boto3; stub it where it isn't installed
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover - depends on the test venv
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

import app.core.security as security  # noqa: E402
from app.db import db_dependency  # noqa: E402
from app.routers import course_knowledge_links as links_router  # noqa: E402
from app.routers import tutor as tutor_router  # noqa: E402
from app.schemas.auth import CustomUserDetails  # noqa: E402
from app.schemas.tutor import CompileKbGrounding, CompileOptions  # noqa: E402
from app.services.course_knowledge import flags  # noqa: E402
from app.services.course_knowledge import links  # noqa: E402
from app.services.tutor.runtime.settings import TutorSettings  # noqa: E402

MODEL = "google/gemini-embedding-001"
USER = "user-1"


# ── fixtures and builders ────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def Session():
    from course_knowledge_pg_helpers import pg_session_factory

    factory = pg_session_factory()
    with factory() as db:
        # The admin_core column the tutor settings reader uses (not in the stubs).
        db.execute(text("ALTER TABLE package ADD COLUMN IF NOT EXISTS course_setting TEXT"))
        db.commit()
    yield factory
    factory.close()


def _inst() -> str:
    return f"inst-{uuid.uuid4().hex[:8]}"


def _id() -> str:
    return str(uuid.uuid4())


def make_kb(db, institute: str, *, owner_type: str = "INSTITUTE", listing: str | None = None,
            name: str = "Physics") -> str:
    kb_id = db.execute(text(
        "INSERT INTO knowledge_base (institute_id, name, purpose, owner_type, embedding_model, embedding_dim) "
        "VALUES (:i, :n, 'general', :o, :m, 768) RETURNING id"),
        {"i": institute, "n": name, "o": owner_type, "m": MODEL}).scalar_one()
    if listing:
        db.execute(text(
            "INSERT INTO knowledge_base_listing (id, knowledge_base_id, title, summary, status) "
            "VALUES (:id, :kb, :n, 'A library', :s)"),
            {"id": _id(), "kb": kb_id, "n": name, "s": listing})
    db.commit()
    return kb_id


def make_node(db, kb_id: str, institute: str, title: str) -> str:
    node_id = db.execute(text(
        "INSERT INTO knowledge_base_node (knowledge_base_id, institute_id, level, title) "
        "VALUES (:kb, :i, 'topic', :t) RETURNING id"),
        {"kb": kb_id, "i": institute, "t": title}).scalar_one()
    db.commit()
    return node_id


def add_chapter(db, course, name: str) -> str:
    """Another ACTIVE chapter on the course's batch."""
    cid = _id()
    db.execute(text("INSERT INTO chapter (id, chapter_name, status) VALUES (:id, :n, 'ACTIVE')"),
               {"id": cid, "n": name})
    db.execute(text(
        "INSERT INTO chapter_package_session_mapping (id, chapter_id, package_session_id, status, chapter_order) "
        "VALUES (:id, :c, :ps, 'ACTIVE', 2)"),
        {"id": _id(), "c": cid, "ps": course.package_session_id})
    db.commit()
    return cid


def make_course(db, institute: str):
    from course_knowledge_pg_helpers import make_course as _make_course

    return _make_course(db, institute, 1)


def set_course_kb_grounding(db, package_id: str, kb_id: str, mode: str = "BLENDED") -> None:
    envelope = {"setting": {"TUTOR_MODE_SETTING": {"data": {
        "enabled": True, "kbGrounding": {"knowledge_base_id": kb_id, "mode": mode}}}}}
    db.execute(text("UPDATE package SET course_setting = :s WHERE id = :p"),
               {"s": json.dumps(envelope), "p": package_id})
    db.commit()


def link_rows(db, package_id: str):
    return db.execute(text(
        "SELECT id, knowledge_base_id, status FROM course_knowledge_link WHERE package_id = :p ORDER BY created_at"),
        {"p": package_id}).fetchall()


@pytest.fixture
def world(Session):
    """One institute with a course, its own KB with three topic nodes, plus a
    second institute with its own KB."""
    inst, other = _inst(), _inst()
    with Session() as db:
        course = make_course(db, inst)
        kb = make_kb(db, inst)
        nodes = [make_node(db, kb, inst, t) for t in ("Motion", "Waves", "Light")]
        other_kb = make_kb(db, other, name="Chemistry")
        other_node = make_node(db, other_kb, other, "Atoms")
    return SimpleNamespace(inst=inst, other=other, course=course, pkg=course.package_id, kb=kb,
                           nodes=nodes, other_kb=other_kb, other_node=other_node)


# ── KB validation ────────────────────────────────────────────────────────────

def test_other_institutes_kb_is_404(Session, world):
    with Session() as db:
        with pytest.raises(links.LinkError) as e:
            links.upsert_link(db, world.inst, world.pkg, {"knowledge_base_id": world.other_kb}, USER)
        assert e.value.status_code == 404
        with pytest.raises(links.LinkError) as e:
            links.upsert_link(db, world.inst, world.pkg, {"knowledge_base_id": "no-such-kb"}, USER)
        assert e.value.status_code == 404
        assert link_rows(db, world.pkg) == []


def test_locked_library_is_402_and_published_library_links(Session, world):
    with Session() as db:
        locked = make_kb(db, world.other, owner_type="PLATFORM", listing="DRAFT", name="Locked")
        with pytest.raises(links.LinkError) as e:
            links.upsert_link(db, world.inst, world.pkg, {"knowledge_base_id": locked}, USER)
        assert e.value.status_code == 402
        assert e.value.detail["reason"] == "LIBRARY_LOCKED"
        assert e.value.detail["knowledge_base_id"] == locked
        assert link_rows(db, world.pkg) == []

        free = make_kb(db, world.other, owner_type="PLATFORM", listing="PUBLISHED", name="Free")
        node = make_node(db, free, world.other, "Optics")
        out = links.upsert_link(db, world.inst, world.pkg,
                                {"knowledge_base_id": free, "topic_node_ids": [node]}, USER)
        assert out["knowledge_base_id"] == free and out["topic_node_ids"] == [node]
        assert out["knowledge_base_name"] == "Free"


# ── node ids and chapter names ───────────────────────────────────────────────

def test_unknown_node_ids_are_dropped(Session, world):
    with Session() as db:
        out = links.upsert_link(db, world.inst, world.pkg, {
            "knowledge_base_id": world.kb,
            "topic_node_ids": [world.nodes[0], "bogus", world.other_node, world.nodes[1], world.nodes[0]],
        }, USER)
    assert out["topic_node_ids"] == [world.nodes[0], world.nodes[1]]


def test_chapter_names_resolve_within_the_course(Session, world):
    with Session() as db:
        motion = world.course.chapter_id          # make_course names it 'Chapter'
        db.execute(text("UPDATE chapter SET chapter_name = 'Motion and Force' WHERE id = :c"), {"c": motion})
        db.commit()
        light = add_chapter(db, world.course, "Chapter 3: Light")
        add_chapter(db, world.course, "Waves")
        add_chapter(db, world.course, "waves ")   # same name twice: ambiguous
        # A chapter of another course with a matching name never resolves here.
        foreign = make_course(db, world.inst)
        db.execute(text("UPDATE chapter SET chapter_name = 'Sound' WHERE id = :c"), {"c": foreign.chapter_id})
        db.commit()

        n_motion, n_waves, n_light = world.nodes
        out = links.upsert_link(db, world.inst, world.pkg, {
            "knowledge_base_id": world.kb,
            "chapter_topics": [
                {"chapter_name": "  motion AND force ", "node_ids": [n_motion, "bogus"]},
                {"chapter_name": "Waves", "node_ids": [n_waves]},
                {"chapter_name": "Light", "node_ids": [n_light, world.other_node]},
                {"chapter_name": "Sound", "node_ids": [n_waves]},
                {"chapter_name": "Nowhere", "node_ids": [n_motion]},
            ],
            "provenance": "AI_COURSE_CREATOR",
        }, USER)
        assert out["chapter_topics"] == {motion: [n_motion], light: [n_light]}
        assert out["provenance"] == "AI_COURSE_CREATOR"

        # The {chapter_id: [node_ids]} shape: chapters outside the course are dropped.
        out = links.upsert_link(db, world.inst, world.pkg, {
            "knowledge_base_id": world.kb,
            "chapter_topics": {light: [n_light, n_waves], foreign.chapter_id: [n_motion]},
        }, USER)
        assert out["chapter_topics"] == {light: [n_light, n_waves]}


# ── idempotent upsert, remove ────────────────────────────────────────────────

def test_upsert_is_idempotent_and_partial_updates_keep_fields(Session, world):
    body = {"knowledge_base_id": world.kb, "grounding_mode": "BLENDED", "use_in": ["tutor"],
            "topic_node_ids": [world.nodes[0]], "provenance": "AI_COURSE_CREATOR"}
    with Session() as db:
        first = links.upsert_link(db, world.inst, world.pkg, dict(body), USER)
        again = links.upsert_link(db, world.inst, world.pkg, dict(body), USER)
        assert again["id"] == first["id"]
        assert [r.status for r in link_rows(db, world.pkg)] == ["ACTIVE"]

        # Only the mode changes; topics, use_in and the first provenance stay.
        edited = links.upsert_link(db, world.inst, world.pkg,
                                   {"knowledge_base_id": world.kb, "grounding_mode": "STRICT",
                                    "provenance": "ADMIN"}, "admin-2")
        assert edited["id"] == first["id"]
        assert edited["grounding_mode"] == "STRICT"
        assert edited["topic_node_ids"] == [world.nodes[0]]
        assert edited["use_in"] == ["tutor"]
        assert edited["provenance"] == "AI_COURSE_CREATOR"
        assert edited["created_by"] == USER


def test_remove_marks_removed_and_a_new_link_is_a_new_row(Session, world):
    with Session() as db:
        first = links.upsert_link(db, world.inst, world.pkg, {"knowledge_base_id": world.kb}, USER)
        with pytest.raises(links.LinkError) as e:
            links.remove_link(db, world.other, world.pkg, first["id"])      # another institute
        assert e.value.status_code == 404
        removed = links.remove_link(db, world.inst, world.pkg, first["id"])
        assert removed["status"] == "REMOVED"
        assert links.list_links(db, world.inst, world.pkg)["links"] == []
        with pytest.raises(links.LinkError):
            links.remove_link(db, world.inst, world.pkg, first["id"])       # already removed
        again = links.upsert_link(db, world.inst, world.pkg, {"knowledge_base_id": world.kb}, USER)
        assert again["id"] != first["id"]
        assert sorted(r.status for r in link_rows(db, world.pkg)) == ["ACTIVE", "REMOVED"]


def test_resolve_course_kb_links_filters_use_in_and_institute(Session, world):
    with Session() as db:
        second = make_kb(db, world.inst, name="Maths")
        links.upsert_link(db, world.inst, world.pkg, {"knowledge_base_id": world.kb, "use_in": ["tutor"]}, USER)
        links.upsert_link(db, world.inst, world.pkg,
                          {"knowledge_base_id": second, "use_in": ["chatbot"], "role": "REFERENCE"}, USER)
        assert [l["knowledge_base_id"] for l in links.resolve_course_kb_links(db, world.inst, [world.pkg], "tutor")] \
            == [world.kb]
        assert [l["knowledge_base_id"] for l in links.resolve_course_kb_links(db, world.inst, [world.pkg], "chatbot")] \
            == [second]
        assert links.resolve_course_kb_links(db, world.other, [world.pkg], "tutor") == []
        assert links.resolve_course_kb_links(db, world.inst, [], "tutor") == []


# ── legacy kbGrounding ───────────────────────────────────────────────────────

def test_legacy_kb_grounding_is_shown_but_never_written(Session, world):
    with Session() as db:
        set_course_kb_grounding(db, world.pkg, world.kb, "BLENDED")
        out = links.list_links(db, world.inst, world.pkg)
        assert out["links"] == []
        assert out["legacy"]["knowledge_base_id"] == world.kb
        assert out["legacy"]["grounding_mode"] == "BLENDED"
        assert out["legacy"]["provenance"] == "LEGACY_TUTOR_SETTING"
        assert out["legacy"]["knowledge_base_name"] == "Physics"
        db.commit()
        assert link_rows(db, world.pkg) == []          # the read wrote nothing

        # Once an active link uses that KB the legacy entry is no longer shown.
        links.upsert_link(db, world.inst, world.pkg, {"knowledge_base_id": world.kb}, USER)
        out = links.list_links(db, world.inst, world.pkg)
        assert out["legacy"] is None and len(out["links"]) == 1


def test_institute_level_legacy_setting_is_read(Session, world):
    with Session() as db:
        envelope = {"setting": {"TUTOR_MODE_SETTING": {"data": {"data": {
            "kbGrounding": {"knowledge_base_id": world.kb}}}}}}
        db.execute(text("UPDATE institutes SET setting_json = :s WHERE id = :i"),
                   {"s": json.dumps(envelope), "i": world.inst})
        db.commit()
        legacy = links.list_links(db, world.inst, world.pkg)["legacy"]
        assert legacy["knowledge_base_id"] == world.kb and legacy["grounding_mode"] == "STRICT"


# ── HTTP: auth, flag, ownership ──────────────────────────────────────────────

@pytest.fixture
def api(Session, world, monkeypatch):
    state = SimpleNamespace(is_root=False, authorities={world.inst: {"roles": ["ADMIN"], "permissions": []}},
                            links_on=True)

    async def fake_verify(auth_header, client_id, settings):
        return CustomUserDetails(username="u", user_id=USER, is_root_user=state.is_root)

    def fake_decode(token, settings):
        return {"user": USER, "authorities": state.authorities}

    monkeypatch.setattr(security, "_verify_and_fetch_user", fake_verify)
    monkeypatch.setattr(security, "_decode_jwt_token", fake_decode)
    monkeypatch.setattr(flags, "links_enabled", lambda: state.links_on)

    def _db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(links_router.router)
    app.dependency_overrides[db_dependency] = _db
    with TestClient(app) as client:
        state.client = client
        state.headers = {"Authorization": "Bearer t", "clientId": world.inst}
        yield state


def test_routes_refuse_when_links_are_not_enabled(api, world):
    api.links_on = False
    r = api.client.get(f"/course-knowledge/v1/packages/{world.pkg}/links", headers=api.headers)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "links_not_enabled"
    r = api.client.put(f"/course-knowledge/v1/packages/{world.pkg}/links",
                       json={"knowledge_base_id": world.kb}, headers=api.headers)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "links_not_enabled"


@pytest.mark.parametrize("roles", [["STUDENT"], ["LEARNER"], []])
def test_root_learner_token_is_rejected(api, world, Session, roles):
    api.is_root = True
    api.authorities = {world.inst: {"roles": roles, "permissions": []}}
    for r in (
        api.client.get(f"/course-knowledge/v1/packages/{world.pkg}/links", headers=api.headers),
        api.client.put(f"/course-knowledge/v1/packages/{world.pkg}/links",
                       json={"knowledge_base_id": world.kb}, headers=api.headers),
        api.client.delete(f"/course-knowledge/v1/packages/{world.pkg}/links/x", headers=api.headers),
    ):
        assert r.status_code == 403, r.request.url
    with Session() as db:
        assert link_rows(db, world.pkg) == []


def test_staff_round_trip_over_http(api, world):
    base = f"/course-knowledge/v1/packages/{world.pkg}/links"
    api.authorities = {world.inst: {"roles": ["CONTENT CREATOR"], "permissions": []}}
    r = api.client.put(base, headers=api.headers, json={
        "knowledge_base_id": world.kb, "grounding_mode": "BLENDED", "use_in": ["tutor", "chatbot"],
        "topic_node_ids": [world.nodes[0], "bogus"],
        "chapter_topics": [{"chapter_name": "CHAPTER", "node_ids": [world.nodes[1]]}],
        "provenance": "AI_COURSE_CREATOR",
    })
    assert r.status_code == 200, r.text
    link = r.json()
    assert link["topic_node_ids"] == [world.nodes[0]]
    assert link["chapter_topics"] == {world.course.chapter_id: [world.nodes[1]]}
    assert link["grounding_mode"] == "BLENDED" and link["provenance"] == "AI_COURSE_CREATOR"
    r = api.client.get(base, headers=api.headers)
    assert r.status_code == 200
    assert [l["id"] for l in r.json()["links"]] == [link["id"]] and r.json()["legacy"] is None
    r = api.client.delete(f"{base}/{link['id']}", headers=api.headers)
    assert r.status_code == 200 and r.json()["status"] == "REMOVED"
    assert api.client.delete(f"{base}/{link['id']}", headers=api.headers).status_code == 404


def test_http_kb_errors_and_foreign_course(api, world, Session):
    base = f"/course-knowledge/v1/packages/{world.pkg}/links"
    r = api.client.put(base, json={"knowledge_base_id": world.other_kb}, headers=api.headers)
    assert r.status_code == 404
    with Session() as db:
        locked = make_kb(db, world.other, owner_type="PLATFORM", name="Locked")
    r = api.client.put(base, json={"knowledge_base_id": locked}, headers=api.headers)
    assert r.status_code == 402 and r.json()["detail"]["reason"] == "LIBRARY_LOCKED"

    # Staff of the other institute cannot reach this course.
    api.authorities = {world.other: {"roles": ["ADMIN"], "permissions": []}}
    headers = {"Authorization": "Bearer t", "clientId": world.other}
    assert api.client.get(base, headers=headers).status_code == 404
    assert api.client.put(base, json={"knowledge_base_id": world.other_kb}, headers=headers).status_code == 404


# ── tutor compile precedence ─────────────────────────────────────────────────

def _caller(inst: str):
    return tutor_router.Caller(inst, USER, ["ADMIN"], False)


@pytest.fixture
def compiler_spy(monkeypatch):
    built = []

    class Spy:
        def __init__(self, **kw):
            built.append(kw)

    monkeypatch.setattr(tutor_router, "PlanCompiler", Spy)
    monkeypatch.setattr(tutor_router, "get_platform_setting", lambda *a, **k: k.get("default"))
    return built


def _compile(db, inst, pkg, payload: CompileOptions, settings: TutorSettings, monkeypatch, built):
    monkeypatch.setattr(tutor_router, "resolve_settings", lambda db, **kw: settings)
    tutor_router._compiler(db, _caller(inst), pkg, payload, force=False)
    return built[-1]


def test_tutor_flag_off_ignores_links_entirely(monkeypatch, compiler_spy):
    """No DB: with the flag off the links module is never read."""
    monkeypatch.setattr(flags, "links_enabled", lambda: False)

    def boom(*a, **k):
        raise AssertionError("links read with the flag off")
    monkeypatch.setattr(links, "tutor_grounding_link", boom)
    monkeypatch.setattr(links, "chapter_topics_for_kb", boom)

    legacy = TutorSettings(kb_grounding={"knowledge_base_id": "kb-legacy", "mode": "BLENDED"})
    kw = _compile(object(), "i", "p", CompileOptions(), legacy, monkeypatch, compiler_spy)
    assert kw["kb_grounding"] == CompileKbGrounding(knowledge_base_id="kb-legacy", mode="BLENDED")
    assert kw["chapter_topics"] is None
    override = CompileOptions(kb_grounding={"knowledge_base_id": "kb-req", "mode": "STRICT"})
    kw = _compile(object(), "i", "p", override, legacy, monkeypatch, compiler_spy)
    assert kw["kb_grounding"].knowledge_base_id == "kb-req" and kw["chapter_topics"] is None
    kw = _compile(object(), "i", "p", CompileOptions(), TutorSettings(), monkeypatch, compiler_spy)
    assert kw["kb_grounding"] is None and kw["chapter_topics"] is None


def test_tutor_precedence_with_flag_on_and_off(Session, world, monkeypatch, compiler_spy):
    with Session() as db:
        legacy_kb = make_kb(db, world.inst, name="Legacy")
        ref_kb = make_kb(db, world.inst, name="Reference")
        chat_kb = make_kb(db, world.inst, name="Chat only")
        # Older links that must NOT be picked: REFERENCE role, chatbot-only.
        links.upsert_link(db, world.inst, world.pkg, {"knowledge_base_id": ref_kb, "role": "REFERENCE"}, USER)
        links.upsert_link(db, world.inst, world.pkg, {"knowledge_base_id": chat_kb, "use_in": ["chatbot"]}, USER)
        legacy = TutorSettings(kb_grounding={"knowledge_base_id": legacy_kb, "mode": "STRICT"})

        # Flag on, no tutor GROUNDING link yet: the legacy setting.
        monkeypatch.setattr(flags, "links_enabled", lambda: True)
        kw = _compile(db, world.inst, world.pkg, CompileOptions(), legacy, monkeypatch, compiler_spy)
        assert kw["kb_grounding"].knowledge_base_id == legacy_kb and kw["chapter_topics"] is None

        chapter = world.course.chapter_id
        links.upsert_link(db, world.inst, world.pkg, {
            "knowledge_base_id": world.kb, "grounding_mode": "BLENDED", "use_in": ["tutor", "chatbot"],
            "chapter_topics": {chapter: [world.nodes[2], world.nodes[0]]}}, USER)

        # Flag on: the GROUNDING tutor link beats the legacy setting, with its chapter map.
        kw = _compile(db, world.inst, world.pkg, CompileOptions(), legacy, monkeypatch, compiler_spy)
        assert kw["kb_grounding"] == CompileKbGrounding(knowledge_base_id=world.kb, mode="BLENDED")
        assert kw["chapter_topics"] == {chapter: [world.nodes[2], world.nodes[0]]}

        # Flag on: the request override beats the link; its own KB's chapter map rides along.
        override = CompileOptions(kb_grounding={"knowledge_base_id": legacy_kb, "mode": "BLENDED"})
        kw = _compile(db, world.inst, world.pkg, override, legacy, monkeypatch, compiler_spy)
        assert kw["kb_grounding"] == CompileKbGrounding(knowledge_base_id=legacy_kb, mode="BLENDED")
        assert kw["chapter_topics"] is None
        override = CompileOptions(kb_grounding={"knowledge_base_id": world.kb, "mode": "STRICT"})
        kw = _compile(db, world.inst, world.pkg, override, legacy, monkeypatch, compiler_spy)
        assert kw["kb_grounding"].mode == "STRICT"
        assert kw["chapter_topics"] == {chapter: [world.nodes[2], world.nodes[0]]}

        # Flag off: the same course compiles exactly as before (legacy, no chapter map).
        monkeypatch.setattr(flags, "links_enabled", lambda: False)
        kw = _compile(db, world.inst, world.pkg, CompileOptions(), legacy, monkeypatch, compiler_spy)
        assert kw["kb_grounding"] == CompileKbGrounding(knowledge_base_id=legacy_kb, mode="STRICT")
        assert kw["chapter_topics"] is None


def test_tutor_links_failure_falls_back_to_legacy(monkeypatch, compiler_spy):
    monkeypatch.setattr(flags, "links_enabled", lambda: True)

    def broken(*a, **k):
        raise RuntimeError("db down")
    monkeypatch.setattr(links, "tutor_grounding_link", broken)
    db = SimpleNamespace(rollback=lambda: None)
    legacy = TutorSettings(kb_grounding={"knowledge_base_id": "kb-legacy", "mode": "STRICT"})
    kw = _compile(db, "i", "p", CompileOptions(), legacy, monkeypatch, compiler_spy)
    assert kw["kb_grounding"].knowledge_base_id == "kb-legacy" and kw["chapter_topics"] is None


# ── PlanCompiler: chapter node into ground_slide ─────────────────────────────

def _ground_calls(monkeypatch, compiler, source):
    from app.services.kb import course_grounding
    from app.services.tutor import plan_compiler as pc

    calls = []

    async def fake_ground(db, **kw):
        calls.append(kw)
        return SimpleNamespace(supported=False)

    monkeypatch.setattr(course_grounding, "ground_slide", fake_ground)
    monkeypatch.setattr(pc, "db_session", lambda: contextlib.nullcontext(object()))
    asyncio.run(compiler._kb_block(source))
    return calls


def _plan_compiler(**kw):
    from app.services.tutor.plan_compiler import PlanCompiler

    return PlanCompiler(institute_id="i", user_id="u", model_override="m",
                        kb_grounding=CompileKbGrounding(knowledge_base_id="kb1", mode="STRICT"), **kw)


def _source(chapter_id="ch-1"):
    return SimpleNamespace(kind="document", slide_id="s1", chapter_id=chapter_id,
                           chapter_name="Motion", title="Speed")


def test_plan_compiler_passes_the_chapters_first_node(monkeypatch):
    calls = _ground_calls(monkeypatch, _plan_compiler(chapter_topics={"ch-1": ["n-first", "n-second"]}), _source())
    assert calls[0]["node_id"] == "n-first"
    assert calls[0]["query"] == "Motion Speed" and calls[0]["kb_id"] == "kb1"


def test_plan_compiler_without_a_mapping_keeps_the_old_call(monkeypatch):
    default = _ground_calls(monkeypatch, _plan_compiler(), _source())
    unmapped = _ground_calls(monkeypatch, _plan_compiler(chapter_topics={"other": ["n"]}), _source())
    no_chapter = _ground_calls(monkeypatch, _plan_compiler(chapter_topics={"ch-1": ["n"]}), _source(None))
    for calls in (default, unmapped, no_chapter):
        assert "node_id" not in calls[0]
        assert set(calls[0]) == {"kb_id", "institute_id", "query", "mode", "faithful"}
