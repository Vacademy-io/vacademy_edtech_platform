"""
The Vacademy Assistant's chat history: list, read, continue and delete.

Pinned here: a caller sees only their own Assistant chats in the pinned
institute (anything else answers 404), learners are refused, titles come from
the first question, the read view leaves out tool traffic and shows cards in
their final state, continuing a chat retires its open cards (so an old card is
never confirmed later and a used card stays used), and a deleted chat is gone
from the list and from every other endpoint.

Runs on an in-memory sqlite copy of chat_sessions / chat_messages; the card
reads and writes that Postgres does with jsonb have sqlite twins here.
"""
from __future__ import annotations

import json
import os
import sys
import types
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:  # some routers import s3_service -> boto3; stub it where it isn't installed
    import boto3  # noqa: F401
except ImportError:  # pragma: no cover - depends on the test venv
    for _name in ("boto3", "botocore", "botocore.exceptions", "botocore.config"):
        sys.modules.setdefault(_name, types.ModuleType(_name))
    sys.modules["botocore.exceptions"].ClientError = Exception
    sys.modules["botocore.exceptions"].NoCredentialsError = Exception
    sys.modules["botocore.config"].Config = object

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.services import assistant_tool_registry as reg  # noqa: E402  (load the registry first)
from app.services import assistant_service as asv  # noqa: E402
from app.core.security import get_pinned_principal  # noqa: E402
from app.dependencies import get_assistant_service  # noqa: E402
from app.routers import assistant as assistant_router  # noqa: E402
from app.schemas.auth import PinnedPrincipal  # noqa: E402

INST, OTHER_INST = "inst-a", "inst-b"
ME, SOMEONE = "user-1", "user-2"

_DDL = (
    """CREATE TABLE chat_sessions (
        id VARCHAR(255) PRIMARY KEY, user_id VARCHAR(255) NOT NULL, institute_id VARCHAR(255) NOT NULL,
        context_type VARCHAR(50) NOT NULL, context_meta TEXT NOT NULL, session_mode VARCHAR(30) NOT NULL,
        status VARCHAR(20) NOT NULL, last_active DATETIME NOT NULL, created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL)""",
    """CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id VARCHAR(255) NOT NULL, message_type VARCHAR(20) NOT NULL,
        content TEXT NOT NULL, metadata TEXT, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)""",
)


def principal(user_id: str = ME, institute_id: str = INST, roles=("ADMIN",)) -> PinnedPrincipal:
    return PinnedPrincipal(user_id=user_id, institute_id=institute_id, roles=list(roles), permissions=[])


def _move_sqlite(db, row_id, meta, from_status):
    """The sqlite twin of AssistantAgentService._move_pending_action (Postgres casts to jsonb)."""
    row = db.execute(
        text("UPDATE chat_messages SET metadata = :m WHERE id = :id "
             "AND json_extract(metadata, '$.status') = :expected RETURNING id"),
        {"m": json.dumps(meta), "id": row_id, "expected": from_status},
    ).first()
    db.commit()
    return row is not None


def _load_sqlite(self, db, session_id, action_id):
    """The sqlite twin of AssistantAgentService._load_pending_action (sqlite returns the json as text)."""
    row = db.execute(
        text("SELECT id, content, metadata FROM chat_messages WHERE session_id = :sid "
             "AND message_type = 'pending_action' AND json_extract(metadata, '$.nonce') = :nonce LIMIT 1"),
        {"sid": session_id, "nonce": action_id},
    ).first()
    return None if row is None else (row[0], row[1], json.loads(row[2] or "{}"))


