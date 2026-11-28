"""Sarvam per-sentence flush + the silent-line guard (call c6847f91, 2026-10-14).

The incident: an agent with the speech cache on (one audio context per
sentence) on bulbul:v4-flash. pipecat only flushes Sarvam for `_turn_context_id`,
which no sentence uses once reuse is off, so the 9-character bridge "एक सेकंड।"
sat in Sarvam's 50-character buffer with no audio, the service stayed paused
behind it (pause_frame_processing) and the reply waited ~16 s for the caller.

Everything here runs the REAL pipecat 1.4 SarvamTTSService through run_test,
with a fake socket that speaks Sarvam's protocol: text is buffered and voiced
only on {"type": "flush"}, then one 'final' per flush. No network.
"""
import asyncio
import base64
import json
import os
import sys
import time
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

pytest.importorskip("pipecat.services.sarvam.tts")

from pipecat.frames.frames import (BotStoppedSpeakingFrame, LLMFullResponseEndFrame,  # noqa: E402
                                   LLMFullResponseStartFrame, LLMTextFrame, TTSAudioRawFrame,
                                   TTSSpeakFrame, TTSStartedFrame, TTSStoppedFrame, TTSTextFrame)
from pipecat.services.sarvam import tts as sarvam_tts                              # noqa: E402
from pipecat.services.sarvam.tts import SarvamTTSService                           # noqa: E402
from pipecat.tests.utils import SleepFrame, run_test                               # noqa: E402
from websockets.protocol import State                                              # noqa: E402

from app import diagnostics as dg                                                  # noqa: E402
from app import providers as p                                                     # noqa: E402
from app import ttscache                                                           # noqa: E402

from pipecat.processors.frame_processor import FrameProcessor                      # noqa: E402

# test_call_behavior's _feed helpers replace FrameProcessor.process_frame with a
# no-op for the whole process and never put it back; a real pipeline after them
# never starts. Captured at collection, before any test has run.
_REAL_PROCESS_FRAME = FrameProcessor.process_frame


@pytest.fixture(autouse=True)
def _real_frame_processor(monkeypatch):
    monkeypatch.setattr(FrameProcessor, "process_frame", _REAL_PROCESS_FRAME)


BRIDGE = "एक सेकंड।"
REPLY = ["ठीक है। ", "आपका बच्चा किस class में है? ", "बताइए।"]


class _FakeSarvam:
    """Sarvam's websocket as the protocol describes it. Each text is voiced as
    `chunks` audio messages whose bytes are the text's 1-based send index, so a
    test can tell exactly whose audio landed where. `silent` texts get nothing
    at all — no audio, no 'final' — which is what the bridge got."""

    def __init__(self, *, chunks=3, gap=0.02, silent=()):
        self.state = State.OPEN
        self.sent = []                 # (monotonic, type, text) for everything after the config
        self.texts = []
        self._buf = []
        self._out = asyncio.Queue()
        self._chunks, self._gap, self._silent = chunks, gap, set(silent)

    def types(self):
        return [t for _, t, _ in self.sent]

    async def send(self, raw):
        msg = json.loads(raw)
        kind = msg.get("type")
        if kind == "config":
            return
        text = (msg.get("data") or {}).get("text")
        self.sent.append((time.monotonic(), kind, text))
        if kind == "text":
            self._buf.append(text)
            self.texts.append(text)
        elif kind == "flush":
            buf, self._buf = self._buf, []
            voiced = [t for t in buf if t.strip() not in self._silent]
            if not voiced:
                return
            for t in voiced:
                k = self.texts.index(t) + 1
                for _ in range(self._chunks):
                    self._out.put_nowait(json.dumps({"type": "audio", "data": {
                        "audio": base64.b64encode(bytes([k]) * 320).decode()}}))
            self._out.put_nowait(json.dumps({"type": "event", "data": {"event_type": "final"}}))

    def __aiter__(self):
        return self

    async def __anext__(self):
        m = await self._out.get()
        if m is None:
            raise StopAsyncIteration
        await asyncio.sleep(self._gap)
        return m

    async def close(self):
        self.state = State.CLOSED
        self._out.put_nowait(None)

    async def ping(self):
        return None


