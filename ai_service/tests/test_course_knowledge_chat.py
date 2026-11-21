"""Learner chatbot x course knowledge (CK-10).

Offline: the agentic loop runs against fake repositories, a scripted LLM and a
patched course scope / search, so the tests can assert exactly what the model
was given and which course reads happened:
  * an unverified caller never reaches the gate or retrieval (no token,
    another learner's token, a token for another institute, a flag sent in the
    request body);
  * a verified caller whose institute's gate is off gets today's prompt, tool
    list and institute-info search, byte for byte;
  * gate 'on' injects the COURSE MATERIAL block, swaps search_related_resources
    for search_my_course, and runs that tool with no pooled session held;
  * gate 'shadow' probes and logs but never injects;
  * the "Sources" card is stored only when the reply cites [n];
  * a mode-on prompt routes to search_my_course, a stray search_related_resources
    call searches the course, and replayed course results are withheld from any
    turn that may not read them;
  * a session opened with an initial message stamps that message too.
"""
from __future__ import annotations

import asyncio
import copy
import logging
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import chat_auth  # noqa: E402
from app.core.chat_auth import ChatCaller  # noqa: E402
from app.routers import chat_agent as router_mod  # noqa: E402
from app.schemas.chat_agent import MessageIntent  # noqa: E402
from app.services import ai_chat_agent_service as mod  # noqa: E402
from app.services.course_knowledge import (  # noqa: E402
    access, learner_tool, prompt_blocks, retrieval, settings_store,
)
from app.services.kb import retrieval as kb_retrieval  # noqa: E402
from app.services.tool_manager_service import TOOL_DEFINITIONS  # noqa: E402

INST = "inst-1"
USER = "learner-1"
SESSION = "sess-1"
QUESTION = "How does photosynthesis make glucose?"


# ── fakes ────────────────────────────────────────────────────────────────────

class FakeMsg:
    def __init__(self, mid: int, session_id: str, message_type: str, content: str, meta: Optional[dict]):
        self.id = mid
        self.session_id = session_id
        self.message_type = message_type
        self.content = content
        self.meta_data = meta
        self.created_at = datetime.now(timezone.utc)


class World:
    """The fake database: messages, plus how many pooled sessions are open."""

    def __init__(self, user_meta: Optional[dict] = None):
        self.messages: List[FakeMsg] = []
        self.open = 0
        self.session = SimpleNamespace(
            id=SESSION, user_id=USER, institute_id=INST, status="ACTIVE",
            context_type="slide", context_meta={"slide_id": "s1", "tz": "Asia/Kolkata"},
        )
        if user_meta is not None:
            self.add("user", QUESTION, user_meta or None)

    def add(self, mtype: str, content: str, meta: Optional[dict]) -> FakeMsg:
        msg = FakeMsg(len(self.messages) + 1, SESSION, mtype, content, meta)
        self.messages.append(msg)
        return msg

    @contextmanager
    def db(self):
        self.open += 1
        try:
            yield SimpleNamespace(get=lambda _cls, mid: next((m for m in self.messages if m.id == mid), None))
        finally:
            self.open -= 1

    def of_type(self, mtype: str) -> List[FakeMsg]:
        return [m for m in self.messages if m.message_type == mtype]


class ScriptedLLM:
    """chat_completion_stream that replays steps and records what it was sent."""

    def __init__(self, steps: List[dict]):
        self.steps = list(steps)
        self.calls: List[dict] = []

    async def chat_completion_stream(self, *, messages, tools, **_kw):
        self.calls.append({"messages": copy.deepcopy(messages), "tools": tools})
        step = self.steps.pop(0) if self.steps else {"content": "ok"}
        if step.get("content"):
            yield {"type": "token", "content": step["content"]}
        if step.get("tool_calls"):
            yield {"type": "tool_calls", "tool_calls": step["tool_calls"]}
        yield {"type": "done", "usage": None}


def _tool_call(name: str, args: str, cid: str = "call-1") -> dict:
    return {"id": cid, "type": "function", "function": {"name": name, "arguments": args}}