class Store:
    """An sqlite chat store plus helpers that write rows the way the assistant does."""

    def __init__(self):
        self.engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        with self.engine.begin() as conn:
            for ddl in _DDL:
                conn.execute(text(ddl))
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.clock = datetime(2026, 11, 1, 9, 0, 0)

    def tick(self, minutes=1):
        self.clock += timedelta(minutes=minutes)
        return self.clock

    def chat(self, *messages, user=ME, institute=INST, context=reg.ASSISTANT_CONTEXT_TYPE, status="ACTIVE"):
        """A chat with (type, content, metadata) messages; returns its id. Later chats are newer."""
        sid = f"s-{len(self.ids()) + 1}"
        at = self.tick()
        with self.Session() as db:
            db.execute(text(
                "INSERT INTO chat_sessions VALUES (:id, :u, :i, :c, '{}', 'text', :s, :t, :t, :t)"),
                {"id": sid, "u": user, "i": institute, "c": context, "s": status, "t": at})
            for kind, content, meta in messages:
                db.execute(text(
                    "INSERT INTO chat_messages (session_id, message_type, content, metadata, created_at, updated_at) "
                    "VALUES (:s, :k, :c, :m, :t, :t)"),
                    {"s": sid, "k": kind, "c": content, "m": json.dumps(meta or {}), "t": at})
            db.commit()
        return sid

    def ids(self):
        with self.Session() as db:
            return [r[0] for r in db.execute(text("SELECT id FROM chat_sessions")).all()]

    def status(self, sid):
        with self.Session() as db:
            return db.execute(text("SELECT status FROM chat_sessions WHERE id = :s"), {"s": sid}).scalar()

    def cards(self, sid):
        with self.Session() as db:
            rows = db.execute(text(
                "SELECT metadata FROM chat_messages WHERE session_id = :s AND message_type = 'pending_action' "
                "ORDER BY id"), {"s": sid}).all()
        return [json.loads(r[0]) for r in rows]


def card(nonce, status="PENDING", minutes=10, **extra):
    expires = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return ("pending_action", "Change status to Interested for 1 lead",
            {"nonce": nonce, "tool": "update_learner_profile", "args": {"x": 1}, "status": status,
             "expires_at": expires.isoformat(), "details": ["Asha: NEW → Interested"], **extra})


@pytest.fixture
def env(monkeypatch):
    store = Store()
    monkeypatch.setattr(asv.AssistantAgentService, "_move_pending_action", staticmethod(_move_sqlite))
    monkeypatch.setattr(asv.AssistantAgentService, "_load_pending_action", _load_sqlite)
    monkeypatch.setattr(asv, "load_assistant_tools_setting", lambda db, inst: None)
    service = asv.AssistantAgentService(store.Session)
    state = SimpleNamespace(store=store, service=service, principal=principal())
    app = FastAPI()
    app.include_router(assistant_router.router)
    app.dependency_overrides[get_assistant_service] = lambda: service
    app.dependency_overrides[get_pinned_principal] = lambda: state.principal
    with TestClient(app) as client:
        state.client = client
        yield state


def ask(env, method, path, **kw):
    return getattr(env.client, method)(f"/assistant{path}", **kw)


# ── list ─────────────────────────────────────────────────────────────────

def test_the_list_holds_only_my_assistant_chats_newest_first(env):
    s = env.store
    old = s.chat(("user", "How do I create a course?", None), ("assistant", "Steps…", None), status="CLOSED")
    s.chat(("user", "someone else's question", None), user=SOMEONE)
    s.chat(("user", "my question in another institute", None), institute=OTHER_INST)
    s.chat(("user", "a tutor chat", None), context="slide_doubt")
    s.chat()                                                          # opened, nothing asked
    new = s.chat(("user", "  Who   owes fees\nthis week?  ", {"page_context": {"route": "/x"}}),
                 ("tool_call", "Calling crm_collections", {"tool_name": "crm_collections"}),
                 ("tool_result", '{"rows": []}', None),
                 ("assistant", "Nobody.", None))

    body = ask(env, "get", "/sessions").json()
    assert [c["id"] for c in body["items"]] == [new, old]
    first, second = body["items"]
    assert first == {"id": new, "title": "Who owes fees this week?", "last_active": first["last_active"],
                     "message_count": 2, "is_open": True}
    assert first["last_active"].endswith("Z")
    assert second["is_open"] is False and second["message_count"] == 2
    assert body["has_more"] is False and body["page"] == 0


def test_titles_are_cut_near_sixty_characters_at_a_word_break():
    long = "Show me every learner in the Class 10 morning batch whose attendance dropped this month"
    title = asv.chat_title(long)
    assert title.endswith("…") and len(title) <= asv.TITLE_MAX_CHARS + 1
    assert long.startswith(title[:-1]) and not title[:-1].endswith(" ")
    assert asv.chat_title("Short one") == "Short one"
    assert asv.chat_title(None) == ""


