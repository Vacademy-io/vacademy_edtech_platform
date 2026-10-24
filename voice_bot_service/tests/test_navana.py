"""Navana (Bodhi) TTS wiring. No network: construction, routing, language and
voice-gender only — the vendor socket is exercised by a real call."""
import pytest

from app import providers as p
from app import bot as b
from app.config import get_settings


def test_agent_languages_map_to_navana_codes():
    assert p.navana_language("hinglish") == "hi"
    assert p.navana_language("english") == "en"
    assert p.navana_language("en-IN") == "en"
    assert p.navana_language("marathi") == "mr"
    assert p.navana_language("od-IN") == "or"          # Sarvam's Odia spelling
    assert p.navana_language("") == "hi"
    assert p.navana_language("klingon") == "hi"


def test_engine_and_voice_gender():
    assert b._engine_of("navana") == "navana"
    assert b._voice_gender("bhavana") == "female"
    assert b._voice_gender("anirban") == "male"
    assert "bhavana" in b.NAVANA_VOICES and len(b.NAVANA_VOICES) == 55


import contextlib as _contextlib


@_contextlib.contextmanager
def _keys(value):
    s = get_settings()
    old = s.navana_api_key
    object.__setattr__(s, "navana_api_key", value)
    try:
        yield
    finally:
        object.__setattr__(s, "navana_api_key", old)


def _with_key(value):
    s = get_settings()
    old = s.navana_api_key
    object.__setattr__(s, "navana_api_key", value)
    return s, old


def test_missing_key_falls_back_to_sarvam():
    s, old = _with_key("")
    try:
        tts = p.build_tts(24000, "bhavana", tts_model="navana", language="hinglish")
        assert p.engine_of(tts)[0] == "sarvam"
    finally:
        object.__setattr__(s, "navana_api_key", old)


def test_builds_the_navana_service_metered():
    pytest.importorskip("bodhi.integrations.pipecat_tts")
    from bodhi.integrations.pipecat_tts import BodhiTTSService
    s, old = _with_key("test-key-not-real")
    try:
        tts = p.build_tts(24000, "anirban", tts_model="navana", language="marathi")
        assert isinstance(tts, BodhiTTSService)
        assert p.engine_of(tts) == ("navana", "anirban")
        # The metering wrapper (vendor characters -> diagnostics.tts.chars).
        assert type(tts).run_tts is not BodhiTTSService.run_tts
    finally:
        object.__setattr__(s, "navana_api_key", old)


# ── speech cache support (2026-09-30) ─────────────────────────────────────
def test_cache_key_separates_languages_for_navana_only():
    from app.ttscache import cache_key
    kw = dict(engine="navana", model="", voice="ipsita", pace=1.0, temperature=None,
              sample_rate=8000, term_map_version="", text="नमस्ते जी।")
    assert cache_key(**kw, language="hinglish") == cache_key(**kw, language="hi-IN")
    assert cache_key(**kw, language="hinglish") != cache_key(**kw, language="marathi")
    g = dict(kw, engine="google")
    assert cache_key(**g, language="hinglish") == cache_key(**g, language="marathi")


def test_navana_is_an_async_arrival_engine():
    from app.ttscache import is_async_arrival
    assert is_async_arrival("navana")


@pytest.mark.asyncio
async def test_renderer_uses_the_live_settings(monkeypatch):
    """No speed (the live stream cannot send one) and the agent's language code."""
    import io
    import wave
    from app import main as m
    from app.ttswarm import synthesize
    seen = {}

    async def fake(text, voice, lang, pace):
        seen.update(text=text, voice=voice, lang=lang, pace=pace)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
            w.writeframes(b"\x00\x01" * 24000)
        return buf.getvalue()
    monkeypatch.setattr(m, "_navana_tts_wav", fake)
    pcm = await synthesize(engine="navana", model="", voice="ipsita", pace=1.02,
                           temperature=None, text="नमस्ते।", language="mr")
    assert seen == {"text": "नमस्ते।", "voice": "ipsita", "lang": "mr", "pace": None}
    assert pcm and abs(len(pcm) - 16000) < 400      # 1 s at 8 kHz, 16-bit


class _Sock:
    def __init__(self, messages):
        self._m = messages
        self.sent = []

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for x in self._m:
            yield x

    async def send(self, data):
        self.sent.append(data)