def _hit(n: int = 1, page: int = 3) -> retrieval.CourseHit:
    return retrieval.CourseHit(
        slide_id=f"s{n}", chunk_id=f"c{n}", source_id=f"src{n}", title=f"Lesson {n}",
        chapter_title="Plants", chapter_id="ch1", package_id="pkg1", package_session_id="ps1",
        source_type="DOCUMENT", excerpt=f"Chlorophyll captures light energy ({n}).",
        similarity=0.71, score=0.9, tier=1, page_start=page, page_end=page, t_start_ms=None,
        href=f"/study-library/courses/course-details/subjects/modules/chapters/slides?slideId=s{n}&page={page}",
        badge=f"p. {page}", icon="pdf", label=f"Plants › Lesson {n} (p. {page})",
    )


def _result(mode: str = retrieval.MODE_AMBIENT, hits: int = 2) -> retrieval.CourseSearchResult:
    return retrieval.CourseSearchResult(
        hits=tuple(_hit(i, page=i + 2) for i in range(1, hits + 1)), latency_ms=12, mode=mode,
    )


class Course:
    """Patched gate, scope and search, recording every call."""

    def __init__(self, monkeypatch, world: World, *, active: bool, mode: str, result_hits: int = 2):
        self.world = world
        self.gate_calls: List[str] = []
        self.scope_calls: List[dict] = []
        self.searches: List[dict] = []
        self.result_hits = result_hits

        def gate(inst):
            self.gate_calls.append(inst)
            return settings_store.LearnerGate(active=active, mode=mode)

        def resolve_scope(db, **kw):
            assert db is None, "the scope must open its own session"
            self.scope_calls.append(kw)
            return SimpleNamespace(is_empty=False, open_ids=lambda: ["s1", "s2"])

        async def search_course(*, scope, query, mode, **_kw):
            # A held pooled session here would be the 2026-08-19 pool exhaustion.
            self.searches.append({"query": query, "mode": mode, "open": self.world.open})
            return _result(mode, self.result_hits)

        monkeypatch.setattr(settings_store, "learner_gate", gate)
        monkeypatch.setattr(access, "resolve_scope", resolve_scope)
        monkeypatch.setattr(retrieval, "search_course", search_course)

    @property
    def touched(self) -> bool:
        return bool(self.gate_calls or self.scope_calls or self.searches)


@pytest.fixture
def patched(monkeypatch):
    """Everything Phase 1 reads, faked; returns a builder for one service run."""
    kb_calls: List[dict] = []

    def build(world: World, llm: ScriptedLLM) -> mod.AiChatAgentService:
        class SessionRepo:
            def __init__(self, db):
                pass

            def get_session_by_id(self, sid):
                return world.session if sid == SESSION else None

            def update_last_active(self, sid):
                return None

        class MessageRepo:
            def __init__(self, db):
                pass

            def create_message(self, session_id, message_type, content, metadata=None):
                return world.add(message_type, content, metadata)

            def get_latest_message(self, sid):
                return world.messages[-1] if world.messages else None

            def find_by_idempotency_key(self, sid, key):
                return None

        class ContextResolver:
            def __init__(self, db):
                pass

            async def resolve_context(self, *a, **kw):
                return {"user_details": {"name": "Asha"}}

        class ContextWindow:
            def __init__(self, db, repo, client):
                pass

            def get_optimized_history(self, sid):
                return [{"role": "user", "content": QUESTION}]

            def should_summarize(self, sid):
                return False

        class InstSettings:
            def __init__(self, db):
                pass

            def get_ai_settings(self, inst):
                return {}

            def format_rules_for_prompt(self, s):
                return "You are Tutor, a helpful assistant."

            def get_temperature(self, s):
                return 0.3

        class KbRetrieval:
            def __init__(self, db):
                pass

            async def search_institute(self, **kw):
                kb_calls.append(kw)
                return []

        class NoToolManager:
            def __init__(self, *a, **kw):
                raise AssertionError("search_my_course must not go through ToolManagerService")

        monkeypatch.setattr(mod, "ChatSessionRepository", SessionRepo)
        monkeypatch.setattr(mod, "ChatMessageRepository", MessageRepo)
        monkeypatch.setattr(mod, "ContextResolverService", ContextResolver)
        monkeypatch.setattr(mod, "ContextWindowService", ContextWindow)
        monkeypatch.setattr(mod, "InstituteSettingsService", InstSettings)
        monkeypatch.setattr(mod, "LearningAnalyticsService", lambda db: SimpleNamespace(track_doubt=lambda **kw: None))
        monkeypatch.setattr(mod, "ToolManagerService", NoToolManager)
        monkeypatch.setattr(kb_retrieval, "KbRetrievalService", KbRetrieval)

        svc = mod.AiChatAgentService.__new__(mod.AiChatAgentService)
        svc._db_factory = world.db
        svc._active_quizzes = {}
        svc.intent_classifier = SimpleNamespace(
            classify=lambda message, explicit_intent=None: explicit_intent or MessageIntent.GENERAL,
            get_practice_topic=lambda *a: "photosynthesis",
        )
        svc._resolve_keys = lambda db, i, u: ("key",)
        svc._make_llm_client = lambda keys: llm
        svc._refresh_claim = lambda mid: None
        svc._record_token_usage = lambda *a, **kw: None
        return svc

    build.kb_calls = kb_calls
    return build