def _sarvam(monkeypatch, *, engine="sarvam", per_sentence=True, **fake_kw):
    fake = _FakeSarvam(**fake_kw)

    async def _connect(*a, **k):
        return fake
    monkeypatch.setattr(sarvam_tts, "websocket_connect", _connect)
    tts = p.build_tts(8000, voice="simran_enhi_customer" if engine == "sarvam_v4" else "priya",
                      tts_model=engine)
    assert p.engine_of(tts)[0] == engine
    # What install_tts_cache does for a cache-on agent on an async-arrival engine.
    tts._reuse_context_id_within_turn = not per_sentence
    return tts, fake


def _llm_turn():
    return ([LLMFullResponseStartFrame()] + [LLMTextFrame(t) for t in REPLY]
            + [LLMFullResponseEndFrame()])


async def _run(tts, frames, timeout=30):
    # run_test has no output transport, so nothing ever sends BotStoppedSpeaking:
    # the trailing one stands in for it so the EndFrame is not held by the pause.
    down, _ = await asyncio.wait_for(
        run_test(tts, frames_to_send=frames + [BotStoppedSpeakingFrame(), SleepFrame(0.1)]),
        timeout)
    return down


def _per_context(down):
    """context_id -> ordered list of ('start'|'stop'|'text'|audio byte)."""
    out, order = {}, []
    for f in down:
        if isinstance(f, (TTSStartedFrame, TTSStoppedFrame, TTSAudioRawFrame, TTSTextFrame)):
            cid = f.context_id
            if cid not in out:
                out[cid] = []
                order.append(cid)
            if isinstance(f, TTSAudioRawFrame):
                out[cid].append(f.audio[0])
            elif isinstance(f, TTSTextFrame):
                out[cid].append("text")
            else:
                out[cid].append("start" if isinstance(f, TTSStartedFrame) else "stop")
    return order, out


# ── (a) every sentence reaches Sarvam with its own flush ─────────────────────

@pytest.mark.parametrize("engine", ["sarvam", "sarvam_v4"])
async def test_a_speak_frame_is_flushed_with_per_sentence_contexts(monkeypatch, engine):
    """The incident's exact shape: before the fix the socket saw ['text'] only."""
    tts, fake = _sarvam(monkeypatch, engine=engine)
    await _run(tts, [TTSSpeakFrame(BRIDGE, append_to_context=False), SleepFrame(0.5)])
    assert fake.types() == ["text", "flush"]


@pytest.mark.parametrize("engine", ["sarvam", "sarvam_v4"])
async def test_each_llm_sentence_is_flushed_and_keeps_its_own_audio(monkeypatch, engine):
    tts, fake = _sarvam(monkeypatch, engine=engine)
    down = await _run(tts, _llm_turn() + [SleepFrame(1.0)])
    assert fake.types() == ["text", "flush"] * 3
    order, per = _per_context(down)
    assert len(order) == 3
    for k, cid in enumerate(order, 1):
        # Its own audio only, all of it, between its start and its stop — no
        # truncation, no overlap with a neighbour.
        assert per[cid][0] == "start" and per[cid][-1] == "stop", per[cid]
        assert [x for x in per[cid] if isinstance(x, int)] == [k] * 3, (k, per[cid])
        assert per[cid].count("text") == 1


async def test_cache_off_keeps_pipecats_own_flush_and_no_second_one(monkeypatch):
    """One context per turn: pipecat already flushes at the end of the turn and of
    a speak frame. The stock path must be untouched — one flush, not two."""
    tts, fake = _sarvam(monkeypatch, per_sentence=False)
    await _run(tts, [TTSSpeakFrame(BRIDGE, append_to_context=False), SleepFrame(0.5),
                     BotStoppedSpeakingFrame()] + _llm_turn() + [SleepFrame(0.8)])
    assert fake.types() == ["text", "flush", "text", "text", "text", "flush"]


# ── routing: the Nth flushed sentence owns the audio until the Nth 'final' ───

