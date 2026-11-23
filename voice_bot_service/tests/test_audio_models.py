"""app/audio_models.py: Silero VAD and Smart Turn v3 on one model session per
process must behave EXACTLY like the stock per-call analyzers — same confidences,
same end-of-turn predictions, independent per-call state, also when several calls
run at once — and fall back to the stock classes when switched off.

app/pipecat_logs.py: INFO and above pass, other DEBUG is dropped except the
allowlisted vendor connect/disconnect lines; PIPECAT_LOG_LEVEL=DEBUG is stock."""
import threading
import time

import numpy as np
import pytest
from pipecat.audio.turn.smart_turn.base_smart_turn import SmartTurnParams
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams

from app import audio_models as am
from app import pipecat_logs as pl

SR = 8000


_FIX = __import__("pathlib").Path(__file__).resolve().parents[1] / "sim" / "fixtures" / "caller"
_CLIPS = ["caller_long_8k.wav", "caller_good_morning_8k.wav", "caller_yes_go_ahead_8k.wav",
          "caller_pause_then_long_8k.wav", "caller_hello_8k.wav", "caller_cut_the_call_8k.wav"]


def _audio(seed, secs=3.0):
    """Real recorded caller speech (8 kHz mono) from the simulator fixtures, so
    the VAD really detects speech; `secs` caps the length."""
    import wave
    with wave.open(str(_FIX / _CLIPS[seed % len(_CLIPS)]), "rb") as w:
        assert w.getframerate() == SR and w.getnchannels() == 1 and w.getsampwidth() == 2
        return w.readframes(int(SR * secs))


def _chunks(pcm, n=256):
    return [pcm[i:i + n * 2] for i in range(0, len(pcm) - n * 2 + 1, n * 2)]


def _confidences(vad, pcm):
    return [float(np.asarray(vad.voice_confidence(c)).ravel()[0]) for c in _chunks(pcm)]


PARAMS = dict(params=VADParams(stop_secs=0.2, start_secs=0.2, confidence=0.6, min_volume=0.35))


@pytest.fixture(autouse=True)
def _shared_on(monkeypatch):
    monkeypatch.delenv("SHARED_AUDIO_MODELS", raising=False)


# ── Silero ───────────────────────────────────────────────────────────────────

def test_shared_vad_gives_the_stock_confidences_chunk_for_chunk():
    pcm = _audio(1)
    stock = SileroVADAnalyzer(**PARAMS); stock.set_sample_rate(SR)
    shared = am.make_vad(**PARAMS); shared.set_sample_rate(SR)
    assert isinstance(shared, SileroVADAnalyzer)
    assert _confidences(shared, pcm) == pytest.approx(_confidences(stock, pcm), abs=1e-6)


def test_calls_share_one_session_but_never_their_state():
    a = am.make_vad(**PARAMS); b = am.make_vad(**PARAMS)
    a.set_sample_rate(SR); b.set_sample_rate(SR)
    assert a._model.session is b._model.session            # one model in memory
    assert a._model is not b._model                         # each call its own state
    _confidences(a, _audio(2))                              # a's state moves on ...
    fresh = SileroVADAnalyzer(**PARAMS); fresh.set_sample_rate(SR)
    pcm = _audio(3)
    assert _confidences(b, pcm) == pytest.approx(_confidences(fresh, pcm), abs=1e-6)  # ... b's does not


def test_five_calls_at_once_get_what_each_would_get_alone():
    pcms = [_audio(s) for s in range(5)]
    alone = []
    for pcm in pcms:
        v = SileroVADAnalyzer(**PARAMS); v.set_sample_rate(SR)
        alone.append(_confidences(v, pcm))
    vads = [am.make_vad(**PARAMS) for _ in pcms]
    for v in vads:
        v.set_sample_rate(SR)
    out = [None] * 5

    def run(i):
        out[i] = _confidences(vads[i], pcms[i])
    ts = [threading.Thread(target=run, args=(i,)) for i in range(5)]
    [t.start() for t in ts]; [t.join() for t in ts]
    for i in range(5):
        assert out[i] == pytest.approx(alone[i], abs=1e-6)


