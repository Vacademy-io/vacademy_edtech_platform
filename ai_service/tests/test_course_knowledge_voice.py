"""Course knowledge on voice doubt calls (CK-11).

  * the socket marks a caller course-verified only when the auth token names
    the session's user AND lists the session's institute in its authorities;
  * search_my_course joins the voice tools only for a verified caller, on a
    tutoring / doubt call, while the institute's gate is active in mode 'on';
    otherwise the tool list and system prompt are exactly today's;
  * voice_interview and voice_oral_test never get it;
  * the tool runs on its own short sessions, never the socket's self.db;
  * the spoken tool text carries at most 3 snippets and no links.

Everything runs offline: the LLM, repositories, scope resolver and course
search are fakes.
"""
from __future__ import annotations

import asyncio
import base64
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import voice_session_service as vss  # noqa: E402
from app.services.course_knowledge import access, learner_tool, retrieval, settings_store  # noqa: E402
from app.services.course_knowledge.access import Entry, ResolvedScope  # noqa: E402
from app.services.course_knowledge.retrieval import CourseHit, CourseSearchResult, Signpost  # noqa: E402

INST = "inst-1"
USER = "user-1"
SESSION = "sess-1"
CONTEXT_META = {"slide_id": "s0", "chapter_id": "ch-1", "package_session_id": "ps-1", "tz": "Europe/London",
                "name": "Thermodynamics"}


def run(coro):
    return asyncio.run(coro)


# ── Fakes ────────────────────────────────────────────────────────────────────

class ExplodingDb:
    """The socket's long-lived session. Any use of it inside a turn fails the test."""

    def __getattr__(self, name):
        raise AssertionError(f"self.db.{name} used during a voice turn")


class FakeSessionRepo:
    def __init__(self, mode: str):
        self.session = SimpleNamespace(session_mode=mode, context_type="slide", context_meta=dict(CONTEXT_META))

    def get_session_by_id(self, session_id):
        return self.session

    def update_last_active(self, session_id):
        return None


class FakeMessageRepo:
    def __init__(self):
        self.rows: List[SimpleNamespace] = []

    def create_message(self, session_id, message_type, content, metadata=None):
        row = SimpleNamespace(id=len(self.rows) + 1, message_type=message_type, content=content, metadata=metadata)
        self.rows.append(row)
        return row

    def get_conversation_history(self, session_id, limit=10):
        return self.rows[-limit:]


class FakeSettings:
    def get_ai_settings(self, institute_id):
        return {}

    def format_rules_for_prompt(self, settings):
        return "Institute rules."

    def get_temperature(self, settings):
        return 0.4


class FakeResolver:
    async def resolve_context(self, **kw):
        return {"context_data": {"name": "Thermodynamics"}, "user_details": {"name": "Asha"}}


class FakeLLM:
    """Records every completion; replies with the queued responses in order."""

    def __init__(self, replies: Optional[List[Dict[str, Any]]] = None):
        self.calls: List[Dict[str, Any]] = []
        self.replies = list(replies or [])

    async def chat_completion(self, **kw):
        self.calls.append({"messages": [dict(m) for m in kw["messages"]], "tools": kw.get("tools")})
        if self.replies:
            return self.replies.pop(0)
        return {"content": "Sure.", "provider": "fake", "model": "fake-1"}


def make_service(mode: str = "voice_doubt", llm: Optional[FakeLLM] = None) -> vss.VoiceSessionService:
    svc = vss.VoiceSessionService(
        db_session=ExplodingDb(),
        llm_client=llm or FakeLLM(),
        institute_settings=FakeSettings(),
        context_resolver=FakeResolver(),
    )
    svc.session_repo = FakeSessionRepo(mode)
    svc.message_repo = FakeMessageRepo()
    return svc