def _routed_rig(open_ctx, pending, playing):
    tts = p._sarvam_tts_class()(api_key="k")
    tts._reuse_context_id_within_turn = False
    tts._sv_state()._sv_pending.extend(pending)
    log, ctxs = [], set(open_ctx)

    async def append(ctx, frame):
        log.append((ctx, type(frame).__name__, frame.audio[0] if isinstance(frame, TTSAudioRawFrame)
                    else None))

    async def remove(ctx):
        log.append((ctx, "removed", None))
        ctxs.discard(ctx)

    async def noop(*a, **k):
        return None
    tts.append_to_audio_context = append
    tts.remove_audio_context = remove
    tts.audio_context_available = lambda c: c in ctxs
    tts.get_active_audio_context_id = lambda: playing
    tts.stop_ttfb_metrics = noop
    return tts, log


def _msgs(*items):
    out = []
    for it in items:
        if it == "final":
            out.append(json.dumps({"type": "event", "data": {"event_type": "final"}}))
        else:
            out.append(json.dumps({"type": "audio", "data": {
                "audio": base64.b64encode(bytes([it]) * 320).decode()}}))
    return out


class _Sock:
    def __init__(self, messages):
        self._m = messages

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for x in self._m:
            yield x


async def test_audio_follows_the_flushed_sentence_not_the_playing_one():
    """A cached sentence C is PLAYING while live sentences A and B are owed.
    The stock loop filed A's and B's audio under C, and a 'final' closed C."""
    tts, log = _routed_rig({"A", "B", "C"}, ["A", "B"], playing="C")
    tts._get_websocket = lambda: _Sock(_msgs(1, 1, "final", 2, "final"))
    await tts._receive_messages()
    assert log == [("A", "TTSAudioRawFrame", 1), ("A", "TTSAudioRawFrame", 1),
                   ("A", "TTSStoppedFrame", None), ("A", "removed", None),
                   ("B", "TTSAudioRawFrame", 2),
                   ("B", "TTSStoppedFrame", None), ("B", "removed", None)]
    assert not tts._sv_pending


async def test_a_timed_out_sentence_does_not_shift_later_finals():
    """A's context already idled out: its late audio goes to B (in order), and
    A's 'final' still pays off A — B is closed by B's own 'final', not early."""
    tts, log = _routed_rig({"B"}, ["A", "B"], playing=None)
    tts._get_websocket = lambda: _Sock(_msgs(1, "final", 2, "final"))
    await tts._receive_messages()
    assert log == [("B", "TTSAudioRawFrame", 1), ("B", "TTSAudioRawFrame", 2),
                   ("B", "TTSStoppedFrame", None), ("B", "removed", None)]


async def test_cache_off_receive_is_pipecats_own():
    """One context per turn: audio to the playing context, 'final' closes it."""
    tts, log = _routed_rig({"T"}, [], playing="T")
    tts._reuse_context_id_within_turn = True
    tts._get_websocket = lambda: _Sock(_msgs(1, 2, "final"))
    await tts._receive_messages()
    assert [c for c, *_ in log] == ["T"] * 4 and log[-1][1] == "removed"


async def test_an_interruption_with_audio_still_owed_reopens_the_socket(monkeypatch):
    """Interrupted before any audio played: pipecat keeps the socket, and the
    stale 'final's would close the NEXT reply's sentences early."""
    from pipecat.frames.frames import InterruptionFrame
    from pipecat.processors.frame_processor import FrameDirection
    from pipecat.services.tts_service import WebsocketTTSService
    calls = []

    async def base_interruption(self, frame, direction):
        await self.on_audio_context_interrupted("A")
    monkeypatch.setattr(WebsocketTTSService, "_handle_interruption", base_interruption)
    tts = p._sarvam_tts_class()(api_key="k")
    tts._reuse_context_id_within_turn = False
    tts._bot_speaking = False
    tts._sv_state()._sv_pending.extend(["A", "B"])

    async def disconnect():
        calls.append("disconnect")

    async def connect():
        calls.append("connect")
        tts._sv_reset()
    tts._disconnect, tts._connect = disconnect, connect
    await tts._handle_interruption(InterruptionFrame(), FrameDirection.DOWNSTREAM)
    assert calls == ["disconnect", "connect"] and not tts._sv_pending

    calls.clear()
    await tts._handle_interruption(InterruptionFrame(), FrameDirection.DOWNSTREAM)
    assert calls == [], "nothing owed: no extra handshake"