@pytest.mark.asyncio
async def test_chunks_follow_their_own_sentence_not_the_playing_one():
    """Sentence 1 ("A") is PLAYING; sentence 2's audio must still be filed under
    "B". The SDK's stock loop filed it under the playing context."""
    import json
    pytest.importorskip("bodhi.integrations.pipecat_tts")
    from bodhi.integrations.pipecat_tts import BodhiTTSService
    cls = p._navana_seq_routing(BodhiTTSService)
    tts = cls(api_key="k", voice="ipsita", language="hi")
    tts._reuse_context_id_within_turn = False
    tts._output_sample_rate = 8000
    tts._nv_reset()
    tts._nv_ctx = {1: "A", 2: "B"}
    appended, removed, open_ctx = [], [], {"A", "B"}

    async def append(ctx, frame):
        appended.append((ctx, type(frame).__name__))

    async def remove(ctx):
        removed.append(ctx)
        open_ctx.discard(ctx)

    async def noop(*a, **k):
        return None
    tts.append_to_audio_context = append
    tts.remove_audio_context = remove
    tts.audio_context_available = lambda c: c in open_ctx
    tts.get_active_audio_context_id = lambda: "A"
    tts.stop_ttfb_metrics = noop
    sock = _Sock([
        json.dumps({"type": "audio", "seq": 1, "is_last_chunk": False}), b"\x00" * 320,
        json.dumps({"type": "audio", "seq": 2, "is_last_chunk": False}), b"\x00" * 320,
        json.dumps({"type": "audio", "seq": 1, "is_last_chunk": True}), b"\x00" * 320,
        json.dumps({"type": "audio", "seq": 2, "is_last_chunk": True}), b"\x00" * 320,
    ])
    tts._get_websocket = lambda: sock
    await tts._receive_messages()
    audio_for = [c for c, kind in appended if kind == "TTSAudioRawFrame"]
    assert audio_for == ["A", "B", "A", "B"], appended
    assert removed == ["A", "B"]
    assert ("A", "TTSStoppedFrame") in appended and ("B", "TTSStoppedFrame") in appended


@pytest.mark.asyncio
async def test_run_tts_records_the_seq_it_sent():
    pytest.importorskip("bodhi.integrations.pipecat_tts")
    from bodhi.integrations.pipecat_tts import BodhiTTSService
    from websockets.protocol import State
    cls = p._navana_seq_routing(BodhiTTSService)
    tts = cls(api_key="k", voice="ipsita", language="hi")
    tts._reuse_context_id_within_turn = False
    sock = _Sock([])
    sock.state = State.OPEN
    tts._websocket = sock
    tts._get_websocket = lambda: sock

    async def noop(*a, **k):
        return None
    tts.start_ttfb_metrics = noop
    tts.start_tts_usage_metrics = noop
    async for _ in tts.run_tts("पहला।", "ctx-1"):
        pass
    async for _ in tts.run_tts("दूसरा।", "ctx-2"):
        pass
    assert tts._nv_ctx == {1: "ctx-1", 2: "ctx-2"}


# ── Said must mean heard (calls 18b63b17 / 45749163, 2026-09-30) ─────────────
def _heard_rig(monkeypatch, *, per_sentence=True, open_ctx=None):
    """The routed service with pipecat's audio-context queue replaced by a log:
    `log` is every frame that reached a context, in order."""
    pytest.importorskip("bodhi.integrations.pipecat_tts")
    from bodhi.integrations.pipecat_tts import BodhiTTSService
    from pipecat.services.tts_service import TTSService
    log = []
    ctxs = set(open_ctx or {"A", "B", "C"})

    async def base_append(self, ctx, frame):
        log.append((ctx, type(frame).__name__, getattr(frame, "text", None)))

    async def base_interrupted(self, ctx):
        return None
    monkeypatch.setattr(TTSService, "append_to_audio_context", base_append)
    monkeypatch.setattr(TTSService, "on_audio_context_interrupted", base_interrupted)
    cls = p._navana_seq_routing(BodhiTTSService)
    tts = cls(api_key="k", voice="ipsita", language="hi")
    tts._reuse_context_id_within_turn = not per_sentence
    tts._output_sample_rate = 8000
    tts._nv_reset()

    async def remove(ctx):
        ctxs.discard(ctx)

    async def noop(*a, **k):
        return None
    tts.remove_audio_context = remove
    tts.audio_context_available = lambda c: c in ctxs
    tts.get_active_audio_context_id = lambda: next(iter(sorted(ctxs)), None)
    tts.stop_ttfb_metrics = noop
    return tts, log, ctxs


