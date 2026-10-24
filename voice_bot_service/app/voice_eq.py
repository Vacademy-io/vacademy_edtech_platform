"""Telephone-band EQ for the bot's OWN voice.

Measured on the production path (2026-09-11, 13.3 s of Smallest/mrunal speech
resampled to the 8 kHz leg): our voice puts 30.8% of its energy below 300 Hz,
against 15.3% for a real recording made through real microphones. A caller's
voice reaches us through a handset mic and an analog hybrid that roll that band
off hard; ours is a studio-clean 24 kHz render that we merely resample. So on
one line you get a voice that sounds band-limited and a voice that sounds
full-range and close-miked, and that contrast is what reads as "recording"
rather than "person on a phone".

This puts the bot in the caller's band: 300 Hz high-pass, gentle 3.4 kHz
low-pass, and a small presence lift to win back the intelligibility the
high-pass costs. Measured over the same speech:

    raw                            <300Hz 30.8%  300-3400 68.3%  rms -19.7 dBFS
    HP300 + LP3400 + 2.5dB@1700    <300Hz 18.4%  300-3400 81.2%  rms -22.7 dBFS

i.e. it lands on the real-recording profile. The ~3 dB the high-pass removes is
returned by VOICE_EQ_MAKEUP_DB so the bot does not simply get quieter; peak
after makeup measured -4.5 dBFS, so nothing clips.

NOT applied to the ambience: that is a real recording with the right spectrum
already, and it is mixed inside the output transport — downstream of this
processor, which therefore cannot touch it.

The DSP (TelephoneEQ) is deliberately free of pipecat so it can be tested
against sine waves; VoiceEQProcessor is the thin frame glue.
"""
from __future__ import annotations

import logging
import math

logger = logging.getLogger("voice_bot")

# Fixed because they are not worth an env knob: 3400 Hz is the telephone
# channel's own corner, and 1700 Hz is the middle of the band the high-pass
# thins. Both are one edit away if an A/B says otherwise.
LOWPASS_HZ = 3400.0
PRESENCE_HZ = 1700.0
PRESENCE_Q = 1.0


def _peaking_sos(f0: float, q: float, gain_db: float, fs: float):
    """RBJ peaking-EQ biquad as one second-order section [b0,b1,b2,1,a1,a2]."""
    import numpy as np

    A = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * f0 / fs
    alpha = math.sin(w0) / (2 * q)
    cos_w0 = math.cos(w0)
    b = [1 + alpha * A, -2 * cos_w0, 1 - alpha * A]
    a = [1 + alpha / A, -2 * cos_w0, 1 - alpha / A]
    return np.array([[b[0] / a[0], b[1] / a[0], b[2] / a[0],
                      1.0, a[1] / a[0], a[2] / a[0]]])


class TelephoneEQ:
    """Stateful band-pass + presence + makeup, safe to feed one frame at a time.

    Filter state is kept PER SAMPLE RATE and carried across calls to
    ``process``: an IIR restarted every 20 ms frame clicks at every boundary.
    Per-rate matters because the frames reaching this stage are at whatever the
    TTS produced (24 kHz for Smallest) while cache hits are stored at the leg's
    8 kHz — both appear in one call.
    """

    def __init__(self, highpass_hz: float = 300.0, presence_db: float = 2.5,
                 makeup_db: float = 2.0, lowpass_hz: float = LOWPASS_HZ,
                 presence_hz: float = PRESENCE_HZ):
        self.highpass_hz = float(highpass_hz)
        self.lowpass_hz = float(lowpass_hz)
        self.presence_hz = float(presence_hz)
        self.presence_db = float(presence_db)
        self._makeup = 10 ** (float(makeup_db) / 20.0)
        self._states: dict[int, tuple] = {}      # rate -> (sos, zi)
        self.clipped_samples = 0

    def _for_rate(self, sample_rate: int):
        st = self._states.get(sample_rate)
        if st is not None:
            return st
        import numpy as np
        from scipy.signal import butter

        nyq = sample_rate / 2.0
        sections = []
        hp = max(20.0, min(self.highpass_hz, nyq * 0.9))
        sections.append(butter(2, hp, "highpass", fs=sample_rate, output="sos"))
        lp = min(self.lowpass_hz, nyq * 0.95)
        if lp > hp * 1.5:
            sections.append(butter(2, lp, "lowpass", fs=sample_rate, output="sos"))
        if abs(self.presence_db) > 0.05 and self.presence_hz < nyq * 0.9:
            sections.append(_peaking_sos(self.presence_hz, PRESENCE_Q,
                                         self.presence_db, sample_rate))
        sos = np.vstack(sections)
        zi = np.zeros((sos.shape[0], 2))         # at rest, not steady-state
        st = (sos, zi)
        self._states[sample_rate] = st
        return st

    def process(self, pcm: bytes, sample_rate: int) -> bytes:
        """Filter one chunk of 16-bit mono PCM. Returns bytes of the same length."""
        if not pcm or sample_rate <= 0:
            return pcm
        import numpy as np
        from scipy.signal import sosfilt

        x = np.frombuffer(pcm, dtype=np.int16)
        if x.size == 0:
            return pcm
        sos, zi = self._for_rate(sample_rate)
        y, zi = sosfilt(sos, x.astype(np.float64), zi=zi)
        self._states[sample_rate] = (sos, zi)
        y *= self._makeup
        clipped = int(np.count_nonzero(np.abs(y) > 32767))
        if clipped:
            self.clipped_samples += clipped
        return np.clip(y, -32768, 32767).astype(np.int16).tobytes()


def build_voice_eq(settings) -> TelephoneEQ | None:
    """The per-call EQ, or None when disabled/unavailable (then nothing changes)."""
    if not getattr(settings, "voice_eq_enabled", False):
        return None
    try:
        import numpy  # noqa: F401
        from scipy.signal import butter, sosfilt  # noqa: F401
    except Exception as e:
        logger.warning("voice-eq: scipy/numpy unavailable (%s) — voice left unfiltered", e)
        return None
    return TelephoneEQ(highpass_hz=settings.voice_eq_highpass_hz,
                       presence_db=settings.voice_eq_presence_db,
                       makeup_db=settings.voice_eq_makeup_db)


def make_voice_eq_processor(eq: TelephoneEQ):
    """Wrap an EQ in a FrameProcessor. Imported lazily so this module stays
    testable (and importable) without pipecat."""
    from pipecat.frames.frames import Frame, OutputAudioRawFrame
    from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

    class VoiceEQProcessor(FrameProcessor):
        """Filters every bot-bound audio frame; passes everything else through.

        Sits AFTER DuckGate so held-then-dropped audio is never filtered for
        nothing, and BEFORE transport.output() so it catches cache hits and
        scripted lines as well as live TTS — but not the ambience.
        """

        def __init__(self, eq: TelephoneEQ):
            super().__init__()
            self._eq = eq

        async def process_frame(self, frame: Frame, direction: FrameDirection):
            await super().process_frame(frame, direction)
            if (direction == FrameDirection.DOWNSTREAM
                    and isinstance(frame, OutputAudioRawFrame) and frame.audio):
                try:
                    frame.audio = self._eq.process(frame.audio, frame.sample_rate)
                except Exception:
                    # Never let a DSP error mute a call: pass the audio through.
                    logger.exception("voice-eq: filter failed — passing audio through")
            await self.push_frame(frame, direction)

    return VoiceEQProcessor(eq)