# ── (b) a line that never gets audio cannot hold the reply behind it ─────────

def _first(fake, text):
    return next(t for t, kind, x in fake.sent if kind == "text" and x and x.strip() == text.strip())


@pytest.mark.parametrize("per_sentence", [True, False])
async def test_a_silent_line_holds_the_reply_for_at_most_the_stop_timeout(monkeypatch, per_sentence):
    """Call c6847f91's freeze, with the vendor answering NOTHING for the bridge
    (no audio, no 'final'). The reply reaches the socket ~3 s later
    (stop_frame_timeout_s), not when the caller speaks."""
    tts, fake = _sarvam(monkeypatch, per_sentence=per_sentence, silent={BRIDGE})
    diag = dg.CallDiagnostics()
    tts.set_diagnostics(diag)
    await _run(tts, [TTSSpeakFrame(BRIDGE, append_to_context=False)] + _llm_turn()
               + [SleepFrame(4.5)])
    held = _first(fake, REPLY[0]) - _first(fake, BRIDGE)
    assert held < 4.0, f"reply held {held:.2f} s behind a silent line"
    assert diag.tts_silent_resumes == 1


async def test_without_the_guard_the_reply_waits_for_the_caller(monkeypatch):
    """The control: routing alone (no guard) still holds the reply until
    something else ends the pause — here the stand-in BotStoppedSpeaking at 2 s."""
    timings = {}
    for name, cls in (("unguarded", p._sarvam_sentence_routing(SarvamTTSService)),
                      ("guarded", p._sarvam_tts_class())):
        fake = _FakeSarvam(silent={BRIDGE})

        async def _connect(*a, _fake=fake, **k):
            return _fake
        monkeypatch.setattr(sarvam_tts, "websocket_connect", _connect)
        tts = cls(api_key="k", sample_rate=8000)
        tts._reuse_context_id_within_turn = False
        tts._stop_frame_timeout_s = 0.5
        await _run(tts, [TTSSpeakFrame(BRIDGE, append_to_context=False)] + _llm_turn()
                   + [SleepFrame(2.0), BotStoppedSpeakingFrame(), SleepFrame(1.0)])
        timings[name] = _first(fake, REPLY[0]) - _first(fake, BRIDGE)
    assert timings["unguarded"] >= 1.9, timings
    assert timings["guarded"] < 1.2, timings


async def test_the_guard_leaves_a_voiced_line_alone(monkeypatch):
    """A line that played ends its pause the stock way (BotStoppedSpeaking)."""
    tts, fake = _sarvam(monkeypatch)
    diag = dg.CallDiagnostics()
    tts.set_diagnostics(diag)
    await _run(tts, [TTSSpeakFrame(BRIDGE, append_to_context=False)] + _llm_turn()
               + [SleepFrame(1.5), BotStoppedSpeakingFrame(), SleepFrame(1.0)])
    held = _first(fake, REPLY[0]) - _first(fake, BRIDGE)
    assert held >= 1.4, "a voiced line must still hold the reply until it has played"
    assert diag.tts_silent_resumes == 0


# ── with the speech cache installed ─────────────────────────────────────────

class _CacheSettings:
    def __init__(self, root):
        self.speech_cache_dir = os.path.join(root, "speech")
        self.tts_cache_salt = "test"
        self.tts_cache_min_seen = 2
        self.tts_speech_cache_max_bytes = 10_000_000
        self.tts_cache_min_blob_ms = 200
        self.tts_cache_speech_enabled = True
        self.tts_cache_llm_enabled = True
        self.tts_cache_agents = ()
        self.tts_cache_debug = False