def _run(svc: mod.AiChatAgentService) -> List[dict]:
    async def go():
        events = [e async for e in svc._stream_agentic_processing(SESSION, USER, INST)]
        # Let detached shadow probes finish before the loop closes.
        if mod._SHADOW_TASKS:
            await asyncio.gather(*list(mod._SHADOW_TASKS))
        return events

    return asyncio.run(go())


def _tool_names(tools) -> List[str]:
    return [t["function"]["name"] for t in tools or []]


# ── 1. who counts as verified (router) ───────────────────────────────────────

IDENTITY = {"user_id": USER, "institute_id": INST, "status": "ACTIVE"}


@pytest.mark.parametrize("caller, expected", [
    (ChatCaller(anonymous_reason="missing"), False),                                # no token
    (ChatCaller(anonymous_reason="invalid"), False),                                # expired token
    (ChatCaller(user_id="someone-else", institute_ids=frozenset({INST})), False),   # another learner
    (ChatCaller(user_id=USER, institute_ids=frozenset({"other-inst"})), False),     # another institute
    (ChatCaller(user_id=USER, institute_ids=frozenset()), False),
    (ChatCaller(user_id=USER, institute_ids=frozenset({INST, "x"})), True),
])
def test_caller_verified_needs_token_same_user_and_member_institute(caller, expected):
    assert router_mod._caller_verified(caller, IDENTITY) is expected


def test_caller_verified_never_matches_an_empty_identity():
    caller = ChatCaller(user_id=USER, institute_ids=frozenset({INST}))
    assert router_mod._caller_verified(caller, {"user_id": None, "institute_id": None}) is False
    assert router_mod._caller_verified(caller, {"user_id": USER, "institute_id": ""}) is False


# ── 2. the router passes the flag; the body cannot set it ────────────────────

class RecordingService:
    def __init__(self):
        self.sent: List[dict] = []

    def get_session_identity(self, sid):
        return dict(IDENTITY)

    async def send_message(self, **kw):
        self.sent.append(kw)
        return 7, "idle"

    async def create_session(self, **kw):
        self.sent.append(kw)
        return SESSION, "idle"


def _client(monkeypatch, caller: ChatCaller, service: RecordingService):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    monkeypatch.setattr(chat_auth, "require_auth_enabled", lambda: False)  # shadow: violations served
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[router_mod.get_chat_agent_service] = lambda: service
    app.dependency_overrides[router_mod.get_chat_caller] = lambda: caller
    return TestClient(app)


@pytest.mark.parametrize("caller, expected", [
    (ChatCaller(anonymous_reason="missing"), False),
    (ChatCaller(user_id="someone-else", institute_ids=frozenset({INST})), False),
    (ChatCaller(user_id=USER, institute_ids=frozenset({"other-inst"})), False),
    (ChatCaller(user_id=USER, institute_ids=frozenset({INST})), True),
])
def test_send_message_route_stamps_from_the_token_not_the_body(monkeypatch, caller, expected):
    service = RecordingService()
    client = _client(monkeypatch, caller, service)
    body = {"message": "hi", "caller_verified": True, "metadata": {"caller_verified": True}}
    resp = client.post(f"/chat-agent/session/{SESSION}/message", json=body)
    assert resp.status_code == 200, resp.text
    (kw,) = service.sent
    assert kw["caller_verified"] is expected