def _sent(tts, seq, ctx):
    """What run_tts records the moment it has sent sentence `seq`."""
    tts._nv_ctx[seq] = ctx
    tts._nv_ctx_seq[ctx] = seq


def _text(t):
    from pipecat.frames.frames import TTSTextFrame
    return TTSTextFrame(t, aggregated_by="sentence")


def _chunks(seq, n, last=True, progress=False):
    """Navana's per-chunk header + binary frame. `progress` adds the documented
    chunk_index (0-based) / chunk_total fields."""
    import json
    out = []
    for i in range(n):
        h = {"type": "audio", "seq": seq, "is_last_chunk": last and i == n - 1}
        if progress:
            h.update(chunk_index=i, chunk_total=n)
        out += [json.dumps(h), b"\x00" * 320]
    return out


@pytest.mark.asyncio
async def test_a_sentences_text_follows_half_of_its_audio(monkeypatch):
    """pipecat appends a push_text_frames service's text right after run_tts —
    for Navana BEFORE any audio. It now goes after half the sentence's audio:
    a sentence cut in its first half is re-sayable, one heard mostly is not
    repeated in full (the review of 2cfb1cff29: all-or-nothing re-said a nearly
    finished opening and lost the answer to it)."""
    tts, log, _ = _heard_rig(monkeypatch)
    _sent(tts, 1, "A")
    await tts.append_to_audio_context("A", _text("फीस तीस हज़ार है।"))
    assert log == [], "the text went out before any audio"
    tts._get_websocket = lambda: _Sock(_chunks(1, 5, progress=True))
    await tts._receive_messages()
    kinds = [k for _c, k, _t in log]
    # 60 %: after the 3rd of 5 chunks.
    assert kinds == ["TTSAudioRawFrame"] * 3 + ["TTSTextFrame"] + ["TTSAudioRawFrame"] * 2 \
        + ["TTSStoppedFrame"], log


@pytest.mark.asyncio
async def test_a_one_chunk_sentence_is_split_so_its_text_lands_60_percent_in(monkeypatch):
    """Real Navana sends a sentence as ONE chunk (chunk_total 1): the frame is
    split sample-aligned at 60 % and the text goes between the halves — else
    "after 60 % of the chunks" would be "after all of it" in production, and a
    question answered over its tail would be re-asked (review of 8e809b6af7)."""
    import json
    tts, log, _ = _heard_rig(monkeypatch)
    _sent(tts, 1, "A")
    await tts.append_to_audio_context("A", _text("मार्क्स कितने आए थे?"))
    pcm = b"\x01\x00" * 1000                      # 1000 samples
    tts._get_websocket = lambda: _Sock([json.dumps({"type": "audio", "seq": 1, "chunk_index": 0,
                                                    "chunk_total": 1, "is_last_chunk": True}), pcm])
    got = []

    from pipecat.services.tts_service import TTSService

    async def base_append(self, ctx, frame):
        got.append((type(frame).__name__, len(getattr(frame, "audio", b"") or b"")))
    monkeypatch.setattr(TTSService, "append_to_audio_context", base_append)
    await tts._receive_messages()
    assert [k for k, _n in got] == ["TTSAudioRawFrame", "TTSTextFrame", "TTSAudioRawFrame",
                                    "TTSStoppedFrame"], got
    assert got[0][1] == 1200 and got[2][1] == 800 and got[0][1] % 2 == 0, got


@pytest.mark.asyncio
async def test_without_progress_headers_text_goes_inside_the_last_chunk(monkeypatch):
    """No chunk_index/chunk_total: never release early — 60 % into the last chunk."""
    tts, log, _ = _heard_rig(monkeypatch)
    _sent(tts, 1, "A")
    await tts.append_to_audio_context("A", _text("फीस तीस हज़ार है।"))
    assert log == [], "the text went out before any audio"
    tts._get_websocket = lambda: _Sock(_chunks(1, 3))
    await tts._receive_messages()
    kinds = [k for _c, k, _t in log]
    assert kinds == ["TTSAudioRawFrame"] * 3 + ["TTSTextFrame", "TTSAudioRawFrame",
                                                 "TTSStoppedFrame"], log


