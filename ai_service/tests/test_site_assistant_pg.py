"""Site Assistant SQL on a REAL Postgres: repository, DB-backed caps, the
index lock, idempotency lookup. Tables as in SPEC §2 / admin_core V598.

Needs SITE_ASSISTANT_TEST_PG_URL (e.g. postgresql+psycopg://postgres@localhost:55432/postgres);
skipped otherwise. Each run works in its own throw-away schema. Without the
pgvector extension `vector` becomes a text domain and the vector searches are
skipped (NULL embeddings and the keyword fallbacks are still exercised).
"""
import os
import sys
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

PG_URL = os.getenv("SITE_ASSISTANT_TEST_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="SITE_ASSISTANT_TEST_PG_URL not set")

from sqlalchemy import create_engine, event, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.site_assistant import caps  # noqa: E402
from app.site_assistant import repository as repo  # noqa: E402

DDL = """
CREATE TABLE site_assistant_conversation (
    id VARCHAR(36) PRIMARY KEY, institute_id VARCHAR(255) NOT NULL, site_tag VARCHAR(255) NOT NULL,
    channel VARCHAR(16) NOT NULL, visitor_id VARCHAR(64) NOT NULL, user_id VARCHAR(255), ip_hash VARCHAR(64),
    origin_host VARCHAR(253), started_page TEXT, utm JSONB, locale VARCHAR(16),
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE', message_count INT NOT NULL DEFAULT 0,
    answers_billed INT NOT NULL DEFAULT 0, lead_status VARCHAR(16), lead_ref VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_active_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE site_assistant_message (
    id BIGSERIAL PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL REFERENCES site_assistant_conversation (id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL, content TEXT NOT NULL, cards JSONB, tool_name VARCHAR(64), sources JSONB,
    answered BOOLEAN, feedback SMALLINT, page JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE site_assistant_knowledge (
    id VARCHAR(36) PRIMARY KEY, institute_id VARCHAR(255) NOT NULL, site_tag VARCHAR(255), kind VARCHAR(16) NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ, embedding {VEC}, created_by VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE site_assistant_page_chunk (
    id BIGSERIAL PRIMARY KEY, institute_id VARCHAR(255) NOT NULL, site_tag VARCHAR(255) NOT NULL,
    page_route TEXT NOT NULL, page_title TEXT, section_id VARCHAR(128), heading TEXT, content TEXT NOT NULL,
    embedding {VEC}, fingerprint VARCHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE site_assistant_index_state (
    institute_id VARCHAR(255) NOT NULL, site_tag VARCHAR(255) NOT NULL, fingerprint VARCHAR(64), status VARCHAR(16),
    chunks INT, error TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (institute_id, site_tag));
CREATE TABLE site_assistant_usage_daily (
    institute_id VARCHAR(255) NOT NULL, site_tag VARCHAR(255) NOT NULL, day DATE NOT NULL,
    answers INT NOT NULL DEFAULT 0, PRIMARY KEY (institute_id, site_tag, day));
CREATE TABLE site_assistant_visitor_daily (
    key_hash VARCHAR(64) NOT NULL, day DATE NOT NULL, answers INT NOT NULL DEFAULT 0, PRIMARY KEY (key_hash, day));
"""

INST, OTHER, TAG = "inst-a", "inst-b", "bv"


@pytest.fixture(scope="module")
def Session():
    schema = f"sa_test_{uuid.uuid4().hex[:8]}"
    engine = create_engine(PG_URL, future=True)
    with engine.begin() as conn:
        has_vector = True
        try:
            with conn.begin_nested():
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        except Exception:  # noqa: BLE001
            has_vector = False
        conn.execute(text(f"CREATE SCHEMA {schema}"))
        conn.execute(text(f"SET search_path TO {schema}, public"))
        if not has_vector:
            conn.execute(text("CREATE DOMAIN vector AS text"))
        conn.execute(text(DDL.replace("{VEC}", "vector(768)" if has_vector else "vector")))

    @event.listens_for(engine, "connect")
    def _search_path(dbapi_conn, _rec):
        cur = dbapi_conn.cursor()
        cur.execute(f"SET search_path TO {schema}, public")
        cur.close()
        dbapi_conn.commit()

    engine.dispose()
    factory = sessionmaker(bind=engine, future=True, expire_on_commit=False)
    factory.has_vector = has_vector
    yield factory
    with engine.begin() as conn:
        conn.execute(text(f"DROP SCHEMA {schema} CASCADE"))
    engine.dispose()


def conv(db, iid=INST, tag=TAG, vid="v_1", ch="HOSTED"):
    cid = repo.create_conversation(db, institute_id=iid, site_tag=tag, channel=ch, visitor_id=vid, user_id=None,
                                   ip_hash="h", origin_host="x.org", started_page="/", utm={"utm_source": "g"},
                                   locale="en")
    db.commit()
    return cid


def test_conversation_round_trip_and_resume(Session):
    with Session() as db:
        cid = conv(db)
        c = repo.get_conversation(db, cid)
        assert c["institute_id"] == INST and c["utm"] == {"utm_source": "g"} and c["status"] == "ACTIVE"
        assert repo.find_resumable(db, conversation_id=cid, institute_id=INST, site_tag=TAG, visitor_id="v_1",
                                   channel="HOSTED", ttl_seconds=3600)
        assert not repo.find_resumable(db, conversation_id=cid, institute_id=INST, site_tag=TAG, visitor_id="v_2",
                                       channel="HOSTED", ttl_seconds=3600)
        db.execute(text("UPDATE site_assistant_conversation SET last_active_at = now() - interval '13 hours' WHERE id = :id"),
                   {"id": cid})
        assert not repo.find_resumable(db, conversation_id=cid, institute_id=INST, site_tag=TAG, visitor_id="v_1",
                                       channel="HOSTED", ttl_seconds=12 * 3600)
        repo.touch_conversation(db, cid, messages=2, billed=1)
        repo.set_lead(db, cid, "SALES", "lead-9")
        db.commit()
        c = repo.get_conversation(db, cid)
        assert (c["message_count"], c["answers_billed"], c["lead_status"], c["lead_ref"]) == (2, 1, "SALES", "lead-9")


def test_messages_idempotency_lookup_history_feedback(Session):
    with Session() as db:
        cid = conv(db)
        repo.advisory_lock(db, f"sa:{cid}")
        u1 = repo.add_message(db, cid, "user", "q1", page={"client_msg_id": "m1", "route": "/"})
        repo.add_message(db, cid, "tool", "<data/>", tool_name="search_courses", sources=[{"type": "course"}])
        a1 = repo.add_message(db, cid, "assistant", "ans1", cards=[{"type": "notice", "title": "t", "body": "b"}],
                              sources={"items": [], "billed": False}, answered=True)
        u2 = repo.add_message(db, cid, "user", "q2", page={"client_msg_id": "m2"})
        db.commit()
        hit = repo.find_by_client_msg_id(db, cid, "m1")
        assert hit["user"]["id"] == u1 and hit["reply"]["id"] == a1 and hit["reply"]["cards"][0]["type"] == "notice"
        hit2 = repo.find_by_client_msg_id(db, cid, "m2")
        assert hit2["user"]["id"] == u2 and hit2["reply"] is None
        assert repo.find_by_client_msg_id(db, cid, "nope") is None
        assert [m["content"] for m in repo.history(db, cid, 8)] == ["q1", "ans1", "q2"]
        assert [m["role"] for m in repo.transcript(db, cid, include_tools=True)] == ["user", "tool", "assistant", "user"]
        assert repo.recent_user_messages(db, cid, 60) == 2
        assert repo.set_feedback(db, cid, a1, 1) and not repo.set_feedback(db, cid, u1, 1)
        other = conv(db, vid="v_2")
        assert not repo.set_feedback(db, other, a1, -1)
        repo.mark_billed(db, a1)
        db.commit()
        assert repo.find_by_client_msg_id(db, cid, "m1")["reply"]["sources"]["billed"] is True
        assert repo.tool_names_used(db, cid) == ["search_courses"]


def test_caps_are_all_or_nothing_and_releasable(Session):
    key = f"v:{uuid.uuid4().hex}"
    ip = f"ip:{uuid.uuid4().hex}"
    tag = f"cap-{uuid.uuid4().hex[:6]}"
    with Session() as db:
        r1 = caps.reserve(db, visitor_key=key, ip_key=ip, institute_id=INST, site_tag=tag, visitor_cap=2, ip_cap=5, site_cap=10)
        r2 = caps.reserve(db, visitor_key=key, ip_key=ip, institute_id=INST, site_tag=tag, visitor_cap=2, ip_cap=5, site_cap=10)
        assert r1 and r2
        assert caps.reserve(db, visitor_key=key, ip_key=ip, institute_id=INST, site_tag=tag,
                            visitor_cap=2, ip_cap=5, site_cap=10) is None
        # the refused attempt took nothing from the ip / site counters
        ip_n = db.execute(text("SELECT answers FROM site_assistant_visitor_daily WHERE key_hash = :k"), {"k": ip}).scalar()
        assert ip_n == 2 and repo.site_answers_today(db, INST, tag) == 2
        caps.release(db, r2)
        assert caps.reserve(db, visitor_key=key, ip_key=ip, institute_id=INST, site_tag=tag,
                            visitor_cap=2, ip_cap=5, site_cap=10) is not None
        assert repo.site_answers_today(db, INST, tag) == 2
        # site cap
        assert caps.reserve(db, visitor_key="v:other", ip_key=None, institute_id=INST, site_tag=tag,
                            visitor_cap=5, ip_cap=5, site_cap=2) is None


def test_new_chat_count_per_network(Session):
    key = f"s:{uuid.uuid4().hex}"
    with Session() as db:
        assert caps.take_session(db, key, 2) and caps.take_session(db, key, 2)
        assert not caps.take_session(db, key, 2)
        assert db.execute(text("SELECT answers FROM site_assistant_visitor_daily WHERE key_hash = :k"),
                          {"k": key}).scalar() == 2


def test_caps_hold_under_concurrency(Session):
    key = f"v:{uuid.uuid4().hex}"
    tag = f"cc-{uuid.uuid4().hex[:6]}"
    results = []

    def worker():
        with Session() as db:
            results.append(caps.reserve(db, visitor_key=key, ip_key=None, institute_id=INST, site_tag=tag,
                                        visitor_cap=5, ip_cap=5, site_cap=100) is not None)
    threads = [threading.Thread(target=worker) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sum(results) == 5


def test_index_lock(Session):
    tag = f"ix-{uuid.uuid4().hex[:6]}"
    with Session() as db:
        assert repo.try_lock_index(db, INST, tag, "fp1")
        db.commit()
        assert not repo.try_lock_index(db, INST, tag, "fp1")            # someone is indexing
        assert not repo.try_lock_index(db, INST, tag, "fp2")            # even for new pages
        repo.finish_index(db, INST, tag, fingerprint="fp1", ok=True, chunks=3)
        db.commit()
        assert not repo.try_lock_index(db, INST, tag, "fp1")            # up to date
        assert repo.try_lock_index(db, INST, tag, "fp2")                # pages changed
        repo.finish_index(db, INST, tag, fingerprint="fp2", ok=False, error="boom")
        db.commit()
        assert not repo.try_lock_index(db, INST, tag, "fp2")            # failed just now: no hot loop
        assert repo.try_lock_index(db, INST, tag, "fp2", force=True)    # admin reindex
        db.execute(text("UPDATE site_assistant_index_state SET updated_at = now() - interval '1 hour' "
                        "WHERE site_tag = :t"), {"t": tag})
        db.commit()
        assert repo.try_lock_index(db, INST, tag, "fp2")                # a dead holder is taken over
        db.commit()
        st = repo.index_state(db, INST, tag)
        assert st["status"] == "INDEXING" and st["fingerprint"] == "fp2"


def test_page_chunks_replace_and_keyword_search(Session):
    tag = f"pc-{uuid.uuid4().hex[:6]}"
    with Session() as db:
        repo.replace_page_chunks(db, INST, tag, "fp", [
            {"page_route": "about", "page_title": "About", "section_id": "a", "heading": "Story",
             "content": "Founded in 2004 at Haridwar", "embedding": None},
            {"page_route": "policies", "page_title": "Refund policy", "section_id": None, "heading": None,
             "content": "Refunds within 7 days", "embedding": None}])
        db.commit()
        hits = repo.search_page_chunks_keyword(db, INST, tag, ["refunds", "policy"])
        assert hits[0]["page_route"] == "policies"
        assert repo.search_page_chunks_keyword(db, OTHER, tag, ["refunds"]) == []
        repo.replace_page_chunks(db, INST, tag, "fp2", [
            {"page_route": "x", "page_title": "X", "content": "only this", "embedding": None}])
        db.commit()
        assert db.execute(text("SELECT count(*) FROM site_assistant_page_chunk WHERE site_tag = :t"), {"t": tag}).scalar() == 1


def test_knowledge_scoping_dates_and_keyword_search(Session):
    tag = f"kn-{uuid.uuid4().hex[:6]}"
    now = datetime.now(timezone.utc)
    with Session() as db:
        shared = repo.create_knowledge(db, INST, site_tag=None, kind="FAQ", title="Refund policy?",
                                       body="Full refund within 7 days.", active=True, starts_at=None, ends_at=None,
                                       created_by="u")
        repo.create_knowledge(db, INST, site_tag=tag, kind="NOTICE", title="Diwali holidays", body="Closed 1-5 Nov",
                              active=True, starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=5),
                              created_by="u")
        repo.create_knowledge(db, INST, site_tag=tag, kind="NOTICE", title="Old notice", body="expired holidays",
                              active=True, starts_at=None, ends_at=now - timedelta(days=1), created_by="u")
        repo.create_knowledge(db, INST, site_tag="other-site", kind="FAQ", title="Other site refund", body="refund",
                              active=True, starts_at=None, ends_at=None, created_by="u")
        repo.create_knowledge(db, OTHER, site_tag=None, kind="FAQ", title="Their refund", body="refund",
                              active=True, starts_at=None, ends_at=None, created_by="u")
        db.commit()
        hits = repo.search_knowledge_keyword(db, INST, tag, ["FAQ", "NOTICE"], ["refund", "holidays"])
        assert {h["title"] for h in hits} == {"Refund policy?", "Diwali holidays"}
        assert [n["title"] for n in repo.active_notices(db, INST, tag)] == ["Diwali holidays"]
        assert {k["title"] for k in repo.list_knowledge(db, INST, site_tag=tag)} == {
            "Refund policy?", "Diwali holidays", "Old notice"}
        assert repo.update_knowledge(db, INST, shared, {"active": False}) and not repo.update_knowledge(
            db, OTHER, shared, {"active": True})
        repo.set_knowledge_embedding(db, INST, shared, None)
        db.commit()
        assert repo.get_knowledge(db, OTHER, shared) is None
        assert not repo.delete_knowledge(db, OTHER, shared) and repo.delete_knowledge(db, INST, shared)
        db.commit()


def test_staff_lists(Session):
    tag = f"st-{uuid.uuid4().hex[:6]}"
    with Session() as db:
        cid = conv(db, tag=tag)
        repo.add_message(db, cid, "user", "Do you have a hostel?")
        a = repo.add_message(db, cid, "assistant", "I don't have that detail.", answered=False)
        repo.set_feedback(db, cid, a, -1)
        repo.touch_conversation(db, cid, messages=2)
        repo.set_lead(db, cid, "SUPPORT", None)
        conv(db, iid=OTHER, tag=tag)
        conv(db, tag=tag)                          # opened, nobody typed: not listed by default
        db.commit()
        assert repo.recent_leads_from_ip(db, INST, "h") >= 1
        out = repo.list_conversations(db, INST, site_tag=tag, lead=None, page=0, size=10)
        assert out["total"] == 1 and out["items"][0]["first_question"] == "Do you have a hostel?"
        assert out["items"][0]["thumbs_down"] == 1
        assert repo.list_conversations(db, INST, site_tag=tag, lead=None, page=0, size=10,
                                       include_empty=True)["total"] == 2
        assert repo.list_conversations(db, INST, site_tag=tag, lead="SALES", page=0, size=10)["total"] == 0
        assert repo.list_conversations(db, INST, site_tag=tag, lead="SUPPORT", page=0, size=10)["total"] == 1
        un = repo.unanswered_questions(db, INST, site_tag=tag, days=30)
        assert [u["question"] for u in un] == ["Do you have a hostel?"]
        assert repo.unanswered_questions(db, OTHER, site_tag=tag, days=30) == []


def test_vector_search_when_pgvector_is_available(Session):
    if not Session.has_vector:
        pytest.skip("pgvector not installed on this server")
    tag = f"vec-{uuid.uuid4().hex[:6]}"
    v1 = [1.0] + [0.0] * 767
    v2 = [0.0, 1.0] + [0.0] * 766
    with Session() as db:
        repo.replace_page_chunks(db, INST, tag, "fp", [
            {"page_route": "a", "page_title": "A", "content": "alpha", "embedding": v1},
            {"page_route": "b", "page_title": "B", "content": "beta", "embedding": v2}])
        kid = repo.create_knowledge(db, INST, site_tag=None, kind="FAQ", title="q", body="a", active=True,
                                    starts_at=None, ends_at=None, created_by="u")
        repo.set_knowledge_embedding(db, INST, kid, v1)
        db.commit()
        assert repo.search_page_chunks_vector(db, INST, tag, v1)[0]["page_route"] == "a"
        assert repo.search_knowledge_vector(db, INST, tag, ["FAQ"], v1)[0]["id"] == kid