def tool_call(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": "call-1", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def hit(i: int) -> CourseHit:
    return CourseHit(
        slide_id=f"s{i}", chunk_id=f"c{i}", source_id=f"src-s{i}", title=f"Lesson {i}", chapter_title="Heat",
        chapter_id="ch-1", package_id="pkg-1", package_session_id="ps-1", source_type="DOCUMENT",
        excerpt="spoken words here " * 40, similarity=0.9 - i * 0.01, score=0.9, tier=1,
        page_start=i + 1, page_end=i + 1, t_start_ms=None,
        href=f"/study-library/courses/course-details/subjects/modules/chapters/slides?slideId=s{i}&page={i + 1}",
        badge=f"p. {i + 1}", icon="pdf", label=f"Heat › Lesson {i} (p. {i + 1})",
    )


def scope() -> ResolvedScope:
    e = Entry(slide_id="s0", title="Lesson 0", source_type="DOCUMENT", package_id="pkg-1",
              package_session_id="ps-1", level_id="lvl-1", subject_id="sub-1", module_id="mod-1",
              chapter_id="ch-1", chapter_title="Heat", order=0, state=access.STATE_OPEN)
    return ResolvedScope(user_id=USER, institute_id=INST, tz=access.DEFAULT_TZ, drip_mode="time_exact",
                         entries={"s0": e}, open_chapter_ids=frozenset({"ch-1"}),
                         open_package_session_ids=frozenset({"ps-1"}))


@pytest.fixture
def gate(monkeypatch):
    """Sets the institute's learner gate; records every read of it."""
    state = {"gate": settings_store.LearnerGate(active=True, mode="on"), "reads": []}

    def learner_gate(inst):
        state["reads"].append(inst)
        return state["gate"]

    monkeypatch.setattr(settings_store, "learner_gate", learner_gate)
    return state


@pytest.fixture
def course(monkeypatch, gate):
    """Fake scope resolver and course search behind run_search_my_course."""
    calls: Dict[str, Any] = {}

    def resolve(db, **kw):
        calls["db"] = db
        calls["kw"] = kw
        return scope()

    async def search_course(*, scope, query, mode, **_kw):
        calls["query"] = query
        calls["mode"] = mode
        locked = Signpost(slide_id="s9", title="Heat engines", chapter_title="Heat", unlock_hint="Unlocks on 12 Nov",
                          package_id="pkg-1", package_session_id="ps-1", source_type="DOCUMENT", similarity=0.8)
        return CourseSearchResult(hits=tuple(hit(i) for i in range(6)), signposts=(locked,), mode=mode)

    monkeypatch.setattr(access, "resolve_scope", resolve)
    monkeypatch.setattr(retrieval, "search_course", search_course)
    return calls


def tool_names(tools) -> Optional[List[str]]:
    return None if tools is None else [t["function"]["name"] for t in tools]


def first_call(svc, **kw):
    run(svc.process_voice_turn(session_id=SESSION, transcript="What is entropy?", user_id=USER,
                               institute_id=INST, **kw))
    return svc.llm_client.calls[0]


# ── The tool list ────────────────────────────────────────────────────────────

def test_unverified_caller_gets_todays_tools_and_prompt(gate):
    baseline = first_call(make_service())
    assert baseline["tools"] is vss.VOICE_LEARNER_TOOLS
    assert "search_my_course" not in tool_names(baseline["tools"])
    assert vss.VOICE_COURSE_RULE.strip() not in baseline["messages"][0]["content"]
    assert gate["reads"] == []  # not even the gate is read for an unverified caller


@pytest.mark.parametrize("off", [
    settings_store.LearnerGate(active=False, mode="on"),
    settings_store.LearnerGate(active=True, mode="shadow"),
    settings_store.LearnerGate(active=False, mode="off"),
])
def test_inactive_gate_is_identical_to_today(gate, off):
    baseline = first_call(make_service())  # unverified: today's behaviour
    gate["gate"] = off
    verified = first_call(make_service(), course_verified=True)
    assert verified["tools"] is vss.VOICE_LEARNER_TOOLS
    assert verified["messages"] == baseline["messages"]
    assert gate["reads"] == [INST]


def test_gate_failure_reads_as_off(monkeypatch):
    def boom(inst):
        raise RuntimeError("settings unreadable")

    monkeypatch.setattr(settings_store, "learner_gate", boom)
    call = first_call(make_service(), course_verified=True)
    assert call["tools"] is vss.VOICE_LEARNER_TOOLS


@pytest.mark.parametrize("mode", ["voice_doubt", "text"])
def test_verified_doubt_call_with_gate_on_adds_search_my_course(gate, mode):
    call = first_call(make_service(mode), course_verified=True)
    names = tool_names(call["tools"])
    assert names == [*tool_names(vss.VOICE_LEARNER_TOOLS), "search_my_course"]
    assert call["tools"][-1] is learner_tool.SEARCH_MY_COURSE_TOOL
    prompt = call["messages"][0]["content"]
    assert prompt.endswith(vss.VOICE_TOOLS_RULE + vss.VOICE_COURSE_RULE)
    assert "call search_my_course" in prompt and "Never read out links" in prompt
    # The shared constant is never mutated.
    assert "search_my_course" not in tool_names(vss.VOICE_LEARNER_TOOLS)
    assert len(vss.VOICE_LEARNER_TOOLS) == len(vss.VOICE_LEARNER_TOOL_NAMES)


@pytest.mark.parametrize("mode", ["voice_interview", "voice_oral_test"])
def test_interview_and_oral_test_never_get_the_tool(gate, mode):
    call = first_call(make_service(mode), course_verified=True)
    assert call["tools"] is None
    assert "search_my_course" not in call["messages"][0]["content"]
    assert gate["reads"] == []


# ── Running the tool ─────────────────────────────────────────────────────────

def test_search_my_course_runs_without_self_db_and_speaks_at_most_three_snippets(course):
    llm = FakeLLM([
        {"content": None, "tool_calls": [tool_call("search_my_course", {"query": "entropy"})]},
        {"content": "That's in Lesson 0, page one.", "provider": "fake", "model": "fake-1"},
    ])
    svc = make_service(llm=llm)  # self.db explodes on any use
    result = run(svc.process_voice_turn(session_id=SESSION, transcript="What is entropy?", user_id=USER,
                                        institute_id=INST, course_verified=True))
    assert result["ai_text"] == "That's in Lesson 0, page one."

    assert course["db"] is None  # resolve_scope opened its own short session
    assert course["mode"] == retrieval.MODE_VOICE
    assert course["query"] == "entropy"
    assert course["kw"] == {"user_id": USER, "institute_id": INST, "tz": "Europe/London",
                            "hint_slide_id": "s0", "hint_chapter_id": "ch-1", "hint_package_session_id": "ps-1"}

    tool_msg = llm.calls[1]["messages"][-1]
    assert tool_msg["role"] == "tool" and tool_msg["name"] == "search_my_course"
    spoken = tool_msg["content"]
    snippets = [line for line in spoken.splitlines() if line.startswith("From ")]
    assert 1 <= len(snippets) <= 3
    for line in snippets:
        assert len(line.split(": ", 1)[1]) <= 300
    assert "http" not in spoken and "/study-library" not in spoken and "&page=" not in spoken
    assert 'Coming up, locked: "Heat engines" — Unlocks on 12 Nov' in spoken


def test_run_voice_tool_refuses_search_my_course_when_not_offered(course):
    svc = make_service()
    out = run(svc._run_voice_tool(tool_call("search_my_course", {"query": "entropy"}), USER, INST))
    assert out == "Unknown tool: search_my_course"
    assert "db" not in course


def test_run_voice_tool_drops_non_hint_context(course):
    svc = make_service()
    meta = dict(CONTEXT_META, user_id="someone-else", institute_id="inst-2")
    out = run(svc._run_voice_tool(tool_call("search_my_course", {"query": "heat"}), USER, INST,
                                  course_tool=True, context_meta=meta))
    assert out.startswith('From the lesson "Lesson 0" (p. 1): ')
    assert course["kw"]["user_id"] == USER and course["kw"]["institute_id"] == INST


def test_learner_tool_still_rechecks_the_gate(course, gate):
    gate["gate"] = settings_store.LearnerGate(active=True, mode="shadow")
    svc = make_service()
    out = run(svc._run_voice_tool(tool_call("search_my_course", {"query": "heat"}), USER, INST,
                                  course_tool=True, context_meta=CONTEXT_META))
    assert out == learner_tool.NOT_AVAILABLE_TEXT
    assert "db" not in course


# ── The socket: who counts as verified ───────────────────────────────────────

from app.routers import voice_agent  # noqa: E402


@pytest.mark.parametrize("claims,expected", [
    ({"user": USER, "authorities": {INST: {"roles": ["STUDENT"]}}}, True),
    ({"user": USER, "authorities": {INST: {"roles": []}, "inst-2": {}}}, True),
    ({"user": USER, "authorities": {"inst-2": {"roles": ["ADMIN"]}}}, False),
    ({"user": USER, "authorities": [INST]}, False),
    ({"user": USER}, False),
    ({"user": "user-2", "authorities": {INST: {}}}, False),
    ({"user": "", "authorities": {INST: {}}}, False),
    ({"authorities": {INST: {}}, "is_root_user": True}, False),
    ({"user": USER, "authorities": {}, "is_root_user": True}, False),
    (None, False),
])
def test_course_verified_rule(claims, expected):
    assert voice_agent._course_verified(claims, USER, INST) is expected


def test_course_verified_needs_session_identity():
    claims = {"user": USER, "authorities": {INST: {}}}
    assert voice_agent._course_verified(claims, None, INST) is False
    assert voice_agent._course_verified(claims, USER, None) is False


class _FakeVoiceService:
    def __init__(self):
        self.turns: List[Dict[str, Any]] = []

    def record_voice_media_usage(self, **kw):
        return None

    async def generate_opening_turn(self, **kw):
        return None

    async def process_voice_turn(self, **kw):
        self.turns.append(kw)
        return {"ai_text": "", "message_id": len(self.turns)}


@pytest.fixture
def socket_env(monkeypatch):
    service = _FakeVoiceService()
    chat_session = SimpleNamespace(user_id=USER, institute_id=INST, session_mode="voice_doubt")

    class _Repo:
        def __init__(self, db):
            pass

        def get_session_by_id(self, session_id):
            return chat_session

    class _Sarvam:
        async def speech_to_text(self, **kw):
            return "what is entropy"

    class _Db:
        def close(self):
            return None

    async def transcode(audio, mime):
        return b"\0" * 64000, "audio/wav", "ok"

    async def synth(**kw):
        return b"", "audio/wav", "sarvam"

    tokens = {
        "good": {"user": USER, "authorities": {INST: {"roles": ["STUDENT"]}}},
        "other-inst": {"user": USER, "authorities": {"inst-2": {"roles": ["STUDENT"]}}},
        "no-user": {"authorities": {INST: {}}},
    }
    monkeypatch.setattr(voice_agent, "get_sessionmaker", lambda: (lambda: _Db()))
    monkeypatch.setattr(voice_agent, "ChatSessionRepository", _Repo)
    monkeypatch.setattr(voice_agent, "_build_voice_session_service", lambda db: service)
    monkeypatch.setattr(voice_agent, "SarvamService", _Sarvam)
    monkeypatch.setattr(voice_agent, "_transcode_to_wav", transcode)
    monkeypatch.setattr(voice_agent, "trim_to_container_start", lambda audio, mime: (audio, 0))
    monkeypatch.setattr(voice_agent, "synthesize_speech", synth)
    monkeypatch.setattr(voice_agent, "decode_access_token", lambda token: tokens.get(token))
    monkeypatch.setattr(
        voice_agent, "get_platform_setting",
        lambda key, default=None, db=None: {"chatbot.voice.opening_turn": False}.get(key, default),
    )
    return service


def _one_turn(token: Optional[str]) -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(voice_agent.router)
    with TestClient(app) as client:
        with client.websocket_connect(f"/chat-agent/session/{SESSION}/voice") as ws:
            assert ws.receive_json()["type"] == "ready"
            if token is not None:
                ws.send_text(json.dumps({"type": "auth", "token": token}))
            ws.send_text(json.dumps({"type": "audio_chunk", "data": base64.b64encode(b"x" * 10).decode()}))
            ws.send_text(json.dumps({"type": "audio_end", "mime": "audio/webm"}))
            while True:
                msg = ws.receive_json()
                if msg["type"] == "audio_end":
                    break


@pytest.mark.parametrize("token,expected", [
    ("good", True),
    ("other-inst", False),
    ("no-user", False),
    (None, False),
])
def test_socket_passes_course_verified_to_every_turn(socket_env, token, expected):
    _one_turn(token)
    assert len(socket_env.turns) == 1
    assert socket_env.turns[0]["course_verified"] is expected
    assert socket_env.turns[0]["user_id"] == USER and socket_env.turns[0]["institute_id"] == INST
