"""Silero VAD and Smart Turn v3, loaded ONCE per process instead of once per call.

WHY. Every call built a fresh SileroVADAnalyzer and LocalSmartTurnAnalyzerV3,
and each constructor creates an onnxruntime InferenceSession from disk: about
0.8 s of CPU per call on a laptop (Silero 0.48 s + Smart Turn 0.30 s), more on
the Mumbai box's single shared vCPU. Five calls answered together spent several
seconds of the box's only core loading the same two models, at the moment their
openings had to play. In the 5-call tests of 2026-11-14 openings went out 18-31 s
late, and the whole bot stalled until a call ended. Each session also held its
own copy of the model weights in memory.

WHAT. One InferenceSession per model, shared by every call. Behaviour is
unchanged:
  * Smart Turn is stateless per inference (the session only runs the model); the
    per-call audio buffer lives in BaseSmartTurn, which every call still gets.
  * Silero keeps a small recurrent state (_state, _context) BETWEEN chunks. That
    lives on SileroOnnxModel, so every call gets its OWN SileroOnnxModel whose
    state starts at zero exactly as before; only `.session` is shared. The state
    goes in and out of session.run() as arguments, so calls never see each
    other's state.
  * onnxruntime's InferenceSession.run is safe to call from several threads at
    once (each call's VAD and Smart Turn run on their own executor thread).

FALLBACK. If this pipecat's internals do not look as expected (an upgrade), or
SHARED_AUDIO_MODELS=false, the stock per-call classes are used, as before.
"""
from __future__ import annotations

import logging
import os
import threading

logger = logging.getLogger("voice_bot")

_lock = threading.Lock()
_silero_session = None
_smart_turn_session = None
_smart_turn_path = None


def shared_enabled() -> bool:
    return os.environ.get("SHARED_AUDIO_MODELS", "true").strip().lower() != "false"


def _silero_shared_session():
    """The one Silero session, built by pipecat's own loader the first time."""
    global _silero_session
    with _lock:
        if _silero_session is None:
            from pipecat.audio.vad.silero import SileroVADAnalyzer
            probe = SileroVADAnalyzer()
            _silero_session = probe._model.session
        return _silero_session


def _smart_turn_shared_session(cpu_count: int = 1):
    """The one Smart Turn session, built by pipecat's own loader the first time."""
    global _smart_turn_session, _smart_turn_path
    with _lock:
        if _smart_turn_session is None:
            from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
            probe = LocalSmartTurnAnalyzerV3(cpu_count=cpu_count)
            _smart_turn_session = probe._session
        return _smart_turn_session


def warm() -> None:
    """Load both models now (startup, off the event loop) so no call pays for it."""
    if not shared_enabled():
        return
    _silero_shared_session()
    _smart_turn_shared_session()
    logger.info("audio models: Silero VAD and Smart Turn v3 loaded once, shared by every call")


def make_vad(**kwargs):
    """A SileroVADAnalyzer for one call: its own state, the shared session."""
    from pipecat.audio.vad.silero import SileroOnnxModel, SileroVADAnalyzer
    from pipecat.audio.vad.vad_analyzer import VADAnalyzer
    if not shared_enabled():
        return SileroVADAnalyzer(**kwargs)
    try:
        session = _silero_shared_session()

        class _SharedSileroVAD(SileroVADAnalyzer):
            def __init__(self, *, sample_rate=None, params=None):
                VADAnalyzer.__init__(self, sample_rate=sample_rate, params=params)
                model = SileroOnnxModel.__new__(SileroOnnxModel)
                model.session = session
                model.reset_states()
                model.sample_rates = [8000, 16000]
                self._model = model
                self._last_reset_time = 0

        vad = _SharedSileroVAD(**kwargs)
        # Same attributes a stock instance has, or fall back.
        stock_attrs = ("_model", "_last_reset_time")
        if not all(hasattr(vad, a) for a in stock_attrs):
            raise AttributeError("unexpected SileroVADAnalyzer shape")
        return vad
    except Exception:
        logger.exception("audio models: shared Silero unavailable — loading per call")
        return SileroVADAnalyzer(**kwargs)


def make_smart_turn(cpu_count: int = 1, **kwargs):
    """A LocalSmartTurnAnalyzerV3 for one call, on the shared session."""
    from pipecat.audio.turn.smart_turn.base_smart_turn import BaseSmartTurn
    from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
    if not shared_enabled():
        return LocalSmartTurnAnalyzerV3(cpu_count=cpu_count, **kwargs)
    try:
        session = _smart_turn_shared_session(cpu_count)
        try:
            from pipecat.utils.env import env_truthy
        except Exception:                         # older/newer pipecat: same default
            def env_truthy(name, default=False):
                v = os.environ.get(name)
                return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")

        class _SharedSmartTurn(LocalSmartTurnAnalyzerV3):
            def __init__(self, **kw):
                BaseSmartTurn.__init__(self, **kw)
                self._log_data = env_truthy("PIPECAT_SMART_TURN_LOG_DATA", default=False)
                self._session = session

        st = _SharedSmartTurn(**kwargs)
        if not hasattr(st, "_session"):
            raise AttributeError("unexpected LocalSmartTurnAnalyzerV3 shape")
        return st
    except Exception:
        logger.exception("audio models: shared Smart Turn unavailable — loading per call")
        return LocalSmartTurnAnalyzerV3(cpu_count=cpu_count, **kwargs)