def test_the_list_pages_and_searches_by_title(env):
    for n in range(5):
        env.store.chat(("user", f"Question number {n} about fees" if n % 2 else f"Question {n} on batches", None))
    page0 = ask(env, "get", "/sessions", params={"page_size": 2}).json()
    page2 = ask(env, "get", "/sessions", params={"page_size": 2, "page": 2}).json()
    assert len(page0["items"]) == 2 and page0["has_more"] is True
    assert len(page2["items"]) == 1 and page2["has_more"] is False
    found = ask(env, "get", "/sessions", params={"q": "FEES"}).json()["items"]
    assert [c["title"] for c in found] == ["Question number 3 about fees", "Question number 1 about fees"]
    # LIKE wildcards and the escape character in the search are plain text
    for literal in ("%", "_", "!", "!%"):
        assert ask(env, "get", "/sessions", params={"q": literal}).json()["items"] == [], literal
    env.store.chat(("user", "Fees 100% paid_up!", None))
    assert [c["title"] for c in ask(env, "get", "/sessions", params={"q": "100% PAID_UP!"}).json()["items"]] == \
        ["Fees 100% paid_up!"]
    assert ask(env, "get", "/sessions", params={"page_size": 51}).status_code == 422


# ── read one chat ────────────────────────────────────────────────────────

def test_a_chat_shows_questions_answers_and_cards_without_tool_traffic(env):
    sid = env.store.chat(
        ("user", "Move Asha to Interested", {"page_context": {"route": "/leads", "selected_student": {"id": "x"}}}),
        ("tool_call", "Calling crm_lead_edit", {"tool_name": "crm_lead_edit"}),
        ("tool_result", '{"secret": "tool payload"}', None),
        card("n-open"),
        card("n-old", minutes=-5),
        card("n-done", status="EXECUTED"),
        ("assistant", "Press Confirm on the card.", {"suggestions": ["Show her follow-ups", "Any other leads?"]}),
    )
    body = ask(env, "get", f"/sessions/{sid}").json()
    assert body["title"] == "Move Asha to Interested" and body["is_open"] is True
    roles = [m["role"] for m in body["messages"]]
    assert roles == ["user", "action", "action", "action", "assistant"]
    blob = json.dumps(body)
    assert "tool payload" not in blob and "crm_lead_edit" not in blob and "page_context" not in blob
    assert "nonce" not in blob and "n-open" not in blob and "update_learner_profile" not in blob
    states = [m["action"]["status"] for m in body["messages"] if m["role"] == "action"]
    assert states == ["pending", "expired", "executed"]
    assert body["messages"][1]["action"]["details"] == ["Asha: NEW → Interested"]
    assert body["messages"][-1]["suggestions"] == ["Show her follow-ups", "Any other leads?"]


@pytest.mark.parametrize("who", [
    principal(user_id=SOMEONE),                 # another user of the same institute
    principal(institute_id=OTHER_INST),         # me, pinned to another institute
])
def test_another_users_or_institutes_chat_is_not_found(env, who):
    sid = env.store.chat(("user", "my private question", None), card("n-1"))
    env.principal = who
    assert ask(env, "get", f"/sessions/{sid}").status_code == 404
    assert ask(env, "post", f"/sessions/{sid}/continue").status_code == 404
    assert ask(env, "delete", f"/sessions/{sid}").status_code == 404
    assert ask(env, "get", "/sessions").json()["items"] == []
    assert ask(env, "get", "/sessions/no-such-chat").status_code == 404
    assert env.store.status(sid) == "ACTIVE" and env.store.cards(sid)[0]["status"] == "PENDING"


def test_a_tutor_chat_of_mine_is_not_an_assistant_chat(env):
    sid = env.store.chat(("user", "a tutor question", None), context="slide_doubt")
    assert ask(env, "get", f"/sessions/{sid}").status_code == 404


@pytest.mark.parametrize("roles", [("STUDENT",), ("LEARNER",), ()])
def test_learners_are_refused(env, roles):
    sid = env.store.chat(("user", "q", None))
    env.principal = principal(roles=roles)
    for method, path in (("get", "/sessions"), ("get", f"/sessions/{sid}"),
                         ("post", f"/sessions/{sid}/continue"), ("delete", f"/sessions/{sid}")):
        assert ask(env, method, path).status_code == 403, (method, path)
    assert env.store.status(sid) == "ACTIVE"


# ── continue ─────────────────────────────────────────────────────────────