def test_switched_off_means_the_stock_class_and_its_own_session(monkeypatch):
    monkeypatch.setenv("SHARED_AUDIO_MODELS", "false")
    a = am.make_vad(**PARAMS); b = am.make_vad(**PARAMS)
    assert type(a) is SileroVADAnalyzer and a._model.session is not b._model.session


# ── Smart Turn ───────────────────────────────────────────────────────────────

def _turn_audio(seed):
    return np.frombuffer(_audio(seed, secs=4.0), dtype=np.int16).astype(np.float32) / 32768


def test_shared_smart_turn_predicts_what_the_stock_one_predicts():
    stock = LocalSmartTurnAnalyzerV3(params=SmartTurnParams(stop_secs=1.5)); stock.set_sample_rate(SR)
    shared = am.make_smart_turn(params=SmartTurnParams(stop_secs=1.5)); shared.set_sample_rate(SR)
    assert isinstance(shared, LocalSmartTurnAnalyzerV3)
    for s in (1, 2, 3):
        a, b = stock._predict_endpoint(_turn_audio(s)), shared._predict_endpoint(_turn_audio(s))
        assert a["prediction"] == b["prediction"]
        assert a["probability"] == pytest.approx(b["probability"], abs=1e-6)
    assert shared._params.stop_secs == 1.5


def test_smart_turn_calls_share_the_session_and_keep_their_own_buffers():
    a = am.make_smart_turn(params=SmartTurnParams(stop_secs=1.5))
    b = am.make_smart_turn(params=SmartTurnParams(stop_secs=1.5))
    assert a._session is b._session
    a.set_sample_rate(SR); b.set_sample_rate(SR)
    a.append_audio(_audio(1, secs=0.5), True)
    assert len(getattr(b, "_audio_buffer", [])) == 0


def test_the_shared_constructor_costs_far_less_than_loading_the_models():
    am.warm()
    t0 = time.process_time()
    for _ in range(5):
        am.make_vad(**PARAMS); am.make_smart_turn(params=SmartTurnParams(stop_secs=1.5))
    shared = time.process_time() - t0
    t0 = time.process_time()
    for _ in range(5):
        SileroVADAnalyzer(**PARAMS); LocalSmartTurnAnalyzerV3(params=SmartTurnParams(stop_secs=1.5))
    stock = time.process_time() - t0
    assert shared < stock / 5, (shared, stock)


# ── pipecat log filter ───────────────────────────────────────────────────────

class _Lvl:
    def __init__(self, no):
        self.no = no


def _rec(level_no, name, function):
    return {"level": _Lvl(level_no), "name": name, "function": function}


def test_info_and_up_pass_and_plain_debug_is_dropped(monkeypatch):
    monkeypatch.delenv("PIPECAT_LOG_LEVEL", raising=False)
    assert pl.keep(_rec(20, "pipecat.services.sarvam.stt", "_connect"))
    assert pl.keep(_rec(30, "pipecat.pipeline.service_switcher", "handle_error"))
    assert pl.keep(_rec(40, "pipecat.processors.frame_processor", "push_error_frame"))
    assert not pl.keep(_rec(10, "pipecat.processors.frame_processor", "link"))
    assert not pl.keep(_rec(10, "pipecat.services.sarvam.stt", "_handle_message"))   # caller text
    assert not pl.keep(_rec(10, "pipecat.services.openai.base_llm", "get_chat_completions"))


def test_the_diagnostic_debug_lines_are_kept(monkeypatch):
    monkeypatch.delenv("PIPECAT_LOG_LEVEL", raising=False)
    for name, fn in [("pipecat.services.sarvam.stt", "_disconnect"),
                     ("pipecat.services.smallest.stt", "_connect_websocket"),
                     ("bodhi.integrations.pipecat_tts", "_connect_websocket"),
                     ("pipecat.pipeline.worker", "run")]:
        assert pl.keep(_rec(10, name, fn)), (name, fn)


def test_debug_level_setting_leaves_loguru_untouched(monkeypatch):
    from loguru import logger
    monkeypatch.setenv("PIPECAT_LOG_LEVEL", "DEBUG")
    before = len(logger._core.handlers)
    pl.configure()
    assert len(logger._core.handlers) == before
    monkeypatch.setenv("PIPECAT_LOG_LEVEL", "nonsense")
    assert pl.level_name() == "INFO"
