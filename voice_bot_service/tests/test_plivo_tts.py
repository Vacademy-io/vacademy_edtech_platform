"""Plivo TTS (koyal-v1): voice table, wire format, and the realtime service's
turn bookkeeping against a simulated socket (no network)."""

import io
import json
import struct
import wave

import pytest

from app import plivo_tts as pt


def test_meera_is_the_hindi_female_default():
    assert pt.PLIVO_TTS_DEFAULT_VOICE == "meera"
    assert pt.PLIVO_VOICES["meera"] == ("6uWzc4xFj31t4jNJUaED", "female", "hi")
    assert pt.plivo_voice("Meera") == ("meera", "6uWzc4xFj31t4jNJUaED", "hi")


def test_unknown_voice_falls_back_to_meera_not_a_404():
    assert pt.plivo_voice("priya")[0] == "meera"
    assert pt.plivo_voice("")[0] == "meera"
    assert pt.plivo_voice(None)[0] == "meera"


def test_voice_table_is_complete_and_unambiguous():
    assert len(pt.PLIVO_VOICES) == 33
    ids = [v[0] for v in pt.PLIVO_VOICES.values()]
    assert len(set(ids)) == len(ids)
    assert pt.PLIVO_MALE | pt.PLIVO_FEMALE == pt.PLIVO_VOICE_NAMES
    assert not pt.PLIVO_MALE & pt.PLIVO_FEMALE
    for _vid, gender, lang in pt.PLIVO_VOICES.values():
        assert gender in ("male", "female")
        assert lang in ("hi", "bn", "ta", "te", "mr", "gu", "kn", "en-IN", "en-US", "en-GB", "en-AU")


@pytest.mark.parametrize("pace,sent", [(None, None), (1.0, 1.0), (0.5, 0.7), (2.0, 1.2), (0.95, 0.95)])
def test_pace_is_clamped_to_what_plivo_accepts(pace, sent):
    assert pt.plivo_pace(pace) == sent


def test_batch_body_leaves_unset_fields_out():
    body = pt.batch_body("नमस्ते।", "meera", None)
    assert body == {
        "voice_id": "6uWzc4xFj31t4jNJUaED", "text": "नमस्ते।", "model_id": "koyal-v1",
        "language": "hi",
        "output_format": {"container": "wav", "encoding": "pcm_s16le", "sample_rate": 8000},
    }
    assert "pace" not in body                      # a null would be 400 invalid_request
    assert pt.batch_body("Hi.", "nisha", 1.5)["pace"] == 1.2
    assert pt.batch_body("Hi.", "nisha", 1.0)["language"] == "en-IN"


def test_split_audio_frame():
    ctx = "abc-1".encode()
    frame = struct.pack("<H", len(ctx)) + ctx + b"\x01\x02\x03\x04"
    assert pt.split_audio_frame(frame) == ("abc-1", b"\x01\x02\x03\x04")
    assert pt.split_audio_frame(b"\x00") == ("", b"")


def test_streamed_wav_header_is_rewritten():
    pcm = b"\x10\x00" * 800
    fmt = struct.pack("<HHIIHH", 1, 1, 8000, 16000, 2, 16)
    raw = (b"RIFF" + struct.pack("<I", 0xFFFFFFFF) + b"WAVE" + b"fmt " + struct.pack("<I", 16) + fmt
           + b"data" + struct.pack("<I", 0xFFFFFFFF) + pcm)
    fixed = pt._fix_streamed_wav(raw)
    with wave.open(io.BytesIO(fixed)) as w:
        assert (w.getnchannels(), w.getframerate(), w.getnframes()) == (1, 8000, 800)


# ── the realtime service, against a simulated socket ─────────────────────────
class _FakeWS:
    def __init__(self):
        from websockets.protocol import State
        self.state = State.OPEN
        self.sent = []

    async def send(self, data):
        self.sent.append(json.loads(data))

    async def close(self):
        pass


def _service():
    cls = pt.plivo_tts_service_class()
    svc = cls(auth_id="MAXXXX", auth_token="tok", voice="meera", sample_rate=8000, pace=1.0)
    svc._websocket = _FakeWS()
    got = []

    async def _append(ctx, frame):
        got.append((ctx, frame))
    svc.append_to_audio_context = _append

    async def _remove(ctx):
        got.append((ctx, "REMOVED"))
    svc.remove_audio_context = _remove
    svc.audio_context_available = lambda ctx: True

    async def _noop(*a, **k):
        return None
    svc.start_tts_usage_metrics = _noop
    svc.stop_ttfb_metrics = _noop
    svc.stop_all_metrics = _noop
    return svc, got


async def _run(svc, text, ctx):
    return [f async for f in svc.run_tts(text, ctx)]


@pytest.mark.asyncio
async def test_each_sentence_is_its_own_finished_plivo_reply():
    svc, _got = _service()
    await _run(svc, "नमस्ते।", "turn1")
    await _run(svc, "मैं मीरा बोल रही हूँ।", "turn1")
    a, b = svc._websocket.sent
    assert a["type"] == "text" and a["finish"] is True and a["text"] == "नमस्ते।"
    assert a["voice_id"] == "6uWzc4xFj31t4jNJUaED" and a["language"] == "hi"
    assert a["model_id"] == "koyal-v1" and a["pace"] == 1.0
    assert a["output_format"] == {"container": "raw", "encoding": "pcm_s16le", "sample_rate": 8000}
    assert a["context_id"] != b["context_id"]
    assert a["context_id"].startswith("turn1-") and b["context_id"].startswith("turn1-")