@pytest.mark.parametrize("cached", [REPLY[0].strip(), "ठीक है?"])
async def test_a_cached_sentence_then_live_ones_play_in_order_without_a_hole(
        monkeypatch, tmp_path, cached):
    """The real install: a cached first sentence, then two live ones. Only the
    live ones reach Sarvam (each flushed); each keeps its own audio; and the
    cached context is closed after its playout instead of pipecat's 3 s idle
    timeout (it was: 0.6 s of "ठीक है।" then 3.1 s of nothing). A cached
    question keeps the base class's text frame, inside its own context."""
    from app.ttscache import SAMPLE_RATE, Candidate, SpeechCache, cache_key
    monkeypatch.setattr(ttscache, "get_settings", lambda: _CacheSettings(str(tmp_path)))
    tts, fake = _sarvam(monkeypatch, per_sentence=False)       # install turns it on
    engine, model = p.engine_of(tts)
    store = SpeechCache(root=str(tmp_path / "speech"))
    store.open()
    key = cache_key(engine=engine, model=model, voice="priya", pace=1.0, temperature=0.5,
                    sample_rate=SAMPLE_RATE, term_map_version="", text=cached, language="")
    cand = Candidate(key=key, text=cached, chars=len(cached), engine=engine, model=model,
                     voice="priya", pace=1.0, temperature=0.5, fixed=True)
    store.ladder([cand])
    assert store.store(cand, b"\x09\x09" * int(SAMPLE_RATE * 0.6))
    assert ttscache.install_tts_cache(tts, engine=engine, model=model, voice="priya", pace=1.0,
                                      temperature=0.5, fixed_lines={cached},
                                      cache_mode="FULL", cache=store) is not None
    assert ttscache.per_sentence_contexts(tts)

    starts = {}
    orig_push = tts.push_frame

    async def push(frame, direction=None):
        from pipecat.processors.frame_processor import FrameDirection
        if isinstance(frame, TTSStartedFrame):
            starts[frame.context_id] = time.monotonic()
        await orig_push(frame, direction or FrameDirection.DOWNSTREAM)
    tts.push_frame = push

    frames = ([LLMFullResponseStartFrame(), LLMTextFrame(cached + " ")]
              + [LLMTextFrame(t) for t in REPLY[1:]] + [LLMFullResponseEndFrame(), SleepFrame(2.5)])
    down = await _run(tts, frames)
    assert fake.types() == ["text", "flush"] * 2
    assert [t.strip() for t in fake.texts] == [t.strip() for t in REPLY[1:]]
    order, per = _per_context(down)
    assert len(order) == 3
    assert [x for x in per[order[0]] if isinstance(x, int)] and \
        set(x for x in per[order[0]] if isinstance(x, int)) == {9}, "the cached blob"
    assert per[order[0]].count("text") == 1 and per[order[0]][-1] == "stop"
    for k, cid in enumerate(order[1:], 1):
        assert [x for x in per[cid] if isinstance(x, int)] == [k] * 3, (k, per[cid])
    gap = starts[order[1]] - starts[order[0]]
    assert gap < 1.5, f"next sentence started {gap:.2f} s after a 0.6 s cached one"


# ── Smallest: unaffected by the flush, covered by the guard ──────────────────

async def test_smallest_flush_is_a_noop_and_it_gets_the_guard():
    """Smallest synthesises every request on its own, so its flush_audio sends
    nothing and the missing flush cannot silence it. It pauses the same way,
    though, so a request that never voiced is bounded by the same guard."""
    smallest = pytest.importorskip("pipecat.services.smallest.tts")
    s = SimpleNamespace(smallest_api_key="k", smallest_sample_rate=8000)
    svc = p._build_smallest(smallest.SmallestTTSService, s, "lightning_v3.1", "meher", 1.0)
    assert svc._pause_frame_processing is True
    assert type(svc).__name__ == "SmallestTTSService"
    sent = []

    class _Ws:
        state = State.OPEN

        async def send(self, m):
            sent.append(m)
    svc._websocket = _Ws()
    await svc.flush_audio("ctx")
    assert sent == []
    assert type(svc)._handle_audio_context is not smallest.SmallestTTSService._handle_audio_context