def test_audio_route_passes_the_flag_when_auto_sending(monkeypatch):
    from app.services import audio_utils

    async def transcode(data, ctype):
        return b"wav", "audio/wav", None

    class Sarvam:
        async def speech_to_text(self, **kw):
            return QUESTION

    monkeypatch.setattr(audio_utils, "transcode_to_wav", transcode)
    monkeypatch.setattr(router_mod, "SarvamService", Sarvam)
    for caller, expected in (
        (ChatCaller(anonymous_reason="missing"), False),
        (ChatCaller(user_id=USER, institute_ids=frozenset({INST})), True),
    ):
        service = RecordingService()
        client = _client(monkeypatch, caller, service)
        resp = client.post(
            f"/chat-agent/session/{SESSION}/audio-message",
            files={"file": ("a.webm", b"audio", "audio/webm")},
            data={"auto_send": "true", "caller_verified": "true"},
        )
        assert resp.status_code == 200, resp.text
        (kw,) = service.sent
        assert kw["caller_verified"] is expected


# ── 3. the service stamps only from the keyword argument ─────────────────────

def test_service_stamps_caller_verified_only_when_told(patched):
    world = World()
    svc = patched(world, ScriptedLLM([]))

    asyncio.run(svc.send_message(session_id=SESSION, message="hi"))
    asyncio.run(svc.send_message(
        session_id=SESSION, message="hi",
        attachments=[{"type": "video", "url": "https://x/v.mp4", "caller_verified": True}],
    ))
    asyncio.run(svc.send_message(session_id=SESSION, message="hi", caller_verified="yes"))  # type: ignore[arg-type]
    asyncio.run(svc.send_message(session_id=SESSION, message="hi", caller_verified=True))
    first, second, third, fourth = world.of_type("user")
    assert not (first.meta_data or {}).get("caller_verified")
    assert "caller_verified" not in (second.meta_data or {})  # only nested in the attachment
    assert not (third.meta_data or {}).get("caller_verified")
    assert fourth.meta_data == {"caller_verified": True}


# ── 4. unverified turns never reach course knowledge ─────────────────────────

@pytest.mark.parametrize("meta", [
    {},                                   # anonymous / mismatched: nothing stamped
    {"caller_verified": False},
    {"caller_verified": "true"},          # not a server stamp
    {"caller_verified": 1},
])
def test_unverified_turn_never_calls_gate_or_retrieval(monkeypatch, patched, meta):
    world = World(user_meta=meta)
    course = Course(monkeypatch, world, active=True, mode="on")
    llm = ScriptedLLM([{"content": "Plants use light [1]."}])
    _run(patched(world, llm))
    assert not course.touched
    assert llm.calls[0]["tools"] is TOOL_DEFINITIONS
    assert prompt_blocks.COURSE_HEADER not in llm.calls[0]["messages"][0]["content"]
    assert not world.of_type("card")


# ── 5. gate off: today's chatbot exactly ─────────────────────────────────────

def test_verified_with_gate_off_is_identical_to_today(monkeypatch, patched):
    baseline_world = World(user_meta={})
    Course(monkeypatch, baseline_world, active=False, mode="off")
    baseline = ScriptedLLM([{"content": "Answer [1]."}])
    _run(patched(baseline_world, baseline))
    baseline_kb = list(patched.kb_calls)

    for active, mode in ((False, "off"), (False, "on"), (False, "shadow"), (True, "off")):
        patched.kb_calls.clear()
        world = World(user_meta={"caller_verified": True})
        course = Course(monkeypatch, world, active=active, mode=mode)
        llm = ScriptedLLM([{"content": "Answer [1]."}])
        _run(patched(world, llm))
        assert course.gate_calls == [INST]
        assert not course.scope_calls and not course.searches
        assert llm.calls[0]["tools"] is TOOL_DEFINITIONS
        assert llm.calls[0]["messages"] == baseline.calls[0]["messages"]
        assert patched.kb_calls == baseline_kb  # the institute_info search is unchanged
        assert [m.message_type for m in world.messages] == [m.message_type for m in baseline_world.messages]
        assert not world.of_type("card")


def test_gate_failure_means_no_course_context(monkeypatch, patched):
    world = World(user_meta={"caller_verified": True})

    def boom(inst):
        raise RuntimeError("settings store down")

    monkeypatch.setattr(settings_store, "learner_gate", boom)
    llm = ScriptedLLM([{"content": "Answer."}])
    events = _run(patched(world, llm))
    assert llm.calls[0]["tools"] is TOOL_DEFINITIONS
    assert prompt_blocks.COURSE_HEADER not in llm.calls[0]["messages"][0]["content"]
    assert not [e for e in events if e["event"] == "error"]
    assert world.of_type("assistant")[-1].content == "Answer."