@pytest.mark.asyncio
async def test_a_dropped_sentence_never_counts_as_said(monkeypatch):
    """FloorGate held the reply (the parent was still talking) and the parent's
    words dropped it: the interruption reaches the TTS, and NOTHING of that
    sentence — neither its late chunks nor its text — may reach any context."""
    tts, log, ctxs = _heard_rig(monkeypatch)
    _sent(tts, 1, "A")
    await tts.append_to_audio_context("A", _text("मार्क्स कितने आए थे?"))
    await tts.on_audio_context_interrupted("A")
    ctxs.discard("A")
    tts._get_websocket = lambda: _Sock(_chunks(1, 2))
    await tts._receive_messages()
    assert all(t != "मार्क्स कितने आए थे?" for _c, _k, t in log), log
    assert not [x for x in log if x[1] == "TTSAudioRawFrame"], log


@pytest.mark.asyncio
async def test_a_dropped_replys_late_audio_never_plays_inside_the_next_reply(monkeypatch):
    """No socket reconnect happens for a reply that never started playing, so
    Navana keeps streaming it. Its chunks used to fall back to the PLAYING
    context — the next reply's."""
    tts, log, ctxs = _heard_rig(monkeypatch, open_ctx={"B"})
    _sent(tts, 1, "A")
    await tts.on_audio_context_interrupted("A")
    _sent(tts, 2, "B")                                # the next reply
    await tts.append_to_audio_context("B", _text("जी, बताइए।"))
    tts._get_websocket = lambda: _Sock(_chunks(1, 3) + _chunks(2, 2))
    await tts._receive_messages()
    audio_ctx = [c for c, k, _t in log if k == "TTSAudioRawFrame"]
    assert audio_ctx and set(audio_ctx) == {"B"}, log     # none of the dropped reply's
    assert ("B", "TTSTextFrame", "जी, बताइए।") in log


@pytest.mark.asyncio
async def test_with_the_cache_off_text_still_follows_audio_and_the_turn_context_stays_open(monkeypatch):
    """One context per turn (cache off, e.g. the Mediquity agent): each sentence's
    text after its own audio; the turn's context is not closed per sentence."""
    tts, log, ctxs = _heard_rig(monkeypatch, per_sentence=False, open_ctx={"T"})
    _sent(tts, 1, "T")
    await tts.append_to_audio_context("T", _text("पहला।"))
    _sent(tts, 2, "T")
    await tts.append_to_audio_context("T", _text("दूसरा?"))
    tts._get_websocket = lambda: _Sock(_chunks(1, 2) + _chunks(2, 2))
    await tts._receive_messages()
    seq = [(k, t) for _c, k, t in log if k != "TTSAudioRawFrame"]
    assert seq == [("TTSTextFrame", "पहला।"), ("TTSStoppedFrame", None),
                   ("TTSTextFrame", "दूसरा?"), ("TTSStoppedFrame", None)], log
    assert "T" in ctxs, "the turn's context was closed after one sentence"


@pytest.mark.asyncio
async def test_a_cached_sentences_text_is_not_held(monkeypatch):
    """A cache hit never went to Navana: its text (appended after its audio by
    the base class) passes straight through."""
    tts, log, _ = _heard_rig(monkeypatch)
    await tts.append_to_audio_context("C", _text("नमस्ते जी।"))
    assert log == [("C", "TTSTextFrame", "नमस्ते जी।")]


@pytest.mark.asyncio
async def test_an_interruption_does_not_churn_the_socket(monkeypatch):
    """Navana allows 2 concurrent streams and frees a closed socket's slot late:
    pipecat's close-and-reopen on every interruption got the new handshake
    refused ("concurrency_limit") and the sentence lost — 328 refusals on
    2026-09-30. The dead-seq bookkeeping makes the reconnect unnecessary."""
    pytest.importorskip("bodhi.integrations.pipecat_tts")
    from pipecat.services.tts_service import WebsocketTTSService
    tts, _log, _ = _heard_rig(monkeypatch)
    seen = []

    async def ws_interruption(self, frame, direction):
        seen.append("base")
    monkeypatch.setattr(WebsocketTTSService, "_handle_interruption", ws_interruption)
    calls = []

    async def disc():
        calls.append("disconnect")

    async def conn():
        calls.append("connect")
    tts._disconnect, tts._connect = disc, conn
    tts._bot_speaking = True          # where InterruptibleTTSService would reconnect
    _sent(tts, 1, "A")
    await tts._handle_interruption(None, None)
    assert seen == ["base"] and calls == [], (seen, calls)