async def test_continuing_reopens_the_chat_and_retires_its_open_cards(env):
    sid = env.store.chat(("user", "Move Asha", None), card("n-open"), card("n-old", minutes=-5),
                         card("n-done", status="EXECUTED"), status="CLOSED")
    svc, me = env.service, env.principal

    # a closed chat refuses messages and its cards cannot be confirmed
    with pytest.raises(ValueError):
        await svc.send_message(sid, me, "more")
    with pytest.raises(ValueError):
        await svc.confirm_action(sid, me, "n-open", "jwt")

    assert ask(env, "post", f"/sessions/{sid}/continue").json() == {"session_id": sid, "status": "ACTIVE"}
    assert env.store.status(sid) == "ACTIVE"
    assert [c["status"] for c in env.store.cards(sid)] == ["EXPIRED", "EXPIRED", "EXECUTED"]
    assert env.store.cards(sid)[0]["retired"] == "continued"

    # the old cards stay unusable, and the used one stays used
    for nonce in ("n-open", "n-old", "n-done"):
        out = await svc.confirm_action(sid, me, nonce, "jwt")
        assert out["status"] in ("expired", "executed") and "already handled" in out["message"], nonce
    assert [c["status"] for c in env.store.cards(sid)] == ["EXPIRED", "EXPIRED", "EXECUTED"]

    # new messages go into the same chat
    assert await svc.send_message(sid, me, "And her follow-ups?") > 0
    view = ask(env, "get", f"/sessions/{sid}").json()
    assert view["is_open"] is True and view["messages"][-1]["content"] == "And her follow-ups?"
    assert [m["action"]["status"] for m in view["messages"] if m["role"] == "action"] == \
        ["expired", "expired", "executed"]


async def test_an_open_chat_continued_from_the_history_also_retires_its_cards(env):
    sid = env.store.chat(("user", "Move Asha", None), card("n-open"))
    assert ask(env, "post", f"/sessions/{sid}/continue").status_code == 200
    out = await env.service.confirm_action(sid, env.principal, "n-open", "jwt")
    assert out["status"] == "expired"


# ── delete ───────────────────────────────────────────────────────────────

async def test_a_deleted_chat_is_gone(env):
    keep = env.store.chat(("user", "keep me", None))
    sid = env.store.chat(("user", "delete me", None), card("n-open"))
    assert ask(env, "delete", f"/sessions/{sid}").json() == {"session_id": sid, "status": "DELETED"}
    assert [c["id"] for c in ask(env, "get", "/sessions").json()["items"]] == [keep]
    assert ask(env, "get", f"/sessions/{sid}").status_code == 404
    assert ask(env, "post", f"/sessions/{sid}/continue").status_code == 404
    assert ask(env, "delete", f"/sessions/{sid}").status_code == 404
    assert env.store.status(sid) == "DELETED" and env.store.cards(sid)[0]["status"] == "EXPIRED"

    svc, me = env.service, env.principal
    with pytest.raises(ValueError):
        await svc.send_message(sid, me, "more")
    with pytest.raises(ValueError):
        await svc.confirm_action(sid, me, "n-open", "jwt")
    events = [e async for e in svc.stream(sid, me)]
    assert events == [{"event": "error", "data": {"type": "ERROR", "code": 404, "message": "Session not found."}}]


def test_card_view_status_treats_an_unreadable_expiry_as_expired():
    assert asv.card_view_status({"status": "PENDING", "expires_at": "not a time"}) == "expired"
    assert asv.card_view_status({"status": "EXECUTING"}) == "applying"
    assert asv.card_view_status({"status": "DENIED"}) == "failed"
    assert asv.card_view_status({}) == "failed"


@pytest.mark.parametrize("status", ["DELETED", "deleted"])
def test_the_chat_agent_routes_treat_a_deleted_chat_as_missing(monkeypatch, status):
    from fastapi import HTTPException
    from app.routers import chat_agent

    monkeypatch.setattr(chat_agent, "check_owns_session", lambda caller, user_id: None)
    service = SimpleNamespace(get_session_identity=lambda sid: {"user_id": "u1", "institute_id": "i1", "status": status})
    with pytest.raises(HTTPException) as err:
        chat_agent._owned_session(service, "s1", SimpleNamespace(user_id="u1"))
    assert err.value.status_code == 404


def test_the_chat_agent_routes_still_serve_an_open_or_closed_chat(monkeypatch):
    from app.routers import chat_agent

    monkeypatch.setattr(chat_agent, "check_owns_session", lambda caller, user_id: None)
    for status in ("ACTIVE", "CLOSED", None):
        service = SimpleNamespace(get_session_identity=lambda sid, s=status: {"user_id": "u1", "status": s})
        assert chat_agent._owned_session(service, "s1", SimpleNamespace(user_id="u1"))["user_id"] == "u1"