# ── 6. gate on: block injected, tool swapped, tool runs without a held session ─

def test_mode_on_injects_block_offers_tool_and_runs_it_without_a_held_session(monkeypatch, patched):
    world = World(user_meta={"caller_verified": True})
    course = Course(monkeypatch, world, active=True, mode="on")
    llm = ScriptedLLM([
        {"tool_calls": [_tool_call(learner_tool.TOOL_NAME, '{"query": "light reactions"}')]},
        {"content": "Chlorophyll captures light [1]."},
    ])
    events = _run(patched(world, llm))

    # Ambient block, next to (after) the unchanged institute-info context.
    prompt = llm.calls[0]["messages"][0]["content"]
    assert prompt_blocks.COURSE_HEADER in prompt and "Chlorophyll captures light energy (1)." in prompt
    assert course.searches[0]["mode"] == retrieval.MODE_AMBIENT and course.searches[0]["query"] == QUESTION
    assert course.scope_calls[0]["hint_slide_id"] == "s1" and course.scope_calls[0]["tz"] == "Asia/Kolkata"

    # Tool list: search_my_course replaces search_related_resources; the rest stay, in order.
    names = _tool_names(llm.calls[0]["tools"])
    expected = [learner_tool.TOOL_NAME if n == "search_related_resources" else n for n in _tool_names(TOOL_DEFINITIONS)]
    assert names == expected
    assert "search_related_resources" in _tool_names(TOOL_DEFINITIONS)  # the shared list is untouched

    # The tool ran through learner_tool, with no pooled session open at the time.
    tool_search = [s for s in course.searches if s["mode"] == retrieval.MODE_TOOL]
    assert tool_search == [{"query": "light reactions", "mode": retrieval.MODE_TOOL, "open": 0}]
    (result_msg,) = world.of_type("tool_result")
    assert result_msg.meta_data["tool_name"] == learner_tool.TOOL_NAME
    assert "light reactions" in result_msg.content
    tool_cards = [m for m in world.of_type("card") if m.meta_data["tool_name"] == learner_tool.TOOL_NAME]
    assert len(tool_cards) == 1 and tool_cards[0].meta_data["card"]["title"] == prompt_blocks.RESULTS_TITLE
    assert llm.calls[1]["messages"][-1]["role"] == "tool"

    # The reply cited [1]: a Sources card after it, built from the ambient result.
    sources = [m for m in world.of_type("card") if m.meta_data["tool_name"] == "course_sources"]
    assert len(sources) == 1
    card = sources[0].meta_data["card"]
    assert card["kind"] == "link_list" and card["title"] == prompt_blocks.SOURCES_TITLE
    assert [i["title"] for i in card["items"]] == ["Lesson 1"]
    assert card["items"][0]["href"].endswith("&page=3")
    assert sources[0].content.startswith("**Sources**")
    assert world.messages[-1] is sources[0]
    assert events[-1]["data"]["id"] == sources[0].id


def test_tool_never_holds_a_session_even_if_db_is_forbidden(monkeypatch, patched):
    """The fake _get_db raises while search_my_course runs: the turn still works."""
    world = World(user_meta={"caller_verified": True})
    course = Course(monkeypatch, world, active=True, mode="on")
    real_run = learner_tool.run_search_my_course
    forbidden = {"on": False}
    real_db = world.db

    @contextmanager
    def guarded_db():
        if forbidden["on"]:
            raise AssertionError("_get_db used during search_my_course")
        with real_db() as db:
            yield db

    async def watched_run(**kw):
        assert world.open == 0
        forbidden["on"] = True
        try:
            return await real_run(**kw)
        finally:
            forbidden["on"] = False

    monkeypatch.setattr(learner_tool, "run_search_my_course", watched_run)
    llm = ScriptedLLM([
        {"tool_calls": [_tool_call(learner_tool.TOOL_NAME, '{"query": "stomata"}')]},
        {"content": "Done."},
    ])
    svc = patched(world, llm)
    svc._db_factory = guarded_db
    _run(svc)
    assert [s["mode"] for s in course.searches] == [retrieval.MODE_AMBIENT, retrieval.MODE_TOOL]
    assert world.of_type("tool_result")[0].content != learner_tool.FAILED_TEXT
    assert world.of_type("assistant")[-1].content == "Done."