@pytest.mark.asyncio
async def test_a_refused_handshake_is_retried_not_reported(monkeypatch):
    pytest.importorskip("bodhi.integrations.pipecat_tts")
    from bodhi.integrations.pipecat_tts import BodhiTTSService
    import app.providers as prov
    tries, errors = [], []

    async def fake_connect(self):
        tries.append(1)
        if len(tries) < 3:
            self._websocket = None
            await self.push_error(error_msg="unable to connect: handshake refused: "
                                            "concurrency_limit too many streams")
            return
        self._websocket = object()

    async def fake_push_error(self, *a, **k):
        errors.append(k.get("error_msg"))
    monkeypatch.setattr(BodhiTTSService, "_connect_websocket", fake_connect)
    from pipecat.processors.frame_processor import FrameProcessor
    monkeypatch.setattr(FrameProcessor, "push_error", fake_push_error)

    async def no_sleep(_s):
        return None
    monkeypatch.setattr(prov._asyncio if hasattr(prov, "_asyncio") else __import__("asyncio"),
                        "sleep", no_sleep)
    cls = p._navana_seq_routing(BodhiTTSService)
    tts = cls(api_key="k", voice="ipsita", language="hi")
    tts._websocket = None
    with _keys("k-one"):
        await tts._connect_websocket()
    assert len(tries) == 3 and tts._websocket is not None and errors == [], (tries, errors)


@pytest.mark.asyncio
async def test_a_bad_key_is_skipped_for_a_good_one(monkeypatch):
    """Review of 422351d428: a typo'd / revoked / out-of-credit key failed with a
    non-capacity error, was never skipped, and — always at load 0 — became the
    PREFERRED key: every call after the first went mute."""
    pytest.importorskip("bodhi.integrations.pipecat_tts")
    from bodhi.integrations.pipecat_tts import BodhiTTSService
    used, errors = [], []

    async def fake_connect(self):
        used.append(self._api_key)
        if self._api_key == "bad":
            self._websocket = None
            await self.push_error(error_msg="unable to connect: handshake refused: bad_key")
            return
        self._websocket = object()

    async def fake_push_error(self, *a, **k):
        errors.append(k.get("error_msg"))
    monkeypatch.setattr(BodhiTTSService, "_connect_websocket", fake_connect)
    from pipecat.processors.frame_processor import FrameProcessor
    monkeypatch.setattr(FrameProcessor, "push_error", fake_push_error)
    monkeypatch.setattr(p, "NAVANA_KEYS", p.NavanaKeyPool())
    cls = p._navana_seq_routing(BodhiTTSService)
    with _keys("bad,good"):
        p.NAVANA_KEYS._rr = 0
        tts = cls(api_key="x", voice="ipsita", language="hi")
        tts._websocket = None
        await tts._connect_websocket()
        assert used == ["bad", "good"] and not errors and tts._nv_key == "good", (used, errors)
        # The bad key is rested long: the NEXT call goes straight to "good".
        tts2 = cls(api_key="x", voice="ipsita", language="hi")
        tts2._websocket = None
        await tts2._connect_websocket()
        assert used[-1] == "good" and tts2._nv_key == "good", used


@pytest.mark.asyncio
async def test_a_lone_bad_key_is_reported_after_the_rounds(monkeypatch):
    pytest.importorskip("bodhi.integrations.pipecat_tts")
    from bodhi.integrations.pipecat_tts import BodhiTTSService
    errors = []

    async def fake_connect(self):
        self._websocket = None
        await self.push_error(error_msg="unable to connect: handshake refused: bad_key")

    async def fake_push_error(self, *a, **k):
        errors.append(k.get("error_msg"))

    async def no_sleep(_s):
        return None
    monkeypatch.setattr(BodhiTTSService, "_connect_websocket", fake_connect)
    from pipecat.processors.frame_processor import FrameProcessor
    monkeypatch.setattr(FrameProcessor, "push_error", fake_push_error)
    monkeypatch.setattr(p, "NAVANA_KEYS", p.NavanaKeyPool())
    monkeypatch.setattr(__import__("asyncio"), "sleep", no_sleep)
    cls = p._navana_seq_routing(BodhiTTSService)
    tts = cls(api_key="x", voice="ipsita", language="hi")
    tts._websocket = None
    with _keys("only"):
        await tts._connect_websocket()
    assert len(errors) == 1 and "bad_key" in errors[0] and p.NAVANA_KEYS.load("only") == 0, errors