@pytest.mark.asyncio
async def test_audio_lands_in_its_turn_and_the_turn_closes_after_flush_and_done():
    from pipecat.frames.frames import TTSAudioRawFrame, TTSStoppedFrame
    svc, got = _service()
    await _run(svc, "One.", "turn1")
    await _run(svc, "Two.", "turn1")
    r1, r2 = (m["context_id"] for m in svc._websocket.sent)

    class _Msgs:
        def __init__(self, items):
            self.items = items

        def __aiter__(self):
            return self._gen()

        async def _gen(self):
            for i in self.items:
                yield i

    def binary(rid, audio):
        c = rid.encode()
        return struct.pack("<H", len(c)) + c + audio

    svc._get_websocket = lambda: _Msgs([
        binary(r1, b"\x01\x00" * 4),
        json.dumps({"type": "done", "context_id": r1, "reason": "complete",
                    "characters": 4, "audio_seconds": 0.4}),
        binary(r2, b"\x02\x00" * 4),
        binary("someone-else-1", b"\x09\x00"),          # not ours: ignored
    ])
    spend = []
    svc.set_credits_callback(lambda c, s, n=0: spend.append((c, s, n)))
    await svc._receive_messages()
    audio = [f for _c, f in got if isinstance(f, TTSAudioRawFrame)]
    assert [f.audio for f in audio] == [b"\x01\x00" * 4, b"\x02\x00" * 4]
    assert all(c == "turn1" for c, f in got if isinstance(f, TTSAudioRawFrame))
    assert spend == [(0.0, 0.4, 4)]
    assert not any(f == "REMOVED" for _c, f in got)       # r2 still producing

    await svc.flush_audio("turn1")
    assert not any(f == "REMOVED" for _c, f in got)       # flushed, but r2 not done
    await svc._handle_event({"type": "done", "context_id": r2, "reason": "complete",
                             "characters": 4, "audio_seconds": 0.4})
    tail = got[-2:]
    assert isinstance(tail[0][1], TTSStoppedFrame) and tail[1] == ("turn1", "REMOVED")


@pytest.mark.asyncio
async def test_an_error_ends_only_that_reply():
    svc, got = _service()
    errors = []

    async def _push_error(error_msg=None, **k):
        errors.append(error_msg)
    svc.push_error = _push_error
    await _run(svc, "One.", "turn1")
    rid = svc._websocket.sent[0]["context_id"]
    await svc.flush_audio("turn1")
    await svc._handle_event({"type": "error", "context_id": rid, "code": "voice_not_found",
                             "message": "x", "status_code": 404})
    assert errors and "voice_not_found" in errors[0]
    assert got[-1] == ("turn1", "REMOVED")               # the turn is not left hanging


@pytest.mark.asyncio
async def test_barge_in_cancels_the_turns_replies_at_plivo():
    svc, _got = _service()
    await _run(svc, "One.", "turn1")
    await _run(svc, "Two.", "turn1")
    await _run(svc, "Other.", "turn2")
    ids = [m["context_id"] for m in svc._websocket.sent]
    await svc.on_audio_context_interrupted("turn1")
    cancels = [m for m in svc._websocket.sent if m["type"] == "cancel"]
    assert [c["context_id"] for c in cancels] == ids[:2]
    assert ids[2] in svc._reply_ctx                       # turn2 untouched


def test_build_tts_picks_plivo_and_falls_back_without_keys(monkeypatch):
    import dataclasses
    from app import providers
    base = providers.get_settings()
    no_keys = dataclasses.replace(base, plivo_tts_auth_id="", plivo_tts_auth_token="")
    monkeypatch.setattr(providers, "get_settings", lambda: no_keys)
    assert providers.engine_of(providers.build_tts(8000, "meera", tts_model="plivo"))[0] == "sarvam"
    keys = dataclasses.replace(base, plivo_tts_auth_id="MAXXXX", plivo_tts_auth_token="tok")
    monkeypatch.setattr(providers, "get_settings", lambda: keys)
    svc = providers.build_tts(8000, "meera", tts_model="plivo")
    assert providers.engine_of(svc) == ("plivo", "koyal-v1")
    assert providers.default_engine_model("plivo") == "koyal-v1"


def test_bot_knows_plivo_voices_and_their_gender():
    import app.bot as b
    agent = {"tts_model": "plivo", "voice": "Meera"}
    assert b._engine_of("plivo") == "plivo"
    assert b._agent_voice(agent) == "Meera"
    assert b._default_voice_for({"tts_model": "plivo"}) == "meera"
    assert b._voice_gender("meera") == "female"
    assert b._voice_gender("aman") == "male"
    # A voice from another engine is dropped, not sent to Plivo.
    assert b._agent_voice({"tts_model": "plivo", "voice": "priya"}) is None
    # And a Plivo name is not sent to Sarvam either.
    assert b._agent_voice({"tts_model": "sarvam", "voice": "meera"}) is None