def test_mode_on_without_course_hits_still_swaps_tool_but_injects_nothing(monkeypatch, patched):
    world = World(user_meta={"caller_verified": True})
    Course(monkeypatch, world, active=True, mode="on", result_hits=0)
    llm = ScriptedLLM([{"content": "Not in your course yet [1]."}])
    _run(patched(world, llm))
    assert prompt_blocks.COURSE_HEADER not in llm.calls[0]["messages"][0]["content"]
    assert learner_tool.TOOL_NAME in _tool_names(llm.calls[0]["tools"])
    assert not world.of_type("card")  # nothing was injected, so nothing to cite


# ── 7. shadow never injects ──────────────────────────────────────────────────

def test_shadow_mode_probes_and_logs_but_never_injects(monkeypatch, patched, caplog):
    baseline_world = World(user_meta={})
    Course(monkeypatch, baseline_world, active=False, mode="off")
    baseline = ScriptedLLM([{"content": "Answer [1]."}])
    _run(patched(baseline_world, baseline))

    world = World(user_meta={"caller_verified": True})
    course = Course(monkeypatch, world, active=True, mode="shadow")
    from app.services.course_knowledge import shadow_events
    kept = []
    monkeypatch.setattr(shadow_events, "record", lambda **kw: kept.append(kw) or True)
    llm = ScriptedLLM([{"content": "Answer [1]."}])
    with caplog.at_level(logging.INFO, logger=mod.logger.name):
        _run(patched(world, llm))

    assert llm.calls[0]["messages"] == baseline.calls[0]["messages"]
    assert llm.calls[0]["tools"] is TOOL_DEFINITIONS
    assert not world.of_type("card")
    assert course.searches == [{"query": QUESTION, "mode": retrieval.MODE_AMBIENT, "open": 0}]
    shadow_logs = [r.getMessage() for r in caplog.records if "course_kb.shadow" in r.getMessage()]
    assert len(shadow_logs) == 1
    assert "hits=2" in shadow_logs[0] and "top=0.710" in shadow_logs[0] and "latency_ms=12" in shadow_logs[0]
    assert "signposts=0" in shadow_logs[0]
    # The same numbers are kept as a row (pod logs reset on every deploy).
    assert len(kept) == 1 and kept[0]["hits"] == 2 and kept[0]["latency_ms"] == 12
    assert kept[0]["institute_id"] == "inst-1" and kept[0]["session_id"] == "sess-1" and kept[0]["error"] is None
    assert not mod._SHADOW_TASKS


def test_shadow_probe_failure_is_swallowed(monkeypatch, patched, caplog):
    world = World(user_meta={"caller_verified": True})
    Course(monkeypatch, world, active=True, mode="shadow")

    async def broken(**kw):
        raise RuntimeError("vector index offline")

    monkeypatch.setattr(retrieval, "search_course", broken)
    from app.services.course_knowledge import shadow_events
    kept = []
    monkeypatch.setattr(shadow_events, "record", lambda **kw: kept.append(kw) or True)
    llm = ScriptedLLM([{"content": "Answer."}])
    with caplog.at_level(logging.WARNING, logger=mod.logger.name):
        events = _run(patched(world, llm))
    assert world.of_type("assistant")[-1].content == "Answer."
    assert not [e for e in events if e["event"] == "error"]
    assert any("course_kb.shadow probe failed" in r.getMessage() for r in caplog.records)
    assert [k["error"] for k in kept] == ["probe_failed"]


# ── 8. the Sources card needs [n] markers ────────────────────────────────────

@pytest.mark.parametrize("reply, titles", [
    ("Light is captured by chlorophyll.", None),          # no markers
    ("See [the lesson](/x) for more.", None),             # a markdown link, not a citation
    ("Only [9] which does not exist.", None),             # cited a number that is not there
    ("Light [2] and sugar [1][2].", ["Lesson 1", "Lesson 2"]),
    ("Both [1, 2].", ["Lesson 1", "Lesson 2"]),
])
def test_sources_card_only_when_reply_cites(monkeypatch, patched, reply, titles):
    world = World(user_meta={"caller_verified": True})
    Course(monkeypatch, world, active=True, mode="on")
    llm = ScriptedLLM([{"content": reply}])
    _run(patched(world, llm))
    cards = world.of_type("card")
    if titles is None:
        assert not cards
        assert world.messages[-1].message_type == "assistant"
    else:
        (card_msg,) = cards
        assert card_msg.meta_data["tool_name"] == "course_sources"
        assert [i["title"] for i in card_msg.meta_data["card"]["items"]] == titles
        assert world.messages[-2].message_type == "assistant"