@pytest.mark.asyncio
async def test_a_reconnect_gives_back_the_key_it_held(monkeypatch):
    """Review of 422351d428: the SDK's lazy reconnect over a CLOSED socket came
    back into _connect_websocket still holding its key — phantom load."""
    pytest.importorskip("bodhi.integrations.pipecat_tts")
    from bodhi.integrations.pipecat_tts import BodhiTTSService

    async def fake_connect(self):
        self._websocket = object()
    monkeypatch.setattr(BodhiTTSService, "_connect_websocket", fake_connect)
    monkeypatch.setattr(p, "NAVANA_KEYS", p.NavanaKeyPool())
    cls = p._navana_seq_routing(BodhiTTSService)
    tts = cls(api_key="x", voice="ipsita", language="hi")
    with _keys("a,b"):
        tts._websocket = None
        await tts._connect_websocket()
        tts._websocket = None                  # the socket closed under it
        await tts._connect_websocket()
        assert sum(p.NAVANA_KEYS.loads()) == 1, p.NAVANA_KEYS.loads()


def test_quotes_around_the_secret_are_ignored():
    assert p.navana_keys('"k1,k2"') == ["k1", "k2"]
    assert p.navana_keys("'k1', k2") == ["k1", "k2"]



# ── Several Navana keys (2 streams per account) ─────────────────────────────



def test_keys_are_parsed_from_a_comma_list():
    assert p.navana_keys(" k1, k2,,k3 ,k1 ") == ["k1", "k2", "k3"]
    assert p.navana_keys("") == [] and p.navana_keys(None) == p.navana_keys()


def test_the_least_loaded_key_wins_and_ties_rotate():
    class H:
        pass
    pool = p.NavanaKeyPool()
    with _keys("a,b,c"):
        hs = [H() for _ in range(6)]
        got = [pool.acquire(h) for h in hs[:3]]
        assert sorted(got) == ["a", "b", "c"], got          # one each first
        pool.release(hs[0], got[0])                          # that key frees up
        assert pool.acquire(hs[3]) == got[0]
        assert pool.loads() == [1, 1, 1]


def test_a_refused_key_cools_off_and_is_tried_last():
    class H:
        pass
    pool = p.NavanaKeyPool()
    with _keys("a,b"):
        pool.refused("a")
        assert pool.acquire(H()) == "b"
        assert pool.acquire(H(), exclude={"b"}) == "a"       # still usable if nothing else is


def test_a_call_that_vanishes_does_not_keep_its_key_busy():
    import gc

    class H:
        pass
    pool = p.NavanaKeyPool()
    with _keys("a"):
        h = H()
        pool.acquire(h)
        assert pool.load("a") == 1
        del h
        gc.collect()
        assert pool.load("a") == 0


@pytest.mark.asyncio
async def test_a_refusal_moves_to_the_next_key_at_once(monkeypatch):
    """Key a is full (concurrency_limit): the call must connect on key b with
    no back-off sleep, and a must be cooled."""
    pytest.importorskip("bodhi.integrations.pipecat_tts")
    from bodhi.integrations.pipecat_tts import BodhiTTSService
    used, slept = [], []

    async def fake_connect(self):
        used.append(self._api_key)
        if self._api_key == "a":
            self._websocket = None
            await self.push_error(error_msg="handshake refused: concurrency_limit")
            return
        self._websocket = object()

    async def fake_sleep(s):
        slept.append(s)
    monkeypatch.setattr(BodhiTTSService, "_connect_websocket", fake_connect)
    monkeypatch.setattr(p, "NAVANA_KEYS", p.NavanaKeyPool())
    monkeypatch.setattr(__import__("asyncio"), "sleep", fake_sleep)
    cls = p._navana_seq_routing(BodhiTTSService)
    tts = cls(api_key="x", voice="ipsita", language="hi")
    tts._websocket = None
    with _keys("a,b"):
        p.NAVANA_KEYS._rr = 0                      # a first on a tie
        await tts._connect_websocket()
        assert used == ["a", "b"] and not slept and tts._nv_key == "b", (used, slept)
        assert p.NAVANA_KEYS.load("b") == 1 and p.NAVANA_KEYS.load("a") == 0
        assert p.NAVANA_KEYS._cool.get("a", 0) > 0


