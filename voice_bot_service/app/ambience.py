"""Continuous office room-tone under every call.

Two small pieces, both removable without touching anything else:

* ``build_ambience_mixer`` — a pipecat ``SoundfileMixer`` for the output
  transport (``FastAPIWebsocketParams(audio_out_mixer=...)``). The transport
  calls ``mixer.start(sample_rate)`` when it starts — on the StartFrame, before
  the greeting is queued — and from then on mixes the loop into BOTH the bot's
  audio and the silence it generates between turns (base_output's
  ``with_mixer`` path), so the call opens on room tone and never drops to
  digital silence. Interruptions do not stop it (base_output keeps the audio
  task alive when a mixer is attached).

* ``AmbienceDucker`` — sits just before ``transport.output()`` and owns the
  mixer's gain: it lowers it while the bot speaks (TTSStartedFrame → 0.6×),
  restores it when the bot stops, and drifts it slowly the whole time so the
  bed breathes like a room instead of sitting at one fixed level. Pure control
  frames; delete the processor from the pipeline and the ambience simply plays
  flat.

The asset must be 8 kHz mono 16-bit PCM: pipecat's mixer refuses a file whose
rate differs from the transport's (it logs a warning and mixes nothing), and
it does NOT resample. Verified in tests/test_call_behavior.py.
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
import time
from pathlib import Path

from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    Frame,
    InterruptionFrame,
    MixerUpdateSettingsFrame,
    StartFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

logger = logging.getLogger("voice_bot")

# Relative to the PACKAGE, never the CWD: uvicorn runs from /srv in the image
# and from wherever a developer happens to be locally.
ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
AMBIENCE_FILE = ASSETS_DIR / "call_center_ambience_8k_mono.wav"
AMBIENCE_SOUND = "office"
SPEAKING_GAIN = 0.6     # ambience × this while the bot is talking

# How often the drift loop re-evaluates the level, and how small a change is
# not worth a frame. 2 s ticks over a 40 s period give ~20 steps per cycle —
# far below the ear's threshold for hearing a level move as a step.
DRIFT_TICK_SECS = 2.0
DRIFT_MIN_STEP_DB = 0.25


def build_ambience_mixer(settings):
    """The per-call mixer, or None when disabled / unavailable.

    None is the safe answer in every failure mode (extra not installed, file
    missing): the transport then behaves exactly as before this feature."""
    if not settings.ambience_enabled:
        return None
    if not AMBIENCE_FILE.is_file():
        logger.warning("ambience: %s missing — no room tone this call", AMBIENCE_FILE)
        return None
    try:
        from pipecat.audio.mixers.soundfile_mixer import SoundfileMixer
    except Exception as e:  # ImportError when pipecat-ai[soundfile] is absent
        logger.warning("ambience: soundfile mixer unavailable (%s) — no room tone", e)
        return None
    volume = max(0.0, min(1.0, float(settings.ambience_volume)))
    return SoundfileMixer(
        sound_files={AMBIENCE_SOUND: str(AMBIENCE_FILE)},
        default_sound=AMBIENCE_SOUND,
        volume=volume,
        loop=True,
    )


class AmbienceDucker(FrameProcessor):
    """Owns the room tone's level: ducked under speech, drifting while idle.

    Everything it emits is a MixerUpdateSettingsFrame, which the transport
    hands to the mixer and ignores when none is attached — so the processor is
    harmless with ambience off.

    ONE owner on purpose. A separate drift task writing volume would fight the
    duck (each would clobber the other's last value); instead every update
    comes from :meth:`_target`, which folds both together.
    """

    def __init__(self, base_volume: float, speaking_gain: float = SPEAKING_GAIN,
                 drift_db: float = 0.0, drift_period_secs: float = 40.0):
        super().__init__()
        self._base = max(0.0, min(1.0, float(base_volume)))
        self._gain = float(speaking_gain)
        self._speaking = round(self._base * self._gain, 4)
        self._ducked = False
        self._drift_db = max(0.0, float(drift_db))
        self._period = max(5.0, float(drift_period_secs))
        # Randomised per call: two calls at the same moment must not breathe in
        # step, and one caller rung twice must not hear the same movement.
        self._phase = random.random() * 2 * math.pi
        self._t0: float | None = None       # None = drift off (set on StartFrame)
        self._drift_task = None
        self._last_sent: float | None = None

    # -- level ---------------------------------------------------------------

    def _drift(self, now: float) -> float:
        """Slow sinusoidal gain multiplier, 1.0 until the call has started."""
        if self._t0 is None or self._drift_db <= 0:
            return 1.0
        db = self._drift_db * math.sin(2 * math.pi * (now - self._t0) / self._period
                                       + self._phase)
        return 10 ** (db / 20.0)

    def _target(self, now: float) -> float:
        v = self._base * self._drift(now) * (self._gain if self._ducked else 1.0)
        return round(max(0.0, min(1.0, v)), 4)

    async def _send_target(self, direction, force: bool = False):
        v = self._target(time.time())
        if not force and self._last_sent is not None and v > 0 and self._last_sent > 0:
            if abs(20 * math.log10(v / self._last_sent)) < DRIFT_MIN_STEP_DB:
                return                      # below audibility; not worth a frame
        self._last_sent = v
        await self.push_frame(MixerUpdateSettingsFrame(settings={"volume": v}), direction)

    async def _drift_loop(self):
        while True:
            await asyncio.sleep(DRIFT_TICK_SECS)
            try:
                await self._send_target(FrameDirection.DOWNSTREAM)
            except Exception:
                logger.debug("ambience: drift update failed", exc_info=True)

    async def _stop_drift(self):
        # pipecat 1.4's cancel_task is a COROUTINE. Called without await it did
        # nothing, so the drift loop outlived every call — and through this
        # processor's links it kept the call's whole pipeline alive (VAD + Smart
        # Turn ONNX sessions included): ~30-50 MB per call, never freed, and the
        # Mumbai box was OOM-killed 20 times between 2026-09-15 and 09-30.
        task, self._drift_task = self._drift_task, None
        if task is not None:
            task.cancel()                   # at once, even if the await below fails
            try:
                await self.cancel_task(task)
            except Exception:
                pass

    # -- frames --------------------------------------------------------------

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            await self.push_frame(frame, direction)
            if self._drift_db > 0 and self._drift_task is None:
                self._t0 = time.time()
                self._drift_task = self.create_task(self._drift_loop())
            return

        if isinstance(frame, (EndFrame, CancelFrame)):
            await self._stop_drift()
            await self.push_frame(frame, direction)
            return

        if direction == FrameDirection.DOWNSTREAM and isinstance(frame, TTSStartedFrame):
            if not self._ducked:
                self._ducked = True
                await self._send_target(direction, force=True)   # before the audio
            await self.push_frame(frame, direction)
            return

        if direction == FrameDirection.DOWNSTREAM and isinstance(
                frame, (TTSStoppedFrame, InterruptionFrame)):
            await self.push_frame(frame, direction)              # after the audio
            if self._ducked:
                self._ducked = False
                await self._send_target(direction, force=True)
            return

        await self.push_frame(frame, direction)