def test_quiz_submission_and_practice_skip_course_context(monkeypatch, patched):
    world = World(user_meta={"caller_verified": True, "intent": MessageIntent.PRACTICE.value})
    course = Course(monkeypatch, world, active=True, mode="on")
    svc = patched(world, ScriptedLLM([]))

    async def fake_practice(*a, **kw):
        yield {"event": "message", "data": {"practice": True}}

    async def fake_quiz(*a, **kw):
        yield {"event": "message", "data": {"quiz": True}}

    svc._handle_practice_request = fake_practice
    svc._handle_quiz_submission = fake_quiz
    assert _run(svc) == [{"event": "message", "data": {"practice": True}}]

    world2 = World(user_meta={"caller_verified": True, "quiz_submission": {"answers": []}})
    svc2 = patched(world2, ScriptedLLM([]))
    svc2._handle_quiz_submission = fake_quiz
    assert _run(svc2) == [{"event": "message", "data": {"quiz": True}}]
    assert not course.touched


# ── 9. prompt routing, stray generic search, replayed course text ────────────

def test_constants_match_the_prompt_and_the_tool():
    assert mod._COURSE_TOOL_NAME == learner_tool.TOOL_NAME
    svc = mod.AiChatAgentService.__new__(mod.AiChatAgentService)
    prompt = svc._build_system_prompt("", {}, USER, INST, is_greeting=False)
    assert mod._RESOURCE_SEARCH_GUIDANCE in prompt
    swapped = mod._with_course_tool_guidance(prompt)
    assert mod._COURSE_SEARCH_GUIDANCE in swapped and "search_related_resources" not in swapped
    # A prompt without the generic line still gets the course line.
    assert mod._with_course_tool_guidance("Rules.").endswith(mod._COURSE_SEARCH_GUIDANCE)


def test_mode_on_prompt_routes_to_search_my_course_even_without_hits(monkeypatch, patched):
    world = World(user_meta={"caller_verified": True})
    Course(monkeypatch, world, active=True, mode="on", result_hits=0)
    llm = ScriptedLLM([{"content": "Let me look."}])
    _run(patched(world, llm))
    prompt = llm.calls[0]["messages"][0]["content"]
    assert prompt_blocks.COURSE_HEADER not in prompt
    assert "→ search_my_course" in prompt
    assert "search_related_resources" not in prompt


def test_gate_off_prompt_keeps_the_generic_routing_line(monkeypatch, patched):
    world = World(user_meta={"caller_verified": True})
    Course(monkeypatch, world, active=True, mode="off")
    llm = ScriptedLLM([{"content": "Answer."}])
    _run(patched(world, llm))
    prompt = llm.calls[0]["messages"][0]["content"]
    assert mod._RESOURCE_SEARCH_GUIDANCE in prompt and "search_my_course" not in prompt


def test_mode_on_stray_generic_search_searches_the_course(monkeypatch, patched):
    """search_related_resources is not offered on a mode-on turn; a call to it
    from memory runs the course search (no ToolManagerService, no held session)."""
    world = World(user_meta={"caller_verified": True})
    course = Course(monkeypatch, world, active=True, mode="on")
    llm = ScriptedLLM([
        {"tool_calls": [_tool_call("search_related_resources", '{"topic": "stomata"}')]},
        {"content": "Done."},
    ])
    events = _run(patched(world, llm))  # the fixture's ToolManagerService raises if built
    assert not [e for e in events if e["event"] == "error"]
    tool_search = [s for s in course.searches if s["mode"] == retrieval.MODE_TOOL]
    assert tool_search == [{"query": "stomata", "mode": retrieval.MODE_TOOL, "open": 0}]
    (result_msg,) = world.of_type("tool_result")
    assert result_msg.meta_data["tool_name"] == "search_related_resources"
    assert "stomata" in result_msg.content
    assert world.of_type("assistant")[-1].content == "Done."


COURSE_TEXT = "Passage: chlorophyll absorbs red and blue light."