@pytest.mark.asyncio
async def test_closing_the_socket_releases_its_key(monkeypatch):
    pytest.importorskip("bodhi.integrations.pipecat_tts")
    from bodhi.integrations.pipecat_tts import BodhiTTSService

    async def fake_connect(self):
        self._websocket = object()

    async def fake_disconnect(self):
        self._websocket = None
    monkeypatch.setattr(BodhiTTSService, "_connect_websocket", fake_connect)
    monkeypatch.setattr(BodhiTTSService, "_disconnect_websocket", fake_disconnect)
    monkeypatch.setattr(p, "NAVANA_KEYS", p.NavanaKeyPool())
    cls = p._navana_seq_routing(BodhiTTSService)
    tts = cls(api_key="x", voice="ipsita", language="hi")
    tts._websocket = None
    with _keys("a,b"):
        await tts._connect_websocket()
        k = tts._nv_key
        assert p.NAVANA_KEYS.load(k) == 1
        await tts._disconnect_websocket()
        assert p.NAVANA_KEYS.load(k) == 0 and tts._nv_key is None


@pytest.mark.asyncio
async def test_when_every_key_refuses_it_backs_off_then_goes_round_again(monkeypatch):
    pytest.importorskip("bodhi.integrations.pipecat_tts")
    from bodhi.integrations.pipecat_tts import BodhiTTSService
    used, slept = [], []

    async def fake_connect(self):
        used.append(self._api_key)
        if len(used) <= 2:                          # a and b both full on round 1
            self._websocket = None
            await self.push_error(error_msg="handshake refused: concurrency_limit")
            return
        self._websocket = object()

    async def fake_sleep(s):
        slept.append(s)
    monkeypatch.setattr(BodhiTTSService, "_connect_websocket", fake_connect)
    monkeypatch.setattr(p, "NAVANA_KEYS", p.NavanaKeyPool())
    monkeypatch.setattr(__import__("asyncio"), "sleep", fake_sleep)
    cls = p._navana_seq_routing(BodhiTTSService)
    tts = cls(api_key="x", voice="ipsita", language="hi")
    tts._websocket = None
    with _keys("a,b"):
        await tts._connect_websocket()
    assert sorted(used[:2]) == ["a", "b"] and slept == [0.25] and tts._websocket is not None, (used, slept)


# ── One-shot renders (cache renderer, preview) with several keys ────────────
class _FakeResp:
    def __init__(self, status, body=b"", text=""):
        self.status, self._body, self._text = status, body, text
        self.headers = {"X-Sample-Rate": "24000"}

    async def text(self):
        return self._text

    async def read(self):
        return self._body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _FakeSession:
    def __init__(self, by_key):
        self.by_key, self.calls = by_key, []

    def post(self, url, json=None, headers=None, timeout=None):
        k = headers["X-API-Key"]
        self.calls.append(k)
        return _FakeResp(*self.by_key[k])


@pytest.mark.asyncio
async def test_rest_render_skips_a_dead_key_and_rests_it(monkeypatch):
    """A 401/402/403 key must not soak up renders: it is rested and the next key
    serves the request; later renders go straight to the good key."""
    from app import main as m
    p.NAVANA_KEYS._cool.clear()
    sess = _FakeSession({"k-good": (200, b"\x00\x01" * 100), "k-dead": (402, b"", "insufficient credit")})
    monkeypatch.setattr(m.app.state, "http_session", sess, raising=False)
    with _keys("k-dead,k-good"):
        p.NAVANA_KEYS._rr = 0                     # round-robin points at the dead key
        outs = [await m._navana_tts_wav("नमस्ते", "ipsita", "hi", None) for _ in range(6)]
    assert all(outs)
    assert sess.calls[:2] == ["k-dead", "k-good"]
    assert sess.calls[2:] == ["k-good"] * 5          # rested: not tried again within 60 s
    p.NAVANA_KEYS._cool.clear()


@pytest.mark.asyncio
async def test_rest_render_with_every_key_dead_returns_empty(monkeypatch):
    from app import main as m
    p.NAVANA_KEYS._cool.clear()
    sess = _FakeSession({"k-a": (401, b"", "unauthorized"), "k-b": (403, b"", "forbidden")})
    monkeypatch.setattr(m.app.state, "http_session", sess, raising=False)
    with _keys("k-a,k-b"):
        out = await m._navana_tts_wav("x", "ipsita", "hi", None)
    assert out == b"" and sorted(sess.calls) == ["k-a", "k-b"]
    p.NAVANA_KEYS._cool.clear()
