"""The learner chatbot's reply is produced inside the SSE stream
(AiChatAgentService.stream_session). A learner who closes the tab mid-reply
must not leave the question marked answered: the next stream answers it."""
from __future__ import annotations

import asyncio
import sys
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import ai_chat_agent_service as svc_mod  # noqa: E402


def _row(mid, kind):
    return SimpleNamespace(id=mid, message_type=kind, content="", meta_data={}, created_at=None)


def _service(monkeypatch, rows, turn):
    session = SimpleNamespace(user_id="u1", institute_id="i1", status="ACTIVE")
    monkeypatch.setattr(svc_mod, "ChatSessionRepository",
                        lambda db: SimpleNamespace(get_session_by_id=lambda sid: session))
    monkeypatch.setattr(svc_mod, "ChatMessageRepository", lambda db: SimpleNamespace(
        get_messages_by_session=lambda session_id=None, after_message_id=None, **kw: (
            [] if after_message_id else list(rows))))
    monkeypatch.setattr(svc_mod, "_msg_event", lambda m: {"id": m.id, "type": m.message_type})
    svc = svc_mod.AiChatAgentService.__new__(svc_mod.AiChatAgentService)
    svc._get_db = lambda: nullcontext(None)
    calls = {"claimed": [], "answered": [], "released": []}
    svc._try_claim = lambda sid, mid: calls["claimed"].append(mid) or True
    svc._mark_answered = lambda mid: calls["answered"].append(mid)
    svc._release_claim = lambda mid: calls["released"].append(mid)
    svc._still_pending = lambda mid: False
    svc._stream_agentic_processing = turn
    return svc, calls


async def _consume_until(agen, predicate):
    async for event in agen:
        if predicate(event):
            return event
    return None


def test_leaving_mid_reply_releases_the_question(monkeypatch):
    async def turn(*a, **kw):
        yield {"event": "token", "data": {"content": "Photosyn"}}
        await asyncio.sleep(60)   # the learner closes the tab here
        yield {"event": "token", "data": {"content": "thesis"}}

    svc, calls = _service(monkeypatch, [_row(1, "assistant"), _row(2, "user")], turn)

    async def run():
        agen = svc.stream_session("s1")
        assert await _consume_until(agen, lambda e: e["event"] == "token")
        await agen.aclose()

    asyncio.run(run())
    assert calls == {"claimed": [2], "answered": [], "released": [2]}


def test_a_finished_reply_marks_the_question_answered(monkeypatch):
    async def turn(*a, **kw):
        yield {"event": "message", "data": {"id": 3, "type": "assistant"}}

    svc, calls = _service(monkeypatch, [_row(2, "user")], turn)

    async def run():
        agen = svc.stream_session("s1")
        assert await _consume_until(
            agen, lambda e: e["event"] == "status" and e["data"]["ai_status"] == "idle"
            and calls["answered"])
        await agen.aclose()

    asyncio.run(run())
    assert calls == {"claimed": [2], "answered": [2], "released": []}


def test_a_question_followed_only_by_tool_rows_is_answered_on_reopen(monkeypatch):
    async def turn(*a, **kw):
        yield {"event": "message", "data": {"id": 9, "type": "assistant"}}

    rows = [_row(2, "user"), _row(3, "tool_call"), _row(4, "tool_result")]
    svc, calls = _service(monkeypatch, rows, turn)

    async def run():
        agen = svc.stream_session("s1")
        await _consume_until(agen, lambda e: bool(calls["answered"]))
        await agen.aclose()

    asyncio.run(run())
    assert calls["claimed"] == [2] and calls["answered"] == [2]


def test_a_question_with_a_visible_reply_after_it_is_not_reopened(monkeypatch):
    async def turn(*a, **kw):
        yield {"event": "message", "data": {"id": 9, "type": "assistant"}}

    rows = [_row(2, "user"), _row(3, "tool_call"), _row(4, "tool_result"), _row(5, "assistant")]
    svc, calls = _service(monkeypatch, rows, turn)

    async def run():
        agen = svc.stream_session("s1")
        await _consume_until(agen, lambda e: e["event"] == "status")
        await agen.aclose()

    asyncio.run(run())
    assert calls["claimed"] == []