def _history_with_course_result(monkeypatch):
    history = [
        {"role": "user", "content": "earlier question"},
        {"role": "assistant", "content": None, "tool_calls": [{
            "id": "old-1", "type": "function",
            "function": {"name": learner_tool.TOOL_NAME, "arguments": "{}"},
        }]},
        {"role": "tool", "tool_call_id": "old-1", "name": learner_tool.TOOL_NAME, "content": COURSE_TEXT},
        {"role": "assistant", "content": None, "tool_calls": [{
            "id": "old-2", "type": "function",
            "function": {"name": "get_my_courses", "arguments": "{}"},
        }]},
        {"role": "tool", "tool_call_id": "old-2", "name": "get_my_courses", "content": "Biology 101"},
        {"role": "user", "content": QUESTION},
    ]

    class ContextWindow:
        def __init__(self, db, repo, client):
            pass

        def get_optimized_history(self, sid):
            return copy.deepcopy(history)

    monkeypatch.setattr(mod, "ContextWindowService", ContextWindow)
    return history


@pytest.mark.parametrize("meta, active, mode", [
    ({}, True, "on"),                         # unverified caller (shadow auth, no token)
    ({"caller_verified": True}, True, "off"), # kill switch
    ({"caller_verified": True}, False, "on"), # institute turned the feature off
    ({"caller_verified": True}, True, "shadow"),
])
def test_replayed_course_results_are_withheld_when_the_turn_may_not_read_them(
    monkeypatch, patched, meta, active, mode,
):
    world = World(user_meta=meta)
    Course(monkeypatch, world, active=active, mode=mode)
    llm = ScriptedLLM([{"content": "Answer."}])
    svc = patched(world, llm)
    history = _history_with_course_result(monkeypatch)
    _run(svc)
    sent = llm.calls[0]["messages"][1:]
    assert len(sent) == len(history)
    assert all(COURSE_TEXT not in str(m.get("content")) for m in sent)
    course_tool_msg = next(m for m in sent if m.get("name") == learner_tool.TOOL_NAME)
    assert course_tool_msg["content"] == mod._COURSE_RESULT_WITHHELD
    assert course_tool_msg["tool_call_id"] == "old-1"  # the pair stays intact
    assert next(m for m in sent if m.get("name") == "get_my_courses")["content"] == "Biology 101"


def test_replayed_course_results_kept_on_a_mode_on_verified_turn(monkeypatch, patched):
    world = World(user_meta={"caller_verified": True})
    Course(monkeypatch, world, active=True, mode="on")
    llm = ScriptedLLM([{"content": "Answer."}])
    svc = patched(world, llm)
    history = _history_with_course_result(monkeypatch)
    _run(svc)
    assert llm.calls[0]["messages"][1:] == history


# ── 10. a session opened with an initial message ─────────────────────────────

@pytest.mark.parametrize("caller, expected", [
    (ChatCaller(anonymous_reason="missing"), False),
    (ChatCaller(user_id="someone-else", institute_ids=frozenset({INST})), False),
    (ChatCaller(user_id=USER, institute_ids=frozenset({"other-inst"})), False),
    (ChatCaller(user_id=USER, institute_ids=frozenset({INST})), True),
])
def test_init_session_route_stamps_from_the_token_not_the_body(monkeypatch, caller, expected):
    service = RecordingService()
    client = _client(monkeypatch, caller, service)
    body = {
        "user_id": USER, "institute_id": INST, "initial_message": QUESTION,
        "caller_verified": True, "context_meta": {"caller_verified": True},
    }
    resp = client.post("/chat-agent/session/init", json=body)
    assert resp.status_code == 200, resp.text
    (kw,) = service.sent
    assert kw["caller_verified"] is expected


def test_create_session_stamps_the_initial_message_only_when_told(monkeypatch, patched):
    class SessionRepo:
        def __init__(self, db):
            pass

        def create_session(self, **kw):
            return SimpleNamespace(id=SESSION)

    world = World()
    svc = patched(world, ScriptedLLM([]))
    monkeypatch.setattr(mod, "ChatSessionRepository", SessionRepo)
    asyncio.run(svc.create_session(USER, INST, initial_message="hi"))
    asyncio.run(svc.create_session(USER, INST, initial_message="hi", caller_verified="yes"))  # type: ignore[arg-type]
    asyncio.run(svc.create_session(USER, INST, initial_message="hi", caller_verified=True))
    first, second, third = world.of_type("user")
    assert first.meta_data is None and second.meta_data is None
    assert third.meta_data == {"caller_verified": True}
