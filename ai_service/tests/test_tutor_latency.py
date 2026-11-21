"""Tutor reply latency (review 2026-11-21).

A. The decision streams: `say` is handed over as soon as it is complete.
B. Smallest is asked for mp3 (same speed, a third of the bytes).
"""
from __future__ import annotations

import asyncio

from app.services import voice_tts
from app.services.tutor.runtime import decision


# ── A. early say ─────────────────────────────────────────────────────────────

def test_early_say_waits_for_the_closing_quote():
    assert decision.early_say('{"action": "remediate", "say": "Good try! The right') is None
    assert decision.early_say('{"action": "remediate", "say": "Good try! Say it again.", "board') == \
        "Good try! Say it again."


def test_early_say_unescapes_quotes_and_unicode():
    raw = '{"action":"advance","say":"He said \\"yes\\" \\u2014 right.","board_ops":[]}'
    assert decision.early_say(raw) == 'He said "yes" — right.'


def test_early_say_none_without_say():
    assert decision.early_say('{"action": "advance"') is None


class _StreamClient:
    def __init__(self, pieces, usage=None):
        self.pieces, self.usage, self.seen = pieces, usage, []

    async def chat_completion_stream(self, messages, **kw):
        for p in self.pieces:
            self.seen.append(p)
            yield {"type": "token", "content": p}
        yield {"type": "done", "usage": self.usage, "model": "z-ai/glm-5.3-flash"}


def test_streamed_completion_hands_say_over_before_the_end():
    pieces = ['{"action": "remediate", ', '"say": "Close! ', 'Try once more."', ', "board_ops": [', '], "assessment": {}}']
    client = _StreamClient(pieces, usage={"prompt_tokens": 1200, "completion_tokens": 150})
    calls = []
    out = asyncio.run(decision._streamed_completion(
        client, [], lambda s: calls.append((s, len(client.seen))), institute_id="i", user_id="u", model=None))
    assert calls == [("Close! Try once more.", 3)]          # after the 3rd piece, not at the end
    assert out["content"] == "".join(pieces)
    assert out["usage"] == {"prompt_tokens": 1200, "completion_tokens": 150}
    assert out["model"] == "z-ai/glm-5.3-flash"


def test_streamed_completion_survives_a_failing_callback():
    client = _StreamClient(['{"say": "Hi."}'])

    def boom(_s):
        raise RuntimeError("socket gone")
    out = asyncio.run(decision._streamed_completion(client, [], boom, institute_id="i", user_id="u", model=None))
    assert out["content"] == '{"say": "Hi."}' and out["usage"] == {}


# ── B. Smallest mp3 ──────────────────────────────────────────────────────────

def test_smallest_asks_for_mp3(monkeypatch):
    sent = {}

    class _Resp:
        status_code = 200
        content = b"ID3mp3"
        text = ""

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            sent.update(json)
            return _Resp()

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    monkeypatch.setenv("SMALLEST_API_KEY", "k")
    audio, mime = asyncio.run(voice_tts._smallest("Hello.", "en-IN", "advika"))
    assert sent["output_format"] == "mp3" and mime == "audio/mpeg" and audio == b"ID3mp3"


# ── C. the socket: first sentence alone, shared with the early start ─────────

import json  # noqa: E402

import pytest  # noqa: E402

from tests.test_tutor_natural_runtime import _auth, _frames_until, _socket  # noqa: E402
from app.routers import tutor_ws  # noqa: E402

REPLY = "Close! Try once more. You are nearly there."


@pytest.fixture(autouse=True)
def _fresh_tts_cache():
    """The socket's audio cache is module-wide: never leave real bytes behind
    for other tests (their timing depends on a slow first line)."""
    tutor_ws._TTS_CACHE.clear()
    yield
    tutor_ws._TTS_CACHE.clear()


# (tts seconds, model seconds after `say`): the early start finished before
# the teacher speaks (memory hit), or is still running (joined in flight).
@pytest.mark.parametrize("tts_s,model_s", [(0.05, 0.2), (0.4, 0.0)])
def test_reply_first_sentence_is_voiced_alone_and_once(monkeypatch, tts_s, model_s):
    client, calls = _socket(monkeypatch, natural=False, mode="VOICE")
    spoken = []

    async def tts(**kw):
        spoken.append(kw["text"])
        await asyncio.sleep(tts_s)
        return b"mp3-bytes", "audio/mpeg", "sarvam"
    monkeypatch.setattr(tutor_ws, "synthesize_speech", tts)
    monkeypatch.setattr(tutor_ws.voice_cache, "store", lambda *a, **k: asyncio.sleep(0))
    monkeypatch.setattr(tutor_ws.svc, "record_media_usage", lambda **kw: None)

    async def turn(**kw):
        # The model streams: `say` is complete well before the rest of the JSON.
        kw["on_say"](REPLY)
        await asyncio.sleep(model_s)
        return ({"action": "remediate", "say": REPLY, "board_ops": [], "assessment": {"score": 0.4},
                 "learner_state_delta": {}}, {"prompt_tokens": 1, "completion_tokens": 1})
    monkeypatch.setattr(tutor_ws, "run_turn", turn)
    with client.websocket_connect("/tutor/ws/ts") as ws:
        _auth(ws, caps=False)
        _frames_until(ws, lambda m: m.get("type") == "await" and m.get("what") == "answer", limit=200)
        before = len(spoken)
        ws.send_text(json.dumps({"type": "answer", "text": "I have completed it last Monday"}))
        seen = _frames_until(ws, lambda m: m.get("type") == "audio_end", limit=200)
        segs = [m for m in seen if m["type"] == "segment_text"]
        assert segs[0]["text"] == "Close!" and segs[0]["count"] == 1
        assert segs[1]["text"] == "Try once more. You are nearly there." and segs[1]["index"] == 1
        assert any(m["type"] == "audio_chunk" for m in seen)
        reply_calls = spoken[before:]
        assert reply_calls.count("Close!") == 1, reply_calls          # early start and reply shared one call
        ws.send_text(json.dumps({"type": "end_session"}))
